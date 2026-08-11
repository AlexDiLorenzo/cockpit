/**
 * BASE DE DONNÉES — Cockpit
 * =========================================================================
 * Postgres. Le schéma est créé au démarrage s'il n'existe pas.
 *
 * Deux familles de tables :
 *   — les données importées (`imports`, `interventions`) : remplacées à
 *     chaque import, mais historisées pour reconstituer les courbes sur
 *     8 semaines et 12 mois ;
 *   — les données saisies (`targets`, `actions`, `settings`, `staffing`,
 *     `worked_days`) : elles survivent aux imports, c'est leur raison d'être.
 */

import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg

export const pool = new Pool({
  host: process.env.CK_DB_HOST || 'localhost',
  port: Number(process.env.CK_DB_PORT || 5432),
  user: process.env.CK_DB_USER || 'cockpit',
  password: process.env.CK_DB_PASSWORD || 'cockpit',
  database: process.env.CK_DB_NAME || 'cockpit',
  max: 10,
})

export async function query(sql, params) {
  return pool.query(sql, params)
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'comite',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un import = un dépôt de fichier (ou un appel d'API). Le rapport de
-- nettoyage est conservé : il justifie les lignes écartées.
CREATE TABLE IF NOT EXISTS imports (
  id             SERIAL PRIMARY KEY,
  source_id      TEXT NOT NULL,
  label          TEXT NOT NULL,
  period_start   DATE,
  period_end     DATE,
  rows_source    INTEGER NOT NULL DEFAULT 0,
  rows_kept      INTEGER NOT NULL DEFAULT 0,
  rows_grouped   INTEGER NOT NULL DEFAULT 0,
  report         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une ligne = une MISSION. Un même numéro de dossier peut en porter
-- plusieurs (…OM1, …OM2), confiées à des dépanneurs différents.
CREATE TABLE IF NOT EXISTS interventions (
  mission_key    TEXT PRIMARY KEY,
  import_id      INTEGER REFERENCES imports(id) ON DELETE SET NULL,
  ref_date       TIMESTAMPTZ,
  day_key        DATE,
  week_key       TEXT,
  month_key      TEXT,
  depanneur      TEXT,
  origine        TEXT,
  type_interv    TEXT,
  vehicule       TEXT,
  total_ht       NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_grouped     BOOLEAN NOT NULL DEFAULT FALSE,
  data           JSONB NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_interv_day   ON interventions(day_key);
CREATE INDEX IF NOT EXISTS idx_interv_week  ON interventions(week_key);
CREATE INDEX IF NOT EXISTS idx_interv_month ON interventions(month_key);
CREATE INDEX IF NOT EXISTS idx_interv_group ON interventions(is_grouped);

-- Cibles posées en comité : un indicateur, éventuellement une déclinaison
-- (par origine d'appel par exemple), une valeur et une échéance.
CREATE TABLE IF NOT EXISTS targets (
  id           SERIAL PRIMARY KEY,
  screen       TEXT NOT NULL,
  metric_key   TEXT NOT NULL,
  dimension    TEXT NOT NULL DEFAULT '',
  value        NUMERIC(14,4) NOT NULL,
  due_date     DATE,
  owner        TEXT,
  note         TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (screen, metric_key, dimension)
);

-- Actions du comité : trois au plus par rituel et par période, retrouvées
-- en tête d'écran au comité suivant.
CREATE TABLE IF NOT EXISTS actions (
  id           SERIAL PRIMARY KEY,
  screen       TEXT NOT NULL,
  period_key   TEXT NOT NULL,
  label        TEXT NOT NULL,
  owner        TEXT,
  due_date     DATE,
  evidence     TEXT,
  metric_key   TEXT,
  status       TEXT NOT NULL DEFAULT 'ouverte',
  closed_at    TIMESTAMPTZ,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_actions_screen ON actions(screen, period_key);

-- Réglages libres : seuils d'alerte, paramètres de coût, effectifs.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dépanneurs en service, par jour (saisie manuelle ; viendra du pointage).
CREATE TABLE IF NOT EXISTS staffing (
  day        DATE PRIMARY KEY,
  headcount  INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Jours travaillés par dépanneur et par période (saisie manuelle ; idem).
CREATE TABLE IF NOT EXISTS worked_days (
  period_key TEXT NOT NULL,
  depanneur  TEXT NOT NULL,
  days       NUMERIC(6,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period_key, depanneur)
);
`

/** Réglages livrés par défaut — modifiables depuis l'écran Réglages. */
const DEFAULT_SETTINGS = {
  thresholds: {
    nonAffecteMin: 10, nonAffecteAlerte: 3,
    retardMin: 45, retardAlerte: 5,
    chargeAlerte: 3, trajectoireAlerte: -10, anomaliesAlerte: 10,
    nuitDebut: 19, nuitFin: 8,
  },
  costs: {
    coutHoraireCharge: 28,
    coutKmDefaut: 0.45,
    coutKmParVehicule: {},
    baseTemps: 'declaratif',
    heuresPayees: {},
  },
  owners: {
    delai_acceptation: '', sla: '', non_factures: '', dpr_imputables: '',
    ca_jour_depanneur: '', conformite: '',
    ca_operationnel: '', marge_intervention: '', ca_heure_payee: '',
    cout_pertes: '', taux_marge: '',
  },
  import: { groupedBillingThreshold: 3000, overrides: {} },
  depantime: { siteId: null, aliases: {} },
}

export async function initDB() {
  await pool.query(SCHEMA)

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await pool.query(
      `INSERT INTO settings(key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)]
    )
  }

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users')
  if (rows[0].n === 0) {
    const pass = process.env.CK_DEFAULT_PASSWORD || 'cockpit'
    const hash = bcrypt.hashSync(pass, 10)
    await pool.query(
      `INSERT INTO users(username, display_name, password_hash, role)
       VALUES ($1, $2, $3, 'admin')`,
      ['admin', 'Administrateur', hash]
    )
    console.log(`[cockpit] compte « admin » créé (mot de passe : ${pass})`)
  }

  // Purge : au-delà de 14 mois, les interventions ne servent plus aucune
  // courbe (8 semaines et 12 mois sont les horizons les plus longs).
  const months = Number(process.env.CK_RETENTION_MONTHS || 14)
  await pool.query(
    `DELETE FROM interventions WHERE ref_date < now() - ($1 || ' months')::interval`,
    [months]
  )

  console.log('[cockpit] base prête')
}
