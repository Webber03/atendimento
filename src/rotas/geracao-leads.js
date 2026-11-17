const express = require('express');
const { dbAll, dbGet, dbRun } = require('../../database');
const { requireAuth, requireRole } = require('../../auth');

const router = express.Router();

// ----------------------------------------
// LEAD GENERATIONS ENDPOINTS
// ----------------------------------------

async function getWhatsAppChannelId() {
  const ch = await dbGet("SELECT id FROM channels WHERE LOWER(name) = 'disparo whatsapp' OR LOWER(name) = 'disparo wpp' LIMIT 1");
  return ch ? ch.id : null;
}

async function syncDailyRecordsForChannel(date, consultant_id, channel_id) {
  const aggregate = await dbGet(`
    SELECT 
      COALESCE(SUM(d.leads_totais), 0) as total_leads,
      COALESCE(SUM(d.inviaveis), 0) as total_inviaveis,
      COALESCE(SUM(d.fechados), 0) as total_fechados
    FROM lead_generation_distributions d
    JOIN lead_generations lg ON d.lead_generation_id = lg.id
    WHERE lg.date = ? AND d.consultant_id = ? AND lg.channel_id = ?
  `, [date, consultant_id, channel_id]);

  if (aggregate.total_leads > 0 || aggregate.total_inviaveis > 0 || aggregate.total_fechados > 0) {
    await dbRun(`
      INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT (date, consultant_id, channel_id) DO UPDATE SET
        leads_totais = excluded.leads_totais,
        inviaveis = excluded.inviaveis,
        fechados = excluded.fechados
    `, [date, consultant_id, channel_id, aggregate.total_leads, aggregate.total_inviaveis, aggregate.total_fechados]);
  } else {
    await dbRun(`
      DELETE FROM daily_records
      WHERE date = ? AND consultant_id = ? AND channel_id = ?
    `, [date, consultant_id, channel_id]);
  }
}

router.get('/api/lead-generations', requireAuth, requireRole('admin', 'leads'), async (req, res) => {
  try {
    const records = await dbAll(`
      SELECT 
        lg.*,
        c.name as channel_name,
        s.name as system_name,
        cv.name as convenio_name,
        p.name as produto_name
      FROM lead_generations lg
      LEFT JOIN channels c ON lg.channel_id = c.id
      LEFT JOIN systems s ON lg.system_id = s.id
      LEFT JOIN convenios cv ON lg.convenio_id = cv.id
      LEFT JOIN produtos p ON lg.produto_id = p.id
      ORDER BY lg.date DESC, lg.created_at DESC
      LIMIT 200
    `);

    // Fetch distributions for these records
    if (records.length > 0) {
      const recordIds = records.map(r => r.id);
      const placeholders = recordIds.map(() => '?').join(', ');
      const dists = await dbAll(`
        SELECT lead_generation_id, consultant_id, leads_totais, inviaveis, fechados, faturamento
        FROM lead_generation_distributions
        WHERE lead_generation_id IN (${placeholders})
      `, recordIds);

      // Group distributions by lead_generation_id
      const distMap = {};
      dists.forEach(d => {
        if (!distMap[d.lead_generation_id]) {
          distMap[d.lead_generation_id] = [];
        }
        distMap[d.lead_generation_id].push({
          consultant_id: d.consultant_id,
          leads_totais: d.leads_totais,
          inviaveis: d.inviaveis,
          fechados: d.fechados,
          faturamento: d.faturamento
        });
      });

      // Attach to records
      records.forEach(r => {
        r.distributions = distMap[r.id] || [];
      });
    }

    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/lead-generations', requireAuth, requireRole('admin', 'leads'), async (req, res) => {
  const { date, channel_id, system_id, convenio_id, produto_id, prospectados, aceites, inviaveis, investimento, fechamentos, faturamento, distributions } = req.body;
  if (!date || !convenio_id || !produto_id) {
    return res.status(400).json({ error: "Data, Convênio e Produto são obrigatórios." });
  }
  try {
    const wppChannelId = await getWhatsAppChannelId();
    const isWpp = (channel_id && wppChannelId && parseInt(channel_id, 10) === wppChannelId);

    // Validate distributions for WPP
    if (isWpp && (!Array.isArray(distributions) || distributions.length === 0)) {
      return res.status(400).json({ error: "A distribuição por consultores é obrigatória para o canal Disparo WhatsApp." });
    }

    const result = await dbRun(`
      INSERT INTO lead_generations 
      (date, channel_id, system_id, convenio_id, produto_id, prospectados, aceites, inviaveis, investimento, fechamentos, faturamento)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      date, 
      channel_id || null, 
      system_id || null, 
      convenio_id || null,
      produto_id || null,
      parseInt(prospectados || 0, 10),
      parseInt(aceites || 0, 10),
      parseInt(inviaveis || 0, 10),
      parseFloat(investimento || 0),
      parseInt(fechamentos || 0, 10),
      parseFloat(faturamento || 0)
    ]);

    const leadGenId = result.lastID;

    if (Array.isArray(distributions) && distributions.length > 0) {
      for (const dist of distributions) {
        const { consultant_id, leads_totais, inviaveis: distInviaveis, fechados, faturamento: distFaturamento } = dist;
        const cId = parseInt(consultant_id, 10);
        const lt = parseInt(leads_totais, 10) || 0;
        const inv = parseInt(distInviaveis, 10) || 0;
        const fech = parseInt(fechados, 10) || 0;
        const fat = parseFloat(distFaturamento) || 0;

        if (lt > 0 || inv > 0 || fech > 0 || fat > 0) {
          await dbRun(`
            INSERT INTO lead_generation_distributions (lead_generation_id, consultant_id, leads_totais, inviaveis, fechados, faturamento)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [leadGenId, cId, lt, inv, fech, fat]);

          // Sync daily record for this consultant and channel
          await syncDailyRecordsForChannel(date, cId, parseInt(channel_id, 10));
        }
      }
    }

    res.status(201).json({ id: leadGenId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/lead-generations/:id', requireAuth, requireRole('admin', 'leads'), async (req, res) => {
  const { id } = req.params;
  try {
    const record = await dbGet("SELECT date, channel_id FROM lead_generations WHERE id = ?", [id]);
    if (!record) {
      return res.status(404).json({ error: "Registro não encontrado." });
    }

    const wppChannelId = await getWhatsAppChannelId();
    const isWpp = (record.channel_id && wppChannelId && record.channel_id === wppChannelId);

    const dists = await dbAll("SELECT consultant_id FROM lead_generation_distributions WHERE lead_generation_id = ?", [id]);
    const consultantsToSync = dists.map(d => d.consultant_id);

    const result = await dbRun("DELETE FROM lead_generations WHERE id = ?", [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Registro não encontrado." });
    }

    for (const cId of consultantsToSync) {
      await syncDailyRecordsForChannel(record.date, cId, record.channel_id);
    }

    res.json({ message: "Registro removido com sucesso." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/lead-generations/:id', requireAuth, requireRole('admin', 'leads'), async (req, res) => {
  const { id } = req.params;
  const { date, channel_id, system_id, convenio_id, produto_id, prospectados, aceites, inviaveis, investimento, fechamentos, faturamento, distributions } = req.body;
  if (!date || !convenio_id || !produto_id) {
    return res.status(400).json({ error: "Data, Convênio e Produto são obrigatórios." });
  }
  try {
    const oldRecord = await dbGet("SELECT date, channel_id FROM lead_generations WHERE id = ?", [id]);
    if (!oldRecord) {
      return res.status(404).json({ error: "Registro não encontrado." });
    }

    const wppChannelId = await getWhatsAppChannelId();
    const isWpp = (channel_id && wppChannelId && parseInt(channel_id, 10) === wppChannelId);
    if (isWpp && (!Array.isArray(distributions) || distributions.length === 0)) {
      return res.status(400).json({ error: "A distribuição por consultores é obrigatória para o canal Disparo WhatsApp." });
    }

    // Fetch old distributions
    const oldDists = await dbAll("SELECT consultant_id FROM lead_generation_distributions WHERE lead_generation_id = ?", [id]);
    const oldConsultants = oldDists.map(d => d.consultant_id);

    const result = await dbRun(`
      UPDATE lead_generations 
      SET date = ?, channel_id = ?, system_id = ?, convenio_id = ?, produto_id = ?, 
          prospectados = ?, aceites = ?, inviaveis = ?, investimento = ?, fechamentos = ?, faturamento = ?
      WHERE id = ?
    `, [
      date, 
      channel_id || null, 
      system_id || null, 
      convenio_id || null,
      produto_id || null,
      parseInt(prospectados || 0, 10),
      parseInt(aceites || 0, 10),
      parseInt(inviaveis || 0, 10),
      parseFloat(investimento || 0),
      parseInt(fechamentos || 0, 10),
      parseFloat(faturamento || 0),
      id
    ]);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Registro não encontrado." });
    }

    // Clear old distributions
    await dbRun("DELETE FROM lead_generation_distributions WHERE lead_generation_id = ?", [id]);

    let newConsultants = [];
    if (Array.isArray(distributions)) {
      for (const dist of distributions) {
        const { consultant_id, leads_totais, inviaveis: distInviaveis, fechados, faturamento: distFaturamento } = dist;
        const cId = parseInt(consultant_id, 10);
        const lt = parseInt(leads_totais, 10) || 0;
        const inv = parseInt(distInviaveis, 10) || 0;
        const fech = parseInt(fechados, 10) || 0;
        const fat = parseFloat(distFaturamento) || 0;

        if (lt > 0 || inv > 0 || fech > 0 || fat > 0) {
          await dbRun(`
            INSERT INTO lead_generation_distributions (lead_generation_id, consultant_id, leads_totais, inviaveis, fechados, faturamento)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [id, cId, lt, inv, fech, fat]);
          newConsultants.push(cId);
        }
      }
    }

    // Sync old combinations
    for (const cId of oldConsultants) {
      await syncDailyRecordsForChannel(oldRecord.date, cId, oldRecord.channel_id);
    }

    // Sync new combinations
    for (const cId of newConsultants) {
      await syncDailyRecordsForChannel(date, cId, parseInt(channel_id, 10));
    }

    res.json({ message: "Registro atualizado com sucesso!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/lead-generations/dashboard', requireAuth, requireRole('admin', 'leads'), async (req, res) => {
  const { start_date, end_date, channel_id, system_id, convenio_id, produto_id } = req.query;
  let filterQuery = "";
  const params = [];
  
  if (start_date) {
    filterQuery += " AND date >= ?";
    params.push(start_date);
  }
  if (end_date) {
    filterQuery += " AND date <= ?";
    params.push(end_date);
  }
  if (channel_id) {
    filterQuery += " AND channel_id = ?";
    params.push(channel_id);
  }
  if (system_id) {
    filterQuery += " AND system_id = ?";
    params.push(system_id);
  }
  if (convenio_id) {
    filterQuery += " AND convenio_id = ?";
    params.push(convenio_id);
  }
  if (produto_id) {
    filterQuery += " AND produto_id = ?";
    params.push(produto_id);
  }

  try {
    const kpis = await dbGet(`
      SELECT 
        COALESCE(SUM(prospectados), 0) as total_prospectados,
        COALESCE(SUM(aceites), 0) as total_aceites,
        COALESCE(SUM(inviaveis), 0) as total_inviaveis,
        COALESCE(SUM(investimento), 0) as total_investido,
        COALESCE(SUM(fechamentos), 0) as total_fechamentos,
        COALESCE(SUM(faturamento), 0) as total_faturamento
      FROM lead_generations
      WHERE 1=1 ${filterQuery}
    `, params);

    res.json(kpis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
