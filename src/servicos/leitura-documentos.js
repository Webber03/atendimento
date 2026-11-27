// Leitura por regras dos PDFs do lead (sem IA, nada sai do servidor).
// - Contracheque (SIAPE/Sigepe e GOV BA "Aviso de Crédito"): só dados pessoais.
// - Espelho da proposta (simulação ConnectMax "Proposta de Portabilidade"):
//   portabilidades, banco de destino do refin e crédito bruto.
// Os PDFs são texto (não imagem): cada pedaço tem posição x/y, e as colunas
// são encontradas pelos rótulos/cabeçalhos de cada documento.

let pdfjs = null;
function carregarPdfjs() {
  if (pdfjs) return pdfjs;
  // A biblioteca avisa que não achou "canvas" (só serve para desenhar o PDF): silencia ao carregar
  const aviso = console.warn; const log = console.log;
  console.warn = () => {}; console.log = () => {};
  try { pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.warn = aviso; console.log = log; }
  return pdfjs;
}

// Linhas do PDF: [{ pagina, y, itens: [{ x, s }] }], de cima para baixo
async function extrairLinhas(buffer) {
  const lib = carregarPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false, disableFontFace: true }).promise;
  const todas = [];
  const paginas = Math.min(doc.numPages, 4);
  for (let p = 1; p <= paginas; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const linhas = [];
    for (const it of tc.items) {
      const s = (it.str || '').replace(/\s+/g, ' ').trim();
      if (!s) continue;
      const y = Math.round(it.transform[5]);
      let l = linhas.find(v => Math.abs(v.y - y) <= 2);
      if (!l) { l = { pagina: p, y, itens: [] }; linhas.push(l); }
      l.itens.push({ x: Math.round(it.transform[4]), s });
    }
    linhas.forEach(l => l.itens.sort((a, b) => a.x - b.x));
    linhas.sort((a, b) => b.y - a.y);
    todas.push(...linhas);
  }
  await doc.destroy();
  return todas;
}

const texto = l => l.itens.map(i => i.s).join(' ');
const sem = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

function lerMoeda(s) {
  // "-R$ 50,00" e "- R$ 50,00" (sinal separado do número no PDF) viram -50,00
  const m = String(s || '').replace(/R\$\s*/g, '').replace(/-\s+/g, '-').match(/-?\d{1,3}(\.\d{3})*,\d{2}|-?\d+,\d{2}/);
  if (!m) return null;
  return Number(m[0].replace(/\./g, '').replace(',', '.'));
}
function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }

// Valor logo abaixo de um rótulo, na mesma coluna (mesmo x, com tolerância)
function valorAbaixo(linhas, rotulo, { tolerancia = 8, desde = 0 } = {}) {
  const alvo = sem(rotulo);
  for (let i = desde; i < linhas.length; i++) {
    const item = linhas[i].itens.find(it => sem(it.s) === alvo || sem(it.s).startsWith(alvo + ' '));
    if (!item) continue;
    for (let j = i + 1; j < Math.min(i + 3, linhas.length); j++) {
      if (linhas[j].pagina !== linhas[i].pagina) break;
      const v = linhas[j].itens.find(it => Math.abs(it.x - item.x) <= tolerancia);
      if (v) return { valor: v.s, linha: j };
    }
    return null;
  }
  return null;
}

// Texto à direita de um rótulo na mesma linha ("Banco de Destino:  BRADESCO S/A - 120")
function valorAoLado(linhas, rotulo) {
  const alvo = sem(rotulo);
  for (const l of linhas) {
    const idx = l.itens.findIndex(it => sem(it.s).startsWith(alvo));
    if (idx < 0) continue;
    const depois = [];
    for (const it of l.itens.slice(idx + 1)) { if (/:\s*$/.test(it.s)) break; depois.push(it.s); } // para no próximo rótulo
    const resto = depois.join(' ').trim();
    if (resto) return resto;
    const proprio = l.itens[idx].s.slice(rotulo.length).trim();
    if (proprio) return proprio;
  }
  return null;
}

function detectar(linhas) {
  const tudo = sem(linhas.slice(0, 40).map(texto).join(' | '));
  if (tudo.includes('COMPROVANTE DE RENDIMENTOS') && tudo.includes('MAT. SIAPE')) return 'siape';
  if (tudo.includes('GOVERNO DO ESTADO DA BAHIA') && tudo.includes('AVISO DE CREDITO')) return 'govba';
  if (tudo.includes('PROPOSTA DE PORTABILIDADE') && tudo.includes('CONTRATOS PORTADOS')) return 'espelho';
  return null;
}

function lerSiape(linhas) {
  const v = r => (valorAbaixo(linhas, r) || {}).valor || null;
  const iTitulo = linhas.findIndex(l => sem(texto(l)).includes('COMPROVANTE DE RENDIMENTOS'));
  const orgao = iTitulo >= 0 && linhas[iTitulo + 1] ? texto(linhas[iTitulo + 1]) : null;
  // Conta de salário: primeira linha BANCO / AGÊNCIA / CONTA SALÁRIO
  const banco = valorAbaixo(linhas, 'BANCO');
  let conta = null;
  if (banco) {
    const l = linhas[banco.linha];
    const ag = l.itens[1]; const ct = l.itens[2];
    conta = { banco: banco.valor, agencia: ag ? ag.s : null, conta: ct ? ct.s : null };
  }
  return {
    layout: 'SIAPE',
    nome: v('NOME DO SERVIDOR'),
    cpf: soDigitos(v('CPF')) || null,
    matricula: v('MAT. SIAPE'),
    orgao,
    cargo: v('CARGO/EMPREGO'),
    situacao: v('SITUAÇÃO FUNCIONAL'),
    competencia: v('MÊS/ANO PAGAMENTO'),
    conta_salario: conta
  };
}

function lerGovBa(linhas) {
  const v = r => (valorAbaixo(linhas, r) || {}).valor || null;
  const ba = v('BANCO / AGÊNCIA');
  const [banco, agencia] = ba ? ba.split('/').map(s => s.trim()) : [null, null];
  const competencia = (linhas.find(l => /^[A-Za-zçÇ]+\/\d{4}$/.test(texto(l))) || null);
  return {
    layout: 'GOV BA',
    nome: v('NOME'),
    cpf: soDigitos(v('CPF')) || null,
    matricula: v('MATRÍCULA'),
    orgao: v('ORGÃO/ENTIDADE'),
    cargo: v('CARGO / FUNÇÃO'),
    situacao: v('GRUPO / SUBGRUPO'),
    unidade: v('UNIDADE'),
    admissao: v('ADMISSÃO'),
    endereco: [v('ENDEREÇO'), v('NÚMERO'), v('COMPLEMENTO ENDEREÇO')].filter(Boolean).join(', ') || null,
    cep: (soDigitos(v('CEP')) || '').slice(0, 8) || null,
    cidade: v('MUNICÍPIO'),
    uf: (v('U.F.') || '').slice(0, 2).toUpperCase() || null,
    competencia: competencia ? texto(competencia) : null,
    conta_salario: banco ? { banco, agencia: agencia || null, conta: v('CONTA CORRENTE') } : null
  };
}

function lerEspelho(linhas) {
  const avisos = [];
  const cliente = valorAoLado(linhas, 'Cliente:');
  const cpf = soDigitos(valorAoLado(linhas, 'CPF:'));
  const emissao = (valorAoLado(linhas, 'Emissão:') || '').match(/\d{2}\/\d{2}\/\d{4}/);

  // Cabeçalho da tabela: Banco | Contrato | Parcela | Prazo Rest. | Saldo Devedor
  const iCab = linhas.findIndex(l => { const t = sem(texto(l)); return t.includes('BANCO') && t.includes('CONTRATO') && t.includes('SALDO DEVEDOR'); });
  const portabilidades = [];
  if (iCab >= 0) {
    const cab = linhas[iCab];
    const colunaX = nome => { const it = cab.itens.find(i => sem(i.s).startsWith(nome)); return it ? it.x : null; };
    const cols = [
      ['banco', colunaX('BANCO')], ['contrato', colunaX('CONTRATO')], ['parcela', colunaX('PARCELA')],
      ['prazo', colunaX('PRAZO')], ['saldo', colunaX('SALDO DEVEDOR')]
    ].filter(c => c[1] != null).sort((a, b) => a[1] - b[1]);
    for (let i = iCab + 1; i < linhas.length; i++) {
      const l = linhas[i];
      const t = sem(texto(l));
      if (t.startsWith('RESUMO DA OPERACAO') || t.includes('SOMA DAS PARCELAS')) break;
      if (l.pagina !== cab.pagina) break;
      const valores = {};
      l.itens.forEach(it => {
        // coluna = a última cujo início fica à esquerda do item (com folga)
        let col = cols[0][0];
        cols.forEach(([nome, x]) => { if (it.x >= x - 6) col = nome; });
        valores[col] = valores[col] ? `${valores[col]} ${it.s}` : it.s;
      });
      if (!valores.banco && !valores.parcela) continue;
      const linha = {
        banco_nome_doc: (valores.banco || '').trim(),
        numero_contrato: (valores.contrato || '').trim() || null,
        parcela: lerMoeda(valores.parcela),
        prazo_restante: valores.prazo && /^\d{1,3}$/.test(valores.prazo.trim()) ? Number(valores.prazo.trim()) : null,
        saldo_devedor: lerMoeda(valores.saldo)
      };
      if (!linha.numero_contrato) avisos.push(`Linha ${portabilidades.length + 1}: o espelho não traz o nº do contrato.`);
      portabilidades.push(linha);
    }
  }
  if (!portabilidades.length) avisos.push('Nenhuma portabilidade encontrada na tabela do espelho.');

  const bruto = lerMoeda(valorAoLado(linhas, 'Estimativa Crédito Bruto'));
  const somaParcelas = lerMoeda(valorAoLado(linhas, 'Soma das Parcelas Originais'));
  const margem = lerMoeda(valorAoLado(linhas, 'Margem Utilizada'));
  // "Banco de Destino: BRADESCO S/A - 120": o número depois do traço é o prazo do refin (meses)
  const destinoTxt = (valorAoLado(linhas, 'Banco de Destino:') || '').trim();
  const mDestino = destinoTxt.match(/^(.*?)\s*-\s*(\d{2,3})$/);
  const prazoRefin = mDestino && Number(mDestino[2]) > 0 && Number(mDestino[2]) <= 240 ? Number(mDestino[2]) : null;
  return {
    layout: 'Espelho ConnectMax',
    cliente: cliente || null,
    cpf: cpf || null,
    emissao: emissao ? emissao[0] : null,
    portabilidades,
    banco_destino_doc: (prazoRefin ? mDestino[1] : destinoTxt).trim() || null,
    prazo_refin: prazoRefin,
    credito_bruto: bruto,
    soma_parcelas: somaParcelas,
    margem_utilizada: margem,
    // Parcela do refin = soma das parcelas originais + margem utilizada (negativa reduz)
    parcela_refin: somaParcelas == null ? null : Math.round((somaParcelas + (margem || 0)) * 100) / 100,
    saldo_total: lerMoeda(valorAoLado(linhas, 'Saldo Devedor Total:')),
    avisos
  };
}

// Lê um PDF e devolve { tipo, dados } ou { tipo: null } se o layout não for conhecido
async function lerDocumento(buffer, esperado) {
  const linhas = await extrairLinhas(buffer);
  if (!linhas.length) return { tipo: null, motivo: 'O PDF não tem texto (pode ser imagem escaneada).' };
  const tipo = detectar(linhas);
  if (!tipo) return { tipo: null, motivo: 'Layout não reconhecido.' };
  if (esperado === 'contracheque' && tipo === 'espelho') return { tipo: null, motivo: 'No lugar do contracheque está um espelho de proposta.' };
  if (esperado === 'espelho' && tipo !== 'espelho') return { tipo: null, motivo: 'No lugar do espelho está outro documento.' };
  const dados = tipo === 'siape' ? lerSiape(linhas) : tipo === 'govba' ? lerGovBa(linhas) : lerEspelho(linhas);
  return { tipo, dados };
}

module.exports = { lerDocumento, extrairLinhas, detectar, lerSiape, lerGovBa, lerEspelho, lerMoeda };
