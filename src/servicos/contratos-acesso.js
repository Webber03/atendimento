// Quem pode ver os contratos de um lead e quem pode subir uma nova operação.
// Mesma regra do kanban: closer/SDR veem os seus; supervisor vê se o SDR OU o closer
// do lead for da equipe dele; admin e operacional veem tudo.
// Subir operação: closer (os seus), supervisor (equipe) e admin, com o lead no
// kanban de closer a partir da etapa PROPOSTA SISTEMA.
const { dbGet } = require('../../database');

const ETAPA_MINIMA = 'PROPOSTA SISTEMA';

async function carregarLeadComAcesso(user, leadId) {
  const lead = await dbGet(`
    SELECT l.id, l.cliente_id, l.sdr_id, l.closer_id, l.estagio_id, l.status_atendimento,
           e.nome AS estagio_nome, e.pipeline_tipo, e.ordem AS estagio_ordem,
           us.team_id AS sdr_team_id, uc.team_id AS closer_team_id
    FROM crm_kanban_leads l
    LEFT JOIN crm_kanban_estagios e ON e.id = l.estagio_id
    LEFT JOIN users us ON us.id = l.sdr_id
    LEFT JOIN users uc ON uc.id = l.closer_id
    WHERE l.id = ?`, [leadId]);
  if (!lead) return { lead: null, podeVer: false, podeCriar: false, motivo: 'Lead não encontrado.' };

  let equipeSupervisor = null;
  if (user.role === 'supervisor') {
    const u = await dbGet('SELECT team_id FROM users WHERE id = ?', [user.id]);
    equipeSupervisor = (u && u.team_id) || user.team_id || null;
  }
  const daEquipe = equipeSupervisor != null &&
    (lead.sdr_team_id === equipeSupervisor || lead.closer_team_id === equipeSupervisor);

  const podeVer =
    user.role === 'admin' || user.role === 'operacional' ||
    (user.role === 'closer' && lead.closer_id === user.id) ||
    (user.role === 'sdr' && lead.sdr_id === user.id) ||
    (user.role === 'supervisor' && daEquipe);

  let podeCriar = false;
  let motivo = null;
  const papelPode = user.role === 'admin' ||
    (user.role === 'closer' && lead.closer_id === user.id) ||
    (user.role === 'supervisor' && daEquipe);

  if (!podeVer) {
    motivo = 'Você não tem acesso a este lead.';
  } else if (!papelPode) {
    motivo = 'Só o closer do lead, o supervisor da equipe ou um admin sobem operações.';
  } else if (lead.pipeline_tipo !== 'closer') {
    motivo = `Operações são subidas no kanban de closer, a partir de ${ETAPA_MINIMA}.`;
  } else {
    const minima = await dbGet(
      "SELECT ordem FROM crm_kanban_estagios WHERE pipeline_tipo = 'closer' AND UPPER(TRIM(nome)) = ? LIMIT 1",
      [ETAPA_MINIMA]
    );
    if (minima && Number(lead.estagio_ordem) < Number(minima.ordem)) {
      motivo = `Disponível a partir da etapa ${ETAPA_MINIMA}.`;
    } else {
      podeCriar = true;
    }
  }

  return { lead, podeVer, podeCriar, motivo };
}

// ----------------------------------------------------------------------------
// Acesso pela própria operação (Propostas digitadas): usa o closer, o SDR e as
// equipes gravados na digitação, então continua valendo se o lead sair do kanban.
// ----------------------------------------------------------------------------
async function equipeDoUsuario(user) {
  if (user.role !== 'supervisor') return null;
  const u = await dbGet('SELECT team_id FROM users WHERE id = ?', [user.id]);
  return (u && u.team_id) || user.team_id || null;
}

// Trecho de WHERE (alias "o" = contratos_operacoes) com o que o usuário pode ver
async function filtroVisibilidade(user) {
  if (user.role === 'admin' || user.role === 'operacional') return { sql: 'TRUE', params: [] };
  if (user.role === 'closer') return { sql: 'o.closer_id = ?', params: [user.id] };
  if (user.role === 'sdr') return { sql: 'o.sdr_id = ?', params: [user.id] };
  if (user.role === 'supervisor') {
    const eq = await equipeDoUsuario(user);
    if (!eq) return { sql: 'FALSE', params: [] };
    return { sql: '(o.equipe_closer_id = ? OR o.equipe_sdr_id = ?)', params: [eq, eq] };
  }
  return { sql: 'FALSE', params: [] };
}

const podeMoverStatus = user => user.role === 'admin' || user.role === 'operacional';

// op precisa de: closer_id, sdr_id, equipe_closer_id, equipe_sdr_id; todosIniciais = todos os contratos no status inicial
async function permissoesOperacao(user, op, todosIniciais) {
  const eq = await equipeDoUsuario(user);
  const daEquipe = eq != null && (op.equipe_closer_id === eq || op.equipe_sdr_id === eq);
  const podeVer = user.role === 'admin' || user.role === 'operacional' ||
    (user.role === 'closer' && op.closer_id === user.id) ||
    (user.role === 'sdr' && op.sdr_id === user.id) ||
    (user.role === 'supervisor' && daEquipe);
  const dono = (user.role === 'closer' && op.closer_id === user.id) || (user.role === 'supervisor' && daEquipe);
  let podeEditar = false;
  let motivoEditar = null;
  if (podeMoverStatus(user)) podeEditar = true;
  else if (dono && todosIniciais) podeEditar = true;
  else if (dono) motivoEditar = 'A operação já começou a andar: peça a correção ao Operacional.';
  return { podeVer, podeMover: podeMoverStatus(user), podeEditar, motivoEditar };
}

module.exports = { carregarLeadComAcesso, ETAPA_MINIMA, filtroVisibilidade, permissoesOperacao, podeMoverStatus };
