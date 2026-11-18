// Relatórios: filtros, Funil, etapa e carregamento

// ==========================================================================
// MÓDULO DE RELATÓRIOS CRM ANALÍTICOS (FRONTEND LOGIC)
// ==========================================================================

let relatoriosInitialized = false;

let relatoriosAbortController = null;

let relatoriosRequestId = 0;

let relatoriosDebounceTimer = null;

function debouncedFetchAndRenderRelatorios(delay = 180) {
  if (relatoriosDebounceTimer) clearTimeout(relatoriosDebounceTimer);
  relatoriosDebounceTimer = setTimeout(() => {
    fetchAndRenderRelatorios();
  }, delay);
}

// Monta os filtros comuns (tela e exports). Em "Personalizado" exige as duas datas
// e inverte De/Até se estiverem trocadas. Retorna null quando falta alguma data.
function getRelatoriosFiltros() {
  const periodo = document.getElementById('relatorio-filter-periodo')?.value || 'mes';
  const elDe = document.getElementById('relatorio-date-de');
  const elAte = document.getElementById('relatorio-date-ate');
  let dataDe = elDe?.value || '';
  let dataAte = elAte?.value || '';

  if (periodo === 'custom') {
    if (!dataDe || !dataAte) return null;
    if (dataDe > dataAte) {
      [dataDe, dataAte] = [dataAte, dataDe];
      if (elDe) elDe.value = dataDe;
      if (elAte) elAte.value = dataAte;
    }
  }

  const funil = getRelFunil();
  // Lado que não se aplica ao funil escolhido: a seleção fica guardada, mas não é enviada
  const sdrId = funil === 'closer' ? 'all' : relIdsSelecionados('relatorio-filter-sdr');
  const closerId = funil === 'sdr' ? 'all' : relIdsSelecionados('relatorio-filter-closer');
  const estagioId = relEstagioSelecionado();

  let qs = `periodo=${encodeURIComponent(periodo)}&sdr_id=${encodeURIComponent(sdrId)}&closer_id=${encodeURIComponent(closerId)}`;
  if (periodo === 'custom') qs += `&data_de=${encodeURIComponent(dataDe)}&data_ate=${encodeURIComponent(dataAte)}`;
  qs += `&funil=${encodeURIComponent(funil)}`;
  if (estagioId) qs += `&estagio_id=${encodeURIComponent(estagioId)}`;

  return { periodo, dataDe, dataAte, sdrId, closerId, funil, estagioId, qs };
}

// ----- Funil (Ambos | Só SDR | Só Closer) e Etapa -----
let relFunilAtual = 'ambos';

// Perfis sdr/closer ficam travados no próprio funil (o servidor também trava)
function relFunilTravado() {
  const u = typeof getUser === 'function' ? getUser() : null;
  if (u && u.role === 'sdr') return 'sdr';
  if (u && u.role === 'closer') return 'closer';
  return null;
}

function getRelFunil() {
  return relFunilTravado() || relFunilAtual;
}

// Ids selecionados, ou 'all' quando nenhum ou todos estão marcados (todos = sem filtro)
function relIdsSelecionados(filterId) {
  const sel = CrmState.selectedUsers?.[filterId] || [];
  const meta = CrmState.multiSelectMeta?.[filterId];
  if (sel.length === 0) return document.getElementById(filterId)?.value || 'all';
  if (meta && meta.quick && meta.total > 0 && sel.length >= meta.total) return 'all';
  return sel.join(',');
}

function relEstagioSelecionado() {
  const v = document.getElementById('relatorio-filter-estagio')?.value || '';
  return /^\d+$/.test(v) ? v : '';
}

// Atualiza botões do Funil e o estado (des)habilitado das listas de pessoas
function aplicarEstadoFunilRelatorio() {
  const funil = getRelFunil();
  const seg = document.getElementById('rel-funil-seg');
  if (seg) {
    seg.hidden = !!relFunilTravado();
    seg.querySelectorAll('button[data-funil]').forEach(btn => {
      const on = btn.dataset.funil === funil;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }
  setRelMultiSelectDisabled('relatorio-filter-sdr', funil === 'closer');
  setRelMultiSelectDisabled('relatorio-filter-closer', funil === 'sdr');
}

function setRelMultiSelectDisabled(filterId, disabled) {
  const trigger = document.getElementById(`${filterId}-trigger`);
  const menu = document.getElementById(`${filterId}-menu`);
  if (!trigger) return;
  const wrap = trigger.closest('.custom-multiselect');
  if (wrap) wrap.classList.toggle('is-disabled', disabled);
  if (disabled) {
    trigger.setAttribute('aria-disabled', 'true');
    trigger.setAttribute('tabindex', '-1');
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    if (menu) menu.classList.add('hidden');
  } else {
    trigger.removeAttribute('aria-disabled');
    trigger.setAttribute('tabindex', '0');
  }
  const base = filterId.includes('sdr') ? 'Filtrar por SDR' : 'Filtrar por Closer';
  trigger.setAttribute('aria-label', disabled ? `${base} (não se aplica ao funil escolhido)` : base);
  const labelEl = trigger.querySelector('.custom-multiselect-label');
  const meta = CrmState.multiSelectMeta?.[filterId];
  if (labelEl && meta && meta.quick) {
    // Reaproveita a regra de rótulo do multiselect (inclui "(não se aplica)")
    const map = relUserMaps[filterId] || new Map();
    renderMultiSelectTriggerLabel(filterId, filterId.includes('sdr') ? 'Todos os SDRs' : 'Todos os Closers', map);
  }
}

const relUserMaps = {};

let relEstagiosLista = null;

async function carregarEstagiosRelatorio() {
  if (Array.isArray(CrmState.estagios) && CrmState.estagios.length > 0) {
    relEstagiosLista = CrmState.estagios;
  } else {
    const res = await apiFetch('/api/crm/kanban/estagios');
    relEstagiosLista = Array.isArray(res) ? res : [];
  }
  popularSelectEstagiosRelatorio();
}

// "Todas as etapas" + optgroups Funil SDR / Funil Closer (só o funil escolhido quando não é "Ambos").
// Se a etapa escolhida não pertence ao funil, volta para "Todas". Retorna true se resetou.
function popularSelectEstagiosRelatorio() {
  const select = document.getElementById('relatorio-filter-estagio');
  if (!select) return false;
  const atual = select.value;
  const funil = getRelFunil();
  const ativos = (relEstagiosLista || []).filter(e => e && e.ativo !== false && (e.pipeline_tipo === 'sdr' || e.pipeline_tipo === 'closer'));
  const grupos = [['sdr', 'Funil SDR'], ['closer', 'Funil Closer']].filter(([p]) => funil === 'ambos' || funil === p);

  select.innerHTML = '';
  const optTodas = document.createElement('option');
  optTodas.value = '';
  optTodas.textContent = 'Todas as etapas';
  select.appendChild(optTodas);

  let manteve = false;
  grupos.forEach(([pipeline, rotulo]) => {
    const lista = ativos
      .filter(e => e.pipeline_tipo === pipeline)
      .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0));
    if (lista.length === 0) return;
    const og = document.createElement('optgroup');
    og.label = rotulo;
    lista.forEach(e => {
      const opt = document.createElement('option');
      opt.value = String(e.id);
      opt.textContent = e.nome || `Etapa ${e.id}`;
      if (String(e.id) === String(atual)) { opt.selected = true; manteve = true; }
      og.appendChild(opt);
    });
    select.appendChild(og);
  });
  if (!manteve) select.value = '';
  return !!atual && !manteve;
}

function limparEtapaRelatorio() {
  const select = document.getElementById('relatorio-filter-estagio');
  if (select && select.value) {
    select.value = '';
    fetchAndRenderRelatorios();
  }
}

// Horas -> "< 1 h", "N h", "N d N h"
function formatarHorasEtapa(horas) {
  const h = parseFloat(horas);
  if (horas === null || horas === undefined || !Number.isFinite(h)) return '—';
  if (h < 1) return '< 1 h';
  const total = Math.round(h);
  if (total < 24) return `${total} h`;
  return `${Math.floor(total / 24)} d ${total % 24} h`;
}

function relNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Ajusta a grade de KPIs aos cartões visíveis para não sobrar buraco:
// 4 ou 3 colunas no desktop (o destaque ocupa 2), e o último cartão ocupa 2 quando sobra 1 vaga.
function ajustarGradeKpisRelatorio(grid) {
  if (!grid) return;
  const cards = Array.from(grid.children).filter(c => c.classList.contains('kpi-card') && !c.hidden);
  cards.forEach(c => c.classList.remove('rel-kpi-span-d2', 'rel-kpi-span-m2'));
  grid.classList.remove('rel-kpi-grid--c3');
  if (cards.length === 0) return;
  const slots = cards.reduce((acc, c) => acc + (c.classList.contains('highlight-card') ? 2 : 1), 0);
  const last = cards[cards.length - 1];
  if (slots % 4 === 0) {
    // 4 colunas, sem ajuste
  } else if (slots % 3 === 0) {
    grid.classList.add('rel-kpi-grid--c3');
  } else if (slots % 4 === 3) {
    last.classList.add('rel-kpi-span-d2');
  } else {
    grid.classList.add('rel-kpi-grid--c3');
    if (slots % 3 === 2) last.classList.add('rel-kpi-span-d2');
  }
  // Celular (2 colunas): número ímpar de vagas -> último ocupa a linha toda
  if (slots % 2 === 1 && !last.classList.contains('highlight-card')) last.classList.add('rel-kpi-span-m2');
}

const REL_CUSTOM_DATES_MSG = 'Preencha as duas datas do período personalizado.';

// Aviso fixo junto aos filtros enquanto o Personalizado está incompleto
// (os números na tela continuam sendo os do período anterior)
function atualizarAvisoDatasRelatorio() {
  const aviso = document.getElementById('rel-custom-hint');
  if (!aviso) return;
  const periodo = document.getElementById('relatorio-filter-periodo')?.value;
  const de = document.getElementById('relatorio-date-de')?.value;
  const ate = document.getElementById('relatorio-date-ate')?.value;
  aviso.hidden = !(periodo === 'custom' && (!de || !ate));
}

async function initCrmRelatorios() {
  if (!relatoriosInitialized) {
    relatoriosInitialized = true;
    setupRelatoriosEventListeners();
    await Promise.all([loadRelatorioUsersFilter(), carregarEstagiosRelatorio().catch(() => {})]);
  }
  await fetchAndRenderRelatorios();
}

function setupRelatoriosEventListeners() {
  const selectPeriodo = document.getElementById('relatorio-filter-periodo');
  const customDates = document.getElementById('relatorio-custom-dates');
  const btnRefresh = document.getElementById('btn-refresh-relatorios');
  const btnConfigMeta = document.getElementById('btn-config-meta');
  const dateDe = document.getElementById('relatorio-date-de');
  const dateAte = document.getElementById('relatorio-date-ate');
  const btnExportPerdas = document.getElementById('btn-export-perdas-csv');
  const btnExportTransf = document.getElementById('btn-export-transferidos-csv');

  if (selectPeriodo) {
    selectPeriodo.addEventListener('change', () => {
      atualizarAvisoDatasRelatorio();
      if (selectPeriodo.value === 'custom') {
        if (customDates) customDates.style.display = 'flex';
        // Só busca quando as duas datas já estão preenchidas
        if (getRelatoriosFiltros()) debouncedFetchAndRenderRelatorios(50);
      } else {
        if (customDates) customDates.style.display = 'none';
        debouncedFetchAndRenderRelatorios(50);
      }
    });
  }

  if (dateDe) dateDe.addEventListener('change', () => { atualizarAvisoDatasRelatorio(); debouncedFetchAndRenderRelatorios(150); });
  if (dateAte) dateAte.addEventListener('change', () => { atualizarAvisoDatasRelatorio(); debouncedFetchAndRenderRelatorios(150); });
  if (btnRefresh) btnRefresh.addEventListener('click', () => {
    if (!getRelatoriosFiltros()) {
      showToast(REL_CUSTOM_DATES_MSG, 'error');
      return;
    }
    fetchAndRenderRelatorios();
  });
  if (btnConfigMeta) btnConfigMeta.addEventListener('click', handleConfigMetaClick);

  const segFunil = document.getElementById('rel-funil-seg');
  if (segFunil) {
    segFunil.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-funil]');
      if (!btn || relFunilTravado()) return;
      const novo = btn.dataset.funil;
      if (!['ambos', 'sdr', 'closer'].includes(novo) || novo === relFunilAtual) return;
      relFunilAtual = novo;
      aplicarEstadoFunilRelatorio();
      popularSelectEstagiosRelatorio();
      debouncedFetchAndRenderRelatorios(50);
    });
  }
  const selEstagio = document.getElementById('relatorio-filter-estagio');
  if (selEstagio) selEstagio.addEventListener('change', () => debouncedFetchAndRenderRelatorios(50));
  const btnLimparEtapa = document.getElementById('btn-rel-limpar-etapa');
  if (btnLimparEtapa) btnLimparEtapa.addEventListener('click', limparEtapaRelatorio);
  if (btnExportPerdas) btnExportPerdas.addEventListener('click', exportPerdasCsv);
  if (btnExportTransf) btnExportTransf.addEventListener('click', exportTransferidosCsv);

  const tabsOrigem = document.getElementById('tabs-origem-filtro');
  if (tabsOrigem) {
    tabsOrigem.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tab-origem]');
      if (btn) {
        currentTransferidosOrigemFilter = btn.getAttribute('data-tab-origem');
        aplicarFiltrosTabelaTransferidos();
      }
    });
  }

  const tabsTransf = document.getElementById('tabs-transferidos-filtro');
  if (tabsTransf) {
    tabsTransf.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tab-status]');
      if (btn) {
        currentTransferidosStatusFilter = btn.getAttribute('data-tab-status');
        aplicarFiltrosTabelaTransferidos();
      }
    });
  }
}

async function loadRelatorioUsersFilter() {
  try {
    let users = [];
    const res = await fetchWithAuth('/api/crm/usuarios-filtro');
    if (res && res.ok) {
      users = await res.json();
    } else {
      const resFallback = await fetchWithAuth('/api/users');
      if (resFallback && resFallback.ok) {
        users = await resFallback.json();
      }
    }

    const currentUser = typeof getUser === 'function' ? getUser() : null;
    const isSdrRestrict = currentUser && currentUser.role === 'sdr';
    const isCloserRestrict = currentUser && currentUser.role === 'closer';

    // Map SDRs
    const sdrMap = new Map();
    users
      .filter(u => u.role === 'sdr') // Admin/Supervisor nunca são SDR
      .forEach(u => {
        const uName = (u.name && u.name.trim()) || u.username;
        if (uName) sdrMap.set(String(u.id), uName);
      });

    // Map Closers
    const closerMap = new Map();
    users
      .filter(u => u.role === 'closer' || u.role === 'admin' || u.role === 'supervisor')
      .forEach(u => {
        const uName = (u.name && u.name.trim()) || u.username;
        if (uName) closerMap.set(String(u.id), uName);
      });

    relUserMaps['relatorio-filter-sdr'] = sdrMap;
    relUserMaps['relatorio-filter-closer'] = closerMap;

    setupCustomMultiSelect(
      'relatorio-filter-sdr',
      'Todos os SDRs',
      sdrMap,
      'relatorios',
      isSdrRestrict,
      currentUser,
      () => debouncedFetchAndRenderRelatorios(180),
      { quickActions: true, entity: 'SDRs' }
    );

    setupCustomMultiSelect(
      'relatorio-filter-closer',
      'Todos os Closers',
      closerMap,
      'relatorios',
      isCloserRestrict,
      currentUser,
      () => debouncedFetchAndRenderRelatorios(180),
      { quickActions: true, entity: 'Closers' }
    );
    aplicarEstadoFunilRelatorio();
  } catch (err) {
    console.error('Erro ao carregar lista de usuários para filtro de relatórios:', err);
  }
}

async function fetchAndRenderRelatorios() {
  if (relatoriosDebounceTimer) {
    clearTimeout(relatoriosDebounceTimer);
    relatoriosDebounceTimer = null;
  }

  // Personalizado sem as duas datas: não busca (o usuário ainda está preenchendo)
  const filtros = getRelatoriosFiltros();
  if (!filtros) return;

  // Cancelar requisição anterior em andamento para evitar race conditions e troca de dados
  if (relatoriosAbortController) {
    try {
      relatoriosAbortController.abort();
    } catch (_) {}
  }
  relatoriosAbortController = new AbortController();
  const currentReqId = ++relatoriosRequestId;
  document.getElementById('view-crm-relatorios')?.setAttribute('aria-busy', 'true');

  const btnRefresh = document.getElementById('btn-refresh-relatorios');
  const refreshIcon = btnRefresh ? (btnRefresh.querySelector('i[data-lucide="refresh-cw"]') || btnRefresh.querySelector('svg')) : null;
  if (btnRefresh) {
    btnRefresh.disabled = true;
    btnRefresh.style.opacity = '0.7';
  }
  if (refreshIcon) {
    refreshIcon.style.animation = 'spin 1s linear infinite';
  }

  try {
    const periodo = filtros.periodo;
    const url = `/api/crm/relatorios?${filtros.qs}`;

    const res = await fetchWithAuth(url, { signal: relatoriosAbortController.signal });

    // Descartar se uma requisição mais recente já foi disparada
    if (currentReqId !== relatoriosRequestId) return;

    if (!res || !res.ok) {
      const errData = await res.json().catch(() => ({}));
      showToast(errData.error || 'Erro ao carregar dados do relatório.', 'error');
      return;
    }

    const data = await res.json();
    if (currentReqId !== relatoriosRequestId) return;
    data.kpis = data.kpis || {};
    data.perdas = data.perdas || {};
    data.prospeccoes = data.prospeccoes || {};
    data.rankings = data.rankings || {};

    // Análise de uma etapa: só quando o servidor devolve "etapa" válida (servidor antigo = modo normal)
    const etapa = data.etapa && typeof data.etapa === 'object' && data.etapa.estagio ? data.etapa : null;
    if (!etapa && filtros.estagioId) {
      // Etapa inválida para o servidor: volta para "Todas" sem refazer a busca
      const selEtapa = document.getElementById('relatorio-filter-estagio');
      if (selEtapa) selEtapa.value = '';
    }
    const visao = data.visao && typeof data.visao === 'object' ? data.visao : {};

    // Visibilidade por escopo (campos novos; resposta antiga = tudo visível)
    const ocultarProprios = data.kpis.ocultar_proprios === true;
    const ocultarProsp = data.prospeccoes.ocultar === true;
    const cardProsp = document.getElementById('kpi-card-rel-prospectados');
    const cardProprios = document.getElementById('kpi-card-rel-proprios');
    const cardTempoAceite = document.getElementById('kpi-card-rel-sla');
    const panelProsp = document.getElementById('rel-panel-prospeccao');
    if (cardProsp) cardProsp.hidden = ocultarProsp;
    if (panelProsp) panelProsp.hidden = ocultarProsp && !etapa;
    if (cardProprios) cardProprios.hidden = ocultarProprios;
    if (cardTempoAceite) cardTempoAceite.hidden = visao.mostrar_tempo_aceite === false;
    // Com filtro de SDR, a tabela mostra só as transferências dele (sem abas Próprios/Todos)
    document.querySelectorAll('#tabs-origem-filtro [data-tab-origem="proprios"], #tabs-origem-filtro [data-tab-origem="todos"]')
      .forEach(btn => { btn.hidden = ocultarProprios; });
    if (ocultarProprios && currentTransferidosOrigemFilter !== 'transferidos') {
      currentTransferidosOrigemFilter = 'transferidos';
    }
    const kpiGrid = document.getElementById('rel-kpi-grid-geral');
    if (kpiGrid) {
      kpiGrid.hidden = !!etapa;
      ajustarGradeKpisRelatorio(kpiGrid);
    }

    // Rótulos que mudam com o funil (resposta antiga mantém os textos padrão)
    const elProspRotulo = document.getElementById('kpi-rel-prospectados-rotulo');
    if (elProspRotulo) elProspRotulo.textContent = data.prospeccoes.rotulo || 'Novos leads no funil';
    const elPassagensTitulo = document.getElementById('kpi-rel-transferidos-titulo');
    if (elPassagensTitulo) elPassagensTitulo.textContent = data.kpis.rotulo_passagens || 'Passagens ao Closer';

    // 1. Render KPIs
    const elProspectados = document.getElementById('kpi-rel-prospectados');
    const elTransferidos = document.getElementById('kpi-rel-transferidos');
    const elTransferidosAndamento = document.getElementById('kpi-rel-transferidos-andamento');
    const elTransferidosPerdidos = document.getElementById('kpi-rel-transferidos-perdidos');
    const elTaxaPerdaCloser = document.getElementById('kpi-rel-taxa-perda-closer');
    const elPropriosTotal = document.getElementById('kpi-rel-proprios-total');
    const elPropriosSub = document.getElementById('kpi-rel-proprios-sub');
    const elPerdas = document.getElementById('kpi-rel-perdas');
    const elPerdasSub = document.getElementById('kpi-rel-perdas-sub');
    const elSla = document.getElementById('kpi-rel-sla');

    if (elProspectados) elProspectados.textContent = (data.kpis.prospectados || 0).toLocaleString('pt-BR');
    if (elTransferidos) elTransferidos.textContent = (data.kpis.transferidos || 0).toLocaleString('pt-BR');
    if (elTransferidosAndamento) elTransferidosAndamento.textContent = (data.kpis.transferidos_em_andamento || 0).toLocaleString('pt-BR');
    if (elTransferidosPerdidos) elTransferidosPerdidos.textContent = (data.kpis.transferidos_perdidos || 0).toLocaleString('pt-BR');
    if (elTaxaPerdaCloser) {
      const taxa = parseFloat(data.kpis.taxa_perda_closer);
      elTaxaPerdaCloser.textContent = `${(Number.isFinite(taxa) ? taxa : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    }
    
    if (elPropriosTotal) elPropriosTotal.textContent = (data.kpis.proprios_total || 0).toLocaleString('pt-BR');
    if (elPropriosSub) {
      const andam = (data.kpis.proprios_em_andamento || 0).toLocaleString('pt-BR');
      const perd = (data.kpis.proprios_perdidos || 0).toLocaleString('pt-BR');
      elPropriosSub.textContent = `${andam} em andamento • ${perd} perdidos`;
    }

    // Perdas registradas no período (mesma contagem do "Registro de perdas", respeitando os filtros)
    const perdasInfo = data.perdas || {};
    const totalPerdasRaw = perdasInfo.recentes_total ?? perdasInfo.total ?? 0;
    const totalPerdas = parseInt(totalPerdasRaw, 10) || 0;
    if (elPerdas) elPerdas.textContent = totalPerdas.toLocaleString('pt-BR');
    if (elPerdasSub) {
      if (perdasInfo.escopo === 'sdr') {
        const posTotal = parseInt(perdasInfo.pos_transferencia?.total, 10) || 0;
        elPerdasSub.textContent = posTotal > 0
          ? `No funil do SDR • ${posTotal.toLocaleString('pt-BR')} após a transferência`
          : 'No funil do SDR';
      } else if (perdasInfo.escopo === 'closer') {
        elPerdasSub.textContent = 'No funil do Closer';
      } else {
        elPerdasSub.textContent = 'Registradas no período';
      }
    }

    if (elSla) elSla.textContent = `${data.kpis.tempo_medio_resposta_min || '0.0'} min`;

    // 2. Render Análise de Perdas
    renderPerdasEscopo(data.perdas);
    renderPerdasMotivos(data.perdas.por_motivo, 'chart-rel-motivos-perda',
      etapa ? 'Nenhuma perda registrada nesta etapa no período.' : undefined);
    renderPerdasEstagios(data.perdas.por_estagio);
    renderPerdasPosTransferencia(data.perdas);
    renderPerdasRecentes(data.perdas);

    // 3. Render Detalhes de Clientes Transferidos
    renderTransferidosDetalhes(data.transferidos_detalhes || [], data.transferidos_contagens || null);

    // 4. Render Prospecção & Meta (na análise de etapa: entradas por dia na etapa)
    renderMetaProspeccao(data.prospeccoes, periodo);
    if (etapa) {
      renderEvolucaoDiaria(etapa.evolucao_diaria, 'Sem entradas nesta etapa no período.', 'entradas');
    } else {
      renderEvolucaoDiaria(data.prospeccoes.evolucao_diaria);
    }
    const elEvoTitulo = document.getElementById('rel-evolucao-titulo');
    if (elEvoTitulo) {
      elEvoTitulo.textContent = etapa
        ? 'Entradas por dia'
        : (data.prospeccoes.rotulo && visao.funil && visao.funil !== 'ambos'
          ? `Evolução: ${data.prospeccoes.rotulo}`
          : 'Evolução de novos leads');
    }

    // 5. Render Rankings (a visão do funil pode esconder um dos lados)
    const cardRankSdr = document.getElementById('rel-card-ranking-sdrs');
    const cardRankCloser = document.getElementById('rel-card-ranking-closers');
    if (cardRankSdr) cardRankSdr.hidden = visao.mostrar_ranking_sdr === false;
    if (cardRankCloser) cardRankCloser.hidden = visao.mostrar_ranking_closer === false;
    renderRankingSdrs(data.rankings.sdrs);
    renderRankingClosers(data.rankings.closers);

    // 6. Modo "análise da etapa"
    renderAnaliseEtapa(etapa);

    if (window.lucide) lucide.createIcons();

  } catch (err) {
    if (err.name === 'AbortError') {
      // Abortado silenciosamente em virtude de um filtro mais recente
      return;
    }
    console.error('Erro ao buscar relatórios CRM:', err);
    if (currentReqId === relatoriosRequestId) {
      showToast('Falha na comunicação com o servidor ao gerar relatórios.', 'error');
    }
  } finally {
    if (currentReqId === relatoriosRequestId) {
      document.getElementById('view-crm-relatorios')?.removeAttribute('aria-busy');
      if (btnRefresh) {
        btnRefresh.disabled = false;
        btnRefresh.style.opacity = '';
      }
      if (refreshIcon) {
        refreshIcon.style.animation = '';
      }
    }
  }
}

window.initCrmRelatorios = initCrmRelatorios;

window.fetchAndRenderRelatorios = fetchAndRenderRelatorios;

window.debouncedFetchAndRenderRelatorios = debouncedFetchAndRenderRelatorios;
