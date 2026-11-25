// Menu e troca de telas

// ----------------------------------------
// ROUTER & NAVIGATION
// ----------------------------------------

function setupNavigation() {
  const tabs = [
    { navId: 'nav-dashboard', viewId: 'view-dashboard', name: 'Dashboard Analítico', subtitle: 'Acompanhamento comercial em tempo real' },
    { navId: 'nav-launches', viewId: 'view-launches', name: 'Lançamentos Diários', subtitle: 'Preenchimento e envio de métricas de consultores' },
    { navId: 'nav-records', viewId: 'view-records', name: 'Registros', subtitle: 'Consulta rápida dos últimos lançamentos' },
    { navId: 'nav-settings', viewId: 'view-settings', name: 'Cadastros & Configurações', subtitle: 'Gerenciamento de equipes, consultores e canais de venda' },
    { navId: 'nav-users', viewId: 'view-users', name: 'Usuários & Acessos', subtitle: 'Gerencie contas e níveis de permissão' },
    { navId: 'nav-crm-clientes', viewId: 'view-crm-clientes', name: 'Busca & Tabulação de Clientes', subtitle: 'Localização de cadastros e histórico completo de atendimentos' },
    { navId: 'nav-crm-kanban-sdr', viewId: 'view-crm-kanban-sdr', name: 'Kanban SDR | Comercial', subtitle: 'Funil de qualificação e contatos iniciais' },
    { navId: 'nav-crm-kanban-closer', viewId: 'view-crm-kanban-closer', name: 'Kanban Consultor | Closer', subtitle: 'Gestão de negociações, consultoria e fechamentos com alerta de SLA' },
    { navId: 'nav-crm-relatorios', viewId: 'view-crm-relatorios', name: 'Relatórios CRM Analíticos', subtitle: 'Perdas, prospecções, conversão e passagens do SDR ao Closer' },
    { navId: 'nav-crm-admin', viewId: 'view-crm-admin', name: 'Admin CRM & Fila de Closers', subtitle: 'Configuração dinâmica de colunas, pesos da fila e discadora' },
    { navId: 'nav-leads-dashboard', viewId: 'view-leads-dashboard', name: 'Dashboard de Leads', subtitle: 'Visão gerencial e ROI da Geração de Leads' },
    { navId: 'nav-leads-records', viewId: 'view-leads-records', name: 'Geração de Leads', subtitle: 'Controle de performance da Geração de Leads' },
    { navId: 'nav-contratos-listas', viewId: 'view-contratos-listas', name: 'Listas & Status', subtitle: 'Bancos, produtos, tabelas, tipos, parceiros e status dos contratos' }
  ];

  const perms = getPermissions();
  const allowedSections = perms ? perms.nav : [];

  tabs.forEach(tab => {
    const section = tab.navId.replace('nav-', '');
    const el = document.getElementById(tab.navId);
    if (!el) return;

    if (!allowedSections.includes(section)) {
      el.style.display = 'none'; // Hide nav items user can't access
      return;
    }

    el.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionName = section;
      // Guard: double-check permission before switching
      if (!allowedSections.includes(sectionName)) {
        showToast('Você não tem permissão para acessar esta seção.', 'error');
        return;
      }
      switchTab(sectionName);
    });
  });
}

function switchTab(tabName) {
  const perms = getPermissions();
  // Security guard: block navigation to unauthorized sections
  if (perms && !perms.nav.includes(tabName)) {
    showToast('Acesso negado a esta seção.', 'error');
    return;
  }

  activeTab = tabName;
  
  // Update sidebar active classes
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById(`nav-${tabName}`);
  if (navEl) navEl.classList.add('active');

  // Show/Hide views
  document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
  const viewEl = document.getElementById(`view-${tabName}`);
  if (viewEl) viewEl.classList.remove('hidden');

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
    initProgestorStatusMappingForm();
  } else if (tabName === 'crm-clientes') {
    headerTitle.textContent = 'Busca & Tabulação de Clientes';
    headerSubtitle.textContent = 'Localização de cadastros e histórico completo de atendimentos';
  } else if (tabName === 'crm-kanban-sdr') {
    headerTitle.textContent = 'Kanban SDR | Comercial';
    headerSubtitle.textContent = 'Funil de qualificação e contatos iniciais';
    if (typeof loadKanbanBoard === 'function') loadKanbanBoard('sdr');
  } else if (tabName === 'crm-kanban-closer') {
    headerTitle.textContent = 'Kanban Consultor | Closer';
    headerSubtitle.textContent = 'Gestão de negociações, consultoria e fechamentos com alerta de SLA';
    if (typeof loadKanbanBoard === 'function') loadKanbanBoard('closer');
  } else if (tabName === 'crm-relatorios') {
    headerTitle.textContent = 'Relatórios & Inteligência CRM';
    headerSubtitle.textContent = 'Perdas, prospecções, conversão e passagens do SDR ao Closer';
    if (typeof initCrmRelatorios === 'function') initCrmRelatorios();
  } else if (tabName === 'crm-admin') {
    headerTitle.textContent = 'Admin CRM & Fila de Closers';
    headerSubtitle.textContent = 'Configuração dinâmica de colunas, pesos da fila e discadora';
    if (typeof loadCrmAdminData === 'function') loadCrmAdminData();
  } else if (tabName === 'users') {
    headerTitle.textContent = 'Usuários & Acessos';
    headerSubtitle.textContent = 'Gerencie contas e níveis de permissão';
    loadUsersTable();
  } else if (tabName === 'leads-dashboard') {
    headerTitle.textContent = 'Dashboard Geração de Leads';
    headerSubtitle.textContent = 'Visão gerencial, eficiência e ROI';
    refreshLeadsDashboard();
  } else if (tabName === 'leads-records') {
    headerTitle.textContent = 'Registro de Leads e Resultados';
    headerSubtitle.textContent = 'Lance os resultados diários da operação';
    refreshLeadsRecords();
  } else if (tabName === 'contratos-listas') {
    headerTitle.textContent = 'Listas & Status';
    headerSubtitle.textContent = 'Bancos, produtos, tabelas, tipos, parceiros e status dos contratos';
    if (typeof carregarListasContratos === 'function') carregarListasContratos();
  }
}
