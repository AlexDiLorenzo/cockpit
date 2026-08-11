/**
 * API COCKPIT
 * =========================================================================
 * Rôle volontairement mince : conserver les données et les restituer.
 *
 * Les indicateurs ne sont PAS calculés ici. Le cahier des charges impose des
 * définitions identiques sur les trois écrans ; les recoder côté serveur
 * créerait une seconde vérité. Le serveur stocke les interventions
 * normalisées, le navigateur applique `src/core/metrics.js`.
 */

import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { pool, query, initDB } from './db.js'
import * as depantime from './depantime.js'

const app = express()
const PORT = Number(process.env.CK_PORT || 3100)
const JWT_SECRET = process.env.CK_JWT_SECRET || 'cockpit-dev-secret-a-changer'
const AUTH_ENABLED = process.env.CK_AUTH !== 'off'

// Le front peut être servi depuis Cloudflare Pages, donc depuis une autre
// origine que l'API. On n'ouvre qu'aux origines déclarées ; sans réglage,
// tout est accepté (développement local).
const ORIGINS = (process.env.CK_CORS_ORIGIN || '')
  .split(',').map((s) => s.trim()).filter(Boolean)

app.use(cors({
  origin: ORIGINS.length ? ORIGINS : true,
  credentials: false,
}))
app.use(express.json({ limit: process.env.CK_BODY_LIMIT || '64mb' }))

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

function sign(u) {
  return jwt.sign(
    { sub: u.id, username: u.username, displayName: u.display_name, role: u.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  )
}

function auth(req, res, next) {
  if (!AUTH_ENABLED) {
    req.user = { username: 'local', displayName: 'Poste local', role: 'admin' }
    return next()
  }
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Authentification requise' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Session expirée' })
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, auth: AUTH_ENABLED }))

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {}
  const { rows } = await query('SELECT * FROM users WHERE username = $1', [String(username || '').toLowerCase()])
  const u = rows[0]
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects' })
  }
  res.json({ token: sign(u), user: { username: u.username, displayName: u.display_name, role: u.role } })
})

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: { username: req.user.username, displayName: req.user.displayName, role: req.user.role } })
})

app.post('/api/auth/password', auth, async (req, res) => {
  const { current, next } = req.body || {}
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum)' })
  const { rows } = await query('SELECT * FROM users WHERE username = $1', [req.user.username])
  const u = rows[0]
  if (!u || !bcrypt.compareSync(String(current || ''), u.password_hash)) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' })
  }
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(String(next), 10), u.id])
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Réglages — seuils, coûts, propriétaires d'indicateurs
// ---------------------------------------------------------------------------

app.get('/api/settings', auth, async (_req, res) => {
  const { rows } = await query('SELECT key, value FROM settings')
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])))
})

app.put('/api/settings/:key', auth, async (req, res) => {
  const { key } = req.params
  await query(
    `INSERT INTO settings(key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()`,
    [key, JSON.stringify(req.body ?? {}), req.user.username]
  )
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

app.get('/api/imports', auth, async (_req, res) => {
  const { rows } = await query(
    `SELECT id, source_id, label, period_start, period_end, rows_source, rows_kept,
            rows_grouped, report, created_by, created_at
       FROM imports ORDER BY created_at DESC LIMIT 100`
  )
  res.json(rows)
})

/**
 * Enregistre un import.
 * Corps : { sourceId, label, report, interventions: [...], grouped: [...] }
 *
 * Les interventions déjà connues (même empreinte) sont mises à jour : deux
 * exports qui se chevauchent ne créent pas de doublon, et le dernier import
 * fait foi.
 */
app.post('/api/imports', auth, async (req, res) => {
  const { sourceId, label, report = {}, interventions = [], grouped = [] } = req.body || {}
  if (!Array.isArray(interventions)) return res.status(400).json({ error: 'interventions manquantes' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const ins = await client.query(
      `INSERT INTO imports(source_id, label, period_start, period_end, rows_source,
                           rows_kept, rows_grouped, report, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        sourceId || 'xlsx', label || 'import',
        report.periodStart || null, report.periodEnd || null,
        report.sourceRows || 0, interventions.length, grouped.length,
        JSON.stringify(report), req.user.username,
      ]
    )
    const importId = ins.rows[0].id

    const all = [...interventions, ...grouped]
    const BATCH = 400
    for (let off = 0; off < all.length; off += BATCH) {
      const chunk = all.slice(off, off + BATCH)
      const values = []
      const params = []
      chunk.forEach((it, k) => {
        const b = k * 12
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12})`)
        params.push(
          it.key, importId, it.refDate || null, it.dayKey || null,
          it.weekKey || null, it.monthKey || null, it.depanneur || null,
          it.origine || null, it.typeIntervention || null, it.vehicule || null,
          Number(it.totalHT) || 0, JSON.stringify(it)
        )
      })
      await client.query(
        `INSERT INTO interventions
           (mission_key, import_id, ref_date, day_key, week_key, month_key,
            depanneur, origine, type_interv, vehicule, total_ht, data)
         VALUES ${values.join(',')}
         ON CONFLICT (mission_key) DO UPDATE SET
           import_id = EXCLUDED.import_id, ref_date = EXCLUDED.ref_date,
           day_key = EXCLUDED.day_key, week_key = EXCLUDED.week_key,
           month_key = EXCLUDED.month_key, depanneur = EXCLUDED.depanneur,
           origine = EXCLUDED.origine, type_interv = EXCLUDED.type_interv,
           vehicule = EXCLUDED.vehicule, total_ht = EXCLUDED.total_ht,
           data = EXCLUDED.data, updated_at = now()`,
        params
      )
    }

    // `is_grouped` est porté par la donnée normalisée : on le recopie en
    // colonne pour pouvoir filtrer sans désérialiser le JSON.
    await client.query(
      `UPDATE interventions SET is_grouped = (data->>'isGroupedBilling')::boolean
        WHERE import_id = $1`, [importId]
    )

    await client.query('COMMIT')
    res.json({ ok: true, importId, stored: all.length })
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('[import]', e)
    res.status(500).json({ error: String(e.message || e) })
  } finally {
    client.release()
  }
})

app.delete('/api/imports/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l’administrateur' })
  await query('DELETE FROM interventions WHERE import_id = $1', [req.params.id])
  await query('DELETE FROM imports WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

/** GET /api/interventions?from=AAAA-MM-JJ&to=AAAA-MM-JJ&grouped=0|1|all */
app.get('/api/interventions', auth, async (req, res) => {
  const { from, to, grouped = '0' } = req.query
  const where = []
  const params = []
  if (from) { params.push(from); where.push(`day_key >= $${params.length}`) }
  if (to) { params.push(to); where.push(`day_key <= $${params.length}`) }
  if (grouped === '0') where.push('is_grouped = FALSE')
  else if (grouped === '1') where.push('is_grouped = TRUE')

  const { rows } = await query(
    `SELECT data FROM interventions
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ref_date`,
    params
  )
  res.json(rows.map((r) => r.data))
})

/** Bornes disponibles — sert à savoir si l'historique couvre 8 semaines. */
app.get('/api/interventions/range', auth, async (_req, res) => {
  const { rows } = await query(
    `SELECT MIN(day_key) AS start, MAX(day_key) AS "end", COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE is_grouped)::int AS grouped
       FROM interventions`
  )
  res.json(rows[0])
})

// ---------------------------------------------------------------------------
// Cibles
// ---------------------------------------------------------------------------

app.get('/api/targets', auth, async (req, res) => {
  const { screen } = req.query
  const { rows } = screen
    ? await query('SELECT * FROM targets WHERE screen = $1 ORDER BY metric_key', [screen])
    : await query('SELECT * FROM targets ORDER BY screen, metric_key')
  res.json(rows)
})

app.put('/api/targets', auth, async (req, res) => {
  const { screen, metricKey, dimension = '', value, dueDate, owner, note } = req.body || {}
  if (!screen || !metricKey || value == null) return res.status(400).json({ error: 'Cible incomplète' })
  const { rows } = await query(
    `INSERT INTO targets(screen, metric_key, dimension, value, due_date, owner, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (screen, metric_key, dimension) DO UPDATE SET
       value = EXCLUDED.value, due_date = EXCLUDED.due_date,
       owner = EXCLUDED.owner, note = EXCLUDED.note
     RETURNING *`,
    [screen, metricKey, dimension, value, dueDate || null, owner || null, note || null, req.user.username]
  )
  res.json(rows[0])
})

app.delete('/api/targets/:id', auth, async (req, res) => {
  await query('DELETE FROM targets WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Les actions ouvertes remontent quelle que soit la période : c'est ce qui
 *  permet de les retrouver en tête d'écran au comité suivant. */
app.get('/api/actions', auth, async (req, res) => {
  const { screen } = req.query
  const { rows } = await query(
    `SELECT * FROM actions
      WHERE ($1::text IS NULL OR screen = $1)
      ORDER BY (status = 'ouverte') DESC, due_date NULLS LAST, created_at DESC`,
    [screen || null]
  )
  res.json(rows)
})

app.post('/api/actions', auth, async (req, res) => {
  const { screen, periodKey, label, owner, dueDate, evidence, metricKey } = req.body || {}
  if (!screen || !periodKey || !label) return res.status(400).json({ error: 'Action incomplète' })

  // Trois actions au plus par rituel et par période : la contrainte est
  // volontaire, elle force le comité à choisir.
  const { rows: cnt } = await query(
    `SELECT COUNT(*)::int AS n FROM actions WHERE screen = $1 AND period_key = $2`,
    [screen, periodKey]
  )
  if (cnt[0].n >= 3) return res.status(400).json({ error: 'Trois actions au maximum par comité' })

  const { rows } = await query(
    `INSERT INTO actions(screen, period_key, label, owner, due_date, evidence, metric_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [screen, periodKey, label, owner || null, dueDate || null, evidence || null, metricKey || null, req.user.username]
  )
  res.json(rows[0])
})

app.patch('/api/actions/:id', auth, async (req, res) => {
  const { status, label, owner, dueDate, evidence } = req.body || {}
  const { rows } = await query(
    `UPDATE actions SET
       status    = COALESCE($2, status),
       label     = COALESCE($3, label),
       owner     = COALESCE($4, owner),
       due_date  = COALESCE($5, due_date),
       evidence  = COALESCE($6, evidence),
       closed_at = CASE WHEN $2 IN ('faite','bloquee') THEN now()
                        WHEN $2 = 'ouverte' THEN NULL ELSE closed_at END
     WHERE id = $1 RETURNING *`,
    [req.params.id, status || null, label || null, owner || null, dueDate || null, evidence || null]
  )
  res.json(rows[0] || null)
})

app.delete('/api/actions/:id', auth, async (req, res) => {
  await query('DELETE FROM actions WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Effectifs — saisie manuelle en attendant l'applicatif de pointage
// ---------------------------------------------------------------------------

app.get('/api/staffing', auth, async (req, res) => {
  const { from, to } = req.query
  const { rows } = await query(
    `SELECT to_char(day,'YYYY-MM-DD') AS day, headcount FROM staffing
      WHERE ($1::date IS NULL OR day >= $1) AND ($2::date IS NULL OR day <= $2)
      ORDER BY day DESC LIMIT 400`,
    [from || null, to || null]
  )
  res.json(rows)
})

app.put('/api/staffing/:day', auth, async (req, res) => {
  const n = Number(req.body?.headcount)
  if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Effectif invalide' })
  await query(
    `INSERT INTO staffing(day, headcount) VALUES ($1,$2)
     ON CONFLICT (day) DO UPDATE SET headcount = $2, updated_at = now()`,
    [req.params.day, Math.round(n)]
  )
  res.json({ ok: true })
})

app.get('/api/worked-days/:period', auth, async (req, res) => {
  const { rows } = await query(
    'SELECT depanneur, days FROM worked_days WHERE period_key = $1',
    [req.params.period]
  )
  res.json(Object.fromEntries(rows.map((r) => [r.depanneur, Number(r.days)])))
})

app.put('/api/worked-days/:period', auth, async (req, res) => {
  const entries = Object.entries(req.body || {})
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const [dep, days] of entries) {
      await client.query(
        `INSERT INTO worked_days(period_key, depanneur, days) VALUES ($1,$2,$3)
         ON CONFLICT (period_key, depanneur) DO UPDATE SET days = $3, updated_at = now()`,
        [req.params.period, dep, Number(days) || 0]
      )
    }
    await client.query('COMMIT')
    res.json({ ok: true, saved: entries.length })
  } catch (e) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: String(e.message || e) })
  } finally {
    client.release()
  }
})

// ---------------------------------------------------------------------------
// Passerelle DepanTime — effectifs, jours travaillés, heures payées
// ---------------------------------------------------------------------------

/**
 * Ce que l'export PowerPanne ne contient pas vient de l'applicatif de
 * pointage. La lecture se fait de conteneur à conteneur ; les identifiants
 * du compte de service restent ici et ne descendent jamais au navigateur.
 */
app.get('/api/depantime/status', auth, async (_req, res) => {
  res.json(await depantime.status())
})

/**
 * GET /api/depantime/effectifs?siteId=1&from=AAAA-MM-JJ&to=AAAA-MM-JJ
 *
 * Une seule route pour les trois usages : la plage vaut un jour pour l'écran
 * temps réel, une semaine ISO pour la revue hebdomadaire, un mois pour la
 * revue mensuelle.
 */
app.get('/api/depantime/effectifs', auth, async (req, res) => {
  const { siteId, from, to } = req.query
  if (!depantime.isConfigured()) {
    return res.status(501).json({ error: 'Passerelle DepanTime non configurée' })
  }
  if (!siteId || !from || !to) {
    return res.status(400).json({ error: 'siteId, from et to sont requis' })
  }
  try {
    res.json(await depantime.effectifs({ siteId, from, to }))
  } catch (e) {
    console.error('[depantime]', e)
    res.status(502).json({ error: String(e.message || e) })
  }
})

// ---------------------------------------------------------------------------
// Passerelle PowerPanne — en attente de l'ouverture de l'API
// ---------------------------------------------------------------------------

/**
 * Le jeton d'API ne doit jamais transiter par le navigateur : la source
 * `apiSource` du front appelle cette route, qui relaie côté serveur.
 * Renseigner CK_POWERPANNE_URL et CK_POWERPANNE_TOKEN pour l'activer.
 */
app.get('/api/powerpanne/interventions', auth, async (req, res) => {
  const base = process.env.CK_POWERPANNE_URL
  if (!base) {
    return res.status(501).json({
      error: "L'API PowerPanne n'est pas encore configurée. " +
             'Renseigner CK_POWERPANNE_URL et CK_POWERPANNE_TOKEN, ' +
             "puis ajuster mapRecord() dans src/sources/apiSource.js.",
    })
  }
  try {
    const url = new URL(base)
    if (req.query.from) url.searchParams.set('from', req.query.from)
    if (req.query.to) url.searchParams.set('to', req.query.to)
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(process.env.CK_POWERPANNE_TOKEN
          ? { Authorization: `Bearer ${process.env.CK_POWERPANNE_TOKEN}` }
          : {}),
      },
    })
    if (!r.ok) return res.status(r.status).json({ error: `PowerPanne a répondu ${r.status}` })
    res.json(await r.json())
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
})

// ---------------------------------------------------------------------------

app.use((err, _req, res, _next) => {
  console.error('[erreur]', err)
  res.status(500).json({ error: String(err.message || err) })
})

initDB()
  .then(() => app.listen(PORT, () => console.log(`[cockpit] API sur le port ${PORT}`)))
  .catch((e) => { console.error('[cockpit] démarrage impossible', e); process.exit(1) })
