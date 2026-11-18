// Admin CRM: etapas, fila de Closers e discadora

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
    const isProximo = data.proximoCloserId && item.closer_id === data.proximoCloserId && item.ativo;
    const proximoBadge = isProximo 
      ? '<span class="badge info-badge" style="margin-left: 8px; font-size: 11px; padding: 2px 6px; display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="arrow-right" style="width: 10px; height: 10px;"></i> Próximo da Vez</span>' 
      : '';

    const li = document.createElement('li');
    li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.06);';
    li.innerHTML = `
      <div>
        <div style="display: flex; align-items: center; flex-wrap: wrap;">
          <strong style="color: #fff;">${escapeHtml(item.name || item.username)}</strong>
          ${proximoBadge}
        </div>
        <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 2px;">@${escapeHtml(item.username)} | Ordem: ${item.ordem} | Peso: ${item.peso}</div>
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

async function resetFilaCloserPointer() {
  if (!confirm('Deseja reiniciar o ciclo da fila? O próximo lead recebido irá para o primeiro consultor da ordem.')) return;
  const res = await apiFetch('/api/crm/admin/fila-closers/reset-pointer', { method: 'POST' });
  if (res && res.message) {
    if (typeof showToast === 'function') showToast(res.message, 'success');
    loadCrmAdminFila();
  }
}

window.resetFilaCloserPointer = resetFilaCloserPointer;

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
