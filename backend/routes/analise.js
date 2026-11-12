const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { requireOperador } = require('../middleware/auth');
const { dataValida, hojeBRT } = require('../utils/validacao');

router.use(requireOperador);

function contar(lista, chave) {
  const mapa = {};
  for (const item of lista) {
    const k = chave(item);
    mapa[k] = (mapa[k] || 0) + 1;
  }
  return mapa;
}

const paraLista = (mapa) => Object.entries(mapa).map(([rotulo, total]) => ({ rotulo, total }));
const porTotalDesc = (a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo, 'pt-BR');
const porRotuloAsc = (a, b) => a.rotulo.localeCompare(b.rotulo);

/**
 * GET /api/analise?inicio=AAAA-MM-DD&fim=AAAA-MM-DD&agrupar=dia|mes
 *
 * Devolve tudo que o painel precisa em uma chamada:
 *  - resumo:      totais e indicadores
 *  - por_residuo: agendamentos por tipo de resíduo
 *  - por_bairro:  agendamentos por bairro do ponto de coleta
 *  - por_ponto:   agendamentos por ponto
 *  - por_periodo: agendamentos por dia (ou mês)
 * Os gráficos desconsideram agendamentos cancelados.
 */
router.get('/', async (req, res) => {
  try {
    const { inicio, fim } = req.query;
    const agrupar = req.query.agrupar === 'mes' ? 'mes' : 'dia';

    if (inicio && !dataValida(inicio)) return res.status(400).json({ erro: 'Data inicial inválida. Use AAAA-MM-DD.' });
    if (fim && !dataValida(fim))       return res.status(400).json({ erro: 'Data final inválida. Use AAAA-MM-DD.' });
    if (inicio && fim && inicio > fim) return res.status(400).json({ erro: 'A data inicial não pode ser maior que a final.' });

    let query = db('agendamentos as a')
      .join('usuarios as u', 'a.usuario_id', 'u.id')
      .join('pontos_coleta as p', 'a.ponto_id', 'p.id')
      .join('tipos_residuo as r', 'a.residuo_id', 'r.id')
      .select(
        'a.data_hora', 'a.status',
        'u.tipo as usuario_tipo',
        'p.nome as ponto_nome', 'p.bairro as bairro',
        'r.nome as residuo_nome'
      );
    if (inicio) query = query.where('a.data_hora', '>=', `${inicio}T00:00`);
    if (fim)    query = query.where('a.data_hora', '<=', `${fim}T23:59`);

    const todos  = await query;
    const ativos = todos.filter(a => a.status !== 'cancelado');
    const hoje   = hojeBRT();
    const tamanhoPeriodo = agrupar === 'mes' ? 7 : 10;

    res.json({
      filtro: { inicio: inicio || null, fim: fim || null, agrupar },
      resumo: {
        total:       todos.length,
        confirmados: todos.filter(a => a.status === 'confirmado').length,
        concluidos:  todos.filter(a => a.status === 'concluido').length,
        cancelados:  todos.filter(a => a.status === 'cancelado').length,
        hoje:        ativos.filter(a => a.data_hora.startsWith(hoje)).length,
        pessoa_fisica:   ativos.filter(a => a.usuario_tipo === 'pf').length,
        pessoa_juridica: ativos.filter(a => a.usuario_tipo === 'pj').length,
      },
      por_residuo: paraLista(contar(ativos, a => a.residuo_nome)).sort(porTotalDesc),
      por_bairro:  paraLista(contar(ativos, a => a.bairro)).sort(porTotalDesc),
      por_ponto:   paraLista(contar(ativos, a => a.ponto_nome)).sort(porTotalDesc),
      por_periodo: paraLista(contar(ativos, a => a.data_hora.slice(0, tamanhoPeriodo))).sort(porRotuloAsc),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao gerar análise de dados.' });
  }
});

module.exports = router;
