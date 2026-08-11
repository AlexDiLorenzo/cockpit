/**
 * Vérification du noyau contre un export réel.
 *   node scripts/verify-import.mjs "chemin/du/fichier.xlsx"
 *
 * Sert de garde-fou : les chiffres imprimés ici doivent correspondre à ce
 * qu'affichent les écrans. À relancer après toute modification du noyau.
 */
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { normalizeDataset } from '../src/core/normalize.js'
import {
  sla, delaiAcceptation, delaiArrivee, dprImputables, nonFactures,
  caOperationnel, conformiteSaisie, mixActivite, rendementParVehicule,
  coutDesPertes, margeAgregee, slaBy, slaHeatmap, isoWeekKey,
} from '../src/core/metrics.js'
import { SHEET_COLUMN, depanneurFromSheet } from '../src/sources/xlsxSource.js'

const file = process.argv[2]
if (!file) { console.error('Usage: node scripts/verify-import.mjs <fichier.xlsx>'); process.exit(1) }

const t0 = Date.now()
const wb = XLSX.read(readFileSync(file), { type: 'buffer', cellDates: true })
const rows = []
let headers = null
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const json = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, blankrows: false })
  if (!json.length) continue
  if (!headers) {
    headers = (XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 })[0] || [])
      .map((h) => String(h ?? '').trim()).filter(Boolean)
    headers.push(SHEET_COLUMN)
  }
  const nom = depanneurFromSheet(name)
  for (const r of json) { r.__sheet = name; r[SHEET_COLUMN] = nom; rows.push(r) }
}

const { interventions, grouped, report } = normalizeDataset({ headers, rows, sheets: [] })
const ms = Date.now() - t0

const eur = (n) => (n == null ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €')
const pct = (n) => (n == null ? '—' : (n * 100).toFixed(1) + ' %')
const min = (n) => (n == null ? '—' : n.toFixed(1) + ' min')

console.log(`\n=== IMPORT (${ms} ms) ===`)
console.log('onglets            :', wb.SheetNames.length)
console.log('lignes source      :', report.sourceRows)
console.log('lignes de total    :', report.totalRowsExcluded)
console.log('facturation groupée:', report.groupedBillingCount, '→', eur(report.groupedBillingAmount))
console.log('doublons fusionnés :', report.duplicatesMerged)
console.log('interventions      :', report.kept)
console.log('période            :', report.periodStart, '→', report.periodEnd)
console.log('champs manquants   :', report.missingFields.map((f) => f.label).join(', ') || 'aucun')
console.log('bloquants          :', report.blockingFields.map((f) => f.label).join(', ') || 'aucun')
console.log('colonnes ignorées  :', report.ignoredColumns.length, `(${report.ignoredColumns.slice(0, 3).join(' | ')}…)`)
console.log('colonnes inutiles  :', report.unusedColumns.length)

console.log('\n=== DÉLAIS ===')
const da = delaiAcceptation(interventions)
const dr = delaiArrivee(interventions)
console.log(`acceptation médiane : ${min(da.value)}  (n=${da.n}, écartées=${da.excluded}, p90=${min(da.p90)})`)
console.log(`arrivée médiane     : ${min(dr.value)}  (n=${dr.n}, écartées=${dr.excluded}, p90=${min(dr.p90)})`)

console.log('\n=== SLA ===')
const s = sla(interventions)
console.log(`global : ${pct(s.value)}  ${s.ok}/${s.n}  (rendez-vous exclus=${s.rendezVousExclus}, aberrantes=${s.excluded})`)
for (const r of slaBy(interventions, (i) => i.origine).slice(0, 6)) {
  console.log(`   ${String(r.key).slice(0, 44).padEnd(46)} ${pct(r.value).padStart(7)}  n=${r.n}`)
}

console.log('\n=== DPR ===')
const d = dprImputables(interventions)
console.log(`imputables : ${d.value} (${pct(d.rate)}) — annulations client écartées : ${d.annulationsClient}`)
console.log('  ', d.parRaison.map((r) => `${r.raison}=${r.count}`).join('  '))

console.log('\n=== FACTURATION ===')
const asOf = new Date('2026-08-06T09:00:00')
const nf = nonFactures(interventions, { minDays: 7, asOf })
console.log(`non facturés > 7 j : ${nf.value} dossiers — ${eur(nf.amount)}`)
for (const o of nf.byOrigine.slice(0, 5)) {
  console.log(`   ${String(o.key).slice(0, 44).padEnd(46)} ${String(o.count).padStart(4)}  ${eur(o.amount).padStart(12)}`)
}

console.log('\n=== ARGENT ===')
const ca = caOperationnel(interventions)
console.log(`CA opérationnel : ${eur(ca.value)} sur ${ca.n} interventions — panier ${eur(ca.panierMoyen)}`)
console.log(`CA groupé isolé : ${eur(report.groupedBillingAmount)} sur ${grouped.length} lignes`)
const m = margeAgregee(interventions)
console.log(`marge estimée   : ${eur(m.value)} (${pct(m.tauxMarge)}) — ${eur(m.margeParIntervention)}/interv. (n=${m.n}, sans durée=${m.excluded})`)
console.log('   base :', m.basis.map((b) => `${b.label}=${b.value}${b.unit ? ' ' + b.unit : ''}`).join(' | '))

console.log('\n=== CONFORMITÉ ===')
const c = conformiteSaisie(interventions)
console.log(`global ${pct(c.value)} — photos ${pct(c.photos)} · géoloc ${pct(c.geo)} · CRO ${pct(c.cro)}`)
console.log('   trois derniers :', c.lignes.slice(0, 3).map((l) => `${l.key} ${pct(l.global)}`).join(' · '))

console.log('\n=== PERTES ===')
const p = coutDesPertes(interventions)
console.log(`total estimé : ${eur(p.value)}`)
for (const poste of p.postes) console.log(`   ${poste.label.padEnd(32)} ${String(poste.count).padStart(4)}  ${eur(poste.montant).padStart(12)}  ${poste.detail}`)

console.log('\n=== MIX ===')
for (const x of mixActivite(interventions).slice(0, 6)) {
  console.log(`   ${x.key.padEnd(28)} ${String(x.n).padStart(5)}  ${pct(x.part).padStart(7)}  panier ${eur(x.panier)}`)
}

console.log('\n=== VÉHICULES (top 5) ===')
for (const v of rendementParVehicule(interventions).slice(0, 5)) {
  console.log(`   ${String(v.key).padEnd(14)} ${String(v.n).padStart(4)} interv.  ${String(Math.round(v.km)).padStart(7)} km  ${eur(v.ca).padStart(12)}`)
}

console.log('\n=== SEMAINES PRÉSENTES ===')
const weeks = [...new Set(interventions.map((i) => i.weekKey))].sort()
console.log('  ', weeks.join('  '))

const grid = slaHeatmap(interventions)
const jours = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
console.log('\n=== SLA heure × jour (créneaux < 50 %, n ≥ 10) ===')
for (let d2 = 0; d2 < 7; d2++) {
  for (let h = 0; h < 24; h++) {
    const cell = grid[d2][h]
    if (cell.n >= 10 && cell.value < 0.5) {
      console.log(`   ${jours[d2]} ${String(h).padStart(2, '0')}h  ${pct(cell.value).padStart(7)}  n=${cell.n}`)
    }
  }
}
console.log()
