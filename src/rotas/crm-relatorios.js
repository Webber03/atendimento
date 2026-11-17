const express = require('express');
const { dbAll, dbGet, dbRun } = require('../../database');
const { requireAuth, requireRole } = require('../../auth');
const { PERDA_PIPELINE_EXPR, buildRelatorioFiltrosFunil, escopoPerdasPorFunil, etapaCoorteCte, etapaCoorteIdsSql, getDateFilter, perdaEscopoClause, resolverEtapaRelatorio, resolverFunilRelatorio } = require('../servicos/relatorios-filtros');
const { cpfSomenteNumeros, formatCsvField } = require('../utils/formatos');
const { dataHoraBrasilia, dataIsoBrasilia, sqlUtcParaLocal } = require('../utils/fuso-horario');

const router = express.Router();

// GET /api/crm/usuarios-filtro — Lista de SDRs e Closers para filtros (todos usuários autenticados)
router.get('/api/crm/usuarios-filtro', requireAuth, async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT id, name, username, role 
      FROM users 
      WHERE active = TRUE AND role IN ('sdr', 'closer', 'admin', 'supervisor')
      ORDER BY LOWER(COALESCE(NULLIF(TRIM(name), ''), username)) ASC
    `);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/relatorios — Obter dados consolidados para a aba Relatórios
router.get('/api/crm/relatorios', requireAuth, async (req, res) => {
  try {
    const { periodo = 'mes', data_de, data_ate, sdr_id, closer_id } = req.query;
    // Funil analisado (perfil sdr/closer travado no próprio funil)
    const funil = resolverFunilRelatorio(req.user, req.query.funil);
    // Etapa selecionada (opcional, uma por vez); inválida para o funil => ignorada
    const etapaSel = await resolverEtapaRelatorio(req.query.estagio_id, funil);

    // Data real da perda: último registro em crm_leads_perdas (fallback updated_at para perdidos sem registro)
    const lossDateExpr = 'COALESCE((SELECT MAX(pp.created_at) FROM crm_leads_perdas pp WHERE pp.lead_id = l.id), l.updated_at)';

    const dateFilterCreated = getDateFilter(periodo, data_de, data_ate, 'l.created_at');
    const dateFilterTransfer = getDateFilter(periodo, data_de, data_ate, 'l.transferido_closer_at');
    const dateFilterMoved = getDateFilter(periodo, data_de, data_ate, 'COALESCE(l.moved_to_stage_at, l.updated_at, l.created_at)');
    const dateFilterLoss = getDateFilter(periodo, data_de, data_ate, lossDateExpr);
    const dateFilterPerda = getDateFilter(periodo, data_de, data_ate, 'p.created_at');
    const dateFilterHist = getDateFilter(periodo, data_de, data_ate, 'h.created_at');

    // User filter conditions (lado SDR e lado Closer separados para o ranking cruzado)
    // Visão SDR ignora o filtro de Closer e vice-versa (exceto travamento por perfil)
    const {
      sdrSideFilter, sdrSideParams, closerSideFilter, closerSideParams,
      userLeadFilter, userLeadParams, hasSdrSide, hasCloserSide, escopoPerdas: escopoPerdasFiltros
    } = buildRelatorioFiltrosFunil(req.user, funil, sdr_id, closer_id);
    const escopoPerdas = escopoPerdasPorFunil(funil, escopoPerdasFiltros);
    const sdrIdEfetivo = funil === 'closer' ? undefined : sdr_id;
    const closerIdEfetivo = funil === 'sdr' ? undefined : closer_id;

    // D4a: com filtro do lado SDR (ou visão só SDR), "Próprios do Closer" não se aplica
    const ocultarProprios = hasSdrSide || funil === 'sdr';
    const incluirProprios = funil !== 'sdr';
    // D6: com filtro só do lado Closer, Prospectados/Meta (métricas de SDR) ficam ocultos
    // Prospectados = todos os leads novos (SDR e Closer): visível com qualquer filtro
    const ocultarProspeccao = false;

    // Condição para identificar estritamente transferências reais SDR ➔ Closer
    const realTransferCondition = `(l.sdr_id IS NOT NULL AND l.closer_id IS NOT NULL AND l.sdr_id != l.closer_id AND l.transferido_closer_at IS NOT NULL AND EXISTS (SELECT 1 FROM users u_sdr_chk WHERE u_sdr_chk.id = l.sdr_id AND u_sdr_chk.role IN ('sdr', 'supervisor', 'admin')))`;

    // Condição para identificar leads próprios do Closer (carteira direta / prospecção própria sem passagem de SDR)
    const closerOwnLeadCondition = `(l.closer_id IS NOT NULL AND (l.sdr_id IS NULL OR l.sdr_id = l.closer_id OR l.transferido_closer_at IS NULL OR NOT EXISTS (SELECT 1 FROM users u_sdr_chk WHERE u_sdr_chk.id = l.sdr_id AND u_sdr_chk.role IN ('sdr', 'supervisor', 'admin'))))`;

    // Tempo de aceite: da transferência (ou criação) até o aceite, calculado na consulta (corrige o histórico)
    const aceiteBaseExpr = 'COALESCE(l.transferido_closer_at, l.created_at)';
    const aceiteValidoCond = `l.aceito_em IS NOT NULL AND l.aceito_em >= ${aceiteBaseExpr}`;
    const aceiteSegundosExpr = `EXTRACT(EPOCH FROM (l.aceito_em - ${aceiteBaseExpr}))`;

    // Escopo das perdas por pipeline da etapa (D2)
    const escopoPerdaSql = perdaEscopoClause(escopoPerdas);

    // Filtros de ranking SDR e Closer
    let sdrRankWhere = "u.role = 'sdr' AND u.active = TRUE"; // Admin/Supervisor nunca são SDR
    const sdrRankParams = [];
    if (req.user.role === 'sdr') {
      sdrRankWhere += ' AND u.id = ?';
      sdrRankParams.push(req.user.id);
    } else if (sdrIdEfetivo && sdrIdEfetivo !== 'all') {
      const sdrList = String(sdrIdEfetivo).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      if (sdrList.length === 1) {
        sdrRankWhere += ' AND u.id = ?';
        sdrRankParams.push(sdrList[0]);
      } else if (sdrList.length > 1) {
        sdrRankWhere += ` AND u.id IN (${sdrList.map(() => '?').join(',')})`;
        sdrRankParams.push(...sdrList);
      }
    }

    let closerRankWhere = "u.role IN ('closer', 'admin', 'supervisor') AND u.active = TRUE";
    const closerRankParams = [];
    if (req.user.role === 'closer') {
      closerRankWhere += ' AND u.id = ?';
      closerRankParams.push(req.user.id);
    } else if (closerIdEfetivo && closerIdEfetivo !== 'all') {
      const closerList = String(closerIdEfetivo).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      if (closerList.length === 1) {
        closerRankWhere += ' AND u.id = ?';
        closerRankParams.push(closerList[0]);
      } else if (closerList.length > 1) {
        closerRankWhere += ` AND u.id IN (${closerList.map(() => '?').join(',')})`;
        closerRankParams.push(...closerList);
      }
    }

    // Colunas comuns da lista analítica de clientes (transferidos / próprios)
    const transferidosSelect = `
        SELECT l.id, l.cliente_id, l.status_atendimento, l.transferido_closer_at, l.created_at, l.updated_at, l.moved_to_stage_at,
               c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone, c.valor_contrato,
               e.nome as estagio_nome, e.cor as estagio_cor, e.pipeline_tipo,
               COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
               COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
               p.motivo as motivo_perda, p.observacao as obs_perda,
               CASE
                 WHEN ${realTransferCondition} THEN 'transferido'
                 WHEN ${closerOwnLeadCondition} THEN 'proprio_closer'
                 ELSE 'sdr'
               END as tipo_origem
        FROM crm_kanban_leads l
        JOIN crm_clientes c ON l.cliente_id = c.id
        LEFT JOIN crm_kanban_estagios e ON l.estagio_id = e.id
        LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
        LEFT JOIN users u_closer ON l.closer_id = u_closer.id
        LEFT JOIN crm_leads_perdas p ON p.id = (
          SELECT p2.id FROM crm_leads_perdas p2
          WHERE p2.lead_id = l.id
          ORDER BY p2.created_at DESC
          LIMIT 1
        )`;
    const TRANSFERIDOS_LIMIT = 250;

    // Prospectados / Evolução diária: população conforme o funil
    //  ambos  -> todos os leads novos no período
    //  sdr    -> leads novos que NÃO são próprios do Closer
    //  closer -> entraram no funil do Closer: próprios criados no período OU transferidos no período
    let prospectadosCond = dateFilterCreated.clause;
    let prospectadosParams = [...dateFilterCreated.params];
    let prospectadosDataExpr = 'l.created_at';
    let prospectadosRotulo = 'Novos leads no funil';
    if (funil === 'sdr') {
      prospectadosCond = `(${dateFilterCreated.clause} AND NOT ${closerOwnLeadCondition})`;
      prospectadosRotulo = 'Novos leads no funil do SDR';
    } else if (funil === 'closer') {
      prospectadosCond = `((${closerOwnLeadCondition} AND ${dateFilterCreated.clause}) OR (${realTransferCondition} AND ${dateFilterTransfer.clause}))`;
      prospectadosParams = [...dateFilterCreated.params, ...dateFilterTransfer.params];
      // Data de entrada no funil do Closer: transferência para transferidos, criação para próprios
      prospectadosDataExpr = `CASE WHEN ${realTransferCondition} THEN l.transferido_closer_at ELSE l.created_at END`;
      prospectadosRotulo = 'Entraram no funil do Closer';
    }

    // Perdas: com etapa selecionada, só as perdas ocorridas nessa etapa; senão escopo D2/funil
    const perdaRestricaoSql = etapaSel ? ' AND p.estagio_id = ?' : escopoPerdaSql;
    const perdaRestricaoParams = etapaSel ? [etapaSel.id] : [];

    // Lista analítica: com etapa selecionada, só os leads da coorte da etapa (a coorte já é do período)
    const coorteIds = etapaSel ? etapaCoorteIdsSql(etapaSel.id, dateFilterHist) : null;
    const transfListaCond = etapaSel ? `${realTransferCondition} AND l.id IN (${coorteIds.sql})` : `${realTransferCondition} AND ${dateFilterTransfer.clause}`;
    const transfListaParams = etapaSel ? coorteIds.params : dateFilterTransfer.params;
    const propriosListaCond = etapaSel ? `${closerOwnLeadCondition} AND l.id IN (${coorteIds.sql})` : `${closerOwnLeadCondition} AND ${dateFilterCreated.clause}`;
    const propriosListaParams = etapaSel ? coorteIds.params : dateFilterCreated.params;

    // Análise da etapa (coorte de entradas no período)
    const coorteCte = etapaSel ? etapaCoorteCte(etapaSel.id, dateFilterHist, userLeadFilter, userLeadParams) : null;
    const etapaLadoCol = etapaSel && etapaSel.pipeline_tipo === 'closer' ? 'closer_id' : 'sdr_id';
    const etapaSlaHoras = etapaSel ? parseInt(etapaSel.sla_horas, 10) : NaN;
    const etapaTemSla = Number.isInteger(etapaSlaHoras) && etapaSlaHoras > 0;

    // Disparar todas as consultas analíticas em paralelo no pool do PostgreSQL para máxima velocidade
    const [
      kpiLeads,
      movimentacoesCount,
      perdasPorMotivo,
      perdasPorEstagio,
      perdasTotal,
      perdasRecentes,
      perdasRecentesTotal,
      perdasPosTransfMotivo,
      perdasPosTransfTotal,
      metaProspeccaoSetting,
      evolucaoDiaria,
      estagios,
      sdrRanking,
      closerRanking,
      transferidosLista,
      propriosLista,
      transferidosContagemRows,
      etapaResumo,
      etapaEvolucao,
      etapaRanking,
      etapaSla
    ] = await Promise.all([
      // 1. KPIs Globais
      dbGet(`
        SELECT
          COUNT(CASE WHEN ${prospectadosCond} THEN 1 END) as prospectados, -- população conforme o funil (ambos = todos os leads novos)
          COUNT(CASE WHEN ${realTransferCondition} AND ${dateFilterTransfer.clause} THEN 1 END) as transferidos,
          COUNT(CASE WHEN ${realTransferCondition} AND ${dateFilterTransfer.clause} AND l.status_atendimento IN ('em_atendimento', 'pendente_aceite') THEN 1 END) as transferidos_em_andamento,
          COUNT(CASE WHEN l.status_atendimento = 'perdido' AND ${realTransferCondition} AND ${dateFilterLoss.clause} THEN 1 END) as transferidos_perdidos,
          COUNT(CASE WHEN ${realTransferCondition} AND ${dateFilterTransfer.clause} AND l.status_atendimento = 'perdido' THEN 1 END) as transferidos_perdidos_coorte,
          COUNT(CASE WHEN ${realTransferCondition} AND (${dateFilterTransfer.clause} OR ${dateFilterMoved.clause}) AND l.status_atendimento = 'concluido' THEN 1 END) as transferidos_concluidos,
          COUNT(CASE WHEN ${closerOwnLeadCondition} AND ${dateFilterCreated.clause} THEN 1 END) as proprios_total,
          COUNT(CASE WHEN ${closerOwnLeadCondition} AND ${dateFilterCreated.clause} AND l.status_atendimento IN ('em_atendimento', 'pendente_aceite') THEN 1 END) as proprios_em_andamento,
          COUNT(CASE WHEN l.status_atendimento = 'perdido' AND ${closerOwnLeadCondition} AND ${dateFilterLoss.clause} THEN 1 END) as proprios_perdidos,
          COUNT(CASE WHEN ${closerOwnLeadCondition} AND ${dateFilterCreated.clause} AND l.status_atendimento = 'perdido' THEN 1 END) as proprios_perdidos_coorte,
          COUNT(CASE WHEN ${closerOwnLeadCondition} AND ${dateFilterMoved.clause} AND l.status_atendimento = 'concluido' THEN 1 END) as proprios_concluidos,
          COUNT(CASE WHEN l.status_atendimento = 'concluido' AND ${dateFilterMoved.clause} THEN 1 END) as concluidos_total,
          COUNT(CASE WHEN l.status_atendimento = 'perdido' AND ${dateFilterLoss.clause} THEN 1 END) as perdidos_total,
          COALESCE(SUM(CASE WHEN l.status_atendimento = 'concluido' AND ${dateFilterMoved.clause} THEN c.valor_contrato ELSE 0 END), 0) as faturamento_total,
          COALESCE(AVG(CASE WHEN ${aceiteValidoCond} AND ${dateFilterTransfer.clause} THEN ${aceiteSegundosExpr} ELSE NULL END), 0) as tempo_medio_resposta_seg
        FROM crm_kanban_leads l
        JOIN crm_clientes c ON l.cliente_id = c.id
        WHERE 1=1 ${userLeadFilter}
      `, [
        ...prospectadosParams,
        ...dateFilterTransfer.params,
        ...dateFilterTransfer.params,
        ...dateFilterLoss.params,
        ...dateFilterTransfer.params,
        ...dateFilterTransfer.params, ...dateFilterMoved.params,
        ...dateFilterCreated.params,
        ...dateFilterCreated.params,
        ...dateFilterLoss.params,
        ...dateFilterCreated.params,
        ...dateFilterMoved.params,
        ...dateFilterMoved.params,
        ...dateFilterLoss.params,
        ...dateFilterMoved.params,
        ...dateFilterTransfer.params,
        ...userLeadParams
      ]),

      // 2. Movimentações
      dbGet(`
        SELECT COUNT(*) as total
        FROM crm_kanban_historico h
        JOIN crm_kanban_leads l ON h.lead_id = l.id
        WHERE ${dateFilterHist.clause} ${userLeadFilter}
      `, [...dateFilterHist.params, ...userLeadParams]),

      // 3. Análise de Perdas por Motivo (escopo D2)
      dbAll(`
        -- Motivos iguais com grafias diferentes (ex.: DESISTÊNCIA/Desistência) contam juntos; mostra a grafia mais usada
        SELECT MODE() WITHIN GROUP (ORDER BY TRIM(p.motivo)) as motivo, COUNT(*) as quantidade
        FROM crm_leads_perdas p
        JOIN crm_kanban_leads l ON p.lead_id = l.id
        LEFT JOIN crm_kanban_estagios pe ON pe.id = p.estagio_id
        WHERE ${dateFilterPerda.clause} ${userLeadFilter} ${perdaRestricaoSql}
        GROUP BY UPPER(TRIM(p.motivo))
        ORDER BY quantidade DESC
      `, [...dateFilterPerda.params, ...userLeadParams, ...perdaRestricaoParams]),

      // 4. Análise de Perdas por Estágio (escopo D2)
      dbAll(`
        -- Etapas com o mesmo nome existem nos dois funis (ex.: CONTATO INICIAL no SDR e no Closer): agrupa por nome + funil
        SELECT p.estagio_nome, ${PERDA_PIPELINE_EXPR} as pipeline_tipo, MAX(pe.cor) as estagio_cor, COUNT(*) as quantidade
        FROM crm_leads_perdas p
        JOIN crm_kanban_leads l ON p.lead_id = l.id
        LEFT JOIN crm_kanban_estagios pe ON pe.id = p.estagio_id
        WHERE ${dateFilterPerda.clause} ${userLeadFilter} ${perdaRestricaoSql}
        GROUP BY p.estagio_nome, ${PERDA_PIPELINE_EXPR}
        ORDER BY quantidade DESC
      `, [...dateFilterPerda.params, ...userLeadParams, ...perdaRestricaoParams]),

      // 5. Total de Perdas (escopo D2)
      dbGet(`
        SELECT COUNT(*) as total
        FROM crm_leads_perdas p
        JOIN crm_kanban_leads l ON p.lead_id = l.id
        LEFT JOIN crm_kanban_estagios pe ON pe.id = p.estagio_id
        WHERE ${dateFilterPerda.clause} ${userLeadFilter} ${perdaRestricaoSql}
      `, [...dateFilterPerda.params, ...userLeadParams, ...perdaRestricaoParams]),

      // 6. Perdas Recentes (escopo D2) — com o pipeline em que a perda aconteceu
      dbAll(`
        SELECT p.id, p.estagio_nome, p.motivo, p.observacao, p.usuario_nome, p.created_at,
               c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone,
               COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
               COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
               CASE
                 WHEN ${realTransferCondition} THEN 'transferido'
                 WHEN ${closerOwnLeadCondition} THEN 'proprio_closer'
                 ELSE 'sdr'
               END as lead_origem,
               ${PERDA_PIPELINE_EXPR} as perda_pipeline
        FROM crm_leads_perdas p
        JOIN crm_clientes c ON p.cliente_id = c.id
        JOIN crm_kanban_leads l ON p.lead_id = l.id
        LEFT JOIN crm_kanban_estagios pe ON pe.id = p.estagio_id
        LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
        LEFT JOIN users u_closer ON l.closer_id = u_closer.id
        WHERE ${dateFilterPerda.clause} ${userLeadFilter} ${perdaRestricaoSql}
        ORDER BY p.created_at DESC
        LIMIT 100
      `, [...dateFilterPerda.params, ...userLeadParams, ...perdaRestricaoParams]),

      // 6b. Total da lista de perdas recentes (mesmos JOINs da lista, sem LIMIT)
      dbGet(`
        SELECT COUNT(*) as total
        FROM crm_leads_perdas p
        JOIN crm_clientes c ON p.cliente_id = c.id
        JOIN crm_kanban_leads l ON p.lead_id = l.id
        LEFT JOIN crm_kanban_estagios pe ON pe.id = p.estagio_id
        WHERE ${dateFilterPerda.clause} ${userLeadFilter} ${perdaRestricaoSql}
      `, [...dateFilterPerda.params, ...userLeadParams, ...perdaRestricaoParams]),

      // 6c. Perdas após a transferência (funil Closer) dos leads do SDR filtrado — só no escopo 'sdr'
      escopoPerdas === 'sdr' && !etapaSel ? dbAll(`
        -- Motivos iguais com grafias diferentes (ex.: DESISTÊNCIA/Desistência) contam juntos; mostra a grafia mais usada
        SELECT MODE() WITHIN GROUP (ORDER BY TRIM(p.motivo)) as motivo, COUNT(*) as quantidade
        FROM crm_leads_perdas p
        JOIN crm_kanban_leads l ON p.lead_id = l.id
        LEFT JOIN crm_kanban_estagios pe ON pe.id = p.estagio_id
        WHERE ${dateFilterPerda.clause} ${userLeadFilter} ${perdaEscopoClause('closer')}
        GROUP BY UPPER(TRIM(p.motivo))
        ORDER BY quantidade DESC
      `, [...dateFilterPerda.params, ...userLeadParams]) : Promise.resolve(null),

      escopoPerdas === 'sdr' && !etapaSel ? dbGet(`
        SELECT COUNT(*) as total
        FROM crm_leads_perdas p
        JOIN crm_kanban_leads l ON p.lead_id = l.id
        LEFT JOIN crm_kanban_estagios pe ON pe.id = p.estagio_id
        WHERE ${dateFilterPerda.clause} ${userLeadFilter} ${perdaEscopoClause('closer')}
      `, [...dateFilterPerda.params, ...userLeadParams]) : Promise.resolve(null),

      // 7. Configuração da Meta de Prospecção
      dbGet("SELECT value FROM system_settings WHERE key = 'meta_prospeccao_mensal'"),

      // 8. Evolução Diária (mesma população do KPI Prospectados no funil escolhido; dia de Brasília da entrada)
      dbAll(`
        SELECT TO_CHAR(${sqlUtcParaLocal(prospectadosDataExpr)}, 'YYYY-MM-DD') as data, COUNT(*) as quantidade
        FROM crm_kanban_leads l
        JOIN crm_clientes c ON l.cliente_id = c.id
        WHERE ${prospectadosCond} ${userLeadFilter}
        GROUP BY 1
        ORDER BY 1 ASC
      `, [...prospectadosParams, ...userLeadParams]),

      // 9. Estágios do Funil & Distribuição Atual
      dbAll(`
        SELECT e.id, e.nome, e.pipeline_tipo, e.cor, e.ordem,
               COUNT(l.id) as total_leads,
               COALESCE(SUM(COALESCE(c.valor_contrato, 0)), 0) as valor_total
        FROM crm_kanban_estagios e
        LEFT JOIN crm_kanban_leads l ON l.estagio_id = e.id AND (${dateFilterCreated.clause} ${userLeadFilter})
        LEFT JOIN crm_clientes c ON l.cliente_id = c.id
        WHERE e.ativo = TRUE
        GROUP BY e.id, e.nome, e.pipeline_tipo, e.cor, e.ordem
        ORDER BY e.pipeline_tipo ASC, e.ordem ASC
      `, [...dateFilterCreated.params, ...userLeadParams]),

      // 10. Ranking SDRs (filtro do lado Closer aplicado no JOIN) — oculto na visão só Closer
      funil === 'closer' ? Promise.resolve([]) : dbAll(`
        SELECT u.id, COALESCE(NULLIF(TRIM(u.name), ''), u.username) as sdr_nome, u.username,
               COUNT(CASE WHEN ${dateFilterCreated.clause} THEN 1 END) as total_prospectados,
               COUNT(CASE WHEN ${realTransferCondition} AND ${dateFilterTransfer.clause} THEN 1 END) as total_enviados,
               COUNT(CASE WHEN l.status_atendimento = 'concluido' AND ${dateFilterMoved.clause} THEN 1 END) as total_ganhos,
               COUNT(CASE WHEN l.status_atendimento = 'perdido' AND ${dateFilterLoss.clause} THEN 1 END) as total_perdidos
        FROM users u
        LEFT JOIN crm_kanban_leads l ON l.sdr_id = u.id ${closerSideFilter}
        WHERE ${sdrRankWhere}
        GROUP BY u.id, u.name, u.username
        HAVING COUNT(l.id) > 0 OR u.role = 'sdr'
        ORDER BY total_enviados DESC, total_ganhos DESC
      `, [
        ...dateFilterCreated.params,
        ...dateFilterTransfer.params,
        ...dateFilterMoved.params,
        ...dateFilterLoss.params,
        ...closerSideParams,
        ...sdrRankParams
      ]),

      // 11. Ranking Closers (filtro do lado SDR aplicado no JOIN) — oculto na visão só SDR
      funil === 'sdr' ? Promise.resolve([]) : dbAll(`
        SELECT u.id, COALESCE(NULLIF(TRIM(u.name), ''), u.username) as closer_nome, u.username,
               -- Transferências recebidas de SDR
               COUNT(CASE WHEN ${realTransferCondition} AND ${dateFilterTransfer.clause} THEN 1 END) as total_recebidos,
               COUNT(CASE WHEN ${realTransferCondition} AND ${dateFilterTransfer.clause} AND l.status_atendimento IN ('em_atendimento', 'pendente_aceite') THEN 1 END) as total_em_andamento_transf,
               COUNT(CASE WHEN l.status_atendimento = 'perdido' AND ${realTransferCondition} AND ${dateFilterLoss.clause} THEN 1 END) as total_perdidos_transf,
               COUNT(CASE WHEN ${realTransferCondition} AND (${dateFilterTransfer.clause} OR ${dateFilterMoved.clause}) AND l.status_atendimento = 'concluido' THEN 1 END) as total_ganhos_transf,

               -- Leads próprios do Closer
               COUNT(CASE WHEN ${closerOwnLeadCondition} AND ${dateFilterCreated.clause} THEN 1 END) as total_proprios,
               COUNT(CASE WHEN ${closerOwnLeadCondition} AND ${dateFilterCreated.clause} AND l.status_atendimento IN ('em_atendimento', 'pendente_aceite') THEN 1 END) as total_em_andamento_proprios,
               COUNT(CASE WHEN l.status_atendimento = 'perdido' AND ${closerOwnLeadCondition} AND ${dateFilterLoss.clause} THEN 1 END) as total_perdidos_proprios,
               COUNT(CASE WHEN ${closerOwnLeadCondition} AND ${dateFilterMoved.clause} AND l.status_atendimento = 'concluido' THEN 1 END) as total_ganhos_proprios,

               -- Totais Gerais do Closer
               COUNT(CASE WHEN (${realTransferCondition} AND ${dateFilterTransfer.clause} AND l.status_atendimento IN ('em_atendimento', 'pendente_aceite')) OR (${closerOwnLeadCondition} AND ${dateFilterCreated.clause} AND l.status_atendimento IN ('em_atendimento', 'pendente_aceite')) THEN 1 END) as total_em_andamento,
               COUNT(CASE WHEN l.status_atendimento = 'perdido' AND (${realTransferCondition} OR ${closerOwnLeadCondition}) AND ${dateFilterLoss.clause} THEN 1 END) as total_perdidos,
               COUNT(CASE WHEN l.status_atendimento = 'concluido' AND ${dateFilterMoved.clause} THEN 1 END) as total_ganhos,

               COUNT(CASE WHEN l.aceito_em IS NOT NULL AND ${dateFilterTransfer.clause} THEN 1 END) as total_aceitos,
               COALESCE(SUM(CASE WHEN l.status_atendimento = 'concluido' AND ${dateFilterMoved.clause} THEN c.valor_contrato ELSE 0 END), 0) as faturamento_total,
               COALESCE(AVG(CASE WHEN ${aceiteValidoCond} AND ${dateFilterTransfer.clause} THEN ${aceiteSegundosExpr} / 60.0 ELSE NULL END), 0) as tempo_medio_aceite_min
        FROM users u
        LEFT JOIN crm_kanban_leads l ON l.closer_id = u.id ${sdrSideFilter}
        LEFT JOIN crm_clientes c ON l.cliente_id = c.id
        WHERE ${closerRankWhere}
        GROUP BY u.id, u.name, u.username
        HAVING COUNT(l.id) > 0 OR u.role = 'closer'
        ORDER BY total_ganhos DESC, total_recebidos DESC
      `, [
        ...dateFilterTransfer.params,
        ...dateFilterTransfer.params,
        ...dateFilterLoss.params,
        ...dateFilterTransfer.params, ...dateFilterMoved.params,
        ...dateFilterCreated.params,
        ...dateFilterCreated.params,
        ...dateFilterLoss.params,
        ...dateFilterMoved.params,
        ...dateFilterTransfer.params, ...dateFilterCreated.params,
        ...dateFilterLoss.params,
        ...dateFilterMoved.params,
        ...dateFilterTransfer.params,
        ...dateFilterMoved.params,
        ...dateFilterTransfer.params,
        ...sdrSideParams,
        ...closerRankParams
      ]),

      // 12a. Lista Analítica — Transferidos SDR -> Closer (LIMIT por origem)
      dbAll(`${transferidosSelect}
        WHERE ${transfListaCond}
          ${userLeadFilter}
        ORDER BY COALESCE(l.transferido_closer_at, l.created_at) DESC
        LIMIT ${TRANSFERIDOS_LIMIT}
      `, [
        ...transfListaParams,
        ...userLeadParams
      ]),

      // 12b. Lista Analítica — Próprios do Closer (LIMIT por origem) — não se aplica na visão só SDR
      !incluirProprios ? Promise.resolve([]) : dbAll(`${transferidosSelect}
        WHERE ${propriosListaCond}
          ${userLeadFilter}
        ORDER BY COALESCE(l.transferido_closer_at, l.created_at) DESC
        LIMIT ${TRANSFERIDOS_LIMIT}
      `, [
        ...propriosListaParams,
        ...userLeadParams
      ]),

      // 12c. Contagens das abas da lista analítica (sem LIMIT)
      dbAll(`
        SELECT CASE WHEN ${realTransferCondition} THEN 'transferido' ELSE 'proprio_closer' END as origem,
               CASE WHEN l.status_atendimento IN ('em_atendimento', 'pendente_aceite') THEN 'em_atendimento' ELSE l.status_atendimento END as status,
               COUNT(*) as qtd
        FROM crm_kanban_leads l
        JOIN crm_clientes c ON l.cliente_id = c.id
        WHERE ((${transfListaCond})${incluirProprios ? ` OR (${propriosListaCond})` : ''})
          ${userLeadFilter}
        GROUP BY 1, 2
      `, [
        ...transfListaParams,
        ...(incluirProprios ? propriosListaParams : []),
        ...userLeadParams
      ]),

      // 13. Análise da etapa selecionada (coorte de quem entrou na etapa no período)
      etapaSel ? dbGet(`
        WITH ${coorteCte.sql}
        SELECT COUNT(*) as entraram,
               COUNT(*) FILTER (WHERE resultado = 'avanco') as avancaram,
               COUNT(*) FILTER (WHERE resultado = 'volta') as voltaram,
               COUNT(*) FILTER (WHERE resultado = 'perda') as perdidos,
               COUNT(*) FILTER (WHERE resultado = 'ainda') as ainda_na_etapa,
               COUNT(*) FILTER (WHERE resultado = 'outro') as outros,
               AVG(EXTRACT(EPOCH FROM (saida_em - entrada_em)) / 3600.0) FILTER (WHERE saida_em IS NOT NULL) as tempo_medio_horas
        FROM coorte
      `, coorteCte.params) : Promise.resolve(null),

      // 13b. Entradas na etapa por dia de Brasília (primeira entrada de cada lead no período)
      etapaSel ? dbAll(`
        WITH ${coorteCte.sql}
        SELECT TO_CHAR(${sqlUtcParaLocal('entrada_em')}, 'YYYY-MM-DD') as data, COUNT(*) as quantidade
        FROM coorte
        GROUP BY 1
        ORDER BY 1 ASC
      `, coorteCte.params) : Promise.resolve([]),

      // 13c. Desempenho na etapa por responsável do lado da etapa (SDR ou Closer)
      etapaSel ? dbAll(`
        WITH ${coorteCte.sql}
        SELECT u.id as usuario_id, COALESCE(NULLIF(TRIM(u.name), ''), u.username) as nome,
               COUNT(*) as entraram,
               COUNT(*) FILTER (WHERE co.resultado = 'avanco') as avancaram,
               COUNT(*) FILTER (WHERE co.resultado = 'perda') as perdidos
        FROM coorte co
        JOIN users u ON u.id = co.${etapaLadoCol}
        GROUP BY u.id, u.name, u.username
        ORDER BY entraram DESC, nome ASC
      `, coorteCte.params) : Promise.resolve([]),

      // 13d. SLA estourado agora: leads atualmente na etapa (qualquer data de entrada) além do SLA
      etapaSel && etapaTemSla ? dbGet(`
        SELECT COUNT(*) as total
        FROM crm_kanban_leads l
        WHERE l.estagio_id = ? AND COALESCE(l.status_atendimento, '') <> 'perdido'
          AND l.moved_to_stage_at IS NOT NULL
          AND l.moved_to_stage_at + (?::int * INTERVAL '1 hour') < NOW()
          ${userLeadFilter}
      `, [etapaSel.id, etapaSlaHoras, ...userLeadParams]) : Promise.resolve(null)
    ]);

    const prospectadosCount = parseInt(kpiLeads?.prospectados || '0', 10);
    const transferidosCount = parseInt(kpiLeads?.transferidos || '0', 10);
    const transferidosAndamentoCount = parseInt(kpiLeads?.transferidos_em_andamento || '0', 10);
    const transferidosPerdidosCount = parseInt(kpiLeads?.transferidos_perdidos || '0', 10);
    const transferidosPerdidosCoorteCount = parseInt(kpiLeads?.transferidos_perdidos_coorte || '0', 10);
    const transferidosConcluidosCount = parseInt(kpiLeads?.transferidos_concluidos || '0', 10);

    const propriosTotalCount = ocultarProprios ? 0 : parseInt(kpiLeads?.proprios_total || '0', 10);
    const propriosAndamentoCount = ocultarProprios ? 0 : parseInt(kpiLeads?.proprios_em_andamento || '0', 10);
    const propriosPerdidosCount = ocultarProprios ? 0 : parseInt(kpiLeads?.proprios_perdidos || '0', 10);
    const propriosPerdidosCoorteCount = ocultarProprios ? 0 : parseInt(kpiLeads?.proprios_perdidos_coorte || '0', 10);
    const propriosConcluidosCount = ocultarProprios ? 0 : parseInt(kpiLeads?.proprios_concluidos || '0', 10);

    const concluidosTotalCount = parseInt(kpiLeads?.concluidos_total || '0', 10);
    const perdidosTotalCount = parseInt(kpiLeads?.perdidos_total || '0', 10);

    // Taxas por coorte (D3): dos transferidos/criados no período, quantos estão hoje perdidos (nunca > 100%)
    const taxaPerdaCloser = transferidosCount > 0 ? ((transferidosPerdidosCoorteCount / transferidosCount) * 100).toFixed(1) : '0.0';
    const taxaPerdaProprios = propriosTotalCount > 0 ? ((propriosPerdidosCoorteCount / propriosTotalCount) * 100).toFixed(1) : '0.0';
    const totalLeadsBase = prospectadosCount;
    const taxaPerdaGeral = totalLeadsBase > 0 ? ((perdidosTotalCount / totalLeadsBase) * 100).toFixed(1) : '0.0';

    const metaProspeccao = parseInt(metaProspeccaoSetting?.value || '100', 10);

    // Contagens das abas (sem LIMIT)
    const novaContagem = () => ({ total: 0, em_atendimento: 0, perdido: 0, concluido: 0 });
    const transferidosContagens = { transferido: novaContagem(), proprio_closer: novaContagem() };
    for (const row of (transferidosContagemRows || [])) {
      const bucket = transferidosContagens[row.origem];
      if (!bucket) continue;
      const qtd = parseInt(row.qtd || '0', 10);
      bucket.total += qtd;
      if (Object.prototype.hasOwnProperty.call(bucket, row.status)) bucket[row.status] += qtd;
    }
    const transferidosTotal = transferidosContagens.transferido.total + transferidosContagens.proprio_closer.total;

    // A1: com filtro cruzado ativo, esconder do ranking quem não teve atividade no período
    const num = (v) => parseFloat(v || '0') || 0;
    const sdrRankingFinal = hasCloserSide
      ? sdrRanking.filter(r => num(r.total_prospectados) + num(r.total_enviados) + num(r.total_ganhos) + num(r.total_perdidos) > 0)
      : sdrRanking;
    const closerRankingFinal = hasSdrSide
      ? closerRanking.filter(r => num(r.total_recebidos) + num(r.total_proprios) + num(r.total_em_andamento) + num(r.total_perdidos) + num(r.total_ganhos) + num(r.total_aceitos) > 0)
      : closerRanking;

    const perdas = {
      por_motivo: perdasPorMotivo,
      por_estagio: perdasPorEstagio,
      recentes: perdasRecentes,
      total: parseInt(perdasTotal?.total || '0', 10),
      escopo: etapaSel ? 'etapa' : escopoPerdas,
      recentes_total: parseInt(perdasRecentesTotal?.total || '0', 10)
    };
    if (escopoPerdas === 'sdr' && !etapaSel) {
      perdas.pos_transferencia = {
        por_motivo: perdasPosTransfMotivo || [],
        total: parseInt(perdasPosTransfTotal?.total || '0', 10)
      };
    }

    // Análise da etapa selecionada (null quando não há etapa válida)
    const pct = (parte, todo) => todo > 0 ? parseFloat(((parte / todo) * 100).toFixed(1)) : 0;
    let etapa = null;
    if (etapaSel) {
      const entraram = parseInt(etapaResumo?.entraram || '0', 10);
      const avancaram = parseInt(etapaResumo?.avancaram || '0', 10);
      const tempoMedio = etapaResumo?.tempo_medio_horas;
      etapa = {
        estagio: {
          id: etapaSel.id,
          nome: etapaSel.nome,
          pipeline_tipo: etapaSel.pipeline_tipo,
          cor: etapaSel.cor || null,
          sla_horas: etapaTemSla ? etapaSlaHoras : null
        },
        entraram,
        avancaram,
        voltaram: parseInt(etapaResumo?.voltaram || '0', 10),
        perdidos: parseInt(etapaResumo?.perdidos || '0', 10),
        ainda_na_etapa: parseInt(etapaResumo?.ainda_na_etapa || '0', 10),
        outros: parseInt(etapaResumo?.outros || '0', 10),
        conversao_pct: pct(avancaram, entraram),
        tempo_medio_horas: tempoMedio === null || tempoMedio === undefined || isNaN(parseFloat(tempoMedio))
          ? null : parseFloat(parseFloat(tempoMedio).toFixed(1)),
        sla_estourados: etapaTemSla ? parseInt(etapaSla?.total || '0', 10) : null,
        evolucao_diaria: (etapaEvolucao || []).map(r => ({ data: r.data, quantidade: parseInt(r.quantidade || '0', 10) })),
        ranking: (etapaRanking || []).map(r => {
          const ent = parseInt(r.entraram || '0', 10);
          const av = parseInt(r.avancaram || '0', 10);
          return {
            usuario_id: r.usuario_id,
            nome: r.nome,
            entraram: ent,
            avancaram: av,
            perdidos: parseInt(r.perdidos || '0', 10),
            conversao_pct: pct(av, ent)
          };
        })
      };
    }

    res.json({
      visao: {
        funil,
        mostrar_ranking_sdr: funil !== 'closer',
        mostrar_ranking_closer: funil !== 'sdr',
        mostrar_tempo_aceite: funil !== 'sdr'
      },
      etapa,
      kpis: {
        prospectados: prospectadosCount,
        movimentacoes: parseInt(movimentacoesCount?.total || '0', 10),
        transferidos: transferidosCount,
        transferidos_em_andamento: transferidosAndamentoCount,
        transferidos_perdidos: transferidosPerdidosCount,
        transferidos_perdidos_coorte: transferidosPerdidosCoorteCount,
        transferidos_concluidos: transferidosConcluidosCount,
        taxa_perda_closer: parseFloat(taxaPerdaCloser),
        proprios_total: propriosTotalCount,
        proprios_em_andamento: propriosAndamentoCount,
        proprios_perdidos: propriosPerdidosCount,
        proprios_concluidos: propriosConcluidosCount,
        taxa_perda_proprios: parseFloat(taxaPerdaProprios),
        ocultar_proprios: ocultarProprios,
        rotulo_passagens: funil === 'closer' ? 'Recebidos de SDR' : 'Passagens ao Closer',
        concluidos: concluidosTotalCount,
        perdidos: perdidosTotalCount,
        faturamento_total: parseFloat(kpiLeads?.faturamento_total || '0'),
        taxa_perda: parseFloat(taxaPerdaGeral),
        tempo_medio_resposta_min: kpiLeads?.tempo_medio_resposta_seg ? (parseFloat(kpiLeads.tempo_medio_resposta_seg) / 60).toFixed(1) : '0.0'
      },
      perdas,
      transferidos_detalhes: [...transferidosLista, ...propriosLista],
      transferidos_contagens: transferidosContagens,
      transferidos_total: transferidosTotal,
      prospeccoes: {
        meta_mensal: metaProspeccao,
        prospectados_periodo: prospectadosCount,
        atingido_percentual: metaProspeccao > 0 ? Math.min(100, Math.round((prospectadosCount / metaProspeccao) * 100)) : 0,
        evolucao_diaria: evolucaoDiaria,
        ocultar: ocultarProspeccao,
        rotulo: prospectadosRotulo
      },
      estagios,
      rankings: {
        sdrs: sdrRankingFinal,
        closers: closerRankingFinal
      }
    });

  } catch (err) {
    console.error('Erro ao gerar relatórios CRM:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/relatorios/meta — Buscar meta de prospecção
router.get('/api/crm/relatorios/meta', requireAuth, async (req, res) => {
  try {
    const metaRow = await dbGet("SELECT value FROM system_settings WHERE key = 'meta_prospeccao_mensal'");
    res.json({ meta: parseInt(metaRow?.value || '100', 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/relatorios/meta — Atualizar meta de prospecção (admin/supervisor)
router.post('/api/crm/relatorios/meta', requireAuth, requireRole(['admin', 'supervisor']), async (req, res) => {
  const { meta } = req.body;
  if (!meta || isNaN(meta) || meta <= 0) {
    return res.status(400).json({ error: 'Informe um valor numérico válido para a meta.' });
  }
  try {
    await dbRun(
      `INSERT INTO system_settings (key, value) VALUES ('meta_prospeccao_mensal', ?)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
       RETURNING key`,
      [String(meta)]
    );
    res.json({ success: true, message: 'Meta de prospecção atualizada com sucesso!', meta: parseInt(meta, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/relatorios/perdas/export — Baixar relatório completo detalhado de perdas (da data/filtros selecionados)
router.get('/api/crm/relatorios/perdas/export', requireAuth, async (req, res) => {
  try {
    const { periodo = 'mes', data_de, data_ate, sdr_id, closer_id } = req.query;
    const dateFilterPerda = getDateFilter(periodo, data_de, data_ate, 'p.created_at');

    // Mesmos filtros, funil e escopo de perdas (D2) da tela de Relatórios
    const funil = resolverFunilRelatorio(req.user, req.query.funil);
    const etapaSel = await resolverEtapaRelatorio(req.query.estagio_id, funil);
    const { userLeadFilter, userLeadParams, escopoPerdas: escopoPerdasFiltros } = buildRelatorioFiltrosFunil(req.user, funil, sdr_id, closer_id);
    const escopoPerdas = escopoPerdasPorFunil(funil, escopoPerdasFiltros);
    // Com etapa selecionada: só as perdas ocorridas nessa etapa
    const escopoPerdaSql = etapaSel ? ' AND p.estagio_id = ?' : perdaEscopoClause(escopoPerdas);
    const escopoPerdaParams = etapaSel ? [etapaSel.id] : [];

    const realTransferCondition = `(l.sdr_id IS NOT NULL AND l.closer_id IS NOT NULL AND l.sdr_id != l.closer_id AND l.transferido_closer_at IS NOT NULL AND EXISTS (SELECT 1 FROM users u_sdr_chk WHERE u_sdr_chk.id = l.sdr_id AND u_sdr_chk.role IN ('sdr', 'supervisor', 'admin')))`;
    const closerOwnLeadCondition = `(l.closer_id IS NOT NULL AND (l.sdr_id IS NULL OR l.sdr_id = l.closer_id OR l.transferido_closer_at IS NULL OR NOT EXISTS (SELECT 1 FROM users u_sdr_chk WHERE u_sdr_chk.id = l.sdr_id AND u_sdr_chk.role IN ('sdr', 'supervisor', 'admin'))))`;

    const rows = await dbAll(`
      SELECT p.id as perda_id, p.created_at as data_perda,
             c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone, c.email as cliente_email,
             c.valor_contrato,
             p.estagio_nome as etapa_perda,
             p.motivo, p.observacao, p.usuario_nome,
             COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
             COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
             CASE 
               WHEN ${realTransferCondition} THEN 'Transferido (SDR -> Closer)'
               WHEN ${closerOwnLeadCondition} THEN 'Próprio do Closer'
               ELSE 'Funil SDR'
             END as tipo_origem
      FROM crm_leads_perdas p
      JOIN crm_clientes c ON p.cliente_id = c.id
      JOIN crm_kanban_leads l ON p.lead_id = l.id
      LEFT JOIN crm_kanban_estagios pe ON pe.id = p.estagio_id
      LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
      LEFT JOIN users u_closer ON l.closer_id = u_closer.id
      WHERE ${dateFilterPerda.clause} ${userLeadFilter} ${escopoPerdaSql}
      ORDER BY p.created_at DESC
    `, [...dateFilterPerda.params, ...userLeadParams, ...escopoPerdaParams]);

    const header = [
      'ID Perda',
      'Data/Hora da Perda',
      'Cliente',
      'CPF',
      'Telefone',
      'E-mail',
      'Origem do Lead',
      'SDR Responsável',
      'Closer Responsável',
      'Etapa da Perda',
      'Motivo da Perda',
      'Usuário que Marcou',
      'Observação',
      'Valor do Contrato'
    ];

    const csvLines = [header.map(formatCsvField).join(';')];

    for (const r of rows) {
      const dataFmt = dataHoraBrasilia(r.data_perda);
      const valorFmt = r.valor_contrato ? Number(r.valor_contrato).toFixed(2).replace('.', ',') : '0,00';
      csvLines.push([
        formatCsvField(r.perda_id),
        formatCsvField(dataFmt),
        formatCsvField(r.cliente_nome || ''),
        formatCsvField(cpfSomenteNumeros(r.cliente_cpf)),
        formatCsvField(r.cliente_telefone || ''),
        formatCsvField(r.cliente_email || ''),
        formatCsvField(r.tipo_origem || ''),
        formatCsvField(r.sdr_nome || '—'),
        formatCsvField(r.closer_nome || '—'),
        formatCsvField(r.etapa_perda || ''),
        formatCsvField(r.motivo || ''),
        formatCsvField(r.usuario_nome || ''),
        formatCsvField(r.observacao || ''),
        formatCsvField(valorFmt)
      ].join(';'));
    }

    const csvContent = '\uFEFF' + csvLines.join('\r\n');
    const filenameDate = dataIsoBrasilia();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio_perdas_detalhado_${periodo}_${filenameDate}.csv"`);
    res.send(csvContent);
  } catch (err) {
    console.error('Erro ao exportar relatório de perdas:', err);
    res.status(500).json({ error: 'Erro ao gerar arquivo de perdas: ' + err.message });
  }
});

// GET /api/crm/relatorios/transferidos/export — Baixar relatório de clientes/transferências (da data/filtros selecionados)
router.get('/api/crm/relatorios/transferidos/export', requireAuth, async (req, res) => {
  try {
    const { periodo = 'mes', data_de, data_ate, sdr_id, closer_id } = req.query;
    const funil = resolverFunilRelatorio(req.user, req.query.funil);
    // Visão só SDR: apenas os transferidos (próprios do Closer não se aplicam)
    const origem = funil === 'sdr' ? 'transferidos' : (req.query.origem || 'transferidos');
    const etapaSel = await resolverEtapaRelatorio(req.query.estagio_id, funil);
    const dateFilterTransfer = getDateFilter(periodo, data_de, data_ate, 'l.transferido_closer_at');
    const dateFilterCreated = getDateFilter(periodo, data_de, data_ate, 'l.created_at');
    const dateFilterHist = getDateFilter(periodo, data_de, data_ate, 'h.created_at');

    const { userLeadFilter, userLeadParams } = buildRelatorioFiltrosFunil(req.user, funil, sdr_id, closer_id);

    // Aba de Situação selecionada na tela (whitelist; em_atendimento inclui pendente_aceite)
    const statusFiltroMap = {
      em_atendimento: " AND l.status_atendimento IN ('em_atendimento', 'pendente_aceite')",
      perdido: " AND l.status_atendimento = 'perdido'",
      concluido: " AND l.status_atendimento = 'concluido'"
    };
    const statusFilter = statusFiltroMap[String(req.query.status || 'all')] || '';

    const realTransferCondition = `(l.sdr_id IS NOT NULL AND l.closer_id IS NOT NULL AND l.sdr_id != l.closer_id AND l.transferido_closer_at IS NOT NULL AND EXISTS (SELECT 1 FROM users u_sdr_chk WHERE u_sdr_chk.id = l.sdr_id AND u_sdr_chk.role IN ('sdr', 'supervisor', 'admin')))`;
    const closerOwnLeadCondition = `(l.closer_id IS NOT NULL AND (l.sdr_id IS NULL OR l.sdr_id = l.closer_id OR l.transferido_closer_at IS NULL OR NOT EXISTS (SELECT 1 FROM users u_sdr_chk WHERE u_sdr_chk.id = l.sdr_id AND u_sdr_chk.role IN ('sdr', 'supervisor', 'admin'))))`;

    let whereOrigem = '';
    const paramsOrigem = [];

    if (etapaSel) {
      // Etapa selecionada: só os leads que entraram na etapa no período (coorte), na origem escolhida
      const coorteIds = etapaCoorteIdsSql(etapaSel.id, dateFilterHist);
      const condOrigem = origem === 'transferidos' ? realTransferCondition
        : origem === 'proprios' ? closerOwnLeadCondition
        : `(${realTransferCondition} OR ${closerOwnLeadCondition})`;
      whereOrigem = `(${condOrigem} AND l.id IN (${coorteIds.sql}))`;
      paramsOrigem.push(...coorteIds.params);
    } else if (origem === 'transferidos') {
      whereOrigem = `(${realTransferCondition} AND ${dateFilterTransfer.clause})`;
      paramsOrigem.push(...dateFilterTransfer.params);
    } else if (origem === 'proprios') {
      whereOrigem = `(${closerOwnLeadCondition} AND ${dateFilterCreated.clause})`;
      paramsOrigem.push(...dateFilterCreated.params);
    } else {
      whereOrigem = `((${realTransferCondition} AND ${dateFilterTransfer.clause}) OR (${closerOwnLeadCondition} AND ${dateFilterCreated.clause}))`;
      paramsOrigem.push(...dateFilterTransfer.params, ...dateFilterCreated.params);
    }

    const rows = await dbAll(`
      SELECT l.id as lead_id, l.created_at, l.transferido_closer_at, l.moved_to_stage_at,
             l.status_atendimento,
             c.nome as cliente_nome, c.cpf as cliente_cpf, c.telefone as cliente_telefone, c.email as cliente_email,
             c.valor_contrato,
             e.nome as estagio_atual, e.pipeline_tipo,
             COALESCE(NULLIF(TRIM(u_sdr.name), ''), u_sdr.username) as sdr_nome,
             COALESCE(NULLIF(TRIM(u_closer.name), ''), u_closer.username) as closer_nome,
             p.motivo as motivo_perda, p.observacao as obs_perda,
             CASE 
               WHEN ${realTransferCondition} THEN 'Transferido (SDR -> Closer)'
               WHEN ${closerOwnLeadCondition} THEN 'Próprio do Closer'
               ELSE 'Funil SDR'
             END as tipo_origem
      FROM crm_kanban_leads l
      JOIN crm_clientes c ON l.cliente_id = c.id
      LEFT JOIN crm_kanban_estagios e ON l.estagio_id = e.id
      LEFT JOIN users u_sdr ON l.sdr_id = u_sdr.id
      LEFT JOIN users u_closer ON l.closer_id = u_closer.id
      LEFT JOIN crm_leads_perdas p ON p.id = (
        SELECT p2.id FROM crm_leads_perdas p2 
        WHERE p2.lead_id = l.id 
        ORDER BY p2.created_at DESC 
        LIMIT 1
      )
      WHERE ${whereOrigem} ${userLeadFilter} ${statusFilter}
      ORDER BY COALESCE(l.transferido_closer_at, l.created_at) DESC
    `, [...paramsOrigem, ...userLeadParams]);

    const header = [
      'ID Lead',
      'Data Transf. Closer',
      'Data Criação',
      'Origem do Lead',
      'Cliente',
      'CPF',
      'Telefone',
      'E-mail',
      'SDR de Origem',
      'Closer Responsável',
      'Etapa Atual',
      'Situação',
      'Motivo Perda / Detalhe',
      'Valor Contrato'
    ];

    const csvLines = [header.map(formatCsvField).join(';')];

    for (const r of rows) {
      const dataTransfFmt = (r.transferido_closer_at ? dataHoraBrasilia(r.transferido_closer_at) : '—');
      const dataCriacaoFmt = dataHoraBrasilia(r.created_at);
      const valorFmt = r.valor_contrato ? Number(r.valor_contrato).toFixed(2).replace('.', ',') : '0,00';
      const statusMap = {
        'em_atendimento': 'Em Andamento',
        'pendente_aceite': 'Pendente Aceite',
        'concluido': 'Concluído',
        'perdido': 'Perdido'
      };
      csvLines.push([
        formatCsvField(r.lead_id),
        formatCsvField(dataTransfFmt),
        formatCsvField(dataCriacaoFmt),
        formatCsvField(r.tipo_origem || ''),
        formatCsvField(r.cliente_nome || ''),
        formatCsvField(cpfSomenteNumeros(r.cliente_cpf)),
        formatCsvField(r.cliente_telefone || ''),
        formatCsvField(r.cliente_email || ''),
        formatCsvField(r.sdr_nome || '—'),
        formatCsvField(r.closer_nome || '—'),
        formatCsvField(r.estagio_atual || '—'),
        formatCsvField(statusMap[r.status_atendimento] || r.status_atendimento),
        formatCsvField(r.motivo_perda || r.obs_perda || ''),
        formatCsvField(valorFmt)
      ].join(';'));
    }

    const csvContent = '\uFEFF' + csvLines.join('\r\n');
    const filenameDate = dataIsoBrasilia();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio_clientes_${origem}_${periodo}_${filenameDate}.csv"`);
    res.send(csvContent);
  } catch (err) {
    console.error('Erro ao exportar relatório de transferências:', err);
    res.status(500).json({ error: 'Erro ao gerar arquivo de clientes: ' + err.message });
  }
});

module.exports = router;
