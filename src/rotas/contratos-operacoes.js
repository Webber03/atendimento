// Operações de contratos subidas a partir do lead (entrega 2).
// Uma operação = um envio do consultor (contrato único, só portabilidades ou
// portabilidades + refin da port). Cada contrato nasce no status inicial.
const express = require('express');
const { dbAll, dbGet, pool } = require('../../database');
const { requireAuth } = require('../../auth');
const { carregarLeadComAcesso } = require('../servicos/contratos-acesso');
const { FASES, TIPO_PORTABILIDADE, TIPO_REFIN_PORT } = require('../servicos/contratos-listas-padrao');

const router = express.Router();
const MAX_PORTABILIDADES = 30;
const TIPOS_VENDA = ['Padrão', 'Digital', 'Híbrida'];

const codigoOperacao = id => 'OP-' + String(id).padStart(6, '0');

// "R$ 1.234,56" | "1234.56" | 1234.56 -> 1234.56 ; vazio -> null ; inválido -> NaN
function lerValor(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v).replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function lerInteiro(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).trim());
  return Number.isInteger(n) ? n : NaN;
}

// "2026-11-25" ou "25/11/2026" -> "2026-11-25"
function lerData(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}

const texto = (v, max) => {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const normalizarNumeroContrato = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function carregarListas() {
  const itens = await dbAll('SELECT id, lista, nome, ativo FROM contratos_listas');
  const porId = new Map(itens.map(i => [i.id, i]));
  const tipoPorNome = nome => itens.find(i => i.lista === 'tipo' && i.nome === nome);
  return { porId, tipoPorNome };
}

// GET /api/contratos/digitadores — quem pode constar como digitador
router.get('/api/contratos/digitadores', requireAuth, async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT id, COALESCE(NULLIF(TRIM(name), ''), username) AS nome, role
      FROM users
      WHERE active = TRUE AND role IN ('closer', 'supervisor', 'admin', 'operacional')
      ORDER BY 2`);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/leads/:id/contratos — operações do cliente do lead + se pode subir nova
router.get('/api/crm/leads/:id/contratos', requireAuth, async (req, res) => {
  try {
    const acesso = await carregarLeadComAcesso(req.user, req.params.id);
    if (!acesso.lead) return res.status(404).json({ error: acesso.motivo });
    if (!acesso.podeVer) return res.status(403).json({ error: acesso.motivo });

    const operacoes = await dbAll(`
      SELECT o.id, o.formato, o.created_at, o.observacao, o.tipo_venda, o.proposta_banco_em,
             p.nome AS produto, pa.nome AS parceiro,
             COALESCE(NULLIF(TRIM(ud.name), ''), ud.username) AS digitador,
             COALESCE(NULLIF(TRIM(uc.name), ''), uc.username) AS criado_por
      FROM contratos_operacoes o
      LEFT JOIN contratos_listas p ON p.id = o.produto_id
      LEFT JOIN contratos_listas pa ON pa.id = o.parceiro_id
      LEFT JOIN users ud ON ud.id = o.digitador_id
      LEFT JOIN users uc ON uc.id = o.criado_por
      WHERE o.cliente_id = ?
      ORDER BY o.created_at DESC, o.id DESC`, [acesso.lead.cliente_id]);

    const ids = operacoes.map(o => o.id);
    const contratos = ids.length ? await dbAll(`
      SELECT c.id, c.operacao_id, c.ordem, c.numero_contrato, c.parcela, c.prazo_restante, c.saldo_devedor,
             c.prazo, c.taxa, c.valor_liberado, c.numero_proposta, c.status_em,
             t.nome AS tipo, b.nome AS banco, tb.nome AS tabela,
             s.id AS status_id, s.nome AS status, s.fase
      FROM contratos c
      LEFT JOIN contratos_listas t ON t.id = c.tipo_id
      LEFT JOIN contratos_listas b ON b.id = c.banco_id
      LEFT JOIN contratos_listas tb ON tb.id = c.tabela_id
      JOIN contratos_status s ON s.id = c.status_id
      WHERE c.operacao_id = ANY(?::int[])
      ORDER BY c.operacao_id, c.ordem, c.id`, [ids]) : [];

    res.json({
      pode_criar: acesso.podeCriar,
      motivo: acesso.motivo,
      fases: FASES,
      operacoes: operacoes.map(o => ({
        ...o,
        codigo: codigoOperacao(o.id),
        contratos: contratos.filter(c => c.operacao_id === o.id)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Valida o corpo e devolve { erros: [...], linhas: [...contratos a gravar] }
function validarOperacao(body, listas) {
  const erros = [];
  const erro = (campo, mensagem) => erros.push({ campo, mensagem });
  const item = (id, lista) => {
    const i = listas.porId.get(Number(id));
    return i && i.lista === lista && i.ativo ? i : null;
  };

  const formato = body.formato;
  if (!['unico', 'portabilidades', 'port_refin'].includes(formato)) {
    erro('formato', 'Escolha o tipo de operação.');
    return { erros, linhas: [] };
  }
  if (!item(body.produto_id, 'produto')) erro('produto_id', 'Escolha o produto.');
  if (body.tipo_venda && !TIPOS_VENDA.includes(body.tipo_venda)) erro('tipo_venda', 'Tipo de venda inválido.');
  if (!Number.isInteger(Number(body.digitador_id)) || !Number(body.digitador_id)) erro('digitador_id', 'Escolha o digitador responsável.');
  if (body.proposta_banco_em && lerData(body.proposta_banco_em) === undefined) erro('proposta_banco_em', 'Data da proposta no banco inválida (use dd/mm/aaaa).');

  const linhas = [];
  const tabelaOk = (v, campo) => { const t = item(v, 'tabela'); if (!t) erro(campo, 'Escolha a tabela.'); return t; };
  const valorObrig = (v, campo, nome) => {
    const n = lerValor(v);
    if (n === null) erro(campo, `Informe ${nome}.`);
    else if (Number.isNaN(n) || n <= 0) erro(campo, `${nome[0].toUpperCase() + nome.slice(1)} inválido.`);
    return Number.isFinite(n) ? n : null;
  };
  const valorOpc = (v, campo, nome) => {
    const n = lerValor(v);
    if (Number.isNaN(n) || (n !== null && n < 0)) { erro(campo, `${nome} inválido.`); return null; }
    return n;
  };
  const inteiroObrig = (v, campo, nome) => {
    const n = lerInteiro(v);
    if (n === null) erro(campo, `Informe ${nome}.`);
    else if (Number.isNaN(n) || n <= 0 || n > 420) erro(campo, `${nome[0].toUpperCase() + nome.slice(1)} inválido.`);
    return Number.isInteger(n) ? n : null;
  };
  const inteiroOpc = (v, campo, nome) => {
    const n = lerInteiro(v);
    if (Number.isNaN(n) || (n !== null && (n <= 0 || n > 420))) { erro(campo, `${nome} inválido.`); return null; }
    return n;
  };

  const portabilidade = (p, prefixo) => {
    const banco = item(p.banco_id, 'banco');
    if (!banco) erro(`${prefixo}.banco_id`, 'Escolha o banco de origem da lista.');
    const numero = texto(p.numero_contrato, 60);
    if (!numero) erro(`${prefixo}.numero_contrato`, 'Informe o nº do contrato portado.');
    return {
      banco_id: banco ? banco.id : null,
      numero_contrato: numero,
      parcela: valorObrig(p.parcela, `${prefixo}.parcela`, 'a parcela'),
      prazo_restante: inteiroObrig(p.prazo_restante, `${prefixo}.prazo_restante`, 'o prazo restante'),
      saldo_devedor: valorObrig(p.saldo_devedor, `${prefixo}.saldo_devedor`, 'o saldo devedor')
    };
  };

  const novoContrato = (c, prefixo) => ({
    banco_id: (() => { const b = item(c.banco_id, 'banco'); if (!b) erro(`${prefixo}.banco_id`, 'Escolha o banco da lista.'); return b ? b.id : null; })(),
    tabela_id: (() => { const t = tabelaOk(c.tabela_id, `${prefixo}.tabela_id`); return t ? t.id : null; })(),
    prazo: inteiroObrig(c.prazo, `${prefixo}.prazo`, 'o prazo'),
    parcela: valorOpc(c.parcela, `${prefixo}.parcela`, 'Parcela'),
    taxa: valorOpc(c.taxa, `${prefixo}.taxa`, 'Taxa'),
    valor_liberado: valorObrig(c.valor_liberado, `${prefixo}.valor_liberado`, 'o valor liberado'),
    numero_proposta: texto(c.numero_proposta, 60)
  });

  const tipoPort = listas.tipoPorNome(TIPO_PORTABILIDADE);
  const tipoRefin = listas.tipoPorNome(TIPO_REFIN_PORT);

  if (formato === 'unico') {
    const c = body.contrato || {};
    const tipo = item(c.tipo_id, 'tipo');
    if (!tipo) erro('contrato.tipo_id', 'Escolha o tipo do contrato.');
    else if (tipo.nome === TIPO_REFIN_PORT) erro('contrato.tipo_id', 'Refin da port é subido em “Portabilidades + refin da port”.');
    if (tipo && tipo.nome === TIPO_PORTABILIDADE) {
      linhas.push({ tipo_id: tipo.id, ...portabilidade(c, 'contrato'), numero_proposta: texto(c.numero_proposta, 60) });
    } else {
      linhas.push({ tipo_id: tipo ? tipo.id : null, ...novoContrato(c, 'contrato') });
    }
  } else {
    if (!tipoPort || (formato === 'port_refin' && !tipoRefin)) {
      erro('formato', 'Os tipos PORTABILIDADE e REFIN-PORTABILIDADE precisam existir em Contratos › Listas.');
      return { erros, linhas: [] };
    }
    const ports = Array.isArray(body.portabilidades) ? body.portabilidades : [];
    const minimo = formato === 'portabilidades' ? 2 : 1;
    if (ports.length < minimo) {
      erro('portabilidades', formato === 'portabilidades'
        ? 'Informe pelo menos 2 portabilidades. Uma portabilidade sozinha é “Contrato único”.'
        : 'Informe pelo menos 1 portabilidade.');
    }
    if (ports.length > MAX_PORTABILIDADES) erro('portabilidades', `Limite de ${MAX_PORTABILIDADES} portabilidades por operação.`);
    const vistos = new Map();
    ports.slice(0, MAX_PORTABILIDADES).forEach((p, i) => {
      const linha = portabilidade(p || {}, `portabilidades.${i}`);
      const chave = normalizarNumeroContrato(linha.numero_contrato);
      if (chave) {
        if (vistos.has(chave)) erro(`portabilidades.${i}.numero_contrato`, `Este nº de contrato já está na linha ${vistos.get(chave) + 1}.`);
        else vistos.set(chave, i);
      }
      linhas.push({ tipo_id: tipoPort.id, ...linha });
    });
    if (formato === 'port_refin') {
      linhas.push({ tipo_id: tipoRefin.id, ...novoContrato(body.refin || {}, 'refin') });
    }
  }
  return { erros, linhas };
}

// POST /api/crm/leads/:id/operacoes — sobe uma operação inteira de uma vez
router.post('/api/crm/leads/:id/operacoes', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const acesso = await carregarLeadComAcesso(req.user, req.params.id);
    if (!acesso.lead) return res.status(404).json({ error: acesso.motivo });
    if (!acesso.podeCriar) return res.status(403).json({ error: acesso.motivo });
    const lead = acesso.lead;

    const listas = await carregarListas();
    const { erros, linhas } = validarOperacao(req.body || {}, listas);

    const digitador = await dbGet(
      "SELECT id FROM users WHERE id = ? AND active = TRUE AND role IN ('closer', 'supervisor', 'admin', 'operacional')",
      [Number(req.body.digitador_id) || 0]
    );
    if (req.body.digitador_id && !digitador && !erros.some(e => e.campo === 'digitador_id')) {
      erros.push({ campo: 'digitador_id', mensagem: 'Digitador não encontrado ou inativo.' });
    }
    if (erros.length) {
      return res.status(400).json({ error: erros.length === 1 ? erros[0].mensagem : `${erros.length} campos para corrigir.`, erros });
    }

    const inicial = await dbGet('SELECT id, nome FROM contratos_status WHERE inicial = TRUE LIMIT 1');
    if (!inicial) return res.status(500).json({ error: 'Status inicial não configurado em Contratos › Listas.' });
    const lf = await dbGet("SELECT id FROM contratos_listas WHERE lista = 'parceiro' AND nome = 'LF PROMOTORA' AND ativo = TRUE");
    const equipes = await dbGet(`
      SELECT (SELECT team_id FROM users WHERE id = ?) AS closer_team,
             (SELECT team_id FROM users WHERE id = ?) AS sdr_team`, [lead.closer_id || 0, lead.sdr_id || 0]);

    await client.query('BEGIN');
    const op = (await client.query(`
      INSERT INTO contratos_operacoes
        (cliente_id, lead_id, formato, produto_id, parceiro_id, tipo_venda, digitador_id, proposta_banco_em,
         observacao, closer_id, sdr_id, equipe_closer_id, equipe_sdr_id, criado_por)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`, [
      lead.cliente_id, lead.id, req.body.formato, Number(req.body.produto_id), lf ? lf.id : null,
      req.body.tipo_venda || 'Padrão', digitador.id, lerData(req.body.proposta_banco_em) || null,
      texto(req.body.observacao, 2000), lead.closer_id, lead.sdr_id,
      equipes ? equipes.closer_team : null, equipes ? equipes.sdr_team : null, req.user.id
    ])).rows[0];

    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      const c = (await client.query(`
        INSERT INTO contratos
          (operacao_id, ordem, tipo_id, banco_id, tabela_id, numero_contrato, parcela, prazo_restante,
           saldo_devedor, prazo, taxa, valor_liberado, numero_proposta, status_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`, [
        op.id, i + 1, l.tipo_id, l.banco_id, l.tabela_id || null, l.numero_contrato || null, l.parcela ?? null,
        l.prazo_restante ?? null, l.saldo_devedor ?? null, l.prazo ?? null, l.taxa ?? null,
        l.valor_liberado ?? null, l.numero_proposta || null, inicial.id
      ])).rows[0];
      await client.query(
        'INSERT INTO contratos_historico (contrato_id, operacao_id, status_novo_id, usuario_id, observacao) VALUES ($1, $2, $3, $4, $5)',
        [c.id, op.id, inicial.id, req.user.id, 'Operação criada']
      );
    }

    const codigo = codigoOperacao(op.id);
    await client.query(
      'INSERT INTO crm_kanban_historico (lead_id, usuario_id, observacao) VALUES ($1, $2, $3)',
      [lead.id, req.user.id, `Operação ${codigo} subida com ${linhas.length} contrato${linhas.length > 1 ? 's' : ''} em ${inicial.nome}`]
    );
    await client.query('COMMIT');
    res.status(201).json({ id: op.id, codigo, contratos: linhas.length, status: inicial.nome });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports.validarOperacao = validarOperacao;
module.exports.lerValor = lerValor;
