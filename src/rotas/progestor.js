const express = require('express');
const { dbAll, dbGet, dbRun } = require('../../database');
const { requireAuth, requireRole } = require('../../auth');
const { dataIsoBrasilia } = require('../utils/fuso-horario');

const router = express.Router();

// ----------------------------------------
// PROGESTOR TABULATIONS INTEGRATION
// ----------------------------------------

let progestorCache = {
  data: null,
  lastFetched: 0,
  url: null
};

const PROGESTOR_CACHE_TTL = 55000;

 // 55 seconds

async function scrapeProgestorTabulacoes(manualUrl = null) {
  const mainUrl = 'https://sistemanovo.progestor21.com.br/sistema/atendimentos';
  const baseUrl = 'https://sistemanovo.progestor21.com.br';
  
  let jsonUrl = manualUrl;
  
  if (!jsonUrl) {
    // 1. Fetch the main atendimentos page
    const response = await fetch(mainUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!response.ok) {
      throw new Error(`Falha ao acessar a página principal do Progestor: HTTP ${response.status}`);
    }
    const html = await response.text();
    
    // 2. Extract JSON path from window.location redirect
    // window.location='/sistema/_lib/tmp/sc_json_..._grid_tb_telemarketing.json';
    let match = html.match(/window\.location\s*=\s*'([^']+sc_json_[^']+\.json)'/) 
             || html.match(/window\.location\s*=\s*"([^"]+sc_json_[^"]+\.json)"/);
             
    if (!match) {
      throw new Error('Link temporário de tabulações não encontrado no window.location da página do Progestor.');
    }
    
    const jsonPath = match[1];
    jsonUrl = jsonPath.startsWith('http') ? jsonPath : `${baseUrl}/${jsonPath.replace(/^\//, '')}`;
  }
  
  // 3. Fetch the JSON file
  const jsonRes = await fetch(`${jsonUrl}?_t=${Date.now()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });
  if (!jsonRes.ok) {
    throw new Error(`Falha ao baixar o JSON de tabulações em ${jsonUrl}: HTTP ${jsonRes.status}`);
  }
  
  const data = await jsonRes.json();
  if (!Array.isArray(data)) {
    throw new Error('O arquivo retornado pelo Progestor não possui formato de lista de tabulações válido.');
  }
  return { data, jsonUrl };
}

router.get('/api/progestor/tabulacoes', requireAuth, async (req, res) => {
  const { url, force } = req.query;
  const isForce = force === 'true';
  
  let finalUrl = url;
  try {
    if (!finalUrl) {
      const urlRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_tabulacoes_url'");
      if (urlRow && urlRow.value) {
        finalUrl = urlRow.value;
      }
    }
  } catch (e) {
    console.error("Erro ao obter URL do Progestor das configs:", e);
  }
  
  // Return cache if valid and not forcing
  if (!isForce && progestorCache.data && (Date.now() - progestorCache.lastFetched < PROGESTOR_CACHE_TTL)) {
    if (!finalUrl || finalUrl === progestorCache.url) {
      return res.json({
        source: 'cache',
        lastFetched: progestorCache.lastFetched,
        url: progestorCache.url,
        data: progestorCache.data
      });
    }
  }
  
  try {
    const { data, jsonUrl } = await scrapeProgestorTabulacoes(finalUrl);
    
    progestorCache = {
      data,
      lastFetched: Date.now(),
      url: jsonUrl
    };
    
    res.json({
      source: 'remote',
      lastFetched: progestorCache.lastFetched,
      url: progestorCache.url,
      data: progestorCache.data
    });
  } catch (err) {
    console.error('Erro ao buscar tabulações do Progestor:', err);
    // Use stale cache as fallback if we have it
    if (progestorCache.data) {
      return res.json({
        source: 'fallback-cache',
        lastFetched: progestorCache.lastFetched,
        url: progestorCache.url,
        data: progestorCache.data,
        error: err.message
      });
    }
    res.status(502).json({ error: err.message });
  }
});

// Sync Progestor tabulations into daily records
router.post('/api/progestor/sincronizar', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { data, closedStatuses, unviableStatuses } = req.body;
  
  if (!Array.isArray(data)) {
    return res.status(400).json({ error: "O corpo da requisição deve conter o array 'data' de tabulações." });
  }

  try {
    let closedList = closedStatuses;
    let unviableList = unviableStatuses;

    if (!closedList || !unviableList) {
      const closedRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_closed'");
      const unviableRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_unviable'");
      closedList = (closedRow ? closedRow.value : '45').split(',').map(s => s.trim());
      unviableList = (unviableRow ? unviableRow.value : '33').split(',').map(s => s.trim());
    }

    const closedSet = new Set(closedList.map(s => String(s).trim()));
    const unviableSet = new Set(unviableList.map(s => String(s).trim()));

    // 1. Get consultants with progestor_user
    const dbConsultants = await dbAll("SELECT id, progestor_user FROM consultants WHERE progestor_user IS NOT NULL AND progestor_user <> ''");
    const consultantMap = new Map();
    dbConsultants.forEach(c => {
      consultantMap.set(c.progestor_user.trim().toLowerCase(), c.id);
    });

    // 2. Get channels with progestor_code
    const dbChannels = await dbAll("SELECT id, progestor_code FROM channels WHERE active = 1 AND progestor_code IS NOT NULL AND progestor_code <> ''");
    const channelMap = new Map();
    dbChannels.forEach(ch => {
      channelMap.set(ch.progestor_code.trim().toLowerCase(), ch.id);
    });

    // 3. Helper to format date DD/MM/YYYY into YYYY-MM-DD
    const parseDateToIso = (dateStr) => {
      if (!dateStr) return '';
      const parts = dateStr.trim().split(' ');
      const dateParts = parts[0].split('/');
      if (dateParts.length === 3) {
        return `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // YYYY-MM-DD
      }
      return '';
    };

    // 4. Group metrics by key: Date + "_" + ConsultantId + "_" + ChannelId
    const groups = {};

    data.forEach(r => {
      const func = String(r.Funcionario || '').trim().toLowerCase();
      const canal = String(r.Canalvenda || '').trim().toLowerCase();
      
      const consultantId = consultantMap.get(func);
      const channelId = channelMap.get(canal);
      
      const dateIso = parseDateToIso(r.Data);

      if (!consultantId || !channelId || !dateIso) {
        // Skip unmapped or invalid records
        return;
      }

      const key = `${dateIso}_${consultantId}_${channelId}`;
      if (!groups[key]) {
        groups[key] = {
          date: dateIso,
          consultantId,
          channelId,
          leadsTotais: 0,
          inviaveis: 0,
          fechados: 0
        };
      }

      groups[key].leadsTotais++;

      const rawStatusCode = String(r['Cod Status'] || r['Codstatus'] || r['codstatus'] || '').trim();
      
      if (closedSet.has(rawStatusCode)) {
        groups[key].fechados++;
      } else if (unviableSet.has(rawStatusCode)) {
        groups[key].inviaveis++;
      }
    });

    // 5. Upsert each group into daily_records
    let upsertCount = 0;
    for (const key of Object.keys(groups)) {
      const g = groups[key];
      
      await dbRun(`
        INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, 'Sincronizado automaticamente via Progestor')
        ON CONFLICT (date, consultant_id, channel_id)
        DO UPDATE SET
          leads_totais = EXCLUDED.leads_totais,
          inviaveis = EXCLUDED.inviaveis,
          fechados = EXCLUDED.fechados,
          observacoes = COALESCE(daily_records.observacoes, EXCLUDED.observacoes)
      `, [g.date, g.consultantId, g.channelId, g.leadsTotais, g.inviaveis, g.fechados]);

      upsertCount++;
    }

    res.json({ message: "Sincronização concluída com sucesso!", recordsSynced: upsertCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Retroactive full Progestor sync for all dates
router.post('/api/progestor/sincronizar-total', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    // 1. Get configurations from database
    const closedRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_closed'");
    const unviableRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_unviable'");
    const urlRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_tabulacoes_url'");

    const closedList = (closedRow ? closedRow.value : '45').split(',').map(s => s.trim());
    const unviableList = (unviableRow ? unviableRow.value : '33').split(',').map(s => s.trim());
    const finalUrl = urlRow ? urlRow.value : '';

    const closedSet = new Set(closedList.map(s => String(s).trim()));
    const unviableSet = new Set(unviableList.map(s => String(s).trim()));

    // 2. Fetch data from Progestor
    const { data } = await scrapeProgestorTabulacoes(finalUrl);
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: "Nenhum dado obtido do Progestor." });
    }

    // 3. Get consultants and channels mapping
    const dbConsultants = await dbAll("SELECT id, progestor_user FROM consultants WHERE progestor_user IS NOT NULL AND progestor_user <> ''");
    const consultantMap = new Map();
    dbConsultants.forEach(c => {
      consultantMap.set(c.progestor_user.trim().toLowerCase(), c.id);
    });

    const dbChannels = await dbAll("SELECT id, progestor_code FROM channels WHERE active = 1 AND progestor_code IS NOT NULL AND progestor_code <> ''");
    const channelMap = new Map();
    dbChannels.forEach(ch => {
      channelMap.set(ch.progestor_code.trim().toLowerCase(), ch.id);
    });

    // 4. Helper to format date
    const parseDateToIso = (dateStr) => {
      if (!dateStr) return '';
      const parts = dateStr.trim().split(' ');
      const dateParts = parts[0].split('/');
      if (dateParts.length === 3) {
        return `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
      }
      return '';
    };

    const groups = {};

    data.forEach(r => {
      const func = String(r.Funcionario || '').trim().toLowerCase();
      const canal = String(r.Canalvenda || '').trim().toLowerCase();
      
      const consultantId = consultantMap.get(func);
      const channelId = channelMap.get(canal);
      
      const dateIso = parseDateToIso(r.Data);

      if (!consultantId || !channelId || !dateIso) return;

      const key = `${dateIso}_${consultantId}_${channelId}`;
      if (!groups[key]) {
        groups[key] = {
          date: dateIso,
          consultantId,
          channelId,
          leadsTotais: 0,
          inviaveis: 0,
          fechados: 0
        };
      }

      groups[key].leadsTotais++;

      const rawStatusCode = String(r['Cod Status'] || r['Codstatus'] || r['codstatus'] || '').trim();
      
      if (closedSet.has(rawStatusCode)) {
        groups[key].fechados++;
      } else if (unviableSet.has(rawStatusCode)) {
        groups[key].inviaveis++;
      }
    });

    let upsertCount = 0;
    for (const key of Object.keys(groups)) {
      const g = groups[key];
      
      await dbRun(`
        INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, 'Sincronizado retroativamente via Progestor')
        ON CONFLICT (date, consultant_id, channel_id)
        DO UPDATE SET
          leads_totais = EXCLUDED.leads_totais,
          inviaveis = EXCLUDED.inviaveis,
          fechados = EXCLUDED.fechados,
          observacoes = COALESCE(daily_records.observacoes, EXCLUDED.observacoes)
      `, [g.date, g.consultantId, g.channelId, g.leadsTotais, g.inviaveis, g.fechados]);

      upsertCount++;
    }

    res.json({ message: `Sincronização histórica concluída com sucesso! ${upsertCount} registros sincronizados.`, recordsSynced: upsertCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Progestor Status mappings
router.get('/api/settings/progestor-status', requireAuth, async (req, res) => {
  try {
    const closedRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_closed'");
    const unviableRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_unviable'");
    const urlRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_tabulacoes_url'");
    res.json({
      closed: closedRow ? closedRow.value : '45',
      unviable: unviableRow ? unviableRow.value : '33',
      url: urlRow ? urlRow.value : ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Progestor Status mappings
router.post('/api/settings/progestor-status', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { closed, unviable, url } = req.body;
  try {
    await dbRun(`
      INSERT INTO system_settings (key, value) 
      VALUES ('progestor_mapping_closed', ?) 
      ON CONFLICT (key) 
      DO UPDATE SET value = EXCLUDED.value
      RETURNING key
    `, [closed || '45']);
    
    await dbRun(`
      INSERT INTO system_settings (key, value) 
      VALUES ('progestor_mapping_unviable', ?) 
      ON CONFLICT (key) 
      DO UPDATE SET value = EXCLUDED.value
      RETURNING key
    `, [unviable || '33']);

    await dbRun(`
      INSERT INTO system_settings (key, value) 
      VALUES ('progestor_tabulacoes_url', ?) 
      ON CONFLICT (key) 
      DO UPDATE SET value = EXCLUDED.value
      RETURNING key
    `, [url || '']);
    
    res.json({ message: "Configuração de integração do Progestor salva com sucesso!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Background auto-sync function for today and yesterday tabulations
async function runAutomaticProgestorSync() {
  console.log('[PROGESTOR SYNC] Iniciando sincronização automática de tabulações...');
  try {
    // 1. Get configurations from database
    const closedRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_closed'");
    const unviableRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_mapping_unviable'");
    const urlRow = await dbGet("SELECT value FROM system_settings WHERE key = 'progestor_tabulacoes_url'");

    const closedList = (closedRow ? closedRow.value : '45').split(',').map(s => s.trim());
    const unviableList = (unviableRow ? unviableRow.value : '33').split(',').map(s => s.trim());
    const finalUrl = urlRow ? urlRow.value : '';

    const closedSet = new Set(closedList.map(s => String(s).trim()));
    const unviableSet = new Set(unviableList.map(s => String(s).trim()));

    // 2. Fetch data from Progestor
    const { data } = await scrapeProgestorTabulacoes(finalUrl);
    if (!Array.isArray(data) || data.length === 0) {
      console.log('[PROGESTOR SYNC] Nenhum dado obtido do Progestor.');
      return;
    }

    // 3. Get consultants and channels mapping
    const dbConsultants = await dbAll("SELECT id, progestor_user FROM consultants WHERE progestor_user IS NOT NULL AND progestor_user <> ''");
    const consultantMap = new Map();
    dbConsultants.forEach(c => {
      consultantMap.set(c.progestor_user.trim().toLowerCase(), c.id);
    });

    const dbChannels = await dbAll("SELECT id, progestor_code FROM channels WHERE active = 1 AND progestor_code IS NOT NULL AND progestor_code <> ''");
    const channelMap = new Map();
    dbChannels.forEach(ch => {
      channelMap.set(ch.progestor_code.trim().toLowerCase(), ch.id);
    });

    // 4. Helper to format date
    const parseDateToIso = (dateStr) => {
      if (!dateStr) return '';
      const parts = dateStr.trim().split(' ');
      const dateParts = parts[0].split('/');
      if (dateParts.length === 3) {
        return `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
      }
      return '';
    };

    // Calculate Today and Yesterday ISO strings
    // "Hoje" e "ontem" no horário de Brasília (o servidor roda em UTC)
    const agora = new Date();
    const todayIso = dataIsoBrasilia(agora);
    const yesterdayIso = dataIsoBrasilia(new Date(agora.getTime() - 24 * 60 * 60 * 1000));

    console.log(`[PROGESTOR SYNC] Filtrando tabulações para hoje (${todayIso}) e ontem (${yesterdayIso})...`);

    const groups = {};

    data.forEach(r => {
      const func = String(r.Funcionario || '').trim().toLowerCase();
      const canal = String(r.Canalvenda || '').trim().toLowerCase();
      
      const consultantId = consultantMap.get(func);
      const channelId = channelMap.get(canal);
      
      const dateIso = parseDateToIso(r.Data);

      // Only sync today's and yesterday's records automatically to keep performance high
      if (!consultantId || !channelId || !dateIso) return;
      if (dateIso !== todayIso && dateIso !== yesterdayIso) return;

      const key = `${dateIso}_${consultantId}_${channelId}`;
      if (!groups[key]) {
        groups[key] = {
          date: dateIso,
          consultantId,
          channelId,
          leadsTotais: 0,
          inviaveis: 0,
          fechados: 0
        };
      }

      groups[key].leadsTotais++;

      const rawStatusCode = String(r['Cod Status'] || r['Codstatus'] || r['codstatus'] || '').trim();
      
      if (closedSet.has(rawStatusCode)) {
        groups[key].fechados++;
      } else if (unviableSet.has(rawStatusCode)) {
        groups[key].inviaveis++;
      }
    });

    let upsertCount = 0;
    for (const key of Object.keys(groups)) {
      const g = groups[key];
      
      await dbRun(`
        INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, 'Sincronizado automaticamente via Progestor')
        ON CONFLICT (date, consultant_id, channel_id)
        DO UPDATE SET
          leads_totais = EXCLUDED.leads_totais,
          inviaveis = EXCLUDED.inviaveis,
          fechados = EXCLUDED.fechados,
          observacoes = COALESCE(daily_records.observacoes, EXCLUDED.observacoes)
      `, [g.date, g.consultantId, g.channelId, g.leadsTotais, g.inviaveis, g.fechados]);

      upsertCount++;
    }

    console.log(`[PROGESTOR SYNC] Sincronização automática finalizada com sucesso! ${upsertCount} registros sincronizados.`);
  } catch (err) {
    console.error('[PROGESTOR SYNC] Erro na sincronização automática:', err);
  }
}

module.exports = { router, runAutomaticProgestorSync };
