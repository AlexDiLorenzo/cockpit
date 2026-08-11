/**
 * MÉTRIQUES — définitions de calcul uniques
 * =========================================================================
 * Toutes les définitions du cahier des charges vivent ici, et nulle part
 * ailleurs. Les trois écrans appellent les mêmes fonctions : un SLA affiché
 * en temps réel et un SLA affiché en revue hebdomadaire sortent du même code.
 *
 * Convention de retour — chaque agrégat renvoie :
 *   { value, n, excluded, ... }
 *     value    : la valeur (null si non calculable)
 *     n        : nombre de lignes réellement prises en compte
 *     excluded : nombre de lignes écartées comme aberrantes
 *
 * Le cahier des charges impose de signaler les lignes écartées : c'est
 * pourquoi `excluded` remonte jusqu'à l'interface.
 */

import { DPR_IMPUTABLE, dayKey, isoWeekKey, isoWeekStart, monthKey } from './normalize.js'

export const SLA_MINUTES = 45

// ---------------------------------------------------------------------------
// Statistiques de base
// ---------------------------------------------------------------------------

export function median(xs) {
  const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => p - q)
  if (!a.length) return null
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

export function mean(xs) {
  const a = xs.filter((x) => x != null && Number.isFinite(x))
  if (!a.length) return null
  return a.reduce((s, x) => s + x, 0) / a.length
}

export function sum(xs) {
  return xs.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0)
}

export function percentile(xs, p) {
  const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((q, r) => q - r)
  if (!a.length) return null
  const idx = (a.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo)
}

/** Regroupe une liste par clé, en conservant l'ordre d'apparition. */
export function groupBy(items, keyFn) {
  const m = new Map()
  for (const it of items) {
    const k = keyFn(it)
    if (k == null) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(it)
  }
  return m
}

// ---------------------------------------------------------------------------
// Délais
// ---------------------------------------------------------------------------

/** Délai d'acceptation médian = acceptation (mobile) − première affectation. */
export function delaiAcceptation(interventions) {
  const vals = [], all = interventions.filter((i) => i.delaiAcceptationMin != null)
  for (const i of all) if (i.delaiAcceptationValide) vals.push(i.delaiAcceptationMin)
  return {
    value: median(vals),
    moyenne: mean(vals),
    p90: percentile(vals, 0.9),
    n: vals.length,
    excluded: all.length - vals.length,
  }
}

/** Délai d'arrivée médian = arrivée sur lieu (mobile) − première affectation. */
export function delaiArrivee(interventions) {
  const vals = [], all = interventions.filter((i) => i.delaiArriveeMin != null)
  for (const i of all) if (i.delaiArriveeValide) vals.push(i.delaiArriveeMin)
  return {
    value: median(vals),
    moyenne: mean(vals),
    p90: percentile(vals, 0.9),
    n: vals.length,
    excluded: all.length - vals.length,
  }
}

// ---------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------

/** Périmètre du SLA : hors rendez-vous, délai d'arrivée exploitable. */
export function slaScope(interventions) {
  return interventions.filter((i) => !i.rendezVous && i.delaiArriveeValide)
}

/**
 * SLA = part des interventions arrivées en 45 min ou moins,
 * en excluant les lignes où Rendez-vous = OUI.
 */
export function sla(interventions, thresholdMin = SLA_MINUTES) {
  const candidates = interventions.filter((i) => !i.rendezVous)
  const scope = candidates.filter((i) => i.delaiArriveeValide)
  const ok = scope.filter((i) => i.delaiArriveeMin <= thresholdMin)
  return {
    value: scope.length ? ok.length / scope.length : null,
    ok: ok.length,
    n: scope.length,
    excluded: candidates.length - scope.length,
    rendezVousExclus: interventions.length - candidates.length,
    thresholdMin,
    hors: scope.filter((i) => i.delaiArriveeMin > thresholdMin),
  }
}

/** SLA décliné par dimension (Origine d'appel, dépanneur, …). */
export function slaBy(interventions, keyFn, thresholdMin = SLA_MINUTES) {
  const out = []
  for (const [k, list] of groupBy(interventions, keyFn)) {
    const s = sla(list, thresholdMin)
    out.push({ key: k, ...s })
  }
  return out.sort((a, b) => b.n - a.n)
}

/** SLA croisé heure × jour de semaine — repère les créneaux sous-armés. */
export function slaHeatmap(interventions, thresholdMin = SLA_MINUTES) {
  const grid = []
  for (let d = 0; d < 7; d++) {
    grid.push(Array.from({ length: 24 }, () => ({ ok: 0, n: 0, value: null })))
  }
  for (const i of slaScope(interventions)) {
    if (i.weekday == null || i.hour == null) continue
    const cell = grid[i.weekday][i.hour]
    cell.n++
    if (i.delaiArriveeMin <= thresholdMin) cell.ok++
  }
  for (const row of grid) for (const c of row) c.value = c.n ? c.ok / c.n : null
  return grid
}

// ---------------------------------------------------------------------------
// DPR
// ---------------------------------------------------------------------------

/** DPR imputables : matériel inapproprié ou véhicule non trouvé. */
export function dprImputables(interventions) {
  const list = interventions.filter((i) => i.isDPRImputable)
  const tousDPR = interventions.filter((i) => i.isDPR)
  return {
    value: list.length,
    rate: interventions.length ? list.length / interventions.length : null,
    n: interventions.length,
    excluded: 0,
    list,
    parRaison: DPR_IMPUTABLE.map((r) => ({
      raison: r,
      count: list.filter((i) => i.raisonDPR === r).length,
    })),
    annulationsClient: tousDPR.length - list.length,
  }
}

// ---------------------------------------------------------------------------
// Facturation
// ---------------------------------------------------------------------------

/** Un dossier est non facturé quand la date de facturation est vide. */
export function nonFactures(interventions, { minDays = 7, asOf = new Date() } = {}) {
  const limit = asOf.getTime() - minDays * 86400000
  const list = interventions.filter(
    (i) => !i.estFacture && i.refDate && i.refDate.getTime() <= limit
  )
  const byOrigine = []
  for (const [k, l] of groupBy(list, (i) => i.origine)) {
    byOrigine.push({ key: k, count: l.length, amount: sum(l.map((i) => i.totalHT)) })
  }
  byOrigine.sort((a, b) => b.amount - a.amount)
  return {
    value: list.length,
    amount: sum(list.map((i) => i.totalHT)),
    n: interventions.length,
    excluded: 0,
    minDays,
    byOrigine,
    list,
  }
}

// ---------------------------------------------------------------------------
// Chiffre d'affaires
// ---------------------------------------------------------------------------

/** CA opérationnel = somme des Total HT, hors facturation groupée.
 *  Les lignes reçues ici en sont déjà exemptes (normalizeDataset les isole). */
export function caOperationnel(interventions) {
  return {
    value: sum(interventions.map((i) => i.totalHT)),
    n: interventions.length,
    excluded: 0,
    panierMoyen: interventions.length
      ? sum(interventions.map((i) => i.totalHT)) / interventions.length
      : null,
  }
}

/** CA rapporté au nombre de jours-dépanneur travaillés (saisie manuelle). */
export function caParJourDepanneur(interventions, workedDays = {}) {
  const parDep = []
  for (const [dep, list] of groupBy(interventions, (i) => i.depanneur)) {
    const ca = sum(list.map((i) => i.totalHT))
    const jours = Number(workedDays[dep]) || 0
    parDep.push({
      key: dep,
      ca,
      interventions: list.length,
      jours,
      caParJour: jours > 0 ? ca / jours : null,
      manqueSaisie: jours <= 0,
    })
  }
  parDep.sort((a, b) => (b.caParJour ?? -1) - (a.caParJour ?? -1))

  // Le ratio global ne porte que sur les dépanneurs dont les jours sont
  // saisis : y verser le CA d'un dépanneur sans jours gonflerait le
  // numérateur sans toucher au dénominateur.
  const retenus = parDep.filter((d) => !d.manqueSaisie)
  const totalCA = sum(retenus.map((d) => d.ca))
  const totalJours = sum(retenus.map((d) => d.jours))
  return {
    value: totalJours > 0 ? totalCA / totalJours : null,
    n: retenus.length,
    excluded: parDep.length - retenus.length,
    totalCA, totalJours,
    caNonRattache: sum(parDep.filter((d) => d.manqueSaisie).map((d) => d.ca)),
    classement: parDep,
  }
}

// ---------------------------------------------------------------------------
// Conformité de saisie
// ---------------------------------------------------------------------------

/** Photos, géolocalisation et envoi du CRO, par dépanneur. */
export function conformiteSaisie(interventions) {
  const lignes = []
  for (const [dep, list] of groupBy(interventions, (i) => i.depanneur)) {
    const photos = list.filter((i) => i.nbPhotos > 0).length
    const geo = list.filter((i) => i.geoConforme).length
    const cro = list.filter((i) => i.croConforme).length
    const n = list.length
    lignes.push({
      key: dep,
      n,
      photos: n ? photos / n : null,
      geo: n ? geo / n : null,
      cro: n ? cro / n : null,
      global: n ? (photos + geo + cro) / (3 * n) : null,
    })
  }
  lignes.sort((a, b) => (a.global ?? 1) - (b.global ?? 1)) // les moins conformes d'abord
  const n = interventions.length
  return {
    value: n
      ? (interventions.filter((i) => i.nbPhotos > 0).length +
         interventions.filter((i) => i.geoConforme).length +
         interventions.filter((i) => i.croConforme).length) / (3 * n)
      : null,
    photos: n ? interventions.filter((i) => i.nbPhotos > 0).length / n : null,
    geo: n ? interventions.filter((i) => i.geoConforme).length / n : null,
    cro: n ? interventions.filter((i) => i.croConforme).length / n : null,
    n,
    excluded: 0,
    lignes,
  }
}

// ---------------------------------------------------------------------------
// Séries temporelles
// ---------------------------------------------------------------------------

/** Liste des N dernières clés de semaine ISO se terminant à `asOf`. */
export function lastWeekKeys(n, asOf = new Date()) {
  const keys = []
  const start = isoWeekStart(asOf)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(start)
    d.setDate(d.getDate() - i * 7)
    keys.push(isoWeekKey(d))
  }
  return keys
}

/** Liste des N derniers mois se terminant à `asOf`. */
export function lastMonthKeys(n, asOf = new Date()) {
  const keys = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1)
    keys.push(monthKey(d))
  }
  return keys
}

/**
 * Période sur laquelle ouvrir une revue.
 *
 * Un comité examine la dernière période **révolue**, pas celle en cours :
 * un export s'arrêtant le lundi 3 août ne doit pas présenter une semaine de
 * deux interventions. On retient donc la dernière semaine (ou le dernier
 * mois) entièrement couvert par les données.
 *
 * @param {object[]} interventions
 * @param {'week'|'month'} granularite
 * @returns {Date} date de référence à passer aux séries
 */
export function periodeDeRevue(interventions, granularite = 'week') {
  let max = null
  for (const i of interventions) if (i.refDate && (!max || i.refDate > max)) max = i.refDate
  const now = new Date()
  const ref = max && max < now ? max : now

  if (granularite === 'month') {
    const finDuMois = new Date(ref.getFullYear(), ref.getMonth() + 1, 0)
    if (ref < finDuMois) return new Date(ref.getFullYear(), ref.getMonth(), 0) // mois précédent
    return ref
  }

  const debut = isoWeekStart(ref)
  const fin = new Date(debut)
  fin.setDate(fin.getDate() + 6)
  if (ref < fin) {
    const precedente = new Date(debut)
    precedente.setDate(precedente.getDate() - 1) // dimanche de la semaine d'avant
    return precedente
  }
  return ref
}

/**
 * Construit une série temporelle : une valeur par période.
 * @param {object[]} interventions
 * @param {string[]} periodKeys   clés attendues, dans l'ordre (trous inclus)
 * @param {(i)=>string} periodOf  clé de période d'une intervention
 * @param {(list)=>object} metric fonction de métrique
 */
export function series(interventions, periodKeys, periodOf, metric) {
  const buckets = groupBy(interventions, periodOf)
  return periodKeys.map((k) => {
    const list = buckets.get(k) || []
    const r = metric(list)
    return { period: k, ...r, count: list.length }
  })
}

export const weekOf = (i) => i.weekKey
export const monthOf = (i) => i.monthKey

// ---------------------------------------------------------------------------
// Écran 1 — temps réel
// ---------------------------------------------------------------------------

/**
 * Profil horaire médian du CA pour un jour de semaine donné.
 * Renvoie, pour chaque heure 0→23, la part médiane du CA de la journée
 * déjà réalisée à la fin de cette heure, plus le CA total médian du jour.
 *
 * Sert à tracer la trajectoire attendue du CA sur l'écran temps réel.
 */
export function hourlyProfile(history, weekday) {
  const jours = groupBy(
    history.filter((i) => i.weekday === weekday && i.refDate),
    (i) => i.dayKey
  )
  const courbes = []
  const totaux = []
  for (const [, list] of jours) {
    const total = sum(list.map((i) => i.totalHT))
    if (total <= 0) continue
    totaux.push(total)
    const cum = new Array(24).fill(0)
    for (const i of list) if (i.hour != null) cum[i.hour] += i.totalHT
    let acc = 0
    courbes.push(cum.map((v) => (acc += v) / total))
  }
  if (!courbes.length) return { profile: null, dailyTotal: null, days: 0 }
  const profile = Array.from({ length: 24 }, (_, h) =>
    median(courbes.map((c) => c[h]))
  )
  // Monotonie : une part cumulée ne peut pas décroître.
  for (let h = 1; h < 24; h++) profile[h] = Math.max(profile[h], profile[h - 1])
  return { profile, dailyTotal: median(totaux), days: courbes.length }
}

/** Part attendue du CA à un instant précis, par interpolation intra-horaire. */
export function expectedShareAt(profile, date) {
  if (!profile) return null
  const h = date.getHours(), m = date.getMinutes()
  const prev = h === 0 ? 0 : profile[h - 1]
  const cur = profile[h]
  return prev + (cur - prev) * (m / 60)
}

export const DEFAULT_THRESHOLDS = {
  nonAffecteMin: 10,      // compteur 1 : minutes sans affectation
  nonAffecteAlerte: 3,    // seuil d'alerte : nombre de dossiers
  retardMin: 45,          // compteur 2 : minutes écoulées sans arrivée
  retardAlerte: 5,
  chargeAlerte: 3,        // compteur 3 : dossiers ouverts par dépanneur
  trajectoireAlerte: -10, // compteur 4 : écart au CA attendu, en %
  anomaliesAlerte: 10,    // compteur 5 : nombre d'anomalies du jour
  nuitDebut: 19,
  nuitFin: 8,
}

/**
 * Les cinq compteurs de l'écran temps réel.
 *
 * @param {object[]} today      interventions du jour
 * @param {object[]} history    historique (hors jour courant) pour la trajectoire
 * @param {object} p            { now, thresholds, depanneursEnService }
 */
export function realtimeCounters(today, history, p = {}) {
  const now = p.now || new Date()
  const th = { ...DEFAULT_THRESHOLDS, ...(p.thresholds || {}) }
  const enService = Number(p.depanneursEnService) || 0
  const min = (d) => (d ? (now.getTime() - d.getTime()) / 60000 : null)

  // 1 — non affectés depuis plus de N minutes.
  // Sans horodatage de création de dossier dans l'export, le repère est
  // l'heure d'appel : un dossier appelé il y a plus de N minutes et jamais
  // affecté est en attente.
  const nonAffectes = today.filter((i) => {
    if (i.dtPremiereAffectation) return false
    const age = min(i.heureAppel || i.refDate)
    return age != null && age > th.nonAffecteMin
  })

  // 2 — affectés, sans arrivée, délai écoulé > N minutes, hors rendez-vous.
  const enRetard = today.filter((i) => {
    if (i.rendezVous) return false
    if (!i.dtPremiereAffectation || i.dtArrivee) return false
    const age = min(i.dtPremiereAffectation)
    return age != null && age > th.retardMin
  })

  // 3 — charge instantanée : dossiers ouverts / dépanneurs en service.
  const ouverts = today.filter((i) => !i.dtFin)
  const charge = enService > 0 ? ouverts.length / enService : null

  // 4 — CA du jour contre la trajectoire attendue à cette heure.
  const caJour = sum(today.filter((i) => !i.isGroupedBilling).map((i) => i.totalHT))
  const prof = hourlyProfile(history, now.getDay())
  const share = expectedShareAt(prof.profile, now)
  const attendu = prof.dailyTotal != null && share != null ? prof.dailyTotal * share : null
  const ecart = attendu && attendu > 0 ? (caJour - attendu) / attendu : null

  // 5 — anomalies du jour.
  const anomalies = []
  for (const i of today) {
    const raisons = []
    if (i.dtFin && !(i.nbPhotos > 0)) raisons.push('Clôturée sans photo')
    if (i.geoRespectee != null && !i.geoConforme) raisons.push('Géolocalisation non respectée')
    const horsHeures = (i.refDate && (i.refDate.getHours() >= th.nuitDebut || i.refDate.getHours() < th.nuitFin)) || i.isWeekend
    if (horsHeures && i.montantMajoreHT <= 0 && i.totalHT > 0) {
      raisons.push(i.isWeekend ? 'Week-end sans majoration' : 'Nuit sans majoration')
    }
    if (raisons.length) anomalies.push({ ...i, raisons })
  }

  return {
    nonAffectes: {
      value: nonAffectes.length, list: nonAffectes,
      seuil: th.nonAffecteAlerte, alerte: nonAffectes.length >= th.nonAffecteAlerte,
      param: th.nonAffecteMin,
    },
    enRetard: {
      value: enRetard.length, list: enRetard,
      seuil: th.retardAlerte, alerte: enRetard.length >= th.retardAlerte,
      param: th.retardMin,
    },
    charge: {
      value: charge, list: ouverts, ouverts: ouverts.length, enService,
      seuil: th.chargeAlerte, alerte: charge != null && charge >= th.chargeAlerte,
      manqueSaisie: enService <= 0,
    },
    trajectoire: {
      value: caJour, attendu, ecart, list: today.filter((i) => i.totalHT > 0),
      profilJours: prof.days, seuil: th.trajectoireAlerte,
      alerte: ecart != null && ecart * 100 <= th.trajectoireAlerte,
      manqueHistorique: prof.days === 0,
    },
    anomalies: {
      value: anomalies.length, list: anomalies,
      seuil: th.anomaliesAlerte, alerte: anomalies.length >= th.anomaliesAlerte,
    },
  }
}

// ---------------------------------------------------------------------------
// Écran 3 — économie
// ---------------------------------------------------------------------------

export const DEFAULT_COSTS = {
  /** Coût horaire chargé d'un dépanneur, en euros. */
  coutHoraireCharge: 28,
  /** Coût kilométrique par défaut, en euros par kilomètre. */
  coutKmDefaut: 0.45,
  /** Coût kilométrique par immatriculation : { 'EM-049-DX': 0.62, … } */
  coutKmParVehicule: {},
  /** Base de temps retenue : 'declaratif' (colonne PowerPanne) ou 'horodatage'. */
  baseTemps: 'declaratif',
  /** Heures payées du mois — sert au « CA par heure payée » (saisie manuelle). */
  heuresPayees: {},
  /** Taux servant à valoriser une majoration de nuit ou de week-end absente. */
  tauxMajorationRef: 0.25,
}

/** Durée retenue pour une intervention, en minutes. */
export function dureeMin(i, costs) {
  if ((costs.baseTemps || 'declaratif') === 'horodatage') {
    if (i.dtPremiereAffectation && i.dtFin) {
      const m = (i.dtFin - i.dtPremiereAffectation) / 60000
      if (m >= 0 && m <= 24 * 60) return m
    }
    return null
  }
  return Number.isFinite(i.tempsDeclaratifMin) ? i.tempsDeclaratifMin : null
}

/** Coût kilométrique applicable à une intervention. */
export function coutKmDe(i, costs) {
  const perVeh = costs.coutKmParVehicule || {}
  if (i.vehicule && perVeh[i.vehicule] != null) return { taux: perVeh[i.vehicule], source: i.vehicule }
  return { taux: costs.coutKmDefaut, source: 'défaut' }
}

/**
 * Marge d'une intervention.
 * Renvoie aussi la base de calcul, pour que l'écran puisse afficher
 * « sur quels paramètres cette marge repose ».
 */
export function margeIntervention(i, costs = DEFAULT_COSTS) {
  const c = { ...DEFAULT_COSTS, ...costs }
  const min = dureeMin(i, c)
  const { taux, source } = coutKmDe(i, c)
  const coutTemps = min != null ? (min / 60) * c.coutHoraireCharge : null
  const coutKm = (i.km || 0) * taux
  const complet = coutTemps != null
  const marge = complet ? i.totalHT - coutTemps - coutKm : null
  return {
    ca: i.totalHT,
    coutTemps, coutKm,
    coutTotal: complet ? coutTemps + coutKm : null,
    marge,
    tauxMarge: complet && i.totalHT > 0 ? marge / i.totalHT : null,
    dureeMin: min,
    tauxKm: taux, sourceTauxKm: source,
    complet,
  }
}

/** Base de calcul déclarée — affichée sous chaque marge. */
export function margeBasis(costs = DEFAULT_COSTS, interventions = []) {
  const c = { ...DEFAULT_COSTS, ...costs }
  const vehiculesSpecifiques = Object.keys(c.coutKmParVehicule || {}).length
  const parDefaut = interventions.filter((i) => !c.coutKmParVehicule?.[i.vehicule]).length
  return [
    { key: 'coutHoraireCharge', label: 'Coût horaire chargé', value: c.coutHoraireCharge, unit: '€/h' },
    { key: 'coutKmDefaut', label: 'Coût kilométrique par défaut', value: c.coutKmDefaut, unit: '€/km' },
    {
      key: 'coutKmParVehicule', label: 'Taux kilométriques spécifiques',
      value: vehiculesSpecifiques, unit: `véhicule(s) — ${parDefaut} interv. au taux par défaut`,
    },
    {
      key: 'baseTemps', label: 'Base de temps',
      value: c.baseTemps === 'horodatage' ? 'horodatages mobile' : 'temps déclaratif',
      unit: '',
    },
  ]
}

/** Agrégat de marge sur un ensemble d'interventions. */
export function margeAgregee(interventions, costs = DEFAULT_COSTS) {
  const lignes = interventions.map((i) => margeIntervention(i, costs))
  const ok = lignes.filter((l) => l.complet)
  const ca = sum(lignes.map((l) => l.ca))
  const marge = sum(ok.map((l) => l.marge))
  return {
    value: marge,
    ca,
    coutTemps: sum(ok.map((l) => l.coutTemps)),
    coutKm: sum(ok.map((l) => l.coutKm)),
    margeParIntervention: ok.length ? marge / ok.length : null,
    tauxMarge: ok.length && sum(ok.map((l) => l.ca)) > 0 ? marge / sum(ok.map((l) => l.ca)) : null,
    n: ok.length,
    excluded: lignes.length - ok.length,
    basis: margeBasis(costs, interventions),
  }
}

/** Marge par Origine d'appel (la convention), avec panier, km et temps moyens. */
export function margeParOrigine(interventions, costs = DEFAULT_COSTS) {
  const out = []
  for (const [k, list] of groupBy(interventions, (i) => i.origine)) {
    const m = margeAgregee(list, costs)
    const durees = list.map((i) => dureeMin(i, { ...DEFAULT_COSTS, ...costs })).filter((x) => x != null)
    out.push({
      key: k,
      n: list.length,
      ca: m.ca,
      marge: m.value,
      tauxMarge: m.tauxMarge,
      margeParIntervention: m.margeParIntervention,
      panierMoyen: list.length ? m.ca / list.length : null,
      kmMoyen: mean(list.map((i) => i.km)),
      tempsMoyenMin: mean(durees),
      excluded: m.excluded,
    })
  }
  return out.sort((a, b) => b.ca - a.ca)
}

/** Rendement par véhicule : interventions, km, CA, marge. */
export function rendementParVehicule(interventions, costs = DEFAULT_COSTS) {
  const out = []
  for (const [k, list] of groupBy(interventions, (i) => i.vehicule || '(non renseigné)')) {
    const m = margeAgregee(list, costs)
    out.push({
      key: k,
      n: list.length,
      km: sum(list.map((i) => i.km)),
      kmMoyen: mean(list.map((i) => i.km)),
      ca: m.ca,
      caParKm: sum(list.map((i) => i.km)) > 0 ? m.ca / sum(list.map((i) => i.km)) : null,
      marge: m.value,
      tauxMarge: m.tauxMarge,
    })
  }
  return out.sort((a, b) => b.n - a.n)
}

/**
 * Coût des pertes : DPR imputables, interventions non payantes,
 * majorations non appliquées la nuit et le week-end.
 *
 * Le manque à gagner d'un DPR est estimé par le panier moyen des
 * interventions du même type ; celui d'une majoration manquante par le taux
 * de majoration de référence.
 */
export function coutDesPertes(interventions, costs = DEFAULT_COSTS, opts = {}) {
  const c = { ...DEFAULT_COSTS, ...costs }
  const tauxMajorationRef = opts.tauxMajorationRef ?? c.tauxMajorationRef ?? 0.25
  const nuitDebut = opts.nuitDebut ?? 19
  const nuitFin = opts.nuitFin ?? 8

  const payantes = interventions.filter((i) => !i.nonPayant && i.totalHT > 0)
  const panierMoyen = payantes.length ? sum(payantes.map((i) => i.totalHT)) / payantes.length : 0

  // DPR imputables — coût direct engagé (temps + km) et manque à gagner.
  const dpr = interventions.filter((i) => i.isDPRImputable)
  const dprCoutDirect = sum(dpr.map((i) => {
    const m = margeIntervention(i, c)
    return (m.coutTemps || 0) + (m.coutKm || 0)
  }))
  const dprManqueAGagner = dpr.length * panierMoyen

  // Interventions non payantes.
  const nonPayantes = interventions.filter((i) => i.nonPayant)
  const nonPayantesCout = sum(nonPayantes.map((i) => {
    const m = margeIntervention(i, c)
    return (m.coutTemps || 0) + (m.coutKm || 0)
  }))

  // Majorations non appliquées.
  const horsHeures = interventions.filter((i) => {
    if (!i.refDate || i.totalHT <= 0) return false
    const h = i.refDate.getHours()
    return h >= nuitDebut || h < nuitFin || i.isWeekend
  })
  const sansMajoration = horsHeures.filter((i) => i.montantMajoreHT <= 0)
  const majorationManquante = sum(sansMajoration.map((i) => i.totalHT * tauxMajorationRef))

  return {
    value: dprCoutDirect + dprManqueAGagner + nonPayantesCout + majorationManquante,
    n: interventions.length,
    excluded: 0,
    postes: [
      {
        key: 'dpr', label: 'DPR imputables', count: dpr.length,
        montant: dprCoutDirect + dprManqueAGagner,
        detail: `${dprCoutDirect.toFixed(0)} € engagés + ${dprManqueAGagner.toFixed(0)} € de manque à gagner`,
        list: dpr,
      },
      {
        key: 'nonPayant', label: 'Interventions non payantes', count: nonPayantes.length,
        montant: nonPayantesCout,
        detail: 'coût de production engagé sans recette',
        list: nonPayantes,
      },
      {
        key: 'majoration', label: 'Majorations non appliquées', count: sansMajoration.length,
        montant: majorationManquante,
        detail: `nuit ${nuitDebut} h–${nuitFin} h et week-end, au taux de référence ${(tauxMajorationRef * 100).toFixed(0)} %`,
        list: sansMajoration,
      },
    ],
    panierMoyen,
    tauxMajorationRef,
  }
}

/** Mix d'activité par type d'intervention, avec le panier associé. */
export function mixActivite(interventions) {
  const total = interventions.length
  const out = []
  for (const [k, list] of groupBy(interventions, (i) => i.typeIntervention)) {
    const ca = sum(list.map((i) => i.totalHT))
    out.push({
      key: k,
      n: list.length,
      part: total ? list.length / total : null,
      ca,
      partCA: null,
      panier: list.length ? ca / list.length : null,
    })
  }
  const totalCA = sum(out.map((o) => o.ca))
  for (const o of out) o.partCA = totalCA ? o.ca / totalCA : null
  return out.sort((a, b) => b.n - a.n)
}

/** CA par heure payée — les heures viennent d'une saisie manuelle. */
export function caParHeurePayee(interventions, heures) {
  const ca = sum(interventions.map((i) => i.totalHT))
  const h = Number(heures) || 0
  return {
    value: h > 0 ? ca / h : null,
    ca, heures: h, n: interventions.length, excluded: 0,
    manqueSaisie: h <= 0,
  }
}

// ---------------------------------------------------------------------------
// Catalogue des indicateurs — sert aux cibles et aux séries
// ---------------------------------------------------------------------------

/**
 * Chaque indicateur suivi en revue est déclaré ici : identifiant stable
 * (utilisé comme clé de cible), libellé, unité, sens de progression, et la
 * fonction qui le calcule sur une liste d'interventions.
 */
export const INDICATORS = {
  delai_acceptation: {
    label: "Délai d'acceptation (médiane)", unit: 'min', better: 'lower', screen: 'weekly',
    compute: (list) => delaiAcceptation(list),
  },
  sla: {
    label: 'SLA arrivée ≤ 45 min', unit: '%', better: 'higher', format: 'pct', screen: 'weekly',
    compute: (list) => sla(list),
  },
  non_factures: {
    label: 'Dossiers non facturés > 7 j', unit: 'dossiers', better: 'lower', screen: 'weekly',
    compute: (list, ctx) => nonFactures(list, { asOf: ctx?.asOf }),
  },
  dpr_imputables: {
    label: 'DPR imputables', unit: 'dossiers', better: 'lower', screen: 'weekly',
    compute: (list) => dprImputables(list),
  },
  ca_jour_depanneur: {
    label: 'CA par jour-dépanneur', unit: '€', better: 'higher', screen: 'weekly',
    compute: (list, ctx) => caParJourDepanneur(list, ctx?.workedDays),
  },
  conformite: {
    label: 'Conformité de saisie', unit: '%', better: 'higher', format: 'pct', screen: 'weekly',
    compute: (list) => conformiteSaisie(list),
  },
  ca_operationnel: {
    label: 'CA opérationnel', unit: '€', better: 'higher', screen: 'monthly',
    compute: (list) => caOperationnel(list),
  },
  marge_intervention: {
    label: 'Marge par intervention', unit: '€', better: 'higher', screen: 'monthly',
    compute: (list, ctx) => {
      const m = margeAgregee(list, ctx?.costs)
      return { ...m, value: m.margeParIntervention }
    },
  },
  ca_heure_payee: {
    label: 'CA par heure payée', unit: '€/h', better: 'higher', screen: 'monthly',
    compute: (list, ctx) => caParHeurePayee(list, ctx?.heuresPayees),
  },
  cout_pertes: {
    label: 'Coût des pertes', unit: '€', better: 'lower', screen: 'monthly',
    compute: (list, ctx) => coutDesPertes(list, ctx?.costs),
  },
  taux_marge: {
    label: 'Taux de marge', unit: '%', better: 'higher', format: 'pct', screen: 'monthly',
    compute: (list, ctx) => {
      const m = margeAgregee(list, ctx?.costs)
      return { ...m, value: m.tauxMarge }
    },
  },
}

export { dayKey, isoWeekKey, monthKey, isoWeekStart }
