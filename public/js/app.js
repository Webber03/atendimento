// ==========================================================================
// METRIFY SPA FRONTEND LOGIC
// ==========================================================================

// Global state variables
let teams = [];
let consultants = [];
let channels = [];
let systems = [];
let convenios = [];
let produtos = [];
let activeTab = 'dashboard';

// Chart.js instances
let evolutionChartInstance = null;
let channelChartInstance = null;

// Initialize the app on load
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  // 1. Initialize Lucide Icons
  lucide.createIcons();
  
  // 2. Set default dates
  setDefaultDates();

  // 3. Register Tab Listeners
  setupNavigation();

  // 4. Fetch initial core lists (Teams, Consultants, Channels)
  await loadCoreData();

  // 5. Register Event Listeners for Filters & Forms
  setupEventListeners();

  // 6. Initial render of current tab
  switchTab('dashboard');
}

// ----------------------------------------
// CONFIGS AND DATE UTILITIES
// ----------------------------------------

// Standard date format YYYY-MM-DD
function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setDefaultDates() {
  const today = new Date();
  
  // Header clock/date
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('current-date-span').textContent = today.toLocaleDateString('pt-BR', options);

  // Launches date picker defaults to today
  document.getElementById('launch-date').value = getLocalDateString(today);
  
  // Custom date filters defaults
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(today.getMonth() - 1);
  document.getElementById('filter-start-date').value = getLocalDateString(oneMonthAgo);
  document.getElementById('filter-end-date').value = getLocalDateString(today);
}

// Calculates start and end dates based on selected filter option
function getDateRangeForPeriod(period) {
  const today = new Date();
  let start_date = '';
  let end_date = '';

  switch (period) {
    case 'diario':
      const dailyStr = getLocalDateString(today);
      start_date = dailyStr;
      end_date = dailyStr;
      break;

    case 'semanal':
      // Monday to Sunday of the current week
      const currentDay = today.getDay(); // 0 is Sunday, 1 is Monday...
      const diffToMonday = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
      
      const monday = new Date(today);
      monday.setDate(diffToMonday);
      
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      
      start_date = getLocalDateString(monday);
      end_date = getLocalDateString(sunday);
      break;

    case 'mensal':
      // 1st to last day of current month
      const y = today.getFullYear();
      const m = today.getMonth();
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      
      start_date = getLocalDateString(first);
      end_date = getLocalDateString(last);
      break;

    case 'custom':
      start_date = document.getElementById('filter-start-date').value;
      end_date = document.getElementById('filter-end-date').value;
      break;
  }

  return { start_date, end_date };
}

// ----------------------------------------
// ROUTER & NAVIGATION
// ----------------------------------------

function setupNavigation() {
  const tabs = [
    { navId: 'nav-dashboard', viewId: 'view-dashboard', name: 'Dashboard Analítico', subtitle: 'Acompanhamento comercial em tempo real' },
    { navId: 'nav-launches', viewId: 'view-launches', name: 'Lançamentos Diários', subtitle: 'Preenchimento e envio de métricas de consultores' },
    { navId: 'nav-records', viewId: 'view-records', name: 'Registros', subtitle: 'Consulta rápida dos últimos lançamentos' },
    { navId: 'nav-settings', viewId: 'view-settings', name: 'Cadastros & Configurações', subtitle: 'Gerenciamento de equipes, consultores e canais de venda' },
    { navId: 'nav-leads-dashboard', viewId: 'view-leads-dashboard', name: 'Dashboard de Leads', subtitle: 'Visão gerencial e ROI da Geração de Leads' },
    { navId: 'nav-leads-records', viewId: 'view-leads-records', name: 'Geração de Leads', subtitle: 'Controle de performance da Geração de Leads' }
  ];

  tabs.forEach(tab => {
    document.getElementById(tab.navId).addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(tab.viewId.replace('view-', ''));
    });
  });
}

function switchTab(tabName) {
  activeTab = tabName;
  
  // Update sidebar active classes
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`nav-${tabName}`).classList.add('active');

  // Show/Hide views
  document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
  document.getElementById(`view-${tabName}`).classList.remove('hidden');

  // Update Header title
  const headerTitle = document.getElementById('page-title');
  const headerSubtitle = document.getElementById('page-subtitle');

  if (tabName === 'dashboard') {
    headerTitle.textContent = 'Dashboard Analítico';
    headerSubtitle.textContent = 'Acompanhamento comercial em tempo real';
    refreshDashboard();
  } else if (tabName === 'launches') {
    headerTitle.textContent = 'Lançamentos Diários';
    headerSubtitle.textContent = 'Preenchimento e envio de métricas de consultores';
    checkLaunchGridTrigger();
  } else if (tabName === 'records') {
    headerTitle.textContent = 'Registros';
    headerSubtitle.textContent = 'Consulta rápida dos últimos lançamentos';
    refreshRecentRecords();
  } else if (tabName === 'settings') {
    headerTitle.textContent = 'Cadastros & Configurações';
    headerSubtitle.textContent = 'Gerenciamento de equipes, consultores e canais de venda';
    renderSettingsLists();
  } else if (tabName === 'leads-dashboard') {
    headerTitle.textContent = 'Dashboard Geração de Leads';
    headerSubtitle.textContent = 'Visão gerencial, eficiência e ROI';
    refreshLeadsDashboard();
  } else if (tabName === 'leads-records') {
    headerTitle.textContent = 'Registro de Leads e Resultados';
    headerSubtitle.textContent = 'Lance os resultados diários da operação';
    refreshLeadsRecords();
  }
}

// ----------------------------------------
// STATE LOADERS & ACTIONS
// ----------------------------------------

async function loadCoreData() {
  try {
    const [resTeams, resConsultants, resChannels, resSystems, resConvenios, resProdutos] = await Promise.all([
      fetch('/api/teams').then(r => r.json()),
      fetch('/api/consultants').then(r => r.json()),
      fetch('/api/channels').then(r => r.json()),
      fetch('/api/systems').then(r => r.json()),
      fetch('/api/convenios').then(r => r.json()),
      fetch('/api/produtos').then(r => r.json())
    ]);

    teams = resTeams;
    consultants = resConsultants;
    channels = resChannels;
    systems = resSystems || [];
    convenios = resConvenios || [];
    produtos = resProdutos || [];

    // Populate dropdowns across views
    populateDropdowns();
  } catch (err) {
    showToast("Erro ao carregar dados do servidor.", "error");
    console.error(err);
  }
}

function populateDropdowns() {
  // 1. Dashboard Filters
  const filterTeam = document.getElementById('filter-team');
  const filterConsultant = document.getElementById('filter-consultant');
  
  filterTeam.innerHTML = '<option value="">Todas as Equipes</option>';
  teams.forEach(t => {
    filterTeam.innerHTML += `<option value="${t.id}">${t.name}</option>`;
  });

  updateConsultantFilterOptions();

  // 1b. Dashboard Filter - Sales Channel
  const filterChannel = document.getElementById('filter-channel');
  const currentChannelVal = filterChannel.value;
  filterChannel.innerHTML = '<option value="">Todos os Canais</option>';
  channels.forEach(ch => {
    filterChannel.innerHTML += `<option value="${ch.id}">${ch.name}</option>`;
  });
  // Reapply previous value if it is still valid
  if (channels.some(ch => ch.id == currentChannelVal)) {
    filterChannel.value = currentChannelVal;
  }

  // 2. Launches Panel
  const launchTeam = document.getElementById('launch-team');
  const currentLaunchTeam = launchTeam.value;
  launchTeam.innerHTML = '<option value="">-- Selecione a Equipe --</option>';
  teams.forEach(t => {
    launchTeam.innerHTML += `<option value="${t.id}">${t.name}</option>`;
  });
  if (teams.some(t => t.id == currentLaunchTeam)) {
    launchTeam.value = currentLaunchTeam;
  }

  // 3. Records view filters
  const recordsTeam = document.getElementById('records-team');
  const currentRecordsTeam = recordsTeam.value;
  recordsTeam.innerHTML = '<option value="">Todas as Equipes</option>';
  teams.forEach(t => {
    recordsTeam.innerHTML += `<option value="${t.id}">${t.name}</option>`;
  });
  if (teams.some(t => t.id == currentRecordsTeam)) {
    recordsTeam.value = currentRecordsTeam;
  }

  const recordsConsultant = document.getElementById('records-consultant');
  const currentRecordsConsultant = recordsConsultant.value;
  recordsConsultant.innerHTML = '<option value="">Todos os Consultores</option>';
  consultants.forEach(c => {
    recordsConsultant.innerHTML += `<option value="${c.id}">${c.name} (${c.team_name})</option>`;
  });
  if (consultants.some(c => c.id == currentRecordsConsultant)) {
    recordsConsultant.value = currentRecordsConsultant;
  }

  const recordsChannel = document.getElementById('records-channel');
  const currentRecordsChannel = recordsChannel.value;
  recordsChannel.innerHTML = '<option value="">Todos os Canais</option>';
  channels.forEach(ch => {
    recordsChannel.innerHTML += `<option value="${ch.id}">${ch.name}</option>`;
  });
  if (channels.some(ch => ch.id == currentRecordsChannel)) {
    recordsChannel.value = currentRecordsChannel;
  }

  updateLaunchConsultantOptions();

  const consultantTeamId = document.getElementById('consultant-team-id');
  consultantTeamId.innerHTML = '<option value="">-- Selecione uma Equipe --</option>';
  teams.forEach(t => {
    consultantTeamId.innerHTML += `<option value="${t.id}">${t.name}</option>`;
  });

  // 4. Leads Forms
  const leadChannel = document.getElementById('lead-channel');
  if (leadChannel) {
    const currentLeadCh = leadChannel.value;
    leadChannel.innerHTML = '<option value="">-- Nenhum --</option>';
    channels.forEach(ch => {
      leadChannel.innerHTML += `<option value="${ch.id}">${ch.name}</option>`;
    });
    if (channels.some(ch => ch.id == currentLeadCh)) {
      leadChannel.value = currentLeadCh;
    }
  }

  const leadSystem = document.getElementById('lead-system');
  if (leadSystem) {
    const currentLeadSys = leadSystem.value;
    leadSystem.innerHTML = '<option value="">-- Nenhum --</option>';
    systems.forEach(sys => {
      leadSystem.innerHTML += `<option value="${sys.id}">${sys.name}</option>`;
    });
    if (systems.some(sys => sys.id == currentLeadSys)) {
      leadSystem.value = currentLeadSys;
    }
  }

  const leadConvenio = document.getElementById('lead-convenio');
  if (leadConvenio) {
    const currentLeadCv = leadConvenio.value;
    leadConvenio.innerHTML = '<option value="">-- Nenhum --</option>';
    convenios.forEach(cv => {
      leadConvenio.innerHTML += `<option value="${cv.id}">${cv.name}</option>`;
    });
    if (convenios.some(cv => cv.id == currentLeadCv)) leadConvenio.value = currentLeadCv;
  }

  const leadProduto = document.getElementById('lead-produto');
  if (leadProduto) {
    const currentLeadPd = leadProduto.value;
    leadProduto.innerHTML = '<option value="">-- Nenhum --</option>';
    produtos.forEach(pd => {
      leadProduto.innerHTML += `<option value="${pd.id}">${pd.name}</option>`;
    });
    if (produtos.some(pd => pd.id == currentLeadPd)) leadProduto.value = currentLeadPd;
  }

  // Dashboard Filters Leads
  ['filter-leads-channel', 'filter-leads-system', 'filter-leads-convenio', 'filter-leads-produto'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const currentVal = el.value;
    el.innerHTML = '<option value="">Todos</option>';
    let sourceArray = [];
    if (id === 'filter-leads-channel') sourceArray = channels;
    if (id === 'filter-leads-system') sourceArray = systems;
    if (id === 'filter-leads-convenio') sourceArray = convenios;
    if (id === 'filter-leads-produto') sourceArray = produtos;
    
    sourceArray.forEach(item => {
      el.innerHTML += `<option value="${item.id}">${item.name}</option>`;
    });
    if (sourceArray.some(item => item.id == currentVal)) el.value = currentVal;
  });
}

// Filters dashboard consultant select list based on the chosen team
function updateConsultantFilterOptions() {
  const filterTeamVal = document.getElementById('filter-team').value;
  const filterConsultant = document.getElementById('filter-consultant');
  const currentVal = filterConsultant.value;

  filterConsultant.innerHTML = '<option value="">Todos os Consultores</option>';
  
  const filtered = filterTeamVal 
    ? consultants.filter(c => c.team_id == filterTeamVal) 
    : consultants;

  filtered.forEach(c => {
    filterConsultant.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });

  // Reapply previous value if it is still valid
  if (filtered.some(c => c.id == currentVal)) {
    filterConsultant.value = currentVal;
  } else {
    filterConsultant.value = "";
  }
}

// Filters launch consultant select list based on the chosen team
function updateLaunchConsultantOptions() {
  const launchTeamVal = document.getElementById('launch-team').value;
  const launchConsultant = document.getElementById('launch-consultant');
  const currentVal = launchConsultant.value;

  launchConsultant.innerHTML = '<option value="">-- Selecione o Consultor --</option>';
  const filtered = launchTeamVal
    ? consultants.filter(c => c.team_id == launchTeamVal)
    : consultants;

  filtered.forEach(c => {
    launchConsultant.innerHTML += `<option value="${c.id}">${c.name}${launchTeamVal ? '' : ` (${c.team_name})`}</option>`;
  });

  if (filtered.some(c => c.id == currentVal)) {
    launchConsultant.value = currentVal;
  } else {
    launchConsultant.value = "";
  }
}

// ----------------------------------------
// DASHBOARD MODULE
// ----------------------------------------

async function refreshDashboard() {
  const period = document.getElementById('filter-period').value;
  const teamId = document.getElementById('filter-team').value;
  const consultantId = document.getElementById('filter-consultant').value;
  const channelId = document.getElementById('filter-channel').value;
  
  const { start_date, end_date } = getDateRangeForPeriod(period);

  if (!start_date || !end_date) return;

  try {
    let url = `/api/dashboard?start_date=${start_date}&end_date=${end_date}`;
    if (teamId) url += `&team_id=${teamId}`;
    if (consultantId) url += `&consultant_id=${consultantId}`;
    if (channelId) url += `&channel_id=${channelId}`;

    const data = await fetch(url).then(r => r.json());

    // Update KPI UI
    document.getElementById('kpi-leads-totais').textContent = data.kpis.total_leads.toLocaleString('pt-BR');
    document.getElementById('kpi-leads-inviaveis').textContent = data.kpis.inviaveis.toLocaleString('pt-BR');
    document.getElementById('kpi-leads-inviaveis-label').textContent = `${data.kpis.percent_inviaveis.toFixed(2)}% dos leads recebidos`;
    document.getElementById('kpi-leads-aproveitaveis').textContent = data.kpis.aproveitaveis.toLocaleString('pt-BR');
    document.getElementById('kpi-fechados').textContent = data.kpis.fechados.toLocaleString('pt-BR');
    document.getElementById('kpi-conversao').textContent = data.kpis.conversao_reajustada.toFixed(2) + '%';

    // Build charts
    renderEvolutionChart(data.evolution);
    renderChannelChart(data.channelSplit);

    // Build ranking lists
    renderRankings(data.consultantsRanking, data.teamsRanking);

  } catch (err) {
    showToast("Erro ao obter dados analíticos.", "error");
    console.error(err);
  }
}

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

    const rows = await fetch(`/api/records/latest?${params.toString()}`).then(r => r.json());
    const tbody = document.getElementById('records-table-body');

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">Nenhum lançamento encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const rawDate = row.date ? String(row.date) : '';
      const date = rawDate ? (() => {
        const [year, month, day] = rawDate.split('-');
        if (!year || !month || !day) return rawDate;
        const parsed = new Date(Number(year), Number(month) - 1, Number(day));
        return parsed.toLocaleDateString('pt-BR');
      })() : '-';
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

function renderEvolutionChart(evolutionData) {
  const ctx = document.getElementById('evolutionChart').getContext('2d');
  
  if (evolutionChartInstance) {
    evolutionChartInstance.destroy();
  }

  const labels = evolutionData.map(d => {
    // Format date YYYY-MM-DD to DD/MM
    const pts = d.date.split('-');
    return `${pts[2]}/${pts[1]}`;
  });

  const leadsTotais = evolutionData.map(d => d.leads_totais);
  const fechados = evolutionData.map(d => d.fechados);
  const conversao = evolutionData.map(d => d.conversao_reajustada);

  evolutionChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Conversão Reajustada (%)',
          data: conversao,
          borderColor: 'rgb(0, 229, 229)',
          backgroundColor: 'rgba(0, 229, 229, 0.05)',
          borderWidth: 3,
          tension: 0.35,
          yAxisID: 'y1',
          fill: true
        },
        {
          label: 'Leads Recebidos',
          data: leadsTotais,
          borderColor: 'rgba(54, 162, 235, 0.5)',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.1,
          yAxisID: 'y'
        },
        {
          label: 'Vendas Fechadas',
          data: fechados,
          borderColor: 'rgb(153, 51, 255)',
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.1,
          yAxisID: 'y'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#a0aec0', font: { family: 'Outfit', size: 12 } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a0aec0', font: { family: 'Outfit' } }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a0aec0', font: { family: 'Outfit' } },
          title: { display: true, text: 'Quantidade (Absoluto)', color: '#a0aec0' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#00e5e5', font: { family: 'Outfit', weight: 'bold' } },
          title: { display: true, text: 'Taxa de Conversão (%)', color: '#00e5e5' },
          min: 0,
          max: 100
        }
      }
    }
  });
}

function renderChannelChart(channelData) {
  const ctx = document.getElementById('channelChart').getContext('2d');
  
  if (channelChartInstance) {
    channelChartInstance.destroy();
  }

  const labels = channelData.map(c => c.channel_name);
  const leads = channelData.map(c => c.leads_totais);
  const fechados = channelData.map(c => c.fechados);

  channelChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Leads Recebidos',
          data: leads,
          backgroundColor: 'rgba(0, 122, 255, 0.65)',
          borderColor: 'rgb(0, 122, 255)',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Fechados (Vendas)',
          data: fechados,
          backgroundColor: 'rgba(36, 208, 96, 0.65)',
          borderColor: 'rgb(36, 208, 96)',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y', // Horizontal bars
      plugins: {
        legend: {
          labels: { color: '#a0aec0', font: { family: 'Outfit', size: 12 } }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a0aec0', font: { family: 'Outfit' } }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#a0aec0', font: { family: 'Outfit' } }
        }
      }
    }
  });
}

function renderRankings(consultantsRank, teamsRank) {
  // 1. Consultants Ranking
  const cBody = document.getElementById('ranking-consultants-body');
  if (consultantsRank.length === 0) {
    cBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Nenhum dado registrado no período.</td></tr>';
  } else {
    cBody.innerHTML = '';
    consultantsRank.forEach((item, index) => {
      const positionClass = index === 0 ? 'rank-1' : (index === 1 ? 'rank-2' : (index === 2 ? 'rank-3' : 'rank-other'));
      const positionLabel = index + 1;
      
      cBody.innerHTML += `
        <tr>
          <td><span class="rank-badge ${positionClass}">${positionLabel}</span></td>
          <td style="font-weight: 500;">${item.consultant_name}</td>
          <td><span class="badge info-badge">${item.team_name}</span></td>
          <td class="text-center">${item.leads_totais - item.inviaveis}</td>
          <td class="text-center text-cyan">${item.fechados}</td>
          <td class="text-right text-emerald">${item.conversao_reajustada.toFixed(2)}%</td>
        </tr>
      `;
    });
  }

  // 2. Teams Ranking
  const tBody = document.getElementById('ranking-teams-body');
  if (teamsRank.length === 0) {
    tBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Nenhum dado registrado no período.</td></tr>';
  } else {
    tBody.innerHTML = '';
    teamsRank.forEach((item, index) => {
      const positionClass = index === 0 ? 'rank-1' : (index === 1 ? 'rank-2' : (index === 2 ? 'rank-3' : 'rank-other'));
      const positionLabel = index + 1;
      
      tBody.innerHTML += `
        <tr>
          <td><span class="rank-badge ${positionClass}">${positionLabel}</span></td>
          <td style="font-weight: 500;">${item.team_name}</td>
          <td class="text-center">${item.leads_totais - item.inviaveis}</td>
          <td class="text-center text-cyan">${item.fechados}</td>
          <td class="text-right text-emerald">${item.conversao_reajustada.toFixed(2)}%</td>
        </tr>
      `;
    });
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
    const grid = await fetch(`/api/records?date=${date}&consultant_id=${consultantId}`).then(r => r.json());
    
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
    if (fechados > aproveitaveis) {
      hasValidationErrors = true;
      validationMsgText = "Vendas fechadas não podem ser maiores do que os leads aproveitáveis.";
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
    const res = await fetch('/api/records', {
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

// ----------------------------------------
// MANAGEMENT / SETTINGS MODULE
// ----------------------------------------

function renderSettingsLists() {
  // Render teams list
  const listT = document.getElementById('list-teams');
  listT.innerHTML = '';
  teams.forEach(team => {
    listT.innerHTML += `
      <li class="settings-list-item">
        <span>${team.name}</span>
        <button class="btn-icon-delete" onclick="deleteTeam(${team.id})" title="Remover equipe">
          <i data-lucide="trash-2"></i>
        </button>
      </li>
    `;
  });

  // Render consultants list
  const listC = document.getElementById('list-consultants');
  listC.innerHTML = '';
  consultants.forEach(c => {
    listC.innerHTML += `
      <li class="settings-list-item">
        <div>
          <span>${c.name}</span>
          <small class="item-sub">Equipe: ${c.team_name}</small>
        </div>
        <button class="btn-icon-delete" onclick="deleteConsultant(${c.id})" title="Remover consultor">
          <i data-lucide="trash-2"></i>
        </button>
      </li>
    `;
  });

  // Render channels list with toggle switch
  const listCh = document.getElementById('list-channels');
  listCh.innerHTML = '';
  channels.forEach(ch => {
    listCh.innerHTML += `
      <li class="settings-list-item">
        <span>${ch.name}</span>
        <div class="list-item-actions">
          <label class="switch">
            <input type="checkbox" ${ch.active ? 'checked' : ''} onchange="toggleChannel(${ch.id}, this.checked)">
            <span class="slider"></span>
          </label>
          <button class="btn-icon-delete" onclick="deleteChannel(${ch.id})" title="Remover canal">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </li>
    `;
  });

  // Render systems list
  const listSys = document.getElementById('list-systems');
  if (listSys) {
    listSys.innerHTML = '';
    systems.forEach(sys => {
      listSys.innerHTML += `
        <li class="settings-list-item">
          <span>${sys.name}</span>
          <button class="btn-icon-delete" onclick="deleteSystem(${sys.id})" title="Remover sistema">
            <i data-lucide="trash-2"></i>
          </button>
        </li>
      `;
    });
  }

  // Render convenios list
  const listCv = document.getElementById('list-convenios');
  if (listCv) {
    listCv.innerHTML = '';
    convenios.forEach(cv => {
      listCv.innerHTML += `
        <li class="settings-list-item">
          <span>${cv.name}</span>
          <button class="btn-icon-delete" onclick="deleteConvenio(${cv.id})" title="Remover convênio">
            <i data-lucide="trash-2"></i>
          </button>
        </li>
      `;
    });
  }

  // Render produtos list
  const listPd = document.getElementById('list-produtos');
  if (listPd) {
    listPd.innerHTML = '';
    produtos.forEach(pd => {
      listPd.innerHTML += `
        <li class="settings-list-item">
          <span>${pd.name}</span>
          <button class="btn-icon-delete" onclick="deleteProduto(${pd.id})" title="Remover produto">
            <i data-lucide="trash-2"></i>
          </button>
        </li>
      `;
    });
  }

  lucide.createIcons();
}

async function addTeam(e) {
  e.preventDefault();
  const input = document.getElementById('team-name');
  const name = input.value;
  if (!name.trim()) return;

  try {
    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(`Equipe "${res.name}" cadastrada!`, "success");
      input.value = '';
      await loadCoreData(); // reload
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao salvar equipe.", "error");
    console.error(err);
  }
}

async function deleteTeam(id) {
  if (!confirm("Tem certeza que deseja excluir esta equipe? Todos os consultores e lançamentos associados serão removidos permanentemente!")) {
    return;
  }
  try {
    const res = await fetch(`/api/teams/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(res.message, "success");
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao remover equipe.", "error");
    console.error(err);
  }
}

async function addConsultant(e) {
  e.preventDefault();
  const nameInput = document.getElementById('consultant-name');
  const teamSelect = document.getElementById('consultant-team-id');
  
  const name = nameInput.value;
  const team_id = teamSelect.value;

  if (!name.trim() || !team_id) return;

  try {
    const res = await fetch('/api/consultants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, team_id: parseInt(team_id, 10) })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(`Consultor "${res.name}" cadastrado!`, "success");
      nameInput.value = '';
      teamSelect.value = '';
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao cadastrar consultor.", "error");
    console.error(err);
  }
}

async function deleteConsultant(id) {
  if (!confirm("Tem certeza que deseja excluir este consultor? Seus históricos de lançamentos também serão removidos!")) {
    return;
  }
  try {
    const res = await fetch(`/api/consultants/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(res.message, "success");
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao remover consultor.", "error");
    console.error(err);
  }
}

async function addChannel(e) {
  e.preventDefault();
  const input = document.getElementById('channel-name');
  const name = input.value;
  if (!name.trim()) return;

  try {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(`Canal "${res.name}" cadastrado!`, "success");
      input.value = '';
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao cadastrar canal.", "error");
    console.error(err);
  }
}

async function toggleChannel(id, active) {
  try {
    const res = await fetch(`/api/channels/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: active ? 1 : 0 })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      // Quiet reload of core data to update local active states
      const resChannels = await fetch('/api/channels').then(r => r.json());
      channels = resChannels;
      showToast("Status do canal de venda atualizado!", "success");
    }
  } catch (err) {
    showToast("Erro ao alterar status do canal.", "error");
    console.error(err);
  }
}

async function deleteChannel(id) {
  if (!confirm("Deseja remover este canal de vendas permanentemente do banco?")) {
    return;
  }
  try {
    const res = await fetch(`/api/channels/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(res.message, "success");
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao remover canal de vendas.", "error");
    console.error(err);
  }
}

// Global functions attached to window for inline onclick attributes
window.deleteTeam = deleteTeam;
window.deleteConsultant = deleteConsultant;
window.deleteChannel = deleteChannel;
window.toggleChannel = toggleChannel;

async function addSystem(e) {
  e.preventDefault();
  const input = document.getElementById('system-name');
  const name = input.value;
  if (!name.trim()) return;

  try {
    const res = await fetch('/api/systems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(`Sistema "${res.name}" cadastrado!`, "success");
      input.value = '';
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao cadastrar sistema.", "error");
    console.error(err);
  }
}

async function deleteSystem(id) {
  if (!confirm("Deseja remover este sistema permanentemente do banco?")) return;
  try {
    const res = await fetch(`/api/systems/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(res.message, "success");
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao remover sistema.", "error");
    console.error(err);
  }
}

window.deleteSystem = deleteSystem;

async function addConvenio(e) {
  e.preventDefault();
  const input = document.getElementById('convenio-name');
  const name = input.value;
  if (!name.trim()) return;

  try {
    const res = await fetch('/api/convenios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    }).then(r => r.json());

    if (res.error) showToast(res.error, "error");
    else {
      showToast(`Convênio "${res.name}" cadastrado!`, "success");
      input.value = '';
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao cadastrar convênio.", "error");
  }
}

async function deleteConvenio(id) {
  if (!confirm("Deseja remover este convênio permanentemente?")) return;
  try {
    const res = await fetch(`/api/convenios/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.error) showToast(res.error, "error");
    else {
      showToast(res.message, "success");
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao remover convênio.", "error");
  }
}

async function addProduto(e) {
  e.preventDefault();
  const input = document.getElementById('produto-name');
  const name = input.value;
  if (!name.trim()) return;

  try {
    const res = await fetch('/api/produtos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    }).then(r => r.json());

    if (res.error) showToast(res.error, "error");
    else {
      showToast(`Produto "${res.name}" cadastrado!`, "success");
      input.value = '';
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao cadastrar produto.", "error");
  }
}

async function deleteProduto(id) {
  if (!confirm("Deseja remover este produto permanentemente?")) return;
  try {
    const res = await fetch(`/api/produtos/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (res.error) showToast(res.error, "error");
    else {
      showToast(res.message, "success");
      await loadCoreData();
      renderSettingsLists();
    }
  } catch (err) {
    showToast("Erro ao remover produto.", "error");
  }
}

window.deleteConvenio = deleteConvenio;
window.deleteProduto = deleteProduto;

// ----------------------------------------
// EVEN LISTENERS & ACTIONS SETUP
// ----------------------------------------

function setupEventListeners() {
  // Dashboard filter changes
  document.getElementById('filter-period').addEventListener('change', (e) => {
    const val = e.target.value;
    const customContainer = document.getElementById('custom-date-container');
    if (val === 'custom') {
      customContainer.classList.remove('hidden');
    } else {
      customContainer.classList.add('hidden');
      refreshDashboard();
    }
  });

  // Custom date updates trigger refresh
  document.getElementById('filter-start-date').addEventListener('change', refreshDashboard);
  document.getElementById('filter-end-date').addEventListener('change', refreshDashboard);

  // Filter team changes consultant choices
  document.getElementById('filter-team').addEventListener('change', () => {
    updateConsultantFilterOptions();
    refreshDashboard();
  });
  
  // Consultant filter triggers refresh
  document.getElementById('filter-consultant').addEventListener('change', refreshDashboard);

  // Sales channel filter triggers refresh
  document.getElementById('filter-channel').addEventListener('change', refreshDashboard);

  // Launches panel selection changes
  document.getElementById('launch-date').addEventListener('change', checkLaunchGridTrigger);
  document.getElementById('launch-team').addEventListener('change', () => {
    updateLaunchConsultantOptions();
    checkLaunchGridTrigger();
  });
  document.getElementById('launch-consultant').addEventListener('change', checkLaunchGridTrigger);

  // Save launches form submission
  document.getElementById('btn-save-launches').addEventListener('click', saveLaunches);

  // Records tab filters
  ['records-start-date', 'records-end-date', 'records-team', 'records-consultant', 'records-channel'].forEach(id => {
    document.getElementById(id).addEventListener('change', refreshRecentRecords);
  });

  // Settings Forms submit
  document.getElementById('form-team').addEventListener('submit', addTeam);
  document.getElementById('form-consultant').addEventListener('submit', addConsultant);
  document.getElementById('form-channel').addEventListener('submit', addChannel);
  
  const formSystem = document.getElementById('form-system');
  if (formSystem) formSystem.addEventListener('submit', addSystem);

  const formConvenio = document.getElementById('form-convenio');
  if (formConvenio) formConvenio.addEventListener('submit', addConvenio);

  const formProduto = document.getElementById('form-produto');
  if (formProduto) formProduto.addEventListener('submit', addProduto);

  const formLeadGen = document.getElementById('form-lead-generation');
  if (formLeadGen) formLeadGen.addEventListener('submit', saveLeadGeneration);
  
  const btnFilterLeadsDash = document.getElementById('btn-filter-leads-dash');
  if (btnFilterLeadsDash) btnFilterLeadsDash.addEventListener('click', refreshLeadsDashboard);
}

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
    const data = await fetch(url).then(r => r.json());
    
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

    const txInviaveis = prospectados > 0 ? (inviaveis / prospectados) * 100 : 0;
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
    const data = await fetch('/api/lead-generations').then(r => r.json());
    const tbody = document.querySelector('#leads-records-table tbody');
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">Nenhum registro encontrado.</td></tr>';
      return;
    }

    data.forEach(row => {
      // format date from YYYY-MM-DD string
      const dateParts = row.date.split('-');
      const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : row.date;
      
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
          <td class="text-right">R$ ${parseFloat(row.investimento).toFixed(2).replace('.',',')}</td>
          <td class="text-center text-emerald" style="font-weight: 500;">${row.fechamentos}</td>
          <td class="text-right text-cyan" style="font-weight: 500;">R$ ${parseFloat(row.faturamento).toFixed(2).replace('.',',')}</td>
          <td class="text-center">
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

  try {
    const res = await fetch('/api/lead-generations', {
      method: 'POST',
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
        faturamento: parseFloat(faturamento) || 0
      })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast("Registro salvo com sucesso!", "success");
      // reset forms except date
      document.getElementById('lead-channel').value = '';
      document.getElementById('lead-system').value = '';
      document.getElementById('lead-convenio').value = '';
      document.getElementById('lead-produto').value = '';
      document.getElementById('lead-prospectados').value = '0';
      document.getElementById('lead-aceites').value = '0';
      document.getElementById('lead-inviaveis').value = '0';
      document.getElementById('lead-investimento').value = '0.00';
      document.getElementById('lead-fechamentos').value = '0';
      document.getElementById('lead-faturamento').value = '0.00';
      refreshLeadsRecords();
    }
  } catch (err) {
    showToast("Erro ao salvar registro de leads.", "error");
    console.error(err);
  }
}

async function deleteLeadRecord(id) {
  if (!confirm("Deseja remover este registro permanentemente?")) return;
  try {
    const res = await fetch(`/api/lead-generations/${id}`, { method: 'DELETE' }).then(r => r.json());
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

// ----------------------------------------
// TOAST NOTIFICATIONS HELPER
// ----------------------------------------

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');

  toast.className = `toast ${type}`;
  toastMessage.textContent = message;

  // Icon adjustments based on type
  if (type === 'success') {
    toastIcon.setAttribute('data-lucide', 'check');
  } else if (type === 'error') {
    toastIcon.setAttribute('data-lucide', 'alert-triangle');
  } else {
    toastIcon.setAttribute('data-lucide', 'info');
  }
  lucide.createIcons();

  toast.classList.remove('hidden');

  // Fade out timer
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}
