// Cadastros: equipes, consultores, canais, sistemas, convênios e produtos

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
    const progUserLabel = c.progestor_user ? ` | Progestor: ${c.progestor_user}` : ' | Progestor: [Não vinculado]';
    listC.innerHTML += `
      <li class="settings-list-item">
        <div>
          <span>${c.name}</span>
          <small class="item-sub">Equipe: ${c.team_name}${progUserLabel}</small>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn-icon-delete" onclick="editConsultantMapping(${c.id}, '${c.name}', '${c.progestor_user || ''}')" title="Editar vínculo Progestor" style="color: var(--accent-blue);">
            <i data-lucide="edit-2" style="width: 14px; height: 14px;"></i>
          </button>
          <button class="btn-icon-delete" onclick="deleteConsultant(${c.id})" title="Remover consultor">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </li>
    `;
  });

  // Render channels list with toggle switch
  const listCh = document.getElementById('list-channels');
  listCh.innerHTML = '';
  channels.forEach(ch => {
    const progCodeLabel = ch.progestor_code ? ` (Progestor ID: ${ch.progestor_code})` : ' (Progestor ID: [Não vinculado])';
    listCh.innerHTML += `
      <li class="settings-list-item">
        <span>${ch.name}${progCodeLabel}</span>
        <div class="list-item-actions" style="display: flex; gap: 8px; align-items: center;">
          <label class="switch">
            <input type="checkbox" ${ch.active ? 'checked' : ''} onchange="toggleChannel(${ch.id}, this.checked)">
            <span class="slider"></span>
          </label>
          <button class="btn-icon-delete" onclick="editChannelMapping(${ch.id}, '${ch.name}', '${ch.progestor_code || ''}')" title="Editar ID Progestor" style="color: var(--accent-blue);">
            <i data-lucide="edit-2" style="width: 14px; height: 14px;"></i>
          </button>
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
    const res = await fetchWithAuth('/api/teams', {
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
    const res = await fetchWithAuth(`/api/teams/${id}`, { method: 'DELETE' }).then(r => r.json());
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
  const progUserInput = document.getElementById('consultant-progestor-user');
  
  const name = nameInput.value;
  const team_id = teamSelect.value;
  const progestor_user = progUserInput ? progUserInput.value.trim() : '';

  if (!name.trim() || !team_id) return;

  try {
    const res = await fetchWithAuth('/api/consultants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, team_id: parseInt(team_id, 10), progestor_user })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(`Consultor "${res.name}" cadastrado!`, "success");
      nameInput.value = '';
      teamSelect.value = '';
      if (progUserInput) progUserInput.value = '';
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
    const res = await fetchWithAuth(`/api/consultants/${id}`, { method: 'DELETE' }).then(r => r.json());
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
  const progCodeInput = document.getElementById('channel-progestor-code');
  const name = input.value;
  const progestor_code = progCodeInput ? progCodeInput.value.trim() : '';
  if (!name.trim()) return;

  try {
    const res = await fetchWithAuth('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, progestor_code })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(`Canal "${res.name}" cadastrado!`, "success");
      input.value = '';
      if (progCodeInput) progCodeInput.value = '';
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
    const res = await fetchWithAuth(`/api/channels/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: active ? 1 : 0 })
    }).then(r => r.json());

    if (res.error) {
      showToast(res.error, "error");
    } else {
      // Quiet reload of core data to update local active states
      const resChannels = await fetchWithAuth('/api/channels').then(r => r.json());
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
    const res = await fetchWithAuth(`/api/channels/${id}`, { method: 'DELETE' }).then(r => r.json());
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
    const res = await fetchWithAuth('/api/systems', {
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
    const res = await fetchWithAuth(`/api/systems/${id}`, { method: 'DELETE' }).then(r => r.json());
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
    const res = await fetchWithAuth('/api/convenios', {
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
    const res = await fetchWithAuth(`/api/convenios/${id}`, { method: 'DELETE' }).then(r => r.json());
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
    const res = await fetchWithAuth('/api/produtos', {
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
    const res = await fetchWithAuth(`/api/produtos/${id}`, { method: 'DELETE' }).then(r => r.json());
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
