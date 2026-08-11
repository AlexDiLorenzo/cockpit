/**
 * Tests du noyau de calcul.
 *   npm test
 *
 * Les définitions du cahier des charges sont vérifiées une à une, sur des
 * cas construits à la main : c'est là que se joue la justesse des trois
 * écrans, un écart ici se propage partout.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseDate, parseDateMulti, parseNum, parseBool, isTotalRow,
  normalizeDataset, missionKey, isoWeekKey, dayKey, isNight, isWeekend,
} from '../src/core/normalize.js'
import {
  median, percentile, sla, delaiAcceptation, delaiArrivee, dprImputables,
  nonFactures, caOperationnel, caParJourDepanneur, conformiteSaisie,
  slaHeatmap, hourlyProfile, expectedShareAt, realtimeCounters,
  margeIntervention, margeAgregee, coutDesPertes, mixActivite,
  lastWeekKeys, lastMonthKeys, series, weekOf, DEFAULT_COSTS, periodeDeRevue,
} from '../src/core/metrics.js'
import { buildMapping } from '../src/core/schema.js'

// ---------------------------------------------------------------------------
// Jeu d'essai
// ---------------------------------------------------------------------------

const H = [
  "Origine d'appel", 'Numéro de dossier', 'Numéro de mission', 'Dépanneur',
  "Type d'intervention", 'Véhicule utilisé', 'Rendez-vous', 'Raison du DPR',
  'Non Payant', 'Scénario respecté pour la géolocalisation', 'Nombre de photos prises',
  'Envoi du CRO', 'Nombre de KMS Roulés', 'Temps déclaratif, en minutes',
  'Total HT', 'Montant majoré HT', 'Frais de parc', 'Date de facturation',
  'Date de première affectation', "Date d'acceptation (mobile)",
  "Date d'arrivée sur lieu d'intervention (mobile)", 'Date de fin (mobile)',
  "Heure d'appel", "Date d'acceptation (modifiée)",
]

/** Fabrique une ligne brute façon PowerPanne. */
function ligne(o = {}) {
  return {
    "Origine d'appel": o.origine ?? 'AXA 2026',
    'Numéro de dossier': o.dossier ?? '1000',
    'Numéro de mission': o.mission ?? '1000OM1',
    'Dépanneur': o.dep ?? 'Alice A',
    "Type d'intervention": o.type ?? 'Remorquage',
    'Véhicule utilisé': o.veh ?? 'AA-111-BB',
    'Rendez-vous': o.rdv ?? 'NON',
    'Raison du DPR': o.dpr ?? null,
    'Non Payant': o.nonPayant ?? 'NON',
    'Scénario respecté pour la géolocalisation': o.geo ?? 'OUI',
    'Nombre de photos prises': o.photos ?? '4',
    'Envoi du CRO': o.cro ?? '02/07/2026 10:00:00',
    'Nombre de KMS Roulés': o.km ?? 20,
    'Temps déclaratif, en minutes': o.temps ?? 60,
    'Total HT': o.ht ?? 100,
    'Montant majoré HT': o.majore ?? 0,
    'Frais de parc': 0,
    'Date de facturation': o.facture ?? '',
    'Date de première affectation': o.affect ?? '01/07/2026 10:00:00',
    "Date d'acceptation (mobile)": o.accept ?? '01/07/2026 10:05:00',
    "Date d'arrivée sur lieu d'intervention (mobile)": o.arrivee ?? '01/07/2026 10:30:00',
    'Date de fin (mobile)': o.fin ?? '01/07/2026 11:00:00',
    "Heure d'appel": o.appel ?? '01/07/2026 09:55:00',
    "Date d'acceptation (modifiée)": '01/07/2026 12:00:00',
  }
}

const norm = (rows, opts) => normalizeDataset({ headers: H, rows, sheets: [] }, opts)

// ---------------------------------------------------------------------------
// Parseurs
// ---------------------------------------------------------------------------

test('parseDate lit le format PowerPanne en heure locale', () => {
  const d = parseDate('21/07/2026 17:05:31')
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 6)
  assert.equal(d.getDate(), 21)
  assert.equal(d.getHours(), 17)
  assert.equal(d.getMinutes(), 5)
})

test('parseDate accepte une date seule et rejette les marqueurs de vide', () => {
  assert.equal(parseDate('23/07/2026').getDate(), 23)
  assert.equal(parseDate(''), null)
  assert.equal(parseDate('/'), null)
  assert.equal(parseDate('---'), null)
  assert.equal(parseDate(null), null)
})

test('parseDateMulti retient la première de plusieurs dates de facturation', () => {
  const r = parseDateMulti('26/07/2026 09/07/2026 26/07/2026')
  assert.equal(r.count, 3)
  assert.equal(r.date.getDate(), 9) // la plus ancienne
  assert.equal(r.date.getMonth(), 6)
  assert.deepEqual(parseDateMulti(''), { date: null, count: 0 })
})

test('parseNum gère la virgule décimale et les espaces', () => {
  assert.equal(parseNum('1 234,56'), 1234.56)
  assert.equal(parseNum(42), 42)
  assert.equal(parseNum(''), null)
  assert.equal(parseNum('/'), null)
})

test('parseBool ne reconnaît que les valeurs affirmatives', () => {
  assert.equal(parseBool('OUI'), true)
  assert.equal(parseBool('oui'), true)
  assert.equal(parseBool('NON'), false)
  assert.equal(parseBool(null), false)
})

// ---------------------------------------------------------------------------
// Nettoyage
// ---------------------------------------------------------------------------

test('la ligne de total est reconnue à ses barres obliques', () => {
  const total = Object.fromEntries(H.map((h) => [h, '/']))
  assert.equal(isTotalRow(total, H), true)
  assert.equal(isTotalRow(ligne(), H), false)
})

test('normalizeDataset exclut les totaux et isole la facturation groupée', () => {
  const total = Object.fromEntries(H.map((h) => [h, '/']))
  const { interventions, grouped, report } = norm([
    ligne({ mission: 'A' }),
    ligne({ mission: 'B', ht: 5000 }),
    total,
  ])
  assert.equal(report.totalRowsExcluded, 1)
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].totalHT, 5000)
  assert.equal(interventions.length, 1)
  assert.equal(report.groupedBillingAmount, 5000)
})

test('le seuil de facturation groupée est réglable', () => {
  const { interventions, grouped } = norm(
    [ligne({ mission: 'A', ht: 1500 })],
    { groupedBillingThreshold: 1000 }
  )
  assert.equal(grouped.length, 1)
  assert.equal(interventions.length, 0)
})

test('les horodatages « (modifiée) » sont ignorés au profit du mobile', () => {
  const { interventions, report } = norm([ligne()])
  // L'acceptation modifiée est à 12h00, la mobile à 10h05 : c'est la mobile
  // qui doit produire un délai de 5 minutes.
  assert.equal(interventions[0].delaiAcceptationMin, 5)
  assert.ok(report.ignoredColumns.some((c) => c.includes('modifiée')))
})

test('deux exports qui se chevauchent ne créent pas de doublon', () => {
  const l = ligne({ mission: 'X' })
  const { interventions, report } = norm([l, { ...l }])
  assert.equal(interventions.length, 1)
  assert.equal(report.duplicatesMerged, 1)
})

test('deux missions du même dossier restent distinctes', () => {
  const { interventions } = norm([
    ligne({ dossier: '900', mission: '900OM1', dep: 'Alice A' }),
    ligne({ dossier: '900', mission: '900OM2', dep: 'Bob B', ht: 80 }),
  ])
  assert.equal(interventions.length, 2)
  assert.equal(caOperationnel(interventions).value, 180)
})

test("un numéro de mission non fiable n'écrase pas une autre intervention", () => {
  // Sur l'export réel, « 1 » revient 381 fois dans le champ mission.
  const { interventions } = norm([
    ligne({ dossier: '901', mission: '1', affect: '01/07/2026 10:00:00' }),
    ligne({ dossier: '902', mission: '1', affect: '01/07/2026 14:00:00' }),
  ])
  assert.equal(interventions.length, 2)
})

// ---------------------------------------------------------------------------
// Définitions de calcul
// ---------------------------------------------------------------------------

test("délai d'acceptation = acceptation (mobile) − première affectation", () => {
  const { interventions } = norm([
    ligne({ mission: 'A', affect: '01/07/2026 10:00:00', accept: '01/07/2026 10:10:00' }),
    ligne({ mission: 'B', affect: '01/07/2026 10:00:00', accept: '01/07/2026 10:30:00' }),
  ])
  assert.equal(delaiAcceptation(interventions).value, 20)
})

test("délai d'arrivée = arrivée (mobile) − première affectation", () => {
  const { interventions } = norm([
    ligne({ mission: 'A', affect: '01/07/2026 10:00:00', arrivee: '01/07/2026 10:40:00' }),
  ])
  assert.equal(delaiArrivee(interventions).value, 40)
})

test('les délais négatifs et supérieurs à 24 h sont écartés et comptés', () => {
  const { interventions, report } = norm([
    ligne({ mission: 'A', affect: '01/07/2026 10:00:00', arrivee: '01/07/2026 10:30:00' }),
    ligne({ mission: 'B', affect: '01/07/2026 10:00:00', arrivee: '01/07/2026 09:00:00' }), // négatif
    ligne({ mission: 'C', affect: '01/07/2026 10:00:00', arrivee: '03/07/2026 10:00:00' }), // 48 h
  ])
  const d = delaiArrivee(interventions)
  assert.equal(d.value, 30)
  assert.equal(d.n, 1)
  assert.equal(d.excluded, 2)
  assert.equal(report.outlierArrivee, 2)
})

test('le SLA exclut les rendez-vous', () => {
  const { interventions } = norm([
    ligne({ mission: 'A', arrivee: '01/07/2026 10:30:00' }),                 // 30 min, dans les temps
    ligne({ mission: 'B', arrivee: '01/07/2026 11:30:00' }),                 // 90 min, hors délai
    ligne({ mission: 'C', arrivee: '01/07/2026 14:00:00', rdv: 'OUI' }),     // rendez-vous, exclu
  ])
  const s = sla(interventions)
  assert.equal(s.n, 2)
  assert.equal(s.ok, 1)
  assert.equal(s.value, 0.5)
  assert.equal(s.rendezVousExclus, 1)
  assert.equal(s.hors.length, 1)
})

test('le SLA prend 45 minutes pile comme dans les temps', () => {
  const { interventions } = norm([ligne({ arrivee: '01/07/2026 10:45:00' })])
  assert.equal(sla(interventions).value, 1)
})

test("les DPR imputables excluent l'annulation client", () => {
  const { interventions } = norm([
    ligne({ mission: 'A', dpr: 'materiel_inapproprie' }),
    ligne({ mission: 'B', dpr: 'vehicule_non_trouve' }),
    ligne({ mission: 'C', dpr: 'annulation_client' }),
    ligne({ mission: 'D' }),
  ])
  const d = dprImputables(interventions)
  assert.equal(d.value, 2)
  assert.equal(d.annulationsClient, 1)
  assert.equal(d.rate, 0.5)
})

test('un dossier sans date de facturation est non facturé', () => {
  const { interventions } = norm([
    ligne({ mission: 'A', facture: '' }),
    ligne({ mission: 'B', facture: '05/07/2026' }),
  ])
  assert.equal(interventions.find((i) => i.missionNo === 'A').estFacture, false)
  assert.equal(interventions.find((i) => i.missionNo === 'B').estFacture, true)
})

test('les non facturés de plus de 7 jours comptent en nombre et en euros', () => {
  const { interventions } = norm([
    ligne({ mission: 'A', affect: '01/07/2026 10:00:00', ht: 120, facture: '' }),
    ligne({ mission: 'B', affect: '20/07/2026 10:00:00', ht: 300, facture: '' }), // trop récent
    ligne({ mission: 'C', affect: '01/07/2026 10:00:00', ht: 500, facture: '10/07/2026' }),
  ])
  const nf = nonFactures(interventions, { minDays: 7, asOf: new Date(2026, 6, 22) })
  assert.equal(nf.value, 1)
  assert.equal(nf.amount, 120)
})

test('le CA opérationnel ignore la facturation groupée', () => {
  const { interventions } = norm([
    ligne({ mission: 'A', ht: 100 }),
    ligne({ mission: 'B', ht: 200 }),
    ligne({ mission: 'C', ht: 9000 }),
  ])
  const ca = caOperationnel(interventions)
  assert.equal(ca.value, 300)
  assert.equal(ca.panierMoyen, 150)
})

test('le CA par jour-dépanneur signale les saisies manquantes', () => {
  const { interventions } = norm([
    ligne({ mission: 'A', dep: 'Alice A', ht: 500 }),
    ligne({ mission: 'B', dep: 'Bob B', ht: 300 }),
  ])
  const r = caParJourDepanneur(interventions, { 'Alice A': 5 })
  assert.equal(r.value, 100)      // 500 € sur 5 jours ; Bob est hors calcul
  assert.equal(r.excluded, 1)
  assert.equal(r.classement.find((c) => c.key === 'Bob B').manqueSaisie, true)
})

test('la conformité de saisie moyenne photos, géolocalisation et CRO', () => {
  const { interventions } = norm([
    ligne({ mission: 'A', photos: '0', geo: 'OUI', cro: '02/07/2026 10:00:00' }),
    ligne({ mission: 'B', photos: '3', geo: 'NON', cro: '' }),
  ])
  const c = conformiteSaisie(interventions)
  assert.equal(c.photos, 0.5)
  assert.equal(c.geo, 0.5)
  assert.equal(c.cro, 0.5)
  assert.equal(c.value, 0.5)
})

test('la carte SLA heure × jour place les interventions au bon créneau', () => {
  const { interventions } = norm([
    ligne({ mission: 'A', affect: '01/07/2026 10:00:00', arrivee: '01/07/2026 10:20:00' }),
  ])
  const grid = slaHeatmap(interventions)
  const mercredi = new Date(2026, 6, 1).getDay()
  assert.equal(grid[mercredi][10].n, 1)
  assert.equal(grid[mercredi][10].value, 1)
})

// ---------------------------------------------------------------------------
// Écran temps réel
// ---------------------------------------------------------------------------

test('le profil horaire médian est monotone et sert la trajectoire', () => {
  const rows = []
  for (const j of ['01/07/2026', '08/07/2026', '15/07/2026']) {
    rows.push(ligne({ mission: `${j}a`, dossier: `${j}a`, affect: `${j} 09:00:00`, ht: 100 }))
    rows.push(ligne({ mission: `${j}b`, dossier: `${j}b`, affect: `${j} 15:00:00`, ht: 300 }))
  }
  const { interventions } = norm(rows)
  const p = hourlyProfile(interventions, new Date(2026, 6, 1).getDay())
  assert.equal(p.days, 3)
  assert.equal(p.dailyTotal, 400)
  assert.equal(p.profile[9], 0.25)
  assert.equal(p.profile[15], 1)
  for (let h = 1; h < 24; h++) assert.ok(p.profile[h] >= p.profile[h - 1])
  // À 9 h 30, la moitié de l'heure de 9 h est écoulée.
  assert.equal(expectedShareAt(p.profile, new Date(2026, 6, 22, 9, 30)), 0.125)
})

test('les cinq compteurs temps réel isolent les bons dossiers', () => {
  const now = new Date(2026, 6, 22, 12, 0, 0)
  const rows = [
    // 1 — appelé il y a 40 min, jamais affecté
    { ...ligne({ mission: 'NA', dossier: 'NA', appel: '22/07/2026 11:20:00' }),
      'Date de première affectation': '', "Date d'acceptation (mobile)": '',
      "Date d'arrivée sur lieu d'intervention (mobile)": '', 'Date de fin (mobile)': '' },
    // 2 — affecté il y a 90 min, pas d'arrivée
    { ...ligne({ mission: 'RT', dossier: 'RT', affect: '22/07/2026 10:30:00' }),
      "Date d'arrivée sur lieu d'intervention (mobile)": '', 'Date de fin (mobile)': '' },
    // 5 — clôturée sans photo
    ligne({ mission: 'AN', dossier: 'AN', affect: '22/07/2026 09:00:00',
      arrivee: '22/07/2026 09:20:00', fin: '22/07/2026 10:00:00', photos: '0' }),
  ]
  const { interventions } = norm(rows)
  const c = realtimeCounters(interventions, [], { now, depanneursEnService: 2 })

  assert.equal(c.nonAffectes.value, 1)
  assert.equal(c.nonAffectes.list[0].dossierNo, 'NA')
  assert.equal(c.enRetard.value, 1)
  assert.equal(c.enRetard.list[0].dossierNo, 'RT')
  assert.equal(c.charge.ouverts, 2)          // NA et RT n'ont pas de date de fin
  assert.equal(c.charge.value, 1)            // 2 dossiers ouverts / 2 dépanneurs
  assert.ok(c.anomalies.list.some((a) => a.dossierNo === 'AN'))
  assert.equal(c.trajectoire.manqueHistorique, true)
})

test('un rendez-vous en retard ne déclenche pas le compteur 2', () => {
  const now = new Date(2026, 6, 22, 12, 0, 0)
  const rows = [{
    ...ligne({ mission: 'RV', affect: '22/07/2026 09:00:00', rdv: 'OUI' }),
    "Date d'arrivée sur lieu d'intervention (mobile)": '', 'Date de fin (mobile)': '',
  }]
  const { interventions } = norm(rows)
  assert.equal(realtimeCounters(interventions, [], { now }).enRetard.value, 0)
})

test('la charge reste indéterminée tant que l’effectif n’est pas saisi', () => {
  const { interventions } = norm([ligne()])
  const c = realtimeCounters(interventions, [], { now: new Date(2026, 6, 1, 12), depanneursEnService: 0 })
  assert.equal(c.charge.value, null)
  assert.equal(c.charge.manqueSaisie, true)
})

// ---------------------------------------------------------------------------
// Écran mensuel
// ---------------------------------------------------------------------------

test('la marge retranche le temps et les kilomètres, et expose sa base', () => {
  const { interventions } = norm([ligne({ ht: 100, temps: 60, km: 20 })])
  const m = margeIntervention(interventions[0], { coutHoraireCharge: 30, coutKmDefaut: 0.5 })
  assert.equal(m.coutTemps, 30)   // 60 min à 30 €/h
  assert.equal(m.coutKm, 10)      // 20 km à 0,50 €
  assert.equal(m.marge, 60)
  assert.equal(m.tauxMarge, 0.6)

  const a = margeAgregee(interventions, { coutHoraireCharge: 30, coutKmDefaut: 0.5 })
  assert.equal(a.value, 60)
  const base = Object.fromEntries(a.basis.map((b) => [b.key, b.value]))
  assert.equal(base.coutHoraireCharge, 30)
  assert.equal(base.coutKmDefaut, 0.5)
})

test('un taux kilométrique par véhicule prime sur le taux par défaut', () => {
  const { interventions } = norm([ligne({ veh: 'ZZ-999-ZZ', km: 10, temps: 0 })])
  const m = margeIntervention(interventions[0], {
    coutHoraireCharge: 30, coutKmDefaut: 0.5, coutKmParVehicule: { 'ZZ-999-ZZ': 1.2 },
  })
  assert.equal(m.coutKm, 12)
  assert.equal(m.sourceTauxKm, 'ZZ-999-ZZ')
})

test('le coût des pertes ventile DPR, non payantes et majorations manquantes', () => {
  const { interventions } = norm([
    ligne({ mission: 'A', ht: 100, temps: 60, km: 0 }),
    ligne({ mission: 'B', ht: 0, temps: 60, km: 0, dpr: 'materiel_inapproprie' }),
    ligne({ mission: 'C', ht: 0, temps: 30, km: 0, nonPayant: 'OUI' }),
    // Samedi 4 juillet 2026, sans majoration
    ligne({ mission: 'D', ht: 200, temps: 60, km: 0, affect: '04/07/2026 10:00:00',
      accept: '04/07/2026 10:05:00', arrivee: '04/07/2026 10:30:00', fin: '04/07/2026 11:00:00' }),
  ])
  const p = coutDesPertes(interventions, { coutHoraireCharge: 30, coutKmDefaut: 0 })
  const parCle = Object.fromEntries(p.postes.map((x) => [x.key, x]))
  assert.equal(parCle.dpr.count, 1)
  assert.equal(parCle.nonPayant.count, 1)
  assert.equal(parCle.nonPayant.montant, 15)     // 30 min à 30 €/h
  assert.equal(parCle.majoration.count, 1)
  assert.equal(parCle.majoration.montant, 50)    // 200 € × 25 %
})

test('le mix additionne à 100 % du volume', () => {
  const { interventions } = norm([
    ligne({ mission: 'A', type: 'Remorquage', ht: 100 }),
    ligne({ mission: 'B', type: 'Remorquage', ht: 200 }),
    ligne({ mission: 'C', type: 'Relivraison', ht: 60 }),
  ])
  const mix = mixActivite(interventions)
  assert.equal(mix[0].key, 'Remorquage')
  assert.equal(mix[0].n, 2)
  assert.equal(mix[0].panier, 150)
  assert.equal(Math.round(mix.reduce((s, m) => s + m.part, 0)), 1)
})

// ---------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------

test('la semaine ISO respecte la norme (le 1er janvier 2026 est en S01)', () => {
  assert.equal(isoWeekKey(new Date(2026, 0, 1)), '2026-S01')
  assert.equal(isoWeekKey(new Date(2026, 6, 22)), '2026-S30')
  // Le 31 décembre 2024 appartient à la semaine 1 de 2025.
  assert.equal(isoWeekKey(new Date(2024, 11, 31)), '2025-S01')
})

test('la clé de jour ne dérive pas en UTC', () => {
  assert.equal(dayKey(new Date(2026, 0, 1, 0, 30)), '2026-01-01')
  assert.equal(dayKey(new Date(2026, 6, 15, 23, 59)), '2026-07-15')
})

test('les huit dernières semaines sont contiguës et finissent sur la semaine en cours', () => {
  const k = lastWeekKeys(8, new Date(2026, 6, 22))
  assert.equal(k.length, 8)
  assert.equal(k[7], '2026-S30')
  assert.equal(k[0], '2026-S23')
})

test('les douze derniers mois finissent sur le mois en cours', () => {
  const k = lastMonthKeys(12, new Date(2026, 6, 22))
  assert.equal(k.length, 12)
  assert.equal(k[11], '2026-07')
  assert.equal(k[0], '2025-08')
})

test('la revue s’ouvre sur la dernière période révolue, pas sur la période entamée', () => {
  // Export s'arrêtant le lundi 3 août 2026 : la semaine 32 est entamée,
  // le comité doit voir la 31 ; le mois d'août est entamé, la revue
  // mensuelle doit ouvrir sur juillet.
  const { interventions } = norm([
    ligne({ mission: 'A', affect: '15/07/2026 10:00:00' }),
    ligne({ mission: 'B', affect: '03/08/2026 10:00:00' }),
  ])
  assert.equal(isoWeekKey(periodeDeRevue(interventions, 'week')), '2026-S31')
  const m = periodeDeRevue(interventions, 'month')
  assert.equal(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, '2026-07')
})

test('une période complète est retenue telle quelle', () => {
  // Export s'arrêtant le dimanche 2 août 2026 : la semaine 31 est révolue.
  const { interventions } = norm([ligne({ mission: 'A', affect: '02/08/2026 10:00:00' })])
  assert.equal(isoWeekKey(periodeDeRevue(interventions, 'week')), '2026-S31')
})

test('une série conserve les périodes vides plutôt que de les sauter', () => {
  const { interventions } = norm([ligne({ affect: '01/07/2026 10:00:00' })])
  const s = series(interventions, ['2026-S26', '2026-S27', '2026-S28'], weekOf, (l) => caOperationnel(l))
  assert.equal(s.length, 3)
  assert.equal(s[1].period, '2026-S27')
  assert.equal(s[1].count, 1)
  assert.equal(s[0].count, 0)
})

test('nuit et week-end suivent les bornes du cahier des charges', () => {
  assert.equal(isNight(new Date(2026, 6, 1, 19, 0)), true)
  assert.equal(isNight(new Date(2026, 6, 1, 7, 59)), true)
  assert.equal(isNight(new Date(2026, 6, 1, 8, 0)), false)
  assert.equal(isNight(new Date(2026, 6, 1, 18, 59)), false)
  assert.equal(isWeekend(new Date(2026, 6, 4)), true)  // samedi
  assert.equal(isWeekend(new Date(2026, 6, 6)), false) // lundi
})

// ---------------------------------------------------------------------------
// Schéma
// ---------------------------------------------------------------------------

test('le mapping tolère accents, casse et apostrophes', () => {
  const { map } = buildMapping(['ORIGINE D APPEL', 'total ht', 'Numero de mission'])
  assert.equal(map.origine, 'ORIGINE D APPEL')
  assert.equal(map.totalHT, 'total ht')
  assert.equal(map.missionNo, 'Numero de mission')
})

test('les champs indispensables absents sont signalés comme bloquants', () => {
  const { missing } = buildMapping(['Total HT'])
  const cles = missing.map((f) => f.key)
  assert.ok(cles.includes('dtPremiereAffectation'))
  assert.ok(missing.find((f) => f.key === 'sla') === undefined)
  const bloquants = missing.filter((f) => f.required)
  assert.ok(bloquants.length > 0)
})

test('un mapping manuel force la colonne choisie', () => {
  const { map } = buildMapping(['Colonne exotique', 'Total HT'], { origine: 'Colonne exotique' })
  assert.equal(map.origine, 'Colonne exotique')
})

test('le nom d’onglet prime sur la colonne Dépanneur', () => {
  const { map } = buildMapping(['Dépanneur', 'Dépanneur (onglet)'])
  assert.equal(map.depanneur, 'Dépanneur (onglet)')
})

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

test('médiane et centiles', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(median([]), null)
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3)
  assert.equal(percentile([10, 20], 0.9), 19)
})
