// Listas do módulo Contratos: bancos (com nomes nos documentos), produtos,
// tabelas, tipos, parceiros e status (fase + atalhos).
// Leitura: qualquer usuário logado (os formulários de contrato usam as listas).
// Edição: só Operacional e Admin. Nada é apagado: itens são desativados.
const express = require('express');
const { dbAll, dbGet, dbRun, pool } = require('../../database');
const { requireAuth, requireRole } = require('../../auth');
const { normalizarNome } = require('../utils/normalizar-nome');
const { LISTAS, FASES_CHAVES } = require('../servicos/contratos-schema');
const { FASES, TIPOS_AUTOMATICOS } = require('../servicos/contratos-listas-padrao');

const router = express.Router();
const podeEditar = requireRole('admin', 'operacional');

function limparNome(nome, max) {
  const n = String(nome || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!n) return { erro: 'Informe o nome.' };
  if (n.length > max) return { erro: `O nome pode ter no máximo ${max} caracteres.` };
  return { nome: n };
}

function erroDuplicado(err) {
  return err && err.code === '23505';
}

// GET /api/contratos/listas — tudo de uma vez (com desativados; a tela filtra)
router.get('/api/contratos/listas', requireAuth, async (req, res) => {
  try {
    const itens = await dbAll('SELECT id, lista, nome, ativo FROM contratos_listas ORDER BY nome');
    const nomes = await dbAll(`
      SELECT n.id, n.banco_id, n.nome, n.origem, n.created_at, u.name AS usuario_nome, u.username AS usuario_login
      FROM contratos_bancos_nomes n
      LEFT JOIN users u ON u.id = n.usuario_id
      ORDER BY n.nome`);
    const status = await dbAll('SELECT id, nome, fase, ordem, ativo, inicial FROM contratos_status ORDER BY ordem, id');
    const atalhos = await dbAll('SELECT status_id, destino_id FROM contratos_status_atalhos');

    const canais = await dbAll('SELECT id, name AS nome FROM channels WHERE active IS NULL OR active = 1 ORDER BY name');
    const resposta = { fases: FASES, canais };
    LISTAS.forEach(l => { resposta[l] = []; });
    itens.forEach(i => {
      const item = { id: i.id, nome: i.nome, ativo: i.ativo };
      if (i.lista === 'banco') {
        item.nomes_documentos = nomes
          .filter(n => n.banco_id === i.id)
          .map(n => ({ id: n.id, nome: n.nome, origem: n.origem, created_at: n.created_at, usuario: n.usuario_nome || n.usuario_login || null }));
      }
      resposta[i.lista].push(item);
    });
    resposta.status = status.map(s => ({
      ...s,
      atalhos: atalhos.filter(a => a.status_id === s.id).map(a => a.destino_id)
    }));
    res.json(resposta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contratos/listas/:lista — novo item
router.post('/api/contratos/listas/:lista', requireAuth, podeEditar, async (req, res) => {
  const { lista } = req.params;
  if (!LISTAS.includes(lista)) return res.status(400).json({ error: 'Lista inválida.' });
  const { nome, erro } = limparNome(req.body.nome, 120);
  if (erro) return res.status(400).json({ error: erro });
  try {
    const r = await dbRun('INSERT INTO contratos_listas (lista, nome) VALUES (?, ?)', [lista, nome]);
    res.status(201).json({ id: r.lastID, nome, ativo: true });
  } catch (err) {
    if (erroDuplicado(err)) return res.status(409).json({ error: `"${nome}" já existe nesta lista (pode estar desativado).` });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/contratos/listas/:lista/:id — renomear e/ou ativar/desativar
router.put('/api/contratos/listas/:lista/:id', requireAuth, podeEditar, async (req, res) => {
  const { lista, id } = req.params;
  if (!LISTAS.includes(lista)) return res.status(400).json({ error: 'Lista inválida.' });
  try {
    const atual = await dbGet('SELECT * FROM contratos_listas WHERE id = ? AND lista = ?', [id, lista]);
    if (!atual) return res.status(404).json({ error: 'Item não encontrado.' });
    if (lista === 'tipo' && TIPOS_AUTOMATICOS.includes(atual.nome) &&
        ((req.body.nome !== undefined && limparNome(req.body.nome, 120).nome !== atual.nome) || req.body.ativo === false)) {
      return res.status(400).json({ error: `${atual.nome} é gravado automaticamente nas portabilidades e não pode ser renomeado nem desativado.` });
    }

    let nome = atual.nome;
    if (req.body.nome !== undefined) {
      const r = limparNome(req.body.nome, 120);
      if (r.erro) return res.status(400).json({ error: r.erro });
      nome = r.nome;
    }
    const ativo = typeof req.body.ativo === 'boolean' ? req.body.ativo : atual.ativo;
    await dbRun('UPDATE contratos_listas SET nome = ?, ativo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nome, ativo, id]);
    res.json({ id: Number(id), nome, ativo });
  } catch (err) {
    if (erroDuplicado(err)) return res.status(409).json({ error: 'Já existe um item com esse nome nesta lista.' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contratos/bancos/:id/nomes — novo "nome no documento" para um banco
router.post('/api/contratos/bancos/:id/nomes', requireAuth, podeEditar, async (req, res) => {
  const nome = String(req.body.nome || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!nome) return res.status(400).json({ error: 'Informe como o banco aparece no documento.' });
  if (nome.length > 160) return res.status(400).json({ error: 'Máximo de 160 caracteres.' });
  const norm = normalizarNome(nome);
  if (!norm) return res.status(400).json({ error: 'O nome precisa ter letras ou números.' });
  try {
    const banco = await dbGet("SELECT id FROM contratos_listas WHERE id = ? AND lista = 'banco'", [req.params.id]);
    if (!banco) return res.status(404).json({ error: 'Banco não encontrado.' });
    const r = await dbRun(
      "INSERT INTO contratos_bancos_nomes (banco_id, nome, nome_norm, origem, usuario_id) VALUES (?, ?, ?, 'manual', ?)",
      [banco.id, nome, norm, req.user.id]
    );
    res.status(201).json({ id: r.lastID, nome, origem: 'manual' });
  } catch (err) {
    if (erroDuplicado(err)) {
      const dono = await dbGet(
        `SELECT l.nome FROM contratos_bancos_nomes n JOIN contratos_listas l ON l.id = n.banco_id WHERE n.nome_norm = ?`,
        [norm]
      ).catch(() => null);
      return res.status(409).json({ error: `"${nome}" já está ligado ao banco ${dono ? dono.nome : 'outro banco'}.` });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/contratos/bancos/nomes/:nomeId — tira um nome (ex.: aprendido errado)
router.delete('/api/contratos/bancos/nomes/:nomeId', requireAuth, podeEditar, async (req, res) => {
  try {
    const r = await dbRun('DELETE FROM contratos_bancos_nomes WHERE id = ?', [req.params.nomeId]);
    if (!r.changes) return res.status(404).json({ error: 'Nome não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contratos/status — novo status
router.post('/api/contratos/status', requireAuth, podeEditar, async (req, res) => {
  const { nome, erro } = limparNome(req.body.nome, 80);
  if (erro) return res.status(400).json({ error: erro });
  const fase = req.body.fase;
  if (!FASES_CHAVES.includes(fase)) return res.status(400).json({ error: 'Escolha a fase do status.' });
  try {
    const max = await dbGet('SELECT COALESCE(MAX(ordem), 0) AS m FROM contratos_status WHERE fase = ?', [fase]);
    const r = await dbRun('INSERT INTO contratos_status (nome, fase, ordem) VALUES (?, ?, ?)', [nome, fase, Number(max.m) + 1]);
    res.status(201).json({ id: r.lastID, nome, fase, ativo: true, atalhos: [] });
  } catch (err) {
    if (erroDuplicado(err)) return res.status(409).json({ error: `O status "${nome}" já existe (pode estar desativado).` });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/contratos/status/:id — renomear, trocar fase, ativar/desativar, atalhos
router.put('/api/contratos/status/:id', requireAuth, podeEditar, async (req, res) => {
  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    const atual = (await client.query('SELECT * FROM contratos_status WHERE id = $1', [id])).rows[0];
    if (!atual) return res.status(404).json({ error: 'Status não encontrado.' });

    let nome = atual.nome;
    if (req.body.nome !== undefined) {
      const r = limparNome(req.body.nome, 80);
      if (r.erro) return res.status(400).json({ error: r.erro });
      nome = r.nome;
    }
    let fase = atual.fase;
    if (req.body.fase !== undefined) {
      if (!FASES_CHAVES.includes(req.body.fase)) return res.status(400).json({ error: 'Fase inválida.' });
      fase = req.body.fase;
    }
    let ativo = atual.ativo;
    if (typeof req.body.ativo === 'boolean') {
      if (!req.body.ativo && atual.inicial) {
        return res.status(400).json({ error: 'Este é o status inicial de toda operação e não pode ser desativado.' });
      }
      ativo = req.body.ativo;
    }

    let atalhos = null;
    if (Array.isArray(req.body.atalhos)) {
      atalhos = [...new Set(req.body.atalhos.map(Number).filter(n => Number.isInteger(n) && n > 0 && n !== id))];
      if (atalhos.length > 6) return res.status(400).json({ error: 'Escolha no máximo 6 atalhos.' });
      if (atalhos.length) {
        const existentes = await client.query('SELECT id FROM contratos_status WHERE id = ANY($1::int[])', [atalhos]);
        if (existentes.rows.length !== atalhos.length) return res.status(400).json({ error: 'Algum atalho não existe mais.' });
      }
    }

    await client.query('BEGIN');
    await client.query(
      'UPDATE contratos_status SET nome = $1, fase = $2, ativo = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
      [nome, fase, ativo, id]
    );
    if (atalhos) {
      await client.query('DELETE FROM contratos_status_atalhos WHERE status_id = $1', [id]);
      for (const destino of atalhos) {
        await client.query('INSERT INTO contratos_status_atalhos (status_id, destino_id) VALUES ($1, $2)', [id, destino]);
      }
    }
    await client.query('COMMIT');
    res.json({ id, nome, fase, ativo, atalhos });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (erroDuplicado(err)) return res.status(409).json({ error: 'Já existe um status com esse nome.' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
