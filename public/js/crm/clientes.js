// Busca de clientes, novo cliente e tabulação

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
  if (resultsList) resultsList.innerHTML = '<div class="text-muted text-center" style="padding: 20px;">Buscando…</div>';

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
              ${h.observacao ? `<div style="font-size: 12px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; margin-top: 8px; color: rgba(255,255,255,0.9); border: 1px solid rgba(255,255,255,0.08);">${escapeHtml(h.observacao)}</div>` : ''}
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
      submitBtn.innerHTML = 'Cadastrando…';
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
      } else if (currentUser.role === 'closer' || currentUser.role === 'admin' || currentUser.role === 'supervisor') {
        // Admin/Supervisor nunca são SDR: iniciam leads no funil Closer
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
