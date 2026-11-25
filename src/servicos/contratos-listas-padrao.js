// Conteúdo inicial das listas do módulo Contratos.
// Só é usado quando a lista ainda está vazia no banco: depois disso quem manda
// é o que Operacional/Admin editarem na tela "Listas & Status".

const BANCOS = [
  'AGIBANK', 'AKI CAPITAL', 'ALFA', 'ARBI', 'ASSOCIAÇÃO - ABESP', 'ASSOCIAÇÃO - ASSEBA',
  'ASSOCIAÇÃO - ASTEBA', 'BANCO BTW', 'BANCO DO BRASIL', 'BANCO INTER', 'BANCO PAN',
  'BANCO SEGURO', 'BANESE', 'BANRISUL', 'BIC BANCO', 'BMG', 'BNP PARIBAS',
  'BRADESCO PROMOTORA', 'BRADESCO SA', 'BRB', 'BRB CFI', 'BRB CONSIG360',
  'BRB CONSIG360 - CAIXA', 'BV', 'C6 BANK', 'CAIXA ECONÔMICA', 'CETELEM', 'CIASPREV',
  'CREFAZ', 'CREFISA', 'DAYCOVAL', 'DIGIMAIS', 'DIGIO', 'ERBANK', 'EXÉRCITO',
  'FACTA FINANCEIRA', 'FATOR CARD', 'FICSA', 'FINTECH CORBAN', 'FUTURO PREVIDÊNCIA',
  'GOOROO', 'HAPPY', 'HCRED', 'ICRED', 'INBURSA', 'INDUSTRIAL', 'ITAÚ', 'ITAÚ BMG',
  'KARDBANK', 'MASTER', 'MERCANTIL', 'NBC BANK', 'NOSSA FINTECH', 'NUBANK',
  'OLÉ CONSIGNADO', 'PAGBANK', 'PARANÁ BANCO', 'PARATI', 'PAULISTA', 'PHTECH',
  'PICPAY BANK', 'PINE', 'PRATA DIGITAL', 'PRESENÇA BANK', 'QI SCD', 'QUALIBANK',
  'QUERO MAIS', 'SABEMI', 'SAFRA', 'SANTANDER', 'SICOOB', 'STAR BANK', 'TROCA CRÉDITOS',
  'VCTEX', 'VIDA CARD'
];

const PRODUTOS = ['GOV BA', 'INSS', 'SIAPE', 'TJ', 'FGTS', 'CLT'];
const TABELAS = ['NORMAL', 'CONSULTORIA PEN', 'CONSULTORIA OK'];
const TIPOS = [
  'NOVO', 'REFINANCIAMENTO', 'PORTABILIDADE', 'REFIN-PORTABILIDADE',
  'CARTÃO C/SAQUE', 'CARTÃO BENEFÍCIO', 'CARTÃO BENEFÍCIO C/SAQUE'
];
const PARCEIROS = ['LF PROMOTORA', 'EDUCRED', 'CREDVALOR', 'BEATRIZ FIGUEIRO - SP', 'TN PROMOTORA'];

// Como o banco aparece no espelho da proposta (simulação ConnectMax) e nos contracheques
const NOMES_NOS_DOCUMENTOS = {
  'PARANÁ BANCO': ['PARANA BANCO', 'PARANÁ'],
  'BRB CFI': ['FINANCEIRA BRB'],
  'BRADESCO SA': ['BRADESCO S/A', 'BRADESCO S/A - 120'],
  'PRATA DIGITAL': ['BANCO PRATA'],
  'DIGIO': ['BANCO DIGIO S.A'],
  'BANCO PAN': ['PANAMERICANO'],
  'AGIBANK': ['AGIPLAN'],
  'BANCO INTER': ['INTERMEDIUM'],
  'BANCO DO BRASIL': ['BB'],
  'NUBANK': ['NUBANCK'],
  'CREFISA': ['BANCO CREFISA', 'BANCO CREFISA SA'],
  'BNP PARIBAS': ['PARIBAS', 'BANCO BNP PARIBAS']
};

// Fases: só organizam a tela; qualquer status pode ir para qualquer outro.
const FASES = [
  { chave: 'digitacao', nome: 'Digitação' },
  { chave: 'auditoria', nome: 'Auditoria' },
  { chave: 'analise_interna', nome: 'Análise interna' },
  { chave: 'banco_averbacao', nome: 'Banco e averbação' },
  { chave: 'pagamento', nome: 'Pagamento' },
  { chave: 'encerrado', nome: 'Encerrado' }
];

const STATUS = [
  ['AGUARDANDO RECEPÇÃO', 'digitacao'],
  ['ENVIADO DIGITAÇÃO', 'digitacao'],
  ['AGUARDANDO REDIGITAÇÃO', 'digitacao'],
  ['PORT - CEF (AG. LIBERAR DIG)', 'digitacao'],
  ['AG. PORT FINALIZAR', 'digitacao'],
  ['AGUARDANDO AUDITORIA', 'auditoria'],
  ['AUDITORIA EM ANDAMENTO', 'auditoria'],
  ['LIBERADO AUDITORIA', 'auditoria'],
  ['REPROVADO AUDITORIA', 'auditoria'],
  ['AG. PARECER CONSULTOR', 'analise_interna'],
  ['AGUARDANDO ESTRATÉGIA', 'analise_interna'],
  ['AGUARDANDO RETORNO CIP', 'banco_averbacao'],
  ['SALDO RECEPCIONADO', 'banco_averbacao'],
  ['SALDO PG - AG. AVER', 'banco_averbacao'],
  ['AGUARDANDO AVERBAÇÃO', 'banco_averbacao'],
  ['AVERBADO', 'banco_averbacao'],
  ['AGUARDANDO PAGAMENTO', 'pagamento'],
  ['PAGO', 'pagamento'],
  ['CANCELADO', 'encerrado']
];

const STATUS_INICIAL = 'AGUARDANDO RECEPÇÃO';

// Tipos gravados automaticamente pelo formato da operação: não podem ser renomeados nem desativados
const TIPO_PORTABILIDADE = 'PORTABILIDADE';
const TIPO_REFIN_PORT = 'REFIN-PORTABILIDADE';
const TIPOS_AUTOMATICOS = [TIPO_PORTABILIDADE, TIPO_REFIN_PORT];

module.exports = {
  BANCOS, PRODUTOS, TABELAS, TIPOS, PARCEIROS, NOMES_NOS_DOCUMENTOS,
  FASES, STATUS, STATUS_INICIAL, TIPO_PORTABILIDADE, TIPO_REFIN_PORT, TIPOS_AUTOMATICOS
};
