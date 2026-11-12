const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { requireOperador, ehOperador } = require('../middleware/auth');
const {
  HORA_REGEX, soDigitos, inteiro, paraMin, agoraBRT,
} = require('../utils/validacao');

const NOMES_DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const PADRAO = {
  nome: '', endereco: '', bairro: '', cidade: 'Barretos', cep: null,
  latitude: null, longitude: null,
  hora_abertura: '08:00', hora_fechamento: '17:00', dias_semana: '1,2,3,4,5',
  intervalo_minutos: 30, capacidade_slot: 3, ativo: true,
};

function descreverDias(dias) {
  const n = dias.split(',').map(Number);
  const contiguo = n.every((d, i) => i === 0 || d === n[i - 1] + 1);
  return n.length > 2 && contiguo
    ? `${NOMES_DIAS[n[0]]} a ${NOMES_DIAS[n[n.length - 1]]}`
    : n.map(d => NOMES_DIAS[d]).join(', ');
}

// Aceita array [1,2,3] ou string "1,2,3". Devolve string normalizada ou null se inválido.
function lerDias(valor) {
  const lista = Array.isArray(valor) ? valor : String(valor).split(',');
  const nums = [...new Set(lista.map(v => inteiro(String(v).trim())))];
  if (!nums.length || nums.some(n => n === null || n < 0 || n > 6)) return null;
  return nums.sort((a, b) => a - b).join(',');
}

function validarPonto(body, base) {
  const v = c => (body[c] !== undefined ? body[c] : base[c]);

  const nome     = String(v('nome') || '').trim();
  const endereco = String(v('endereco') || '').trim();
  const bairro   = String(v('bairro') || '').trim();
  const cidade   = String(v('cidade') || 'Barretos').trim();
  if (nome.length < 3)  return { erro: 'Informe o nome do ponto (mínimo 3 caracteres).' };
  if (!endereco)        return { erro: 'Informe o endereço do ponto.' };
  if (!bairro)          return { erro: 'Informe o bairro do ponto.' };

  let cep = v('cep') ? soDigitos(v('cep')) : null;
  if (cep) {
    if (cep.length !== 8) return { erro: 'CEP inválido. Informe 8 dígitos.' };
    cep = `${cep.slice(0, 5)}-${cep.slice(5)}`;
  }

  let latitude = null, longitude = null;
  const lat = v('latitude'), lng = v('longitude');
  if (lat !== null && lat !== undefined && lat !== '') {
    latitude = Number(lat);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return { erro: 'Latitude inválida.' };
  }
  if (lng !== null && lng !== undefined && lng !== '') {
    longitude = Number(lng);
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return { erro: 'Longitude inválida.' };
  }

  const abre  = String(v('hora_abertura') || '');
  const fecha = String(v('hora_fechamento') || '');
  if (!HORA_REGEX.test(abre) || !HORA_REGEX.test(fecha))
    return { erro: 'Horários inválidos. Use o formato HH:MM (exemplo: 08:00).' };
  if (paraMin(fecha) <= paraMin(abre))
    return { erro: 'O horário de fechamento deve ser depois do horário de abertura.' };

  const dias = lerDias(v('dias_semana'));
  if (!dias) return { erro: 'Dias de funcionamento inválidos. Use números de 0 (domingo) a 6 (sábado).' };

  const intervalo = inteiro(v('intervalo_minutos'));
  if (intervalo === null || intervalo < 10 || intervalo > 240)
    return { erro: 'A duração de cada horário deve ficar entre 10 e 240 minutos.' };
  if (paraMin(fecha) - paraMin(abre) < intervalo)
    return { erro: 'A duração de cada horário é maior que o período de funcionamento.' };

  const capacidade = inteiro(v('capacidade_slot'));
  if (capacidade === null || capacidade < 1 || capacidade > 50)
    return { erro: 'A capacidade por horário deve ficar entre 1 e 50 entregas.' };

  const ativo = typeof body.ativo === 'boolean' ? body.ativo : !!base.ativo;

  return {
    dados: {
      nome, endereco, bairro, cidade, cep, latitude, longitude,
      horario_funcionamento: `${descreverDias(dias)}, ${abre} às ${fecha}`,
      hora_abertura: abre, hora_fechamento: fecha, dias_semana: dias,
      intervalo_minutos: intervalo, capacidade_slot: capacidade, ativo,
    }
  };
}

// undefined → não mexe; array de ids → substitui
async function lerResiduos(trx, lista) {
  if (lista === undefined) return { manter: true };
  if (!Array.isArray(lista)) return { erro: 'Resíduos aceitos devem ser enviados como lista de ids.' };
  const ids = [...new Set(lista.map(i => inteiro(i)))];
  if (ids.some(i => i === null)) return { erro: 'Lista de resíduos inválida.' };
  if (ids.length) {
    const achados = await trx('tipos_residuo').whereIn('id', ids).select('id');
    if (achados.length !== ids.length) return { erro: 'Um ou mais tipos de resíduo informados não existem.' };
  }
  return { ids };
}

function erroValidacao(msg) {
  const e = new Error(msg);
  e.validacao = true;
  return e;
}

function normalizar(p) {
  return {
    ...p,
    ativo: !!p.ativo,
    latitude:  p.latitude  === null || p.latitude  === undefined ? null : Number(p.latitude),
    longitude: p.longitude === null || p.longitude === undefined ? null : Number(p.longitude),
  };
}

async function anexarResiduos(pontos) {
  if (!pontos.length) return [];
  const links = await db('ponto_residuo as pr')
    .join('tipos_residuo as r', 'pr.residuo_id', 'r.id')
    .whereIn('pr.ponto_id', pontos.map(p => p.id))
    .select('pr.ponto_id', 'r.id', 'r.nome', 'r.icone')
    .orderBy('r.nome');
  return pontos.map(p => ({
    ...normalizar(p),
    residuos: links
      .filter(l => l.ponto_id === p.id)
      .map(({ id, nome, icone }) => ({ id, nome, icone })),
  }));
}

// GET /api/pontos?residuo_id=  — público (só pontos ativos)
// Operador autenticado pode passar incluir_inativos=1
router.get('/', async (req, res) => {
  try {
    let query = db('pontos_coleta as p').select('p.*').orderBy('p.nome');

    if (!(req.query.incluir_inativos === '1' && ehOperador(req))) {
      query = query.where('p.ativo', true);
    }

    if (req.query.residuo_id !== undefined) {
      const rid = inteiro(req.query.residuo_id);
      if (rid === null) return res.status(400).json({ erro: 'Tipo de resíduo inválido.' });
      query = query.whereIn('p.id', db('ponto_residuo').select('ponto_id').where('residuo_id', rid));
    }

    res.json(await anexarResiduos(await query));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar pontos de coleta.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = inteiro(req.params.id);
    if (id === null) return res.status(400).json({ erro: 'Ponto inválido.' });
    const ponto = await db('pontos_coleta').where({ id }).first();
    if (!ponto || (!ponto.ativo && !ehOperador(req)))
      return res.status(404).json({ erro: 'Ponto de coleta não encontrado.' });
    const [completo] = await anexarResiduos([ponto]);
    res.json(completo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar ponto de coleta.' });
  }
});

// POST /api/pontos — operador
router.post('/', requireOperador, async (req, res) => {
  try {
    const body = req.body || {};
    const v = validarPonto(body, PADRAO);
    if (v.erro) return res.status(400).json({ erro: v.erro });

    const id = await db.transaction(async trx => {
      const r = await lerResiduos(trx, body.residuos);
      if (r.erro) throw erroValidacao(r.erro);
      const [{ id }] = await trx('pontos_coleta').insert(v.dados).returning('id');
      if (r.ids && r.ids.length)
        await trx('ponto_residuo').insert(r.ids.map(rid => ({ ponto_id: id, residuo_id: rid })));
      return id;
    });

    const [criado] = await anexarResiduos([await db('pontos_coleta').where({ id }).first()]);
    res.status(201).json(criado);
  } catch (err) {
    if (err.validacao) return res.status(400).json({ erro: err.message });
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar ponto de coleta.' });
  }
});

// PUT /api/pontos/:id — operador (campos omitidos mantêm o valor atual;
// "residuos" omitido mantém os resíduos aceitos, array substitui)
router.put('/:id', requireOperador, async (req, res) => {
  try {
    const id = inteiro(req.params.id);
    if (id === null) return res.status(400).json({ erro: 'Ponto inválido.' });
    const existente = await db('pontos_coleta').where({ id }).first();
    if (!existente) return res.status(404).json({ erro: 'Ponto de coleta não encontrado.' });

    const body = req.body || {};
    const v = validarPonto(body, existente);
    if (v.erro) return res.status(400).json({ erro: v.erro });

    await db.transaction(async trx => {
      const r = await lerResiduos(trx, body.residuos);
      if (r.erro) throw erroValidacao(r.erro);
      await trx('pontos_coleta').where({ id }).update(v.dados);
      if (!r.manter) {
        await trx('ponto_residuo').where({ ponto_id: id }).delete();
        if (r.ids.length)
          await trx('ponto_residuo').insert(r.ids.map(rid => ({ ponto_id: id, residuo_id: rid })));
      }
    });

    const [atualizado] = await anexarResiduos([await db('pontos_coleta').where({ id }).first()]);
    res.json(atualizado);
  } catch (err) {
    if (err.validacao) return res.status(400).json({ erro: err.message });
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar ponto de coleta.' });
  }
});

// DELETE /api/pontos/:id — operador. DESATIVA o ponto (preserva o histórico de agendamentos).
router.delete('/:id', requireOperador, async (req, res) => {
  try {
    const id = inteiro(req.params.id);
    if (id === null) return res.status(400).json({ erro: 'Ponto inválido.' });
    const existente = await db('pontos_coleta').where({ id }).first();
    if (!existente) return res.status(404).json({ erro: 'Ponto de coleta não encontrado.' });

    await db('pontos_coleta').where({ id }).update({ ativo: false });

    const [{ n }] = await db('agendamentos')
      .where({ ponto_id: id, status: 'confirmado' })
      .where('data_hora', '>=', agoraBRT())
      .count({ n: '*' });

    res.json({
      mensagem: 'Ponto de coleta desativado.',
      agendamentos_futuros_afetados: Number(n),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao desativar ponto de coleta.' });
  }
});

module.exports = router;
