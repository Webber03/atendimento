// Entrega 3: Propostas digitadas (lista/agrupada/CSV), detalhe da operação,
// mover status (com desfazer), parceiro e Editar proposta.
const express = require('express');
const crypto = require('crypto');
const { dbAll, dbGet, pool } = require('../../database');
const { requireAuth } = require('../../auth');
const { filtroVisibilidade, permissoesOperacao, podeMoverStatus } = require('../servicos/contratos-acesso');
const { FASES } = require('../servicos/contratos-listas-padrao');
const ops = require('./contratos-operacoes');

const router = express.Router();
const DESFAZER_MINUTOS = 15;
const nomeUsuario = a => `COALESCE(NULLIF(TRIM(${a}.name), ''), ${a}.username)`;

// ---------------------------------------------------------------------------
// Filtros da lista
// ---------------------------------------------------------------------------
async function montarFiltro(user, q, { ignorarFaseStatus = false } = {}) {
  const vis = await filtroVisibilidade(user);
  const onde = [vis.sql];
  const params = [...vis.params];
  if (!ignorarFaseStatus) {
    if (q.fase && FASES.some(f => f.chave === q.fase)) { onde.push('s.fase = ?'); params.push(q.fase); }
    if (q.status_id && Number(q.status_id)) { onde.push('c.status_id = ?'); params.push(Number(q.status_id)); }
  }
  if (q.closer_id && Number(q.closer_id)) { onde.push('o.closer_id = ?'); params.push(Number(q.closer_id)); }
  if (q.banco_id && Number(q.banco_id)) { onde.push('c.banco_id = ?'); params.push(Number(q.banco_id)); }
  if (q.produto_id && Number(q.produto_id)) { onde.push('o.produto_id = ?'); params.push(Number(q.produto_id)); }
  if (q.canal_id && Number(q.canal_id)) { onde.push('o.canal_venda_id = ?'); params.push(Number(q.canal_id)); }
  const data = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
  // Período pela data de digitação da operação (padrão) ou pela data de liberação (contratos pagos)
  if (q.campo_data === 'liberacao') {
    if (data(q.de) || data(q.ate)) onde.push('c.data_liberacao IS NOT NULL');
    if (data(q.de)) { onde.push('c.data_liberacao >= (?::date)'); params.push(q.de); }
    if (data(q.ate)) { onde.push('c.data_liberacao <= (?::date)'); params.push(q.ate); }
  } else {
    if (data(q.de)) { onde.push("o.created_at >= (?::date)"); params.push(q.de); }
    if (data(q.ate)) { onde.push("o.created_at < (?::date + INTERVAL '1 day')"); params.push(q.ate); }
  }
  const busca = String(q.busca || '').trim();
  if (busca) {
    const digitos = busca.replace(/\D/g, '');
    const termo = `%${busca.toUpperCase()}%`;
    const partes = ['UPPER(cli.nome) LIKE ?', 'UPPER(c.numero_contrato) LIKE ?', 'UPPER(c.numero_proposta) LIKE ?'];
    params.push(termo, termo, termo);
    if (digitos.length >= 3) { partes.push('cli.cpf LIKE ?'); params.push(`%${digitos}%`); }
    const opNum = busca.toUpperCase().match(/^OP-?0*(\d+)$/);
    if (opNum) { partes.push('o.id = ?'); params.push(Number(opNum[1])); }
    onde.push(`(${partes.join(' OR ')})`);
  }
  return { where: onde.join(' AND '), params };
}

const FROM_CONTRATOS = `
  FROM contratos c
  JOIN contratos_operacoes o ON o.id = c.operacao_id
  JOIN contratos_status s ON s.id = c.status_id
  JOIN crm_clientes cli ON cli.id = o.cliente_id
  LEFT JOIN contratos_listas t ON t.id = c.tipo_id
  LEFT JOIN contratos_listas b ON b.id = c.banco_id
  LEFT JOIN contratos_listas p ON p.id = o.produto_id
  LEFT JOIN users uc ON uc.id = o.closer_id
  LEFT JOIN channels chv ON chv.id = o.canal_venda_id`;

const COLUNAS_CONTRATO = `
  c.id, c.operacao_id, c.ordem, c.numero_contrato, c.numero_proposta, c.parcela, c.prazo_restante,
  c.saldo_devedor, c.prazo, c.valor_liberado, c.data_liberacao, c.status_em, c.updated_at, c.created_at,
  s.id AS status_id, s.nome AS status, s.fase, t.nome AS tipo, b.nome AS banco,
  o.formato, o.created_at AS operacao_em, o.lead_id, p.nome AS produto, chv.name AS canal_venda,
  cli.id AS cliente_id, cli.nome AS cliente, cli.cpf,
  ${nomeUsuario('uc')} AS consultor`;

// GET /api/contratos/propostas — um contrato por linha, ou agrupado por operação (?agrupar=1)
router.get('/api/contratos/propostas', requireAuth, async (req, res) => {
  try {
    const q = req.query;
    const porPagina = [50, 100].includes(Number(q.por_pagina)) ? Number(q.por_pagina) : 50;
    const pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    const f = await montarFiltro(req.user, q);
    const fSemFase = await montarFiltro(req.user, q, { ignorarFaseStatus: true });

    // Contagens por fase e status (com os outros filtros, sem o de fase/status)
    const contagens = await dbAll(`SELECT s.fase, c.status_id, COUNT(*)::int AS n ${FROM_CONTRATOS} WHERE ${fSemFase.where} GROUP BY s.fase, c.status_id`, fSemFase.params);
    const contagemFases = {}; const contagemStatus = {};
    contagens.forEach(r => { contagemFases[r.fase] = (contagemFases[r.fase] || 0) + r.n; contagemStatus[r.status_id] = r.n; });

    if (q.agrupar === '1') {
      // Operações com pelo menos 1 contrato no filtro; vêm todos os contratos, marcando os que estão fora
      const totalOps = (await dbGet(`SELECT COUNT(DISTINCT o.id)::int AS n ${FROM_CONTRATOS} WHERE ${f.where}`, f.params)).n;
      const idsOps = (await dbAll(`
        SELECT o.id, MAX(GREATEST(c.updated_at, c.status_em)) AS ult ${FROM_CONTRATOS}
        WHERE ${f.where} GROUP BY o.id ORDER BY ult DESC, o.id DESC LIMIT ? OFFSET ?`,
      [...f.params, porPagina, (pagina - 1) * porPagina])).map(r => r.id);
      let operacoes = [];
      if (idsOps.length) {
        const noFiltro = new Set((await dbAll(`SELECT c.id ${FROM_CONTRATOS} WHERE ${f.where} AND o.id = ANY(?::int[])`, [...f.params, idsOps])).map(r => r.id));
        const contratos = await dbAll(`SELECT ${COLUNAS_CONTRATO} ${FROM_CONTRATOS} WHERE o.id = ANY(?::int[]) ORDER BY c.ordem, c.id`, [idsOps]);
        operacoes = idsOps.map(id => {
          const cs = contratos.filter(c => c.operacao_id === id).map(c => ({ ...c, no_filtro: noFiltro.has(c.id) }));
          const c0 = cs[0] || {};
          return {
            id, codigo: ops.codigoOperacao(id), formato: c0.formato, created_at: c0.operacao_em, lead_id: c0.lead_id,
            cliente_id: c0.cliente_id, cliente: c0.cliente, cpf: c0.cpf, consultor: c0.consultor, produto: c0.produto, canal_venda: c0.canal_venda,
            valor_liberado: cs.reduce((t, c) => t + Number(c.valor_liberado || 0), 0),
            contratos: cs
          };
        });
      }
      return res.json({ total: totalOps, pagina, por_pagina: porPagina, contagem_fases: contagemFases, contagem_status: contagemStatus, operacoes });
    }

    const resumo = await dbGet(`SELECT COUNT(*)::int AS n, COALESCE(SUM(c.valor_liberado), 0) AS liberado ${FROM_CONTRATOS} WHERE ${f.where}`, f.params);

    if (q.formato === 'csv') {
      const linhas = await dbAll(`SELECT ${COLUNAS_CONTRATO} ${FROM_CONTRATOS} WHERE ${f.where} ORDER BY o.created_at DESC, c.operacao_id DESC, c.ordem LIMIT 10000`, f.params);
      const esc = v => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const num = v => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));
      const dt = v => (v ? new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
      const cab = ['Operação', 'Digitado em', 'Cliente', 'CPF', 'Convênio', 'Canal de venda', 'Tipo', 'Banco', 'Nº contrato', 'Nº proposta', 'Parcela', 'Prazo restante', 'Saldo devedor', 'Prazo', 'Valor liberado', 'Data liberação', 'Status', 'Fase', 'Consultor'];
      const corpo = linhas.map(c => [ops.codigoOperacao(c.operacao_id), dt(c.operacao_em), c.cliente, c.cpf, c.produto, c.canal_venda, c.tipo, c.banco, c.numero_contrato, c.numero_proposta, num(c.parcela), c.prazo_restante, num(c.saldo_devedor), c.prazo, num(c.valor_liberado), dt(c.data_liberacao), c.status, (FASES.find(x => x.chave === c.fase) || {}).nome, c.consultor].map(esc).join(';'));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="propostas-digitadas.csv"');
      return res.send('﻿' + [cab.join(';'), ...corpo].join('\r\n'));
    }

    const linhas = await dbAll(`SELECT ${COLUNAS_CONTRATO} ${FROM_CONTRATOS} WHERE ${f.where}
      ORDER BY o.created_at DESC, c.operacao_id DESC, c.ordem LIMIT ? OFFSET ?`, [...f.params, porPagina, (pagina - 1) * porPagina]);
    res.json({
      total: resumo.n, valor_liberado_total: Number(resumo.liberado), pagina, por_pagina: porPagina,
      contagem_fases: contagemFases, contagem_status: contagemStatus,
      linhas: linhas.map(l => ({ ...l, codigo: ops.codigoOperacao(l.operacao_id) }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contratos/consultores — closers com operações visíveis (filtro da lista)
router.get('/api/contratos/consultores', requireAuth, async (req, res) => {
  try {
    const vis = await filtroVisibilidade(req.user);
    const r = await dbAll(`SELECT DISTINCT u.id, ${nomeUsuario('u')} AS nome FROM contratos_operacoes o JOIN users u ON u.id = o.closer_id WHERE ${vis.sql} ORDER BY 2`, vis.params);
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Detalhe da operação
// ---------------------------------------------------------------------------
async function carregarOperacao(id) {
  return dbGet(`
    SELECT o.*, cli.nome AS cliente, cli.cpf, cli.telefone, cli.data_nascimento, cli.cep, cli.endereco, cli.cidade, cli.uf,
           cli.banco AS cli_banco, cli.agencia AS cli_agencia, cli.conta AS cli_conta, ch.name AS canal_venda,
           p.nome AS produto, pa.nome AS parceiro,
           ${nomeUsuario('uc')} AS consultor, ${nomeUsuario('us')} AS sdr, ${nomeUsuario('ud')} AS digitador,
           ${nomeUsuario('ucr')} AS criado_por_nome
    FROM contratos_operacoes o
    JOIN crm_clientes cli ON cli.id = o.cliente_id
    LEFT JOIN contratos_listas p ON p.id = o.produto_id
    LEFT JOIN contratos_listas pa ON pa.id = o.parceiro_id
    LEFT JOIN channels ch ON ch.id = o.canal_venda_id
    LEFT JOIN users uc ON uc.id = o.closer_id
    LEFT JOIN users us ON us.id = o.sdr_id
    LEFT JOIN users ud ON ud.id = o.digitador_id
    LEFT JOIN users ucr ON ucr.id = o.criado_por
    WHERE o.id = ?`, [id]);
}

async function contratosDaOperacao(id) {
  return dbAll(`
    SELECT c.*, s.nome AS status, s.fase, s.inicial, t.nome AS tipo, b.nome AS banco, tb.nome AS tabela
    FROM contratos c
    JOIN contratos_status s ON s.id = c.status_id
    LEFT JOIN contratos_listas t ON t.id = c.tipo_id
    LEFT JOIN contratos_listas b ON b.id = c.banco_id
    LEFT JOIN contratos_listas tb ON tb.id = c.tabela_id
    WHERE c.operacao_id = ? ORDER BY c.ordem, c.id`, [id]);
}

async function acessoOperacao(user, id) {
  const op = await carregarOperacao(id);
  if (!op) return { erro: [404, 'Operação não encontrada.'] };
  const contratos = await contratosDaOperacao(id);
  const perm = await permissoesOperacao(user, op, contratos.length > 0 && contratos.every(c => c.inicial));
  if (!perm.podeVer) return { erro: [403, 'Você não tem acesso a esta operação.'] };
  return { op, contratos, perm };
}

// GET /api/contratos/operacoes/:id
router.get('/api/contratos/operacoes/:id', requireAuth, async (req, res) => {
  try {
    const a = await acessoOperacao(req.user, req.params.id);
    if (a.erro) return res.status(a.erro[0]).json({ error: a.erro[1] });
    const historico = await dbAll(`
      SELECT h.id, h.contrato_id, h.lote, h.tipo, h.observacao, h.created_at,
             sa.nome AS status_anterior, sn.nome AS status_novo, ${nomeUsuario('u')} AS usuario
      FROM contratos_historico h
      LEFT JOIN contratos_status sa ON sa.id = h.status_anterior_id
      LEFT JOIN contratos_status sn ON sn.id = h.status_novo_id
      LEFT JOIN users u ON u.id = h.usuario_id
      WHERE h.operacao_id = ? ORDER BY h.created_at DESC, h.id DESC LIMIT 300`, [req.params.id]);
    const { op } = a;
    res.json({
      operacao: {
        id: op.id, codigo: ops.codigoOperacao(op.id), formato: op.formato, lead_id: op.lead_id,
        cliente_id: op.cliente_id, cliente: op.cliente, cpf: op.cpf, telefone: op.telefone,
        produto_id: op.produto_id, produto: op.produto, parceiro_id: op.parceiro_id, parceiro: op.parceiro,
        tipo_venda: op.tipo_venda, digitador_id: op.digitador_id, digitador: op.digitador,
        proposta_banco_em: op.proposta_banco_em, observacao: op.observacao,
        matricula: op.matricula, orgao: op.orgao, cargo: op.cargo, situacao_funcional: op.situacao_funcional,
        canal_venda_id: op.canal_venda_id, canal_venda: op.canal_venda,
        data_nascimento: op.data_nascimento, cep: op.cep, endereco: op.endereco, cidade: op.cidade, uf: op.uf,
        banco_cliente: op.cli_banco, agencia_cliente: op.cli_agencia, conta_cliente: op.cli_conta,
        consultor: op.consultor, sdr: op.sdr, criado_por: op.criado_por_nome, created_at: op.created_at
      },
      contratos: a.contratos,
      historico,
      permissoes: { pode_mover: a.perm.podeMover, pode_editar: a.perm.podeEditar, motivo_editar: a.perm.motivoEditar }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Mover status (inclui cancelar) — só Operacional e Admin
// ---------------------------------------------------------------------------
router.post('/api/contratos/operacoes/:id/mover', requireAuth, async (req, res) => {
  if (!podeMoverStatus(req.user)) return res.status(403).json({ error: 'Só Operacional e Admin mudam o status dos contratos.' });
  const client = await pool.connect();
  try {
    const a = await acessoOperacao(req.user, req.params.id);
    if (a.erro) return res.status(a.erro[0]).json({ error: a.erro[1] });
    const destino = await dbGet('SELECT id, nome, fase, ativo FROM contratos_status WHERE id = ?', [Number(req.body.status_id) || 0]);
    if (!destino || !destino.ativo) return res.status(400).json({ error: 'Escolha o novo status.' });
    const ids = [...new Set((req.body.contrato_ids || []).map(Number))];
    if (!ids.length) return res.status(400).json({ error: 'Marque pelo menos um contrato.' });
    const daOp = new Map(a.contratos.map(c => [c.id, c]));
    if (ids.some(i => !daOp.has(i))) return res.status(400).json({ error: 'Algum contrato marcado não é desta operação.' });
    const mover = ids.map(i => daOp.get(i)).filter(c => c.status_id !== destino.id);
    if (!mover.length) return res.status(400).json({ error: `Os contratos marcados já estão em ${destino.nome}.` });

    let dataLib = null;
    if (destino.nome === 'PAGO') {
      dataLib = ops.lerData(req.body.data_liberacao);
      if (!dataLib) return res.status(400).json({ error: 'Informe a data de liberação para marcar como PAGO.', campo: 'data_liberacao' });
    }
    const obs = ops.texto(req.body.observacao, 1000);
    const lote = crypto.randomUUID();

    await client.query('BEGIN');
    for (const c of mover) {
      await client.query(
        `UPDATE contratos SET status_id = $1, status_em = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
           data_liberacao = COALESCE($2, data_liberacao) WHERE id = $3`, [destino.id, dataLib, c.id]);
      await client.query(
        `INSERT INTO contratos_historico (contrato_id, operacao_id, status_anterior_id, status_novo_id, usuario_id, observacao, lote, tipo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'status')`, [c.id, a.op.id, c.status_id, destino.id, req.user.id, obs, lote]);
    }
    await client.query('UPDATE contratos_operacoes SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [a.op.id]);
    await client.query('COMMIT');
    res.json({ lote, movidos: mover.length, status: destino.nome, ignorados: ids.length - mover.length, desfazer_minutos: DESFAZER_MINUTOS });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/contratos/lotes/:lote/desfazer — volta o último movimento (se ninguém mexeu depois)
router.post('/api/contratos/lotes/:lote/desfazer', requireAuth, async (req, res) => {
  if (!podeMoverStatus(req.user)) return res.status(403).json({ error: 'Só Operacional e Admin mudam o status dos contratos.' });
  const client = await pool.connect();
  try {
    const itens = await dbAll(`
      SELECT h.contrato_id, h.operacao_id, h.status_anterior_id, h.status_novo_id, h.usuario_id, c.status_id AS atual,
             (h.created_at >= CURRENT_TIMESTAMP - (? * INTERVAL '1 minute')) AS recente
      FROM contratos_historico h JOIN contratos c ON c.id = h.contrato_id
      WHERE h.lote = ? AND h.tipo = 'status'`, [DESFAZER_MINUTOS, req.params.lote]);
    if (!itens.length) return res.status(404).json({ error: 'Movimento não encontrado.' });
    if (!itens[0].recente) {
      return res.status(400).json({ error: `Só dá para desfazer nos primeiros ${DESFAZER_MINUTOS} minutos. Mova de novo pelo Atualizar operação.` });
    }
    const voltar = itens.filter(i => i.atual === i.status_novo_id);
    await client.query('BEGIN');
    for (const i of voltar) {
      await client.query('UPDATE contratos SET status_id = $1, status_em = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [i.status_anterior_id, i.contrato_id]);
      await client.query(
        `INSERT INTO contratos_historico (contrato_id, operacao_id, status_anterior_id, status_novo_id, usuario_id, observacao, tipo)
         VALUES ($1, $2, $3, $4, $5, 'Movimento desfeito', 'status')`, [i.contrato_id, i.operacao_id, i.status_novo_id, i.status_anterior_id, req.user.id]);
    }
    await client.query("UPDATE contratos_historico SET tipo = 'desfeito' WHERE lote = $1", [req.params.lote]);
    await client.query('COMMIT');
    res.json({ desfeitos: voltar.length, mantidos: itens.length - voltar.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/contratos/operacoes/:id/parceiro — só Operacional e Admin
router.put('/api/contratos/operacoes/:id/parceiro', requireAuth, async (req, res) => {
  if (!podeMoverStatus(req.user)) return res.status(403).json({ error: 'Só Operacional e Admin definem o parceiro.' });
  try {
    const a = await acessoOperacao(req.user, req.params.id);
    if (a.erro) return res.status(a.erro[0]).json({ error: a.erro[1] });
    const p = await dbGet("SELECT id, nome FROM contratos_listas WHERE id = ? AND lista = 'parceiro' AND ativo = TRUE", [Number(req.body.parceiro_id) || 0]);
    if (!p) return res.status(400).json({ error: 'Escolha um parceiro da lista.' });
    if (p.id !== a.op.parceiro_id) {
      await dbGet('UPDATE contratos_operacoes SET parceiro_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING id', [p.id, a.op.id]);
      const primeiro = a.contratos[0];
      if (primeiro) {
        await dbGet(`INSERT INTO contratos_historico (contrato_id, operacao_id, status_anterior_id, status_novo_id, usuario_id, observacao, tipo)
          VALUES (?, ?, ?, ?, ?, ?, 'edicao') RETURNING id`, [primeiro.id, a.op.id, primeiro.status_id, primeiro.status_id, req.user.id, `Parceiro: ${a.op.parceiro || "nenhum"} para ${p.nome}`]);
      }
    }
    res.json({ parceiro_id: p.id, parceiro: p.nome });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/contratos/operacoes/:id — Editar proposta (mesmo corpo da Nova operação,
// cada contrato existente com "id"). Formato não muda. Contrato só sai se ainda
// estiver no status inicial; depois disso, cancela-se.
// ---------------------------------------------------------------------------
router.put('/api/contratos/operacoes/:id', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const a = await acessoOperacao(req.user, req.params.id);
    if (a.erro) return res.status(a.erro[0]).json({ error: a.erro[1] });
    if (!a.perm.podeEditar) return res.status(403).json({ error: a.perm.motivoEditar || 'Você não pode editar esta operação.' });

    const corpo = { ...(req.body || {}), formato: a.op.formato };
    const listas = await ops.carregarListas();
    // Itens já gravados continuam valendo mesmo se tiverem sido desativados depois
    a.contratos.forEach(c => ['tipo_id', 'banco_id', 'tabela_id'].forEach(k => {
      const it = listas.porId.get(c[k]); if (it) listas.porId.set(c[k], { ...it, ativo: true });
    }));
    const produtoAtual = listas.porId.get(a.op.produto_id); if (produtoAtual) listas.porId.set(a.op.produto_id, { ...produtoAtual, ativo: true });

    const { erros, linhas } = ops.validarOperacao(corpo, listas);
    const digitador = await dbGet("SELECT id FROM users WHERE id = ? AND (active = TRUE OR id = ?) AND role IN ('closer', 'supervisor', 'admin', 'operacional')", [Number(corpo.digitador_id) || 0, a.op.digitador_id || 0]);
    if (corpo.digitador_id && !digitador && !erros.some(e => e.campo === 'digitador_id')) erros.push({ campo: 'digitador_id', mensagem: 'Digitador não encontrado.' });
    const cli = ops.validarCliente(corpo);
    erros.push(...cli.erros);
    const canal = await ops.validarCanal(corpo.canal_venda_id);
    if (canal.erro) erros.push(canal.erro);

    // ids dos contratos na mesma ordem das linhas validadas
    let ids = [];
    if (a.op.formato === 'unico') ids = [corpo.contrato && corpo.contrato.id];
    else {
      ids = (corpo.portabilidades || []).slice(0, 30).map(p => p && p.id);
      if (a.op.formato === 'port_refin') ids.push(corpo.refin && corpo.refin.id);
    }
    const existentes = new Map(a.contratos.map(c => [c.id, c]));
    ids = ids.map(i => (i && existentes.has(Number(i)) ? Number(i) : null));
    const removidos = a.contratos.filter(c => !ids.includes(c.id));
    removidos.forEach(c => {
      if (!c.inicial) erros.push({ campo: 'portabilidades', mensagem: `O contrato ${c.numero_contrato || c.tipo} já está em ${c.status}: cancele em vez de remover.` });
    });
    if (erros.length) return res.status(400).json({ error: erros.length === 1 ? erros[0].mensagem : `${erros.length} campos para corrigir.`, erros });

    const inicial = await dbGet('SELECT id, nome FROM contratos_status WHERE inicial = TRUE LIMIT 1');
    const campos = ['tipo_id', 'banco_id', 'tabela_id', 'numero_contrato', 'parcela', 'prazo_restante', 'saldo_devedor', 'prazo', 'taxa', 'valor_liberado', 'numero_proposta'];
    const resumo = [];
    await client.query('BEGIN');
    await client.query(`UPDATE contratos_operacoes SET produto_id = $1, tipo_venda = $2, digitador_id = $3, proposta_banco_em = $4,
      observacao = $5, matricula = $6, orgao = $7, cargo = $8, situacao_funcional = $9, canal_venda_id = $10,
      updated_at = CURRENT_TIMESTAMP WHERE id = $11`, [
      Number(corpo.produto_id), corpo.tipo_venda || 'Padrão', digitador.id, ops.lerData(corpo.proposta_banco_em) || null,
      ops.texto(corpo.observacao, 2000), ops.texto(corpo.matricula, 40), ops.texto(corpo.orgao, 120),
      ops.texto(corpo.cargo, 120), ops.texto(corpo.situacao_funcional, 80), canal.id, a.op.id
    ]);
    await client.query(`UPDATE crm_clientes SET data_nascimento = $1, cep = $2, endereco = $3, cidade = $4, uf = $5,
      updated_at = CURRENT_TIMESTAMP WHERE id = $6`,
      [cli.valores.data_nascimento, cli.valores.cep, cli.valores.endereco, cli.valores.cidade, cli.valores.uf, a.op.cliente_id]);
    for (const c of removidos) {
      await client.query('DELETE FROM contratos WHERE id = $1', [c.id]);
      resumo.push(`removido ${c.numero_contrato || c.tipo}`);
    }
    let alterados = 0; let novos = 0; let primeiroId = null;
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      const valores = campos.map(k => (l[k] === undefined ? null : l[k]));
      if (ids[i]) {
        const antes = existentes.get(ids[i]);
        const mudou = campos.some((k, j) => String(antes[k] ?? '') !== String(valores[j] ?? '') && !(antes[k] != null && valores[j] != null && Number(antes[k]) === Number(valores[j])));
        await client.query(`UPDATE contratos SET ordem = $1, ${campos.map((k, j) => `${k} = $${j + 2}`).join(', ')}${mudou ? ', updated_at = CURRENT_TIMESTAMP' : ''} WHERE id = $${campos.length + 2}`,
          [i + 1, ...valores, ids[i]]);
        if (mudou) alterados++;
        primeiroId = primeiroId || ids[i];
      } else {
        const r = await client.query(`INSERT INTO contratos (operacao_id, ordem, ${campos.join(', ')}, status_id)
          VALUES ($1, $2, ${campos.map((_, j) => `$${j + 3}`).join(', ')}, $${campos.length + 3}) RETURNING id`, [a.op.id, i + 1, ...valores, inicial.id]);
        await client.query(`INSERT INTO contratos_historico (contrato_id, operacao_id, status_novo_id, usuario_id, observacao, tipo)
          VALUES ($1, $2, $3, $4, 'Incluído na edição da proposta', 'status')`, [r.rows[0].id, a.op.id, inicial.id, req.user.id]);
        novos++;
        primeiroId = primeiroId || r.rows[0].id;
      }
    }
    if (alterados) resumo.unshift(`${alterados} contrato${alterados > 1 ? 's' : ''} alterado${alterados > 1 ? 's' : ''}`);
    if (novos) resumo.push(`${novos} incluído${novos > 1 ? 's' : ''}`);
    if (primeiroId) {
      await client.query(`INSERT INTO contratos_historico (contrato_id, operacao_id, usuario_id, observacao, tipo)
        VALUES ($1, $2, $3, $4, 'edicao')`, [primeiroId, a.op.id, req.user.id, 'Proposta editada' + (resumo.length ? ': ' + resumo.join(', ') : '')]);
    }
    await client.query('COMMIT');
    res.json({ id: a.op.id, codigo: ops.codigoOperacao(a.op.id), alterados, novos, removidos: removidos.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
