const express = require('express');
const { dbAll, dbGet, dbRun } = require('../../database');
const { requireAuth, requireRole } = require('../../auth');

const router = express.Router();

// ----------------------------------------
// DAILY RECORDS ENDPOINTS
// ----------------------------------------

// Fetch grid of active channels combined with existing daily records for a date and consultant
router.get('/api/records', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { date, consultant_id } = req.query;
  if (!date || !consultant_id) {
    return res.status(400).json({ error: "Data e ID do Consultor são campos obrigatórios." });
  }
  try {
    // 1. Fetch all active channels
    const channels = await dbAll("SELECT id as channel_id, name as channel_name FROM channels WHERE active = 1 ORDER BY name ASC");
    
    // 2. Fetch existing daily records for this date and consultant
    const records = await dbAll(`
      SELECT channel_id, leads_totais, inviaveis, fechados, observacoes 
      FROM daily_records 
      WHERE date = ? AND consultant_id = ?
    `, [date, consultant_id]);

    // Create a lookup map for the existing records
    const recordMap = {};
    records.forEach(r => {
      recordMap[r.channel_id] = r;
    });

    // 3. Merge channels with their logs (if any) or populate defaults
    const grid = channels.map(ch => {
      const existing = recordMap[ch.channel_id];
      return {
        channel_id: ch.channel_id,
        channel_name: ch.channel_name,
        leads_totais: existing ? existing.leads_totais : 0,
        inviaveis: existing ? existing.inviaveis : 0,
        fechados: existing ? existing.fechados : 0,
        observacoes: existing ? existing.observacoes || "" : ""
      };
    });

    res.json(grid);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List latest saved records for the records tab
router.get('/api/records/latest', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { start_date, end_date, consultant_id, channel_id } = req.query;
    let { team_id } = req.query;

    // RBAC: Supervisor só pode ver a própria equipe
    if (req.user.role === 'supervisor') {
      team_id = req.user.team_id;
    }

    let filterQuery = "";
    const params = [];

    if (start_date) {
      filterQuery += " AND dr.date >= ?";
      params.push(start_date);
    }
    if (end_date) {
      filterQuery += " AND dr.date <= ?";
      params.push(end_date);
    }
    if (team_id) {
      filterQuery += " AND c.team_id = ?";
      params.push(team_id);
    }
    if (consultant_id) {
      filterQuery += " AND dr.consultant_id = ?";
      params.push(consultant_id);
    }
    if (channel_id) {
      filterQuery += " AND dr.channel_id = ?";
      params.push(channel_id);
    }

    const rows = await dbAll(`
      SELECT 
        dr.date,
        dr.leads_totais,
        dr.inviaveis,
        dr.fechados,
        dr.observacoes,
        c.name as consultant_name,
        t.name as team_name,
        ch.name as channel_name
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      JOIN teams t ON c.team_id = t.id
      JOIN channels ch ON dr.channel_id = ch.id
      WHERE 1 = 1 ${filterQuery}
      ORDER BY dr.date DESC, dr.created_at DESC
    `, params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save or Update daily records
router.post('/api/records', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { date, consultant_id, launches } = req.body;

  if (!date || !consultant_id || !Array.isArray(launches)) {
    return res.status(400).json({ error: "Parâmetros inválidos. Data, Consultor e Lançamentos são obrigatórios." });
  }

  // Validate inputs first before performing database transaction
  for (const launch of launches) {
    const { channel_id, leads_totais, inviaveis, fechados } = launch;
    if (channel_id === undefined || leads_totais === undefined || inviaveis === undefined || fechados === undefined) {
      return res.status(400).json({ error: "Parâmetros incompletos na lista de lançamentos." });
    }
    const lt = parseInt(leads_totais, 10);
    const inv = parseInt(inviaveis, 10);
    const fech = parseInt(fechados, 10);

    if (isNaN(lt) || lt < 0 || isNaN(inv) || inv < 0 || isNaN(fech) || fech < 0) {
      return res.status(400).json({ error: "Os campos de leads e fechamentos devem ser números inteiros maiores ou iguais a zero." });
    }
    if (inv > lt) {
      return res.status(400).json({ error: "Leads inviáveis não podem ser maiores que os leads totais." });
    }
  }

  try {
    // Save in database using UPSERT
    for (const launch of launches) {
      const { channel_id, leads_totais, inviaveis, fechados, observacoes } = launch;
      const obs = observacoes ? observacoes.trim() : null;

      await dbRun(`
        INSERT INTO daily_records (date, consultant_id, channel_id, leads_totais, inviaveis, fechados, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (date, consultant_id, channel_id) DO UPDATE SET
          leads_totais = excluded.leads_totais,
          inviaveis = excluded.inviaveis,
          fechados = excluded.fechados,
          observacoes = excluded.observacoes
      `, [date, consultant_id, channel_id, leads_totais, inviaveis, fechados, obs]);
    }
    res.json({ message: "Lançamentos salvos com sucesso!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------
// ANALYTICS / DASHBOARD ENDPOINT
// ----------------------------------------

router.get('/api/dashboard', requireAuth, requireRole('admin', 'supervisor'), async (req, res) => {
  const { start_date, end_date, consultant_id, channel_id } = req.query;
  let { team_id } = req.query;

  // RBAC: Supervisor só pode ver os dados da própria equipe
  if (req.user.role === 'supervisor') {
    team_id = req.user.team_id;
  }

  if (!start_date || !end_date) {
    return res.status(400).json({ error: "As datas de início e fim são obrigatórias para filtrar o período." });
  }

  try {
    // 1. Build dynamic query filters
    let filterQuery = "WHERE dr.date BETWEEN ? AND ?";
    const params = [start_date, end_date];

    if (team_id) {
      filterQuery += " AND c.team_id = ?";
      params.push(team_id);
    }
    if (consultant_id) {
      filterQuery += " AND dr.consultant_id = ?";
      params.push(consultant_id);
    }
    if (channel_id) {
      filterQuery += " AND dr.channel_id = ?";
      params.push(channel_id);
    }

    // 2. Fetch consolidated KPIs
    const kpi = await dbGet(`
      SELECT 
        SUM(dr.leads_totais) as total_leads,
        SUM(dr.inviaveis) as total_inviaveis,
        SUM(dr.fechados) as total_fechados
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      ${filterQuery}
    `, params);

    const total_leads = kpi.total_leads || 0;
    const total_inviaveis = kpi.total_inviaveis || 0;
    const total_fechados = kpi.total_fechados || 0;
    const aproveitaveis = total_leads - total_inviaveis;
    const percent_inviaveis = total_leads > 0 ? (total_inviaveis / total_leads) * 100 : 0;

    // Regra de Ouro: Taxa de conversão reajustada desconsiderando inviáveis, com validação de divisão por zero.
    let conversao_reajustada = 0;
    if (aproveitaveis > 0) {
      conversao_reajustada = (total_fechados / aproveitaveis) * 100;
    }

    // 3. Fetch performance split by Sales Channel
    const channelSplit = await dbAll(`
      SELECT 
        ch.name as channel_name,
        SUM(dr.leads_totais) as leads_totais,
        SUM(dr.inviaveis) as inviaveis,
        SUM(dr.fechados) as fechados
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      JOIN channels ch ON dr.channel_id = ch.id
      ${filterQuery}
      GROUP BY dr.channel_id, ch.name
      ORDER BY leads_totais DESC
    `, params);

    // 4. Fetch daily evolution (leads, sales, conversion)
    const evolution = await dbAll(`
      SELECT 
        dr.date,
        SUM(dr.leads_totais) as leads_totais,
        SUM(dr.inviaveis) as inviaveis,
        SUM(dr.fechados) as fechados
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      ${filterQuery}
      GROUP BY dr.date
      ORDER BY dr.date ASC
    `, params);

    // 5. Fetch Rankings
    // Consultants ranking
    const consultantsRanking = await dbAll(`
      SELECT 
        c.name as consultant_name,
        t.name as team_name,
        SUM(dr.leads_totais) as leads_totais,
        SUM(dr.inviaveis) as inviaveis,
        SUM(dr.fechados) as fechados
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      JOIN teams t ON c.team_id = t.id
      ${filterQuery}
      GROUP BY dr.consultant_id, c.name, t.name
      ORDER BY fechados DESC, leads_totais DESC
    `, params);

    // Teams ranking
    const teamsRanking = await dbAll(`
      SELECT 
        t.name as team_name,
        SUM(dr.leads_totais) as leads_totais,
        SUM(dr.inviaveis) as inviaveis,
        SUM(dr.fechados) as fechados
      FROM daily_records dr
      JOIN consultants c ON dr.consultant_id = c.id
      JOIN teams t ON c.team_id = t.id
      ${filterQuery}
      GROUP BY c.team_id, t.name
      ORDER BY fechados DESC, leads_totais DESC
    `, params);

    res.json({
      kpis: {
        total_leads,
        inviaveis: total_inviaveis,
        percent_inviaveis: parseFloat(percent_inviaveis.toFixed(2)),
        aproveitaveis,
        fechados: total_fechados,
        conversao_reajustada: parseFloat(conversao_reajustada.toFixed(2))
      },
      channelSplit,
      evolution: evolution.map(ev => {
        const ap = ev.leads_totais - ev.inviaveis;
        const conv = ap > 0 ? (ev.fechados / ap) * 100 : 0;
        return {
          ...ev,
          conversao_reajustada: parseFloat(conv.toFixed(2))
        };
      }),
      consultantsRanking: consultantsRanking.map(cr => {
        const ap = cr.leads_totais - cr.inviaveis;
        const conv = ap > 0 ? (cr.fechados / ap) * 100 : 0;
        return {
          ...cr,
          conversao_reajustada: parseFloat(conv.toFixed(2))
        };
      }).sort((a, b) => b.conversao_reajustada - a.conversao_reajustada || b.fechados - a.fechados || b.leads_totais - a.leads_totais),
      teamsRanking: teamsRanking.map(tr => {
        const ap = tr.leads_totais - tr.inviaveis;
        const conv = ap > 0 ? (tr.fechados / ap) * 100 : 0;
        return {
          ...tr,
          conversao_reajustada: parseFloat(conv.toFixed(2))
        };
      }).sort((a, b) => b.conversao_reajustada - a.conversao_reajustada || b.fechados - a.fechados || b.leads_totais - a.leads_totais)
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
