/**
 * SOURCE — export Excel PowerPanne « Historique dépanneur »
 * =========================================================================
 * Un onglet par dépanneur, colonnes identiques dans chaque onglet, une ligne
 * par intervention, plus une ligne de total par onglet.
 *
 * Le fichier est lu dans le navigateur : rien n'est téléversé tant que
 * l'utilisateur n'a pas validé l'aperçu.
 */

// SheetJS n'est chargé qu'au moment du premier import : il pèse à lui seul
// plus que tout le reste de l'application, et les écrans de pilotage n'en
// ont pas besoin.
let XLSX = null
async function loadXLSX() {
  if (!XLSX) XLSX = await import('xlsx')
  return XLSX
}

/** Onglets à ne pas consolider (aucun aujourd'hui, réglable si besoin). */
const SKIP_SHEETS = []

/** Colonne synthétique portant le nom de dépanneur tiré du nom d'onglet. */
export const SHEET_COLUMN = 'Dépanneur (onglet)'

export const xlsxSource = {
  id: 'xlsx',
  label: 'Fichier Excel PowerPanne',
  needs: 'file',

  /**
   * @param {File|ArrayBuffer} input
   * @param {{onProgress?: (p:{step:string, pct:number}) => void}} opts
   */
  async load(input, opts = {}) {
    const progress = opts.onProgress || (() => {})
    progress({ step: 'Lecture du fichier', pct: 5 })

    const XLSX = await loadXLSX()
    const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer()
    progress({ step: 'Ouverture du classeur', pct: 15 })

    const wb = XLSX.read(buf, { type: 'array', cellDates: true, cellNF: false, cellText: false })

    const sheetNames = wb.SheetNames.filter((n) => !SKIP_SHEETS.includes(n))
    const rows = []
    const sheets = []
    let headers = null

    sheetNames.forEach((name, idx) => {
      const ws = wb.Sheets[name]
      if (!ws) return

      // `defval: null` conserve les cellules vides, sinon les colonnes
      // manquantes disparaissent des objets et faussent la détection.
      const json = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, blankrows: false })
      if (!json.length) {
        sheets.push({ name, rows: 0, totalRows: 0 })
        return
      }

      const sheetHeaders = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 })[0] || []
      if (!headers) {
        headers = sheetHeaders.map((h) => String(h ?? '').trim()).filter(Boolean)
        headers.push(SHEET_COLUMN)
      }

      // L'onglet porte le nom complet du dépanneur (« Dylan Roux (droux) »)
      // là où la colonne « Dépanneur » abrège en « Dylan R ». On promeut le
      // nom d'onglet en colonne à part entière : le schéma la préfère, et
      // une source sans onglets (l'API) retombera sur « Dépanneur ».
      const nom = depanneurFromSheet(name)
      let kept = 0
      for (const r of json) {
        r.__sheet = name
        r[SHEET_COLUMN] = nom
        rows.push(r)
        kept++
      }
      sheets.push({ name, rows: kept, totalRows: 0 })
      progress({ step: `Onglet ${idx + 1}/${sheetNames.length}`, pct: 15 + (70 * (idx + 1)) / sheetNames.length })
    })

    progress({ step: 'Consolidation', pct: 90 })

    return {
      headers: headers || [],
      rows,
      sheets,
      meta: {
        sourceId: 'xlsx',
        label: input.name || 'classeur.xlsx',
        fetchedAt: new Date().toISOString(),
        sheetCount: sheetNames.length,
      },
    }
  },
}

/** Nom complet du dépanneur déduit du nom d'onglet : « Dylan Roux (droux) ». */
export function depanneurFromSheet(sheetName) {
  if (!sheetName) return null
  return String(sheetName).replace(/\s*\([^)]*\)?\s*$/, '').trim() || sheetName
}
