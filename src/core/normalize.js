/**
 * NORMALISATION — lignes brutes → interventions canoniques
 * =========================================================================
 * Applique les règles de nettoyage du cahier des charges :
 *   1. exclure les lignes de total (valeur "/" dans la plupart des colonnes)
 *   2. isoler la facturation groupée (Total HT > seuil, 3 000 € par défaut)
 *   3. n'utiliser que les horodatages (mobile)/(web), jamais (modifiée)
 *   4. calculer les délais et marquer les valeurs aberrantes sans les perdre
 *
 * Le module est pur : mêmes entrées → mêmes sorties, aucune dépendance.
 */

import { buildMapping, blockingMissing } from './schema.js'

export const DEFAULT_OPTIONS = {
  /** Au-delà, la ligne est traitée comme une facturation groupée. */
  groupedBillingThreshold: 3000,
  /** Un délai hors de [0 ; 1440] minutes est aberrant. */
  outlierMinMinutes: 0,
  outlierMaxMinutes: 24 * 60,
  /** Part des colonnes valant "/" à partir de laquelle la ligne est un total. */
  totalRowRatio: 0.5,
}

/** Raisons de DPR imputables à l'entreprise (l'annulation client ne l'est pas). */
export const DPR_IMPUTABLE = ['materiel_inapproprie', 'vehicule_non_trouve']

// ---------------------------------------------------------------------------
// Parseurs de valeurs
// ---------------------------------------------------------------------------

const RE_DATETIME = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/
const RE_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/

/** Convertit une valeur en Date locale, ou null. Accepte les formats
 *  « JJ/MM/AAAA HH:mm:ss », « JJ/MM/AAAA », ISO, Date native, série Excel. */
export function parseDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') {
    // Série Excel (jours depuis le 30/12/1899), en heure locale.
    if (v < 1 || v > 80000) return null
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
      d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())
  }
  const s = String(v).trim()
  if (!s || s === '/' || s === '-' || s === '---') return null

  let m = RE_DATETIME.exec(s)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0))
  m = RE_DATE.exec(s)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  m = RE_ISO.exec(s)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
  return null
}

/**
 * Une cellule « Date de facturation » peut contenir plusieurs dates séparées
 * par des espaces (un dossier facturé en plusieurs fois). On retient la
 * première et on compte les occurrences.
 */
export function parseDateMulti(v) {
  if (v == null || v === '') return { date: null, count: 0 }
  if (v instanceof Date || typeof v === 'number') {
    const d = parseDate(v)
    return { date: d, count: d ? 1 : 0 }
  }
  const parts = String(v).trim().split(/\s+/).filter(Boolean)
  const dates = parts.map(parseDate).filter(Boolean)
  if (!dates.length) return { date: null, count: 0 }
  dates.sort((a, b) => a - b)
  return { date: dates[0], count: dates.length }
}

/** Convertit en nombre : gère la virgule décimale et les espaces fines. */
export function parseNum(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).replace(/[\s  ]/g, '').replace(',', '.')
  if (!s || s === '/' || s === '-' || s === '---') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** OUI / NON / vrai / 1 → booléen. */
export function parseBool(v) {
  if (v == null || v === '') return false
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toUpperCase()
  return s === 'OUI' || s === 'O' || s === 'TRUE' || s === 'VRAI' || s === '1' || s === 'YES'
}

/** Texte nettoyé ; les marqueurs de vide de PowerPanne deviennent null. */
export function parseText(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s || s === '/' || s === '-' || s === '---') return null
  return s
}

// ---------------------------------------------------------------------------
// Détection des lignes de total
// ---------------------------------------------------------------------------

/** Une ligne de total porte "/" dans la plupart de ses colonnes. */
export function isTotalRow(row, headers, ratio = DEFAULT_OPTIONS.totalRowRatio) {
  let slashes = 0
  for (const h of headers) {
    const v = row[h]
    if (typeof v === 'string' && v.trim() === '/') slashes++
  }
  return slashes >= Math.max(3, Math.floor(headers.length * ratio))
}

// ---------------------------------------------------------------------------
// Normalisation d'une ligne
// ---------------------------------------------------------------------------

function minutesBetween(a, b) {
  if (!a || !b) return null
  return (b.getTime() - a.getTime()) / 60000
}

/**
 * Empreinte d'unicité d'une intervention.
 *
 * Ni « Numéro de dossier » ni « Numéro de mission » ne sont des clés :
 *   — un dossier porte souvent plusieurs missions (…OM1, …OM2), confiées à
 *     des dépanneurs différents ;
 *   — le champ mission accueille de la saisie libre (« 1 », « 2 »,
 *     « NE PAS FACTURER », « PAYANT 160€ ») ; sur un export réel, 475 lignes
 *     portent un simple compteur et « 1 » revient 381 fois ;
 *   — le champ dossier aussi (« Fourrière », « TGI »).
 *
 * L'empreinte combine donc dossier, mission, dépanneur, horodatage
 * d'affectation et montant. Deux exports qui se chevauchent produisent la
 * même empreinte pour la même intervention — le doublon est absorbé — tandis
 * que deux missions réellement distinctes restent distinctes.
 */
export function missionKey(it) {
  const t = it.dtPremiereAffectation ? it.dtPremiereAffectation.getTime() : ''
  const f = it.dtFin ? it.dtFin.getTime() : ''
  return [
    it.dossierNo || '', it.missionNo || '', it.depanneur || '',
    t, f, it.totalHT ?? '',
  ].join('|')
}

/** Clé de jour locale « AAAA-MM-JJ » — jamais toISOString(), qui décale en UTC. */
export function dayKey(d) {
  if (!d) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function monthKey(d) {
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Numéro de semaine ISO 8601 + année ISO, sous forme « AAAA-Sxx ». */
export function isoWeekKey(d) {
  if (!d) return null
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (t.getDay() + 6) % 7 // lundi = 0
  t.setDate(t.getDate() - day + 3) // jeudi de la semaine
  const isoYear = t.getFullYear()
  const jan4 = new Date(isoYear, 0, 4)
  const jan4Day = (jan4.getDay() + 6) % 7
  const week1Thursday = new Date(isoYear, 0, 4 - jan4Day + 3)
  const week = 1 + Math.round((t - week1Thursday) / (7 * 86400000))
  return `${isoYear}-S${String(week).padStart(2, '0')}`
}

/** Lundi 00:00 de la semaine ISO contenant `d`. */
export function isoWeekStart(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = (t.getDay() + 6) % 7
  t.setDate(t.getDate() - day)
  return t
}

/** Une intervention est « de nuit » entre 19 h et 8 h. */
export function isNight(d, nightStart = 19, nightEnd = 8) {
  if (!d) return false
  const h = d.getHours()
  return h >= nightStart || h < nightEnd
}

export function isWeekend(d) {
  if (!d) return false
  const w = d.getDay()
  return w === 0 || w === 6
}

/**
 * Transforme une ligne brute en intervention canonique.
 * @param {object} row       ligne brute { [colonne]: valeur }
 * @param {object} map       correspondance champ canonique → colonne
 * @param {object} opts
 */
export function normalizeRow(row, map, opts = DEFAULT_OPTIONS) {
  const get = (k) => (map[k] ? row[map[k]] : undefined)

  const dtPremiereAffectation = parseDate(get('dtPremiereAffectation'))
  const dtAcceptation = parseDate(get('dtAcceptation'))
  const dtArrivee = parseDate(get('dtArrivee'))
  const dtDepartPour = parseDate(get('dtDepartPour'))
  const dtDepartLieu = parseDate(get('dtDepartLieu'))
  const dtFin = parseDate(get('dtFin'))
  const heureAppel = parseDate(get('heureAppel'))

  const fact = parseDateMulti(get('dateFacturation'))
  const totalHT = parseNum(get('totalHT')) ?? 0

  const delaiAcceptationMin = minutesBetween(dtPremiereAffectation, dtAcceptation)
  const delaiArriveeMin = minutesBetween(dtPremiereAffectation, dtArrivee)

  const inRange = (m) =>
    m != null && m >= opts.outlierMinMinutes && m <= opts.outlierMaxMinutes

  const raisonDPR = parseText(get('raisonDPR'))
  const geoRaw = parseText(get('geoRespectee'))
  const croDate = parseDate(get('croEnvoye'))
  const ref = dtPremiereAffectation || heureAppel || dtArrivee || dtFin

  return {
    // Identité — la ligne est une MISSION, pas un dossier : un même
    // numéro de dossier porte parfois plusieurs missions (…OM1, …OM2).
    missionNo: parseText(get('missionNo')),
    dossierNo: parseText(get('dossierNo')),
    depanneur: parseText(get('depanneur')),

    origine: parseText(get('origine')) || '(non renseigné)',
    typeIntervention: parseText(get('typeIntervention')) || '(non renseigné)',
    agence: parseText(get('agence')),
    vehicule: parseText(get('vehicule')),
    typeVehicule: parseText(get('typeVehicule')),
    genre: parseText(get('genre')),
    immat: parseText(get('immat')),
    marque: parseText(get('marque')),
    modele: parseText(get('modele')),
    lieuPriseEnCharge: parseText(get('lieuPriseEnCharge')),
    lieuDepot: parseText(get('lieuDepot')),
    operateurAffectation: parseText(get('operateurAffectation')),

    rendezVous: parseBool(get('rendezVous')),
    nonPayant: parseBool(get('nonPayant')),
    raisonDPR,
    isDPR: !!raisonDPR,
    isDPRImputable: !!raisonDPR && DPR_IMPUTABLE.includes(raisonDPR),

    geoRespectee: geoRaw,
    geoConforme: geoRaw != null && geoRaw.toUpperCase() === 'OUI',
    nbPhotos: parseNum(get('nbPhotos')) ?? 0,
    croEnvoye: croDate,
    croConforme: !!croDate,

    km: parseNum(get('km')) ?? 0,
    tempsDeclaratifMin: parseNum(get('tempsDeclaratifMin')) ?? 0,

    totalHT,
    totalTTC: parseNum(get('totalTTC')) ?? 0,
    prestationHT: parseNum(get('prestationHT')) ?? 0,
    montantMajoreHT: parseNum(get('montantMajoreHT')) ?? 0,
    tauxMajoration: parseText(get('tauxMajoration')),
    fraisParc: parseNum(get('fraisParc')) ?? 0,
    piecesHT: parseNum(get('piecesHT')) ?? 0,
    avancesFrais: parseNum(get('avancesFrais')) ?? 0,
    montantAssistanceHT: parseNum(get('montantAssistanceHT')) ?? 0,
    montantSocietaireHT: parseNum(get('montantSocietaireHT')) ?? 0,
    modeEncaissement: parseText(get('modeEncaissement')),
    entiteFacturee: parseText(get('entiteFacturee')),

    dateFacturation: fact.date,
    nbFactures: fact.count,
    estFacture: !!fact.date,

    dtPremiereAffectation, dtAcceptation, dtArrivee,
    dtDepartPour, dtDepartLieu, dtFin, heureAppel,

    // Délais — la valeur brute est conservée ; le drapeau dit si elle est
    // exploitable. Les métriques n'agrègent que les valeurs valides et
    // savent combien de lignes ont été écartées.
    delaiAcceptationMin,
    delaiAcceptationValide: inRange(delaiAcceptationMin),
    delaiArriveeMin,
    delaiArriveeValide: inRange(delaiArriveeMin),

    // Facturation groupée : regroupements trimestriels de frais de parc,
    // exclus des indicateurs opérationnels mais conservés.
    isGroupedBilling: totalHT > opts.groupedBillingThreshold,

    // Repères temporels dérivés (calculés une fois, réutilisés partout).
    refDate: ref,
    dayKey: dayKey(ref),
    weekKey: isoWeekKey(ref),
    monthKey: monthKey(ref),
    hour: ref ? ref.getHours() : null,
    weekday: ref ? ref.getDay() : null, // 0 = dimanche
    isNight: isNight(ref),
    isWeekend: isWeekend(ref),
  }
}

// ---------------------------------------------------------------------------
// Normalisation d'un jeu complet
// ---------------------------------------------------------------------------

/**
 * @param {{headers: string[], rows: object[], sheets?: object[]}} raw
 * @param {object} options { overrides, groupedBillingThreshold, ... }
 * @returns {{
 *   interventions: object[],   // lignes opérationnelles
 *   grouped: object[],         // facturation groupée, consultable à part
 *   mapping: object,
 *   report: object             // diagnostic d'import
 * }}
 */
export function normalizeDataset(raw, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const headers = raw.headers || []
  const { map, missing, unused, ignored } = buildMapping(headers, options.overrides || {})

  const report = {
    sourceRows: raw.rows.length,
    totalRowsExcluded: 0,
    emptyRowsExcluded: 0,
    noKeyExcluded: 0,
    duplicatesMerged: 0,
    groupedBillingCount: 0,
    groupedBillingAmount: 0,
    outlierAcceptation: 0,
    outlierArrivee: 0,
    kept: 0,
    missingFields: missing.map((f) => ({ key: f.key, label: f.label, required: !!f.required })),
    blockingFields: blockingMissing(missing).map((f) => ({ key: f.key, label: f.label })),
    unusedColumns: unused,
    ignoredColumns: ignored,
    sheets: raw.sheets || [],
    periodStart: null,
    periodEnd: null,
  }

  const byMission = new Map()
  const grouped = []

  for (const row of raw.rows) {
    if (isTotalRow(row, headers, opts.totalRowRatio)) { report.totalRowsExcluded++; continue }
    if (headers.every((h) => row[h] == null || row[h] === '')) { report.emptyRowsExcluded++; continue }

    const it = normalizeRow(row, map, opts)
    if (!it.missionNo && !it.dossierNo) { report.noKeyExcluded++; continue }

    const key = missionKey(it)
    it.key = key

    if (it.isGroupedBilling) {
      grouped.push(it)
      report.groupedBillingCount++
      report.groupedBillingAmount += it.totalHT
      continue
    }

    if (byMission.has(key)) report.duplicatesMerged++
    byMission.set(key, it) // le dernier import gagne

    if (it.delaiAcceptationMin != null && !it.delaiAcceptationValide) report.outlierAcceptation++
    if (it.delaiArriveeMin != null && !it.delaiArriveeValide) report.outlierArrivee++
  }

  const interventions = [...byMission.values()]
  report.kept = interventions.length

  const dates = interventions.map((i) => i.refDate).filter(Boolean).sort((a, b) => a - b)
  if (dates.length) {
    report.periodStart = dayKey(dates[0])
    report.periodEnd = dayKey(dates[dates.length - 1])
  }

  return { interventions, grouped, mapping: map, report }
}
