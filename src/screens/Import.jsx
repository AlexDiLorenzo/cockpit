/**
 * ÉCRAN IMPORT
 * =========================================================================
 * Déposer un fichier, lire le diagnostic, valider. Rien n'est enregistré
 * avant validation : l'aperçu montre exactement ce qui entrera dans les
 * indicateurs et ce qui en sera écarté, avec la raison.
 */

import { useState, useRef, useCallback } from 'react'
import { normalizeDataset } from '../core/normalize.js'
import { getSource, SOURCES } from '../sources/index.js'
import { caOperationnel, sla, dprImputables } from '../core/metrics.js'
import { nb, pct, eur, eurShort, dateLongue, court, EMPTY, dateCourte } from '../format.js'
import { Modal, DossierTable, Toast, Spinner, Field } from '../components/ui.jsx'

export default function Import({ settings, imports, onImport, onDeleteImport, onSaveSettings, mode }) {
  const [etat, setEtat] = useState('repos') // repos | lecture | apercu | envoi
  const [progres, setProgres] = useState(null)
  const [resultat, setResultat] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [toast, setToast] = useState(null)
  const [drag, setDrag] = useState(false)
  const [voirGroupees, setVoirGroupees] = useState(false)
  const [voirColonnes, setVoirColonnes] = useState(false)
  const inputRef = useRef(null)

  const seuilGroupe = settings.import?.groupedBillingThreshold ?? 3000

  const traiter = useCallback(async (file) => {
    setErreur(null)
    setEtat('lecture')
    setProgres({ step: 'Ouverture', pct: 0 })
    try {
      const src = getSource('xlsx')
      const raw = await src.load(file, { onProgress: setProgres })
      const out = normalizeDataset(raw, {
        groupedBillingThreshold: seuilGroupe,
        overrides: settings.import?.overrides || {},
      })
      setResultat({ ...out, meta: raw.meta, fileName: file.name })
      setEtat('apercu')
    } catch (e) {
      console.error(e)
      setErreur(String(e.message || e))
      setEtat('repos')
    } finally {
      setProgres(null)
    }
  }, [seuilGroupe, settings.import])

  const valider = async () => {
    setEtat('envoi')
    try {
      await onImport({
        sourceId: 'xlsx',
        label: resultat.fileName,
        report: resultat.report,
        interventions: resultat.interventions,
        grouped: resultat.grouped,
      })
      setToast(`${nb(resultat.interventions.length)} interventions enregistrées`)
      setResultat(null)
      setEtat('repos')
    } catch (e) {
      setErreur(String(e.message || e))
      setEtat('apercu')
    }
  }

  return (
    <div className="grid" style={{ gap: 20, maxWidth: 1100 }}>
      <header>
        <h1 className="md-h1">Import des données</h1>
        <div className="md-small">
          Export PowerPanne « Historique dépanneur » — un onglet par dépanneur.
          {mode === 'local' && ' Les données restent sur ce poste (aucun serveur détecté).'}
        </div>
      </header>

      {etat === 'repos' && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault(); setDrag(false)
              const f = e.dataTransfer.files?.[0]
              if (f) traiter(f)
            }}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed ${drag ? 'var(--md-forest-600)' : 'var(--color-border)'}`,
              background: drag ? 'var(--md-forest-50)' : '#fff',
              borderRadius: 'var(--radius-xl)', padding: 56, textAlign: 'center',
              cursor: 'pointer', transition: 'all 150ms var(--ease-standard)',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 10 }}>⬆</div>
            <div className="md-h3">Déposer le fichier Excel</div>
            <div className="md-small" style={{ marginTop: 6 }}>
              ou cliquer pour le choisir · fichiers .xlsx et .xls
            </div>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && traiter(e.target.files[0])} />
          </div>

          {erreur && (
            <div className="card" style={{ borderColor: 'var(--md-danger)', background: 'var(--md-danger-bg)' }}>
              <strong>Lecture impossible</strong>
              <div className="md-small" style={{ marginTop: 4, color: 'var(--md-stone-900)' }}>{erreur}</div>
            </div>
          )}

          <ReglesNettoyage seuil={seuilGroupe} onChange={(v) =>
            onSaveSettings('import', { ...settings.import, groupedBillingThreshold: v })} />

          <HistoriqueImports imports={imports} onDelete={onDeleteImport} />
        </>
      )}

      {etat === 'lecture' && (
        <div className="card">
          <Spinner label={progres ? `${progres.step}…` : 'Lecture…'} />
          {progres && (
            <div style={{ height: 6, background: 'var(--md-stone-100)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${progres.pct}%`, height: '100%', background: 'var(--md-forest-600)',
                transition: 'width 150ms var(--ease-standard)',
              }} />
            </div>
          )}
        </div>
      )}

      {etat === 'envoi' && <div className="card"><Spinner label="Enregistrement…" /></div>}

      {etat === 'apercu' && resultat && (
        <Apercu
          r={resultat} seuil={seuilGroupe} erreur={erreur}
          onAnnuler={() => { setResultat(null); setEtat('repos'); setErreur(null) }}
          onValider={valider}
          onVoirGroupees={() => setVoirGroupees(true)}
          onVoirColonnes={() => setVoirColonnes(true)}
        />
      )}

      {voirGroupees && resultat && (
        <Modal title="Lignes de facturation groupée" width={1040} onClose={() => setVoirGroupees(false)}
          subtitle={`Montant supérieur à ${eur(seuilGroupe)} — exclues des indicateurs opérationnels, consultables dans la revue mensuelle`}>
          <DossierTable items={resultat.grouped} extra={[
            { key: 'origine', label: 'Origine', render: (it) => court(it.origine, 30) },
            { key: 'typeIntervention', label: 'Type' },
            { key: 'fraisParc', label: 'Frais de parc', num: true, render: (it) => eur(it.fraisParc) },
            { key: 'totalHT', label: 'Total HT', num: true, render: (it) => eur(it.totalHT) },
          ]} />
        </Modal>
      )}

      {voirColonnes && resultat && (
        <Modal title="Colonnes du fichier" width={780} onClose={() => setVoirColonnes(false)}
          subtitle="Ce que l'application a reconnu, ignoré ou laissé de côté">
          <ColonnesDetail report={resultat.report} mapping={resultat.mapping} />
        </Modal>
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Apercu({ r, seuil, erreur, onAnnuler, onValider, onVoirGroupees, onVoirColonnes }) {
  const { report, interventions, grouped } = r
  const ca = caOperationnel(interventions)
  const s = sla(interventions)
  const d = dprImputables(interventions)
  const bloque = report.blockingFields.length > 0

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <div>
            <h3 className="md-h3">{r.fileName}</h3>
            <div className="md-small">
              {nb(report.sheets.length)} onglets · période du {report.periodStart} au {report.periodEnd}
            </div>
          </div>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={onVoirColonnes}>Colonnes reconnues</button>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
          <Bloc label="Lignes lues" val={nb(report.sourceRows)} />
          <Bloc label="Lignes de total" val={nb(report.totalRowsExcluded)} note="exclues" tone="muted" />
          <Bloc label="Facturation groupée" val={nb(report.groupedBillingCount)}
            note={`${eurShort(report.groupedBillingAmount)} isolés`} tone="warn"
            action={grouped.length ? onVoirGroupees : null} />
          <Bloc label="Doublons" val={nb(report.duplicatesMerged)} note="fusionnés" tone="muted" />
          <Bloc label="Interventions retenues" val={nb(report.kept)} tone="ok" />
        </div>
      </section>

      <section className="card">
        <div className="md-label" style={{ marginBottom: 12 }}>Ce que donneront les indicateurs</div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16 }}>
          <Bloc label="CA opérationnel" val={eurShort(ca.value)} note={`panier ${eur(ca.panierMoyen)}`} />
          <Bloc label="SLA" val={pct(s.value)} note={`${nb(s.ok)}/${nb(s.n)} · ${nb(s.rendezVousExclus)} RDV exclus`} />
          <Bloc label="DPR imputables" val={nb(d.value)} note={`${nb(d.annulationsClient)} annulations écartées`} />
          <Bloc label="Délais aberrants" val={nb(report.outlierAcceptation + report.outlierArrivee)}
            note="négatifs ou supérieurs à 24 h" tone="warn" />
        </div>
      </section>

      {report.missingFields.length > 0 && (
        <section className="card" style={{
          borderColor: bloque ? 'var(--md-danger)' : 'var(--md-signal-300)',
          background: bloque ? 'var(--md-danger-bg)' : 'var(--md-signal-50)',
        }}>
          <div className="md-label" style={{ color: 'var(--md-stone-900)' }}>
            {bloque ? 'Colonnes indispensables absentes' : 'Colonnes optionnelles absentes'}
          </div>
          <div className="md-small" style={{ marginTop: 6, color: 'var(--md-stone-900)' }}>
            {report.missingFields.map((f) => f.label).join(' · ')}
          </div>
          {bloque && (
            <div className="md-small" style={{ marginTop: 8, color: 'var(--md-stone-900)' }}>
              Sans ces colonnes, les indicateurs correspondants ne seront pas calculables.
              Vérifier que l'export contient bien les mêmes colonnes que d'habitude.
            </div>
          )}
        </section>
      )}

      {erreur && (
        <div className="card" style={{ borderColor: 'var(--md-danger)', background: 'var(--md-danger-bg)' }}>
          <strong>Enregistrement impossible</strong>
          <div className="md-small" style={{ marginTop: 4, color: 'var(--md-stone-900)' }}>{erreur}</div>
        </div>
      )}

      <section className="card">
        <div className="md-label" style={{ marginBottom: 10 }}>Répartition par onglet</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {report.sheets.map((sh) => (
            <span key={sh.name} className="pill pill-neutral" title={sh.name}>
              {court(sh.name.replace(/\s*\([^)]*\)\s*$/, ''), 22)} · {nb(sh.rows)}
            </span>
          ))}
        </div>
      </section>

      <div className="row" style={{ gap: 12 }}>
        <button className="btn btn-ghost" onClick={onAnnuler}>Annuler</button>
        <div className="spacer" />
        <span className="md-small">
          {nb(interventions.length)} interventions et {nb(grouped.length)} ligne(s) groupée(s) seront enregistrées
        </span>
        <button className="btn btn-primary" onClick={onValider} disabled={bloque}>
          Valider l'import
        </button>
      </div>
    </div>
  )
}

function Bloc({ label, val, note, tone, action }) {
  const couleur = { ok: 'var(--md-forest-600)', warn: 'var(--md-signal-800)', muted: 'var(--md-stone-500)' }[tone]
  return (
    <div>
      <div className="md-label">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: couleur, letterSpacing: '-0.02em' }}>{val}</div>
      {note && <div className="md-small">{note}</div>}
      {action && <button className="btn btn-quiet btn-sm" style={{ paddingLeft: 0 }} onClick={action}>Voir →</button>}
    </div>
  )
}

// ---------------------------------------------------------------------------

function ReglesNettoyage({ seuil, onChange }) {
  return (
    <section className="card">
      <div className="md-label" style={{ marginBottom: 10 }}>Règles appliquées à chaque import</div>
      <ul className="md-small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9, color: 'var(--color-text)' }}>
        <li>Les lignes de total (une par onglet, reconnaissables à la valeur « / ») sont exclues.</li>
        <li>
          Les lignes dépassant{' '}
          <input className="num" type="number" step="100" value={seuil} style={{ width: 90 }}
            onChange={(e) => onChange(Number(e.target.value) || 3000)} />{' '}
          € de Total HT sont isolées comme facturation groupée : hors indicateurs opérationnels,
          consultables dans la revue mensuelle.
        </li>
        <li>Seuls les horodatages « (mobile) » et « (web) » sont utilisés ; les « (modifiée) » sont ignorés.</li>
        <li>Les délais négatifs ou supérieurs à 24 h sont écartés des moyennes, médianes et taux, et comptés.</li>
        <li>
          Une intervention est identifiée par dossier + mission + dépanneur + horodatages + montant :
          deux exports qui se chevauchent ne créent pas de doublon.
        </li>
      </ul>
    </section>
  )
}

function ColonnesDetail({ report, mapping }) {
  const reconnues = Object.entries(mapping)
  return (
    <div className="grid" style={{ gap: 18 }}>
      <div>
        <div className="md-label" style={{ marginBottom: 8 }}>
          Reconnues — {nb(reconnues.length)}
        </div>
        <table className="md-table">
          <thead><tr><th>Champ du Cockpit</th><th>Colonne du fichier</th></tr></thead>
          <tbody>
            {reconnues.map(([k, col]) => (
              <tr key={k}><td>{k}</td><td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{col}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.ignoredColumns.length > 0 && (
        <div>
          <div className="md-label" style={{ marginBottom: 8 }}>
            Volontairement ignorées — {nb(report.ignoredColumns.length)}
          </div>
          <div className="md-small">
            Horodatages « (modifiée) », remplis à moins de 50 % :{' '}
            {report.ignoredColumns.join(' · ')}
          </div>
        </div>
      )}

      {report.unusedColumns.length > 0 && (
        <div>
          <div className="md-label" style={{ marginBottom: 8 }}>
            Non utilisées — {nb(report.unusedColumns.length)}
          </div>
          <div className="md-small">
            Présentes dans le fichier mais sans usage dans les indicateurs :{' '}
            {report.unusedColumns.join(' · ')}
          </div>
        </div>
      )}
    </div>
  )
}

function HistoriqueImports({ imports, onDelete }) {
  if (!imports.length) {
    return (
      <section className="card">
        <div className="md-label" style={{ marginBottom: 8 }}>Historique des imports</div>
        <div className="empty">Aucun import enregistré.</div>
      </section>
    )
  }
  return (
    <section className="card">
      <div className="md-label" style={{ marginBottom: 10 }}>Historique des imports</div>
      <table className="md-table">
        <thead>
          <tr>
            <th>Fichier</th><th>Période couverte</th>
            <th className="num">Retenues</th><th className="num">Groupées</th>
            <th>Importé le</th><th></th>
          </tr>
        </thead>
        <tbody>
          {imports.map((im) => (
            <tr key={im.id}>
              <td title={im.label}>{court(im.label, 42)}</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {im.period_start ? `${String(im.period_start).slice(0, 10)} → ${String(im.period_end).slice(0, 10)}` : EMPTY}
              </td>
              <td className="num">{nb(im.rows_kept)}</td>
              <td className="num">{nb(im.rows_grouped)}</td>
              <td className="md-small">{dateCourte(im.created_at)} · {im.created_by || EMPTY}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn btn-quiet btn-sm"
                  onClick={() => confirm(`Supprimer l'import « ${im.label} » et ses interventions ?`) && onDelete(im.id)}>
                  Supprimer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="md-small" style={{ marginTop: 10 }}>
        Supprimer un import retire les interventions qu'il a apportées. Celles qu'un import
        ultérieur a mises à jour appartiennent désormais à ce dernier.
      </div>
    </section>
  )
}
