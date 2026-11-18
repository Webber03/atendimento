// Lançamentos diários e registros

async function refreshRecentRecords() {
  try {
    const startDate = document.getElementById('records-start-date').value;
    const endDate = document.getElementById('records-end-date').value;
    const teamId = document.getElementById('records-team').value;
    const consultantId = document.getElementById('records-consultant').value;
    const channelId = document.getElementById('records-channel').value;

    const params = new URLSearchParams();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    if (teamId) params.set('team_id', teamId);
    if (consultantId) params.set('consultant_id', consultantId);
    if (channelId) params.set('channel_id', channelId);

    const rows = await fetchWithAuth(`/api/records/latest?${params.toString()}`).then(r => r.json());
    const tbody = document.getElementById('records-table-body');

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">Nenhum lançamento encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const date = formatDateBR(row.date);
      const aproveitaveis = (row.leads_totais || 0) - (row.inviaveis || 0);
      const conversao = aproveitaveis > 0 ? ((row.fechados || 0) / aproveitaveis * 100).toFixed(2) : '0.00';

      return `
        <tr>
          <td>${date}</td>
          <td>${row.consultant_name || '-'}</td>
          <td>${row.team_name || '-'}</td>
          <td>${row.channel_name || '-'}</td>
          <td class="text-center">${(row.leads_totais || 0).toLocaleString('pt-BR')}</td>
          <td class="text-center">${(row.inviaveis || 0).toLocaleString('pt-BR')}</td>
          <td class="text-center">${aproveitaveis.toLocaleString('pt-BR')}</td>
          <td class="text-center">${(row.fechados || 0).toLocaleString('pt-BR')}</td>
          <td class="text-right text-emerald">${conversao}%</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
    document.getElementById('records-table-body').innerHTML = '<tr><td colspan="9" class="text-center text-muted">Erro ao carregar os registros.</td></tr>';
  }
}

// ----------------------------------------
// DAILY LAUNCHES GRID MODULE
// ----------------------------------------

function checkLaunchGridTrigger() {
  const date = document.getElementById('launch-date').value;
  const consultantId = document.getElementById('launch-consultant').value;
  
  const placeholder = document.getElementById('launch-placeholder');
  const container = document.getElementById('launch-form-container');
  
  if (date && consultantId) {
    placeholder.classList.add('hidden');
    container.classList.remove('hidden');
    
    // Set Badge title
    const selectedC = consultants.find(c => c.id == consultantId);
    document.getElementById('selected-consultant-badge').textContent = `${selectedC.name} (${selectedC.team_name})`;
    
    loadLaunchGrid(date, consultantId);
  } else {
    placeholder.classList.remove('hidden');
    container.classList.add('hidden');
  }
}

async function loadLaunchGrid(date, consultantId) {
  try {
    const grid = await fetchWithAuth(`/api/records?date=${date}&consultant_id=${consultantId}`).then(r => r.json());
    
    const tbody = document.getElementById('launch-table-body');
    tbody.innerHTML = '';

    if (grid.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Aviso: Não há canais de venda cadastrados e ativos no sistema. Vá até as configurações.</td></tr>';
      updateLaunchGridTotals();
      return;
    }

    grid.forEach(row => {
      const aproveitaveis = row.leads_totais - row.inviaveis;
      tbody.innerHTML += `
        <tr data-channel-id="${row.channel_id}">
          <td style="font-weight: 500;">${row.channel_name}</td>
          <td>
            <input type="number" class="form-input launch-input input-leads" value="${row.leads_totais}" min="0">
          </td>
          <td>
            <input type="number" class="form-input launch-input input-inviaveis" value="${row.inviaveis}" min="0">
          </td>
          <td class="text-center aproveitaveis-cell">${aproveitaveis}</td>
          <td>
            <input type="number" class="form-input launch-input input-fechados" value="${row.fechados}" min="0">
          </td>
          <td>
            <input type="text" class="form-input observacoes-input input-obs" value="${row.observacoes}" placeholder="Ex: Lead premium">
          </td>
        </tr>
      `;
    });

    // Add event listeners to input changes
    tbody.querySelectorAll('.launch-input').forEach(input => {
      input.addEventListener('input', (e) => {
        handleLaunchGridValueChange(e.target);
      });
    });

    updateLaunchGridTotals();

  } catch (err) {
    showToast("Erro ao obter grade de canais.", "error");
    console.error(err);
  }
}

function handleLaunchGridValueChange(inputEl) {
  const row = inputEl.closest('tr');
  const leadsTotais = parseInt(row.querySelector('.input-leads').value, 10) || 0;
  const inviaveis = parseInt(row.querySelector('.input-inviaveis').value, 10) || 0;
  const fechados = parseInt(row.querySelector('.input-fechados').value, 10) || 0;
  
  // Calculate Usable
  const aproveitaveis = Math.max(0, leadsTotais - inviaveis);
  row.querySelector('.aproveitaveis-cell').textContent = aproveitaveis;

  // Real-time error styling/validation
  let hasRowError = false;
  row.classList.remove('has-error');

  if (inviaveis > leadsTotais) {
    hasRowError = true;
  }
  if (fechados > aproveitaveis) {
    hasRowError = true;
  }

  if (hasRowError) {
    row.style.backgroundColor = 'hsla(350, 89%, 60%, 0.08)';
  } else {
    row.style.backgroundColor = '';
  }

  // Recalculate whole grid
  updateLaunchGridTotals();
}

function updateLaunchGridTotals() {
  const tbody = document.getElementById('launch-table-body');
  const rows = tbody.querySelectorAll('tr[data-channel-id]');

  let sumLeads = 0;
  let sumInviaveis = 0;
  let sumAproveitaveis = 0;
  let sumFechados = 0;
  
  let hasValidationErrors = false;
  let validationMsgText = '';

  rows.forEach(row => {
    const leads = parseInt(row.querySelector('.input-leads').value, 10) || 0;
    const inviaveis = parseInt(row.querySelector('.input-inviaveis').value, 10) || 0;
    const fechados = parseInt(row.querySelector('.input-fechados').value, 10) || 0;
    const aproveitaveis = leads - inviaveis;

    // Checks row validation rules
    if (leads < 0 || inviaveis < 0 || fechados < 0) {
      hasValidationErrors = true;
      validationMsgText = "Não são permitidos valores numéricos negativos.";
    }
    if (inviaveis > leads) {
      hasValidationErrors = true;
      validationMsgText = "O número de leads inviáveis não pode exceder o total de leads recebidos.";
    }

    sumLeads += leads;
    sumInviaveis += inviaveis;
    sumAproveitaveis += aproveitaveis;
    sumFechados += fechados;
  });

  // Calculate Conversion Rate
  let conversion = 0;
  if (sumAproveitaveis > 0) {
    conversion = (sumFechados / sumAproveitaveis) * 100;
  }

  // Set DOM totals
  document.getElementById('launch-total-leads').textContent = sumLeads;
  document.getElementById('launch-total-inviaveis').textContent = sumInviaveis;
  document.getElementById('launch-total-aproveitaveis').textContent = sumAproveitaveis;
  document.getElementById('launch-total-fechados').textContent = sumFechados;
  document.getElementById('launch-total-conversion').textContent = conversion.toFixed(2) + '%';

  // Toggle warning banner & lock save button
  const errorBanner = document.getElementById('launch-validation-message');
  const btnSave = document.getElementById('btn-save-launches');

  if (hasValidationErrors) {
    errorBanner.textContent = validationMsgText;
    errorBanner.classList.remove('hidden');
    btnSave.disabled = true;
    btnSave.style.opacity = '0.5';
    btnSave.style.cursor = 'not-allowed';
  } else {
    errorBanner.classList.add('hidden');
    btnSave.disabled = false;
    btnSave.style.opacity = '1';
    btnSave.style.cursor = 'pointer';
  }
}

async function saveLaunches() {
  const date = document.getElementById('launch-date').value;
  const consultantId = document.getElementById('launch-consultant').value;
  const tbody = document.getElementById('launch-table-body');
  const rows = tbody.querySelectorAll('tr[data-channel-id]');

  const launches = [];
  rows.forEach(row => {
    launches.push({
      channel_id: parseInt(row.getAttribute('data-channel-id'), 10),
      leads_totais: parseInt(row.querySelector('.input-leads').value, 10) || 0,
      inviaveis: parseInt(row.querySelector('.input-inviaveis').value, 10) || 0,
      fechados: parseInt(row.querySelector('.input-fechados').value, 10) || 0,
      observacoes: row.querySelector('.input-obs').value
    });
  });

  try {
    const res = await fetchWithAuth('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        consultant_id: parseInt(consultantId, 10),
        launches
      })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(res.message, "success");
      // Switch to dashboard after a delay to show off saved entries
      setTimeout(() => {
        switchTab('dashboard');
      }, 1500);
    }
  } catch (err) {
    showToast("Erro de rede ao salvar lançamentos.", "error");
    console.error(err);
  }
}
