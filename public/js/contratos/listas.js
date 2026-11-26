// Contratos › Listas & Status
// Bancos (com "nomes nos documentos"), produtos, tabelas, tipos, parceiros e status.
// Só Operacional e Admin editam; nada é apagado, só desativado.

const ContratosListas = {
  dados: null,
  aba: 'status',
  busca: '',
  mostrarDesativados: false,
  editando: null,      // id do item em edição
  addNomeBanco: null,  // id do banco com o campo "+ nome" aberto
  iniciado: false
};

const CL_ABAS = [
  { chave: 'status', titulo: 'Status', item: 'status', sub: 'fase e atalhos',
    ajuda: 'As fases só organizam a esteira: qualquer status pode ir para qualquer outro. Atalhos são os status sugeridos primeiro na hora de atualizar.' },
  { chave: 'banco', titulo: 'Bancos', item: 'banco', sub: 'e nomes nos documentos',
    ajuda: '“Nomes nos documentos” é como o banco aparece no espelho da proposta; é assim que a leitura reconhece cada linha.' },
  { chave: 'produto', titulo: 'Convênios', item: 'produto', ajuda: 'Convênio escolhido em cada operação (GOV BA, INSS, SIAPE…).' },
  { chave: 'tabela', titulo: 'Tabelas', item: 'tabela', ajuda: 'Tabela do refin da port.' },
  { chave: 'tipo', titulo: 'Tipos', item: 'tipo', ajuda: 'Tipo de cada contrato. Em “Só portabilidades” e “Portabilidades + refin” o tipo é gravado sozinho.' },
  { chave: 'parceiro', titulo: 'Parceiros', item: 'parceiro', ajuda: 'Parceiro da operação. Só Operacional e Admin preenchem.' }
];

function clEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clPodeEditar() {
  const u = typeof getUser === 'function' ? getUser() : null;
  return !!u && ['admin', 'operacional'].includes(u.role);
}

function clAba() {
  return CL_ABAS.find(a => a.chave === ContratosListas.aba) || CL_ABAS[0];
}

function clItens(chave) {
  const d = ContratosListas.dados;
  if (!d) return [];
  return chave === 'status' ? d.status : (d[chave] || []);
}

function clFaseNome(chave) {
  const f = (ContratosListas.dados?.fases || []).find(x => x.chave === chave);
  return f ? f.nome : chave;
}

async function clRequisicao(url, opcoes = {}) {
  const res = await fetchWithAuth(url, opcoes);
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo.error || 'Não foi possível salvar.');
  return corpo;
}

async function carregarListasContratos() {
  if (!ContratosListas.iniciado) clIniciar();
  try {
    ContratosListas.dados = await clRequisicao('/api/contratos/listas');
    clRender();
  } catch (err) {
    document.getElementById('cl-lista').innerHTML =
      `<p class="cl-vazio">Não foi possível carregar as listas: ${clEsc(err.message)} <button type="button" class="btn btn-secondary cl-btn-sm" onclick="carregarListasContratos()">Tentar de novo</button></p>`;
  }
}

function clIniciar() {
  ContratosListas.iniciado = true;
  document.getElementById('cl-busca').addEventListener('input', (e) => {
    ContratosListas.busca = e.target.value;
    clRenderLista();
  });
  document.getElementById('cl-desativados').addEventListener('change', (e) => {
    ContratosListas.mostrarDesativados = e.target.checked;
    clRenderLista();
  });
  document.getElementById('cl-btn-novo').addEventListener('click', clAbrirNovo);
  document.getElementById('cl-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-aba]');
    if (!b) return;
    ContratosListas.aba = b.dataset.aba;
    ContratosListas.editando = null;
    ContratosListas.addNomeBanco = null;
    ContratosListas.busca = '';
    document.getElementById('cl-busca').value = '';
    document.getElementById('cl-novo').hidden = true;
    clRender();
  });
  document.getElementById('cl-lista').addEventListener('click', clCliqueLista);
  document.getElementById('cl-lista').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { ContratosListas.editando = null; ContratosListas.addNomeBanco = null; clRenderLista(); }
    if (e.key === 'Enter' && e.target.matches('[data-enter]')) {
      e.preventDefault();
      const btn = e.target.closest('[data-linha]')?.querySelector(`[data-acao="${e.target.dataset.enter}"]`);
      if (btn) btn.click();
    }
  });
}

function clRender() {
  const editar = clPodeEditar();
  const aba = clAba();
  document.getElementById('cl-nav').innerHTML = CL_ABAS.map(a => {
    const ativos = clItens(a.chave).filter(i => i.ativo).length;
    const atual = a.chave === ContratosListas.aba;
    return `<button type="button" data-aba="${a.chave}" ${atual ? 'aria-current="page"' : ''}>
      <span><span class="cl-nav-titulo">${a.titulo}</span>${a.sub ? `<small>${a.sub}</small>` : ''}</span>
      <span class="cl-nav-n">${ativos}</span></button>`;
  }).join('');
  document.getElementById('cl-titulo').textContent = aba.titulo;
  document.getElementById('cl-ajuda').textContent = aba.ajuda;
  document.getElementById('cl-btn-novo').style.display = editar ? '' : 'none';
  document.getElementById('cl-rodape-texto').textContent = editar
    ? 'Itens não são apagados: desativar tira o item das listas de escolha e mantém o nome em tudo que já foi digitado. Só Operacional e Admin editam.'
    : 'Somente consulta: estas são as opções que aparecem ao digitar um contrato. Para incluir ou mudar algo, fale com o Operacional.';
  document.getElementById('cl-btn-novo-texto').textContent = aba.chave === 'status' ? 'Novo status' : `Adicionar ${aba.titulo.toLowerCase().replace(/s$/, '').replace(/ênio$/, 'ênio')}`;
  clRenderLista();
}

function clFiltrar(itens) {
  const termo = ContratosListas.busca.trim().toUpperCase();
  return itens.filter(i => {
    if (!ContratosListas.mostrarDesativados && !i.ativo && i.id !== ContratosListas.editando) return false;
    if (!termo) return true;
    if (i.nome.toUpperCase().includes(termo)) return true;
    return (i.nomes_documentos || []).some(n => n.nome.toUpperCase().includes(termo));
  });
}

function clRenderLista() {
  const aba = clAba();
  const itens = clItens(aba.chave);
  const desativados = itens.filter(i => !i.ativo).length;
  document.getElementById('cl-desativados-texto').textContent = `Mostrar desativados (${desativados})`;
  const alvo = document.getElementById('cl-lista');
  const visiveis = clFiltrar(itens);

  if (!visiveis.length) {
    alvo.innerHTML = `<p class="cl-vazio">${ContratosListas.busca ? 'Nada encontrado com essa busca.' : 'Nenhum item nesta lista.'}</p>`;
    return;
  }

  if (aba.chave === 'status') {
    const fases = ContratosListas.dados.fases;
    alvo.innerHTML = fases.map(f => {
      const doGrupo = visiveis.filter(s => s.fase === f.chave);
      if (!doGrupo.length) return '';
      return `<div class="cl-grupo"><h3 class="cl-grupo-titulo">${clEsc(f.nome)} <span>${doGrupo.length}</span></h3>${doGrupo.map(clLinhaStatus).join('')}</div>`;
    }).join('');
  } else {
    alvo.innerHTML = visiveis.map(i => clLinhaItem(i, aba.chave)).join('');
  }
  if (window.lucide) lucide.createIcons();
  const foco = alvo.querySelector('[data-autofoco]');
  if (foco) { foco.focus(); if (foco.select) foco.select(); }
}

function clBotoesItem(i) {
  if (!clPodeEditar()) return '';
  return `<span class="cl-acoes">
    <button type="button" class="btn btn-secondary cl-btn-sm" data-acao="editar" aria-label="Editar ${clEsc(i.nome)}">Editar</button>
    ${i.inicial ? '' : `<button type="button" class="btn btn-secondary cl-btn-sm" data-acao="${i.ativo ? 'desativar' : 'reativar'}">${i.ativo ? 'Desativar' : 'Reativar'}</button>`}
  </span>`;
}

function clLinhaItem(i, lista) {
  const ed = ContratosListas.editando === i.id;
  const nomeHtml = ed
    ? `<input type="text" class="form-input cl-input" value="${clEsc(i.nome)}" maxlength="120" data-campo="nome" data-enter="salvar" data-autofoco aria-label="Nome">`
    : `<span class="cl-nome">${clEsc(i.nome)}</span>`;
  const acoes = ed
    ? `<span class="cl-acoes"><button type="button" class="btn btn-primary cl-btn-sm" data-acao="salvar">Salvar</button><button type="button" class="btn btn-secondary cl-btn-sm" data-acao="cancelar">Cancelar</button></span>`
    : clBotoesItem(i);

  let docs = '';
  if (lista === 'banco') {
    const chips = (i.nomes_documentos || []).map(n => {
      const aprendido = n.origem === 'aprendido';
      const titulo = aprendido ? `Aprendido${n.usuario ? ' com ' + n.usuario : ''}${n.created_at ? ' em ' + new Date(n.created_at).toLocaleDateString('pt-BR') : ''}` : '';
      return `<span class="cl-chip ${aprendido ? 'cl-chip-aprendido' : ''}" ${titulo ? `title="${clEsc(titulo)}"` : ''}>${clEsc(n.nome)}${aprendido ? ' · aprendido' : ''}${clPodeEditar() ? `<button type="button" class="cl-chip-x" data-acao="tirar-nome" data-nome-id="${n.id}" aria-label="Tirar ${clEsc(n.nome)}"><i data-lucide="x"></i></button>` : ''}</span>`;
    }).join('');
    const adicionando = ContratosListas.addNomeBanco === i.id;
    const add = !clPodeEditar() ? '' : adicionando
      ? `<span class="cl-add-nome"><input type="text" class="form-input cl-input" maxlength="160" placeholder="Como aparece no documento" data-campo="nome-doc" data-enter="salvar-nome" data-autofoco aria-label="Nome no documento para ${clEsc(i.nome)}"><button type="button" class="btn btn-primary cl-btn-sm" data-acao="salvar-nome">Incluir</button><button type="button" class="btn btn-secondary cl-btn-sm" data-acao="cancelar-nome">Cancelar</button></span>`
      : `<button type="button" class="cl-chip-add" data-acao="add-nome">+ nome no documento</button>`;
    docs = `<div class="cl-docs">${chips}${add}</div>`;
  }

  return `<div class="cl-linha ${i.ativo ? '' : 'cl-desativado'}" data-linha data-id="${i.id}" data-lista="${lista}">
    <div class="cl-linha-topo"><span class="cl-col-nome">${nomeHtml}${i.ativo ? '' : '<span class="cl-tag">desativado</span>'}</span>${docs}${acoes}</div>
  </div>`;
}

function clLinhaStatus(s) {
  const todos = ContratosListas.dados.status;
  const nomeDe = id => (todos.find(x => x.id === id) || {}).nome || '';
  const ed = ContratosListas.editando === s.id;
  const tag = s.nome === 'PAGO' ? 'cl-st-pago' : s.nome === 'CANCELADO' ? 'cl-st-cancelado' : '';

  if (!ed) {
    const atalhos = s.atalhos.length
      ? s.atalhos.map(id => `<span class="cl-chip">→ ${clEsc(nomeDe(id))}</span>`).join('')
      : '<span class="cl-sem-atalho">sem atalhos</span>';
    return `<div class="cl-linha ${s.ativo ? '' : 'cl-desativado'}" data-linha data-id="${s.id}" data-lista="status">
      <div class="cl-linha-topo"><span class="cl-col-nome"><span class="cl-nome ${tag}">${clEsc(s.nome)}</span>${s.inicial ? '<span class="cl-tag cl-tag-inicial">status inicial</span>' : ''}${s.ativo ? '' : '<span class="cl-tag">desativado</span>'}</span><div class="cl-docs" aria-label="Atalhos">${atalhos}</div>${clBotoesItem(s)}</div>
    </div>`;
  }

  const fases = ContratosListas.dados.fases;
  const opcoesFase = fases.map(f => `<option value="${f.chave}" ${f.chave === s.fase ? 'selected' : ''}>${clEsc(f.nome)}</option>`).join('');
  const checks = fases.map(f => {
    const doGrupo = todos.filter(x => x.fase === f.chave && x.id !== s.id && x.ativo);
    if (!doGrupo.length) return '';
    return `<fieldset class="cl-atalhos-fase"><legend>${clEsc(f.nome)}</legend>${doGrupo.map(x =>
      `<label class="cl-check"><input type="checkbox" value="${x.id}" data-campo="atalho" ${s.atalhos.includes(x.id) ? 'checked' : ''}> ${clEsc(x.nome)}</label>`).join('')}</fieldset>`;
  }).join('');

  return `<div class="cl-linha cl-editando" data-linha data-id="${s.id}" data-lista="status">
    <div class="cl-form-status">
      <label class="cl-campo">Nome<input type="text" class="form-input cl-input" value="${clEsc(s.nome)}" maxlength="80" data-campo="nome" data-enter="salvar" data-autofoco></label>
      <label class="cl-campo">Fase<select class="form-input cl-input" data-campo="fase">${opcoesFase}</select></label>
    </div>
    <p class="cl-ajuda-atalhos">Atalhos a partir de ${clEsc(s.nome)} (até 6). Os outros status continuam disponíveis em “Qualquer status”.</p>
    <div class="cl-atalhos">${checks}</div>
    <div class="cl-acoes cl-acoes-fim"><button type="button" class="btn btn-primary cl-btn-sm" data-acao="salvar">Salvar</button><button type="button" class="btn btn-secondary cl-btn-sm" data-acao="cancelar">Cancelar</button></div>
  </div>`;
}

function clAbrirNovo() {
  const aba = clAba();
  const box = document.getElementById('cl-novo');
  const fases = ContratosListas.dados?.fases || [];
  box.innerHTML = `<form class="cl-novo-form" id="cl-novo-form">
      <label class="cl-campo">Nome ${aba.chave === 'status' ? 'do status' : ''}<input type="text" class="form-input cl-input" id="cl-novo-nome" maxlength="${aba.chave === 'status' ? 80 : 120}" required></label>
      ${aba.chave === 'status' ? `<label class="cl-campo">Fase<select class="form-input cl-input" id="cl-novo-fase">${fases.map(f => `<option value="${f.chave}">${clEsc(f.nome)}</option>`).join('')}</select></label>` : ''}
      <span class="cl-acoes"><button type="submit" class="btn btn-primary cl-btn-sm">Salvar</button><button type="button" class="btn btn-secondary cl-btn-sm" id="cl-novo-cancelar">Cancelar</button></span>
    </form>`;
  box.hidden = false;
  document.getElementById('cl-novo-nome').focus();
  document.getElementById('cl-novo-cancelar').onclick = () => { box.hidden = true; };
  document.getElementById('cl-novo-form').onsubmit = async (e) => {
    e.preventDefault();
    const nome = document.getElementById('cl-novo-nome').value;
    const btn = e.submitter || box.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (aba.chave === 'status') {
        await clRequisicao('/api/contratos/status', { method: 'POST', body: JSON.stringify({ nome, fase: document.getElementById('cl-novo-fase').value }) });
      } else {
        await clRequisicao(`/api/contratos/listas/${aba.chave}`, { method: 'POST', body: JSON.stringify({ nome }) });
      }
      box.hidden = true;
      showToast('Item incluído.', 'success');
      await carregarListasContratos();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
    }
  };
}

async function clCliqueLista(e) {
  const btn = e.target.closest('[data-acao]');
  if (!btn) return;
  const linha = btn.closest('[data-linha]');
  const id = Number(linha.dataset.id);
  const lista = linha.dataset.lista;
  const acao = btn.dataset.acao;
  const item = clItens(lista).find(i => i.id === id);

  if (acao === 'editar') { ContratosListas.editando = id; ContratosListas.addNomeBanco = null; return clRenderLista(); }
  if (acao === 'cancelar') { ContratosListas.editando = null; return clRenderLista(); }
  if (acao === 'add-nome') { ContratosListas.addNomeBanco = id; ContratosListas.editando = null; return clRenderLista(); }
  if (acao === 'cancelar-nome') { ContratosListas.addNomeBanco = null; return clRenderLista(); }

  btn.disabled = true;
  try {
    if (acao === 'salvar') {
      const nome = linha.querySelector('[data-campo="nome"]').value;
      if (lista === 'status') {
        const atalhos = [...linha.querySelectorAll('[data-campo="atalho"]:checked')].map(c => Number(c.value));
        if (atalhos.length > 6) throw new Error('Escolha no máximo 6 atalhos.');
        await clRequisicao(`/api/contratos/status/${id}`, { method: 'PUT', body: JSON.stringify({ nome, fase: linha.querySelector('[data-campo="fase"]').value, atalhos }) });
      } else {
        await clRequisicao(`/api/contratos/listas/${lista}/${id}`, { method: 'PUT', body: JSON.stringify({ nome }) });
      }
      ContratosListas.editando = null;
      showToast('Alteração salva.', 'success');
    } else if (acao === 'desativar' || acao === 'reativar') {
      const ativo = acao === 'reativar';
      const url = lista === 'status' ? `/api/contratos/status/${id}` : `/api/contratos/listas/${lista}/${id}`;
      await clRequisicao(url, { method: 'PUT', body: JSON.stringify({ ativo }) });
      showToast(ativo ? `${item.nome} reativado.` : `${item.nome} desativado: não aparece mais para escolher.`, 'success');
    } else if (acao === 'salvar-nome') {
      const nome = linha.querySelector('[data-campo="nome-doc"]').value;
      await clRequisicao(`/api/contratos/bancos/${id}/nomes`, { method: 'POST', body: JSON.stringify({ nome }) });
      ContratosListas.addNomeBanco = null;
      showToast('Nome incluído: a leitura passa a reconhecer.', 'success');
    } else if (acao === 'tirar-nome') {
      await clRequisicao(`/api/contratos/bancos/nomes/${btn.dataset.nomeId}`, { method: 'DELETE' });
      showToast('Nome retirado.', 'success');
    }
    await carregarListasContratos();
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
  }
}
