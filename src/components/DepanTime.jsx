/**
 * REPRISE DEPUIS DEPANTIME
 * =========================================================================
 * DepanTime détient les relevés de temps. Le Cockpit y puise trois choses
 * que l'export PowerPanne ne contient pas : l'effectif du jour, les jours
 * travaillés par dépanneur, les heures payées du mois.
 *
 * Deux principes :
 *   — rien n'est écrit sans validation. La reprise remplit un aperçu,
 *     l'utilisateur voit ce qui a été rapproché et ce qui ne l'a pas été,
 *     puis valide ;
 *   — les rapprochements douteux ne sont jamais devinés. Un nom ambigu, ou
 *     deux noms PowerPanne pointant vers la même fiche, passent en choix
 *     manuel — et ce choix est mémorisé pour les fois suivantes.
 */

import { useState, useEffect, useCallback } from 'react'
import { getStore } from '../store.js'
import { apparier } from '../core/matching.js'
import { nb, dateISO, dateCourte, EMPTY } from '../format.js'
import { Modal, Field, Spinner } from './ui.jsx'

/** État de la passerelle : configurée ? joignable ? quels sites ? */
export function useDepanTime(settings) {
  const [etat, setEtat] = useState({ chargement: true, configured: false, ok: false })

  useEffect(() => {
    let vivant = true
    getStore().depantimeStatus()
      .then((s) => vivant && setEtat({ ...s, chargement: false }))
      .catch((e) => vivant && setEtat({
        chargement: false, configured: false, ok: false, message: String(e.message || e),
      }))
    return () => { vivant = false }
  }, [])

  const siteId = settings?.depantime?.siteId
    ?? (etat.sites?.length === 1 ? etat.sites[0].id : null)

  return { ...etat, siteId, disponible: etat.ok && siteId != null }
}

/**
 * Bouton de reprise + modale de rapprochement.
 *
 * @param {string} from,to     plage de dates (une journée, une semaine ISO, un mois)
 * @param {string[]} depanneurs noms tels qu'ils apparaissent dans PowerPanne
 * @param {(valeurs, aliases) => void} onAppliquer
 *        valeurs : { [nomPowerPanne]: {jours, heures} }
 * @param {'jours'|'heures'} quoi  ce que la reprise alimente
 */
export function BoutonReprise({
  dt, settings, from, to, depanneurs, onAppliquer, onSaveSettings,
  quoi = 'jours', libelle = 'Reprendre depuis DepanTime',
}) {
  const [ouvert, setOuvert] = useState(false)

  if (dt.chargement) return null
  if (!dt.configured) {
    return (
      <span className="md-small" title={dt.message}>
        Reprise DepanTime non configurée
      </span>
    )
  }
  if (!dt.ok) {
    return (
      <span className="pill pill-danger" title={dt.message}>
        DepanTime injoignable
      </span>
    )
  }
  if (dt.siteId == null) {
    return <span className="md-small">Choisir le site DepanTime dans Réglages</span>
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm no-print" onClick={() => setOuvert(true)}>
        {libelle}
      </button>
      {ouvert && (
        <ModaleReprise
          dt={dt} settings={settings} from={from} to={to} depanneurs={depanneurs}
          quoi={quoi} onSaveSettings={onSaveSettings}
          onClose={() => setOuvert(false)}
          onAppliquer={(v, a) => { onAppliquer(v, a); setOuvert(false) }}
        />
      )}
    </>
  )
}

function ModaleReprise({
  dt, settings, from, to, depanneurs, quoi, onClose, onAppliquer, onSaveSettings,
}) {
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState(null)
  const [donnees, setDonnees] = useState(null)
  const [choix, setChoix] = useState({}) // nom PowerPanne → id employé, saisi à la main

  const aliases = settings?.depantime?.aliases || {}

  const charger = useCallback(async () => {
    setChargement(true); setErreur(null)
    try {
      const d = await getStore().depantimeEffectifs({ siteId: dt.siteId, from, to })
      setDonnees(d)
    } catch (e) {
      setErreur(String(e.message || e))
    } finally {
      setChargement(false)
    }
  }, [dt.siteId, from, to])

  useEffect(() => { charger() }, [charger])

  const employes = donnees?.depanneurs || []
  const app = donnees ? apparier(depanneurs, employes, aliases) : null

  // Les choix manuels de la session s'ajoutent aux rapprochements automatiques.
  const resolus = { ...(app?.resolus || {}) }
  for (const [nom, id] of Object.entries(choix)) {
    if (!id) continue
    const e = employes.find((x) => String(x.id) === String(id))
    if (e) resolus[nom] = { employeeId: e.id, label: e.label, manuel: true }
  }

  const valeurDe = (nom) => {
    const r = resolus[nom]
    if (!r) return null
    const e = employes.find((x) => String(x.id) === String(r.employeeId))
    if (!e) return null
    return { jours: e.jours, heures: e.heures, heuresTravaillees: e.heuresTravaillees }
  }

  const rapproches = depanneurs.filter((d) => resolus[d])
  const restants = depanneurs.filter((d) => !resolus[d])
  const totalJours = rapproches.reduce((s, d) => s + (valeurDe(d)?.jours || 0), 0)
  const totalHeures = rapproches.reduce((s, d) => s + (valeurDe(d)?.heures || 0), 0)

  const appliquer = () => {
    const valeurs = {}
    for (const d of rapproches) {
      const v = valeurDe(d)
      if (v) valeurs[d] = v
    }
    // Mémoriser les choix manuels pour les prochaines reprises.
    const nouveaux = { ...aliases }
    for (const [nom, id] of Object.entries(choix)) {
      if (id) nouveaux[normaliser(nom)] = id
    }
    if (onSaveSettings && Object.keys(choix).length) {
      onSaveSettings('depantime', { ...settings.depantime, aliases: nouveaux })
    }
    onAppliquer(valeurs, nouveaux)
  }

  return (
    <Modal
      title="Reprise depuis DepanTime"
      subtitle={`Relevés de temps du ${dateCourte(from)} au ${dateCourte(to)}`}
      width={860}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-quiet btn-sm" onClick={charger}>Recharger</button>
          <div className="spacer" />
          <span className="md-small">
            {nb(rapproches.length)} / {nb(depanneurs.length)} dépanneurs rapprochés
            {quoi === 'jours' ? ` · ${nb(totalJours)} jours` : ` · ${nb(totalHeures)} h`}
          </span>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!rapproches.length} onClick={appliquer}>
            Appliquer
          </button>
        </>
      }
    >
      {chargement && <Spinner label="Lecture des relevés DepanTime…" />}

      {erreur && (
        <div className="card" style={{ borderColor: 'var(--md-danger)', background: 'var(--md-danger-bg)' }}>
          <strong>DepanTime n'a pas répondu</strong>
          <div className="md-small" style={{ marginTop: 4, color: 'var(--md-stone-900)' }}>{erreur}</div>
        </div>
      )}

      {donnees && !chargement && (
        <div className="grid" style={{ gap: 18 }}>
          {restants.length > 0 && (
            <section style={{
              border: '1px solid var(--md-signal-300)', background: 'var(--md-signal-50)',
              borderRadius: 'var(--radius-md)', padding: 14,
            }}>
              <div className="md-label" style={{ color: 'var(--md-stone-900)', marginBottom: 4 }}>
                {nb(restants.length)} dépanneur(s) à rapprocher à la main
              </div>
              <div className="md-small" style={{ color: 'var(--md-stone-900)', marginBottom: 10 }}>
                Le rapprochement automatique n'a pas tranché : nom absent de DepanTime, ou
                deux noms PowerPanne désignant la même fiche. Le choix est mémorisé pour
                les reprises suivantes.
              </div>
              <div className="grid" style={{ gap: 8 }}>
                {restants.map((nom) => {
                  const m = app.manuels.find((x) => x.depanneur === nom)
                  return (
                    <div key={nom} className="row" style={{ gap: 10 }}>
                      <span style={{ minWidth: 200, fontWeight: 600 }}>{nom}</span>
                      <select value={choix[nom] || ''} style={{ minWidth: 240 }}
                        onChange={(e) => setChoix({ ...choix, [nom]: e.target.value })}>
                        <option value="">— laisser de côté —</option>
                        {employes.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.label} · {nb(e.jours)} j · {nb(e.heures, 1)} h
                          </option>
                        ))}
                      </select>
                      {m?.raison === 'collision' && (
                        <span className="pill pill-warn">deux noms pour une fiche</span>
                      )}
                      {m?.raison === 'introuvable' && (
                        <span className="pill pill-neutral">introuvable</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <section>
            <div className="md-label" style={{ marginBottom: 8 }}>
              Rapprochements — {nb(rapproches.length)} dépanneur(s)
            </div>
            <table className="md-table">
              <thead>
                <tr>
                  <th>Dépanneur (PowerPanne)</th>
                  <th>Fiche DepanTime</th>
                  <th className="num">Jours travaillés</th>
                  <th className="num">Heures payées</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rapproches.map((nom) => {
                  const r = resolus[nom]
                  const v = valeurDe(nom)
                  return (
                    <tr key={nom}>
                      <td>{nom}</td>
                      <td>{r.label}</td>
                      <td className="num">{nb(v?.jours)}</td>
                      <td className="num">{nb(v?.heures, 1)}</td>
                      <td>
                        {r.manuel && <span className="pill pill-info">choix manuel</span>}
                        {r.fromAlias && <span className="pill pill-neutral">alias connu</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          {app.inutilises.length > 0 && (
            <div className="md-small">
              {nb(app.inutilises.length)} fiche(s) DepanTime sans intervention sur la période :{' '}
              {app.inutilises.slice(0, 8).map((e) => e.label).join(', ')}
              {app.inutilises.length > 8 ? '…' : ''}
            </div>
          )}

          <div className="md-small">
            Un jour de congés est compté dans les heures payées mais pas dans les jours
            travaillés : DepanTime y pré-remplit 7 h pour la paie, or aucune intervention
            n'y est produite.
          </div>
        </div>
      )}
    </Modal>
  )
}

function normaliser(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Reprise silencieuse de l'effectif d'une journée — l'écran temps réel n'a
 * pas besoin d'un rapprochement de noms, seulement d'un décompte.
 */
export async function effectifDuJour(siteId, jour) {
  const d = await getStore().depantimeEffectifs({ siteId, from: jour, to: jour })
  return d.parJour?.[jour] ?? d.totaux?.effectifMax ?? 0
}
