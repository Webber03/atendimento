// Tabelas do módulo Contratos (entrega 1: listas e status).
// Só cria o que não existe e só preenche listas vazias: nada do que já existe é alterado.
const padrao = require('./contratos-listas-padrao');
const { normalizarNome } = require('../utils/normalizar-nome');

const LISTAS = ['banco', 'produto', 'tabela', 'tipo', 'parceiro'];
const FASES_CHAVES = padrao.FASES.map(f => f.chave);

async function createContratosSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contratos_listas (
      id SERIAL PRIMARY KEY,
      lista VARCHAR(20) NOT NULL CHECK (lista IN (${LISTAS.map(l => `'${l}'`).join(', ')})),
      nome VARCHAR(120) NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (lista, nome)
    )
  `);

  // "Nomes nos documentos": como cada banco aparece no espelho/contracheque
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contratos_bancos_nomes (
      id SERIAL PRIMARY KEY,
      banco_id INTEGER NOT NULL REFERENCES contratos_listas(id) ON DELETE CASCADE,
      nome VARCHAR(160) NOT NULL,
      nome_norm VARCHAR(160) NOT NULL UNIQUE,
      origem VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (origem IN ('padrao', 'manual', 'aprendido')),
      usuario_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contratos_status (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(80) NOT NULL UNIQUE,
      fase VARCHAR(30) NOT NULL CHECK (fase IN (${FASES_CHAVES.map(f => `'${f}'`).join(', ')})),
      ordem INTEGER NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      inicial BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Atalhos: os status mais usados a partir de cada status (não limitam nada)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contratos_status_atalhos (
      status_id INTEGER NOT NULL REFERENCES contratos_status(id) ON DELETE CASCADE,
      destino_id INTEGER NOT NULL REFERENCES contratos_status(id) ON DELETE CASCADE,
      PRIMARY KEY (status_id, destino_id)
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_contratos_listas_lista ON contratos_listas(lista)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_contratos_bancos_nomes_banco ON contratos_bancos_nomes(banco_id)');

  await preencherListasVazias(pool);
  await createOperacoesSchema(pool);
}

// Entrega 2: operações (o que o consultor sobe de uma vez) e seus contratos.
// Equipes do closer e do SDR são gravadas na digitação (filial = equipe) para o dash futuro.
async function createOperacoesSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contratos_operacoes (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES crm_clientes(id) ON DELETE RESTRICT,
      lead_id INTEGER REFERENCES crm_kanban_leads(id) ON DELETE SET NULL,
      formato VARCHAR(20) NOT NULL CHECK (formato IN ('unico', 'portabilidades', 'port_refin')),
      produto_id INTEGER REFERENCES contratos_listas(id),
      parceiro_id INTEGER REFERENCES contratos_listas(id),
      tipo_venda VARCHAR(20),
      digitador_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      proposta_banco_em DATE,
      observacao TEXT,
      closer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      sdr_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      equipe_closer_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      equipe_sdr_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contratos (
      id SERIAL PRIMARY KEY,
      operacao_id INTEGER NOT NULL REFERENCES contratos_operacoes(id) ON DELETE CASCADE,
      ordem INTEGER NOT NULL DEFAULT 1,
      tipo_id INTEGER REFERENCES contratos_listas(id),
      banco_id INTEGER REFERENCES contratos_listas(id),
      tabela_id INTEGER REFERENCES contratos_listas(id),
      numero_contrato VARCHAR(60),
      parcela NUMERIC(12, 2),
      prazo_restante INTEGER,
      saldo_devedor NUMERIC(14, 2),
      prazo INTEGER,
      taxa NUMERIC(7, 3),
      valor_liberado NUMERIC(14, 2),
      numero_proposta VARCHAR(60),
      status_id INTEGER NOT NULL REFERENCES contratos_status(id),
      status_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contratos_historico (
      id SERIAL PRIMARY KEY,
      contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
      operacao_id INTEGER NOT NULL REFERENCES contratos_operacoes(id) ON DELETE CASCADE,
      status_anterior_id INTEGER REFERENCES contratos_status(id),
      status_novo_id INTEGER REFERENCES contratos_status(id),
      usuario_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      observacao TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_contratos_op_cliente ON contratos_operacoes(cliente_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_contratos_op_lead ON contratos_operacoes(lead_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_contratos_op_created ON contratos_operacoes(created_at)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_contratos_operacao ON contratos(operacao_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_contratos_status ON contratos(status_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_contratos_hist_contrato ON contratos_historico(contrato_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_contratos_hist_operacao ON contratos_historico(operacao_id)');
}

async function listaVazia(pool, sql, params = []) {
  const r = await pool.query(sql, params);
  return parseInt(r.rows[0].total, 10) === 0;
}

async function preencherListasVazias(pool) {
  const iniciais = {
    banco: padrao.BANCOS,
    produto: padrao.PRODUTOS,
    tabela: padrao.TABELAS,
    tipo: padrao.TIPOS,
    parceiro: padrao.PARCEIROS
  };

  for (const lista of LISTAS) {
    if (await listaVazia(pool, 'SELECT COUNT(*) AS total FROM contratos_listas WHERE lista = $1', [lista])) {
      for (const nome of iniciais[lista]) {
        await pool.query(
          'INSERT INTO contratos_listas (lista, nome) VALUES ($1, $2) ON CONFLICT (lista, nome) DO NOTHING',
          [lista, nome]
        );
      }
      console.log(`Contratos: lista "${lista}" preenchida com ${iniciais[lista].length} itens.`);
    }
  }

  if (await listaVazia(pool, 'SELECT COUNT(*) AS total FROM contratos_bancos_nomes')) {
    for (const [banco, nomes] of Object.entries(padrao.NOMES_NOS_DOCUMENTOS)) {
      const b = await pool.query("SELECT id FROM contratos_listas WHERE lista = 'banco' AND nome = $1", [banco]);
      if (!b.rows[0]) continue;
      for (const nome of nomes) {
        await pool.query(
          `INSERT INTO contratos_bancos_nomes (banco_id, nome, nome_norm, origem)
           VALUES ($1, $2, $3, 'padrao') ON CONFLICT (nome_norm) DO NOTHING`,
          [b.rows[0].id, nome, normalizarNome(nome)]
        );
      }
    }
  }

  if (await listaVazia(pool, 'SELECT COUNT(*) AS total FROM contratos_status')) {
    const ids = [];
    for (let i = 0; i < padrao.STATUS.length; i++) {
      const [nome, fase] = padrao.STATUS[i];
      const r = await pool.query(
        `INSERT INTO contratos_status (nome, fase, ordem, inicial)
         VALUES ($1, $2, $3, $4) ON CONFLICT (nome) DO NOTHING RETURNING id`,
        [nome, fase, (i + 1) * 10, nome === padrao.STATUS_INICIAL]
      );
      ids.push(r.rows[0] ? r.rows[0].id : null);
    }
    // Atalho padrão: o próximo status da esteira (editável depois na tela)
    const finais = new Set(['PAGO', 'CANCELADO']);
    for (let i = 0; i < ids.length - 1; i++) {
      const origem = padrao.STATUS[i][0];
      const destino = padrao.STATUS[i + 1][0];
      if (finais.has(origem) || destino === 'CANCELADO' || !ids[i] || !ids[i + 1]) continue;
      await pool.query(
        'INSERT INTO contratos_status_atalhos (status_id, destino_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [ids[i], ids[i + 1]]
      );
    }
    console.log(`Contratos: ${padrao.STATUS.length} status em ${padrao.FASES.length} fases criados.`);
  }
}

module.exports = { createContratosSchema, LISTAS, FASES_CHAVES };
