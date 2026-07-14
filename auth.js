// ==========================================================================
// auth.js — Middleware de Autenticação JWT e Controle de Acesso (RBAC)
// ==========================================================================

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

/**
 * Roles disponíveis no sistema.
 * Escalável: para adicionar novos perfis, basta incluir aqui.
 */
const ROLES = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  LEADS: 'leads'
};

/**
 * Middleware: Verifica se o usuário possui um token JWT válido.
 * Injeta req.user = { id, username, role, team_id } na requisição.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acesso não autorizado. Faça login para continuar.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.', expired: true });
    }
    return res.status(401).json({ error: 'Token inválido.' });
  }
}

/**
 * Middleware factory: Verifica se o usuário possui um dos roles permitidos.
 * Uso: requireRole('admin') ou requireRole('admin', 'supervisor')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para esta operação.' });
    }
    next();
  };
}

/**
 * Gera um token JWT com os dados do usuário.
 */
function generateToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    role: user.role,
    team_id: user.team_id || null
  };
  const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

module.exports = {
  ROLES,
  requireAuth,
  requireRole,
  generateToken,
  JWT_SECRET
};
