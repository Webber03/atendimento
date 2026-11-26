// Contratos dentro do modal do lead: operações do cliente, total por fase e botão "+ Nova operação".

const LeadContratos = { leadId: null, dados: null, abertos: new Set() };

const LC_FORMATO = {
  unico: () => 'Contrato único',
  portabilidades: n => `${n} portabilidades`,
  port_refin: n => `${n - 1} portabilidade${n - 1 > 1 ? 's' : ''} + refin da port`
};

function lcEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function lcMoeda(v) {
  if (v === null || v === undefined || v === '') return '—';
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function lcData(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleDateString('pt-BR');
}

function lcClasseStatus(nome) {
  if (nome === 'PAGO') return 'lc-st lc-st-pago';
  if (nome === 'CANCELADO') return 'lc-st lc-st-cancelado';
  return 'lc-st';
}

async function carregarContratosDoLead(leadId) {
  const area = document.getElementById('modal-lead-contratos');
  if (!area) return;
  LeadContratos.leadId = String(leadId);
  area.classList.add('hidden');
  area.innerHTML = '';
  try {
    const res = await fetchWithAuth(`/api/crm/leads/${leadId}/contratos`);
    if (!res.ok) return; // sem acesso: a área simplesmente não aparece
    const dados = await res.json();
    if (String(document.getElementById('modal-lead-id')?.value) !== String(leadId)) return;
    LeadContratos.dados = dados;
    renderContratosDoLead();
  } catch (err) {
    console.error('Contratos do lead:', err);
  }
}

function renderContratosDoLead() {
  const area = document.getElementById('modal-lead-contratos');
  const d = LeadContratos.dados;
  if (!area || !d) return;
  if (!d.operacoes.length && !d.pode_criar) { area.classList.add('hidden'); return; }

  const botao = d.pode_criar
    ? `<button type="button" class="btn btn-primary lc-btn-nova" onclick="abrirNovaOperacao(${Number(LeadContratos.leadId)})"><i data-lucide="plus"></i> Nova operação</button>`
    : '';

  const ops = d.operacoes.map(op => {
    const n = op.contratos.length;
    const titulo = op.formato === 'unico'
      ? `Contrato único · ${lcEsc(op.contratos[0]?.tipo || '')}`
      : LC_FORMATO[op.formato](n);
    const porFase = {};
    op.contratos.forEach(c => { porFase[c.fase] = (porFase[c.fase] || 0) + 1; });
    const fases = d.fases.filter(f => porFase[f.chave]).map(f => {
      const cor = f.chave === 'encerrado' ? 'lc-fase-red' : f.chave === 'pagamento' ? 'lc-fase-green' : '';
      return `<span class="lc-fase ${cor}" role="listitem">${lcEsc(f.nome)} <strong>${porFase[f.chave]}</strong></span>`;
    }).join('');

    const aberto = LeadContratos.abertos.has(op.id);
    const LIMITE = 4;
    const visiveis = aberto || n <= LIMITE + 1 ? op.contratos : op.contratos.slice(0, LIMITE);
    const linhas = visiveis.map(c => {
      const ehPort = c.tipo === 'PORTABILIDADE';
      const nome = c.tipo === 'REFIN-PORTABILIDADE' ? 'Refin da port' : ehPort ? `Port nº ${lcEsc(c.numero_contrato || '')}` : lcEsc(c.tipo || '');
      const detalhes = [lcEsc(c.banco || '—')];
      if (c.parcela != null) detalhes.push(`parcela ${lcMoeda(c.parcela)}`);
      if (ehPort && c.saldo_devedor != null) detalhes.push(`saldo ${lcMoeda(c.saldo_devedor)}`);
      if (!ehPort && c.valor_liberado != null) detalhes.push(`liberado ${lcMoeda(c.valor_liberado)}`);
      if (c.prazo_restante) detalhes.push(`${c.prazo_restante} restantes`);
      return `<li class="lc-item">
        <div class="lc-item-topo"><span class="lc-c-nome">${nome}</span><span class="${lcClasseStatus(c.status)}">${lcEsc(c.status)}</span></div>
        <div class="lc-item-sub">${detalhes.join(' · ')}</div>
      </li>`;
    }).join('');
    const resto = n - visiveis.length;
    const toggle = resto > 0
      ? `<button type="button" class="lc-mais" onclick="lcAlternar(${op.id})"><i data-lucide="chevron-down"></i> Mostrar os outros ${resto} contratos</button>`
      : (aberto && n > LIMITE + 1 ? `<button type="button" class="lc-mais" onclick="lcAlternar(${op.id})"><i data-lucide="chevron-up"></i> Mostrar menos</button>` : '');

    return `<article class="lc-op">
      <div class="lc-op-head">
        <div class="lc-op-txt">
          <strong class="lc-op-titulo">${lcEsc(op.codigo)} · ${titulo}</strong>
          <span class="lc-op-sub">${lcEsc(op.produto || '')} · subida em ${lcData(op.created_at)}${op.criado_por ? ' por ' + lcEsc(op.criado_por) : ''}${op.digitador && op.digitador !== op.criado_por ? ' · digitador ' + lcEsc(op.digitador) : ''}</span>
        </div>
        <div class="lc-op-acoes">
          ${op.pode_editar ? `<button type="button" class="lc-acao" onclick="abrirEdicaoOperacao(${op.id})"><i data-lucide="pencil"></i> Editar proposta</button>` : ''}
          ${op.pode_mover ? `<button type="button" class="lc-acao lc-acao-forte" onclick="abrirAtualizarOperacao(${op.id})">Atualizar operação</button>` : ''}
        </div>
      </div>
      <div class="lc-fases" role="list" aria-label="Contratos por fase">${fases}</div>
      <ul class="lc-lista" aria-label="Contratos da operação ${lcEsc(op.codigo)}">${linhas}</ul>
      ${toggle}
    </article>`;
  }).join('');

  const vazio = !d.operacoes.length
    ? '<p class="lc-vazio">Nenhuma operação subida para este cliente ainda.</p>'
    : '';

  area.innerHTML = `
    <div class="lc-head">
      <h3><i data-lucide="file-text"></i> Contratos</h3>
      ${botao}
    </div>
    ${vazio}${ops}`;
  area.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function lcAlternar(opId) {
  if (LeadContratos.abertos.has(opId)) LeadContratos.abertos.delete(opId);
  else LeadContratos.abertos.add(opId);
  renderContratosDoLead();
}
