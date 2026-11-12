require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./database');

const usuariosRouter     = require('./routes/usuarios');
const pontosRouter       = require('./routes/pontos');
const residuosRouter     = require('./routes/residuos');
const agendamentosRouter = require('./routes/agendamentos');
const authRouter         = require('./routes/auth');
const lembretesRouter    = require('./routes/lembretes');
const analiseRouter      = require('./routes/analise');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Keep-alive ping (precisa vir ANTES do catch-all)
app.get('/ping', (req, res) => res.send('ok'));

app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api/usuarios',      usuariosRouter);
app.use('/api/pontos',        pontosRouter);
app.use('/api/residuos',      residuosRouter);
app.use('/api/agendamentos',  agendamentosRouter);
app.use('/api/auth',          authRouter);
app.use('/api/lembretes',     lembretesRouter);
app.use('/api/analise',       analiseRouter);

// Rota de API inexistente -> 404 em JSON (não devolve o index.html)
app.use('/api', (req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Handler de erros (sempre por último)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n✅ EcoPonto Digital rodando em http://localhost:${PORT}`);
      console.log(`📋 API disponível em http://localhost:${PORT}/api\n`);
    });
  })
  .catch(err => {
    console.error('❌ Erro ao inicializar banco de dados:', err);
    process.exit(1);
  });
