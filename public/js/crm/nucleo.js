// CRM: estado, API, tempo real, navegação e utilitários

/**
 * MÓDULO CRM & KANBAN - FRONTEND CLIENT
 */

// Estado global do CRM
const CrmState = {
  selectedClientId: null,
  estagios: [],
  sdrLeads: [],
  closerLeads: [],
  eventSource: null,
  show15PercentBoard: {},
  show15PercentColumns: {},
  selectedUsers: {},
  usersList: []
};

// Helper de requisição autenticada com parse de JSON automático
async function apiFetch(url, options = {}) {
  try {
    const res = await fetchWithAuth(url, options);
    if (!res || !res.ok) {
      const errData = res ? await res.json().catch(() => ({})) : {};
      return { error: errData.error || 'Erro na requisição' };
    }
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

// ----------------------------------------
// INICIALIZAÇÃO
// ----------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initCrmEvents();
  initRealtimeSSE();
  initCrmNavigation();
  initCrmSearch();
  initCrmAdminForms();
  initTabulacaoModalForm();
  initNewClientModalForm();
  initLeadDetailsForm();
});

// Indicador de conexão no rodapé da sidebar (reflete o estado real do tempo real)
function setServerStatus(state) {
  const tag = document.querySelector('.vps-tag');
  if (!tag) return;
  const label = { online: 'Conectado', reconnecting: 'Reconectando…', offline: 'Sem conexão' }[state] || 'Conectando…';
  tag.dataset.state = state;
  tag.setAttribute('role', 'status');
  const textNode = Array.from(tag.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
  if (textNode) textNode.textContent = ' ' + label;
  else tag.appendChild(document.createTextNode(' ' + label));
}

// Configurar o EventSource para escutar o servidor em Realtime (SSE)
function initRealtimeSSE() {
  if (CrmState.eventSource) return;

  try {
    CrmState.eventSource = new EventSource('/api/crm/events');
    setServerStatus('connecting');
    CrmState.eventSource.onopen = () => setServerStatus('online');
    
    CrmState.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleRealtimeEvent(data);
      } catch (err) {
        console.error('Erro ao processar evento SSE:', err);
      }
    };

    CrmState.eventSource.onerror = (err) => {
      console.warn('Conexão SSE oscilou, tentando reconectar...', err);
      const es = CrmState.eventSource;
      setServerStatus(es && es.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
    };
  } catch (err) {
    console.error('SSE não suportado pelo navegador:', err);
  }
}

// Trata eventos recebidos do servidor ao vivo
function handleRealtimeEvent(data) {
  const currentUser = typeof getUser === 'function' ? getUser() : null;
  const currentUserId = currentUser ? parseInt(currentUser.id, 10) : null;
  const isAdmin = currentUser && currentUser.role === 'admin';

  if (data.type === 'LEAD_NOVO') {
    const lead = data.payload;

    const isCloserDoLead = lead.closer_id && currentUserId && currentUserId === parseInt(lead.closer_id, 10);
    const isSdrDoLead = lead.sdr_id && currentUserId && currentUserId === parseInt(lead.sdr_id, 10);
    const deveNotificar = isAdmin || isCloserDoLead || isSdrDoLead;

    if (deveNotificar) {
      if (typeof showToast === 'function') {
        showToast(`⚡ Novo Lead recebido: ${lead.cliente_nome || 'Cliente'}`, 'info');
      }

      // Tocar beep apenas para o closer que precisa aceitar
      if (isCloserDoLead && lead.status_atendimento === 'pendente_aceite') {
        playAlertAudio();
      }
    }

    const userPerms = typeof getPermissions === 'function' ? getPermissions() : null;
    const canSdr = !userPerms || userPerms.nav.includes('crm-kanban-sdr');
    const canCloser = !userPerms || userPerms.nav.includes('crm-kanban-closer');

    if (canSdr) loadKanbanBoard('sdr');
    if (canCloser) loadKanbanBoard('closer');
  } else if (data.type === 'LEAD_MOVIDO' || data.type === 'LEAD_ACEITO' || data.type === 'TABULACAO_NOVA' || data.type === 'LEADS_REMOVIDOS') {
    const userPerms = typeof getPermissions === 'function' ? getPermissions() : null;
    const canSdr = !userPerms || userPerms.nav.includes('crm-kanban-sdr');
    const canCloser = !userPerms || userPerms.nav.includes('crm-kanban-closer');

    if (canSdr) loadKanbanBoard('sdr');
    if (canCloser) loadKanbanBoard('closer');
    if (CrmState.selectedClientId) {
      loadClientDetails(CrmState.selectedClientId);
    }
  }
}

// Tocar bip sonoro de alerta para o consultor
function playAlertAudio() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // Ignorar falha de áudio se política de autostart bloquear
  }
}

// ----------------------------------------
// NAVEGAÇÃO DE SEÇÕES CRM
// ----------------------------------------
function initCrmNavigation() {
  window.addEventListener('hashchange', handleCrmHashChange);
  handleCrmHashChange();
}

function handleCrmHashChange() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  
  if (hash === 'crm-clientes') {
    // Busca pronta
  } else if (hash === 'crm-kanban-sdr') {
    loadKanbanBoard('sdr');
  } else if (hash === 'crm-kanban-closer') {
    loadKanbanBoard('closer');
  } else if (hash === 'crm-admin') {
    loadCrmAdminData();
  }
}

function debounce(fn, wait = 120) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

function initCrmEvents() {
  const debouncedFilterSdr = debounce(() => filterKanbanCards('sdr'), 120);
  const debouncedFilterCloser = debounce(() => filterKanbanCards('closer'), 120);

  document.getElementById('sdr-kanban-filter-user')?.addEventListener('change', () => filterKanbanCards('sdr'));
  document.getElementById('sdr-kanban-filter-estagio')?.addEventListener('change', () => filterKanbanCards('sdr'));
  document.getElementById('sdr-kanban-search')?.addEventListener('input', debouncedFilterSdr);

  document.getElementById('closer-kanban-filter-user')?.addEventListener('change', () => filterKanbanCards('closer'));
  document.getElementById('closer-kanban-filter-sdr')?.addEventListener('change', () => filterKanbanCards('closer'));
  document.getElementById('closer-kanban-filter-estagio')?.addEventListener('change', () => filterKanbanCards('closer'));
  document.getElementById('closer-kanban-search')?.addEventListener('input', debouncedFilterCloser);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-multiselect')) closeAllMultiSelects(null);
  });
  // Painel flutuante (position: fixed): acompanha o gatilho em rolagem/redimensionamento
  const repositionOpenMultiSelects = () => {
    document.querySelectorAll('.custom-multiselect-menu:not(.hidden)').forEach(positionMultiSelectMenu);
  };
  window.addEventListener('resize', repositionOpenMultiSelects);
  window.addEventListener('scroll', (e) => {
    if (e.target && e.target.closest && e.target.closest('.custom-multiselect-menu')) return;
    repositionOpenMultiSelects();
  }, true);

  setupKanbanDateFilter('sdr');
  setupKanbanDateFilter('closer');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateString(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleString('pt-BR');
}

function formatTimeAgo(isoString) {
  if (!isoString) return '';
  const diffSec = Math.round((new Date().getTime() - new Date(isoString).getTime()) / 1000);
  if (diffSec <= 0) return 'agora';
  if (diffSec < 60) return `${diffSec}s atrás`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m atrás`;
  const diffHours = Math.floor(diffSec / 3600);
  if (diffHours < 48) return `${diffHours}h atrás`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d atrás`;
}

function formatShortDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}`;
}

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCpf(cpf) {
  if (!cpf) return '';
  let digits = String(cpf).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 11) {
    digits = digits.padStart(11, '0');
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return cpf;
}

function showConfirmModal({ title, text, onConfirm }) {
  // Remover modal de confirmação anterior, se houver
  const existing = document.getElementById('custom-confirm-modal');
  if (existing) existing.remove();

  // Criar o backdrop do modal
  const backdrop = document.createElement('div');
  backdrop.id = 'custom-confirm-modal';
  backdrop.style.position = 'fixed';
  backdrop.style.inset = '0';
  backdrop.style.background = 'rgba(0, 0, 0, 0.75)';
  backdrop.style.backdropFilter = 'blur(4px)';
  backdrop.style.display = 'flex';
  backdrop.style.alignItems = 'center';
  backdrop.style.justifyContent = 'center';
  backdrop.style.zIndex = '100000'; // Maior que os outros modals

  // Criar o card do modal
  const card = document.createElement('div');
  card.className = 'card form-card';
  card.style.width = '420px';
  card.style.maxWidth = '90vw';
  card.style.background = '#1b1e2e';
  card.style.border = '1px solid rgba(255, 255, 255, 0.15)';
  card.style.borderRadius = '12px';
  card.style.padding = '20px';
  card.style.boxShadow = '0 20px 50px rgba(0,0,0,0.6)';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.gap = '16px';
  card.style.color = '#fff';

  // Conteúdo do modal
  card.innerHTML = `
    <div style="display: flex; gap: 12px; align-items: flex-start;">
      <div style="background: rgba(239, 68, 68, 0.15); border-radius: 50%; padding: 10px; display: inline-flex; align-items: center; justify-content: center; color: #EF4444; flex-shrink: 0;">
        <i data-lucide="alert-triangle" style="width: 24px; height: 24px;"></i>
      </div>
      <div style="flex: 1;">
        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #fff;">${title}</h3>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.5;">${text}</p>
      </div>
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;">
      <button id="custom-confirm-cancel" type="button" class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px; height: auto;">Cancelar</button>
      <button id="custom-confirm-ok" type="button" class="btn btn-danger" style="font-size: 12px; padding: 6px 12px; height: auto; background: #EF4444; border-color: #EF4444; color: #fff;">Excluir</button>
    </div>
  `;

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  // Inicializar ícone lucide
  if (window.lucide) {
    window.lucide.createIcons({
      attrs: {
        class: 'lucide'
      },
      nameAttr: 'data-lucide',
      nodes: card.querySelectorAll('[data-lucide]')
    });
  }

  // Eventos de clique
  const close = () => backdrop.remove();

  backdrop.querySelector('#custom-confirm-cancel').onclick = close;
  backdrop.querySelector('#custom-confirm-ok').onclick = () => {
    close();
    if (onConfirm) onConfirm();
  };

  // Fechar ao clicar fora
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
}
