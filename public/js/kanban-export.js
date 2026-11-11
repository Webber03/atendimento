// ----------------------------------------
// KANBAN: exportação CSV (SDR e Consultor)
// Exporta exatamente o que está visível no quadro, respeitando filtros
// (usuário, SDR de origem, etapa, busca, período) e a ordenação das colunas.
// - exportKanbanCsv('sdr')            → todas as colunas visíveis
// - exportKanbanCsv('closer', 12)     → só a etapa 12
// Nota privada fica de fora do arquivo de propósito.
// ----------------------------------------
(function () {
  const PIPELINE_LABEL = { sdr: 'sdr', closer: 'consultor' };

  function csvField(value) {
    let v = value == null ? '' : String(value);
    // Evita que o Excel interprete o texto como fórmula (=, +, -, @),
    // sem estragar telefones e números como "+55 11 9...".
    if (/^[=+\-@\t\r]/.test(v) && !/^[+\-]?[\d\s().,-]+$/.test(v)) v = "'" + v;
    return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function fmtDuration(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (!(ms > 0)) return '';
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))} min`;
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? `${d}d ${rh}h` : `${d}d`;
  }

  function fmtMoney(n) {
    return Number(n || 0).toFixed(2).replace('.', ',');
  }

  function slug(text) {
    return String(text || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'etapa';
  }

  function slaStatus(lead, stage) {
    if (!stage || !stage.sla_horas || stage.sla_horas <= 0 || !lead.moved_to_stage_at) return 'Sem SLA';
    const horas = (Date.now() - new Date(lead.moved_to_stage_at).getTime()) / 3600000;
    const pct = horas / stage.sla_horas;
    if (pct >= 1) return `Excedido (+${Math.round(horas - stage.sla_horas)}h)`;
    if (pct >= 0.75) return `Perto do limite (${Math.round(stage.sla_horas - horas)}h restantes)`;
    return 'No prazo';
  }

  function docsCount(lead) {
    return [lead.doc_contracheque_id, lead.doc_extrato_id, lead.doc_identificacao_id, lead.doc_residencia_id, lead.doc_espelho_id]
      .filter(Boolean).length;
  }

  function trim(v) {
    return v && String(v).trim() ? String(v).trim() : '';
  }

  function buildRow(lead, pipelineTipo, stagesById) {
    const stage = stagesById.get(String(lead.estagio_id));
    const stageTime = lead.moved_to_stage_at || (pipelineTipo === 'closer' ? lead.transferido_closer_at : null) || lead.created_at;
    const valor = typeof getLeadValorContrato === 'function' ? getLeadValorContrato(lead) : (lead.valor_contrato || 0);
    const canal = lead.canal_nome || (lead.discadora_login ? 'Discadora' : '');
    return [
      stage ? stage.nome : '',
      trim(lead.cliente_nome) || (lead.cliente_cpf ? '' : `Cliente #${lead.cliente_id}`),
      lead.cliente_cpf && typeof formatCpf === 'function' ? formatCpf(lead.cliente_cpf) : (lead.cliente_cpf || ''),
      lead.cliente_telefone || '',
      lead.cliente_email || '',
      canal,
      trim(lead.sdr_nome) || trim(lead.sdr_username) || trim(lead.discadora_login),
      trim(lead.closer_nome) || trim(lead.closer_username),
      fmtMoney(valor),
      `${docsCount(lead)}/5`,
      slaStatus(lead, stage),
      fmtDateTime(stageTime),
      fmtDuration(stageTime),
      fmtDateTime(lead.created_at),
      lead.status_atendimento === 'pendente_aceite' ? 'Sim' : 'Não'
    ];
  }

  const HEADER = [
    'Etapa', 'Cliente', 'CPF', 'Telefone', 'E-mail', 'Canal', 'SDR', 'Consultor (Closer)',
    'Valor do Contrato', 'Documentos', 'Situação do SLA', 'Entrou na Etapa em', 'Tempo na Etapa',
    'Criado em', 'Aguardando Aceite'
  ];

  function isShown(el) {
    return el && el.style.display !== 'none';
  }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type);
  }

  window.exportKanbanCsv = function (pipelineTipo, estagioId) {
    const board = document.getElementById(`${pipelineTipo}-kanban-board`);
    const pool = pipelineTipo === 'sdr' ? (CrmState.sdrLeads || []) : (CrmState.closerLeads || []);
    if (!board || !pool.length) {
      toast('Não há leads carregados para exportar.', 'error');
      return;
    }

    const leadsById = new Map(pool.map(l => [String(l.id), l]));
    const stagesById = new Map((CrmState.estagios || []).map(e => [String(e.id), e]));
    const lines = [HEADER.map(csvField).join(';')];
    let count = 0;

    board.querySelectorAll('.kanban-column').forEach(col => {
      const wrapper = col.querySelector('.kanban-cards-wrapper');
      if (!wrapper || !isShown(col)) return;
      if (estagioId != null && String(wrapper.dataset.estagioId) !== String(estagioId)) return;
      wrapper.querySelectorAll('.kanban-card').forEach(card => {
        if (!isShown(card)) return;
        const lead = leadsById.get(String(card.dataset.leadId));
        if (!lead) return;
        lines.push(buildRow(lead, pipelineTipo, stagesById).map(csvField).join(';'));
        count++;
      });
    });

    if (!count) {
      toast('Nenhum lead visível com os filtros atuais.', 'error');
      return;
    }

    const stageName = estagioId != null ? (stagesById.get(String(estagioId))?.nome || 'etapa') : 'filtrado';
    const filename = `kanban_${PIPELINE_LABEL[pipelineTipo] || pipelineTipo}_${slug(stageName)}_${new Date().toISOString().slice(0, 10)}.csv`;
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${count} ${count === 1 ? 'lead exportado' : 'leads exportados'}.`, 'success');
  };
})();
