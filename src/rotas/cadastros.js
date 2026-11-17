const express = require('express');
const { dbAll, dbGet, dbRun } = require('../../database');
const { requireAuth, requireRole } = require('../../auth');

const router = express.Router();

// ----------------------------------------
// CONSULTANTS ENDPOINTS
// ----------------------------------------

// List all consultants (joined with team name)
router.get('/api/consultants', requireAuth, async (req, res) => {
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
router.post('/api/consultants', requireAuth, requireRole('admin'), async (req, res) => {
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
router.put('/api/consultants/:id', requireAuth, requireRole('admin'), async (req, res) => {
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
router.delete('/api/consultants/:id', requireAuth, requireRole('admin'), async (req, res) => {
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
router.get('/api/channels', requireAuth, async (req, res) => {
  try {
    const channels = await dbAll("SELECT * FROM channels ORDER BY name ASC");
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create channel
router.post('/api/channels', requireAuth, requireRole('admin'), async (req, res) => {
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
router.put('/api/channels/:id', requireAuth, requireRole('admin'), async (req, res) => {
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
router.delete('/api/channels/:id', requireAuth, requireRole('admin'), async (req, res) => {
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
// SYSTEMS ENDPOINTS
// ----------------------------------------

// List all systems
router.get('/api/systems', requireAuth, async (req, res) => {
  try {
    const systems = await dbAll("SELECT * FROM systems ORDER BY name ASC");
    res.json(systems);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create system
router.post('/api/systems', requireAuth, requireRole('admin'), async (req, res) => {
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
router.put('/api/systems/:id', requireAuth, requireRole('admin'), async (req, res) => {
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
router.delete('/api/systems/:id', requireAuth, requireRole('admin'), async (req, res) => {
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

router.get('/api/convenios', requireAuth, async (req, res) => {
  try {
    const convenios = await dbAll("SELECT * FROM convenios ORDER BY name ASC");
    res.json(convenios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/convenios', requireAuth, requireRole('admin'), async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') return res.status(400).json({ error: "Nome obrigatório." });
  try {
    const result = await dbRun("INSERT INTO convenios (name, active) VALUES (?, 1)", [name.trim()]);
    res.status(201).json({ id: result.lastID, name: name.trim(), active: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/convenios/:id', requireAuth, requireRole('admin'), async (req, res) => {
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

router.get('/api/produtos', requireAuth, async (req, res) => {
  try {
    const produtos = await dbAll("SELECT * FROM produtos ORDER BY name ASC");
    res.json(produtos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/produtos', requireAuth, requireRole('admin'), async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') return res.status(400).json({ error: "Nome obrigatório." });
  try {
    const result = await dbRun("INSERT INTO produtos (name, active) VALUES (?, 1)", [name.trim()]);
    res.status(201).json({ id: result.lastID, name: name.trim(), active: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/produtos/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun("DELETE FROM produtos WHERE id = ?", [id]);
    res.json({ message: "Produto removido com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
