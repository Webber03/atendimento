// Gestão de usuários

// GET /api/users — Lista todos os usuários
let CrmUsers = [];

async function loadUsersTable() {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  
  try {
    const res = await fetchWithAuth('/api/users');
    const data = await res.json();
    
    if (data.error) {
      showToast(data.error, "error");
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Não foi possível carregar os usuários. <button type="button" class="btn btn-secondary" style="margin-left:8px;padding:6px 12px;font-size:12px" onclick="loadUsersTable()">Tentar de novo</button></td></tr>';
      return;
    }
    
    CrmUsers = data;
    tbody.innerHTML = '';
    
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Nenhum usuário cadastrado.</td></tr>';
      return;
    }
    
    data.forEach(user => {
      const activeText = user.active ? 'Ativo' : 'Inativo';
      const activeClass = user.active ? 'badge-success' : 'badge-danger';
      const teamName = user.team_name || '-';
      const roleName = getRoleLabel(user.role);
      
      tbody.innerHTML += `
        <tr>
          <td><strong>${escapeHtml(user.name || '-')}</strong></td>
          <td>${user.username}</td>
          <td>${roleName}</td>
          <td>${teamName}</td>
          <td class="text-center">
            <span class="badge ${activeClass}">${activeText}</span>
          </td>
          <td class="text-center">
            <div style="display: flex; gap: 8px; justify-content: center;">
              <button class="btn-icon-delete" onclick="startEditUser(${user.id})" title="Editar usuário" style="color: var(--accent-blue);">
                <i data-lucide="edit"></i>
              </button>
              <button class="btn-icon-delete" onclick="toggleUserStatus(${user.id}, ${user.active})" title="Alterar status" style="color: var(--accent-light);">
                <i data-lucide="${user.active ? 'user-x' : 'user-check'}"></i>
              </button>
              <button class="btn-icon-delete" onclick="deleteUser(${user.id})" title="Remover usuário">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    });
    
    lucide.createIcons();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Não foi possível carregar os usuários. <button type="button" class="btn btn-secondary" style="margin-left:8px;padding:6px 12px;font-size:12px" onclick="loadUsersTable()">Tentar de novo</button></td></tr>';
    showToast("Erro ao carregar usuários.", "error");
    console.error(err);
  }
}

async function createUser(e) {
  e.preventDefault();
  const editId = document.getElementById('user-edit-id').value;
  const nameInput = document.getElementById('user-name');
  const usernameInput = document.getElementById('user-username');
  const passwordInput = document.getElementById('user-password');
  const roleSelect = document.getElementById('user-role');
  const teamSelect = document.getElementById('user-team-id');
  
  const name = nameInput.value.trim();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const role = roleSelect.value;
  const team_id = teamSelect.value ? parseInt(teamSelect.value, 10) : null;
  
  if (!name || !username || (!editId && !password) || !role) {
    showToast("Preencha todos os campos obrigatórios.", "error");
    return;
  }
  
  try {
    let res;
    if (editId) {
      res = await fetchWithAuth(`/api/users/${editId}`, {
        method: 'PUT',
        body: JSON.stringify({ username, name, password: password || undefined, role, team_id })
      }).then(r => r.json());
    } else {
      res = await fetchWithAuth('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username, name, password, role, team_id })
      }).then(r => r.json());
    }
    
    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(editId ? "Usuário atualizado com sucesso!" : `Usuário "${res.username}" criado!`, "success");
      cancelUserEdit();
      loadUsersTable();
    }
  } catch (err) {
    showToast(editId ? "Erro ao atualizar usuário." : "Erro ao criar usuário.", "error");
    console.error(err);
  }
}

function startEditUser(id) {
  const user = CrmUsers.find(u => u.id === id);
  if (!user) return;
  
  document.getElementById('user-edit-id').value = user.id;
  document.getElementById('user-name').value = user.name || '';
  document.getElementById('user-username').value = user.username;
  document.getElementById('user-password').value = '';
  document.getElementById('user-password').required = false;
  document.getElementById('label-user-password').textContent = 'Senha (deixe em branco para manter a atual)';
  document.getElementById('user-role').value = user.role;
  
  const teamGroup = document.getElementById('user-team-group');
  const teamSelect = document.getElementById('user-team-id');
  if (['supervisor', 'closer', 'sdr'].includes(user.role)) {
    teamGroup.style.display = 'block';
    teamSelect.value = user.team_id || '';
    teamSelect.required = (user.role === 'supervisor');
  } else {
    teamGroup.style.display = 'none';
    teamSelect.value = '';
    teamSelect.required = false;
  }
  
  document.getElementById('card-user-title').textContent = 'Editar Usuário';
  document.getElementById('btn-user-submit').innerHTML = '<i data-lucide="save"></i> Salvar Alterações';
  document.getElementById('btn-user-cancel-edit').classList.remove('hidden');
  lucide.createIcons();
}

function cancelUserEdit() {
  document.getElementById('user-edit-id').value = '';
  document.getElementById('user-name').value = '';
  document.getElementById('user-username').value = '';
  document.getElementById('user-password').value = '';
  document.getElementById('user-password').required = true;
  document.getElementById('label-user-password').textContent = 'Senha (mín. 6 caracteres)';
  document.getElementById('user-role').value = '';
  document.getElementById('user-team-id').value = '';
  document.getElementById('user-team-group').style.display = 'none';
  
  document.getElementById('card-user-title').textContent = 'Novo Usuário';
  document.getElementById('btn-user-submit').innerHTML = '<i data-lucide="plus"></i> Criar Usuário';
  document.getElementById('btn-user-cancel-edit').classList.add('hidden');
  lucide.createIcons();
}

window.startEditUser = startEditUser;

window.cancelUserEdit = cancelUserEdit;

async function toggleUserStatus(id, currentActive) {
  try {
    const res = await fetchWithAuth(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ active: !currentActive })
    }).then(r => r.json());
    
    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast("Status do usuário atualizado!", "success");
      loadUsersTable();
    }
  } catch (err) {
    showToast("Erro ao alterar status do usuário.", "error");
  }
}

async function deleteUser(id) {
  const curUser = getUser();
  if (curUser && curUser.id === id) {
    showToast("Você não pode remover seu próprio usuário.", "error");
    return;
  }
  
  if (!(await confirmarAcao({ titulo: 'Remover usuário?', mensagem: 'A conta será apagada permanentemente. Para só bloquear o acesso, use “Alterar status”.', confirmar: 'Remover usuário', perigo: true }))) return;
  
  try {
    const res = await fetchWithAuth(`/api/users/${id}`, {
      method: 'DELETE'
    }).then(r => r.json());
    
    if (res.error) {
      showToast(res.error, "error");
    } else {
      showToast(res.message, "success");
      loadUsersTable();
    }
  } catch (err) {
    showToast("Erro ao remover usuário.", "error");
  }
}

window.deleteUser = deleteUser;

window.toggleUserStatus = toggleUserStatus;
