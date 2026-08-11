/**
 * COCKPIT — coquille applicative
 * =========================================================================
 * Navigation, chargement des données, authentification.
 *
 * Les interventions sont chargées une fois puis partagées entre les trois
 * écrans : chacun applique les mêmes fonctions de `core/metrics.js` sur la
 * tranche qui l'intéresse. C'est ce qui garantit qu'un SLA affiché en temps
 * réel et le même SLA affiché en revue hebdomadaire sortent du même calcul.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { initStore, getStore, setToken, getToken, DEFAULT_SETTINGS } from './store.js'
import { dayKey, isoWeekKey } from './core/normalize.js'
import { nb, dateISO } from './format.js'
import { Spinner, Toast } from './components/ui.jsx'

import Realtime from './screens/Realtime.jsx'
import Weekly from './screens/Weekly.jsx'
import Monthly from './screens/Monthly.jsx'
import ImportScreen from './screens/Import.jsx'
import Settings from './screens/Settings.jsx'

const ONGLETS = [
  { id: 'realtime', label: 'Temps réel', marker: '⏱' },
  { id: 'weekly', label: 'Revue hebdo', marker: '📊' },
  { id: 'monthly', label: 'Revue mensuelle', marker: '📅' },
  { id: 'import', label: 'Import', marker: '⬆' },
  { id: 'settings', label: 'Réglages', marker: '⚙' },
]

/** Fenêtre chargée : 13 mois, de quoi tenir les courbes 8 semaines et 12 mois. */
function fenetreChargement() {
  const to = new Date()
  const from = new Date(to.getFullYear(), to.getMonth() - 13, 1)
  return { from: dateISO(from), to: dateISO(new Date(to.getFullYear(), to.getMonth() + 1, 0)) }
}

export default function App() {
  const [pret, setPret] = useState(false)
  const [mode, setMode] = useState('local')
  const [authRequis, setAuthRequis] = useState(false)
  const [user, setUser] = useState(null)
  const [onglet, setOnglet] = useState('realtime')
  const [toast, setToast] = useState(null)

  const [interventions, setInterventions] = useState([])
  const [grouped, setGrouped] = useState([])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [targets, setTargets] = useState([])
  const [actions, setActions] = useState([])
  const [imports, setImports] = useState([])
  const [range, setRange] = useState(null)
  const [staffing, setStaffing] = useState([])
  const [workedDays, setWorkedDays] = useState({})
  const [chargement, setChargement] = useState(true)

  // ---- Démarrage ----------------------------------------------------------
  useEffect(() => {
    (async () => {
      const { store, authRequired } = await initStore()
      setMode(store.mode)
      setAuthRequis(authRequired)
      if (authRequired && !getToken()) { setPret(true); setChargement(false); return }
      try {
        if (store.me) setUser(await store.me())
      } catch { setPret(true); setChargement(false); return }
      await chargerTout()
      setPret(true)
    })()
  }, [])

  const chargerTout = useCallback(async () => {
    setChargement(true)
    const s = getStore()
    const w = fenetreChargement()
    try {
      const [set, itv, grp, tg, ac, im, rg, st] = await Promise.all([
        s.getSettings(),
        s.getInterventions({ ...w, grouped: '0' }),
        s.getInterventions({ ...w, grouped: '1' }),
        s.getTargets(),
        s.getActions(),
        s.listImports(),
        s.getRange(),
        s.getStaffing(),
      ])
      setSettings(set)
      setInterventions(itv)
      setGrouped(grp)
      setTargets(tg)
      setActions(ac)
      setImports(im)
      setRange(rg)
      setStaffing(st)
    } catch (e) {
      console.error(e)
      setToast(String(e.message || e))
    } finally {
      setChargement(false)
    }
  }, [])

  // ---- Jours travaillés — rechargés quand la revue change de semaine ------
  const [periodeJours, setPeriodeJours] = useState(() => isoWeekKey(new Date()))

  useEffect(() => {
    if (!pret) return
    getStore().getWorkedDays(periodeJours).then(setWorkedDays).catch(() => setWorkedDays({}))
  }, [pret, periodeJours])

  // ---- Actions utilisateur ------------------------------------------------

  const saveSettings = async (key, value) => {
    await getStore().putSetting(key, value)
    setSettings((s) => ({ ...s, [key]: value }))
  }

  const onImport = async (payload) => {
    await getStore().saveImport(payload)
    await chargerTout()
  }

  const onDeleteImport = async (id) => {
    await getStore().deleteImport(id)
    await chargerTout()
  }

  const onSaveTarget = async (t) => {
    await getStore().putTarget(t)
    setTargets(await getStore().getTargets())
    setToast('Cible enregistrée')
  }

  const onDeleteTarget = async (id) => {
    await getStore().deleteTarget(id)
    setTargets(await getStore().getTargets())
  }

  const onAddAction = async (a) => {
    try {
      await getStore().addAction(a)
      setActions(await getStore().getActions())
      setToast('Action enregistrée')
    } catch (e) { setToast(String(e.message || e)) }
  }

  const onPatchAction = async (id, patch) => {
    await getStore().patchAction(id, patch)
    setActions(await getStore().getActions())
  }

  const onDeleteAction = async (id) => {
    await getStore().deleteAction(id)
    setActions(await getStore().getActions())
  }

  const onSaveStaffing = async (day, headcount) => {
    await getStore().putStaffing(day, headcount)
    setStaffing(await getStore().getStaffing())
  }

  const onSaveWorkedDays = async (period, map) => {
    await getStore().putWorkedDays(period, map)
    if (period === periodeJours) setWorkedDays(map)
    setToast('Jours travaillés enregistrés')
  }

  const staffingDuJour = useMemo(() => {
    const j = dayKey(new Date())
    return staffing.find((s) => String(s.day).slice(0, 10) === j) || null
  }, [staffing])

  // ---- Rendu --------------------------------------------------------------

  if (!pret) return <Splash />

  if (authRequis && !user) {
    return <Login onSuccess={async (u) => { setUser(u); await chargerTout(); setPret(true) }} />
  }

  const props = {
    interventions, grouped, settings, targets, actions, workedDays,
    onSaveSettings: saveSettings, onSaveTarget, onDeleteTarget,
    onAddAction, onPatchAction, onDeleteAction, onSaveWorkedDays,
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        onglet={onglet} setOnglet={setOnglet} user={user} mode={mode}
        nbInterventions={interventions.length}
        actionsOuvertes={actions.filter((a) => a.status === 'ouverte').length}
        onLogout={() => { setToken(null); location.reload() }}
      />

      <main style={{ flex: 1, minWidth: 0, padding: '28px 32px 64px', maxWidth: 1440 }}>
        {chargement && <div style={{ position: 'fixed', top: 12, right: 24, zIndex: 50 }}
          className="pill pill-neutral">chargement…</div>}

        <div style={{ opacity: chargement ? 0.55 : 1, transition: 'opacity 150ms' }}>
          {onglet === 'realtime' && (
            <Realtime {...props} staffing={staffingDuJour} onSaveStaffing={onSaveStaffing} />
          )}
          {onglet === 'weekly' && (
            <Weekly {...props} actions={actions.filter((a) => a.screen === 'weekly')}
              targets={targets.filter((t) => t.screen === 'weekly')}
              onPeriodChange={setPeriodeJours} />
          )}
          {onglet === 'monthly' && (
            <Monthly {...props} actions={actions.filter((a) => a.screen === 'monthly')}
              targets={targets.filter((t) => t.screen === 'monthly')} />
          )}
          {onglet === 'import' && (
            <ImportScreen settings={settings} imports={imports} mode={mode}
              onImport={onImport} onDeleteImport={onDeleteImport} onSaveSettings={saveSettings} />
          )}
          {onglet === 'settings' && (
            <Settings settings={settings} onSaveSettings={saveSettings} range={range}
              imports={imports} mode={mode} user={user}
              onChangePassword={(c, n) => getStore().changePassword(c, n)} />
          )}
        </div>
      </main>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Sidebar({ onglet, setOnglet, user, mode, nbInterventions, actionsOuvertes, onLogout }) {
  return (
    <aside className="no-print" style={{
      width: 240, flexShrink: 0, background: '#fff',
      borderRight: '1px solid var(--color-border)',
      display: 'flex', flexDirection: 'column',
      position: 'sticky', top: 0, height: '100vh',
    }}>
      <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid var(--color-border)' }}>
        <img src="/logo.svg" alt="Montpellier Dépannage" style={{ width: '100%', maxWidth: 190, display: 'block' }} />
        <div className="md-overline" style={{ marginTop: 12, letterSpacing: '0.14em' }}>Cockpit</div>
      </div>

      <nav style={{ padding: 12, flex: 1 }}>
        {ONGLETS.map((o) => {
          const actif = onglet === o.id
          return (
            <button key={o.id} onClick={() => setOnglet(o.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '10px 12px', marginBottom: 2, textAlign: 'left',
                border: 'none', borderRadius: 'var(--radius-md)',
                background: actif ? 'var(--md-forest-600)' : 'transparent',
                color: actif ? '#fff' : 'var(--color-text)',
                fontWeight: actif ? 600 : 500, fontSize: 14,
                transition: 'background 150ms var(--ease-standard)',
              }}
              onMouseEnter={(e) => !actif && (e.currentTarget.style.background = 'var(--md-forest-50)')}
              onMouseLeave={(e) => !actif && (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ opacity: actif ? 1 : 0.55, fontSize: 13 }}>{o.marker}</span>
              <span>{o.label}</span>
              {o.id === 'weekly' && actionsOuvertes > 0 && (
                <span style={{
                  marginLeft: 'auto', background: actif ? 'rgba(255,255,255,0.22)' : 'var(--md-signal-300)',
                  color: actif ? '#fff' : 'var(--md-stone-900)',
                  borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 700,
                }}>{actionsOuvertes}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div style={{ padding: 16, borderTop: '1px solid var(--color-border)' }}>
        <div className="md-small">{nb(nbInterventions)} interventions chargées</div>
        <div className="md-small" style={{ marginTop: 2 }}>
          {mode === 'remote' ? 'Serveur Cockpit' : 'Poste local'}
        </div>
        {user && mode === 'remote' && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="md-small" style={{ fontWeight: 600, color: 'var(--color-text)' }}>
              {user.displayName || user.username}
            </span>
            <div className="spacer" />
            <button className="btn btn-quiet btn-sm" onClick={onLogout}>Quitter</button>
          </div>
        )}
      </div>
    </aside>
  )
}

function Splash() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', gap: 20 }}>
      <img src="/logo.svg" alt="Montpellier Dépannage" style={{ width: 240 }} />
      <Spinner label="Ouverture du Cockpit…" />
    </div>
  )
}

function Login({ onSuccess }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const soumettre = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const user = await getStore().login(u, p)
      onSuccess(user)
    } catch (e2) {
      setErr(String(e2.message || e2))
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <form onSubmit={soumettre} className="card" style={{ width: 380, padding: 32 }}>
        <img src="/logo.svg" alt="Montpellier Dépannage" style={{ width: '100%', marginBottom: 6 }} />
        <div className="md-overline" style={{ textAlign: 'center', letterSpacing: '0.16em', marginBottom: 24 }}>
          Cockpit
        </div>

        <div className="grid" style={{ gap: 14 }}>
          <label style={{ display: 'grid', gap: 5 }}>
            <span className="md-label">Identifiant</span>
            <input value={u} onChange={(e) => setU(e.target.value)} autoFocus autoComplete="username" />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span className="md-label">Mot de passe</span>
            <input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
          </label>
          {err && <div className="md-small" style={{ color: 'var(--md-danger)', fontWeight: 600 }}>{err}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy || !u || !p}
            style={{ justifyContent: 'center', marginTop: 4 }}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </div>
      </form>
    </div>
  )
}
