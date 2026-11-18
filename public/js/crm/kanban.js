// Kanban: quadro, cards, filtros, arrastar e ordenação

function setupKanbanDateFilter(pipelineTipo) {
  const tipoDataEl = document.getElementById(`${pipelineTipo}-kanban-filter-tipo-data`);
  const periodoEl = document.getElementById(`${pipelineTipo}-kanban-filter-periodo`);
  const customDatesEl = document.getElementById(`${pipelineTipo}-kanban-custom-dates`);
  const dateDeEl = document.getElementById(`${pipelineTipo}-kanban-date-de`);
  const dateAteEl = document.getElementById(`${pipelineTipo}-kanban-date-ate`);

  if (!periodoEl) return;

  const criterioWrap = document.getElementById(`${pipelineTipo}-kanban-criterio-wrap`);
  const syncCriterio = () => { if (criterioWrap) criterioWrap.hidden = periodoEl.value === 'todos'; };
  syncCriterio();

  periodoEl.addEventListener('change', () => {
    const val = periodoEl.value;
    syncCriterio();
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
    if (!resEstagios || resEstagios.error || !Array.isArray(resEstagios)) {
      renderKanbanLoadError(pipelineTipo);
      return;
    }

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

    // Preserva a rolagem (horizontal do quadro e vertical de cada coluna) ao recarregar
    const prevScrollLeft = boardContainer.scrollLeft;
    const prevColScroll = {};
    boardContainer.querySelectorAll('.kanban-cards-wrapper').forEach(w => { prevColScroll[w.dataset.estagioId] = w.scrollTop; });
    const prevFocusLeadId = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('kanban-card')
      ? document.activeElement.dataset.leadId : null;

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
      } else if (currentSort === 'value_desc') {
        colLeadsSorted.sort((a, b) => leadValorParaOrdenar(b) - leadValorParaOrdenar(a));
      }
      const sortMeta = getColumnSortMeta(currentSort);

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
                      class="btn-kanban-column-sort ${sortMeta.cls}"
                      id="btn-sort-${pipelineTipo}-${estagio.id}"
                      onclick="toggleColumnSortMenu(event, '${pipelineTipo}', ${estagio.id})" 
                      title="${sortMeta.title}">
                ${getSortIconSvg(currentSort)}
                ${sortMeta.badge}
              </button>
              <div id="sort-menu-${pipelineTipo}-${estagio.id}" class="kanban-column-sort-menu hidden">
                <button type="button" onclick="selectColumnSort(event, '${pipelineTipo}', ${estagio.id}, 'newest')">
                  ${getSortIconSvg('newest')} Mais recentes primeiro
                </button>
                <button type="button" onclick="selectColumnSort(event, '${pipelineTipo}', ${estagio.id}, 'oldest')">
                  ${getSortIconSvg('oldest')} Mais antigos primeiro
                </button>
                <button type="button" onclick="selectColumnSort(event, '${pipelineTipo}', ${estagio.id}, 'value_desc')">
                  ${getSortIconSvg('value_desc')} Maior valor primeiro
                </button>
                <button type="button" class="btn-sort-reset" onclick="selectColumnSort(event, '${pipelineTipo}', ${estagio.id}, 'default')">
                  ${getResetIconSvg()} Remover filtro (Ordem original)
                </button>
                <div class="kanban-column-menu-sep" role="separator"></div>
                <button type="button" class="btn-column-export" onclick="event.stopPropagation(); this.closest('.kanban-column-sort-menu').classList.add('hidden'); exportKanbanCsv('${pipelineTipo}', ${estagio.id});">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
                  Exportar esta etapa (CSV)
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

    boardContainer.scrollLeft = prevScrollLeft;
    boardContainer.querySelectorAll('.kanban-cards-wrapper').forEach(w => {
      if (prevColScroll[w.dataset.estagioId] != null) w.scrollTop = prevColScroll[w.dataset.estagioId];
    });
    if (prevFocusLeadId) {
      const again = boardContainer.querySelector(`.kanban-card[data-lead-id="${prevFocusLeadId}"]`);
      if (again) again.focus({ preventScroll: true });
    }

    if (window.lucide) window.lucide.createIcons({ root: boardContainer });
  } catch (err) {
    console.error(`Erro ao carregar Kanban (${pipelineTipo}):`, err);
    renderKanbanLoadError(pipelineTipo);
  }
}

// Estado de erro do quadro: diz o que houve e oferece nova tentativa
function renderKanbanLoadError(pipelineTipo) {
  const board = document.getElementById(`${pipelineTipo}-kanban-board`);
  const badge = document.getElementById(`${pipelineTipo}-kanban-count-badge`);
  if (badge) badge.textContent = 'Sem dados';
  if (!board) return;
  board.innerHTML = `
    <div class="kanban-state kanban-state-error" role="alert">
      <i data-lucide="wifi-off"></i>
      <strong>Não foi possível carregar o quadro.</strong>
      <span>Verifique a conexão e tente de novo. Se continuar, avise o administrador.</span>
      <button type="button" class="btn kanban-retry-btn">Tentar novamente</button>
    </div>`;
  const btn = board.querySelector('.kanban-retry-btn');
  if (btn) btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Carregando…';
    loadKanbanBoard(pipelineTipo);
  });
  if (window.lucide) window.lucide.createIcons({ root: board });
}

function renderKanbanCard(lead, pipelineTipo) {
  const cardEl = document.createElement('div');
  const isPendente = lead.status_atendimento === 'pendente_aceite';

  // Pisca só na primeira vez que o lead pendente aparece nesta sessão
  if (!window.__lfPendentesVistos) window.__lfPendentesVistos = new Set();
  const isNovoPendente = isPendente && !window.__lfPendentesVistos.has(lead.id);
  if (isPendente) window.__lfPendentesVistos.add(lead.id);
  cardEl.className = `kanban-card ${isPendente ? 'alert-pulsing' : ''} ${isNovoPendente ? 'alert-new' : ''}`;
  cardEl.setAttribute('draggable', 'true');
  cardEl.setAttribute('tabindex', '0');
  cardEl.setAttribute('role', 'button');
  cardEl.dataset.leadId = lead.id;
  cardEl.style.setProperty('--card-color', lead.estagio_cor || '#52525b');

  cardEl.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', lead.id);
    cardEl.style.opacity = '0.5';
  });

  cardEl.addEventListener('dragend', () => {
    cardEl.style.opacity = '1';
  });

  cardEl.addEventListener('click', (e) => {
    if (e.target.closest('.btn-aceitar-lead') || e.target.closest('a')) return;
    openLeadDetailsModal(lead.id, pipelineTipo);
  });

  cardEl.addEventListener('keydown', (e) => {
    if (e.target !== cardEl) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openLeadDetailsModal(lead.id, pipelineTipo);
    }
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
  cardEl.setAttribute('aria-label', `Abrir lead ${clienteNome}`);

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
      docsBadgeHtml = `<div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; background: rgba(34, 197, 94, 0.12); color: #34D399; border: 1px solid rgba(34, 197, 94, 0.25); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; width: fit-content;"><i data-lucide="file-check-2" style="width: 11px; height: 11px;"></i> Docs 5/5</div>`;
    } else if (totalDocs > 0) {
      docsBadgeHtml = `<div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; background: rgba(245, 158, 11, 0.12); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.25); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; width: fit-content;"><i data-lucide="file-text" style="width: 11px; height: 11px;"></i> Docs ${totalDocs}/5</div>`;
    } else {
      docsBadgeHtml = `<div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; background: rgba(239, 68, 68, 0.12); color: #F87171; border: 1px solid rgba(239, 68, 68, 0.25); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; width: fit-content;"><i data-lucide="file-x" style="width: 11px; height: 11px;"></i> Sem Docs (0/5)</div>`;
    }
  }

  const sdrNomeTag = (lead.sdr_nome && lead.sdr_nome.trim()) || (lead.sdr_username && lead.sdr_username.trim());
  const sdrBadgeHtml = (pipelineTipo === 'closer' && sdrNomeTag)
    ? `<span class="kanban-chip" title="SDR de origem">SDR: ${escapeHtml(sdrNomeTag)}</span>`
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
      slaBadgeHtml = `<div class="kanban-card-sla-badge"><i data-lucide="alarm-clock"></i> SLA +${labelExtra} excedido</div>`;
    } else if (pctUsado >= 0.75) {
      // Próximo do SLA
      const horasRestantes = Math.round(stage.sla_horas - horasDecorridas);
      slaBadgeHtml = `<div class="kanban-card-sla-badge warning"><i data-lucide="timer"></i> SLA: ${horasRestantes}h restantes</div>`;
    }
  }

  const temNotaPrivada = lead.nota_privada && String(lead.nota_privada).trim().length > 0;
  const notaBadgeHtml = temNotaPrivada
    ? `<div style="margin-top: 2px;"><span class="kanban-chip kanban-chip-note" title="Nota Privada: ${escapeHtml(lead.nota_privada)}"><i data-lucide="sticky-note"></i> Nota privada</span></div>`
    : '';

  const canalTagText = lead.canal_nome ? String(lead.canal_nome).toUpperCase() : (lead.discadora_login ? 'DISCADORA' : '');
  const canalBadgeHtml = canalTagText
    ? `<span class="kanban-chip" title="Canal">${escapeHtml(canalTagText)}</span>`
    : '';

  cardEl.innerHTML = `
    <div class="kanban-card-tag"></div>
    <div class="kanban-card-client-name" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px;">
      <span>
        ${escapeHtml(clienteNome)}
      </span>
      <div>
        ${canalBadgeHtml}
        ${sdrBadgeHtml}
      </div>
    </div>
    <div class="kanban-card-info">
      ${(exibirCpf && formattedCpf) ? `<div><i data-lucide="credit-card" style="width:12px;height:12px;vertical-align:middle;"></i> ${escapeHtml(formattedCpf)}</div>` : ''}
      ${exibirTelefone ? `<div><i data-lucide="phone" style="width:12px;height:12px;vertical-align:middle;"></i> ${escapeHtml(lead.cliente_telefone || 'Sem telefone')}</div>` : ''}
      ${emailHtml}
      ${valorHtml}
      ${notaBadgeHtml}
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
    const res = await fetchWithAuth(`/api/crm/kanban/leads/${leadId}/aceitar`, {
      method: 'POST'
    });
    if (!res) return;
    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      if (typeof showToast === 'function') showToast('Atendimento iniciado! Alerta desligado.', 'success');
      loadKanbanBoard('closer');
    } else {
      if (typeof showToast === 'function') showToast(body.error || body.message || 'Erro ao aceitar lead.', 'error');
      // 409: o lead já foi aceito ou mudou de situação; recarrega para refletir o estado real
      if (res.status === 409) loadKanbanBoard('closer');
    }
  } catch (err) {
    console.error('Erro ao aceitar atendimento:', err);
    if (typeof showToast === 'function') showToast(err.message || 'Falha de conexão ao aceitar o lead.', 'error');
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

  // Todos marcados = sem filtro (mesma regra de nenhum marcado)
  const selectedUserIds = msEffectiveSelection(`${pipelineTipo}-kanban-filter-user`);
  const selectedSdrIds = pipelineTipo === 'closer' ? msEffectiveSelection('closer-kanban-filter-sdr') : [];
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
  const currentUser = typeof getUser === 'function' ? getUser() : null;
  const isRestrict = currentUser && (
    (pipelineTipo === 'sdr' && currentUser.role === 'sdr') ||
    (pipelineTipo === 'closer' && currentUser.role === 'closer')
  );

  const filterId = `${pipelineTipo}-kanban-filter-user`;
  const defaultLabel = pipelineTipo === 'sdr' ? 'Todos os SDRs' : 'Todos os Closers';

  const userMap = new Map();
  (leads || []).forEach(l => {
    // Admin/Supervisor nunca são SDR: não entram na lista de SDRs
    if (pipelineTipo === 'sdr' && l.sdr_id && l.sdr_role && l.sdr_role !== 'sdr') return;
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
      if (l.sdr_role && l.sdr_role !== 'sdr') return; // Admin/Supervisor nunca são SDR
      const sKey = l.sdr_id ? String(l.sdr_id) : null;
      const sName = (l.sdr_nome && l.sdr_nome.trim()) || l.sdr_username;
      if (sKey && sName && !sdrMap.has(sKey)) {
        sdrMap.set(sKey, sName);
      }
    });

    setupCustomMultiSelect(sdrFilterId, sdrDefaultLabel, sdrMap, 'closer', false, null);
  }
}

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
    } else if (sortOrder === 'value_desc') {
      const diff = leadValorParaOrdenar(leadB) - leadValorParaOrdenar(leadA);
      if (diff !== 0) return diff;
      const iA = originalIndexMap.get(String(cardA?.dataset?.leadId)) ?? 0;
      const iB = originalIndexMap.get(String(cardB?.dataset?.leadId)) ?? 0;
      return iA - iB;
    } else {
      const idxA = originalIndexMap.get(String(cardA?.dataset?.leadId)) ?? 0;
      const idxB = originalIndexMap.get(String(cardB?.dataset?.leadId)) ?? 0;
      return idxA - idxB;
    }
  });

  cards.forEach(card => wrapper.appendChild(card));

  const btn = document.getElementById(`btn-sort-${pipelineTipo}-${estagioId}`);
  if (btn) {
    const meta = getColumnSortMeta(sortOrder);
    btn.className = `btn-kanban-column-sort ${meta.cls}`;
    btn.title = meta.title;
    btn.innerHTML = `${getSortIconSvg(sortOrder)}${meta.badge}`;
  }
}

// Valor do contrato para ordenação: sem valor = 0
function leadValorParaOrdenar(lead) {
  if (!lead) return 0;
  const v = Number(typeof getLeadValorContrato === 'function' ? getLeadValorContrato(lead) : lead.valor_contrato);
  return Number.isFinite(v) ? v : 0;
}

function getColumnSortMeta(sortOrder) {
  if (sortOrder === 'newest') return { cls: 'active-newest', badge: '<span style="font-size: 10px;">Recentes</span>', title: 'Filtro: Mais recentes primeiro' };
  if (sortOrder === 'oldest') return { cls: 'active-oldest', badge: '<span style="font-size: 10px;">Antigos</span>', title: 'Filtro: Mais antigos primeiro' };
  if (sortOrder === 'value_desc') return { cls: 'active-value', badge: '<span style="font-size: 10px;">Maior R$</span>', title: 'Filtro: Maior valor primeiro (sem valor conta como R$ 0)' };
  return { cls: '', badge: '', title: 'Ordenar cards da coluna' };
}

function getSortIconSvg(sortOrder) {
  if (sortOrder === 'value_desc') {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f7cb45" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
  }
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
