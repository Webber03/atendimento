// Geração de leads: dashboard, registros e formulário

// ----------------------------------------
// LEADS MODULE LOGIC
// ----------------------------------------

async function refreshLeadsDashboard() {
  const start_date = document.getElementById('leads-filter-start').value;
  const end_date = document.getElementById('leads-filter-end').value;
  const channel_id = document.getElementById('filter-leads-channel').value;
  const system_id = document.getElementById('filter-leads-system').value;
  const convenio_id = document.getElementById('filter-leads-convenio').value;
  const produto_id = document.getElementById('filter-leads-produto').value;

  let url = '/api/lead-generations/dashboard?1=1';
  if (start_date) url += `&start_date=${start_date}`;
  if (end_date) url += `&end_date=${end_date}`;
  if (channel_id) url += `&channel_id=${channel_id}`;
  if (system_id) url += `&system_id=${system_id}`;
  if (convenio_id) url += `&convenio_id=${convenio_id}`;
  if (produto_id) url += `&produto_id=${produto_id}`;

  try {
    const data = await fetchWithAuth(url).then(r => r.json());
    
    // Fallback defaults
    const prospectados = data.total_prospectados || 0;
    const aceites = data.total_aceites || 0;
    const inviaveis = data.total_inviaveis || 0;
    const investido = parseFloat(data.total_investido || 0);
    const fechamentos = data.total_fechamentos || 0;
    const faturamento = parseFloat(data.total_faturamento || 0);

    document.getElementById('kpi-leads-prospectados').textContent = prospectados;
    document.getElementById('kpi-leads-aceites').textContent = aceites;
    document.getElementById('kpi-leads-inviaveis-dash').textContent = inviaveis;
    document.getElementById('kpi-leads-fechamentos').textContent = fechamentos;
    document.getElementById('kpi-leads-investimento').textContent = `R$ ${investido.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    document.getElementById('kpi-leads-faturamento').textContent = `R$ ${faturamento.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}`;

    const txInviaveis = aceites > 0 ? (inviaveis / aceites) * 100 : 0;
    const txResposta = prospectados > 0 ? (aceites / prospectados) * 100 : 0;
    
    const validos = Math.max(0, aceites - inviaveis);
    const txFechamento = validos > 0 ? (fechamentos / validos) * 100 : 0;
    
    let roi = 0;
    if (investido > 0) {
      roi = ((faturamento - investido) / investido) * 100;
    }

    const setLabel = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = `${val.toFixed(2)}%`;
    };

    setLabel('kpi-leads-tx-inviaveis', txInviaveis);
    setLabel('kpi-leads-tx-resposta', txResposta);
    setLabel('kpi-leads-tx-fechamento', txFechamento);
    setLabel('kpi-leads-roi', roi);

  } catch (err) {
    showToast("Erro ao atualizar Dashboard de Leads.", "error");
    console.error(err);
  }
}

async function refreshLeadsRecords() {
  try {
    const data = await fetchWithAuth('/api/lead-generations').then(r => r.json());
    const tbody = document.querySelector('#leads-records-table tbody');
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted">Nenhum registro encontrado.</td></tr>';
      return;
    }

    data.forEach(row => {
      const formattedDate = formatDateBR(row.date);
      
      tbody.innerHTML += `
        <tr>
          <td>${formattedDate}</td>
          <td>${row.channel_name || '-'}</td>
          <td>${row.system_name || '-'}</td>
          <td>${row.convenio_name || '-'}</td>
          <td>${row.produto_name || '-'}</td>
          <td class="text-center">${row.prospectados}</td>
          <td class="text-center">${row.aceites}</td>
          <td class="text-center">${row.inviaveis}</td>
          <td class="text-right">${formatBRL(row.investimento)}</td>
          <td class="text-center text-emerald" style="font-weight: 500;">${row.fechamentos}</td>
          <td class="text-right text-cyan" style="font-weight: 500;">${formatBRL(row.faturamento)}</td>
          <td class="text-center" style="display: flex; gap: 8px; justify-content: center;">
            <button class="btn-icon-delete" onclick="editLeadRecord(${row.id})" title="Editar registro" style="color: var(--accent-blue); padding: 4px 8px;">
              <i data-lucide="edit-2" style="width: 16px; height: 16px;"></i>
            </button>
            <button class="btn-icon-delete" onclick="deleteLeadRecord(${row.id})" title="Remover registro">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `;
    });
    lucide.createIcons();
  } catch (err) {
    showToast("Erro ao listar registros de leads.", "error");
    console.error(err);
  }
}

function handleLeadChannelChange() {
  const channelSelect = document.getElementById('lead-channel');
  const channel_id = channelSelect.value;
  const selectedCh = channels.find(ch => ch.id == channel_id);
  const container = document.getElementById('lead-distribution-container');
  const tbody = document.getElementById('lead-distribution-tbody');

  const inputProspectados = document.getElementById('lead-prospectados');
  const inputAceites = document.getElementById('lead-aceites');
  const inputInviaveis = document.getElementById('lead-inviaveis');
  const inputFechamentos = document.getElementById('lead-fechamentos');

  const expandWrapper = document.getElementById('lead-expand-consultants-wrapper');
  const expandCheckbox = document.getElementById('lead-expand-consultants');

  if (selectedCh) {
    if (expandWrapper) expandWrapper.style.display = 'flex';
    
    if (selectedCh.name.toLowerCase() === 'disparo whatsapp' || selectedCh.name.toLowerCase() === 'disparo wpp') {
      if (expandCheckbox) {
        expandCheckbox.checked = true;
        expandCheckbox.disabled = true;
      }
    } else {
      if (expandCheckbox) expandCheckbox.disabled = false;
    }
  } else {
    if (expandWrapper) expandWrapper.style.display = 'none';
    if (expandCheckbox) {
      expandCheckbox.checked = false;
      expandCheckbox.disabled = false;
    }
  }

  const isDistributed = expandCheckbox && expandCheckbox.checked;

  if (isDistributed) {
    container.classList.remove('hidden');
    inputProspectados.readOnly = false;
    inputAceites.readOnly = true;
    inputInviaveis.readOnly = true;
    inputFechamentos.readOnly = true;

    if (!tbody.querySelector('tr')) {
      tbody.innerHTML = '';
      const sortedConsultants = [...consultants].sort((a, b) => a.name.localeCompare(b.name));
      sortedConsultants.forEach(c => {
        tbody.innerHTML += `
          <tr data-consultant-id="${c.id}">
            <td><strong>${c.name}</strong> <span class="text-muted small">(${c.team_name})</span></td>
            <td>
              <input type="number" class="form-input dist-input dist-leads" data-consultant-id="${c.id}" value="0" min="0" style="padding: 4px 8px; font-size: 0.875rem;">
            </td>
            <td>
              <input type="number" class="form-input dist-input dist-inviaveis" data-consultant-id="${c.id}" value="0" min="0" style="padding: 4px 8px; font-size: 0.875rem;">
            </td>
            <td>
              <input type="number" class="form-input dist-input dist-fechados" data-consultant-id="${c.id}" value="0" min="0" style="padding: 4px 8px; font-size: 0.875rem;">
            </td>
            <td>
              <input type="number" class="form-input dist-input dist-faturamento" data-consultant-id="${c.id}" value="0.00" min="0" step="0.01" style="padding: 4px 8px; font-size: 0.875rem;">
            </td>
          </tr>
        `;
      });

      tbody.querySelectorAll('.dist-input').forEach(input => {
        input.addEventListener('input', calculateLeadDistributionTotals);
      });
    }

    calculateLeadDistributionTotals();
    
    if (window.lucide) {
      window.lucide.createIcons();
    }
  } else {
    container.classList.add('hidden');
    tbody.innerHTML = '';
    inputProspectados.readOnly = false;
    inputAceites.readOnly = false;
    inputInviaveis.readOnly = false;
    inputFechamentos.readOnly = false;
  }
}

function calculateLeadDistributionTotals() {
  const tbody = document.getElementById('lead-distribution-tbody');
  const leadsInputs = tbody.querySelectorAll('.dist-leads');
  const inviaveisInputs = tbody.querySelectorAll('.dist-inviaveis');
  const fechadosInputs = tbody.querySelectorAll('.dist-fechados');
  const faturamentoInputs = tbody.querySelectorAll('.dist-faturamento');

  let totalLeads = 0;
  let totalInviaveis = 0;
  let totalFechados = 0;
  let totalFaturamento = 0;

  leadsInputs.forEach(input => {
    totalLeads += parseInt(input.value, 10) || 0;
  });
  inviaveisInputs.forEach(input => {
    totalInviaveis += parseInt(input.value, 10) || 0;
  });
  fechadosInputs.forEach(input => {
    totalFechados += parseInt(input.value, 10) || 0;
  });
  faturamentoInputs.forEach(input => {
    totalFaturamento += parseFloat(input.value) || 0;
  });

  document.getElementById('lead-aceites').value = totalLeads;
  document.getElementById('lead-inviaveis').value = totalInviaveis;
  document.getElementById('lead-fechamentos').value = totalFechados;
  document.getElementById('lead-faturamento').value = totalFaturamento.toFixed(2);
}

async function saveLeadGeneration(e) {
  e.preventDefault();
  const date = document.getElementById('lead-date').value;
  const channel_id = document.getElementById('lead-channel').value;
  const system_id = document.getElementById('lead-system').value;
  const convenio_id = document.getElementById('lead-convenio').value;
  const produto_id = document.getElementById('lead-produto').value;
  const prospectados = document.getElementById('lead-prospectados').value;
  const aceites = document.getElementById('lead-aceites').value;
  const inviaveis = document.getElementById('lead-inviaveis').value;
  const investimento = document.getElementById('lead-investimento').value;
  const fechamentos = document.getElementById('lead-fechamentos').value;
  const faturamento = document.getElementById('lead-faturamento').value;

  const form = document.getElementById('form-lead-generation');
  const editId = form.dataset.editId;

  // Gather consultant distributions if checkbox is checked
  const distributions = [];
  const expandCheckbox = document.getElementById('lead-expand-consultants');
  if (expandCheckbox && expandCheckbox.checked) {
    const rows = document.querySelectorAll('#lead-distribution-tbody tr[data-consultant-id]');
    rows.forEach(row => {
      const cId = parseInt(row.getAttribute('data-consultant-id'), 10);
      const lt = parseInt(row.querySelector('.dist-leads').value, 10) || 0;
      const inv = parseInt(row.querySelector('.dist-inviaveis').value, 10) || 0;
      const fech = parseInt(row.querySelector('.dist-fechados').value, 10) || 0;
      const fat = parseFloat(row.querySelector('.dist-faturamento').value) || 0;

      if (lt > 0 || inv > 0 || fech > 0 || fat > 0) {
        distributions.push({
          consultant_id: cId,
          leads_totais: lt,
          inviaveis: inv,
          fechados: fech,
          faturamento: fat
        });
      }
    });
  }

  try {
    let response;
    let url = '/api/lead-generations';
    let method = 'POST';
    let successMsg = "Registro salvo com sucesso!";
    
    if (editId) {
      url += `/${editId}`;
      method = 'PUT';
      successMsg = "Registro atualizado com sucesso!";
    }

    const res = await fetchWithAuth(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        channel_id: channel_id ? parseInt(channel_id, 10) : null,
        system_id: system_id ? parseInt(system_id, 10) : null,
        convenio_id: convenio_id ? parseInt(convenio_id, 10) : null,
        produto_id: produto_id ? parseInt(produto_id, 10) : null,
        prospectados: parseInt(prospectados, 10) || 0,
        aceites: parseInt(aceites, 10) || 0,
        inviaveis: parseInt(inviaveis, 10) || 0,
        investimento: parseFloat(investimento) || 0,
        fechamentos: parseInt(fechamentos, 10) || 0,
        faturamento: parseFloat(faturamento) || 0,
        distributions
      })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(successMsg, "success");
      // reset forms except date
      document.getElementById('lead-channel').value = '';
      handleLeadChannelChange(); // Reset distribution container visibility and inputs
      document.getElementById('lead-system').value = '';
      document.getElementById('lead-convenio').value = '';
      document.getElementById('lead-produto').value = '';
      document.getElementById('lead-prospectados').value = '0';
      document.getElementById('lead-aceites').value = '0';
      document.getElementById('lead-inviaveis').value = '0';
      document.getElementById('lead-investimento').value = '0.00';
      document.getElementById('lead-fechamentos').value = '0';
      document.getElementById('lead-faturamento').value = '0.00';
      
      // Reset edit mode
      delete form.dataset.editId;
      const submitBtn = document.querySelector('#form-lead-generation button[type="submit"]');
      submitBtn.innerHTML = '<i data-lucide="save"></i> Salvar Registro';
      lucide.createIcons();
      
      refreshLeadsRecords();
    }
  } catch (err) {
    showToast("Erro ao salvar registro de leads.", "error");
    console.error(err);
  }
}

async function editLeadRecord(id) {
  try {
    const data = await fetchWithAuth('/api/lead-generations').then(r => r.json());
    const record = data.find(r => r.id === id);
    if (!record) throw new Error('Registro não encontrado');

    // Pre-fill edit form with current values
    let dateValue = record.date;
    if (dateValue && dateValue.includes('T')) {
      dateValue = dateValue.split('T')[0];
    }
    document.getElementById('lead-date').value = dateValue;
    document.getElementById('lead-channel').value = record.channel_id || '';
    
    const hasDistributions = (record.distributions && record.distributions.length > 0);
    const expandCheckbox = document.getElementById('lead-expand-consultants');
    if (expandCheckbox) {
      expandCheckbox.checked = hasDistributions;
    }
    
    // Trigger channel change logic (shows/hides and renders consultant table)
    handleLeadChannelChange();

    document.getElementById('lead-system').value = record.system_id || '';
    document.getElementById('lead-convenio').value = record.convenio_id || '';
    document.getElementById('lead-produto').value = record.produto_id || '';
    document.getElementById('lead-prospectados').value = record.prospectados || '0';
    document.getElementById('lead-aceites').value = record.aceites || '0';
    document.getElementById('lead-inviaveis').value = record.inviaveis || '0';
    document.getElementById('lead-investimento').value = record.investimento || '0.00';
    document.getElementById('lead-fechamentos').value = record.fechamentos || '0';
    document.getElementById('lead-faturamento').value = record.faturamento || '0.00';

    // Populate distribution fields if checkbox is checked
    if (expandCheckbox && expandCheckbox.checked && record.distributions) {
      const tbody = document.getElementById('lead-distribution-tbody');
      record.distributions.forEach(dist => {
        const row = tbody.querySelector(`tr[data-consultant-id="${dist.consultant_id}"]`);
        if (row) {
          row.querySelector('.dist-leads').value = dist.leads_totais;
          row.querySelector('.dist-inviaveis').value = dist.inviaveis;
          row.querySelector('.dist-fechados').value = dist.fechados;
          row.querySelector('.dist-faturamento').value = dist.faturamento || '0.00';
        }
      });
      // Update totals
      calculateLeadDistributionTotals();
    }

    // Store ID for update
    document.getElementById('form-lead-generation').dataset.editId = id;
    
    // Change button text to indicate edit mode
    const submitBtn = document.querySelector('#form-lead-generation button[type="submit"]');
    submitBtn.innerHTML = '<i data-lucide="save"></i> Atualizar Registro';
    lucide.createIcons();
    
    // Scroll smoothly to the top of the page for editing
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    showToast('Modo edição ativado. Atualize os dados e clique em "Atualizar Registro"', 'success');
  } catch (err) {
    showToast('Erro ao editar registro: ' + err.message, 'error');
  }
}

async function deleteLeadRecord(id) {
  if (!confirm("Deseja remover este registro permanentemente?")) return;
  try {
    const res = await fetchWithAuth(`/api/lead-generations/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(res.message, "success");
      refreshLeadsRecords();
    }
  } catch (err) {
    showToast("Erro ao remover registro.", "error");
    console.error(err);
  }
}

window.deleteLeadRecord = deleteLeadRecord;
