/**
 * PASSERELLE DEPANTIME
 * =========================================================================
 * DepanTime est l'applicatif de pointage : il détient les relevés de temps
 * (arrivée, pause, départ, repos, absence, congés) par dépanneur et par jour.
 * Le Cockpit y puise ce que l'export PowerPanne ne contient pas :
 *
 *   — le nombre de dépanneurs en service un jour donné  (écran temps réel)
 *   — les jours travaillés par dépanneur                (revue hebdomadaire)
 *   — les heures payées du mois                         (revue mensuelle)
 *
 * L'appel se fait de conteneur à conteneur sur le réseau Docker
 * (`http://depantime-api:3000`) : rien ne sort du serveur, et les
 * identifiants du compte de service ne quittent jamais l'API Cockpit.
 *
 * Aucune écriture n'est faite dans DepanTime : la passerelle est en
 * lecture seule.
 */

const BASE = process.env.CK_DEPANTIME_URL || ''
const USER = process.env.CK_DEPANTIME_USER || ''
const PASS = process.env.CK_DEPANTIME_PASSWORD || ''
const TIMEOUT = Number(process.env.CK_DEPANTIME_TIMEOUT || 8000)

export const isConfigured = () => !!(BASE && USER && PASS)

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

let cache = { token: null, expires: 0 }

async function token() {
  if (cache.token && Date.now() < cache.expires) return cache.token
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(`Connexion à DepanTime refusée (${r.status}) ${t}`.trim())
  }
  const { token: tk } = await r.json()
  if (!tk) throw new Error('DepanTime n’a pas renvoyé de jeton')
  // Les jetons DepanTime durent 30 jours ; on en redemande un chaque jour,
  // ce qui suffit et évite de garder un jeton périmé en mémoire.
  cache = { token: tk, expires: Date.now() + 23 * 3600 * 1000 }
  return tk
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (r.status === 401) {
    cache = { token: null, expires: 0 } // jeton rejeté : on retentera au prochain appel
    throw new Error('DepanTime a rejeté le compte de service')
  }
  if (!r.ok) throw new Error(`DepanTime a répondu ${r.status} sur ${path}`)
  return r.json()
}

export const getSites = () => get('/api/sites')
export const getEmployees = (siteId) => get(`/api/employees/${siteId}`)
export const getTimesheets = (siteId, year, month) =>
  get(`/api/timesheets/${siteId}/${year}/${month}`)

// ---------------------------------------------------------------------------
// Lecture des relevés
// ---------------------------------------------------------------------------

/** « 08:00 » ou « 8h00 » → minutes depuis minuit. */
function minutesDe(v) {
  if (!v) return null
  const m = /^(\d{1,2})\s*[h:]\s*(\d{2})$/.exec(String(v).trim())
  if (!m) return null
  const min = Number(m[1]) * 60 + Number(m[2])
  return Number.isFinite(min) ? min : null
}

const OUI = (v) => String(v ?? '').trim().toLowerCase() === 'oui'

/**
 * Durée payée d'une journée, en minutes : départ − arrivée, moins la pause
 * quand elle est renseignée des deux côtés.
 */
function dureeJour(e) {
  const a = minutesDe(e.arrivee)
  const d = minutesDe(e.depart)
  if (a == null || d == null || d <= a) return 0
  let total = d - a
  const p1 = minutesDe(e.debutPause)
  const p2 = minutesDe(e.finPause)
  if (p1 != null && p2 != null && p2 > p1) total -= p2 - p1
  return Math.max(0, total)
}

/**
 * Qualifie une journée.
 *
 * Un jour de congés est **payé** mais n'est pas **travaillé** : DepanTime y
 * pré-remplit 7 h (08:00–17:00 avec pause) pour la paie, ce qui en ferait un
 * jour de production si on ne regardait que les horaires. Le CA par
 * jour-dépanneur en serait mécaniquement abaissé.
 */
function qualifier(e) {
  if (!e) return { travaille: false, minutes: 0 }
  if (OUI(e.absence) || OUI(e.repos)) return { travaille: false, minutes: 0 }
  const minutes = dureeJour(e)
  if (OUI(e.conges)) return { travaille: false, minutes } // payé, non travaillé
  return { travaille: minutes > 0, minutes }
}

const cleJour = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Liste des couples (année, mois 1-12) couverts par une plage de dates. */
function moisCouverts(from, to) {
  const out = []
  const d = new Date(from.getFullYear(), from.getMonth(), 1)
  const fin = new Date(to.getFullYear(), to.getMonth(), 1)
  while (d <= fin) {
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1 })
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

/**
 * Effectifs sur une plage de dates.
 *
 * Une seule fonction sert les trois besoins : la plage vaut un jour pour
 * l'écran temps réel, une semaine ISO pour la revue hebdomadaire, un mois
 * pour la revue mensuelle.
 *
 * @returns {{
 *   from, to, siteId,
 *   depanneurs: Array<{id, nom, prenom, label, jours, heures, heuresTravaillees}>,
 *   parJour: Record<string, number>,
 *   totaux: {jours, heures, heuresTravaillees, effectifMax}
 * }}
 */
export async function effectifs({ siteId, from, to }) {
  const d1 = new Date(`${from}T00:00:00`)
  const d2 = new Date(`${to}T00:00:00`)
  if (isNaN(d1) || isNaN(d2) || d2 < d1) throw new Error('Plage de dates invalide')

  const employees = await getEmployees(siteId)
  const releves = {}
  for (const { year, month } of moisCouverts(d1, d2)) {
    // DepanTime indexe ses mois de 0 à 11, comme JavaScript.
    releves[`${year}-${month}`] = await getTimesheets(siteId, year, month - 1)
  }

  const parEmploye = new Map(
    employees.map((e) => [
      String(e.id),
      {
        id: e.id,
        nom: e.nom || '',
        prenom: e.prenom || '',
        label: `${e.prenom || ''} ${e.nom || ''}`.trim() || String(e.id),
        actif: e.active !== false,
        jours: 0, heures: 0, heuresTravaillees: 0,
      },
    ])
  )
  const parJour = {}

  for (const cur = new Date(d1); cur <= d2; cur.setDate(cur.getDate() + 1)) {
    const y = cur.getFullYear(), m = cur.getMonth() + 1, jour = cur.getDate()
    const ts = releves[`${y}-${m}`] || {}
    const cle = cleJour(y, m, jour)
    parJour[cle] = 0

    for (const [empId, agg] of parEmploye) {
      const e = ts?.[empId]?.[String(jour)]
      const q = qualifier(e)
      agg.heures += q.minutes / 60
      if (q.travaille) {
        agg.jours += 1
        agg.heuresTravaillees += q.minutes / 60
        parJour[cle] += 1
      }
    }
  }

  const depanneurs = [...parEmploye.values()]
    .map((d) => ({
      ...d,
      heures: Math.round(d.heures * 100) / 100,
      heuresTravaillees: Math.round(d.heuresTravaillees * 100) / 100,
    }))
    .filter((d) => d.jours > 0 || d.heures > 0)
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))

  return {
    from, to, siteId,
    depanneurs,
    parJour,
    totaux: {
      jours: depanneurs.reduce((s, d) => s + d.jours, 0),
      heures: Math.round(depanneurs.reduce((s, d) => s + d.heures, 0) * 100) / 100,
      heuresTravaillees:
        Math.round(depanneurs.reduce((s, d) => s + d.heuresTravaillees, 0) * 100) / 100,
      effectifMax: Math.max(0, ...Object.values(parJour)),
    },
  }
}

/** Vérifie que la passerelle répond, et renvoie les sites disponibles. */
export async function status() {
  if (!isConfigured()) {
    return {
      configured: false,
      ok: false,
      message:
        'Passerelle DepanTime non configurée. Renseigner CK_DEPANTIME_URL, ' +
        'CK_DEPANTIME_USER et CK_DEPANTIME_PASSWORD côté serveur.',
    }
  }
  try {
    const sites = await getSites()
    return { configured: true, ok: true, sites }
  } catch (e) {
    return { configured: true, ok: false, message: String(e.message || e) }
  }
}
