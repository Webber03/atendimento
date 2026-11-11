// ----------------------------------------
// KANBAN: teclado e altura do quadro
// - Setas navegam entre cards (↑↓ na coluna, ←→ entre colunas)
// - "/" foca a busca do quadro visível; Esc na busca limpa
// - Enter/Espaço/Esc nos filtros de seleção múltipla
// - O quadro ocupa a altura restante da janela
// ----------------------------------------
(function () {
  const BOARDS = ['sdr', 'closer'];

  function isVisible(el) {
    return !!el && el.offsetParent !== null;
  }

  function visibleBoard() {
    for (const t of BOARDS) {
      const board = document.getElementById(`${t}-kanban-board`);
      if (isVisible(board)) return { tipo: t, board };
    }
    return null;
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  // ---- Altura do quadro ----
  function fitBoards() {
    const vb = visibleBoard();
    if (!vb) return;
    if (window.matchMedia('(max-width: 768px)').matches) {
      vb.board.style.height = '';
      return;
    }
    const top = vb.board.getBoundingClientRect().top + window.scrollY;
    const main = vb.board.closest('.main-content');
    const padBottom = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
    const h = Math.max(420, Math.floor(window.innerHeight - top - padBottom - 4));
    vb.board.style.height = `${h}px`;
  }

  // ---- Navegação por setas entre cards ----
  function cardsOf(column) {
    return Array.from(column.querySelectorAll('.kanban-card')).filter(isVisible);
  }

  function moveFocus(card, key) {
    const column = card.closest('.kanban-column');
    const board = card.closest('.kanban-board-container');
    if (!column || !board) return;

    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const list = cardsOf(column);
      const i = list.indexOf(card);
      const next = list[i + (key === 'ArrowDown' ? 1 : -1)];
      if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
      return;
    }

    const columns = Array.from(board.querySelectorAll('.kanban-column')).filter(isVisible);
    let ci = columns.indexOf(column);
    const step = key === 'ArrowRight' ? 1 : -1;
    const rowIndex = cardsOf(column).indexOf(card);
    for (ci += step; ci >= 0 && ci < columns.length; ci += step) {
      const list = cardsOf(columns[ci]);
      if (list.length) {
        const target = list[Math.min(rowIndex, list.length - 1)];
        target.focus();
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }
    }
  }

  document.addEventListener('keydown', (e) => {
    const el = e.target;

    // Cards: setas
    if (el.classList && el.classList.contains('kanban-card') &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      moveFocus(el, e.key);
      return;
    }

    // Seleção múltipla: Enter/Espaço ativam; Esc fecha
    if (el.classList && (el.classList.contains('custom-multiselect-trigger') || el.classList.contains('custom-multiselect-item'))) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const menu = el.closest('.custom-multiselect')?.querySelector('.custom-multiselect-menu');
        if (menu && !menu.classList.contains('hidden')) {
          e.preventDefault();
          const items = Array.from(menu.querySelectorAll('.custom-multiselect-item'));
          const i = items.indexOf(el);
          const next = items[i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)];
          if (next) next.focus();
        }
        return;
      }
    }
    if (e.key === 'Escape') {
      const wrap = el.closest && el.closest('.custom-multiselect');
      if (wrap) {
        const menu = wrap.querySelector('.custom-multiselect-menu');
        const trigger = wrap.querySelector('.custom-multiselect-trigger');
        if (menu && !menu.classList.contains('hidden')) {
          menu.classList.add('hidden');
          if (trigger) {
            trigger.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.focus();
          }
          e.stopPropagation();
          return;
        }
      }
      // Esc na busca do Kanban limpa o texto
      if (el.id === 'sdr-kanban-search' || el.id === 'closer-kanban-search') {
        if (el.value) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          e.stopPropagation();
        }
        return;
      }
    }

    // "/" foca a busca do quadro visível
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(el)) {
      const vb = visibleBoard();
      if (!vb) return;
      if (document.querySelector('.modal-backdrop:not(.hidden)')) return;
      const search = document.getElementById(`${vb.tipo}-kanban-search`);
      if (search) {
        e.preventDefault();
        search.focus();
        search.select();
      }
    }
  });

  // Mantém aria-expanded coerente quando o menu fecha por clique fora
  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-multiselect-trigger[aria-expanded="true"]').forEach(t => {
      if (!t.classList.contains('open')) t.setAttribute('aria-expanded', 'false');
    });
  });

  function init() {
    window.addEventListener('resize', fitBoards);
    BOARDS.forEach(t => {
      const section = document.getElementById(`view-crm-kanban-${t}`);
      if (section) {
        new MutationObserver(() => requestAnimationFrame(fitBoards))
          .observe(section, { attributes: true, attributeFilter: ['class'] });
        const toolbar = section.querySelector('.kanban-toolbar');
        if (toolbar && 'ResizeObserver' in window) new ResizeObserver(() => fitBoards()).observe(toolbar);
      }
    });
    fitBoards();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
