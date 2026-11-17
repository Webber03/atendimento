const express = require('express');
const bcrypt = require('bcryptjs');
const { google } = require('googleapis');
const { dbGet, dbRun } = require('../../database');
const { generateToken, requireAuth } = require('../../auth');
const { initializeOAuthDrive } = require('../servicos/google-drive');

const router = express.Router();

// ----------------------------------------
// AUTH ENDPOINTS
// ----------------------------------------

// POST /api/auth/login — Autentica o usuário e retorna um token JWT
router.post('/api/auth/login', async (req, res) => {
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
router.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/setup — Cria o primeiro usuário admin (protegido por token de setup)
router.post('/api/auth/setup', async (req, res) => {
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
router.get('/api/auth/google', async (req, res) => {
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
router.get('/api/auth/google/callback', async (req, res) => {
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

module.exports = router;
