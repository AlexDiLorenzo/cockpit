/**
 * ÉCRAN 3 — REVUE MENSUELLE
 * =========================================================================
 * Même rituel que l'hebdomadaire, objet différent : l'économie plutôt que
 * l'exécution.
 *
 * Le calcul de marge repose sur des coûts absents de l'export. Ils sont
 * saisis dans l'application et **chaque marge affichée rappelle sur quels
 * paramètres elle repose** — l'encart « Base de calcul » n'est pas
 * décoratif, c'est ce qui rend le chiffre discutable en séance.
 */

import { useState, useMemo } from 'react'
import {
  caOperationnel, margeAgregee, margeParOrigine, rendementParVehicule,
  coutDesPertes, mixActivite, caParHeurePayee, margeBasis, dureeMin,
  series, lastMonthKeys, monthOf, INDICATORS, DEFAULT_COSTS, groupBy, sum, mean,
  periodeDeRevue,
} from '../core/metrics.js'
import { monthKey, dayKey } from '../core/normalize.js'
import {
  nb, pct, eur, eurShort, minutes, court, EMPTY, MOIS,
  libellePeriode, libellePeriodeLongue, libelleDPR,
} from '../format.js'
import { LineChart, BarsH, StackedBar, ChartCard, VIZ } from '../components/charts.jsx'
import {
  StatTile, Modal, DossierTable, ActionsBar, TargetButton, TargetBadge,
  Field, NumInput, exportCSV, EmptyState, Toast,
} from '../components/ui.jsx'
import { useDepanTime, BoutonReprise } from '../components/DepanTime.jsx'

const SCREEN = 'monthly'
const NB_MOIS = 12

const CLES = ['ca_operationnel', 'marge_intervention', 'ca_heure_payee', 'taux_marge', 'cout_pertes']

export default function Monthly({
  interventions, grouped, settings, targets, actions,
  onSaveTarget, onDeleteTarget, onAddAction, onPatchAction, onDeleteAction, onSaveSettings,
}) {
  // Ouvre sur le dernier mois entièrement couvert par les données.
  const [asOf, setAsOf] = useState(() => periodeDeRevue(interventions, 'month'))
  const [drill, setDrill] = useState(null)
  const [editCouts, setEditCouts] = useState(false)
  const [toast, setToast] = useState(null)

  const dt = useDepanTime(settings)
  const mois = useMemo(() => lastMonthKeys(NB_MOIS, asOf), [asOf])
  const moisCourant = mois[mois.length - 1]

  // Bornes du mois affiché — la reprise DepanTime s'y cale.
  const bornes = useMemo(() => {
    const [y, m] = moisCourant.split('-').map(Number)
    return { from: dayKey(new Date(y, m - 1, 1)), to: dayKey(new Date(y, m, 0)) }
  }, [moisCourant])

  const costs = { ...DEFAULT_COSTS, ...settings.costs }
  const heuresPayees = costs.heuresPayees?.[moisCourant] ?? 0

  const courant = useMemo(
    () => interventions.filter((i) => i.monthKey === moisCourant),
    [interventions, moisCourant]
  )
  const groupeCourant = useMemo(
    () => (grouped || []).filter((i) => i.monthKey === moisCourant),
    [grouped, moisCourant]
  )

  const ctx = { costs, heuresPayees }

  const s = useMemo(() => {
    const out = {}
    for (const k of CLES) {
      out[k] = series(interventions, mois, monthOf, (list) =>
        INDICATORS[k].compute(list, {
          costs,
          heuresPayees: costs.heuresPayees?.[list[0]?.monthKey] ?? 0,
        })
      )
    }
    return out
  }, [interventions, mois, settings.costs])

  const ca = useMemo(() => caOperationnel(courant), [courant])
  const marge = useMemo(() => margeAgregee(courant, costs), [courant, settings.costs])
  const parOrigine = useMemo(() => margeParOrigine(courant, costs), [courant, settings.costs])
  const vehicules = useMemo(() => rendementParVehicule(courant, costs), [courant, settings.costs])
  const pertes = useMemo(
    () => coutDesPertes(courant, costs, { nuitDebut: settings.thresholds.nuitDebut, nuitFin: settings.thresholds.nuitFin }),
    [courant, settings.costs, settings.thresholds]
  )
  const mix = useMemo(() => mixActivite(courant), [courant])
  const cahp = useMemo(() => caParHeurePayee(courant, heuresPayees), [courant, heuresPayees])

  const cible = (k) => targets.find((t) => t.metric_key === k && !t.dimension)
  const proprio = (k) => cible(k)?.owner || settings.owners?.[k] || null

  if (!interventions.length) {
    return <EmptyState titre="Aucune donnée importée"
      texte="Importer un export PowerPanne pour alimenter la revue mensuelle." />
  }

  const moisNav = (d) => {
    const x = new Date(asOf)
    x.setMonth(x.getMonth() + d)
    setAsOf(x)
  }

  const majCouts = async (patch) => {
    const next = { ...costs, ...patch }
    await onSaveSettings('costs', next)
  }

  return (
    <div className="grid" style={{ gap: 20 }}>
      <header className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="md-h1">Revue mensuelle</h1>
          <div className="md-small">
            {libellePeriodeLongue(moisCourant)} · {nb(courant.length)} interventions ·
            {' '}série sur {NB_MOIS} mois
          </div>
        </div>
        <div className="spacer" />
        <div className="row no-print" style={{ gap: 8 }}>
          <button className="btn btn-quiet btn-sm" onClick={() => moisNav(-1)}>◀</button>
          <span className="md-mono" style={{ minWidth: 96, textAlign: 'center' }}>
            {MOIS[Number(moisCourant.split('-')[1]) - 1].slice(0, 4)}. {moisCourant.split('-')[0].slice(2)}
          </span>
          <button className="btn btn-quiet btn-sm" onClick={() => moisNav(1)}
            disabled={monthKey(asOf) >= monthKey(new Date())}>▶</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditCouts(true)}>Paramètres de coût</button>
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>Imprimer</button>
        </div>
      </header>

      <ActionsBar
        actions={actions} periodKey={moisCourant} screen={SCREEN}
        onAdd={onAddAction} onPatch={onPatchAction} onDelete={onDeleteAction}
        indicateurs={Object.fromEntries(CLES.map((k) => [k, INDICATORS[k]]))}
      />

      {/* ---- 1. Économie du mois ---------------------------------------- */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(232px, 1fr))' }}>
        <StatTile label="CA opérationnel" value={eurShort(ca.value)} hero
          sub={`${nb(ca.n)} interventions · panier moyen ${eur(ca.panierMoyen)}`}
          spark={s.ca_operationnel}
          footnote={groupeCourant.length
            ? `${nb(groupeCourant.length)} ligne(s) de facturation groupée isolée(s)`
            : null}
          onClick={() => setDrill({
            titre: `Interventions de ${libellePeriodeLongue(moisCourant)}`,
            items: courant,
            extra: [{ key: 'totalHT', label: 'Total HT', num: true, render: (it) => eur(it.totalHT, 2) }],
          })} />

        <StatTile label="Marge par intervention" value={eur(marge.margeParIntervention)}
          tone={marge.margeParIntervention > 0 ? 'ok' : 'danger'}
          sub={`Marge totale ${eurShort(marge.value)} · taux ${pct(marge.tauxMarge)}`}
          spark={s.marge_intervention}
          footnote={marge.excluded ? `${nb(marge.excluded)} sans durée exploitable` : null} />

        <StatTile label="CA par heure payée" value={cahp.manqueSaisie ? EMPTY : eur(cahp.value)}
          tone={cahp.manqueSaisie ? 'neutral' : 'ok'}
          sub={cahp.manqueSaisie
            ? 'Saisir les heures payées du mois dans les paramètres de coût'
            : `${eurShort(cahp.ca)} sur ${nb(cahp.heures)} heures payées`}
          spark={cahp.manqueSaisie ? null : s.ca_heure_payee} />

        <StatTile label="Coût des pertes" value={eurShort(pertes.value)} tone="warn"
          sub={pertes.postes.map((p) => `${p.label.split(' ')[0]} ${nb(p.count)}`).join(' · ')}
          spark={s.cout_pertes} />
      </div>

      <BaseDeCalcul basis={marge.basis} onEdit={() => setEditCouts(true)} />

      {/* ---- Courbe CA + marge ------------------------------------------ */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <ChartCard
          title="CA opérationnel sur 12 mois"
          subtitle="Hors lignes de facturation groupée"
          right={
            <div className="row" style={{ gap: 8 }}>
              {proprio('ca_operationnel') && <span className="pill pill-neutral">{proprio('ca_operationnel')}</span>}
              <TargetBadge value={ca.value} target={cible('ca_operationnel')?.value != null ? Number(cible('ca_operationnel').value) : null}
                better="higher" format={eurShort} />
              <TargetButton indicateur={INDICATORS.ca_operationnel} metricKey="ca_operationnel" screen={SCREEN}
                target={cible('ca_operationnel')} onSave={onSaveTarget} onDelete={onDeleteTarget} format={eurShort} />
            </div>
          }
          table={{
            columns: [
              { key: 'period', label: 'Mois', render: (r) => libellePeriodeLongue(r.period) },
              { key: 'value', label: 'CA opérationnel', num: true, render: (r) => eur(r.value) },
              { key: 'count', label: 'Interventions', num: true, render: (r) => nb(r.count) },
              { key: 'panier', label: 'Panier moyen', num: true, render: (r) => eur(r.panierMoyen) },
            ],
            rows: s.ca_operationnel,
          }}
        >
          <LineChart data={s.ca_operationnel}
            target={cible('ca_operationnel')?.value != null ? Number(cible('ca_operationnel').value) : null}
            fmt={eurShort} labelPeriod={libellePeriode} />
        </ChartCard>

        <ChartCard
          title="Taux de marge sur 12 mois"
          subtitle="Recalculé à chaque changement de paramètre de coût"
          right={
            <div className="row" style={{ gap: 8 }}>
              {proprio('taux_marge') && <span className="pill pill-neutral">{proprio('taux_marge')}</span>}
              <TargetBadge value={marge.tauxMarge} target={cible('taux_marge')?.value != null ? Number(cible('taux_marge').value) : null}
                better="higher" format={(v) => pct(v, 0)} />
              <TargetButton indicateur={INDICATORS.taux_marge} metricKey="taux_marge" screen={SCREEN}
                target={cible('taux_marge')} onSave={onSaveTarget} onDelete={onDeleteTarget} format={(v) => pct(v, 0)} />
            </div>
          }
          note={<BasisInline basis={marge.basis} />}
          table={{
            columns: [
              { key: 'period', label: 'Mois', render: (r) => libellePeriodeLongue(r.period) },
              { key: 'value', label: 'Taux de marge', num: true, render: (r) => pct(r.value) },
              { key: 'ca', label: 'CA', num: true, render: (r) => eur(r.ca) },
              { key: 'coutTemps', label: 'Coût temps', num: true, render: (r) => eur(r.coutTemps) },
              { key: 'coutKm', label: 'Coût km', num: true, render: (r) => eur(r.coutKm) },
            ],
            rows: s.taux_marge,
          }}
        >
          <LineChart data={s.taux_marge}
            target={cible('taux_marge')?.value != null ? Number(cible('taux_marge').value) : null}
            fmt={(v) => pct(v, 0)} labelPeriod={libellePeriode} />
        </ChartCard>
      </div>

      {/* ---- 2. Marge par convention ------------------------------------ */}
      <ChartCard
        title="Marge par origine d'appel"
        subtitle="Panier moyen, kilomètres et temps moyens par convention"
        note={<BasisInline basis={marge.basis} />}
        table={{
          columns: [
            { key: 'key', label: "Origine d'appel" },
            { key: 'n', label: 'Interv.', num: true, render: (r) => nb(r.n) },
            { key: 'ca', label: 'CA', num: true, render: (r) => eur(r.ca) },
            { key: 'panierMoyen', label: 'Panier', num: true, render: (r) => eur(r.panierMoyen) },
            { key: 'marge', label: 'Marge', num: true, render: (r) => eur(r.marge) },
            { key: 'tauxMarge', label: 'Taux', num: true, render: (r) => pct(r.tauxMarge) },
            { key: 'kmMoyen', label: 'Km moy.', num: true, render: (r) => nb(r.kmMoyen, 1) },
            { key: 'tempsMoyenMin', label: 'Temps moy.', num: true, render: (r) => minutes(r.tempsMoyenMin) },
          ],
          rows: parOrigine,
        }}
      >
        <BarsH
          data={parOrigine.filter((o) => o.n >= 5).slice(0, 12).map((o) => ({
            key: o.key, label: court(o.key, 30), value: o.margeParIntervention,
            color: o.margeParIntervention < 0 ? VIZ.danger : VIZ.cat[0],
            tooltip: (
              <>
                <div style={{ fontWeight: 700 }}>{o.key}</div>
                <div>{nb(o.n)} interventions · CA {eur(o.ca)}</div>
                <div>panier {eur(o.panierMoyen)} · {nb(o.kmMoyen, 1)} km · {minutes(o.tempsMoyenMin)}</div>
                <div>taux de marge {pct(o.tauxMarge)}</div>
              </>
            ),
          }))}
          fmt={(v) => eur(v)} labelWidth={230}
          sub={(d) => `n=${parOrigine.find((o) => o.key === d.key)?.n ?? 0}`}
        />
        <div className="md-small" style={{ marginTop: 12 }}>
          Marge par intervention, conventions d'au moins 5 interventions. Le tableau donne
          panier, kilomètres et temps moyens de chacune.
        </div>
      </ChartCard>

      {/* ---- 3. Rendement par véhicule ---------------------------------- */}
      <ChartCard
        title="Rendement par véhicule"
        subtitle="Interventions et kilomètres par véhicule utilisé"
        note={vehicules.find((v) => v.key === '(non renseigné)')
          ? <span className="md-small" style={{ color: 'var(--md-signal-800)', fontWeight: 600 }}>
              {nb(vehicules.find((v) => v.key === '(non renseigné)').n)} interventions sans véhicule renseigné
              dans l'export — elles restent dans le CA mais ne sont attribuées à aucun véhicule.
            </span>
          : null}
        table={{
          columns: [
            { key: 'key', label: 'Véhicule' },
            { key: 'n', label: 'Interventions', num: true, render: (r) => nb(r.n) },
            { key: 'km', label: 'Km total', num: true, render: (r) => nb(r.km) },
            { key: 'kmMoyen', label: 'Km moyen', num: true, render: (r) => nb(r.kmMoyen, 1) },
            { key: 'ca', label: 'CA', num: true, render: (r) => eur(r.ca) },
            { key: 'caParKm', label: 'CA / km', num: true, render: (r) => eur(r.caParKm, 2) },
            { key: 'marge', label: 'Marge', num: true, render: (r) => eur(r.marge) },
          ],
          rows: vehicules,
        }}
      >
        <BarsH
          data={vehicules.filter((v) => v.key !== '(non renseigné)').slice(0, 15).map((v) => ({
            key: v.key, label: v.key, value: v.n,
            tooltip: (
              <>
                <div style={{ fontWeight: 700 }}>{v.key}</div>
                <div>{nb(v.n)} interventions · {nb(v.km)} km</div>
                <div>CA {eur(v.ca)} · {eur(v.caParKm, 2)} par km</div>
              </>
            ),
          }))}
          fmt={(v) => nb(v)} labelWidth={140}
          sub={(d) => `${nb(vehicules.find((v) => v.key === d.key)?.km ?? 0)} km`}
        />
      </ChartCard>

      {/* ---- 4. Coût des pertes ----------------------------------------- */}
      <ChartCard
        title="Coût des pertes"
        subtitle="DPR imputables, interventions non payantes, majorations non appliquées"
        right={
          <div className="row" style={{ gap: 8 }}>
            {proprio('cout_pertes') && <span className="pill pill-neutral">{proprio('cout_pertes')}</span>}
            <TargetButton indicateur={INDICATORS.cout_pertes} metricKey="cout_pertes" screen={SCREEN}
              target={cible('cout_pertes')} onSave={onSaveTarget} onDelete={onDeleteTarget} format={eurShort} />
          </div>
        }
        note={
          <span className="md-small">
            Le manque à gagner d'un DPR est estimé au panier moyen du mois ({eur(pertes.panierMoyen)}).
            Les majorations manquantes sont valorisées au taux de référence {pct(pertes.tauxMajorationRef, 0)},
            réglable dans les paramètres de coût. Ces deux chiffres sont des estimations, pas des montants constatés.
          </span>
        }
        table={{
          columns: [
            { key: 'label', label: 'Poste' },
            { key: 'count', label: 'Dossiers', num: true, render: (r) => nb(r.count) },
            { key: 'montant', label: 'Coût estimé', num: true, render: (r) => eur(r.montant) },
            { key: 'detail', label: 'Méthode' },
          ],
          rows: pertes.postes,
        }}
      >
        <StackedBar
          segments={pertes.postes.map((p, i) => ({
            label: p.label, value: p.montant, color: VIZ.cat[i],
            detail: `${nb(p.count)} dossiers — ${p.detail}`,
          }))}
          fmt={(v) => eurShort(v)}
        />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', marginTop: 20 }}>
          {pertes.postes.map((p, i) => (
            <div key={p.key} style={{
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
              padding: 14, cursor: 'pointer',
            }}
              onClick={() => setDrill({
                titre: p.label,
                sous: p.detail,
                items: p.list,
                extra: p.key === 'dpr'
                  ? [{ key: 'raisonDPR', label: 'Raison', render: (it) => libelleDPR(it.raisonDPR) }]
                  : p.key === 'majoration'
                    ? [
                        { key: 'creneau', label: 'Créneau', render: (it) => (it.isWeekend ? 'Week-end' : 'Nuit') },
                        { key: 'totalHT', label: 'Total HT', num: true, render: (it) => eur(it.totalHT, 2) },
                      ]
                    : [{ key: 'totalHT', label: 'Total HT', num: true, render: (it) => eur(it.totalHT, 2) }],
              })}>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: VIZ.cat[i] }} />
                <span className="md-label" style={{ color: 'var(--color-text)' }}>{p.label}</span>
              </div>
              <div className="md-mono-lg">{eur(p.montant)}</div>
              <div className="md-small">{nb(p.count)} dossiers · voir le détail →</div>
            </div>
          ))}
        </div>
      </ChartCard>

      {/* ---- 5. Mix d'activité ------------------------------------------ */}
      <MixCard mix={mix} interventions={interventions} mois={mois} moisCourant={moisCourant} onDrill={setDrill} courant={courant} />

      {/* ---- Facturation groupée ---------------------------------------- */}
      {groupeCourant.length > 0 && (
        <ChartCard
          title="Facturation groupée"
          subtitle={`Lignes au-delà de ${eur(settings.import?.groupedBillingThreshold ?? 3000)} — exclues des indicateurs opérationnels, conservées ici`}
          note="Typiquement des regroupements trimestriels de frais de parc. Elles fausseraient le panier moyen et la marge par intervention si elles étaient mêlées aux interventions courantes."
        >
          <DossierTable items={groupeCourant} extra={[
            { key: 'origine', label: 'Origine', render: (it) => court(it.origine, 28) },
            { key: 'typeIntervention', label: 'Type' },
            { key: 'fraisParc', label: 'Frais de parc', num: true, render: (it) => eur(it.fraisParc) },
            { key: 'totalHT', label: 'Total HT', num: true, render: (it) => eur(it.totalHT) },
          ]} />
          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end', gap: 12 }}>
            <span className="md-label">Total isolé</span>
            <span className="md-mono-lg">{eur(groupeCourant.reduce((s2, i) => s2 + i.totalHT, 0))}</span>
          </div>
        </ChartCard>
      )}

      {drill && (
        <Modal title={drill.titre} subtitle={drill.sous} onClose={() => setDrill(null)} width={1040}
          footer={
            <>
              <span className="md-small">{nb(drill.items.length)} dossier(s)</span>
              <div className="spacer" />
              <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(drill.items, 'mensuel')}>Exporter CSV</button>
              <button className="btn btn-primary" onClick={() => setDrill(null)}>Fermer</button>
            </>
          }>
          <DossierTable items={drill.items} extra={drill.extra || []} />
        </Modal>
      )}

      {editCouts && (
        <ParametresCout costs={costs} periode={moisCourant} vehicules={vehicules}
          onSave={majCouts} onClose={() => setEditCouts(false)}
          onToast={setToast}
          dt={dt} settings={settings} bornes={bornes}
          depanneurs={[...new Set(courant.map((i) => i.depanneur).filter(Boolean))]}
          onSaveSettings={onSaveSettings} />
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Base de calcul — l'exigence de traçabilité du cahier des charges
// ---------------------------------------------------------------------------

function BaseDeCalcul({ basis, onEdit }) {
  return (
    <section className="card" style={{ background: 'var(--md-stone-50)' }}>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="md-label">Base de calcul des marges</div>
          <div className="md-small" style={{ marginTop: 4 }}>
            Ces paramètres n'existent pas dans l'export PowerPanne : ils sont saisis ici.
            Toute marge affichée sur cet écran en dépend.
          </div>
        </div>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm no-print" onClick={onEdit}>Modifier</button>
      </div>
      <div className="row" style={{ gap: 28, marginTop: 14, flexWrap: 'wrap' }}>
        {basis.map((b) => (
          <div key={b.key}>
            <div className="md-label">{b.label}</div>
            <div className="md-mono" style={{ fontSize: 15, fontWeight: 600, marginTop: 3 }}>
              {typeof b.value === 'number' ? nb(b.value, b.value % 1 ? 2 : 0) : b.value}
              {b.unit ? <span className="md-small" style={{ marginLeft: 4 }}>{b.unit}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function BasisInline({ basis }) {
  return (
    <span className="md-small">
      Repose sur :{' '}
      {basis.map((b, i) => (
        <span key={b.key}>
          {i > 0 ? ' · ' : ''}
          {b.label.toLowerCase()}{' '}
          <strong style={{ fontFamily: 'var(--font-mono)' }}>
            {typeof b.value === 'number' ? nb(b.value, b.value % 1 ? 2 : 0) : b.value}
          </strong>
          {b.unit && !b.unit.includes('—') ? ` ${b.unit}` : ''}
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 5 — Mix d'activité et évolution du panier
// ---------------------------------------------------------------------------

function MixCard({ mix, interventions, mois, moisCourant, courant, onDrill }) {
  const [type, setType] = useState(null)
  const choisi = type || mix[0]?.key

  const evolution = useMemo(() => {
    const list = interventions.filter((i) => i.typeIntervention === choisi)
    return series(list, mois, monthOf, (l) => ({
      value: l.length ? sum(l.map((i) => i.totalHT)) / l.length : null,
      n: l.length, excluded: 0,
    }))
  }, [interventions, mois, choisi])

  return (
    <ChartCard
      title="Mix d'activité"
      subtitle="Répartition par type d'intervention et évolution du panier associé"
      table={{
        columns: [
          { key: 'key', label: "Type d'intervention" },
          { key: 'n', label: 'Interventions', num: true, render: (r) => nb(r.n) },
          { key: 'part', label: 'Part du volume', num: true, render: (r) => pct(r.part) },
          { key: 'ca', label: 'CA', num: true, render: (r) => eur(r.ca) },
          { key: 'partCA', label: 'Part du CA', num: true, render: (r) => pct(r.partCA) },
          { key: 'panier', label: 'Panier', num: true, render: (r) => eur(r.panier) },
        ],
        rows: mix,
      }}
      note="Cliquer un type d'intervention trace l'évolution de son panier sur 12 mois."
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 28, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 340px', minWidth: 300 }}>
          <BarsH
            data={mix.slice(0, 10).map((m) => ({
              key: m.key, label: m.key, value: m.n,
              color: m.key === choisi ? VIZ.cat[0] : '#B8D79B',
              tooltip: (
                <>
                  <div style={{ fontWeight: 700 }}>{m.key}</div>
                  <div>{nb(m.n)} interventions · {pct(m.part)} du volume</div>
                  <div>CA {eur(m.ca)} · panier {eur(m.panier)}</div>
                </>
              ),
            }))}
            fmt={(v) => nb(v)} labelWidth={200}
            sub={(d) => eur(mix.find((m) => m.key === d.key)?.panier ?? 0)}
          />
          <div className="row no-print" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {mix.slice(0, 8).map((m) => (
              <button key={m.key}
                className={`btn btn-sm ${m.key === choisi ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setType(m.key)}>{court(m.key, 22)}</button>
            ))}
          </div>
        </div>

        <div style={{ flex: '1 1 340px', minWidth: 300 }}>
          <div className="md-label" style={{ marginBottom: 8 }}>
            Panier moyen — {choisi}
          </div>
          <LineChart data={evolution} fmt={(v) => eur(v)} labelPeriod={libellePeriode} height={210} />
          <button className="btn btn-quiet btn-sm no-print" style={{ paddingLeft: 0, marginTop: 6 }}
            onClick={() => onDrill({
              titre: `${choisi} — ${libellePeriodeLongue(moisCourant)}`,
              items: courant.filter((i) => i.typeIntervention === choisi),
              extra: [
                { key: 'origine', label: 'Origine', render: (it) => court(it.origine, 24) },
                { key: 'totalHT', label: 'Total HT', num: true, render: (it) => eur(it.totalHT, 2) },
              ],
            })}>
            Voir les dossiers du mois →
          </button>
        </div>
      </div>
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// Paramètres de coût
// ---------------------------------------------------------------------------

function ParametresCout({
  costs, periode, vehicules, onSave, onClose, onToast,
  dt, settings, bornes, depanneurs, onSaveSettings,
}) {
  const [c, setC] = useState({ ...costs })
  const [nouveauVeh, setNouveauVeh] = useState('')

  const parVeh = c.coutKmParVehicule || {}
  const heures = c.heuresPayees || {}

  const set = (patch) => setC({ ...c, ...patch })
  const setVeh = (immat, taux) => {
    const next = { ...parVeh }
    if (taux == null || taux === '') delete next[immat]
    else next[immat] = Number(taux)
    set({ coutKmParVehicule: next })
  }

  return (
    <Modal title="Paramètres de coût" width={780} onClose={onClose}
      subtitle="Ces valeurs n'existent pas dans l'export PowerPanne. Toute marge affichée en dépend."
      footer={
        <>
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={async () => {
            await onSave(c)
            onToast('Paramètres de coût enregistrés — les marges sont recalculées')
            onClose()
          }}>Enregistrer</button>
        </>
      }>
      <div className="grid" style={{ gap: 20 }}>
        <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
          <Field label="Coût horaire chargé" hint="Salaire chargé d'un dépanneur, à l'heure">
            <NumInput value={c.coutHoraireCharge} step={0.5} suffix="€/h"
              onChange={(v) => set({ coutHoraireCharge: v })} />
          </Field>
          <Field label="Coût kilométrique par défaut" hint="Appliqué aux véhicules sans taux propre">
            <NumInput value={c.coutKmDefaut} step={0.01} suffix="€/km"
              onChange={(v) => set({ coutKmDefaut: v })} />
          </Field>
          <Field label="Base de temps" hint="Durée retenue pour valoriser le temps passé">
            <select value={c.baseTemps} onChange={(e) => set({ baseTemps: e.target.value })}>
              <option value="declaratif">Temps déclaratif (colonne PowerPanne)</option>
              <option value="horodatage">Horodatages mobile (fin − affectation)</option>
            </select>
          </Field>
          <Field label="Taux de majoration de référence"
            hint="Sert à valoriser les majorations manquantes de nuit et de week-end">
            <NumInput value={Math.round((c.tauxMajorationRef ?? 0.25) * 100)} step={5} suffix="%"
              onChange={(v) => set({ tauxMajorationRef: (v ?? 0) / 100 })} />
          </Field>
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          <div className="md-label" style={{ marginBottom: 4 }}>Heures payées par mois</div>
          <div className="md-small" style={{ marginBottom: 10 }}>
            Saisie manuelle en attendant la reprise depuis l'applicatif de pointage. Sert au CA par heure payée.
          </div>
          <div className="row" style={{ gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label={`Heures payées — ${libellePeriodeLongue(periode)}`}>
              <NumInput value={heures[periode] ?? ''} step={10} suffix="h" width={110}
                onChange={(v) => set({ heuresPayees: { ...heures, [periode]: v ?? 0 } })} />
            </Field>
            <BoutonReprise
              dt={dt} settings={settings} from={bornes.from} to={bornes.to}
              depanneurs={depanneurs} quoi="heures" onSaveSettings={onSaveSettings}
              libelle="Reprendre les heures depuis DepanTime"
              onAppliquer={(valeurs) => {
                const total = Object.values(valeurs).reduce((s2, v) => s2 + (v.heures || 0), 0)
                set({ heuresPayees: { ...heures, [periode]: Math.round(total) } })
                onToast(`${Math.round(total)} heures reprises depuis DepanTime`)
              }}
            />
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
          <div className="md-label" style={{ marginBottom: 4 }}>Coût kilométrique par véhicule</div>
          <div className="md-small" style={{ marginBottom: 10 }}>
            Un plateau poids lourd ne coûte pas le même kilomètre qu'un fourgon.
            Les véhicules sans taux propre utilisent le taux par défaut ({nb(c.coutKmDefaut, 2)} €/km).
          </div>

          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <select value={nouveauVeh} onChange={(e) => setNouveauVeh(e.target.value)} style={{ minWidth: 190 }}>
              <option value="">— choisir un véhicule —</option>
              {vehicules.filter((v) => v.key !== '(non renseigné)' && parVeh[v.key] == null).map((v) => (
                <option key={v.key} value={v.key}>{v.key} ({nb(v.n)} interv.)</option>
              ))}
            </select>
            <button className="btn btn-ghost btn-sm" disabled={!nouveauVeh}
              onClick={() => { setVeh(nouveauVeh, c.coutKmDefaut); setNouveauVeh('') }}>
              Ajouter un taux
            </button>
          </div>

          {Object.keys(parVeh).length === 0 ? (
            <div className="empty">Aucun taux spécifique — tous les véhicules au taux par défaut.</div>
          ) : (
            <table className="md-table">
              <thead><tr><th>Véhicule</th><th className="num">Interventions</th><th className="num">Coût / km</th><th></th></tr></thead>
              <tbody>
                {Object.entries(parVeh).sort().map(([immat, taux]) => (
                  <tr key={immat}>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{immat}</td>
                    <td className="num">{nb(vehicules.find((v) => v.key === immat)?.n ?? 0)}</td>
                    <td className="num">
                      <NumInput value={taux} step={0.01} suffix="€/km" width={80}
                        onChange={(v) => setVeh(immat, v)} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-quiet btn-sm" onClick={() => setVeh(immat, null)}>Retirer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  )
}
