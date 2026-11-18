// Ligação dos eventos das telas gerais

// ----------------------------------------
// EVEN LISTENERS & ACTIONS SETUP
// ----------------------------------------

function setupEventListeners() {
  // Dashboard filter changes
  document.getElementById('filter-period').addEventListener('change', (e) => {
    const val = e.target.value;
    const customContainer = document.getElementById('custom-date-container');
    if (val === 'custom') {
      customContainer.classList.remove('hidden');
    } else {
      customContainer.classList.add('hidden');
      refreshDashboard();
    }
  });

  // Custom date updates trigger refresh
  document.getElementById('filter-start-date').addEventListener('change', refreshDashboard);
  document.getElementById('filter-end-date').addEventListener('change', refreshDashboard);

  // Filter team changes consultant choices
  document.getElementById('filter-team').addEventListener('change', () => {
    updateConsultantFilterOptions();
    refreshDashboard();
  });
  
  // Consultant filter triggers refresh
  document.getElementById('filter-consultant').addEventListener('change', refreshDashboard);

  // Sales channel filter triggers refresh
  document.getElementById('filter-channel').addEventListener('change', refreshDashboard);

  // Launches panel selection changes
  document.getElementById('launch-date').addEventListener('change', checkLaunchGridTrigger);
  document.getElementById('launch-team').addEventListener('change', () => {
    updateLaunchConsultantOptions();
    checkLaunchGridTrigger();
  });
  document.getElementById('launch-consultant').addEventListener('change', checkLaunchGridTrigger);

  // Save launches form submission
  document.getElementById('btn-save-launches').addEventListener('click', saveLaunches);

  // Records tab filters
  ['records-start-date', 'records-end-date', 'records-team', 'records-consultant', 'records-channel'].forEach(id => {
    document.getElementById(id).addEventListener('change', refreshRecentRecords);
  });

  // Settings Forms submit
  document.getElementById('form-team').addEventListener('submit', addTeam);
  document.getElementById('form-consultant').addEventListener('submit', addConsultant);
  document.getElementById('form-channel').addEventListener('submit', addChannel);
  
  const formSystem = document.getElementById('form-system');
  if (formSystem) formSystem.addEventListener('submit', addSystem);

  const formConvenio = document.getElementById('form-convenio');
  if (formConvenio) formConvenio.addEventListener('submit', addConvenio);

  const formProduto = document.getElementById('form-produto');
  if (formProduto) formProduto.addEventListener('submit', addProduto);

  const formLeadGen = document.getElementById('form-lead-generation');
  if (formLeadGen) formLeadGen.addEventListener('submit', saveLeadGeneration);
  
  const leadChannel = document.getElementById('lead-channel');
  if (leadChannel) {
    leadChannel.addEventListener('change', () => {
      const channel_id = leadChannel.value;
      const selectedCh = channels.find(ch => ch.id == channel_id);
      const expandCheckbox = document.getElementById('lead-expand-consultants');
      if (expandCheckbox) {
        if (selectedCh && (selectedCh.name.toLowerCase() === 'disparo whatsapp' || selectedCh.name.toLowerCase() === 'disparo wpp')) {
          expandCheckbox.checked = true;
        } else {
          expandCheckbox.checked = false;
        }
      }
      handleLeadChannelChange();
    });
  }

  const leadExpandCheckbox = document.getElementById('lead-expand-consultants');
  if (leadExpandCheckbox) {
    leadExpandCheckbox.addEventListener('change', handleLeadChannelChange);
  }
  
  const btnFilterLeadsDash = document.getElementById('btn-filter-leads-dash');
  if (btnFilterLeadsDash) btnFilterLeadsDash.addEventListener('click', refreshLeadsDashboard);

  const formProgStatus = document.getElementById('form-progestor-status-mapping');
  if (formProgStatus) {
    formProgStatus.addEventListener('submit', async (e) => {
      e.preventDefault();
      const closedInput = document.getElementById('mapping-closed-codes');
      const unviableInput = document.getElementById('mapping-unviable-codes');
      const urlInput = document.getElementById('mapping-progestor-url');
      const closed = closedInput ? closedInput.value.trim() : '';
      const unviable = unviableInput ? unviableInput.value.trim() : '';
      const url = urlInput ? urlInput.value.trim() : '';

      try {
        const res = await fetchWithAuth('/api/settings/progestor-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ closed, unviable, url })
        }).then(r => r.json());

        if (res.error) {
          showToast(res.error, "error");
        } else {
          showToast(res.message, "success");
        }
      } catch (err) {
        showToast("Erro ao salvar configurações no banco.", "error");
        console.error(err);
      }
    });
  }

  // User Administration listeners
  const formUser = document.getElementById('form-user');
  if (formUser) formUser.addEventListener('submit', createUser);

  const roleSelect = document.getElementById('user-role');
  if (roleSelect) {
    roleSelect.addEventListener('change', (e) => {
      const teamGroup = document.getElementById('user-team-group');
      const teamSelect = document.getElementById('user-team-id');
      if (teamGroup) {
        const showTeam = ['supervisor', 'closer', 'sdr'].includes(e.target.value);
        teamGroup.style.display = showTeam ? 'block' : 'none';
        if (teamSelect) {
          teamSelect.required = e.target.value === 'supervisor';
          if (!showTeam) teamSelect.value = '';
        }
      }
    });
  }
}
