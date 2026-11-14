require('dotenv').config();
const knex = require('knex');
const path = require('path');

const isProduction = !!process.env.DATABASE_URL;

let db;

if (isProduction) {
  db = knex({
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    },
    pool: {
      min: 0,
      max: 2,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 240000,   // 4 min (< 5 min do Neon)
      reapIntervalMillis: 1000,
    }
  });
} else {
  db = knex({
    client: 'better-sqlite3',
    connection: { filename: process.env.DB_FILE || path.join(__dirname, 'ecoponto.db') },
    useNullAsDefault: true
  });
}

async function contar(tabela) {
  const [row] = await db(tabela).count({ n: '*' });
  return Number(row.n);
}

async function initDb() {
  // ───────── usuarios (PF/PJ) ─────────
  if (!(await db.schema.hasTable('usuarios'))) {
    await db.schema.createTable('usuarios', t => {
      t.increments('id');
      t.string('tipo').notNullable().defaultTo('pf');   // 'pf' | 'pj'
      t.string('nome').notNullable();                   // nome (PF) ou razão social (PJ)
      t.string('cpf_cnpj').notNullable().unique();      // somente dígitos
      t.string('responsavel');                          // PJ: nome do responsável
      t.string('telefone').notNullable();
      t.string('email');
      t.string('senha_hash');                           // opcional (cadastro simples)
      t.timestamp('criado_em').defaultTo(db.fn.now());
    });
  }

  // ───────── tipos_residuo ─────────
  if (!(await db.schema.hasTable('tipos_residuo'))) {
    await db.schema.createTable('tipos_residuo', t => {
      t.increments('id');
      t.string('nome').notNullable();
      t.string('descricao');
      t.text('instrucoes_descarte');
      t.string('icone');
      t.timestamp('criado_em').defaultTo(db.fn.now());
    });
  }

  // ───────── pontos_coleta (PEVs) ─────────
  if (!(await db.schema.hasTable('pontos_coleta'))) {
    await db.schema.createTable('pontos_coleta', t => {
      t.increments('id');
      t.string('nome').notNullable();
      t.string('endereco').notNullable();
      t.string('bairro').notNullable();
      t.string('cidade').notNullable().defaultTo('Barretos');
      t.string('cep');
      t.decimal('latitude', 10, 6);
      t.decimal('longitude', 10, 6);
      t.string('horario_funcionamento');                 // texto para exibição
      t.string('hora_abertura').notNullable().defaultTo('08:00');
      t.string('hora_fechamento').notNullable().defaultTo('17:00');
      t.string('dias_semana').notNullable().defaultTo('1,2,3,4,5'); // 0=dom ... 6=sáb
      t.integer('intervalo_minutos').notNullable().defaultTo(30);   // duração de cada slot
      t.integer('capacidade_slot').notNullable().defaultTo(3);      // entregas simultâneas por slot
      t.boolean('ativo').notNullable().defaultTo(true);
      t.timestamp('criado_em').defaultTo(db.fn.now());
    });
  }

  // ───────── ponto_residuo (N:N) ─────────
  if (!(await db.schema.hasTable('ponto_residuo'))) {
    await db.schema.createTable('ponto_residuo', t => {
      t.integer('ponto_id').notNullable().references('id').inTable('pontos_coleta').onDelete('CASCADE');
      t.integer('residuo_id').notNullable().references('id').inTable('tipos_residuo').onDelete('CASCADE');
      t.primary(['ponto_id', 'residuo_id']);
    });
  }

  // ───────── agendamentos ─────────
  if (!(await db.schema.hasTable('agendamentos'))) {
    await db.schema.createTable('agendamentos', t => {
      t.increments('id');
      t.integer('usuario_id').notNullable().references('id').inTable('usuarios').onDelete('CASCADE');
      t.integer('ponto_id').notNullable().references('id').inTable('pontos_coleta').onDelete('CASCADE');
      t.integer('residuo_id').notNullable().references('id').inTable('tipos_residuo').onDelete('CASCADE');
      t.string('data_hora').notNullable();               // 'YYYY-MM-DDTHH:mm' (BRT)
      t.string('quantidade_estimada');                   // ex.: "5 kg", "20 unidades"
      t.string('status').notNullable().defaultTo('confirmado'); // confirmado | concluido | cancelado
      t.text('observacoes');
      t.boolean('confirmacao_enviada').defaultTo(false);
      t.boolean('lembrete_60_enviado').defaultTo(false);
      t.boolean('lembrete_15_enviado').defaultTo(false);
      t.timestamp('criado_em').defaultTo(db.fn.now());
      t.index(['ponto_id', 'data_hora']);
      t.index(['usuario_id']);
    });
  }

  // ───────── SEED (dados fictícios para demonstração) ─────────
  if ((await contar('tipos_residuo')) === 0) {
    await db('tipos_residuo').insert([
      { nome: 'Eletrônicos',          descricao: 'Celulares, computadores, TVs, cabos e periféricos', instrucoes_descarte: 'Entregue o equipamento inteiro, sem desmontar. Remova dados pessoais antes.', icone: '💻' },
      { nome: 'Pilhas e baterias',    descricao: 'Pilhas, baterias de celular e notebook',            instrucoes_descarte: 'Não perfure nem abra. Entregue em saco plástico fechado, sem vazamento.',     icone: '🔋' },
      { nome: 'Lâmpadas',             descricao: 'Fluorescentes e LED',                               instrucoes_descarte: 'Transporte na embalagem original ou envolvida em jornal, sem quebrar.',        icone: '💡' },
      { nome: 'Medicamentos vencidos', descricao: 'Comprimidos, xaropes e cartelas',                  instrucoes_descarte: 'Mantenha na embalagem. Líquidos em frascos bem fechados.',                    icone: '💊' },
      { nome: 'Óleo de cozinha',      descricao: 'Óleo vegetal usado em frituras',                    instrucoes_descarte: 'Entregue frio, em garrafa PET bem fechada, sem restos de comida.',            icone: '🛢️' },
    ]);
  }

  if ((await contar('pontos_coleta')) === 0) {
    await db('pontos_coleta').insert([
      { nome: 'PEV Centro',     endereco: 'Rua 20, 1000',         bairro: 'Centro',     cidade: 'Barretos', cep: '14780-000', latitude: -20.5573, longitude: -48.5677, horario_funcionamento: 'Seg a Sex, 8h às 17h',  hora_abertura: '08:00', hora_fechamento: '17:00', dias_semana: '1,2,3,4,5',   intervalo_minutos: 30, capacidade_slot: 3 },
      { nome: 'PEV Aeroporto',  endereco: 'Avenida 43, 2500',     bairro: 'Aeroporto',  cidade: 'Barretos', cep: '14780-100', latitude: -20.5440, longitude: -48.5810, horario_funcionamento: 'Seg a Sex, 8h às 16h',  hora_abertura: '08:00', hora_fechamento: '16:00', dias_semana: '1,2,3,4,5',   intervalo_minutos: 30, capacidade_slot: 2 },
      { nome: 'PEV Zona Norte', endereco: 'Rua 8, 350',           bairro: 'Zona Norte', cidade: 'Barretos', cep: '14780-200', latitude: -20.5360, longitude: -48.5600, horario_funcionamento: 'Seg a Sáb, 8h às 12h',  hora_abertura: '08:00', hora_fechamento: '12:00', dias_semana: '1,2,3,4,5,6', intervalo_minutos: 30, capacidade_slot: 2 },
    ]);
  }

  if ((await contar('ponto_residuo')) === 0) {
    const pontos  = await db('pontos_coleta').select('id', 'nome');
    const residuos = await db('tipos_residuo').select('id', 'nome');
    const idP = Object.fromEntries(pontos.map(p => [p.nome, p.id]));
    const idR = Object.fromEntries(residuos.map(r => [r.nome, r.id]));

    const aceitos = {
      'PEV Centro':     ['Eletrônicos', 'Pilhas e baterias', 'Lâmpadas', 'Óleo de cozinha'],
      'PEV Aeroporto':  ['Eletrônicos', 'Pilhas e baterias', 'Lâmpadas'],
      'PEV Zona Norte': ['Pilhas e baterias', 'Medicamentos vencidos', 'Óleo de cozinha'],
    };

    const linhas = [];
    for (const [ponto, lista] of Object.entries(aceitos)) {
      for (const r of lista) linhas.push({ ponto_id: idP[ponto], residuo_id: idR[r] });
    }
    await db('ponto_residuo').insert(linhas);
  }

  console.log(`✅ Banco de dados pronto (${isProduction ? 'PostgreSQL' : 'SQLite'})`);
}

module.exports = { db, initDb };
