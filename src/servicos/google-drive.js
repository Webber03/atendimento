const fs = require('fs');
const { google } = require('googleapis');
const path = require('path');
const { dbGet } = require('../../database');

// Configuração do Google Drive API (suporta tanto Service Account quanto OAuth2 para contas comuns)
let drive = null;

// Função para inicializar o Drive com OAuth2 Pessoal
function initializeOAuthDrive(refreshToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (clientId && clientSecret && redirectUri && refreshToken) {
    try {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      drive = google.drive({ version: 'v3', auth: oauth2Client });
      console.log('Google Drive API (OAuth2 Pessoal) inicializada com sucesso.');
      return true;
    } catch (err) {
      console.error('Erro ao inicializar Google Drive API via OAuth2:', err.message);
    }
  }
  return false;
}

// Secundário: Função para inicializar o Drive com Service Account
function initializeServiceAccountDrive() {
  let credentials = null;
  if (process.env.GOOGLE_DRIVE_CREDENTIALS) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_DRIVE_CREDENTIALS);
    } catch (err) {
      console.error('Erro ao decodificar GOOGLE_DRIVE_CREDENTIALS:', err.message);
    }
  } else {
    const credentialsPath = path.join(__dirname, '..', '..', 'google-credentials.json');
    if (fs.existsSync(credentialsPath)) {
      try {
        credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      } catch (err) {
        console.error('Erro ao ler credenciais do arquivo google-credentials.json:', err.message);
      }
    }
  }

  if (credentials) {
    try {
      const privateKey = (credentials.private_key || '').replace(/\\n/g, '\n');
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: credentials.client_email,
          private_key: privateKey
        },
        scopes: ['https://www.googleapis.com/auth/drive']
      });
      drive = google.drive({ version: 'v3', auth });
      console.log('Google Drive API (Service Account) inicializada com sucesso.');
      return true;
    } catch (err) {
      console.error('Erro ao inicializar Google Drive API via Service Account:', err.message);
    }
  }
  return false;
}

// Inicializar Drive ao iniciar o servidor
setTimeout(async () => {
  try {
    // 1. Tentar inicializar com OAuth2 (se o refresh_token já estiver no banco)
    const row = await dbGet("SELECT value FROM system_settings WHERE key = 'google_drive_refresh_token'");
    if (row && row.value) {
      const ok = initializeOAuthDrive(row.value);
      if (ok) return;
    }
  } catch (err) {
    console.error('Erro ao carregar refresh_token do banco:', err.message);
  }

  // 2. Fallback: Tentar inicializar com Service Account
  initializeServiceAccountDrive();
}, 2000);

function getDrive() {
  return drive;
}

module.exports = { getDrive, initializeOAuthDrive };
