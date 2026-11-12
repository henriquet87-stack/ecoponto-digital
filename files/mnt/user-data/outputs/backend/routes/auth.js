const express = require('express');
const router  = express.Router();
const {
  credenciaisOperador, iguais, gerarToken, extrairToken, validarToken,
} = require('../middleware/auth');

/**
 * POST /api/auth/login
 * Body: { usuario: string, senha: string }
 *
 * Variáveis de ambiente no Render (obrigatórias em produção):
 *   APP_USER       → usuário do operador
 *   APP_PASSWORD   → senha do operador
 *   SESSION_SECRET → segredo HMAC (string hex aleatória)
 */
router.post('/login', (req, res) => {
  const { usuario, senha } = req.body || {};

  if (!usuario || !senha) {
    return res.status(400).json({ ok: false, erro: 'Informe usuário e senha.' });
  }

  const cred = credenciaisOperador();
  if (!cred) {
    console.error('❌ APP_USER, APP_PASSWORD e SESSION_SECRET precisam estar definidos em produção.');
    return res.status(500).json({ ok: false, erro: 'Acesso do operador não configurado no servidor.' });
  }

  // Avalia os dois sempre, para não revelar qual campo errou
  const userOk = iguais(usuario, cred.user);
  const passOk = iguais(senha, cred.pass);
  if (!userOk || !passOk) {
    return res.status(401).json({ ok: false, erro: 'Usuário ou senha inválidos.' });
  }

  const { token, expira } = gerarToken(cred.user, cred.secret);
  res.json({ ok: true, token, expira });
});

/**
 * POST /api/auth/verificar
 * Header: Authorization: Bearer <token>
 * Revalida o token salvo no sessionStorage quando a página é recarregada.
 */
router.post('/verificar', (req, res) => {
  const r = validarToken(extrairToken(req));
  if (!r.ok) return res.status(401).json({ ok: false, erro: r.erro });
  res.json({ ok: true });
});

module.exports = router;
