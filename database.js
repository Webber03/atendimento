require('dotenv').config();
const { Pool } = require('pg');

function createPool() {
  const ssl = process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false;

  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL, ssl });
  }

  return new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl
  });
}

const pool = createPool();

function toPgQuery(query, params) {
  let index = 0;
  const pgQuery = query.replace(/\?/g, () => `$${++index}`);
  return [pgQuery, params];
}

function dbRun(query, params = []) {
  const [pgQuery, pgParams] = toPgQuery(query, params);
  const isInsert = /^\s*INSERT/i.test(query.trim());
  const finalQuery = isInsert && !/RETURNING/i.test(pgQuery)
    ? `${pgQuery} RETURNING id`
    : pgQuery;

  return pool.query(finalQuery, pgParams).then(result => ({
    lastID: result.rows[0]?.id,
    changes: result.rowCount
  }));
}

function dbGet(query, params = []) {
  const [pgQuery, pgParams] = toPgQuery(query, params);
  return pool.query(pgQuery, pgParams).then(result => result.rows[0] || null);
}

function dbAll(query, params = []) {
  const [pgQuery, pgParams] = toPgQuery(query, params);
  return pool.query(pgQuery, pgParams).then(result => result.rows);
}

async function resetTables() {
  await pool.query('DROP TABLE IF EXISTS daily_records CASCADE');
  await pool.query('DROP TABLE IF EXISTS channels CASCADE');
  await pool.query('DROP TABLE IF EXISTS teams CASCADE');
  await pool.query('DROP TABLE IF EXISTS systems CASCADE');
  await pool.query('DROP TABLE IF EXISTS convenios CASCADE');
  await pool.query('DROP TABLE IF EXISTS produtos CASCADE');
  await pool.query('DROP TABLE IF EXISTS lead_generations CASCADE');
}

async function ensureLeadGenerationColumns() {
  const requiredColumns = [
    ['date', 'DATE'],
    ['channel_id', 'INTEGER'],
    ['system_id', 'INTEGER'],
    ['convenio_id', 'INTEGER'],
    ['produto_id', 'INTEGER'],
    ['prospectados', 'INTEGER NOT NULL DEFAULT 0'],
    ['aceites', 'INTEGER NOT NULL DEFAULT 0'],
    ['inviaveis', 'INTEGER NOT NULL DEFAULT 0'],
    ['investimento', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['fechamentos', 'INTEGER NOT NULL DEFAULT 0'],
    ['faturamento', 'DECIMAL(15,2) NOT NULL DEFAULT 0.00'],
    ['created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP']
  ];

  for (const [columnName, definition] of requiredColumns) {
    await pool.query(`
      ALTER TABLE lead_generations
      ADD COLUMN IF NOT EXISTS ${columnName} ${definition}
    `);
  }
}

async function createSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultants (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_records (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      consultant_id INTEGER NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      leads_totais INTEGER NOT NULL DEFAULT 0,
      inviaveis INTEGER NOT NULL DEFAULT 0,
      fechados INTEGER NOT NULL DEFAULT 0,
      observacoes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, consultant_id, channel_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS systems (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS convenios (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_generations (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
      system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL,
      convenio_id INTEGER NOT NULL REFERENCES convenios(id),
      produto_id INTEGER NOT NULL REFERENCES produtos(id),
      prospectados INTEGER NOT NULL DEFAULT 0,
      aceites INTEGER NOT NULL DEFAULT 0,
      inviaveis INTEGER NOT NULL DEFAULT 0,
      investimento DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      fechamentos INTEGER NOT NULL DEFAULT 0,
      faturamento DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureLeadGenerationColumns();
}

function validateDbConfig() {
  if (process.env.DATABASE_URL) {
    return;
  }

  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  }
}

async function initDb() {
  validateDbConfig();
  await pool.query('SELECT 1');

  if (process.env.DB_RESET === 'true') {
    console.log('DB_RESET=true: recriando tabelas do zero...');
    await resetTables();
  }

  await createSchema();
  console.log('Banco PostgreSQL conectado e schema pronto (sem dados iniciais).');
}

module.exports = {
  dbRun,
  dbGet,
  dbAll,
  initDb,
  pool
};
