// Estado global, inicialização, perfis, datas e avisos (toast)

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

// Progestor Tabulations state
let progestorData = [];

let progestorFiltered = [];

let progestorCurrentPage = 1;

const progestorPageSize = 20;

// Chart.js instances
let evolutionChartInstance = null;

let channelChartInstance = null;

let chartProgEvolutionInstance = null;

let chartProgResultsInstance = null;

// Otimização global do Chart.js para carregamento rápido e fluidez em hardware modesto
if (typeof Chart !== 'undefined') {
  Chart.defaults.animation = {
    duration: 300,
    easing: 'easeOutQuart'
  };
  Chart.defaults.responsive = true;
  Chart.defaults.font.family = "'Montserrat', 'Segoe UI', sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#a1a1aa';
  Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.06)';
}

// Initialize the app on load
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  // 0. Guard: redirect to login if not authenticated
  if (!requireAuthGuard()) return;

  // 1. Setup user badge and apply role-based UI
  setupUserBadge();
  applyRoleUI();

  // 2. Register Tab Listeners
  setupNavigation();

  // 3. Navigate immediately to first allowed tab for user's role (avoids flashing admin dashboard)
  const perms = getPermissions();
  const firstTab = perms && perms.nav.length > 0 ? perms.nav[0] : 'dashboard';
  switchTab(firstTab);

  // 4. Initialize Lucide Icons
  lucide.createIcons();
  
  // 5. Set default dates
  setDefaultDates();

  // 6. Register Event Listeners for Filters & Forms
  setupEventListeners();

  // 7. Fetch initial core lists ONLY if the user actually has access to views using core data
  const needsCoreData = perms && perms.nav.some(t => ['dashboard', 'launches', 'records', 'settings'].includes(t));
  if (needsCoreData) {
    await loadCoreData();
  }
}

function setupUserBadge() {
  const user = getUser();
  if (user) {
    const usernameEl = document.getElementById('header-username');
    const roleEl = document.getElementById('header-role');
    if (usernameEl) usernameEl.textContent = (user.name || user.username).toUpperCase();
    if (roleEl) roleEl.textContent = getRoleLabel(user.role);
  }
}

function applyRoleUI() {
  const user = getUser();
  if (!user) return;

  const perms = getPermissions();
  if (!perms) return;

  // Se o usuário não puder ver todas as equipes (ex: supervisor), vamos travar/ocultar seletores de equipe
  if (!perms.canViewAllTeams && user.team_id) {
    const teamFilters = ['filter-team', 'launch-team', 'records-team'];
    teamFilters.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.value = user.team_id;
        el.disabled = true;
      }
    });
  }

  // Mostrar ou ocultar o divisor da sidebar
  const divider = document.querySelector('.sidebar-divider');
  if (divider) {
    const hasAtendimento = perms.nav.some(t => ['dashboard', 'launches', 'records'].includes(t));
    const hasLeads = perms.nav.some(t => ['leads-dashboard', 'leads-records'].includes(t));
    divider.style.display = (hasAtendimento && hasLeads) ? 'block' : 'none';
  }
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

// Format number as Brazilian currency (R$ 1.234,56)
function formatBRL(value) {
  const num = parseFloat(value) || 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

// Parse date from any format and return as YYYY-MM-DD
function parseDateString(dateStr) {
  if (!dateStr) return '';
  
  // Convert to string in case it's not
  dateStr = String(dateStr).trim();
  
  // If already in YYYY-MM-DD format, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // If ISO format with time (2026-07-10T00:00:00.000Z), extract date part
  if (dateStr.includes('T')) {
    return dateStr.split('T')[0];
  }
  
  // Try to parse as date and convert to YYYY-MM-DD
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {
    // Ignore
  }
  
  return dateStr;
}

// Format date YYYY-MM-DD to DD/MM/YYYY
function formatDateBR(dateStr) {
  const normalized = parseDateString(dateStr);
  if (!normalized) return '-';
  
  const parts = normalized.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return normalized;
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

  // Fade out timer (reinicia a cada aviso para o novo não sumir antes do tempo)
  if (window.__toastHideTimer) clearTimeout(window.__toastHideTimer);
  window.__toastHideTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}
