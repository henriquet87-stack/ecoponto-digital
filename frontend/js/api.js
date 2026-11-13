// =============================================
//  api.js — Comunicação com o backend (EcoPonto Digital)
// =============================================

// ⚠️ TROQUE pela URL do seu serviço no Render (termina em /api)
const API_PRODUCAO = 'https://ecoponto-digital.onrender.com/api';

const API = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? 'http://localhost:3000/api'
  : API_PRODUCAO;

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.append(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

// auth:true → envia o token do operador; se o servidor responder 401, encerra a sessão
async function req(method, endpoint, corpo = null, { auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const t = Auth.token();
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }

  let res;
  try {
    res = await fetch(API + endpoint, {
      method,
      headers,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente. Se o serviço estiver "acordando", aguarde cerca de um minuto.');
  }

  let dados = null;
  try { dados = await res.json(); } catch { /* resposta sem corpo JSON */ }

  if (res.status === 401 && auth) {
    Auth.logout();
    window.dispatchEvent(new Event('ecoponto:sessao-expirada'));
  }
  if (!res.ok) {
    const msg = [dados && dados.erro, dados && dados.detalhe].filter(Boolean).join(' ');
    throw new Error(msg || `Erro inesperado (${res.status}).`);
  }
  return dados;
}

const api = {
  // Autenticação do operador
  login: (usuario, senha) => req('POST', '/auth/login', { usuario, senha }),

  // Usuários (cidadão)
  criarUsuario: (b)    => req('POST', '/usuarios', b),
  identificar:  (b)    => req('POST', '/usuarios/identificar', b),
  historico:    (b)    => req('POST', '/usuarios/historico', b),

  // Resíduos
  getResiduos:       (p)     => req('GET',    `/residuos${qs(p)}`),
  criarResiduo:      (b)     => req('POST',   '/residuos', b, { auth: true }),
  atualizarResiduo:  (id, b) => req('PUT',    `/residuos/${id}`, b, { auth: true }),
  deletarResiduo:    (id)    => req('DELETE', `/residuos/${id}`, null, { auth: true }),

  // Pontos de coleta
  getPontos:         (p, auth = false) => req('GET', `/pontos${qs(p)}`, null, { auth }),
  criarPonto:        (b)     => req('POST',   '/pontos', b, { auth: true }),
  atualizarPonto:    (id, b) => req('PUT',    `/pontos/${id}`, b, { auth: true }),
  desativarPonto:    (id)    => req('DELETE', `/pontos/${id}`, null, { auth: true }),

  // Agendamentos
  disponibilidade:   (p)     => req('GET',    `/agendamentos/disponibilidade${qs(p)}`),
  criarAgendamento:  (b)     => req('POST',   '/agendamentos', b),
  getAgendamentos:   (p)     => req('GET',    `/agendamentos${qs(p)}`, null, { auth: true }),
  atualizarStatus:   (id, s) => req('PATCH',  `/agendamentos/${id}/status`, { status: s }, { auth: true }),

  // Análise de dados (operador)
  analise:           (p)     => req('GET',    `/analise${qs(p)}`, null, { auth: true }),
};

// API pública ViaCEP (preenchimento de endereço pelo CEP)
async function buscarCepViaCep(cep) {
  const digitos = String(cep || '').replace(/\D/g, '');
  if (digitos.length !== 8) throw new Error('Informe um CEP com 8 dígitos.');
  let res;
  try { res = await fetch(`https://viacep.com.br/ws/${digitos}/json/`); }
  catch { throw new Error('Não foi possível consultar o ViaCEP agora. Preencha o endereço manualmente.'); }
  if (!res.ok) throw new Error('CEP não encontrado. Preencha o endereço manualmente.');
  const d = await res.json();
  if (d.erro) throw new Error('CEP não encontrado. Preencha o endereço manualmente.');
  return d; // { logradouro, bairro, localidade, uf, ... }
}
