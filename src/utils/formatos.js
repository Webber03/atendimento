

function parseBrDateTime(brStr) {
  if (!brStr) return null;
  const match = brStr.toString().trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    const hh = (match[4] || '00').padStart(2, '0');
    const mm = (match[5] || '00').padStart(2, '0');
    const ss = (match[6] || '00').padStart(2, '0');
    return `${year}-${month}-${day} ${hh}:${mm}:${ss}`;
  }
  return null;
}

function parseValueFromString(str) {
  if (str === undefined || str === null) return 0.00;
  // Limpa e trata formatos como "R$ 1.500,00", "1500", "1500,00"
  let cleaned = str.toString().trim()
    .replace(/R\$/gi, '')
    .replace(/\s/g, '');
    
  // Extrai apenas o padrão de números (incluindo pontos e vírgulas)
  const match = cleaned.match(/[\d.,]+/);
  if (!match) return 0.00;
  
  let numStr = match[0];
  
  if (numStr.includes('.') && numStr.includes(',')) {
    if (numStr.indexOf('.') < numStr.indexOf(',')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else {
      numStr = numStr.replace(/,/g, '');
    }
  } else if (numStr.includes(',')) {
    numStr = numStr.replace(',', '.');
  }
  
  const parsed = parseFloat(numStr);
  return isNaN(parsed) ? 0.00 : parsed;
}

function sanitizeCpf(val) {
  if (val === undefined || val === null) return null;
  const digits = val.toString().replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 11) {
    return digits.padStart(11, '0');
  }
  return digits;
}

function formatCpf(cpf) {
  if (!cpf) return '';
  const digits = String(cpf).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 11) {
    return digits.padStart(11, '0').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return String(cpf);
}

// ----------------------------------------
// MÓDULO DE RELATÓRIOS CRM ANALÍTICOS
// ----------------------------------------

// Motivos de perda da coluna: sempre em MAIÚSCULAS, sem espaços sobrando, separados por ", "
function normalizarMotivosPerda(texto) {
  return String(texto)
    .split(',')
    .map(m => m.trim().toLocaleUpperCase('pt-BR'))
    .filter(Boolean)
    .join(', ');
}

function formatCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

// CPF nas exportações: só dígitos (sem pontos e traço), com zeros à esquerda até 11
function cpfSomenteNumeros(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (!d) return '';
  return d.length < 11 ? d.padStart(11, '0') : d;
}

module.exports = { cpfSomenteNumeros, formatCpf, formatCsvField, normalizarMotivosPerda, parseBrDateTime, parseValueFromString, sanitizeCpf };
