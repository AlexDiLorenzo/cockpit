/**
 * GRAPHIQUES — SVG, sans bibliothèque
 * =========================================================================
 * Palette validée contre la charte Montpellier Dépannage :
 *   catégoriel  #2C6126 · #185FA5 · #A09D1E · #A32D2D
 *               (ΔE deutan 19,4 sur la paire adjacente la plus proche)
 *   séquentiel  rampe forest 100 → 800, une seule teinte
 *   divergent   danger ↔ forest, point neutre stone
 *
 * Le jaune de la charte (signal-300) reste un fond : il n'est jamais employé
 * comme trait ni comme texte. Chaque graphique dispose d'une vue tableau, et
 * les valeurs restent lisibles sans survol.
 */

import { useState, useRef, useEffect } from 'react'
import { nb, pct, eur, EMPTY } from '../format.js'

export const VIZ = {
  cat: ['#2C6126', '#185FA5', '#A09D1E', '#A32D2D'],
  seq: ['#F1F7EC', '#DCEBCB', '#B8D79B', '#8FBE6A', '#64A142', '#3E7F2C', '#2C6126', '#1F4A1D'],
  grid: '#F1EFE8',
  axis: '#D3D1C7',
  ink: '#1A190F',
  muted: '#888780',
  surface: '#FFFFFF',
  danger: '#A32D2D',
  warn: '#A09D1E',
  ok: '#2C6126',
  info: '#185FA5',
}

/**
 * Tronque un texte à une largeur en pixels, mesurée pour de vrai.
 *
 * Une estimation « n caractères » ne tient pas : « EUROP ASSISTANCE » en
 * capitales est bien plus large que le même nombre de minuscules, et le
 * libellé finit par chevaucher le compteur voisin.
 */
let mesureCtx = null
export function tronquerA(texte, largeurPx, font = '12px "DM Sans", system-ui, sans-serif') {
  const s = String(texte ?? '')
  if (typeof document === 'undefined') return s
  if (!mesureCtx) mesureCtx = document.createElement('canvas').getContext('2d')
  mesureCtx.font = font
  if (mesureCtx.measureText(s).width <= largeurPx) return s
  const ell = '…'
  let lo = 0, hi = s.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (mesureCtx.measureText(s.slice(0, mid) + ell).width <= largeurPx) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? s.slice(0, lo) + ell : ell
}

/** Largeur réelle du conteneur — le SVG est rendu en pixels, pas étiré. */
export function useWidth(fallback = 640) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => {
      const next = Math.floor(e.contentRect.width)
      if (next > 0) setW(next)
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// ---------------------------------------------------------------------------
// Infobulle partagée
// ---------------------------------------------------------------------------

function Tooltip({ x, y, width, children }) {
  if (x == null) return null
  const flip = x > width - 150
  return (
    <div
      style={{
        position: 'absolute', left: flip ? x - 12 : x + 12, top: y,
        transform: flip ? 'translate(-100%, -50%)' : 'translateY(-50%)',
        background: '#fff', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
        padding: '8px 10px', pointerEvents: 'none', zIndex: 20,
        fontSize: 12, whiteSpace: 'nowrap', maxWidth: 260,
      }}
    >
      {children}
    </div>
  )
}

const Legend = ({ items }) => (
  <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
    {items.map((it) => (
      <span key={it.label} className="row" style={{ gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color, display: 'inline-block' }} />
        <span className="md-small" style={{ color: 'var(--color-text)' }}>{it.label}</span>
      </span>
    ))}
  </div>
)

// ---------------------------------------------------------------------------
// Courbe temporelle — une série, cible optionnelle
// ---------------------------------------------------------------------------

/**
 * @param {{period:string, value:number|null, n?:number, excluded?:number}[]} data
 * @param {number|null} target     valeur cible, tracée en repère
 * @param {(v)=>string} fmt        formatage des valeurs
 * @param {'higher'|'lower'} better sens de progression
 */
export function LineChart({
  data, target = null, fmt = (v) => nb(v, 1), better = 'higher',
  height = 190, labelPeriod = (p) => p, unit = '', color = VIZ.cat[0],
}) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const pad = { t: 18, r: 46, b: 26, l: 46 }
  const iw = Math.max(80, w - pad.l - pad.r)
  const ih = height - pad.t - pad.b

  const vals = data.map((d) => d.value).filter((v) => v != null && Number.isFinite(v))
  const withTarget = target != null ? [...vals, target] : vals
  if (!withTarget.length) {
    return <div ref={ref} className="empty" style={{ height, display: 'grid', placeItems: 'center' }}>Pas encore de données</div>
  }

  let min = Math.min(...withTarget), max = Math.max(...withTarget)
  if (min === max) { min -= Math.abs(min || 1) * 0.2; max += Math.abs(max || 1) * 0.2 }
  const span = max - min
  min = Math.max(0, min - span * 0.15)
  max = max + span * 0.18

  const x = (i) => pad.l + (data.length === 1 ? iw / 2 : (iw * i) / (data.length - 1))
  const y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih

  // Une série continue peut avoir des trous (semaine sans données) : on
  // segmente plutôt que de relier par-dessus le vide, qui inventerait
  // une valeur.
  const segments = []
  let cur = []
  data.forEach((d, i) => {
    if (d.value == null || !Number.isFinite(d.value)) { if (cur.length) { segments.push(cur); cur = [] } }
    else cur.push([x(i), y(d.value)])
  })
  if (cur.length) segments.push(cur)

  const ticks = [min, (min + max) / 2, max]
  const last = [...data].reverse().find((d) => d.value != null)
  const lastIdx = last ? data.lastIndexOf(last) : -1

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={w} height={height} role="img" style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t, k) => (
          <g key={k}>
            <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke={VIZ.grid} strokeWidth="1" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10"
              fill={VIZ.muted} fontFamily="var(--font-mono)">{fmt(t)}</text>
          </g>
        ))}

        {target != null && (
          <g>
            {/* Repère de cible — pointillé pour ne jamais être confondu
                avec la série ni avec la grille (qui reste pleine). */}
            <line x1={pad.l} x2={pad.l + iw} y1={y(target)} y2={y(target)}
              stroke={VIZ.info} strokeWidth="1.5" strokeDasharray="5 4" />
            <text x={pad.l + iw + 6} y={y(target) + 4} fontSize="10" fill={VIZ.info}
              fontWeight="700">cible</text>
          </g>
        )}

        {segments.map((seg, k) => (
          <polyline key={k} points={seg.map((p) => p.join(',')).join(' ')}
            fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {data.map((d, i) => d.value == null ? null : (
          <circle key={i} cx={x(i)} cy={y(d.value)} r={i === lastIdx ? 5 : 3.5}
            fill={color} stroke={VIZ.surface} strokeWidth="2" />
        ))}

        {/* Valeur du dernier point uniquement — jamais une étiquette par point. */}
        {last && (
          <text x={x(lastIdx)} y={y(last.value) - 12} textAnchor="middle" fontSize="12"
            fontWeight="700" fill={VIZ.ink} fontFamily="var(--font-mono)">{fmt(last.value)}</text>
        )}

        {data.map((d, i) => (
          <text key={`l${i}`} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10"
            fill={hover === i ? VIZ.ink : VIZ.muted} fontWeight={hover === i ? 700 : 400}>
            {labelPeriod(d.period)}
          </text>
        ))}

        {/* Zones de survol larges : la cible dépasse 24 px même sur 12 points. */}
        {data.map((d, i) => (
          <rect key={`h${i}`} x={x(i) - iw / (2 * Math.max(1, data.length - 1))} y={pad.t}
            width={iw / Math.max(1, data.length - 1)} height={ih} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}

        {hover != null && data[hover].value != null && (
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih}
            stroke={VIZ.axis} strokeWidth="1" />
        )}
      </svg>

      {hover != null && (
        <Tooltip x={x(hover)} y={data[hover].value != null ? y(data[hover].value) : height / 2} width={w}>
          <div style={{ fontWeight: 700 }}>{labelPeriod(data[hover].period)}</div>
          <div style={{ fontFamily: 'var(--font-mono)' }}>
            {data[hover].value != null ? `${fmt(data[hover].value)}${unit}` : 'aucune donnée'}
          </div>
          {data[hover].n != null && <div className="md-small">{nb(data[hover].n)} interventions</div>}
          {data[hover].excluded > 0 && (
            <div className="md-small" style={{ color: VIZ.warn }}>
              {nb(data[hover].excluded)} écartée(s)
            </div>
          )}
        </Tooltip>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barres horizontales — une seule teinte, valeur en bout
// ---------------------------------------------------------------------------

export function BarsH({
  data, fmt = (v) => nb(v), height = null, color = VIZ.cat[0],
  labelWidth = 190, max = null, showZero = true, sub = null,
}) {
  const [ref, w] = useWidth()
  const rows = showZero ? data : data.filter((d) => d.value)
  const barH = 18, gap = 12
  const h = height ?? rows.length * (barH + gap) + 8
  const top = max ?? Math.max(...rows.map((d) => Math.abs(d.value) || 0), 1)
  const iw = Math.max(60, w - labelWidth - 70)
  const [hover, setHover] = useState(null)

  // Le libellé ne doit jamais toucher le compteur aligné à droite de la
  // gouttière : on le tronque sur la place réellement disponible.
  const dispo = Math.max(60, labelWidth - (sub ? 62 : 14))
  const tronque = (s) => tronquerA(s, dispo)

  if (!rows.length) return <div ref={ref} className="empty">Aucune donnée</div>

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={w} height={h} style={{ display: 'block' }}>
        {rows.map((d, i) => {
          const y = i * (barH + gap) + 4
          const bw = Math.max(0, (Math.abs(d.value) / top) * iw)
          return (
            <g key={d.key ?? i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={y - gap / 2} width={w} height={barH + gap} fill="transparent" />
              <text x={0} y={y + barH / 2 + 4} fontSize="12" fill={VIZ.ink}>
                {tronque(String(d.label ?? d.key))}
              </text>
              {sub && (
                <text x={labelWidth - 10} y={y + barH / 2 + 4} fontSize="10" textAnchor="end"
                  fill={VIZ.muted} fontFamily="var(--font-mono)">{sub(d)}</text>
              )}
              <rect x={labelWidth} y={y} width={bw} height={barH}
                fill={d.color || color} rx="4"
                style={{ opacity: hover == null || hover === i ? 1 : 0.45, transition: 'opacity 150ms' }} />
              <text x={labelWidth + bw + 8} y={y + barH / 2 + 4} fontSize="11" fontWeight="600"
                fill={VIZ.ink} fontFamily="var(--font-mono)">{fmt(d.value)}</text>
            </g>
          )
        })}
      </svg>
      {hover != null && rows[hover].tooltip && (
        <Tooltip x={labelWidth + 20} y={hover * (barH + gap) + barH} width={w}>
          {rows[hover].tooltip}
        </Tooltip>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barre segmentée — part-à-tout, six segments au plus
// ---------------------------------------------------------------------------

export function StackedBar({ segments, fmt = (v) => eur(v), height = 34 }) {
  const [ref, w] = useWidth()
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0)
  const [hover, setHover] = useState(null)
  if (!total) return <div ref={ref} className="empty">Aucune donnée</div>

  const GAP = 2 // séparation par le fond, jamais par un contour
  let x = 0
  const parts = segments.map((s, i) => {
    const raw = (Math.max(0, s.value) / total) * (w - GAP * (segments.length - 1))
    const p = { ...s, x, w: raw, color: s.color || VIZ.cat[i % VIZ.cat.length] }
    x += raw + GAP
    return p
  })

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={w} height={height} style={{ display: 'block' }}>
        {parts.map((p, i) => (
          <g key={p.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={p.x} y={0} width={Math.max(0, p.w)} height={height} fill={p.color} rx="4"
              style={{ opacity: hover == null || hover === i ? 1 : 0.5, transition: 'opacity 150ms' }} />
            {/* Étiquette interne seulement si elle tient réellement, et
                encrée selon la luminance du fond : blanc sur le vert forêt,
                sombre sur le jaune, sans quoi elle disparaît. */}
            {p.w > 64 && (
              <text x={p.x + p.w / 2} y={height / 2 + 4} textAnchor="middle" fontSize="11"
                fontWeight="700" fill={encreSur(p.color)} fontFamily="var(--font-mono)">{fmt(p.value)}</text>
            )}
          </g>
        ))}
      </svg>
      <Legend items={parts.map((p) => ({ label: p.label, color: p.color }))} />
      {hover != null && (
        <Tooltip x={parts[hover].x + parts[hover].w / 2} y={height / 2} width={w}>
          <div style={{ fontWeight: 700 }}>{parts[hover].label}</div>
          <div style={{ fontFamily: 'var(--font-mono)' }}>
            {fmt(parts[hover].value)} · {pct(parts[hover].value / total)}
          </div>
          {parts[hover].detail && <div className="md-small">{parts[hover].detail}</div>}
        </Tooltip>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Carte de chaleur heure × jour
// ---------------------------------------------------------------------------

/**
 * Échelle divergente autour de la cible : en dessous vire au rouge,
 * au-dessus au vert, l'égalité reste neutre. C'est la polarité qui compte,
 * pas la magnitude — on cherche les créneaux sous-armés.
 */
export function Heatmap({ grid, center = 0.7, jours, minN = 1, onCell = null }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const labelW = 34, top = 18
  const cell = Math.max(14, Math.floor((w - labelW - 4) / 24))
  const h = top + 7 * (cell + 2)

  const couleur = (v) => {
    if (v == null) return '#F7F6F2'
    const d = (v - center) / Math.max(center, 1 - center)
    const t = Math.min(1, Math.abs(d))
    if (d >= 0) return mix('#EDF1EA', '#2C6126', t)
    return mix('#EDF1EA', '#A32D2D', t)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={w} height={h} style={{ display: 'block' }}>
        {Array.from({ length: 24 }, (_, hh) => (
          hh % 3 === 0 ? (
            <text key={hh} x={labelW + hh * (cell + 0) + cell / 2} y={11} fontSize="9"
              textAnchor="middle" fill={VIZ.muted} fontFamily="var(--font-mono)">
              {String(hh).padStart(2, '0')}
            </text>
          ) : null
        ))}
        {grid.map((row, d) => (
          <g key={d}>
            <text x={0} y={top + d * (cell + 2) + cell / 2 + 4} fontSize="10" fill={VIZ.muted}>
              {jours[d]}
            </text>
            {row.map((c, hh) => {
              const shown = c.n >= minN ? c.value : null
              const active = hover && hover.d === d && hover.h === hh
              return (
                <rect key={hh} x={labelW + hh * cell} y={top + d * (cell + 2)}
                  width={cell - 2} height={cell} rx="3"
                  fill={couleur(shown)}
                  stroke={active ? VIZ.ink : 'none'} strokeWidth="1.5"
                  style={{ cursor: onCell && c.n ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHover({ d, h: hh, ...c })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onCell && c.n && onCell(d, hh, c)} />
              )
            })}
          </g>
        ))}
      </svg>
      {hover && (
        <Tooltip x={labelW + hover.h * cell + cell} y={top + hover.d * (cell + 2) + cell / 2} width={w}>
          <div style={{ fontWeight: 700 }}>{jours[hover.d]} {String(hover.h).padStart(2, '0')} h</div>
          <div style={{ fontFamily: 'var(--font-mono)' }}>
            {hover.n ? `${pct(hover.value)} · ${hover.ok}/${hover.n}` : 'aucune intervention'}
          </div>
        </Tooltip>
      )}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <span className="md-small">sous la cible</span>
        <svg width="120" height="10">
          {Array.from({ length: 20 }, (_, i) => (
            <rect key={i} x={i * 6} y={0} width="6" height="10"
              fill={couleur(center + ((i - 9.5) / 9.5) * Math.max(center, 1 - center))} />
          ))}
        </svg>
        <span className="md-small">au-dessus</span>
        <span className="md-small" style={{ marginLeft: 8 }}>
          repère {pct(center, 0)}
        </span>
      </div>
    </div>
  )
}

/** Blanc ou encre sombre, selon ce qui contraste le mieux avec le fond. */
export function encreSur(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return (L + 0.05) / 0.05 > 4.5 ? VIZ.ink : '#FFFFFF'
}

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b)
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`
}

// ---------------------------------------------------------------------------
// Sparkline — dans les tuiles
// ---------------------------------------------------------------------------

export function Sparkline({ data, width = 96, height = 26, color = VIZ.cat[0] }) {
  const vals = data.map((d) => (typeof d === 'number' ? d : d.value)).filter((v) => v != null)
  if (vals.length < 2) return null
  const min = Math.min(...vals), max = Math.max(...vals)
  const span = max - min || 1
  const pts = vals.map((v, i) => [
    (i / (vals.length - 1)) * (width - 6) + 3,
    height - 3 - ((v - min) / span) * (height - 6),
  ])
  return (
    <svg width={width} height={height} style={{ display: 'block' }} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none"
        stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3"
        fill={color} stroke={VIZ.surface} strokeWidth="1.5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Jauge — charge instantanée, avancement
// ---------------------------------------------------------------------------

export function Meter({ value, max, seuil = null, fmt = (v) => nb(v, 1), tone = 'ok' }) {
  const [ref, w] = useWidth()
  const h = 10
  const t = Math.max(0, Math.min(1, (value || 0) / (max || 1)))
  const couleurs = { ok: VIZ.ok, warn: VIZ.warn, danger: VIZ.danger, info: VIZ.info }
  const c = couleurs[tone] || VIZ.ok
  return (
    <div ref={ref}>
      <svg width={w} height={h} style={{ display: 'block' }}>
        <rect x="0" y="0" width={w} height={h} rx={h / 2} fill="#EDF1EA" />
        <rect x="0" y="0" width={Math.max(2, t * w)} height={h} rx={h / 2} fill={c} />
        {seuil != null && max > 0 && (
          <line x1={(seuil / max) * w} x2={(seuil / max) * w} y1={-2} y2={h + 2}
            stroke={VIZ.ink} strokeWidth="1.5" />
        )}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vue tableau — le jumeau accessible de chaque graphique
// ---------------------------------------------------------------------------

export function TableView({ columns, rows }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <table className="md-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>
                  {c.render ? c.render(r) : (r[c.key] ?? EMPTY)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Enveloppe : titre, bascule graphique ↔ tableau, note de méthode. */
export function ChartCard({ title, subtitle, right, children, table, note, id }) {
  const [showTable, setShowTable] = useState(false)
  return (
    <section className="card" id={id}>
      <div className="row" style={{ marginBottom: subtitle ? 2 : 12, alignItems: 'flex-start' }}>
        <div>
          <h3 className="md-h3">{title}</h3>
          {subtitle && <div className="md-small" style={{ marginTop: 2 }}>{subtitle}</div>}
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 8 }}>
          {right}
          {table && (
            <button className="btn btn-quiet btn-sm no-print" onClick={() => setShowTable((s) => !s)}
              title="Afficher les valeurs sous forme de tableau">
              {showTable ? 'Graphique' : 'Tableau'}
            </button>
          )}
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        {showTable && table ? <TableView {...table} /> : children}
      </div>
      {note && <div className="md-small" style={{ marginTop: 10 }}>{note}</div>}
    </section>
  )
}
