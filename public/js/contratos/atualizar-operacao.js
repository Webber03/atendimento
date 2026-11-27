// Modal "Atualizar operação": mover status (atalhos ou qualquer status), cancelar,
// parceiro, histórico, Editar proposta e Desfazer. Abre por cima de qualquer tela.

const AtuOp = {
  id: null, dados: null, listas: null, seq: [], pre: null, aoMudar: null,
  modo: 'mover', verTodos: false, destino: null, salvando: false
};
const AO_LIMITE = 6;

function aoEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function aoMoeda(v) {
  return v === null || v === undefined || v === '' ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const aoTravado = c => c.status === 'PAGO' || c.status === 'CANCELADO';
const aoNomeContrato = c => c.tipo === 'PORTABILIDADE' ? `Port nº ${aoEsc(c.numero_contrato || '')}` : c.tipo === 'REFIN-PORTABILIDADE' ? 'Refin da port' : aoEsc(c.tipo || 'Contrato');
const aoClasse = s => s === 'PAGO' ? 'ao-st ao-st-pago' : s === 'CANCELADO' ? 'ao-st ao-st-cancelado' : 'ao-st';

async function abrirAtualizarOperacao(opId, opcoes = {}) {
  AtuOp.seq = opcoes.sequencia || [opId];
  AtuOp.pre = opcoes.preSelecionados || null;
  AtuOp.aoMudar = opcoes.aoMudar || null;
  if (!AtuOp.listas) {
    try { AtuOp.listas = await fetchWithAuth('/api/contratos/listas').then(r => r.json()); }
    catch (err) { showToast('Não foi possível abrir: ' + err.message, 'error'); return; }
  }
  aoGarantirModal();
  await aoCarregar(opId);
}

function aoGarantirModal() {
  if (document.getElementById('ao-modal')) return;
  const m = document.createElement('div');
  m.id = 'ao-modal';
  m.className = 'ao-fundo';
  m.hidden = true;
  m.innerHTML = '<div class="ao-caixa" role="dialog" aria-modal="true" aria-labelledby="ao-titulo"></div>';
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) aoFechar(); });
  m.addEventListener('click', aoClique);
  m.addEventListener('change', aoMudou);
  document.addEventListener('keydown', e => {
    if (document.getElementById('ao-modal')?.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); aoFechar(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && AtuOp.modo === 'mover' && AtuOp.dados?.permissoes.pode_mover) {
      e.preventDefault();
      aoAplicar(aoTemProxima());
    }
  });
}

async function aoCarregar(opId) {
  AtuOp.id = opId;
  AtuOp.modo = 'mover';
  AtuOp.verTodos = false;
  AtuOp.destino = null;
  const m = document.getElementById('ao-modal');
  const caixa = m.querySelector('.ao-caixa');
  caixa.innerHTML = '<p class="ao-carregando">Carregando operação…</p>';
  m.hidden = false;
  document.body.classList.add('ao-aberto');
  try {
    const res = await fetchWithAuth(`/api/contratos/operacoes/${opId}`);
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.error || 'Erro ao carregar.');
    AtuOp.dados = dados;
    aoRender();
  } catch (err) {
    caixa.innerHTML = `<p class="ao-carregando">Não foi possível abrir a operação: ${aoEsc(err.message)}</p><div class="ao-rodape"><span></span><button type="button" class="btn btn-secondary" data-acao="fechar">Fechar</button></div>`;
  }
}

function aoFechar() {
  const m = document.getElementById('ao-modal');
  if (!m || m.hidden) return;
  m.hidden = true;
  document.body.classList.remove('ao-aberto');
}

function aoTemProxima() {
  const i = AtuOp.seq.indexOf(AtuOp.id);
  return i >= 0 && i < AtuOp.seq.length - 1;
}

// Status de referência: o dos pré-selecionados ou o mais comum entre os contratos que podem andar
function aoStatusReferencia() {
  const cs = AtuOp.dados.contratos;
  const pre = AtuOp.pre && AtuOp.pre.get(AtuOp.id);
  if (pre && pre.length) {
    const c = cs.find(x => pre.includes(x.id));
    if (c) return c.status_id;
  }
  const cont = {};
  cs.filter(c => !aoTravado(c)).forEach(c => { cont[c.status_id] = (cont[c.status_id] || 0) + 1; });
  const top = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];
  return top ? Number(top[0]) : null;
}

function aoMarcadoInicial(c, ref) {
  if (aoTravado(c)) return false;
  const pre = AtuOp.pre && AtuOp.pre.get(AtuOp.id);
  if (AtuOp.modo === 'cancelar') return !!(pre && pre.includes(c.id));
  if (pre && pre.length) return pre.includes(c.id);
  return c.status_id === ref;
}

function aoRender() {
  const { operacao: op, contratos: cs, historico, permissoes: perm } = AtuOp.dados;
  const caixa = document.querySelector('#ao-modal .ao-caixa');
  const i = AtuOp.seq.indexOf(AtuOp.id);
  const nav = AtuOp.seq.length > 1 ? `<span class="ao-pos">${i + 1} de ${AtuOp.seq.length}</span>
      <button type="button" class="ao-ico" data-acao="anterior" ${i <= 0 ? 'disabled' : ''} aria-label="Operação anterior"><i data-lucide="chevron-left"></i></button>
      <button type="button" class="ao-ico" data-acao="proxima" ${!aoTemProxima() ? 'disabled' : ''} aria-label="Próxima operação"><i data-lucide="chevron-right"></i></button>` : '';
  const formato = op.formato === 'unico' ? 'Contrato único' : op.formato === 'portabilidades' ? `${cs.length} portabilidades` : `${cs.length - 1} portabilidades + refin da port`;
  const cancelar = AtuOp.modo === 'cancelar';
  caixa.classList.toggle('ao-caixa-cancelar', cancelar);

  const cab = `<div class="ao-topo">
      <div class="ao-topo-txt">
        ${cancelar ? '<button type="button" class="ao-voltar" data-acao="voltar"><i data-lucide="chevron-left"></i> Voltar para Atualizar operação</button>' : ''}
        <h2 id="ao-titulo">${cancelar ? 'Cancelar contratos' : perm.pode_mover ? 'Atualizar operação' : 'Operação'} · ${aoEsc(op.cliente)}</h2>
        <span>${aoEsc(op.codigo)} · ${formato} · ${aoEsc(op.produto || '')}${op.canal_venda ? ' · canal ' + aoEsc(op.canal_venda) : ''} · consultor ${aoEsc(op.consultor || '—')}${op.parceiro ? ' · parceiro ' + aoEsc(op.parceiro) : ''}</span>
      </div>
      <div class="ao-topo-acoes">${cancelar ? '' : nav}<button type="button" class="ao-ico" data-acao="fechar" aria-label="Fechar"><i data-lucide="x"></i></button></div>
    </div>`;

  let corpo = '';
  let rodape = '';
  if (!perm.pode_mover) {
    corpo = `${aoListaContratos(cs, null, false)}${perm.motivo_editar ? `<p class="ao-aviso">${aoEsc(perm.motivo_editar)}</p>` : ''}${aoHistorico(historico)}`;
    rodape = `<div class="ao-rodape"><div>${perm.pode_editar ? '<button type="button" class="ao-btn" data-acao="editar"><i data-lucide="pencil"></i> Editar proposta</button>' : ''}</div>
      <div><button type="button" class="ao-btn" data-acao="fechar">Fechar</button></div></div>`;
  } else if (cancelar) {
    corpo = `${aoListaContratos(cs, null, true)}
      <label class="ao-campo">Observação do cancelamento<input type="text" class="form-input" id="ao-obs" maxlength="1000" placeholder="Ex.: cliente desistiu após contraproposta do banco"></label>
      <div class="ao-resumo-cancel" id="ao-resumo" aria-live="polite"></div>`;
    rodape = `<div class="ao-rodape"><span></span>
      <div><button type="button" class="ao-btn" data-acao="voltar">Voltar</button>
      <button type="button" class="ao-btn ao-btn-perigo" data-acao="confirmar-cancelamento" id="ao-btn-cancelar">Cancelar contratos</button></div></div>`;
  } else {
    const ref = aoStatusReferencia();
    const st = AtuOp.listas.status || [];
    const refStatus = st.find(s => s.id === ref);
    const atalhos = refStatus ? refStatus.atalhos.map(id => st.find(s => s.id === id)).filter(s => s && s.ativo) : [];
    if (!AtuOp.destino) AtuOp.destino = atalhos[0] ? atalhos[0].id : null;
    const ehAtalho = atalhos.some(a => a.id === AtuOp.destino);
    const grupos = (AtuOp.listas.fases || []).map(f => {
      const doGrupo = st.filter(s => s.fase === f.chave && s.ativo && s.nome !== 'CANCELADO');
      return doGrupo.length ? `<optgroup label="${aoEsc(f.nome)}">${doGrupo.map(s => `<option value="${s.id}" ${!ehAtalho && s.id === AtuOp.destino ? 'selected' : ''}>${aoEsc(s.nome)}</option>`).join('')}</optgroup>` : '';
    }).join('');
    const destino = st.find(s => s.id === AtuOp.destino);
    const parceiros = (AtuOp.listas.parceiro || []).filter(p => p.ativo || p.id === op.parceiro_id);
    corpo = `<div class="ao-bloco">
        <span class="ao-rot" id="ao-rot-destino">Mover para</span>
        <div class="ao-destinos" role="radiogroup" aria-labelledby="ao-rot-destino">
          ${atalhos.map(a => `<label class="ao-chip ${a.id === AtuOp.destino ? 'on' : ''}"><input type="radio" name="ao-destino" value="${a.id}" ${a.id === AtuOp.destino ? 'checked' : ''}> ${aoEsc(a.nome)}</label>`).join('')}
          <select class="form-input ao-qualquer ${!ehAtalho && AtuOp.destino ? 'on' : ''}" id="ao-qualquer" aria-label="Qualquer status"><option value="">Qualquer status…</option>${grupos}</select>
        </div>
      </div>
      ${aoListaContratos(cs, ref, true)}
      <div class="ao-grid">
        <label class="ao-campo">Observação<input type="text" class="form-input" id="ao-obs" maxlength="1000" placeholder="Ex.: saldos recebidos do banco"></label>
        <label class="ao-campo">Parceiro<select class="form-input" id="ao-parceiro">${parceiros.map(p => `<option value="${p.id}" ${p.id === op.parceiro_id ? 'selected' : ''}>${aoEsc(p.nome)}</option>`).join('')}${op.parceiro_id ? '' : '<option value="" selected>—</option>'}</select></label>
      </div>
      ${destino && destino.nome === 'PAGO' ? `<label class="ao-campo ao-campo-data">Data de liberação <abbr title="obrigatório">*</abbr><input type="date" class="form-input" id="ao-data-lib" value="${new Date().toISOString().slice(0, 10)}"></label>` : ''}
      ${aoHistorico(historico)}`;
    const prox = aoTemProxima();
    rodape = `<div class="ao-rodape">
      <div>${perm.pode_editar ? '<button type="button" class="ao-btn" data-acao="editar"><i data-lucide="pencil"></i> Editar proposta</button>' : ''}
        <button type="button" class="ao-btn ao-btn-perigo-borda" data-acao="cancelar">Cancelar contratos…</button></div>
      <div><button type="button" class="ao-btn" data-acao="aplicar" id="ao-btn-aplicar">Aplicar</button>
        ${prox ? '<button type="button" class="ao-btn ao-btn-primario" data-acao="aplicar-proxima" id="ao-btn-proxima">Mover e ir para a próxima</button>' : ''}
      </div></div>`;
  }

  caixa.innerHTML = `${cab}<div class="ao-corpo">${corpo}</div>${rodape}`;
  if (window.lucide) lucide.createIcons();
  aoAtualizarContagem();
  caixa.querySelector('#ao-titulo')?.focus?.();
}

function aoListaContratos(cs, ref, comCheck) {
  const ordenados = [...cs];
  const visiveis = AtuOp.verTodos || ordenados.length <= AO_LIMITE + 1 ? ordenados : ordenados.slice(0, AO_LIMITE);
  const resto = ordenados.length - visiveis.length;
  const cancelar = AtuOp.modo === 'cancelar';
  const marcarRot = cancelar ? `Marcar os ${cs.filter(c => !aoTravado(c)).length} que podem` : 'Marcar todos os que podem';
  const topo = comCheck
    ? `<div class="ao-lista-topo"><span>${cancelar ? 'Nada vem marcado: escolha os contratos que vão ser cancelados.' : (AtuOp.pre && AtuOp.pre.get(AtuOp.id) ? 'Marcados os que você selecionou na lista.' : 'Marcados os que estão no mesmo status. Desmarque as exceções.')}</span>
       <span><button type="button" class="ao-link" data-acao="marcar-todos">${marcarRot}</button> · <button type="button" class="ao-link" data-acao="desmarcar">Desmarcar</button></span></div>`
    : '';
  const linhas = ordenados.map((c, idx) => {
    const travado = aoTravado(c);
    const marcado = comCheck && aoMarcadoInicial(c, ref);
    const det = [aoEsc(c.banco || '—')];
    if (c.parcela != null) det.push('parcela ' + aoMoeda(c.parcela));
    if (c.tipo === 'PORTABILIDADE' && c.saldo_devedor != null) det.push('saldo ' + aoMoeda(c.saldo_devedor));
    if (c.tipo !== 'PORTABILIDADE' && c.valor_liberado != null) det.push('liberado ' + aoMoeda(c.valor_liberado));
    const oculto = idx >= visiveis.length ? ' hidden' : '';
    const conteudo = `<span class="ao-c-nome">${aoNomeContrato(c)}</span><span class="ao-c-det">${det.join(' · ')}</span><span class="${aoClasse(c.status)}"${stCorAttr(c.status_cor)}>${aoEsc(c.status)}</span>`;
    return comCheck
      ? `<label class="ao-linha ${travado ? 'ao-travado' : ''}"${oculto}><input type="checkbox" data-contrato="${c.id}" ${marcado ? 'checked' : ''} ${travado ? 'disabled' : ''}>${conteudo}</label>`
      : `<div class="ao-linha ao-sem-check"${oculto}>${conteudo}</div>`;
  }).join('');
  const mais = resto > 0 ? `<button type="button" class="ao-mais" data-acao="ver-todos"><i data-lucide="chevron-down"></i> Mostrar os outros ${resto} contratos</button>` : '';
  return `<fieldset class="ao-lista"><legend class="ao-sr">Contratos da operação</legend>${topo}${linhas}${mais}</fieldset>`;
}

function aoHistorico(h) {
  if (!h || !h.length) return '';
  const itens = h.slice(0, 40).map(x => {
    let txt = x.observacao || '';
    if (x.tipo === 'status' || x.tipo === 'desfeito') {
      txt = `${x.status_anterior ? aoEsc(x.status_anterior) + ' → ' : ''}<strong>${aoEsc(x.status_novo || '')}</strong>${x.observacao ? ' · “' + aoEsc(x.observacao) + '”' : ''}${x.tipo === 'desfeito' ? ' <em>(desfeito)</em>' : ''}`;
    } else txt = aoEsc(txt);
    return `<li><span>${txt}</span><span class="ao-h-quem">${aoEsc(x.usuario || '')} · ${new Date(x.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></li>`;
  }).join('');
  return `<details class="ao-historico"><summary>Histórico da operação (${h.length})</summary><ol>${itens}</ol></details>`;
}

function aoMarcados() {
  return [...document.querySelectorAll('#ao-modal [data-contrato]:checked')].map(i => Number(i.dataset.contrato));
}

function aoAtualizarContagem() {
  const n = aoMarcados().length;
  if (AtuOp.modo === 'cancelar') {
    const cs = AtuOp.dados.contratos;
    const marc = new Set(aoMarcados());
    const encerrados = cs.filter(aoTravado).length;
    const continuam = cs.length - encerrados - marc.size;
    const r = document.getElementById('ao-resumo');
    if (r) r.innerHTML = `<strong>Como a operação fica depois</strong>
      <span><strong class="ao-vermelho">${marc.size} contrato${marc.size !== 1 ? 's' : ''}</strong> passa${marc.size !== 1 ? 'm' : ''} para CANCELADO</span>
      ${continuam ? `<span><strong>${continuam} contrato${continuam !== 1 ? 's' : ''}</strong> ${continuam !== 1 ? 'continuam como estão' : 'continua como está'}</span>` : ''}
      ${encerrados ? `<span><strong>${encerrados} contrato${encerrados !== 1 ? 's' : ''}</strong> já estava${encerrados !== 1 ? 'm' : ''} encerrado${encerrados !== 1 ? 's' : ''} e não muda${encerrados !== 1 ? 'm' : ''}</span>` : ''}`;
    const b = document.getElementById('ao-btn-cancelar');
    if (b) { b.textContent = n ? `Cancelar ${n} contrato${n > 1 ? 's' : ''}` : 'Marque os contratos'; b.disabled = !n || AtuOp.salvando; }
    return;
  }
  const b1 = document.getElementById('ao-btn-aplicar');
  const b2 = document.getElementById('ao-btn-proxima');
  if (b1) { b1.textContent = n ? `Aplicar em ${n}` : 'Aplicar'; b1.disabled = AtuOp.salvando; }
  if (b2) { b2.textContent = n ? `Mover ${n} e ir para a próxima` : 'Ir para a próxima'; b2.disabled = AtuOp.salvando; }
}

function aoMudou(e) {
  const t = e.target;
  if (t.name === 'ao-destino') { AtuOp.destino = Number(t.value); aoRenderMantendoMarcados(); return; }
  if (t.id === 'ao-qualquer') { if (t.value) { AtuOp.destino = Number(t.value); aoRenderMantendoMarcados(); } return; }
  if (t.dataset.contrato) aoAtualizarContagem();
}

// Redesenha sem perder as marcações, a observação e a escolha de "ver todos"
function aoRenderMantendoMarcados() {
  const marc = aoMarcados();
  const obs = document.getElementById('ao-obs')?.value || '';
  const parc = document.getElementById('ao-parceiro')?.value;
  AtuOp.pre = new Map([...(AtuOp.pre || new Map())]);
  AtuOp.pre.set(AtuOp.id, marc);
  aoRender();
  const o = document.getElementById('ao-obs'); if (o) o.value = obs;
  const p = document.getElementById('ao-parceiro'); if (p && parc !== undefined) p.value = parc;
}

function aoClique(e) {
  const b = e.target.closest('[data-acao]');
  if (!b || b.disabled) return;
  const acao = b.dataset.acao;
  const idx = AtuOp.seq.indexOf(AtuOp.id);
  if (acao === 'fechar') return aoFechar();
  if (acao === 'anterior' && idx > 0) return aoCarregar(AtuOp.seq[idx - 1]);
  if (acao === 'proxima' && aoTemProxima()) return aoCarregar(AtuOp.seq[idx + 1]);
  if (acao === 'ver-todos') { AtuOp.verTodos = true; document.querySelectorAll('#ao-modal .ao-linha[hidden]').forEach(l => { l.hidden = false; }); b.remove(); return; }
  if (acao === 'marcar-todos' || acao === 'desmarcar') {
    document.querySelectorAll('#ao-modal [data-contrato]:not(:disabled)').forEach(i => { i.checked = acao === 'marcar-todos'; });
    aoAtualizarContagem();
    return;
  }
  if (acao === 'cancelar') { AtuOp.modo = 'cancelar'; return aoRender(); }
  if (acao === 'voltar') { AtuOp.modo = 'mover'; return aoRender(); }
  if (acao === 'editar') {
    const id = AtuOp.id;
    aoFechar();
    if (typeof abrirEdicaoOperacao === 'function') abrirEdicaoOperacao(id, { aoSalvar: AtuOp.aoMudar });
    return;
  }
  if (acao === 'aplicar') return aoAplicar(false);
  if (acao === 'aplicar-proxima') return aoAplicar(true);
  if (acao === 'confirmar-cancelamento') return aoCancelar();
}

async function aoSalvarParceiro() {
  const sel = document.getElementById('ao-parceiro');
  if (!sel || !sel.value || Number(sel.value) === AtuOp.dados.operacao.parceiro_id) return false;
  const res = await fetchWithAuth(`/api/contratos/operacoes/${AtuOp.id}/parceiro`, { method: 'PUT', body: JSON.stringify({ parceiro_id: Number(sel.value) }) });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(r.error || 'Não foi possível salvar o parceiro.');
  return true;
}

async function aoMover(statusId, ids, obs, extra = {}) {
  const res = await fetchWithAuth(`/api/contratos/operacoes/${AtuOp.id}/mover`, {
    method: 'POST', body: JSON.stringify({ status_id: statusId, contrato_ids: ids, observacao: obs, ...extra })
  });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(r.error || 'Não foi possível mover.');
  return r;
}

async function aoAplicar(irProxima) {
  if (AtuOp.salvando) return;
  const ids = aoMarcados();
  const obs = document.getElementById('ao-obs')?.value || '';
  AtuOp.salvando = true; aoAtualizarContagem();
  try {
    const parceiroMudou = await aoSalvarParceiro();
    let r = null;
    if (ids.length) {
      if (!AtuOp.destino) throw new Error('Escolha para qual status mover.');
      const dataLib = document.getElementById('ao-data-lib')?.value;
      r = await aoMover(AtuOp.destino, ids, obs, dataLib ? { data_liberacao: dataLib } : {});
    } else if (!parceiroMudou && !irProxima) {
      throw new Error('Marque os contratos que vão mudar de status.');
    }
    if (r) aoAvisoDesfazer(r, AtuOp.dados.operacao.cliente);
    else if (parceiroMudou) showToast('Parceiro atualizado.', 'success');
    if (AtuOp.aoMudar && (r || parceiroMudou)) AtuOp.aoMudar();
    if (typeof LeadContratos !== 'undefined' && LeadContratos.leadId && !document.getElementById('modal-lead-details')?.classList.contains('hidden')) carregarContratosDoLead(LeadContratos.leadId);
    const idx = AtuOp.seq.indexOf(AtuOp.id);
    if (irProxima && aoTemProxima()) { AtuOp.salvando = false; return aoCarregar(AtuOp.seq[idx + 1]); }
    aoFechar();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    AtuOp.salvando = false; aoAtualizarContagem();
  }
}

async function aoCancelar() {
  if (AtuOp.salvando) return;
  const ids = aoMarcados();
  if (!ids.length) return;
  const cancel = (AtuOp.listas.status || []).find(s => s.nome === 'CANCELADO');
  if (!cancel) { showToast('Status CANCELADO não encontrado nas Listas.', 'error'); return; }
  AtuOp.salvando = true; aoAtualizarContagem();
  try {
    const r = await aoMover(cancel.id, ids, document.getElementById('ao-obs')?.value || '');
    aoAvisoDesfazer(r, AtuOp.dados.operacao.cliente);
    if (AtuOp.aoMudar) AtuOp.aoMudar();
    if (typeof LeadContratos !== 'undefined' && LeadContratos.leadId && !document.getElementById('modal-lead-details')?.classList.contains('hidden')) carregarContratosDoLead(LeadContratos.leadId);
    aoFechar();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    AtuOp.salvando = false; aoAtualizarContagem();
  }
}

// Aviso com "Desfazer" (o servidor aceita desfazer por alguns minutos)
function aoAvisoDesfazer(r, cliente) {
  let av = document.getElementById('ao-desfazer');
  if (!av) {
    av = document.createElement('div');
    av.id = 'ao-desfazer';
    av.className = 'ao-desfazer';
    av.setAttribute('role', 'status');
    document.body.appendChild(av);
  }
  clearTimeout(av._t);
  av.innerHTML = `<span><strong>${r.movidos} contrato${r.movidos > 1 ? 's' : ''}</strong> de ${aoEsc(cliente)} movido${r.movidos > 1 ? 's' : ''} para ${aoEsc(r.status)}</span>
    <button type="button" class="ao-desfazer-btn"><i data-lucide="undo-2"></i> Desfazer</button>`;
  av.hidden = false;
  if (window.lucide) lucide.createIcons();
  av.querySelector('button').onclick = async () => {
    av.hidden = true;
    try {
      const res = await fetchWithAuth(`/api/contratos/lotes/${r.lote}/desfazer`, { method: 'POST' });
      const x = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(x.error || 'Não foi possível desfazer.');
      showToast(x.mantidos ? `Desfeito em ${x.desfeitos}; ${x.mantidos} já tinham mudado de novo e ficaram como estão.` : 'Movimento desfeito.', 'success');
      if (AtuOp.aoMudar) AtuOp.aoMudar();
      if (typeof LeadContratos !== 'undefined' && LeadContratos.leadId) carregarContratosDoLead(LeadContratos.leadId);
      if (!document.getElementById('ao-modal')?.hidden) aoCarregar(AtuOp.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  av._t = setTimeout(() => { av.hidden = true; }, 15000);
}
