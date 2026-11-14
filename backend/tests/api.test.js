// Testes de integração da API do EcoPonto Digital (Jest + Supertest)
// Usam um banco SQLite temporário (ver tests/env.js), nunca o de produção.
const fs = require('fs');
const request = require('supertest');
const { initDb, db } = require('../database');
const app = require('../server');
const { diaSemanaDe } = require('../utils/validacao');

// Próximo dia útil (seg–sex) a pelo menos 7 dias de hoje, no formato AAAA-MM-DD
function proximoDiaUtil() {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + 7 * 86400000); // hoje (BRT) + 7 dias
  for (;;) {
    const s = d.toISOString().slice(0, 10);
    const dia = diaSemanaDe(s);
    if (dia >= 1 && dia <= 5) return s;
    d.setUTCDate(d.getUTCDate() + 1);
  }
}
function proximoDomingo() {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + 7 * 86400000);
  while (diaSemanaDe(d.toISOString().slice(0, 10)) !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const DATA = proximoDiaUtil();
const HORA = `${DATA}T09:00`;
const CPFS = ['52998224725', '39053344705', '11144477735', '12345678909'];
const U = {};          // ids dos usuários criados
let token;             // token do operador
let agIds = [];        // ids dos agendamentos criados

beforeAll(async () => { await initDb(); });
afterAll(async () => {
  await db.destroy();
  try { fs.unlinkSync(process.env.DB_FILE); } catch { /* arquivo temporário já removido */ }
});

const operador = () => ({ Authorization: `Bearer ${token}` });

describe('Infraestrutura e dados iniciais', () => {
  test('GET /ping responde ok', async () => {
    const r = await request(app).get('/ping');
    expect(r.status).toBe(200);
    expect(r.text).toBe('ok');
  });
  test('GET /api/residuos devolve os 5 tipos do seed', async () => {
    const r = await request(app).get('/api/residuos');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(5);
  });
  test('GET /api/pontos?residuo_id=4 (medicamentos) devolve só o PEV Zona Norte', async () => {
    const r = await request(app).get('/api/pontos?residuo_id=4');
    expect(r.status).toBe(200);
    expect(r.body.map(p => p.nome)).toEqual(['PEV Zona Norte']);
  });
  test('rota de API inexistente devolve 404 em JSON', async () => {
    const r = await request(app).get('/api/nao-existe');
    expect(r.status).toBe(404);
    expect(r.body.erro).toBeDefined();
  });
});

describe('Cadastro e identificação de usuários', () => {
  test('recusa CPF inválido', async () => {
    const r = await request(app).post('/api/usuarios')
      .send({ tipo: 'pf', nome: 'Maria Souza', cpf_cnpj: '111.111.111-11', telefone: '17999991234' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/CPF inválido/);
  });
  test('cadastra pessoa física', async () => {
    const r = await request(app).post('/api/usuarios')
      .send({ tipo: 'pf', nome: 'Maria Souza', cpf_cnpj: '529.982.247-25', telefone: '(17) 99999-1234' });
    expect(r.status).toBe(201);
    expect(r.body.tipo).toBe('pf');
    U.maria = r.body.id;
  });
  test('recusa documento duplicado', async () => {
    const r = await request(app).post('/api/usuarios')
      .send({ tipo: 'pf', nome: 'Outra Pessoa', cpf_cnpj: '52998224725', telefone: '17988887777' });
    expect(r.status).toBe(409);
  });
  test('pessoa jurídica exige responsável', async () => {
    const r = await request(app).post('/api/usuarios')
      .send({ tipo: 'pj', nome: 'Tech Assist Ltda', cpf_cnpj: '11.222.333/0001-81', telefone: '1733334444' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/responsável/i);
  });
  test('cadastra pessoa jurídica com CNPJ válido', async () => {
    const r = await request(app).post('/api/usuarios')
      .send({ tipo: 'pj', nome: 'Tech Assist Ltda', cpf_cnpj: '11.222.333/0001-81', responsavel: 'João Lima', telefone: '1733334444' });
    expect(r.status).toBe(201);
    expect(r.body.tipo).toBe('pj');
    U.empresa = r.body.id;
  });
  test('identifica usuário por documento + telefone', async () => {
    const r = await request(app).post('/api/usuarios/identificar')
      .send({ cpf_cnpj: '52998224725', telefone: '(17) 99999-1234' });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(U.maria);
  });
  test('não identifica com telefone diferente', async () => {
    const r = await request(app).post('/api/usuarios/identificar')
      .send({ cpf_cnpj: '52998224725', telefone: '17900000000' });
    expect(r.status).toBe(404);
  });
});

describe('Disponibilidade de horários', () => {
  test('dia útil: PEV Centro gera 18 horários (08:00 a 16:30) com 3 vagas', async () => {
    const r = await request(app).get(`/api/agendamentos/disponibilidade?ponto_id=1&data=${DATA}&residuo_id=1`);
    expect(r.status).toBe(200);
    expect(r.body.slots).toHaveLength(18);
    expect(r.body.slots[0]).toMatchObject({ hora: '08:00', vagas: 3, disponivel: true });
    expect(r.body.slots[17].hora).toBe('16:30');
  });
  test('domingo: ponto não funciona', async () => {
    const r = await request(app).get(`/api/agendamentos/disponibilidade?ponto_id=1&data=${proximoDomingo()}`);
    expect(r.status).toBe(200);
    expect(r.body.funciona).toBe(false);
    expect(r.body.slots).toHaveLength(0);
  });
  test('recusa resíduo que o ponto não aceita', async () => {
    const r = await request(app).get(`/api/agendamentos/disponibilidade?ponto_id=1&data=${DATA}&residuo_id=4`);
    expect(r.status).toBe(400);
  });
});

describe('Regras de agendamento', () => {
  const base = () => ({ usuario_id: U.maria, ponto_id: 1, residuo_id: 1, data_hora: HORA });

  test('recusa data/hora no passado', async () => {
    const r = await request(app).post('/api/agendamentos').send({ ...base(), data_hora: '2020-01-01T09:00' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/passada/);
  });
  test('recusa ponto que não aceita o resíduo escolhido', async () => {
    const r = await request(app).post('/api/agendamentos').send({ ...base(), residuo_id: 4 });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/não aceita/);
  });
  test('recusa horário fora do funcionamento', async () => {
    const r = await request(app).post('/api/agendamentos').send({ ...base(), data_hora: `${DATA}T07:00` });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/fora do funcionamento/);
  });
  test('empresa precisa informar a quantidade estimada', async () => {
    const r = await request(app).post('/api/agendamentos').send({ ...base(), usuario_id: U.empresa });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/quantidade/i);
  });
  test('cria agendamento válido e a resposta pública não expõe telefone', async () => {
    const r = await request(app).post('/api/agendamentos').send({ ...base(), quantidade_estimada: '2 celulares' });
    expect(r.status).toBe(201);
    expect(r.body.ponto_nome).toBe('PEV Centro');
    expect(r.body.usuario_telefone).toBeUndefined();
    agIds.push(r.body.id);
  });
  test('recusa o mesmo usuário no mesmo ponto e horário', async () => {
    const r = await request(app).post('/api/agendamentos').send(base());
    expect(r.status).toBe(409);
  });
});

describe('Capacidade por horário (3 entregas no PEV Centro)', () => {
  test('o 4º agendamento no mesmo horário é recusado como lotado', async () => {
    // Maria já ocupa a 1ª vaga. Cria mais 3 usuários; os 2 primeiros preenchem as vagas 2 e 3.
    for (let i = 1; i <= 3; i++) {
      const u = await request(app).post('/api/usuarios')
        .send({ tipo: 'pf', nome: `Usuário ${i}`, cpf_cnpj: CPFS[i], telefone: `1798888000${i}` });
      expect(u.status).toBe(201);
      U[`u${i}`] = u.body.id;
    }
    for (const chave of ['u1', 'u2']) {
      const r = await request(app).post('/api/agendamentos')
        .send({ usuario_id: U[chave], ponto_id: 1, residuo_id: 1, data_hora: HORA });
      expect(r.status).toBe(201);
      agIds.push(r.body.id);
    }
    const lotado = await request(app).post('/api/agendamentos')
      .send({ usuario_id: U.u3, ponto_id: 1, residuo_id: 1, data_hora: HORA });
    expect(lotado.status).toBe(409);
    expect(lotado.body.erro).toMatch(/lotado/i);
  });
  test('a disponibilidade mostra 0 vagas no horário lotado', async () => {
    const r = await request(app).get(`/api/agendamentos/disponibilidade?ponto_id=1&data=${DATA}`);
    const slot = r.body.slots.find(s => s.hora === '09:00');
    expect(slot.vagas).toBe(0);
    expect(slot.disponivel).toBe(false);
  });
});

describe('Área do operador', () => {
  test('rotas do operador exigem token', async () => {
    const r = await request(app).get('/api/agendamentos');
    expect(r.status).toBe(401);
  });
  test('login com senha errada é recusado', async () => {
    const r = await request(app).post('/api/auth/login').send({ usuario: 'operador_teste', senha: 'errada' });
    expect(r.status).toBe(401);
  });
  test('login correto devolve token e /verificar o aceita', async () => {
    const r = await request(app).post('/api/auth/login').send({ usuario: 'operador_teste', senha: 'senha_teste_123' });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
    token = r.body.token;
    const v = await request(app).post('/api/auth/verificar').set(operador());
    expect(v.status).toBe(200);
  });
  test('token adulterado é recusado', async () => {
    const r = await request(app).get('/api/agendamentos').set('Authorization', `Bearer ${token}x`);
    expect(r.status).toBe(401);
  });
  test('lista agendamentos do dia com filtro', async () => {
    const r = await request(app).get(`/api/agendamentos?data=${DATA}&ponto_id=1`).set(operador());
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(3);
    expect(r.body[0].usuario_telefone).toBeDefined(); // o operador vê o contato
  });
  test('cancelar um agendamento libera a vaga', async () => {
    const c = await request(app).patch(`/api/agendamentos/${agIds[1]}/status`).set(operador()).send({ status: 'cancelado' });
    expect(c.status).toBe(200);
    const r = await request(app).post('/api/agendamentos')
      .send({ usuario_id: U.u3, ponto_id: 1, residuo_id: 1, data_hora: HORA });
    expect(r.status).toBe(201);
  });
  test('status inválido é recusado', async () => {
    const r = await request(app).patch(`/api/agendamentos/${agIds[0]}/status`).set(operador()).send({ status: 'qualquer' });
    expect(r.status).toBe(400);
  });
  test('desativar um ponto o remove da lista pública', async () => {
    const d = await request(app).delete('/api/pontos/2').set(operador());
    expect(d.status).toBe(200);
    const r = await request(app).get('/api/pontos');
    expect(r.body.map(p => p.nome)).not.toContain('PEV Aeroporto');
  });
  test('não permite remover resíduo com agendamentos vinculados', async () => {
    const r = await request(app).delete('/api/residuos/1').set(operador());
    expect(r.status).toBe(409);
  });
});

describe('Análise de dados e histórico', () => {
  test('GET /api/analise devolve totais e agrupamentos', async () => {
    const r = await request(app).get('/api/analise').set(operador());
    expect(r.status).toBe(200);
    expect(r.body.resumo.total).toBe(4);       // 3 ativos + 1 cancelado
    expect(r.body.resumo.cancelados).toBe(1);
    expect(r.body.por_residuo[0]).toEqual({ rotulo: 'Eletrônicos', total: 3 });
    expect(r.body.por_bairro[0].rotulo).toBe('Centro');
  });
  test('histórico do usuário traz resumo e entregas', async () => {
    const r = await request(app).post('/api/usuarios/historico')
      .send({ cpf_cnpj: '52998224725', telefone: '17999991234' });
    expect(r.status).toBe(200);
    expect(r.body.resumo.total).toBe(1);
    expect(r.body.agendamentos[0].residuo_nome).toBe('Eletrônicos');
  });
});
