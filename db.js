const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

loadEnvFile();

const schema = process.env.PGSCHEMA || "mktmood";
let pool = null;
let initPromise = null;
let dbStatus = {
  enabled: Boolean(process.env.PGHOST),
  ok: false,
  schema,
  lastError: null,
  lastWriteAt: null
};

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function getPool() {
  if (!process.env.PGHOST) return null;
  if (!pool) {
    pool = new Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000
    });
  }
  return pool;
}

async function initDb() {
  const activePool = getPool();
  if (!activePool) return dbStatus;
  if (!initPromise) {
    initPromise = createSchema(activePool).catch((error) => {
      dbStatus = { ...dbStatus, ok: false, lastError: error.message };
      initPromise = null;
      throw error;
    });
  }
  try {
    await initPromise;
    dbStatus = { ...dbStatus, enabled: true, ok: true, lastError: null };
  } catch {
    // The caller sees dbStatus; the app should continue serving data.
  }
  return dbStatus;
}

async function createSchema(activePool) {
  const schemaResult = await activePool.query(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1",
    [schema]
  );
  if (!schemaResult.rowCount) {
    await activePool.query(`CREATE SCHEMA ${q(schema)}`);
  }
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS ${qn("ingestion_runs")} (
      run_id text PRIMARY KEY,
      observed_at timestamptz NOT NULL,
      market_score numeric,
      regime_name text,
      regime_description text,
      source_status jsonb NOT NULL DEFAULT '{}'::jsonb,
      raw_snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS ${qn("indicator_observations")} (
      id bigserial PRIMARY KEY,
      run_id text NOT NULL REFERENCES ${qn("ingestion_runs")}(run_id) ON DELETE CASCADE,
      observed_at timestamptz NOT NULL,
      indicator_id text NOT NULL,
      name text NOT NULL,
      category text,
      source text,
      symbol text,
      status text,
      unit text,
      value numeric,
      change numeric,
      change_pct numeric,
      trend20 numeric,
      trend60 numeric,
      score numeric,
      state text,
      state_label text,
      source_updated_at text,
      reading text,
      raw jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS indicator_observations_lookup_idx
      ON ${qn("indicator_observations")} (indicator_id, observed_at DESC)
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS ${qn("indicator_history_points")} (
      indicator_id text NOT NULL,
      point_date date NOT NULL,
      value numeric NOT NULL,
      source text,
      observed_at timestamptz NOT NULL,
      raw jsonb NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (indicator_id, point_date)
    )
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS ${qn("indicator_signals")} (
      id bigserial PRIMARY KEY,
      run_id text NOT NULL REFERENCES ${qn("ingestion_runs")}(run_id) ON DELETE CASCADE,
      observed_at timestamptz NOT NULL,
      indicator_id text NOT NULL,
      indicator_name text NOT NULL,
      category text,
      signal_type text NOT NULL,
      direction text,
      severity text,
      label text,
      detail text,
      window_label text,
      value numeric,
      threshold numeric,
      raw jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS indicator_signals_lookup_idx
      ON ${qn("indicator_signals")} (observed_at DESC, indicator_id)
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS ${qn("event_observations")} (
      id bigserial PRIMARY KEY,
      run_id text NOT NULL REFERENCES ${qn("ingestion_runs")}(run_id) ON DELETE CASCADE,
      observed_at timestamptz NOT NULL,
      event_key text NOT NULL,
      event_type text NOT NULL,
      status text,
      event_date date,
      event_time text,
      days_until integer,
      title text,
      symbol text,
      company text,
      sector text,
      theme text,
      priority text,
      source text,
      expectation text,
      previous text,
      consensus text,
      forecast text,
      actual text,
      eps_forecast text,
      no_of_ests text,
      last_year_eps text,
      fiscal_quarter_ending text,
      market_cap text,
      why text,
      watch_text text,
      raw jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS event_observations_lookup_idx
      ON ${qn("event_observations")} (event_key, observed_at DESC)
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS event_observations_date_idx
      ON ${qn("event_observations")} (event_date, priority)
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS ${qn("equity_anomaly_observations")} (
      id bigserial PRIMARY KEY,
      run_id text NOT NULL REFERENCES ${qn("ingestion_runs")}(run_id) ON DELETE CASCADE,
      observed_at timestamptz NOT NULL,
      symbol text NOT NULL,
      name text,
      anomaly_type text,
      direction text,
      severity text,
      change_pct numeric,
      market_cap numeric,
      market_label text,
      exchange_label text,
      currency text,
      volume numeric,
      volume_ratio numeric,
      abnormal_move_ratio numeric,
      classification text,
      sector_label text,
      industry_label text,
      company_brief text,
      explanation text,
      raw jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await activePool.query(`ALTER TABLE ${qn("equity_anomaly_observations")} ADD COLUMN IF NOT EXISTS market_label text`);
  await activePool.query(`ALTER TABLE ${qn("equity_anomaly_observations")} ADD COLUMN IF NOT EXISTS exchange_label text`);
  await activePool.query(`ALTER TABLE ${qn("equity_anomaly_observations")} ADD COLUMN IF NOT EXISTS currency text`);
  await activePool.query(`ALTER TABLE ${qn("equity_anomaly_observations")} ADD COLUMN IF NOT EXISTS industry_label text`);
  await activePool.query(`ALTER TABLE ${qn("equity_anomaly_observations")} ADD COLUMN IF NOT EXISTS company_brief text`);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS equity_anomaly_lookup_idx
      ON ${qn("equity_anomaly_observations")} (observed_at DESC, symbol)
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS ${qn("sector_move_observations")} (
      id bigserial PRIMARY KEY,
      run_id text NOT NULL REFERENCES ${qn("ingestion_runs")}(run_id) ON DELETE CASCADE,
      observed_at timestamptz NOT NULL,
      symbol text NOT NULL,
      name text,
      group_name text,
      direction text,
      severity text,
      change_pct numeric,
      trend20 numeric,
      abnormal_move_ratio numeric,
      explanation text,
      raw jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS sector_move_lookup_idx
      ON ${qn("sector_move_observations")} (observed_at DESC, symbol)
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS ${qn("market_structure_observations")} (
      id bigserial PRIMARY KEY,
      run_id text NOT NULL REFERENCES ${qn("ingestion_runs")}(run_id) ON DELETE CASCADE,
      observed_at timestamptz NOT NULL,
      diagnosis_type text,
      diagnosis_label text,
      diagnosis_confidence numeric,
      fragility_level text,
      bottom_stage integer,
      bottom_label text,
      bottom_blocked boolean,
      confirmations_met integer,
      confirmations_available integer,
      raw jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS market_structure_lookup_idx
      ON ${qn("market_structure_observations")} (observed_at DESC, bottom_stage)
  `);
}

async function persistSnapshot(snapshot) {
  const activePool = getPool();
  if (!activePool) return dbStatus;
  try {
    await initDb();
    if (!dbStatus.ok) return dbStatus;
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const observedAt = snapshot.updatedAt;
    const client = await activePool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ${qn("ingestion_runs")}
          (run_id, observed_at, market_score, regime_name, regime_description, source_status, raw_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [
          runId,
          observedAt,
          toNumber(snapshot.marketScore),
          snapshot.regime?.name || null,
          snapshot.regime?.description || null,
          JSON.stringify(snapshot.upcomingEvents?.sourceStatus || {}),
          JSON.stringify(trimSnapshot(snapshot))
        ]
      );
      for (const indicator of snapshot.indicators || []) {
        await insertIndicator(client, runId, observedAt, indicator);
      }
      for (const event of flattenEvents(snapshot.upcomingEvents)) {
        await insertEvent(client, runId, observedAt, event);
      }
      for (const anomaly of snapshot.anomalyRadar?.equityAnomalies || []) {
        await insertEquityAnomaly(client, runId, observedAt, anomaly);
      }
      for (const move of snapshot.anomalyRadar?.sectorMoves || []) {
        await insertSectorMove(client, runId, observedAt, move);
      }
      if (snapshot.marketStructure) {
        await insertMarketStructure(client, runId, observedAt, snapshot.marketStructure);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    dbStatus = { ...dbStatus, ok: true, lastError: null, lastWriteAt: new Date().toISOString() };
  } catch (error) {
    dbStatus = { ...dbStatus, ok: false, lastError: error.message };
  }
  return dbStatus;
}

async function insertMarketStructure(client, runId, observedAt, structure) {
  await client.query(
    `INSERT INTO ${qn("market_structure_observations")}
      (run_id, observed_at, diagnosis_type, diagnosis_label, diagnosis_confidence, fragility_level,
       bottom_stage, bottom_label, bottom_blocked, confirmations_met, confirmations_available, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [
      runId,
      observedAt,
      structure.diagnosis?.type,
      structure.diagnosis?.label,
      toNumber(structure.diagnosis?.confidence),
      structure.fragility?.level,
      Number.isFinite(Number(structure.bottom?.stage)) ? Number(structure.bottom.stage) : null,
      structure.bottom?.label,
      Boolean(structure.bottom?.blocked),
      Number.isFinite(Number(structure.bottom?.metCount)) ? Number(structure.bottom.metCount) : null,
      Number.isFinite(Number(structure.bottom?.availableCount)) ? Number(structure.bottom.availableCount) : null,
      JSON.stringify(structure)
    ]
  );
}

async function insertEquityAnomaly(client, runId, observedAt, anomaly) {
  await client.query(
    `INSERT INTO ${qn("equity_anomaly_observations")}
      (run_id, observed_at, symbol, name, anomaly_type, direction, severity, change_pct, market_cap, volume,
       market_label, exchange_label, currency, volume_ratio, abnormal_move_ratio, classification, sector_label,
       industry_label, company_brief, explanation, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)`,
    [
      runId,
      observedAt,
      anomaly.symbol,
      anomaly.name,
      anomaly.anomalyType,
      anomaly.direction,
      anomaly.severity,
      toNumber(anomaly.changePct),
      toNumber(anomaly.marketCap),
      toNumber(anomaly.volume),
      anomaly.marketLabel,
      anomaly.exchangeLabel,
      anomaly.currency,
      toNumber(anomaly.volumeRatio),
      toNumber(anomaly.abnormalMoveRatio),
      anomaly.classification,
      anomaly.sectorLabel,
      anomaly.industryLabel,
      anomaly.companyBrief,
      anomaly.explanation,
      JSON.stringify(anomaly)
    ]
  );
}

async function insertSectorMove(client, runId, observedAt, move) {
  await client.query(
    `INSERT INTO ${qn("sector_move_observations")}
      (run_id, observed_at, symbol, name, group_name, direction, severity, change_pct, trend20,
       abnormal_move_ratio, explanation, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [
      runId,
      observedAt,
      move.symbol,
      move.name,
      move.group,
      move.direction,
      move.severity,
      toNumber(move.changePct),
      toNumber(move.trend20),
      toNumber(move.abnormalMoveRatio),
      move.explanation,
      JSON.stringify(move)
    ]
  );
}

async function insertIndicator(client, runId, observedAt, indicator) {
  await client.query(
    `INSERT INTO ${qn("indicator_observations")}
      (run_id, observed_at, indicator_id, name, category, source, symbol, status, unit, value, change, change_pct,
       trend20, trend60, score, state, state_label, source_updated_at, reading, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)`,
    [
      runId,
      observedAt,
      indicator.id,
      indicator.name,
      indicator.category,
      indicator.source,
      indicator.symbol,
      indicator.status,
      indicator.unit,
      toNumber(indicator.value),
      toNumber(indicator.change),
      toNumber(indicator.changePct),
      toNumber(indicator.trend20),
      toNumber(indicator.trend60),
      toNumber(indicator.score),
      indicator.state,
      indicator.stateLabel,
      indicator.updatedAt,
      indicator.reading,
      JSON.stringify(indicator)
    ]
  );
  for (const point of indicator.history || []) {
    await client.query(
      `INSERT INTO ${qn("indicator_history_points")}
        (indicator_id, point_date, value, source, observed_at, raw)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (indicator_id, point_date)
       DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, observed_at = EXCLUDED.observed_at, raw = EXCLUDED.raw`,
      [indicator.id, point.date, toNumber(point.value), indicator.source, observedAt, JSON.stringify(point)]
    );
  }
  for (const signal of indicator.signals || []) {
    await client.query(
      `INSERT INTO ${qn("indicator_signals")}
        (run_id, observed_at, indicator_id, indicator_name, category, signal_type, direction, severity, label,
         detail, window_label, value, threshold, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [
        runId,
        observedAt,
        indicator.id,
        indicator.name,
        indicator.category,
        signal.type,
        signal.direction,
        signal.severity,
        signal.label,
        signal.detail,
        signal.window,
        toNumber(signal.value),
        toNumber(signal.threshold),
        JSON.stringify(signal)
      ]
    );
  }
}

async function insertEvent(client, runId, observedAt, event) {
  await client.query(
    `INSERT INTO ${qn("event_observations")}
      (run_id, observed_at, event_key, event_type, status, event_date, event_time, days_until, title, symbol,
       company, sector, theme, priority, source, expectation, previous, consensus, forecast, actual, eps_forecast,
       no_of_ests, last_year_eps, fiscal_quarter_ending, market_cap, why, watch_text, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb)`,
    [
      runId,
      observedAt,
      eventKey(event),
      event.type,
      event.status,
      event.date || null,
      event.time || null,
      Number.isFinite(Number(event.daysUntil)) ? Number(event.daysUntil) : null,
      event.title || null,
      event.symbol || null,
      event.company || null,
      event.sector || null,
      event.theme || null,
      event.priority || null,
      event.source || null,
      event.expectation || null,
      event.previous || null,
      event.consensus || null,
      event.forecast || null,
      event.actual || null,
      event.epsForecast || null,
      event.noOfEsts || null,
      event.lastYearEPS || null,
      event.fiscalQuarterEnding || null,
      event.marketCap || null,
      event.why || null,
      event.watchText || null,
      JSON.stringify(event)
    ]
  );
}

async function getIndicatorObservationHistory(indicatorId, limit = 200) {
  const activePool = getPool();
  if (!activePool) return [];
  await initDb();
  if (!dbStatus.ok) return [];
  const result = await activePool.query(
    `SELECT observed_at, status, value, change, change_pct, trend20, trend60, score, state, state_label, source_updated_at
       FROM ${qn("indicator_observations")}
      WHERE indicator_id = $1
      ORDER BY observed_at DESC
      LIMIT $2`,
    [indicatorId, Math.min(Number(limit) || 200, 1000)]
  );
  return result.rows.reverse();
}

async function getIndicatorHistoryPoints(indicatorId, limit = 500) {
  const activePool = getPool();
  if (!activePool) return [];
  await initDb();
  if (!dbStatus.ok) return [];
  const result = await activePool.query(
    `SELECT point_date, value, source, observed_at
       FROM ${qn("indicator_history_points")}
      WHERE indicator_id = $1
      ORDER BY point_date DESC
      LIMIT $2`,
    [indicatorId, Math.min(Number(limit) || 500, 2000)]
  );
  return result.rows.reverse();
}

async function getEventObservationHistory(eventKeyValue, limit = 100) {
  const activePool = getPool();
  if (!activePool) return [];
  await initDb();
  if (!dbStatus.ok) return [];
  const result = await activePool.query(
    `SELECT observed_at, event_date, event_time, title, expectation, previous, consensus, forecast, actual,
            eps_forecast, no_of_ests, priority, source
       FROM ${qn("event_observations")}
      WHERE event_key = $1
      ORDER BY observed_at DESC
      LIMIT $2`,
    [eventKeyValue, Math.min(Number(limit) || 100, 500)]
  );
  return result.rows.reverse();
}

async function getIndicatorObservationSeriesForIds(indicatorIds, limitPerIndicator = 40) {
  const activePool = getPool();
  if (!activePool || !indicatorIds.length) return new Map();
  await initDb();
  if (!dbStatus.ok) return new Map();
  const result = await activePool.query(
    `WITH ranked AS (
       SELECT indicator_id, observed_at, value, score, state, source_updated_at,
              row_number() OVER (PARTITION BY indicator_id ORDER BY observed_at DESC) AS rn
         FROM ${qn("indicator_observations")}
        WHERE indicator_id = ANY($1)
          AND value IS NOT NULL
     )
     SELECT indicator_id, observed_at, value, score, state, source_updated_at
       FROM ranked
      WHERE rn <= $2
      ORDER BY indicator_id, observed_at ASC`,
    [indicatorIds, Math.min(Number(limitPerIndicator) || 40, 300)]
  );
  const byId = new Map();
  for (const row of result.rows) {
    if (!byId.has(row.indicator_id)) byId.set(row.indicator_id, []);
    byId.get(row.indicator_id).push(row);
  }
  return byId;
}

async function getEventObservationRowsForKeys(eventKeys, limitPerEvent = 20) {
  const activePool = getPool();
  if (!activePool || !eventKeys.length) return new Map();
  await initDb();
  if (!dbStatus.ok) return new Map();
  const result = await activePool.query(
    `WITH ranked AS (
       SELECT event_key, observed_at, event_date, title, expectation, previous, consensus, forecast, actual,
              eps_forecast, no_of_ests, priority, source,
              row_number() OVER (PARTITION BY event_key ORDER BY observed_at DESC) AS rn
         FROM ${qn("event_observations")}
        WHERE event_key = ANY($1)
     )
     SELECT event_key, observed_at, event_date, title, expectation, previous, consensus, forecast, actual,
            eps_forecast, no_of_ests, priority, source
       FROM ranked
      WHERE rn <= $2
      ORDER BY event_key, observed_at ASC`,
    [eventKeys, Math.min(Number(limitPerEvent) || 20, 200)]
  );
  const byKey = new Map();
  for (const row of result.rows) {
    if (!byKey.has(row.event_key)) byKey.set(row.event_key, []);
    byKey.get(row.event_key).push(row);
  }
  return byKey;
}

async function getRecentSignals(limit = 100) {
  const activePool = getPool();
  if (!activePool) return [];
  await initDb();
  if (!dbStatus.ok) return [];
  const result = await activePool.query(
    `SELECT observed_at, indicator_id, indicator_name, category, signal_type, direction, severity, label, detail,
            window_label, value, threshold
       FROM ${qn("indicator_signals")}
      ORDER BY observed_at DESC
      LIMIT $1`,
    [Math.min(Number(limit) || 100, 500)]
  );
  return result.rows;
}

function flattenEvents(upcomingEvents) {
  const seen = new Set();
  const events = [];
  for (const event of [...(upcomingEvents?.macro || []), ...(upcomingEvents?.earnings || [])]) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(event);
  }
  return events;
}

function eventKey(event) {
  if (event.type === "earnings") return `earnings:${event.symbol}:${event.date}`;
  return `macro:${event.symbol || slug(event.title)}:${event.date}:${event.reference || ""}`;
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function trimSnapshot(snapshot) {
  return {
    updatedAt: snapshot.updatedAt,
    marketScore: snapshot.marketScore,
    regime: snapshot.regime,
    flags: snapshot.flags,
    dimensions: snapshot.dimensions,
    frameworks: snapshot.frameworks,
    marketStructure: snapshot.marketStructure,
    marketStructureSources: snapshot.marketStructureSources,
    api: snapshot.api
  };
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function q(identifier) {
  return `"${String(identifier).replace(/"/g, "\"\"")}"`;
}

function qn(table) {
  return `${q(schema)}.${q(table)}`;
}

module.exports = {
  initDb,
  persistSnapshot,
  getDbStatus: () => dbStatus,
  getIndicatorObservationHistory,
  getIndicatorHistoryPoints,
  getIndicatorObservationSeriesForIds,
  getEventObservationHistory,
  getEventObservationRowsForKeys,
  getRecentSignals,
  eventKey
};
