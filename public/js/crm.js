/**
 * MÓDULO CRM & KANBAN - FRONTEND CLIENT
 */

// Estado global do CRM
const CrmState = {
  selectedClientId: null,
  estagios: [],
  sdrLeads: [],
  closerLeads: [],
  eventSource: null
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
  const currentUser = typeof getAuthUser === 'function' ? getAuthUser() : (typeof getUser === 'function' ? getUser() : null);

  if (data.type === 'LEAD_NOVO') {
    const lead = data.payload;
    if (typeof showToast === 'function') showToast(`⚡ Novo Lead recebido: ${lead.cliente_nome || 'Cliente'}`, 'info');

    // Se o lead é para o Closer logado e está em alerta -> tocar beep de notificação
    if (lead.closer_id && currentUser && parseInt(currentUser.id, 10) === parseInt(lead.closer_id, 10) && lead.status_atendimento === 'pendente_aceite') {
      playAlertAudio();
    }

    loadKanbanBoard('sdr');
    loadKanbanBoard('closer');
  } else if (data.type === 'LEAD_MOVIDO' || data.type === 'LEAD_ACEITO' || data.type === 'TABULACAO_NOVA') {
    loadKanbanBoard('sdr');
    loadKanbanBoard('closer');
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

function initCrmEvents() {
  document.getElementById('btn-sdr-refresh')?.addEventListener('click', () => loadKanbanBoard('sdr'));
  document.getElementById('btn-closer-refresh')?.addEventListener('click', () => loadKanbanBoard('closer'));

  document.getElementById('sdr-kanban-filter-user')?.addEventListener('change', () => filterKanbanCards('sdr'));
  document.getElementById('sdr-kanban-filter-estagio')?.addEventListener('change', () => filterKanbanCards('sdr'));
  document.getElementById('sdr-kanban-search')?.addEventListener('input', () => filterKanbanCards('sdr'));

  document.getElementById('closer-kanban-filter-user')?.addEventListener('change', () => filterKanbanCards('closer'));
  document.getElementById('closer-kanban-filter-estagio')?.addEventListener('change', () => filterKanbanCards('closer'));
  document.getElementById('closer-kanban-search')?.addEventListener('input', () => filterKanbanCards('closer'));
}

// ----------------------------------------
// KANBAN (BOARD, CARDS, DRAG & DROP)
// ----------------------------------------

async function loadKanbanBoard(pipelineTipo) {
  try {
    const resEstagios = await apiFetch('/api/crm/kanban/estagios');
    if (!resEstagios || resEstagios.error || !Array.isArray(resEstagios)) return;

    CrmState.estagios = resEstagios;
    const estagiosFiltrados = resEstagios.filter(e => e.pipeline_tipo === pipelineTipo);
    populateStageFilterDropdown(pipelineTipo, estagiosFiltrados);

    let urlLeads = `/api/crm/kanban/leads?pipeline_tipo=${pipelineTipo}`;
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

    estagiosFiltrados.forEach(estagio => {
      const colLeads = leads.filter(l => parseInt(l.estagio_id, 10) === parseInt(estagio.id, 10));

      const columnEl = document.createElement('div');
      columnEl.className = 'kanban-column';
      columnEl.style.setProperty('--column-color', estagio.cor || '#4F46E5');

      columnEl.innerHTML = `
        <div class="kanban-column-header">
          <div class="kanban-column-title">
            <span style="width: 10px; height: 10px; border-radius: 50%; background: ${estagio.cor || '#4F46E5'};"></span>
            ${escapeHtml(estagio.nome)}
          </div>
          <span class="badge info-badge">${colLeads.length}</span>
        </div>
        <div class="kanban-cards-wrapper" data-estagio-id="${estagio.id}"></div>
      `;

      const cardsWrapper = columnEl.querySelector('.kanban-cards-wrapper');

      cardsWrapper.addEventListener('dragover', handleDragOver);
      cardsWrapper.addEventListener('dragleave', handleDragLeave);
      cardsWrapper.addEventListener('drop', (e) => handleDropCard(e, estagio.id, pipelineTipo));

      colLeads.forEach(lead => {
        const cardEl = renderKanbanCard(lead, pipelineTipo);
        cardsWrapper.appendChild(cardEl);
      });

      boardContainer.appendChild(columnEl);
    });

    filterKanbanCards(pipelineTipo);

    if (window.lucide) window.lucide.createIcons();
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

  const tempoStr = lead.created_at ? formatTimeAgo(lead.created_at) : '';
  const consultorNome = lead.closer_nome || lead.sdr_nome || lead.discadora_login || 'Não atribuído';
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

  const valorContrato = lead.valor_contrato ? parseFloat(lead.valor_contrato) : 0;
  const valorHtml = valorContrato > 0
    ? `<div style="margin-top: 4px; font-weight: 700; color: #10B981; font-size: 12px; display: flex; align-items: center; gap: 4px;">
         <i data-lucide="circle-dollar-sign" style="width: 12px; height: 12px;"></i>
         R$ ${valorContrato.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
       </div>`
    : '';

  cardEl.innerHTML = `
    <div class="kanban-card-tag"></div>
    <div class="kanban-card-client-name">${escapeHtml(clienteNome)}</div>
    <div class="kanban-card-info">
      ${formattedCpf ? `<div><i data-lucide="credit-card" style="width:12px;height:12px;vertical-align:middle;"></i> ${escapeHtml(formattedCpf)}</div>` : ''}
      <div><i data-lucide="phone" style="width:12px;height:12px;vertical-align:middle;"></i> ${escapeHtml(lead.cliente_telefone || 'Sem telefone')}</div>
      ${valorHtml}
    </div>
    <div class="kanban-card-footer">
      <span><i data-lucide="user" style="width:11px;height:11px;vertical-align:middle;"></i> ${escapeHtml(consultorNome)}</span>
      <span>${tempoStr}</span>
    </div>
    ${btnAceitarHtml}
  `;

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
      body: JSON.stringify({ estagio_id: novoEstagioId, observacao: 'Movido no Kanban via Drag & Drop' })
    });

    if (res && res.message) {
      if (typeof showToast === 'function') showToast('Lead movido com sucesso!', 'success');
      loadKanbanBoard(pipelineTipo);
    } else {
      if (typeof showToast === 'function') showToast(res.error || 'Erro ao mover lead.', 'error');
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

function filterKanbanCards(pipelineTipo) {
  const termRaw = (document.getElementById(`${pipelineTipo}-kanban-search`)?.value || '').toLowerCase().trim();
  const termDigits = termRaw.replace(/\D/g, '');

  const selectedUser = (document.getElementById(`${pipelineTipo}-kanban-filter-user`)?.value || '').trim();
  const selectedEstagio = (document.getElementById(`${pipelineTipo}-kanban-filter-estagio`)?.value || '').trim();

  const board = document.getElementById(`${pipelineTipo}-kanban-board`);
  if (!board) return;

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

    const cards = col.querySelectorAll('.kanban-card');
    cards.forEach(card => {
      const leadId = card.dataset.leadId;
      const leadsPool = pipelineTipo === 'sdr' ? CrmState.sdrLeads : CrmState.closerLeads;
      const lead = (leadsPool || []).find(l => String(l.id) === String(leadId));

      let matchesUser = true;
      if (selectedUser !== '') {
        if (!lead) {
          matchesUser = false;
        } else {
          if (pipelineTipo === 'sdr') {
            matchesUser = String(lead.sdr_id) === selectedUser || 
                          (lead.discadora_login && String(lead.discadora_login).toLowerCase() === selectedUser.toLowerCase()) ||
                          (lead.sdr_nome && String(lead.sdr_nome).toLowerCase() === selectedUser.toLowerCase());
          } else {
            matchesUser = String(lead.closer_id) === selectedUser ||
                          (lead.closer_nome && String(lead.closer_nome).toLowerCase() === selectedUser.toLowerCase());
          }
        }
      }

      let matchesText = true;
      if (termRaw !== '') {
        const content = card.textContent.toLowerCase();
        const contentDigits = content.replace(/\D/g, '');

        const textMatch = content.includes(termRaw);
        const digitsMatch = termDigits.length >= 2 && contentDigits.includes(termDigits);

        // Busca complementar no objeto lead (CPF ou telefone sem formatação)
        let leadMatch = false;
        if (lead) {
          const lNome = (lead.cliente_nome || '').toLowerCase();
          const lCpf = (lead.cliente_cpf || '').replace(/\D/g, '');
          const lTel = (lead.cliente_telefone || '').replace(/\D/g, '');
          const tClean = termRaw.replace(/\D/g, '');

          if (tClean.length >= 2) {
            leadMatch = lCpf.includes(tClean) || lTel.includes(tClean);
          } else {
            leadMatch = lNome.includes(termRaw);
          }
        }

        matchesText = textMatch || digitsMatch || leadMatch;
      }

      if (matchesUser && matchesText) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  });
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
          <span>CPF: ${escapeHtml(cli.cpf || '—')}</span>
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
    document.getElementById('crm-detail-cpf').textContent = cli.cpf || '—';
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
                  ${t.valor && parseFloat(t.valor) > 0 ? `<span class="badge success-badge" style="margin-left: 6px; background: rgba(16,185,129,0.15); color: #10B981; border: 1px solid rgba(16,185,129,0.2); font-size: 10px; padding: 2px 6px; border-radius: 4px;">R$ ${parseFloat(t.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>` : ''}
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
          timeBox.innerHTML = `
            <div class="timeline-icon" style="color: #3B82F6;"><i data-lucide="arrow-right-circle"></i></div>
            <div class="timeline-content-box">
              <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 700; color: #fff;">
                <span>Movimentação no Kanban: ${escapeHtml(h.estagio_novo_nome || 'Novo Estágio')}</span>
                <span style="font-weight: 400; opacity: 0.6; font-size: 12px;">${formatDateString(h.created_at)}</span>
              </div>
              <div style="font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 4px;">
                Por: <strong>${escapeHtml(h.usuario_nome || 'Sistema')}</strong> ${h.estagio_anterior_nome ? `(Veio de: ${escapeHtml(h.estagio_anterior_nome)})` : ''}
              </div>
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

function openNewClientForm(defaultQuery = '') {
  document.getElementById('modal-cliente-nome').value = defaultQuery || '';
  document.getElementById('modal-cliente-cpf').value = '';
  document.getElementById('modal-cliente-telefone').value = '';
  document.getElementById('modal-novo-cliente').classList.remove('hidden');
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

  const form = document.getElementById('form-novo-cliente');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('modal-cliente-nome').value;
    const cpf = document.getElementById('modal-cliente-cpf').value;
    const telefone = document.getElementById('modal-cliente-telefone').value;

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
      } else {
        if (typeof showToast === 'function') showToast(res?.error || 'Erro ao cadastrar cliente.', 'error');
      }
    } catch (err) {
      console.error('Erro ao cadastrar cliente:', err);
    }
  });
}

function openTabulacaoModal(clienteId) {
  document.getElementById('modal-tabulacao-cliente-id').value = clienteId;
  document.getElementById('modal-tabulacao-obs').value = '';
  const valorInput = document.getElementById('modal-tabulacao-valor');
  if (valorInput) valorInput.value = '';
  document.getElementById('modal-tabulacao-iniciar-kanban').checked = false;
  document.getElementById('modal-tabulacao-pipeline-wrapper').classList.add('hidden');
  document.getElementById('modal-tabulacao').classList.remove('hidden');
}

function closeTabulacaoModal() {
  document.getElementById('modal-tabulacao').classList.add('hidden');
}

function initTabulacaoModalForm() {
  const chkKanban = document.getElementById('modal-tabulacao-iniciar-kanban');
  if (chkKanban) {
    chkKanban.addEventListener('change', (e) => {
      const wrapper = document.getElementById('modal-tabulacao-pipeline-wrapper');
      if (e.target.checked) wrapper.classList.remove('hidden');
      else wrapper.classList.add('hidden');
    });
  }

  const form = document.getElementById('form-tabulacao');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const cliente_id = document.getElementById('modal-tabulacao-cliente-id').value;
      const tipo_tabulacao = document.getElementById('modal-tabulacao-tipo').value;
      const observacao = document.getElementById('modal-tabulacao-obs').value;
      const iniciar_kanban = document.getElementById('modal-tabulacao-iniciar-kanban').checked;
      const pipeline_tipo = document.getElementById('modal-tabulacao-pipeline-tipo').value;
      const valor = document.getElementById('modal-tabulacao-valor')?.value || '';

      try {
        const res = await apiFetch('/api/crm/tabulacoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliente_id, tipo_tabulacao, observacao, iniciar_kanban, pipeline_tipo, valor })
        });

        if (res && res.message) {
          if (typeof showToast === 'function') showToast('Tabulação registrada com sucesso!', 'success');
          closeTabulacaoModal();
          loadClientDetails(cliente_id);
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

    const res = await apiFetch('/api/crm/admin/estagios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, pipeline_tipo, cor, ordem })
    });

    if (res && res.id) {
      if (typeof showToast === 'function') showToast('Estágio criado com sucesso!', 'success');
      document.getElementById('form-crm-estagio').reset();
      loadCrmAdminEstagios();
    } else {
      if (typeof showToast === 'function') showToast(res?.error || 'Erro ao criar estágio.', 'error');
    }
  });

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
}

async function loadCrmAdminEstagios() {
  const listEl = document.getElementById('list-crm-estagios');
  if (!listEl) return;

  const estagios = await apiFetch('/api/crm/admin/estagios');
  if (!estagios || estagios.error || !Array.isArray(estagios)) return;

  listEl.innerHTML = '';
  estagios.forEach(e => {
    const li = document.createElement('li');
    li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.06);';
    li.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="width: 12px; height: 12px; border-radius: 50%; background: ${e.cor};"></span>
        <strong style="color: #fff;">${escapeHtml(e.nome)}</strong>
        <span class="badge info-badge">${e.pipeline_tipo.toUpperCase()}</span>
      </div>
      <button class="btn btn-secondary btn-small" onclick="deleteCrmEstagio(${e.id})"><i data-lucide="trash-2"></i></button>
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

async function loadCrmAdminFila() {
  const listEl = document.getElementById('list-crm-fila');
  const selectCloser = document.getElementById('fila-closer-id');
  if (!listEl) return;

  const data = await apiFetch('/api/crm/admin/fila-closers');
  if (!data || data.error) return;

  if (selectCloser) {
    selectCloser.innerHTML = '<option value="">-- Selecione o Usuário --</option>';
    (data.disponiveis || []).forEach(u => {
      selectCloser.innerHTML += `<option value="${u.id}">${escapeHtml(u.username)} (${u.role})</option>`;
    });
  }

  listEl.innerHTML = '';
  (data.fila || []).forEach(item => {
    const li = document.createElement('li');
    li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.06);';
    li.innerHTML = `
      <div>
        <strong style="color: #fff;">${escapeHtml(item.username)}</strong>
        <div style="font-size: 12px; color: rgba(255,255,255,0.6);">Peso: ${item.peso} | Ordem: ${item.ordem}</div>
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
    select.innerHTML = '<option value="">Todos os Closers</option>';
    data.fila.forEach(f => {
      select.innerHTML += `<option value="${f.closer_id}">${escapeHtml(f.username)}</option>`;
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
  if (diffSec < 60) return `${diffSec}s atrás`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m atrás`;
  return `${Math.floor(diffSec / 3600)}h atrás`;
}

async function clearCrmTestData() {
  if (!confirm('Deseja realmente apagar TODOS os leads e dados de teste do CRM?')) return;

  try {
    const res = await apiFetch('/api/crm/admin/clear-data', { method: 'POST' });
    if (res && res.message) {
      if (typeof showToast === 'function') showToast('Todos os dados de teste do CRM foram limpos!', 'success');
      loadKanbanBoard('sdr');
      loadKanbanBoard('closer');
    } else {
      if (typeof showToast === 'function') showToast(res.error || 'Erro ao limpar dados.', 'error');
    }
  } catch (err) {
    console.error('Erro ao limpar CRM:', err);
  }
}

function formatCpf(cpf) {
  if (!cpf) return '';
  const digits = String(cpf).replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
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

    const data = await apiFetch(`/api/crm/clientes/${lead.cliente_id}`);
    if (!data || data.error || !data.cliente) return;

    const cli = data.cliente;
    document.getElementById('modal-lead-id').value = leadId;
    document.getElementById('modal-lead-cliente-id').value = cli.id;

    const clienteNome = (cli.nome && cli.nome.trim()) ? cli.nome : (cli.cpf ? `Cliente CPF ${formatCpf(cli.cpf)}` : `Cliente #${cli.id}`);
    document.getElementById('modal-lead-nome').textContent = clienteNome;
    document.getElementById('modal-lead-cpf').textContent = cli.cpf ? formatCpf(cli.cpf) : 'Não informado';
    document.getElementById('modal-lead-telefone').textContent = cli.telefone || 'Não informado';
    document.getElementById('modal-lead-consultor').textContent = lead.closer_nome || lead.sdr_nome || lead.discadora_login || 'Não atribuído';
    
    // Buscar e exibir valor de contrato do lead (da tabulação mais recente com valor > 0)
    const latestValTab = (data.tabulacoes || []).find(t => t.valor && parseFloat(t.valor) > 0);
    const valWrapper = document.getElementById('modal-lead-valor-wrapper');
    const valSpan = document.getElementById('modal-lead-valor-val');
    const valInput = document.getElementById('modal-lead-valor');
    
    if (valInput) {
      valInput.value = latestValTab ? parseFloat(latestValTab.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    }
    
    if (valWrapper && valSpan) {
      if (latestValTab) {
        valSpan.textContent = `R$ ${parseFloat(latestValTab.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        valWrapper.classList.remove('hidden');
      } else {
        valWrapper.classList.add('hidden');
      }
    }

    const badgeEstagio = document.getElementById('modal-lead-badge-estagio');
    if (badgeEstagio) {
      badgeEstagio.textContent = (lead.estagio_nome || 'CONTATO INICIAL').toUpperCase();
      badgeEstagio.style.background = lead.estagio_cor || '#4F46E5';
    }

    // Botão Tabular
    const btnTab = document.getElementById('btn-modal-lead-tabular');
    if (btnTab) {
      btnTab.onclick = () => {
        closeLeadDetailsModal();
        openTabulacaoModal(cli.id);
      };
    }

    // Botão Ver Ficha Completa (Chama o redirecionamento com switchTab)
    const btnFull = document.getElementById('btn-modal-lead-full-history');
    if (btnFull) {
      btnFull.onclick = () => {
        closeLeadDetailsModal();
        if (typeof switchTab === 'function') switchTab('crm-clientes');
        else window.location.hash = '#crm-clientes';
        loadClientDetails(cli.id);
      };
    }

    // Carregar Observações Livres
    document.getElementById('modal-lead-obs').value = cli.observacoes || '';

    // Renderizar select de estágios
    const selectEstagio = document.getElementById('modal-lead-select-estagio');
    if (selectEstagio) {
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

      // Lógica de visibilidade dos documentos do Google Drive
      const docsWrapper = document.getElementById('modal-lead-docs-wrapper');
      if (docsWrapper) {
        const updateDocsVisibility = (estagioId) => {
          const selectedEst = (CrmState.estagios || []).find(e => parseInt(e.id, 10) === parseInt(estagioId, 10));
          if (selectedEst && (selectedEst.nome.trim().toUpperCase() === 'NEGOCIAÇÃO' || selectedEst.nome.trim().toUpperCase() === 'ABERTURA DE CONTA')) {
            docsWrapper.classList.remove('hidden');
            renderLeadDocuments(leadId, cli);
          } else {
            docsWrapper.classList.add('hidden');
          }
        };

        updateDocsVisibility(selectEstagio.value);
        selectEstagio.onchange = () => {
          updateDocsVisibility(selectEstagio.value);
        };
      }
    }

    // Renderizar histórico recente
    const recentHistoryEl = document.getElementById('modal-lead-recent-history');
    if (recentHistoryEl) {
      recentHistoryEl.innerHTML = '';
      const tabulacoes = data.tabulacoes || [];
      if (tabulacoes.length === 0) {
        recentHistoryEl.innerHTML = '<div class="text-muted" style="font-size: 12px;">Nenhum atendimento registrado ainda.</div>';
      } else {
        tabulacoes.slice(0, 3).forEach(t => {
          const div = document.createElement('div');
          div.style.cssText = 'font-size: 12px; padding: 8px 10px; background: rgba(255,255,255,0.04); border-radius: 6px; display: flex; flex-direction: column; gap: 4px; border: 1px solid rgba(255,255,255,0.02);';
          const consultor = t.consultor_nome || t.consultor_username || 'Sistema';
          div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <span>
                <strong style="color: #fff;">${escapeHtml(t.tipo_tabulacao)}</strong>
                ${t.valor && parseFloat(t.valor) > 0 ? `<span class="badge success-badge" style="margin-left: 6px; background: rgba(16,185,129,0.15); color: #10B981; border: 1px solid rgba(16,185,129,0.2); font-size: 10px; padding: 2px 6px; border-radius: 4px;">R$ ${parseFloat(t.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>` : ''}
              </span>
              <span class="text-muted" style="font-size: 11px; white-space: nowrap;">${formatDateString(t.created_at)}</span>
            </div>
            ${t.observacao ? `<div style="color: rgba(255,255,255,0.85); font-size: 12px; word-break: break-word;">${escapeHtml(t.observacao)}</div>` : ''}
            <div class="text-muted" style="font-size: 11px; display: flex; align-items: center; gap: 4px; margin-top: 2px;">
              <i data-lucide="user" style="width: 11px; height: 11px; opacity: 0.6;"></i>
              <span>Consultor: <strong style="color: rgba(255,255,255,0.6);">${escapeHtml(consultor)}</strong></span>
            </div>
          `;
          recentHistoryEl.appendChild(div);
        });
      }
    }

    document.getElementById('modal-lead-details').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Erro ao abrir detalhes do lead:', err);
  }
}

function closeLeadDetailsModal() {
  document.getElementById('modal-lead-details').classList.add('hidden');
}

function initLeadDetailsForm() {
  const modalLead = document.getElementById('modal-lead-details');
  if (modalLead) {
    modalLead.addEventListener('click', (e) => {
      if (e.target === modalLead) closeLeadDetailsModal();
    });
  }

  const modalTab = document.getElementById('modal-tabulacao');
  if (modalTab) {
    modalTab.addEventListener('click', (e) => {
      if (e.target === modalTab) closeTabulacaoModal();
    });
  }

  const form = document.getElementById('form-modal-lead-details');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const leadId = document.getElementById('modal-lead-id').value;
    const clienteId = document.getElementById('modal-lead-cliente-id').value;
    const novoEstagioId = document.getElementById('modal-lead-select-estagio').value;
    const observacoes = document.getElementById('modal-lead-obs').value;
    const valor = document.getElementById('modal-lead-valor')?.value || '';

    try {
      // 1. Atualizar observações e valor do cliente
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
            email: clienteAtual.cliente.email,
            observacoes: observacoes,
            valor: valor
          })
        });
      }

      // 2. Mover de estágio se alterou
      if (leadId && novoEstagioId) {
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

function populateUserFilterDropdown(pipelineTipo, leads) {
  const select = document.getElementById(`${pipelineTipo}-kanban-filter-user`);
  if (!select) return;

  const currentVal = select.value;
  const labelPrefix = pipelineTipo === 'sdr' ? 'Todos os SDRs' : 'Todos os Closers';
  select.innerHTML = `<option value="">${labelPrefix}</option>`;

  const userMap = new Map();

  // Coletar APENAS operadores que possuem cards ativos neste Kanban
  (leads || []).forEach(l => {
    const uKey = pipelineTipo === 'sdr' 
      ? (l.sdr_id ? String(l.sdr_id) : (l.discadora_login ? String(l.discadora_login) : null))
      : (l.closer_id ? String(l.closer_id) : null);

    const uName = pipelineTipo === 'sdr' 
      ? (l.sdr_nome || l.discadora_login)
      : l.closer_nome;

    if (uKey && uName && !userMap.has(uKey)) {
      userMap.set(uKey, uName);
    }
  });

  userMap.forEach((name, idKey) => {
    const opt = document.createElement('option');
    opt.value = idKey;
    opt.textContent = name;
    if (String(idKey) === String(currentVal)) opt.selected = true;
    select.appendChild(opt);
  });
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
      showToast(data.error || 'Erro ao fazer upload do documento.', 'error');
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
