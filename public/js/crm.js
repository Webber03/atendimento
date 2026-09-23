/**
 * MÓDULO CRM & KANBAN - FRONTEND CLIENT
 */

// Estado global do CRM
const CrmState = {
  selectedClientId: null,
  estagios: [],
  sdrLeads: [],
  closerLeads: [],
  eventSource: null,
  show15PercentBoard: {},
  show15PercentColumns: {},
  selectedUsers: {},
  usersList: []
};

// Helper de requisição autenticada com parse de JSON automático
async function apiFetch(url, options = {}) {
  try {
    const res = await fetchWithAuth(url, options);
    if (!res || !res.ok) {
      const errData = res ? await res.json().catch(() => ({})) : {};
      return { error: errData.error || 'Erro na requisição' };
    }
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

// ----------------------------------------
// INICIALIZAÇÃO
// ----------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initCrmEvents();
  initRealtimeSSE();
  initCrmNavigation();
  initCrmSearch();
  initCrmAdminForms();
  initTabulacaoModalForm();
  initNewClientModalForm();
  initLeadDetailsForm();
});

// Configurar o EventSource para escutar o servidor em Realtime (SSE)
function initRealtimeSSE() {
  if (CrmState.eventSource) return;

  try {
    CrmState.eventSource = new EventSource('/api/crm/events');
    
    CrmState.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleRealtimeEvent(data);
      } catch (err) {
        console.error('Erro ao processar evento SSE:', err);
      }
    };

    CrmState.eventSource.onerror = (err) => {
      console.warn('Conexão SSE oscilou, tentando reconectar...', err);
    };
  } catch (err) {
    console.error('SSE não suportado pelo navegador:', err);
  }
}

// Trata eventos recebidos do servidor ao vivo
function handleRealtimeEvent(data) {
  const currentUser = typeof getUser === 'function' ? getUser() : null;
  const currentUserId = currentUser ? parseInt(currentUser.id, 10) : null;
  const isAdmin = currentUser && currentUser.role === 'admin';

  if (data.type === 'LEAD_NOVO') {
    const lead = data.payload;

    const isCloserDoLead = lead.closer_id && currentUserId && currentUserId === parseInt(lead.closer_id, 10);
    const isSdrDoLead = lead.sdr_id && currentUserId && currentUserId === parseInt(lead.sdr_id, 10);
    const deveNotificar = isAdmin || isCloserDoLead || isSdrDoLead;

    if (deveNotificar) {
      if (typeof showToast === 'function') {
        showToast(`⚡ Novo Lead recebido: ${lead.cliente_nome || 'Cliente'}`, 'info');
      }

      // Tocar beep apenas para o closer que precisa aceitar
      if (isCloserDoLead && lead.status_atendimento === 'pendente_aceite') {
        playAlertAudio();
      }
    }

    const userPerms = typeof getPermissions === 'function' ? getPermissions() : null;
    const canSdr = !userPerms || userPerms.nav.includes('crm-kanban-sdr');
    const canCloser = !userPerms || userPerms.nav.includes('crm-kanban-closer');

    if (canSdr) loadKanbanBoard('sdr');
    if (canCloser) loadKanbanBoard('closer');
  } else if (data.type === 'LEAD_MOVIDO' || data.type === 'LEAD_ACEITO' || data.type === 'TABULACAO_NOVA' || data.type === 'LEADS_REMOVIDOS') {
    const userPerms = typeof getPermissions === 'function' ? getPermissions() : null;
    const canSdr = !userPerms || userPerms.nav.includes('crm-kanban-sdr');
    const canCloser = !userPerms || userPerms.nav.includes('crm-kanban-closer');

    if (canSdr) loadKanbanBoard('sdr');
    if (canCloser) loadKanbanBoard('closer');
    if (CrmState.selectedClientId) {
      loadClientDetails(CrmState.selectedClientId);
    }
  }
}


// Tocar bip sonoro de alerta para o consultor
function playAlertAudio() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // Ignorar falha de áudio se política de autostart bloquear
  }
}

// ----------------------------------------
// NAVEGAÇÃO DE SEÇÕES CRM
// ----------------------------------------
function initCrmNavigation() {
  window.addEventListener('hashchange', handleCrmHashChange);
  handleCrmHashChange();
}

function handleCrmHashChange() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  
  if (hash === 'crm-clientes') {
    // Busca pronta
  } else if (hash === 'crm-kanban-sdr') {
    loadKanbanBoard('sdr');
  } else if (hash === 'crm-kanban-closer') {
    loadClosersFilter();
    loadKanbanBoard('closer');
  } else if (hash === 'crm-admin') {
    loadCrmAdminData();
  }
}

function debounce(fn, wait = 120) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

function initCrmEvents() {
  const debouncedFilterSdr = debounce(() => filterKanbanCards('sdr'), 120);
  const debouncedFilterCloser = debounce(() => filterKanbanCards('closer'), 120);

  document.getElementById('sdr-kanban-filter-user')?.addEventListener('change', () => filterKanbanCards('sdr'));
  document.getElementById('sdr-kanban-filter-estagio')?.addEventListener('change', () => filterKanbanCards('sdr'));
  document.getElementById('sdr-kanban-search')?.addEventListener('input', debouncedFilterSdr);

  document.getElementById('closer-kanban-filter-user')?.addEventListener('change', () => filterKanbanCards('closer'));
  document.getElementById('closer-kanban-filter-sdr')?.addEventListener('change', () => filterKanbanCards('closer'));
  document.getElementById('closer-kanban-filter-estagio')?.addEventListener('change', () => filterKanbanCards('closer'));
  document.getElementById('closer-kanban-search')?.addEventListener('input', debouncedFilterCloser);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-multiselect')) {
      document.querySelectorAll('.custom-multiselect-menu').forEach(m => m.classList.add('hidden'));
      document.querySelectorAll('.custom-multiselect-trigger').forEach(t => t.classList.remove('open'));
    }
  });

  setupKanbanDateFilter('sdr');
  setupKanbanDateFilter('closer');
}

function setupKanbanDateFilter(pipelineTipo) {
  const tipoDataEl = document.getElementById(`${pipelineTipo}-kanban-filter-tipo-data`);
  const periodoEl = document.getElementById(`${pipelineTipo}-kanban-filter-periodo`);
  const customDatesEl = document.getElementById(`${pipelineTipo}-kanban-custom-dates`);
  const dateDeEl = document.getElementById(`${pipelineTipo}-kanban-date-de`);
  const dateAteEl = document.getElementById(`${pipelineTipo}-kanban-date-ate`);

  if (!periodoEl) return;

  periodoEl.addEventListener('change', () => {
    const val = periodoEl.value;
    if (val === 'custom') {
      if (customDatesEl) customDatesEl.style.display = 'inline-flex';
    } else {
      if (customDatesEl) customDatesEl.style.display = 'none';
      if (val === 'todos') {
        if (dateDeEl) dateDeEl.value = '';
        if (dateAteEl) dateAteEl.value = '';
      } else if (val === 'hoje') {
        const today = getLocalDateString();
        if (dateDeEl) dateDeEl.value = today;
        if (dateAteEl) dateAteEl.value = today;
      } else if (val === 'ontem') {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        const yesterday = getLocalDateString(y);
        if (dateDeEl) dateDeEl.value = yesterday;
        if (dateAteEl) dateAteEl.value = yesterday;
      } else if (val === '7dias') {
        const d7 = new Date();
        d7.setDate(d7.getDate() - 6);
        if (dateDeEl) dateDeEl.value = getLocalDateString(d7);
        if (dateAteEl) dateAteEl.value = getLocalDateString();
      } else if (val === 'mes') {
        const dMes = new Date();
        dMes.setDate(1);
        if (dateDeEl) dateDeEl.value = getLocalDateString(dMes);
        if (dateAteEl) dateAteEl.value = getLocalDateString();
      }
      loadKanbanBoard(pipelineTipo);
    }
  });

  tipoDataEl?.addEventListener('change', () => {
    loadKanbanBoard(pipelineTipo);
  });

  dateDeEl?.addEventListener('change', () => {
    loadKanbanBoard(pipelineTipo);
  });

  dateAteEl?.addEventListener('change', () => {
    loadKanbanBoard(pipelineTipo);
  });
}

// ----------------------------------------
// KANBAN (BOARD, CARDS, DRAG & DROP)
// ----------------------------------------

function parseCurrencyValue(val) {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim().replace(/R\$/gi, '').replace(/\s/g, '');
  const match = str.match(/[\d.,]+/);
  if (!match) return 0;
  let numStr = match[0];
  if (numStr.includes('.') && numStr.includes(',')) {
    if (numStr.indexOf('.') < numStr.indexOf(',')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else {
      numStr = numStr.replace(/,/g, '');
    }
  } else if (numStr.includes(',')) {
    numStr = numStr.replace(',', '.');
  }
  const parsed = parseFloat(numStr);
  return isNaN(parsed) ? 0 : parsed;
}

function getLeadValorContrato(lead) {
  if (!lead) return 0;
  return parseCurrencyValue(lead.valor_contrato !== undefined ? lead.valor_contrato : lead.valor);
}

async function loadKanbanBoard(pipelineTipo) {
  try {
    const resEstagios = await apiFetch('/api/crm/kanban/estagios');
    if (!resEstagios || resEstagios.error || !Array.isArray(resEstagios)) return;

    CrmState.estagios = resEstagios;
    const estagiosFiltrados = resEstagios.filter(e => e.pipeline_tipo === pipelineTipo);
    populateStageFilterDropdown(pipelineTipo, estagiosFiltrados);

    const tipoDataEl = document.getElementById(`${pipelineTipo}-kanban-filter-tipo-data`);
    const dateDeEl = document.getElementById(`${pipelineTipo}-kanban-date-de`);
    const dateAteEl = document.getElementById(`${pipelineTipo}-kanban-date-ate`);
    const periodoEl = document.getElementById(`${pipelineTipo}-kanban-filter-periodo`);

    let urlLeads = `/api/crm/kanban/leads?pipeline_tipo=${pipelineTipo}`;
    if (periodoEl && periodoEl.value !== 'todos') {
      if (dateDeEl && dateDeEl.value) urlLeads += `&data_inicio=${encodeURIComponent(dateDeEl.value)}`;
      if (dateAteEl && dateAteEl.value) urlLeads += `&data_fim=${encodeURIComponent(dateAteEl.value)}`;
      if (tipoDataEl && tipoDataEl.value) urlLeads += `&tipo_data=${encodeURIComponent(tipoDataEl.value)}`;
    }
    const leads = await apiFetch(urlLeads);
    if (!leads || leads.error || !Array.isArray(leads)) return;

    if (pipelineTipo === 'sdr') CrmState.sdrLeads = leads;
    else CrmState.closerLeads = leads;

    populateUserFilterDropdown(pipelineTipo, leads);

    const boardContainer = document.getElementById(`${pipelineTipo}-kanban-board`);
    if (!boardContainer) return;

    boardContainer.innerHTML = '';

    const badge = document.getElementById(`${pipelineTipo}-kanban-count-badge`);
    if (badge) badge.textContent = `${leads.length} leads`;

    const fragment = document.createDocumentFragment();

    estagiosFiltrados.forEach(estagio => {
      const colLeads = leads.filter(l => parseInt(l.estagio_id, 10) === parseInt(estagio.id, 10));
      const currentSort = (CrmState.columnSort && CrmState.columnSort[`${pipelineTipo}_${estagio.id}`]) || 'default';

      let colLeadsSorted = [...colLeads];
      if (currentSort === 'newest') {
        colLeadsSorted.sort((a, b) => new Date(b.created_at || b.moved_to_stage_at || 0) - new Date(a.created_at || a.moved_to_stage_at || 0));
      } else if (currentSort === 'oldest') {
        colLeadsSorted.sort((a, b) => new Date(a.created_at || a.moved_to_stage_at || 0) - new Date(b.created_at || b.moved_to_stage_at || 0));
      }

      const columnEl = document.createElement('div');
      columnEl.className = 'kanban-column';
      columnEl.style.setProperty('--column-color', estagio.cor || '#4F46E5');

      columnEl.innerHTML = `
        <div class="kanban-column-header">
          <div class="kanban-column-header-top">
            <div class="kanban-column-title" title="${escapeHtml(estagio.nome)}">
              <span class="kanban-column-dot" style="background: ${estagio.cor || '#4F46E5'};"></span>
              <span>${escapeHtml(estagio.nome)}</span>
            </div>
            <div class="kanban-column-sort-dropdown" style="position: relative;">
              <button type="button" 
                      class="btn-kanban-column-sort ${currentSort === 'newest' ? 'active-newest' : (currentSort === 'oldest' ? 'active-oldest' : '')}"
                      id="btn-sort-${pipelineTipo}-${estagio.id}"
                      onclick="toggleColumnSortMenu(event, '${pipelineTipo}', ${estagio.id})" 
                      title="${currentSort === 'newest' ? 'Filtro: Mais recentes primeiro' : (currentSort === 'oldest' ? 'Filtro: Mais antigos primeiro' : 'Ordenar por data de criação')}">
                ${getSortIconSvg(currentSort)}
                ${currentSort === 'newest' ? '<span style="font-size: 10px;">Recentes</span>' : (currentSort === 'oldest' ? '<span style="font-size: 10px;">Antigos</span>' : '')}
              </button>
              <div id="sort-menu-${pipelineTipo}-${estagio.id}" class="kanban-column-sort-menu hidden">
                <button type="button" onclick="selectColumnSort(event, '${pipelineTipo}', ${estagio.id}, 'newest')">
                  ${getSortIconSvg('newest')} Mais recentes primeiro
                </button>
                <button type="button" onclick="selectColumnSort(event, '${pipelineTipo}', ${estagio.id}, 'oldest')">
                  ${getSortIconSvg('oldest')} Mais antigos primeiro
                </button>
                <button type="button" class="btn-sort-reset" onclick="selectColumnSort(event, '${pipelineTipo}', ${estagio.id}, 'default')">
                  ${getResetIconSvg()} Remover filtro (Ordem original)
                </button>
              </div>
            </div>
          </div>
          <div class="kanban-column-header-sub">
            <span class="kanban-column-total zero-val" title="Soma dos Valores de Contrato">
              <i data-lucide="circle-dollar-sign" style="width: 11px; height: 11px;"></i>
              <span class="kanban-column-total-val">R$ 0,00</span>
            </span>
            <span class="badge info-badge kanban-column-count">${colLeads.length} ${colLeads.length === 1 ? 'lead' : 'leads'}</span>
          </div>
        </div>
        <div class="kanban-cards-wrapper" data-estagio-id="${estagio.id}"></div>
      `;

      const cardsWrapper = columnEl.querySelector('.kanban-cards-wrapper');

      cardsWrapper.addEventListener('dragover', handleDragOver);
      cardsWrapper.addEventListener('dragleave', handleDragLeave);
      cardsWrapper.addEventListener('drop', (e) => handleDropCard(e, estagio.id, pipelineTipo));

      colLeadsSorted.forEach(lead => {
        const cardEl = renderKanbanCard(lead, pipelineTipo);
        cardsWrapper.appendChild(cardEl);
      });

      fragment.appendChild(columnEl);
    });

    boardContainer.appendChild(fragment);

    filterKanbanCards(pipelineTipo);

    if (window.lucide) window.lucide.createIcons({ root: boardContainer });
  } catch (err) {
    console.error(`Erro ao carregar Kanban (${pipelineTipo}):`, err);
  }
}

function renderKanbanCard(lead, pipelineTipo) {
  const cardEl = document.createElement('div');
  const isPendente = lead.status_atendimento === 'pendente_aceite';

  cardEl.className = `kanban-card ${isPendente ? 'alert-pulsing' : ''}`;
  cardEl.setAttribute('draggable', 'true');
  cardEl.dataset.leadId = lead.id;
  cardEl.style.setProperty('--card-color', lead.estagio_cor || '#4F46E5');

  cardEl.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', lead.id);
    cardEl.style.opacity = '0.5';
  });

  cardEl.addEventListener('dragend', () => {
    cardEl.style.opacity = '1';
  });

  cardEl.addEventListener('click', (e) => {
    if (e.target.closest('.btn-aceitar-lead')) return;
    openLeadDetailsModal(lead.id, pipelineTipo);
  });

  const stageTime = lead.moved_to_stage_at || (pipelineTipo === 'closer' ? lead.transferido_closer_at : null) || lead.created_at;
  const tempoEtapaStr = stageTime ? formatTimeAgo(stageTime) : 'agora';
  const dataCriacaoStr = lead.created_at ? formatShortDate(lead.created_at) : '';

  // No pipeline Closer, exibe o Closer responsável (lead.closer_nome ou lead.closer_username). NUNCA faz fallback para o SDR!
  const consultorNome = (pipelineTipo === 'closer')
    ? ((lead.closer_nome && lead.closer_nome.trim()) || (lead.closer_username && lead.closer_username.trim()) || 'Aguardando Closer')
    : ((lead.sdr_nome && lead.sdr_nome.trim()) || (lead.sdr_username && lead.sdr_username.trim()) || lead.discadora_login || 'Não atribuído');

  const clienteNome = (lead.cliente_nome && lead.cliente_nome.trim()) ? lead.cliente_nome : (lead.cliente_cpf ? `Cliente CPF ${formatCpf(lead.cliente_cpf)}` : `Cliente #${lead.cliente_id}`);
  const formattedCpf = lead.cliente_cpf ? formatCpf(lead.cliente_cpf) : '';

  let btnAceitarHtml = '';
  if (isPendente) {
    btnAceitarHtml = `
      <button class="btn-aceitar-lead" onclick="aceitarAtendimentoLead(${lead.id}, event)">
        <i data-lucide="zap"></i> Iniciar Atendimento
      </button>
    `;
  }

  const stage = (CrmState.estagios || []).find(e => e.id === lead.estagio_id);
  const exibirValor = stage ? stage.exibir_valor !== false : true;
  const exibirCpf = stage ? stage.exibir_cpf !== false : true;
  const exibirTelefone = stage ? stage.exibir_telefone !== false : true;
  const exibirEmail = stage ? !!stage.exibir_email : false;
  const exibirDocs = stage ? !!stage.exibir_documentos : false;

  const valorContrato = getLeadValorContrato(lead);
  const valorHtml = (exibirValor && valorContrato > 0)
    ? `<div style="margin-top: 6px; display: inline-flex; align-items: center; gap: 4px; background: rgba(34, 197, 94, 0.12); color: var(--accent-emerald); border: 1px solid rgba(34, 197, 94, 0.25); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; width: fit-content;">
         <i data-lucide="circle-dollar-sign" style="width: 11px; height: 11px;"></i>
         R$ ${valorContrato.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
       </div>`
    : '';

  const emailHtml = (exibirEmail && lead.cliente_email)
    ? `<div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><i data-lucide="mail" style="width:12px;height:12px;vertical-align:middle;"></i> ${escapeHtml(lead.cliente_email)}</div>`
    : (exibirEmail ? `<div class="text-muted" style="font-size: 11px;"><i data-lucide="mail" style="width:12px;height:12px;vertical-align:middle;"></i> Sem e-mail</div>` : '');

  let docsBadgeHtml = '';
  if (exibirDocs) {
    const totalDocs = [
      lead.doc_contracheque_id,
      lead.doc_extrato_id,
      lead.doc_identificacao_id,
      lead.doc_residencia_id,
      lead.doc_espelho_id
    ].filter(Boolean).length;

    if (totalDocs === 5) {
      docsBadgeHtml = `<div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; background: rgba(34, 197, 94, 0.12); color: #34D399; border: 1px solid rgba(34, 197, 94, 0.25); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; width: fit-content;"><i data-lucide="file-check-2" style="width: 11px; height: 11px;"></i> Docs 5/5</div>`;
    } else if (totalDocs > 0) {
      docsBadgeHtml = `<div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; background: rgba(245, 158, 11, 0.12); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.25); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; width: fit-content;"><i data-lucide="file-text" style="width: 11px; height: 11px;"></i> Docs ${totalDocs}/5</div>`;
    } else {
      docsBadgeHtml = `<div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; background: rgba(239, 68, 68, 0.12); color: #F87171; border: 1px solid rgba(239, 68, 68, 0.25); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; width: fit-content;"><i data-lucide="file-x" style="width: 11px; height: 11px;"></i> Sem Docs (0/5)</div>`;
    }
  }

  const sdrNomeTag = (lead.sdr_nome && lead.sdr_nome.trim()) || (lead.sdr_username && lead.sdr_username.trim());
  const sdrBadgeHtml = (pipelineTipo === 'closer' && sdrNomeTag)
    ? `<span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(168, 85, 247, 0.12); color: #C084FC; border: 1px solid rgba(168, 85, 247, 0.25); font-weight: 700; margin-left: 6px; display: inline-block; vertical-align: middle; line-height: 1; letter-spacing: 0.3px; text-transform: uppercase;">SDR: ${escapeHtml(sdrNomeTag)}</span>`
    : '';

  // Badge de SLA — alerta de card parado
  let slaBadgeHtml = '';
  if (stage && stage.sla_horas && stage.sla_horas > 0 && lead.moved_to_stage_at) {
    const msDecorrido = Date.now() - new Date(lead.moved_to_stage_at).getTime();
    const horasDecorridas = msDecorrido / (1000 * 60 * 60);
    const pctUsado = horasDecorridas / stage.sla_horas;
    if (pctUsado >= 1) {
      // SLA excedido
      const horasExtra = Math.round(horasDecorridas - stage.sla_horas);
      const labelExtra = horasExtra < 24 ? `${horasExtra}h` : `${Math.round(horasExtra / 24)}d`;
      slaBadgeHtml = `<div class="kanban-card-sla-badge"><i data-lucide="alarm-clock" style="width:9px;height:9px;"></i> SLA +${labelExtra} excedido</div>`;
    } else if (pctUsado >= 0.75) {
      // Próximo do SLA
      const horasRestantes = Math.round(stage.sla_horas - horasDecorridas);
      slaBadgeHtml = `<div class="kanban-card-sla-badge warning"><i data-lucide="timer" style="width:9px;height:9px;"></i> SLA: ${horasRestantes}h restantes</div>`;
    }
  }

  const canalTagText = lead.canal_nome ? String(lead.canal_nome).toUpperCase() : (lead.discadora_login ? 'DISCADORA' : '');
  const canalBadgeHtml = canalTagText
    ? `<span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.12); color: #60A5FA; border: 1px solid rgba(59, 130, 246, 0.25); font-weight: 700; margin-left: 6px; display: inline-block; vertical-align: middle; line-height: 1; letter-spacing: 0.3px; text-transform: uppercase;">${escapeHtml(canalTagText)}</span>`
    : '';

  cardEl.innerHTML = `
    <div class="kanban-card-tag"></div>
    <div class="kanban-card-client-name">
      ${escapeHtml(clienteNome)}
      ${canalBadgeHtml}
      ${sdrBadgeHtml}
    </div>
    <div class="kanban-card-info">
      ${(exibirCpf && formattedCpf) ? `<div><i data-lucide="credit-card" style="width:12px;height:12px;vertical-align:middle;"></i> ${escapeHtml(formattedCpf)}</div>` : ''}
      ${exibirTelefone ? `<div><i data-lucide="phone" style="width:12px;height:12px;vertical-align:middle;"></i> ${escapeHtml(lead.cliente_telefone || 'Sem telefone')}</div>` : ''}
      ${emailHtml}
      ${valorHtml}
      ${docsBadgeHtml}
      ${slaBadgeHtml}
    </div>
    <div class="kanban-card-footer">
      <div class="kanban-card-footer-user" title="Consultor: ${escapeHtml(consultorNome)}">
        <i data-lucide="user" style="width:11px;height:11px;flex-shrink:0;"></i>
        <span>${escapeHtml(consultorNome)}</span>
      </div>
      <div class="kanban-card-footer-times">
        <span class="kanban-card-stage-time" title="Tempo nesta etapa">
          <i data-lucide="clock" style="width:10px;height:10px;flex-shrink:0;"></i> Na etapa: ${tempoEtapaStr}
        </span>
        ${dataCriacaoStr ? `<span class="kanban-card-created-time" title="Data de criação do lead">Criado: ${dataCriacaoStr}</span>` : ''}
      </div>
    </div>
    ${btnAceitarHtml}
  `;

  cardEl.dataset.searchText = [
    clienteNome,
    formattedCpf,
    lead.cliente_cpf || '',
    lead.cliente_telefone || '',
    lead.cliente_email || '',
    consultorNome,
    sdrNomeTag || '',
    canalTagText || '',
    lead.discadora_login || ''
  ].filter(Boolean).join(' ').toLowerCase();

  return cardEl;
}

function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleDropCard(e, novoEstagioId, pipelineTipo) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');

  const leadId = e.dataTransfer.getData('text/plain');
  if (!leadId) return;



  try {
    const res = await apiFetch(`/api/crm/kanban/leads/${leadId}/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estagio_id: novoEstagioId, observacao: 'Movido no Kanban' })
    });

    if (res && res.message) {
      if (typeof showToast === 'function') showToast('Lead movido com sucesso!', 'success');
      loadKanbanBoard(pipelineTipo);
    } else {
      if (typeof showToast === 'function') showToast(res.error || 'Erro ao mover lead.', 'error');
      loadKanbanBoard(pipelineTipo);
    }
  } catch (err) {
    console.error('Erro ao soltar card:', err);
  }
}

async function aceitarAtendimentoLead(leadId, event) {
  if (event) event.stopPropagation();

  try {
    const res = await apiFetch(`/api/crm/kanban/leads/${leadId}/aceitar`, {
      method: 'POST'
    });

    if (res && res.message) {
      if (typeof showToast === 'function') showToast('Atendimento iniciado! Alerta desligado.', 'success');
      loadKanbanBoard('closer');
    } else {
      if (typeof showToast === 'function') showToast(res.error || 'Erro ao aceitar lead.', 'error');
    }
  } catch (err) {
    console.error('Erro ao aceitar atendimento:', err);
  }
}

function canUserUse15PercentCalc(pipelineTipo) {
  const currentUser = typeof getUser === 'function' ? getUser() : null;
  const role = currentUser ? currentUser.role : null;
  if (pipelineTipo === 'closer') {
    // Closers, Admins e Supervisores podem ver no Kanban de Closer
    return !role || role === 'closer' || role === 'admin' || role === 'supervisor';
  } else if (pipelineTipo === 'sdr') {
    // Apenas Admins e Supervisores podem ver no Kanban de SDR (SDRs NÃO veem)
    return role === 'admin' || role === 'supervisor';
  }
  return false;
}

function filterKanbanCards(pipelineTipo) {
  const termRaw = (document.getElementById(`${pipelineTipo}-kanban-search`)?.value || '').toLowerCase().trim();
  const termDigits = termRaw.replace(/\D/g, '');

  const selectedUserIds = CrmState.selectedUsers?.[`${pipelineTipo}-kanban-filter-user`] || [];
  const selectedSdrIds = pipelineTipo === 'closer' ? (CrmState.selectedUsers?.['closer-kanban-filter-sdr'] || []) : [];
  const selectedEstagio = (document.getElementById(`${pipelineTipo}-kanban-filter-estagio`)?.value || '').trim();

  const board = document.getElementById(`${pipelineTipo}-kanban-board`);
  if (!board) return;

  let totalVisibleBoardCount = 0;
  let totalVisibleBoardValor = 0;

  const isCalcAllowed = canUserUse15PercentCalc(pipelineTipo);
  const currentUser = typeof getUser === 'function' ? getUser() : null;
  const currentRole = currentUser?.role;
  const currentUserId = currentUser?.id ? String(currentUser.id) : null;

  const leadsPool = pipelineTipo === 'sdr' ? CrmState.sdrLeads : CrmState.closerLeads;
  // O(1) Map lookup para alta performance sem travamento
  const leadsMap = new Map((leadsPool || []).map(l => [String(l.id), l]));

  const columns = board.querySelectorAll('.kanban-column');
  columns.forEach(col => {
    const colEstagioId = col.querySelector('.kanban-cards-wrapper')?.dataset.estagioId;

    // Se filtrou por estágio específico, esconde as outras colunas
    if (selectedEstagio !== '' && String(selectedEstagio) !== String(colEstagioId)) {
      col.style.display = 'none';
      return;
    } else {
      col.style.display = 'flex';
    }

    let colVisibleCount = 0;
    let colVisibleValor = 0;

    const cards = col.querySelectorAll('.kanban-card');
    cards.forEach(card => {
      const leadId = card.dataset.leadId;
      const lead = leadsMap.get(String(leadId));

      // Salvaguarda: SDR/Closer logados nunca devem ver cards de outros consultores
      if (currentRole === 'closer' && pipelineTipo === 'closer') {
        if (lead && String(lead.closer_id) !== currentUserId) {
          card.style.display = 'none';
          return;
        }
      }
      if (currentRole === 'sdr' && pipelineTipo === 'sdr') {
        if (lead && String(lead.sdr_id) !== currentUserId) {
          card.style.display = 'none';
          return;
        }
      }

      let matchesUser = true;
      if (selectedUserIds.length > 0) {
        if (!lead) {
          matchesUser = false;
        } else {
          if (pipelineTipo === 'sdr') {
            const leadSdrId = lead.sdr_id ? String(lead.sdr_id) : null;
            const leadDiscadora = lead.discadora_login ? String(lead.discadora_login).toLowerCase() : null;
            const leadSdrNome = lead.sdr_nome ? String(lead.sdr_nome).toLowerCase() : null;
            matchesUser = selectedUserIds.some(id => {
              const idLower = id.toLowerCase();
              return id === leadSdrId || 
                     (leadDiscadora && idLower === leadDiscadora) ||
                     (leadSdrNome && idLower === leadSdrNome);
            });
          } else {
            const leadCloserId = lead.closer_id ? String(lead.closer_id) : null;
            const leadCloserNome = lead.closer_nome ? String(lead.closer_nome).toLowerCase() : null;
            const leadCloserUser = lead.closer_username ? String(lead.closer_username).toLowerCase() : null;
            matchesUser = selectedUserIds.some(id => {
              const idLower = id.toLowerCase();
              return id === leadCloserId ||
                     (leadCloserNome && idLower === leadCloserNome) ||
                     (leadCloserUser && idLower === leadCloserUser);
            });
          }
        }
      }

      let matchesSdr = true;
      if (pipelineTipo === 'closer' && selectedSdrIds.length > 0) {
        if (!lead) {
          matchesSdr = false;
        } else {
          const leadSdrId = lead.sdr_id ? String(lead.sdr_id) : null;
          const leadSdrNome = lead.sdr_nome ? String(lead.sdr_nome).toLowerCase() : null;
          const leadSdrUser = lead.sdr_username ? String(lead.sdr_username).toLowerCase() : null;
          matchesSdr = selectedSdrIds.some(id => {
            const idLower = id.toLowerCase();
            return id === leadSdrId ||
                   (leadSdrNome && idLower === leadSdrNome) ||
                   (leadSdrUser && idLower === leadSdrUser);
          });
        }
      }

      let matchesText = true;
      if (termRaw !== '') {
        const content = card.dataset.searchText || card.textContent.toLowerCase();
        const contentDigits = content.replace(/\D/g, '');

        const textMatch = content.includes(termRaw);
        const digitsMatch = termDigits.length >= 2 && contentDigits.includes(termDigits);

        let leadMatch = false;
        if (lead) {
          const lNome = (lead.cliente_nome || '').toLowerCase();
          const lCpf = (lead.cliente_cpf || '').replace(/\D/g, '').padStart(11, '0');
          const lTel = (lead.cliente_telefone || '').replace(/\D/g, '');
          const lSdr = ((lead.sdr_nome || '') + ' ' + (lead.sdr_username || '')).toLowerCase();
          const lCloser = ((lead.closer_nome || '') + ' ' + (lead.closer_username || '')).toLowerCase();
          const tClean = termRaw.replace(/\D/g, '');

          if (tClean.length >= 2) {
            leadMatch = lCpf.includes(tClean) || lTel.includes(tClean);
          } else {
            leadMatch = lNome.includes(termRaw) || lSdr.includes(termRaw) || lCloser.includes(termRaw);
          }
        }

        matchesText = textMatch || digitsMatch || leadMatch;
      }

      if (matchesUser && matchesSdr && matchesText) {
        card.style.display = 'block';
        colVisibleCount++;
        const valor = getLeadValorContrato(lead);
        if (valor > 0) {
          colVisibleValor += valor;
        }
      } else {
        card.style.display = 'none';
      }
    });

    totalVisibleBoardCount += colVisibleCount;
    totalVisibleBoardValor += colVisibleValor;

    // Atualiza contadores e total da coluna
    const countBadge = col.querySelector('.kanban-column-count');
    if (countBadge) {
      countBadge.textContent = `${colVisibleCount} ${colVisibleCount === 1 ? 'lead' : 'leads'}`;
    }

    const totalBadge = col.querySelector('.kanban-column-total');
    const totalValSpan = col.querySelector('.kanban-column-total-val');
    if (totalBadge) {
      totalBadge.dataset.rawValor = colVisibleValor;
      const colKey = `${pipelineTipo}_${colEstagioId}`;

      if (isCalcAllowed) {
        totalBadge.classList.add('clickable-total-badge');
        if (!totalBadge.dataset.bound15Calc) {
          totalBadge.dataset.bound15Calc = 'true';
          totalBadge.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!CrmState.show15PercentColumns) CrmState.show15PercentColumns = {};
            const isNow15 = !CrmState.show15PercentColumns[colKey];
            CrmState.show15PercentColumns[colKey] = isNow15;

            // Atualização síncrona instantânea (0ms)
            const rawVal = parseFloat(totalBadge.dataset.rawValor || 0);
            const dispVal = isNow15 ? (rawVal * 0.15) : rawVal;
            const fNum = dispVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const fText = isNow15 ? `15%: R$ ${fNum}` : `R$ ${fNum}`;

            const valSpan = totalBadge.querySelector('.kanban-column-total-val');
            if (valSpan) {
              valSpan.textContent = fText;
            } else {
              totalBadge.textContent = fText;
            }

            if (isNow15) {
              totalBadge.classList.add('badge-calc-15');
              totalBadge.title = `Modo 15% ativo (Total 100%: R$ ${rawVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Clique para alternar.`;
            } else {
              totalBadge.classList.remove('badge-calc-15');
              totalBadge.title = `Soma dos Contratos: R$ ${rawVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Clique para ver 15%)`;
            }
          });
        }
      } else {
        totalBadge.classList.remove('clickable-total-badge');
      }

      const show15 = isCalcAllowed && (CrmState.show15PercentColumns && CrmState.show15PercentColumns[colKey]);
      const displayValor = show15 ? (colVisibleValor * 0.15) : colVisibleValor;
      const formattedNum = displayValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const formatted = show15 ? `15%: R$ ${formattedNum}` : `R$ ${formattedNum}`;

      if (totalValSpan) {
        totalValSpan.textContent = formatted;
      } else {
        totalBadge.textContent = formatted;
      }

      if (show15) {
        totalBadge.classList.add('badge-calc-15');
        totalBadge.title = `Modo 15% ativo (Total 100%: R$ ${colVisibleValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Clique para alternar.`;
      } else {
        totalBadge.classList.remove('badge-calc-15');
        totalBadge.title = isCalcAllowed
          ? `Soma dos Contratos: R$ ${colVisibleValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Clique para ver 15%)`
          : `Soma dos Contratos no estágio: R$ ${colVisibleValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }

      if (colVisibleValor > 0) {
        totalBadge.classList.remove('zero-val');
      } else {
        totalBadge.classList.add('zero-val');
      }
    }
  });

  // Atualiza contadores globais do board
  const boardCountBadge = document.getElementById(`${pipelineTipo}-kanban-count-badge`);
  if (boardCountBadge) {
    boardCountBadge.textContent = `${totalVisibleBoardCount} leads`;
  }

  const boardTotalBadge = document.getElementById(`${pipelineTipo}-kanban-total-badge`);
  if (boardTotalBadge) {
    boardTotalBadge.dataset.rawValor = totalVisibleBoardValor;

    if (isCalcAllowed) {
      boardTotalBadge.classList.add('clickable-total-badge');
      if (!boardTotalBadge.dataset.bound15Calc) {
        boardTotalBadge.dataset.bound15Calc = 'true';
        boardTotalBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!CrmState.show15PercentBoard) CrmState.show15PercentBoard = {};
          const isNow15 = !CrmState.show15PercentBoard[pipelineTipo];
          CrmState.show15PercentBoard[pipelineTipo] = isNow15;

          // Atualização síncrona instantânea (0ms)
          const rawVal = parseFloat(boardTotalBadge.dataset.rawValor || 0);
          const dispVal = isNow15 ? (rawVal * 0.15) : rawVal;
          const fNum = dispVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const fText = isNow15 ? `15%: R$ ${fNum}` : `Total: R$ ${fNum}`;

          boardTotalBadge.textContent = fText;

          if (isNow15) {
            boardTotalBadge.classList.add('badge-calc-15');
            boardTotalBadge.title = `Modo 15% ativo (Total 100%: R$ ${rawVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Clique para alternar.`;
          } else {
            boardTotalBadge.classList.remove('badge-calc-15');
            boardTotalBadge.title = `Valor total da esteira: R$ ${rawVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Clique para ver 15%)`;
          }
        });
      }
    } else {
      boardTotalBadge.classList.remove('clickable-total-badge');
    }

    const show15Board = isCalcAllowed && (CrmState.show15PercentBoard && CrmState.show15PercentBoard[pipelineTipo]);
    const displayBoardValor = show15Board ? (totalVisibleBoardValor * 0.15) : totalVisibleBoardValor;
    const formattedBoardNum = displayBoardValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedBoardText = show15Board ? `15%: R$ ${formattedBoardNum}` : `Total: R$ ${formattedBoardNum}`;

    boardTotalBadge.textContent = formattedBoardText;

    if (show15Board) {
      boardTotalBadge.classList.add('badge-calc-15');
      boardTotalBadge.title = `Modo 15% ativo (Total 100%: R$ ${totalVisibleBoardValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Clique para alternar.`;
    } else {
      boardTotalBadge.classList.remove('badge-calc-15');
      boardTotalBadge.title = isCalcAllowed
        ? `Valor total da esteira: R$ ${totalVisibleBoardValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Clique para ver 15%)`
        : `Valor total da esteira: R$ ${totalVisibleBoardValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }
}

// ----------------------------------------
// BUSCA E FICHA DO CLIENTE
// ----------------------------------------
function initCrmSearch() {
  const inputSearch = document.getElementById('crm-search-input');
  const btnSearch = document.getElementById('btn-crm-search');
  const btnNew = document.getElementById('btn-crm-new-client');

  if (btnSearch && inputSearch) {
    btnSearch.addEventListener('click', performCrmSearch);
    inputSearch.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') performCrmSearch();
    });
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => openNewClientForm());
  }
}

async function performCrmSearch() {
  const query = document.getElementById('crm-search-input')?.value.trim();
  if (!query || query.length < 2) {
    if (typeof showToast === 'function') showToast('Digite ao menos 2 caracteres para pesquisar.', 'warning');
    return;
  }

  const resultsList = document.getElementById('crm-search-results-list');
  const countBadge = document.getElementById('crm-search-count');
  if (resultsList) resultsList.innerHTML = '<div class="text-muted text-center" style="padding: 20px;">Buscando...</div>';

  try {
    const clientes = await apiFetch(`/api/crm/clientes/search?q=${encodeURIComponent(query)}`);
    if (!clientes || clientes.error || !Array.isArray(clientes)) {
      if (typeof showToast === 'function') showToast(clientes?.error || 'Erro ao pesquisar clientes.', 'error');
      return;
    }

    if (countBadge) countBadge.textContent = clientes.length;

    if (clientes.length === 0) {
      resultsList.innerHTML = `
        <div class="text-muted text-center" style="padding: 30px 10px;">
          Nenhum cliente encontrado com "${escapeHtml(query)}".<br><br>
          <button class="btn btn-secondary btn-small" onclick="openNewClientForm('${escapeHtml(query)}')">
            <i data-lucide="user-plus"></i> Cadastrar este cliente
          </button>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    resultsList.innerHTML = '';
    clientes.forEach(cli => {
      const itemEl = document.createElement('div');
      itemEl.style.cssText = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; cursor: pointer; transition: background 0.2s;';
      itemEl.onmouseover = () => itemEl.style.background = 'rgba(255,255,255,0.08)';
      itemEl.onmouseout = () => itemEl.style.background = 'rgba(255,255,255,0.04)';
      itemEl.onclick = () => loadClientDetails(cli.id);

      itemEl.innerHTML = `
        <div style="font-weight: 700; color: #fff; font-size: 14px;">${escapeHtml(cli.nome)}</div>
        <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 4px; display: flex; justify-content: space-between;">
          <span>CPF: ${escapeHtml(formatCpf(cli.cpf) || '—')}</span>
          <span>Tel: ${escapeHtml(cli.telefone || '—')}</span>
        </div>
      `;
      resultsList.appendChild(itemEl);
    });
  } catch (err) {
    console.error('Erro na busca de clientes:', err);
  }
}

async function loadClientDetails(clienteId) {
  CrmState.selectedClientId = clienteId;
  const placeholder = document.getElementById('crm-client-empty-placeholder');
  const content = document.getElementById('crm-client-detail-content');

  try {
    const data = await apiFetch(`/api/crm/clientes/${clienteId}`);
    if (!data || data.error) return;

    if (placeholder) placeholder.classList.add('hidden');
    if (content) content.classList.remove('hidden');

    const cli = data.cliente;
    document.getElementById('crm-detail-nome').textContent = cli.nome || '—';
    document.getElementById('crm-detail-cpf').textContent = formatCpf(cli.cpf) || '—';
    document.getElementById('crm-detail-telefone').textContent = cli.telefone || '—';
    const emailEl = document.getElementById('crm-detail-email');
    if (emailEl) emailEl.textContent = cli.email || '—';

    const btnTab = document.getElementById('btn-crm-open-tabulacao-modal');
    if (btnTab) {
      btnTab.onclick = () => openTabulacaoModal(cli.id);
    }

    // Buscar e exibir valor de contrato na Ficha Completa
    const latestValTab = (data.tabulacoes || []).find(t => t.valor && parseFloat(t.valor) > 0);
    const valWrapper = document.getElementById('crm-detail-valor-wrapper');
    const valSpan = document.getElementById('crm-detail-valor-val');
    if (valWrapper && valSpan) {
      if (latestValTab) {
        valSpan.textContent = `R$ ${parseFloat(latestValTab.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        valWrapper.classList.remove('hidden');
      } else {
        valWrapper.classList.add('hidden');
      }
    }

    const timelineEl = document.getElementById('crm-client-timeline');
    if (timelineEl) {
      timelineEl.innerHTML = '';

      const events = [];
      (data.tabulacoes || []).forEach(t => events.push({ type: 'tabulacao', date: new Date(t.created_at), data: t }));
      (data.historicoKanban || []).forEach(h => events.push({ type: 'kanban', date: new Date(h.created_at), data: h }));

      events.sort((a, b) => b.date - a.date);

      if (events.length === 0) {
        timelineEl.innerHTML = '<div class="text-muted text-center" style="padding: 20px;">Nenhum atendimento registrado para este cliente ainda.</div>';
        return;
      }

      events.forEach(item => {
        const timeBox = document.createElement('div');
        timeBox.className = 'timeline-item';

        if (item.type === 'tabulacao') {
          const t = item.data;
          timeBox.innerHTML = `
            <div class="timeline-icon" style="color: #10B981;"><i data-lucide="phone-call"></i></div>
            <div class="timeline-content-box">
              <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; color: #fff;">
                <span>
                  ${escapeHtml(t.tipo_tabulacao)}
                  ${t.canal_nome ? `<span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.12); color: #60A5FA; border: 1px solid rgba(59, 130, 246, 0.25); font-weight: 700; margin-left: 6px; display: inline-block; vertical-align: middle; text-transform: uppercase;">${escapeHtml(t.canal_nome)}</span>` : ''}
                  ${t.valor && parseFloat(t.valor) > 0 ? `<span class="badge success-badge" style="margin-left: 6px; background: rgba(34, 197, 94, 0.12); color: var(--accent-emerald); border: 1px solid rgba(34, 197, 94, 0.2); font-size: 10px; padding: 2px 6px; border-radius: 4px;">R$ ${parseFloat(t.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>` : ''}
                </span>
                <span style="font-weight: 400; opacity: 0.6; font-size: 12px;">${formatDateString(t.created_at)}</span>
              </div>
              <div style="font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 4px;">
                Consultor: <strong>${escapeHtml(t.consultor_nome || t.consultor_username || 'Sistema')}</strong>
              </div>
              ${t.observacao ? `<div style="font-size: 12px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; margin-top: 8px; color: rgba(255,255,255,0.9);">${escapeHtml(t.observacao)}</div>` : ''}
            </div>
          `;
        } else {
          const h = item.data;
          const isLoss = h.observacao && h.observacao.includes('PERDIDO');
          const titleText = isLoss ? 'Perda Registrada' : `Movimentação no Kanban: ${escapeHtml(h.estagio_novo_nome || 'Estágio Final')}`;
          const iconColor = isLoss ? '#EF4444' : '#3B82F6';
          const iconName = isLoss ? 'x-circle' : 'arrow-right-circle';

          timeBox.innerHTML = `
            <div class="timeline-icon" style="color: ${iconColor};"><i data-lucide="${iconName}"></i></div>
            <div class="timeline-content-box">
              <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; color: #fff;">
                <span>${titleText}</span>
                <span style="font-weight: 400; opacity: 0.6; font-size: 12px;">${formatDateString(h.created_at)}</span>
              </div>
              <div style="font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 4px;">
                Por: <strong>${escapeHtml(h.usuario_nome || 'Sistema')}</strong> ${h.estagio_anterior_nome ? `(Etapa: ${escapeHtml(h.estagio_anterior_nome)})` : ''}
              </div>
              ${h.observacao ? `<div style="font-size: 12px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; margin-top: 8px; color: rgba(255,255,255,0.9); border-left: 3px solid ${iconColor};">${escapeHtml(h.observacao)}</div>` : ''}
            </div>
          `;
        }
        timelineEl.appendChild(timeBox);
      });

      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    console.error('Erro ao carregar detalhes do cliente:', err);
  }
}

function maskCpfInput(value) {
  let v = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  if (v.length > 6) return v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  if (v.length > 3) return v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  return v;
}

function maskPhoneInput(value) {
  let v = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (v.length > 10) return v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (v.length > 6) return v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  if (v.length > 2) return v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
  return v;
}

let checkCpfTimeout = null;
let lastCheckedCpf = '';

async function checkCpfAvailability(cpfVal) {
  const digits = String(cpfVal || '').replace(/\D/g, '');
  const warnBox = document.getElementById('modal-cliente-cpf-warning');
  const warnText = document.getElementById('modal-cliente-cpf-warning-text');
  const btnVerCliente = document.getElementById('btn-ver-cliente-duplicado');
  const submitBtn = document.getElementById('btn-submit-novo-cliente');

  if (digits.length !== 11) {
    if (warnBox) warnBox.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = false;
    lastCheckedCpf = '';
    return;
  }

  if (digits === lastCheckedCpf) return;
  lastCheckedCpf = digits;

  try {
    const res = await apiFetch(`/api/crm/clientes/check-cpf?cpf=${encodeURIComponent(digits)}`);
    if (res && res.exists && res.cliente) {
      if (warnBox) warnBox.classList.remove('hidden');
      if (warnText) {
        warnText.innerHTML = `⚠️ Já cadastrado: <strong>${escapeHtml(res.cliente.nome)}</strong>`;
      }
      if (btnVerCliente) {
        btnVerCliente.onclick = () => {
          closeNewClientModal();
          loadClientDetails(res.cliente.id);
        };
      }
      if (submitBtn) submitBtn.disabled = true;
    } else {
      if (warnBox) warnBox.classList.add('hidden');
      if (submitBtn) submitBtn.disabled = false;
    }
  } catch (err) {
    console.error('Erro ao checar CPF:', err);
  }
}

function openNewClientForm(defaultQuery = '') {
  const inputNome = document.getElementById('modal-cliente-nome');
  const inputCpf = document.getElementById('modal-cliente-cpf');
  const inputTel = document.getElementById('modal-cliente-telefone');
  const warnBox = document.getElementById('modal-cliente-cpf-warning');
  const submitBtn = document.getElementById('btn-submit-novo-cliente');

  if (warnBox) warnBox.classList.add('hidden');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = 'Cadastrar Cliente';
  }

  const queryRaw = (defaultQuery || '').trim();
  const digits = queryRaw.replace(/\D/g, '');

  if (digits.length === 11 && (queryRaw.length === 11 || queryRaw.includes('.') || queryRaw.includes('-'))) {
    if (inputNome) inputNome.value = '';
    if (inputCpf) {
      inputCpf.value = maskCpfInput(digits);
      checkCpfAvailability(digits);
    }
    if (inputTel) inputTel.value = '';
  } else if ((digits.length === 10 || digits.length === 11) && (queryRaw.startsWith('(') || queryRaw.includes('-'))) {
    if (inputNome) inputNome.value = '';
    if (inputCpf) inputCpf.value = '';
    if (inputTel) inputTel.value = maskPhoneInput(digits);
  } else {
    if (inputNome) inputNome.value = queryRaw;
    if (inputCpf) inputCpf.value = '';
    if (inputTel) inputTel.value = '';
  }

  lastCheckedCpf = '';
  document.getElementById('modal-novo-cliente').classList.remove('hidden');
  if (inputNome && !inputNome.value) {
    inputNome.focus();
  } else if (inputCpf && !inputCpf.value) {
    inputCpf.focus();
  }
}

function closeNewClientModal() {
  document.getElementById('modal-novo-cliente').classList.add('hidden');
}

function initNewClientModalForm() {
  const modal = document.getElementById('modal-novo-cliente');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeNewClientModal();
    });
  }

  const inputCpf = document.getElementById('modal-cliente-cpf');
  const inputTel = document.getElementById('modal-cliente-telefone');

  if (inputCpf) {
    inputCpf.addEventListener('input', (e) => {
      e.target.value = maskCpfInput(e.target.value);
      clearTimeout(checkCpfTimeout);
      checkCpfTimeout = setTimeout(() => {
        checkCpfAvailability(e.target.value);
      }, 300);
    });
    inputCpf.addEventListener('blur', (e) => {
      checkCpfAvailability(e.target.value);
    });
  }

  if (inputTel) {
    inputTel.addEventListener('input', (e) => {
      e.target.value = maskPhoneInput(e.target.value);
    });
  }

  const form = document.getElementById('form-novo-cliente');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('btn-submit-novo-cliente');
    const nomeInput = document.getElementById('modal-cliente-nome');
    const cpfInput = document.getElementById('modal-cliente-cpf');
    const telInput = document.getElementById('modal-cliente-telefone');

    const nome = nomeInput?.value || '';
    const cpf = cpfInput?.value || '';
    const telefone = telInput?.value || '';

    const digitsCpf = cpf.replace(/\D/g, '');
    if (digitsCpf.length !== 11) {
      if (typeof showToast === 'function') showToast('Informe um CPF válido com 11 dígitos.', 'warning');
      if (cpfInput) cpfInput.focus();
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = 'Cadastrando...';
    }

    try {
      const res = await apiFetch('/api/crm/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          cpf: cpf ? cpf.trim() : null,
          telefone: telefone ? telefone.trim() : null
        })
      });

      if (res && res.id) {
        if (typeof showToast === 'function') showToast('Cliente cadastrado com sucesso!', 'success');
        closeNewClientModal();
        loadClientDetails(res.id);
        const searchInput = document.getElementById('crm-search-input');
        if (searchInput && searchInput.value.trim().length >= 2) {
          performCrmSearch();
        }
      } else {
        const errorMsg = res?.error || 'Erro ao cadastrar cliente.';
        if (typeof showToast === 'function') showToast(errorMsg, 'error');
        if (res && res.clienteExistenteId) {
          const warnBox = document.getElementById('modal-cliente-cpf-warning');
          const warnText = document.getElementById('modal-cliente-cpf-warning-text');
          const btnVer = document.getElementById('btn-ver-cliente-duplicado');
          if (warnBox) warnBox.classList.remove('hidden');
          if (warnText) warnText.innerHTML = `⚠️ ${escapeHtml(errorMsg)}`;
          if (btnVer) {
            btnVer.onclick = () => {
              closeNewClientModal();
              loadClientDetails(res.clienteExistenteId);
            };
          }
        }
      }
    } catch (err) {
      console.error('Erro ao cadastrar cliente:', err);
      if (typeof showToast === 'function') showToast('Falha na comunicação com o servidor.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Cadastrar Cliente';
      }
    }
  });
}

async function openTabulacaoModal(clienteId) {
  document.getElementById('modal-tabulacao-cliente-id').value = clienteId;
  document.getElementById('modal-tabulacao-obs').value = '';
  const valorInput = document.getElementById('modal-tabulacao-valor');
  if (valorInput) valorInput.value = '';

  if (valorInput && typeof applyCurrencyMask === 'function' && !valorInput.dataset.masked) {
    applyCurrencyMask(valorInput);
    valorInput.dataset.masked = 'true';
  }

  const selectCanal = document.getElementById('modal-tabulacao-canal-id');
  if (selectCanal) {
    selectCanal.innerHTML = '<option value="">-- Carregando canais... --</option>';
    try {
      let channelsList = CrmState.channels;
      if (!channelsList || channelsList.length === 0) {
        const res = await apiFetch('/api/channels');
        if (res && Array.isArray(res)) {
          channelsList = res.filter(c => c.active !== false && c.active !== 0);
          CrmState.channels = channelsList;
        }
      }
      selectCanal.innerHTML = '<option value="">-- Selecione o Canal de Venda --</option>';
      (channelsList || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        selectCanal.appendChild(opt);
      });
    } catch (err) {
      console.error('Erro ao carregar canais de venda no modal:', err);
      selectCanal.innerHTML = '<option value="">-- Selecione o Canal de Venda --</option>';
    }
  }

  const selectTipo = document.getElementById('modal-tabulacao-tipo');
  if (selectTipo) {
    selectTipo.innerHTML = '<option value="">-- Carregando etapas... --</option>';
    
    let estagios = CrmState.estagios;
    if (!estagios || estagios.length === 0) {
      try {
        const res = await apiFetch('/api/crm/kanban/estagios');
        if (res && Array.isArray(res)) {
          CrmState.estagios = res;
          estagios = res;
        }
      } catch (err) {
        console.error('Erro ao carregar estágios no modal de tabulação:', err);
      }
    }
    
    selectTipo.innerHTML = '<option value="">-- Selecione a Etapa --</option>';
    const currentUser = typeof getUser === 'function' ? getUser() : null;
    let estagiosFiltrados = estagios || [];
    
    if (currentUser) {
      if (currentUser.role === 'sdr') {
        estagiosFiltrados = estagiosFiltrados.filter(e => e.pipeline_tipo === 'sdr');
      } else if (currentUser.role === 'closer') {
        estagiosFiltrados = estagiosFiltrados.filter(e => e.pipeline_tipo === 'closer');
      }
    }
    
    // Filtrar apenas a PRIMEIRA etapa (menor ordem) de cada pipeline
    const primeirasEtapas = [];
    const pipelines = [...new Set(estagiosFiltrados.map(e => e.pipeline_tipo))];
    pipelines.forEach(pType => {
      const etapasDoPipeline = estagiosFiltrados
        .filter(e => e.pipeline_tipo === pType)
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      if (etapasDoPipeline.length > 0) {
        primeirasEtapas.push(etapasDoPipeline[0]);
      }
    });

    primeirasEtapas.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = `${e.nome} (${e.pipeline_tipo.toUpperCase()})`;
      selectTipo.appendChild(opt);
    });

    if (primeirasEtapas.length === 1) {
      selectTipo.value = primeirasEtapas[0].id;
    }
  }

  document.getElementById('modal-tabulacao').classList.remove('hidden');
}

function closeTabulacaoModal() {
  document.getElementById('modal-tabulacao').classList.add('hidden');
}

function initTabulacaoModalForm() {
  const form = document.getElementById('form-tabulacao');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const cliente_id = document.getElementById('modal-tabulacao-cliente-id').value;
      const canal_venda_id = document.getElementById('modal-tabulacao-canal-id')?.value;
      const selectTipo = document.getElementById('modal-tabulacao-tipo');
      const estagio_id = selectTipo.value;
      const tipo_tabulacao = selectTipo.options[selectTipo.selectedIndex]?.text || '';
      const observacao = document.getElementById('modal-tabulacao-obs').value;
      const valor = document.getElementById('modal-tabulacao-valor')?.value || '';

      if (!canal_venda_id) {
        if (typeof showToast === 'function') showToast('Por favor, selecione o Canal de Venda.', 'error');
        return;
      }

      try {
        const res = await apiFetch('/api/crm/tabulacoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliente_id, estagio_id, tipo_tabulacao, observacao, valor, canal_venda_id })
        });

        if (res && res.message) {
          if (typeof showToast === 'function') showToast('Tabulação registrada com sucesso!', 'success');
          closeTabulacaoModal();
          
          if (typeof loadKanbanBoard === 'function') {
            loadKanbanBoard('sdr');
            loadKanbanBoard('closer');
          }
          
          if (typeof loadClientDetails === 'function') {
            loadClientDetails(cliente_id);
          }
        } else {
          if (typeof showToast === 'function') showToast(res.error || 'Erro ao registrar tabulação.', 'error');
        }
      } catch (err) {
        console.error('Erro na tabulação:', err);
      }
    });
  }
}

// ----------------------------------------
// PAINEL ADMIN (ESTÁGIOS, FILA, DISCADORA)
// ----------------------------------------
function initCrmAdminForms() {
  document.getElementById('form-crm-estagio')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('estagio-nome').value;
    const pipeline_tipo = document.getElementById('estagio-pipeline-tipo').value;
    const cor = document.getElementById('estagio-cor').value;
    const ordem = document.getElementById('estagio-ordem').value;
    const motivos_perda = document.getElementById('estagio-motivos-perda').value;
    const exigir_obs = document.getElementById('estagio-exigir-obs')?.checked || false;
    const exigir_valor = document.getElementById('estagio-exigir-valor')?.checked || false;
    const exigir_email = document.getElementById('estagio-exigir-email')?.checked || false;
    const exigir_documentos = document.getElementById('estagio-exigir-documentos')?.checked || false;
    const exigir_dados_conta = document.getElementById('estagio-exigir-dados-conta')?.checked || false;
    const exibir_valor = document.getElementById('estagio-exibir-valor')?.checked ?? true;
    const exibir_cpf = document.getElementById('estagio-exibir-cpf')?.checked ?? true;
    const exibir_telefone = document.getElementById('estagio-exibir-telefone')?.checked ?? true;
    const exibir_email = document.getElementById('estagio-exibir-email')?.checked || false;
    const exibir_documentos = document.getElementById('estagio-exibir-documentos')?.checked || false;
    const modal_exibir_valor = document.getElementById('estagio-modal-exibir-valor')?.checked ?? true;
    const modal_exibir_email = document.getElementById('estagio-modal-exibir-email')?.checked ?? true;
    const modal_exibir_docs = document.getElementById('estagio-modal-exibir-docs')?.checked ?? true;
    const modal_exibir_obs = document.getElementById('estagio-modal-exibir-obs')?.checked ?? true;
    const modal_exibir_historico = document.getElementById('estagio-modal-exibir-historico')?.checked ?? true;
    const modal_exibir_closer = document.getElementById('estagio-modal-exibir-closer')?.checked ?? true;
    const modal_exibir_dados_bancarios = document.getElementById('estagio-modal-exibir-dados-bancarios')?.checked ?? false;
    const sla_horas = document.getElementById('estagio-sla-horas')?.value || null;

    const res = await apiFetch('/api/crm/admin/estagios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        nome, pipeline_tipo, cor, ordem, motivos_perda, exigir_obs,
        exigir_valor, exigir_email, exigir_documentos, exigir_dados_conta,
        exibir_valor, exibir_cpf, exibir_telefone,
        exibir_email, exibir_documentos,
        modal_exibir_valor, modal_exibir_email, modal_exibir_docs,
        modal_exibir_obs, modal_exibir_historico, modal_exibir_closer,
        modal_exibir_dados_bancarios,
        sla_horas
      })
    });

    if (res && res.id) {
      if (typeof showToast === 'function') showToast('Estágio criado com sucesso!', 'success');
      document.getElementById('form-crm-estagio').reset();
      loadCrmAdminEstagios();
      if (typeof loadKanbanBoard === 'function') {
        loadKanbanBoard('sdr');
        loadKanbanBoard('closer');
      }
    } else {
      if (typeof showToast === 'function') showToast(res?.error || 'Erro ao criar estágio.', 'error');
    }
  });

  document.getElementById('form-edit-crm-estagio')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-estagio-id').value;
    const nome = document.getElementById('edit-estagio-nome').value;
    const cor = document.getElementById('edit-estagio-cor').value;
    const ordem = document.getElementById('edit-estagio-ordem').value;
    const motivos_perda = document.getElementById('edit-estagio-motivos-perda').value;
    const exigir_obs = document.getElementById('edit-estagio-exigir-obs')?.checked || false;
    const exigir_valor = document.getElementById('edit-estagio-exigir-valor')?.checked || false;
    const exigir_email = document.getElementById('edit-estagio-exigir-email')?.checked || false;
    const exigir_documentos = document.getElementById('edit-estagio-exigir-documentos')?.checked || false;
    const exigir_dados_conta = document.getElementById('edit-estagio-exigir-dados-conta')?.checked || false;
    const exibir_valor = document.getElementById('edit-estagio-exibir-valor')?.checked ?? true;
    const exibir_cpf = document.getElementById('edit-estagio-exibir-cpf')?.checked ?? true;
    const exibir_telefone = document.getElementById('edit-estagio-exibir-telefone')?.checked ?? true;
    const exibir_email = document.getElementById('edit-estagio-exibir-email')?.checked || false;
    const exibir_documentos = document.getElementById('edit-estagio-exibir-documentos')?.checked || false;
    const modal_exibir_valor = document.getElementById('edit-estagio-modal-exibir-valor')?.checked ?? true;
    const modal_exibir_email = document.getElementById('edit-estagio-modal-exibir-email')?.checked ?? true;
    const modal_exibir_docs = document.getElementById('edit-estagio-modal-exibir-docs')?.checked ?? true;
    const modal_exibir_obs = document.getElementById('edit-estagio-modal-exibir-obs')?.checked ?? true;
    const modal_exibir_historico = document.getElementById('edit-estagio-modal-exibir-historico')?.checked ?? true;
    const modal_exibir_closer = document.getElementById('edit-estagio-modal-exibir-closer')?.checked ?? true;
    const modal_exibir_dados_bancarios = document.getElementById('edit-estagio-modal-exibir-dados-bancarios')?.checked ?? false;
    const sla_horas = document.getElementById('edit-estagio-sla-horas')?.value || null;

    const res = await apiFetch(`/api/crm/admin/estagios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        nome, cor, ordem, motivos_perda, exigir_obs,
        exigir_valor, exigir_email, exigir_documentos, exigir_dados_conta,
        exibir_valor, exibir_cpf, exibir_telefone,
        exibir_email, exibir_documentos,
        modal_exibir_valor, modal_exibir_email, modal_exibir_docs,
        modal_exibir_obs, modal_exibir_historico, modal_exibir_closer,
        modal_exibir_dados_bancarios,
        sla_horas
      })
    });

    if (res && !res.error) {
      if (typeof showToast === 'function') showToast('Estágio atualizado com sucesso!', 'success');
      closeEditEstagioModal();
      loadCrmAdminEstagios();
      if (typeof loadKanbanBoard === 'function') {
        loadKanbanBoard('sdr');
        loadKanbanBoard('closer');
      }
    } else {
      if (typeof showToast === 'function') showToast(res?.error || 'Erro ao atualizar estágio.', 'error');
    }
  });

  const modalEditEstagio = document.getElementById('modal-edit-estagio');
  if (modalEditEstagio) {
    modalEditEstagio.addEventListener('click', (e) => {
      if (e.target === modalEditEstagio) closeEditEstagioModal();
    });
  }

  document.getElementById('form-crm-fila')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const closer_id = document.getElementById('fila-closer-id').value;
    const peso = document.getElementById('fila-peso').value;
    const ordem = document.getElementById('fila-ordem').value;

    const res = await apiFetch('/api/crm/admin/fila-closers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ closer_id, peso, ordem })
    });

    if (res && res.id) {
      if (typeof showToast === 'function') showToast('Consultor adicionado à fila!', 'success');
      loadCrmAdminFila();
    } else {
      if (typeof showToast === 'function') showToast(res?.error || 'Erro ao adicionar consultor à fila.', 'error');
    }
  });

  document.getElementById('form-crm-discadora-map')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const discadora_login = document.getElementById('map-discadora-login').value;
    const crm_user_id = document.getElementById('map-crm-user-id').value;

    const res = await apiFetch('/api/crm/admin/discadora-mapeamentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discadora_login, crm_user_id })
    });

    if (res && res.message) {
      if (typeof showToast === 'function') showToast('Mapeamento da discadora salvo!', 'success');
      document.getElementById('form-crm-discadora-map').reset();
      loadCrmAdminDiscadora();
    } else {
      if (typeof showToast === 'function') showToast(res?.error || 'Erro ao salvar mapeamento.', 'error');
    }
  });
}

async function loadCrmAdminData() {
  loadCrmAdminEstagios();
  loadCrmAdminFila();
  loadCrmAdminDiscadora();
  checkDriveStatus();
}

async function checkDriveStatus() {
  const badge = document.getElementById('crm-drive-status-badge');
  const desc = document.getElementById('crm-drive-status-desc');
  if (!badge || !desc) return;

  try {
    const res = await apiFetch('/api/crm/admin/drive-status');
    if (res && res.connected) {
      badge.textContent = 'Conectado';
      badge.style.background = 'rgba(34,197,94,0.15)';
      badge.style.color = '#4ADE80';
      badge.style.border = '1px solid rgba(34,197,94,0.3)';
      desc.textContent = 'Google Drive autenticado e pronto para envio de documentos.';
    } else {
      badge.textContent = 'Reconexão Necessária';
      badge.style.background = 'rgba(239,68,68,0.15)';
      badge.style.color = '#F87171';
      badge.style.border = '1px solid rgba(239,68,68,0.3)';
      desc.textContent = res?.error || 'Sessão expirada. Clique no botão abaixo para autorizar.';
    }
  } catch (err) {
    badge.textContent = 'Erro ao verificar';
    desc.textContent = err.message;
  }
}

async function loadCrmAdminEstagios() {
  const listEl = document.getElementById('list-crm-estagios');
  if (!listEl) return;

  const estagios = await apiFetch('/api/crm/admin/estagios');
  if (!estagios || estagios.error || !Array.isArray(estagios)) return;

  CrmState.adminEstagios = estagios;

  listEl.innerHTML = '';
  estagios.forEach(e => {
    const li = document.createElement('li');
    li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); gap: 12px; flex-wrap: wrap;';
    
    // Badges de visibilidade desativada (se houver)
    let visOcultas = [];
    if (e.exibir_valor === false) visOcultas.push('Sem Valor');
    if (e.exibir_cpf === false) visOcultas.push('Sem CPF');
    if (e.exibir_telefone === false) visOcultas.push('Sem Tel');
    
    // Badges de visibilidade extra ativada
    let visExtras = [];
    if (e.exibir_email) visExtras.push('E-mail');
    if (e.exibir_documentos) visExtras.push('Docs');

    const visOcultasHtml = visOcultas.length > 0 
      ? `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94A3B8; border: 1px solid rgba(148, 163, 184, 0.25); font-size: 10px;">👁️ Oculta: ${visOcultas.join(', ')}</span>` 
      : '';
    const visExtrasHtml = visExtras.length > 0 
      ? `<span class="badge" style="background: rgba(59, 130, 246, 0.12); color: #60A5FA; border: 1px solid rgba(59, 130, 246, 0.25); font-size: 10px;">👁️ Exibe: ${visExtras.join(', ')}</span>` 
      : '';

    li.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <span style="width: 12px; height: 12px; border-radius: 50%; background: ${e.cor};"></span>
        <strong style="color: #fff;">${escapeHtml(e.nome)}</strong>
        <span class="badge info-badge">${e.pipeline_tipo.toUpperCase()}</span>
        <span class="text-muted" style="font-size: 11px;">Ordem: ${e.ordem}</span>
        ${e.exigir_valor ? `<span class="badge" style="background: rgba(16, 185, 129, 0.12); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.25); font-size: 10px; font-weight: 700;">EXIGE VALOR</span>` : ''}
        ${e.exigir_email ? `<span class="badge" style="background: rgba(59, 130, 246, 0.12); color: #60A5FA; border: 1px solid rgba(59, 130, 246, 0.25); font-size: 10px; font-weight: 700;">EXIGE E-MAIL</span>` : ''}
        ${e.exigir_documentos ? `<span class="badge" style="background: rgba(245, 158, 11, 0.12); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.25); font-size: 10px; font-weight: 700;">EXIGE DOCS</span>` : ''}
        ${e.exigir_dados_conta ? `<span class="badge" style="background: rgba(14, 165, 233, 0.12); color: #38BDF8; border: 1px solid rgba(14, 165, 233, 0.25); font-size: 10px; font-weight: 700;">EXIGE DADOS DA CONTA</span>` : ''}
        ${e.exigir_obs ? `<span class="badge" style="background: rgba(168, 85, 247, 0.12); color: #C084FC; border: 1px solid rgba(168, 85, 247, 0.25); font-size: 10px; font-weight: 700;">EXIGE OBS EM PERDA</span>` : ''}
        ${visOcultasHtml}
        ${visExtrasHtml}
      </div>
      <div style="display: flex; gap: 6px;">
        <button class="btn btn-secondary btn-small" onclick="openEditEstagioModal(${e.id})"><i data-lucide="edit-2"></i></button>
        <button class="btn btn-secondary btn-small" onclick="deleteCrmEstagio(${e.id})"><i data-lucide="trash-2"></i></button>
      </div>
    `;
    listEl.appendChild(li);
  });
  if (window.lucide) window.lucide.createIcons();
}

async function deleteCrmEstagio(id) {
  if (!confirm('Deseja realmente remover esta coluna do Kanban?')) return;
  await apiFetch(`/api/crm/admin/estagios/${id}`, { method: 'DELETE' });
  loadCrmAdminEstagios();
}

function openEditEstagioModal(id) {
  const estagio = (CrmState.adminEstagios || []).find(e => e.id === id);
  if (!estagio) return;

  document.getElementById('edit-estagio-id').value = estagio.id;
  document.getElementById('edit-estagio-nome').value = estagio.nome;
  document.getElementById('edit-estagio-cor').value = estagio.cor || '#4F46E5';
  document.getElementById('edit-estagio-ordem').value = estagio.ordem || 1;
  document.getElementById('edit-estagio-motivos-perda').value = estagio.motivos_perda || '';
  document.getElementById('edit-estagio-exigir-obs').checked = !!estagio.exigir_obs;
  document.getElementById('edit-estagio-exigir-valor').checked = !!estagio.exigir_valor;
  document.getElementById('edit-estagio-exigir-email').checked = !!estagio.exigir_email;
  document.getElementById('edit-estagio-exigir-documentos').checked = !!estagio.exigir_documentos;
  const editExigirContaEl = document.getElementById('edit-estagio-exigir-dados-conta');
  if (editExigirContaEl) editExigirContaEl.checked = !!estagio.exigir_dados_conta;
  document.getElementById('edit-estagio-exibir-valor').checked = estagio.exibir_valor !== false;
  document.getElementById('edit-estagio-exibir-cpf').checked = estagio.exibir_cpf !== false;
  document.getElementById('edit-estagio-exibir-telefone').checked = estagio.exibir_telefone !== false;
  document.getElementById('edit-estagio-exibir-email').checked = !!estagio.exibir_email;
  document.getElementById('edit-estagio-exibir-documentos').checked = !!estagio.exibir_documentos;
  // Novos campos — Visibilidade no Modal
  document.getElementById('edit-estagio-modal-exibir-valor').checked = estagio.modal_exibir_valor !== false;
  document.getElementById('edit-estagio-modal-exibir-email').checked = estagio.modal_exibir_email !== false;
  document.getElementById('edit-estagio-modal-exibir-docs').checked = estagio.modal_exibir_docs !== false;
  document.getElementById('edit-estagio-modal-exibir-obs').checked = estagio.modal_exibir_obs !== false;
  document.getElementById('edit-estagio-modal-exibir-historico').checked = estagio.modal_exibir_historico !== false;
  document.getElementById('edit-estagio-modal-exibir-closer').checked = estagio.modal_exibir_closer !== false;
  document.getElementById('edit-estagio-modal-exibir-dados-bancarios').checked = !!estagio.modal_exibir_dados_bancarios;
  // SLA
  document.getElementById('edit-estagio-sla-horas').value = estagio.sla_horas || '';

  document.getElementById('modal-edit-estagio').classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons({ root: document.getElementById('modal-edit-estagio') });
}

function closeEditEstagioModal() {
  document.getElementById('modal-edit-estagio').classList.add('hidden');
}

async function loadCrmAdminFila() {
  const listEl = document.getElementById('list-crm-fila');
  const selectCloser = document.getElementById('fila-closer-id');
  if (!listEl) return;

  const data = await apiFetch('/api/crm/admin/fila-closers');
  if (!data || data.error) return;

  if (selectCloser) {
    selectCloser.innerHTML = '<option value="">-- Selecione o Usuário --</option>';
    (data.disponiveis || []).forEach(u => {
      selectCloser.innerHTML += `<option value="${u.id}">${escapeHtml(u.name || u.username)} (@${escapeHtml(u.username)}) - ${u.role}</option>`;
    });
  }

  listEl.innerHTML = '';
  (data.fila || []).forEach(item => {
    const li = document.createElement('li');
    li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.06);';
    li.innerHTML = `
      <div>
        <strong style="color: #fff;">${escapeHtml(item.name || item.username)}</strong>
        <div style="font-size: 12px; color: rgba(255,255,255,0.6);">@${escapeHtml(item.username)} | Peso: ${item.peso} | Ordem: ${item.ordem}</div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <label style="cursor: pointer; font-size: 12px; color: ${item.ativo ? '#10B981' : '#EF4444'}; font-weight: 600;">
          <input type="checkbox" ${item.ativo ? 'checked' : ''} onchange="toggleFilaCloserAtivo(${item.id}, this.checked)">
          ${item.ativo ? 'ATIVO' : 'PAUSADO'}
        </label>
        <button class="btn btn-secondary btn-small" onclick="deleteFilaCloser(${item.id})"><i data-lucide="trash-2"></i></button>
      </div>
    `;
    listEl.appendChild(li);
  });
  if (window.lucide) window.lucide.createIcons();
}

async function toggleFilaCloserAtivo(id, ativo) {
  await apiFetch(`/api/crm/admin/fila-closers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ativo })
  });
  loadCrmAdminFila();
}

async function deleteFilaCloser(id) {
  if (!confirm('Remover este consultor da fila?')) return;
  await apiFetch(`/api/crm/admin/fila-closers/${id}`, { method: 'DELETE' });
  loadCrmAdminFila();
}

async function loadCrmAdminDiscadora() {
  const listEl = document.getElementById('list-crm-discadora-map');
  const selectCrmUser = document.getElementById('map-crm-user-id');
  if (!listEl) return;

  const users = await apiFetch('/api/users');
  if (selectCrmUser && users && !users.error && Array.isArray(users)) {
    selectCrmUser.innerHTML = '<option value="">-- Selecione o Usuário CRM --</option>';
    users.forEach(u => {
      selectCrmUser.innerHTML += `<option value="${u.id}">${escapeHtml(u.username)} (${u.role})</option>`;
    });
  }

  const mapeamentos = await apiFetch('/api/crm/admin/discadora-mapeamentos');
  if (!mapeamentos || mapeamentos.error || !Array.isArray(mapeamentos)) return;

  listEl.innerHTML = '';
  mapeamentos.forEach(m => {
    const li = document.createElement('li');
    li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.06);';
    li.innerHTML = `
      <div>
        <span style="font-family: monospace; color: #3B82F6;">${escapeHtml(m.discadora_login)}</span> 
        <i data-lucide="arrow-right" style="width: 12px; height: 12px; vertical-align: middle;"></i> 
        <strong style="color: #fff;">${escapeHtml(m.crm_username)}</strong>
      </div>
      <button class="btn btn-secondary btn-small" onclick="deleteCrmDiscadoraMap(${m.id})"><i data-lucide="trash-2"></i></button>
    `;
    listEl.appendChild(li);
  });
  if (window.lucide) window.lucide.createIcons();
}

async function deleteCrmDiscadoraMap(id) {
  await apiFetch(`/api/crm/admin/discadora-mapeamentos/${id}`, { method: 'DELETE' });
  loadCrmAdminDiscadora();
}

async function loadClosersFilter() {
  const select = document.getElementById('closer-kanban-filter-user');
  if (!select) return;

  const data = await apiFetch('/api/crm/admin/fila-closers');
  if (data && data.fila) {
    data.fila.sort((a, b) => {
      const nameA = (a.name || a.username || '').toLowerCase();
      const nameB = (b.name || b.username || '').toLowerCase();
      return nameA.localeCompare(nameB, 'pt-BR');
    });
    select.innerHTML = '<option value="">Todos os Closers</option>';
    data.fila.forEach(f => {
      select.innerHTML += `<option value="${f.closer_id}">${escapeHtml(f.name || f.username)}</option>`;
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateString(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleString('pt-BR');
}

function formatTimeAgo(isoString) {
  if (!isoString) return '';
  const diffSec = Math.round((new Date().getTime() - new Date(isoString).getTime()) / 1000);
  if (diffSec <= 0) return 'agora';
  if (diffSec < 60) return `${diffSec}s atrás`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m atrás`;
  const diffHours = Math.floor(diffSec / 3600);
  if (diffHours < 48) return `${diffHours}h atrás`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d atrás`;
}

function formatShortDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}`;
}

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCpf(cpf) {
  if (!cpf) return '';
  let digits = String(cpf).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 11) {
    digits = digits.padStart(11, '0');
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return cpf;
}

// ----------------------------------------
// MODAL DE DETALHES DO LEAD (ABRIR AO CLICAR NO CARD)
// ----------------------------------------
async function openLeadDetailsModal(leadId, pipelineTipo) {
  try {
    const poolLeads = pipelineTipo === 'closer' ? CrmState.closerLeads : CrmState.sdrLeads;
    let lead = (poolLeads || []).find(l => parseInt(l.id, 10) === parseInt(leadId, 10));

    if (!lead) {
      const allLeads = [...CrmState.sdrLeads, ...CrmState.closerLeads];
      lead = allLeads.find(l => parseInt(l.id, 10) === parseInt(leadId, 10));
    }

    if (!lead) return;

    // 1. ABRIR O MODAL INSTANTANEAMENTE (0ms) COM DADOS LOCAIS NA MEMÓRIA
    const modal = document.getElementById('modal-lead-details');
    if (modal) modal.classList.remove('hidden');

    document.getElementById('modal-lead-id').value = leadId;
    document.getElementById('modal-lead-cliente-id').value = lead.cliente_id || '';

    const clienteNomeLocal = (lead.cliente_nome && lead.cliente_nome.trim()) ? lead.cliente_nome : (lead.cliente_cpf ? `Cliente CPF ${formatCpf(lead.cliente_cpf)}` : `Cliente #${lead.cliente_id}`);
    document.getElementById('modal-lead-nome').textContent = clienteNomeLocal;
    document.getElementById('modal-lead-cpf').textContent = lead.cliente_cpf ? formatCpf(lead.cliente_cpf) : 'Não informado';
    document.getElementById('modal-lead-telefone').textContent = lead.cliente_telefone || 'Não informado';

    const isCloserPipeline = (lead.pipeline_tipo === 'closer' || pipelineTipo === 'closer');
    const closerNomeDisplay = (lead.closer_nome && lead.closer_nome.trim()) || (lead.closer_username && lead.closer_username.trim());
    const sdrNomeDisplay = (lead.sdr_nome && lead.sdr_nome.trim()) || (lead.sdr_username && lead.sdr_username.trim());

    const consultorModalNome = isCloserPipeline
      ? (closerNomeDisplay || 'Aguardando Closer')
      : (sdrNomeDisplay || lead.discadora_login || 'Não atribuído');

    document.getElementById('modal-lead-consultor').textContent = consultorModalNome;

    const sdrWrapper = document.getElementById('modal-lead-sdr-wrapper');
    const sdrSpan = document.getElementById('modal-lead-sdr');
    if (sdrWrapper && sdrSpan) {
      if (isCloserPipeline && sdrNomeDisplay) {
        sdrSpan.textContent = sdrNomeDisplay;
        sdrWrapper.classList.remove('hidden');
      } else {
        sdrWrapper.classList.add('hidden');
      }
    }

    const badgeEstagio = document.getElementById('modal-lead-badge-estagio');
    if (badgeEstagio) {
      badgeEstagio.textContent = (lead.estagio_nome || 'CONTATO INICIAL').toUpperCase();
      badgeEstagio.style.background = lead.estagio_cor || '#4F46E5';
    }

    const recentHistoryEl = document.getElementById('modal-lead-recent-history');
    if (recentHistoryEl) {
      recentHistoryEl.innerHTML = '<div class="text-muted" style="font-size: 12px; padding: 6px;">Carregando histórico...</div>';
    }

    if (window.lucide) window.lucide.createIcons();

    // 2. BUSCAR DADOS COMPLETOS E USUÁRIOS EM SEGUNDO PLANO (SEM BLOQUEAR A TELA)
    const currentUser = typeof getUser === 'function' ? getUser() : null;
    const isAdmin = currentUser && currentUser.role === 'admin';
    const isSupervisor = currentUser && currentUser.role === 'supervisor';
    const canReassign = isAdmin || isSupervisor;

    // Cache de Usuários para reatribuição de operador
    if (canReassign && (!CrmState.usersList || CrmState.usersList.length === 0)) {
      try {
        const resUsers = await apiFetch('/api/users');
        if (resUsers && Array.isArray(resUsers)) {
          CrmState.usersList = resUsers;
        }
      } catch (_) {}
    }

    // Preencher dropdown de usuários com cache
    const closerGroup = document.getElementById('modal-lead-closer-group');
    const selectCloser = document.getElementById('modal-lead-select-closer');
    if (closerGroup && selectCloser) {
      if (canReassign) {
        closerGroup.classList.remove('hidden');
        const labelEl = closerGroup.querySelector('label');
        if (labelEl) {
          labelEl.textContent = isCloserPipeline ? 'Closer Responsável:' : 'SDR Responsável:';
        }
        selectCloser.innerHTML = '<option value="">-- Selecione o Operador --</option>';

        let usersList = [...(CrmState.usersList || [])];
        usersList.sort((a, b) => {
          const nameA = (a.name || a.username || '').toLowerCase();
          const nameB = (b.name || b.username || '').toLowerCase();
          return nameA.localeCompare(nameB, 'pt-BR');
        });

        const currentAssignedId = isCloserPipeline ? lead.closer_id : lead.sdr_id;
        usersList.forEach(u => {
          const isSelected = String(u.id) === String(currentAssignedId);
          const nameDisplay = u.name ? `${escapeHtml(u.name)} (@${escapeHtml(u.username)})` : `@${escapeHtml(u.username)}`;
          selectCloser.innerHTML += `<option value="${u.id}" ${isSelected ? 'selected' : ''}>${nameDisplay}</option>`;
        });

        selectCloser.dataset.originalOperatorId = currentAssignedId || '';
        selectCloser.dataset.pipelineTipo = isCloserPipeline ? 'closer' : 'sdr';
      } else {
        closerGroup.classList.add('hidden');
      }
    }

    // Buscar dados estendidos do cliente e histórico via API
    const data = await apiFetch(`/api/crm/clientes/${lead.cliente_id}`);
    if (!data || data.error || !data.cliente) return;
    const cli = data.cliente;

    // Salvaguarda: se o modal tiver mudado para outro lead durante a requisição, ignora
    const currentModalLeadId = document.getElementById('modal-lead-id')?.value;
    if (String(currentModalLeadId) !== String(leadId)) return;

    const clienteNome = (cli.nome && cli.nome.trim()) ? cli.nome : (cli.cpf ? `Cliente CPF ${formatCpf(cli.cpf)}` : `Cliente #${cli.id}`);
    document.getElementById('modal-lead-nome').textContent = clienteNome;
    document.getElementById('modal-lead-cpf').textContent = cli.cpf ? formatCpf(cli.cpf) : 'Não informado';
    document.getElementById('modal-lead-telefone').textContent = cli.telefone || 'Não informado';

    // Buscar e exibir valor de contrato do lead (prioriza cli.valor_contrato, fallback para tabulacoes)
    const valorContrato = cli.valor_contrato ? parseFloat(cli.valor_contrato) : (lead.valor_contrato ? parseFloat(lead.valor_contrato) : 0);
    const latestValTab = (data.tabulacoes || []).find(t => t.valor && parseFloat(t.valor) > 0);
    const resolvedValor = valorContrato > 0 ? valorContrato : (latestValTab ? parseFloat(latestValTab.valor) : 0);

    const valWrapper = document.getElementById('modal-lead-valor-wrapper');
    const valSpan = document.getElementById('modal-lead-valor-val');
    const valInput = document.getElementById('modal-lead-valor');
    
    if (valInput) {
      valInput.value = resolvedValor > 0 ? 'R$ ' + resolvedValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    }
    
    if (valWrapper && valSpan) {
      if (resolvedValor > 0) {
        valSpan.textContent = `R$ ${resolvedValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        valWrapper.classList.remove('hidden');
      } else {
        valWrapper.classList.add('hidden');
      }
    }

    // Preencher E-mail e Dados bancários
    const emailInput = document.getElementById('modal-lead-email');
    if (emailInput) emailInput.value = cli.email || '';

    const bancoInput = document.getElementById('modal-lead-banco');
    const agenciaInput = document.getElementById('modal-lead-agencia');
    const contaInput = document.getElementById('modal-lead-conta');
    if (bancoInput) bancoInput.value = cli.banco || lead.cliente_banco || '';
    if (agenciaInput) agenciaInput.value = cli.agencia || lead.cliente_agencia || '';
    if (contaInput) contaInput.value = cli.conta || lead.cliente_conta || '';

    // Botão Transferir para Closer / Resolvido
    const btnTransfer = document.getElementById('btn-modal-lead-transfer-closer');
    if (btnTransfer) {
      const isAberturaSdr = (lead.pipeline_tipo || pipelineTipo) === 'sdr' && (lead.estagio_nome || '').trim().toUpperCase() === 'ABERTURA DE CONTA';
      if (isAberturaSdr) {
        btnTransfer.classList.remove('hidden');
        btnTransfer.onclick = (e) => {
          e.preventDefault();
          handleTransferToCloserClick(leadId);
        };
      } else {
        btnTransfer.classList.add('hidden');
      }
    }

    // Botão Ver Ficha Completa
    const btnFull = document.getElementById('btn-modal-lead-full-history');
    if (btnFull) {
      btnFull.onclick = () => {
        closeLeadDetailsModal();
        if (typeof switchTab === 'function') switchTab('crm-clientes');
        else window.location.hash = '#crm-clientes';
        loadClientDetails(cli.id);
      };
    }

    // Observações
    document.getElementById('modal-lead-obs').value = cli.observacoes || '';

    // Select de estágios e visibilidade de seções
    const selectEstagio = document.getElementById('modal-lead-select-estagio');
    if (selectEstagio) {
      selectEstagio.dataset.originalStageId = lead.estagio_id;
      selectEstagio.innerHTML = '';
      const pTipo = lead.pipeline_tipo || pipelineTipo || 'sdr';
      const estagiosDoPipeline = (CrmState.estagios || []).filter(e => e.pipeline_tipo === pTipo);
      estagiosDoPipeline.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = `${e.nome} (${e.pipeline_tipo.toUpperCase()})`;
        if (parseInt(e.id, 10) === parseInt(lead.estagio_id, 10)) opt.selected = true;
        selectEstagio.appendChild(opt);
      });

      const docsWrapper = document.getElementById('modal-lead-docs-wrapper');
      const emailGroup = document.getElementById('modal-lead-email-group');
      const bancoWrapper = document.getElementById('modal-lead-banco-wrapper');
      const valorGroup = document.getElementById('modal-lead-valor-group') || document.querySelector('#modal-lead-valor')?.closest('.form-group-vertical');
      const obsGroup = document.getElementById('modal-lead-obs-group') || document.querySelector('#modal-lead-obs')?.closest('.form-group-vertical');
      const historyGroup = document.getElementById('modal-lead-history-group') || document.querySelector('#modal-lead-recent-history')?.closest('div[style*="background"]');

      const applyModalVisibility = (estagioId) => {
        const selectedEst = (CrmState.estagios || []).find(e => parseInt(e.id, 10) === parseInt(estagioId, 10));

        const showDocs = selectedEst ? selectedEst.modal_exibir_docs !== false : true;
        const showEmail = selectedEst ? selectedEst.modal_exibir_email !== false : true;
        const showValor = selectedEst ? selectedEst.modal_exibir_valor !== false : true;
        const showObs = selectedEst ? selectedEst.modal_exibir_obs !== false : true;
        const showHistorico = selectedEst ? selectedEst.modal_exibir_historico !== false : true;
        const showCloser = selectedEst ? selectedEst.modal_exibir_closer !== false : true;
        const showDadosBancarios = selectedEst ? selectedEst.modal_exibir_dados_bancarios === true : false;

        if (docsWrapper) {
          if (showDocs) {
            docsWrapper.classList.remove('hidden');
            renderLeadDocuments(leadId, cli);
          } else {
            docsWrapper.classList.add('hidden');
          }
        }
        if (emailGroup) emailGroup.classList.toggle('hidden', !showEmail);
        if (bancoWrapper) bancoWrapper.classList.toggle('hidden', !showDadosBancarios);
        if (valorGroup) valorGroup.classList.toggle('hidden', !showValor);
        if (obsGroup) obsGroup.classList.toggle('hidden', !showObs);
        if (historyGroup) historyGroup.classList.toggle('hidden', !showHistorico);
        if (closerGroup) closerGroup.classList.toggle('hidden', !(showCloser && canReassign));
      };

      applyModalVisibility(selectEstagio.value);
      selectEstagio.onchange = () => {
        applyModalVisibility(selectEstagio.value);
      };
    }

    // Histórico recente unificado
    if (recentHistoryEl) {
      recentHistoryEl.innerHTML = '';
      
      const tabulacoes = (data.tabulacoes || []).map(t => ({
        type: 'tabulacao',
        date: t.created_at,
        title: t.tipo_tabulacao,
        description: t.observacao,
        user: t.consultor_nome || t.consultor_username || 'Sistema',
        valor: t.valor
      }));

      const historico = (data.historicoKanban || []).map(h => {
        let title = 'Movimentação no Kanban';
        if (h.estagio_anterior_nome && h.estagio_novo_nome) {
          title = `Kanban: Mover de ${h.estagio_anterior_nome} para ${h.estagio_novo_nome}`;
        } else if (h.estagio_novo_nome) {
          title = `Kanban: Entrou em ${h.estagio_novo_nome}`;
        }
        return {
          type: 'kanban',
          date: h.created_at,
          title: title,
          description: h.observacao,
          user: h.usuario_nome || 'Sistema'
        };
      });

      const allEvents = [...tabulacoes, ...historico].sort((a, b) => new Date(b.date) - new Date(a.date));

      if (allEvents.length === 0) {
        recentHistoryEl.innerHTML = '<div class="text-muted" style="font-size: 12px;">Nenhum histórico registrado ainda.</div>';
      } else {
        allEvents.slice(0, 5).forEach(event => {
          const div = document.createElement('div');
          div.style.cssText = 'font-size: 12px; padding: 8px 10px; background: rgba(255,255,255,0.03); border-radius: 6px; display: flex; flex-direction: column; gap: 4px; border: 1px solid rgba(255,255,255,0.01);';
          
          const icon = event.type === 'tabulacao' ? 'phone-call' : 'git-commit';
          const iconColor = event.type === 'tabulacao' ? '#60A5FA' : 'var(--accent-purple)';
          
          div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <span style="display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <i data-lucide="${icon}" style="width: 12px; height: 12px; color: ${iconColor};"></i>
                <strong style="color: #fff;">${escapeHtml(event.title)}</strong>
                ${event.valor && parseFloat(event.valor) > 0 ? `<span class="badge success-badge" style="background: rgba(34, 197, 94, 0.12); color: var(--accent-emerald); border: 1px solid rgba(34, 197, 94, 0.2); font-size: 10px; padding: 2px 6px; border-radius: 4px; line-height: 1;">R$ ${parseFloat(event.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>` : ''}
              </span>
              <span class="text-muted" style="font-size: 11px; white-space: nowrap;">${formatDateString(event.date)}</span>
            </div>
            ${event.description ? `<div style="color: rgba(255,255,255,0.8); font-size: 12px; word-break: break-word; padding-left: 18px;">${escapeHtml(event.description)}</div>` : ''}
            <div class="text-muted" style="font-size: 11px; display: flex; align-items: center; gap: 4px; margin-top: 2px; padding-left: 18px;">
              <i data-lucide="user" style="width: 11px; height: 11px; opacity: 0.6;"></i>
              <span>Por: <strong style="color: rgba(255,255,255,0.6);">${escapeHtml(event.user)}</strong></span>
            </div>
          `;
          recentHistoryEl.appendChild(div);
        });
      }
    }

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Erro ao abrir detalhes do lead:', err);
  }
}

function closeLeadDetailsModal() {
  document.getElementById('modal-lead-details').classList.add('hidden');
}

async function handleTransferToCloserClick(leadId) {
  try {
    // Primeiro salvamos qualquer alteração pendente no e-mail, dados bancários ou observações
    const email = document.getElementById('modal-lead-email')?.value || '';
    const observacoes = document.getElementById('modal-lead-obs').value;
    const valor = document.getElementById('modal-lead-valor')?.value || '';
    const banco = document.getElementById('modal-lead-banco')?.value || '';
    const agencia = document.getElementById('modal-lead-agencia')?.value || '';
    const conta = document.getElementById('modal-lead-conta')?.value || '';
    const clienteId = document.getElementById('modal-lead-cliente-id').value;

    // Chamar API para atualizar os dados do cliente antes da transição
    const clienteAtual = await apiFetch(`/api/crm/clientes/${clienteId}`);
    if (clienteAtual && clienteAtual.cliente) {
      await apiFetch('/api/crm/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: clienteId,
          nome: clienteAtual.cliente.nome,
          cpf: clienteAtual.cliente.cpf,
          telefone: clienteAtual.cliente.telefone,
          email: email,
          observacoes: observacoes,
          valor: valor,
          banco: banco,
          agencia: agencia,
          conta: conta
        })
      });
    }

    // Agora executamos a transferência
    const res = await apiFetch(`/api/crm/kanban/leads/${leadId}/transfer-to-closer`, {
      method: 'POST'
    });

    if (res && res.error) {
      if (typeof showToast === 'function') showToast(res.error, 'error');
      return;
    }

    if (res && res.success) {
      // 1. Fechar o modal de detalhes do lead
      closeLeadDetailsModal();

      // 2. Exibir o modal de confirmação com o Closer sorteado
      const modalConfirm = document.getElementById('modal-transfer-closer-confirm');
      const closerNameEl = document.getElementById('modal-transfer-closer-name');
      if (closerNameEl && res.closer) {
        closerNameEl.textContent = res.closer.name || res.closer.username;
      }
      if (modalConfirm) {
        modalConfirm.classList.remove('hidden');
      }

      // 3. Atualizar o Kanban
      loadKanbanBoard('sdr');
      loadKanbanBoard('closer');
    }
  } catch (err) {
    console.error('Erro ao transferir lead:', err);
    if (typeof showToast === 'function') showToast('Erro ao transferir lead.', 'error');
  }
}

function confirmTransferCloserCiente() {
  const confirmModal = document.getElementById('modal-transfer-closer-confirm');
  if (confirmModal) {
    confirmModal.classList.add('hidden');
  }
  // Recarrega os boards
  loadKanbanBoard('sdr');
  loadKanbanBoard('closer');
}



function openLossReasonModal(e) {
  if (e) e.preventDefault();
  const selectEstagio = document.getElementById('modal-lead-select-estagio');
  const currentEstagioId = selectEstagio?.value || selectEstagio?.dataset.originalStageId;
  const selectMotivo = document.getElementById('loss-reason-select');
  
  if (selectMotivo && currentEstagioId) {
    selectMotivo.innerHTML = '<option value="">-- Selecione o Motivo --</option>';
    const estagio = (CrmState.estagios || []).find(est => parseInt(est.id, 10) === parseInt(currentEstagioId, 10));
    if (estagio && estagio.motivos_perda) {
      const motivos = estagio.motivos_perda.split(',').map(m => m.trim()).filter(m => m.length > 0);
      motivos.forEach(m => {
        selectMotivo.innerHTML += `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`;
      });
    } else {
      selectMotivo.innerHTML += '<option value="Outros">Outros</option>';
    }
  }

  document.getElementById('modal-loss-reason-confirm').classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function closeLossReasonModal() {
  document.getElementById('modal-loss-reason-confirm').classList.add('hidden');
}

async function salvarDadosCliente(clienteId, email, observacoes, valor, banco, agencia, conta) {
  const clienteAtual = await apiFetch(`/api/crm/clientes/${clienteId}`);
  if (clienteAtual && clienteAtual.cliente) {
    await apiFetch('/api/crm/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: clienteId,
        nome: clienteAtual.cliente.nome,
        cpf: clienteAtual.cliente.cpf,
        telefone: clienteAtual.cliente.telefone,
        email: email,
        observacoes: observacoes,
        valor: valor,
        banco: banco,
        agencia: agencia,
        conta: conta
      })
    });
  }
}

function applyCurrencyMask(input) {
  input.addEventListener('input', (e) => {
    let value = e.target.value;
    
    // Remove tudo o que não for dígito
    value = value.replace(/\D/g, "");
    
    if (value === "") {
      e.target.value = "";
      return;
    }
    
    const options = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    const result = (parseFloat(value) / 100).toLocaleString('pt-BR', options);
    
    e.target.value = "R$ " + result;
  });
}

function initLeadDetailsForm() {
  // Fechar modals com a tecla ESC (respeitando a sobreposição de modais)
  if (!window._escModalListenerAdded) {
    window._escModalListenerAdded = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        // 1. Modais de confirmação / sobrepostos primeiro (maior prioridade)
        const modalLoss = document.getElementById('modal-loss-reason-confirm');
        if (modalLoss && !modalLoss.classList.contains('hidden')) {
          closeLossReasonModal();
          return;
        }

        const modalTransfer = document.getElementById('modal-transfer-closer-confirm');
        if (modalTransfer && !modalTransfer.classList.contains('hidden')) {
          if (typeof confirmTransferCloserCiente === 'function') confirmTransferCloserCiente();
          else modalTransfer.classList.add('hidden');
          return;
        }

        // 2. Modais de tabulação, novo cliente e edição de estágio
        const modalTab = document.getElementById('modal-tabulacao');
        if (modalTab && !modalTab.classList.contains('hidden')) {
          closeTabulacaoModal();
          return;
        }

        const modalNovoCli = document.getElementById('modal-novo-cliente');
        if (modalNovoCli && !modalNovoCli.classList.contains('hidden')) {
          closeNewClientModal();
          return;
        }

        const modalEditEstagio = document.getElementById('modal-edit-estagio');
        if (modalEditEstagio && !modalEditEstagio.classList.contains('hidden')) {
          closeEditEstagioModal();
          return;
        }

        // 3. Modal de detalhes do lead
        const modalLead = document.getElementById('modal-lead-details');
        if (modalLead && !modalLead.classList.contains('hidden')) {
          closeLeadDetailsModal();
          return;
        }

        // 4. Fallback genérico para qualquer backdrop de modal aberto
        const openModals = document.querySelectorAll('.modal-backdrop:not(.hidden)');
        if (openModals.length > 0) {
          openModals[openModals.length - 1].classList.add('hidden');
        }
      }
    });
  }

  const modalLead = document.getElementById('modal-lead-details');
  if (modalLead) {
    modalLead.addEventListener('click', (e) => {
      if (e.target === modalLead) closeLeadDetailsModal();
    });
  }

  const modalLoss = document.getElementById('modal-loss-reason-confirm');
  if (modalLoss) {
    modalLoss.addEventListener('click', (e) => {
      if (e.target === modalLoss) closeLossReasonModal();
    });
  }

  const modalTab = document.getElementById('modal-tabulacao');
  if (modalTab) {
    modalTab.addEventListener('click', (e) => {
      if (e.target === modalTab) closeTabulacaoModal();
    });
  }

  const valorInput = document.getElementById('modal-lead-valor');
  if (valorInput) {
    applyCurrencyMask(valorInput);
  }

  document.getElementById('form-confirm-loss')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const leadId = document.getElementById('modal-lead-id').value;
    const motivo = document.getElementById('loss-reason-select').value;
    const observacao = document.getElementById('loss-observation').value;

    const res = await apiFetch(`/api/crm/kanban/leads/${leadId}/mark-loss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo, observacao })
    });

    if (res && res.success) {
      if (typeof showToast === 'function') showToast('Lead marcado como perdido.', 'success');
      closeLossReasonModal();
      closeLeadDetailsModal();
      loadKanbanBoard('sdr');
      loadKanbanBoard('closer');
    } else {
      if (typeof showToast === 'function') showToast(res?.error || 'Erro ao registrar perda.', 'error');
    }
  });

  const form = document.getElementById('form-modal-lead-details');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const leadId = document.getElementById('modal-lead-id').value;
    const clienteId = document.getElementById('modal-lead-cliente-id').value;
    const novoEstagioId = document.getElementById('modal-lead-select-estagio').value;
    const observacoes = document.getElementById('modal-lead-obs').value;
    const valor = document.getElementById('modal-lead-valor')?.value || '';
    const email = document.getElementById('modal-lead-email')?.value || '';
    const banco = document.getElementById('modal-lead-banco')?.value || '';
    const agencia = document.getElementById('modal-lead-agencia')?.value || '';
    const conta = document.getElementById('modal-lead-conta')?.value || '';

    const selectedEst = (CrmState.estagios || []).find(e => parseInt(e.id, 10) === parseInt(novoEstagioId, 10));
    const isEmailRequired = selectedEst && selectedEst.nome.trim().toUpperCase() === 'ABERTURA DE CONTA';
    
    if (isEmailRequired && (!email || email.trim() === '' || !email.includes('@'))) {
      if (typeof showToast === 'function') {
        showToast('E-mail válido é obrigatório para a etapa de Abertura de Conta.', 'error');
      }
      return;
    }

    try {
      // 1. Atualizar dados do cliente
      await salvarDadosCliente(clienteId, email, observacoes, valor, banco, agencia, conta);

      // 2. Mover de estágio se alterou
      if (leadId && novoEstagioId) {
        const originalStageId = document.getElementById('modal-lead-select-estagio').dataset.originalStageId;
        const stageChanged = String(originalStageId) !== String(novoEstagioId);

        if (stageChanged) {
          const moveRes = await apiFetch(`/api/crm/kanban/leads/${leadId}/move`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estagio_id: novoEstagioId, observacao: 'Estágio alterado via Modal do Lead' })
          });
          if (moveRes && moveRes.error) {
            if (typeof showToast === 'function') showToast(moveRes.error, 'error');
            return;
          }
        }
      }

      // 3. Reatribuir Closer/SDR se alterou no dropdown
      const selectCloser = document.getElementById('modal-lead-select-closer');
      if (selectCloser && selectCloser.value !== undefined) {
        const originalOpId = selectCloser.dataset.originalOperatorId || selectCloser.dataset.originalCloserId || '';
        const pipelineTipo = selectCloser.dataset.pipelineTipo || 'closer';
        if (selectCloser.value && String(originalOpId) !== String(selectCloser.value)) {
          const payload = pipelineTipo === 'sdr'
            ? { sdr_id: parseInt(selectCloser.value, 10) }
            : { closer_id: parseInt(selectCloser.value, 10) };

          await apiFetch(`/api/crm/kanban/leads/${leadId}/reassign`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        }
      }

      if (typeof showToast === 'function') showToast('Alterações do lead salvas com sucesso!', 'success');
      closeLeadDetailsModal();
      loadKanbanBoard('sdr');
      loadKanbanBoard('closer');
    } catch (err) {
      console.error('Erro ao salvar detalhes do lead:', err);
    }
  });
}

function populateStageFilterDropdown(pipelineTipo, estagiosFiltrados) {
  const select = document.getElementById(`${pipelineTipo}-kanban-filter-estagio`);
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="">Todas as Etapas</option>';
  (estagiosFiltrados || []).forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.nome;
    if (String(e.id) === String(currentVal)) opt.selected = true;
    select.appendChild(opt);
  });
}

function setupCustomMultiSelect(filterId, defaultLabel, userMap, pipelineTipo, isRestrict, currentUser) {
  const trigger = document.getElementById(`${filterId}-trigger`);
  const menu = document.getElementById(`${filterId}-menu`);
  const parentContainer = trigger?.closest('.custom-multiselect');
  
  if (!trigger || !menu) return;

  if (!CrmState.selectedUsers) CrmState.selectedUsers = {};
  if (!CrmState.selectedUsers[filterId]) CrmState.selectedUsers[filterId] = [];

  if (isRestrict && currentUser) {
    if (parentContainer) parentContainer.style.display = 'none';
    CrmState.selectedUsers[filterId] = [String(currentUser.id)];
    return;
  } else {
    if (parentContainer) parentContainer.style.display = '';
  }

  // Bind click toggle on trigger once
  if (!trigger.dataset.initialized) {
    trigger.dataset.initialized = 'true';
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.custom-multiselect-menu').forEach(m => {
        if (m !== menu) m.classList.add('hidden');
      });
      document.querySelectorAll('.custom-multiselect-trigger').forEach(t => {
        if (t !== trigger) t.classList.remove('open');
      });
      const willOpen = menu.classList.contains('hidden');
      menu.classList.toggle('hidden', !willOpen);
      trigger.classList.toggle('open', willOpen);
    });
  }

  // Sort users alphabetically
  const sortedUsers = Array.from(userMap.entries()).sort((a, b) => {
    return a[1].toLowerCase().localeCompare(b[1].toLowerCase(), 'pt-BR');
  });

  // Keep only valid selections
  const validKeys = new Set(sortedUsers.map(([k]) => String(k)));
  CrmState.selectedUsers[filterId] = (CrmState.selectedUsers[filterId] || []).filter(id => validKeys.has(String(id)));

  const selectedSet = new Set(CrmState.selectedUsers[filterId].map(String));

  menu.innerHTML = '';

  // Option 0: All (Resets selection)
  const allItem = document.createElement('div');
  const isAllSelected = selectedSet.size === 0;
  allItem.className = `custom-multiselect-item ${isAllSelected ? 'selected' : ''}`;
  allItem.innerHTML = `
    <input type="checkbox" class="custom-multiselect-checkbox" ${isAllSelected ? 'checked' : ''} style="pointer-events:none;">
    <span>${escapeHtml(defaultLabel)}</span>
  `;
  allItem.addEventListener('click', (e) => {
    e.stopPropagation();
    CrmState.selectedUsers[filterId] = [];
    renderMultiSelectItemsState(filterId, defaultLabel, sortedUsers, pipelineTipo);
    filterKanbanCards(pipelineTipo);
  });
  menu.appendChild(allItem);

  // User Options
  sortedUsers.forEach(([idKey, name]) => {
    const keyStr = String(idKey);
    const isSelected = selectedSet.has(keyStr);
    const item = document.createElement('div');
    item.className = `custom-multiselect-item ${isSelected ? 'selected' : ''}`;
    item.innerHTML = `
      <input type="checkbox" class="custom-multiselect-checkbox" ${isSelected ? 'checked' : ''} style="pointer-events:none;">
      <span>${escapeHtml(name)}</span>
    `;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      let currentArr = CrmState.selectedUsers[filterId] || [];
      if (currentArr.includes(keyStr)) {
        currentArr = currentArr.filter(id => id !== keyStr);
      } else {
        currentArr.push(keyStr);
      }
      CrmState.selectedUsers[filterId] = currentArr;
      renderMultiSelectItemsState(filterId, defaultLabel, sortedUsers, pipelineTipo);
      filterKanbanCards(pipelineTipo);
    });
    menu.appendChild(item);
  });

  renderMultiSelectTriggerLabel(filterId, defaultLabel, userMap);
}

function renderMultiSelectItemsState(filterId, defaultLabel, sortedUsers, pipelineTipo) {
  const menu = document.getElementById(`${filterId}-menu`);
  if (!menu) return;
  const selectedSet = new Set((CrmState.selectedUsers[filterId] || []).map(String));
  const userMap = new Map(sortedUsers);

  const items = menu.querySelectorAll('.custom-multiselect-item');
  items.forEach((item, index) => {
    if (index === 0) {
      const isAll = selectedSet.size === 0;
      item.classList.toggle('selected', isAll);
      const chk = item.querySelector('.custom-multiselect-checkbox');
      if (chk) chk.checked = isAll;
    } else {
      const [idKey] = sortedUsers[index - 1] || [];
      const isSel = selectedSet.has(String(idKey));
      item.classList.toggle('selected', isSel);
      const chk = item.querySelector('.custom-multiselect-checkbox');
      if (chk) chk.checked = isSel;
    }
  });

  renderMultiSelectTriggerLabel(filterId, defaultLabel, userMap);
}

function renderMultiSelectTriggerLabel(filterId, defaultLabel, userMap) {
  const labelEl = document.querySelector(`#${filterId}-trigger .custom-multiselect-label`);
  if (!labelEl) return;

  const selectedIds = CrmState.selectedUsers[filterId] || [];
  if (selectedIds.length === 0) {
    labelEl.textContent = defaultLabel;
  } else if (selectedIds.length === 1) {
    const name = userMap.get(selectedIds[0]) || userMap.get(Number(selectedIds[0])) || defaultLabel;
    labelEl.textContent = name;
  } else {
    const names = selectedIds.map(id => userMap.get(id) || userMap.get(Number(id))).filter(Boolean);
    const joined = names.join(', ');
    if (joined.length <= 16) {
      labelEl.textContent = joined;
    } else {
      const entity = filterId.includes('sdr') ? 'SDRs' : 'Closers';
      labelEl.textContent = `${selectedIds.length} ${entity} Selecionados`;
    }
  }
}

function populateUserFilterDropdown(pipelineTipo, leads) {
  const currentUser = typeof getUser === 'function' ? getUser() : null;
  const isRestrict = currentUser && (
    (pipelineTipo === 'sdr' && currentUser.role === 'sdr') ||
    (pipelineTipo === 'closer' && currentUser.role === 'closer')
  );

  const filterId = `${pipelineTipo}-kanban-filter-user`;
  const defaultLabel = pipelineTipo === 'sdr' ? 'Todos os SDRs' : 'Todos os Closers';

  const userMap = new Map();
  (leads || []).forEach(l => {
    const uKey = pipelineTipo === 'sdr' 
      ? (l.sdr_id ? String(l.sdr_id) : (l.discadora_login ? String(l.discadora_login) : null))
      : (l.closer_id ? String(l.closer_id) : null);

    const uName = pipelineTipo === 'sdr' 
      ? ((l.sdr_nome && l.sdr_nome.trim()) || l.sdr_username || l.discadora_login)
      : ((l.closer_nome && l.closer_nome.trim()) || l.closer_username || 'Sem Nome');

    if (uKey && uName && !userMap.has(uKey)) {
      userMap.set(uKey, uName);
    }
  });

  setupCustomMultiSelect(filterId, defaultLabel, userMap, pipelineTipo, isRestrict, currentUser);

  if (pipelineTipo === 'closer') {
    const sdrFilterId = 'closer-kanban-filter-sdr';
    const sdrDefaultLabel = 'Todos os SDRs';
    const sdrMap = new Map();
    (leads || []).forEach(l => {
      const sKey = l.sdr_id ? String(l.sdr_id) : null;
      const sName = (l.sdr_nome && l.sdr_nome.trim()) || l.sdr_username;
      if (sKey && sName && !sdrMap.has(sKey)) {
        sdrMap.set(sKey, sName);
      }
    });

    setupCustomMultiSelect(sdrFilterId, sdrDefaultLabel, sdrMap, 'closer', false, null);
  }
}

// ----------------------------------------
// LÓGICA DE UPLOAD E DOWNLOAD DE DOCUMENTOS (GOOGLE DRIVE)
// ----------------------------------------
function renderLeadDocuments(leadId, cliente) {
  const docs = [
    { key: 'contracheque', label: 'Contracheque', field: 'doc_contracheque_id' },
    { key: 'extrato', label: 'Extrato de Consignação', field: 'doc_extrato_id' },
    { key: 'identificacao', label: 'Documento de Identificação', field: 'doc_identificacao_id' },
    { key: 'residencia', label: 'Comprovante de Residência', field: 'doc_residencia_id' },
    { key: 'espelho', label: 'Espelho da Proposta', field: 'doc_espelho_id' }
  ];

  docs.forEach(doc => {
    const container = document.getElementById(`doc-${doc.key}-status`);
    if (!container) return;

    const fileId = cliente[doc.field];
    if (fileId) {
      // Já enviado: mostrar botão download, substituir e excluir
      container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(16,185,129,0.06); border: 1px solid rgba(16,185,129,0.2); border-radius: 4px; padding: 6px 10px; margin-top: 4px;">
          <span style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #34D399; font-weight: 500;">
            <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i>
            Anexado
          </span>
          <div style="display: flex; gap: 8px;">
            <button type="button" onclick="downloadCrmDoc('${fileId}')" title="Baixar documento" style="background: none; border: none; color: #10B981; cursor: pointer; padding: 2px;">
              <i data-lucide="download" style="width: 14px; height: 14px;"></i>
            </button>
            <button type="button" onclick="triggerDocUpload('${leadId}', '${doc.key}')" title="Substituir documento" style="background: none; border: none; color: #F59E0B; cursor: pointer; padding: 2px;">
              <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i>
            </button>
            <button type="button" onclick="deleteCrmDoc('${leadId}', '${doc.key}')" title="Excluir documento" style="background: none; border: none; color: #EF4444; cursor: pointer; padding: 2px;">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
          </div>
        </div>
      `;
    } else {
      // Não enviado: mostrar campo de upload
      container.innerHTML = `
        <div style="display: flex; align-items: center; margin-top: 4px;">
          <input type="file" id="file-${doc.key}-${leadId}" accept=".pdf" style="display: none;" onchange="uploadCrmDoc('${leadId}', '${doc.key}')">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('file-${doc.key}-${leadId}').click()" style="width: 100%; font-size: 11px; padding: 6px 12px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: auto;">
            <i data-lucide="upload" style="width: 13px; height: 13px;"></i> Anexar PDF
          </button>
        </div>
      `;
    }
  });

  if (window.lucide) window.lucide.createIcons();
}

async function uploadCrmDoc(leadId, docType) {
  const input = document.getElementById(`file-${docType}-${leadId}`);
  if (!input || !input.files || input.files.length === 0) return;

  const file = input.files[0];
  if (file.type !== 'application/pdf') {
    showToast('Apenas arquivos PDF são permitidos.', 'error');
    return;
  }

  // Mostrar indicador de carregamento
  const container = document.getElementById(`doc-${docType}-status`);
  if (container) {
    container.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #9CA3AF; padding: 6px 10px;">
        <span class="spinner" style="width: 12px; height: 12px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 1s linear infinite;"></span>
        Enviando para o Drive...
      </div>
    `;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('docType', docType);

  try {
    const res = await fetch(`/api/crm/leads/${leadId}/documentos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`
      },
      body: formData
    });

    const data = await res.json();
    if (res.status === 201) {
      showToast('Documento anexado com sucesso!', 'success');
      const pipelineTipo = window.location.hash.includes('closer') ? 'closer' : 'sdr';
      
      // Atualizar no estado local
      const poolLeads = pipelineTipo === 'closer' ? CrmState.closerLeads : CrmState.sdrLeads;
      const leadObj = poolLeads.find(l => parseInt(l.id, 10) === parseInt(leadId, 10));
      if (leadObj) {
        const dbColumns = {
          contracheque: 'doc_contracheque_id',
          extrato: 'doc_extrato_id',
          identificacao: 'doc_identificacao_id',
          residencia: 'doc_residencia_id',
          espelho: 'doc_espelho_id'
        };
        leadObj[dbColumns[docType]] = data.fileId;
      }

      openLeadDetailsModal(leadId, pipelineTipo);
    } else {
      if (data.error && data.error.includes('invalid_grant')) {
        showToast('A autorização do Google Drive expirou. Acesse o Admin CRM para reconectar a conta.', 'error');
      } else {
        showToast(data.error || 'Erro ao fazer upload do documento.', 'error');
      }
      const pipelineTipo = window.location.hash.includes('closer') ? 'closer' : 'sdr';
      openLeadDetailsModal(leadId, pipelineTipo);
    }
  } catch (err) {
    console.error('Erro no upload:', err);
    showToast('Erro de rede ao fazer upload.', 'error');
    const pipelineTipo = window.location.hash.includes('closer') ? 'closer' : 'sdr';
    openLeadDetailsModal(leadId, pipelineTipo);
  }
}

function triggerDocUpload(leadId, docType) {
  // Criar um input temporário para lidar com a substituição de forma robusta
  const tempInput = document.createElement('input');
  tempInput.type = 'file';
  tempInput.accept = '.pdf';
  tempInput.style.display = 'none';
  tempInput.onchange = async () => {
    if (tempInput.files && tempInput.files.length > 0) {
      const file = tempInput.files[0];
      if (file.type !== 'application/pdf') {
        showToast('Apenas arquivos PDF são permitidos.', 'error');
        return;
      }
      
      // Mostrar indicador de carregamento
      const container = document.getElementById(`doc-${docType}-status`);
      if (container) {
        container.innerHTML = `
          <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #9CA3AF; padding: 6px 10px;">
            <span class="spinner" style="width: 12px; height: 12px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; display: inline-block; animation: spin 1s linear infinite;"></span>
            Enviando para o Drive...
          </div>
        `;
      }
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('docType', docType);
      
      try {
        const res = await fetch(`/api/crm/leads/${leadId}/documentos`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getToken()}`
          },
          body: formData
        });
        
        const data = await res.json();
        if (res.status === 201) {
          showToast('Documento atualizado com sucesso!', 'success');
          const pipelineTipo = window.location.hash.includes('closer') ? 'closer' : 'sdr';
          
          // Atualizar no estado local
          const poolLeads = pipelineTipo === 'closer' ? CrmState.closerLeads : CrmState.sdrLeads;
          const leadObj = poolLeads.find(l => parseInt(l.id, 10) === parseInt(leadId, 10));
          if (leadObj) {
            const dbColumns = {
              contracheque: 'doc_contracheque_id',
              extrato: 'doc_extrato_id',
              identificacao: 'doc_identificacao_id',
              residencia: 'doc_residencia_id'
            };
            leadObj[dbColumns[docType]] = data.fileId;
          }
          
          openLeadDetailsModal(leadId, pipelineTipo);
        } else {
          showToast(data.error || 'Erro ao atualizar documento.', 'error');
          const pipelineTipo = window.location.hash.includes('closer') ? 'closer' : 'sdr';
          openLeadDetailsModal(leadId, pipelineTipo);
        }
      } catch (err) {
        console.error('Erro no upload:', err);
        showToast('Erro de rede ao atualizar documento.', 'error');
        const pipelineTipo = window.location.hash.includes('closer') ? 'closer' : 'sdr';
        openLeadDetailsModal(leadId, pipelineTipo);
      }
    }
  };
  document.body.appendChild(tempInput);
  tempInput.click();
  setTimeout(() => tempInput.remove(), 10000);
}

function downloadCrmDoc(fileId) {
  const token = getToken();
  const url = `/api/crm/documentos/download/${fileId}`;
  
  showToast('Iniciando download do arquivo...', 'info');
  
  fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
  .then(res => {
    if (!res.ok) throw new Error('Erro ao baixar arquivo do servidor.');
    
    const disposition = res.headers.get('Content-Disposition');
    let filename = 'documento.pdf';
    if (disposition && disposition.indexOf('attachment') !== -1) {
      const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
      const matches = filenameRegex.exec(disposition);
      if (matches != null && matches[1]) { 
        filename = decodeURIComponent(matches[1].replace(/['"]/g, ''));
      }
    }
    
    return res.blob().then(blob => ({ blob, filename }));
  })
  .then(({ blob, filename }) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  })
  .catch(err => {
    console.error('Erro no download:', err);
    showToast('Falha ao baixar arquivo.', 'error');
  });
}

function showConfirmModal({ title, text, onConfirm }) {
  // Remover modal de confirmação anterior, se houver
  const existing = document.getElementById('custom-confirm-modal');
  if (existing) existing.remove();

  // Criar o backdrop do modal
  const backdrop = document.createElement('div');
  backdrop.id = 'custom-confirm-modal';
  backdrop.style.position = 'fixed';
  backdrop.style.inset = '0';
  backdrop.style.background = 'rgba(0, 0, 0, 0.75)';
  backdrop.style.backdropFilter = 'blur(4px)';
  backdrop.style.display = 'flex';
  backdrop.style.alignItems = 'center';
  backdrop.style.justifyContent = 'center';
  backdrop.style.zIndex = '100000'; // Maior que os outros modals

  // Criar o card do modal
  const card = document.createElement('div');
  card.className = 'card form-card';
  card.style.width = '420px';
  card.style.maxWidth = '90vw';
  card.style.background = '#1b1e2e';
  card.style.border = '1px solid rgba(255, 255, 255, 0.15)';
  card.style.borderRadius = '12px';
  card.style.padding = '20px';
  card.style.boxShadow = '0 20px 50px rgba(0,0,0,0.6)';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.gap = '16px';
  card.style.color = '#fff';

  // Conteúdo do modal
  card.innerHTML = `
    <div style="display: flex; gap: 12px; align-items: flex-start;">
      <div style="background: rgba(239, 68, 68, 0.15); border-radius: 50%; padding: 10px; display: inline-flex; align-items: center; justify-content: center; color: #EF4444; flex-shrink: 0;">
        <i data-lucide="alert-triangle" style="width: 24px; height: 24px;"></i>
      </div>
      <div style="flex: 1;">
        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #fff;">${title}</h3>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.5;">${text}</p>
      </div>
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;">
      <button id="custom-confirm-cancel" type="button" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px; height: auto;">Cancelar</button>
      <button id="custom-confirm-ok" type="button" class="btn btn-danger" style="font-size: 12px; padding: 6px 12px; height: auto; background: #EF4444; border-color: #EF4444; color: #fff;">Excluir</button>
    </div>
  `;

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  // Inicializar ícone lucide
  if (window.lucide) {
    window.lucide.createIcons({
      attrs: {
        class: 'lucide'
      },
      nameAttr: 'data-lucide',
      nodes: card.querySelectorAll('[data-lucide]')
    });
  }

  // Eventos de clique
  const close = () => backdrop.remove();

  backdrop.querySelector('#custom-confirm-cancel').onclick = close;
  backdrop.querySelector('#custom-confirm-ok').onclick = () => {
    close();
    if (onConfirm) onConfirm();
  };

  // Fechar ao clicar fora
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
}

function deleteCrmDoc(leadId, docType) {
  showConfirmModal({
    title: 'Excluir documento?',
    text: 'Deseja realmente excluir este documento do Google Drive e do cadastro do cliente? Esta ação não poderá ser desfeita.',
    onConfirm: async () => {
      const url = `/api/crm/leads/${leadId}/documentos/${docType}`;
      showToast('Excluindo arquivo...', 'info');

      try {
        const res = await fetch(url, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${getToken()}`
          }
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          showToast('Documento excluído com sucesso!', 'success');
          const pipelineTipo = window.location.hash.includes('closer') ? 'closer' : 'sdr';
          
          // Atualizar no estado local
          const poolLeads = pipelineTipo === 'closer' ? CrmState.closerLeads : CrmState.sdrLeads;
          const leadObj = poolLeads.find(l => parseInt(l.id, 10) === parseInt(leadId, 10));
          if (leadObj) {
            const dbColumns = {
              contracheque: 'doc_contracheque_id',
              extrato: 'doc_extrato_id',
              identificacao: 'doc_identificacao_id',
              residencia: 'doc_residencia_id',
              espelho: 'doc_espelho_id'
            };
            leadObj[dbColumns[docType]] = null;
          }

          openLeadDetailsModal(leadId, pipelineTipo);
        } else {
          showToast(data.error || 'Erro ao excluir o documento.', 'error');
        }
      } catch (err) {
        console.error('Erro de rede:', err);
        showToast('Erro de rede ao excluir o documento.', 'error');
      }
    }
  });
}

window.uploadCrmDoc = uploadCrmDoc;
window.triggerDocUpload = triggerDocUpload;
window.downloadCrmDoc = downloadCrmDoc;
window.deleteCrmDoc = deleteCrmDoc;

// ─── Presets de Cor e SLA (via delegação de eventos) ───────────────────────

document.addEventListener('click', function(e) {
  // Preset de Cor
  const colorDot = e.target.closest('.color-preset-dot');
  if (colorDot) {
    const targetId = colorDot.dataset.target;
    const color = colorDot.dataset.color;
    if (targetId && color) {
      const input = document.getElementById(targetId);
      if (input) input.value = color;
    }
  }

  // Preset de SLA
  const slaBtn = e.target.closest('.sla-preset-btn');
  if (slaBtn) {
    const targetId = slaBtn.dataset.target;
    const val = slaBtn.dataset.val;
    if (targetId !== undefined) {
      const input = document.getElementById(targetId);
      if (input) input.value = val;
    }
  }

  // Fechar menus de ordenação ao clicar em qualquer lugar da página
  if (!e.target.closest('.kanban-column-sort-dropdown')) {
    document.querySelectorAll('.kanban-column-sort-menu').forEach(menu => menu.classList.add('hidden'));
  }
});

// ─── Ordenação por Data nas Colunas do Kanban ───────────────────────────────

function toggleColumnSortMenu(event, pipelineTipo, estagioId) {
  if (event) event.stopPropagation();
  const menu = document.getElementById(`sort-menu-${pipelineTipo}-${estagioId}`);
  if (!menu) return;

  document.querySelectorAll('.kanban-column-sort-menu').forEach(m => {
    if (m !== menu) m.classList.add('hidden');
  });

  menu.classList.toggle('hidden');
}

function selectColumnSort(event, pipelineTipo, estagioId, sortOrder) {
  if (event) event.stopPropagation();
  const menu = document.getElementById(`sort-menu-${pipelineTipo}-${estagioId}`);
  if (menu) menu.classList.add('hidden');

  if (!CrmState.columnSort) CrmState.columnSort = {};
  CrmState.columnSort[`${pipelineTipo}_${estagioId}`] = sortOrder;

  applyColumnSort(pipelineTipo, estagioId, sortOrder);
}

function applyColumnSort(pipelineTipo, estagioId, sortOrder) {
  const wrapper = document.querySelector(`#${pipelineTipo}-kanban-board .kanban-cards-wrapper[data-estagio-id="${estagioId}"]`);
  if (!wrapper) return;

  const cards = Array.from(wrapper.querySelectorAll('.kanban-card'));
  const leadsPool = pipelineTipo === 'sdr' ? CrmState.sdrLeads : CrmState.closerLeads;
  if (!leadsPool || leadsPool.length === 0) return;

  const originalIndexMap = new Map();
  leadsPool.forEach((lead, index) => originalIndexMap.set(String(lead.id), index));

  cards.sort((cardA, cardB) => {
    const leadA = leadsPool.find(l => String(l.id) === String(cardA.dataset.leadId));
    const leadB = leadsPool.find(l => String(l.id) === String(cardB.dataset.leadId));

    if (sortOrder === 'newest') {
      const dateA = new Date(leadA?.created_at || leadA?.moved_to_stage_at || 0).getTime();
      const dateB = new Date(leadB?.created_at || leadB?.moved_to_stage_at || 0).getTime();
      return dateB - dateA;
    } else if (sortOrder === 'oldest') {
      const dateA = new Date(leadA?.created_at || leadA?.moved_to_stage_at || 0).getTime();
      const dateB = new Date(leadB?.created_at || leadB?.moved_to_stage_at || 0).getTime();
      return dateA - dateB;
    } else {
      const idxA = originalIndexMap.get(String(cardA?.dataset?.leadId)) ?? 0;
      const idxB = originalIndexMap.get(String(cardB?.dataset?.leadId)) ?? 0;
      return idxA - idxB;
    }
  });

  cards.forEach(card => wrapper.appendChild(card));

  const btn = document.getElementById(`btn-sort-${pipelineTipo}-${estagioId}`);
  if (btn) {
    btn.className = `btn-kanban-column-sort ${sortOrder === 'newest' ? 'active-newest' : (sortOrder === 'oldest' ? 'active-oldest' : '')}`;
    const badgeText = sortOrder === 'newest' ? '<span style="font-size: 10px;">Recentes</span>' : (sortOrder === 'oldest' ? '<span style="font-size: 10px;">Antigos</span>' : '');
    const titleText = sortOrder === 'newest' ? 'Filtro: Mais recentes primeiro' : (sortOrder === 'oldest' ? 'Filtro: Mais antigos primeiro' : 'Ordenar por data de criação');
    
    btn.title = titleText;
    btn.innerHTML = `${getSortIconSvg(sortOrder)}${badgeText}`;
  }
}

function getSortIconSvg(sortOrder) {
  if (sortOrder === 'newest') {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M3 6h18M3 12h12M3 18h6M19 8v12M15 16l4 4 4-4"/></svg>`;
  } else if (sortOrder === 'oldest') {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C084FC" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M3 6h6M3 12h12M3 18h18M19 20V8M15 12l4-4 4 4"/></svg>`;
  } else {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M3 6h18M3 12h12M3 18h6M19 8v12M15 16l4 4 4-4"/></svg>`;
  }
}

function getResetIconSvg() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
}

window.toggleColumnSortMenu = toggleColumnSortMenu;
window.selectColumnSort = selectColumnSort;
window.applyColumnSort = applyColumnSort;
