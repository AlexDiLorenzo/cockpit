/**
 * ÉCRAN 2 — REVUE HEBDOMADAIRE
 * =========================================================================
 * Six indicateurs, chacun sur les huit dernières semaines, avec propriétaire
 * nommé et cible tracée. Plus la vue croisée SLA heure × jour de semaine.
 *
 * Le rituel : les actions du comité précédent en tête d'écran, les
 * indicateurs ensuite, les cibles et actions posées depuis l'écran.
 */

import { useState, useMemo, useEffect } from 'react'
import {
  sla, slaBy, slaHeatmap, delaiAcceptation, dprImputables, nonFactures,
  caParJourDepanneur, conformiteSaisie, series, lastWeekKeys, weekOf,
  INDICATORS, isoWeekKey, periodeDeRevue,
} from '../core/metrics.js'
import { isoWeekStart, dayKey } from '../core/normalize.js'
import {
  nb, pct, eur, eurShort, minutes, court, EMPTY, JOURS_COURT,
  libellePeriode, libellePeriodeLongue, libelleDPR, dateCourte,
} from '../format.js'
import { LineChart, BarsH, Heatmap, ChartCard, VIZ } from '../components/charts.jsx'
import {
  StatTile, Modal, DossierTable, ActionsBar, TargetButton, ExclusionNote,
  TargetBadge, Field, exportCSV, EmptyState,
} from '../components/ui.jsx'
import { useDepanTime, BoutonReprise } from '../components/DepanTime.jsx'

const SCREEN = 'weekly'
const NB_SEMAINES = 8

/** Les six indicateurs de la revue, dans l'ordre du cahier des charges. */
const CLES = ['delai_acceptation', 'sla', 'non_factures', 'dpr_imputables', 'ca_jour_depanneur', 'conformite']

export default function Weekly({
  interventions, settings, targets, actions, workedDays,
  onSaveTarget, onDeleteTarget, onAddAction, onPatchAction, onDeleteAction,
  onSaveSettings, onSaveWorkedDays, onPeriodChange,
}) {
  // La revue s'ouvre sur la dernière semaine entièrement couverte par les
  // données : un export s'arrêtant le lundi ne doit pas présenter au comité
  // une semaine de deux interventions.
  const [asOf, setAsOf] = useState(() => periodeDeRevue(interventions, 'week'))
  const [drill, setDrill] = useState(null)
  const [saisieJours, setSaisieJours] = useState(false)

  const dt = useDepanTime(settings)
  const semaines = useMemo(() => lastWeekKeys(NB_SEMAINES, asOf), [asOf])
  const semaineCourante = semaines[semaines.length - 1]

  // Bornes de la semaine affichée — la reprise DepanTime s'y cale.
  const bornes = useMemo(() => {
    const lundi = isoWeekStart(asOf)
    const dimanche = new Date(lundi)
    dimanche.setDate(dimanche.getDate() + 6)
    return { from: dayKey(lundi), to: dayKey(dimanche) }
  }, [asOf])
  const debutFenetre = useMemo(() => {
    const d = isoWeekStart(asOf)
    d.setDate(d.getDate() - (NB_SEMAINES - 1) * 7)
    return d
  }, [asOf])

  // Les jours travaillés sont stockés par semaine : prévenir la coquille
  // quand la revue change de semaine, pour qu'elle recharge la bonne saisie.
  useEffect(() => { onPeriodChange?.(semaineCourante) }, [semaineCourante])

  const fenetre = useMemo(
    () => interventions.filter((i) => i.refDate && i.refDate >= debutFenetre),
    [interventions, debutFenetre]
  )
  const courante = useMemo(
    () => fenetre.filter((i) => i.weekKey === semaineCourante),
    [fenetre, semaineCourante]
  )

  const cible = (k) => targets.find((t) => t.metric_key === k && !t.dimension)
  const proprio = (k) => cible(k)?.owner || settings.owners?.[k] || null

  const ctx = { asOf, workedDays }

  // Une série par indicateur, sur les huit semaines.
  const s = useMemo(() => {
    const out = {}
    for (const k of CLES) {
      const ind = INDICATORS[k]
      out[k] = series(fenetre, semaines, weekOf, (list) => ind.compute(list, ctx))
    }
    return out
  }, [fenetre, semaines, workedDays, asOf])

  const val = (k) => s[k][s[k].length - 1]

  if (!interventions.length) {
    return <EmptyState titre="Aucune donnée importée"
      texte="Importer un export PowerPanne pour alimenter la revue hebdomadaire." />
  }

  const fmtDe = (k) => {
    const i = INDICATORS[k]
    if (i.format === 'pct') return (v) => pct(v, 0)
    if (i.unit === 'min') return (v) => minutes(v)
    if (i.unit === '€') return (v) => eurShort(v)
    return (v) => nb(v)
  }

  const semaineNav = (delta) => {
    const d = new Date(asOf)
    d.setDate(d.getDate() + delta * 7)
    setAsOf(d)
  }

  return (
    <div className="grid" style={{ gap: 20 }}>
      <header className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="md-h1">Revue hebdomadaire</h1>
          <div className="md-small">
            {libellePeriodeLongue(semaineCourante)} · {nb(courante.length)} interventions ·
            {' '}série sur {NB_SEMAINES} semaines
          </div>
        </div>
        <div className="spacer" />
        <div className="row no-print" style={{ gap: 8 }}>
          <button className="btn btn-quiet btn-sm" onClick={() => semaineNav(-1)}>◀</button>
          <span className="md-mono" style={{ minWidth: 96, textAlign: 'center' }}>{semaineCourante}</span>
          <button className="btn btn-quiet btn-sm" onClick={() => semaineNav(1)}
            disabled={isoWeekKey(asOf) >= isoWeekKey(new Date())}>▶</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSaisieJours(true)}>Jours travaillés</button>
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>Imprimer</button>
        </div>
      </header>

      <ActionsBar
        actions={actions} periodKey={semaineCourante} screen={SCREEN}
        onAdd={onAddAction} onPatch={onPatchAction} onDelete={onDeleteAction}
        indicateurs={Object.fromEntries(CLES.map((k) => [k, INDICATORS[k]]))}
      />

      {/* ---- 1. Délai d'acceptation ------------------------------------ */}
      <IndicCard
        mkey="delai_acceptation" data={s.delai_acceptation} target={cible('delai_acceptation')}
        owner={proprio('delai_acceptation')} fmt={fmtDe('delai_acceptation')}
        onSaveTarget={onSaveTarget} onDeleteTarget={onDeleteTarget}
        sous="Acceptation (mobile) moins première affectation, médiane de la semaine"
        note={<ExclusionNote n={val('delai_acceptation').n} excluded={val('delai_acceptation').excluded} quoi="interventions" />}
        extra={
          <div className="grid" style={{ gap: 10, marginTop: 14 }}>
            <Chiffre label="Moyenne" valeur={minutes(val('delai_acceptation').moyenne)} />
            <Chiffre label="9 dossiers sur 10 sous" valeur={minutes(val('delai_acceptation').p90)} />
          </div>
        }
      />

      {/* ---- 2. SLA ----------------------------------------------------- */}
      <SlaCard
        serie={s.sla} courante={courante} target={cible('sla')} owner={proprio('sla')}
        onSaveTarget={onSaveTarget} onDeleteTarget={onDeleteTarget} onDrill={setDrill}
      />

      {/* ---- 3. Dossiers non facturés ----------------------------------- */}
      <NonFacturesCard
        serie={s.non_factures} fenetre={fenetre} asOf={asOf}
        target={cible('non_factures')} owner={proprio('non_factures')}
        onSaveTarget={onSaveTarget} onDeleteTarget={onDeleteTarget} onDrill={setDrill}
      />

      {/* ---- 4. DPR imputables ------------------------------------------ */}
      <IndicCard
        mkey="dpr_imputables" data={s.dpr_imputables} target={cible('dpr_imputables')}
        owner={proprio('dpr_imputables')} fmt={fmtDe('dpr_imputables')}
        onSaveTarget={onSaveTarget} onDeleteTarget={onDeleteTarget}
        sous="Matériel inapproprié ou véhicule non trouvé — les annulations client sont exclues"
        note={
          <span className="md-small">
            {nb(val('dpr_imputables').annulationsClient)} annulation(s) client écartée(s) cette semaine ·{' '}
            {val('dpr_imputables').parRaison.map((r) => `${libelleDPR(r.raison)} : ${r.count}`).join(' · ')}
          </span>
        }
        onClick={() => setDrill({
          titre: 'DPR imputables de la semaine',
          items: val('dpr_imputables').list,
          extra: [{ key: 'raisonDPR', label: 'Raison', render: (it) => libelleDPR(it.raisonDPR) }],
        })}
      />

      {/* ---- 5. CA par jour-dépanneur ----------------------------------- */}
      <CaJourCard
        serie={s.ca_jour_depanneur} courante={courante} workedDays={workedDays}
        target={cible('ca_jour_depanneur')} owner={proprio('ca_jour_depanneur')}
        onSaveTarget={onSaveTarget} onDeleteTarget={onDeleteTarget}
        onSaisie={() => setSaisieJours(true)}
      />

      {/* ---- 6. Conformité de saisie ------------------------------------ */}
      <ConformiteCard
        serie={s.conformite} courante={courante}
        target={cible('conformite')} owner={proprio('conformite')}
        onSaveTarget={onSaveTarget} onDeleteTarget={onDeleteTarget} onDrill={setDrill}
      />

      {/* ---- Vue complémentaire : SLA heure × jour ----------------------- */}
      <HeatmapCard fenetre={fenetre} target={cible('sla')} onDrill={setDrill} />

      {drill && (
        <Modal title={drill.titre} subtitle={drill.sous} onClose={() => setDrill(null)} width={1040}
          footer={
            <>
              <span className="md-small">{nb(drill.items.length)} dossier(s)</span>
              <div className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(drill.items, 'hebdo')}>Exporter CSV</button>
              <button className="btn btn-primary" onClick={() => setDrill(null)}>Fermer</button>
            </>
          }>
          <DossierTable items={drill.items} extra={drill.extra || []} />
        </Modal>
      )}

      {saisieJours && (
        <SaisieJoursTravailles
          periode={semaineCourante} interventions={courante} workedDays={workedDays}
          onSave={onSaveWorkedDays} onClose={() => setSaisieJours(false)}
          dt={dt} settings={settings} bornes={bornes} onSaveSettings={onSaveSettings}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Briques
// ---------------------------------------------------------------------------

function Chiffre({ label, valeur, tone }) {
  return (
    <div>
      <div className="md-label">{label}</div>
      <div className="md-mono-lg" style={{ color: tone }}>{valeur}</div>
    </div>
  )
}

function EnTete({ mkey, target, owner, onSaveTarget, onDeleteTarget, fmt, value }) {
  const ind = INDICATORS[mkey]
  return (
    <div className="row" style={{ gap: 8 }}>
      {owner && <span className="pill pill-neutral">{owner}</span>}
      <TargetBadge value={value} target={target?.value != null ? Number(target.value) : null}
        better={ind.better} format={fmt} />
      <TargetButton indicateur={ind} metricKey={mkey} screen={SCREEN} target={target}
        onSave={onSaveTarget} onDelete={onDeleteTarget} format={fmt} />
    </div>
  )
}

/** Carte générique : une courbe sur huit semaines, une cible, un propriétaire. */
function IndicCard({ mkey, data, target, owner, fmt, sous, note, extra, onClick, onSaveTarget, onDeleteTarget }) {
  const ind = INDICATORS[mkey]
  const derniere = data[data.length - 1]
  const cibleVal = target?.value != null ? Number(target.value) : null

  return (
    <ChartCard
      title={ind.label}
      subtitle={sous}
      right={<EnTete mkey={mkey} target={target} owner={owner} fmt={fmt} value={derniere?.value}
        onSaveTarget={onSaveTarget} onDeleteTarget={onDeleteTarget} />}
      note={note}
      table={{
        columns: [
          { key: 'period', label: 'Semaine', render: (r) => r.period },
          { key: 'value', label: ind.label, num: true, render: (r) => fmt(r.value) },
          { key: 'count', label: 'Interventions', num: true, render: (r) => nb(r.count) },
          { key: 'excluded', label: 'Écartées', num: true, render: (r) => nb(r.excluded || 0) },
        ],
        rows: data,
      }}
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
        <div style={{ minWidth: 150 }}>
          <div className="md-label">Cette semaine</div>
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            {fmt(derniere?.value)}
          </div>
          {onClick && (
            <button className="btn btn-quiet btn-sm no-print" style={{ paddingLeft: 0 }} onClick={onClick}>
              Voir les dossiers →
            </button>
          )}
          {extra}
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <LineChart data={data} target={cibleVal} fmt={fmt} better={ind.better}
            labelPeriod={libellePeriode} />
        </div>
      </div>
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// 2 — SLA, global puis par origine d'appel
// ---------------------------------------------------------------------------

function SlaCard({ serie, courante, target, owner, onSaveTarget, onDeleteTarget, onDrill }) {
  const fmt = (v) => pct(v, 0)
  const derniere = serie[serie.length - 1]
  const cibleVal = target?.value != null ? Number(target.value) : null
  const parOrigine = useMemo(
    () => slaBy(courante, (i) => i.origine).filter((r) => r.n >= 5).slice(0, 12),
    [courante]
  )

  return (
    <ChartCard
      title="SLA — arrivée en 45 minutes ou moins"
      subtitle="Les interventions marquées Rendez-vous sont exclues du périmètre"
      right={<EnTete mkey="sla" target={target} owner={owner} fmt={fmt} value={derniere?.value}
        onSaveTarget={onSaveTarget} onDeleteTarget={onDeleteTarget} />}
      note={
        <span className="md-small">
          {nb(derniere?.n)} interventions dans le périmètre ·{' '}
          {nb(derniere?.rendezVousExclus)} rendez-vous exclus ·{' '}
          <span style={{ color: 'var(--md-signal-800)', fontWeight: 600 }}>{nb(derniere?.excluded)} écartées</span>{' '}
          (délai négatif ou supérieur à 24 h)
        </span>
      }
      table={{
        columns: [
          { key: 'period', label: 'Semaine' },
          { key: 'value', label: 'SLA', num: true, render: (r) => pct(r.value) },
          { key: 'ok', label: 'Dans les temps', num: true, render: (r) => nb(r.ok) },
          { key: 'n', label: 'Périmètre', num: true, render: (r) => nb(r.n) },
        ],
        rows: serie,
      }}
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
        <div style={{ minWidth: 150 }}>
          <div className="md-label">Cette semaine</div>
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            {pct(derniere?.value, 0)}
          </div>
          <div className="md-small">{nb(derniere?.ok)} / {nb(derniere?.n)} dans les temps</div>
          <button className="btn btn-quiet btn-sm no-print" style={{ paddingLeft: 0 }}
            onClick={() => onDrill({
              titre: 'Interventions hors SLA cette semaine',
              sous: 'Arrivée au-delà de 45 minutes après la première affectation, hors rendez-vous.',
              items: derniere?.hors || [],
              extra: [
                { key: 'delai', label: 'Délai', num: true, render: (it) => minutes(it.delaiArriveeMin), value: (it) => it.delaiArriveeMin },
                { key: 'origine', label: "Origine d'appel", render: (it) => court(it.origine, 26) },
              ],
            })}>
            Voir les {nb((derniere?.n || 0) - (derniere?.ok || 0))} dossiers hors délai →
          </button>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <LineChart data={serie} target={cibleVal} fmt={fmt} better="higher" labelPeriod={libellePeriode} />
        </div>
      </div>

      <div style={{ marginTop: 20, borderTop: '1px solid var(--md-stone-100)', paddingTop: 16 }}>
        <div className="md-label" style={{ marginBottom: 10 }}>
          Décliné par origine d'appel — semaine en cours, conventions d'au moins 5 interventions
        </div>
        <BarsH
          data={parOrigine.map((r) => ({
            key: r.key,
            label: court(r.key, 30),
            value: r.value,
            color: cibleVal != null && r.value < cibleVal ? VIZ.danger : VIZ.cat[0],
            tooltip: <><div style={{ fontWeight: 700 }}>{r.key}</div><div>{nb(r.ok)}/{nb(r.n)} dans les temps</div></>,
          }))}
          fmt={(v) => pct(v, 0)} max={1} labelWidth={230}
          sub={(d) => `n=${parOrigine.find((r) => r.key === d.key)?.n ?? 0}`}
        />
      </div>
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// 3 — Dossiers non facturés depuis plus de 7 jours
// ---------------------------------------------------------------------------

function NonFacturesCard({ serie, fenetre, asOf, target, owner, onSaveTarget, onDeleteTarget, onDrill }) {
  const fmt = (v) => nb(v)
  const derniere = serie[serie.length - 1]
  const global = useMemo(() => nonFactures(fenetre, { minDays: 7, asOf }), [fenetre, asOf])
  const cibleVal = target?.value != null ? Number(target.value) : null

  return (
    <ChartCard
      title="Dossiers non facturés depuis plus de 7 jours"
      subtitle="Date de facturation vide, intervention datant de plus d'une semaine"
      right={<EnTete mkey="non_factures" target={target} owner={owner} fmt={fmt} value={derniere?.value}
        onSaveTarget={onSaveTarget} onDeleteTarget={onDeleteTarget} />}
      note={<span className="md-small">
        La courbe compte les dossiers dont l'intervention a eu lieu la semaine considérée et qui restent
        non facturés à ce jour. L'encours ci-contre porte sur les {NB_SEMAINES} semaines affichées.
      </span>}
      table={{
        columns: [
          { key: 'key', label: "Origine d'appel" },
          { key: 'count', label: 'Dossiers', num: true, render: (r) => nb(r.count) },
          { key: 'amount', label: 'Montant HT', num: true, render: (r) => eur(r.amount) },
        ],
        rows: global.byOrigine,
      }}
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
        <div style={{ minWidth: 170 }}>
          <div className="md-label">Encours total</div>
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            {eurShort(global.amount)}
          </div>
          <div className="md-small">{nb(global.value)} dossiers</div>
          <button className="btn btn-quiet btn-sm no-print" style={{ paddingLeft: 0 }}
            onClick={() => onDrill({
              titre: 'Dossiers non facturés depuis plus de 7 jours',
              items: global.list,
              extra: [
                { key: 'origine', label: 'Origine', render: (it) => court(it.origine, 24) },
                { key: 'totalHT', label: 'Montant HT', num: true, render: (it) => eur(it.totalHT, 2) },
                { key: 'age', label: 'Ancienneté', num: true,
                  render: (it) => `${Math.floor((asOf - it.refDate) / 86400000)} j`,
                  value: (it) => asOf - it.refDate },
              ],
            })}>
            Voir les dossiers →
          </button>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <LineChart data={serie} target={cibleVal} fmt={fmt} better="lower" labelPeriod={libellePeriode} />
        </div>
      </div>

      <div style={{ marginTop: 20, borderTop: '1px solid var(--md-stone-100)', paddingTop: 16 }}>
        <div className="md-label" style={{ marginBottom: 10 }}>Encours par origine d'appel</div>
        <BarsH
          data={global.byOrigine.slice(0, 10).map((o) => ({
            key: o.key, label: court(o.key, 30), value: o.amount,
            tooltip: <><div style={{ fontWeight: 700 }}>{o.key}</div><div>{nb(o.count)} dossiers · {eur(o.amount)}</div></>,
          }))}
          fmt={(v) => eurShort(v)} labelWidth={230}
          sub={(d) => `${nb(global.byOrigine.find((o) => o.key === d.key)?.count ?? 0)} doss.`}
        />
      </div>
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// 5 — CA par jour-dépanneur
// ---------------------------------------------------------------------------

function CaJourCard({ serie, courante, workedDays, target, owner, onSaveTarget, onDeleteTarget, onSaisie }) {
  const fmt = (v) => eurShort(v)
  const derniere = serie[serie.length - 1]
  const cibleVal = target?.value != null ? Number(target.value) : null
  const classement = (derniere?.classement || []).filter((d) => !d.manqueSaisie)
  const sansSaisie = (derniere?.classement || []).filter((d) => d.manqueSaisie)

  return (
    <ChartCard
      title="CA par jour-dépanneur"
      subtitle="Le nombre de jours travaillés est saisi manuellement ; il proviendra de l'applicatif de pointage"
      right={
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm no-print" onClick={onSaisie}>Saisir les jours</button>
          <EnTete mkey="ca_jour_depanneur" target={target} owner={owner} fmt={fmt} value={derniere?.value}
            onSaveTarget={onSaveTarget} onDeleteTarget={onDeleteTarget} />
        </div>
      }
      note={
        sansSaisie.length
          ? <span className="md-small" style={{ color: 'var(--md-signal-800)', fontWeight: 600 }}>
              {nb(sansSaisie.length)} dépanneur(s) sans jours saisis — exclus du calcul :{' '}
              {sansSaisie.slice(0, 6).map((d) => d.key).join(', ')}{sansSaisie.length > 6 ? '…' : ''}
            </span>
          : <span className="md-small">{nb(derniere?.totalJours)} jours-dépanneur saisis cette semaine</span>
      }
      table={{
        columns: [
          { key: 'key', label: 'Dépanneur' },
          { key: 'caParJour', label: 'CA / jour', num: true, render: (r) => eur(r.caParJour) },
          { key: 'ca', label: 'CA semaine', num: true, render: (r) => eur(r.ca) },
          { key: 'jours', label: 'Jours', num: true, render: (r) => nb(r.jours) },
          { key: 'interventions', label: 'Interventions', num: true, render: (r) => nb(r.interventions) },
        ],
        rows: derniere?.classement || [],
      }}
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
        <div style={{ minWidth: 170 }}>
          <div className="md-label">Cette semaine</div>
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            {derniere?.value != null ? eur(derniere.value) : EMPTY}
          </div>
          <div className="md-small">{eurShort(derniere?.totalCA)} sur {nb(derniere?.totalJours)} jours</div>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <LineChart data={serie} target={cibleVal} fmt={fmt} better="higher" labelPeriod={libellePeriode} />
        </div>
      </div>

      {classement.length > 0 && (
        <div style={{ marginTop: 20, borderTop: '1px solid var(--md-stone-100)', paddingTop: 16 }}>
          <div className="md-label" style={{ marginBottom: 10 }}>Classement des dépanneurs — CA par jour travaillé</div>
          <BarsH
            data={classement.slice(0, 15).map((d) => ({
              key: d.key, label: d.key, value: d.caParJour,
              color: cibleVal != null && d.caParJour < cibleVal ? VIZ.danger : VIZ.cat[0],
              tooltip: <><div style={{ fontWeight: 700 }}>{d.key}</div>
                <div>{eur(d.ca)} sur {nb(d.jours)} jour(s) · {nb(d.interventions)} interventions</div></>,
            }))}
            fmt={(v) => eur(v)} labelWidth={190}
            sub={(d) => `${nb(classement.find((x) => x.key === d.key)?.jours ?? 0)} j`}
          />
        </div>
      )}
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// 6 — Conformité de saisie
// ---------------------------------------------------------------------------

function ConformiteCard({ serie, courante, target, owner, onSaveTarget, onDeleteTarget, onDrill }) {
  const fmt = (v) => pct(v, 0)
  const derniere = serie[serie.length - 1]
  const cibleVal = target?.value != null ? Number(target.value) : null
  const lignes = (derniere?.lignes || []).filter((l) => l.n >= 3)

  return (
    <ChartCard
      title="Conformité de saisie"
      subtitle="Photos prises, scénario de géolocalisation respecté, compte rendu d'opération envoyé"
      right={<EnTete mkey="conformite" target={target} owner={owner} fmt={fmt} value={derniere?.value}
        onSaveTarget={onSaveTarget} onDeleteTarget={onDeleteTarget} />}
      note={<span className="md-small">
        Moyenne des trois critères. Les dépanneurs comptant moins de 3 interventions dans la
        semaine ne sont pas classés.
      </span>}
      table={{
        columns: [
          { key: 'key', label: 'Dépanneur' },
          { key: 'photos', label: 'Photos', num: true, render: (r) => pct(r.photos, 0) },
          { key: 'geo', label: 'Géoloc.', num: true, render: (r) => pct(r.geo, 0) },
          { key: 'cro', label: 'CRO', num: true, render: (r) => pct(r.cro, 0) },
          { key: 'global', label: 'Global', num: true, render: (r) => pct(r.global, 0) },
          { key: 'n', label: 'Interv.', num: true, render: (r) => nb(r.n) },
        ],
        rows: derniere?.lignes || [],
      }}
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
        <div style={{ minWidth: 170 }}>
          <div className="md-label">Cette semaine</div>
          <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            {pct(derniere?.value, 0)}
          </div>
          <div className="grid" style={{ gap: 4, marginTop: 8 }}>
            <Critere label="Photos" v={derniere?.photos} />
            <Critere label="Géolocalisation" v={derniere?.geo} />
            <Critere label="Envoi du CRO" v={derniere?.cro} />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <LineChart data={serie} target={cibleVal} fmt={fmt} better="higher" labelPeriod={libellePeriode} />
        </div>
      </div>

      {lignes.length > 0 && (
        <div style={{ marginTop: 20, borderTop: '1px solid var(--md-stone-100)', paddingTop: 16 }}>
          <div className="md-label" style={{ marginBottom: 10 }}>
            Par dépanneur — les moins conformes en premier
          </div>
          <BarsH
            data={lignes.slice(0, 15).map((l) => ({
              key: l.key, label: l.key, value: l.global,
              color: cibleVal != null && l.global < cibleVal ? VIZ.danger : VIZ.cat[0],
              tooltip: <><div style={{ fontWeight: 700 }}>{l.key}</div>
                <div>photos {pct(l.photos, 0)} · géoloc {pct(l.geo, 0)} · CRO {pct(l.cro, 0)}</div>
                <div className="md-small">{nb(l.n)} interventions</div></>,
            }))}
            fmt={(v) => pct(v, 0)} max={1} labelWidth={190}
            sub={(d) => `n=${lignes.find((l) => l.key === d.key)?.n ?? 0}`}
          />
        </div>
      )}
    </ChartCard>
  )
}

function Critere({ label, v }) {
  return (
    <div className="row" style={{ gap: 8, fontSize: 12 }}>
      <span style={{ minWidth: 110, color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="md-mono" style={{ fontWeight: 600 }}>{pct(v, 0)}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vue complémentaire — SLA heure × jour
// ---------------------------------------------------------------------------

function HeatmapCard({ fenetre, target, onDrill }) {
  const [minN, setMinN] = useState(5)
  const grid = useMemo(() => slaHeatmap(fenetre), [fenetre])
  const centre = target?.value != null ? Number(target.value) : 0.7

  const creneaux = useMemo(() => {
    const out = []
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
      const c = grid[d][h]
      if (c.n >= minN && c.value != null) out.push({ d, h, ...c })
    }
    return out.sort((a, b) => a.value - b.value)
  }, [grid, minN])

  return (
    <ChartCard
      title="SLA croisé heure × jour de semaine"
      subtitle={`Sur les ${NB_SEMAINES} semaines affichées — repère la cible ou 70 % à défaut`}
      right={
        <label className="row no-print" style={{ gap: 6 }}>
          <span className="md-label">Minimum</span>
          <input className="num" type="number" min="1" style={{ width: 56 }} value={minN}
            onChange={(e) => setMinN(Math.max(1, Number(e.target.value) || 1))} />
          <span className="md-small">interv.</span>
        </label>
      }
      note="Cliquer une case ouvre les interventions du créneau. Les cases plus claires que le repère signalent les créneaux sous-armés."
      table={{
        columns: [
          { key: 'creneau', label: 'Créneau', render: (r) => `${JOURS_COURT[r.d]} ${String(r.h).padStart(2, '0')} h` },
          { key: 'value', label: 'SLA', num: true, render: (r) => pct(r.value) },
          { key: 'ok', label: 'Dans les temps', num: true, render: (r) => nb(r.ok) },
          { key: 'n', label: 'Interventions', num: true, render: (r) => nb(r.n) },
        ],
        rows: creneaux,
      }}
    >
      <Heatmap grid={grid} center={centre} jours={JOURS_COURT} minN={minN}
        onCell={(d, h, c) => onDrill({
          titre: `SLA ${JOURS_COURT[d]} ${String(h).padStart(2, '0')} h — ${pct(c.value)}`,
          sous: `${nb(c.ok)} interventions dans les temps sur ${nb(c.n)}, hors rendez-vous`,
          items: fenetre.filter((i) => i.weekday === d && i.hour === h && !i.rendezVous && i.delaiArriveeValide),
          extra: [
            { key: 'delai', label: 'Délai', num: true, render: (it) => minutes(it.delaiArriveeMin), value: (it) => it.delaiArriveeMin },
            { key: 'origine', label: 'Origine', render: (it) => court(it.origine, 24) },
          ],
        })} />

      {creneaux.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="md-label" style={{ marginBottom: 8 }}>Cinq créneaux les plus faibles</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {creneaux.slice(0, 5).map((c) => (
              <span key={`${c.d}-${c.h}`} className="pill pill-danger">
                {JOURS_COURT[c.d]} {String(c.h).padStart(2, '0')} h · {pct(c.value, 0)} · n={c.n}
              </span>
            ))}
          </div>
        </div>
      )}
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// Saisie des jours travaillés
// ---------------------------------------------------------------------------

function SaisieJoursTravailles({
  periode, interventions, workedDays, onSave, onClose,
  dt, settings, bornes, onSaveSettings,
}) {
  const depanneurs = useMemo(
    () => [...new Set(interventions.map((i) => i.depanneur).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')),
    [interventions]
  )
  const [vals, setVals] = useState(() => Object.fromEntries(depanneurs.map((d) => [d, workedDays[d] ?? ''])))

  return (
    <Modal
      title="Jours travaillés" width={720}
      subtitle={`${libellePeriodeLongue(periode)} — saisie manuelle en attendant la reprise depuis l'applicatif de pointage`}
      onClose={onClose}
      footer={
        <>
          <BoutonReprise
            dt={dt} settings={settings} from={bornes.from} to={bornes.to}
            depanneurs={depanneurs} quoi="jours" onSaveSettings={onSaveSettings}
            onAppliquer={(valeurs) => {
              const next = { ...vals }
              for (const [nom, v] of Object.entries(valeurs)) next[nom] = v.jours
              setVals(next)
            }}
          />
          <button className="btn btn-quiet btn-sm"
            onClick={() => setVals(Object.fromEntries(depanneurs.map((d) => [d, 5])))}>
            Tout à 5 jours
          </button>
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={() => {
            const clean = Object.fromEntries(
              Object.entries(vals).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)])
            )
            onSave(periode, clean)
            onClose()
          }}>Enregistrer</button>
        </>
      }
    >
      <table className="md-table">
        <thead>
          <tr><th>Dépanneur</th><th className="num">Interventions</th><th className="num">CA</th><th className="num">Jours travaillés</th></tr>
        </thead>
        <tbody>
          {depanneurs.map((d) => {
            const l = interventions.filter((i) => i.depanneur === d)
            return (
              <tr key={d}>
                <td>{d}</td>
                <td className="num">{nb(l.length)}</td>
                <td className="num">{eur(l.reduce((s, i) => s + i.totalHT, 0))}</td>
                <td className="num">
                  <input className="num" type="number" min="0" max="7" step="0.5" style={{ width: 70 }}
                    value={vals[d] ?? ''} placeholder="—"
                    onChange={(e) => setVals({ ...vals, [d]: e.target.value })} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Modal>
  )
}
