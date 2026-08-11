/**
 * SOURCES DE DONNÉES
 * =========================================================================
 * Contrat unique auquel toute source doit se conformer :
 *
 *   {
 *     id:    'xlsx' | 'api' | …
 *     label: string
 *     needs: 'file' | 'none'
 *     load(input, opts) => Promise<RawDataset>
 *   }
 *
 *   RawDataset = {
 *     headers: string[],            // libellés de colonnes, tels quels
 *     rows: Array<Record<string, any>>,
 *     sheets?: Array<{name, rows, totalRows}>,
 *     meta: { sourceId, label, fetchedAt, ... }
 *   }
 *
 * Une source ne nettoie rien et ne calcule rien : elle produit des lignes
 * brutes. Le nettoyage vit dans core/normalize.js, les calculs dans
 * core/metrics.js. Passer de l'Excel à l'API PowerPanne consiste donc à
 * changer de source, sans toucher aux indicateurs.
 */

import { xlsxSource } from './xlsxSource.js'
import { apiSource } from './apiSource.js'

export const SOURCES = [xlsxSource, apiSource]

export function getSource(id) {
  return SOURCES.find((s) => s.id === id) || xlsxSource
}

export { xlsxSource, apiSource }
