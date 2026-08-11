/**
 * SCHÉMA CANONIQUE — Cockpit
 * =========================================================================
 * Ce fichier est le seul endroit qui connaît les noms de colonnes de la
 * source. Tout le reste de l'application (normalize, metrics, écrans) ne
 * manipule que le modèle canonique décrit ici.
 *
 * Brancher une nouvelle source (API PowerPanne, autre export) revient à
 * produire des lignes brutes `{ [nomDeColonne]: valeur }` et, si les noms
 * diffèrent, à ajouter les variantes dans `aliases`. Aucun calcul n'est à
 * réécrire.
 *
 * Aucune dépendance : ce module tourne dans le navigateur comme dans Node.
 */

/** Normalise un libellé de colonne pour la comparaison :
 *  minuscules, sans accents, sans ponctuation, espaces réduits. */
export function normKey(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Type des champs canoniques :
 *   text | num | int | date | bool | raw
 *
 * `aliases` : libellés acceptés dans la source, par ordre de préférence.
 * Le premier trouvé gagne. La comparaison passe par normKey(), donc les
 * accents, apostrophes et casse sont indifférents.
 */
export const FIELDS = [
  // --- Identité ------------------------------------------------------
  { key: 'missionNo',  label: 'Numéro de mission', type: 'text', required: true,
    aliases: ['Numéro de mission', 'N° de mission', 'Numero de mission'] },
  { key: 'dossierNo',  label: 'Numéro de dossier', type: 'text', required: true,
    aliases: ['Numéro de dossier', 'N° de dossier', 'Numero de dossier'] },
  // Le nom d'onglet, quand il existe, est plus complet que la colonne
  // « Dépanneur » (« Dylan Roux » contre « Dylan R ») : il passe en premier.
  { key: 'depanneur',  label: 'Dépanneur', type: 'text', required: true,
    aliases: ['Dépanneur (onglet)', 'Dépanneur', 'Depanneur', 'Chauffeur'] },

  // --- Qualification --------------------------------------------------
  { key: 'origine',    label: "Origine d'appel", type: 'text', required: true,
    aliases: ["Origine d'appel", 'Origine appel', 'Convention'] },
  { key: 'typeIntervention', label: "Type d'intervention", type: 'text', required: true,
    aliases: ["Type d'intervention", 'Type intervention'] },
  { key: 'agence',     label: 'Agence', type: 'text', aliases: ['Agence'] },
  { key: 'vehicule',   label: 'Véhicule utilisé', type: 'text',
    aliases: ['Véhicule utilisé', 'Vehicule utilise', 'Immatriculation véhicule'] },
  { key: 'typeVehicule', label: 'Type de véhicule utilisé', type: 'text',
    aliases: ['Type de véhicule utilisé', 'Type de vehicule utilise'] },
  { key: 'genre',      label: 'Genre du véhicule client', type: 'text', aliases: ['Genre'] },
  { key: 'immat',      label: 'Immatriculation client', type: 'text', aliases: ['Immat', 'Immatriculation'] },
  { key: 'marque',     label: 'Marque', type: 'text', aliases: ['Marque'] },
  { key: 'modele',     label: 'Modèle', type: 'text', aliases: ['Modèle', 'Modele'] },
  { key: 'lieuPriseEnCharge', label: 'Lieu de prise en charge', type: 'text',
    aliases: ['Lieux de prise en charge', "Lieu d'intervention", 'Lieu de prise en charge'] },
  { key: 'lieuDepot',  label: 'Lieu de dépôt', type: 'text',
    aliases: ['Lieux de dépot', 'Lieux de dépôt', 'Lieu de destination'] },
  { key: 'operateurAffectation', label: "Opérateur d'affectation", type: 'text',
    aliases: ["Opérateur d'affectation"] },

  // --- Drapeaux métier -------------------------------------------------
  { key: 'rendezVous', label: 'Rendez-vous', type: 'bool', required: true,
    aliases: ['Rendez-vous', 'Rendez vous', 'Transformé en Rendez-vous'] },
  { key: 'raisonDPR',  label: 'Raison du DPR', type: 'text', required: true,
    aliases: ['Raison du DPR'] },
  { key: 'nonPayant',  label: 'Non payant', type: 'bool', aliases: ['Non Payant'] },
  { key: 'geoRespectee', label: 'Scénario géolocalisation', type: 'text', required: true,
    aliases: ['Scénario respecté pour la géolocalisation', 'Scenario respecte pour la geolocalisation'] },
  { key: 'nbPhotos',   label: 'Nombre de photos prises', type: 'int', required: true,
    aliases: ['Nombre de photos prises', 'Nombre de photos'] },
  { key: 'croEnvoye',  label: 'Envoi du CRO', type: 'date', required: true,
    aliases: ['Envoi du CRO', 'Date envoi CRO'] },

  // --- Volumétrie ------------------------------------------------------
  { key: 'km',         label: 'Kilomètres roulés', type: 'num',
    aliases: ['Nombre de KMS Roulés', 'Nombre de KMS Roules', 'Km GPS', 'Kms roulés'] },
  { key: 'tempsDeclaratifMin', label: 'Temps déclaratif (min)', type: 'num',
    aliases: ['Temps déclaratif, en minutes', 'Temps declaratif en minutes'] },

  // --- Argent -----------------------------------------------------------
  { key: 'totalHT',    label: 'Total HT', type: 'num', required: true, aliases: ['Total HT'] },
  { key: 'totalTTC',   label: 'Total TTC', type: 'num', aliases: ['Total TTC'] },
  { key: 'prestationHT', label: 'Prestation HT', type: 'num', aliases: ['Prestation HT'] },
  { key: 'montantMajoreHT', label: 'Montant majoré HT', type: 'num', required: true,
    aliases: ['Montant majoré HT', 'Montant majore HT'] },
  { key: 'tauxMajoration', label: '% de majoration', type: 'text', aliases: ['% de majoration'] },
  { key: 'fraisParc',  label: 'Frais de parc', type: 'num', aliases: ['Frais de parc'] },
  { key: 'piecesHT',   label: 'Pièces HT', type: 'num', aliases: ['Pièces HT', 'Pieces HT'] },
  { key: 'avancesFrais', label: 'Avances de frais', type: 'num', aliases: ['Avances de frais'] },
  { key: 'montantAssistanceHT', label: 'Montant assistance HT', type: 'num', aliases: ['Montant Assistance HT'] },
  { key: 'montantSocietaireHT', label: 'Montant sociétaire HT', type: 'num',
    aliases: ['Montant Sociétaire HT', 'Montant Societaire HT'] },
  { key: 'coutDeRevient', label: 'Coût de revient', type: 'num', aliases: ['Coût de revient', 'Cout de revient'] },
  { key: 'dateFacturation', label: 'Date de facturation', type: 'dateOnlyMulti', required: true,
    aliases: ['Date de facturation'] },
  { key: 'factures',   label: 'Factures', type: 'text', aliases: ['Factures', 'Numéros de factures associés'] },
  { key: 'modeEncaissement', label: "Mode d'encaissement", type: 'text', aliases: ["Mode d'encaissement"] },
  { key: 'entiteFacturee', label: 'Entité à facturer', type: 'text', aliases: ['Entité à facturer du dossier'] },

  // --- Horodatages (mobile / web : remplis à ~100 %) ---------------------
  { key: 'dtPremiereAffectation', label: 'Date de première affectation', type: 'date', required: true,
    aliases: ['Date de première affectation', 'Date de premiere affectation'] },
  { key: 'dtAcceptation', label: "Date d'acceptation (mobile)", type: 'date', required: true,
    aliases: ["Date d'acceptation (mobile)", "Date d'acceptation (web)"] },
  { key: 'dtDepartPour', label: 'Date de départ pour intervention (mobile)', type: 'date',
    aliases: ['Date de départ pour intervention (mobile)', 'Date de départ pour intervention (web)'] },
  { key: 'dtArrivee', label: "Date d'arrivée sur lieu d'intervention (mobile)", type: 'date', required: true,
    aliases: ["Date d'arrivée sur lieu d'intervention (mobile)", "Date d'arrivée sur lieu d'intervention (web)"] },
  { key: 'dtDepartLieu', label: "Date de départ du lieu d'intervention (mobile)", type: 'date',
    aliases: ["Date de départ du lieu d'intervention (mobile)", "Date de départ du lieu d'intervention (web)"] },
  { key: 'dtFin', label: 'Date de fin (mobile)', type: 'date', required: true,
    aliases: ['Date de fin (mobile)', 'Date de fin (web)'] },
  { key: 'heureAppel', label: "Heure d'appel", type: 'date', aliases: ["Heure d'appel"] },
]

/** Colonnes volontairement ignorées : horodatages « (modifiée) », remplis à
 *  moins de 50 %, que le brief demande d'écarter au profit de mobile/web. */
export const IGNORED_PATTERNS = [/ modifiee$/, /^modifiee$/]

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]))

/**
 * Construit la table de correspondance entre les colonnes réellement
 * présentes dans la source et les champs canoniques.
 *
 * @param {string[]} headers  en-têtes lus dans la source
 * @param {object}   overrides  { champCanonique: 'Nom de colonne' } — réglage
 *                              manuel depuis l'écran Import
 * @returns {{ map: Record<string,string>, missing: object[], unused: string[], ignored: string[] }}
 */
export function buildMapping(headers, overrides = {}) {
  const byNorm = new Map()
  for (const h of headers) {
    const n = normKey(h)
    if (!byNorm.has(n)) byNorm.set(n, h)
  }

  const map = {}
  const used = new Set()

  for (const f of FIELDS) {
    const forced = overrides[f.key]
    if (forced && headers.includes(forced)) {
      map[f.key] = forced
      used.add(forced)
      continue
    }
    for (const a of f.aliases) {
      const hit = byNorm.get(normKey(a))
      if (hit) {
        map[f.key] = hit
        used.add(hit)
        break
      }
    }
  }

  const ignored = headers.filter((h) => IGNORED_PATTERNS.some((re) => re.test(normKey(h))))
  const missing = FIELDS.filter((f) => !map[f.key])
  const unused = headers.filter((h) => !used.has(h) && !ignored.includes(h))

  return { map, missing, unused, ignored }
}

/** Champs sans lesquels les indicateurs ne sont pas calculables. */
export function blockingMissing(missing) {
  return missing.filter((f) => f.required)
}
