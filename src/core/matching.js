/**
 * APPARIEMENT DES NOMS — PowerPanne ↔ DepanTime
 * =========================================================================
 * Les deux applicatifs ne nomment pas les dépanneurs de la même façon :
 *
 *   PowerPanne (nom d'onglet)  « Dylan Roux (droux) », « Ronan THUAL »
 *   DepanTime (fiche salarié)  { nom: "ROUX", prenom: "Dylan" }
 *
 * S'y ajoutent les inversions prénom/nom, les fautes de frappe récurrentes
 * (THUAL/THURAL, COMELLI/COMELI, OZAZDIN/OZAYDIN) et les initiales seules.
 *
 * La logique est reprise de `src/payroll.js` de DepanTime, où elle est
 * éprouvée sur le fichier réel — mêmes règles de score, même distance
 * d'édition, même refus de trancher en cas d'égalité. Garder les deux
 * implémentations cohérentes : si l'une est corrigée, l'autre doit suivre.
 *
 * Module pur : aucune dépendance, testable dans Node.
 */

/** Minuscules, sans accents, sans ponctuation. */
export function normNom(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Découpe en mots signifiants, en retirant le trigramme entre parenthèses. */
export function nameTokens(s) {
  return normNom(String(s ?? '').replace(/\([^)]*\)/g, ''))
    .split(' ')
    .filter((t) => t.length > 0 && !PARTICULES.has(t))
}

const PARTICULES = new Set(['de', 'du', 'da', 'le', 'la', 'el', 'di', 'van', 'von'])

/** Distance de Levenshtein, bornée par la longueur du plus long mot. */
export function editDistance(a, b) {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = cur
  }
  return prev[n]
}

function tokensMatch(a, b) {
  if (a === b) return true
  // Une initiale (« FACON L ») reconnaît le prénom correspondant (« Laura Facon »).
  if (a.length === 1 || b.length === 1) return a[0] === b[0]
  // Au-delà de cinq lettres, une faute de frappe est tolérée.
  if (a.length >= 5 && b.length >= 5) return editDistance(a, b) <= 1
  return false
}

/** Le nom de famille pèse plus lourd que le prénom. */
function matchScore(tokens, emp) {
  const empNom = nameTokens(emp.nom)
  const empPrenom = nameTokens(emp.prenom)
  if (!empNom.length) return 0
  let score = 0
  if (tokens.some((t) => tokensMatch(t, empNom[0]))) score += 10
  for (const t of empNom.slice(1)) if (tokens.some((d) => tokensMatch(d, t))) score += 2
  for (const t of empPrenom) if (tokens.some((d) => tokensMatch(d, t))) score += 3
  return score
}

/**
 * Rapproche un dépanneur PowerPanne d'une fiche DepanTime.
 * @returns {{employeeId, auto, fromAlias, candidates}} — `auto` faux quand le
 *   choix est ambigu : c'est alors à l'utilisateur de trancher.
 */
export function matchDepanneur(nomPowerPanne, employees, aliases = {}) {
  const cle = normNom(nomPowerPanne)
  if (aliases[cle]) {
    const connu = employees.find((e) => String(e.id) === String(aliases[cle]))
    if (connu) return { employeeId: connu.id, auto: true, fromAlias: true, candidates: [] }
  }
  const tokens = nameTokens(nomPowerPanne)
  if (!tokens.length) return { employeeId: null, auto: false, fromAlias: false, candidates: [] }

  const notes = employees.map((e) => ({ e, s: matchScore(tokens, e) }))
  const best = notes.reduce((m, x) => Math.max(m, x.s), 0)
  // Sans le nom de famille (10 points), le rapprochement n'est pas fiable.
  if (best < 10) return { employeeId: null, auto: false, fromAlias: false, candidates: [] }

  const gagnants = notes.filter((x) => x.s === best).map((x) => x.e)
  if (gagnants.length === 1) {
    return { employeeId: gagnants[0].id, auto: true, fromAlias: false, candidates: [] }
  }
  return { employeeId: null, auto: false, fromAlias: false, candidates: gagnants }
}

/**
 * Apparie l'ensemble des dépanneurs d'un import aux fiches DepanTime.
 *
 * Règle de sûreté héritée de DepanTime : si deux noms PowerPanne différents
 * désignent automatiquement la même fiche (le cas Safir / Ilies Bouhajra),
 * les deux repassent en manuel. Attribuer les mêmes jours travaillés à deux
 * personnes fausserait leur CA par jour, et silencieusement.
 *
 * @returns {{
 *   resolus: Record<string, {employeeId, label, jours, heures}>,
 *   manuels: Array<{depanneur, candidates}>,
 *   inutilises: Array<object>
 * }}
 */
export function apparier(depanneursPowerPanne, employees, aliases = {}) {
  const brut = new Map()
  for (const nom of depanneursPowerPanne) {
    brut.set(nom, matchDepanneur(nom, employees, aliases))
  }

  // Détection des collisions : on compte TOUTES les fiches attribuées, alias
  // compris. Un alias posé sur une fiche l'occupe : un rapprochement
  // automatique qui viserait la même repasse en manuel, sinon les jours
  // travaillés d'une personne se retrouveraient sur deux dépanneurs.
  const compte = new Map()
  const parAlias = new Set()
  for (const [, r] of brut) {
    if (r.employeeId == null) continue
    const id = String(r.employeeId)
    compte.set(id, (compte.get(id) || 0) + 1)
    if (r.fromAlias) parAlias.add(id)
  }

  const resolus = {}
  const manuels = []
  const pris = new Set()

  for (const [nom, r] of brut) {
    // Le choix explicite de l'utilisateur l'emporte ; c'est le rapprochement
    // deviné qui cède.
    const collision =
      r.employeeId != null &&
      compte.get(String(r.employeeId)) > 1 &&
      !r.fromAlias
    if (r.employeeId != null && !collision) {
      const emp = employees.find((e) => String(e.id) === String(r.employeeId))
      resolus[nom] = {
        employeeId: r.employeeId,
        label: emp ? `${emp.prenom || ''} ${emp.nom || ''}`.trim() : String(r.employeeId),
        fromAlias: r.fromAlias,
      }
      pris.add(String(r.employeeId))
    } else {
      manuels.push({
        depanneur: nom,
        raison: collision ? 'collision' : r.candidates.length ? 'ambigu' : 'introuvable',
        candidates: (collision
          ? employees.filter((e) => String(e.id) === String(r.employeeId))
          : r.candidates
        ).map((e) => ({ id: e.id, label: `${e.prenom || ''} ${e.nom || ''}`.trim() })),
      })
    }
  }

  return {
    resolus,
    manuels,
    inutilises: employees.filter((e) => !pris.has(String(e.id))),
  }
}
