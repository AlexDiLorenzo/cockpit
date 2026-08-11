/**
 * ÉCRAN 1 — TEMPS RÉEL
 * =========================================================================
 * Destiné au chef opérationnel, affiché en continu.
 * Cinq compteurs, chacun cliquable, chacun avec un seuil d'alerte réglable.
 *
 * L'écran se recalcule chaque minute : l'ancienneté d'un dossier non affecté
 * bouge avec l'horloge, pas avec les données.
 */

import { useState, useEffect, useMemo } from 'react'
import {
  realtimeCounters, hourlyProfile, expectedShareAt, DEFAULT_THRESHOLDS,
} from '../core/metrics.js'
import { dayKey } from '../core/normalize.js'
import { nb, pct, eur, eurShort, minutes, heure, dateLongue, court, EMPTY, JOURS, libelleDPR } from '../format.js'
import { StatTile, Modal, DossierTable, Field, NumInput, Toast, exportCSV } from '../components/ui.jsx'
import { useDepanTime, effectifDuJour } from '../components/DepanTime.jsx'
import { VIZ, useWidth } from '../components/charts.jsx'

export default function Realtime({ interventions, history, settings, onSaveSettings, staffing, onSaveStaffing }) {
  const [now, setNow] = useState(new Date())
  // Rejouer une journée passée : le chef opérationnel revient souvent sur la
  // veille. L'horloge de référence se fige alors à la fin de cette journée.
  const [jourChoisi, setJourChoisi] = useState(null)
  const [drill, setDrill] = useState(null)
  const [reglages, setReglages] = useState(false)
  const [toast, setToast] = useState(null)
  const [seuils, setSeuils] = useState(settings.thresholds)

  useEffect(() => setSeuils(settings.thresholds), [settings.thresholds])

  // Une minute : assez fin pour un écran de pilotage, assez lâche pour ne
  // pas recalculer en permanence sur plusieurs milliers de lignes.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  const rejoue = !!jourChoisi && jourChoisi !== dayKey(new Date())
  const jour = jourChoisi || dayKey(now)
  // En rejeu, l'heure de référence est 23 h 59 du jour choisi : les
  // compteurs d'ancienneté racontent alors la journée entière.
  const ref = useMemo(() => {
    if (!rejoue) return now
    const [y, m, d] = jour.split('-').map(Number)
    return new Date(y, m - 1, d, 23, 59, 59)
  }, [rejoue, jour, now])

  const today = useMemo(() => interventions.filter((i) => i.dayKey === jour), [interventions, jour])
  const passe = useMemo(() => interventions.filter((i) => i.dayKey !== jour), [interventions, jour])

  // Effectif : la saisie manuelle prime, sinon on lit le pointage DepanTime.
  const dt = useDepanTime(settings)
  const [effectifDT, setEffectifDT] = useState(null)
  const [reprisEnCours, setReprisEnCours] = useState(false)

  useEffect(() => {
    setEffectifDT(null)
    if (!dt.disponible) return
    let vivant = true
    setReprisEnCours(true)
    effectifDuJour(dt.siteId, jour)
      .then((n) => vivant && setEffectifDT(n))
      .catch(() => vivant && setEffectifDT(null))
      .finally(() => vivant && setReprisEnCours(false))
    return () => { vivant = false }
  }, [dt.disponible, dt.siteId, jour])

  const saisiManuel = staffing?.headcount != null
  const enService = saisiManuel ? staffing.headcount : (effectifDT ?? 0)

  const c = useMemo(
    () => realtimeCounters(today, passe, { now: ref, thresholds: seuils, depanneursEnService: enService }),
    [today, passe, ref, seuils, enService]
  )

  const majSeuils = async (patch) => {
    const next = { ...seuils, ...patch }
    setSeuils(next)
    await onSaveSettings('thresholds', next)
  }

  const ton = (k) => (c[k].alerte ? 'danger' : 'ok')

  return (
    <div className="grid" style={{ gap: 20 }}>
      <header className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="md-h1">Temps réel</h1>
          <div className="md-small">
            {dateLongue(ref)} ·{' '}
            {rejoue ? 'journée rejouée' : `dernière actualisation ${heure(now)}`} ·{' '}
            {nb(today.length)} interventions
          </div>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 8 }}>
            <span className="md-label">Journée</span>
            <input type="date" value={jour} max={dayKey(new Date())}
              onChange={(e) => setJourChoisi(e.target.value || null)} />
          </label>
          <label className="row" style={{ gap: 8 }}>
            <span className="md-label">Dépanneurs en service</span>
            <input className="num" type="number" min="0" style={{ width: 70 }}
              value={enService || ''} placeholder={reprisEnCours ? '…' : '—'}
              onChange={(e) => onSaveStaffing(jour, Number(e.target.value) || 0)} />
            {effectifDT != null && !saisiManuel && (
              <span className="pill pill-ok" title="Compté depuis les relevés DepanTime">
                pointage
              </span>
            )}
            {effectifDT != null && saisiManuel && effectifDT !== staffing.headcount && (
              <span className="pill pill-warn"
                title={`Le pointage DepanTime en compte ${effectifDT}`}>
                pointage : {nb(effectifDT)}
              </span>
            )}
          </label>
          <button className="btn btn-ghost btn-sm" onClick={() => setReglages(true)}>Seuils d'alerte</button>
          <button className="btn btn-ghost btn-sm"
            onClick={() => { setJourChoisi(null); setNow(new Date()) }}>
            {rejoue ? "Revenir à aujourd'hui" : 'Actualiser'}
          </button>
        </div>
      </header>

      {rejoue && (
        <div className="callout-urgent">
          Journée du {dateLongue(ref)} rejouée. Les compteurs d'ancienneté sont calculés
          à la fin de cette journée, pas à l'heure actuelle.
        </div>
      )}

      {!today.length && !rejoue && (
        <div className="callout-urgent">
          Aucune intervention datée d'aujourd'hui dans les données importées.
          Choisir une autre journée ci-dessus pour consulter une date couverte par l'import.
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(232px, 1fr))' }}>
        <StatTile
          label={`Non affectés > ${seuils.nonAffecteMin} min`}
          value={nb(c.nonAffectes.value)}
          tone={ton('nonAffectes')}
          seuil={c.nonAffectes.seuil}
          sub="Dossiers appelés et jamais affectés à un dépanneur"
          onClick={() => setDrill({
            titre: `Dossiers non affectés depuis plus de ${seuils.nonAffecteMin} minutes`,
            items: c.nonAffectes.list,
            extra: [{
              key: 'attente', label: 'Attente', num: true,
              render: (it) => minutes((ref - (it.heureAppel || it.refDate)) / 60000),
              value: (it) => ref - (it.heureAppel || it.refDate),
            }],
          })}
        />

        <StatTile
          label={`Affectés sans arrivée > ${seuils.retardMin} min`}
          value={nb(c.enRetard.value)}
          tone={ton('enRetard')}
          seuil={c.enRetard.seuil}
          sub="Hors rendez-vous — le compte tourne depuis la première affectation"
          onClick={() => setDrill({
            titre: `Dossiers affectés sans horodatage d'arrivée depuis plus de ${seuils.retardMin} minutes`,
            sous: 'Les rendez-vous sont exclus.',
            items: c.enRetard.list,
            extra: [{
              key: 'ecoule', label: 'Écoulé', num: true,
              render: (it) => minutes((ref - it.dtPremiereAffectation) / 60000),
              value: (it) => ref - it.dtPremiereAffectation,
            }],
          })}
        />

        <StatTile
          label="Charge instantanée"
          value={c.charge.manqueSaisie ? EMPTY : nb(c.charge.value, 1)}
          tone={c.charge.manqueSaisie ? 'neutral' : ton('charge')}
          seuil={c.charge.seuil}
          sub={c.charge.manqueSaisie
            ? (dt.disponible
                ? "Aucun dépanneur pointé sur cette journée dans DepanTime"
                : "Saisir le nombre de dépanneurs en service (en haut à droite)")
            : `${nb(c.charge.ouverts)} dossiers ouverts / ${nb(enService)} dépanneurs`
              + (saisiManuel ? ' (saisie manuelle)' : ' (pointage DepanTime)')}
          onClick={() => setDrill({
            titre: 'Dossiers ouverts',
            sous: "Interventions sans horodatage de fin. Le nombre de dépanneurs en service est saisi manuellement ; il proviendra de l'applicatif de pointage.",
            items: c.charge.list,
            extra: [{
              key: 'depuis', label: 'Ouvert depuis', num: true,
              render: (it) => minutes((ref - (it.dtPremiereAffectation || it.refDate)) / 60000),
              value: (it) => ref - (it.dtPremiereAffectation || it.refDate),
            }],
          })}
        />

        <TrajectoireTile c={c.trajectoire} now={ref} passe={passe}
          onClick={() => setDrill({
            titre: 'Interventions facturables du jour',
            sous: `CA cumulé ${eur(c.trajectoire.value)} — trajectoire attendue ${eur(c.trajectoire.attendu)}`,
            items: c.trajectoire.list,
            extra: [{ key: 'totalHT', label: 'Total HT', num: true, render: (it) => eur(it.totalHT, 2) }],
          })} />

        <StatTile
          label="Anomalies du jour"
          value={nb(c.anomalies.value)}
          tone={ton('anomalies')}
          seuil={c.anomalies.seuil}
          sub="Photo manquante, géolocalisation non respectée, nuit ou week-end sans majoration"
          onClick={() => setDrill({
            titre: 'Anomalies du jour',
            items: c.anomalies.list,
            extra: [
              { key: 'raisons', label: 'Anomalie', render: (it) => it.raisons.join(' · ') },
              { key: 'totalHT', label: 'Total HT', num: true, render: (it) => eur(it.totalHT, 2) },
            ],
          })}
        />
      </div>

      <ProfilJour today={today} passe={passe} now={ref} trajectoire={c.trajectoire} />

      {drill && (
        <Modal title={drill.titre} subtitle={drill.sous} onClose={() => setDrill(null)} width={1040}
          footer={
            <>
              <span className="md-small">{nb(drill.items.length)} dossier(s)</span>
              <div className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(drill.items, 'cockpit')}>
                Exporter CSV
              </button>
              <button className="btn btn-primary" onClick={() => setDrill(null)}>Fermer</button>
            </>
          }>
          <DossierTable items={drill.items} extra={drill.extra || []} />
        </Modal>
      )}

      {reglages && (
        <Modal title="Seuils d'alerte" width={620} onClose={() => setReglages(false)}
          subtitle="Un compteur passe en alerte quand il atteint son seuil."
          footer={
            <>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { majSeuils(DEFAULT_THRESHOLDS); setToast('Seuils réinitialisés') }}>
                Valeurs par défaut
              </button>
              <div className="spacer" />
              <button className="btn btn-primary" onClick={() => { setReglages(false); setToast('Seuils enregistrés') }}>
                Fermer
              </button>
            </>
          }>
          <div className="grid" style={{ gap: 16 }}>
            <SeuilLigne titre="Dossiers non affectés"
              gauche={<Field label="Au-delà de"><NumInput value={seuils.nonAffecteMin} suffix="min"
                onChange={(v) => majSeuils({ nonAffecteMin: v })} /></Field>}
              droite={<Field label="Alerte à partir de"><NumInput value={seuils.nonAffecteAlerte} suffix="dossiers"
                onChange={(v) => majSeuils({ nonAffecteAlerte: v })} /></Field>} />

            <SeuilLigne titre="Affectés sans arrivée"
              gauche={<Field label="Au-delà de"><NumInput value={seuils.retardMin} suffix="min"
                onChange={(v) => majSeuils({ retardMin: v })} /></Field>}
              droite={<Field label="Alerte à partir de"><NumInput value={seuils.retardAlerte} suffix="dossiers"
                onChange={(v) => majSeuils({ retardAlerte: v })} /></Field>} />

            <SeuilLigne titre="Charge instantanée"
              gauche={<Field label="Alerte à partir de"><NumInput value={seuils.chargeAlerte} step={0.5}
                suffix="dossiers / dépanneur" width={80}
                onChange={(v) => majSeuils({ chargeAlerte: v })} /></Field>} />

            <SeuilLigne titre="Trajectoire du CA"
              gauche={<Field label="Alerte en dessous de"><NumInput value={seuils.trajectoireAlerte} suffix="% d'écart"
                onChange={(v) => majSeuils({ trajectoireAlerte: v })} /></Field>} />

            <SeuilLigne titre="Anomalies"
              gauche={<Field label="Alerte à partir de"><NumInput value={seuils.anomaliesAlerte} suffix="anomalies"
                onChange={(v) => majSeuils({ anomaliesAlerte: v })} /></Field>}
              droite={
                <div className="row" style={{ gap: 10 }}>
                  <Field label="Nuit de"><NumInput value={seuils.nuitDebut} suffix="h" width={60}
                    onChange={(v) => majSeuils({ nuitDebut: v })} /></Field>
                  <Field label="à"><NumInput value={seuils.nuitFin} suffix="h" width={60}
                    onChange={(v) => majSeuils({ nuitFin: v })} /></Field>
                </div>
              } />
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

function SeuilLigne({ titre, gauche, droite }) {
  return (
    <div style={{ borderTop: '1px solid var(--md-stone-100)', paddingTop: 12 }}>
      <div className="md-label" style={{ marginBottom: 8 }}>{titre}</div>
      <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>{gauche}{droite}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compteur 4 — CA du jour contre la trajectoire attendue
// ---------------------------------------------------------------------------

function TrajectoireTile({ c, now, passe, onClick }) {
  const enAvance = c.ecart != null && c.ecart >= 0
  const tone = c.manqueHistorique ? 'neutral' : c.alerte ? 'danger' : enAvance ? 'ok' : 'warn'
  return (
    <StatTile
      label="CA du jour / trajectoire"
      value={eurShort(c.value)}
      tone={tone}
      sub={
        c.manqueHistorique
          ? `Pas encore d'historique pour un ${JOURS[now.getDay()]}`
          : `Attendu à ${heure(now)} : ${eurShort(c.attendu)} · ${c.ecart >= 0 ? '+' : '−'}${pct(Math.abs(c.ecart))}`
      }
      footnote={c.manqueHistorique ? null : `profil médian sur ${nb(c.profilJours)} ${JOURS[now.getDay()]}s`}
      onClick={onClick}
      badge={
        !c.manqueHistorique && (
          <span className={`pill ${enAvance ? 'pill-ok' : 'pill-warn'}`}>
            {enAvance ? 'en avance' : 'en retard'}
          </span>
        )
      }
    />
  )
}

// ---------------------------------------------------------------------------
// Courbe du jour contre le profil horaire médian
// ---------------------------------------------------------------------------

function ProfilJour({ today, passe, now, trajectoire }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const h = 220
  const pad = { t: 16, r: 20, b: 30, l: 58 }
  const iw = Math.max(120, w - pad.l - pad.r)
  const ih = h - pad.t - pad.b

  const prof = useMemo(() => hourlyProfile(passe, now.getDay()), [passe, now])

  const reel = useMemo(() => {
    const cum = new Array(24).fill(0)
    for (const i of today) if (i.hour != null && !i.isGroupedBilling) cum[i.hour] += i.totalHT
    let acc = 0
    return cum.map((v) => (acc += v))
  }, [today])

  const heureCourante = now.getHours()

  if (!prof.profile) {
    return (
      <section className="card">
        <h3 className="md-h3">Trajectoire du chiffre d'affaires</h3>
        <div className="empty" style={{ padding: 30 }}>
          La trajectoire attendue se construit à partir du profil horaire médian des
          {' '}{JOURS[now.getDay()]}s précédents. Importer davantage d'historique pour l'afficher.
        </div>
      </section>
    )
  }

  const attendu = prof.profile.map((p) => p * prof.dailyTotal)
  const max = Math.max(...attendu, ...reel.slice(0, heureCourante + 1), 1)
  const x = (hh) => pad.l + (iw * hh) / 23
  const y = (v) => pad.t + ih - (v / max) * ih

  const ptsAttendu = attendu.map((v, i) => [x(i), y(v)])
  const ptsReel = reel.slice(0, heureCourante + 1).map((v, i) => [x(i), y(v)])

  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 4 }}>
        <div>
          <h3 className="md-h3">Trajectoire du chiffre d'affaires</h3>
          <div className="md-small">
            CA cumulé d'aujourd'hui comparé au profil horaire médian des {JOURS[now.getDay()]}s
            {' '}({nb(prof.days)} journée{prof.days > 1 ? 's' : ''} d'historique, jour type à {eur(prof.dailyTotal)})
          </div>
        </div>
      </div>

      <div ref={ref} style={{ position: 'relative', marginTop: 12 }}>
        <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
          {[0, max / 2, max].map((t, k) => (
            <g key={k}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke={VIZ.grid} strokeWidth="1" />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="10" fill={VIZ.muted}
                fontFamily="var(--font-mono)">{eurShort(t)}</text>
            </g>
          ))}

          <polyline points={ptsAttendu.map((p) => p.join(',')).join(' ')} fill="none"
            stroke={VIZ.info} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
          {ptsReel.length > 1 && (
            <polyline points={ptsReel.map((p) => p.join(',')).join(' ')} fill="none"
              stroke={VIZ.cat[0]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {ptsReel.length > 0 && (
            <circle cx={ptsReel[ptsReel.length - 1][0]} cy={ptsReel[ptsReel.length - 1][1]} r="5"
              fill={VIZ.cat[0]} stroke={VIZ.surface} strokeWidth="2" />
          )}

          <line x1={x(heureCourante)} x2={x(heureCourante)} y1={pad.t} y2={pad.t + ih}
            stroke={VIZ.axis} strokeWidth="1" />

          {Array.from({ length: 24 }, (_, hh) => hh % 3 === 0 && (
            <text key={hh} x={x(hh)} y={h - 8} textAnchor="middle" fontSize="10" fill={VIZ.muted}
              fontFamily="var(--font-mono)">{String(hh).padStart(2, '0')}h</text>
          ))}

          {Array.from({ length: 24 }, (_, hh) => (
            <rect key={`z${hh}`} x={x(hh) - iw / 46} y={pad.t} width={iw / 23} height={ih}
              fill="transparent" onMouseEnter={() => setHover(hh)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>

        {hover != null && (
          <div style={{
            position: 'absolute', left: Math.min(x(hover) + 12, w - 170), top: 10,
            background: '#fff', border: '1px solid var(--color-border)', borderRadius: 8,
            boxShadow: 'var(--shadow-lg)', padding: '8px 10px', pointerEvents: 'none', fontSize: 12,
          }}>
            <div style={{ fontWeight: 700 }}>{String(hover).padStart(2, '0')} h</div>
            <div style={{ fontFamily: 'var(--font-mono)' }}>attendu {eur(attendu[hover])}</div>
            {hover <= heureCourante && (
              <div style={{ fontFamily: 'var(--font-mono)', color: VIZ.cat[0] }}>réel {eur(reel[hover])}</div>
            )}
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 18, marginTop: 10 }}>
        <span className="row" style={{ gap: 6 }}>
          <svg width="18" height="4"><rect width="18" height="3" rx="1.5" fill={VIZ.cat[0]} /></svg>
          <span className="md-small">réalisé</span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <svg width="18" height="4"><rect width="7" height="3" rx="1.5" fill={VIZ.info} /><rect x="11" width="7" height="3" rx="1.5" fill={VIZ.info} /></svg>
          <span className="md-small">trajectoire attendue</span>
        </span>
      </div>
    </section>
  )
}
