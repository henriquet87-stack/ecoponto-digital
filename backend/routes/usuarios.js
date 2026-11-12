const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { requireOperador } = require('../middleware/auth');
const {
  soDigitos, validarCPF, validarCNPJ, normalizarTelefone, emailValido,
} = require('../utils/validacao');

const CAMPOS_PUBLICOS = ['id', 'tipo', 'nome', 'cpf_cnpj', 'responsavel', 'telefone', 'email', 'criado_em'];

// Localiza o usuário por documento + telefone (os dois precisam bater).
// Não é autenticação forte: é uma identificação leve para o cidadão não precisar de senha.
async function localizarUsuario(body) {
  const doc = soDigitos(body.cpf_cnpj);
  const tel = normalizarTelefone(body.telefone);
  if (!doc || !tel) return null;
  const usuario = await db('usuarios').select(CAMPOS_PUBLICOS).where({ cpf_cnpj: doc }).first();
  if (!usuario || normalizarTelefone(usuario.telefone) !== tel) return null;
  return usuario;
}

// POST /api/usuarios — cadastro PF ou PJ
router.post('/', async (req, res) => {
  try {
    const { tipo, nome, cpf_cnpj, responsavel, telefone, email } = req.body || {};

    if (!['pf', 'pj'].includes(tipo))
      return res.status(400).json({ erro: 'Informe o tipo de cadastro: pessoa física ou pessoa jurídica.' });

    const nomeLimpo = String(nome || '').trim();
    if (nomeLimpo.length < 3 || nomeLimpo.length > 120)
      return res.status(400).json({
        erro: tipo === 'pj'
          ? 'Informe a razão social (mínimo 3 caracteres).'
          : 'Informe o nome completo (mínimo 3 caracteres).'
      });

    const doc = soDigitos(cpf_cnpj);
    if (tipo === 'pf' && !validarCPF(doc))
      return res.status(400).json({ erro: 'CPF inválido. Confira os 11 dígitos.' });
    if (tipo === 'pj' && !validarCNPJ(doc))
      return res.status(400).json({ erro: 'CNPJ inválido. Confira os 14 dígitos.' });

    let resp = null;
    if (tipo === 'pj') {
      resp = String(responsavel || '').trim();
      if (resp.length < 3)
        return res.status(400).json({ erro: 'Informe o nome do responsável pela empresa.' });
    }

    const tel = normalizarTelefone(telefone);
    if (!tel)
      return res.status(400).json({ erro: 'Telefone inválido. Informe DDD + número, por exemplo (17) 99999-9999.' });

    const mail = String(email || '').trim();
    if (mail && !emailValido(mail))
      return res.status(400).json({ erro: 'E-mail inválido. Confira o formato (exemplo: nome@dominio.com).' });

    const existente = await db('usuarios').where({ cpf_cnpj: doc }).first();
    if (existente)
      return res.status(409).json({
        erro: 'Este documento já possui cadastro.',
        detalhe: 'Use a opção "Já tenho cadastro" informando documento e telefone.'
      });

    const [{ id }] = await db('usuarios')
      .insert({ tipo, nome: nomeLimpo, cpf_cnpj: doc, responsavel: resp, telefone: tel, email: mail || null })
      .returning('id');

    const novo = await db('usuarios').select(CAMPOS_PUBLICOS).where({ id }).first();
    res.status(201).json(novo);
  } catch (err) {
    if (err.code === '23505' || /UNIQUE/i.test(err.message || ''))
      return res.status(409).json({ erro: 'Este documento já possui cadastro.' });
    console.error(err);
    res.status(500).json({ erro: 'Erro ao cadastrar usuário.' });
  }
});

// POST /api/usuarios/identificar — { cpf_cnpj, telefone }
router.post('/identificar', async (req, res) => {
  try {
    const usuario = await localizarUsuario(req.body || {});
    if (!usuario)
      return res.status(404).json({ erro: 'Não encontramos um cadastro com esses dados. Confira documento e telefone.' });
    res.json(usuario);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao identificar usuário.' });
  }
});

// POST /api/usuarios/historico — { cpf_cnpj, telefone }
// Devolve os dados para o comprovante (o PDF é gerado no frontend).
router.post('/historico', async (req, res) => {
  try {
    const usuario = await localizarUsuario(req.body || {});
    if (!usuario)
      return res.status(404).json({ erro: 'Não encontramos um cadastro com esses dados. Confira documento e telefone.' });

    const agendamentos = await db('agendamentos as a')
      .join('pontos_coleta as p', 'a.ponto_id', 'p.id')
      .join('tipos_residuo as r', 'a.residuo_id', 'r.id')
      .where('a.usuario_id', usuario.id)
      .select(
        'a.id', 'a.data_hora', 'a.status', 'a.quantidade_estimada',
        'p.nome as ponto_nome', 'p.endereco as ponto_endereco', 'p.bairro as ponto_bairro',
        'r.nome as residuo_nome'
      )
      .orderBy('a.data_hora', 'desc');

    const resumo = {
      total:      agendamentos.length,
      confirmado: agendamentos.filter(a => a.status === 'confirmado').length,
      concluido:  agendamentos.filter(a => a.status === 'concluido').length,
      cancelado:  agendamentos.filter(a => a.status === 'cancelado').length,
    };

    res.json({ usuario, resumo, agendamentos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao buscar histórico.' });
  }
});

// GET /api/usuarios?q= — operador
router.get('/', requireOperador, async (req, res) => {
  try {
    let query = db('usuarios').select(CAMPOS_PUBLICOS).orderBy('nome').limit(200);
    const q = String(req.query.q || '').trim();
    if (q) {
      const like = `%${q.toLowerCase()}%`;
      const digitos = soDigitos(q);
      query = query.where(b => {
        b.whereRaw('LOWER(nome) LIKE ?', [like]);
        if (digitos) b.orWhere('cpf_cnpj', 'like', `%${digitos}%`);
      });
    }
    res.json(await query);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao listar usuários.' });
  }
});

module.exports = router;
