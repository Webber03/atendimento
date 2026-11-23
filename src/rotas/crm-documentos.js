const express = require('express');
const { Readable } = require('stream');
const { dbAll, dbGet, dbRun } = require('../../database');
const { requireAuth } = require('../../auth');
const { getDrive } = require('../servicos/google-drive');
const { sanitizeCpf } = require('../utils/formatos');
const { upload } = require('../middlewares/upload');

const router = express.Router();

// POST /api/crm/leads/:id/documentos — Upload de documento para Google Drive
router.post('/api/crm/leads/:id/documentos', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  if (!getDrive()) {
    return res.status(500).json({ error: 'Integração com Google Drive não está ativa ou configurada no servidor.' });
  }

  const { id } = req.params;
  const { docType } = req.body;
  const file = req.file;

  if (!docType || !['contracheque', 'extrato', 'identificacao', 'residencia', 'espelho'].includes(docType)) {
    return res.status(400).json({ error: 'Tipo de documento inválido.' });
  }

  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  try {
    // 1. Obter informações do lead e do cliente
    const lead = await dbGet('SELECT * FROM crm_kanban_leads WHERE id = ?', [id]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [lead.cliente_id]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    // 2. Definir nome da pasta do cliente no Google Drive
    // Formato: NOME DO CLIENTE - CPF (se CPF existir)
    const cpfLimpo = sanitizeCpf(cliente.cpf);
    const cpfStr = cpfLimpo ? ` - ${cpfLimpo}` : '';
    const folderName = `${cliente.nome.trim().toUpperCase()}${cpfStr}`;
    const parentFolderId = '1NYMMgTD7Tr3TCDQ1KzK12LJxH4RtEoqh';

    let folderId = cliente.drive_folder_id;

    // Verificar se a pasta do cliente realmente existe e é acessível pela conta do Google atual
    if (folderId) {
      try {
        await getDrive().files.get({
          fileId: folderId,
          fields: 'id',
          supportsAllDrives: true
        });
      } catch (err) {
        console.warn(`Aviso: Pasta ${folderId} não encontrada ou está inacessível. Criando uma nova.`);
        folderId = null;
      }
    }

    // 3. Se o cliente não tem pasta no Drive (ou ela era de outra conta e está inacessível), cria uma
    if (!folderId) {
      console.log(`Criando pasta para o cliente no Drive: ${folderName}`);
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
      };

      const folderResponse = await getDrive().files.create({
        requestBody: folderMetadata,
        fields: 'id',
        supportsAllDrives: true
      });

      folderId = folderResponse.data.id;
      // Atualizar no banco
      await dbRun('UPDATE crm_clientes SET drive_folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [folderId, cliente.id]);
    }

    // 4. Mapear o nome do arquivo com base no tipo de documento e nome do cliente sanitizado
    const sanitizeFilename = (name) => {
      return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove acentos
        .replace(/[^a-z0-9]/g, '_') // substitui caracteres especiais por _
        .replace(/_+/g, '_') // colapsa múltiplos _
        .replace(/^_+|_+$/g, ''); // remove _ do início e fim
    };

    const docNames = {
      contracheque: 'contracheque',
      extrato: 'extrato_de_consignacao',
      identificacao: 'documento_de_identificacao',
      residencia: 'comprovante_de_residencia',
      espelho: 'espelho_da_proposta'
    };

    const cleanClientName = sanitizeFilename(cliente.nome);
    const newFileName = `${docNames[docType]}_${cleanClientName}.pdf`;

    // 5. Verificar se já existe arquivo deste tipo cadastrado e excluir do Drive para evitar duplicatas
    const dbColumns = {
      contracheque: 'doc_contracheque_id',
      extrato: 'doc_extrato_id',
      identificacao: 'doc_identificacao_id',
      residencia: 'doc_residencia_id',
      espelho: 'doc_espelho_id'
    };
    const dbColumn = dbColumns[docType];
    const oldFileId = cliente[dbColumn];

    if (oldFileId) {
      console.log(`Excluindo arquivo anterior do Drive: ${oldFileId}`);
      try {
        await getDrive().files.delete({ 
          fileId: oldFileId,
          supportsAllDrives: true
        });
      } catch (err) {
        console.warn(`Aviso ao excluir arquivo antigo ${oldFileId} no Drive:`, err.message);
      }
    }

    // 6. Fazer upload do arquivo no Drive
    const fileMetadata = {
      name: newFileName,
      parents: [folderId]
    };
    const media = {
      mimeType: 'application/pdf',
      body: Readable.from(file.buffer)
    };

    const driveFile = await getDrive().files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name',
      supportsAllDrives: true
    });

    const fileId = driveFile.data.id;

    // 7. Salvar ID no banco de dados do cliente
    await dbRun(
      `UPDATE crm_clientes SET ${dbColumn} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [fileId, cliente.id]
    );

    // Registrar histórico da ação no Lead
    await dbRun(
      'INSERT INTO crm_kanban_historico (lead_id, usuario_id, observacao) VALUES (?, ?, ?)',
      [id, req.user.id, `Documento ${docNames[docType].toUpperCase()} anexado no Google Drive.`]
    );

    res.status(201).json({
      message: 'Documento enviado com sucesso!',
      fileId: fileId,
      fileName: driveFile.data.name
    });
  } catch (err) {
    console.error('Erro no upload do documento para o Drive:', err);
    const isInvalidGrant = err.message && (err.message.includes('invalid_grant') || err.message.includes('No refresh token'));
    if (isInvalidGrant) {
      return res.status(401).json({
        error: 'A autorização do Google Drive expirou (invalid_grant). Acesse o Admin CRM para reconectar sua conta Google Drive.'
      });
    }
    res.status(500).json({ error: 'Erro interno ao salvar documento no Drive: ' + err.message });
  }
});

// DELETE /api/crm/leads/:id/documentos/:docType — Excluir documento do Google Drive e do banco
router.delete('/api/crm/leads/:id/documentos/:docType', requireAuth, async (req, res) => {
  if (!getDrive()) {
    return res.status(500).json({ error: 'Integração com Google Drive não está ativa ou configurada no servidor.' });
  }

  const { id, docType } = req.params;

  if (!docType || !['contracheque', 'extrato', 'identificacao', 'residencia', 'espelho'].includes(docType)) {
    return res.status(400).json({ error: 'Tipo de documento inválido.' });
  }

  try {
    // 1. Obter informações do lead e do cliente
    const lead = await dbGet('SELECT * FROM crm_kanban_leads WHERE id = ?', [id]);
    if (!lead) {
      return res.status(404).json({ error: 'Lead não encontrado.' });
    }

    const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [lead.cliente_id]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    // 2. Mapear as colunas
    const dbColumns = {
      contracheque: 'doc_contracheque_id',
      extrato: 'doc_extrato_id',
      identificacao: 'doc_identificacao_id',
      residencia: 'doc_residencia_id',
      espelho: 'doc_espelho_id'
    };
    
    const docNames = {
      contracheque: 'contracheque',
      extrato: 'extrato_de_consignacao',
      identificacao: 'documento_de_identificacao',
      residencia: 'comprovante_de_residencia',
      espelho: 'espelho_da_proposta'
    };

    const dbColumn = dbColumns[docType];
    const fileId = cliente[dbColumn];

    if (!fileId) {
      return res.status(400).json({ error: 'Documento não encontrado ou já excluído.' });
    }

    // 3. Excluir do Google Drive
    console.log(`Excluindo arquivo do Drive: ${fileId}`);
    try {
      await getDrive().files.delete({ 
        fileId: fileId,
        supportsAllDrives: true
      });
    } catch (err) {
      console.warn(`Aviso ao excluir arquivo ${fileId} no Drive:`, err.message);
    }

    // 4. Limpar do banco de dados do cliente
    await dbRun(
      `UPDATE crm_clientes SET ${dbColumn} = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [cliente.id]
    );

    // 5. Registrar histórico da ação no Lead
    await dbRun(
      'INSERT INTO crm_kanban_historico (lead_id, usuario_id, observacao) VALUES (?, ?, ?)',
      [id, req.user.id, `Documento ${docNames[docType].toUpperCase()} excluído do Google Drive.`]
    );

    res.json({ message: 'Documento excluído com sucesso!' });
  } catch (err) {
    console.error('Erro ao excluir documento do Drive:', err);
    const isInvalidGrant = err.message && (err.message.includes('invalid_grant') || err.message.includes('No refresh token'));
    if (isInvalidGrant) {
      return res.status(401).json({
        error: 'A autorização do Google Drive expirou (invalid_grant). Acesse o Admin CRM para reconectar sua conta Google Drive.'
      });
    }
    res.status(500).json({ error: 'Erro interno ao excluir documento do Drive: ' + err.message });
  }
});

// ----------------------------------------
// DOCUMENTOS EXTRAS (nome livre, vários por cliente, opcionais — ex.: DEDs do contrato)
// Ficam no cliente (mesma pasta do Drive dos 5 documentos fixos) e não contam como obrigatórios.
// ----------------------------------------
const PASTA_RAIZ_DRIVE = '1NYMMgTD7Tr3TCDQ1KzK12LJxH4RtEoqh';

function nomeArquivoSeguro(nome) {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function erroDrive(res, err, acao) {
  console.error(`Erro ao ${acao} documento extra no Drive:`, err);
  const expirou = err.message && (err.message.includes('invalid_grant') || err.message.includes('No refresh token'));
  if (expirou) {
    return res.status(401).json({ error: 'A autorização do Google Drive expirou (invalid_grant). Acesse o Admin CRM para reconectar sua conta Google Drive.' });
  }
  return res.status(500).json({ error: `Erro interno ao ${acao} documento no Drive: ${err.message}` });
}

// Mesma regra do upload dos documentos fixos: reaproveita a pasta do cliente ou cria uma nova
async function garantirPastaCliente(cliente) {
  let folderId = cliente.drive_folder_id;
  if (folderId) {
    try {
      await getDrive().files.get({ fileId: folderId, fields: 'id', supportsAllDrives: true });
    } catch (err) {
      folderId = null;
    }
  }
  if (!folderId) {
    const cpfLimpo = sanitizeCpf(cliente.cpf);
    const folderName = `${cliente.nome.trim().toUpperCase()}${cpfLimpo ? ` - ${cpfLimpo}` : ''}`;
    const folder = await getDrive().files.create({
      requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [PASTA_RAIZ_DRIVE] },
      fields: 'id',
      supportsAllDrives: true
    });
    folderId = folder.data.id;
    await dbRun('UPDATE crm_clientes SET drive_folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [folderId, cliente.id]);
  }
  return folderId;
}

// GET /api/crm/leads/:id/documentos-extras — Lista os documentos extras do cliente do lead
router.get('/api/crm/leads/:id/documentos-extras', requireAuth, async (req, res) => {
  try {
    const lead = await dbGet('SELECT cliente_id FROM crm_kanban_leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
    const docs = await dbAll(
      `SELECT d.id, d.nome, d.drive_file_id, d.created_at,
              COALESCE(NULLIF(TRIM(u.name), ''), u.username) AS usuario_nome
       FROM crm_clientes_documentos_extras d
       LEFT JOIN users u ON u.id = d.usuario_id
       WHERE d.cliente_id = ?
       ORDER BY d.created_at ASC, d.id ASC`,
      [lead.cliente_id]
    );
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/leads/:id/documentos-extras — Anexa um PDF com nome livre
router.post('/api/crm/leads/:id/documentos-extras', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!getDrive()) {
    return res.status(500).json({ error: 'Integração com Google Drive não está ativa ou configurada no servidor.' });
  }
  const { id } = req.params;
  const nome = String(req.body.nome || '').replace(/\s+/g, ' ').trim();
  if (!nome) return res.status(400).json({ error: 'Informe o nome do documento.' });
  if (nome.length > 80) return res.status(400).json({ error: 'O nome do documento pode ter no máximo 80 caracteres.' });
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  try {
    const lead = await dbGet('SELECT * FROM crm_kanban_leads WHERE id = ?', [id]);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
    const cliente = await dbGet('SELECT * FROM crm_clientes WHERE id = ?', [lead.cliente_id]);
    if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado.' });

    const folderId = await garantirPastaCliente(cliente);
    const fileName = `${nomeArquivoSeguro(nome) || 'documento'}_${nomeArquivoSeguro(cliente.nome)}.pdf`;
    const driveFile = await getDrive().files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: 'application/pdf', body: Readable.from(req.file.buffer) },
      fields: 'id, name',
      supportsAllDrives: true
    });

    const novo = await dbGet(
      `INSERT INTO crm_clientes_documentos_extras (cliente_id, lead_id, nome, drive_file_id, usuario_id)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [cliente.id, id, nome, driveFile.data.id, req.user.id]
    );
    await dbRun(
      'INSERT INTO crm_kanban_historico (lead_id, usuario_id, observacao) VALUES (?, ?, ?)',
      [id, req.user.id, `Documento extra "${nome}" anexado no Google Drive.`]
    );
    res.status(201).json({ message: 'Documento enviado com sucesso!', id: novo && novo.id, fileId: driveFile.data.id, nome });
  } catch (err) {
    erroDrive(res, err, 'salvar');
  }
});

// DELETE /api/crm/leads/:id/documentos-extras/:docId — Exclui um documento extra (Drive + banco)
router.delete('/api/crm/leads/:id/documentos-extras/:docId', requireAuth, async (req, res) => {
  if (!getDrive()) {
    return res.status(500).json({ error: 'Integração com Google Drive não está ativa ou configurada no servidor.' });
  }
  const { id, docId } = req.params;
  try {
    const lead = await dbGet('SELECT cliente_id FROM crm_kanban_leads WHERE id = ?', [id]);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
    // Só exclui documento do mesmo cliente do lead
    const doc = await dbGet('SELECT * FROM crm_clientes_documentos_extras WHERE id = ? AND cliente_id = ?', [docId, lead.cliente_id]);
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado ou já excluído.' });

    try {
      await getDrive().files.delete({ fileId: doc.drive_file_id, supportsAllDrives: true });
    } catch (err) {
      console.warn(`Aviso ao excluir arquivo ${doc.drive_file_id} no Drive:`, err.message);
    }
    await dbRun('DELETE FROM crm_clientes_documentos_extras WHERE id = ?', [doc.id]);
    await dbRun(
      'INSERT INTO crm_kanban_historico (lead_id, usuario_id, observacao) VALUES (?, ?, ?)',
      [id, req.user.id, `Documento extra "${doc.nome}" excluído do Google Drive.`]
    );
    res.json({ message: 'Documento excluído com sucesso!' });
  } catch (err) {
    erroDrive(res, err, 'excluir');
  }
});

// GET /api/crm/admin/drive-status — Verifica status da conexão com o Google Drive
router.get('/api/crm/admin/drive-status', requireAuth, async (req, res) => {
  if (!getDrive()) {
    return res.json({ connected: false, error: 'Google Drive não configurado ou cliente não inicializado.' });
  }
  try {
    await getDrive().files.list({ pageSize: 1, fields: 'files(id)' });
    return res.json({ connected: true });
  } catch (err) {
    const isInvalidGrant = err.message && (err.message.includes('invalid_grant') || err.message.includes('No refresh token'));
    return res.json({
      connected: false,
      error: isInvalidGrant
        ? 'A autorização com o Google expirou (invalid_grant). Clique no botão abaixo para reconectar.'
        : `Erro no Drive: ${err.message}`
    });
  }
});

// GET /api/crm/documentos/download/:fileId — Baixar arquivo do Google Drive
router.get('/api/crm/documentos/download/:fileId', requireAuth, async (req, res) => {
  if (!getDrive()) {
    return res.status(500).json({ error: 'Integração com Google Drive não está ativa ou configurada no servidor.' });
  }

  const { fileId } = req.params;

  try {
    // 1. Obter metadados do arquivo (para pegar o nome exato)
    const fileMeta = await getDrive().files.get({
      fileId: fileId,
      fields: 'name, mimeType',
      supportsAllDrives: true
    });

    const fileName = fileMeta.data.name;
    const mimeType = fileMeta.data.mimeType || 'application/pdf';

    // 2. Configurar headers para download com o nome correto
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', mimeType);

    // 3. Fazer stream do arquivo direto para a resposta HTTP
    const driveResponse = await getDrive().files.get(
      { fileId: fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );

    driveResponse.data
      .on('error', (err) => {
        console.error('Erro ao fazer stream do Drive:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Erro ao fazer download do arquivo.' });
        }
      })
      .pipe(res);

  } catch (err) {
    console.error('Erro ao baixar documento do Drive:', err);
    res.status(500).json({ error: 'Erro ao obter arquivo do Drive: ' + err.message });
  }
});

module.exports = router;
