// Normaliza nomes vindos de documentos para comparação:
// maiúsculas, sem acento, sem pontuação e com espaços únicos.
// "Paraná  Banco S.A." -> "PARANA BANCO S A"
function normalizarNome(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

module.exports = { normalizarNome };
