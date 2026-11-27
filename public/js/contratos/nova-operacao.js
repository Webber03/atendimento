// Nova operação: o consultor sobe de uma vez um contrato único, só portabilidades
// ou portabilidades + refin da port. Abre por cima do lead, em tela cheia.

const NovaOp = {
  leadId: null,
  listas: null,
  digitadores: [],
  formato: 'port_refin',
  ports: [],
  tentouSalvar: false,
  salvando: false,
  sujo: false,
  edicao: null,      // { id, codigo, contratoId, refinId, aoSalvar } quando é "Editar proposta"
  leitura: null,     // resultado de "ler documentos do lead"
  refinDoc: null,    // nome do banco de destino no espelho, quando não foi reconhecido
  cabecalho: null,   // dados do cliente quando não vêm do modal do lead
  avulsa: null       // { aoSalvar, consultores, fixo } quando sobe por Propostas digitadas, sem lead
};

const NO_MAX_PORTS = 30;
const NO_TIPO_PORT = 'PORTABILIDADE';
const NO_TIPO_REFIN = 'REFIN-PORTABILIDADE';

function noEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// "R$ 1.234,56" -> 1234.56 ; "" -> null ; inválido -> NaN
function noValor(v) {
  const s0 = String(v == null ? '' : v).replace(/[R$\s]/g, '');
  if (!s0) return null;
  const s = s0.includes(',') ? s0.replace(/\./g, '').replace(',', '.') : s0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function noMoeda(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const noNovaPort = () => ({ banco: '', numero_contrato: '', parcela: '', prazo_restante: '', saldo_devedor: '' });

function noAtivos(lista) {
  return (NovaOp.listas?.[lista] || []).filter(i => i.ativo);
}
function noBancoId(nome) {
  const alvo = String(nome || '').trim().toUpperCase();
  if (!alvo) return null;
  // ativos primeiro; na edição, aceita também o banco já gravado mesmo se foi desativado depois
  const b = noAtivos('banco').find(i => i.nome.toUpperCase() === alvo) ||
    (NovaOp.edicao ? (NovaOp.listas?.banco || []).find(i => i.nome.toUpperCase() === alvo) : null);
  return b ? b.id : undefined;
}

async function abrirNovaOperacao(leadId) {
  NovaOp.edicao = null;
  NovaOp.cabecalho = null;
  NovaOp.avulsa = null;
  return noAbrir(leadId);
}

// Subida avulsa (Propostas digitadas): cliente digitado na hora, sem lead
async function abrirNovaOperacaoAvulsa(opcoes = {}) {
  NovaOp.edicao = null;
  NovaOp.cabecalho = null;
  try {
    const res = await fetchWithAuth('/api/contratos/avulsa/consultores');
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || 'Sem permissão para subir contratos.');
    NovaOp.avulsa = { aoSalvar: opcoes.aoSalvar || null, consultores: r.consultores || [], fixo: !!r.fixo };
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }
  return noAbrir(null);
}

// Editar proposta: mesma tela, preenchida com a operação gravada
async function abrirEdicaoOperacao(opId, opcoes = {}) {
  let d;
  try {
    const res = await fetchWithAuth(`/api/contratos/operacoes/${opId}`);
    d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Erro ao carregar a operação.');
    if (!d.permissoes.pode_editar) throw new Error(d.permissoes.motivo_editar || 'Você não pode editar esta operação.');
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }
  const op = d.operacao;
  NovaOp.edicao = { id: op.id, codigo: op.codigo, op, contratos: d.contratos, aoSalvar: opcoes.aoSalvar || null };
  NovaOp.avulsa = null;
  NovaOp.cabecalho = {
    nome: op.cliente || 'Cliente',
    cpf: typeof formatCpf === 'function' ? formatCpf(op.cpf) : op.cpf,
    celular: op.telefone || '',
    consultor: op.consultor || '',
    sdr: op.sdr || ''
  };
  return noAbrir(op.lead_id);
}

async function noAbrir(leadId) {
  NovaOp.leadId = leadId;
  NovaOp.tentouSalvar = false;
  NovaOp.salvando = false;
  NovaOp.sujo = false;
  NovaOp.formato = NovaOp.edicao ? NovaOp.edicao.op.formato : 'port_refin';
  NovaOp.ports = [noNovaPort()];
  if (NovaOp.edicao) {
    const brl = v => (v === null || v === undefined || v === '' ? '' : noMoeda(v));
    const ports = NovaOp.edicao.contratos.filter(c => c.tipo === NO_TIPO_PORT && NovaOp.formato !== 'unico');
    if (ports.length) NovaOp.ports = ports.map(c => ({ id: c.id, status: c.status, banco: c.banco || '', numero_contrato: c.numero_contrato || '', parcela: brl(c.parcela), prazo_restante: c.prazo_restante ?? '', saldo_devedor: brl(c.saldo_devedor) }));
  }
  try {
    const [listas, digitadores, dadosCli] = await Promise.all([
      fetchWithAuth('/api/contratos/listas').then(r => r.json()),
      fetchWithAuth('/api/contratos/digitadores').then(r => r.json()),
      NovaOp.edicao || NovaOp.avulsa ? Promise.resolve(null) : fetchWithAuth(`/api/crm/leads/${leadId}/cliente-operacao`).then(r => r.json())
    ]);
    if (listas.error) throw new Error(listas.error);
    NovaOp.listas = listas;
    NovaOp.digitadores = Array.isArray(digitadores) ? digitadores : [];
    if (NovaOp.edicao) {
      const o = NovaOp.edicao.op;
      NovaOp.cli = { data_nascimento: o.data_nascimento, cep: o.cep, endereco: o.endereco, cidade: o.cidade, uf: o.uf,
        banco: o.banco_cliente, agencia: o.agencia_cliente, conta: o.conta_cliente, canal_venda_id: o.canal_venda_id };
    } else if (NovaOp.avulsa) {
      NovaOp.cli = {};
    } else {
      if (!dadosCli || dadosCli.error) throw new Error((dadosCli && dadosCli.error) || 'cliente não encontrado');
      NovaOp.cli = dadosCli.cliente || {};
    }
  } catch (err) {
    showToast('Não foi possível abrir a Nova operação: ' + err.message, 'error');
    return;
  }

  let tela = document.getElementById('nova-operacao');
  if (!tela) {
    tela = document.createElement('div');
    tela.id = 'nova-operacao';
    tela.className = 'no-tela';
    tela.setAttribute('role', 'dialog');
    tela.setAttribute('aria-modal', 'true');
    tela.setAttribute('aria-labelledby', 'no-titulo');
    document.body.appendChild(tela);
    tela.addEventListener('input', () => { NovaOp.sujo = true; if (NovaOp.tentouSalvar) noValidarEMostrar(); noAtualizarRodape(); });
    tela.addEventListener('change', noAoMudar);
    tela.addEventListener('click', noAoClicar);
    tela.addEventListener('focusout', (e) => {
      if (e.target.matches('[data-moeda]')) {
        const n = noValor(e.target.value);
        if (Number.isFinite(n) && n !== null) e.target.value = noMoeda(n);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('nova-operacao')?.hidden) fecharNovaOperacao();
    });
  }
  NovaOp.leitura = null;
  NovaOp.refinDoc = null;
  noRenderTela();
  noPreencherCliente();
  if (NovaOp.edicao) noPreencherEdicao();
  else if (!NovaOp.avulsa) noLerDocumentos();
  tela.hidden = false;
  document.body.classList.add('no-aberta');
  tela.scrollTop = 0;
  document.getElementById('no-titulo')?.focus();
}

async function fecharNovaOperacao(forcar) {
  const tela = document.getElementById('nova-operacao');
  if (!tela || tela.hidden) return;
  if (!forcar && NovaOp.sujo && !(await confirmarAcao({
    titulo: NovaOp.edicao ? 'Descartar as alterações?' : 'Descartar a operação?',
    mensagem: NovaOp.edicao ? 'O que você mudou nesta proposta não será salvo.' : 'O que já foi digitado nesta operação será perdido.',
    confirmar: 'Descartar', cancelar: 'Continuar editando', perigo: true }))) return;
  tela.hidden = true;
  document.body.classList.remove('no-aberta');
}

function noCabecalhoLead() {
  if (NovaOp.avulsa) return { nome: 'cliente novo', cpf: '', celular: '', consultor: '', sdr: '' };
  if (NovaOp.cabecalho) return NovaOp.cabecalho;
  const t = id => (document.getElementById(id)?.textContent || '').trim();
  return {
    nome: t('modal-lead-nome') || 'Cliente',
    cpf: t('modal-lead-cpf'),
    celular: t('modal-lead-telefone'),
    consultor: t('modal-lead-consultor'),
    sdr: document.getElementById('modal-lead-sdr-wrapper')?.classList.contains('hidden') ? '' : t('modal-lead-sdr')
  };
}

function noCamposClienteAvulso() {
  const a = NovaOp.avulsa;
  const consultor = a.fixo
    ? `<div class="no-tile"><span>Consultor</span><strong>${noEsc((a.consultores[0] || {}).nome || '—')}</strong></div>`
    : noCampo('Consultor', `<select class="form-input" data-campo="consultor_id"><option value="">Selecione…</option>${a.consultores.map(c => `<option value="${c.id}">${noEsc(c.nome)}</option>`).join('')}</select>`, 'consultor_id', true);
  return `<div class="no-grid-cli no-grid-avulsa">
    ${noCampo('Nome completo', '<input type="text" class="form-input" data-campo="avulsa.nome" maxlength="255" autocomplete="off">', 'avulsa.nome', true)}
    ${noCampo('CPF', '<input type="text" class="form-input" data-campo="avulsa.cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" autocomplete="off">', 'avulsa.cpf', true)}
    ${noCampo('Celular', '<input type="tel" class="form-input" data-campo="avulsa.telefone" maxlength="20" placeholder="(00) 00000-0000" autocomplete="off">', 'avulsa.telefone')}
    ${consultor}
  </div>
  <span class="no-cep-status" id="no-cpf-status" aria-live="polite"></span>`;
}

// CPF já cadastrado: preenche o que o cadastro tem (o servidor reaproveita o cliente)
async function noBuscarCpfAvulsa(cpf) {
  const tela = document.getElementById('nova-operacao');
  const st = document.getElementById('no-cpf-status');
  try {
    const res = await fetchWithAuth('/api/contratos/avulsa/cliente?cpf=' + cpf);
    const r = await res.json();
    if (!res.ok || !r.cliente) { if (st) st.textContent = ''; return; }
    const c = r.cliente;
    const set = (campo, valor) => { const el = tela.querySelector(`[data-campo="${campo}"]`); if (el && !String(el.value || '').trim() && valor) el.value = valor; };
    set('avulsa.nome', c.nome); set('avulsa.telefone', c.telefone);
    set('data_nascimento', c.data_nascimento ? String(c.data_nascimento).slice(0, 10) : '');
    set('cep', c.cep); set('endereco', c.endereco); set('cidade', c.cidade); set('uf', c.uf);
    set('avulsa.banco', c.banco); set('avulsa.agencia', c.agencia); set('avulsa.conta', c.conta);
    if (st) st.textContent = 'CPF já cadastrado: dados do cadastro preenchidos. O contrato fica ligado a esse cliente.';
  } catch (_) { if (st) st.textContent = ''; }
}

function noOpcoes(lista, selecionado, filtro) {
  return noAtivos(lista).filter(filtro || (() => true))
    .map(i => `<option value="${i.id}" ${String(i.id) === String(selecionado) ? 'selected' : ''}>${noEsc(i.nome)}</option>`).join('');
}

function noTabelas(campo, selecionado) {
  const tabelas = noAtivos('tabela').slice().sort((a, b) => a.id - b.id); // ordem em que foram cadastradas (NORMAL primeiro)
  const padrao = selecionado || (tabelas.find(t => t.nome === 'NORMAL') || tabelas[0] || {}).id;
  return `<div class="no-seg" role="radiogroup" aria-label="Tabela" data-campo="${campo}">${tabelas.map(t =>
    `<label class="${String(t.id) === String(padrao) ? 'on' : ''}"><input type="radio" name="${campo}" value="${t.id}" ${String(t.id) === String(padrao) ? 'checked' : ''}>${noEsc(t.nome)}</label>`).join('')}</div>`;
}

function noCampo(rotulo, html, campo, obrig) {
  return `<label class="no-lb" data-wrap="${campo}"><span>${rotulo}${obrig ? ' <abbr title="obrigatório">*</abbr>' : ''}</span>${html}<span class="no-erro" data-erro="${campo}" role="alert"></span></label>`;
}

function noRenderTela() {
  const tela = document.getElementById('nova-operacao');
  const lead = noCabecalhoLead();
  const eu = typeof getUser === 'function' ? getUser() : null;
  const digitadores = NovaOp.digitadores.map(u => `<option value="${u.id}" ${eu && u.id === eu.id ? 'selected' : ''}>${noEsc(u.nome)}</option>`).join('');
  const bancos = noAtivos('banco').map(b => `<option value="${noEsc(b.nome)}"></option>`).join('');
  const inicial = (NovaOp.listas.status || []).find(s => s.inicial);

  tela.innerHTML = `
  <datalist id="no-bancos">${bancos}</datalist>
  <div class="no-corpo">
    <header class="no-topo">
      <div>
        <h1 id="no-titulo" tabindex="-1">${NovaOp.edicao ? `Editar proposta · ${noEsc(NovaOp.edicao.codigo)} · ${noEsc(lead.nome)}` : `Nova operação · ${noEsc(lead.nome)}`}</h1>
        <p>${NovaOp.edicao ? 'Corrija o que for preciso. Contratos novos entram em AGUARDANDO RECEPÇÃO; os que já andaram mantêm o status.' : 'O cliente é digitado uma vez; cada linha vira um contrato com status próprio, todos ligados a esta operação.'}</p>
      </div>
      <button type="button" class="no-fechar" data-acao="fechar" aria-label="Fechar sem salvar"><i data-lucide="x"></i></button>
    </header>

    <div class="no-tipo">
      <span id="no-rot-tipo">Tipo de operação</span>
      <div class="no-tipo-seg" role="radiogroup" aria-labelledby="no-rot-tipo">
        ${[['unico', 'Contrato único'], ['portabilidades', 'Só portabilidades'], ['port_refin', 'Portabilidades + refin da port']].map(([v, t]) =>
          `<label class="${NovaOp.formato === v ? 'on' : ''} ${NovaOp.edicao && NovaOp.formato !== v ? 'no-off' : ''}"><input type="radio" name="no-formato" value="${v}" ${NovaOp.formato === v ? 'checked' : ''} ${NovaOp.edicao ? 'disabled' : ''}> ${t}</label>`).join('')}
      </div>
    </div>

    <section id="no-docs" class="no-docs" aria-live="polite" ${NovaOp.edicao || NovaOp.avulsa ? 'hidden' : ''}></section>

    <section class="no-sec" aria-labelledby="no-sec-cli">
      <h2 id="no-sec-cli">Cliente <span>· nascimento e endereço ficam no cadastro e voltam preenchidos na próxima operação</span></h2>
      ${NovaOp.avulsa ? noCamposClienteAvulso() : `<div class="no-tiles">
        <div class="no-tile"><span>Nome</span><strong>${noEsc(lead.nome)}</strong></div>
        <div class="no-tile"><span>CPF</span><strong>${noEsc(lead.cpf || '—')}</strong></div>
        <div class="no-tile"><span>Celular</span><strong>${noEsc(lead.celular || '—')}</strong></div>
        <div class="no-tile"><span>Consultor${lead.sdr ? ' · SDR' : ''}</span><strong>${noEsc(lead.consultor || '—')}${lead.sdr ? ' · ' + noEsc(lead.sdr) : ''}</strong></div>
      </div>`}
      <div class="no-grid-cli">
        ${noCampo('Data de nascimento', `<input type="date" class="form-input" data-campo="data_nascimento" autocomplete="off">`, 'data_nascimento', true)}
        ${noCampo('CEP', `<input type="text" inputmode="numeric" class="form-input" data-campo="cep" maxlength="9" placeholder="00000-000" autocomplete="off">`, 'cep', true)}
        ${noCampo('Endereço', `<input type="text" class="form-input" data-campo="endereco" maxlength="200" placeholder="Rua, número, complemento…">`, 'endereco', true)}
        ${noCampo('Cidade', `<input type="text" class="form-input" data-campo="cidade" maxlength="120">`, 'cidade', true)}
        ${noCampo('Estado', `<select class="form-input" data-campo="uf"><option value="">UF</option><option>AC</option><option>AL</option><option>AP</option><option>AM</option><option>BA</option><option>CE</option><option>DF</option><option>ES</option><option>GO</option><option>MA</option><option>MT</option><option>MS</option><option>MG</option><option>PA</option><option>PB</option><option>PR</option><option>PE</option><option>PI</option><option>RJ</option><option>RN</option><option>RS</option><option>RO</option><option>RR</option><option>SC</option><option>SP</option><option>SE</option><option>TO</option></select>`, 'uf', true)}
      </div>
      <span class="no-cep-status" id="no-cep-status" aria-live="polite"></span>
      ${NovaOp.avulsa ? `<div class="no-banco-cli">
        <span class="no-banco-cli-tit">Dados bancários <small>· opcionais</small></span>
        <div class="no-grid-cli no-grid-3">
          ${noCampo('Banco', '<input type="text" class="form-input" data-campo="avulsa.banco" maxlength="100" autocomplete="off">', 'avulsa.banco')}
          ${noCampo('Agência', '<input type="text" class="form-input" data-campo="avulsa.agencia" maxlength="20" inputmode="numeric" autocomplete="off">', 'avulsa.agencia')}
          ${noCampo('Conta com dígito', '<input type="text" class="form-input" data-campo="avulsa.conta" maxlength="30" autocomplete="off">', 'avulsa.conta')}
        </div>
      </div>` : `<div class="no-banco-cli">
        <span class="no-banco-cli-tit">Dados bancários <small>· ${NovaOp.edicao && !NovaOp.edicao.op.lead_id ? 'do cadastro do cliente' : 'do kanban; para corrigir, edite no lead'}</small></span>
        <div class="no-tiles no-tiles-3">
          <div class="no-tile"><span>Banco</span><strong id="no-cli-banco">—</strong></div>
          <div class="no-tile"><span>Agência</span><strong id="no-cli-agencia">—</strong></div>
          <div class="no-tile"><span>Conta com dígito</span><strong id="no-cli-conta">—</strong></div>
        </div>
      </div>`}
    </section>

    <section class="no-sec" aria-labelledby="no-sec-op">
      <h2 id="no-sec-op">Dados da operação <span>· valem para todos os contratos · <abbr title="obrigatório">*</abbr> obrigatório</span></h2>
      <div class="no-grid5">
        ${noCampo('Convênio', `<select class="form-input" data-campo="produto_id"><option value="">Selecione…</option>${noOpcoes('produto')}</select>`, 'produto_id', true)}
        ${noCampo('Canal de venda', `<select class="form-input" data-campo="canal_venda_id"><option value="">Selecione…</option>${(NovaOp.listas.canais || []).map(c => `<option value="${c.id}">${noEsc(c.nome)}</option>`).join('')}</select>`, 'canal_venda_id', true)}
        ${noCampo('Tipo de venda', `<select class="form-input" data-campo="tipo_venda"><option>Padrão</option><option>Digital</option><option>Híbrida</option></select>`, 'tipo_venda')}
        ${noCampo('Digitador responsável', `<select class="form-input" data-campo="digitador_id"><option value="">Selecione…</option>${digitadores}</select>`, 'digitador_id', true)}
        ${noCampo('Proposta no banco em', `<input type="date" class="form-input" data-campo="proposta_banco_em">`, 'proposta_banco_em')}
      </div>
      <div class="no-grid4">
        ${noCampo('Matrícula', `<input type="text" class="form-input" maxlength="40" data-campo="matricula">`, 'matricula')}
        ${noCampo('Órgão', `<input type="text" class="form-input" maxlength="120" data-campo="orgao">`, 'orgao')}
        ${noCampo('Cargo', `<input type="text" class="form-input" maxlength="120" data-campo="cargo">`, 'cargo')}
        ${noCampo('Situação', `<input type="text" class="form-input" maxlength="80" data-campo="situacao_funcional" placeholder="Ex.: APOSENTADO, Efetivo">`, 'situacao_funcional')}
      </div>
    </section>

    <div id="no-formato-area"></div>

    <section class="no-sec">
      ${noCampo('Observações sobre a operação', `<textarea class="form-input" rows="2" maxlength="2000" data-campo="observacao"></textarea>`, 'observacao')}
    </section>
  </div>

  <footer class="no-rodape">
    <div class="no-resumo">
      <span id="no-totais"></span>
      <a href="#" id="no-pendencias" class="no-pendencias" hidden></a>
      <span>${NovaOp.edicao ? 'Contratos novos entram em' : 'Todos entram em'} <strong>${noEsc(inicial ? inicial.nome : 'AGUARDANDO RECEPÇÃO')}</strong></span>
    </div>
    <div class="no-acoes">
      <button type="button" class="btn btn-secondary" data-acao="fechar">Cancelar</button>
      <button type="button" class="btn btn-primary" id="no-salvar" data-acao="salvar">${NovaOp.edicao ? 'Salvar alterações' : 'Salvar operação'}</button>
    </div>
  </footer>`;

  noRenderFormato();
}

function noLinhaPort(p, i) {
  const pre = `portabilidades.${i}`;
  const cel = (campo, html) => `<div role="cell" class="no-cel-wrap" data-wrap="${pre}.${campo}">${html}<span class="no-erro" data-erro="${pre}.${campo}" role="alert"></span></div>`;
  const dicas = [];
  if (p.doc) dicas.push(`No espelho veio “${noEsc(p.doc)}”, que não está na lista. Escolha o banco: o nome fica guardado e da próxima vez é reconhecido.`);
  if (p.semNumero) dicas.push('O espelho não traz o nº deste contrato: digite.');
  const avisoDoc = dicas.length ? `<div class="no-aviso-doc" role="note">${dicas.join(' ')}</div>` : '';
  return `<div class="no-row ${dicas.length ? 'no-row-aviso' : ''}" role="row" data-linha="${i}" data-id="${p.id || ''}" data-status="${noEsc(p.status || '')}" data-doc="${noEsc(p.doc || '')}" data-sem-numero="${p.semNumero ? '1' : ''}">
    <span role="cell" class="no-idx" ${p.status ? `title="${noEsc(p.status)}"` : ''}>${i + 1}${p.status && p.status !== 'AGUARDANDO RECEPÇÃO' ? '<i class="no-andou" aria-label="já andou: ' + noEsc(p.status) + '"></i>' : ''}</span>
    ${cel('banco_id', `<input type="text" class="form-input" list="no-bancos" data-port="banco" data-campo="${pre}.banco_id" value="${noEsc(p.banco)}" placeholder="Buscar banco…" aria-label="Banco de origem da linha ${i + 1}">`)}
    ${cel('numero_contrato', `<input type="text" class="form-input" data-port="numero_contrato" data-campo="${pre}.numero_contrato" value="${noEsc(p.numero_contrato)}" maxlength="60" aria-label="Nº do contrato da linha ${i + 1}">`)}
    ${cel('parcela', `<input type="text" inputmode="decimal" class="form-input" data-moeda data-port="parcela" data-campo="${pre}.parcela" value="${noEsc(p.parcela)}" placeholder="0,00" aria-label="Parcela da linha ${i + 1}">`)}
    ${cel('prazo_restante', `<input type="text" inputmode="numeric" class="form-input" data-port="prazo_restante" data-campo="${pre}.prazo_restante" value="${noEsc(p.prazo_restante)}" aria-label="Prazo restante da linha ${i + 1}">`)}
    ${cel('saldo_devedor', `<input type="text" inputmode="decimal" class="form-input" data-moeda data-port="saldo_devedor" data-campo="${pre}.saldo_devedor" value="${noEsc(p.saldo_devedor)}" placeholder="0,00" aria-label="Saldo devedor da linha ${i + 1}">`)}
    <span role="cell" class="no-row-acoes">
      <button type="button" class="no-ico" data-acao="duplicar" aria-label="Duplicar linha ${i + 1}" title="Duplicar linha"><i data-lucide="copy"></i></button>
      <button type="button" class="no-ico" data-acao="remover" aria-label="Remover linha ${i + 1}" title="Remover linha"><i data-lucide="trash-2"></i></button>
    </span>
    ${avisoDoc}
  </div>`;
}

function noBlocoNovoContrato(pre, titulo, comTipo) {
  const tipos = comTipo
    ? noCampo('Tipo', `<select class="form-input" data-campo="${pre}.tipo_id"><option value="">Selecione…</option>${noOpcoes('tipo', null, t => t.nome !== NO_TIPO_REFIN)}</select>`, `${pre}.tipo_id`, true)
    : '';
  return `<section class="no-sec" aria-label="${titulo}">
    <h2>${titulo}</h2>
    ${comTipo ? `<div class="no-grid4">${tipos}</div>` : ''}
    <div id="${pre}-campos"></div>
  </section>`;
}

function noCamposNovoContrato(pre) {
  return `
    <div class="no-grid-refin">
      ${noCampo('Banco', `<input type="text" class="form-input" list="no-bancos" data-campo="${pre}.banco_id" placeholder="Buscar banco…">`, `${pre}.banco_id`, true)}
      <div class="no-lb" data-wrap="${pre}.tabela_id"><span>Tabela <abbr title="obrigatório">*</abbr></span>${noTabelas(`${pre}.tabela_id`)}<span class="no-erro" data-erro="${pre}.tabela_id" role="alert"></span></div>
      ${noCampo('Valor liberado', `<input type="text" inputmode="decimal" class="form-input" data-moeda data-campo="${pre}.valor_liberado" placeholder="0,00">`, `${pre}.valor_liberado`, true)}
    </div>
    <div class="no-grid4">
      ${noCampo('Prazo (meses)', `<input type="text" inputmode="numeric" class="form-input" data-campo="${pre}.prazo">`, `${pre}.prazo`, true)}
      ${noCampo('Parcela', `<input type="text" inputmode="decimal" class="form-input" data-moeda data-campo="${pre}.parcela" placeholder="0,00">`, `${pre}.parcela`, true)}
      ${noCampo('Taxa (% a.m.)', `<input type="text" inputmode="decimal" class="form-input" data-campo="${pre}.taxa" placeholder="0,00">`, `${pre}.taxa`)}
      ${noCampo('Nº da proposta no banco', `<input type="text" class="form-input" maxlength="60" data-campo="${pre}.numero_proposta">`, `${pre}.numero_proposta`)}
    </div>`;
}

function noCamposPortUnica(pre) {
  return `
    <div class="no-grid4">
      ${noCampo('Banco de origem', `<input type="text" class="form-input" list="no-bancos" data-campo="${pre}.banco_id" placeholder="Buscar banco…">`, `${pre}.banco_id`, true)}
      ${noCampo('Nº do contrato portado', `<input type="text" class="form-input" maxlength="60" data-campo="${pre}.numero_contrato">`, `${pre}.numero_contrato`, true)}
      ${noCampo('Parcela', `<input type="text" inputmode="decimal" class="form-input" data-moeda data-campo="${pre}.parcela" placeholder="0,00">`, `${pre}.parcela`, true)}
      ${noCampo('Prazo restante', `<input type="text" inputmode="numeric" class="form-input" data-campo="${pre}.prazo_restante">`, `${pre}.prazo_restante`, true)}
    </div>
    <div class="no-grid4">
      ${noCampo('Saldo devedor', `<input type="text" inputmode="decimal" class="form-input" data-moeda data-campo="${pre}.saldo_devedor" placeholder="0,00">`, `${pre}.saldo_devedor`, true)}
      ${noCampo('Nº da proposta no banco', `<input type="text" class="form-input" maxlength="60" data-campo="${pre}.numero_proposta">`, `${pre}.numero_proposta`)}
    </div>`;
}

function noRenderFormato() {
  const area = document.getElementById('no-formato-area');
  if (NovaOp.formato === 'unico') {
    area.innerHTML = noBlocoNovoContrato('contrato', 'Contrato', true);
    noRenderContratoUnico();
  } else {
    const n = NovaOp.ports.length;
    area.innerHTML = `
      <section class="no-sec" aria-labelledby="no-sec-port">
        <div class="no-sec-topo">
          <h2 id="no-sec-port">Portabilidades <span>· uma linha por contrato portado · até ${NO_MAX_PORTS}</span></h2>
          <button type="button" class="no-btn-add" data-acao="adicionar" ${n >= NO_MAX_PORTS ? 'disabled' : ''}>+ Adicionar portabilidade</button>
        </div>
        <span class="no-erro no-erro-bloco" data-erro="portabilidades" role="alert"></span>
        <div class="no-tabela" role="table" aria-label="Portabilidades">
          <div class="no-row no-row-head" role="row">
            <span role="columnheader">#</span><span role="columnheader">Banco de origem *</span><span role="columnheader">Nº do contrato *</span>
            <span role="columnheader">Parcela *</span><span role="columnheader">Prazo restante *</span><span role="columnheader">Saldo devedor *</span><span role="columnheader"><span class="no-sr">Ações</span></span>
          </div>
          ${NovaOp.ports.map(noLinhaPort).join('')}
        </div>
      </section>
      ${NovaOp.formato === 'port_refin' ? noBlocoNovoContrato('refin', `Refin da port <span>· o contrato novo, ligado às portabilidades</span>`, false) : ''}`;
    if (NovaOp.formato === 'port_refin') document.getElementById('refin-campos').innerHTML = noCamposNovoContrato('refin');
  }
  if (window.lucide) lucide.createIcons();
  noAtualizarRodape();
  if (NovaOp.tentouSalvar) noValidarEMostrar();
}

function noRenderContratoUnico() {
  const sel = document.querySelector('#nova-operacao [data-campo="contrato.tipo_id"]');
  const tipo = noAtivos('tipo').find(t => String(t.id) === String(sel?.value));
  const alvo = document.getElementById('contrato-campos');
  if (!alvo) return;
  alvo.innerHTML = tipo && tipo.nome === NO_TIPO_PORT ? noCamposPortUnica('contrato') : noCamposNovoContrato('contrato');
  if (window.lucide) lucide.createIcons();
}

// Lê as linhas de portabilidade da tela para o estado (antes de redesenhar)
function noLerPorts() {
  const tela = document.getElementById('nova-operacao');
  NovaOp.ports = [...tela.querySelectorAll('.no-row[data-linha]')].map(linha => {
    const p = noNovaPort();
    if (linha.dataset.id) p.id = Number(linha.dataset.id);
    if (linha.dataset.status) p.status = linha.dataset.status;
    if (linha.dataset.doc) p.doc = linha.dataset.doc;
    if (linha.dataset.semNumero) p.semNumero = true;
    linha.querySelectorAll('[data-port]').forEach(inp => { p[inp.dataset.port] = inp.value; });
    return p;
  });
}

function noAoMudar(e) {
  const t = e.target;
  NovaOp.sujo = true;
  if (t.name === 'no-formato') {
    noLerPorts();
    NovaOp.formato = t.value;
    if (NovaOp.formato === 'portabilidades' && NovaOp.ports.length < 2) while (NovaOp.ports.length < 2) NovaOp.ports.push(noNovaPort());
    document.querySelectorAll('#nova-operacao .no-tipo-seg label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
    noRenderFormato();
    return;
  }
  if (t.matches('.no-seg input')) {
    t.closest('.no-seg').querySelectorAll('label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
  }
  if (t.dataset.campo === 'contrato.tipo_id') noRenderContratoUnico();
  if (NovaOp.tentouSalvar) noValidarEMostrar();
  noAtualizarRodape();
}

function noAoClicar(e) {
  const b = e.target.closest('[data-acao]');
  if (!b) {
    if (e.target.id === 'no-pendencias') { e.preventDefault(); noFocarPrimeiroErro(); }
    return;
  }
  const acao = b.dataset.acao;
  if (acao === 'fechar') return fecharNovaOperacao();
  if (acao === 'ler-docs') {
    if (!NovaOp.sujo) return noLerDocumentos();
    confirmarAcao({ titulo: 'Ler os documentos de novo?', mensagem: 'O vínculo, as portabilidades e o refin serão substituídos pelo que está nos documentos do lead.', confirmar: 'Ler de novo' })
      .then(ok => { if (ok) noLerDocumentos(); });
    return;
  }
  if (acao === 'salvar') return noSalvar();
  if (['adicionar', 'duplicar', 'remover'].includes(acao)) {
    noLerPorts();
    const i = Number(b.closest('[data-linha]')?.dataset.linha);
    if (acao === 'adicionar' && NovaOp.ports.length < NO_MAX_PORTS) NovaOp.ports.push(noNovaPort());
    if (acao === 'duplicar' && NovaOp.ports.length < NO_MAX_PORTS) NovaOp.ports.splice(i + 1, 0, { ...NovaOp.ports[i], id: undefined, status: undefined, doc: undefined, semNumero: undefined, numero_contrato: '' });
    if (acao === 'remover') {
      const min = NovaOp.formato === 'portabilidades' ? 2 : 1;
      if (NovaOp.ports.length <= min) { showToast(min === 2 ? 'Só portabilidades precisa de pelo menos 2 linhas.' : 'Mantenha pelo menos 1 portabilidade.', 'info'); return; }
      const st = NovaOp.ports[i] && NovaOp.ports[i].status;
      if (st && st !== 'AGUARDANDO RECEPÇÃO') { showToast(`Este contrato já está em ${st}: para tirar da operação, cancele em Atualizar operação.`, 'info'); return; }
      NovaOp.ports.splice(i, 1);
    }
    NovaOp.sujo = true;
    noRenderFormato();
    const alvo = acao === 'remover' ? null : document.querySelector(`#nova-operacao .no-row[data-linha="${acao === 'adicionar' ? NovaOp.ports.length - 1 : i + 1}"] input`);
    if (alvo) alvo.focus();
  }
}

// Monta o corpo enviado ao servidor a partir da tela
function noColetar() {
  const tela = document.getElementById('nova-operacao');
  const v = campo => tela.querySelector(`[data-campo="${campo}"]`)?.value ?? '';
  const radio = campo => tela.querySelector(`[data-campo="${campo}"] input:checked`)?.value || '';
  const corpo = {
    ...(NovaOp.avulsa ? {
      cliente_avulso: { nome: v('avulsa.nome'), cpf: v('avulsa.cpf'), telefone: v('avulsa.telefone'), banco: v('avulsa.banco'), agencia: v('avulsa.agencia'), conta: v('avulsa.conta') },
      consultor_id: v('consultor_id') || null
    } : {}),
    formato: NovaOp.formato,
    produto_id: v('produto_id') || null,
    tipo_venda: v('tipo_venda'),
    digitador_id: v('digitador_id') || null,
    proposta_banco_em: v('proposta_banco_em') || null,
    observacao: v('observacao'),
    matricula: v('matricula'), orgao: v('orgao'), cargo: v('cargo'), situacao_funcional: v('situacao_funcional'),
    canal_venda_id: v('canal_venda_id') || null,
    data_nascimento: v('data_nascimento') || null, cep: v('cep'), endereco: v('endereco'), cidade: v('cidade'), uf: v('uf')
  };
  const novo = pre => ({
    banco_id: noBancoId(v(`${pre}.banco_id`)), tabela_id: radio(`${pre}.tabela_id`) || null,
    prazo: v(`${pre}.prazo`), parcela: v(`${pre}.parcela`), taxa: v(`${pre}.taxa`),
    valor_liberado: v(`${pre}.valor_liberado`), numero_proposta: v(`${pre}.numero_proposta`)
  });
  if (NovaOp.formato === 'unico') {
    const tipoId = v('contrato.tipo_id') || null;
    const tipo = noAtivos('tipo').find(t => String(t.id) === String(tipoId));
    const idUnico = NovaOp.edicao ? NovaOp.edicao.contratoId : undefined;
    corpo.contrato = tipo && tipo.nome === NO_TIPO_PORT
      ? { id: idUnico, tipo_id: tipoId, banco_id: noBancoId(v('contrato.banco_id')), numero_contrato: v('contrato.numero_contrato'), parcela: v('contrato.parcela'), prazo_restante: v('contrato.prazo_restante'), saldo_devedor: v('contrato.saldo_devedor'), numero_proposta: v('contrato.numero_proposta') }
      : { id: idUnico, tipo_id: tipoId, ...novo('contrato') };
  } else {
    noLerPorts();
    corpo.portabilidades = NovaOp.ports.map(p => ({ id: p.id, banco_id: noBancoId(p.banco), banco_nome_doc: p.doc || undefined, numero_contrato: p.numero_contrato, parcela: p.parcela, prazo_restante: p.prazo_restante, saldo_devedor: p.saldo_devedor }));
    if (NovaOp.formato === 'port_refin') corpo.refin = { id: NovaOp.edicao ? NovaOp.edicao.refinId : undefined, banco_nome_doc: NovaOp.refinDoc || undefined, ...novo('refin') };
  }
  return corpo;
}

// Mesmas regras do servidor, para avisar antes de enviar
function noValidar(corpo) {
  const erros = {};
  const tela = document.getElementById('nova-operacao');
  const preenchido = campo => String(tela.querySelector(`[data-campo="${campo}"]`)?.value || '').trim() !== '';
  const reqValor = (val, campo, msg) => { const n = noValor(val); if (n === null) erros[campo] = msg; else if (!(n > 0)) erros[campo] = 'Valor inválido.'; };
  const reqInt = (val, campo, msg) => { const s = String(val || '').trim(); if (!s) erros[campo] = msg; else if (!/^\d+$/.test(s) || +s <= 0 || +s > 420) erros[campo] = 'Número inválido.'; };
  const banco = (id, campo) => { if (id === undefined) erros[campo] = 'Escolha um banco da lista.'; else if (!id) erros[campo] = 'Informe o banco.'; };

  if (NovaOp.avulsa) {
    const ca = corpo.cliente_avulso;
    if (!String(ca.nome || '').trim()) erros['avulsa.nome'] = 'Informe o nome do cliente.';
    const cpf = String(ca.cpf || '').replace(/\D/g, '');
    if (!cpf) erros['avulsa.cpf'] = 'Informe o CPF.'; else if (cpf.length !== 11) erros['avulsa.cpf'] = 'O CPF tem 11 números.';
    if (!NovaOp.avulsa.fixo && !corpo.consultor_id) erros.consultor_id = 'Escolha o consultor.';
  }
  if (!corpo.produto_id) erros.produto_id = 'Escolha o convênio.';
  if (!corpo.canal_venda_id) erros.canal_venda_id = 'Escolha o canal de venda.';
  if (!corpo.data_nascimento) erros.data_nascimento = 'Informe a data de nascimento.';
  const cepNum = String(corpo.cep || '').replace(/\D/g, '');
  if (!cepNum) erros.cep = 'Informe o CEP.'; else if (cepNum.length !== 8) erros.cep = 'O CEP tem 8 números.';
  if (!String(corpo.endereco || '').trim()) erros.endereco = 'Informe o endereço.';
  if (!String(corpo.cidade || '').trim()) erros.cidade = 'Informe a cidade.';
  if (!corpo.uf) erros.uf = 'Escolha o estado.';
  if (!corpo.digitador_id) erros.digitador_id = 'Escolha o digitador.';

  const novo = (c, pre) => {
    banco(c.banco_id, `${pre}.banco_id`);
    if (!c.tabela_id) erros[`${pre}.tabela_id`] = 'Escolha a tabela.';
    reqInt(c.prazo, `${pre}.prazo`, 'Informe o prazo.');
    reqValor(c.valor_liberado, `${pre}.valor_liberado`, 'Informe o valor liberado.');
    reqValor(c.parcela, `${pre}.parcela`, 'Informe a parcela.');
    if (preenchido(`${pre}.taxa`) && Number.isNaN(noValor(c.taxa))) erros[`${pre}.taxa`] = 'Taxa inválida.';
  };
  const port = (p, pre) => {
    banco(p.banco_id, `${pre}.banco_id`);
    if (!String(p.numero_contrato || '').trim()) erros[`${pre}.numero_contrato`] = 'Informe o nº do contrato.';
    reqValor(p.parcela, `${pre}.parcela`, 'Informe a parcela.');
    reqInt(p.prazo_restante, `${pre}.prazo_restante`, 'Informe o prazo restante.');
    reqValor(p.saldo_devedor, `${pre}.saldo_devedor`, 'Informe o saldo devedor.');
  };

  if (corpo.formato === 'unico') {
    if (!corpo.contrato.tipo_id) erros['contrato.tipo_id'] = 'Escolha o tipo.';
    else if ('numero_contrato' in corpo.contrato) port(corpo.contrato, 'contrato');
    else novo(corpo.contrato, 'contrato');
  } else {
    const vistos = new Map();
    corpo.portabilidades.forEach((p, i) => {
      port(p, `portabilidades.${i}`);
      const chave = String(p.numero_contrato || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (chave) {
        if (vistos.has(chave)) erros[`portabilidades.${i}.numero_contrato`] = `Este nº já está na linha ${vistos.get(chave) + 1}.`;
        else vistos.set(chave, i);
      }
    });
    if (corpo.formato === 'portabilidades' && corpo.portabilidades.length < 2) erros.portabilidades = 'Informe pelo menos 2 portabilidades. Uma sozinha é “Contrato único”.';
    if (corpo.formato === 'port_refin') novo(corpo.refin, 'refin');
  }
  return erros;
}

function noMostrarErros(erros) {
  const tela = document.getElementById('nova-operacao');
  tela.querySelectorAll('[data-erro]').forEach(el => { el.textContent = ''; });
  tela.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
  tela.querySelectorAll('.no-invalido').forEach(el => el.classList.remove('no-invalido'));
  Object.entries(erros).forEach(([campo, msg]) => {
    const alvoErro = tela.querySelector(`[data-erro="${campo}"]`);
    if (alvoErro) alvoErro.textContent = msg;
    const campoEl = tela.querySelector(`[data-campo="${campo}"]`);
    if (campoEl) {
      campoEl.setAttribute('aria-invalid', 'true');
      campoEl.classList.add('no-invalido');
    }
  });
  const n = Object.keys(erros).length;
  const link = document.getElementById('no-pendencias');
  if (link) {
    link.hidden = n === 0;
    link.textContent = n === 1 ? '1 campo para corrigir' : `${n} campos para corrigir`;
  }
}

function noValidarEMostrar() {
  const erros = noValidar(noColetar());
  noMostrarErros(erros);
  return erros;
}

function noFocarPrimeiroErro() {
  const el = document.querySelector('#nova-operacao [aria-invalid="true"], #nova-operacao .no-erro:not(:empty)');
  if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (el.focus) el.focus({ preventScroll: true }); }
}

function noAtualizarRodape() {
  const totais = document.getElementById('no-totais');
  const btn = document.getElementById('no-salvar');
  if (!totais || !btn) return;
  let qtd = 1;
  if (NovaOp.formato === 'unico') {
    totais.textContent = 'Contrato único';
  } else {
    const linhas = [...document.querySelectorAll('#nova-operacao .no-row[data-linha]')];
    const soma = campo => linhas.reduce((t, l) => { const n = noValor(l.querySelector(`[data-port="${campo}"]`)?.value); return t + (Number.isFinite(n) ? n : 0); }, 0);
    qtd = linhas.length + (NovaOp.formato === 'port_refin' ? 1 : 0);
    totais.textContent = `${linhas.length} portabilidade${linhas.length > 1 ? 's' : ''} · parcelas R$ ${noMoeda(soma('parcela'))} · saldos R$ ${noMoeda(soma('saldo_devedor'))}`;
  }
  btn.textContent = NovaOp.salvando ? 'Salvando…' : NovaOp.edicao ? `Salvar alterações · ${qtd} contrato${qtd > 1 ? 's' : ''}` : `Salvar operação · ${qtd} contrato${qtd > 1 ? 's' : ''}`;
}

async function noSalvar() {
  if (NovaOp.salvando) return;
  NovaOp.tentouSalvar = true;
  const corpo = noColetar();
  const erros = noValidar(corpo);
  noMostrarErros(erros);
  if (Object.keys(erros).length) { noFocarPrimeiroErro(); return; }

  NovaOp.salvando = true;
  const btn = document.getElementById('no-salvar');
  btn.disabled = true;
  noAtualizarRodape();
  try {
    const res = NovaOp.edicao
      ? await fetchWithAuth(`/api/contratos/operacoes/${NovaOp.edicao.id}`, { method: 'PUT', body: JSON.stringify(corpo) })
      : NovaOp.avulsa
        ? await fetchWithAuth('/api/contratos/operacoes/avulsa', { method: 'POST', body: JSON.stringify(corpo) })
        : await fetchWithAuth(`/api/crm/leads/${NovaOp.leadId}/operacoes`, { method: 'POST', body: JSON.stringify(corpo) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (Array.isArray(r.erros)) {
        const mapa = {};
        r.erros.forEach(e => { mapa[e.campo] = e.mensagem; });
        noMostrarErros(mapa);
        noFocarPrimeiroErro();
      }
      throw new Error(r.error || 'Não foi possível salvar a operação.');
    }
    fecharNovaOperacao(true);
    if (NovaOp.edicao) {
      const partes = [];
      if (r.alterados) partes.push(`${r.alterados} alterado${r.alterados > 1 ? 's' : ''}`);
      if (r.novos) partes.push(`${r.novos} incluído${r.novos > 1 ? 's' : ''}`);
      if (r.removidos) partes.push(`${r.removidos} removido${r.removidos > 1 ? 's' : ''}`);
      showToast(`Proposta ${r.codigo} salva${partes.length ? ': ' + partes.join(', ') : ''}.`, 'success');
      if (NovaOp.edicao.aoSalvar) NovaOp.edicao.aoSalvar();
      const leadAberto = !document.getElementById('modal-lead-details')?.classList.contains('hidden');
      if (leadAberto && typeof carregarContratosDoLead === 'function' && typeof LeadContratos !== 'undefined' && LeadContratos.leadId) carregarContratosDoLead(LeadContratos.leadId);
      return;
    }
    showToast(`Operação ${r.codigo} salva: ${r.contratos} contrato${r.contratos > 1 ? 's' : ''} em ${r.status}.${r.cliente_existente ? ' Ligada ao cliente já cadastrado com esse CPF.' : ''}`, 'success');
    if (NovaOp.avulsa) { if (NovaOp.avulsa.aoSalvar) NovaOp.avulsa.aoSalvar(); return; }
    // Recarrega o lead inteiro: contratos e histórico ("Operação OP-… subida")
    if (typeof openLeadDetailsModal === 'function') openLeadDetailsModal(NovaOp.leadId, 'closer');
    else if (typeof carregarContratosDoLead === 'function') carregarContratosDoLead(NovaOp.leadId);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    NovaOp.salvando = false;
    if (btn) btn.disabled = false;
    noAtualizarRodape();
  }
}

// Preenche a tela com a operação gravada (Editar proposta)
function noPreencherEdicao() {
  const { op, contratos } = NovaOp.edicao;
  const tela = document.getElementById('nova-operacao');
  const set = (campo, valor) => { const el = tela.querySelector(`[data-campo="${campo}"]`); if (el && valor !== null && valor !== undefined) el.value = valor; };
  const brl = v => (v === null || v === undefined || v === '' ? '' : noMoeda(v));
  const num = v => (v === null || v === undefined || v === '' ? '' : String(Number(v)).replace('.', ','));
  // produto e digitador podem ter sido desativados: garante a opção
  const garantir = (campo, id, nome) => {
    const sel = tela.querySelector(`[data-campo="${campo}"]`);
    if (sel && id && ![...sel.options].some(o => String(o.value) === String(id))) sel.insertAdjacentHTML('beforeend', `<option value="${id}">${noEsc(nome || '')}</option>`);
  };
  garantir('produto_id', op.produto_id, op.produto);
  garantir('digitador_id', op.digitador_id, op.digitador);
  set('produto_id', op.produto_id);
  set('tipo_venda', op.tipo_venda || 'Padrão');
  set('digitador_id', op.digitador_id);
  set('proposta_banco_em', op.proposta_banco_em ? String(op.proposta_banco_em).slice(0, 10) : '');
  set('observacao', op.observacao || '');
  set('matricula', op.matricula || ''); set('orgao', op.orgao || ''); set('cargo', op.cargo || ''); set('situacao_funcional', op.situacao_funcional || '');

  const novo = (pre, c) => {
    set(`${pre}.banco_id`, c.banco || '');
    const radio = tela.querySelector(`[data-campo="${pre}.tabela_id"] input[value="${c.tabela_id}"]`);
    if (radio) { radio.checked = true; radio.closest('.no-seg').querySelectorAll('label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked)); }
    set(`${pre}.prazo`, c.prazo ?? '');
    set(`${pre}.parcela`, brl(c.parcela));
    set(`${pre}.taxa`, num(c.taxa));
    set(`${pre}.valor_liberado`, brl(c.valor_liberado));
    set(`${pre}.numero_proposta`, c.numero_proposta || '');
  };
  if (op.formato === 'unico' && contratos[0]) {
    const c = contratos[0];
    NovaOp.edicao.contratoId = c.id;
    const selTipo = tela.querySelector('[data-campo="contrato.tipo_id"]');
    if (selTipo && ![...selTipo.options].some(o => String(o.value) === String(c.tipo_id))) selTipo.insertAdjacentHTML('beforeend', `<option value="${c.tipo_id}">${noEsc(c.tipo)}</option>`);
    set('contrato.tipo_id', c.tipo_id);
    noRenderContratoUnico();
    if (c.tipo === NO_TIPO_PORT) {
      set('contrato.banco_id', c.banco || ''); set('contrato.numero_contrato', c.numero_contrato || '');
      set('contrato.parcela', brl(c.parcela)); set('contrato.prazo_restante', c.prazo_restante ?? '');
      set('contrato.saldo_devedor', brl(c.saldo_devedor)); set('contrato.numero_proposta', c.numero_proposta || '');
    } else novo('contrato', c);
  }
  if (op.formato === 'port_refin') {
    const r = contratos.find(c => c.tipo === NO_TIPO_REFIN);
    if (r) { NovaOp.edicao.refinId = r.id; novo('refin', r); }
  }
  noAtualizarRodape();
}

// ---------------------------------------------------------------------------
// Entrega 4: lê o contracheque e o espelho anexados ao lead e preenche a tela
// ---------------------------------------------------------------------------
const NO_ROTULO_STATUS = {
  ok: 'lido',
  ausente: 'não anexado',
  nao_reconhecido: 'layout não reconhecido, preencha à mão',
  erro: 'não foi possível ler, preencha à mão'
};

function noRenderDocs(estado) {
  const box = document.getElementById('no-docs');
  if (!box) return;
  if (estado === 'lendo') {
    box.innerHTML = '<div class="no-docs-txt"><strong>Lendo os documentos do lead…</strong><span>Contracheque e espelho da proposta</span></div>';
    box.className = 'no-docs';
    return;
  }
  const l = NovaOp.leitura;
  if (!l) { box.innerHTML = ''; return; }
  const item = (nome, d, resumo) => {
    const ok = d.status === 'ok';
    const icone = ok ? '<i data-lucide="check" class="no-docs-ok"></i>' : '<i data-lucide="alert-triangle" class="no-docs-aviso"></i>';
    return `<span class="no-docs-item">${icone}<strong>${nome}</strong> ${ok ? resumo : noEsc(d.motivo || NO_ROTULO_STATUS[d.status] || '')}</span>`;
  };
  const cc = l.contracheque; const es = l.espelho;
  const nPorts = es.status === 'ok' ? es.portabilidades.length : 0;
  const alertas = [];
  if (cc.status === 'ok' && cc.cpf_confere === false) alertas.push('O CPF do contracheque é diferente do CPF do cliente: confira se o arquivo anexado é deste cliente.');
  if (cc.status === 'ok' && NovaOp.convenioDiferente) alertas.push(`O contracheque é do convênio ${noEsc(NovaOp.convenioDiferente)}, diferente do convênio escolhido: confira.`);
  if (es.status === 'ok' && es.cpf_confere === false) alertas.push('O CPF do espelho é diferente do CPF do cliente: confira se o arquivo anexado é deste cliente.');
  box.className = 'no-docs' + (alertas.length ? ' no-docs-alerta' : '');
  box.innerHTML = `
    <div class="no-docs-txt">
      <div><strong>Lido dos documentos do lead</strong> <span class="no-docs-sub">· confira o que veio preenchido</span></div>
      <div class="no-docs-linha">
        ${item('Contracheque', cc, `${noEsc(cc.layout || '')} · ${cc.convenio ? 'convênio e ' : ''}vínculo preenchido`)}
        ${item('Espelho da proposta', es, `${nPorts} portabilidade${nPorts !== 1 ? 's' : ''}${es.banco_destino && es.banco_destino.doc ? ', banco de destino' : ''}${es.prazo_refin ? ', prazo do refin' : ''}${es.parcela_refin > 0 ? ', parcela do refin' : ''}${es.credito_bruto ? ' e crédito bruto' : ''}`)}
      </div>
      ${alertas.map(a => `<p class="no-docs-cpf" role="alert">${a}</p>`).join('')}
      ${cc.status !== 'ok' || es.status !== 'ok' ? '<span class="no-docs-dica">O que não foi lido fica em branco para preencher à mão.</span>' : ''}
    </div>
    <button type="button" class="btn btn-secondary" data-acao="ler-docs">Ler de novo</button>`;
  if (window.lucide) lucide.createIcons();
}

async function noLerDocumentos() {
  if (!NovaOp.leadId) return;
  noRenderDocs('lendo');
  try {
    const res = await fetchWithAuth(`/api/crm/leads/${NovaOp.leadId}/ler-documentos`, { method: 'POST' });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || 'Erro ao ler os documentos.');
    NovaOp.leitura = r;
    noAplicarLeitura();
  } catch (err) {
    NovaOp.leitura = { contracheque: { status: 'erro', motivo: err.message }, espelho: { status: 'erro', motivo: err.message } };
    noRenderDocs();
    noMarcarPendentes();
  }
}

function noAplicarLeitura() {
  const l = NovaOp.leitura;
  const tela = document.getElementById('nova-operacao');
  const set = (campo, valor) => { const el = tela.querySelector(`[data-campo="${campo}"]`); if (el && valor != null && valor !== '') { el.value = valor; } };
  const brl = v => (v == null ? '' : noMoeda(v));

  if (l.contracheque.status === 'ok') {
    const c = l.contracheque;
    set('matricula', c.matricula); set('orgao', c.orgao); set('cargo', c.cargo); set('situacao_funcional', c.situacao);
    // Convênio pelo layout do contracheque: preenche se vazio; se já escolhido e diferente, só avisa
    NovaOp.convenioDiferente = null;
    if (c.convenio) {
      const conv = tela.querySelector('[data-campo="produto_id"]');
      if (conv && !conv.value) conv.value = c.convenio.id;
      else if (conv && String(conv.value) !== String(c.convenio.id)) NovaOp.convenioDiferente = c.convenio.nome;
    }
    // Endereço do contracheque (GOV BA) só entra onde o cadastro ainda está vazio
    const vazio = campo => !String(tela.querySelector(`[data-campo="${campo}"]`)?.value || '').trim();
    if (c.cep && vazio('cep')) set('cep', c.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2'));
    if (c.endereco && vazio('endereco')) set('endereco', c.endereco);
    if (c.cidade && vazio('cidade')) set('cidade', c.cidade);
    if (c.uf && vazio('uf')) set('uf', c.uf);
  }
  if (l.espelho.status === 'ok' && l.espelho.portabilidades.length) {
    const e = l.espelho;
    NovaOp.ports = e.portabilidades.map(p => ({
      banco: p.banco_nome || '',
      doc: p.banco_id ? undefined : p.banco_nome_doc,
      numero_contrato: p.numero_contrato || '',
      semNumero: !p.numero_contrato,
      parcela: brl(p.parcela),
      prazo_restante: p.prazo_restante ?? '',
      saldo_devedor: brl(p.saldo_devedor)
    }));
    NovaOp.formato = 'port_refin';
    tela.querySelectorAll('.no-tipo-seg input').forEach(i => { i.checked = i.value === 'port_refin'; i.closest('label').classList.toggle('on', i.checked); });
    noRenderFormato();
    NovaOp.refinDoc = e.banco_destino && e.banco_destino.doc && !e.banco_destino.id ? e.banco_destino.doc : null;
    if (e.banco_destino && e.banco_destino.nome) set('refin.banco_id', e.banco_destino.nome);
    if (e.credito_bruto) set('refin.valor_liberado', brl(e.credito_bruto));
    if (e.prazo_refin) set('refin.prazo', e.prazo_refin);
    if (e.parcela_refin > 0) set('refin.parcela', brl(e.parcela_refin));
    const refinBanco = tela.querySelector('[data-campo="refin.banco_id"]');
    if (refinBanco && NovaOp.refinDoc) {
      refinBanco.insertAdjacentHTML('afterend', `<span class="no-aviso-doc">No espelho o banco de destino é “${noEsc(NovaOp.refinDoc)}”. Escolha na lista: o nome fica guardado.</span>`);
    }
    const lib = tela.querySelector('[data-campo="refin.valor_liberado"]');
    if (lib && e.credito_bruto) lib.closest('.no-lb').querySelector('span').innerHTML = 'Valor liberado <abbr title="obrigatório">*</abbr> · crédito bruto do espelho';
  }
  noRenderDocs();
  noMarcarPendentes();
}

// Depois da leitura: o que ficou obrigatório e vazio já aparece em vermelho
// (e some sozinho conforme é preenchido)
function noMarcarPendentes() {
  NovaOp.tentouSalvar = true;
  noValidarEMostrar();
  noAtualizarRodape();
}

// ---------------------------------------------------------------------------
// Cliente: nascimento, endereço (com busca pelo CEP), dados bancários do kanban
// ---------------------------------------------------------------------------
function noPreencherCliente() {
  const c = NovaOp.cli || {};
  const tela = document.getElementById('nova-operacao');
  const set = (campo, valor) => { const el = tela.querySelector(`[data-campo="${campo}"]`); if (el && valor != null && valor !== '') el.value = valor; };
  set('data_nascimento', c.data_nascimento ? String(c.data_nascimento).slice(0, 10) : '');
  set('cep', c.cep || ''); set('endereco', c.endereco || ''); set('cidade', c.cidade || ''); set('uf', c.uf || '');
  if (c.canal_venda_id) set('canal_venda_id', c.canal_venda_id);
  if (document.getElementById('no-cli-banco')) {
    document.getElementById('no-cli-banco').textContent = c.banco || '—';
    document.getElementById('no-cli-agencia').textContent = c.agencia || '—';
    document.getElementById('no-cli-conta').textContent = c.conta || '—';
  }
  const cpfAv = tela.querySelector('[data-campo="avulsa.cpf"]');
  if (cpfAv && !cpfAv.dataset.ligado) {
    cpfAv.dataset.ligado = '1';
    cpfAv.addEventListener('input', () => {
      const d = cpfAv.value.replace(/\D/g, '').slice(0, 11);
      cpfAv.value = d.length > 9 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d.length > 6 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}` : d.length > 3 ? `${d.slice(0, 3)}.${d.slice(3)}` : d;
      if (d.length === 11 && d !== cpfAv.dataset.buscado) { cpfAv.dataset.buscado = d; noBuscarCpfAvulsa(d); }
    });
  }
  const cep = tela.querySelector('[data-campo="cep"]');
  if (cep && !cep.dataset.ligado) {
    cep.dataset.ligado = '1';
    cep.addEventListener('input', () => {
      const d = cep.value.replace(/\D/g, '').slice(0, 8);
      cep.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
      if (d.length === 8 && d !== cep.dataset.buscado) noBuscarCep(d);
    });
  }
}

// Busca o endereço pelo CEP (ViaCEP); só preenche, o consultor confere e completa o número
async function noBuscarCep(cep) {
  const tela = document.getElementById('nova-operacao');
  const status = document.getElementById('no-cep-status');
  const campo = tela.querySelector('[data-campo="cep"]');
  campo.dataset.buscado = cep;
  status.textContent = 'Buscando o endereço pelo CEP…';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    if (j.erro) { status.textContent = 'CEP não encontrado: preencha o endereço à mão.'; return; }
    const set = (c, v) => { const el = tela.querySelector(`[data-campo="${c}"]`); if (el && v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('endereco', [j.logradouro, j.complemento, j.bairro].filter(Boolean).join(', '));
    set('cidade', j.localidade);
    const uf = tela.querySelector('[data-campo="uf"]'); if (uf && j.uf) { uf.value = j.uf; uf.dispatchEvent(new Event('change', { bubbles: true })); }
    status.textContent = 'Endereço preenchido pelo CEP: complete o número.';
    tela.querySelector('[data-campo="endereco"]').focus();
  } catch (_) {
    status.textContent = 'Não foi possível buscar o CEP agora: preencha o endereço à mão.';
  }
}
