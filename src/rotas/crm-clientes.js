const express = require('express');
const { dbAll, dbGet, dbRun } = require('../../database');
const { requireAuth } = require('../../auth');
const { broadcastCrmEvent } = require('../servicos/eventos-crm');
const { formatCpf, parseValueFromString, sanitizeCpf } = require('../utils/formatos');
const { getNextCloserFromQueue } = require('../servicos/fila-closers');

const router = express.Router();

// ----------------------------------------
// BUSCA E TABULAÇÃO DE CLIENTES
// ----------------------------------------

// GET /api/crm/clientes/search — Busca clientes por CPF, Nome ou Telefone (com ou sem pontuação)
router.get('/api/crm/clientes/search', requireAuth, async (req, res) => {
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

// (registrada antes de /:id, senão "check-cpf" seria tratado como id)
// GET /api/crm/clientes/check-cpf — Verifica se um CPF já está cadastrado
router.get('/api/crm/clientes/check-cpf', requireAuth, async (req, res) => {
  const { cpf, excludeId } = req.query;
  const cpfLimpo = sanitizeCpf(cpf);
  if (!cpfLimpo || (cpfLimpo.length !== 11 && cpfLimpo.length !== 14)) {
    return res.json({ exists: false });
  }

  try {
    let query = `SELECT id, nome, cpf, telefone FROM crm_clientes WHERE cpf = ? OR REGEXP_REPLACE(COALESCE(cpf, ''), '\\D', '', 'g') = ?`;
    const params = [cpfLimpo, cpfLimpo];
    if (excludeId) {
      query += ` AND id != ?`;
      params.push(excludeId);
    }
    query += ` LIMIT 1`;
    const cliente = await dbGet(query, params);
    if (cliente) {
      return res.json({ 
        exists: true, 
        cliente: {
          id: cliente.id,
          nome: cliente.nome,
          cpf: cliente.cpf,
          telefone: cliente.telefone
        }
      });
    }
    res.json({ exists: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/clientes/:id — Ficha detalhada do cliente + histórico
router.get('/api/crm/clientes/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [id]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    // Tabulações
    const tabulacoes = await dbAll(`
      SELECT t.*, u.username as consultor_username, ch.name as canal_nome
      FROM crm_tabulacoes t
      LEFT JOIN users u ON t.consultor_id = u.id
      LEFT JOIN channels ch ON t.canal_venda_id = ch.id
      WHERE t.cliente_id = ?
      ORDER BY t.created_at DESC
    `, [id]);

    // Histórico de movimentações no Kanban
    const historicoKanban = await dbAll(`
      SELECT h.*, e_ant.nome as estagio_anterior_nome, e_novo.nome as estagio_novo_nome, COALESCE(u.name, u.username) as usuario_nome
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
router.post('/api/crm/clientes', requireAuth, async (req, res) => {
  const { id, cpf, nome, telefone, email, observacoes, valor, banco, agencia, conta } = req.body;

  if (!nome || nome.trim() === '') {
    return res.status(400).json({ error: 'O nome do cliente é obrigatório.' });
  }

  try {
    let targetClienteId = id;
    const valorNum = (valor !== undefined && valor !== null && valor !== '') ? parseValueFromString(valor) : null;
    const cpfLimpo = sanitizeCpf(cpf);
    const bancoLimpo = (banco && banco.trim() !== '') ? banco.trim() : null;
    const agenciaLimpa = (agencia && agencia.trim() !== '') ? agencia.trim() : null;
    const contaLimpa = (conta && conta.trim() !== '') ? conta.trim() : null;

    if (id) {
      // Se for alteração de cliente existente e foi informado CPF, verificar se o CPF não pertence a outro cliente
      if (cpfLimpo) {
        const clienteComMesmoCpf = await dbGet(
          `SELECT id, nome, cpf FROM crm_clientes 
           WHERE (cpf = ? OR REGEXP_REPLACE(COALESCE(cpf, ''), '\\D', '', 'g') = ?) AND id != ? LIMIT 1`,
          [cpfLimpo, cpfLimpo, id]
        );
        if (clienteComMesmoCpf) {
          return res.status(400).json({ 
            error: `O CPF ${formatCpf(cpfLimpo)} já pertence a outro cliente cadastrado: ${clienteComMesmoCpf.nome}.`,
            clienteExistenteId: clienteComMesmoCpf.id
          });
        }
      }

      await dbRun(
        'UPDATE crm_clientes SET cpf = ?, nome = ?, telefone = ?, email = ?, observacoes = ?, valor_contrato = ?, banco = ?, agencia = ?, conta = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [cpfLimpo, nome.trim(), telefone ? telefone.trim() : null, email ? email.trim() : null, observacoes || null, valorNum, bancoLimpo, agenciaLimpa, contaLimpa, id]
      );
    } else {
      // Cadastro de NOVO cliente
      if (!cpfLimpo) {
        return res.status(400).json({ error: 'O CPF do cliente é obrigatório.' });
      }
      if (cpfLimpo.length !== 11 && cpfLimpo.length !== 14) {
        return res.status(400).json({ error: 'CPF inválido. O CPF deve conter 11 dígitos numéricos.' });
      }
      if (!telefone || telefone.trim() === '') {
        return res.status(400).json({ error: 'O telefone do cliente é obrigatório.' });
      }

      // Validação de duplicidade por CPF
      const clienteExistente = await dbGet(
        `SELECT id, nome, cpf, telefone FROM crm_clientes 
         WHERE cpf = ? OR REGEXP_REPLACE(COALESCE(cpf, ''), '\\D', '', 'g') = ? LIMIT 1`,
        [cpfLimpo, cpfLimpo]
      );

      if (clienteExistente) {
        return res.status(409).json({ 
          error: `Cliente já cadastrado com este CPF (${formatCpf(clienteExistente.cpf) || cpfLimpo}): ${clienteExistente.nome}.`,
          clienteExistenteId: clienteExistente.id,
          clienteExistenteNome: clienteExistente.nome
        });
      }

      try {
        const result = await dbRun(
          'INSERT INTO crm_clientes (cpf, nome, telefone, email, observacoes, valor_contrato, banco, agencia, conta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [cpfLimpo, nome.trim(), telefone ? telefone.trim() : null, email ? email.trim() : null, observacoes || null, valorNum, bancoLimpo, agenciaLimpa, contaLimpa]
        );
        targetClienteId = result.lastID;
      } catch (insertErr) {
        // Tratar erro de violação de índice único caso chegue requisição concorrente simultânea
        if (insertErr.code === '23505') {
          const cliConflict = await dbGet('SELECT id, nome, cpf FROM crm_clientes WHERE cpf = ?', [cpfLimpo]);
          return res.status(409).json({
            error: `Cliente já cadastrado com este CPF: ${cliConflict ? cliConflict.nome : cpfLimpo}.`,
            clienteExistenteId: cliConflict?.id,
            clienteExistenteNome: cliConflict?.nome
          });
        }
        throw insertErr;
      }
    }

    // Salvar/atualizar o valor na tabulação mais recente do cliente se informado (para manter histórico de valor)
    if (valorNum !== null) {
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
router.post('/api/crm/tabulacoes', requireAuth, async (req, res) => {
  let { cliente_id, estagio_id, tipo_tabulacao, observacao, valor, canal_venda_id } = req.body;

  if (!cliente_id || !estagio_id || !tipo_tabulacao || !canal_venda_id) {
    return res.status(400).json({ error: 'Cliente, Estágio, Canal de Venda e Tipo de Tabulação são obrigatórios.' });
  }

  const valorNum = parseValueFromString(valor);

  try {
    const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [cliente_id]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    const estagio = await dbGet('SELECT * FROM crm_kanban_estagios WHERE id = ?', [estagio_id]);
    if (!estagio) {
      return res.status(400).json({ error: 'Estágio de destino inválido.' });
    }

    let pTipo = estagio.pipeline_tipo || 'sdr';
    // Admin/Supervisor nunca são SDR: lead iniciado por eles vai para a 1ª etapa do funil Closer,
    // com eles como Closer (mesma regra da discadora)
    if (pTipo === 'sdr' && (req.user.role === 'admin' || req.user.role === 'supervisor')) {
      const primeiraCloser = await dbGet("SELECT id FROM crm_kanban_estagios WHERE pipeline_tipo = 'closer' AND ativo = TRUE ORDER BY ordem ASC LIMIT 1");
      if (primeiraCloser) {
        estagio_id = primeiraCloser.id;
        pTipo = 'closer';
      }
    }
    const sdrId = pTipo === 'sdr' ? req.user.id : null;
    let closerId = pTipo === 'closer' ? req.user.id : null;
    if (!closerId && pTipo === 'closer') {
      closerId = await getNextCloserFromQueue();
    }

    // Evitar duplicar card do mesmo operador se o cliente já possuir um lead ativo no Kanban para este operador
    let activeLead = null;
    if (pTipo === 'sdr') {
      activeLead = await dbGet(
        "SELECT * FROM crm_kanban_leads WHERE cliente_id = ? AND sdr_id = ? AND status_atendimento IN ('em_atendimento', 'pendente_aceite') LIMIT 1",
        [cliente_id, sdrId]
      );
    } else {
      activeLead = await dbGet(
        "SELECT * FROM crm_kanban_leads WHERE cliente_id = ? AND closer_id = ? AND status_atendimento IN ('em_atendimento', 'pendente_aceite') LIMIT 1",
        [cliente_id, closerId]
      );
    }

    let leadId = null;
    if (activeLead) {
      leadId = activeLead.id;
      const estagioAnteriorId = activeLead.estagio_id;

      await dbRun(
        'UPDATE crm_kanban_leads SET estagio_id = ?, canal_venda_id = ?, moved_to_stage_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [estagio_id, canal_venda_id, leadId]
      );

      await dbRun(
        'INSERT INTO crm_kanban_historico (lead_id, estagio_anterior_id, estagio_novo_id, usuario_id, observacao) VALUES (?, ?, ?, ?, ?)',
        [leadId, estagioAnteriorId, estagio_id, req.user.id, `Lead atualizado via tabulação manual (${tipo_tabulacao})`]
      );
    } else {
      const resLead = await dbRun(
        'INSERT INTO crm_kanban_leads (cliente_id, sdr_id, closer_id, estagio_id, status_atendimento, canal_venda_id, moved_to_stage_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [cliente_id, sdrId, closerId, estagio_id, closerId ? 'pendente_aceite' : 'em_atendimento', canal_venda_id]
      );
      leadId = resLead.lastID;

      await dbRun(
        'INSERT INTO crm_kanban_historico (lead_id, estagio_novo_id, usuario_id, observacao) VALUES (?, ?, ?, ?)',
        [leadId, estagio_id, req.user.id, `Lead iniciado via tabulação manual (${tipo_tabulacao})`]
      );
    }

    await dbRun(
      'INSERT INTO crm_tabulacoes (cliente_id, consultor_id, consultor_nome, tipo_tabulacao, observacao, iniciou_kanban, valor, canal_venda_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [cliente_id, req.user.id, req.user.name || req.user.username, tipo_tabulacao, observacao || null, true, isNaN(valorNum) ? 0.00 : valorNum, canal_venda_id]
    );

    await dbRun(
      'UPDATE crm_clientes SET canal_venda_id = ?' + (valorNum > 0 ? ', valor_contrato = ?' : '') + ', updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      valorNum > 0 ? [canal_venda_id, valorNum, cliente_id] : [canal_venda_id, cliente_id]
    );

    // Buscar lead atualizado completo para notificação em tempo real
    const leadCompleto = await dbGet(`
      SELECT l.*, c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone,
             e.nome as estagio_nome, e.cor as estagio_cor, e.pipeline_tipo,
             COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
             COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
             u_sdr.username as sdr_username,
             u_closer.username as closer_username,
             ch.name as canal_nome
      FROM crm_kanban_leads l
      JOIN crm_clientes c ON l.cliente_id = c.id
      LEFT JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
      LEFT JOIN users u_closer ON l.closer_id = u_closer.id
      LEFT JOIN channels ch ON COALESCE(l.canal_venda_id, c.canal_venda_id) = ch.id
      WHERE l.id = ?
    `, [leadId]);

    broadcastCrmEvent('LEAD_CRIADO', leadCompleto);
    broadcastCrmEvent('TABULACAO_NOVA', { cliente_id, tipo_tabulacao, consultor: req.user.name || req.user.username });

    res.status(201).json({ message: 'Tabulação registrada com sucesso!', leadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
