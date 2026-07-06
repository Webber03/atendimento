require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDb, dbRun, dbGet, dbAll } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------
// TEAMS ENDPOINTS
// ----------------------------------------

// List all teams
app.get('/api/teams', async (req, res) => {
  try {
    const teams = await dbAll("SELECT * FROM teams ORDER BY name ASC");
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create team
app.post('/api/teams', async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: "O nome da equipe é obrigatório." });
  }
  try {
    const result = await dbRun("INSERT INTO teams (name) VALUES (?)", [name.trim()]);
    res.status(201).json({ id: result.lastID, name: name.trim() });
  } catch (err) {
    if (err.code === '23505' || /unique/i.test(err.message)) {
      return res.status(400).json({ error: "Já existe uma equipe com este nome." });
    }
    res.status(500).json({ error: err.message });
  }
});

// Delete team
app.delete('/api/teams/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await dbRun("DELETE FROM teams WHERE id = ?", [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Equipe não encontrada." });
    }
    res.json({ message: "Equipe removida com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// CONSULTANTS ENDPOINTS
// ----------------------------------------

// List all consultants (joined with team name)
app.get('/api/consultants', async (req, res) => {
  try {
    const consultants = await dbAll(`
      SELECT c.id, c.name, c.team_id, t.name as team_name 
      FROM consultants c
      JOIN teams t ON c.team_id = t.id
      ORDER BY c.name ASC
    `);
    res.json(consultants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create consultant
app.post('/api/consultants', async (req, res) => {
  const { name, team_id } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: "O nome do consultor é obrigatório." });
  }
  if (!team_id) {
    return res.status(400).json({ error: "É obrigatório vincular o consultor a uma equipe." });
  }
  try {
    // Validate team exists
    const team = await dbGet("SELECT id FROM teams WHERE id = ?", [team_id]);
    if (!team) {
      return res.status(400).json({ error: "A equipe selecionada não existe." });
    }
    const result = await dbRun("INSERT INTO consultants (name, team_id) VALUES (?, ?)", [name.trim(), team_id]);
    res.status(201).json({ id: result.lastID, name: name.trim(), team_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete consultant
app.delete('/api/consultants/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await dbRun("DELETE FROM consultants WHERE id = ?", [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Consultor não encontrado." });
    }
    res.json({ message: "Consultor removido com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// CHANNELS ENDPOINTS
// ----------------------------------------

// List all channels
app.get('/api/channels', async (req, res) => {
  try {
    const channels = await dbAll("SELECT * FROM channels ORDER BY name ASC");
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create channel
app.post('/api/channels', async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: "O nome do canal é obrigatório." });
  }
  try {
    const result = await dbRun("INSERT INTO channels (name, active) VALUES (?, 1)", [name.trim()]);
    res.status(201).json({ id: result.lastID, name: name.trim(), active: 1 });
  } catch (err) {
    if (err.code === '23505' || /unique/i.test(err.message)) {
      return res.status(400).json({ error: "Já existe um canal de venda com este nome." });
    }
    res.status(500).json({ error: err.message });
  }
});

// Toggle channel active status (PUT /api/channels/:id)
app.put('/api/channels/:id', async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;
  if (active === undefined) {
    return res.status(400).json({ error: "O status 'active' (0 ou 1) é obrigatório." });
  }
  try {
    const result = await dbRun("UPDATE channels SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Canal de venda não encontrado." });
    }
    res.json({ message: "Status do canal atualizado com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete channel
app.delete('/api/channels/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await dbRun("DELETE FROM channels WHERE id = ?", [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Canal não encontrado." });
    }
    res.json({ message: "Canal removido com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// DAILY RECORDS ENDPOINTS
// ----------------------------------------

// Fetch grid of active channels combined with existing daily records for a date and consultant
app.get('/api/records', async (req, res) => {
  const { date, consultant_id } = req.query;
  if (!date || !consultant_id) {
    return res.status(400).json({ error: "Data e ID do Consultor são campos obrigatórios." });
  }
  try {
    // 1. Fetch all active channels
    const channels = await dbAll("SELECT id as channel_id, name as channel_name FROM channels WHERE active = 1 ORDER BY name ASC");
    
    // 2. Fetch existing daily records for this date and consultant
    const records = await dbAll(`
      SELECT channel_id, leads_totais, inviaveis, fechados, observacoes 
      FROM daily_records 
      WHERE date = ? AND consultant_id = ?
    `, [date, consultant_id]);

    // Create a lookup map for the existing records
    const recordMap = {};
    records.forEach(r => {
      recordMap[r.channel_id] = r;
    });

    // 3. Merge channels with their logs (if any) or populate defaults
    const grid = channels.map(ch => {
      const existing = recordMap[ch.channel_id];
      return {
        channel_id: ch.channel_id,
        channel_name: ch.channel_name,
        leads_totais: existing ? existing.leads_totais : 0,
        inviaveis: existing ? existing.inviaveis : 0,
        fechados: existing ? existing.fechados : 0,
        observacoes: existing ? existing.observacoes || "" : ""
      };
    });

    res.json(grid);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save or Update daily records
app.post('/api/records', async (req, res) => {
  const { date, consultant_id, launches } = req.body;

  if (!date || !consultant_id || !Array.isArray(launches)) {
    return res.status(400).json({ error: "Parâmetros inválidos. Data, Consultor e Lançamentos são obrigatórios." });
  }

  // Validate inputs first before performing database transaction
  for (const launch of launches) {
    const { channel_id, leads_totais, inviaveis, fechados } = launch;
    if (channel_id === undefined || leads_totais === undefined || inviaveis === undefined || fechados === undefined) {
      return res.status(400).json({ error: "Parâmetros incompletos na lista de lançamentos." });
    }
    const lt = parseInt(leads_totais, 10);
    const inv = parseInt(inviaveis, 10);
    const fech = parseInt(fechados, 10);

    if (isNaN(lt) || lt < 0 || isNaN(inv) || inv < 0 || isNaN(fech) || fech < 0) {
      return res.status(400).json({ error: "Os campos de leads e fechamentos devem ser números inteiros maiores ou iguais a zero." });
    }
    if (inv > lt) {
      return res.status(400).json({ error: "Leads inviáveis não podem ser maiores que os leads totais." });
    }
    if (fech > (lt - inv)) {
      return res.status(400).json({ error: "Vendas fechadas não podem ser maiores do que os leads aproveitáveis." });
    }
  }

  try {
    // Save in database using UPSERT
    for (const launch of launches) {
      const { channel_id, leads_totais, inviaveis, fechados, observacoes } = launch;
      const obs = observacoes ? observacoes.trim() : null;

      await dbRun(`
        INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (date, consultant_id, channel_id) DO UPDATE SET
          leads_totais = excluded.leads_totais,
          inviaveis = excluded.inviaveis,
          fechados = excluded.fechados,
          observacoes = excluded.observacoes
      `, [date, consultant_id, channel_id, leads_totais, inviaveis, fechados, obs]);
    }
    res.json({ message: "Lançamentos salvos com sucesso!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// ANALYTICS / DASHBOARD ENDPOINT
// ----------------------------------------

app.get('/api/dashboard', async (req, res) => {
  const { start_date, end_date, team_id, consultant_id, channel_id } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: "As datas de início e fim são obrigatórias para filtrar o período." });
  }

  try {
    // 1. Build dynamic query filters
    let filterQuery = "WHERE dr.date BETWEEN ? AND ?";
    const params = [start_date, end_date];

    if (team_id) {
      filterQuery += " AND c.team_id = ?";
      params.push(team_id);
    }
    if (consultant_id) {
      filterQuery += " AND dr.consultant_id = ?";
      params.push(consultant_id);
    }
    if (channel_id) {
      filterQuery += " AND dr.channel_id = ?";
      params.push(channel_id);
    }

    // 2. Fetch consolidated KPIs
    const kpi = await dbGet(`
      SELECT 
        SUM(dr.leads_totais) as total_leads,
        SUM(dr.inviaveis) as total_inviaveis,
        SUM(dr.fechados) as total_fechados
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      ${filterQuery}
    `, params);

    const total_leads = kpi.total_leads || 0;
    const total_inviaveis = kpi.total_inviaveis || 0;
    const total_fechados = kpi.total_fechados || 0;
    const aproveitaveis = total_leads - total_inviaveis;
    const percent_inviaveis = total_leads > 0 ? (total_inviaveis / total_leads) * 100 : 0;

    // Regra de Ouro: Taxa de conversão reajustada desconsiderando inviáveis, com validação de divisão por zero.
    let conversao_reajustada = 0;
    if (aproveitaveis > 0) {
      conversao_reajustada = (total_fechados / aproveitaveis) * 100;
    }

    // 3. Fetch performance split by Sales Channel
    const channelSplit = await dbAll(`
      SELECT 
        ch.name as channel_name,
        SUM(dr.leads_totais) as leads_totais,
        SUM(dr.inviaveis) as inviaveis,
        SUM(dr.fechados) as fechados
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      JOIN channels ch ON dr.channel_id = ch.id
      ${filterQuery}
      GROUP BY dr.channel_id, ch.name
      ORDER BY leads_totais DESC
    `, params);

    // 4. Fetch daily evolution (leads, sales, conversion)
    const evolution = await dbAll(`
      SELECT 
        dr.date,
        SUM(dr.leads_totais) as leads_totais,
        SUM(dr.inviaveis) as inviaveis,
        SUM(dr.fechados) as fechados
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      ${filterQuery}
      GROUP BY dr.date
      ORDER BY dr.date ASC
    `, params);

    // 5. Fetch Rankings
    // Consultants ranking
    const consultantsRanking = await dbAll(`
      SELECT 
        c.name as consultant_name,
        t.name as team_name,
        SUM(dr.leads_totais) as leads_totais,
        SUM(dr.inviaveis) as inviaveis,
        SUM(dr.fechados) as fechados
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      JOIN teams t ON c.team_id = t.id
      ${filterQuery}
      GROUP BY dr.consultant_id, c.name, t.name
      ORDER BY fechados DESC, leads_totais DESC
    `, params);

    // Teams ranking
    const teamsRanking = await dbAll(`
      SELECT 
        t.name as team_name,
        SUM(dr.leads_totais) as leads_totais,
        SUM(dr.inviaveis) as inviaveis,
        SUM(dr.fechados) as fechados
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      JOIN teams t ON c.team_id = t.id
      ${filterQuery}
      GROUP BY c.team_id, t.name
      ORDER BY fechados DESC, leads_totais DESC
    `, params);

    res.json({
      kpis: {
        total_leads,
        inviaveis: total_inviaveis,
        percent_inviaveis: parseFloat(percent_inviaveis.toFixed(2)),
        aproveitaveis,
        fechados: total_fechados,
        conversao_reajustada: parseFloat(conversao_reajustada.toFixed(2))
      },
      channelSplit,
      evolution: evolution.map(ev => {
        const ap = ev.leads_totais - ev.inviaveis;
        const conv = ap > 0 ? (ev.fechados / ap) * 100 : 0;
        return {
          ...ev,
          conversao_reajustada: parseFloat(conv.toFixed(2))
        };
      }),
      consultantsRanking: consultantsRanking.map(cr => {
        const ap = cr.leads_totais - cr.inviaveis;
        const conv = ap > 0 ? (cr.fechados / ap) * 100 : 0;
        return {
          ...cr,
          conversao_reajustada: parseFloat(conv.toFixed(2))
        };
      }),
      teamsRanking: teamsRanking.map(tr => {
        const ap = tr.leads_totais - tr.inviaveis;
        const conv = ap > 0 ? (tr.fechados / ap) * 100 : 0;
        return {
          ...tr,
          conversao_reajustada: parseFloat(conv.toFixed(2))
        };
      })
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// START SERVER
// ----------------------------------------
(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
      console.log(`URL Local: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Erro ao iniciar banco de dados:", err);
    process.exit(1);
  }
})();
