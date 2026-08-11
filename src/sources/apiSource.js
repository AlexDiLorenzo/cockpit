/**
 * SOURCE — API PowerPanne
 * =========================================================================
 * PowerPanne n'expose pas encore d'API. Cet adaptateur est en place et
 * respecte déjà le contrat de source : le jour où l'API existe, il suffit de
 * renseigner l'URL et le jeton dans Réglages, d'ajuster `mapRecord()` aux
 * noms de champs réellement renvoyés, et l'application bascule sans qu'une
 * seule ligne de calcul ne bouge.
 *
 * Le proxy passe par le backend Cockpit (`/api/powerpanne/interventions`)
 * afin que le jeton d'API ne transite jamais par le navigateur.
 */

export const apiSource = {
  id: 'api',
  label: 'API PowerPanne',
  needs: 'none',
  available: false, // passera à true quand l'API sera ouverte

  /**
   * @param {{from?: string, to?: string}} input  bornes de période, AAAA-MM-JJ
   */
  async load(input = {}, opts = {}) {
    const progress = opts.onProgress || (() => {})
    progress({ step: 'Interrogation de PowerPanne', pct: 10 })

    const qs = new URLSearchParams()
    if (input.from) qs.set('from', input.from)
    if (input.to) qs.set('to', input.to)

    const res = await fetch(`/api/powerpanne/interventions?${qs}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`API PowerPanne indisponible (${res.status}) ${txt}`.trim())
    }
    const payload = await res.json()
    progress({ step: 'Conversion', pct: 70 })

    const records = Array.isArray(payload) ? payload : payload.items || []
    const rows = records.map(mapRecord)
    const headers = rows.length ? Object.keys(rows[0]) : []

    return {
      headers,
      rows,
      sheets: [],
      meta: {
        sourceId: 'api',
        label: `API PowerPanne ${input.from || ''}→${input.to || ''}`.trim(),
        fetchedAt: new Date().toISOString(),
      },
    }
  },
}

/**
 * Convertit un enregistrement d'API en ligne « à la PowerPanne ».
 *
 * On reproduit volontairement les libellés de l'export Excel : le schéma
 * canonique les reconnaît déjà, donc aucun mapping supplémentaire n'est
 * nécessaire. Si l'API nomme ses champs autrement, c'est ici — et
 * uniquement ici — que la traduction se fait.
 */
export function mapRecord(r) {
  return {
    "Origine d'appel": r.origineAppel ?? r.origine ?? null,
    'Numéro de dossier': r.numeroDossier ?? r.dossier ?? null,
    'Numéro de mission': r.numeroMission ?? r.mission ?? null,
    'Dépanneur': r.depanneur ?? r.chauffeur ?? null,
    "Type d'intervention": r.typeIntervention ?? null,
    'Agence': r.agence ?? null,
    'Véhicule utilisé': r.vehiculeUtilise ?? null,
    'Type de véhicule utilisé': r.typeVehiculeUtilise ?? null,
    'Genre': r.genre ?? null,
    'Immat': r.immatriculation ?? null,
    'Marque': r.marque ?? null,
    'Modèle': r.modele ?? null,
    'Lieux de prise en charge': r.lieuPriseEnCharge ?? null,
    'Lieux de dépot': r.lieuDepot ?? null,
    "Opérateur d'affectation": r.operateurAffectation ?? null,
    'Rendez-vous': bool(r.rendezVous),
    'Raison du DPR': r.raisonDPR ?? null,
    'Non Payant': bool(r.nonPayant),
    'Scénario respecté pour la géolocalisation': bool(r.geolocalisationRespectee),
    'Nombre de photos prises': r.nombrePhotos ?? 0,
    'Envoi du CRO': r.dateEnvoiCRO ?? null,
    'Nombre de KMS Roulés': r.kmRoules ?? 0,
    'Temps déclaratif, en minutes': r.tempsDeclaratifMinutes ?? 0,
    'Total HT': r.totalHT ?? 0,
    'Total TTC': r.totalTTC ?? 0,
    'Prestation HT': r.prestationHT ?? 0,
    'Montant majoré HT': r.montantMajoreHT ?? 0,
    '% de majoration': r.tauxMajoration ?? null,
    'Frais de parc': r.fraisParc ?? 0,
    'Pièces HT': r.piecesHT ?? 0,
    'Avances de frais': r.avancesFrais ?? 0,
    'Montant Assistance HT': r.montantAssistanceHT ?? 0,
    'Montant Sociétaire HT': r.montantSocietaireHT ?? 0,
    'Coût de revient': r.coutDeRevient ?? null,
    'Date de facturation': r.dateFacturation ?? null,
    'Factures': r.factures ?? null,
    "Mode d'encaissement": r.modeEncaissement ?? null,
    'Entité à facturer du dossier': r.entiteFacturee ?? null,
    'Date de première affectation': r.datePremiereAffectation ?? null,
    "Date d'acceptation (mobile)": r.dateAcceptationMobile ?? r.dateAcceptation ?? null,
    'Date de départ pour intervention (mobile)': r.dateDepartPourInterventionMobile ?? null,
    "Date d'arrivée sur lieu d'intervention (mobile)": r.dateArriveeMobile ?? r.dateArrivee ?? null,
    "Date de départ du lieu d'intervention (mobile)": r.dateDepartLieuMobile ?? null,
    'Date de fin (mobile)': r.dateFinMobile ?? r.dateFin ?? null,
    "Heure d'appel": r.heureAppel ?? null,
  }
}

function bool(v) {
  if (v == null) return null
  return v === true || v === 'OUI' || v === 1 ? 'OUI' : 'NON'
}
