const { dbGet } = require('../../database');
const { SQL_HOJE_LOCAL, TZ_LOCAL, sqlIntervaloDatasLocal, sqlLocalParaUtc } = require('../utils/fuso-horario');

function getDateFilter(periodo, dataDe, dataAte, dateColumn = 'l.created_at') {
  if (periodo === 'custom') {
    // Personalizado: aceita só datas YYYY-MM-DD; com uma data só, vira intervalo de um dia; De > Até é invertido
    const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) ? v.trim() : null;
    let de = isoDate(dataDe);
    let ate = isoDate(dataAte);
    if (de && !ate) ate = de;
    if (ate && !de) de = ate;
    if (de && ate) {
      if (de > ate) [de, ate] = [ate, de];
      return { clause: sqlIntervaloDatasLocal(dateColumn), params: [de, ate] };
    }
    // Sem nenhuma data válida: cai no padrão 'mes' (abaixo)
  }
  if (periodo === 'todos') {
    // Sem recorte de data, mas mantém a exigência de a data existir (mesma semântica dos demais períodos)
    return { clause: `${dateColumn} IS NOT NULL`, params: [] };
  } else if (periodo === 'hoje') {
    return { clause: `${dateColumn} >= ${sqlLocalParaUtc(SQL_HOJE_LOCAL)} AND ${dateColumn} < ${sqlLocalParaUtc(`${SQL_HOJE_LOCAL} + INTERVAL '1 day'`)}`, params: [] };
  } else if (periodo === 'ontem') {
    return { clause: `${dateColumn} >= ${sqlLocalParaUtc(`${SQL_HOJE_LOCAL} - INTERVAL '1 day'`)} AND ${dateColumn} < ${sqlLocalParaUtc(SQL_HOJE_LOCAL)}`, params: [] };
  } else if (periodo === '7dias') {
    // Hoje + 6 dias anteriores (mesmo critério do filtro do Kanban)
    return { clause: `${dateColumn} >= ${sqlLocalParaUtc(`${SQL_HOJE_LOCAL} - INTERVAL '6 days'`)}`, params: [] };
  } else if (periodo === 'semana') {
    return { clause: `${dateColumn} >= ${sqlLocalParaUtc(`DATE_TRUNC('week', NOW() AT TIME ZONE '${TZ_LOCAL}')`)}`, params: [] };
  } else if (periodo === '30d') {
    return { clause: `${dateColumn} >= ${sqlLocalParaUtc(`${SQL_HOJE_LOCAL} - INTERVAL '30 days'`)}`, params: [] };
  } else {
    // Default 'mes'
    return { clause: `${dateColumn} >= ${sqlLocalParaUtc(`DATE_TRUNC('month', NOW() AT TIME ZONE '${TZ_LOCAL}')`)}`, params: [] };
  }
}

// Filtros de usuário dos Relatórios, separados em lado SDR (l.sdr_id) e lado Closer (l.closer_id).
// Perfil sdr/closer logado sempre fica restrito a si mesmo no próprio lado (não pode ampliar via query).
function buildRelatorioUserFilters(user, sdr_id, closer_id) {
  let sdrSideFilter = '';
  const sdrSideParams = [];
  let closerSideFilter = '';
  const closerSideParams = [];

  if (user.role === 'sdr') {
    sdrSideFilter = ' AND l.sdr_id = ?';
    sdrSideParams.push(user.id);
  } else if (sdr_id && sdr_id !== 'all') {
    const sdrList = String(sdr_id).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (sdrList.length === 1) {
      sdrSideFilter = ' AND l.sdr_id = ?';
      sdrSideParams.push(sdrList[0]);
    } else if (sdrList.length > 1) {
      sdrSideFilter = ` AND l.sdr_id IN (${sdrList.map(() => '?').join(',')})`;
      sdrSideParams.push(...sdrList);
    }
  }

  if (user.role === 'closer') {
    closerSideFilter = ' AND l.closer_id = ?';
    closerSideParams.push(user.id);
  } else if (closer_id && closer_id !== 'all') {
    const closerList = String(closer_id).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (closerList.length === 1) {
      closerSideFilter = ' AND l.closer_id = ?';
      closerSideParams.push(closerList[0]);
    } else if (closerList.length > 1) {
      closerSideFilter = ` AND l.closer_id IN (${closerList.map(() => '?').join(',')})`;
      closerSideParams.push(...closerList);
    }
  }

  const hasSdrSide = sdrSideFilter !== '';
  const hasCloserSide = closerSideFilter !== '';
  // Escopo das perdas (D2): só SDR -> funil SDR; só Closer -> funil Closer; nenhum ou ambos -> todas
  const escopoPerdas = hasSdrSide && !hasCloserSide ? 'sdr' : (hasCloserSide && !hasSdrSide ? 'closer' : 'todos');

  return {
    sdrSideFilter, sdrSideParams, closerSideFilter, closerSideParams,
    userLeadFilter: sdrSideFilter + closerSideFilter,
    userLeadParams: [...sdrSideParams, ...closerSideParams],
    hasSdrSide, hasCloserSide, escopoPerdas
  };
}

// Pipeline em que a perda aconteceu (requer "LEFT JOIN crm_kanban_estagios pe ON pe.id = p.estagio_id").
// Etapa apagada (estagio_id NULL): 'closer' se o lead já tinha sido transferido quando foi perdido, senão 'sdr'.
const PERDA_PIPELINE_EXPR = `COALESCE(pe.pipeline_tipo, CASE WHEN l.transferido_closer_at IS NOT NULL AND l.transferido_closer_at <= p.created_at THEN 'closer' ELSE 'sdr' END)`;

function perdaEscopoClause(escopo) {
  if (escopo === 'sdr') return ` AND ${PERDA_PIPELINE_EXPR} = 'sdr'`;
  if (escopo === 'closer') return ` AND ${PERDA_PIPELINE_EXPR} = 'closer'`;
  return '';
}

// Funil analisado nos Relatórios: 'ambos' | 'sdr' | 'closer'. Perfil sdr/closer logado fica preso ao próprio funil.
function resolverFunilRelatorio(user, funil) {
  if (user.role === 'sdr') return 'sdr';
  if (user.role === 'closer') return 'closer';
  return funil === 'sdr' || funil === 'closer' ? funil : 'ambos';
}

// Filtros de usuário conforme o funil: na visão SDR o filtro de Closer é ignorado, e vice-versa
// (o travamento por perfil continua valendo dentro de buildRelatorioUserFilters).
function buildRelatorioFiltrosFunil(user, funil, sdr_id, closer_id) {
  return buildRelatorioUserFilters(
    user,
    funil === 'closer' ? undefined : sdr_id,
    funil === 'sdr' ? undefined : closer_id
  );
}

// Escopo das perdas: funil escolhido manda; em 'ambos' segue a regra D2 (pelos filtros de pessoas)
function escopoPerdasPorFunil(funil, escopoPelosFiltros) {
  return funil === 'sdr' || funil === 'closer' ? funil : escopoPelosFiltros;
}

// Etapa selecionada nos Relatórios (uma por vez). Inválida (inexistente ou de outro funil) => null.
async function resolverEtapaRelatorio(estagio_id, funil) {
  const id = parseInt(String(estagio_id ?? '').trim(), 10);
  if (!Number.isInteger(id) || id <= 0 || String(id) !== String(estagio_id).trim()) return null;
  const etapa = await dbGet('SELECT id, nome, pipeline_tipo, cor, ordem, sla_horas FROM crm_kanban_estagios WHERE id = ?', [id]);
  if (!etapa || !etapa.id) return null;
  if (etapa.pipeline_tipo !== 'sdr' && etapa.pipeline_tipo !== 'closer') return null;
  if (funil !== 'ambos' && etapa.pipeline_tipo !== funil) return null;
  return etapa;
}

// Leads que ENTRARAM na etapa no período (coorte), para usar em "l.id IN (...)".
// Entrada = linha do histórico com estagio_novo_id = E vinda de outra etapa (ou criação).
function etapaCoorteIdsSql(estagioId, dateFilterHist) {
  return {
    sql: `SELECT h.lead_id FROM crm_kanban_historico h
          WHERE h.estagio_novo_id = ? AND (h.estagio_anterior_id IS NULL OR h.estagio_anterior_id <> ?) AND ${dateFilterHist.clause}`,
    params: [estagioId, estagioId, ...dateFilterHist.params]
  };
}

// CTEs "entradas" (primeira entrada de cada lead na etapa no período, com filtros de usuário em l)
// e "coorte" (uma linha por lead, com flags de saída após a entrada). Requer "WITH" antes.
function etapaCoorteCte(estagioId, dateFilterHist, userLeadFilter, userLeadParams) {
  return {
    sql: `entradas AS (
        SELECT h.lead_id, MIN(h.created_at) AS entrada_em
        FROM crm_kanban_historico h
        JOIN crm_kanban_leads l ON l.id = h.lead_id
        WHERE h.estagio_novo_id = ? AND (h.estagio_anterior_id IS NULL OR h.estagio_anterior_id <> ?)
          AND ${dateFilterHist.clause} ${userLeadFilter}
        GROUP BY h.lead_id
      ),
      coorte AS (
        -- Cada lead da coorte cai em UMA categoria, pela PRIMEIRA saída da etapa após a entrada:
        -- avanco | volta | perda | ainda (sem saída e ainda na etapa) | outro (resto)
        -- => entraram = avancaram + voltaram + perdidos + ainda_na_etapa + outros
        SELECT en.lead_id, en.entrada_em, l.sdr_id, l.closer_id, l.estagio_id, l.status_atendimento,
               e.id AS etapa_id, s.saida_em,
               CASE
                 WHEN s.saida_em IS NULL THEN
                   CASE WHEN l.estagio_id = e.id AND COALESCE(l.status_atendimento, '') <> 'perdido' THEN 'ainda' ELSE 'outro' END
                 WHEN s.estagio_novo_id IS NULL THEN 'perda'
                 WHEN (e.pipeline_tipo = 'sdr' AND s.destino_pipeline = 'closer')
                   OR (s.destino_pipeline = e.pipeline_tipo AND s.destino_ordem > e.ordem) THEN 'avanco'
                 WHEN s.destino_pipeline = e.pipeline_tipo AND s.destino_ordem < e.ordem THEN 'volta'
                 ELSE 'outro'
               END AS resultado
        FROM entradas en
        JOIN crm_kanban_leads l ON l.id = en.lead_id
        JOIN crm_kanban_estagios e ON e.id = ?
        LEFT JOIN LATERAL (
          SELECT h2.created_at AS saida_em, h2.estagio_novo_id,
                 d.pipeline_tipo AS destino_pipeline, d.ordem AS destino_ordem
          FROM crm_kanban_historico h2
          LEFT JOIN crm_kanban_estagios d ON d.id = h2.estagio_novo_id
          WHERE h2.lead_id = en.lead_id AND h2.estagio_anterior_id = e.id
            AND (h2.estagio_novo_id IS NULL OR h2.estagio_novo_id <> e.id)
            AND h2.created_at >= en.entrada_em
          ORDER BY h2.created_at ASC, h2.id ASC
          LIMIT 1
        ) s ON TRUE
      )`,
    params: [estagioId, estagioId, ...dateFilterHist.params, ...userLeadParams, estagioId]
  };
}

module.exports = { PERDA_PIPELINE_EXPR, buildRelatorioFiltrosFunil, escopoPerdasPorFunil, etapaCoorteCte, etapaCoorteIdsSql, getDateFilter, perdaEscopoClause, resolverEtapaRelatorio, resolverFunilRelatorio };
