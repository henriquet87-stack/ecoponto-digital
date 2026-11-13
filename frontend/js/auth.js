/**
 * auth.js — EcoPonto Digital
 * Carregado APÓS api.js e ANTES de app.js.
 *
 *  Auth   → sessão do OPERADOR (token HMAC no sessionStorage, validade de 8h)
 *  Sessao → identificação do CIDADÃO (PF/PJ), sem senha
 */

const Auth = (() => {
  const KEY = 'ecoponto_token';

  const token = () => sessionStorage.getItem(KEY);

  // O token tem o formato base64url("usuario|expira") + "." + assinatura.
  // Aqui só lemos a validade para a interface; quem decide de verdade é o servidor.
  function expiraEm(t) {
    try {
      const b64 = t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      return parseInt(atob(b64).split('|')[1], 10) || 0;
    } catch {
      return 0;
    }
  }

  const logado = () => {
    const t = token();
    return !!t && expiraEm(t) > Date.now();
  };

  async function login(usuario, senha) {
    const r = await api.login(usuario, senha);
    sessionStorage.setItem(KEY, r.token);
    window.dispatchEvent(new Event('ecoponto:auth'));
    return r;
  }

  function logout() {
    sessionStorage.removeItem(KEY);
    window.dispatchEvent(new Event('ecoponto:auth'));
  }

  return { token, logado, login, logout };
})();

const Sessao = (() => {
  const U = 'ecoponto_usuario';
  const D = 'ecoponto_destino';
  const L = 'ecoponto_ultimo';
  const ler = (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } };

  return {
    usuario:    () => ler(U),
    entrar:     (u) => sessionStorage.setItem(U, JSON.stringify(u)),
    sair:       () => { sessionStorage.removeItem(U); sessionStorage.removeItem(L); },
    ultimo:     () => ler(L),
    setUltimo:  (a) => sessionStorage.setItem(L, JSON.stringify(a)),
    destino:    () => sessionStorage.getItem(D) || 'agendar',
    setDestino: (d) => sessionStorage.setItem(D, d),
  };
})();
