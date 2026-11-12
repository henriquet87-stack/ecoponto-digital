// Envia mensagem de WhatsApp ao OPERADOR via CallMeBot.
// Retorna true se o CallMeBot respondeu com sucesso (HTTP 2xx), false caso contrário.
//
// ⚠️ Nunca coloque URL wa.me dentro do texto (gera 403). Envie o link encurtado
//    (TinyURL) em uma SEGUNDA chamada a esta função.
// ⚠️ Serviço hobby, sem SLA: não faça rajadas de envio.
async function enviarWhatsApp(mensagem) {
  const telefone = process.env.OPERADOR_TELEFONE;   // formato 55DDDNÚMERO
  const apikey   = process.env.CALLMEBOT_APIKEY;
  if (!telefone || !apikey) return false;

  const url = `https://api.callmebot.com/whatsapp.php?phone=${telefone}&text=${encodeURIComponent(mensagem)}&apikey=${apikey}`;

  try {
    const res = await fetch(url);
    const texto = await res.text();
    console.log(`📲 CallMeBot: ${res.status} — ${texto.slice(0, 200)}`);
    return res.ok;
  } catch (err) {
    console.error('📲 CallMeBot erro:', err.message);
    return false;
  }
}

module.exports = { enviarWhatsApp };
