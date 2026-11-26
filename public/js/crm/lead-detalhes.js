// Detalhes do lead, transferência, perda e documentos

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
    if (modal) {
      modal.classList.remove('hidden');
      if (typeof resetModalScroll === 'function') resetModalScroll(modal);
    }

    document.getElementById('modal-lead-id').value = leadId;
    document.getElementById('modal-lead-cliente-id').value = lead.cliente_id || '';
    const notaPrivadaEl = document.getElementById('modal-lead-nota-privada');
    if (notaPrivadaEl) notaPrivadaEl.value = lead.nota_privada || '';

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
      recentHistoryEl.innerHTML = '<div class="text-muted" style="font-size: 12px; padding: 6px;">Carregando histórico…</div>';
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
    const notaPrivadaInput = document.getElementById('modal-lead-nota-privada');
    if (notaPrivadaInput && lead.nota_privada !== undefined) {
      notaPrivadaInput.value = lead.nota_privada || '';
    }

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

    // Contratos do cliente (só aparece para quem tem acesso)
    if (typeof carregarContratosDoLead === 'function') carregarContratosDoLead(leadId);

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
  const modal = document.getElementById('modal-lead-details');
  if (modal) {
    if (typeof resetModalScroll === 'function') resetModalScroll(modal);
    modal.classList.add('hidden');
  }
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

function resetModalScroll(modalEl) {
  if (!modalEl) return;
  modalEl.scrollTop = 0;
  const innerCard = modalEl.querySelector('.card, .form-card, .modal-card, .modal-content, form');
  if (innerCard) innerCard.scrollTop = 0;
  const scrollables = modalEl.querySelectorAll('*');
  scrollables.forEach(child => {
    if (child.scrollTop > 0) child.scrollTop = 0;
  });
}

window.resetModalScroll = resetModalScroll;

function initLeadDetailsForm() {
  // MutationObserver para garantir que QUALQUER modal do sistema volte ao topo (scrollTop = 0) ao ser aberto/fechado
  if (!window._modalScrollObserverSet) {
    window._modalScrollObserverSet = true;
    const attachObservers = () => {
      document.querySelectorAll('.modal-backdrop, .modal').forEach(modal => {
        const observer = new MutationObserver((mutations) => {
          mutations.forEach(mutation => {
            if (mutation.type === 'attributes' && (mutation.attributeName === 'class' || mutation.attributeName === 'style')) {
              resetModalScroll(modal);
            }
          });
        });
        observer.observe(modal, { attributes: true });
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attachObservers);
    } else {
      attachObservers();
    }
  }

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
          const targetModal = openModals[openModals.length - 1];
          resetModalScroll(targetModal);
          targetModal.classList.add('hidden');
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
    const notaPrivada = document.getElementById('modal-lead-nota-privada')?.value || '';
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

      // 1.1. Atualizar nota privada do card do lead
      if (leadId) {
        await apiFetch(`/api/crm/kanban/leads/${leadId}/nota-privada`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nota_privada: notaPrivada })
        });
      }

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
  carregarDocumentosExtras(leadId);
}

// ----------------------------------------
// DOCUMENTOS EXTRAS: vários por cliente, nome livre (ex.: DEDs do contrato), opcionais
// ----------------------------------------
async function carregarDocumentosExtras(leadId) {
  const area = document.getElementById('doc-extras-area');
  if (!area) return;
  area.dataset.leadId = String(leadId);
  area.innerHTML = '';
  let docs = [];
  try {
    const res = await fetch(`/api/crm/leads/${leadId}/documentos-extras`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
    if (res.ok) docs = await res.json();
  } catch (err) {
    console.error('Erro ao carregar documentos extras:', err);
  }
  // O modal pode ter trocado de lead enquanto a lista carregava
  if (area.dataset.leadId !== String(leadId)) return;
  renderDocumentosExtras(leadId, Array.isArray(docs) ? docs : []);
}

function renderDocumentosExtras(leadId, docs) {
  const area = document.getElementById('doc-extras-area');
  if (!area) return;
  const itens = docs.map(d => `
    <div class="doc-box doc-extra-box">
      <span class="doc-extra-nome" title="${escapeHtml(d.nome)}${d.usuario_nome ? ` · anexado por ${escapeHtml(d.usuario_nome)}` : ''}">${escapeHtml(d.nome)}</span>
      <div class="doc-extra-anexado">
        <span class="doc-extra-ok"><i data-lucide="check-circle"></i> Anexado</span>
        <div class="doc-extra-acoes">
          <button type="button" onclick="downloadCrmDoc('${escapeHtml(d.drive_file_id)}')" title="Baixar documento" class="doc-extra-btn doc-extra-btn--baixar"><i data-lucide="download"></i></button>
          <button type="button" onclick="excluirDocumentoExtra('${leadId}', ${parseInt(d.id, 10)})" title="Excluir documento" class="doc-extra-btn doc-extra-btn--excluir"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    </div>`).join('');

  area.innerHTML = `${itens}
    <div class="doc-box doc-extra-novo" id="doc-extra-novo">
      <button type="button" class="doc-extra-adicionar" onclick="abrirNovoDocumentoExtra('${leadId}')">
        <i data-lucide="plus"></i> Adicionar documentação
      </button>
    </div>`;
  if (window.lucide) window.lucide.createIcons();
}

function abrirNovoDocumentoExtra(leadId) {
  const box = document.getElementById('doc-extra-novo');
  if (!box) return;
  box.classList.add('doc-extra-novo--form');
  box.innerHTML = `
    <label class="doc-extra-label" for="doc-extra-nome-input">Nome do documento</label>
    <input type="text" id="doc-extra-nome-input" class="form-input doc-extra-input" maxlength="80" placeholder="Ex.: DED Banco Pan" autocomplete="off">
    <input type="file" id="doc-extra-file-input" accept=".pdf" style="display: none;">
    <div class="doc-extra-form-acoes">
      <button type="button" class="btn btn-secondary doc-extra-form-btn" id="doc-extra-cancelar">Cancelar</button>
      <button type="button" class="btn btn-primary doc-extra-form-btn" id="doc-extra-escolher"><i data-lucide="upload"></i> Escolher PDF</button>
    </div>`;
  if (window.lucide) window.lucide.createIcons();

  const nomeInput = document.getElementById('doc-extra-nome-input');
  const fileInput = document.getElementById('doc-extra-file-input');
  const escolher = () => {
    if (!nomeInput.value.trim()) {
      showToast('Informe o nome do documento.', 'error');
      nomeInput.focus();
      return;
    }
    fileInput.click();
  };
  nomeInput.focus();
  nomeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); escolher(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); carregarDocumentosExtras(leadId); }
  });
  document.getElementById('doc-extra-cancelar').addEventListener('click', () => carregarDocumentosExtras(leadId));
  document.getElementById('doc-extra-escolher').addEventListener('click', escolher);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) enviarDocumentoExtra(leadId, nomeInput.value.trim(), file);
  });
}

async function enviarDocumentoExtra(leadId, nome, file) {
  if (file.type !== 'application/pdf') {
    showToast('Apenas arquivos PDF são permitidos.', 'error');
    return;
  }
  const box = document.getElementById('doc-extra-novo');
  if (box) {
    box.innerHTML = `
      <span class="doc-extra-nome">${escapeHtml(nome)}</span>
      <div class="doc-extra-enviando"><span class="spinner"></span> Enviando para o Drive…</div>`;
  }
  const formData = new FormData();
  formData.append('nome', nome);
  formData.append('file', file);
  try {
    const res = await fetch(`/api/crm/leads/${leadId}/documentos-extras`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: formData
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 201) {
      showToast('Documento anexado com sucesso!', 'success');
    } else if (data.error && data.error.includes('invalid_grant')) {
      showToast('A autorização do Google Drive expirou. Acesse o Admin CRM para reconectar a conta.', 'error');
    } else {
      showToast(data.error || 'Erro ao fazer upload do documento.', 'error');
    }
  } catch (err) {
    console.error('Erro no upload do documento extra:', err);
    showToast('Erro de rede ao fazer upload.', 'error');
  }
  carregarDocumentosExtras(leadId);
}

function excluirDocumentoExtra(leadId, docId) {
  showConfirmModal({
    title: 'Excluir documento?',
    text: 'Deseja realmente excluir este documento do Google Drive e do cadastro do cliente? Esta ação não poderá ser desfeita.',
    onConfirm: async () => {
      showToast('Excluindo arquivo…', 'info');
      try {
        const res = await fetch(`/api/crm/leads/${leadId}/documentos-extras/${docId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) showToast('Documento excluído com sucesso!', 'success');
        else showToast(data.error || 'Erro ao excluir o documento.', 'error');
      } catch (err) {
        console.error('Erro de rede:', err);
        showToast('Erro de rede ao excluir o documento.', 'error');
      }
      carregarDocumentosExtras(leadId);
    }
  });
}

window.abrirNovoDocumentoExtra = abrirNovoDocumentoExtra;
window.excluirDocumentoExtra = excluirDocumentoExtra;

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
  
  showToast('Iniciando download do arquivo…', 'info');
  
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

function deleteCrmDoc(leadId, docType) {
  showConfirmModal({
    title: 'Excluir documento?',
    text: 'Deseja realmente excluir este documento do Google Drive e do cadastro do cliente? Esta ação não poderá ser desfeita.',
    onConfirm: async () => {
      const url = `/api/crm/leads/${leadId}/documentos/${docType}`;
      showToast('Excluindo arquivo…', 'info');

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
