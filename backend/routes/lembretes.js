const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { enviarWhatsApp } = require('../utils/callmebot');
const { agoraBRT } = require('../utils/validacao');

// Janelas de lembrete (minutos antes do horário agendado)
const JANELAS = [
  { tipo: '60min', flag: 'lembrete_60_enviado', min: 55, max: 65, titulo: '⏰ Daqui 1h!' },
  { tipo: '15min', flag: 'lembrete_15_enviado', min: 10, max: 20, titulo: '🔔 Daqui 15min!' },
];

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// Link wa.me para o OPERADOR avisar o cidadão com um clique
function linkCidadao(telefone, nome, residuo, ponto, data, hora) {
  const tel  = String(telefone).replace(/\D/g, '');
  const fone = tel.startsWith('55') ? tel : '55' + tel;
  const msg  = `Olá ${nome}! Lembrete da sua entrega de *${residuo}* no *${ponto}* em *${data} às ${hora}*. Obrigado por descartar corretamente! ♻️`;
  return `https://wa.me/${fone}?text=${encodeURIComponent(msg)}`;
}

async function encurtarUrl(url) {
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    if (res.ok) return await res.text();
  } catch (err) {
    console.error('TinyURL erro:', err.message);
  }
  return null;
}

// GET /api/lembretes/processar — chamado pelo cron-job.org a cada 5 min
router.get('/processar', async (req, res) => {
  try {
    const agora = new Date();

    // Só agendamentos de agora em diante (evita varrer o histórico inteiro)
    const agendamentos = await db('agendamentos as a')
      .join('usuarios as u', 'a.usuario_id', 'u.id')
      .join('pontos_coleta as p', 'a.ponto_id', 'p.id')
      .join('tipos_residuo as r', 'a.residuo_id', 'r.id')
      .select(
        'a.id', 'a.data_hora', 'a.quantidade_estimada',
        'a.lembrete_60_enviado', 'a.lembrete_15_enviado',
        'u.tipo as usuario_tipo', 'u.nome as usuario_nome', 'u.telefone as usuario_telefone',
        'p.nome as ponto_nome', 'r.nome as residuo_nome'
      )
      .whereNotIn('a.status', ['cancelado', 'concluido'])
      .where('a.data_hora', '>=', agoraBRT());

    const enviados = [];
    const falhas = [];

    for (const ag of agendamentos) {
      const diffMin = (new Date(ag.data_hora + '-03:00') - agora) / 60000;
      const data = ag.data_hora.slice(0, 10).split('-').reverse().join('/');
      const hora = ag.data_hora.slice(11, 16);

      for (const j of JANELAS) {
        if (ag[j.flag] || diffMin < j.min || diffMin > j.max) continue;

        const qtd = ag.quantidade_estimada ? ` (${ag.quantidade_estimada})` : '';
        const empresa = ag.usuario_tipo === 'pj' ? ' [empresa]' : '';
        const msg = `${j.titulo}\n👤 ${ag.usuario_nome}${empresa}\n🗑️ ${ag.residuo_nome}${qtd}\n📍 ${ag.ponto_nome}\n📅 ${data} às ${hora}\n📞 ${ag.usuario_telefone}`;

        const ok = await enviarWhatsApp(msg);
        if (!ok) {
          // Não marca como enviado: o próximo ciclo do cron tenta de novo dentro da janela
          falhas.push({ id: ag.id, tipo: j.tipo });
          continue;
        }

        // Link wa.me NUNCA vai no texto da 1ª mensagem (gera 403): vai encurtado, em 2ª chamada
        const link = linkCidadao(ag.usuario_telefone, ag.usuario_nome, ag.residuo_nome, ag.ponto_nome, data, hora);
        const linkCurto = await encurtarUrl(link);
        if (linkCurto) {
          await esperar(1500); // espaça as duas chamadas ao CallMeBot
          await enviarWhatsApp(`👆 Avisar cidadão:\n${linkCurto}`);
        }

        await db('agendamentos').where({ id: ag.id }).update({ [j.flag]: true });
        enviados.push({ id: ag.id, tipo: j.tipo });
      }
    }

    res.json({ ok: true, processados: agendamentos.length, enviados, falhas });
  } catch (err) {
    console.error('Erro ao processar lembretes:', err);
    res.status(500).json({ erro: 'Erro ao processar lembretes.' });
  }
});

module.exports = router;
