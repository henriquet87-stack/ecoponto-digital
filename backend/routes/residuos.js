const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { requireOperador } = require('../middleware/auth');
const { inteiro } = require('../utils/validacao');

function validarResiduo(body, base) {
  const v = c => (body[c] !== undefined ? body[c] : base[c]);

  const nome = String(v('nome') || '').trim();
  const descricao = String(v('descricao') || '').trim();
  const instrucoes = String(v('instrucoes_descarte') || '').trim();
  const icone = String(v('icone') || '').trim();

  if (nome.length < 3 || nome.length > 60)
    return { erro: 'Informe o nome do resíduo (de 3 a 60 caracteres).' };
  if (descricao.length > 200)
    return { erro: 'A descrição pode ter no máximo 200 caracteres.' };
  if (instrucoes.length > 500)
    return { erro: 'As instruções de descarte podem ter no máximo 500 caracteres.' };
  if (icone.length > 8)
    return { erro: 'O ícone deve ser um emoji ou texto curto.' };

  return {
    dados: {
      nome,
      descricao: descricao || null,
      instrucoes_descarte: instrucoes || null,
      icone: icone || null,
    }
  };
}

async function nomeEmUso(nome, ignorarId = null) {
  let q = db('tipos_residuo').whereRaw('LOWER(nome) = ?', [nome.toLowerCase()]);
  if (ignorarId) q = q.whereNot('id', ignorarId);
  return !!(await q.first());
}

// GET /api/residuos — público. ?disponiveis=1 → só resíduos aceitos por algum ponto ativo
router.get('/', async (req, res) => {
  try {
    let query = db('tipos_residuo as r').select('r.*').orderBy('r.nome');
    if (req.query.disponiveis === '1') {
      query = query.whereIn('r.id',
        db('ponto_residuo as pr')
          .join('pontos_coleta as p', 'pr.ponto_id', 'p.id')
          .where('p.ativo', true)
          .select('pr.residuo_id')
      );
    }
    res.json(await query);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar tipos de resíduo.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = inteiro(req.params.id);
    if (id === null) return res.status(400).json({ erro: 'Resíduo inválido.' });
    const residuo = await db('tipos_residuo').where({ id }).first();
    if (!residuo) return res.status(404).json({ erro: 'Tipo de resíduo não encontrado.' });
    res.json(residuo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar tipo de resíduo.' });
  }
});

// POST /api/residuos — operador
router.post('/', requireOperador, async (req, res) => {
  try {
    const v = validarResiduo(req.body || {}, {});
    if (v.erro) return res.status(400).json({ erro: v.erro });
    if (await nomeEmUso(v.dados.nome))
      return res.status(409).json({ erro: 'Já existe um tipo de resíduo com esse nome.' });

    const [{ id }] = await db('tipos_residuo').insert(v.dados).returning('id');
    res.status(201).json(await db('tipos_residuo').where({ id }).first());
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar tipo de resíduo.' });
  }
});

// PUT /api/residuos/:id — operador
router.put('/:id', requireOperador, async (req, res) => {
  try {
    const id = inteiro(req.params.id);
    if (id === null) return res.status(400).json({ erro: 'Resíduo inválido.' });
    const existente = await db('tipos_residuo').where({ id }).first();
    if (!existente) return res.status(404).json({ erro: 'Tipo de resíduo não encontrado.' });

    const v = validarResiduo(req.body || {}, existente);
    if (v.erro) return res.status(400).json({ erro: v.erro });
    if (await nomeEmUso(v.dados.nome, id))
      return res.status(409).json({ erro: 'Já existe um tipo de resíduo com esse nome.' });

    await db('tipos_residuo').where({ id }).update(v.dados);
    res.json(await db('tipos_residuo').where({ id }).first());
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao atualizar tipo de resíduo.' });
  }
});

// DELETE /api/residuos/:id — operador (bloqueado se houver agendamentos vinculados)
router.delete('/:id', requireOperador, async (req, res) => {
  try {
    const id = inteiro(req.params.id);
    if (id === null) return res.status(400).json({ erro: 'Resíduo inválido.' });
    const existente = await db('tipos_residuo').where({ id }).first();
    if (!existente) return res.status(404).json({ erro: 'Tipo de resíduo não encontrado.' });

    const [{ n }] = await db('agendamentos').where({ residuo_id: id }).count({ n: '*' });
    if (Number(n) > 0)
      return res.status(409).json({
        erro: 'Não é possível remover este resíduo.',
        detalhe: `Existem ${Number(n)} agendamento(s) vinculados a ele. Para parar de oferecê-lo, retire-o dos pontos que o aceitam.`
      });

    await db('tipos_residuo').where({ id }).delete();
    res.json({ mensagem: 'Tipo de resíduo removido com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao remover tipo de resíduo.' });
  }
});

module.exports = router;
