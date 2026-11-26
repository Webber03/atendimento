// Reconhece o banco a partir do nome que vem no documento e aprende nomes novos.
const { dbAll, dbRun } = require('../../database');
const { normalizarNome } = require('../utils/normalizar-nome');

// Mapa nome normalizado -> { id, nome } (nomes nos documentos + nome do próprio banco, só ativos)
async function carregarMapaBancos() {
  const bancos = await dbAll("SELECT id, nome FROM contratos_listas WHERE lista = 'banco' AND ativo = TRUE");
  const porId = new Map(bancos.map(b => [b.id, b]));
  const mapa = new Map();
  bancos.forEach(b => mapa.set(normalizarNome(b.nome), b));
  const apelidos = await dbAll('SELECT banco_id, nome_norm FROM contratos_bancos_nomes');
  apelidos.forEach(a => { const b = porId.get(a.banco_id); if (b) mapa.set(a.nome_norm, b); });
  return mapa;
}

// Variações do nome para tentar: "BANCO - DAYCOVAL" -> "DAYCOVAL"; "BRADESCO S/A - 120" -> "BRADESCO S A" -> "BRADESCO SA"
function variacoes(nome) {
  const base = normalizarNome(nome);
  const v = new Set([base]);
  const semCodigo = base.replace(/\s+\d{1,4}$/, '');
  v.add(semCodigo);
  [base, semCodigo].forEach(n => {
    v.add(n.replace(/\bS A\b/g, 'SA'));
    v.add(n.replace(/^BCO\s+/, 'BANCO '));
    const semPrefixo = n.replace(/^(BANCO|BCO)\s+/, '');
    v.add(semPrefixo);
    v.add(semPrefixo.replace(/\bS A\b/g, 'SA').replace(/\s+(SA|S A)$/, ''));
    v.add(n.replace(/\s+(SA|S A)$/, ''));
  });
  return [...v].filter(Boolean);
}

function resolverBanco(nomeDoc, mapa) {
  if (!nomeDoc) return null;
  for (const n of variacoes(nomeDoc)) {
    const b = mapa.get(n);
    if (b) return b;
  }
  return null;
}

// Guarda "nome no documento" -> banco escolhido pelo consultor (origem 'aprendido')
async function aprenderNomes(pares, usuarioId) {
  let novos = 0;
  for (const { nomeDoc, bancoId } of pares) {
    const nome = String(nomeDoc || '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 160);
    const norm = normalizarNome(nome);
    if (!norm || !bancoId) continue;
    const r = await dbRun(
      `INSERT INTO contratos_bancos_nomes (banco_id, nome, nome_norm, origem, usuario_id)
       SELECT ?, ?, ?, 'aprendido', ?
       WHERE NOT EXISTS (SELECT 1 FROM contratos_listas l WHERE l.lista = 'banco' AND l.id = ? AND UPPER(l.nome) = ?)
       ON CONFLICT (nome_norm) DO NOTHING`,
      [bancoId, nome, norm, usuarioId, bancoId, nome]
    ).catch(() => ({ changes: 0 }));
    novos += r.changes || 0;
  }
  return novos;
}

module.exports = { carregarMapaBancos, resolverBanco, aprenderNomes, variacoes };
