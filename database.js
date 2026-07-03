const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'metrics.db');
const db = new sqlite3.Database(dbPath);

// Helper function to run commands (INSERT, UPDATE, DELETE)
function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
}

// Helper function to fetch a single row
function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Helper function to fetch all rows
function dbAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Initialize database schema and seed data
async function initDb() {
  // Activating Foreign Keys
  await dbRun("PRAGMA foreign_keys = ON;");

  // Create Teams Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Consultants Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS consultants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      team_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
    )
  `);

  // Create Channels Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Daily Records Table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS daily_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      consultant_id INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      leads_totais INTEGER NOT NULL DEFAULT 0,
      inviaveis INTEGER NOT NULL DEFAULT 0,
      fechados INTEGER NOT NULL DEFAULT 0,
      observacoes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(consultant_id) REFERENCES consultants(id) ON DELETE CASCADE,
      FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      UNIQUE(date, consultant_id, channel_id)
    )
  `);

  // Seed default data if teams table is empty
  const teamCheck = await dbGet("SELECT COUNT(*) as count FROM teams");
  if (teamCheck.count === 0) {
    console.log("Banco vazio detectado. Populando dados iniciais para demonstração...");

    // Seed Teams
    const teamAlpha = await dbRun("INSERT INTO teams (name) VALUES (?)", ["Equipe Alpha"]);
    const teamBeta = await dbRun("INSERT INTO teams (name) VALUES (?)", ["Equipe Beta"]);

    const alphaId = teamAlpha.lastID;
    const betaId = teamBeta.lastID;

    // Seed Consultants
    const c1 = await dbRun("INSERT INTO consultants (name, team_id) VALUES (?, ?)", ["Carlos Silva", alphaId]);
    const c2 = await dbRun("INSERT INTO consultants (name, team_id) VALUES (?, ?)", ["Amanda Souza", alphaId]);
    const c3 = await dbRun("INSERT INTO consultants (name, team_id) VALUES (?, ?)", ["Rodrigo Santos", betaId]);
    const c4 = await dbRun("INSERT INTO consultants (name, team_id) VALUES (?, ?)", ["Mariana Costa", betaId]);

    const carlosId = c1.lastID;
    const amandaId = c2.lastID;
    const rodrigoId = c3.lastID;
    const marianaId = c4.lastID;

    // Seed Channels
    const chWpp = await dbRun("INSERT INTO channels (name, active) VALUES (?, 1)", ["WhatsApp Oficial"]);
    const chDial = await dbRun("INSERT INTO channels (name, active) VALUES (?, 1)", ["Discadora Automática"]);
    const chInsta = await dbRun("INSERT INTO channels (name, active) VALUES (?, 1)", ["Instagram Direct"]);
    const chSite = await dbRun("INSERT INTO channels (name, active) VALUES (?, 1)", ["Formulário Site"]);
    const chManual = await dbRun("INSERT INTO channels (name, active) VALUES (?, 1)", ["Indicação/Manual"]);

    const wppId = chWpp.lastID;
    const dialId = chDial.lastID;
    const instaId = chInsta.lastID;
    const siteId = chSite.lastID;
    const manualId = chManual.lastID;

    // Seed 14 days of realistic random historical records
    const today = new Date();
    for (let i = 14; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      // Carlos Silva (Alpha) - WPP and Dialer
      await dbRun(`INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dateStr, carlosId, wppId, Math.floor(Math.random() * 12) + 8, Math.floor(Math.random() * 3), Math.floor(Math.random() * 3), "Leads interessados"]);
      await dbRun(`INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dateStr, carlosId, dialId, Math.floor(Math.random() * 20) + 15, Math.floor(Math.random() * 7), Math.floor(Math.random() * 2), "Muitos ocupados"]);

      // Amanda Souza (Alpha) - WPP and Instagram
      await dbRun(`INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dateStr, amandaId, wppId, Math.floor(Math.random() * 15) + 10, Math.floor(Math.random() * 4), Math.floor(Math.random() * 4), "Conversas fluídas"]);
      await dbRun(`INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dateStr, amandaId, instaId, Math.floor(Math.random() * 8) + 4, Math.floor(Math.random() * 2), Math.floor(Math.random() * 2), "Leads do Instagram"]);

      // Rodrigo Santos (Beta) - Dialer and Site
      await dbRun(`INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dateStr, rodrigoId, dialId, Math.floor(Math.random() * 30) + 20, Math.floor(Math.random() * 12), Math.floor(Math.random() * 3), "Ligou bastante"]);
      await dbRun(`INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dateStr, rodrigoId, siteId, Math.floor(Math.random() * 5) + 2, 0, Math.floor(Math.random() * 2), "Leads qualificados do formulário"]);

      // Mariana Costa (Beta) - WPP and Manual
      await dbRun(`INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dateStr, marianaId, wppId, Math.floor(Math.random() * 15) + 8, Math.floor(Math.random() * 3), Math.floor(Math.random() * 3), "Dia movimentado"]);
      await dbRun(`INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dateStr, marianaId, manualId, Math.floor(Math.random() * 3) + 1, 0, Math.floor(Math.random() * 2), "Venda de indicação"]);
    }
    console.log("Carga de dados iniciais efetuada com sucesso!");
  }
}

module.exports = {
  dbRun,
  dbGet,
  dbAll,
  initDb
};
