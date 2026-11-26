// Entrega 4: lê os PDFs já anexados ao lead (contracheque e espelho da proposta)
// e devolve o que vai preencher a Nova operação. Nada é gravado aqui.
const express = require('express');
const { dbGet } = require('../../database');
const { requireAuth } = require('../../auth');
const { getDrive } = require('../servicos/google-drive');
const { carregarLeadComAcesso } = require('../servicos/contratos-acesso');
const { lerDocumento } = require('../servicos/leitura-documentos');
const { carregarMapaBancos, resolverBanco } = require('../servicos/contratos-bancos');

const router = express.Router();
const LIMITE_BYTES = 15 * 1024 * 1024;

async function baixarPdf(fileId) {
  const drive = getDrive();
  if (!drive) throw new Error('Google Drive indisponível no momento.');
  const r = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  const buf = Buffer.from(r.data);
  if (buf.length > LIMITE_BYTES) throw new Error('Arquivo grande demais para leitura.');
  return buf;
}

async function lerAnexo(fileId, esperado) {
  if (!fileId) return { status: 'ausente', motivo: esperado === 'espelho' ? 'O espelho da proposta não foi anexado ao lead.' : 'O contracheque não foi anexado ao lead.' };
  try {
    const buf = await baixarPdf(fileId);
    const r = await lerDocumento(buf, esperado);
    if (!r.tipo) return { status: 'nao_reconhecido', motivo: r.motivo };
    return { status: 'ok', tipo: r.tipo, dados: r.dados };
  } catch (err) {
    return { status: 'erro', motivo: 'Não foi possível ler o arquivo: ' + err.message };
  }
}

// POST /api/crm/leads/:id/ler-documentos
router.post('/api/crm/leads/:id/ler-documentos', requireAuth, async (req, res) => {
  try {
    const acesso = await carregarLeadComAcesso(req.user, req.params.id);
    if (!acesso.lead) return res.status(404).json({ error: acesso.motivo });
    if (!acesso.podeCriar) return res.status(403).json({ error: acesso.motivo });
    const cliente = await dbGet('SELECT id, cpf, doc_contracheque_id, doc_espelho_id FROM crm_clientes WHERE id = ?', [acesso.lead.cliente_id]);
    if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado.' });
    const cpfCliente = String(cliente.cpf || '').replace(/\D/g, '');
    const confere = cpf => (cpf && cpfCliente ? cpf === cpfCliente : null);

    const [cc, esp] = await Promise.all([
      lerAnexo(cliente.doc_contracheque_id, 'contracheque'),
      lerAnexo(cliente.doc_espelho_id, 'espelho')
    ]);

    const contracheque = { status: cc.status, motivo: cc.motivo || null };
    if (cc.status === 'ok') {
      const d = cc.dados;
      Object.assign(contracheque, {
        layout: d.layout, cpf_confere: confere(d.cpf),
        matricula: d.matricula || null, orgao: d.orgao || null, cargo: d.cargo || null,
        situacao: d.situacao || null, competencia: d.competencia || null, conta_salario: d.conta_salario || null,
        endereco: d.endereco || null, cep: d.cep || null, cidade: d.cidade || null, uf: d.uf || null
      });
    }

    const espelho = { status: esp.status, motivo: esp.motivo || null };
    if (esp.status === 'ok') {
      const d = esp.dados;
      const mapa = await carregarMapaBancos();
      const destino = resolverBanco(d.banco_destino_doc, mapa);
      Object.assign(espelho, {
        layout: d.layout, cpf_confere: confere(d.cpf), emissao: d.emissao,
        credito_bruto: d.credito_bruto, saldo_total: d.saldo_total, avisos: d.avisos,
        banco_destino: { doc: d.banco_destino_doc, id: destino ? destino.id : null, nome: destino ? destino.nome : null },
        portabilidades: d.portabilidades.map(p => {
          const b = resolverBanco(p.banco_nome_doc, mapa);
          return { ...p, banco_id: b ? b.id : null, banco_nome: b ? b.nome : null };
        })
      });
    }
    res.json({ contracheque, espelho });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
