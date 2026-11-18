// Carga de equipes, consultores e canais e preenchimento das listas

// ----------------------------------------
// STATE LOADERS & ACTIONS
// ----------------------------------------

async function loadCoreData() {
  try {
    const [resTeams, resConsultants, resChannels, resSystems, resConvenios, resProdutos] = await Promise.all([
      fetchWithAuth('/api/teams').then(r => r.json()),
      fetchWithAuth('/api/consultants').then(r => r.json()),
      fetchWithAuth('/api/channels').then(r => r.json()),
      fetchWithAuth('/api/systems').then(r => r.json()),
      fetchWithAuth('/api/convenios').then(r => r.json()),
      fetchWithAuth('/api/produtos').then(r => r.json())
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

  const userTeamId = document.getElementById('user-team-id');
  if (userTeamId) {
    userTeamId.innerHTML = '<option value="">-- Selecione a Equipe --</option>';
    teams.forEach(t => {
      userTeamId.innerHTML += `<option value="${t.id}">${t.name}</option>`;
    });
  }

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

  // Aplica as restrições de perfil nas opções dinâmicas recém-carregadas
  applyRoleUI();
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
