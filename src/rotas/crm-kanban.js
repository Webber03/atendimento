const express = require('express');
const { dbAll, dbGet, dbRun } = require('../../database');
const { requireAuth, requireRole } = require('../../auth');
const { broadcastCrmEvent } = require('../servicos/eventos-crm');
const { getNextCloserFromQueue } = require('../servicos/fila-closers');
const { sqlLocalParaUtc } = require('../utils/fuso-horario');

const router = express.Router();

// ----------------------------------------
// KANBAN ENDPOINTS
// ----------------------------------------

// GET /api/crm/kanban/estagios — Lista todos os estágios ativos do Kanban
router.get('/api/crm/kanban/estagios', requireAuth, async (req, res) => {
  try {
    const estagios = await dbAll('SELECT * FROM crm_kanban_estagios WHERE ativo = TRUE ORDER BY pipeline_tipo ASC, ordem ASC');
    res.json(estagios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/kanban/leads — Lista os cards do Kanban
router.get('/api/crm/kanban/leads', requireAuth, async (req, res) => {
  const { pipeline_tipo, closer_id, sdr_id, data_inicio, data_fim, tipo_data } = req.query;
  
  try {
    let queryFilter = "WHERE l.status_atendimento IN ('em_atendimento', 'pendente_aceite')";
    const params = [];

    if (req.user.role === 'sdr') {
      queryFilter += " AND e.pipeline_tipo = 'sdr' AND l.sdr_id = ?";
      params.push(req.user.id);
    } else if (req.user.role === 'closer') {
      queryFilter += " AND e.pipeline_tipo = 'closer' AND l.closer_id = ?";
      params.push(req.user.id);
    } else if (req.user.role === 'supervisor') {
      const supervisor = await dbGet('SELECT team_id FROM users WHERE id = ?', [req.user.id]);
      const supervisorTeamId = supervisor?.team_id || req.user.team_id;

      if (!supervisorTeamId) {
        queryFilter += ' AND 1 = 0';
      } else {
        if (pipeline_tipo === 'sdr') {
          queryFilter += " AND e.pipeline_tipo = ? AND (u_sdr.team_id = ? OR u_closer.team_id = ?)";
          params.push('sdr', supervisorTeamId, supervisorTeamId);
        } else if (pipeline_tipo === 'closer') {
          queryFilter += " AND e.pipeline_tipo = ? AND (u_closer.team_id = ? OR u_sdr.team_id = ?)";
          params.push('closer', supervisorTeamId, supervisorTeamId);
        } else {
          queryFilter += " AND ((e.pipeline_tipo = 'sdr' AND (u_sdr.team_id = ? OR u_closer.team_id = ?)) OR (e.pipeline_tipo = 'closer' AND (u_closer.team_id = ? OR u_sdr.team_id = ?)))";
          params.push(supervisorTeamId, supervisorTeamId, supervisorTeamId, supervisorTeamId);
        }
        if (closer_id) {
          queryFilter += ' AND l.closer_id = ?';
          params.push(closer_id);
        }
        if (sdr_id) {
          queryFilter += ' AND l.sdr_id = ?';
          params.push(sdr_id);
        }
      }
    } else {
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
    }

    const targetDateCol = (tipo_data === 'criacao')
      ? 'l.created_at'
      : 'COALESCE(l.moved_to_stage_at, l.created_at)';

    // Datas do filtro são dias de Brasília; a coluna está em UTC
    if (data_inicio) {
      queryFilter += ` AND ${targetDateCol} >= ${sqlLocalParaUtc('?::date::timestamp')}`;
      params.push(data_inicio);
    }
    if (data_fim) {
      queryFilter += ` AND ${targetDateCol} < ${sqlLocalParaUtc("?::date::timestamp + INTERVAL '1 day'")}`;
      params.push(data_fim);
    }

    const leads = await dbAll(`
      SELECT l.*, 
             c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone, c.email as cliente_email,
             c.drive_folder_id, c.doc_contracheque_id, c.doc_extrato_id, c.doc_identificacao_id, c.doc_residencia_id, c.doc_espelho_id,
             c.banco as cliente_banco, c.agencia as cliente_agencia, c.conta as cliente_conta,
             e.nome as estagio_nome, e.cor as estagio_cor, e.pipeline_tipo, e.ordem as estagio_ordem,
             COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
             COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
             u_sdr.username as sdr_username, u_sdr.role as sdr_role,
             u_closer.username as closer_username,
             c.valor_contrato,
             ch.name as canal_nome
      FROM crm_kanban_leads l
      JOIN crm_clientes c ON l.cliente_id = c.id
      JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
      LEFT JOIN users u_closer ON l.closer_id = u_closer.id
      LEFT JOIN channels ch ON COALESCE(l.canal_venda_id, c.canal_venda_id) = ch.id
      ${queryFilter}
      ORDER BY l.status_atendimento ASC, l.updated_at DESC
    `, params);

    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/crm/kanban/leads/:id/move — Mover lead para novo estágio
router.put('/api/crm/kanban/leads/:id/move', requireAuth, async (req, res) => {
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

    // Regra: Apenas o dono do lead (ou admin/supervisor da equipe) pode mover o card
    if (req.user.role === 'sdr' && lead.sdr_id !== req.user.id) {
      return res.status(403).json({ error: 'Você só pode mover os seus próprios leads.' });
    }
    if (req.user.role === 'closer' && lead.closer_id !== req.user.id) {
      return res.status(403).json({ error: 'Você só pode mover os seus próprios leads.' });
    }
    if (req.user.role === 'supervisor') {
      const supervisor = await dbGet('SELECT team_id FROM users WHERE id = ?', [req.user.id]);
      const supervisorTeamId = supervisor?.team_id || req.user.team_id;
      const leadOwner = await dbGet(`
        SELECT u_sdr.team_id as sdr_team_id, u_closer.team_id as closer_team_id
        FROM crm_kanban_leads l
        LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
        LEFT JOIN users u_closer ON l.closer_id = u_closer.id
        WHERE l.id = ?
      `, [id]);
      if (!supervisorTeamId || (leadOwner?.sdr_team_id !== supervisorTeamId && leadOwner?.closer_team_id !== supervisorTeamId)) {
        return res.status(403).json({ error: 'Você só pode mover leads da sua própria equipe.' });
      }
    }

    const novoEstagio = await dbGet('SELECT * FROM crm_kanban_estagios WHERE id = ?', [estagio_id]);
    if (!novoEstagio) {
      return res.status(400).json({ error: 'Estágio de destino inválido.' });
    }



    // Regras dinâmicas de obrigatoriedade configuradas no estágio de destino
    if (lead.estagio_id !== estagio_id) {
      // 1. Exigir Valor do Contrato (> 0)
      if (novoEstagio.exigir_valor) {
        const cliente = await dbGet('SELECT valor_contrato FROM crm_clientes WHERE id = ?', [lead.cliente_id]);
        if (!cliente || !cliente.valor_contrato || parseFloat(cliente.valor_contrato) <= 0) {
          return res.status(400).json({ 
            error: `Para mover o lead para a coluna "${novoEstagio.nome}", é obrigatório preencher o Valor do Contrato.` 
          });
        }
      }

      // 2. Exigir E-mail válido
      if (novoEstagio.exigir_email) {
        const cliente = await dbGet('SELECT email FROM crm_clientes WHERE id = ?', [lead.cliente_id]);
        if (!cliente || !cliente.email || cliente.email.trim() === '' || !cliente.email.includes('@')) {
          return res.status(400).json({ 
            error: `Para mover o lead para a coluna "${novoEstagio.nome}", é obrigatório cadastrar um E-mail válido.` 
          });
        }
      }

      // 3. Exigir os 5 Documentos anexados
      if (novoEstagio.exigir_documentos) {
        const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [lead.cliente_id]);
        if (!cliente || !cliente.doc_contracheque_id || !cliente.doc_extrato_id || !cliente.doc_identificacao_id || !cliente.doc_residencia_id || !cliente.doc_espelho_id) {
          return res.status(400).json({ 
            error: `A etapa "${novoEstagio.nome}" exige os 5 documentos obrigatórios anexados.` 
          });
        }
      }

      // 4. Exigir Dados da Conta (Banco, Agência e Conta)
      if (novoEstagio.exigir_dados_conta) {
        const cliente = await dbGet('SELECT banco, agencia, conta FROM crm_clientes WHERE id = ?', [lead.cliente_id]);
        if (!cliente || !cliente.banco || !cliente.banco.trim() || !cliente.agencia || !cliente.agencia.trim() || !cliente.conta || !cliente.conta.trim()) {
          return res.status(400).json({ 
            error: `Para mover o lead para a coluna "${novoEstagio.nome}", é obrigatório preencher os Dados da Conta (Banco, Agência e Conta).` 
          });
        }
      }
    }

    const estagioAnteriorId = lead.estagio_id;

    // Se o lead foi movido para uma etapa do pipeline Closer e ainda não possui closer_id atribuído, sorteia da fila automaticamente
    let closerAtribuidoId = lead.closer_id;
    let statusAtendimento = lead.status_atendimento;
    let marcarTransferencia = false;
    let historicoObs = observacao || null;

    if (novoEstagio.pipeline_tipo === 'closer' && !lead.closer_id) {
      closerAtribuidoId = await getNextCloserFromQueue(lead.sdr_id);
      if (closerAtribuidoId) {
        statusAtendimento = 'pendente_aceite';
        // Data da transferência gravada pelo relógio do banco, sem sobrescrever uma já existente
        marcarTransferencia = true;
        if (!historicoObs) {
          historicoObs = `Lead transferido do SDR para o Closer no estágio ${novoEstagio.nome}.`;
        }
      }
    }

    // Atualizar o lead
    await dbRun(
      `UPDATE crm_kanban_leads SET estagio_id = ?, closer_id = ?, status_atendimento = ?, transferido_closer_at = ${marcarTransferencia ? 'COALESCE(transferido_closer_at, CURRENT_TIMESTAMP)' : 'transferido_closer_at'}, moved_to_stage_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [estagio_id, closerAtribuidoId || null, statusAtendimento, id]
    );

    // Registrar histórico de movimentação
    await dbRun(
      'INSERT INTO crm_kanban_historico (lead_id, estagio_anterior_id, estagio_novo_id, usuario_id, observacao) VALUES (?, ?, ?, ?, ?)',
      [id, estagioAnteriorId, estagio_id, req.user.id, historicoObs]
    );

    const leadAtualizado = await dbGet(`
      SELECT l.*, c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone,
             c.drive_folder_id, c.doc_contracheque_id, c.doc_extrato_id, c.doc_identificacao_id, c.doc_residencia_id,
             e.nome as estagio_nome, e.cor as estagio_cor, e.pipeline_tipo,
             COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
             COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
             u_sdr.username as sdr_username,
             u_closer.username as closer_username
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

// POST /api/crm/kanban/leads/:id/transfer-to-closer — Transferir lead do SDR para Closer
router.post('/api/crm/kanban/leads/:id/transfer-to-closer', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const lead = await dbGet(`
      SELECT l.*, e.pipeline_tipo, e.nome as estagio_nome 
      FROM crm_kanban_leads l
      JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      WHERE l.id = ?
    `, [id]);

    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    const isSpecialRole = (req.user.role === 'admin' || req.user.role === 'supervisor');

    if (!isSpecialRole) {
      if (lead.pipeline_tipo !== 'sdr' || lead.estagio_nome.trim().toUpperCase() !== 'ABERTURA DE CONTA') {
        return res.status(400).json({ error: 'Apenas leads na etapa ABERTURA DE CONTA podem ser transferidos para Closers.' });
      }
    }

    // Regra: SDR só transfere seus próprios leads; Supervisor apenas da sua equipe
    if (req.user.role === 'sdr' && lead.sdr_id !== req.user.id) {
      return res.status(403).json({ error: 'Você só pode transferir os seus próprios leads.' });
    }
    if (req.user.role === 'supervisor') {
      const supervisor = await dbGet('SELECT team_id FROM users WHERE id = ?', [req.user.id]);
      const supervisorTeamId = supervisor?.team_id || req.user.team_id;
      const sdrUser = lead.sdr_id ? await dbGet('SELECT team_id FROM users WHERE id = ?', [lead.sdr_id]) : null;
      if (!supervisorTeamId || (sdrUser && sdrUser.team_id !== supervisorTeamId)) {
        return res.status(403).json({ error: 'Você só pode transferir leads da sua própria equipe.' });
      }
    }

    const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [lead.cliente_id]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente correspondente não encontrado.' });
    }

    // Valida e-mail
    if (!cliente.email || cliente.email.trim() === '' || !cliente.email.includes('@')) {
      return res.status(400).json({ error: 'E-mail válido é obrigatório antes de transferir para o Closer.' });
    }

    // Valida os 5 documentos
    if (!cliente.doc_contracheque_id || !cliente.doc_extrato_id || !cliente.doc_identificacao_id || !cliente.doc_residencia_id || !cliente.doc_espelho_id) {
      return res.status(400).json({ error: 'A transferência para o Closer exige os 5 documentos obrigatórios anexados.' });
    }

    // Busca o primeiro estágio ativo do pipeline de Closers
    const firstCloserStage = await dbGet(`
      SELECT id, nome FROM crm_kanban_estagios 
      WHERE pipeline_tipo = 'closer' AND ativo = TRUE 
      ORDER BY ordem ASC LIMIT 1
    `);

    if (!firstCloserStage) {
      return res.status(400).json({ error: 'Nenhum estágio ativo configurado para o pipeline de Closers.' });
    }

    // Roteamento: sorteia o próximo closer da fila (excluindo o SDR de origem se houver outros)
    const closerId = await getNextCloserFromQueue(lead.sdr_id || req.user.id);
    if (!closerId) {
      return res.status(400).json({ error: 'Nenhum Closer ativo disponível na fila de rodízio.' });
    }

    const closerUser = await dbGet(`
      SELECT id, 
             COALESCE(NULLIF(TRIM(name), ''), username) as name, 
             username 
      FROM users WHERE id = ?
    `, [closerId]);
    if (!closerUser) {
      return res.status(400).json({ error: 'Erro ao identificar o Closer sorteado na base de dados.' });
    }

    const estagioAnteriorId = lead.estagio_id;

    // Atualiza o lead
    await dbRun(`
      UPDATE crm_kanban_leads 
      SET closer_id = ?, 
          estagio_id = ?, 
          status_atendimento = 'pendente_aceite', 
          transferido_closer_at = CURRENT_TIMESTAMP, 
          moved_to_stage_at = CURRENT_TIMESTAMP, 
          updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [closerId, firstCloserStage.id, id]);

    // Grava histórico de movimentação
    const observacao = `Lead transferido para o Closer ${closerUser.name || closerUser.username} (@${closerUser.username}) no estágio ${firstCloserStage.nome}.`;
    await dbRun(`
      INSERT INTO crm_kanban_historico (lead_id, estagio_anterior_id, estagio_novo_id, usuario_id, observacao) 
      VALUES (?, ?, ?, ?, ?)
    `, [id, estagioAnteriorId, firstCloserStage.id, req.user.id, observacao]);

    // Dispara evento em tempo real do lead atualizado
    const leadAtualizado = await dbGet(`
      SELECT l.*, c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone,
             c.drive_folder_id, c.doc_contracheque_id, c.doc_extrato_id, c.doc_identificacao_id, c.doc_residencia_id,
             e.nome as estagio_nome, e.cor as estagio_cor, e.pipeline_tipo,
             COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
             COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
             u_sdr.username as sdr_username,
             u_closer.username as closer_username
      FROM crm_kanban_leads l
      JOIN crm_clientes c ON l.cliente_id = c.id
      JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
      LEFT JOIN users u_closer ON l.closer_id = u_closer.id
      WHERE l.id = ?
    `, [id]);

    broadcastCrmEvent('LEAD_MOVIDO', leadAtualizado);

    res.json({
      success: true,
      message: observacao,
      closer: {
        id: closerUser.id,
        name: closerUser.name || closerUser.username,
        username: closerUser.username
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/crm/kanban/leads/:id/reassign — Reatribuir Closer ou SDR manualmente (Admin ou Supervisor da Equipe)
router.put('/api/crm/kanban/leads/:id/reassign', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { id } = req.params;
  const { closer_id, sdr_id } = req.body;

  try {
    const lead = await dbGet('SELECT * FROM crm_kanban_leads WHERE id = ?', [id]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (req.user.role === 'supervisor') {
      const supervisor = await dbGet('SELECT team_id FROM users WHERE id = ?', [req.user.id]);
      const supervisorTeamId = supervisor?.team_id || req.user.team_id;
      const leadOwner = await dbGet(`
        SELECT u_sdr.team_id as sdr_team_id, u_closer.team_id as closer_team_id
        FROM crm_kanban_leads l
        LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
        LEFT JOIN users u_closer ON l.closer_id = u_closer.id
        WHERE l.id = ?
      `, [id]);
      if (!supervisorTeamId || (leadOwner?.sdr_team_id !== supervisorTeamId && leadOwner?.closer_team_id !== supervisorTeamId)) {
        return res.status(403).json({ error: 'Você só pode reatribuir leads da sua própria equipe.' });
      }

      const targetUserId = closer_id !== undefined ? closer_id : sdr_id;
      if (targetUserId) {
        const targetUser = await dbGet('SELECT id, team_id FROM users WHERE id = ?', [targetUserId]);
        if (!targetUser || (targetUser.team_id !== supervisorTeamId && targetUser.id !== req.user.id)) {
          return res.status(400).json({ error: 'Você só pode atribuir leads para membros da sua equipe ou para você mesmo.' });
        }
      }
    }

    const updates = [];
    const params = [];

    if (closer_id !== undefined) {
      updates.push('closer_id = ?');
      params.push(closer_id ? parseInt(closer_id, 10) : null);
    }
    if (sdr_id !== undefined) {
      updates.push('sdr_id = ?');
      params.push(sdr_id ? parseInt(sdr_id, 10) : null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
    }

    // D4b: lead de SDR (papel 'sdr') que recebe um Closer novo/diferente conta como transferência.
    // Grava a data só se ainda não existir (nunca sobrescreve).
    const novoCloserId = closer_id !== undefined ? (closer_id ? parseInt(closer_id, 10) : null) : lead.closer_id;
    const novoSdrId = sdr_id !== undefined ? (sdr_id ? parseInt(sdr_id, 10) : null) : lead.sdr_id;
    let registrarTransferenciaHistorico = false;
    if (closer_id !== undefined && novoCloserId && novoCloserId !== lead.closer_id && novoSdrId && novoSdrId !== novoCloserId) {
      const sdrUser = await dbGet('SELECT role FROM users WHERE id = ?', [novoSdrId]);
      if (sdrUser && sdrUser.role === 'sdr') {
        updates.push('transferido_closer_at = COALESCE(transferido_closer_at, CURRENT_TIMESTAMP)');
        // Só registra no histórico quando a transferência é marcada pela primeira vez.
        // O registro (com "transferido" no texto) também impede que a migração de boot apague a data.
        registrarTransferenciaHistorico = !lead.transferido_closer_at;
      }
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    await dbRun(`UPDATE crm_kanban_leads SET ${updates.join(', ')} WHERE id = ?`, params);

    if (registrarTransferenciaHistorico) {
      const closerUser = await dbGet("SELECT COALESCE(NULLIF(TRIM(name), ''), username) as nome FROM users WHERE id = ?", [novoCloserId]);
      await dbRun(
        'INSERT INTO crm_kanban_historico (lead_id, estagio_anterior_id, estagio_novo_id, usuario_id, observacao) VALUES (?, ?, ?, ?, ?)',
        [id, lead.estagio_id || null, lead.estagio_id || null, req.user.id, `Lead transferido do SDR para o Closer ${closerUser?.nome || 'atribuído'} (reatribuição).`]
      );
    }

    const leadAtualizado = await dbGet(`
      SELECT l.*, c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone,
             c.drive_folder_id, c.doc_contracheque_id, c.doc_extrato_id, c.doc_identificacao_id, c.doc_residencia_id,
             e.nome as estagio_nome, e.cor as estagio_cor, e.pipeline_tipo,
             COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
             COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
             u_sdr.username as sdr_username,
             u_closer.username as closer_username
      FROM crm_kanban_leads l
      JOIN crm_clientes c ON l.cliente_id = c.id
      JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
      LEFT JOIN users u_closer ON l.closer_id = u_closer.id
      WHERE l.id = ?
    `, [id]);

    broadcastCrmEvent('LEAD_MOVIDO', leadAtualizado);

    res.json({ success: true, message: 'Consultor reatribuído com sucesso!', lead: leadAtualizado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/crm/kanban/leads/:id/nota-privada — Atualizar Nota Privada do Card
router.put('/api/crm/kanban/leads/:id/nota-privada', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { nota_privada } = req.body;

  try {
    const lead = await dbGet('SELECT * FROM crm_kanban_leads WHERE id = ?', [id]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    const notaFinal = (nota_privada && typeof nota_privada === 'string') ? nota_privada.trim() : null;

    await dbRun(
      'UPDATE crm_kanban_leads SET nota_privada = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [notaFinal, id]
    );

    const leadAtualizado = await dbGet(`
      SELECT l.*, c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone,
             c.drive_folder_id, c.doc_contracheque_id, c.doc_extrato_id, c.doc_identificacao_id, c.doc_residencia_id, c.doc_espelho_id,
             e.nome as estagio_nome, e.cor as estagio_cor, e.pipeline_tipo,
             COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
             COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
             u_sdr.username as sdr_username,
             u_closer.username as closer_username
      FROM crm_kanban_leads l
      JOIN crm_clientes c ON l.cliente_id = c.id
      JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
      LEFT JOIN users u_closer ON l.closer_id = u_closer.id
      WHERE l.id = ?
    `, [id]);

    broadcastCrmEvent('LEAD_ATUALIZADO', leadAtualizado);

    res.json({ success: true, message: 'Nota privada atualizada com sucesso!', lead: leadAtualizado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/kanban/leads/:id/mark-loss — Marcar lead como perdido
router.post('/api/crm/kanban/leads/:id/mark-loss', requireAuth, async (req, res) => {
  const { id } = req.params;
  let { motivo, observacao } = req.body;

  if (!motivo || !String(motivo).trim()) {
    return res.status(400).json({ error: 'O motivo da perda é obrigatório.' });
  }
  // Motivos sempre em MAIÚSCULAS (evita "Desistência" e "DESISTÊNCIA" contados separados)
  motivo = String(motivo).trim().toLocaleUpperCase('pt-BR');

  try {
    const lead = await dbGet(`
      SELECT l.*, e.nome as estagio_nome, e.pipeline_tipo, e.exigir_obs 
      FROM crm_kanban_leads l
      JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      WHERE l.id = ?
    `, [id]);

    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    if (lead.exigir_obs && (!observacao || observacao.trim() === '')) {
      return res.status(400).json({ error: 'A observação descrevendo a perda é obrigatória para esta etapa.' });
    }

    // Regra: Apenas o dono do lead (ou admin/supervisor da equipe) pode marcar perda
    if (req.user.role === 'sdr' && lead.sdr_id !== req.user.id) {
      return res.status(403).json({ error: 'Você só pode registrar perda de seus próprios leads.' });
    }
    if (req.user.role === 'closer' && lead.closer_id !== req.user.id) {
      return res.status(403).json({ error: 'Você só pode registrar perda de seus próprios leads.' });
    }
    if (req.user.role === 'supervisor') {
      const supervisor = await dbGet('SELECT team_id FROM users WHERE id = ?', [req.user.id]);
      const supervisorTeamId = supervisor?.team_id || req.user.team_id;
      const leadOwner = await dbGet(`
        SELECT u_sdr.team_id as sdr_team_id, u_closer.team_id as closer_team_id
        FROM crm_kanban_leads l
        LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
        LEFT JOIN users u_closer ON l.closer_id = u_closer.id
        WHERE l.id = ?
      `, [id]);
      if (!supervisorTeamId || (leadOwner?.sdr_team_id !== supervisorTeamId && leadOwner?.closer_team_id !== supervisorTeamId)) {
        return res.status(403).json({ error: 'Você só pode registrar perda de leads da sua própria equipe.' });
      }
    }

    // 1. Atualizar status do lead para 'perdido'
    await dbRun(
      "UPDATE crm_kanban_leads SET status_atendimento = 'perdido', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    );

    // 2. Gravar histórico
    const logObs = `Lead marcado como PERDIDO no estágio ${lead.estagio_nome}. Motivo: ${motivo}.${observacao ? ' Obs: ' + observacao.trim() : ''}`;
    await dbRun(
      'INSERT INTO crm_kanban_historico (lead_id, estagio_anterior_id, estagio_novo_id, usuario_id, observacao) VALUES (?, ?, ?, ?, ?)',
      [id, lead.estagio_id, null, req.user.id, logObs]
    );

    // 3. Salvar registro de perda
    await dbRun(
      `INSERT INTO crm_leads_perdas 
        (lead_id, cliente_id, estagio_id, estagio_nome, motivo, observacao, usuario_id, usuario_nome) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        lead.cliente_id,
        lead.estagio_id,
        lead.estagio_nome,
        motivo,
        observacao || null,
        req.user.id,
        req.user.name || req.user.username
      ]
    );

    // 4. Buscar lead atualizado completo para SSE
    const leadAtualizado = await dbGet(`
      SELECT l.*, c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone,
             e.nome as estagio_nome, e.cor as estagio_cor, e.pipeline_tipo,
             COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
             COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
             u_sdr.username as sdr_username,
             u_closer.username as closer_username
      FROM crm_kanban_leads l
      JOIN crm_clientes c ON l.cliente_id = c.id
      LEFT JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
      LEFT JOIN users u_closer ON l.closer_id = u_closer.id
      WHERE l.id = ?
    `, [id]);

    broadcastCrmEvent('LEAD_MOVIDO', leadAtualizado);

    res.json({ success: true, message: 'Lead marcado como perdido com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/kanban/leads/:id/aceitar — Closer aceita o lead (Desliga o Alerta)
router.post('/api/crm/kanban/leads/:id/aceitar', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const lead = await dbGet('SELECT * FROM crm_kanban_leads WHERE id = ?', [id]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    // Quem pode aceitar: o Closer dono do lead, ou admin/supervisor. SDR e Geração de Leads não aceitam.
    const role = req.user.role;
    if (role === 'closer') {
      if (String(lead.closer_id) !== String(req.user.id)) {
        return res.status(403).json({ error: 'Este lead está atribuído a outro Closer.' });
      }
    } else if (role === 'supervisor') {
      // Supervisor: só leads da própria equipe (mesma regra de mover, reatribuir e marcar perda)
      const supervisor = await dbGet('SELECT team_id FROM users WHERE id = ?', [req.user.id]);
      const supervisorTeamId = supervisor?.team_id || req.user.team_id;
      const leadOwner = await dbGet(`
        SELECT u_sdr.team_id as sdr_team_id, u_closer.team_id as closer_team_id
        FROM crm_kanban_leads l
        LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
        LEFT JOIN users u_closer ON l.closer_id = u_closer.id
        WHERE l.id = ?
      `, [id]);
      if (!supervisorTeamId || (leadOwner?.sdr_team_id !== supervisorTeamId && leadOwner?.closer_team_id !== supervisorTeamId)) {
        return res.status(403).json({ error: 'Você só pode aceitar leads da sua própria equipe.' });
      }
    } else if (role !== 'admin') {
      return res.status(403).json({ error: 'Apenas o Closer responsável pode aceitar este lead.' });
    }

    // Só aceita lead pendente (evita regravar o tempo e reabrir lead perdido/concluído).
    // Tempo de resposta = da transferência ao Closer (ou criação) até agora, calculado no banco.
    const aceito = await dbGet(
      `UPDATE crm_kanban_leads
       SET status_atendimento = 'em_atendimento', aceito_em = CURRENT_TIMESTAMP,
           tempo_resposta_segundos = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(transferido_closer_at, created_at)))))::int,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status_atendimento = 'pendente_aceite'
       RETURNING id, tempo_resposta_segundos`,
      [id]
    );

    if (!aceito) {
      return res.status(409).json({ error: 'Este lead não está mais pendente de aceite (já foi aceito ou teve a situação alterada). Atualize a tela.' });
    }

    const tempoRespostaSegundos = aceito.tempo_resposta_segundos;

    broadcastCrmEvent('LEAD_ACEITO', { id: parseInt(id), status_atendimento: 'em_atendimento', tempo_resposta_segundos: tempoRespostaSegundos });

    res.json({ message: 'Atendimento iniciado com sucesso! Alerta desligado.', tempo_resposta_segundos: tempoRespostaSegundos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
