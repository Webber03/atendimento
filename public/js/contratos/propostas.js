// Contratos › Propostas digitadas: um contrato por linha ou agrupado por operação.

const Propostas = {
  iniciado: false,
  modo: 'lista',           // 'lista' | 'grupo'
  filtros: { fase: '', status_id: '', busca: '', periodo: 'mes', campo_data: 'subida', de: '', ate: '', closer_id: '', banco_id: '', canal_id: '' },
  pagina: 1,
  porPagina: 50,
  dados: null,
  listas: null,
  consultores: [],
  selecionados: new Map(), // contratoId -> operacaoId
  abertos: new Set(),      // operações expandidas no modo agrupado
  ultimoPedido: 0
};

function ppEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function ppMoeda(v) {
  if (v === null || v === undefined || v === '') return '—';
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function ppData(v, comHora) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return comHora
    ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function ppPodeMover() {
  const u = typeof getUser === 'function' ? getUser() : null;
  return !!u && ['admin', 'operacional'].includes(u.role);
}
function ppStatusClasse(nome) {
  return nome === 'PAGO' ? 'pp-st pp-st-pago' : nome === 'CANCELADO' ? 'pp-st pp-st-cancelado' : 'pp-st';
}
function ppDatasPeriodo(p) {
  const hoje = new Date();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (p === 'mes') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate: iso(hoje) };
  if (p === '7d') { const d = new Date(hoje); d.setDate(d.getDate() - 6); return { de: iso(d), ate: iso(hoje) }; }
  if (p === 'personalizado') return { de: Propostas.filtros.de || '', ate: Propostas.filtros.ate || '' };
  if (p === 'mes_passado') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)), ate: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)) };
  return { de: '', ate: '' };
}

function ppQuery(extra = {}) {
  const f = Propostas.filtros;
  const { de, ate } = ppDatasPeriodo(f.periodo);
  const p = new URLSearchParams();
  const add = (k, v) => { if (v !== '' && v != null) p.set(k, v); };
  add('fase', f.fase); add('status_id', f.status_id); add('busca', f.busca.trim());
  add('de', de); add('ate', ate); add('closer_id', f.closer_id);
  if (f.campo_data === 'liberacao') p.set('campo_data', 'liberacao'); add('banco_id', f.banco_id); add('canal_id', f.canal_id);
  add('pagina', Propostas.pagina); add('por_pagina', Propostas.porPagina);
  if (Propostas.modo === 'grupo') p.set('agrupar', '1');
  Object.entries(extra).forEach(([k, v]) => p.set(k, v));
  return p.toString();
}

async function carregarPropostas() {
  if (!Propostas.iniciado) await ppIniciar();
  const pedido = ++Propostas.ultimoPedido;
  const alvo = document.getElementById('pp-conteudo');
  alvo.setAttribute('aria-busy', 'true');
  try {
    const res = await fetchWithAuth('/api/contratos/propostas?' + ppQuery());
    const dados = await res.json();
    if (pedido !== Propostas.ultimoPedido) return;
    if (!res.ok) throw new Error(dados.error || 'Erro ao carregar.');
    Propostas.dados = dados;
    ppRender();
  } catch (err) {
    alvo.innerHTML = `<p class="pp-vazio">Não foi possível carregar: ${ppEsc(err.message)} <button type="button" class="btn btn-secondary pp-btn-sm" onclick="carregarPropostas()">Tentar de novo</button></p>`;
  } finally {
    alvo.removeAttribute('aria-busy');
  }
}

async function ppIniciar() {
  Propostas.iniciado = true;
  try {
    const [listas, consultores] = await Promise.all([
      fetchWithAuth('/api/contratos/listas').then(r => r.json()),
      fetchWithAuth('/api/contratos/consultores').then(r => r.json())
    ]);
    Propostas.listas = listas;
    Propostas.consultores = Array.isArray(consultores) ? consultores : [];
  } catch (_) { Propostas.listas = { fases: [], status: [], banco: [] }; }

  const selConsultor = document.getElementById('pp-consultor');
  selConsultor.innerHTML = '<option value="">Todos os consultores</option>' +
    Propostas.consultores.map(c => `<option value="${c.id}">${ppEsc(c.nome)}</option>`).join('');
  const u = typeof getUser === 'function' ? getUser() : null;
  if (u && u.role === 'closer') selConsultor.closest('.pp-campo').hidden = true;
  const selBanco = document.getElementById('pp-banco');
  selBanco.innerHTML = '<option value="">Todos os bancos</option>' +
    (Propostas.listas.banco || []).filter(b => b.ativo).map(b => `<option value="${b.id}">${ppEsc(b.nome)}</option>`).join('');
  const selCanal = document.getElementById('pp-canal');
  selCanal.innerHTML = '<option value="">Todos os canais</option>' +
    (Propostas.listas.canais || []).map(c => `<option value="${c.id}">${ppEsc(c.nome)}</option>`).join('');

  let tempo = null;
  document.getElementById('pp-busca').addEventListener('input', e => {
    clearTimeout(tempo);
    tempo = setTimeout(() => { Propostas.filtros.busca = e.target.value; Propostas.pagina = 1; carregarPropostas(); }, 350);
  });
  const datas = document.getElementById('pp-datas');
  const hoje = new Date();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  document.getElementById('pp-de').value = iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  document.getElementById('pp-ate').value = iso(hoje);
  document.getElementById('pp-periodo').addEventListener('change', e => {
    datas.hidden = e.target.value !== 'personalizado';
    if (!datas.hidden) { Propostas.filtros.de = document.getElementById('pp-de').value; Propostas.filtros.ate = document.getElementById('pp-ate').value; }
  });
  ['pp-de', 'pp-ate'].forEach(id => document.getElementById(id).addEventListener('change', e => {
    Propostas.filtros[id === 'pp-de' ? 'de' : 'ate'] = e.target.value; Propostas.pagina = 1; carregarPropostas();
  }));
  [['pp-campo-data', 'campo_data'], ['pp-periodo', 'periodo'], ['pp-consultor', 'closer_id'], ['pp-banco', 'banco_id'], ['pp-canal', 'canal_id']].forEach(([id, k]) => {
    document.getElementById(id).addEventListener('change', e => { Propostas.filtros[k] = e.target.value; Propostas.pagina = 1; carregarPropostas(); });
  });
  document.getElementById('pp-por-pagina').addEventListener('change', e => { Propostas.porPagina = Number(e.target.value); Propostas.pagina = 1; carregarPropostas(); });
  document.getElementById('pp-modos').addEventListener('click', e => {
    const b = e.target.closest('[data-modo]');
    if (!b || b.dataset.modo === Propostas.modo) return;
    Propostas.modo = b.dataset.modo; Propostas.pagina = 1;
    document.querySelectorAll('#pp-modos [data-modo]').forEach(x => x.setAttribute('aria-pressed', x.dataset.modo === Propostas.modo ? 'true' : 'false'));
    carregarPropostas();
  });
  document.getElementById('pp-exportar').addEventListener('click', ppExportar);
  document.getElementById('pp-filtros-fase').addEventListener('click', e => {
    const b = e.target.closest('[data-fase]');
    if (b) { Propostas.filtros.fase = b.dataset.fase; Propostas.filtros.status_id = ''; Propostas.pagina = 1; carregarPropostas(); return; }
    const s = e.target.closest('[data-status]');
    if (s) { Propostas.filtros.status_id = s.dataset.status; Propostas.pagina = 1; carregarPropostas(); }
  });
  document.getElementById('pp-conteudo').addEventListener('click', ppCliqueConteudo);
  document.getElementById('pp-conteudo').addEventListener('change', ppMudouSelecao);
  document.getElementById('pp-lote').addEventListener('click', e => {
    if (e.target.closest('[data-acao="limpar"]')) { Propostas.selecionados.clear(); ppRender(); }
    if (e.target.closest('[data-acao="atualizar"]')) ppAtualizarSelecionados();
  });
}

function ppRender() {
  const d = Propostas.dados;
  const fases = Propostas.listas.fases || [];
  const f = Propostas.filtros;
  const totalTodas = Object.values(d.contagem_fases || {}).reduce((a, b) => a + b, 0);
  const chip = (chave, nome, n) => `<button type="button" class="pp-chip" data-fase="${chave}" aria-pressed="${f.fase === chave}">${ppEsc(nome)} · ${n}</button>`;
  let html = `<div class="pp-chips" role="group" aria-label="Filtrar por fase">${chip('', 'Todas as fases', totalTodas)}${fases.map(x => chip(x.chave, x.nome, d.contagem_fases[x.chave] || 0)).join('')}</div>`;
  if (f.fase) {
    const sts = (Propostas.listas.status || []).filter(s => s.fase === f.fase && (s.ativo || d.contagem_status[s.id]));
    html += `<div class="pp-chips pp-chips-sub" role="group" aria-label="Status da fase">
      <button type="button" class="pp-chip pp-chip-sub" data-status="" aria-pressed="${!f.status_id}">Todos desta fase</button>
      ${sts.map(s => `<button type="button" class="pp-chip pp-chip-sub" data-status="${s.id}" aria-pressed="${String(f.status_id) === String(s.id)}">${ppEsc(s.nome)} · ${d.contagem_status[s.id] || 0}</button>`).join('')}
    </div>`;
  }
  document.getElementById('pp-filtros-fase').innerHTML = html;

  const alvo = document.getElementById('pp-conteudo');
  const vazio = Propostas.modo === 'grupo' ? !d.operacoes.length : !d.linhas.length;
  if (vazio) {
    const temFiltro = f.fase || f.status_id || f.busca || f.closer_id || f.banco_id || f.canal_id;
    alvo.innerHTML = `<p class="pp-vazio">${temFiltro ? 'Nenhum contrato com esses filtros.' : f.campo_data === 'liberacao' ? 'Nenhum contrato liberado (pago) neste período.' : 'Nenhum contrato subido neste período.'}${f.periodo !== 'todos' ? ' <button type="button" class="pp-link" data-acao="todo-periodo">Ver todo o período</button>' : ''}</p>`;
  } else {
    alvo.innerHTML = Propostas.modo === 'grupo' ? ppHtmlGrupo(d) : ppHtmlLista(d);
  }

  const total = d.total || 0;
  const ini = total ? (d.pagina - 1) * d.por_pagina + 1 : 0;
  const fim = Math.min(d.pagina * d.por_pagina, total);
  const paginas = Math.max(1, Math.ceil(total / d.por_pagina));
  const rotulo = Propostas.modo === 'grupo' ? 'operações' : 'contratos';
  document.getElementById('pp-rodape-info').textContent = `${ini}–${fim} de ${total} ${rotulo}` +
    (Propostas.modo === 'lista' && d.valor_liberado_total ? ` · valor liberado no filtro: ${ppMoeda(d.valor_liberado_total)}` : '');
  document.getElementById('pp-pagina').textContent = `Página ${d.pagina} de ${paginas}`;
  document.getElementById('pp-ant').disabled = d.pagina <= 1;
  document.getElementById('pp-prox').disabled = d.pagina >= paginas;
  ppRenderLote();
  if (window.lucide) lucide.createIcons();
}

function ppHtmlLista(d) {
  const mover = ppPodeMover();
  const idsPagina = d.linhas.map(l => l.id);
  const todos = idsPagina.length && idsPagina.every(i => Propostas.selecionados.has(i));
  return `<div class="pp-tabela pp-tabela-lista ${mover ? 'pp-com-check' : ''}" role="table" aria-label="Contratos">
    <div class="pp-row pp-row-head" role="row">
      ${mover ? `<span role="columnheader"><label class="pp-check"><input type="checkbox" data-acao="todos" ${todos ? 'checked' : ''} aria-label="Selecionar todos os contratos da página"></label></span>` : ''}
      <span role="columnheader">Operação</span><span role="columnheader">Cliente</span>
      <span role="columnheader">Contrato</span><span role="columnheader">Banco</span>
      <span role="columnheader">Consultor</span><span role="columnheader">Status</span>
      <span role="columnheader" class="pp-num">Parcela</span><span role="columnheader" class="pp-num">Saldo / liberado</span>
    </div>
    ${d.linhas.map(l => {
      const sel = Propostas.selecionados.has(l.id);
      const contrato = l.tipo === 'PORTABILIDADE' ? `Port ${ppEsc(l.numero_contrato || '')}` : l.tipo === 'REFIN-PORTABILIDADE' ? 'Refin da port' : ppEsc(l.tipo || '');
      return `<div class="pp-row ${sel ? 'pp-sel' : ''}" role="row">
        ${mover ? `<span role="cell"><label class="pp-check"><input type="checkbox" data-contrato="${l.id}" data-op="${l.operacao_id}" ${sel ? 'checked' : ''} aria-label="Selecionar ${ppEsc(l.cliente)} · ${contrato}"></label></span>` : ''}
        <span role="cell" class="pp-cliente"><button type="button" class="pp-link" data-abrir="${l.operacao_id}">${ppEsc(l.codigo)}</button><small>${ppData(l.operacao_em, true)} · ${ppEsc(l.produto || '')}${l.canal_venda ? ' · ' + ppEsc(l.canal_venda) : ''}</small></span>
        <span role="cell" class="pp-cliente"><strong>${ppEsc(l.cliente)}</strong><small>${ppEsc(typeof formatCpf === 'function' ? formatCpf(l.cpf) : l.cpf)}</small></span>
        <span role="cell">${contrato}</span>
        <span role="cell">${ppEsc(l.banco || '—')}</span>
        <span role="cell">${ppEsc(l.consultor || '—')}</span>
        <span role="cell"><span class="${ppStatusClasse(l.status)}">${ppEsc(l.status)}</span>${l.data_liberacao ? ` <small class="pp-liberado">em ${ppData(String(l.data_liberacao).slice(0, 10) + 'T12:00:00')}</small>` : ''}</span>
        <span role="cell" class="pp-num">${l.parcela != null ? ppMoeda(l.parcela) : '—'}</span>
        <span role="cell" class="pp-num">${l.tipo === 'PORTABILIDADE' ? ppMoeda(l.saldo_devedor) : ppMoeda(l.valor_liberado)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

const PP_FORMATO = {
  unico: () => 'Contrato único',
  portabilidades: n => `${n} portabilidades`,
  port_refin: n => `${n - 1} port + refin`
};

function ppHtmlGrupo(d) {
  const mover = ppPodeMover();
  return `<div class="pp-tabela pp-tabela-grupo ${mover ? 'pp-com-check' : ''}" role="table" aria-label="Operações">
    <div class="pp-row pp-row-head" role="row">
      ${mover ? '<span role="columnheader"><span class="pp-sr">Selecionar</span></span>' : ''}
      <span role="columnheader"><span class="pp-sr">Expandir</span></span>
      <span role="columnheader">Cliente / operação</span><span role="columnheader">Consultor</span><span role="columnheader">Composição</span>
      <span role="columnheader">Contratos por status</span><span role="columnheader" class="pp-num">Valor liberado</span><span role="columnheader">Subida em</span>
    </div>
    ${d.operacoes.map(op => {
      const aberto = Propostas.abertos.has(op.id);
      const marcados = op.contratos.filter(c => Propostas.selecionados.has(c.id)).length;
      const porStatus = {};
      op.contratos.forEach(c => { porStatus[c.status] = (porStatus[c.status] || 0) + 1; });
      const chips = Object.entries(porStatus).map(([s, n]) => `<span class="${ppStatusClasse(s)}">${n} ${ppEsc(s)}</span>`).join('');
      const filhos = aberto ? op.contratos.map(c => `<div class="pp-row pp-filho ${c.no_filtro ? '' : 'pp-fora'}" role="row">
          ${mover ? '<span role="cell"></span>' : ''}<span role="cell"></span>
          <span role="cell">${c.tipo === 'PORTABILIDADE' ? `Port ${ppEsc(c.numero_contrato || '')}` : c.tipo === 'REFIN-PORTABILIDADE' ? 'Refin da port' : ppEsc(c.tipo || '')}</span>
          <span role="cell"></span><span role="cell">${ppEsc(c.banco || '—')}</span>
          <span role="cell"><span class="${ppStatusClasse(c.status)}">${ppEsc(c.status)}</span>${c.no_filtro ? '' : ' <small class="pp-fora-tag">fora do filtro</small>'}</span>
          <span role="cell" class="pp-num">${c.tipo === 'PORTABILIDADE' ? ppMoeda(c.saldo_devedor) : ppMoeda(c.valor_liberado)}</span><span role="cell"></span>
        </div>`).join('') : '';
      return `<div class="pp-row ${marcados ? 'pp-sel' : ''}" role="row">
          ${mover ? `<span role="cell"><label class="pp-check"><input type="checkbox" data-op-inteira="${op.id}" ${marcados === op.contratos.length ? 'checked' : ''} aria-label="Selecionar a operação de ${ppEsc(op.cliente)}"></label></span>` : ''}
          <span role="cell"><button type="button" class="pp-expandir" data-expandir="${op.id}" aria-expanded="${aberto}" aria-label="${aberto ? 'Recolher' : 'Expandir'} contratos de ${ppEsc(op.cliente)}"><i data-lucide="${aberto ? 'chevron-down' : 'chevron-right'}"></i></button></span>
          <span role="cell" class="pp-cliente"><button type="button" class="pp-link" data-abrir="${op.id}"><strong>${ppEsc(op.cliente)}</strong></button><small>${ppEsc(op.codigo)} · ${ppEsc(op.produto || '')}${op.canal_venda ? ' · ' + ppEsc(op.canal_venda) : ''}</small></span>
          <span role="cell">${ppEsc(op.consultor || '—')}</span>
          <span role="cell">${PP_FORMATO[op.formato] ? PP_FORMATO[op.formato](op.contratos.length) : ''}</span>
          <span role="cell" class="pp-chips-status">${chips}</span>
          <span role="cell" class="pp-num">${ppMoeda(op.valor_liberado)}</span>
          <span role="cell" class="pp-muted">${ppData(op.created_at)}</span>
        </div>${filhos}`;
    }).join('')}
  </div>`;
}

function ppCliqueConteudo(e) {
  const abrir = e.target.closest('[data-abrir]');
  if (abrir) {
    const id = Number(abrir.dataset.abrir);
    const seq = Propostas.modo === 'grupo'
      ? Propostas.dados.operacoes.map(o => o.id)
      : [...new Set(Propostas.dados.linhas.map(l => l.operacao_id))];
    abrirAtualizarOperacao(id, { sequencia: seq, aoMudar: carregarPropostas });
    return;
  }
  const exp = e.target.closest('[data-expandir]');
  if (exp) {
    const id = Number(exp.dataset.expandir);
    if (Propostas.abertos.has(id)) Propostas.abertos.delete(id); else Propostas.abertos.add(id);
    ppRender();
    return;
  }
  if (e.target.closest('[data-acao="todo-periodo"]')) {
    Propostas.filtros.periodo = 'todos';
    document.getElementById('pp-periodo').value = 'todos';
    document.getElementById('pp-datas').hidden = true;
    carregarPropostas();
  }
}

function ppMudouSelecao(e) {
  const t = e.target;
  if (t.dataset.acao === 'todos') {
    Propostas.dados.linhas.forEach(l => { if (t.checked) Propostas.selecionados.set(l.id, l.operacao_id); else Propostas.selecionados.delete(l.id); });
  } else if (t.dataset.contrato) {
    if (t.checked) Propostas.selecionados.set(Number(t.dataset.contrato), Number(t.dataset.op));
    else Propostas.selecionados.delete(Number(t.dataset.contrato));
  } else if (t.dataset.opInteira) {
    const op = Propostas.dados.operacoes.find(o => o.id === Number(t.dataset.opInteira));
    op.contratos.forEach(c => { if (t.checked) Propostas.selecionados.set(c.id, op.id); else Propostas.selecionados.delete(c.id); });
  } else return;
  ppRender();
}

function ppRenderLote() {
  const barra = document.getElementById('pp-lote');
  const n = Propostas.selecionados.size;
  if (!n || !ppPodeMover()) { barra.hidden = true; return; }
  const opsSel = new Set(Propostas.selecionados.values());
  barra.hidden = false;
  barra.innerHTML = `<span><strong>${n} contrato${n > 1 ? 's' : ''}</strong> de ${opsSel.size} operaç${opsSel.size > 1 ? 'ões' : 'ão'}</span>
    <button type="button" class="btn btn-primary pp-btn-sm" data-acao="atualizar">Atualizar operação${opsSel.size > 1 ? ' (uma por vez)' : ''}</button>
    <span class="pp-muted pp-lote-dica">Abre a atualização com estes contratos já marcados.</span>
    <button type="button" class="btn btn-secondary pp-btn-sm" data-acao="limpar">Limpar seleção</button>`;
}

function ppAtualizarSelecionados() {
  const porOp = new Map();
  Propostas.selecionados.forEach((op, contrato) => { if (!porOp.has(op)) porOp.set(op, []); porOp.get(op).push(contrato); });
  const seq = [...porOp.keys()];
  abrirAtualizarOperacao(seq[0], {
    sequencia: seq,
    preSelecionados: porOp,
    aoMudar: () => { Propostas.selecionados.clear(); carregarPropostas(); }
  });
}

function ppPagina(delta) {
  Propostas.pagina = Math.max(1, Propostas.pagina + delta);
  carregarPropostas();
}

async function ppExportar() {
  const btn = document.getElementById('pp-exportar');
  btn.disabled = true;
  try {
    const modo = Propostas.modo; Propostas.modo = 'lista';
    const q = ppQuery({ formato: 'csv' }); Propostas.modo = modo;
    const res = await fetchWithAuth('/api/contratos/propostas?' + q);
    if (!res.ok) throw new Error('Não foi possível exportar.');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `propostas-digitadas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
