// Utilitários de validação e datas (fuso BRT, UTC-3)

const DATA_REGEX      = /^\d{4}-\d{2}-\d{2}$/;
const DATA_HORA_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const HORA_REGEX      = /^([01]\d|2[0-3]):[0-5]\d$/;

function soDigitos(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
}

// Converte para inteiro ou devolve null (evita 500 do Postgres com ids inválidos)
function inteiro(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function validarCPF(valor) {
  const cpf = soDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += parseInt(cpf[i], 10) * (t + 1 - i);
    const digito = ((soma * 10) % 11) % 10;
    if (digito !== parseInt(cpf[t], 10)) return false;
  }
  return true;
}

function validarCNPJ(valor) {
  const cnpj = soDigitos(valor);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (base) => {
    const pesos = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += parseInt(base[i], 10) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = calc(cnpj.slice(0, 12));
  const d2 = calc(cnpj.slice(0, 12) + d1);
  return d1 === parseInt(cnpj[12], 10) && d2 === parseInt(cnpj[13], 10);
}

// Devolve só dígitos (DDD + número, sem o 55) ou null se inválido
function normalizarTelefone(valor) {
  let d = soDigitos(valor);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return d;
}

function emailValido(valor) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
}

// 'AAAA-MM-DD' existente no calendário
function dataValida(str) {
  if (typeof str !== 'string' || !DATA_REGEX.test(str)) return false;
  const d = new Date(str + 'T12:00:00-03:00');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

// 'AAAA-MM-DDTHH:mm' válido
function dataHoraValida(str) {
  if (typeof str !== 'string' || !DATA_HORA_REGEX.test(str)) return false;
  if (!dataValida(str.slice(0, 10))) return false;
  return !isNaN(new Date(str + '-03:00').getTime());
}

// 0 = domingo ... 6 = sábado, para uma data 'AAAA-MM-DD'
function diaSemanaDe(data) {
  return new Date(data + 'T12:00:00-03:00').getUTCDay();
}

// "Agora" e "hoje" em horário de Brasília, independente do fuso do servidor
function agoraBRT() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
function hojeBRT() {
  return agoraBRT().slice(0, 10);
}

function paraMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}
function deMin(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

module.exports = {
  DATA_REGEX, DATA_HORA_REGEX, HORA_REGEX,
  soDigitos, inteiro,
  validarCPF, validarCNPJ, normalizarTelefone, emailValido,
  dataValida, dataHoraValida, diaSemanaDe,
  agoraBRT, hojeBRT, paraMin, deMin,
};
