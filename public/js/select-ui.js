// ----------------------------------------
// LISTAS DE ESCOLHA ÚNICA (Etapa, Período, Critério de data...)
// Troca o visual do <select> nativo pelo mesmo painel da seleção de pessoas.
// O <select> continua no DOM (oculto) e é a fonte da verdade: o código existente
// lê/escreve .value e escuta "change" normalmente. Optgroups viram títulos de grupo.
// Busca por digitação aparece quando há mais de 8 opções.
// ----------------------------------------
(function () {
  const ALVOS = '.kanban-toolbar-filters select.form-input, .filter-grid select.form-input';
  const CHECK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SEARCH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const indexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  let aberto = null; // { select, trigger, menu }
  let seq = 0;

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function rotuloAtual(select) {
    const opt = select.options[select.selectedIndex];
    return opt ? opt.textContent.trim() : '';
  }

  function atualizarTrigger(select) {
    const ui = select._selUi;
    if (!ui) return;
    ui.label.textContent = rotuloAtual(select);
    ui.trigger.title = ui.label.textContent;
    ui.trigger.classList.toggle('sel-disabled', select.disabled);
    ui.trigger.setAttribute('aria-disabled', select.disabled ? 'true' : 'false');
    ui.trigger.tabIndex = select.disabled ? -1 : 0;
    ui.trigger.hidden = select.hidden;
    if (aberto && aberto.select === select) montarLista(select, false);
  }

  function montarLista(select, resetBusca) {
    const ui = select._selUi;
    const menu = ui.menu;
    const total = select.options.length;
    const comBusca = total > 8;
    const busca = menu.querySelector('.ms-search-input');
    const q = resetBusca || !busca ? '' : busca.value;
    const listId = `${ui.id}-list`;
    let html = '';
    if (comBusca) {
      html += `<div class="ms-search"><span class="ms-search-icon">${SEARCH_SVG}</span>` +
        `<input type="text" class="ms-search-input" placeholder="Buscar..." autocomplete="off" spellcheck="false" aria-label="Buscar opção" aria-controls="${listId}" value="${esc(q)}">` +
        `<button type="button" class="ms-search-clear" aria-label="Limpar busca"${q ? '' : ' hidden'}>&times;</button></div>`;
    }
    html += `<div class="ms-list sel-list" id="${listId}" role="listbox" aria-label="${esc(select.getAttribute('aria-label') || '')}">`;
    Array.from(select.children).forEach(node => {
      if (node.tagName === 'OPTGROUP') {
        html += `<div class="sel-group" role="presentation">${esc(node.label)}</div>`;
        Array.from(node.children).forEach(o => { html += itemHtml(select, o, true); });
      } else if (node.tagName === 'OPTION') {
        html += itemHtml(select, node, false);
      }
    });
    html += '<div class="ms-empty" hidden>Nenhuma opção encontrada</div></div>';
    menu.innerHTML = html;
    filtrar(menu);
    if (busca && !resetBusca) {
      const nova = menu.querySelector('.ms-search-input');
      if (nova && document.activeElement !== nova) { nova.focus(); nova.setSelectionRange(q.length, q.length); }
    }
  }

  function itemHtml(select, opt, emGrupo) {
    if (opt.hidden) return '';
    const sel = opt.selected;
    return `<div class="custom-multiselect-item sel-item${sel ? ' selected' : ''}${emGrupo ? ' sel-indent' : ''}${opt.disabled ? ' sel-disabled' : ''}"` +
      ` role="option" tabindex="-1" aria-selected="${sel}" data-index="${opt.index}" data-busca="${esc(norm(opt.textContent))}">` +
      `<span class="ms-name">${esc(opt.textContent.trim())}</span><span class="sel-check">${sel ? CHECK_SVG : ''}</span></div>`;
  }

  function filtrar(menu) {
    const input = menu.querySelector('.ms-search-input');
    const q = norm(input ? input.value : '');
    let visiveis = 0;
    menu.querySelectorAll('.sel-item').forEach(item => {
      const ok = !q || item.dataset.busca.includes(q);
      item.hidden = !ok;
      if (ok) visiveis++;
    });
    // Título do grupo some quando nenhum item do grupo sobra
    menu.querySelectorAll('.sel-group').forEach(g => {
      let n = g.nextElementSibling, algum = false;
      while (n && n.classList.contains('sel-item')) { if (!n.hidden) algum = true; n = n.nextElementSibling; }
      g.hidden = !algum;
    });
    const vazio = menu.querySelector('.ms-empty');
    if (vazio) vazio.hidden = visiveis > 0;
    const limpar = menu.querySelector('.ms-search-clear');
    if (limpar) limpar.hidden = !(input && input.value);
  }

  function itensVisiveis(menu) {
    return Array.from(menu.querySelectorAll('.sel-item')).filter(i => !i.hidden && !i.classList.contains('sel-disabled'));
  }

  function focar(menu, item) {
    if (!item) return;
    menu.querySelectorAll('.sel-item').forEach(i => { i.tabIndex = i === item ? 0 : -1; });
    item.focus();
    item.scrollIntoView({ block: 'nearest' });
  }

  function posicionar(trigger, menu) {
    const r = trigger.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const m = 8;
    const width = vw <= 600 ? vw - m * 2 : Math.min(Math.max(r.width, 260), 340, vw - m * 2);
    const left = Math.max(m, Math.min(r.left, vw - m - width));
    const below = vh - r.bottom - m - 4;
    const above = r.top - m - 4;
    const up = below < 220 && above > below;
    menu.style.width = `${width}px`;
    menu.style.left = `${left}px`;
    menu.style.maxHeight = `${Math.max(160, Math.min(360, up ? above : below))}px`;
    if (up) { menu.style.top = 'auto'; menu.style.bottom = `${vh - r.top + 4}px`; }
    else { menu.style.bottom = 'auto'; menu.style.top = `${r.bottom + 4}px`; }
  }

  function abrir(select) {
    if (select.disabled) return;
    if (aberto) fechar(false);
    // Fecha painéis de seleção de pessoas que estejam abertos
    document.querySelectorAll('.custom-multiselect-menu:not(.hidden):not(.sel-menu)').forEach(m => {
      const t = m.closest('.custom-multiselect')?.querySelector('.custom-multiselect-trigger');
      if (t && t.classList.contains('open')) t.click(); else m.classList.add('hidden');
    });
    const ui = select._selUi;
    montarLista(select, true);
    ui.menu.classList.remove('hidden');
    ui.trigger.classList.add('open');
    ui.trigger.setAttribute('aria-expanded', 'true');
    posicionar(ui.trigger, ui.menu);
    aberto = { select, trigger: ui.trigger, menu: ui.menu };
    const busca = ui.menu.querySelector('.ms-search-input');
    const atual = ui.menu.querySelector('.sel-item.selected') || itensVisiveis(ui.menu)[0];
    if (busca) { busca.focus(); if (atual) atual.scrollIntoView({ block: 'nearest' }); }
    else focar(ui.menu, atual);
  }

  function fechar(devolverFoco) {
    if (!aberto) return;
    const { trigger, menu } = aberto;
    menu.classList.add('hidden');
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    aberto = null;
    if (devolverFoco) trigger.focus();
  }

  function escolher(select, index) {
    const opt = select.options[index];
    if (!opt || opt.disabled) return;
    const mudou = select.selectedIndex !== index;
    indexDesc.set.call(select, index);
    atualizarTrigger(select);
    fechar(true);
    if (mudou) select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function aprimorar(select) {
    if (select._selUi || select.multiple) return;
    const id = `sel-ui-${++seq}`;
    const trigger = document.createElement('div');
    trigger.className = `custom-multiselect-trigger form-input sel-trigger ${select.className.replace(/\bform-input\b/, '')}`.trim();
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', id);
    const aria = select.getAttribute('aria-label') || (select.id && document.querySelector(`label[for="${select.id}"]`)?.textContent.trim()) || '';
    if (aria) trigger.setAttribute('aria-label', aria);
    trigger.innerHTML = '<span class="custom-multiselect-label"></span><span class="custom-multiselect-arrow"></span>';
    if (select.id) {
      trigger.id = `${select.id}-ui`;
      const lbl = document.querySelector(`label[for="${select.id}"]`);
      if (lbl) lbl.htmlFor = trigger.id;
    }

    const menu = document.createElement('div');
    menu.className = 'custom-multiselect-menu sel-menu hidden';
    menu.id = id;
    document.body.appendChild(menu);

    select.insertAdjacentElement('afterend', trigger);
    select.classList.add('sel-native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    select._selUi = { id, trigger, menu, label: trigger.querySelector('.custom-multiselect-label') };

    // Escritas por código em .value / .selectedIndex atualizam o rótulo
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() { return valueDesc.get.call(this); },
      set(v) { valueDesc.set.call(this, v); atualizarTrigger(this); }
    });
    Object.defineProperty(select, 'selectedIndex', {
      configurable: true,
      get() { return indexDesc.get.call(this); },
      set(v) { indexDesc.set.call(this, v); atualizarTrigger(this); }
    });
    // Opções reconstruídas (innerHTML), hidden/disabled alterados
    new MutationObserver(() => atualizarTrigger(select))
      .observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'selected'] });
    select.addEventListener('change', () => atualizarTrigger(select));

    trigger.addEventListener('click', () => {
      if (aberto && aberto.select === select) fechar(false); else abrir(select);
    });
    trigger.addEventListener('keydown', (e) => {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); abrir(select); }
    });

    menu.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.ms-search-input')) e.preventDefault(); // mantém o foco
    });
    menu.addEventListener('click', (e) => {
      if (e.target.closest('.ms-search-clear')) {
        const input = menu.querySelector('.ms-search-input');
        input.value = '';
        filtrar(menu);
        input.focus();
        return;
      }
      const item = e.target.closest('.sel-item');
      if (item && !item.classList.contains('sel-disabled')) escolher(select, Number(item.dataset.index));
    });
    menu.addEventListener('input', (e) => {
      if (e.target.classList.contains('ms-search-input')) filtrar(menu);
    });
    menu.addEventListener('keydown', (e) => {
      const itens = itensVisiveis(menu);
      const naBusca = e.target.classList.contains('ms-search-input');
      const i = itens.indexOf(e.target);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(true); }
      else if (e.key === 'Tab') { fechar(false); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); focar(menu, naBusca ? itens[0] : itens[Math.min(i + 1, itens.length - 1)]); }
      else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (i <= 0) { const b = menu.querySelector('.ms-search-input'); if (b) b.focus(); }
        else focar(menu, itens[i - 1]);
      }
      else if (e.key === 'Home' && !naBusca) { e.preventDefault(); focar(menu, itens[0]); }
      else if (e.key === 'End' && !naBusca) { e.preventDefault(); focar(menu, itens[itens.length - 1]); }
      else if (e.key === 'Enter' || (e.key === ' ' && !naBusca)) {
        e.preventDefault();
        const alvo = naBusca ? itens[0] : e.target.closest('.sel-item');
        if (alvo) escolher(select, Number(alvo.dataset.index));
      } else if (!naBusca && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const b = menu.querySelector('.ms-search-input');
        if (b) { b.focus(); }
        else {
          // Sem busca: pula para a próxima opção que começa com a letra
          const k = norm(e.key);
          const prox = itens.slice(i + 1).concat(itens.slice(0, i + 1)).find(it => it.dataset.busca.startsWith(k));
          if (prox) focar(menu, prox);
        }
      }
    });

    atualizarTrigger(select);
  }

  document.addEventListener('mousedown', (e) => {
    if (!aberto) return;
    if (aberto.menu.contains(e.target) || aberto.trigger.contains(e.target)) return;
    fechar(false);
  });
  window.addEventListener('resize', () => { if (aberto) posicionar(aberto.trigger, aberto.menu); });
  document.addEventListener('scroll', (e) => {
    if (!aberto || aberto.menu.contains(e.target)) return;
    if (!aberto.trigger.isConnected || aberto.trigger.offsetParent === null) { fechar(false); return; }
    posicionar(aberto.trigger, aberto.menu);
  }, true);

  function init() {
    document.querySelectorAll(ALVOS).forEach(aprimorar);
  }
  window.aprimorarSelect = aprimorar;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
