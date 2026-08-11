/**
 * ACCÈS AUX DONNÉES
 * =========================================================================
 * Deux implémentations derrière une seule interface :
 *
 *   remote — l'API Cockpit (Postgres). Mode normal, multi-poste.
 *   local  — le navigateur seul (IndexedDB + localStorage). Permet de faire
 *            tourner l'application sans serveur, pour évaluer ou dépanner.
 *
 * Le mode est détecté au démarrage : si `/api/health` répond, c'est remote.
 * Les écrans ne savent pas lequel est actif.
 */

import { DEFAULT_THRESHOLDS, DEFAULT_COSTS } from './core/metrics.js'

const TOKEN_KEY = 'ck-token'
const DB_NAME = 'cockpit'
const DB_VERSION = 1

/**
 * Base de l'API. Vide quand le front est servi par le même hôte que l'API
 * (déploiement tout-Docker) ; renseignée par VITE_API_URL quand le front est
 * hébergé ailleurs — Cloudflare Pages, par exemple.
 */
export const API_BASE = (import.meta.env?.VITE_API_URL || '').replace(/\/+$/, '')

export const DEFAULT_SETTINGS = {
  thresholds: { ...DEFAULT_THRESHOLDS },
  costs: { ...DEFAULT_COSTS },
  owners: {},
  import: { groupedBillingThreshold: 3000, overrides: {} },
  // Site DepanTime interrogé et alias de noms validés par l'utilisateur.
  depantime: { siteId: null, aliases: {} },
}

/** Champs à reconvertir en Date après un aller-retour JSON. */
const DATE_FIELDS = [
  'refDate', 'dtPremiereAffectation', 'dtAcceptation', 'dtArrivee',
  'dtDepartPour', 'dtDepartLieu', 'dtFin', 'heureAppel',
  'croEnvoye', 'dateFacturation',
]

export function reviveIntervention(o) {
  if (!o) return o
  for (const f of DATE_FIELDS) {
    const v = o[f]
    if (typeof v === 'string') {
      const d = new Date(v)
      o[f] = isNaN(d) ? null : d
    }
  }
  return o
}

// ---------------------------------------------------------------------------
// Client HTTP
// ---------------------------------------------------------------------------

export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) }

async function http(path, opts = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(opts.headers || {}),
    },
  })
  if (res.status === 401) {
    setToken(null)
    throw Object.assign(new Error('Session expirée'), { status: 401 })
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Erreur ${res.status}`)
  }
  return res.status === 204 ? null : res.json()
}

// ---------------------------------------------------------------------------
// IndexedDB — stockage local des interventions
// ---------------------------------------------------------------------------

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('interventions')) {
        const os = db.createObjectStore('interventions', { keyPath: 'key' })
        os.createIndex('dayKey', 'dayKey')
      }
      if (!db.objectStoreNames.contains('imports')) {
        db.createObjectStore('imports', { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store)
}

function reqAsPromise(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

const lsGet = (k, fb) => {
  try { const v = localStorage.getItem(`ck-${k}`); return v ? JSON.parse(v) : fb } catch { return fb }
}
const lsSet = (k, v) => localStorage.setItem(`ck-${k}`, JSON.stringify(v))

// ---------------------------------------------------------------------------
// Implémentation locale
// ---------------------------------------------------------------------------

const localStore = {
  mode: 'local',

  async me() { return { username: 'local', displayName: 'Poste local', role: 'admin' } },

  async getSettings() {
    return {
      thresholds: { ...DEFAULT_SETTINGS.thresholds, ...lsGet('thresholds', {}) },
      costs: { ...DEFAULT_SETTINGS.costs, ...lsGet('costs', {}) },
      owners: lsGet('owners', {}),
      import: { ...DEFAULT_SETTINGS.import, ...lsGet('import', {}) },
      depantime: { ...DEFAULT_SETTINGS.depantime, ...lsGet('depantime', {}) },
    }
  },
  async putSetting(key, value) { lsSet(key, value); return { ok: true } },

  async listImports() {
    const db = await openDB()
    const all = await reqAsPromise(tx(db, 'imports').getAll())
    return all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  },

  async saveImport({ sourceId, label, report, interventions, grouped }) {
    const db = await openDB()
    const meta = {
      source_id: sourceId, label,
      period_start: report.periodStart, period_end: report.periodEnd,
      rows_source: report.sourceRows, rows_kept: interventions.length,
      rows_grouped: grouped.length, report,
      created_by: 'local', created_at: new Date().toISOString(),
    }
    const id = await reqAsPromise(tx(db, 'imports', 'readwrite').add(meta))

    const store = tx(db, 'interventions', 'readwrite')
    for (const it of [...interventions, ...grouped]) store.put({ ...it, importId: id })
    await new Promise((r) => { store.transaction.oncomplete = r })
    return { ok: true, importId: id, stored: interventions.length + grouped.length }
  },

  async deleteImport(id) {
    const db = await openDB()
    const all = await reqAsPromise(tx(db, 'interventions').getAll())
    const store = tx(db, 'interventions', 'readwrite')
    for (const it of all) if (it.importId === id) store.delete(it.key)
    await new Promise((r) => { store.transaction.oncomplete = r })
    await reqAsPromise(tx(db, 'imports', 'readwrite').delete(id))
    return { ok: true }
  },

  async getInterventions({ from, to, grouped = '0' } = {}) {
    const db = await openDB()
    const all = await reqAsPromise(tx(db, 'interventions').getAll())
    return all
      .filter((i) => {
        if (grouped === '0' && i.isGroupedBilling) return false
        if (grouped === '1' && !i.isGroupedBilling) return false
        if (from && i.dayKey < from) return false
        if (to && i.dayKey > to) return false
        return true
      })
      .map(reviveIntervention)
      .sort((a, b) => (a.refDate || 0) - (b.refDate || 0))
  },

  async getRange() {
    const db = await openDB()
    const all = await reqAsPromise(tx(db, 'interventions').getAll())
    const days = all.map((i) => i.dayKey).filter(Boolean).sort()
    return {
      start: days[0] || null, end: days[days.length - 1] || null,
      n: all.length, grouped: all.filter((i) => i.isGroupedBilling).length,
    }
  },

  async getTargets(screen) {
    return lsGet('targets', []).filter((t) => !screen || t.screen === screen)
  },
  async putTarget(t) {
    const all = lsGet('targets', [])
    const i = all.findIndex((x) => x.screen === t.screen && x.metric_key === t.metricKey && (x.dimension || '') === (t.dimension || ''))
    const row = {
      id: i >= 0 ? all[i].id : Date.now(),
      screen: t.screen, metric_key: t.metricKey, dimension: t.dimension || '',
      value: Number(t.value), due_date: t.dueDate || null, owner: t.owner || null, note: t.note || null,
    }
    if (i >= 0) all[i] = row; else all.push(row)
    lsSet('targets', all)
    return row
  },
  async deleteTarget(id) {
    lsSet('targets', lsGet('targets', []).filter((t) => t.id !== id))
    return { ok: true }
  },

  async getActions(screen) {
    return lsGet('actions', [])
      .filter((a) => !screen || a.screen === screen)
      .sort((a, b) => (b.status === 'ouverte') - (a.status === 'ouverte'))
  },
  async addAction(a) {
    const all = lsGet('actions', [])
    if (all.filter((x) => x.screen === a.screen && x.period_key === a.periodKey).length >= 3) {
      throw new Error('Trois actions au maximum par comité')
    }
    const row = {
      id: Date.now(), screen: a.screen, period_key: a.periodKey, label: a.label,
      owner: a.owner || null, due_date: a.dueDate || null, evidence: a.evidence || null,
      metric_key: a.metricKey || null, status: 'ouverte',
      created_at: new Date().toISOString(),
    }
    all.push(row); lsSet('actions', all)
    return row
  },
  async patchAction(id, patch) {
    const all = lsGet('actions', [])
    const i = all.findIndex((a) => a.id === id)
    if (i < 0) return null
    all[i] = { ...all[i], ...patch }
    lsSet('actions', all)
    return all[i]
  },
  async deleteAction(id) {
    lsSet('actions', lsGet('actions', []).filter((a) => a.id !== id))
    return { ok: true }
  },

  async getStaffing() { return lsGet('staffing', []) },
  async putStaffing(day, headcount) {
    const all = lsGet('staffing', []).filter((s) => s.day !== day)
    all.push({ day, headcount: Number(headcount) })
    lsSet('staffing', all.sort((a, b) => b.day.localeCompare(a.day)))
    return { ok: true }
  },

  async getWorkedDays(period) { return lsGet(`worked-${period}`, {}) },
  async putWorkedDays(period, map) { lsSet(`worked-${period}`, map); return { ok: true } },

  // La passerelle DepanTime passe par le serveur Cockpit : sans lui, la
  // reprise n'est pas possible et la saisie manuelle reste seule.
  async depantimeStatus() {
    return {
      configured: false, ok: false,
      message: 'La reprise depuis DepanTime nécessite le serveur Cockpit. ' +
               'En mode poste local, les jours et heures se saisissent à la main.',
    }
  },
  async depantimeEffectifs() { throw new Error('Indisponible en mode poste local') },
}

// ---------------------------------------------------------------------------
// Implémentation distante
// ---------------------------------------------------------------------------

const remoteStore = {
  mode: 'remote',

  async me() { return (await http('/auth/me')).user },
  async login(username, password) {
    const r = await http('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
    setToken(r.token)
    return r.user
  },
  async changePassword(current, next) {
    return http('/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) })
  },

  async getSettings() {
    const s = await http('/settings')
    return {
      thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(s.thresholds || {}) },
      costs: { ...DEFAULT_SETTINGS.costs, ...(s.costs || {}) },
      owners: s.owners || {},
      import: { ...DEFAULT_SETTINGS.import, ...(s.import || {}) },
      depantime: { ...DEFAULT_SETTINGS.depantime, ...(s.depantime || {}) },
    }
  },
  async putSetting(key, value) {
    return http(`/settings/${key}`, { method: 'PUT', body: JSON.stringify(value) })
  },

  async listImports() { return http('/imports') },
  async saveImport(payload) {
    return http('/imports', { method: 'POST', body: JSON.stringify(payload) })
  },
  async deleteImport(id) { return http(`/imports/${id}`, { method: 'DELETE' }) },

  async getInterventions({ from, to, grouped = '0' } = {}) {
    const qs = new URLSearchParams()
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    qs.set('grouped', grouped)
    const rows = await http(`/interventions?${qs}`)
    return rows.map(reviveIntervention)
  },
  async getRange() { return http('/interventions/range') },

  async getTargets(screen) { return http(`/targets${screen ? `?screen=${screen}` : ''}`) },
  async putTarget(t) { return http('/targets', { method: 'PUT', body: JSON.stringify(t) }) },
  async deleteTarget(id) { return http(`/targets/${id}`, { method: 'DELETE' }) },

  async getActions(screen) { return http(`/actions${screen ? `?screen=${screen}` : ''}`) },
  async addAction(a) { return http('/actions', { method: 'POST', body: JSON.stringify(a) }) },
  async patchAction(id, patch) {
    const body = {
      status: patch.status, label: patch.label, owner: patch.owner,
      dueDate: patch.due_date ?? patch.dueDate, evidence: patch.evidence,
    }
    return http(`/actions/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
  },
  async deleteAction(id) { return http(`/actions/${id}`, { method: 'DELETE' }) },

  async getStaffing() { return http('/staffing') },
  async putStaffing(day, headcount) {
    return http(`/staffing/${day}`, { method: 'PUT', body: JSON.stringify({ headcount }) })
  },

  async getWorkedDays(period) { return http(`/worked-days/${period}`) },
  async putWorkedDays(period, map) {
    return http(`/worked-days/${period}`, { method: 'PUT', body: JSON.stringify(map) })
  },

  // --- Passerelle DepanTime ---
  async depantimeStatus() { return http('/depantime/status') },
  async depantimeEffectifs({ siteId, from, to }) {
    const qs = new URLSearchParams({ siteId: String(siteId), from, to })
    return http(`/depantime/effectifs?${qs}`)
  },
}

// ---------------------------------------------------------------------------

let current = null

/** Détecte le mode et renvoie le store à utiliser. */
export async function initStore() {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(2500) })
    if (res.ok) {
      const h = await res.json()
      current = remoteStore
      return { store: remoteStore, authRequired: !!h.auth }
    }
  } catch { /* pas de serveur : on bascule en local */ }
  current = localStore
  return { store: localStore, authRequired: false }
}

export function getStore() { return current || localStore }
export { localStore, remoteStore }
