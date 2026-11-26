require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDb } = require('./database');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serviços com efeito ao carregar (Drive inicia 2s após o boot)
require('./src/servicos/google-drive');
const rotasAuth = require('./src/rotas/auth');
const rotasUsuarios = require('./src/rotas/usuarios');
const rotasCadastros = require('./src/rotas/cadastros');
const rotasLancamentos = require('./src/rotas/lancamentos');
const rotasGeracaoLeads = require('./src/rotas/geracao-leads');
const { router: rotasProgestor, runAutomaticProgestorSync } = require('./src/rotas/progestor');
const { router: rotasEventosCrm } = require('./src/servicos/eventos-crm');
const rotasCrmWebhook = require('./src/rotas/crm-webhook');
const rotasCrmClientes = require('./src/rotas/crm-clientes');
const rotasCrmKanban = require('./src/rotas/crm-kanban');
const rotasCrmAdmin = require('./src/rotas/crm-admin');
const rotasCrmDocumentos = require('./src/rotas/crm-documentos');
const rotasCrmRelatorios = require('./src/rotas/crm-relatorios');
const rotasContratosListas = require('./src/rotas/contratos-listas');
const rotasContratosOperacoes = require('./src/rotas/contratos-operacoes');
const rotasContratosPropostas = require('./src/rotas/contratos-propostas');

// Rotas (na mesma ordem do server.js original)
app.use(rotasAuth);
app.use(rotasUsuarios);
app.use(rotasCadastros);
app.use(rotasLancamentos);
app.use(rotasGeracaoLeads);
app.use(rotasProgestor);
app.use(rotasEventosCrm);
app.use(rotasCrmWebhook);
app.use(rotasCrmClientes);
app.use(rotasCrmKanban);
app.use(rotasCrmAdmin);
app.use(rotasCrmDocumentos);
app.use(rotasCrmRelatorios);
app.use(rotasContratosListas);
app.use(rotasContratosOperacoes);
app.use(rotasContratosPropostas);

// ----------------------------------------
// START SERVER
// ----------------------------------------
(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
      console.log(`URL Local: http://localhost:${PORT}`);
      
      // Start background automatic synchronization every 15 minutes
      const SYNC_INTERVAL = 15 * 60 * 1000; 
      setInterval(runAutomaticProgestorSync, SYNC_INTERVAL);
      
      // Run first check 5 seconds after startup
      setTimeout(runAutomaticProgestorSync, 5000);
    });
  } catch (err) {
    console.error("Erro ao iniciar banco de dados:", err);
    process.exit(1);
  }
})();
