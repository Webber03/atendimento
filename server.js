require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { initDb, dbRun, dbGet, dbAll } = require('./database');
const { requireAuth, requireRole, generateToken } = require('./auth');
const { google } = require('googleapis');
const multer = require('multer');
const { Readable } = require('stream');
const fs = require('fs');

// Configuração do Google Drive API (suporta tanto Service Account quanto OAuth2 para contas comuns)
let drive = null;

// Função para inicializar o Drive com OAuth2 Pessoal
function initializeOAuthDrive(refreshToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (clientId && clientSecret && redirectUri && refreshToken) {
    try {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      drive = google.drive({ version: 'v3', auth: oauth2Client });
      console.log('Google Drive API (OAuth2 Pessoal) inicializada com sucesso.');
      return true;
    } catch (err) {
      console.error('Erro ao inicializar Google Drive API via OAuth2:', err.message);
    }
  }
  return false;
}

// Secundário: Função para inicializar o Drive com Service Account
function initializeServiceAccountDrive() {
  let credentials = null;
  if (process.env.GOOGLE_DRIVE_CREDENTIALS) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_DRIVE_CREDENTIALS);
    } catch (err) {
      console.error('Erro ao decodificar GOOGLE_DRIVE_CREDENTIALS:', err.message);
    }
  } else {
    const credentialsPath = path.join(__dirname, 'google-credentials.json');
    if (fs.existsSync(credentialsPath)) {
      try {
        credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      } catch (err) {
        console.error('Erro ao ler credenciais do arquivo google-credentials.json:', err.message);
      }
    }
  }

  if (credentials) {
    try {
      const privateKey = (credentials.private_key || '').replace(/\\n/g, '\n');
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: credentials.client_email,
          private_key: privateKey
        },
        scopes: ['https://www.googleapis.com/auth/drive']
      });
      drive = google.drive({ version: 'v3', auth });
      console.log('Google Drive API (Service Account) inicializada com sucesso.');
      return true;
    } catch (err) {
      console.error('Erro ao inicializar Google Drive API via Service Account:', err.message);
    }
  }
  return false;
}

// Inicializar Drive ao iniciar o servidor
setTimeout(async () => {
  try {
    // 1. Tentar inicializar com OAuth2 (se o refresh_token já estiver no banco)
    const row = await dbGet("SELECT value FROM system_settings WHERE key = 'google_drive_refresh_token'");
    if (row && row.value) {
      const ok = initializeOAuthDrive(row.value);
      if (ok) return;
    }
  } catch (err) {
    console.error('Erro ao carregar refresh_token do banco:', err.message);
  }

  // 2. Fallback: Tentar inicializar com Service Account
  initializeServiceAccountDrive();
}, 2000); // Aguarda 2 segundos para dar tempo do banco de dados iniciar

// Configuração do Multer (upload em memória, apenas PDF)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos PDF são permitidos.'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // Limite de 10MB
  }
});

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
        name: user.name,
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
      "INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, ?, ?)",
      [username.trim().toLowerCase(), hash, 'admin', 'Administrador']
    );
    res.status(201).json({ message: 'Administrador criado com sucesso!', id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/google — Redireciona o usuário para consentimento do Google
app.get('/api/auth/google', async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  
  if (!clientId || !redirectUri) {
    return res.status(400).send('Erro: GOOGLE_CLIENT_ID e GOOGLE_REDIRECT_URI precisam estar configurados nas variáveis de ambiente da VPS.');
  }

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, null, redirectUri);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/drive']
    });
    res.redirect(authUrl);
  } catch (err) {
    res.status(500).send('Erro ao gerar URL do Google OAuth: ' + err.message);
  }
});

// GET /api/auth/google/callback — Recebe o callback do Google
app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!code) {
    return res.status(400).send('Erro: Código de autorização ausente.');
  }

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.refresh_token) {
      return res.send('<h1>Erro de Autorização</h1><p>O Google não retornou o <strong>refresh_token</strong>.</p><p>Isso acontece se o app já estiver autorizado na sua conta. Vá em <a href="https://myaccount.google.com/connections" target="_blank">Acessos à Conta Google</a>, remova o acesso do "LF CRM" (ou do nome do projeto criado) e tente novamente para forçar o consentimento.</p>');
    }

    // Salvar o refresh token no banco de dados de configurações do sistema
    await dbRun(
      "INSERT INTO system_settings (key, value) VALUES ('google_drive_refresh_token', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value RETURNING key",
      [tokens.refresh_token]
    );

    // Inicializar o cliente Drive do backend com a nova autenticação
    initializeOAuthDrive(tokens.refresh_token);

    res.send('<h1>LF CRM — Google Drive Autenticado com sucesso!</h1><p>O <strong>refresh_token</strong> foi gerado e salvo com sucesso no banco de dados.</p><p>A integração com o seu Drive pessoal já está ativa! Pode fechar esta janela e voltar ao sistema.</p>');
  } catch (err) {
    console.error('Erro ao processar callback do Google:', err);
    res.status(500).send('Erro na autenticação: ' + err.message);
  }
});

// ----------------------------------------
// USER MANAGEMENT ENDPOINTS (admin only)
// ----------------------------------------

// GET /api/users — Lista todos os usuários
app.get('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT u.id, u.username, u.name, u.role, u.team_id, u.active, u.created_at, t.name as team_name
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
  const { username, password, role, team_id, name } = req.body;
  if (!username || !password || !role || !name) {
    return res.status(400).json({ error: 'Nome, login (usuário), senha e perfil são obrigatórios.' });
  }
  if (!['admin', 'supervisor', 'leads', 'sdr', 'closer'].includes(role)) {
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
      "INSERT INTO users (username, password_hash, role, team_id, name) VALUES (?, ?, ?, ?, ?)",
      [username.trim().toLowerCase(), hash, role, team_id || null, name.trim()]
    );
    res.status(201).json({ id: result.lastID, username: username.trim().toLowerCase(), name: name.trim(), role, team_id: team_id || null });
  } catch (err) {
    if (/unique/i.test(err.message)) {
      return res.status(400).json({ error: 'Já existe um usuário com este login.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — Atualiza usuário (senha opcional)
app.put('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { username, name, password, role, team_id, active } = req.body;
  if (role && !['admin', 'supervisor', 'leads', 'sdr', 'closer'].includes(role)) {
    return res.status(400).json({ error: 'Perfil inválido.' });
  }
  try {
    const existing = await dbGet('SELECT * FROM users WHERE id = $1', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const finalUsername = username !== undefined ? username.trim().toLowerCase() : existing.username;
    const finalName = name !== undefined ? name.trim() : existing.name;
    const finalRole = role !== undefined ? role : existing.role;
    const finalTeamId = team_id !== undefined ? team_id : existing.team_id;
    const finalActive = active !== undefined ? active : existing.active;

    let query, params;
    if (password && password.length >= 6) {
      const hash = await bcrypt.hash(password, 12);
      query = "UPDATE users SET username = ?, name = ?, password_hash = ?, role = ?, team_id = ?, active = ? WHERE id = ?";
      params = [finalUsername, finalName, hash, finalRole, finalTeamId, finalActive, id];
    } else {
      query = "UPDATE users SET username = ?, name = ?, role = ?, team_id = ?, active = ? WHERE id = ?";
      params = [finalUsername, finalName, finalRole, finalTeamId, finalActive, id];
    }
    const result = await dbRun(query, params);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.json({ message: 'Usuário atualizado com sucesso.' });
  } catch (err) {
    if (/unique/i.test(err.message)) {
      return res.status(400).json({ error: 'Já existe um usuário com este login.' });
    }
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
// CRM, KANBAN, DISCADORA & CLIENTES MODULE
// ----------------------------------------

// Server-Sent Events (SSE) subscribers array para atualizações Realtime sem F5
let crmClients = [];

function broadcastCrmEvent(eventType, payload) {
  const data = JSON.stringify({ type: eventType, payload, timestamp: new Date().toISOString() });
  crmClients.forEach(client => {
    try {
      client.res.write(`data: ${data}\n\n`);
    } catch (err) {
      // Ignorar conexões mortas
    }
  });
}

// GET /api/crm/events — Stream de eventos Realtime para o Frontend
app.get('/api/crm/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  crmClients.push(newClient);

  req.on('close', () => {
    crmClients = crmClients.filter(c => c.id !== clientId);
  });
});

// Auxiliar de Fila Round-Robin com Pesos para Closers
async function getNextCloserFromQueue() {
  const activeClosers = await dbAll(`
    SELECT f.id, f.closer_id, f.peso, f.ordem, f.ultima_atribuicao_at, u.username
    FROM crm_fila_closers f
    JOIN users u ON f.closer_id = u.id
    WHERE f.ativo = TRUE AND u.active = TRUE
    ORDER BY f.ultima_atribuicao_at ASC NULLS FIRST, f.ordem ASC
  `);

  if (!activeClosers || activeClosers.length === 0) {
    return null;
  }

  const selected = activeClosers[0];
  await dbRun(`UPDATE crm_fila_closers SET ultima_atribuicao_at = CURRENT_TIMESTAMP WHERE id = ?`, [selected.id]);
  return selected.closer_id;
}

function parseBrDateTime(brStr) {
  if (!brStr) return null;
  const match = brStr.toString().trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    const hh = (match[4] || '00').padStart(2, '0');
    const mm = (match[5] || '00').padStart(2, '0');
    const ss = (match[6] || '00').padStart(2, '0');
    return `${year}-${month}-${day} ${hh}:${mm}:${ss}`;
  }
  return null;
}

function parseValueFromString(str) {
  if (str === undefined || str === null) return 0.00;
  // Limpa e trata formatos como "R$ 1.500,00", "1500", "1500,00"
  let cleaned = str.toString().trim()
    .replace(/R\$/gi, '')
    .replace(/\s/g, '');
    
  // Extrai apenas o padrão de números (incluindo pontos e vírgulas)
  const match = cleaned.match(/[\d.,]+/);
  if (!match) return 0.00;
  
  let numStr = match[0];
  
  if (numStr.includes('.') && numStr.includes(',')) {
    if (numStr.indexOf('.') < numStr.indexOf(',')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else {
      numStr = numStr.replace(/,/g, '');
    }
  } else if (numStr.includes(',')) {
    numStr = numStr.replace(',', '.');
  }
  
  const parsed = parseFloat(numStr);
  return isNaN(parsed) ? 0.00 : parsed;
}

app.post('/api/crm/webhook/discadora', async (req, res) => {
  console.log('[WEBHOOK DISCADORA] Novo payload recebido:', req.body);
  
  // Suporta tanto as chaves padrão do backend quanto as colunas diretas da planilha
  const cpf = req.body.cpf || req.body.CPF;
  const nome = req.body.nome || req.body.Nome;
  const telefone = req.body.telefone || req.body.Telefone;
  const email = req.body.email || req.body.Email;
  const fila = req.body.fila || req.body.Fila;
  const discadora_login = req.body.discadora_login || req.body.Agente || req.body.agente;
  const tabulacao = req.body.tabulacao || req.body.Classificacao || req.body.classificacao || req.body.Classificação || req.body.classificação;
  const observacao = req.body.observacao || req.body.Observacao || req.body.Observação || req.body.observação;
  const data_criacao = req.body.data_criacao || req.body['Hora e Data'] || req.body.hora_e_data;

  if (!nome && !telefone && !cpf) {
    return res.status(400).json({ error: 'É necessário informar ao menos Nome, CPF ou Telefone.' });
  }

  // 1. FILTRO RIGOROSO DE TABULAÇÃO: Deve ser estritamente "Interesse na Simulação"
  const tabStr = (tabulacao || '').toString().trim().toLowerCase();
  const eInteresse = tabStr.includes('interesse') && (tabStr.includes('simula') || tabStr.includes('simulação'));
  
  if (!eInteresse) {
    console.log(`[WEBHOOK DISCADORA] Ignorado (não é Interesse na Simulação): "${tabulacao}"`);
    return res.json({ message: 'Tabulação ignorada (não é Interesse na Simulação).', tabulacao });
  }

  // 2. FILTRO RIGOROSO DE AGENTE: O usuário da discadora DEVE estar cadastrado no CRM
  let assignedUserId = null;
  if (discadora_login && discadora_login.toString().trim() !== '') {
    const map = await dbGet('SELECT crm_user_id FROM crm_discadora_mapeamentos WHERE LOWER(TRIM(discadora_login)) = LOWER(TRIM(?))', [discadora_login.toString().trim()]);
    if (map) {
      assignedUserId = map.crm_user_id;
    }
  }

  if (!assignedUserId) {
    console.log(`[WEBHOOK DISCADORA] Ignorado: Operador "${discadora_login}" NÃO está cadastrado no mapeamento da discadora.`);
    return res.status(200).json({ message: `Operador "${discadora_login}" não cadastrado no CRM. Lead ignorado.` });
  }

  try {
    const fechaPersonalizada = parseBrDateTime(data_criacao);

    // Definir nome limpo com fallback seguro (nunca salva string vazia)
    const nomeLimpo = (nome && nome.toString().trim() !== '') 
      ? nome.toString().trim() 
      : (cpf && cpf.toString().trim() !== '' ? `Cliente CPF ${cpf.toString().trim()}` : 'Cliente Discadora');

    const cpfLimpo = (cpf && cpf.toString().trim() !== '') ? cpf.toString().trim() : null;
    const telLimpo = (telefone && telefone.toString().trim() !== '') ? telefone.toString().trim() : null;
    const obsLimpa = (observacao && observacao.toString().trim() !== '') ? observacao.toString().trim() : null;

    const valorWebhook = parseValueFromString(observacao);

    // Se extraímos um valor numérico válido (> 0) da observação,
    // não salvamos esse valor como texto nas observações do cliente ou da tabulação (deixando apenas no campo valor)
    const obsSalvarCliente = (valorWebhook > 0) ? null : obsLimpa;
    const obsTabulacao = (valorWebhook > 0) ? (fila || null) : (observacao || fila || null);

    // 3. Cadastrar ou localizar o cliente
    let cliente = null;
    if (cpfLimpo) {
      cliente = await dbGet('SELECT * FROM crm_clientes WHERE cpf = ?', [cpfLimpo]);
    }
    if (!cliente && telLimpo) {
      cliente = await dbGet('SELECT * FROM crm_clientes WHERE telefone = ?', [telLimpo]);
    }

    let clienteId;
    if (cliente) {
      clienteId = cliente.id;
      await dbRun(
        'UPDATE crm_clientes SET nome = ?, telefone = COALESCE(?, telefone), email = COALESCE(?, email), observacoes = COALESCE(?, observacoes), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [nomeLimpo, telLimpo, email ? email.toString().trim() : null, obsSalvarCliente, clienteId]
      );
    } else {
      const resCli = await dbRun(
        'INSERT INTO crm_clientes (cpf, nome, telefone, email, observacoes) VALUES (?, ?, ?, ?, ?)',
        [cpfLimpo, nomeLimpo, telLimpo, email ? email.toString().trim() : null, obsSalvarCliente]
      );
      clienteId = resCli.lastID;
    }

    // 4. Registrar a Tabulação (Preservando a data informada na planilha)
    let finalConsultorNome = discadora_login || 'Discadora Auto';
    if (assignedUserId) {
      const userRow = await dbGet('SELECT name, username FROM users WHERE id = ?', [assignedUserId]);
      if (userRow) {
        finalConsultorNome = userRow.name || userRow.username || finalConsultorNome;
      }
    }

    if (fechaPersonalizada) {
      await dbRun(
        'INSERT INTO crm_tabulacoes (cliente_id, consultor_id, consultor_nome, tipo_tabulacao, observacao, iniciou_kanban, valor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [clienteId, assignedUserId, finalConsultorNome, tabulacao || 'Interesse na Simulação', obsTabulacao, true, valorWebhook, fechaPersonalizada]
      );
    } else {
      await dbRun(
        'INSERT INTO crm_tabulacoes (cliente_id, consultor_id, consultor_nome, tipo_tabulacao, observacao, iniciou_kanban, valor) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [clienteId, assignedUserId, finalConsultorNome, tabulacao || 'Interesse na Simulação', obsTabulacao, true, valorWebhook]
      );
    }

    // 4. Determinar estágio inicial do Kanban SDR ("CONTATO INICIAL")
    let estagioInicial = await dbGet("SELECT id FROM crm_kanban_estagios WHERE pipeline_tipo = 'sdr' AND ativo = TRUE ORDER BY ordem ASC LIMIT 1");
    if (!estagioInicial) {
      estagioInicial = await dbGet("SELECT id FROM crm_kanban_estagios WHERE ativo = TRUE ORDER BY ordem ASC LIMIT 1");
    }
    const estagioId = estagioInicial ? estagioInicial.id : null;

    // 5. Criar o Card no Kanban SDR (Preservando a data informada na planilha)
    let resLead;
    if (fechaPersonalizada) {
      resLead = await dbRun(
        `INSERT INTO crm_kanban_leads 
          (cliente_id, sdr_id, closer_id, estagio_id, status_atendimento, discadora_login, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [clienteId, assignedUserId, null, estagioId, 'em_atendimento', discadora_login || null, fechaPersonalizada]
      );
    } else {
      resLead = await dbRun(
        `INSERT INTO crm_kanban_leads 
          (cliente_id, sdr_id, closer_id, estagio_id, status_atendimento, discadora_login) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [clienteId, assignedUserId, null, estagioId, 'em_atendimento', discadora_login || null]
      );
    }

    const leadId = resLead.lastID;

    // 6. Historico de movimentação
    await dbRun(
      'INSERT INTO crm_kanban_historico (lead_id, estagio_novo_id, usuario_id, observacao) VALUES (?, ?, ?, ?)',
      [leadId, estagioId, assignedUserId, 'Lead criado via Discadora na coluna CONTATO INICIAL (SDR)']
    );

    // 7. Notificar via Realtime (SSE)
    const leadCompleto = await dbGet(`
      SELECT l.*, c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone,
             e.nome as estagio_nome, e.cor as estagio_cor, e.pipeline_tipo,
             u.username as sdr_nome
      FROM crm_kanban_leads l
      JOIN crm_clientes c ON l.cliente_id = c.id
      LEFT JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      LEFT JOIN users u ON l.sdr_id = u.id
      WHERE l.id = ?
    `, [leadId]);

    broadcastCrmEvent('LEAD_NOVO', leadCompleto);
    console.log(`[WEBHOOK DISCADORA] Lead #${leadId} (${nome}) criado no Kanban SDR (CONTATO INICIAL) com data: ${fechaPersonalizada || 'Agora'}`);

    res.status(201).json({
      message: 'Lead recebido da discadora e inserido no Kanban com sucesso!',
      lead: leadCompleto
    });
  } catch (err) {
    console.error('Erro no webhook da discadora:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// BUSCA E TABULAÇÃO DE CLIENTES
// ----------------------------------------

// GET /api/crm/clientes/search — Busca clientes por CPF, Nome ou Telefone (com ou sem pontuação)
app.get('/api/crm/clientes/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Informe pelo menos 2 caracteres para busca.' });
  }

  const queryRaw = q.trim();
  const queryTerm = `%${queryRaw}%`;
  const digitsOnly = queryRaw.replace(/\D/g, '');
  const digitsTerm = digitsOnly.length >= 2 ? `%${digitsOnly}%` : null;

  try {
    let clientes;
    if (digitsTerm) {
      clientes = await dbAll(`
        SELECT c.*, 
          (SELECT COUNT(*) FROM crm_tabulacoes t WHERE t.cliente_id = c.id) as total_tabulacoes,
          (SELECT MAX(created_at) FROM crm_tabulacoes t WHERE t.cliente_id = c.id) as ultima_tabulacao_at
        FROM crm_clientes c
        WHERE c.cpf LIKE ? OR c.nome ILIKE ? OR c.telefone LIKE ?
           OR REGEXP_REPLACE(COALESCE(c.cpf, ''), '\\D', '', 'g') LIKE ?
           OR REGEXP_REPLACE(COALESCE(c.telefone, ''), '\\D', '', 'g') LIKE ?
        ORDER BY c.updated_at DESC LIMIT 30
      `, [queryTerm, queryTerm, queryTerm, digitsTerm, digitsTerm]);
    } else {
      clientes = await dbAll(`
        SELECT c.*, 
          (SELECT COUNT(*) FROM crm_tabulacoes t WHERE t.cliente_id = c.id) as total_tabulacoes,
          (SELECT MAX(created_at) FROM crm_tabulacoes t WHERE t.cliente_id = c.id) as ultima_tabulacao_at
        FROM crm_clientes c
        WHERE c.cpf LIKE ? OR c.nome ILIKE ? OR c.telefone LIKE ?
        ORDER BY c.updated_at DESC LIMIT 30
      `, [queryTerm, queryTerm, queryTerm]);
    }

    res.json(clientes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/clientes/:id — Ficha detalhada do cliente + histórico
app.get('/api/crm/clientes/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [id]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    // Tabulações
    const tabulacoes = await dbAll(`
      SELECT t.*, u.username as consultor_username
      FROM crm_tabulacoes t
      LEFT JOIN users u ON t.consultor_id = u.id
      WHERE t.cliente_id = ?
      ORDER BY t.created_at DESC
    `, [id]);

    // Histórico de movimentações no Kanban
    const historicoKanban = await dbAll(`
      SELECT h.*, e_ant.nome as estagio_anterior_nome, e_novo.nome as estagio_novo_nome, u.username as usuario_nome
      FROM crm_kanban_historico h
      JOIN crm_kanban_leads l ON h.lead_id = l.id
      LEFT JOIN crm_kanban_estagios e_ant ON h.estagio_anterior_id = e_ant.id
      LEFT JOIN crm_kanban_estagios e_novo ON h.estagio_novo_id = e_novo.id
      LEFT JOIN users u ON h.usuario_id = u.id
      WHERE l.cliente_id = ?
      ORDER BY h.created_at DESC
    `, [id]);

    res.json({
      cliente,
      tabulacoes,
      historicoKanban
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/clientes — Criar ou atualizar cliente
app.post('/api/crm/clientes', requireAuth, async (req, res) => {
  const { id, cpf, nome, telefone, email, observacoes, valor } = req.body;

  if (!nome || nome.trim() === '') {
    return res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
  }

  try {
    let targetClienteId = id;
    if (id) {
      await dbRun(
        'UPDATE crm_clientes SET cpf = ?, nome = ?, telefone = ?, email = ?, observacoes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [cpf ? cpf.trim() : null, nome.trim(), telefone ? telefone.trim() : null, email ? email.trim() : null, observacoes || null, id]
      );
    } else {
      const result = await dbRun(
        'INSERT INTO crm_clientes (cpf, nome, telefone, email, observacoes) VALUES (?, ?, ?, ?, ?)',
        [cpf ? cpf.trim() : null, nome.trim(), telefone ? telefone.trim() : null, email ? email.trim() : null, observacoes || null]
      );
      targetClienteId = result.lastID;
    }

    // Salvar/atualizar o valor na tabulação mais recente do cliente se informado
    if (valor !== undefined && valor !== null && valor !== '') {
      const valorNum = parseValueFromString(valor);
      const ultimaTab = await dbGet('SELECT id FROM crm_tabulacoes WHERE cliente_id = ? ORDER BY created_at DESC LIMIT 1', [targetClienteId]);
      if (ultimaTab) {
        await dbRun('UPDATE crm_tabulacoes SET valor = ? WHERE id = ?', [valorNum, ultimaTab.id]);
      } else {
        await dbRun(
          'INSERT INTO crm_tabulacoes (cliente_id, consultor_id, consultor_nome, tipo_tabulacao, observacao, iniciou_kanban, valor) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [targetClienteId, req.user.id, req.user.username, 'Interesse na Simulação', 'Valor de contrato atualizado', false, valorNum]
        );
      }
    }

    if (id) {
      res.json({ message: 'Cliente atualizado com sucesso!', id });
    } else {
      res.status(201).json({ message: 'Cliente cadastrado com sucesso!', id: targetClienteId });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/tabulacoes — Registrar nova tabulação
app.post('/api/crm/tabulacoes', requireAuth, async (req, res) => {
  const { cliente_id, tipo_tabulacao, observacao, iniciar_kanban, pipeline_tipo, valor } = req.body;

  if (!cliente_id || !tipo_tabulacao) {
    return res.status(400).json({ error: 'Cliente e Tipo de Tabulação são obrigatórios.' });
  }

  const valorNum = parseValueFromString(valor);

  try {
    const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [cliente_id]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    let leadId = null;
    if (iniciar_kanban) {
      const pTipo = pipeline_tipo || 'sdr';
      const estagio = await dbGet('SELECT id FROM crm_kanban_estagios WHERE pipeline_tipo = ? AND ativo = TRUE ORDER BY ordem ASC LIMIT 1', [pTipo]);
      
      const sdrId = pTipo === 'sdr' ? req.user.id : null;
      let closerId = pTipo === 'closer' ? req.user.id : null;
      if (!closerId && pTipo === 'closer') {
        closerId = await getNextCloserFromQueue();
      }

      const resLead = await dbRun(
        'INSERT INTO crm_kanban_leads (cliente_id, sdr_id, closer_id, estagio_id, status_atendimento) VALUES (?, ?, ?, ?, ?)',
        [cliente_id, sdrId, closerId, estagio ? estagio.id : null, closerId ? 'pendente_aceite' : 'em_atendimento']
      );
      leadId = resLead.lastID;

      await dbRun(
        'INSERT INTO crm_kanban_historico (lead_id, estagio_novo_id, usuario_id, observacao) VALUES (?, ?, ?, ?)',
        [leadId, estagio ? estagio.id : null, req.user.id, `Lead iniciado via tabulação manual (${tipo_tabulacao})`]
      );
    }

    await dbRun(
      'INSERT INTO crm_tabulacoes (cliente_id, consultor_id, consultor_nome, tipo_tabulacao, observacao, iniciou_kanban, valor) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [cliente_id, req.user.id, req.user.name || req.user.username, tipo_tabulacao, observacao || null, !!iniciar_kanban, isNaN(valorNum) ? 0.00 : valorNum]
    );

    broadcastCrmEvent('TABULACAO_NOVA', { cliente_id, tipo_tabulacao, consultor: req.user.username });

    res.status(201).json({ message: 'Tabulação registrada com sucesso!', leadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// KANBAN ENDPOINTS
// ----------------------------------------

// GET /api/crm/kanban/estagios — Lista todos os estágios ativos do Kanban
app.get('/api/crm/kanban/estagios', requireAuth, async (req, res) => {
  try {
    const estagios = await dbAll('SELECT * FROM crm_kanban_estagios WHERE ativo = TRUE ORDER BY pipeline_tipo ASC, ordem ASC');
    res.json(estagios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/kanban/leads — Lista os cards do Kanban
app.get('/api/crm/kanban/leads', requireAuth, async (req, res) => {
  const { pipeline_tipo, closer_id, sdr_id } = req.query;
  
  try {
    let queryFilter = 'WHERE 1 = 1';
    const params = [];

    if (pipeline_tipo) {
      queryFilter += ' AND e.pipeline_tipo = ?';
      params.push(pipeline_tipo);
    }

    if (closer_id) {
      queryFilter += ' AND l.closer_id = ?';
      params.push(closer_id);
    }

    if (sdr_id) {
      queryFilter += ' AND l.sdr_id = ?';
      params.push(sdr_id);
    }

    const leads = await dbAll(`
      SELECT l.*, 
             c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone, c.email as cliente_email,
             c.drive_folder_id, c.doc_contracheque_id, c.doc_extrato_id, c.doc_identificacao_id, c.doc_residencia_id,
             e.nome as estagio_nome, e.cor as estagio_cor, e.pipeline_tipo, e.ordem as estagio_ordem,
             COALESCE(u_sdr.name, u_sdr.username) as sdr_nome,
             COALESCE(u_closer.name, u_closer.username) as closer_nome,
             (SELECT valor FROM crm_tabulacoes WHERE cliente_id = l.cliente_id AND valor > 0 ORDER BY created_at DESC LIMIT 1) as valor_contrato
      FROM crm_kanban_leads l
      JOIN crm_clientes c ON l.cliente_id = c.id
      JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
      LEFT JOIN users u_closer ON l.closer_id = u_closer.id
      ${queryFilter}
      ORDER BY l.status_atendimento ASC, l.updated_at DESC
    `, params);

    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/crm/kanban/leads/:id/move — Mover lead para novo estágio
app.put('/api/crm/kanban/leads/:id/move', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { estagio_id, observacao } = req.body;

  if (!estagio_id) {
    return res.status(400).json({ error: 'O novo estágio é obrigatório.' });
  }

  try {
    const lead = await dbGet('SELECT * FROM crm_kanban_leads WHERE id = ?', [id]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    const novoEstagio = await dbGet('SELECT * FROM crm_kanban_estagios WHERE id = ?', [estagio_id]);
    if (!novoEstagio) {
      return res.status(400).json({ error: 'Estágio de destino inválido.' });
    }

    // Regra: Bloquear movimentação para NEGOCIAÇÃO se não houver valor de contrato preenchido
    if (novoEstagio.nome.trim().toUpperCase() === 'NEGOCIAÇÃO' && lead.estagio_id !== estagio_id) {
      const valorObj = await dbGet(
        'SELECT valor FROM crm_tabulacoes WHERE cliente_id = ? AND valor > 0 ORDER BY created_at DESC LIMIT 1',
        [lead.cliente_id]
      );
      if (!valorObj || parseFloat(valorObj.valor) <= 0) {
        return res.status(400).json({ error: 'Para mover o lead para a coluna NEGOCIAÇÃO, é obrigatório preencher o Valor do Contrato.' });
      }
    }

    // Regra: Bloquear movimentação para ABERTURA DE CONTA se não houver os 5 documentos anexados
    if (novoEstagio.nome.trim().toUpperCase() === 'ABERTURA DE CONTA' && lead.estagio_id !== estagio_id) {
      const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [lead.cliente_id]);
      if (!cliente || !cliente.doc_contracheque_id || !cliente.doc_extrato_id || !cliente.doc_identificacao_id || !cliente.doc_residencia_id || !cliente.doc_espelho_id) {
        return res.status(400).json({ 
          error: 'Abertura de Conta exige os 5 documentos obrigatórios anexados.' 
        });
      }
    }

    const estagioAnteriorId = lead.estagio_id;

    // Atualizar o lead
    await dbRun(
      'UPDATE crm_kanban_leads SET estagio_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [estagio_id, id]
    );

    // Registrar histórico de movimentação
    await dbRun(
      'INSERT INTO crm_kanban_historico (lead_id, estagio_anterior_id, estagio_novo_id, usuario_id, observacao) VALUES (?, ?, ?, ?, ?)',
      [id, estagioAnteriorId, estagio_id, req.user.id, observacao || null]
    );

    const leadAtualizado = await dbGet(`
      SELECT l.*, c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone,
             c.drive_folder_id, c.doc_contracheque_id, c.doc_extrato_id, c.doc_identificacao_id, c.doc_residencia_id,
             e.nome as estagio_nome, e.cor as estagio_cor, e.pipeline_tipo,
             COALESCE(u_sdr.name, u_sdr.username) as sdr_nome, COALESCE(u_closer.name, u_closer.username) as closer_nome
      FROM crm_kanban_leads l
      JOIN crm_clientes c ON l.cliente_id = c.id
      JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
      LEFT JOIN users u_closer ON l.closer_id = u_closer.id
      WHERE l.id = ?
    `, [id]);

    broadcastCrmEvent('LEAD_MOVIDO', leadAtualizado);

    res.json({ message: 'Lead movido com sucesso!', lead: leadAtualizado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/leads/:id/documentos — Upload de documento para Google Drive
app.post('/api/crm/leads/:id/documentos', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  if (!drive) {
    return res.status(500).json({ error: 'Integração com Google Drive não está ativa ou configurada no servidor.' });
  }

  const { id } = req.params;
  const { docType } = req.body;
  const file = req.file;

  if (!docType || !['contracheque', 'extrato', 'identificacao', 'residencia', 'espelho'].includes(docType)) {
    return res.status(400).json({ error: 'Tipo de documento inválido.' });
  }

  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  try {
    // 1. Obter informações do lead e do cliente
    const lead = await dbGet('SELECT * FROM crm_kanban_leads WHERE id = ?', [id]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [lead.cliente_id]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    // 2. Definir nome da pasta do cliente no Google Drive
    // Formato: NOME DO CLIENTE - CPF (se CPF existir)
    const cpfLimpo = (cliente.cpf || '').replace(/\D/g, '');
    const cpfStr = cpfLimpo ? ` - ${cpfLimpo}` : '';
    const folderName = `${cliente.nome.trim().toUpperCase()}${cpfStr}`;
    const parentFolderId = '1NYMMgTD7Tr3TCDQ1KzK12LJxH4RtEoqh';

    let folderId = cliente.drive_folder_id;

    // Verificar se a pasta do cliente realmente existe e é acessível pela conta do Google atual
    if (folderId) {
      try {
        await drive.files.get({
          fileId: folderId,
          fields: 'id',
          supportsAllDrives: true
        });
      } catch (err) {
        console.warn(`Aviso: Pasta ${folderId} não encontrada ou está inacessível. Criando uma nova.`);
        folderId = null;
      }
    }

    // 3. Se o cliente não tem pasta no Drive (ou ela era de outra conta e está inacessível), cria uma
    if (!folderId) {
      console.log(`Criando pasta para o cliente no Drive: ${folderName}`);
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
      };

      const folderResponse = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id',
        supportsAllDrives: true
      });

      folderId = folderResponse.data.id;
      // Atualizar no banco
      await dbRun('UPDATE crm_clientes SET drive_folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [folderId, cliente.id]);
    }

    // 4. Mapear o nome do arquivo com base no tipo de documento e nome do cliente sanitizado
    const sanitizeFilename = (name) => {
      return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove acentos
        .replace(/[^a-z0-9]/g, '_') // substitui caracteres especiais por _
        .replace(/_+/g, '_') // colapsa múltiplos _
        .replace(/^_+|_+$/g, ''); // remove _ do início e fim
    };

    const docNames = {
      contracheque: 'contracheque',
      extrato: 'extrato_de_consignacao',
      identificacao: 'documento_de_identificacao',
      residencia: 'comprovante_de_residencia',
      espelho: 'espelho_da_proposta'
    };

    const cleanClientName = sanitizeFilename(cliente.nome);
    const newFileName = `${docNames[docType]}_${cleanClientName}.pdf`;

    // 5. Verificar se já existe arquivo deste tipo cadastrado e excluir do Drive para evitar duplicatas
    const dbColumns = {
      contracheque: 'doc_contracheque_id',
      extrato: 'doc_extrato_id',
      identificacao: 'doc_identificacao_id',
      residencia: 'doc_residencia_id',
      espelho: 'doc_espelho_id'
    };
    const dbColumn = dbColumns[docType];
    const oldFileId = cliente[dbColumn];

    if (oldFileId) {
      console.log(`Excluindo arquivo anterior do Drive: ${oldFileId}`);
      try {
        await drive.files.delete({ 
          fileId: oldFileId,
          supportsAllDrives: true
        });
      } catch (err) {
        console.warn(`Aviso ao excluir arquivo antigo ${oldFileId} no Drive:`, err.message);
      }
    }

    // 6. Fazer upload do arquivo no Drive
    const fileMetadata = {
      name: newFileName,
      parents: [folderId]
    };
    const media = {
      mimeType: 'application/pdf',
      body: Readable.from(file.buffer)
    };

    const driveFile = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name',
      supportsAllDrives: true
    });

    const fileId = driveFile.data.id;

    // 7. Salvar ID no banco de dados do cliente
    await dbRun(
      `UPDATE crm_clientes SET ${dbColumn} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [fileId, cliente.id]
    );

    // Registrar histórico da ação no Lead
    await dbRun(
      'INSERT INTO crm_kanban_historico (lead_id, usuario_id, observacao) VALUES (?, ?, ?)',
      [id, req.user.id, `Documento ${docNames[docType].toUpperCase()} anexado no Google Drive.`]
    );

    res.status(201).json({
      message: 'Documento enviado com sucesso!',
      fileId: fileId,
      fileName: driveFile.data.name
    });
  } catch (err) {
    console.error('Erro no upload do documento para o Drive:', err);
    res.status(500).json({ error: 'Erro interno ao salvar documento no Drive: ' + err.message });
  }
});

// DELETE /api/crm/leads/:id/documentos/:docType — Excluir documento do Google Drive e do banco
app.delete('/api/crm/leads/:id/documentos/:docType', requireAuth, async (req, res) => {
  if (!drive) {
    return res.status(500).json({ error: 'Integração com Google Drive não está ativa ou configurada no servidor.' });
  }

  const { id, docType } = req.params;

  if (!docType || !['contracheque', 'extrato', 'identificacao', 'residencia', 'espelho'].includes(docType)) {
    return res.status(400).json({ error: 'Tipo de documento inválido.' });
  }

  try {
    // 1. Obter informações do lead e do cliente
    const lead = await dbGet('SELECT * FROM crm_kanban_leads WHERE id = ?', [id]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [lead.cliente_id]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    // 2. Mapear as colunas
    const dbColumns = {
      contracheque: 'doc_contracheque_id',
      extrato: 'doc_extrato_id',
      identificacao: 'doc_identificacao_id',
      residencia: 'doc_residencia_id',
      espelho: 'doc_espelho_id'
    };
    
    const docNames = {
      contracheque: 'contracheque',
      extrato: 'extrato_de_consignacao',
      identificacao: 'documento_de_identificacao',
      residencia: 'comprovante_de_residencia',
      espelho: 'espelho_da_proposta'
    };

    const dbColumn = dbColumns[docType];
    const fileId = cliente[dbColumn];

    if (!fileId) {
      return res.status(400).json({ error: 'Documento não encontrado ou já excluído.' });
    }

    // 3. Excluir do Google Drive
    console.log(`Excluindo arquivo do Drive: ${fileId}`);
    try {
      await drive.files.delete({ 
        fileId: fileId,
        supportsAllDrives: true
      });
    } catch (err) {
      console.warn(`Aviso ao excluir arquivo ${fileId} no Drive:`, err.message);
    }

    // 4. Limpar do banco de dados do cliente
    await dbRun(
      `UPDATE crm_clientes SET ${dbColumn} = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [cliente.id]
    );

    // 5. Registrar histórico da ação no Lead
    await dbRun(
      'INSERT INTO crm_kanban_historico (lead_id, usuario_id, observacao) VALUES (?, ?, ?)',
      [id, req.user.id, `Documento ${docNames[docType].toUpperCase()} excluído do Google Drive.`]
    );

    res.json({ message: 'Documento excluído com sucesso!' });
  } catch (err) {
    console.error('Erro ao excluir documento do Drive:', err);
    res.status(500).json({ error: 'Erro interno ao excluir documento do Drive: ' + err.message });
  }
});

// GET /api/crm/documentos/download/:fileId — Baixar arquivo do Google Drive
app.get('/api/crm/documentos/download/:fileId', requireAuth, async (req, res) => {
  if (!drive) {
    return res.status(500).json({ error: 'Integração com Google Drive não está ativa ou configurada no servidor.' });
  }

  const { fileId } = req.params;

  try {
    // 1. Obter metadados do arquivo (para pegar o nome exato)
    const fileMeta = await drive.files.get({
      fileId: fileId,
      fields: 'name, mimeType',
      supportsAllDrives: true
    });

    const fileName = fileMeta.data.name;
    const mimeType = fileMeta.data.mimeType || 'application/pdf';

    // 2. Configurar headers para download com o nome correto
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', mimeType);

    // 3. Fazer stream do arquivo direto para a resposta HTTP
    const driveResponse = await drive.files.get(
      { fileId: fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );

    driveResponse.data
      .on('error', (err) => {
        console.error('Erro ao fazer stream do Drive:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Erro ao fazer download do arquivo.' });
        }
      })
      .pipe(res);

  } catch (err) {
    console.error('Erro ao baixar documento do Drive:', err);
    res.status(500).json({ error: 'Erro ao obter arquivo do Drive: ' + err.message });
  }
});

// POST /api/crm/kanban/leads/:id/aceitar — Closer aceita o lead (Desliga o Alerta)
app.post('/api/crm/kanban/leads/:id/aceitar', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const lead = await dbGet('SELECT * FROM crm_kanban_leads WHERE id = ?', [id]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    const agora = new Date();
    const criadoEm = new Date(lead.created_at);
    const tempoRespostaSegundos = Math.round((agora.getTime() - criadoEm.getTime()) / 1000);

    await dbRun(
      `UPDATE crm_kanban_leads 
       SET status_atendimento = 'em_atendimento', aceito_em = CURRENT_TIMESTAMP, tempo_resposta_segundos = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [tempoRespostaSegundos, id]
    );

    broadcastCrmEvent('LEAD_ACEITO', { id: parseInt(id), status_atendimento: 'em_atendimento', tempo_resposta_segundos: tempoRespostaSegundos });

    res.json({ message: 'Atendimento iniciado com sucesso! Alerta desligado.', tempo_resposta_segundos: tempoRespostaSegundos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// PAINEL ADMIN (ESTÁGIOS, FILA DE CLOSERS, DISCADORA)
// ----------------------------------------

// GET /api/crm/admin/estagios — Lista todos os estágios (incluindo inativos)
app.get('/api/crm/admin/estagios', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const estagios = await dbAll('SELECT * FROM crm_kanban_estagios ORDER BY pipeline_tipo ASC, ordem ASC');
    res.json(estagios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/admin/estagios — Criar novo estágio
app.post('/api/crm/admin/estagios', requireAuth, requireRole('admin'), async (req, res) => {
  const { nome, pipeline_tipo, cor, ordem } = req.body;

  if (!nome || !pipeline_tipo) {
    return res.status(400).json({ error: 'Nome e Tipo de Pipeline (sdr ou closer) são obrigatórios.' });
  }

  try {
    const result = await dbRun(
      'INSERT INTO crm_kanban_estagios (nome, pipeline_tipo, cor, ordem) VALUES (?, ?, ?, ?)',
      [nome.trim(), pipeline_tipo, cor || '#4F46E5', parseInt(ordem || 1, 10)]
    );
    res.status(201).json({ id: result.lastID, message: 'Estágio criado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/crm/admin/estagios/:id — Editar estágio
app.put('/api/crm/admin/estagios/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { nome, cor, ordem, ativo } = req.body;

  try {
    await dbRun(
      'UPDATE crm_kanban_estagios SET nome = COALESCE(?, nome), cor = COALESCE(?, cor), ordem = COALESCE(?, ordem), ativo = COALESCE(?, ativo) WHERE id = ?',
      [nome ? nome.trim() : null, cor ? cor.trim() : null, ordem !== undefined ? parseInt(ordem, 10) : null, ativo !== undefined ? !!ativo : null, id]
    );
    res.json({ message: 'Estágio atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/crm/admin/estagios/:id — Deletar estágio
app.delete('/api/crm/admin/estagios/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM crm_kanban_estagios WHERE id = ?', [id]);
    res.json({ message: 'Estágio removido com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/admin/fila-closers — Lista usuários e status da Fila de Closers
app.get('/api/crm/admin/fila-closers', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const fila = await dbAll(`
      SELECT f.id, f.closer_id, f.peso, f.ativo, f.ordem, f.ultima_atribuicao_at, u.username
      FROM crm_fila_closers f
      JOIN users u ON f.closer_id = u.id
      ORDER BY f.ordem ASC, u.username ASC
    `);

    // Usuários elegíveis que ainda não estão na fila
    const usuariosForaDaFila = await dbAll(`
      SELECT u.id, u.username, u.role
      FROM users u
      WHERE u.active = TRUE AND u.id NOT IN (SELECT closer_id FROM crm_fila_closers)
      ORDER BY u.username ASC
    `);

    res.json({ fila, disponiveis: usuariosForaDaFila });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/admin/fila-closers — Adicionar consultor à Fila
app.post('/api/crm/admin/fila-closers', requireAuth, requireRole('admin'), async (req, res) => {
  const { closer_id, peso, ordem } = req.body;

  if (!closer_id) {
    return res.status(400).json({ error: 'ID do consultor é obrigatório.' });
  }

  try {
    const result = await dbRun(
      'INSERT INTO crm_fila_closers (closer_id, peso, ativo, ordem) VALUES (?, ?, TRUE, ?)',
      [closer_id, parseInt(peso || 1, 10), parseInt(ordem || 1, 10)]
    );
    res.status(201).json({ id: result.lastID, message: 'Consultor adicionado à fila com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/crm/admin/fila-closers/:id — Atualizar peso, ordem ou ativar/desativar
app.put('/api/crm/admin/fila-closers/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { peso, ativo, ordem } = req.body;

  try {
    await dbRun(
      'UPDATE crm_fila_closers SET peso = COALESCE(?, peso), ativo = COALESCE(?, ativo), ordem = COALESCE(?, ordem) WHERE id = ?',
      [peso !== undefined ? parseInt(peso, 10) : null, ativo !== undefined ? !!ativo : null, ordem !== undefined ? parseInt(ordem, 10) : null, id]
    );
    res.json({ message: 'Configuração da fila atualizada com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/crm/admin/fila-closers/:id — Remover consultor da fila
app.delete('/api/crm/admin/fila-closers/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM crm_fila_closers WHERE id = ?', [id]);
    res.json({ message: 'Consultor removido da fila com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/admin/discadora-mapeamentos — Lista mapeamentos discadora <-> CRM
app.get('/api/crm/admin/discadora-mapeamentos', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const mapeamentos = await dbAll(`
      SELECT m.*, u.username as crm_username
      FROM crm_discadora_mapeamentos m
      JOIN users u ON m.crm_user_id = u.id
      ORDER BY m.discadora_login ASC
    `);
    res.json(mapeamentos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/admin/discadora-mapeamentos — Criar/Atualizar mapeamento
app.post('/api/crm/admin/discadora-mapeamentos', requireAuth, requireRole('admin'), async (req, res) => {
  const { discadora_login, crm_user_id } = req.body;

  if (!discadora_login || !crm_user_id) {
    return res.status(400).json({ error: 'Login da discadora e Usuário do CRM são obrigatórios.' });
  }

  try {
    await dbRun(
      `INSERT INTO crm_discadora_mapeamentos (discadora_login, crm_user_id)
       VALUES (?, ?)
       ON CONFLICT (discadora_login) DO UPDATE SET crm_user_id = EXCLUDED.crm_user_id`,
      [discadora_login.trim().toLowerCase(), crm_user_id]
    );
    res.status(201).json({ message: 'Mapeamento salvo com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/crm/admin/discadora-mapeamentos/:id — Remover mapeamento
app.delete('/api/crm/admin/discadora-mapeamentos/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM crm_discadora_mapeamentos WHERE id = ?', [id]);
    res.json({ message: 'Mapeamento removido com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/admin/clear-data — Limpar todos os leads e clientes de teste do CRM
app.post('/api/crm/admin/clear-data', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await dbRun('TRUNCATE crm_kanban_historico, crm_kanban_leads, crm_tabulacoes, crm_clientes RESTART IDENTITY CASCADE');
    broadcastCrmEvent('LEAD_MOVIDO', {});
    console.log('[CRM ADMIN] Todos os leads e clientes de teste foram limpos do banco de dados.');
    res.json({ message: 'Todos os leads e clientes de teste foram limpos com sucesso!' });
  } catch (err) {
    console.error('Erro ao limpar dados do CRM:', err);
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
