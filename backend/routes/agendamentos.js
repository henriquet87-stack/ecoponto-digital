const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { enviarWhatsApp } = require('../utils/callmebot');
const { requireOperador } = require('../middleware/auth');
const {
  inteiro, dataValida, dataHoraValida, diaSemanaDe, paraMin, deMin,
} = require('../utils/validacao');

const STATUS_VALIDOS = ['confirmado', 'concluido', 'cancelado'];

// ───────── helpers ─────────

// Horários ('HH:MM') que o ponto oferece em uma data 'AAAA-MM-DD'
function gerarSlots(ponto, data) {
  const dias = String(ponto.dias_semana).split(',').map(Number);
  if (!dias.includes(diaSemanaDe(data))) return [];
  const ini = paraMin(ponto.hora_abertura);
  const fim = paraMin(ponto.hora_fechamento);
  const passo = Number(ponto.intervalo_minutos) || 30;
  const slots = [];
  for (let m = ini; m + passo <= fim; m += passo) slots.push(deMin(m));
  return slots;
}

// Envia notificação WhatsApp ao OPERADOR via CallMeBot. Retorna true/false.
async function notificarOperador(ag) {
  const data = ag.data_hora.slice(0, 10).split('-').reverse().join('/');
  const hora = ag.data_hora.slice(11, 16);
  const qtd  = ag.quantidade_estimada ? ` (${ag.quantidade_estimada})` : '';
  const msg  = `♻️ Novo agendamento!\n👤 ${ag.usuario_nome} [${ag.usuario_tipo.toUpperCase()}]\n🗑️ ${ag.residuo_nome}${qtd}\n📍 ${ag.ponto_nome}\n📅 ${data} às ${hora}`;
  return enviarWhatsApp(msg);
}

const selectAgendamento = (query) =>
  query
    .join('usuarios as u', 'a.usuario_id', 'u.id')
    .join('pontos_coleta as p', 'a.ponto_id', 'p.id')
    .join('tipos_residuo as r', 'a.residuo_id', 'r.id')
    .select(
      'a.id', 'a.data_hora', 'a.status', 'a.quantidade_estimada', 'a.observacoes', 'a.criado_em',
      'u.id as usuario_id', 'u.tipo as usuario_tipo', 'u.nome as usuario_nome', 'u.telefone as usuario_telefone',
      'p.id as ponto_id', 'p.nome as ponto_nome', 'p.endereco as ponto_endereco', 'p.bairro as ponto_bairro',
      'r.id as residuo_id', 'r.nome as residuo_nome', 'r.instrucoes_descarte'
    );

// Resposta pública (cidadão): sem telefone nem dados de outros campos pessoais
function visaoPublica(ag) {
  return {
    id: ag.id,
    data_hora: ag.data_hora,
    status: ag.status,
    quantidade_estimada: ag.quantidade_estimada,
    ponto_nome: ag.ponto_nome,
    ponto_endereco: ag.ponto_endereco,
    ponto_bairro: ag.ponto_bairro,
    residuo_nome: ag.residuo_nome,
    instrucoes_descarte: ag.instrucoes_descarte,
  };
}

// ───────── GET /disponibilidade (público) ─────────
// ?ponto_id=1&data=2026-11-12[&residuo_id=2]
router.get('/disponibilidade', async (req, res) => {
  try {
    const pid = inteiro(req.query.ponto_id);
    const data = req.query.data;
    if (pid === null || !data)
      return res.status(400).json({ erro: 'Informe o ponto de coleta e a data.' });
    if (!dataValida(data))
      return res.status(400).json({ erro: 'Data inválida. Use o formato AAAA-MM-DD.' });

    const ponto = await db('pontos_coleta').where({ id: pid, ativo: true }).first();
    if (!ponto) return res.status(404).json({ erro: 'Ponto de coleta não encontrado ou inativo.' });

    if (req.query.residuo_id !== undefined) {
      const rid = inteiro(req.query.residuo_id);
      if (rid === null) return res.status(400).json({ erro: 'Tipo de resíduo inválido.' });
      const aceita = await db('ponto_residuo').where({ ponto_id: pid, residuo_id: rid }).first();
      if (!aceita) return res.status(400).json({ erro: 'Este ponto não aceita o resíduo selecionado.' });
    }

    const slots = gerarSlots(ponto, data);
    const ocupados = await db('agendamentos')
      .where('ponto_id', pid)
      .whereNot('status', 'cancelado')
      .where('data_hora', 'like', `${data}%`)
      .select('data_hora')
      .count({ n: '*' })
      .groupBy('data_hora');
    const usados = Object.fromEntries(ocupados.map(o => [o.data_hora, Number(o.n)]));

    const agora = new Date();
    const lista = slots.map(hora => {
      const data_hora = `${data}T${hora}`;
      const vagas = Math.max(0, ponto.capacidade_slot - (usados[data_hora] || 0));
      const futuro = new Date(data_hora + '-03:00') > agora;
      return { hora, data_hora, vagas, disponivel: vagas > 0 && futuro };
    });

    res.json({
      ponto_id: pid,
      ponto_nome: ponto.nome,
      horario_funcionamento: ponto.horario_funcionamento,
      data,
      funciona: slots.length > 0,
      capacidade_slot: ponto.capacidade_slot,
      intervalo_minutos: ponto.intervalo_minutos,
      slots: lista,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao consultar disponibilidade.' });
  }
});

// ───────── POST / (público) — cria agendamento ─────────
router.post('/', async (req, res) => {
  try {
    const { usuario_id, ponto_id, residuo_id, data_hora, quantidade_estimada, observacoes } = req.body || {};
    const uid = inteiro(usuario_id);
    const pid = inteiro(ponto_id);
    const rid = inteiro(residuo_id);

    if (!uid || !pid || !rid || !data_hora)
      return res.status(400).json({ erro: 'Usuário, ponto de coleta, tipo de resíduo e data/hora são obrigatórios.' });

    if (!dataHoraValida(data_hora))
      return res.status(400).json({ erro: 'Data/hora inválida. Use o formato AAAA-MM-DDTHH:mm.' });

    if (new Date(data_hora + '-03:00') <= new Date())
      return res.status(400).json({ erro: 'Não é possível agendar em uma data/hora passada.' });

    const usuario = await db('usuarios').where({ id: uid }).first();
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const ponto = await db('pontos_coleta').where({ id: pid, ativo: true }).first();
    if (!ponto) return res.status(404).json({ erro: 'Ponto de coleta não encontrado ou inativo.' });

    const residuo = await db('tipos_residuo').where({ id: rid }).first();
    if (!residuo) return res.status(404).json({ erro: 'Tipo de resíduo não encontrado.' });

    const aceita = await db('ponto_residuo').where({ ponto_id: pid, residuo_id: rid }).first();
    if (!aceita)
      return res.status(400).json({ erro: `O ponto "${ponto.nome}" não aceita o resíduo "${residuo.nome}".` });

    const qtd = String(quantidade_estimada || '').trim();
    if (usuario.tipo === 'pj' && !qtd)
      return res.status(400).json({ erro: 'Empresas devem informar a quantidade estimada.' });
    if (qtd.length > 60)
      return res.status(400).json({ erro: 'A quantidade estimada pode ter no máximo 60 caracteres.' });

    const data = data_hora.slice(0, 10);
    const hora = data_hora.slice(11, 16);
    if (!gerarSlots(ponto, data).includes(hora))
      return res.status(400).json({
        erro: 'Horário fora do funcionamento do ponto.',
        detalhe: `${ponto.nome} funciona: ${ponto.horario_funcionamento || 'consulte o ponto'}.`
      });

    const duplicado = await db('agendamentos')
      .where({ usuario_id: uid, ponto_id: pid, data_hora })
      .whereNot('status', 'cancelado')
      .first();
    if (duplicado)
      return res.status(409).json({ erro: 'Você já possui um agendamento neste ponto e horário.' });

    // Capacidade do horário (checagem simples; em tráfego muito alto duas requisições
    // simultâneas poderiam exceder o limite em 1 — aceitável para o escopo do projeto)
    const [{ n }] = await db('agendamentos')
      .where({ ponto_id: pid, data_hora })
      .whereNot('status', 'cancelado')
      .count({ n: '*' });
    if (Number(n) >= ponto.capacidade_slot)
      return res.status(409).json({
        erro: 'Horário lotado.',
        detalhe: `Este horário atingiu o limite de ${ponto.capacidade_slot} entrega(s). Escolha outro horário.`
      });

    const [{ id }] = await db('agendamentos')
      .insert({
        usuario_id: uid, ponto_id: pid, residuo_id: rid, data_hora,
        quantidade_estimada: qtd || null,
        observacoes: String(observacoes || '').trim().slice(0, 500) || null,
      })
      .returning('id');

    const novo = await selectAgendamento(db('agendamentos as a')).where('a.id', id).first();

    // Só notifica se o agendamento for com mais de 20 min de antecedência
    const diffMin = (new Date(novo.data_hora + '-03:00') - new Date()) / 60000;
    if (diffMin > 20) {
      notificarOperador(novo)
        .then(ok => ok && db('agendamentos').where({ id }).update({ confirmacao_enviada: true }))
        .catch(() => {});
    }

    res.status(201).json(visaoPublica(novo));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar agendamento.' });
  }
});

// ───────── Rotas do operador ─────────

// GET /api/agendamentos?data=&ponto_id=&residuo_id=&status=
router.get('/', requireOperador, async (req, res) => {
  try {
    let query = selectAgendamento(db('agendamentos as a'));

    if (req.query.data) {
      if (!dataValida(req.query.data))
        return res.status(400).json({ erro: 'Data inválida. Use o formato AAAA-MM-DD.' });
      query = query.where('a.data_hora', 'like', `${req.query.data}%`);
    }
    for (const [param, coluna] of [['ponto_id', 'a.ponto_id'], ['residuo_id', 'a.residuo_id']]) {
      if (req.query[param] !== undefined && req.query[param] !== '') {
        const v = inteiro(req.query[param]);
        if (v === null) return res.status(400).json({ erro: `Filtro "${param}" inválido.` });
        query = query.where(coluna, v);
      }
    }
    if (req.query.status) {
      if (!STATUS_VALIDOS.includes(req.query.status))
        return res.status(400).json({ erro: 'Status inválido.' });
      query = query.where('a.status', req.query.status);
    }

    res.json(await query.orderBy('a.data_hora'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar agendamentos.' });
  }
});

router.get('/:id', requireOperador, async (req, res) => {
  try {
    const id = inteiro(req.params.id);
    if (id === null) return res.status(400).json({ erro: 'Agendamento inválido.' });
    const ag = await selectAgendamento(db('agendamentos as a')).where('a.id', id).first();
    if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    res.json(ag);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar agendamento.' });
  }
});

// PATCH /api/agendamentos/:id/status — { status: 'confirmado' | 'concluido' | 'cancelado' }
router.patch('/:id/status', requireOperador, async (req, res) => {
  try {
    const id = inteiro(req.params.id);
    if (id === null) return res.status(400).json({ erro: 'Agendamento inválido.' });
    const { status } = req.body || {};
    if (!STATUS_VALIDOS.includes(status))
      return res.status(400).json({ erro: `Status inválido. Use: ${STATUS_VALIDOS.join(', ')}.` });

    const existe = await db('agendamentos').where({ id }).first();
    if (!existe) return res.status(404).json({ erro: 'Agendamento não encontrado.' });

    await db('agendamentos').where({ id }).update({ status });
    res.json(await selectAgendamento(db('agendamentos as a')).where('a.id', id).first());
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar status.' });
  }
});

// DELETE /api/agendamentos/:id — remove definitivamente (prefira cancelar pelo status)
router.delete('/:id', requireOperador, async (req, res) => {
  try {
    const id = inteiro(req.params.id);
    if (id === null) return res.status(400).json({ erro: 'Agendamento inválido.' });
    const existe = await db('agendamentos').where({ id }).first();
    if (!existe) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
    await db('agendamentos').where({ id }).delete();
    res.json({ mensagem: 'Agendamento removido com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao remover agendamento.' });
  }
});

module.exports = router;
