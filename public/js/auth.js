// ==========================================================================
// auth.js — Frontend Authentication Helper
// Gerencia token JWT, dados do usuário e permissões de acesso (RBAC)
// ==========================================================================

const AUTH_TOKEN_KEY = 'lf_auth_token';
const AUTH_USER_KEY  = 'lf_auth_user';

// ----------------------------------------
// Definição de permissões por role
// ----------------------------------------
const ROLE_PERMISSIONS = {
  admin: {
    nav: ['dashboard', 'launches', 'records', 'settings', 'leads-dashboard', 'leads-records', 'users'],
    canManageSettings: true,
    canViewAllTeams: true,
    canAccessLeads: true,
    canAccessAtendimento: true,
    canManageUsers: true
  },
  supervisor: {
    nav: ['dashboard', 'launches', 'records'],
    canManageSettings: false,
    canViewAllTeams: false,
    canAccessLeads: false,
    canAccessAtendimento: true,
    canManageUsers: false
  },
  leads: {
    nav: ['leads-dashboard', 'leads-records'],
    canManageSettings: false,
    canViewAllTeams: false,
    canAccessLeads: true,
    canAccessAtendimento: false,
    canManageUsers: false
  }
};

// ----------------------------------------
// Funções de Token e Usuário
// ----------------------------------------

function saveAuth(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USER_KEY));
  } catch {
    return null;
  }
}

function getPermissions() {
  const user = getUser();
  if (!user || !user.role) return null;
  return ROLE_PERMISSIONS[user.role] || null;
}

function isAuthenticated() {
  const token = getToken();
  const user = getUser();
  if (!token || !user) return false;

  // Verificação básica de expiração do JWT (sem lib)
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      logout(false);
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

function logout(redirect = true) {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  if (redirect) {
    window.location.href = '/login.html';
  }
}

// ----------------------------------------
// Fetch com Authorization Header automático
// Intercepta 401/403 e redireciona se necessário
// ----------------------------------------
async function fetchWithAuth(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const data = await response.json().catch(() => ({}));
    logout(true);
    throw new Error(data.error || 'Sessão expirada.');
  }

  if (response.status === 403) {
    throw new Error('Acesso negado. Você não tem permissão para esta ação.');
  }

  return response;
}

// ----------------------------------------
// Guard de rota — chame no topo do app principal
// ----------------------------------------
function requireAuthGuard() {
  if (!isAuthenticated()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

// ----------------------------------------
// Rótulos em português para os roles
// ----------------------------------------
const ROLE_LABELS = {
  admin: 'Administrador',
  supervisor: 'Supervisor de Equipe',
  leads: 'Geração de Leads'
};

function getRoleLabel(role) {
  return ROLE_LABELS[role] || role;
}
