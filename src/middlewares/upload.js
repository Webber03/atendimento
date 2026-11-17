const multer = require('multer');

 // Aguarda 2 segundos para dar tempo do banco de dados iniciar


// Configuração do Multer (upload em memória, apenas PDF)
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos PDF são permitidos.'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // Limite de 10MB
  }
});

module.exports = { upload };
