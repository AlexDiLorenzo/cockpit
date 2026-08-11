/**
 * PRIMITIVES D'INTERFACE
 * Cartes, tuiles, modales, tableaux de détail, cibles et actions.
 * Tout suit la charte Montpellier Dépannage.
 */

import { useEffect, useState, useRef } from 'react'
import { nb, pct, eur, heure, dateCourte, court, EMPTY, STATUTS_ACTION, dateISO } from '../format.js'
import { Sparkline, VIZ } from './charts.jsx'

// ---------------------------------------------------------------------------
// Tuile d'indicateur
// ---------------------------------------------------------------------------

/**
 * @param {'ok'|'warn'|'danger'|'neutral'} tone
 * @param {boolean} clickable  ouvre la liste des dossiers concernés
 */
export function StatTile({
  label, value, sub, tone = 'neutral', onClick, seuil, spark,
  hero = false, footnote, badge,
}) {
  const border = {
    ok: 'var(--md-forest-200)', warn: 'var(--md-signal-300)',
    danger: 'var(--md-danger)', neutral: 'var(--color-border)',
  }[tone]
  const couleur = {
    ok: 'var(--md-forest-600)', warn: 'var(--md-signal-800)',
    danger: 'var(--md-danger)', neutral: 'var(--color-text)',
  }[tone]

  return (
    <div
      className="card"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
      style={{
        borderColor: border,
        borderWidth: tone === 'danger' ? 2 : 1,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 150ms var(--ease-standard), border-color 150ms var(--ease-standard)',
        display: 'flex', flexDirection: 'column', gap: 6, minHeight: hero ? 168 : 132,
      }}
      onMouseEnter={(e) => onClick && (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
      onMouseLeave={(e) => onClick && (e.currentTarget.style.boxShadow = 'var(--shadow-sm)')}
    >
      <div className="row">
        <span className="md-overline">{label}</span>
        <div className="spacer" />
        {badge}
      </div>

      <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
        {/* Valeur en chiffres proportionnels : les tabular-nums sont réservés
            aux colonnes de tableau. */}
        <span style={{
          fontFamily: 'var(--font-sans)', fontWeight: 700,
          fontSize: hero ? 44 : 32, lineHeight: 1.1, color: couleur,
          letterSpacing: '-0.02em',
        }}>{value}</span>
        {spark && <div style={{ marginLeft: 'auto' }}><Sparkline data={spark} color={couleur} /></div>}
      </div>

      {sub && <div className="md-small" style={{ lineHeight: 1.4 }}>{sub}</div>}
      <div className="spacer" />
      <div className="row" style={{ gap: 8 }}>
        {seuil != null && <span className="md-small">seuil {seuil}</span>}
        {footnote && <span className="md-small">{footnote}</span>}
        {onClick && <span className="spacer" />}
        {onClick && <span className="md-small link-quiet">Voir les dossiers →</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modale
// ---------------------------------------------------------------------------

export function Modal({ title, subtitle, onClose, children, width = 900, footer }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = '' }
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(26,25,15,0.35)',
        display: 'grid', placeItems: 'center', zIndex: 100, padding: 24,
        animation: 'fadeIn 150ms var(--ease-standard)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)',
          width: '100%', maxWidth: width, maxHeight: '86vh', display: 'flex', flexDirection: 'column',
        }}
      >
        <div className="row" style={{ padding: '18px 20px', borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h3 className="md-h3">{title}</h3>
            {subtitle && <div className="md-small" style={{ marginTop: 2 }}>{subtitle}</div>}
          </div>
          <div className="spacer" />
          <button className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div className="row" style={{ padding: '14px 20px', borderTop: '1px solid var(--color-border)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Liste de dossiers — le détail derrière chaque compteur
// ---------------------------------------------------------------------------

const COLONNES_DOSSIER = [
  { key: 'dossierNo', label: 'Dossier' },
  { key: 'depanneur', label: 'Dépanneur' },
  { key: 'heure', label: 'Heure' },
  { key: 'lieu', label: 'Lieu' },
]

export function DossierTable({ items, extra = [], emptyLabel = 'Aucun dossier' }) {
  const [tri, setTri] = useState({ col: null, asc: true })
  if (!items.length) return <div className="empty" style={{ padding: 20 }}>{emptyLabel}</div>

  const cols = [...COLONNES_DOSSIER, ...extra]
  const val = (it, c) => {
    if (c.value) return c.value(it)
    if (c.key === 'heure') return it.refDate ? it.refDate.getTime() : 0
    if (c.key === 'lieu') return it.lieuPriseEnCharge || ''
    return it[c.key] ?? ''
  }
  const rows = tri.col
    ? [...items].sort((a, b) => {
        const c = cols.find((x) => x.key === tri.col)
        const va = val(a, c), vb = val(b, c)
        const r = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr')
        return tri.asc ? r : -r
      })
    : items

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="md-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.num ? 'num' : ''}
                style={{ cursor: 'pointer' }}
                onClick={() => setTri((t) => ({ col: c.key, asc: t.col === c.key ? !t.asc : true }))}>
                {c.label}{tri.col === c.key ? (tri.asc ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => (
            <tr key={it.key}>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{it.dossierNo || EMPTY}</td>
              <td>{it.depanneur || EMPTY}</td>
              <td style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                {dateCourte(it.refDate)} {heure(it.refDate)}
              </td>
              <td title={it.lieuPriseEnCharge || ''}>{court(it.lieuPriseEnCharge, 42)}</td>
              {extra.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(it) : (it[c.key] ?? EMPTY)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Export CSV d'une liste de dossiers — pour transmettre le détail. */
export function exportCSV(items, nom = 'dossiers') {
  const cols = ['dossierNo', 'missionNo', 'depanneur', 'refDate', 'origine',
    'typeIntervention', 'lieuPriseEnCharge', 'totalHT', 'delaiArriveeMin', 'estFacture']
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lignes = [cols.join(';')]
  for (const it of items) {
    lignes.push(cols.map((c) => {
      const v = it[c]
      if (v instanceof Date) return esc(`${dateCourte(v)} ${heure(v)}`)
      if (typeof v === 'number') return esc(String(v).replace('.', ','))
      return esc(v)
    }).join(';'))
  }
  const blob = new Blob(['﻿' + lignes.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${nom}-${dateISO(new Date())}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// ---------------------------------------------------------------------------
// Champs de saisie
// ---------------------------------------------------------------------------

export function Field({ label, hint, children, width }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, width }}>
      <span className="md-label">{label}</span>
      {children}
      {hint && <span className="md-small" style={{ fontSize: 11 }}>{hint}</span>}
    </label>
  )
}

export function NumInput({ value, onChange, step = 1, min, max, suffix, width = 90 }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <input className="num" type="number" value={value ?? ''} step={step} min={min} max={max}
        style={{ width }} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      {suffix && <span className="md-small">{suffix}</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Bandeau des actions du comité
// ---------------------------------------------------------------------------

/**
 * Les actions ouvertes des comités précédents sont en tête d'écran : c'est
 * la première chose que voit le comité, avant les indicateurs.
 */
export function ActionsBar({ actions, periodKey, screen, onAdd, onPatch, onDelete, indicateurs }) {
  const [ouvertes, faites] = [
    actions.filter((a) => a.status === 'ouverte'),
    actions.filter((a) => a.status !== 'ouverte'),
  ]
  const [form, setForm] = useState(null)
  const dePeriode = actions.filter((a) => a.period_key === periodKey)

  return (
    <section className="card" style={{ borderColor: ouvertes.length ? 'var(--md-signal-300)' : 'var(--color-border)' }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <h3 className="md-h3">Actions du comité</h3>
        <span className="pill pill-neutral">{ouvertes.length} en cours</span>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm no-print"
          disabled={dePeriode.length >= 3}
          title={dePeriode.length >= 3 ? 'Trois actions au maximum par comité' : ''}
          onClick={() => setForm({ label: '', owner: '', dueDate: '', evidence: '', metricKey: '' })}>
          + Action ({dePeriode.length}/3)
        </button>
      </div>

      {!actions.length && (
        <div className="empty" style={{ padding: '12px 0' }}>
          Aucune action enregistrée. Le comité en pose jusqu'à trois par séance.
        </div>
      )}

      {[...ouvertes, ...faites].map((a) => {
        const st = STATUTS_ACTION[a.status] || STATUTS_ACTION.ouverte
        const enRetard = a.status === 'ouverte' && a.due_date && new Date(a.due_date) < new Date()
        return (
          <div key={a.id} style={{
            display: 'grid', gridTemplateColumns: '1fr auto', gap: 12,
            padding: '10px 0', borderTop: '1px solid var(--md-stone-100)',
            opacity: a.status === 'faite' ? 0.65 : 1,
          }}>
            <div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, textDecoration: a.status === 'faite' ? 'line-through' : 'none' }}>
                  {a.label}
                </span>
                <span className={`pill ${st.pill}`}>{st.label}</span>
                {enRetard && <span className="pill pill-danger">échéance dépassée</span>}
              </div>
              <div className="md-small" style={{ marginTop: 3 }}>
                {a.owner || 'sans porteur'}
                {a.due_date ? ` · pour le ${dateCourte(a.due_date)}` : ''}
                {a.metric_key && indicateurs?.[a.metric_key] ? ` · ${indicateurs[a.metric_key].label}` : ''}
                {a.evidence ? ` · preuve : ${a.evidence}` : ''}
                {a.period_key !== periodKey ? ` · posée en ${a.period_key}` : ''}
              </div>
            </div>
            <div className="row no-print" style={{ gap: 4 }}>
              {['faite', 'non_faite', 'bloquee'].map((s) => (
                <button key={s} className={`btn btn-sm ${a.status === s ? 'btn-primary' : 'btn-quiet'}`}
                  onClick={() => onPatch(a.id, { status: a.status === s ? 'ouverte' : s })}>
                  {STATUTS_ACTION[s].label}
                </button>
              ))}
              <button className="btn btn-quiet btn-sm" onClick={() => onDelete(a.id)} title="Supprimer">✕</button>
            </div>
          </div>
        )
      })}

      {form && (
        <Modal title="Nouvelle action" subtitle={`Comité ${periodKey}`} width={620}
          onClose={() => setForm(null)}
          footer={
            <>
              <div className="spacer" />
              <button className="btn btn-ghost" onClick={() => setForm(null)}>Annuler</button>
              <button className="btn btn-primary" disabled={!form.label.trim()}
                onClick={() => { onAdd({ ...form, screen, periodKey }); setForm(null) }}>
                Enregistrer
              </button>
            </>
          }>
          <div className="grid" style={{ gap: 14 }}>
            <Field label="Libellé de l'action">
              <input value={form.label} autoFocus placeholder="Ce qui doit être fait"
                onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </Field>
            <div className="row" style={{ gap: 14 }}>
              <Field label="Porteur" width="50%">
                <input value={form.owner} placeholder="Qui s'en charge"
                  onChange={(e) => setForm({ ...form, owner: e.target.value })} />
              </Field>
              <Field label="Échéance" width="50%">
                <input type="date" value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </Field>
            </div>
            <Field label="Indicateur de preuve" hint="Ce qui permettra de constater que l'action a produit son effet">
              <input value={form.evidence} placeholder="Par exemple : SLA AXA au-dessus de 70 % en S34"
                onChange={(e) => setForm({ ...form, evidence: e.target.value })} />
            </Field>
            <Field label="Indicateur concerné">
              <select value={form.metricKey} onChange={(e) => setForm({ ...form, metricKey: e.target.value })}>
                <option value="">— aucun —</option>
                {Object.entries(indicateurs || {}).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Édition d'une cible
// ---------------------------------------------------------------------------

export function TargetButton({ indicateur, metricKey, screen, target, onSave, onDelete, format }) {
  const [open, setOpen] = useState(false)
  const [v, setV] = useState(target ? String(target.value) : '')
  const [d, setD] = useState(target?.due_date ? String(target.due_date).slice(0, 10) : '')
  const [o, setO] = useState(target?.owner || '')

  useEffect(() => {
    setV(target ? String(target.value) : '')
    setD(target?.due_date ? String(target.due_date).slice(0, 10) : '')
    setO(target?.owner || '')
  }, [target])

  const estPct = indicateur.format === 'pct'

  return (
    <>
      <button className="btn btn-quiet btn-sm no-print" onClick={() => setOpen(true)}>
        {target ? `Cible ${format(target.value)}` : '+ Cible'}
      </button>
      {open && (
        <Modal title={`Cible — ${indicateur.label}`} width={560} onClose={() => setOpen(false)}
          footer={
            <>
              {target && (
                <button className="btn btn-danger btn-sm"
                  onClick={() => { onDelete(target.id); setOpen(false) }}>Retirer la cible</button>
              )}
              <div className="spacer" />
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>Annuler</button>
              <button className="btn btn-primary" disabled={v === ''}
                onClick={() => {
                  onSave({
                    screen, metricKey, dimension: '',
                    value: estPct ? Number(v) / 100 : Number(v),
                    dueDate: d || null, owner: o || null,
                  })
                  setOpen(false)
                }}>Enregistrer</button>
            </>
          }>
          <div className="grid" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 14 }}>
              <Field label={`Valeur visée (${estPct ? '%' : indicateur.unit})`} width={190}>
                <input className="num" type="number" step="any" value={v} autoFocus
                  onChange={(e) => setV(e.target.value)} />
              </Field>
              <Field label="Échéance" width={190}>
                <input type="date" value={d} onChange={(e) => setD(e.target.value)} />
              </Field>
            </div>
            <Field label="Propriétaire de l'indicateur">
              <input value={o} placeholder="Nom du responsable" onChange={(e) => setO(e.target.value)} />
            </Field>
            <div className="md-small">
              {indicateur.better === 'lower'
                ? 'Cet indicateur est bon quand il baisse.'
                : 'Cet indicateur est bon quand il monte.'}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------

/** Mention des lignes écartées — exigée par le cahier des charges. */
export function ExclusionNote({ excluded, n, quoi = 'lignes' }) {
  if (!excluded) return <span className="md-small">{nb(n)} {quoi} prises en compte</span>
  return (
    <span className="md-small">
      {nb(n)} {quoi} prises en compte ·{' '}
      <span style={{ color: 'var(--md-signal-800)', fontWeight: 600 }}>
        {nb(excluded)} écartée{excluded > 1 ? 's' : ''}
      </span>{' '}
      (délai négatif ou supérieur à 24 h)
    </span>
  )
}

export function Toast({ message, tone = 'ok', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])
  const bg = { ok: 'var(--md-forest-600)', danger: 'var(--md-danger)', warn: 'var(--md-signal-300)' }[tone]
  const fg = tone === 'warn' ? 'var(--md-stone-900)' : '#fff'
  return (
    <div style={{
      position: 'fixed', right: 24, bottom: 24, zIndex: 200,
      background: bg, color: fg, padding: '12px 18px',
      borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
      fontWeight: 600, animation: 'toastIn 240ms var(--ease-standard)', maxWidth: 420,
    }}>{message}</div>
  )
}

export function Spinner({ label = 'Chargement…' }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 60, gap: 12 }}>
      <svg width="28" height="28" viewBox="0 0 28 28">
        <circle cx="14" cy="14" r="11" fill="none" stroke="var(--md-stone-200)" strokeWidth="3" />
        <path d="M14 3 a11 11 0 0 1 11 11" fill="none" stroke="var(--md-forest-600)"
          strokeWidth="3" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 14 14" to="360 14 14"
            dur="0.9s" repeatCount="indefinite" />
        </path>
      </svg>
      <span className="md-small">{label}</span>
    </div>
  )
}

export function EmptyState({ titre, texte, action }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 48 }}>
      <h3 className="md-h3" style={{ marginBottom: 8 }}>{titre}</h3>
      <p className="md-small" style={{ maxWidth: 460, margin: '0 auto 16px' }}>{texte}</p>
      {action}
    </div>
  )
}

/** Indique si la valeur atteint la cible, et de combien elle s'en écarte. */
export function TargetBadge({ value, target, better = 'higher', format }) {
  if (target == null || value == null) return null
  const atteint = better === 'higher' ? value >= target : value <= target
  const ecart = value - target
  return (
    <span className={`pill ${atteint ? 'pill-ok' : 'pill-danger'}`}>
      {atteint ? '✓ cible tenue' : `${ecart > 0 ? '+' : '−'}${format(Math.abs(ecart))} / cible`}
    </span>
  )
}
