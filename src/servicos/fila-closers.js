const { dbAll, dbGet, dbRun } = require('../../database');

// Mutex em memória para serializar chamadas assíncronas concorrentes e evitar race condition na fila
let filaCloserMutex = Promise.resolve();

async function getNextCloserFromQueue(excludeUserId = null) {
  return new Promise((resolve, reject) => {
    filaCloserMutex = filaCloserMutex
      .catch(() => {})
      .then(async () => {
        try {
          const closerId = await _getNextCloserInternal(excludeUserId);
          resolve(closerId);
        } catch (err) {
          reject(err);
        }
      });
  });
}

async function _getNextCloserInternal(excludeUserId = null) {
  // 1. Busca todos os consultores ativos na fila, ordenados estritamente por f.ordem ASC, f.id ASC
  const activeClosers = await dbAll(`
    SELECT f.id, f.closer_id, f.peso, f.ordem, u.username
    FROM crm_fila_closers f
    JOIN users u ON f.closer_id = u.id
    WHERE f.ativo = TRUE AND u.active = TRUE
    ORDER BY f.ordem ASC, f.id ASC
  `);

  if (!activeClosers || activeClosers.length === 0) {
    return null;
  }

  // 2. Monta os slots de repetição respeitando a ordem e o peso de cada consultor
  // Exemplo: se consultor 1 tem peso 2, consultor 2 peso 1, consultor 3 peso 2, consultor 4 peso 1
  // Slots: [C1, C1, C2, C3, C3, C4] -> ordem estrita: 1 > 1 > 2 > 3 > 3 > 4 > 1 > 1...
  const slots = [];
  for (const c of activeClosers) {
    const peso = Math.max(1, parseInt(c.peso, 10) || 1);
    for (let i = 0; i < peso; i++) {
      slots.push({
        closer_id: c.closer_id,
        fila_id: c.id
      });
    }
  }

  if (slots.length === 0) {
    return null;
  }

  // 3. Lê o ponteiro atual persistido no banco de dados
  const pointerRow = await dbGet("SELECT value FROM system_settings WHERE key = 'crm_fila_closers_pointer'");
  let currentPointer = -1;
  if (pointerRow && pointerRow.value !== null && pointerRow.value !== undefined) {
    const parsed = parseInt(pointerRow.value, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      currentPointer = parsed;
    }
  }

  // 4. Próximo índice sequencial circular indexado
  let nextIndex = (currentPointer + 1) % slots.length;
  let selectedSlot = slots[nextIndex];
  let chosenIndex = nextIndex;

  // 5. Tratamento de excludeUserId (ex: evitar auto-distribuição caso o consultor seja o próprio SDR)
  if (excludeUserId && selectedSlot.closer_id === excludeUserId) {
    for (let step = 1; step < slots.length; step++) {
      const candidateIdx = (nextIndex + step) % slots.length;
      if (slots[candidateIdx].closer_id !== excludeUserId) {
        selectedSlot = slots[candidateIdx];
        chosenIndex = candidateIdx;
        break;
      }
    }
  }

  // 6. Atualiza o ponteiro persistido no banco
  await dbRun(
    `INSERT INTO system_settings (key, value) VALUES ('crm_fila_closers_pointer', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value
     RETURNING key`,
    [String(chosenIndex)]
  );

  // 7. Atualiza o carimbo de última atribuição para fins de histórico/auditoria
  await dbRun(
    `UPDATE crm_fila_closers SET ultima_atribuicao_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [selectedSlot.fila_id]
  );

  return selectedSlot.closer_id;
}

module.exports = { getNextCloserFromQueue };
