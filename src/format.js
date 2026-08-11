/** Formatage — tout en français, chiffres en tabular numerals. */

const NF = new Intl.NumberFormat('fr-FR')
const NF1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const NF2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const EMPTY = '—'

export function nb(v, dec = 0) {
  if (v == null || !Number.isFinite(v)) return EMPTY
  return dec === 0 ? NF.format(Math.round(v)) : dec === 1 ? NF1.format(v) : NF2.format(v)
}

export function eur(v, dec = 0) {
  if (v == null || !Number.isFinite(v)) return EMPTY
  return `${nb(v, dec)} €`
}

/** Montants d'écran : 12,4 k€ au-delà de 10 000 €. */
export function eurShort(v) {
  if (v == null || !Number.isFinite(v)) return EMPTY
  if (Math.abs(v) >= 10000) return `${NF1.format(v / 1000)} k€`
  return eur(v)
}

export function pct(v, dec = 1) {
  if (v == null || !Number.isFinite(v)) return EMPTY
  return `${dec === 0 ? nb(v * 100) : NF1.format(v * 100)} %`
}

/** Durées : 37 min, 1 h 12, 2 j 04 h. */
export function minutes(v) {
  if (v == null || !Number.isFinite(v)) return EMPTY
  const s = v < 0 ? '−' : ''
  const m = Math.abs(v)
  if (m < 60) return `${s}${Math.round(m)} min`
  if (m < 1440) return `${s}${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`
  return `${s}${Math.floor(m / 1440)} j ${String(Math.floor((m % 1440) / 60)).padStart(2, '0')} h`
}

export function heure(d) {
  if (!d) return EMPTY
  const x = d instanceof Date ? d : new Date(d)
  if (isNaN(x)) return EMPTY
  return `${String(x.getHours()).padStart(2, '0')}h${String(x.getMinutes()).padStart(2, '0')}`
}

export function dateCourte(d) {
  if (!d) return EMPTY
  const x = d instanceof Date ? d : new Date(d)
  if (isNaN(x)) return EMPTY
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`
}

export function dateLongue(d) {
  if (!d) return EMPTY
  const x = d instanceof Date ? d : new Date(d)
  if (isNaN(x)) return EMPTY
  return x.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function dateISO(d) {
  const x = d instanceof Date ? d : new Date(d)
  if (isNaN(x)) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}

export const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
export const JOURS_COURT = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** « 2026-S28 » → « S28 », « 2026-07 » → « juil. 26 ». */
export function libellePeriode(key) {
  if (!key) return EMPTY
  if (key.includes('-S')) return key.split('-')[1]
  const [y, m] = key.split('-')
  if (m) return `${MOIS[Number(m) - 1].slice(0, 4)}. ${y.slice(2)}`
  return key
}

export function libellePeriodeLongue(key) {
  if (!key) return EMPTY
  if (key.includes('-S')) {
    const [y, s] = key.split('-')
    return `semaine ${s.slice(1)} de ${y}`
  }
  const [y, m] = key.split('-')
  if (m) return `${MOIS[Number(m) - 1]} ${y}`
  return key
}

/** Tronque un libellé long (les origines d'appel le sont beaucoup). */
export function court(s, n = 28) {
  if (!s) return EMPTY
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

/** Raison de DPR en clair. */
export function libelleDPR(r) {
  return {
    materiel_inapproprie: 'Matériel inapproprié',
    vehicule_non_trouve: 'Véhicule non trouvé',
    annulation_client: 'Annulation client',
  }[r] || r || EMPTY
}

export const STATUTS_ACTION = {
  ouverte: { label: 'À faire', pill: 'pill-neutral' },
  faite: { label: 'Faite', pill: 'pill-ok' },
  non_faite: { label: 'Non faite', pill: 'pill-danger' },
  bloquee: { label: 'Bloquée', pill: 'pill-warn' },
}
