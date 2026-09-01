require('dotenv').config();
const { Pool } = require('pg');

function createPool() {
  const ssl = process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false;

  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL, ssl });
  }

  return new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl
  });
}

const pool = createPool();

function toPgQuery(query, params) {
  let index = 0;
  const pgQuery = query.replace(/\?/g, () => `$${++index}`);
  return [pgQuery, params];
}

function dbRun(query, params = []) {
  const [pgQuery, pgParams] = toPgQuery(query, params);
  const isInsert = /^\s*INSERT/i.test(query.trim());
  const finalQuery = isInsert && !/RETURNING/i.test(pgQuery)
    ? `${pgQuery} RETURNING id`
    : pgQuery;

  return pool.query(finalQuery, pgParams).then(result => ({
    lastID: result.rows[0]?.id,
    changes: result.rowCount
  }));
}

function dbGet(query, params = []) {
  const [pgQuery, pgParams] = toPgQuery(query, params);
  return pool.query(pgQuery, pgParams).then(result => result.rows[0] || null);
}

function dbAll(query, params = []) {
  const [pgQuery, pgParams] = toPgQuery(query, params);
  return pool.query(pgQuery, pgParams).then(result => result.rows);
}

async function resetTables() {
  await pool.query('DROP TABLE IF EXISTS lead_generation_distributions CASCADE');
  await pool.query('DROP TABLE IF EXISTS daily_records CASCADE');
  await pool.query('DROP TABLE IF EXISTS channels CASCADE');
  await pool.query('DROP TABLE IF EXISTS consultants CASCADE');
  await pool.query('DROP TABLE IF EXISTS teams CASCADE');
  await pool.query('DROP TABLE IF EXISTS systems CASCADE');
  await pool.query('DROP TABLE IF EXISTS convenios CASCADE');
  await pool.query('DROP TABLE IF EXISTS produtos CASCADE');
  await pool.query('DROP TABLE IF EXISTS lead_generations CASCADE');
  await pool.query('DROP TABLE IF EXISTS users CASCADE');
}

async function ensureLeadGenerationColumns() {
  const requiredColumns = [
    ['date', 'DATE'],
    ['channel_id', 'INTEGER'],
    ['system_id', 'INTEGER'],
    ['convenio_id', 'INTEGER'],
    ['produto_id', 'INTEGER'],
    ['prospectados', 'INTEGER NOT NULL DEFAULT 0'],
    ['aceites', 'INTEGER NOT NULL DEFAULT 0'],
    ['inviaveis', 'INTEGER NOT NULL DEFAULT 0'],
    ['investimento', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['fechamentos', 'INTEGER NOT NULL DEFAULT 0'],
    ['faturamento', 'DECIMAL(15,2) NOT NULL DEFAULT 0.00'],
    ['created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP']
  ];

  for (const [columnName, definition] of requiredColumns) {
    await pool.query(`
      ALTER TABLE lead_generations
      ADD COLUMN IF NOT EXISTS ${columnName} ${definition}
    `);
  }
}

async function ensureProgestorMappingColumns() {
  await pool.query(`
    ALTER TABLE consultants
    ADD COLUMN IF NOT EXISTS progestor_user VARCHAR(255)
  `);
  await pool.query(`
    ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS progestor_code VARCHAR(50)
  `);
}

async function createSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consultants (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      progestor_user VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      progestor_code VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_records (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      consultant_id INTEGER NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      leads_totais INTEGER NOT NULL DEFAULT 0,
      inviaveis INTEGER NOT NULL DEFAULT 0,
      fechados INTEGER NOT NULL DEFAULT 0,
      observacoes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, consultant_id, channel_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS systems (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS convenios (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_generations (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
      system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL,
      convenio_id INTEGER NOT NULL REFERENCES convenios(id),
      produto_id INTEGER NOT NULL REFERENCES produtos(id),
      prospectados INTEGER NOT NULL DEFAULT 0,
      aceites INTEGER NOT NULL DEFAULT 0,
      inviaveis INTEGER NOT NULL DEFAULT 0,
      investimento DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      fechamentos INTEGER NOT NULL DEFAULT 0,
      faturamento DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureLeadGenerationColumns();
  await ensureProgestorMappingColumns();

  // Create lead_generation_distributions table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_generation_distributions (
      id SERIAL PRIMARY KEY,
      lead_generation_id INTEGER NOT NULL REFERENCES lead_generations(id) ON DELETE CASCADE,
      consultant_id INTEGER NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
      leads_totais INTEGER NOT NULL DEFAULT 0,
      inviaveis INTEGER NOT NULL DEFAULT 0,
      fechados INTEGER NOT NULL DEFAULT 0,
      faturamento DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      UNIQUE(lead_generation_id, consultant_id)
    )
  `);

  await pool.query(`
    ALTER TABLE lead_generation_distributions
    ADD COLUMN IF NOT EXISTS faturamento DECIMAL(15,2) NOT NULL DEFAULT 0.00
  `);

  // Add lead_generation_id column to daily_records if it does not exist
  await pool.query(`
    ALTER TABLE daily_records
    ADD COLUMN IF NOT EXISTS lead_generation_id INTEGER REFERENCES lead_generations(id) ON DELETE CASCADE
  `);

  // Tabela de usuários do sistema (auth + RBAC)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'supervisor', 'leads', 'sdr', 'closer')),
      team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255)
  `);

  // Atualizar check constraint de perfis para permitir sdr e closer
  try {
    await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await pool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'supervisor', 'leads', 'sdr', 'closer'))`);
  } catch (err) {
    console.log('Aviso ao atualizar constraint de perfis (users_role_check):', err.message);
  }

  // Tabela de configurações globais
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key VARCHAR(255) PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await pool.query(`
    INSERT INTO system_settings (key, value) VALUES ('progestor_mapping_closed', '45') ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO system_settings (key, value) VALUES ('progestor_mapping_unviable', '33') ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO system_settings (key, value) VALUES ('progestor_tabulacoes_url', '') ON CONFLICT DO NOTHING
  `);

  // ==========================================
  // TABELAS DO MÓDULO CRM / KANBAN / DISCADORA
  // ==========================================

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_clientes (
      id SERIAL PRIMARY KEY,
      cpf VARCHAR(20),
      nome VARCHAR(255) NOT NULL,
      telefone VARCHAR(30),
      email VARCHAR(255),
      observacoes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migração: adicionar colunas para controle de arquivos no Google Drive
  await pool.query(`
    ALTER TABLE crm_clientes 
    ADD COLUMN IF NOT EXISTS drive_folder_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS doc_contracheque_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS doc_extrato_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS doc_identificacao_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS doc_residencia_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS doc_espelho_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS valor_contrato NUMERIC(15,2)
  `);

  // Popula valor_contrato com o valor da última tabulação se estiver nulo (sintaxe correta do PostgreSQL sem alias no UPDATE)
  await pool.query(`
    UPDATE crm_clientes 
    SET valor_contrato = (
      SELECT valor FROM crm_tabulacoes WHERE cliente_id = crm_clientes.id AND valor > 0 ORDER BY created_at DESC LIMIT 1
    )
    WHERE valor_contrato IS NULL OR valor_contrato = 0
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_tabulacoes (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER REFERENCES crm_clientes(id) ON DELETE CASCADE,
      consultor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      consultor_nome VARCHAR(255),
      tipo_tabulacao VARCHAR(100) NOT NULL,
      observacao TEXT,
      iniciou_kanban BOOLEAN DEFAULT FALSE,
      valor DECIMAL(10,2) DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE crm_tabulacoes ADD COLUMN IF NOT EXISTS valor DECIMAL(10,2) DEFAULT 0.00
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_kanban_estagios (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      pipeline_tipo VARCHAR(20) NOT NULL CHECK (pipeline_tipo IN ('sdr', 'closer')),
      cor VARCHAR(20) DEFAULT '#4F46E5',
      ordem INTEGER DEFAULT 1,
      ativo BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE crm_kanban_estagios ADD COLUMN IF NOT EXISTS motivos_perda TEXT;
  `);

  await pool.query(`
    ALTER TABLE crm_kanban_estagios ADD COLUMN IF NOT EXISTS exigir_obs BOOLEAN DEFAULT FALSE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_kanban_leads (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES crm_clientes(id) ON DELETE CASCADE,
      sdr_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      closer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      estagio_id INTEGER REFERENCES crm_kanban_estagios(id) ON DELETE SET NULL,
      status_atendimento VARCHAR(30) DEFAULT 'em_atendimento' CHECK (status_atendimento IN ('pendente_aceite', 'em_atendimento', 'concluido', 'perdido')),
      aceito_em TIMESTAMP,
      tempo_resposta_segundos INTEGER,
      discadora_login VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    ALTER TABLE crm_kanban_leads 
    ADD COLUMN IF NOT EXISTS transferido_closer_at TIMESTAMP
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_leads_perdas (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER REFERENCES crm_kanban_leads(id) ON DELETE CASCADE,
      cliente_id INTEGER REFERENCES crm_clientes(id) ON DELETE CASCADE,
      estagio_id INTEGER REFERENCES crm_kanban_estagios(id) ON DELETE SET NULL,
      estagio_nome VARCHAR(255) NOT NULL,
      motivo TEXT NOT NULL,
      observacao TEXT,
      usuario_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      usuario_nome VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_kanban_historico (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL REFERENCES crm_kanban_leads(id) ON DELETE CASCADE,
      estagio_anterior_id INTEGER REFERENCES crm_kanban_estagios(id) ON DELETE SET NULL,
      estagio_novo_id INTEGER REFERENCES crm_kanban_estagios(id) ON DELETE SET NULL,
      usuario_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      observacao TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_fila_closers (
      id SERIAL PRIMARY KEY,
      closer_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peso INTEGER DEFAULT 1,
      ativo BOOLEAN DEFAULT TRUE,
      ordem INTEGER DEFAULT 1,
      ultima_atribuicao_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_discadora_mapeamentos (
      id SERIAL PRIMARY KEY,
      discadora_login VARCHAR(100) UNIQUE NOT NULL,
      crm_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Popular estágios padrão do Kanban se estiverem vazios
  const estagiosCount = await pool.query('SELECT COUNT(*) as total FROM crm_kanban_estagios');
  if (parseInt(estagiosCount.rows[0].total, 10) === 0) {
    // SDR stages (conforme print enviado)
    await pool.query(`INSERT INTO crm_kanban_estagios (nome, pipeline_tipo, cor, ordem, motivos_perda) VALUES ('CONTATO INICIAL', 'sdr', '#6366F1', 1, 'Caixa Postal, Sem Telefone, Cliente não atende')`);
    await pool.query(`INSERT INTO crm_kanban_estagios (nome, pipeline_tipo, cor, ordem, motivos_perda) VALUES ('NEGOCIAÇÃO', 'sdr', '#10B981', 2, 'Sem Margem, Não tem interesse, Condições comerciais')`);
    await pool.query(`INSERT INTO crm_kanban_estagios (nome, pipeline_tipo, cor, ordem, motivos_perda) VALUES ('ABERTURA DE CONTA', 'sdr', '#EAB308', 3, 'Desistência, Documentação inválida, Outros')`);

    // Closer stages (conforme print enviado)
    await pool.query(`INSERT INTO crm_kanban_estagios (nome, pipeline_tipo, cor, ordem, motivos_perda) VALUES ('DED', 'closer', '#3B82F6', 1, 'Sem Margem, Fora do perfil, Sem interesse')`);
    await pool.query(`INSERT INTO crm_kanban_estagios (nome, pipeline_tipo, cor, ordem, motivos_perda) VALUES ('CONSULTORIA', 'closer', '#EC4899', 2, 'Desistência, Sem margem, Não atendeu consultoria')`);
    await pool.query(`INSERT INTO crm_kanban_estagios (nome, pipeline_tipo, cor, ordem, motivos_perda) VALUES ('PROPOSTA SISTEMA', 'closer', '#84CC16', 3, 'Proposta recusada, Margem estourada, Desistência')`);
  } else {
    // Migrar cor antiga de 'ABERTURA DE CONTA' para o novo dourado/amarelo premium mais integrado
    await pool.query(`UPDATE crm_kanban_estagios SET cor = '#EAB308' WHERE cor = '#F59E0B'`);
    
    // Migrar/definir motivos de perda padrões para os estágios padrões existentes que estejam sem motivos
    await pool.query(`UPDATE crm_kanban_estagios SET motivos_perda = 'Caixa Postal, Sem Telefone, Cliente não atende' WHERE nome = 'CONTATO INICIAL' AND motivos_perda IS NULL`);
    await pool.query(`UPDATE crm_kanban_estagios SET motivos_perda = 'Sem Margem, Não tem interesse, Condições comerciais' WHERE nome = 'NEGOCIAÇÃO' AND motivos_perda IS NULL`);
    await pool.query(`UPDATE crm_kanban_estagios SET motivos_perda = 'Desistência, Documentação inválida, Outros' WHERE nome = 'ABERTURA DE CONTA' AND motivos_perda IS NULL`);
    await pool.query(`UPDATE crm_kanban_estagios SET motivos_perda = 'Sem Margem, Fora do perfil, Sem interesse' WHERE nome = 'DED' AND motivos_perda IS NULL`);
    await pool.query(`UPDATE crm_kanban_estagios SET motivos_perda = 'Desistência, Sem margem, Não atendeu consultoria' WHERE nome = 'CONSULTORIA' AND motivos_perda IS NULL`);
    await pool.query(`UPDATE crm_kanban_estagios SET motivos_perda = 'Proposta recusada, Margem estourada, Desistência' WHERE nome = 'PROPOSTA SISTEMA' AND motivos_perda IS NULL`);
  }
}

function validateDbConfig(env = process.env) {
  if (env.DATABASE_URL) {
    return;
  }

  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter(key => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  }
}

async function initDb() {
  validateDbConfig();
  await pool.query('SELECT 1');

  if (process.env.DB_RESET === 'true') {
    console.log('DB_RESET=true: recriando tabelas do zero...');
    await resetTables();
  }

  await createSchema();

  // Limpeza de duplicados antigos para garantir consistência visual no Kanban
  try {
    await pool.query(`
      UPDATE crm_kanban_leads
      SET status_atendimento = 'finalizado'
      WHERE status_atendimento IN ('em_atendimento', 'pendente_aceite')
        AND id NOT IN (
          SELECT MAX(id)
          FROM crm_kanban_leads
          WHERE status_atendimento IN ('em_atendimento', 'pendente_aceite')
          GROUP BY cliente_id
        )
    `);
    console.log('Leads ativos duplicados antigos limpos com sucesso no PostgreSQL.');
  } catch (err) {
    console.error('Erro ao limpar duplicados de leads:', err);
  }

  // Normalização de CPFs com zeros à esquerda faltantes (ex: vindos do Google Sheets)
  try {
    await pool.query(`
      UPDATE crm_clientes
      SET cpf = LPAD(REGEXP_REPLACE(cpf, '\\D', '', 'g'), 11, '0')
      WHERE cpf IS NOT NULL 
        AND LENGTH(REGEXP_REPLACE(cpf, '\\D', '', 'g')) BETWEEN 1 AND 10
    `);
    console.log('Normalização de CPFs (zeros à esquerda) concluída com sucesso no PostgreSQL.');
  } catch (err) {
    console.error('Erro ao normalizar zeros à esquerda nos CPFs:', err);
  }

  console.log('Banco PostgreSQL conectado e schema pronto (sem dados iniciais).');
}

module.exports = {
  dbRun,
  dbGet,
  dbAll,
  initDb,
  validateDbConfig,
  pool
};
