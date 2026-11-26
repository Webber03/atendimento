// Seleção múltipla de pessoas (com busca)

// ----------------------------------------
// SELEÇÃO MÚLTIPLA DE PESSOAS (Kanban SDR/Closer e Relatórios)
// Painel flutuante (position: fixed, não é cortado pelas barras de filtro) com busca,
// contador, "Selecionar todos/visíveis" / "Limpar" e lista role=listbox.
// Nenhum marcado ou todos marcados = sem filtro ("Todos os ...").
// opts (opcional, só Relatórios): { quickActions: true, entity: 'SDRs' } usa o rótulo "N de M SDRs"
// e "(não se aplica)" quando desabilitado pelo Funil. O Kanban não passa opts.
// ----------------------------------------
const MS_CHECK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const MS_SEARCH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function msNormalize(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function msInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(p => p && !/^(d[aeo]s?|e)$/i.test(p));
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Seleção efetiva para filtrar: todos marcados equivale a nenhum (sem filtro)
function msEffectiveSelection(filterId) {
  const sel = CrmState.selectedUsers?.[filterId] || [];
  const meta = CrmState.multiSelectMeta?.[filterId];
  if (meta && meta.total > 0 && sel.length >= meta.total) return [];
  return sel;
}

function msIsOpen(menu) {
  return !!menu && !menu.classList.contains('hidden');
}

function closeMultiSelect(wrapOrMenu, focusTrigger) {
  const wrap = wrapOrMenu?.closest ? wrapOrMenu.closest('.custom-multiselect') : null;
  if (!wrap) return;
  const menu = wrap.querySelector('.custom-multiselect-menu');
  const trigger = wrap.querySelector('.custom-multiselect-trigger');
  if (menu) menu.classList.add('hidden');
  if (trigger) {
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    if (focusTrigger) trigger.focus();
  }
}

function closeAllMultiSelects(except) {
  document.querySelectorAll('.custom-multiselect-menu').forEach(m => {
    if (m !== except && msIsOpen(m)) closeMultiSelect(m, false);
  });
}

// Posiciona o painel junto ao gatilho, dentro da janela (margem de 8px), abrindo para cima se faltar espaço
function positionMultiSelectMenu(menu) {
  const wrap = menu.closest('.custom-multiselect');
  const trigger = wrap?.querySelector('.custom-multiselect-trigger');
  if (!trigger) return;
  const r = trigger.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const margin = 8;
  // Celular: painel na largura da tela menos 8px de cada lado
  const width = vw <= 600 ? vw - margin * 2 : Math.min(Math.max(r.width, 304), 340, vw - margin * 2);
  let left = Math.min(r.left, vw - margin - width);
  left = Math.max(margin, left);
  const below = vh - r.bottom - margin - 4;
  const above = r.top - margin - 4;
  const openUp = below < 220 && above > below;
  const maxH = Math.max(160, Math.min(320, openUp ? above : below));
  menu.style.width = `${width}px`;
  menu.style.left = `${left}px`;
  menu.style.maxHeight = `${maxH}px`;
  if (openUp) {
    menu.style.top = 'auto';
    menu.style.bottom = `${vh - r.top + 4}px`;
  } else {
    menu.style.bottom = 'auto';
    menu.style.top = `${r.bottom + 4}px`;
  }
}

function msVisibleItems(menu) {
  return Array.from(menu.querySelectorAll('.custom-multiselect-item')).filter(i => !i.hidden);
}

function msFocusItem(menu, item) {
  if (!item) return;
  menu.querySelectorAll('.custom-multiselect-item').forEach(i => i.setAttribute('tabindex', i === item ? '0' : '-1'));
  item.focus();
  item.scrollIntoView({ block: 'nearest' });
}

function msApplySearch(menu) {
  const st = menu._ms;
  if (!st) return;
  const input = menu.querySelector('.ms-search-input');
  const raw = input ? input.value : '';
  const q = msNormalize(raw);
  let visible = 0;
  menu.querySelectorAll('.custom-multiselect-item').forEach(item => {
    const match = !q || item.dataset.search.includes(q);
    item.hidden = !match;
    if (match) visible++;
  });
  const empty = menu.querySelector('.ms-empty');
  if (empty) {
    empty.hidden = st.total === 0 ? false : visible > 0;
    empty.textContent = st.total === 0 ? 'Nenhuma pessoa disponível' : `Nenhum resultado para '${raw.trim()}'`;
  }
  const allBtn = menu.querySelector('.ms-action[data-action="all"]');
  if (allBtn) {
    allBtn.textContent = q ? 'Selecionar visíveis' : 'Selecionar todos';
    allBtn.disabled = visible === 0;
  }
  const clear = menu.querySelector('.ms-search-clear');
  if (clear) clear.hidden = !raw;
  // Mantém um item com tabindex=0 entre os visíveis (roving tabindex)
  const vis = msVisibleItems(menu);
  if (vis.length && !vis.some(i => i.getAttribute('tabindex') === '0')) {
    menu.querySelectorAll('.custom-multiselect-item').forEach(i => i.setAttribute('tabindex', '-1'));
    vis[0].setAttribute('tabindex', '0');
  }
}

function msUpdateCount(menu) {
  const st = menu._ms;
  const el = menu.querySelector('.ms-count');
  if (!st || !el) return;
  const n = (CrmState.selectedUsers[st.filterId] || []).length;
  el.textContent = (n === 0 || n >= st.total) ? 'Todos' : (n === 1 ? '1 selecionado' : `${n} selecionados`);
}

function openMultiSelect(menu, focusTarget) {
  const wrap = menu.closest('.custom-multiselect');
  const trigger = wrap?.querySelector('.custom-multiselect-trigger');
  if (!trigger || trigger.getAttribute('aria-disabled') === 'true') return;
  closeAllMultiSelects(menu);
  menu.classList.remove('hidden');
  trigger.classList.add('open');
  trigger.setAttribute('aria-expanded', 'true');
  positionMultiSelectMenu(menu);
  const list = menu.querySelector('.ms-list');
  if (list) list.scrollTop = 0;
  if (focusTarget === 'last') {
    const vis = msVisibleItems(menu);
    msFocusItem(menu, vis[vis.length - 1]);
  } else {
    const input = menu.querySelector('.ms-search-input');
    if (input) { input.focus(); input.select(); }
  }
}

// Eventos do painel: ligados uma única vez por menu; o estado atual fica em menu._ms
function bindMultiSelectMenu(menu, trigger) {
  if (menu.dataset.msBound) return;
  menu.dataset.msBound = 'true';
  const wrap = menu.closest('.custom-multiselect');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (trigger.getAttribute('aria-disabled') === 'true') return;
    if (msIsOpen(menu)) closeMultiSelect(menu, false);
    else openMultiSelect(menu);
  });

  trigger.addEventListener('keydown', (e) => {
    if (trigger.getAttribute('aria-disabled') === 'true') return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (msIsOpen(menu) && (e.key === 'Enter' || e.key === ' ')) { closeMultiSelect(menu, false); return; }
      openMultiSelect(menu, e.key === 'ArrowUp' ? 'last' : 'search');
    } else if (e.key === 'Escape' && msIsOpen(menu)) {
      e.preventDefault();
      e.stopPropagation();
      closeMultiSelect(menu, true);
    }
  });

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const st = menu._ms;
    if (!st) return;
    const clear = e.target.closest('.ms-search-clear');
    if (clear) {
      const input = menu.querySelector('.ms-search-input');
      input.value = '';
      msApplySearch(menu);
      input.focus();
      return;
    }
    const btn = e.target.closest('.ms-action');
    if (btn) {
      if (btn.dataset.action === 'all') {
        const visKeys = msVisibleItems(menu).map(i => i.dataset.key);
        const searching = !!msNormalize(menu.querySelector('.ms-search-input')?.value);
        const arr = searching
          ? Array.from(new Set([...(CrmState.selectedUsers[st.filterId] || []), ...visKeys]))
          : st.sortedUsers.map(([k]) => String(k));
        st.setSelection(arr);
      } else {
        st.setSelection([]);
      }
      return;
    }
    const item = e.target.closest('.custom-multiselect-item');
    if (item) {
      msFocusItem(menu, item);
      st.toggle(item.dataset.key);
    }
  });

  menu.addEventListener('input', (e) => {
    if (e.target.classList.contains('ms-search-input')) msApplySearch(menu);
  });

  menu.addEventListener('keydown', (e) => {
    const el = e.target;
    const st = menu._ms;
    if (!st) return;
    const input = menu.querySelector('.ms-search-input');
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (input && input.value) {
        input.value = '';
        msApplySearch(menu);
        input.focus();
      } else {
        closeMultiSelect(menu, true);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const vis = msVisibleItems(menu);
      if (!vis.length) return;
      e.preventDefault();
      const i = vis.indexOf(el);
      if (i < 0) {
        msFocusItem(menu, e.key === 'ArrowDown' ? vis[0] : vis[vis.length - 1]);
      } else if (e.key === 'ArrowUp' && i === 0) {
        if (input) input.focus();
      } else {
        msFocusItem(menu, vis[Math.min(vis.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))]);
      }
      return;
    }
    if ((e.key === 'Home' || e.key === 'End') && el.classList.contains('custom-multiselect-item')) {
      const vis = msVisibleItems(menu);
      e.preventDefault();
      msFocusItem(menu, e.key === 'Home' ? vis[0] : vis[vis.length - 1]);
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && el.classList.contains('custom-multiselect-item')) {
      e.preventDefault();
      st.toggle(el.dataset.key);
      return;
    }
    if (e.key === 'Enter' && el === input) {
      // Enter na busca: com um único resultado, marca/desmarca esse item
      e.preventDefault();
      const vis = msVisibleItems(menu);
      if (vis.length === 1) st.toggle(vis[0].dataset.key);
      else if (vis.length) msFocusItem(menu, vis[0]);
    }
  });

  // Tab para fora do painel fecha o menu (o foco segue a ordem natural)
  document.addEventListener('focusin', (e) => {
    if (msIsOpen(menu) && !wrap.contains(e.target)) closeMultiSelect(menu, false);
  });
}

function setupCustomMultiSelect(filterId, defaultLabel, userMap, pipelineTipo, isRestrict, currentUser, onSelectChange, opts) {
  const trigger = document.getElementById(`${filterId}-trigger`);
  const menu = document.getElementById(`${filterId}-menu`);
  const parentContainer = trigger?.closest('.custom-multiselect');

  if (!trigger || !menu) return;

  if (!CrmState.selectedUsers) CrmState.selectedUsers = {};
  if (!CrmState.selectedUsers[filterId]) CrmState.selectedUsers[filterId] = [];
  if (!CrmState.multiSelectMeta) CrmState.multiSelectMeta = {};
  const quick = !!(opts && opts.quickActions);

  if (isRestrict && currentUser) {
    if (parentContainer) parentContainer.style.display = 'none';
    CrmState.selectedUsers[filterId] = [String(currentUser.id)];
    // Travado no próprio usuário: nunca tratar como "todos selecionados"
    delete CrmState.multiSelectMeta[filterId];
    return;
  } else {
    if (parentContainer) parentContainer.style.display = '';
  }

  // Sort users alphabetically
  const sortedUsers = Array.from(userMap.entries()).sort((a, b) => {
    return a[1].toLowerCase().localeCompare(b[1].toLowerCase(), 'pt-BR');
  });

  // Keep only valid selections
  const validKeys = new Set(sortedUsers.map(([k]) => String(k)));
  CrmState.selectedUsers[filterId] = (CrmState.selectedUsers[filterId] || []).filter(id => validKeys.has(String(id)));

  const selectedSet = new Set(CrmState.selectedUsers[filterId].map(String));
  CrmState.multiSelectMeta[filterId] = quick
    ? { quick: true, total: sortedUsers.length, entity: opts.entity || (filterId.includes('sdr') ? 'SDRs' : 'Closers') }
    : { quick: false, total: sortedUsers.length };

  const notifyChange = (arr) => {
    renderMultiSelectItemsState(filterId, defaultLabel, sortedUsers, pipelineTipo);
    if (typeof onSelectChange === 'function') {
      onSelectChange(arr);
    } else if (pipelineTipo === 'sdr' || pipelineTipo === 'closer') {
      filterKanbanCards(pipelineTipo);
    }
  };

  // Preserva o texto da busca se o menu for reconstruído (ex.: recarga do quadro)
  const prevQuery = menu.querySelector('.ms-search-input')?.value || '';
  const listId = `${filterId}-listbox`;
  const ariaLabel = trigger.getAttribute('aria-label') || defaultLabel;
  trigger.setAttribute('aria-controls', listId);
  if (!trigger.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', 'false');

  const itemsHtml = sortedUsers.map(([idKey, name]) => {
    const keyStr = String(idKey);
    const isSel = selectedSet.has(keyStr);
    const safeName = escapeHtml(name);
    return `<div class="custom-multiselect-item${isSel ? ' selected' : ''}" role="option" tabindex="-1" aria-selected="${isSel}" data-key="${escapeHtml(keyStr)}" data-search="${escapeHtml(msNormalize(name))}" title="${safeName}">`
      + `<input type="checkbox" class="custom-multiselect-checkbox" tabindex="-1" aria-hidden="true"${isSel ? ' checked' : ''}>`
      + `<span class="ms-check" aria-hidden="true">${MS_CHECK_SVG}</span>`
      + `<span class="ms-avatar" aria-hidden="true">${escapeHtml(msInitials(name))}</span>`
      + `<span class="ms-name">${safeName}</span>`
      + `</div>`;
  }).join('');

  menu.innerHTML = `
    <div class="ms-search">
      <span class="ms-search-icon">${MS_SEARCH_SVG}</span>
      <input type="text" class="ms-search-input" placeholder="Buscar nome…" autocomplete="off" spellcheck="false" aria-label="Buscar nome" aria-controls="${listId}">
      <button type="button" class="ms-search-clear" aria-label="Limpar busca" hidden>&times;</button>
    </div>
    <div class="ms-header">
      <span class="ms-count" aria-live="polite"></span>
      <span class="ms-actions">
        <button type="button" class="ms-action" data-action="all">Selecionar todos</button>
        <button type="button" class="ms-action" data-action="none">Limpar</button>
      </span>
    </div>
    <div class="ms-list" id="${listId}" role="listbox" aria-multiselectable="true" aria-label="${escapeHtml(ariaLabel)}">${itemsHtml}</div>
    <div class="ms-empty" role="status" hidden></div>`;
  menu.removeAttribute('role');
  menu.removeAttribute('aria-multiselectable');
  menu.setAttribute('tabindex', '-1');

  menu._ms = {
    filterId,
    sortedUsers,
    total: sortedUsers.length,
    setSelection(arr) {
      CrmState.selectedUsers[filterId] = arr;
      notifyChange(arr);
    },
    toggle(keyStr) {
      let currentArr = CrmState.selectedUsers[filterId] || [];
      if (currentArr.includes(keyStr)) {
        currentArr = currentArr.filter(id => id !== keyStr);
      } else {
        currentArr.push(keyStr);
      }
      CrmState.selectedUsers[filterId] = currentArr;
      notifyChange(currentArr);
    }
  };

  bindMultiSelectMenu(menu, trigger);

  const input = menu.querySelector('.ms-search-input');
  if (prevQuery) input.value = prevQuery;
  msApplySearch(menu);
  msUpdateCount(menu);
  if (msIsOpen(menu)) positionMultiSelectMenu(menu);

  renderMultiSelectTriggerLabel(filterId, defaultLabel, userMap);
}

function renderMultiSelectItemsState(filterId, defaultLabel, sortedUsers, pipelineTipo) {
  const menu = document.getElementById(`${filterId}-menu`);
  if (!menu) return;
  const selectedSet = new Set((CrmState.selectedUsers[filterId] || []).map(String));
  const userMap = new Map(sortedUsers);

  const items = menu.querySelectorAll('.custom-multiselect-item');
  items.forEach(item => {
    const isSel = selectedSet.has(String(item.dataset.key));
    item.classList.toggle('selected', isSel);
    item.setAttribute('aria-selected', isSel ? 'true' : 'false');
    const chk = item.querySelector('.custom-multiselect-checkbox');
    if (chk) chk.checked = isSel;
  });
  msUpdateCount(menu);

  const hiddenSelect = document.getElementById(filterId);
  if (hiddenSelect) {
    const selectedArr = CrmState.selectedUsers[filterId] || [];
    hiddenSelect.value = selectedArr.length > 0 ? selectedArr.join(',') : 'all';
  }

  renderMultiSelectTriggerLabel(filterId, defaultLabel, userMap);
}

function renderMultiSelectTriggerLabel(filterId, defaultLabel, userMap) {
  const labelEl = document.querySelector(`#${filterId}-trigger .custom-multiselect-label`);
  if (!labelEl) return;

  const selectedIds = CrmState.selectedUsers[filterId] || [];
  const meta = CrmState.multiSelectMeta?.[filterId];
  if (meta && meta.quick) {
    const trigger = document.getElementById(`${filterId}-trigger`);
    if (trigger && trigger.getAttribute('aria-disabled') === 'true') {
      labelEl.textContent = `${meta.entity} (não se aplica)`;
    } else if (selectedIds.length === 0 || selectedIds.length >= meta.total) {
      labelEl.textContent = defaultLabel;
    } else if (selectedIds.length === 1) {
      labelEl.textContent = userMap.get(selectedIds[0]) || userMap.get(Number(selectedIds[0])) || defaultLabel;
    } else {
      labelEl.textContent = `${selectedIds.length} de ${meta.total} ${meta.entity}`;
    }
    return;
  }
  if (selectedIds.length === 0 || (meta && meta.total > 0 && selectedIds.length >= meta.total)) {
    // Nenhum ou todos marcados = sem filtro
    labelEl.textContent = defaultLabel;
  } else if (selectedIds.length === 1) {
    const name = userMap.get(selectedIds[0]) || userMap.get(Number(selectedIds[0])) || defaultLabel;
    labelEl.textContent = name;
  } else {
    const names = selectedIds.map(id => userMap.get(id) || userMap.get(Number(id))).filter(Boolean);
    const joined = names.join(', ');
    if (joined.length <= 16) {
      labelEl.textContent = joined;
    } else {
      const entity = filterId.includes('sdr') ? 'SDRs' : 'Closers';
      labelEl.textContent = meta && meta.total > 0
        ? `${selectedIds.length} de ${meta.total} ${entity}`
        : `${selectedIds.length} ${entity}`;
    }
  }
}
