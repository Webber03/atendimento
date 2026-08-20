const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');

const sqlitePath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'metrics.db');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Defina DATABASE_URL antes de executar a migração.');
  process.exit(1);
}

const sqliteDb = new sqlite3.Database(sqlitePath);
const pgPool = new Pool({ connectionString });

function querySqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

async function ensureSchema() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS consultants (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_records (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      consultant_id INTEGER NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      leads_totais INTEGER NOT NULL DEFAULT 0,
      inviaveis INTEGER NOT NULL DEFAULT 0,
      fechados INTEGER NOT NULL DEFAULT 0,
      observacoes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, consultant_id, channel_id)
    );
  `);
}

async function migrateTable({ table, columns, selectSql, insertSql }) {
  const rows = await querySqlite(selectSql);
  if (!rows.length) {
    console.log(`Nenhum dado encontrado para ${table}.`);
    return;
  }

  for (const row of rows) {
    const values = columns.map((col) => row[col]);
    await pgPool.query(insertSql, values);
  }

  console.log(`${rows.length} registros migrados para ${table}.`);
}

async function main() {
  try {
    console.log(`Migrando dados de ${sqlitePath} para PostgreSQL...`);
    await ensureSchema();
    await pgPool.query('TRUNCATE TABLE daily_records, consultants, channels, teams RESTART IDENTITY CASCADE');

    await migrateTable({
      table: 'teams',
      columns: ['id', 'name', 'created_at'],
      selectSql: 'SELECT id, name, created_at FROM teams ORDER BY id',
      insertSql: `
        INSERT INTO teams (id, name, created_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          created_at = EXCLUDED.created_at
      `
    });

    await migrateTable({
      table: 'consultants',
      columns: ['id', 'name', 'team_id', 'created_at'],
      selectSql: 'SELECT id, name, team_id, created_at FROM consultants ORDER BY id',
      insertSql: `
        INSERT INTO consultants (id, name, team_id, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          team_id = EXCLUDED.team_id,
          created_at = EXCLUDED.created_at
      `
    });

    await migrateTable({
      table: 'channels',
      columns: ['id', 'name', 'active', 'created_at'],
      selectSql: 'SELECT id, name, active, created_at FROM channels ORDER BY id',
      insertSql: `
        INSERT INTO channels (id, name, active, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          active = EXCLUDED.active,
          created_at = EXCLUDED.created_at
      `
    });

    await migrateTable({
      table: 'daily_records',
      columns: ['id', 'date', 'consultant_id', 'channel_id', 'leads_totais', 'inviaveis', 'fechados', 'observacoes', 'created_at'],
      selectSql: 'SELECT id, date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes, created_at FROM daily_records ORDER BY id',
      insertSql: `
        INSERT INTO daily_records (id, date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          date = EXCLUDED.date,
          consultant_id = EXCLUDED.consultant_id,
          channel_id = EXCLUDED.channel_id,
          leads_totais = EXCLUDED.leads_totais,
          inviaveis = EXCLUDED.inviaveis,
          fechados = EXCLUDED.fechados,
          observacoes = EXCLUDED.observacoes,
          created_at = EXCLUDED.created_at
      `
    });

    console.log('Migração concluída com sucesso.');
  } catch (error) {
    console.error('Erro durante a migração:', error);
    process.exit(1);
  } finally {
    sqliteDb.close();
    await pgPool.end();
  }
}

main();
