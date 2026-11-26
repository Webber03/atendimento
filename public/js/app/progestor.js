// Progestor: dados, filtros, gráficos e mapeamentos

// ==========================================================================
// PROGESTOR TABULATIONS MODULE
// ==========================================================================

async function initProgestorTab() {
  // Clear charts if they exist
  if (chartProgEvolutionInstance) {
    chartProgEvolutionInstance.destroy();
    chartProgEvolutionInstance = null;
  }
  if (chartProgResultsInstance) {
    chartProgResultsInstance.destroy();
    chartProgResultsInstance = null;
  }

  // Set default dates for Progestor tab if not set
  const startDateInput = document.getElementById('filter-prog-start-date');
  const endDateInput = document.getElementById('filter-prog-end-date');
  if (startDateInput && !startDateInput.value) {
    const today = new Date();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(today.getMonth() - 1);
    startDateInput.value = getLocalDateString(oneMonthAgo);
    endDateInput.value = getLocalDateString(today);
  }

  // Register event listeners for filters (if not already registered)
  setupProgestorFilterListeners();

  // Load status mapping
  initProgestorStatusMappingForm();

  // Load the data from Progestor
  await loadProgestorData();
}

function setupProgestorFilterListeners() {
  const periodSelect = document.getElementById('filter-prog-period');
  const customDateContainer = document.getElementById('prog-custom-date-container');
  const startDateInput = document.getElementById('filter-prog-start-date');
  const endDateInput = document.getElementById('filter-prog-end-date');
  const agentSelect = document.getElementById('filter-prog-agent');
  const resultSelect = document.getElementById('filter-prog-result');
  const branchSelect = document.getElementById('filter-prog-branch');
  const searchInput = document.getElementById('filter-prog-search');

  // Toggle custom dates visibility
  if (periodSelect && !periodSelect.dataset.listenerRegistered) {
    periodSelect.addEventListener('change', () => {
      if (periodSelect.value === 'custom') {
        customDateContainer.classList.remove('hidden');
      } else {
        customDateContainer.classList.add('hidden');
      }
      applyProgestorFilters();
    });
    periodSelect.dataset.listenerRegistered = 'true';
  }

  const inputs = [startDateInput, endDateInput, agentSelect, resultSelect, branchSelect];
  inputs.forEach(input => {
    if (input && !input.dataset.listenerRegistered) {
      input.addEventListener('change', applyProgestorFilters);
      input.dataset.listenerRegistered = 'true';
    }
  });

  if (searchInput && !searchInput.dataset.listenerRegistered) {
    searchInput.addEventListener('input', applyProgestorFilters);
    searchInput.dataset.listenerRegistered = 'true';
  }

  // Pagination buttons
  const prevBtn = document.getElementById('btn-prog-prev-page');
  const nextBtn = document.getElementById('btn-prog-next-page');

  if (prevBtn && !prevBtn.dataset.listenerRegistered) {
    prevBtn.addEventListener('click', () => {
      if (progestorCurrentPage > 1) {
        progestorCurrentPage--;
        renderProgestorTable();
      }
    });
    prevBtn.dataset.listenerRegistered = 'true';
  }

  if (nextBtn && !nextBtn.dataset.listenerRegistered) {
    nextBtn.addEventListener('click', () => {
      const totalPages = Math.ceil(progestorFiltered.length / progestorPageSize) || 1;
      if (progestorCurrentPage < totalPages) {
        progestorCurrentPage++;
        renderProgestorTable();
      }
    });
    nextBtn.dataset.listenerRegistered = 'true';
  }
}

async function loadProgestorData(forceRefresh = false) {
  const statusText = document.getElementById('progestor-status-text');
  const statusDot = document.getElementById('progestor-status-dot');
  const refreshIcon = document.getElementById('btn-refresh-progestor-icon');

  if (statusText) statusText.textContent = "Carregando dados…";
  if (statusDot) statusDot.style.background = "#ffb84d"; // Yellow for loading
  if (statusDot) {
    statusDot.style.boxShadow = "0 0 8px #ffb84d";
  }
  if (refreshIcon) refreshIcon.style.animation = "spin 1s linear infinite";

  try {
    const savedUrl = localStorage.getItem('progestor_tabulacoes_url') || '';
    let apiUrl = `/api/progestor/tabulacoes`;
    const params = new URLSearchParams();
    if (savedUrl) params.set('url', savedUrl);
    if (forceRefresh) params.set('force', 'true');
    
    const queryString = params.toString();
    if (queryString) apiUrl += `?${queryString}`;

    const res = await fetchWithAuth(apiUrl).then(r => r.json());
    
    if (res.error && !res.data) {
      throw new Error(res.error);
    }

    progestorData = res.data || [];
    
    // Update status bar
    const lastFetchTime = new Date(res.lastFetched).toLocaleTimeString('pt-BR');
    const sourceLabel = res.source === 'cache' ? 'Cache' : (res.source === 'fallback-cache' ? 'Cache Alternativo' : 'Servidor Progestor');
    if (statusText) statusText.textContent = `${progestorData.length.toLocaleString('pt-BR')} registros obtidos via ${sourceLabel} às ${lastFetchTime}.`;
    if (statusDot) statusDot.style.background = "#24d060"; // Green
    if (statusDot) {
      statusDot.style.boxShadow = "0 0 8px #24d060";
    }
    
    // Populate dynamic select list filter options
    populateProgestorFiltersDropdowns();

    // Reset page and apply filters
    progestorCurrentPage = 1;
    applyProgestorFilters();

    if (res.error) {
      showToast(`Aviso: Buscando cache. Falha ao atualizar: ${res.error}`, "warning");
    }

  } catch (err) {
    showToast("Erro ao obter tabulações do Progestor.", "error");
    console.error(err);
    if (statusText) statusText.textContent = `Erro ao carregar dados: ${err.message}`;
    if (statusDot) statusDot.style.background = "#ff5c5c"; // Red
    if (statusDot) {
      statusDot.style.boxShadow = "0 0 8px #ff5c5c";
    }
  } finally {
    if (refreshIcon) refreshIcon.style.animation = "";
  }
}

// Populate filters with unique options from loaded dataset
function populateProgestorFiltersDropdowns() {
  const agentSelect = document.getElementById('filter-prog-agent');
  const resultSelect = document.getElementById('filter-prog-result');
  const branchSelect = document.getElementById('filter-prog-branch');

  const currentAgent = agentSelect ? agentSelect.value : '';
  const currentResult = resultSelect ? resultSelect.value : '';
  const currentBranch = branchSelect ? branchSelect.value : '';

  // 1. Agents (Funcionario)
  const agents = [...new Set(progestorData.map(r => r.Funcionario).filter(Boolean))].sort();
  if (agentSelect) {
    agentSelect.innerHTML = '<option value="">Todos os Consultores</option>';
    agents.forEach(a => {
      agentSelect.innerHTML += `<option value="${a}">${a}</option>`;
    });
    agentSelect.value = agents.includes(currentAgent) ? currentAgent : '';
  }

  // 2. Outcomes (Resultado)
  const results = [...new Set(progestorData.map(r => r.Resultado ? r.Resultado.trim().toUpperCase() : '').filter(Boolean))].sort();
  if (resultSelect) {
    resultSelect.innerHTML = '<option value="">Todos os Resultados</option>';
    results.forEach(r => {
      const displayLabel = r.length > 40 ? r.substring(0, 40) + '...' : r;
      resultSelect.innerHTML += `<option value="${r}">${displayLabel}</option>`;
    });
    resultSelect.value = results.includes(currentResult) ? currentResult : '';
  }

  // 3. Branch / Channel (Filial)
  const branches = [...new Set(progestorData.map(r => r.Filial).filter(Boolean))].sort();
  if (branchSelect) {
    branchSelect.innerHTML = '<option value="">Todas as Filiais/Canais</option>';
    branches.forEach(b => {
      branchSelect.innerHTML += `<option value="${b}">Filial ${b}</option>`;
    });
    branchSelect.value = branches.includes(currentBranch) ? currentBranch : '';
  }
}

// Convert DD/MM/YYYY into YYYY-MM-DD
function parseProgestorDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.trim().split(' ');
  const dateParts = parts[0].split('/');
  if (dateParts.length === 3) {
    return `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // YYYY-MM-DD
  }
  return '';
}

// Calculate dates for filter periods
function getProgestorDateRange(period) {
  const today = new Date();
  let start_date = '';
  let end_date = '';

  switch (period) {
    case 'diario':
      start_date = getLocalDateString(today);
      end_date = start_date;
      break;
    case 'ontem':
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      start_date = getLocalDateString(yesterday);
      end_date = start_date;
      break;
    case 'semanal':
      const currentDay = today.getDay();
      const diffToMonday = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
      const monday = new Date(today);
      monday.setDate(diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      start_date = getLocalDateString(monday);
      end_date = getLocalDateString(sunday);
      break;
    case 'mensal':
      const y = today.getFullYear();
      const m = today.getMonth();
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      start_date = getLocalDateString(first);
      end_date = getLocalDateString(last);
      break;
    case '7dias':
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(today.getDate() - 7);
      start_date = getLocalDateString(sevenDaysAgo);
      end_date = getLocalDateString(today);
      break;
    case 'custom':
      start_date = document.getElementById('filter-prog-start-date').value;
      end_date = document.getElementById('filter-prog-end-date').value;
      break;
  }
  return { start_date, end_date };
}

function applyProgestorFilters() {
  const period = document.getElementById('filter-prog-period').value;
  const agentVal = document.getElementById('filter-prog-agent').value;
  const resultVal = document.getElementById('filter-prog-result').value;
  const branchVal = document.getElementById('filter-prog-branch').value;
  const searchVal = document.getElementById('filter-prog-search').value.toLowerCase().trim();

  const { start_date, end_date } = getProgestorDateRange(period);

  progestorFiltered = progestorData.filter(r => {
    // 1. Filter by Date range
    const parsedDate = parseProgestorDate(r.Data); // YYYY-MM-DD
    if (start_date && parsedDate < start_date) return false;
    if (end_date && parsedDate > end_date) return false;

    // 2. Filter by Agent
    if (agentVal && r.Funcionario !== agentVal) return false;

    // 3. Filter by Result
    if (resultVal && (r.Resultado ? r.Resultado.trim().toUpperCase() : '') !== resultVal) return false;

    // 4. Filter by Branch
    if (branchVal && r.Filial !== branchVal) return false;

    // 5. Search text match
    if (searchVal) {
      const name = r.Nome ? r.Nome.toLowerCase() : '';
      const cpf = r.CPF ? r.CPF.replace(/\D/g, '') : '';
      const cell = r.Celular ? r.Celular.replace(/\D/g, '') : '';
      
      const searchClean = searchVal.replace(/\D/g, '');
      if (searchClean) {
        if (!cpf.includes(searchClean) && !cell.includes(searchClean)) return false;
      } else {
        if (!name.includes(searchVal)) return false;
      }
    }

    return true;
  });

  progestorCurrentPage = 1;
  
  // Render metrics and views
  updateProgestorKPIs();
  renderProgestorLeaderboard();
  renderProgestorTable();
  renderProgestorCharts();
}

function updateProgestorKPIs() {
  const totalCalls = progestorFiltered.length;
  
  // Clientes Únicos (Unique CPFs contacted)
  const uniqueCpfs = new Set(progestorFiltered.map(r => r.CPF ? r.CPF.replace(/\D/g, '').padStart(11, '0') : null).filter(Boolean));
  const uniqueCount = uniqueCpfs.size;

  // Closed sales
  const closedRows = progestorFiltered.filter(r => {
    const resText = r.Resultado ? r.Resultado.toUpperCase() : '';
    return resText.includes('FECHADO') || resText.includes('FECHAMENTO');
  });
  const closedCount = closedRows.length;

  // Conversion rate
  const conversionRate = uniqueCount > 0 ? (closedCount / uniqueCount) * 100 : 0.00;

  document.getElementById('kpi-prog-totais').textContent = totalCalls.toLocaleString('pt-BR');
  document.getElementById('kpi-prog-unicos').textContent = uniqueCount.toLocaleString('pt-BR');
  document.getElementById('kpi-prog-fechados').textContent = closedCount.toLocaleString('pt-BR');
  document.getElementById('kpi-prog-conversao').textContent = conversionRate.toFixed(2) + '%';
}

function renderProgestorLeaderboard() {
  const rankingBody = document.getElementById('prog-ranking-tbody');
  if (!rankingBody) return;

  // Group stats by agent
  const agentMap = {};
  progestorFiltered.forEach(r => {
    const agent = r.Funcionario || 'NÃO IDENTIFICADO';
    if (!agentMap[agent]) {
      agentMap[agent] = {
        name: agent,
        totales: 0,
        uniqueCpfs: new Set(),
        closed: 0
      };
    }
    
    agentMap[agent].totales++;
    if (r.CPF) agentMap[agent].uniqueCpfs.add(r.CPF.replace(/\D/g, '').padStart(11, '0'));
    
    const resText = r.Resultado ? r.Resultado.toUpperCase() : '';
    if (resText.includes('FECHADO') || resText.includes('FECHAMENTO')) {
      agentMap[agent].closed++;
    }
  });

  const leaderboard = Object.values(agentMap).sort((a, b) => {
    if (b.closed !== a.closed) return b.closed - a.closed;
    return b.totales - a.totales;
  });

  if (leaderboard.length === 0) {
    rankingBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Nenhum operador com dados no período selecionado.</td></tr>';
    return;
  }

  rankingBody.innerHTML = leaderboard.map((item, index) => {
    const positionClass = index === 0 ? 'rank-1' : (index === 1 ? 'rank-2' : (index === 2 ? 'rank-3' : 'rank-other'));
    const positionLabel = index + 1;
    const uniqueClientsCount = item.uniqueCpfs.size;
    const rate = uniqueClientsCount > 0 ? (item.closed / uniqueClientsCount * 100).toFixed(2) : '0.00';

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="rank-badge ${positionClass}">${positionLabel}</span>
            <span style="font-weight: 500;">${item.name}</span>
          </div>
        </td>
        <td class="text-center">${item.totales.toLocaleString('pt-BR')}</td>
        <td class="text-center">${uniqueClientsCount.toLocaleString('pt-BR')}</td>
        <td class="text-center text-cyan" style="font-weight: 600;">${item.closed.toLocaleString('pt-BR')}</td>
        <td class="text-right text-emerald" style="font-weight: 600;">${rate}%</td>
      </tr>
    `;
  }).join('');
}

function renderProgestorTable() {
  const tbody = document.getElementById('progestor-records-tbody');
  const pageIndicator = document.getElementById('prog-page-indicator');
  if (!tbody) return;

  const totalRecords = progestorFiltered.length;
  const totalPages = Math.ceil(totalRecords / progestorPageSize) || 1;

  if (progestorCurrentPage > totalPages) progestorCurrentPage = totalPages;
  if (progestorCurrentPage < 1) progestorCurrentPage = 1;

  if (pageIndicator) pageIndicator.textContent = `Pág. ${progestorCurrentPage} / ${totalPages}`;

  const prevBtn = document.getElementById('btn-prog-prev-page');
  const nextBtn = document.getElementById('btn-prog-next-page');
  if (prevBtn) prevBtn.disabled = progestorCurrentPage === 1;
  if (nextBtn) nextBtn.disabled = progestorCurrentPage === totalPages;

  if (totalRecords === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Nenhuma tabulação encontrada para os filtros selecionados.</td></tr>';
    return;
  }

  const startIndex = (progestorCurrentPage - 1) * progestorPageSize;
  const endIndex = startIndex + progestorPageSize;
  const pageData = progestorFiltered.slice(startIndex, endIndex);

  tbody.innerHTML = pageData.map(row => {
    const resUpper = row.Resultado ? row.Resultado.toUpperCase() : '';
    let badgeClass = 'info-badge';
    if (resUpper.includes('FECHADO') || resUpper.includes('FECHAMENTO')) {
      badgeClass = 'bg-emerald';
    } else if (resUpper.includes('INVIAVEL') || resUpper.includes('SEM MARGEM') || resUpper.includes('NEGATIVO')) {
      badgeClass = 'bg-orange';
    } else if (resUpper.includes('NEGOCIACAO') || resUpper.includes('SIMULACAO') || resUpper.includes('ENVIADA')) {
      badgeClass = 'bg-cyan';
    } else if (resUpper.includes('WPP') || resUpper.includes('MENSAGEM') || resUpper.includes('CONTATO')) {
      badgeClass = 'bg-blue';
    }

    const cleanCpf = row.CPF ? row.CPF.replace(/\D/g, '').padStart(11, '0') : '';
    const formattedCpf = cleanCpf.length === 11 
      ? `${cleanCpf.slice(0,3)}.${cleanCpf.slice(3,6)}.${cleanCpf.slice(6,9)}-${cleanCpf.slice(9,11)}`
      : row.CPF || '-';

    const cellPhone = row.Celular || row.Telefone || '-';

    return `
      <tr>
        <td style="white-space: nowrap; font-size: 12px;">${row.Data || '-'}</td>
        <td style="font-weight: 500;">${row.Funcionario || '-'}</td>
        <td style="font-weight: 500; font-size: 13px;">${row.Nome || '-'}</td>
        <td style="font-family: monospace; font-size: 12px;">${formattedCpf}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-family: monospace;">${cellPhone}</span>
            ${cellPhone !== '-' ? `
              <button onclick="copyToClipboard('${cellPhone}', 'Telefone copiado!')" class="btn btn-secondary" style="padding: 2px 5px; height: auto; font-size: 9px;" title="Copiar celular">
                <i data-lucide="copy" style="width: 10px; height: 10px;"></i>
              </button>
            ` : ''}
          </div>
        </td>
        <td>
          <div style="font-size: 11px;">
            <div style="font-weight: 600;">Filial ${row.Filial || '-'}</div>
            <div class="text-muted">Canal ${row.Canalvenda || '-'}</div>
          </div>
        </td>
        <td>
          <span class="badge ${badgeClass}" style="display: inline-block; font-size: 11px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${row.Resultado || ''}">
            ${row.Resultado || '-'}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

function renderProgestorCharts() {
  renderProgestorEvolutionChart();
  renderProgestorDistributionChart();
}

function renderProgestorEvolutionChart() {
  const canvas = document.getElementById('chart-prog-evolution');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  if (chartProgEvolutionInstance) {
    chartProgEvolutionInstance.destroy();
  }

  const dailyMap = {};
  progestorFiltered.forEach(r => {
    const rawDate = parseProgestorDate(r.Data);
    if (!rawDate) return;
    
    if (!dailyMap[rawDate]) {
      dailyMap[rawDate] = {
        date: rawDate,
        total: 0,
        closed: 0
      };
    }
    
    dailyMap[rawDate].total++;
    const resText = r.Resultado ? r.Resultado.toUpperCase() : '';
    if (resText.includes('FECHADO') || resText.includes('FECHAMENTO')) {
      dailyMap[rawDate].closed++;
    }
  });

  const sortedDays = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  const labels = sortedDays.map(d => {
    const parts = d.date.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d.date;
  });
  const totalData = sortedDays.map(d => d.total);
  const closedData = sortedDays.map(d => d.closed);

  chartProgEvolutionInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Acionamentos Totais',
          data: totalData,
          borderColor: 'rgb(54, 162, 235)',
          backgroundColor: 'rgba(54, 162, 235, 0.08)',
          borderWidth: 2,
          tension: 0.3,
          fill: true
        },
        {
          label: 'Fechamentos (Vendas)',
          data: closedData,
          borderColor: 'rgb(36, 208, 96)',
          backgroundColor: 'rgba(36, 208, 96, 0.1)',
          borderWidth: 2.5,
          tension: 0.25,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#a0aec0', font: { family: 'Montserrat', size: 12 } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a0aec0', font: { family: 'Montserrat' } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a0aec0', font: { family: 'Montserrat' } },
          title: { display: true, text: 'Ligações', color: '#a0aec0' }
        }
      }
    }
  });
}

function renderProgestorDistributionChart() {
  const canvas = document.getElementById('chart-prog-results');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  if (chartProgResultsInstance) {
    chartProgResultsInstance.destroy();
  }

  let closed = 0;
  let unviable = 0;
  let inProgress = 0;
  let other = 0;

  progestorFiltered.forEach(r => {
    const resUpper = r.Resultado ? r.Resultado.toUpperCase() : '';
    if (resUpper.includes('FECHADO') || resUpper.includes('FECHAMENTO')) {
      closed++;
    } else if (resUpper.includes('INVIAVEL') || resUpper.includes('SEM MARGEM') || resUpper.includes('NEGATIVO')) {
      unviable++;
    } else if (resUpper.includes('NEGOCIACAO') || resUpper.includes('SIMULACAO') || resUpper.includes('ENVIADA')) {
      inProgress++;
    } else {
      other++;
    }
  });

  const total = closed + unviable + inProgress + other;
  if (total === 0) {
    return;
  }

  chartProgResultsInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Vendas Fechadas', 'Lead Inviável', 'Em Negociação', 'Contatos / Outros'],
      datasets: [{
        data: [closed, unviable, inProgress, other],
        backgroundColor: [
          'rgba(36, 208, 96, 0.75)',
          'rgba(255, 92, 92, 0.75)',
          'rgba(0, 229, 229, 0.75)',
          'rgba(160, 174, 192, 0.6)'
        ],
        borderColor: [
          'rgb(36, 208, 96)',
          'rgb(255, 92, 92)',
          'rgb(0, 229, 229)',
          'rgb(160, 174, 192)'
        ],
        borderWidth: 1.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#a0aec0', font: { family: 'Montserrat', size: 12 } }
        }
      }
    }
  });
}

// MAPPING & SYNC INTEGRATION
async function editConsultantMapping(id, name, currentProgUser) {
  const newUser = prompt(`Vincular consultor "${name}" ao operador do Progestor (Ex: REALIZE.JACILENE):`, currentProgUser || '');
  if (newUser === null) return;
  
  try {
    const res = await fetchWithAuth(`/api/consultants/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progestor_user: newUser.trim() })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(`Mapeamento de ${name} atualizado!`, "success");
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao atualizar mapeamento.", "error");
    console.error(err);
  }
}

async function editChannelMapping(id, name, currentProgCode) {
  const newCode = prompt(`Vincular canal de venda "${name}" ao ID do canal no Progestor (Ex: 31):`, currentProgCode || '');
  if (newCode === null) return;

  try {
    const res = await fetchWithAuth(`/api/channels/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progestor_code: newCode.trim() })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(`Canal de venda ${name} atualizado!`, "success");
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao atualizar canal de venda.", "error");
    console.error(err);
  }
}

async function initProgestorStatusMappingForm() {
  const closedInput = document.getElementById('mapping-closed-codes');
  const unviableInput = document.getElementById('mapping-unviable-codes');
  const urlInput = document.getElementById('mapping-progestor-url');
  if (!closedInput || !unviableInput) return;

  try {
    const res = await fetchWithAuth('/api/settings/progestor-status').then(r => r.json());
    if (res && !res.error) {
      closedInput.value = res.closed;
      unviableInput.value = res.unviable;
      if (urlInput) urlInput.value = res.url || '';
    }
  } catch (err) {
    console.error("Erro ao obter mapeamento de status:", err);
  }

  const btnSyncHistory = document.getElementById('btn-sync-progestor-history');
  if (btnSyncHistory && !btnSyncHistory.dataset.listenerRegistered) {
    btnSyncHistory.addEventListener('click', async () => {
      if (!confirm("Deseja sincronizar retroativamente todo o histórico de tabulações do Progestor? Isso atualizará os lançamentos diários existentes com base nos novos códigos de status.")) {
        return;
      }
      
      btnSyncHistory.disabled = true;
      const icon = btnSyncHistory.querySelector('i');
      if (icon) icon.style.animation = "spin 1s linear infinite";
      
      showToast("Sincronizando histórico do Progestor... Aguarde.", "info");
      
      try {
        const res = await fetchWithAuth('/api/progestor/sincronizar-total', {
          method: 'POST'
        }).then(r => r.json());
        
        if (res.error) {
          showToast(`Erro na sincronização: ${res.error}`, "error");
        } else {
          showToast(res.message, "success");
        }
      } catch (err) {
        showToast("Erro de rede ao sincronizar histórico.", "error");
        console.error(err);
      } finally {
        btnSyncHistory.disabled = false;
        if (icon) icon.style.animation = "";
      }
    });
    btnSyncHistory.dataset.listenerRegistered = 'true';
  }
}

window.editConsultantMapping = editConsultantMapping;

window.editChannelMapping = editChannelMapping;

window.initProgestorStatusMappingForm = initProgestorStatusMappingForm;
