const express = require('express');

const router = express.Router();

// ----------------------------------------
// CRM, KANBAN, DISCADORA & CLIENTES MODULE
// ----------------------------------------

// Server-Sent Events (SSE) subscribers array para atualizações Realtime sem F5
let crmClients = [];

function broadcastCrmEvent(eventType, payload) {
  const data = JSON.stringify({ type: eventType, payload, timestamp: new Date().toISOString() });
  crmClients.forEach(client => {
    try {
      client.res.write(`data: ${data}\n\n`);
    } catch (err) {
      // Ignorar conexões mortas
    }
  });
}

// GET /api/crm/events — Stream de eventos Realtime para o Frontend
router.get('/api/crm/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  crmClients.push(newClient);

  req.on('close', () => {
    crmClients = crmClients.filter(c => c.id !== clientId);
  });
});

module.exports = { router, broadcastCrmEvent };
