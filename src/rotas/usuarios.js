const express = require('express');
const bcrypt = require('bcryptjs');
const { dbAll, dbGet, dbRun } = require('../../database');
const { requireAuth, requireRole } = require('../../auth');

const router = express.Router();

// ----------------------------------------
// USER MANAGEMENT ENDPOINTS (admin only)
// ----------------------------------------

// GET /api/users — Lista todos os usuários (Admin vê todos; Supervisor vê os de sua equipe + ele próprio)
router.get('/api/users', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    let query = `
      SELECT u.id, u.username, u.name, u.role, u.team_id, u.active, u.created_at, t.name as team_name
      FROM users u
      LEFT JOIN teams t ON u.team_id = t.id
    `;
    const params = [];
    if (req.user.role === 'supervisor') {
      const supervisor = await dbGet('SELECT team_id FROM users WHERE id = ?', [req.user.id]);
      const teamId = supervisor?.team_id || req.user.team_id;
      query += ` WHERE (u.team_id = ? OR u.id = ?)`;
      params.push(teamId || 0, req.user.id);
    }
    query += ` ORDER BY LOWER(COALESCE(NULLIF(TRIM(u.name), ''), u.username)) ASC`;
    const users = await dbAll(query, params);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users — Cria novo usuário
router.post('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { username, password, role, team_id, name } = req.body;
  if (!username || !password || !role || !name) {
    return res.status(400).json({ error: 'Nome, login (usuário), senha e perfil são obrigatórios.' });
  }
  if (!['admin', 'supervisor', 'leads', 'sdr', 'closer', 'operacional'].includes(role)) {
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
router.put('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { username, name, password, role, team_id, active } = req.body;
  if (role && !['admin', 'supervisor', 'leads', 'sdr', 'closer', 'operacional'].includes(role)) {
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
router.delete('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
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
router.get('/api/teams', requireAuth, async (req, res) => {
  try {
    const teams = await dbAll("SELECT * FROM teams ORDER BY name ASC");
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create team
router.post('/api/teams', requireAuth, requireRole('admin'), async (req, res) => {
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
router.delete('/api/teams/:id', requireAuth, requireRole('admin'), async (req, res) => {
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

module.exports = router;
