// ----------------------------------------
// SIDEBAR: grupos recolhíveis (um aberto por vez)
// - Abre automaticamente o grupo da página ativa
// - Esconde grupos sem nenhum item permitido para o perfil
// - Lembra o último grupo aberto (por navegador)
// ----------------------------------------
(function () {
  const STORAGE_KEY = 'lf.sidebar.openGroup';

  function groups() {
    return Array.from(document.querySelectorAll('.sidebar-nav .nav-group'));
  }

  function setOpen(group, open) {
    const btn = group.querySelector('.nav-group-toggle');
    group.classList.toggle('open', open);
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function openOnly(target, remember) {
    groups().forEach(g => setOpen(g, g === target));
    if (remember) {
      try { localStorage.setItem(STORAGE_KEY, target ? target.dataset.group : ''); } catch (e) {}
    }
  }

  function isItemVisible(item) {
    return getComputedStyle(item).display !== 'none';
  }

  // Esconde o grupo inteiro se o perfil não tiver nenhum item dele
  function refreshVisibility() {
    groups().forEach(g => {
      const hasVisible = Array.from(g.querySelectorAll('.nav-item')).some(isItemVisible);
      g.classList.toggle('hidden', !hasVisible);
    });
  }

  // Marca o grupo que contém a página ativa e garante que ele esteja aberto
  function syncActive() {
    let activeGroup = null;
    groups().forEach(g => {
      const hasActive = !!g.querySelector('.nav-item.active');
      g.classList.toggle('has-active', hasActive);
      if (hasActive) activeGroup = g;
    });
    if (activeGroup && !activeGroup.classList.contains('open')) {
      openOnly(activeGroup, false);
    }
  }

  // ---- Menu lateral recolhível (celular/tablet) ----
  function setupDrawer() {
    const btn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!btn || !sidebar) return;

    const isOpen = () => document.body.classList.contains('sidebar-open');
    const setDrawer = (open) => {
      document.body.classList.toggle('sidebar-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
      if (backdrop) backdrop.hidden = !open;
      if (open) {
        const target = sidebar.querySelector('.nav-item.active') || sidebar.querySelector('.nav-group-toggle');
        if (target) target.focus({ preventScroll: true });
      }
    };

    btn.addEventListener('click', () => setDrawer(!isOpen()));
    if (backdrop) backdrop.addEventListener('click', () => { setDrawer(false); btn.focus(); });
    sidebar.addEventListener('click', (e) => {
      if (e.target.closest('.nav-item') && isOpen()) setDrawer(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) { setDrawer(false); btn.focus(); }
    });
    window.matchMedia('(min-width: 961px)').addEventListener('change', (mq) => { if (mq.matches) setDrawer(false); });
  }

  function init() {
    setupDrawer();
    const nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    groups().forEach(g => {
      const btn = g.querySelector('.nav-group-toggle');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const willOpen = !g.classList.contains('open');
        openOnly(willOpen ? g : null, true);
      });
    });

    refreshVisibility();

    // Estado inicial: grupo da página ativa > último grupo salvo > primeiro visível
    let initial = groups().find(g => g.querySelector('.nav-item.active'));
    if (!initial) {
      let saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
      initial = groups().find(g => g.dataset.group === saved && !g.classList.contains('hidden'));
    }
    if (!initial) initial = groups().find(g => !g.classList.contains('hidden'));
    if (initial) openOnly(initial, false);
    syncActive();

    // Reage quando o app troca de aba (classe .active) ou esconde itens por permissão (style)
    const observer = new MutationObserver(() => {
      refreshVisibility();
      syncActive();
    });
    nav.querySelectorAll('.nav-item').forEach(item => {
      observer.observe(item, { attributes: true, attributeFilter: ['class', 'style'] });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
