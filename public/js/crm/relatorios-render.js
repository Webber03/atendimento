// Relatórios: desenho dos painéis, tabelas e exportações

// Liga/desliga o modo "análise da etapa": KPIs da etapa, faixa com o nome, painéis adaptados
function renderAnaliseEtapa(etapa) {
  const ativo = !!etapa;
  const view = document.getElementById('view-crm-relatorios');
  if (view) view.classList.toggle('rel-modo-etapa', ativo);

  const banner = document.getElementById('rel-etapa-banner');
  const gridEtapa = document.getElementById('rel-kpi-grid-etapa');
  const gridRankings = document.getElementById('rel-grid-rankings');
  const cardRankEtapa = document.getElementById('rel-card-ranking-etapa');
  const subEtapas = document.getElementById('rel-subpanel-etapas');
  const metaBlock = document.getElementById('rel-meta-block');
  const metaHint = document.getElementById('rel-meta-hint');
  const btnMeta = document.getElementById('btn-config-meta');
  const tituloProsp = document.getElementById('rel-prosp-titulo');
  const tituloPerdas = document.getElementById('rel-perdas-titulo');

  if (banner) banner.hidden = !ativo;
  if (gridEtapa) gridEtapa.hidden = !ativo;
  if (gridRankings) gridRankings.hidden = ativo;
  if (cardRankEtapa) cardRankEtapa.hidden = !ativo;
  if (subEtapas) subEtapas.hidden = ativo;
  if (btnMeta) btnMeta.hidden = ativo;
  if (tituloProsp) tituloProsp.textContent = ativo ? 'Entradas na etapa' : 'Prospecção e meta';
  if (tituloPerdas) tituloPerdas.textContent = ativo ? 'Perdas nesta etapa' : 'Perdas por motivo e etapa';
  if (!ativo) return;

  // renderMetaProspeccao já rodou; na análise da etapa a meta mensal não se aplica
  if (metaBlock) metaBlock.hidden = true;
  if (metaHint) metaHint.hidden = true;

  const est = etapa.estagio || {};
  const funilNome = est.pipeline_tipo === 'closer' ? 'Funil Closer' : (est.pipeline_tipo === 'sdr' ? 'Funil SDR' : '');
  const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setTxt('rel-etapa-banner-nome', est.nome || 'selecionada');
  setTxt('rel-etapa-banner-funil', funilNome ? ` (${funilNome})` : '');
  const dot = document.getElementById('rel-etapa-banner-dot');
  if (dot) dot.style.background = /^#[0-9a-f]{3,8}$/i.test(est.cor || '') ? est.cor : '#71717a';

  const fmt = n => relNum(n).toLocaleString('pt-BR');
  const pct1 = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const entraram = relNum(etapa.entraram);
  const voltaram = relNum(etapa.voltaram);
  const perdidos = relNum(etapa.perdidos);

  setTxt('kpi-etapa-entraram', fmt(entraram));
  setTxt('kpi-etapa-avancaram', fmt(etapa.avancaram));
  let subAvanco = `${pct1(relNum(etapa.conversao_pct))}% de conversão`;
  if (voltaram > 0) subAvanco += ` • ${fmt(voltaram)} ${voltaram === 1 ? 'voltou' : 'voltaram'}`;
  setTxt('kpi-etapa-avancaram-sub', subAvanco);
  setTxt('kpi-etapa-ainda', fmt(etapa.ainda_na_etapa));
  setTxt('kpi-etapa-perdidos', fmt(perdidos));
  setTxt('kpi-etapa-perdidos-sub', `${pct1(entraram > 0 ? (perdidos / entraram) * 100 : 0)}% de quem entrou`);
  setTxt('kpi-etapa-tempo', formatarHorasEtapa(etapa.tempo_medio_horas));

  // "SLA estourado agora" só quando a etapa tem SLA
  const sla = relNum(est.sla_horas ?? etapa.sla_horas);
  const temSla = sla > 0 && etapa.sla_estourados !== null && etapa.sla_estourados !== undefined;
  const cardSla = document.getElementById('kpi-card-etapa-sla');
  if (cardSla) cardSla.hidden = !temSla;
  if (temSla) {
    const estourados = relNum(etapa.sla_estourados);
    const elSla = document.getElementById('kpi-etapa-sla');
    if (elSla) {
      elSla.textContent = fmt(estourados);
      elSla.classList.toggle('rel-val-loss', estourados > 0);
    }
    setTxt('kpi-etapa-sla-sub', `Prazo da etapa: ${sla.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`);
  }
  ajustarGradeKpisRelatorio(gridEtapa);

  setTxt('rel-ranking-etapa-sub', est.pipeline_tipo === 'closer'
    ? 'Por Closer responsável pelo lead'
    : 'Por SDR responsável pelo lead');
  renderRankingEtapa(etapa.ranking);
}

function renderRankingEtapa(lista) {
  const tbody = document.getElementById('tbody-rel-ranking-etapa');
  if (!tbody) return;
  if (!Array.isArray(lista) || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="rel-empty">Nenhum lead entrou nesta etapa no período.</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(r => {
    const perd = relNum(r.perdidos);
    const conv = relNum(r.conversao_pct);
    return `
      <tr>
        <td class="rel-td-strong"><span class="rel-name"><i data-lucide="user"></i>${escapeHtml(r.nome || '—')}</span></td>
        <td class="text-center rel-td-strong">${relNum(r.entraram).toLocaleString('pt-BR')}</td>
        <td class="text-center"><span class="kanban-chip">${relNum(r.avancaram).toLocaleString('pt-BR')}</span></td>
        <td class="text-center"><span class="kanban-chip ${perd > 0 ? 'rel-chip--loss' : ''}">${perd.toLocaleString('pt-BR')}</span></td>
        <td class="text-center rel-td-muted">${conv.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
      </tr>`;
  }).join('');
}

// Texto do escopo das perdas (D2): SDR filtrado vê só o funil do SDR, Closer filtrado só o do Closer
function renderPerdasEscopo(perdas) {
  const escopo = perdas?.escopo || 'todos';
  const textos = {
    sdr: 'Perdas no funil do SDR. As perdas do Closer nos leads transferidos aparecem abaixo.',
    closer: 'Perdas no funil do Closer',
    etapa: 'Perdas registradas nesta etapa no período',
    todos: 'Perdas nos funis do SDR e do Closer'
  };
  const el = document.getElementById('rel-perdas-escopo');
  if (el) el.textContent = textos[escopo] || textos.todos;

  const regSub = document.getElementById('rel-perdas-registro-sub');
  if (regSub) {
    const sufixos = { sdr: ' no funil do SDR', closer: ' no funil do Closer', etapa: ' nesta etapa' };
    const sufixo = sufixos[escopo] || '';
    regSub.textContent = `Desqualificações e desistências no período selecionado${sufixo}`;
  }
}

function renderPerdasPosTransferencia(perdas) {
  const bloco = document.getElementById('rel-perdas-pos-transf');
  if (!bloco) return;
  const pos = perdas?.pos_transferencia;
  if (perdas?.escopo !== 'sdr' || !pos) {
    bloco.hidden = true;
    return;
  }
  bloco.hidden = false;
  const total = parseInt(pos.total, 10) || 0;
  const chip = document.getElementById('rel-perdas-pos-total');
  if (chip) chip.textContent = `${total.toLocaleString('pt-BR')} ${total === 1 ? 'perda' : 'perdas'}`;
  renderPerdasMotivos(pos.por_motivo, 'chart-rel-motivos-pos-transf', 'Nenhuma perda do Closer nos leads transferidos neste período.');
}

function renderPerdasMotivos(lista, containerId = 'chart-rel-motivos-perda', emptyMsg = 'Nenhuma perda registrada no período.') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!lista || lista.length === 0) {
    container.innerHTML = `<p class="rel-evo-empty">${escapeHtml(emptyMsg)}</p>`;
    return;
  }

  const total = lista.reduce((acc, item) => acc + parseInt(item.quantidade, 10), 0);
  let html = '';

  lista.forEach(item => {
    const qty = parseInt(item.quantidade, 10);
    const pct = total > 0 ? Math.round((qty / total) * 100) : 0;
    html += `<div><div class="rel-bar-head"><span class="rel-bar-label" title="${escapeHtml(item.motivo)}">${escapeHtml(item.motivo)}</span><span class="rel-bar-count">${qty} (${pct}%)</span></div><div class="rel-bar-track"><div class="rel-bar-fill" style="width:${pct}%"></div></div></div>`;
  });

  container.innerHTML = html;
}

function renderPerdasEstagios(lista) {
  const container = document.getElementById('chart-rel-estagios-perda');
  if (!container) return;

  if (!lista || lista.length === 0) {
    container.innerHTML = '<p class="rel-evo-empty">Nenhuma perda por etapa registrada.</p>';
    return;
  }

  const total = lista.reduce((acc, item) => acc + parseInt(item.quantidade, 10), 0);
  let html = '';

  lista.forEach(item => {
    const qty = parseInt(item.quantidade, 10);
    const pct = total > 0 ? Math.round((qty / total) * 100) : 0;
    const cor = /^#[0-9a-f]{3,8}$/i.test(item.estagio_cor || '') ? item.estagio_cor : '#71717a';
    const funil = item.pipeline_tipo === 'closer' ? 'Closer' : (item.pipeline_tipo === 'sdr' ? 'SDR' : '');
    const funilTag = funil ? `<span class="rel-funil-tag rel-funil-tag--${funil.toLowerCase()}">${funil}</span>` : '';
    const titulo = `${item.estagio_nome || '—'}${funil ? ` (funil ${funil})` : ''}`;
    html += `<div><div class="rel-bar-head"><span class="rel-bar-label rel-etapa-label" title="${escapeHtml(titulo)}"><span class="rel-chip-dot" style="background:${cor}"></span><span class="rel-etapa-nome">${escapeHtml(item.estagio_nome || '—')}</span>${funilTag}</span><span class="rel-bar-count">${qty} (${pct}%)</span></div><div class="rel-bar-track"><div class="rel-bar-fill rel-bar-fill--etapa" style="width:${pct}%"></div></div></div>`;
  });

  container.innerHTML = html;
}

function renderPerdasRecentes(perdasData) {
  const tbody = document.getElementById('tbody-rel-perdas-recentes');
  if (!tbody) return;

  const lista = Array.isArray(perdasData) ? perdasData : (perdasData?.recentes || []);
  // recentes_total usa o mesmo JOIN da lista; resposta antiga cai em total
  const rawTotal = perdasData && !Array.isArray(perdasData)
    ? (perdasData.recentes_total ?? perdasData.total)
    : undefined;
  const parsedTotal = parseInt(rawTotal, 10);
  const totalCount = Number.isFinite(parsedTotal) ? Math.max(parsedTotal, lista.length) : lista.length;

  const badgeCount = document.getElementById('badge-total-perdas-count');
  if (badgeCount) {
    badgeCount.textContent = `${totalCount.toLocaleString('pt-BR')} ${totalCount === 1 ? 'registro' : 'registros'}`;
  }

  const note = document.getElementById('rel-perdas-note');
  if (note) {
    // Só afirma "Exibindo N de M" quando o servidor manda o total com o mesmo critério da lista
    const temTotalConfiavel = perdasData && !Array.isArray(perdasData) && perdasData.recentes_total != null;
    const truncado = temTotalConfiavel && lista.length > 0 && lista.length < totalCount;
    note.hidden = !truncado;
    note.textContent = truncado
      ? `Exibindo ${lista.length.toLocaleString('pt-BR')} de ${totalCount.toLocaleString('pt-BR')} registros. Exporte o CSV para ver a lista completa.`
      : '';
  }

  if (!lista || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="rel-empty">Nenhum registro de perda encontrado para este filtro.</td></tr>';
    return;
  }

  let html = '';
  lista.forEach(p => {
    const dataFmt = p.created_at ? new Date(p.created_at).toLocaleString('pt-BR') : '—';

    let badgeOrigem = '';
    if (p.lead_origem === 'transferido') {
      badgeOrigem = '<span class="kanban-chip"><i data-lucide="send"></i> Transferido</span>';
    } else if (p.lead_origem === 'proprio_closer') {
      badgeOrigem = '<span class="kanban-chip"><i data-lucide="user-check"></i> Próprio Closer</span>';
    } else {
      badgeOrigem = '<span class="kanban-chip"><i data-lucide="filter"></i> Funil SDR</span>';
    }

    // Responsável conforme o funil em que a perda aconteceu (perda_pipeline); sem a informação, regra antiga
    const respSdr = p.sdr_nome ? `${escapeHtml(p.sdr_nome)} (SDR)` : '';
    const respCloser = p.closer_nome ? `${escapeHtml(p.closer_nome)} (Closer)` : '';
    let respText;
    if (p.perda_pipeline === 'sdr') respText = respSdr || respCloser || '—';
    else if (p.perda_pipeline === 'closer') respText = respCloser || respSdr || '—';
    else respText = respCloser || respSdr || '—';

    html += `
      <tr>
        <td class="rel-td-muted">${dataFmt}</td>
        <td class="rel-td-strong">${escapeHtml(p.cliente_nome || '—')}</td>
        <td class="rel-td-muted">${escapeHtml(p.cliente_cpf || p.cliente_telefone || '—')}</td>
        <td>${badgeOrigem}</td>
        <td class="rel-td-muted">${respText}</td>
        <td><span class="kanban-chip">${escapeHtml(p.estagio_nome || '—')}</span></td>
        <td class="rel-loss-text">${escapeHtml(p.motivo || '—')}</td>
        <td class="rel-td-muted">${escapeHtml(p.usuario_nome || '—')}</td>
        <td class="rel-td-muted rel-td-note rel-td-clip" title="${escapeHtml(p.observacao || '')}">${escapeHtml(p.observacao || '—')}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function renderMetaProspeccao(prospeccoes, periodo) {
  // A meta é mensal: o progresso só faz sentido em "Este mês"
  const mostrarMeta = (periodo || 'mes') === 'mes';
  const metaBlock = document.getElementById('rel-meta-block');
  const metaHint = document.getElementById('rel-meta-hint');
  if (metaBlock) metaBlock.hidden = !mostrarMeta;
  if (metaHint) metaHint.hidden = mostrarMeta;

  prospeccoes = prospeccoes || {};
  const meta = prospeccoes.meta_mensal || 100;
  const atingido = prospeccoes.prospectados_periodo || 0;
  const pct = Math.min(100, Math.round((atingido / meta) * 100));

  const labelPct = document.getElementById('label-meta-percentual');
  const bar = document.getElementById('bar-meta-progresso');
  const valAtingido = document.getElementById('val-meta-atingido');
  const valAlvo = document.getElementById('val-meta-alvo');

  if (labelPct) labelPct.textContent = `${pct}%`;
  if (bar) bar.style.width = `${pct}%`;
  if (valAtingido) valAtingido.textContent = atingido.toLocaleString('pt-BR');
  if (valAlvo) valAlvo.textContent = meta.toLocaleString('pt-BR');
}

function renderEvolucaoDiaria(evolucao, emptyMsg = 'Sem prospecções no período.', unidade = 'leads') {
  const container = document.getElementById('chart-rel-evolucao-diaria');
  if (!container) return;

  if (!evolucao || evolucao.length === 0) {
    container.innerHTML = `<p class="rel-evo-empty">${escapeHtml(emptyMsg)}</p>`;
    return;
  }

  const maxQty = Math.max(...evolucao.map(e => parseInt(e.quantidade, 10)), 1);
  // Até 15 dias: "dd/mm" em todas as barras. Até 31 dias (um mês): todas as barras com o dia ("03"),
  // números menores. Acima disso (ex.: "Todo o período"): rótulos espaçados para não sobrepor.
  const n = evolucao.length;
  const compacto = n > 15;
  const step = n <= 31 ? 1 : Math.ceil(n / 16);
  const showVal = n <= 31;

  let html = '';
  evolucao.forEach((item, i) => {
    const qty = parseInt(item.quantidade, 10);
    const barPx = qty > 0 ? Math.max(3, Math.round(qty / maxQty * 64)) : 1;
    const partes = String(item.data || '').split('T')[0].split('-').reverse().slice(0, 2);
    const d = escapeHtml(partes.join('/'));
    const rotulo = compacto && n <= 31 ? escapeHtml(String(parseInt(partes[0], 10) || '')) : d;

    html += `<div class="rel-evo-col" title="${d}: ${qty} ${unidade}">${showVal ? `<span class="rel-evo-val">${qty}</span>` : ''}<div class="rel-evo-bar" style="height:${barPx}px"></div><span class="rel-evo-date">${i % step === 0 ? rotulo : '&nbsp;'}</span></div>`;
  });

  container.innerHTML = html;
  container.classList.toggle('rel-evo-compacto', compacto);
  container.setAttribute('aria-label', `Evolução diária: ${n} dias, máximo de ${maxQty} ${unidade} em um dia`);
}

function renderRankingSdrs(sdrs) {
  const tbody = document.getElementById('tbody-rel-ranking-sdrs');
  if (!tbody) return;

  if (!sdrs || sdrs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="rel-empty">Nenhum SDR com atividade registrada no período.</td></tr>';
    return;
  }

  let html = '';
  sdrs.forEach(s => {
    const prospectados = parseInt(s.total_prospectados || '0', 10);
    const enviados = parseInt(s.total_enviados || '0', 10);

    html += `
      <tr>
        <td class="rel-td-strong"><span class="rel-name"><i data-lucide="user"></i>${escapeHtml(s.sdr_nome)}</span></td>
        <td class="text-center rel-td-strong">${prospectados}</td>
        <td class="text-center"><span class="kanban-chip">${enviados}</span></td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function renderRankingClosers(closers) {
  const tbody = document.getElementById('tbody-rel-ranking-closers');
  if (!tbody) return;

  if (!closers || closers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="rel-empty">Nenhum Closer com atividade registrada no período.</td></tr>';
    return;
  }

  let html = '';
  closers.forEach(c => {
    const recebidos = parseInt(c.total_recebidos || '0', 10);
    const proprios = parseInt(c.total_proprios || '0', 10);
    const emAndamento = parseInt(c.total_em_andamento || '0', 10);
    const perdidos = parseInt(c.total_perdidos || '0', 10);
    const sla = c.tempo_medio_aceite_min && parseFloat(c.tempo_medio_aceite_min) > 0
      ? parseFloat(c.tempo_medio_aceite_min).toFixed(1) + ' min'
      : '—';

    html += `
      <tr>
        <td class="rel-td-strong"><span class="rel-name"><i data-lucide="user-check"></i>${escapeHtml(c.closer_nome)}</span></td>
        <td class="text-center rel-td-strong">${recebidos}</td>
        <td class="text-center rel-td-strong">${proprios}</td>
        <td class="text-center"><span class="kanban-chip">${emAndamento}</span></td>
        <td class="text-center"><span class="kanban-chip ${perdidos > 0 ? 'rel-chip--loss' : ''}">${perdidos}</span></td>
        <td class="text-center rel-td-muted">${sla}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

let currentTransferidosList = [];

let currentTransferidosOrigemFilter = 'transferidos';

 // 'transferidos' (DEFAULT!), 'proprios', 'todos'
let currentTransferidosStatusFilter = 'all';

let currentTransferidosContagens = null;

// Contagens das abas: do servidor (sem LIMIT) quando existir, senão da lista recebida
function relContagemValida(c) {
  return c && typeof c === 'object' && c.transferido && c.proprio_closer;
}

function relContagensDaLista(lista) {
  const status = l => (l.status_atendimento === 'pendente_aceite' ? 'em_atendimento' : l.status_atendimento);
  const base = () => ({ total: 0, em_atendimento: 0, perdido: 0, concluido: 0 });
  const out = { transferido: base(), proprio_closer: base() };
  lista.forEach(l => {
    const grupo = out[l.tipo_origem];
    if (!grupo) return;
    grupo.total++;
    const s = status(l);
    if (s in grupo && s !== 'total') grupo[s]++;
  });
  return out;
}

// Contagem (servidor) para a combinação de abas origem x status atual
function relContagemAba(contagens, origemFiltro, statusFiltro) {
  const chave = statusFiltro === 'all' ? 'total' : statusFiltro;
  const val = g => parseInt(g?.[chave], 10) || 0;
  if (origemFiltro === 'transferidos') return val(contagens.transferido);
  if (origemFiltro === 'proprios') return val(contagens.proprio_closer);
  return val(contagens.transferido) + val(contagens.proprio_closer);
}

function renderTransferidosDetalhes(lista, contagens) {
  currentTransferidosList = lista || [];
  currentTransferidosContagens = relContagemValida(contagens) ? contagens : null;
  const cont = currentTransferidosContagens || relContagensDaLista(currentTransferidosList);

  const countTransf = parseInt(cont.transferido.total, 10) || 0;
  const countProprios = parseInt(cont.proprio_closer.total, 10) || 0;
  const countTodosOrigem = countTransf + countProprios;

  const elCountTransf = document.getElementById('count-tab-origem-transf');
  const elCountProprios = document.getElementById('count-tab-origem-proprios');
  const elCountTodosOrigem = document.getElementById('count-tab-origem-todos');

  if (elCountTransf) elCountTransf.textContent = countTransf;
  if (elCountProprios) elCountProprios.textContent = countProprios;
  if (elCountTodosOrigem) elCountTodosOrigem.textContent = countTodosOrigem;

  aplicarFiltrosTabelaTransferidos();
}

function aplicarFiltrosTabelaTransferidos() {
  const tbody = document.getElementById('tbody-rel-transferidos-detalhes');
  if (!tbody) return;

  // Atualiza botões de origem
  document.querySelectorAll('#tabs-origem-filtro button').forEach(btn => {
    const on = btn.getAttribute('data-tab-origem') === currentTransferidosOrigemFilter;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });

  // Filtra por origem primeiro
  let filtradosOrigem = currentTransferidosList;
  if (currentTransferidosOrigemFilter === 'transferidos') {
    filtradosOrigem = currentTransferidosList.filter(l => l.tipo_origem === 'transferido');
  } else if (currentTransferidosOrigemFilter === 'proprios') {
    filtradosOrigem = currentTransferidosList.filter(l => l.tipo_origem === 'proprio_closer');
  }

  // Atualiza contadores das abas de status
  const contAbas = currentTransferidosContagens || relContagensDaLista(currentTransferidosList);
  const origemAtual = currentTransferidosOrigemFilter;
  const countTodos = relContagemAba(contAbas, origemAtual, 'all');
  const countAndamento = relContagemAba(contAbas, origemAtual, 'em_atendimento');
  const countPerdidos = relContagemAba(contAbas, origemAtual, 'perdido');
  const countConcluidos = relContagemAba(contAbas, origemAtual, 'concluido');

  const elTodos = document.getElementById('count-tab-transf-todos');
  const elAndamento = document.getElementById('count-tab-transf-andamento');
  const elPerdidos = document.getElementById('count-tab-transf-perdidos');
  const elConcluidos = document.getElementById('count-tab-transf-concluidos');

  if (elTodos) elTodos.textContent = countTodos;
  if (elAndamento) elAndamento.textContent = countAndamento;
  if (elPerdidos) elPerdidos.textContent = countPerdidos;
  if (elConcluidos) elConcluidos.textContent = countConcluidos;

  // Atualiza botões de status
  document.querySelectorAll('#tabs-transferidos-filtro button').forEach(btn => {
    const on = btn.getAttribute('data-tab-status') === currentTransferidosStatusFilter;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });

  let filtrados = filtradosOrigem;
  if (currentTransferidosStatusFilter === 'em_atendimento') {
    filtrados = filtradosOrigem.filter(l => l.status_atendimento === 'em_atendimento' || l.status_atendimento === 'pendente_aceite');
  } else if (currentTransferidosStatusFilter === 'perdido') {
    filtrados = filtradosOrigem.filter(l => l.status_atendimento === 'perdido');
  } else if (currentTransferidosStatusFilter === 'concluido') {
    filtrados = filtradosOrigem.filter(l => l.status_atendimento === 'concluido');
  }

  // Lista limitada no servidor: avisa quando há mais registros do que os exibidos
  const note = document.getElementById('rel-transf-note');
  if (note) {
    const totalAba = relContagemAba(contAbas, origemAtual, currentTransferidosStatusFilter);
    const truncado = filtrados.length < totalAba;
    note.hidden = !truncado;
    note.textContent = truncado
      ? `Exibindo ${filtrados.length.toLocaleString('pt-BR')} de ${totalAba.toLocaleString('pt-BR')} leads. Exporte o CSV para ver a lista completa.`
      : '';
  }

  if (!filtrados || filtrados.length === 0) {
    const msg = currentTransferidosOrigemFilter === 'transferidos'
      ? 'Nenhum lead transferido do SDR para Closer encontrado nesta categoria.'
      : 'Nenhum lead encontrado para os filtros selecionados.';
    tbody.innerHTML = `<tr><td colspan="9" class="rel-empty">${msg}</td></tr>`;
    return;
  }

  let html = '';
  filtrados.forEach(item => {
    const dataRef = item.transferido_closer_at 
      ? new Date(item.transferido_closer_at).toLocaleString('pt-BR') 
      : (item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : '—');
    
    let badgeOrigem = '';
    if (item.tipo_origem === 'transferido') {
      badgeOrigem = '<span class="kanban-chip"><i data-lucide="send"></i> Transferido</span>';
    } else if (item.tipo_origem === 'proprio_closer') {
      badgeOrigem = '<span class="kanban-chip"><i data-lucide="user-check"></i> Próprio Closer</span>';
    } else {
      badgeOrigem = '<span class="kanban-chip"><i data-lucide="filter"></i> Funil SDR</span>';
    }

    let statusBadge = '';
    let detalhe = '—';
    let detalheTexto = '';

    if (item.status_atendimento === 'perdido') {
      detalheTexto = `${item.motivo_perda || 'Perda registrada'}${item.obs_perda ? ` (${item.obs_perda})` : ''}`;
      statusBadge = '<span class="kanban-chip rel-chip--loss">Perdido</span>';
      detalhe = `<span class="rel-loss-text">${escapeHtml(item.motivo_perda || 'Perda registrada')}</span>${item.obs_perda ? ` <span class="rel-td-muted">(${escapeHtml(item.obs_perda)})</span>` : ''}`;
    } else if (item.status_atendimento === 'concluido') {
      statusBadge = '<span class="kanban-chip rel-chip--won">Concluído</span>';
      detalheTexto = 'Venda Efetivada';
      detalhe = '<span class="rel-won-text">Venda Efetivada</span>';
    } else {
      statusBadge = '<span class="kanban-chip">Em andamento</span>';
      detalheTexto = 'Negociação ativa';
      detalhe = '<span class="rel-td-muted">Negociação ativa</span>';
    }

    const estagioColor = /^#[0-9a-f]{3,8}$/i.test(item.estagio_cor || '') ? item.estagio_cor : '#71717a';

    html += `
      <tr>
        <td class="rel-td-muted">${dataRef}</td>
        <td>${badgeOrigem}</td>
        <td class="rel-td-strong">${escapeHtml(item.cliente_nome || '—')}</td>
        <td class="rel-td-muted">${escapeHtml(item.cliente_cpf || item.cliente_telefone || '—')}</td>
        <td>${escapeHtml(item.sdr_nome || '—')}</td>
        <td>${escapeHtml(item.closer_nome || '—')}</td>
        <td><span class="kanban-chip"><span class="rel-chip-dot" style="background:${estagioColor}"></span>${escapeHtml(item.estagio_nome || '—')}</span></td>
        <td class="text-center">${statusBadge}</td>
        <td class="rel-td-clip" title="${escapeHtml(detalheTexto)}">${detalhe}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

// Download do relatório detalhado completo de perdas no período
async function exportPerdasCsv() {
  const filtros = getRelatoriosFiltros();
  if (!filtros) {
    if (typeof showToast === 'function') showToast(REL_CUSTOM_DATES_MSG, 'error');
    return;
  }
  const periodo = filtros.periodo;
  const url = `/api/crm/relatorios/perdas/export?${filtros.qs}`;

  try {
    if (typeof showToast === 'function') showToast('Gerando download do relatório de perdas...', 'info');
    const res = await fetchWithAuth(url);
    if (!res || !res.ok) {
      const err = await res.json().catch(() => ({}));
      if (typeof showToast === 'function') showToast(err.error || 'Erro ao baixar relatório de perdas.', 'error');
      return;
    }

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `relatorio_perdas_completo_${periodo}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
    if (typeof showToast === 'function') showToast('Relatório de perdas baixado com sucesso!', 'success');
  } catch (err) {
    console.error('Erro ao exportar perdas:', err);
    if (typeof showToast === 'function') showToast('Falha ao processar download do relatório.', 'error');
  }
}

// Download do relatório analítico de transferências / clientes no período
async function exportTransferidosCsv() {
  const filtros = getRelatoriosFiltros();
  if (!filtros) {
    if (typeof showToast === 'function') showToast(REL_CUSTOM_DATES_MSG, 'error');
    return;
  }
  const periodo = filtros.periodo;
  // status: all | em_atendimento (inclui pendente_aceite no servidor) | perdido | concluido
  const url = `/api/crm/relatorios/transferidos/export?${filtros.qs}&origem=${encodeURIComponent(currentTransferidosOrigemFilter)}&status=${encodeURIComponent(currentTransferidosStatusFilter)}`;

  try {
    if (typeof showToast === 'function') showToast('Gerando download do relatório de clientes/transferências...', 'info');
    const res = await fetchWithAuth(url);
    if (!res || !res.ok) {
      const err = await res.json().catch(() => ({}));
      if (typeof showToast === 'function') showToast(err.error || 'Erro ao baixar relatório.', 'error');
      return;
    }

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `relatorio_clientes_${currentTransferidosOrigemFilter}_${periodo}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
    if (typeof showToast === 'function') showToast('Relatório baixado com sucesso!', 'success');
  } catch (err) {
    console.error('Erro ao exportar transferidos:', err);
    if (typeof showToast === 'function') showToast('Falha ao processar download do relatório.', 'error');
  }
}

async function handleConfigMetaClick() {
  const valAlvoEl = document.getElementById('val-meta-alvo');
  const metaAtual = valAlvoEl ? valAlvoEl.textContent.replace(/\D/g, '') : '100';

  const novaMeta = prompt('Digite a nova meta mensal de prospecções de leads:', metaAtual);
  if (!novaMeta) return;

  const num = parseInt(novaMeta, 10);
  if (isNaN(num) || num <= 0) {
    showToast('Informe um número válido para a meta.', 'error');
    return;
  }

  try {
    const res = await fetchWithAuth('/api/crm/relatorios/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: num })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Meta atualizada com sucesso!', 'success');
      fetchAndRenderRelatorios();
    } else {
      showToast(data.error || 'Erro ao atualizar meta.', 'error');
    }
  } catch (err) {
    showToast('Falha de conexão com o servidor.', 'error');
  }
}
