// Configuração do ambiente de teste (roda antes de cada arquivo de teste).
// Garante que os testes NUNCA usem o banco de produção nem enviem WhatsApp.
const os = require('os');
const path = require('path');

process.env.DATABASE_URL = '';                 // força SQLite (o dotenv não sobrescreve variável já definida)
process.env.DB_FILE = path.join(os.tmpdir(), `ecoponto-teste-${process.pid}.db`);
process.env.APP_USER = 'operador_teste';
process.env.APP_PASSWORD = 'senha_teste_123';
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.OPERADOR_TELEFONE = '';            // sem telefone/apikey → CallMeBot não é chamado
process.env.CALLMEBOT_APIKEY = '';
