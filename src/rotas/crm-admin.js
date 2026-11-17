const express = require('express');
const { dbAll, dbGet, dbRun } = require('../../database');
const { requireAuth, requireRole } = require('../../auth');
const { normalizarMotivosPerda } = require('../utils/formatos');

const router = express.Router();

// GET /api/crm/admin/perdas — Listar registros de perdas (para futura exportação)
router.get('/api/crm/admin/perdas', requireAuth, async (req, res) => {
  try {
    const perdas = await dbAll(`
      SELECT p.*, c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone,
             COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
             COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
             u_sdr.username as sdr_username,
             u_closer.username as closer_username
      FROM crm_leads_perdas p
      JOIN crm_clientes c ON p.cliente_id = c.id
      LEFT JOIN crm_kanban_leads l ON p.lead_id = l.id
      LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
      LEFT JOIN users u_closer ON l.closer_id = u_closer.id
      ORDER BY p.created_at DESC
    `);
    res.json(perdas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// PAINEL ADMIN (ESTÁGIOS, FILA DE CLOSERS, DISCADORA)
// ----------------------------------------

// GET /api/crm/admin/estagios — Lista todos os estágios (incluindo inativos)
router.get('/api/crm/admin/estagios', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const estagios = await dbAll('SELECT * FROM crm_kanban_estagios ORDER BY pipeline_tipo ASC, ordem ASC');
    res.json(estagios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/admin/estagios — Criar novo estágio
router.post('/api/crm/admin/estagios', requireAuth, requireRole('admin'), async (req, res) => {
  const { 
    nome, pipeline_tipo, cor, ordem, motivos_perda, exigir_obs,
    exigir_valor, exigir_email, exigir_documentos, exigir_dados_conta,
    exibir_valor, exibir_cpf, exibir_telefone,
    exibir_email, exibir_documentos,
    modal_exibir_valor, modal_exibir_email, modal_exibir_docs,
    modal_exibir_obs, modal_exibir_historico, modal_exibir_closer,
    modal_exibir_dados_bancarios,
    sla_horas
  } = req.body;

  if (!nome || !pipeline_tipo) {
    return res.status(400).json({ error: 'Nome e Tipo de Pipeline (sdr ou closer) são obrigatórios.' });
  }

  try {
    const parsedSla = sla_horas !== undefined && sla_horas !== null && sla_horas !== '' ? parseInt(sla_horas, 10) : null;
    const result = await dbRun(
      `INSERT INTO crm_kanban_estagios 
        (nome, pipeline_tipo, cor, ordem, motivos_perda, exigir_obs, exigir_valor, exigir_email, exigir_documentos, exigir_dados_conta, 
         exibir_valor, exibir_cpf, exibir_telefone, exibir_email, exibir_documentos,
         modal_exibir_valor, modal_exibir_email, modal_exibir_docs, modal_exibir_obs, modal_exibir_historico, modal_exibir_closer, modal_exibir_dados_bancarios, sla_horas) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nome.trim(),
        pipeline_tipo,
        cor || '#4F46E5',
        parseInt(ordem || 1, 10),
        motivos_perda ? normalizarMotivosPerda(motivos_perda) : null,
        exigir_obs !== undefined ? !!exigir_obs : false,
        exigir_valor !== undefined ? !!exigir_valor : false,
        exigir_email !== undefined ? !!exigir_email : false,
        exigir_documentos !== undefined ? !!exigir_documentos : false,
        exigir_dados_conta !== undefined ? !!exigir_dados_conta : false,
        exibir_valor !== undefined ? !!exibir_valor : true,
        exibir_cpf !== undefined ? !!exibir_cpf : true,
        exibir_telefone !== undefined ? !!exibir_telefone : true,
        exibir_email !== undefined ? !!exibir_email : false,
        exibir_documentos !== undefined ? !!exibir_documentos : false,
        modal_exibir_valor !== undefined ? !!modal_exibir_valor : true,
        modal_exibir_email !== undefined ? !!modal_exibir_email : true,
        modal_exibir_docs !== undefined ? !!modal_exibir_docs : true,
        modal_exibir_obs !== undefined ? !!modal_exibir_obs : true,
        modal_exibir_historico !== undefined ? !!modal_exibir_historico : true,
        modal_exibir_closer !== undefined ? !!modal_exibir_closer : true,
        modal_exibir_dados_bancarios !== undefined ? !!modal_exibir_dados_bancarios : false,
        (parsedSla && !isNaN(parsedSla) && parsedSla > 0) ? parsedSla : null
      ]
    );
    res.status(201).json({ id: result.lastID, message: 'Estágio criado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/crm/admin/estagios/:id — Editar estágio
router.put('/api/crm/admin/estagios/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { 
    nome, cor, ordem, ativo, motivos_perda, exigir_obs,
    exigir_valor, exigir_email, exigir_documentos, exigir_dados_conta,
    exibir_valor, exibir_cpf, exibir_telefone,
    exibir_email, exibir_documentos,
    modal_exibir_valor, modal_exibir_email, modal_exibir_docs,
    modal_exibir_obs, modal_exibir_historico, modal_exibir_closer,
    modal_exibir_dados_bancarios,
    sla_horas
  } = req.body;

  try {
    const parsedSla = (sla_horas !== undefined && sla_horas !== null && sla_horas !== '') ? parseInt(sla_horas, 10) : null;
    const finalSla = (parsedSla && !isNaN(parsedSla) && parsedSla > 0) ? parsedSla : null;

    await dbRun(
      `UPDATE crm_kanban_estagios SET 
        nome = COALESCE(?, nome), 
        cor = COALESCE(?, cor), 
        ordem = COALESCE(?, ordem), 
        ativo = COALESCE(?, ativo), 
        motivos_perda = COALESCE(?, motivos_perda), 
        exigir_obs = COALESCE(?, exigir_obs),
        exigir_valor = COALESCE(?, exigir_valor),
        exigir_email = COALESCE(?, exigir_email),
        exigir_documentos = COALESCE(?, exigir_documentos),
        exigir_dados_conta = COALESCE(?, exigir_dados_conta),
        exibir_valor = COALESCE(?, exibir_valor),
        exibir_cpf = COALESCE(?, exibir_cpf),
        exibir_telefone = COALESCE(?, exibir_telefone),
        exibir_email = COALESCE(?, exibir_email),
        exibir_documentos = COALESCE(?, exibir_documentos),
        modal_exibir_valor = COALESCE(?, modal_exibir_valor),
        modal_exibir_email = COALESCE(?, modal_exibir_email),
        modal_exibir_docs = COALESCE(?, modal_exibir_docs),
        modal_exibir_obs = COALESCE(?, modal_exibir_obs),
        modal_exibir_historico = COALESCE(?, modal_exibir_historico),
        modal_exibir_closer = COALESCE(?, modal_exibir_closer),
        modal_exibir_dados_bancarios = COALESCE(?, modal_exibir_dados_bancarios),
        sla_horas = CASE WHEN ? THEN ? ELSE sla_horas END
      WHERE id = ?`,
      [
        nome ? nome.trim() : null,
        cor ? cor.trim() : null,
        ordem !== undefined ? parseInt(ordem, 10) : null,
        ativo !== undefined ? !!ativo : null,
        motivos_perda !== undefined && motivos_perda !== null ? normalizarMotivosPerda(motivos_perda) : null,
        exigir_obs !== undefined ? !!exigir_obs : null,
        exigir_valor !== undefined ? !!exigir_valor : null,
        exigir_email !== undefined ? !!exigir_email : null,
        exigir_documentos !== undefined ? !!exigir_documentos : null,
        exigir_dados_conta !== undefined ? !!exigir_dados_conta : null,
        exibir_valor !== undefined ? !!exibir_valor : null,
        exibir_cpf !== undefined ? !!exibir_cpf : null,
        exibir_telefone !== undefined ? !!exibir_telefone : null,
        exibir_email !== undefined ? !!exibir_email : null,
        exibir_documentos !== undefined ? !!exibir_documentos : null,
        modal_exibir_valor !== undefined ? !!modal_exibir_valor : null,
        modal_exibir_email !== undefined ? !!modal_exibir_email : null,
        modal_exibir_docs !== undefined ? !!modal_exibir_docs : null,
        modal_exibir_obs !== undefined ? !!modal_exibir_obs : null,
        modal_exibir_historico !== undefined ? !!modal_exibir_historico : null,
        modal_exibir_closer !== undefined ? !!modal_exibir_closer : null,
        modal_exibir_dados_bancarios !== undefined ? !!modal_exibir_dados_bancarios : null,
        sla_horas !== undefined ? 1 : 0,
        finalSla,
        id
      ]
    );
    res.json({ message: 'Estágio atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/crm/admin/estagios/:id — Deletar estágio
router.delete('/api/crm/admin/estagios/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM crm_kanban_estagios WHERE id = ?', [id]);
    res.json({ message: 'Estágio removido com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/admin/fila-closers — Lista usuários e status da Fila de Closers
router.get('/api/crm/admin/fila-closers', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const fila = await dbAll(`
      SELECT f.id, f.closer_id, f.peso, f.ativo, f.ordem, f.ultima_atribuicao_at, u.username,
             COALESCE(NULLIF(TRIM(u.name), ''), u.username) as name
      FROM crm_fila_closers f
      JOIN users u ON f.closer_id = u.id
      ORDER BY f.ordem ASC, u.username ASC
    `);

    // Usuários elegíveis que ainda não estão na fila
    const usuariosForaDaFila = await dbAll(`
      SELECT u.id, u.username, u.role,
             COALESCE(NULLIF(TRIM(u.name), ''), u.username) as name
      FROM users u
      WHERE u.active = TRUE AND u.id NOT IN (SELECT closer_id FROM crm_fila_closers)
      ORDER BY u.username ASC
    `);

    // Descobre quem é o próximo na sequência atual
    const activeClosers = fila.filter(f => f.ativo);
    const slots = [];
    for (const c of activeClosers) {
      const peso = Math.max(1, parseInt(c.peso, 10) || 1);
      for (let i = 0; i < peso; i++) {
        slots.push(c.closer_id);
      }
    }
    const pointerRow = await dbGet("SELECT value FROM system_settings WHERE key = 'crm_fila_closers_pointer'");
    let currentPointer = pointerRow && pointerRow.value !== null && pointerRow.value !== undefined ? parseInt(pointerRow.value, 10) : -1;
    if (isNaN(currentPointer) || currentPointer < 0) currentPointer = -1;
    const proximoIndex = slots.length > 0 ? (currentPointer + 1) % slots.length : null;
    const proximoCloserId = proximoIndex !== null ? slots[proximoIndex] : null;

    res.json({ fila, disponiveis: usuariosForaDaFila, proximoCloserId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/admin/fila-closers/reset-pointer — Reiniciar ciclo da Fila (iniciar novamente no primeiro)
router.post('/api/crm/admin/fila-closers/reset-pointer', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await dbRun(
      "INSERT INTO system_settings (key, value) VALUES ('crm_fila_closers_pointer', '-1') ON CONFLICT (key) DO UPDATE SET value = '-1' RETURNING key"
    );
    res.json({ message: 'Ciclo da fila reiniciado com sucesso! O próximo lead irá para o primeiro consultor da ordem.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/admin/fila-closers — Adicionar consultor à Fila
router.post('/api/crm/admin/fila-closers', requireAuth, requireRole('admin'), async (req, res) => {
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
router.put('/api/crm/admin/fila-closers/:id', requireAuth, requireRole('admin'), async (req, res) => {
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
router.delete('/api/crm/admin/fila-closers/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM crm_fila_closers WHERE id = ?', [id]);
    res.json({ message: 'Consultor removido da fila com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/admin/discadora-mapeamentos — Lista mapeamentos discadora <-> CRM
router.get('/api/crm/admin/discadora-mapeamentos', requireAuth, requireRole('admin'), async (req, res) => {
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
router.post('/api/crm/admin/discadora-mapeamentos', requireAuth, requireRole('admin'), async (req, res) => {
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
router.delete('/api/crm/admin/discadora-mapeamentos/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM crm_discadora_mapeamentos WHERE id = ?', [id]);
    res.json({ message: 'Mapeamento removido com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
