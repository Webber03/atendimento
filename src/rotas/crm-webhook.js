const express = require('express');
const { dbGet, dbRun } = require('../../database');
const { broadcastCrmEvent } = require('../servicos/eventos-crm');
const { parseBrDateTime, parseValueFromString, sanitizeCpf } = require('../utils/formatos');
const { sqlLocalParaUtc } = require('../utils/fuso-horario');

const router = express.Router();

const recentProcessedIdentifiers = new Set();

router.post('/api/crm/webhook/discadora', async (req, res) => {
  console.log('[WEBHOOK DISCADORA] Novo payload recebido:', req.body);
  
  // Lista de instâncias clientes ativas
  const clientInstances = [
    'https://educred.vps11814.panel.icontainer.work/api/crm/webhook/discadora',
    'https://itacred.vps11814.panel.icontainer.work/api/crm/webhook/discadora',
    'https://drjessica.vps11814.panel.icontainer.work/api/crm/webhook/discadora'
  ];

  if (!req.headers['x-forwarded-by']) {
    clientInstances.forEach(url => {
      fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Forwarded-By': 'discadora-hub'
        },
        body: JSON.stringify(req.body)
      }).catch(() => {});
    });
  }

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
    const cpfLimpo = sanitizeCpf(cpf);
    const nomeLimpo = (nome && nome.toString().trim() !== '') 
      ? nome.toString().trim() 
      : (cpfLimpo ? `Cliente CPF ${cpfLimpo}` : 'Cliente Discadora');

    const telLimpo = (telefone && telefone.toString().trim() !== '') ? telefone.toString().trim() : null;
    const obsLimpa = (observacao && observacao.toString().trim() !== '') ? observacao.toString().trim() : null;

    // Trava de processamento concorrente em memória (100% segura contra race conditions de banco de dados)
    const dedupeKey = cpfLimpo ? `cpf_${cpfLimpo}` : (telLimpo ? `tel_${telLimpo}` : null);
    if (dedupeKey) {
      if (recentProcessedIdentifiers.has(dedupeKey)) {
        console.log(`[WEBHOOK DISCADORA] Evitado duplo processamento concorrente para a chave: ${dedupeKey}`);
        return res.status(200).json({ message: 'Requisição concorrente duplicada ignorada.' });
      }
      recentProcessedIdentifiers.add(dedupeKey);
      setTimeout(() => {
        recentProcessedIdentifiers.delete(dedupeKey);
      }, 10000); // Expira em 10 segundos
    }

    const valorWebhook = parseValueFromString(observacao);

    // Se extraímos um valor numérico válido (> 0) da observação,
    // não salvamos esse valor como texto nas observações do cliente ou da tabulação (deixando apenas no campo valor)
    const obsSalvarCliente = (valorWebhook > 0) ? null : obsLimpa;
    const obsTabulacao = (valorWebhook > 0) ? (fila || null) : (observacao || fila || null);

    // 3. Cadastrar ou localizar o cliente
    let cliente = null;
    if (cpfLimpo) {
      cliente = await dbGet('SELECT * FROM crm_clientes WHERE cpf = ? OR REGEXP_REPLACE(COALESCE(cpf, \'\'), \'\\D\', \'\', \'g\') = ?', [cpfLimpo, cpfLimpo]);
    }
    if (!cliente && telLimpo) {
      const telDigits = telLimpo.replace(/\D/g, '');
      if (telDigits.length >= 8) {
        cliente = await dbGet('SELECT * FROM crm_clientes WHERE telefone = ? OR REGEXP_REPLACE(COALESCE(telefone, \'\'), \'\\D\', \'\', \'g\') LIKE ?', [telLimpo, `%${telDigits}%`]);
      } else {
        cliente = await dbGet('SELECT * FROM crm_clientes WHERE telefone = ?', [telLimpo]);
      }
    }

    let clienteId;
    if (cliente) {
      clienteId = cliente.id;
      await dbRun(
        'UPDATE crm_clientes SET nome = ?, cpf = COALESCE(?, cpf), telefone = COALESCE(?, telefone), email = COALESCE(?, email), observacoes = COALESCE(?, observacoes), valor_contrato = COALESCE(?, valor_contrato), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [nomeLimpo, cpfLimpo, telLimpo, email ? email.toString().trim() : null, obsSalvarCliente, valorWebhook > 0 ? valorWebhook : null, clienteId]
      );
    } else {
      try {
        const resCli = await dbRun(
          'INSERT INTO crm_clientes (cpf, nome, telefone, email, observacoes, valor_contrato) VALUES (?, ?, ?, ?, ?, ?)',
          [cpfLimpo, nomeLimpo, telLimpo, email ? email.toString().trim() : null, obsSalvarCliente, valorWebhook > 0 ? valorWebhook : null]
        );
        clienteId = resCli.lastID;
      } catch (insertErr) {
        if (insertErr.code === '23505' && cpfLimpo) {
          const cliConflict = await dbGet('SELECT id FROM crm_clientes WHERE cpf = ?', [cpfLimpo]);
          clienteId = cliConflict?.id;
        } else {
          throw insertErr;
        }
      }
    }

    // 4. Registrar a Tabulação (Preservando a data informada na planilha)
    let finalConsultorNome = discadora_login || 'Discadora Auto';
    let userRole = 'sdr';
    if (assignedUserId) {
      const userRow = await dbGet('SELECT role, name, username FROM users WHERE id = ?', [assignedUserId]);
      if (userRow) {
        userRole = userRow.role || 'sdr';
        finalConsultorNome = userRow.name || userRow.username || finalConsultorNome;
      }
    }

    if (fechaPersonalizada) {
      await dbRun(
        `INSERT INTO crm_tabulacoes (cliente_id, consultor_id, consultor_nome, tipo_tabulacao, observacao, iniciou_kanban, valor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ${sqlLocalParaUtc('?::timestamp')})`,
        [clienteId, assignedUserId, finalConsultorNome, tabulacao || 'Interesse na Simulação', obsTabulacao, true, valorWebhook, fechaPersonalizada]
      );
    } else {
      await dbRun(
        'INSERT INTO crm_tabulacoes (cliente_id, consultor_id, consultor_nome, tipo_tabulacao, observacao, iniciou_kanban, valor) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [clienteId, assignedUserId, finalConsultorNome, tabulacao || 'Interesse na Simulação', obsTabulacao, true, valorWebhook]
      );
    }

    // 4. Determinar estágio inicial do Kanban (SDR ou Closer dependendo da Role)
    // Supervisores e Admins prospectam pela discadora e seus leads devem cair no pipeline Closer (vinculado a eles)
    const targetPipeline = (userRole === 'sdr') ? 'sdr' : 'closer';
    let estagioInicial = await dbGet("SELECT id FROM crm_kanban_estagios WHERE pipeline_tipo = ? AND ativo = TRUE ORDER BY ordem ASC LIMIT 1", [targetPipeline]);
    if (!estagioInicial) {
      estagioInicial = await dbGet("SELECT id FROM crm_kanban_estagios WHERE ativo = TRUE ORDER BY ordem ASC LIMIT 1");
    }
    const estagioId = estagioInicial ? estagioInicial.id : null;

    const sdrId = (targetPipeline === 'sdr') ? assignedUserId : null;
    const closerId = (targetPipeline === 'closer') ? assignedUserId : null;

    // 5. Criar o Card no Kanban correspondente (Evitando duplicidade por disparos simultâneos ou clientes que já possuem atendimento ativo para este mesmo operador)
    let activeLead = null;
    if (targetPipeline === 'sdr') {
      activeLead = await dbGet(
        "SELECT id FROM crm_kanban_leads WHERE cliente_id = ? AND sdr_id = ? AND status_atendimento IN ('em_atendimento', 'pendente_aceite') LIMIT 1",
        [clienteId, sdrId]
      );
    } else {
      activeLead = await dbGet(
        "SELECT id FROM crm_kanban_leads WHERE cliente_id = ? AND closer_id = ? AND status_atendimento IN ('em_atendimento', 'pendente_aceite') LIMIT 1",
        [clienteId, closerId]
      );
    }

    let leadId;
    if (activeLead) {
      leadId = activeLead.id;
      console.log(`[WEBHOOK DISCADORA] Cliente #${clienteId} já possui um lead ativo no Kanban para o operador #${assignedUserId} (#${leadId}). Evitando duplicado.`);
      return res.status(200).json({
        message: 'Lead recebido (cliente já possui lead ativo para este operador).',
        leadId
      });
    }

    let resLead;
    if (fechaPersonalizada) {
      resLead = await dbRun(
        `INSERT INTO crm_kanban_leads 
          (cliente_id, sdr_id, closer_id, estagio_id, status_atendimento, discadora_login, created_at, moved_to_stage_at) 
         VALUES (?, ?, ?, ?, ?, ?, ${sqlLocalParaUtc('?::timestamp')}, ${sqlLocalParaUtc('?::timestamp')})`,
        [clienteId, sdrId, closerId, estagioId, 'em_atendimento', discadora_login || null, fechaPersonalizada, fechaPersonalizada]
      );
    } else {
      resLead = await dbRun(
        `INSERT INTO crm_kanban_leads 
          (cliente_id, sdr_id, closer_id, estagio_id, status_atendimento, discadora_login, moved_to_stage_at) 
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [clienteId, sdrId, closerId, estagioId, 'em_atendimento', discadora_login || null]
      );
    }
    leadId = resLead.lastID;

    // 6. Historico de movimentação
    const logDesc = (targetPipeline === 'closer')
      ? 'Lead criado via Discadora na coluna inicial de Closer'
      : 'Lead criado via Discadora na coluna CONTATO INICIAL (SDR)';
    await dbRun(
      'INSERT INTO crm_kanban_historico (lead_id, estagio_novo_id, usuario_id, observacao) VALUES (?, ?, ?, ?)',
      [leadId, estagioId, assignedUserId, logDesc]
    );

    // 7. Notificar via Realtime (SSE)
    const leadCompleto = await dbGet(`
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
    `, [leadId]);

    broadcastCrmEvent('LEAD_NOVO', leadCompleto);
    console.log(`[WEBHOOK DISCADORA] Lead #${leadId} (${nome}) criado no Kanban ${targetPipeline.toUpperCase()} com data: ${fechaPersonalizada || 'Agora'}`);

    res.status(201).json({
      message: 'Lead recebido da discadora e inserido no Kanban com sucesso!',
      lead: leadCompleto
    });
  } catch (err) {
    console.error('Erro no webhook da discadora:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
