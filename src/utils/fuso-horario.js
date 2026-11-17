

// ----------------------------------------
// FUSO HORÁRIO: dados em UTC, períodos calculados no horário de Brasília
// ----------------------------------------
const TZ_LOCAL = 'America/Sao_Paulo';

// Converte um timestamp "de parede" de Brasília (sem fuso) para o UTC gravado no banco
const sqlLocalParaUtc = (expr) => `((${expr}) AT TIME ZONE '${TZ_LOCAL}' AT TIME ZONE 'UTC')`;

// Converte um timestamp UTC do banco para o horário de Brasília (para agrupar por dia local)
const sqlUtcParaLocal = (expr) => `((${expr}) AT TIME ZONE 'UTC' AT TIME ZONE '${TZ_LOCAL}')`;

// Meia-noite de hoje em Brasília (timestamp sem fuso)
const SQL_HOJE_LOCAL = `DATE_TRUNC('day', NOW() AT TIME ZONE '${TZ_LOCAL}')`;

// Intervalo de datas YYYY-MM-DD (inclusive) em Brasília, comparado direto na coluna (usa índice)
const sqlIntervaloDatasLocal = (col) =>
  `${col} >= ${sqlLocalParaUtc('?::date::timestamp')} AND ${col} < ${sqlLocalParaUtc("?::date::timestamp + INTERVAL '1 day'")}`;

// Data (YYYY-MM-DD) e data/hora no horário de Brasília (Node), para CSV e sincronizações
function dataIsoBrasilia(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_LOCAL, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function dataHoraBrasilia(valor) {
  if (!valor) return '';
  const d = valor instanceof Date ? valor : new Date(valor);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { timeZone: TZ_LOCAL });
}

module.exports = { SQL_HOJE_LOCAL, TZ_LOCAL, dataHoraBrasilia, dataIsoBrasilia, sqlIntervaloDatasLocal, sqlLocalParaUtc, sqlUtcParaLocal };
