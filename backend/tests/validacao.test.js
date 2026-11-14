// Testes unitários das funções de validação e datas (utils/validacao.js)
const {
  validarCPF, validarCNPJ, normalizarTelefone, emailValido,
  dataValida, dataHoraValida, diaSemanaDe, paraMin, deMin,
} = require('../utils/validacao');

describe('CPF', () => {
  test('aceita CPF válido com e sem máscara', () => {
    expect(validarCPF('529.982.247-25')).toBe(true);
    expect(validarCPF('52998224725')).toBe(true);
  });
  test('recusa dígito verificador errado', () => {
    expect(validarCPF('529.982.247-24')).toBe(false);
  });
  test('recusa sequências repetidas e tamanho errado', () => {
    expect(validarCPF('111.111.111-11')).toBe(false);
    expect(validarCPF('123')).toBe(false);
    expect(validarCPF('')).toBe(false);
  });
});

describe('CNPJ', () => {
  test('aceita CNPJ válido', () => {
    expect(validarCNPJ('11.222.333/0001-81')).toBe(true);
  });
  test('recusa CNPJ inválido ou repetido', () => {
    expect(validarCNPJ('11.222.333/0001-82')).toBe(false);
    expect(validarCNPJ('00000000000000')).toBe(false);
  });
});

describe('Telefone e e-mail', () => {
  test('normaliza para DDD + número, removendo o 55', () => {
    expect(normalizarTelefone('(17) 99999-1234')).toBe('17999991234');
    expect(normalizarTelefone('+55 17 3333-4444')).toBe('1733334444');
  });
  test('recusa telefone curto', () => {
    expect(normalizarTelefone('9999-1234')).toBeNull();
  });
  test('valida formato de e-mail', () => {
    expect(emailValido('maria@exemplo.com')).toBe(true);
    expect(emailValido('maria@')).toBe(false);
  });
});

describe('Datas (fuso de Brasília)', () => {
  test('dataValida reconhece datas reais do calendário', () => {
    expect(dataValida('2026-11-20')).toBe(true);
    expect(dataValida('2026-02-30')).toBe(false);
    expect(dataValida('20/11/2026')).toBe(false);
  });
  test('dataHoraValida exige AAAA-MM-DDTHH:mm e hora existente', () => {
    expect(dataHoraValida('2026-11-20T09:00')).toBe(true);
    expect(dataHoraValida('2026-11-20T25:00')).toBe(false);
    expect(dataHoraValida('2026-11-20 09:00')).toBe(false);
  });
  test('diaSemanaDe: 20/11/2026 é sexta (5) e 22/11/2026 é domingo (0)', () => {
    expect(diaSemanaDe('2026-11-20')).toBe(5);
    expect(diaSemanaDe('2026-11-22')).toBe(0);
  });
  test('conversão de minutos', () => {
    expect(paraMin('08:30')).toBe(510);
    expect(deMin(510)).toBe('08:30');
  });
});
