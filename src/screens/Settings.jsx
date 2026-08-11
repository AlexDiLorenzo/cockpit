/**
 * ÉCRAN RÉGLAGES
 * =========================================================================
 * Ce qui survit aux imports : propriétaires d'indicateurs, seuils d'alerte,
 * paramètres de coût, effectifs. Plus l'état de la source de données.
 */

import { useState } from 'react'
import { INDICATORS, DEFAULT_THRESHOLDS, DEFAULT_COSTS } from '../core/metrics.js'
import { nb, eur, pct, dateCourte, EMPTY } from '../format.js'
import { Field, NumInput, Toast } from '../components/ui.jsx'
import { useDepanTime } from '../components/DepanTime.jsx'

export default function Settings({ settings, onSaveSettings, range, imports, mode, user, onChangePassword }) {
  const [toast, setToast] = useState(null)
  const [owners, setOwners] = useState(settings.owners || {})
  const [pw, setPw] = useState({ current: '', next: '' })

  const seuils = settings.thresholds
  const costs = { ...DEFAULT_COSTS, ...settings.costs }

  const majSeuils = (patch) => onSaveSettings('thresholds', { ...seuils, ...patch })
  const majCosts = (patch) => onSaveSettings('costs', { ...costs, ...patch })

  const enregistrerOwners = async () => {
    await onSaveSettings('owners', owners)
    setToast('Propriétaires enregistrés')
  }

  return (
    <div className="grid" style={{ gap: 20, maxWidth: 940 }}>
      <header>
        <h1 className="md-h1">Réglages</h1>
        <div className="md-small">
          Ces valeurs survivent aux imports successifs.
        </div>
      </header>

      {/* ---- Source de données ------------------------------------------ */}
      <section className="card">
        <h3 className="md-h3" style={{ marginBottom: 12 }}>Source de données</h3>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <Info label="Mode" val={mode === 'remote' ? 'Serveur Cockpit' : 'Poste local'}
            note={mode === 'remote' ? 'PostgreSQL, données partagées' : 'IndexedDB, données sur ce poste'} />
          <Info label="Interventions stockées" val={nb(range?.n ?? 0)}
            note={`dont ${nb(range?.grouped ?? 0)} en facturation groupée`} />
          <Info label="Historique couvert"
            val={range?.start ? `${String(range.start).slice(0, 10)} → ${String(range.end).slice(0, 10)}` : EMPTY}
            note={couvertureLabel(range)} />
          <Info label="Imports enregistrés" val={nb(imports?.length ?? 0)} />
        </div>
        <div className="md-small" style={{ marginTop: 14, borderTop: '1px solid var(--md-stone-100)', paddingTop: 12 }}>
          <strong>API PowerPanne</strong> — non configurée. Le noyau de calcul est indépendant de la
          source : quand l'API sera ouverte, renseigner <code>CK_POWERPANNE_URL</code> et{' '}
          <code>CK_POWERPANNE_TOKEN</code> côté serveur, ajuster <code>mapRecord()</code> dans{' '}
          <code>src/sources/apiSource.js</code>, et les trois écrans fonctionneront à l'identique.
        </div>
      </section>

      <PasserelleDepanTime settings={settings} onSaveSettings={onSaveSettings} onToast={setToast} />

      {/* ---- Propriétaires ---------------------------------------------- */}
      <section className="card">
        <div className="row" style={{ marginBottom: 4 }}>
          <h3 className="md-h3">Propriétaires des indicateurs</h3>
          <div className="spacer" />
          <button className="btn btn-primary btn-sm" onClick={enregistrerOwners}>Enregistrer</button>
        </div>
        <div className="md-small" style={{ marginBottom: 14 }}>
          Le nom apparaît à côté de l'indicateur en revue. Une cible portant un propriétaire prime sur cette liste.
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {Object.entries(INDICATORS).map(([k, ind]) => (
            <Field key={k} label={`${ind.label} (${ind.screen === 'weekly' ? 'hebdo' : 'mensuel'})`}>
              <input value={owners[k] || ''} placeholder="Nom du responsable"
                onChange={(e) => setOwners({ ...owners, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </section>

      {/* ---- Seuils ------------------------------------------------------ */}
      <section className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <h3 className="md-h3">Seuils d'alerte — écran temps réel</h3>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm"
            onClick={() => { majSeuils(DEFAULT_THRESHOLDS); setToast('Seuils réinitialisés') }}>
            Valeurs par défaut
          </button>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
          <Field label="Non affectés — au-delà de">
            <NumInput value={seuils.nonAffecteMin} suffix="min" onChange={(v) => majSeuils({ nonAffecteMin: v })} />
          </Field>
          <Field label="Non affectés — alerte à">
            <NumInput value={seuils.nonAffecteAlerte} suffix="dossiers" onChange={(v) => majSeuils({ nonAffecteAlerte: v })} />
          </Field>
          <Field label="Sans arrivée — au-delà de">
            <NumInput value={seuils.retardMin} suffix="min" onChange={(v) => majSeuils({ retardMin: v })} />
          </Field>
          <Field label="Sans arrivée — alerte à">
            <NumInput value={seuils.retardAlerte} suffix="dossiers" onChange={(v) => majSeuils({ retardAlerte: v })} />
          </Field>
          <Field label="Charge — alerte à">
            <NumInput value={seuils.chargeAlerte} step={0.5} suffix="doss./dép." onChange={(v) => majSeuils({ chargeAlerte: v })} />
          </Field>
          <Field label="Trajectoire — alerte sous">
            <NumInput value={seuils.trajectoireAlerte} suffix="% d'écart" onChange={(v) => majSeuils({ trajectoireAlerte: v })} />
          </Field>
          <Field label="Anomalies — alerte à">
            <NumInput value={seuils.anomaliesAlerte} suffix="anomalies" onChange={(v) => majSeuils({ anomaliesAlerte: v })} />
          </Field>
          <Field label="Nuit — de" hint="Sert aux anomalies et aux majorations">
            <NumInput value={seuils.nuitDebut} suffix="h" width={64} onChange={(v) => majSeuils({ nuitDebut: v })} />
          </Field>
          <Field label="Nuit — jusqu'à">
            <NumInput value={seuils.nuitFin} suffix="h" width={64} onChange={(v) => majSeuils({ nuitFin: v })} />
          </Field>
        </div>
      </section>

      {/* ---- Coûts ------------------------------------------------------- */}
      <section className="card">
        <h3 className="md-h3" style={{ marginBottom: 4 }}>Paramètres de coût</h3>
        <div className="md-small" style={{ marginBottom: 14 }}>
          Absents de l'export PowerPanne. Toute marge affichée en revue mensuelle en dépend,
          et l'écran le rappelle sous chaque chiffre.
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
          <Field label="Coût horaire chargé">
            <NumInput value={costs.coutHoraireCharge} step={0.5} suffix="€/h"
              onChange={(v) => majCosts({ coutHoraireCharge: v })} />
          </Field>
          <Field label="Coût kilométrique par défaut">
            <NumInput value={costs.coutKmDefaut} step={0.01} suffix="€/km"
              onChange={(v) => majCosts({ coutKmDefaut: v })} />
          </Field>
          <Field label="Taux de majoration de référence">
            <NumInput value={Math.round((costs.tauxMajorationRef ?? 0.25) * 100)} step={5} suffix="%"
              onChange={(v) => majCosts({ tauxMajorationRef: (v ?? 0) / 100 })} />
          </Field>
          <Field label="Base de temps">
            <select value={costs.baseTemps} onChange={(e) => majCosts({ baseTemps: e.target.value })}>
              <option value="declaratif">Temps déclaratif</option>
              <option value="horodatage">Horodatages mobile</option>
            </select>
          </Field>
        </div>
        <div className="md-small" style={{ marginTop: 12 }}>
          {Object.keys(costs.coutKmParVehicule || {}).length
            ? `${nb(Object.keys(costs.coutKmParVehicule).length)} véhicule(s) avec un taux kilométrique propre — modifiables depuis la revue mensuelle.`
            : 'Aucun taux kilométrique spécifique. Les taux par véhicule se règlent depuis la revue mensuelle.'}
        </div>
      </section>

      {/* ---- Compte ------------------------------------------------------ */}
      {mode === 'remote' && (
        <section className="card">
          <h3 className="md-h3" style={{ marginBottom: 4 }}>Compte</h3>
          <div className="md-small" style={{ marginBottom: 14 }}>
            Connecté en tant que {user?.displayName || user?.username} ({user?.role}).
          </div>
          <div className="row" style={{ gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Mot de passe actuel">
              <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
            <Field label="Nouveau mot de passe" hint="6 caractères minimum">
              <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <button className="btn btn-primary" disabled={!pw.current || pw.next.length < 6}
              onClick={async () => {
                try {
                  await onChangePassword(pw.current, pw.next)
                  setPw({ current: '', next: '' })
                  setToast('Mot de passe modifié')
                } catch (e) { setToast(String(e.message || e)) }
              }}>Modifier</button>
          </div>
        </section>
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

/**
 * Passerelle DepanTime — état du lien et choix du site.
 *
 * Les identifiants du compte de service ne sont pas modifiables ici :
 * ils vivent dans les variables d'environnement du serveur et ne descendent
 * jamais au navigateur.
 */
function PasserelleDepanTime({ settings, onSaveSettings, onToast }) {
  const dt = useDepanTime(settings)
  const siteId = settings.depantime?.siteId ?? ''
  const aliases = settings.depantime?.aliases || {}

  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 4 }}>
        <h3 className="md-h3">Passerelle DepanTime</h3>
        <div className="spacer" />
        {dt.chargement
          ? <span className="pill pill-neutral">vérification…</span>
          : dt.ok
            ? <span className="pill pill-ok">connectée</span>
            : dt.configured
              ? <span className="pill pill-danger">injoignable</span>
              : <span className="pill pill-neutral">non configurée</span>}
      </div>

      <div className="md-small" style={{ marginBottom: 14 }}>
        L'applicatif de pointage fournit l'effectif du jour, les jours travaillés par
        dépanneur et les heures payées du mois — trois données absentes de l'export
        PowerPanne. La lecture se fait de conteneur à conteneur ; le Cockpit n'écrit
        jamais dans DepanTime.
      </div>

      {!dt.configured && !dt.chargement && (
        <div className="md-small" style={{
          background: 'var(--md-stone-50)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', padding: 12,
        }}>
          Renseigner côté serveur <code>CK_DEPANTIME_URL</code> (par exemple{' '}
          <code>http://depantime-api:3000</code>), <code>CK_DEPANTIME_USER</code> et{' '}
          <code>CK_DEPANTIME_PASSWORD</code>, puis redémarrer l'API Cockpit.
          Tant que ce n'est pas fait, jours travaillés et heures payées restent
          en saisie manuelle — les écrans fonctionnent normalement.
        </div>
      )}

      {dt.configured && !dt.ok && !dt.chargement && (
        <div className="md-small" style={{ color: 'var(--md-danger)', fontWeight: 600 }}>
          {dt.message}
        </div>
      )}

      {dt.ok && (
        <div className="row" style={{ gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Site interrogé" hint="Les relevés de temps sont lus pour ce site">
            <select value={siteId}
              onChange={(e) => {
                onSaveSettings('depantime', {
                  ...settings.depantime,
                  siteId: e.target.value === '' ? null : e.target.value,
                })
                onToast('Site DepanTime enregistré')
              }}>
              <option value="">— choisir —</option>
              {(dt.sites || []).map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
              ))}
            </select>
          </Field>

          <div>
            <div className="md-label">Rapprochements mémorisés</div>
            <div className="md-mono" style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>
              {nb(Object.keys(aliases).length)}
            </div>
            <div className="md-small">choix manuels conservés d'une reprise à l'autre</div>
          </div>

          {Object.keys(aliases).length > 0 && (
            <button className="btn btn-ghost btn-sm"
              onClick={() => {
                onSaveSettings('depantime', { ...settings.depantime, aliases: {} })
                onToast('Rapprochements oubliés')
              }}>
              Oublier les rapprochements
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function Info({ label, val, note }) {
  return (
    <div>
      <div className="md-label">{label}</div>
      <div className="md-mono" style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{val}</div>
      {note && <div className="md-small">{note}</div>}
    </div>
  )
}

function couvertureLabel(range) {
  if (!range?.start) return 'aucune donnée'
  const jours = Math.round((new Date(range.end) - new Date(range.start)) / 86400000) + 1
  const semaines = Math.floor(jours / 7)
  if (semaines >= 52) return `${Math.floor(jours / 30)} mois — les 12 mois sont couverts`
  if (semaines >= 8) return `${semaines} semaines — les 8 semaines sont couvertes`
  return `${semaines} semaine(s) — importer davantage d'historique pour les courbes`
}
