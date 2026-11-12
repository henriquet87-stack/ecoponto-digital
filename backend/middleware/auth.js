const crypto = require('crypto');

/**
 * Credenciais do operador.
 * - Em produção (DATABASE_URL definida) APP_USER, APP_PASSWORD e SESSION_SECRET são OBRIGATÓRIOS.
 * - Em desenvolvimento local há valores padrão (admin / admin123).
 */
function credenciaisOperador() {
  const prod = !!process.env.DATABASE_URL;
  const user   = process.env.APP_USER       || (prod ? null : 'admin');
  const pass   = process.env.APP_PASSWORD   || (prod ? null : 'admin123');
  const secret = process.env.SESSION_SECRET || (prod ? null : 'ecoponto-secret-dev');
  if (!user || !pass || !secret) return null;
  return { user, pass, secret };
}

// Comparação em tempo constante
function iguais(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function assinar(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Token = base64url("usuario|expira") + "." + HMAC-SHA256(payload)
function gerarToken(usuario, secret) {
  const expira  = Date.now() + 8 * 60 * 60 * 1000; // 8 horas
  const payload = `${usuario}|${expira}`;
  const token   = `${Buffer.from(payload).toString('base64url')}.${assinar(payload, secret)}`;
  return { token, expira };
}

function extrairToken(req) {
  return (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
}

function validarToken(token) {
  if (!token) return { ok: false, erro: 'Token não informado.' };
  try {
    const cred = credenciaisOperador();
    if (!cred) throw new Error('credenciais não configuradas');

    const dot = token.lastIndexOf('.');
    if (dot === -1) throw new Error('formato inválido');

    const payload = Buffer.from(token.slice(0, dot), 'base64url').toString();
    const sigRecebida = token.slice(dot + 1);
    if (!iguais(sigRecebida, assinar(payload, cred.secret))) throw new Error('assinatura inválida');

    const [, expStr] = payload.split('|');
    if (Date.now() > parseInt(expStr, 10)) {
      return { ok: false, erro: 'Sessão expirada. Faça login novamente.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, erro: 'Token inválido.' };
  }
}

// Middleware: exige operador autenticado
function requireOperador(req, res, next) {
  const r = validarToken(extrairToken(req));
  if (!r.ok) return res.status(401).json({ erro: r.erro });
  next();
}

// Uso interno: true/false sem responder
function ehOperador(req) {
  return validarToken(extrairToken(req)).ok;
}

module.exports = {
  credenciaisOperador, iguais, gerarToken,
  extrairToken, validarToken, requireOperador, ehOperador,
};
