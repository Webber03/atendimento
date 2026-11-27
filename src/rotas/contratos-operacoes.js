// Operações de contratos subidas a partir do lead (entrega 2).
// Uma operação = um envio do consultor (contrato único, só portabilidades ou
// portabilidades + refin da port). Cada contrato nasce no status inicial.
const express = require('express');
const { dbAll, dbGet, pool } = require('../../database');
const { requireAuth } = require('../../auth');
const { carregarLeadComAcesso, permissoesOperacao } = require('../servicos/contratos-acesso');
const { FASES, TIPO_PORTABILIDADE, TIPO_REFIN_PORT } = require('../servicos/contratos-listas-padrao');
const { aprenderNomes } = require('../servicos/contratos-bancos');

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

// Dados do cliente pedidos na digitação (ficam no cadastro do cliente e são reaproveitados)
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
function validarCliente(body) {
  const erros = [];
  const nasc = lerData(body.data_nascimento);
  if (!body.data_nascimento) erros.push({ campo: 'data_nascimento', mensagem: 'Informe a data de nascimento.' });
  else if (!nasc) erros.push({ campo: 'data_nascimento', mensagem: 'Data de nascimento inválida.' });
  else {
    const anos = (Date.now() - new Date(nasc + 'T12:00:00').getTime()) / (365.25 * 86400000);
    if (anos < 16 || anos > 110) erros.push({ campo: 'data_nascimento', mensagem: 'Confira a data de nascimento.' });
  }
  const cep = String(body.cep || '').replace(/\D/g, '');
  if (!cep) erros.push({ campo: 'cep', mensagem: 'Informe o CEP.' });
  else if (cep.length !== 8) erros.push({ campo: 'cep', mensagem: 'O CEP tem 8 números.' });
  const endereco = texto(body.endereco, 200);
  if (!endereco) erros.push({ campo: 'endereco', mensagem: 'Informe o endereço.' });
  const cidade = texto(body.cidade, 120);
  if (!cidade) erros.push({ campo: 'cidade', mensagem: 'Informe a cidade.' });
  const uf = String(body.uf || '').trim().toUpperCase();
  if (!UFS.includes(uf)) erros.push({ campo: 'uf', mensagem: 'Escolha o estado.' });
  return { erros, valores: { data_nascimento: nasc, cep: cep ? cep.slice(0, 5) + '-' + cep.slice(5) : null, endereco, cidade, uf } };
}

async function validarCanal(canalId) {
  const id = Number(canalId) || 0;
  if (!id) return { erro: { campo: 'canal_venda_id', mensagem: 'Escolha o canal de venda.' } };
  const c = await dbGet('SELECT id FROM channels WHERE id = ? AND (active IS NULL OR active = 1)', [id]);
  return c ? { id: c.id } : { erro: { campo: 'canal_venda_id', mensagem: 'Canal de venda não encontrado ou inativo.' } };
}

// GET /api/crm/leads/:id/cliente-operacao — o que a digitação já sabe do cliente (do kanban)
router.get('/api/crm/leads/:id/cliente-operacao', requireAuth, async (req, res) => {
  try {
    const acesso = await carregarLeadComAcesso(req.user, req.params.id);
    if (!acesso.lead) return res.status(404).json({ error: acesso.motivo });
    if (!acesso.podeVer) return res.status(403).json({ error: acesso.motivo });
    const cliente = await dbGet(`SELECT id, nome, cpf, telefone, data_nascimento, cep, endereco, cidade, uf,
      banco, agencia, conta, canal_venda_id FROM crm_clientes WHERE id = ?`, [acesso.lead.cliente_id]);
    const canais = await dbAll('SELECT id, name AS nome FROM channels WHERE active IS NULL OR active = 1 ORDER BY name');
    // Mesmo canal que o card do kanban mostra: o do lead, senão o do cliente, senão DISCADORA (lead da discadora)
    const lead = await dbGet('SELECT canal_venda_id, discadora_login FROM crm_kanban_leads WHERE id = ?', [acesso.lead.id]);
    let canalId = (lead && lead.canal_venda_id) || cliente.canal_venda_id || null;
    if (!canalId && lead && lead.discadora_login) {
      const d = canais.find(c => String(c.nome).trim().toUpperCase() === 'DISCADORA');
      if (d) canalId = d.id;
    }
    if (canalId && !canais.some(c => c.id === canalId)) canalId = null; // canal inativo: deixa escolher
    cliente.canal_venda_id = canalId;
    res.json({ cliente, canais });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
             o.closer_id, o.sdr_id, o.equipe_closer_id, o.equipe_sdr_id,
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
             s.id AS status_id, s.nome AS status, s.cor AS status_cor, s.fase, s.inicial
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
      operacoes: await Promise.all(operacoes.map(async o => {
        const cs = contratos.filter(c => c.operacao_id === o.id);
        const perm = await permissoesOperacao(req.user, o, cs.length > 0 && cs.every(c => c.inicial));
        const { closer_id, sdr_id, equipe_closer_id, equipe_sdr_id, ...resto } = o;
        return { ...resto, codigo: codigoOperacao(o.id), contratos: cs, pode_mover: perm.podeMover, pode_editar: perm.podeEditar };
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
    // Todo empréstimo tem parcela (no refin da port, o espelho traz a soma das parcelas originais)
    parcela: valorObrig(c.parcela, `${prefixo}.parcela`, 'a parcela'),
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
    const cli = validarCliente(req.body);
    erros.push(...cli.erros);
    const canal = await validarCanal(req.body.canal_venda_id);
    if (canal.erro) erros.push(canal.erro);
    if (erros.length) {
      return res.status(400).json({ error: erros.length === 1 ? erros[0].mensagem : `${erros.length} campos para corrigir.`, erros });
    }

    const inicial = await dbGet('SELECT id, nome FROM contratos_status WHERE inicial = TRUE LIMIT 1');
    if (!inicial) return res.status(500).json({ error: 'Status inicial não configurado em Contratos › Listas.' });
    const equipes = await dbGet(`
      SELECT (SELECT team_id FROM users WHERE id = ?) AS closer_team,
             (SELECT team_id FROM users WHERE id = ?) AS sdr_team`, [lead.closer_id || 0, lead.sdr_id || 0]);

    await client.query('BEGIN');
    const op = (await client.query(`
      INSERT INTO contratos_operacoes
        (cliente_id, lead_id, formato, produto_id, parceiro_id, tipo_venda, digitador_id, proposta_banco_em,
         observacao, closer_id, sdr_id, equipe_closer_id, equipe_sdr_id, criado_por,
         matricula, orgao, cargo, situacao_funcional, canal_venda_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`, [
      lead.cliente_id, lead.id, req.body.formato, Number(req.body.produto_id), null, // parceiro: em branco; Operacional/Admin definem depois
      req.body.tipo_venda || 'Padrão', digitador.id, lerData(req.body.proposta_banco_em) || null,
      texto(req.body.observacao, 2000), lead.closer_id, lead.sdr_id,
      equipes ? equipes.closer_team : null, equipes ? equipes.sdr_team : null, req.user.id,
      texto(req.body.matricula, 40), texto(req.body.orgao, 120), texto(req.body.cargo, 120), texto(req.body.situacao_funcional, 80),
      canal.id
    ])).rows[0];
    await client.query(`UPDATE crm_clientes SET data_nascimento = $1, cep = $2, endereco = $3, cidade = $4, uf = $5,
      updated_at = CURRENT_TIMESTAMP WHERE id = $6`,
      [cli.valores.data_nascimento, cli.valores.cep, cli.valores.endereco, cli.valores.cidade, cli.valores.uf, lead.cliente_id]);

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
    // Nomes de banco do espelho que o consultor teve de escolher: ficam guardados para a próxima leitura
    const aprender = [];
    (req.body.portabilidades || []).forEach(p => { if (p && p.banco_nome_doc && p.banco_id) aprender.push({ nomeDoc: p.banco_nome_doc, bancoId: Number(p.banco_id) }); });
    if (req.body.refin && req.body.refin.banco_nome_doc && req.body.refin.banco_id) aprender.push({ nomeDoc: req.body.refin.banco_nome_doc, bancoId: Number(req.body.refin.banco_id) });
    const aprendidos = aprender.length ? await aprenderNomes(aprender, req.user.id) : 0;
    res.status(201).json({ id: op.id, codigo, contratos: linhas.length, status: inicial.nome, nomes_aprendidos: aprendidos });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Operação avulsa (Propostas digitadas): cliente cadastrado na hora, sem lead.
// Closer sobe só no próprio nome; Operacional e Admin escolhem o consultor;
// supervisor escolhe entre os closers da equipe dele.
// ---------------------------------------------------------------------------
const PAPEIS_AVULSA = ['closer', 'supervisor', 'admin', 'operacional'];

async function consultoresPermitidos(user) {
  if (user.role === 'closer') {
    return dbAll("SELECT id, COALESCE(NULLIF(TRIM(name), ''), username) AS nome FROM users WHERE id = ? AND active = TRUE", [user.id]);
  }
  if (user.role === 'supervisor') {
    const u = await dbGet('SELECT team_id FROM users WHERE id = ?', [user.id]);
    const eq = (u && u.team_id) || null;
    if (!eq) return [];
    return dbAll("SELECT id, COALESCE(NULLIF(TRIM(name), ''), username) AS nome FROM users WHERE active = TRUE AND role = 'closer' AND team_id = ? ORDER BY 2", [eq]);
  }
  if (user.role === 'admin' || user.role === 'operacional') {
    return dbAll("SELECT id, COALESCE(NULLIF(TRIM(name), ''), username) AS nome FROM users WHERE active = TRUE AND role = 'closer' ORDER BY 2");
  }
  return [];
}

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += Number(cpf[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

// GET /api/contratos/avulsa/consultores — quem pode constar como consultor na subida avulsa
router.get('/api/contratos/avulsa/consultores', requireAuth, async (req, res) => {
  try {
    if (!PAPEIS_AVULSA.includes(req.user.role)) return res.status(403).json({ error: 'Sem permissão para subir contratos.' });
    res.json({ fixo: req.user.role === 'closer', consultores: await consultoresPermitidos(req.user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contratos/avulsa/cliente?cpf= — se o CPF já tem cadastro, devolve para preencher
router.get('/api/contratos/avulsa/cliente', requireAuth, async (req, res) => {
  try {
    if (!PAPEIS_AVULSA.includes(req.user.role)) return res.status(403).json({ error: 'Sem permissão.' });
    const cpf = String(req.query.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) return res.json({ cliente: null });
    const c = await dbGet(`SELECT id, nome, telefone, data_nascimento, cep, endereco, cidade, uf, banco, agencia, conta
      FROM crm_clientes WHERE REGEXP_REPLACE(COALESCE(cpf, ''), '\\D', '', 'g') = ? LIMIT 1`, [cpf]);
    res.json({ cliente: c || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/contratos/operacoes/avulsa
router.post('/api/contratos/operacoes/avulsa', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!PAPEIS_AVULSA.includes(req.user.role)) return res.status(403).json({ error: 'Sem permissão para subir contratos.' });
    const body = req.body || {};
    const ca = body.cliente_avulso || {};
    const listas = await carregarListas();
    const { erros, linhas } = validarOperacao(body, listas);

    const nome = texto(ca.nome, 255);
    if (!nome) erros.push({ campo: 'avulsa.nome', mensagem: 'Informe o nome do cliente.' });
    const cpf = String(ca.cpf || '').replace(/\D/g, '');
    if (!cpf) erros.push({ campo: 'avulsa.cpf', mensagem: 'Informe o CPF.' });
    else if (!cpfValido(cpf)) erros.push({ campo: 'avulsa.cpf', mensagem: 'CPF inválido.' });
    const telefone = texto(ca.telefone, 30);

    const permitidos = await consultoresPermitidos(req.user);
    const consultorId = req.user.role === 'closer' ? req.user.id : Number(body.consultor_id) || 0;
    const consultor = permitidos.find(u => u.id === consultorId);
    if (!consultor) erros.push({ campo: 'consultor_id', mensagem: req.user.role === 'closer' ? 'Seu usuário está inativo.' : 'Escolha o consultor.' });

    const digitador = await dbGet(
      "SELECT id FROM users WHERE id = ? AND active = TRUE AND role IN ('closer', 'supervisor', 'admin', 'operacional')",
      [Number(body.digitador_id) || 0]
    );
    if (body.digitador_id && !digitador && !erros.some(e => e.campo === 'digitador_id')) {
      erros.push({ campo: 'digitador_id', mensagem: 'Digitador não encontrado ou inativo.' });
    }
    const cli = validarCliente(body);
    erros.push(...cli.erros);
    const canal = await validarCanal(body.canal_venda_id);
    if (canal.erro) erros.push(canal.erro);
    if (erros.length) {
      return res.status(400).json({ error: erros.length === 1 ? erros[0].mensagem : `${erros.length} campos para corrigir.`, erros });
    }

    const inicial = await dbGet('SELECT id, nome FROM contratos_status WHERE inicial = TRUE LIMIT 1');
    if (!inicial) return res.status(500).json({ error: 'Status inicial não configurado em Contratos › Listas.' });
    const equipe = await dbGet('SELECT team_id FROM users WHERE id = ?', [consultor.id]);

    await client.query('BEGIN');
    // Cliente: CPF já cadastrado é reaproveitado (nome e dados bancários existentes não são trocados)
    const existente = (await client.query(
      "SELECT id, banco, agencia, conta FROM crm_clientes WHERE REGEXP_REPLACE(COALESCE(cpf, ''), '\\D', '', 'g') = $1 LIMIT 1 FOR UPDATE", [cpf])).rows[0];
    let clienteId;
    const banco = texto(ca.banco, 100); const agencia = texto(ca.agencia, 20); const conta = texto(ca.conta, 30);
    if (existente) {
      clienteId = existente.id;
      await client.query(`UPDATE crm_clientes SET data_nascimento = $1, cep = $2, endereco = $3, cidade = $4, uf = $5,
        telefone = COALESCE(telefone, $6),
        banco = COALESCE(NULLIF(banco, ''), $7), agencia = COALESCE(NULLIF(agencia, ''), $8), conta = COALESCE(NULLIF(conta, ''), $9),
        updated_at = CURRENT_TIMESTAMP WHERE id = $10`,
        [cli.valores.data_nascimento, cli.valores.cep, cli.valores.endereco, cli.valores.cidade, cli.valores.uf, telefone, banco, agencia, conta, clienteId]);
    } else {
      clienteId = (await client.query(`INSERT INTO crm_clientes (nome, cpf, telefone, data_nascimento, cep, endereco, cidade, uf, banco, agencia, conta)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [nome.toUpperCase(), cpf, telefone, cli.valores.data_nascimento, cli.valores.cep, cli.valores.endereco, cli.valores.cidade, cli.valores.uf, banco, agencia, conta])).rows[0].id;
    }

    const op = (await client.query(`
      INSERT INTO contratos_operacoes
        (cliente_id, lead_id, formato, produto_id, parceiro_id, tipo_venda, digitador_id, proposta_banco_em,
         observacao, closer_id, sdr_id, equipe_closer_id, equipe_sdr_id, criado_por,
         matricula, orgao, cargo, situacao_funcional, canal_venda_id)
      VALUES ($1, NULL, $2, $3, NULL, $4, $5, $6, $7, $8, NULL, $9, NULL, $10, $11, $12, $13, $14, $15) RETURNING id`, [
      clienteId, body.formato, Number(body.produto_id),
      body.tipo_venda || 'Padrão', digitador.id, lerData(body.proposta_banco_em) || null,
      texto(body.observacao, 2000), consultor.id, equipe ? equipe.team_id : null, req.user.id,
      texto(body.matricula, 40), texto(body.orgao, 120), texto(body.cargo, 120), texto(body.situacao_funcional, 80),
      canal.id
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
        [c.id, op.id, inicial.id, req.user.id, 'Operação criada (avulsa)']
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ id: op.id, codigo: codigoOperacao(op.id), contratos: linhas.length, status: inicial.nome, cliente_existente: !!existente });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
Object.assign(module.exports, { validarOperacao, validarCliente, validarCanal, lerValor, lerData, texto, codigoOperacao, carregarListas, TIPOS_VENDA });
