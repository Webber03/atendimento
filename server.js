require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { initDb, dbRun, dbGet, dbAll } = require('./database');
const { requireAuth, requireRole, generateToken } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------
// AUTH ENDPOINTS
// ----------------------------------------

// POST /api/auth/login — Autentica o usuário e retorna um token JWT
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }
  try {
    const user = await dbGet(
      'SELECT * FROM users WHERE username = $1 AND active = TRUE',
      [username.trim().toLowerCase()]
    );
    if (!user) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }
    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        team_id: user.team_id
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me — Retorna os dados do usuário logado
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/setup — Cria o primeiro usuário admin (protegido por token de setup)
app.post('/api/auth/setup', async (req, res) => {
  const setupToken = process.env.ADMIN_SETUP_TOKEN;
  const { setup_token, username, password } = req.body;

  if (!setupToken || setup_token !== setupToken) {
    return res.status(403).json({ error: 'Token de setup inválido ou não configurado.' });
  }

  try {
    const existing = await dbGet('SELECT id FROM users WHERE role = $1', ['admin']);
    if (existing) {
      return res.status(400).json({ error: 'Já existe um administrador cadastrado.' });
    }
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Usuário e senha (mín. 6 caracteres) são obrigatórios.' });
    }
    const hash = await bcrypt.hash(password, 12);
    const result = await dbRun(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
      [username.trim().toLowerCase(), hash, 'admin']
    );
    res.status(201).json({ message: 'Administrador criado com sucesso!', id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// USER MANAGEMENT ENDPOINTS (admin only)
// ----------------------------------------

// GET /api/users — Lista todos os usuários
app.get('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT u.id, u.username, u.role, u.team_id, u.active, u.created_at, t.name as team_name
      FROM users u
      LEFT JOIN teams t ON u.team_id = t.id
      ORDER BY u.created_at DESC
    `);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users — Cria novo usuário
app.post('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { username, password, role, team_id } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Usuário, senha e perfil são obrigatórios.' });
  }
  if (!['admin', 'supervisor', 'leads'].includes(role)) {
    return res.status(400).json({ error: 'Perfil inválido.' });
  }
  if (role === 'supervisor' && !team_id) {
    return res.status(400).json({ error: 'Supervisores precisam estar vinculados a uma equipe.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await dbRun(
      "INSERT INTO users (username, password_hash, role, team_id) VALUES (?, ?, ?, ?)",
      [username.trim().toLowerCase(), hash, role, team_id || null]
    );
    res.status(201).json({ id: result.lastID, username: username.trim().toLowerCase(), role, team_id: team_id || null });
  } catch (err) {
    if (/unique/i.test(err.message)) {
      return res.status(400).json({ error: 'Já existe um usuário com este nome.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — Atualiza usuário (senha opcional)
app.put('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { password, role, team_id, active } = req.body;
  if (role && !['admin', 'supervisor', 'leads'].includes(role)) {
    return res.status(400).json({ error: 'Perfil inválido.' });
  }
  try {
    const existing = await dbGet('SELECT * FROM users WHERE id = $1', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const finalRole = role !== undefined ? role : existing.role;
    const finalTeamId = team_id !== undefined ? team_id : existing.team_id;
    const finalActive = active !== undefined ? active : existing.active;

    let query, params;
    if (password && password.length >= 6) {
      const hash = await bcrypt.hash(password, 12);
      query = "UPDATE users SET password_hash = ?, role = ?, team_id = ?, active = ? WHERE id = ?";
      params = [hash, finalRole, finalTeamId, finalActive, id];
    } else {
      query = "UPDATE users SET role = ?, team_id = ?, active = ? WHERE id = ?";
      params = [finalRole, finalTeamId, finalActive, id];
    }
    const result = await dbRun(query, params);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.json({ message: 'Usuário atualizado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id — Remove usuário
app.delete('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'Você não pode remover seu próprio usuário.' });
  }
  try {
    const result = await dbRun('DELETE FROM users WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.json({ message: 'Usuário removido com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// TEAMS ENDPOINTS
// ----------------------------------------

// List all teams
app.get('/api/teams', requireAuth, async (req, res) => {
  try {
    const teams = await dbAll("SELECT * FROM teams ORDER BY name ASC");
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create team
app.post('/api/teams', requireAuth, requireRole('admin'), async (req, res) => {
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
app.delete('/api/teams/:id', requireAuth, requireRole('admin'), async (req, res) => {
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
app.get('/api/consultants', requireAuth, async (req, res) => {
  try {
    const consultants = await dbAll(`
      SELECT c.id, c.name, c.team_id, c.progestor_user, t.name as team_name 
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
app.post('/api/consultants', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, team_id, progestor_user } = req.body;
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
    const finalProgUser = progestor_user && progestor_user.trim() !== '' ? progestor_user.trim() : null;
    const result = await dbRun("INSERT INTO consultants (name, team_id, progestor_user) VALUES (?, ?, ?)", [name.trim(), team_id, finalProgUser]);
    res.status(201).json({ id: result.lastID, name: name.trim(), team_id, progestor_user: finalProgUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update consultant mapping
app.put('/api/consultants/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, team_id, progestor_user } = req.body;
  try {
    const existing = await dbGet("SELECT * FROM consultants WHERE id = ?", [id]);
    if (!existing) {
      return res.status(404).json({ error: "Consultor não encontrado." });
    }
    const finalName = name !== undefined ? name.trim() : existing.name;
    const finalTeamId = team_id !== undefined ? team_id : existing.team_id;
    const finalProgUser = progestor_user !== undefined ? (progestor_user && progestor_user.trim() !== '' ? progestor_user.trim() : null) : existing.progestor_user;

    await dbRun("UPDATE consultants SET name = ?, team_id = ?, progestor_user = ? WHERE id = ?", [finalName, finalTeamId, finalProgUser, id]);
    res.json({ message: "Consultor atualizado com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete consultant
app.delete('/api/consultants/:id', requireAuth, requireRole('admin'), async (req, res) => {
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
app.get('/api/channels', requireAuth, async (req, res) => {
  try {
    const channels = await dbAll("SELECT * FROM channels ORDER BY name ASC");
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create channel
app.post('/api/channels', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, progestor_code } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: "O nome do canal é obrigatório." });
  }
  try {
    const finalProgCode = progestor_code && progestor_code.trim() !== '' ? progestor_code.trim() : null;
    const result = await dbRun("INSERT INTO channels (name, active, progestor_code) VALUES (?, 1, ?)", [name.trim(), finalProgCode]);
    res.status(201).json({ id: result.lastID, name: name.trim(), active: 1, progestor_code: finalProgCode });
  } catch (err) {
    if (err.code === '23505' || /unique/i.test(err.message)) {
      return res.status(400).json({ error: "Já existe um canal de venda com este nome." });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update channel (PUT /api/channels/:id)
app.put('/api/channels/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { active, name, progestor_code } = req.body;
  try {
    const existing = await dbGet("SELECT * FROM channels WHERE id = ?", [id]);
    if (!existing) {
      return res.status(404).json({ error: "Canal de venda não encontrado." });
    }
    const finalActive = active !== undefined ? (active ? 1 : 0) : existing.active;
    const finalName = name !== undefined ? name.trim() : existing.name;
    const finalProgCode = progestor_code !== undefined ? (progestor_code && progestor_code.trim() !== '' ? progestor_code.trim() : null) : existing.progestor_code;

    const result = await dbRun(
      "UPDATE channels SET active = ?, name = ?, progestor_code = ? WHERE id = ?",
      [finalActive, finalName, finalProgCode, id]
    );
    res.json({ message: "Canal de venda atualizado com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete channel
app.delete('/api/channels/:id', requireAuth, requireRole('admin'), async (req, res) => {
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
app.get('/api/records', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
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

// List latest saved records for the records tab
app.get('/api/records/latest', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { start_date, end_date, consultant_id, channel_id } = req.query;
    let { team_id } = req.query;

    // RBAC: Supervisor só pode ver a própria equipe
    if (req.user.role === 'supervisor') {
      team_id = req.user.team_id;
    }

    let filterQuery = "";
    const params = [];

    if (start_date) {
      filterQuery += " AND dr.date >= ?";
      params.push(start_date);
    }
    if (end_date) {
      filterQuery += " AND dr.date <= ?";
      params.push(end_date);
    }
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

    const rows = await dbAll(`
      SELECT 
        dr.date,
        dr.leads_totais,
        dr.inviaveis,
        dr.fechados,
        dr.observacoes,
        c.name as consultant_name,
        t.name as team_name,
        ch.name as channel_name
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      JOIN teams t ON c.team_id = t.id
      JOIN channels ch ON dr.channel_id = ch.id
      WHERE 1 = 1 ${filterQuery}
      ORDER BY dr.date DESC, dr.created_at DESC
    `, params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save or Update daily records
app.post('/api/records', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
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

app.get('/api/dashboard', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { start_date, end_date, consultant_id, channel_id } = req.query;
  let { team_id } = req.query;

  // RBAC: Supervisor só pode ver os dados da própria equipe
  if (req.user.role === 'supervisor') {
    team_id = req.user.team_id;
  }

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
// SYSTEMS ENDPOINTS
// ----------------------------------------

// List all systems
app.get('/api/systems', requireAuth, async (req, res) => {
  try {
    const systems = await dbAll("SELECT * FROM systems ORDER BY name ASC");
    res.json(systems);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create system
app.post('/api/systems', requireAuth, requireRole('admin'), async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: "O nome do sistema é obrigatório." });
  }
  try {
    const result = await dbRun("INSERT INTO systems (name, active) VALUES (?, 1)", [name.trim()]);
    res.status(201).json({ id: result.lastID, name: name.trim(), active: 1 });
  } catch (err) {
    if (err.code === '23505' || /unique/i.test(err.message)) {
      return res.status(400).json({ error: "Já existe um sistema com este nome." });
    }
    res.status(500).json({ error: err.message });
  }
});

// Toggle system active status
app.put('/api/systems/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;
  if (active === undefined) {
    return res.status(400).json({ error: "O status 'active' (0 ou 1) é obrigatório." });
  }
  try {
    const result = await dbRun("UPDATE systems SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Sistema não encontrado." });
    }
    res.json({ message: "Status do sistema atualizado com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete system
app.delete('/api/systems/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await dbRun("DELETE FROM systems WHERE id = ?", [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Sistema não encontrado." });
    }
    res.json({ message: "Sistema removido com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// CONVENIOS ENDPOINTS
// ----------------------------------------

app.get('/api/convenios', requireAuth, async (req, res) => {
  try {
    const convenios = await dbAll("SELECT * FROM convenios ORDER BY name ASC");
    res.json(convenios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/convenios', requireAuth, requireRole('admin'), async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') return res.status(400).json({ error: "Nome obrigatório." });
  try {
    const result = await dbRun("INSERT INTO convenios (name, active) VALUES (?, 1)", [name.trim()]);
    res.status(201).json({ id: result.lastID, name: name.trim(), active: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/convenios/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun("DELETE FROM convenios WHERE id = ?", [id]);
    res.json({ message: "Convênio removido com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// PRODUTOS ENDPOINTS
// ----------------------------------------

app.get('/api/produtos', requireAuth, async (req, res) => {
  try {
    const produtos = await dbAll("SELECT * FROM produtos ORDER BY name ASC");
    res.json(produtos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/produtos', requireAuth, requireRole('admin'), async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') return res.status(400).json({ error: "Nome obrigatório." });
  try {
    const result = await dbRun("INSERT INTO produtos (name, active) VALUES (?, 1)", [name.trim()]);
    res.status(201).json({ id: result.lastID, name: name.trim(), active: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/produtos/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun("DELETE FROM produtos WHERE id = ?", [id]);
    res.json({ message: "Produto removido com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// LEAD GENERATIONS ENDPOINTS
// ----------------------------------------

async function getWhatsAppChannelId() {
  const ch = await dbGet("SELECT id FROM channels WHERE LOWER(name) = 'disparo whatsapp' OR LOWER(name) = 'disparo wpp' LIMIT 1");
  return ch ? ch.id : null;
}

async function syncDailyRecordsForChannel(date, consultant_id, channel_id) {
  const aggregate = await dbGet(`
    SELECT 
      COALESCE(SUM(d.leads_totais), 0) as total_leads,
      COALESCE(SUM(d.inviaveis), 0) as total_inviaveis,
      COALESCE(SUM(d.fechados), 0) as total_fechados
    FROM lead_generation_distributions d
    JOIN lead_generations lg ON d.lead_generation_id = lg.id
    WHERE lg.date = ? AND d.consultant_id = ? AND lg.channel_id = ?
  `, [date, consultant_id, channel_id]);

  if (aggregate.total_leads > 0 || aggregate.total_inviaveis > 0 || aggregate.total_fechados > 0) {
    await dbRun(`
      INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT (date, consultant_id, channel_id) DO UPDATE SET
        leads_totais = excluded.leads_totais,
        inviaveis = excluded.inviaveis,
        fechados = excluded.fechados
    `, [date, consultant_id, channel_id, aggregate.total_leads, aggregate.total_inviaveis, aggregate.total_fechados]);
  } else {
    await dbRun(`
      DELETE FROM daily_records
      WHERE date = ? AND consultant_id = ? AND channel_id = ?
    `, [date, consultant_id, channel_id]);
  }
}

app.get('/api/lead-generations', requireAuth, requireRole('admin', 'leads'), async (req, res) => {
  try {
    const records = await dbAll(`
      SELECT 
        lg.*,
        c.name as channel_name,
        s.name as system_name,
        cv.name as convenio_name,
        p.name as produto_name
      FROM lead_generations lg
      LEFT JOIN channels c ON lg.channel_id = c.id
      LEFT JOIN systems s ON lg.system_id = s.id
      LEFT JOIN convenios cv ON lg.convenio_id = cv.id
      LEFT JOIN produtos p ON lg.produto_id = p.id
      ORDER BY lg.date DESC, lg.created_at DESC
      LIMIT 200
    `);

    // Fetch distributions for these records
    if (records.length > 0) {
      const recordIds = records.map(r => r.id);
      const placeholders = recordIds.map(() => '?').join(', ');
      const dists = await dbAll(`
        SELECT lead_generation_id, consultant_id, leads_totais, inviaveis, fechados, faturamento
        FROM lead_generation_distributions
        WHERE lead_generation_id IN (${placeholders})
      `, recordIds);

      // Group distributions by lead_generation_id
      const distMap = {};
      dists.forEach(d => {
        if (!distMap[d.lead_generation_id]) {
          distMap[d.lead_generation_id] = [];
        }
        distMap[d.lead_generation_id].push({
          consultant_id: d.consultant_id,
          leads_totais: d.leads_totais,
          inviaveis: d.inviaveis,
          fechados: d.fechados,
          faturamento: d.faturamento
        });
      });

      // Attach to records
      records.forEach(r => {
        r.distributions = distMap[r.id] || [];
      });
    }

    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lead-generations', requireAuth, requireRole('admin', 'leads'), async (req, res) => {
  const { date, channel_id, system_id, convenio_id, produto_id, prospectados, aceites, inviaveis, investimento, fechamentos, faturamento, distributions } = req.body;
  if (!date || !convenio_id || !produto_id) {
    return res.status(400).json({ error: "Data, Convênio e Produto são obrigatórios." });
  }
  try {
    const wppChannelId = await getWhatsAppChannelId();
    const isWpp = (channel_id && wppChannelId && parseInt(channel_id, 10) === wppChannelId);

    // Validate distributions for WPP
    if (isWpp && (!Array.isArray(distributions) || distributions.length === 0)) {
      return res.status(400).json({ error: "A distribuição por consultores é obrigatória para o canal Disparo WhatsApp." });
    }

    const result = await dbRun(`
      INSERT INTO lead_generations 
      (date, channel_id, system_id, convenio_id, produto_id, prospectados, aceites, inviaveis, investimento, fechamentos, faturamento)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      date, 
      channel_id || null, 
      system_id || null, 
      convenio_id || null,
      produto_id || null,
      parseInt(prospectados || 0, 10),
      parseInt(aceites || 0, 10),
      parseInt(inviaveis || 0, 10),
      parseFloat(investimento || 0),
      parseInt(fechamentos || 0, 10),
      parseFloat(faturamento || 0)
    ]);

    const leadGenId = result.lastID;

    if (Array.isArray(distributions) && distributions.length > 0) {
      for (const dist of distributions) {
        const { consultant_id, leads_totais, inviaveis: distInviaveis, fechados, faturamento: distFaturamento } = dist;
        const cId = parseInt(consultant_id, 10);
        const lt = parseInt(leads_totais, 10) || 0;
        const inv = parseInt(distInviaveis, 10) || 0;
        const fech = parseInt(fechados, 10) || 0;
        const fat = parseFloat(distFaturamento) || 0;

        if (lt > 0 || inv > 0 || fech > 0 || fat > 0) {
          await dbRun(`
            INSERT INTO lead_generation_distributions (lead_generation_id, consultant_id, leads_totais, inviaveis, fechados, faturamento)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [leadGenId, cId, lt, inv, fech, fat]);

          // Sync daily record for this consultant and channel
          await syncDailyRecordsForChannel(date, cId, parseInt(channel_id, 10));
        }
      }
    }

    res.status(201).json({ id: leadGenId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/lead-generations/:id', requireAuth, requireRole('admin', 'leads'), async (req, res) => {
  const { id } = req.params;
  try {
    const record = await dbGet("SELECT date, channel_id FROM lead_generations WHERE id = ?", [id]);
    if (!record) {
      return res.status(404).json({ error: "Registro não encontrado." });
    }

    const wppChannelId = await getWhatsAppChannelId();
    const isWpp = (record.channel_id && wppChannelId && record.channel_id === wppChannelId);

    const dists = await dbAll("SELECT consultant_id FROM lead_generation_distributions WHERE lead_generation_id = ?", [id]);
    const consultantsToSync = dists.map(d => d.consultant_id);

    const result = await dbRun("DELETE FROM lead_generations WHERE id = ?", [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Registro não encontrado." });
    }

    for (const cId of consultantsToSync) {
      await syncDailyRecordsForChannel(record.date, cId, record.channel_id);
    }

    res.json({ message: "Registro removido com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/lead-generations/:id', requireAuth, requireRole('admin', 'leads'), async (req, res) => {
  const { id } = req.params;
  const { date, channel_id, system_id, convenio_id, produto_id, prospectados, aceites, inviaveis, investimento, fechamentos, faturamento, distributions } = req.body;
  if (!date || !convenio_id || !produto_id) {
    return res.status(400).json({ error: "Data, Convênio e Produto são obrigatórios." });
  }
  try {
    const oldRecord = await dbGet("SELECT date, channel_id FROM lead_generations WHERE id = ?", [id]);
    if (!oldRecord) {
      return res.status(404).json({ error: "Registro não encontrado." });
    }

    const wppChannelId = await getWhatsAppChannelId();
    const isWpp = (channel_id && wppChannelId && parseInt(channel_id, 10) === wppChannelId);
    if (isWpp && (!Array.isArray(distributions) || distributions.length === 0)) {
      return res.status(400).json({ error: "A distribuição por consultores é obrigatória para o canal Disparo WhatsApp." });
    }

    // Fetch old distributions
    const oldDists = await dbAll("SELECT consultant_id FROM lead_generation_distributions WHERE lead_generation_id = ?", [id]);
    const oldConsultants = oldDists.map(d => d.consultant_id);

    const result = await dbRun(`
      UPDATE lead_generations 
      SET date = ?, channel_id = ?, system_id = ?, convenio_id = ?, produto_id = ?, 
          prospectados = ?, aceites = ?, inviaveis = ?, investimento = ?, fechamentos = ?, faturamento = ?
      WHERE id = ?
    `, [
      date, 
      channel_id || null, 
      system_id || null, 
      convenio_id || null,
      produto_id || null,
      parseInt(prospectados || 0, 10),
      parseInt(aceites || 0, 10),
      parseInt(inviaveis || 0, 10),
      parseFloat(investimento || 0),
      parseInt(fechamentos || 0, 10),
      parseFloat(faturamento || 0),
      id
    ]);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Registro não encontrado." });
    }

    // Clear old distributions
    await dbRun("DELETE FROM lead_generation_distributions WHERE lead_generation_id = ?", [id]);

    let newConsultants = [];
    if (Array.isArray(distributions)) {
      for (const dist of distributions) {
        const { consultant_id, leads_totais, inviaveis: distInviaveis, fechados, faturamento: distFaturamento } = dist;
        const cId = parseInt(consultant_id, 10);
        const lt = parseInt(leads_totais, 10) || 0;
        const inv = parseInt(distInviaveis, 10) || 0;
        const fech = parseInt(fechados, 10) || 0;
        const fat = parseFloat(distFaturamento) || 0;

        if (lt > 0 || inv > 0 || fech > 0 || fat > 0) {
          await dbRun(`
            INSERT INTO lead_generation_distributions (lead_generation_id, consultant_id, leads_totais, inviaveis, fechados, faturamento)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [id, cId, lt, inv, fech, fat]);
          newConsultants.push(cId);
        }
      }
    }

    // Sync old combinations
    for (const cId of oldConsultants) {
      await syncDailyRecordsForChannel(oldRecord.date, cId, oldRecord.channel_id);
    }

    // Sync new combinations
    for (const cId of newConsultants) {
      await syncDailyRecordsForChannel(date, cId, parseInt(channel_id, 10));
    }

    res.json({ message: "Registro atualizado com sucesso!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/lead-generations/dashboard', requireAuth, requireRole('admin', 'leads'), async (req, res) => {
  const { start_date, end_date, channel_id, system_id, convenio_id, produto_id } = req.query;
  let filterQuery = "";
  const params = [];
  
  if (start_date) {
    filterQuery += " AND date >= ?";
    params.push(start_date);
  }
  if (end_date) {
    filterQuery += " AND date <= ?";
    params.push(end_date);
  }
  if (channel_id) {
    filterQuery += " AND channel_id = ?";
    params.push(channel_id);
  }
  if (system_id) {
    filterQuery += " AND system_id = ?";
    params.push(system_id);
  }
  if (convenio_id) {
    filterQuery += " AND convenio_id = ?";
    params.push(convenio_id);
  }
  if (produto_id) {
    filterQuery += " AND produto_id = ?";
    params.push(produto_id);
  }

  try {
    const kpis = await dbGet(`
      SELECT 
        COALESCE(SUM(prospectados), 0) as total_prospectados,
        COALESCE(SUM(aceites), 0) as total_aceites,
        COALESCE(SUM(inviaveis), 0) as total_inviaveis,
        COALESCE(SUM(investimento), 0) as total_investido,
        COALESCE(SUM(fechamentos), 0) as total_fechamentos,
        COALESCE(SUM(faturamento), 0) as total_faturamento
      FROM lead_generations
      WHERE 1=1 ${filterQuery}
    `, params);

    res.json(kpis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// PROGESTOR TABULATIONS INTEGRATION
// ----------------------------------------

let progestorCache = {
  data: null,
  lastFetched: 0,
  url: null
};
const PROGESTOR_CACHE_TTL = 55000; // 55 seconds

async function scrapeProgestorTabulacoes(manualUrl = null) {
  const mainUrl = 'https://sistemanovo.progestor21.com.br/sistema/atendimentos';
  const baseUrl = 'https://sistemanovo.progestor21.com.br';
  
  let jsonUrl = manualUrl;
  
  if (!jsonUrl) {
    // 1. Fetch the main atendimentos page
    const response = await fetch(mainUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!response.ok) {
      throw new Error(`Falha ao acessar a página principal do Progestor: HTTP ${response.status}`);
    }
    const html = await response.text();
    
    // 2. Extract JSON path from window.location redirect
    // window.location='/sistema/_lib/tmp/sc_json_..._grid_tb_telemarketing.json';
    let match = html.match(/window\.location\s*=\s*'([^']+sc_json_[^']+\.json)'/) 
             || html.match(/window\.location\s*=\s*"([^"]+sc_json_[^"]+\.json)"/);
             
    if (!match) {
      throw new Error('Link temporário de tabulações não encontrado no window.location da página do Progestor.');
    }
    
    const jsonPath = match[1];
    jsonUrl = jsonPath.startsWith('http') ? jsonPath : `${baseUrl}/${jsonPath.replace(/^\//, '')}`;
  }
  
  // 3. Fetch the JSON file
  const jsonRes = await fetch(`${jsonUrl}?_t=${Date.now()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });
  if (!jsonRes.ok) {
    throw new Error(`Falha ao baixar o JSON de tabulações em ${jsonUrl}: HTTP ${jsonRes.status}`);
  }
  
  const data = await jsonRes.json();
  if (!Array.isArray(data)) {
    throw new Error('O arquivo retornado pelo Progestor não possui formato de lista de tabulações válido.');
  }
  return { data, jsonUrl };
}

app.get('/api/progestor/tabulacoes', requireAuth, async (req, res) => {
  const { url, force } = req.query;
  const isForce = force === 'true';
  
  let finalUrl = url;
  try {
    if (!finalUrl) {
      const urlRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_tabulacoes_url'");
      if (urlRow && urlRow.value) {
        finalUrl = urlRow.value;
      }
    }
  } catch (e) {
    console.error("Erro ao obter URL do Progestor das configs:", e);
  }
  
  // Return cache if valid and not forcing
  if (!isForce && progestorCache.data && (Date.now() - progestorCache.lastFetched < PROGESTOR_CACHE_TTL)) {
    if (!finalUrl || finalUrl === progestorCache.url) {
      return res.json({
        source: 'cache',
        lastFetched: progestorCache.lastFetched,
        url: progestorCache.url,
        data: progestorCache.data
      });
    }
  }
  
  try {
    const { data, jsonUrl } = await scrapeProgestorTabulacoes(finalUrl);
    
    progestorCache = {
      data,
      lastFetched: Date.now(),
      url: jsonUrl
    };
    
    res.json({
      source: 'remote',
      lastFetched: progestorCache.lastFetched,
      url: progestorCache.url,
      data: progestorCache.data
    });
  } catch (err) {
    console.error('Erro ao buscar tabulações do Progestor:', err);
    // Use stale cache as fallback if we have it
    if (progestorCache.data) {
      return res.json({
        source: 'fallback-cache',
        lastFetched: progestorCache.lastFetched,
        url: progestorCache.url,
        data: progestorCache.data,
        error: err.message
      });
    }
    res.status(502).json({ error: err.message });
  }
});

// Sync Progestor tabulations into daily records
app.post('/api/progestor/sincronizar', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { data, closedStatuses, unviableStatuses } = req.body;
  
  if (!Array.isArray(data)) {
    return res.status(400).json({ error: "O corpo da requisição deve conter o array 'data' de tabulações." });
  }

  try {
    let closedList = closedStatuses;
    let unviableList = unviableStatuses;

    if (!closedList || !unviableList) {
      const closedRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_closed'");
      const unviableRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_unviable'");
      closedList = (closedRow ? closedRow.value : '45').split(',').map(s => s.trim());
      unviableList = (unviableRow ? unviableRow.value : '33').split(',').map(s => s.trim());
    }

    const closedSet = new Set(closedList.map(s => String(s).trim()));
    const unviableSet = new Set(unviableList.map(s => String(s).trim()));

    // 1. Get consultants with progestor_user
    const dbConsultants = await dbAll("SELECT id, progestor_user FROM consultants WHERE progestor_user IS NOT NULL AND progestor_user <> ''");
    const consultantMap = new Map();
    dbConsultants.forEach(c => {
      consultantMap.set(c.progestor_user.trim().toLowerCase(), c.id);
    });

    // 2. Get channels with progestor_code
    const dbChannels = await dbAll("SELECT id, progestor_code FROM channels WHERE active = 1 AND progestor_code IS NOT NULL AND progestor_code <> ''");
    const channelMap = new Map();
    dbChannels.forEach(ch => {
      channelMap.set(ch.progestor_code.trim().toLowerCase(), ch.id);
    });

    // 3. Helper to format date DD/MM/YYYY into YYYY-MM-DD
    const parseDateToIso = (dateStr) => {
      if (!dateStr) return '';
      const parts = dateStr.trim().split(' ');
      const dateParts = parts[0].split('/');
      if (dateParts.length === 3) {
        return `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // YYYY-MM-DD
      }
      return '';
    };

    // 4. Group metrics by key: Date + "_" + ConsultantId + "_" + ChannelId
    const groups = {};

    data.forEach(r => {
      const func = String(r.Funcionario || '').trim().toLowerCase();
      const canal = String(r.Canalvenda || '').trim().toLowerCase();
      
      const consultantId = consultantMap.get(func);
      const channelId = channelMap.get(canal);
      
      const dateIso = parseDateToIso(r.Data);

      if (!consultantId || !channelId || !dateIso) {
        // Skip unmapped or invalid records
        return;
      }

      const key = `${dateIso}_${consultantId}_${channelId}`;
      if (!groups[key]) {
        groups[key] = {
          date: dateIso,
          consultantId,
          channelId,
          leadsTotais: 0,
          inviaveis: 0,
          fechados: 0
        };
      }

      groups[key].leadsTotais++;

      const rawStatusCode = String(r['Cod Status'] || r['Codstatus'] || r['codstatus'] || '').trim();
      
      if (closedSet.has(rawStatusCode)) {
        groups[key].fechados++;
      } else if (unviableSet.has(rawStatusCode)) {
        groups[key].inviaveis++;
      }
    });

    // 5. Upsert each group into daily_records
    let upsertCount = 0;
    for (const key of Object.keys(groups)) {
      const g = groups[key];
      
      await dbRun(`
        INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, 'Sincronizado automaticamente via Progestor')
        ON CONFLICT (date, consultant_id, channel_id)
        DO UPDATE SET
          leads_totais = EXCLUDED.leads_totais,
          inviaveis = EXCLUDED.inviaveis,
          fechados = EXCLUDED.fechados,
          observacoes = COALESCE(daily_records.observacoes, EXCLUDED.observacoes)
      `, [g.date, g.consultantId, g.channelId, g.leadsTotais, g.inviaveis, g.fechados]);

      upsertCount++;
    }

    res.json({ message: "Sincronização concluída com sucesso!", recordsSynced: upsertCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Retroactive full Progestor sync for all dates
app.post('/api/progestor/sincronizar-total', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    // 1. Get configurations from database
    const closedRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_closed'");
    const unviableRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_unviable'");
    const urlRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_tabulacoes_url'");

    const closedList = (closedRow ? closedRow.value : '45').split(',').map(s => s.trim());
    const unviableList = (unviableRow ? unviableRow.value : '33').split(',').map(s => s.trim());
    const finalUrl = urlRow ? urlRow.value : '';

    const closedSet = new Set(closedList.map(s => String(s).trim()));
    const unviableSet = new Set(unviableList.map(s => String(s).trim()));

    // 2. Fetch data from Progestor
    const { data } = await scrapeProgestorTabulacoes(finalUrl);
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: "Nenhum dado obtido do Progestor." });
    }

    // 3. Get consultants and channels mapping
    const dbConsultants = await dbAll("SELECT id, progestor_user FROM consultants WHERE progestor_user IS NOT NULL AND progestor_user <> ''");
    const consultantMap = new Map();
    dbConsultants.forEach(c => {
      consultantMap.set(c.progestor_user.trim().toLowerCase(), c.id);
    });

    const dbChannels = await dbAll("SELECT id, progestor_code FROM channels WHERE active = 1 AND progestor_code IS NOT NULL AND progestor_code <> ''");
    const channelMap = new Map();
    dbChannels.forEach(ch => {
      channelMap.set(ch.progestor_code.trim().toLowerCase(), ch.id);
    });

    // 4. Helper to format date
    const parseDateToIso = (dateStr) => {
      if (!dateStr) return '';
      const parts = dateStr.trim().split(' ');
      const dateParts = parts[0].split('/');
      if (dateParts.length === 3) {
        return `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
      }
      return '';
    };

    const groups = {};

    data.forEach(r => {
      const func = String(r.Funcionario || '').trim().toLowerCase();
      const canal = String(r.Canalvenda || '').trim().toLowerCase();
      
      const consultantId = consultantMap.get(func);
      const channelId = channelMap.get(canal);
      
      const dateIso = parseDateToIso(r.Data);

      if (!consultantId || !channelId || !dateIso) return;

      const key = `${dateIso}_${consultantId}_${channelId}`;
      if (!groups[key]) {
        groups[key] = {
          date: dateIso,
          consultantId,
          channelId,
          leadsTotais: 0,
          inviaveis: 0,
          fechados: 0
        };
      }

      groups[key].leadsTotais++;

      const rawStatusCode = String(r['Cod Status'] || r['Codstatus'] || r['codstatus'] || '').trim();
      
      if (closedSet.has(rawStatusCode)) {
        groups[key].fechados++;
      } else if (unviableSet.has(rawStatusCode)) {
        groups[key].inviaveis++;
      }
    });

    let upsertCount = 0;
    for (const key of Object.keys(groups)) {
      const g = groups[key];
      
      await dbRun(`
        INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, 'Sincronizado retroativamente via Progestor')
        ON CONFLICT (date, consultant_id, channel_id)
        DO UPDATE SET
          leads_totais = EXCLUDED.leads_totais,
          inviaveis = EXCLUDED.inviaveis,
          fechados = EXCLUDED.fechados,
          observacoes = COALESCE(daily_records.observacoes, EXCLUDED.observacoes)
      `, [g.date, g.consultantId, g.channelId, g.leadsTotais, g.inviaveis, g.fechados]);

      upsertCount++;
    }

    res.json({ message: `Sincronização histórica concluída com sucesso! ${upsertCount} registros sincronizados.`, recordsSynced: upsertCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Progestor Status mappings
app.get('/api/settings/progestor-status', requireAuth, async (req, res) => {
  try {
    const closedRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_closed'");
    const unviableRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_unviable'");
    const urlRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_tabulacoes_url'");
    res.json({
      closed: closedRow ? closedRow.value : '45',
      unviable: unviableRow ? unviableRow.value : '33',
      url: urlRow ? urlRow.value : ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Progestor Status mappings
app.post('/api/settings/progestor-status', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { closed, unviable, url } = req.body;
  try {
    await dbRun(`
      INSERT INTO system_settings (key, value) 
      VALUES ('progestor_mapping_closed', ?) 
      ON CONFLICT (key) 
      DO UPDATE SET value = EXCLUDED.value
      RETURNING key
    `, [closed || '45']);
    
    await dbRun(`
      INSERT INTO system_settings (key, value) 
      VALUES ('progestor_mapping_unviable', ?) 
      ON CONFLICT (key) 
      DO UPDATE SET value = EXCLUDED.value
      RETURNING key
    `, [unviable || '33']);

    await dbRun(`
      INSERT INTO system_settings (key, value) 
      VALUES ('progestor_tabulacoes_url', ?) 
      ON CONFLICT (key) 
      DO UPDATE SET value = EXCLUDED.value
      RETURNING key
    `, [url || '']);
    
    res.json({ message: "Configuração de integração do Progestor salva com sucesso!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Background auto-sync function for today and yesterday tabulations
async function runAutomaticProgestorSync() {
  console.log('[PROGESTOR SYNC] Iniciando sincronização automática de tabulações...');
  try {
    // 1. Get configurations from database
    const closedRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_closed'");
    const unviableRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_unviable'");
    const urlRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_tabulacoes_url'");

    const closedList = (closedRow ? closedRow.value : '45').split(',').map(s => s.trim());
    const unviableList = (unviableRow ? unviableRow.value : '33').split(',').map(s => s.trim());
    const finalUrl = urlRow ? urlRow.value : '';

    const closedSet = new Set(closedList.map(s => String(s).trim()));
    const unviableSet = new Set(unviableList.map(s => String(s).trim()));

    // 2. Fetch data from Progestor
    const { data } = await scrapeProgestorTabulacoes(finalUrl);
    if (!Array.isArray(data) || data.length === 0) {
      console.log('[PROGESTOR SYNC] Nenhum dado obtido do Progestor.');
      return;
    }

    // 3. Get consultants and channels mapping
    const dbConsultants = await dbAll("SELECT id, progestor_user FROM consultants WHERE progestor_user IS NOT NULL AND progestor_user <> ''");
    const consultantMap = new Map();
    dbConsultants.forEach(c => {
      consultantMap.set(c.progestor_user.trim().toLowerCase(), c.id);
    });

    const dbChannels = await dbAll("SELECT id, progestor_code FROM channels WHERE active = 1 AND progestor_code IS NOT NULL AND progestor_code <> ''");
    const channelMap = new Map();
    dbChannels.forEach(ch => {
      channelMap.set(ch.progestor_code.trim().toLowerCase(), ch.id);
    });

    // 4. Helper to format date
    const parseDateToIso = (dateStr) => {
      if (!dateStr) return '';
      const parts = dateStr.trim().split(' ');
      const dateParts = parts[0].split('/');
      if (dateParts.length === 3) {
        return `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
      }
      return '';
    };

    // Calculate Today and Yesterday ISO strings
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const getLocalDateIso = (dObj) => {
      const yyyy = dObj.getFullYear();
      const mm = String(dObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dObj.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    const todayIso = getLocalDateIso(today);
    const yesterdayIso = getLocalDateIso(yesterday);

    console.log(`[PROGESTOR SYNC] Filtrando tabulações para hoje (${todayIso}) e ontem (${yesterdayIso})...`);

    const groups = {};

    data.forEach(r => {
      const func = String(r.Funcionario || '').trim().toLowerCase();
      const canal = String(r.Canalvenda || '').trim().toLowerCase();
      
      const consultantId = consultantMap.get(func);
      const channelId = channelMap.get(canal);
      
      const dateIso = parseDateToIso(r.Data);

      // Only sync today's and yesterday's records automatically to keep performance high
      if (!consultantId || !channelId || !dateIso) return;
      if (dateIso !== todayIso && dateIso !== yesterdayIso) return;

      const key = `${dateIso}_${consultantId}_${channelId}`;
      if (!groups[key]) {
        groups[key] = {
          date: dateIso,
          consultantId,
          channelId,
          leadsTotais: 0,
          inviaveis: 0,
          fechados: 0
        };
      }

      groups[key].leadsTotais++;

      const rawStatusCode = String(r['Cod Status'] || r['Codstatus'] || r['codstatus'] || '').trim();
      
      if (closedSet.has(rawStatusCode)) {
        groups[key].fechados++;
      } else if (unviableSet.has(rawStatusCode)) {
        groups[key].inviaveis++;
      }
    });

    let upsertCount = 0;
    for (const key of Object.keys(groups)) {
      const g = groups[key];
      
      await dbRun(`
        INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, 'Sincronizado automaticamente via Progestor')
        ON CONFLICT (date, consultant_id, channel_id)
        DO UPDATE SET
          leads_totais = EXCLUDED.leads_totais,
          inviaveis = EXCLUDED.inviaveis,
          fechados = EXCLUDED.fechados,
          observacoes = COALESCE(daily_records.observacoes, EXCLUDED.observacoes)
      `, [g.date, g.consultantId, g.channelId, g.leadsTotais, g.inviaveis, g.fechados]);

      upsertCount++;
    }

    console.log(`[PROGESTOR SYNC] Sincronização automática finalizada com sucesso! ${upsertCount} registros sincronizados.`);
  } catch (err) {
    console.error('[PROGESTOR SYNC] Erro na sincronização automática:', err);
  }
}

// ----------------------------------------
// START SERVER
// ----------------------------------------
(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
      console.log(`URL Local: http://localhost:${PORT}`);
      
      // Start background automatic synchronization every 15 minutes
      const SYNC_INTERVAL = 15 * 60 * 1000; 
      setInterval(runAutomaticProgestorSync, SYNC_INTERVAL);
      
      // Run first check 5 seconds after startup
      setTimeout(runAutomaticProgestorSync, 5000);
    });
  } catch (err) {
    console.error("Erro ao iniciar banco de dados:", err);
    process.exit(1);
  }
})();
