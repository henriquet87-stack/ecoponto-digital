'use strict';
/* =====================================================
   app.js — EcoPonto Digital
   Carregado por último (depende de api.js e auth.js).
   Seções: helpers · roteador · cidadão · operador · eventos
===================================================== */

/* ───────────── helpers ───────────── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Escapa texto vindo do servidor/usuário antes de usar em innerHTML
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const hojeBRT   = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

function fmtDataHora(dh) {
  const [d, h] = String(dh).split('T');
  const [a, m, dia] = d.split('-');
  return `${dia}/${m}/${a} às ${h}`;
}
function fmtDoc(v) {
  const d = soDigitos(v);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v || '';
}
function fmtTel(v) {
  const d = soDigitos(v);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return v || '';
}
function fmtCep(v) {
  const d = soDigitos(v);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (v || '');
}

const STATUS_ROTULO = { confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado' };
const badge = (s) => `<span class="badge badge-${esc(s)}">${esc(STATUS_ROTULO[s] || s)}</span>`;
const tipoRotulo = (t) => (t === 'pj' ? 'Empresa' : 'Pessoa física');

let _avisoTimer;
function avisar(msg, tipo = 'ok') {
  const el = $('#aviso');
  el.textContent = msg;
  el.classList.toggle('erro', tipo === 'erro');
  clearTimeout(_avisoTimer);
  _avisoTimer = setTimeout(() => { el.textContent = ''; }, 6000);
}
function mostrarErro(id, msg) {
  const el = $('#' + id);
  el.textContent = msg;
  el.hidden = false;
}
function limparErro(id) {
  const el = $('#' + id);
  el.textContent = '';
  el.hidden = true;
}
function ocupado(btn, sim, textoOcupado = 'Aguarde…') {
  if (sim) { btn.dataset.rotulo = btn.textContent; btn.textContent = textoOcupado; }
  else if (btn.dataset.rotulo) { btn.textContent = btn.dataset.rotulo; }
  btn.disabled = sim;
}
const abrirDialogo  = (id) => { const d = $('#' + id); if (!d.open) d.showModal(); };
const fecharDialogo = (id) => { const d = $('#' + id); if (d.open) d.close(); };

/* ───────────── roteador por hash ───────────── */
const ROTAS = {
  'inicio':          { titulo: 'Início',               init: initInicio },
  'identificar':     { titulo: 'Identificação',        init: initIdentificar },
  'agendar':         { titulo: 'Agendar entrega',      init: initAgendar,     cidadao: true },
  'confirmacao':     { titulo: 'Agendamento confirmado', init: initConfirmacao, cidadao: true },
  'historico':       { titulo: 'Meu histórico',        init: initHistorico,   cidadao: true },
  'operador':        { titulo: 'Área do operador',     init: initLoginOperador },
  'op-agendamentos': { titulo: 'Agendamentos',         init: initOpAgendamentos, operador: true },
  'op-pontos':       { titulo: 'Pontos de coleta',     init: initOpPontos,    operador: true },
  'op-residuos':     { titulo: 'Tipos de resíduo',     init: initOpResiduos,  operador: true },
  'op-analise':      { titulo: 'Análise de dados',     init: initOpAnalise,   operador: true },
};

function irPara(nome) {
  if (location.hash === '#' + nome) rotear();
  else location.hash = '#' + nome;
}

async function rotear() {
  let nome = location.hash.replace(/^#/, '') || 'inicio';
  if (!ROTAS[nome]) nome = 'inicio';
  const rota = ROTAS[nome];

  if (rota.operador && !Auth.logado()) {
    avisar('Faça login para acessar a área do operador.', 'erro');
    return irPara('operador');
  }
  if (rota.cidadao && !Sessao.usuario()) {
    Sessao.setDestino(nome === 'confirmacao' ? 'agendar' : nome);
    return irPara('identificar');
  }
  if (nome === 'operador' && Auth.logado()) return irPara('op-agendamentos');

  $$('.view').forEach(s => { s.hidden = s.id !== 'view-' + nome; });
  document.title = `${rota.titulo} — EcoPonto Digital`;
  atualizarNav(nome);
  $('#menus').classList.remove('aberto');
  $('#btn-menu').setAttribute('aria-expanded', 'false');

  try { await rota.init(); }
  catch (err) { avisar(err.message, 'erro'); }

  const h1 = $(`#view-${nome} h1`);
  if (h1) { window.scrollTo(0, 0); h1.focus(); }   // leitores de tela anunciam a nova página
}

function atualizarNav(nome) {
  $('#nav-operador').hidden = !Auth.logado();
  $$('.menus a[data-nav]').forEach(a => {
    if (a.dataset.nav === nome) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  // "Área do operador" some do menu público enquanto o operador está logado
  const link = $('#nav-publico a[data-nav="operador"]');
  if (link) link.hidden = Auth.logado();
}

/* ═════════════════════ CIDADÃO ═════════════════════ */

/* ── Início ── */
async function initInicio() {
  const ul = $('#lista-residuos-home');
  try {
    const rs = await api.getResiduos({ disponiveis: 1 });
    ul.innerHTML = rs.length
      ? rs.map(r => `<li><span class="icone" aria-hidden="true">${esc(r.icone || '♻')}</span>
          <strong>${esc(r.nome)}</strong><small>${esc(r.descricao || '')}</small></li>`).join('')
      : '<li>Nenhum resíduo disponível no momento.</li>';
  } catch (err) {
    ul.innerHTML = `<li>${esc(err.message)}</li>`;
  }
}

/* ── Identificação / cadastro ── */
function initIdentificar() {
  definirModo('entrar');
  limparErro('ent-erro');
  limparErro('cad-erro');
}

function definirModo(modo) {
  const entrar = modo === 'entrar';
  $('#form-entrar').hidden = !entrar;
  $('#form-cadastro').hidden = entrar;
  $('#modo-entrar').setAttribute('aria-pressed', String(entrar));
  $('#modo-cadastro').setAttribute('aria-pressed', String(!entrar));
}

function ajustarTipoCadastro() {
  const pj = $('input[name="cad-tipo"]:checked').value === 'pj';
  $('#cad-nome-rotulo').textContent = pj ? 'Razão social' : 'Nome completo';
  $('#cad-doc-rotulo').textContent  = pj ? 'CNPJ' : 'CPF';
  $('#cad-resp-grupo').hidden = !pj;
  $('#cad-resp').required = pj;
}

function seguirAposIdentificar() {
  const destino = Sessao.destino();
  Sessao.setDestino('agendar');
  irPara(destino);
}

async function submeterEntrar(e) {
  e.preventDefault();
  limparErro('ent-erro');
  const btn = $('#ent-enviar');
  ocupado(btn, true, 'Verificando…');
  try {
    const u = await api.identificar({
      cpf_cnpj: soDigitos($('#ent-doc').value),
      telefone: soDigitos($('#ent-tel').value),
    });
    Sessao.entrar(u);
    avisar(`Olá, ${u.nome}!`);
    seguirAposIdentificar();
  } catch (err) {
    mostrarErro('ent-erro', err.message);
  } finally {
    ocupado(btn, false);
  }
}

async function submeterCadastro(e) {
  e.preventDefault();
  limparErro('cad-erro');
  const btn = $('#cad-enviar');
  const tipo = $('input[name="cad-tipo"]:checked').value;
  ocupado(btn, true, 'Cadastrando…');
  try {
    const u = await api.criarUsuario({
      tipo,
      nome: $('#cad-nome').value.trim(),
      cpf_cnpj: soDigitos($('#cad-doc').value),
      responsavel: tipo === 'pj' ? $('#cad-resp').value.trim() : undefined,
      telefone: soDigitos($('#cad-tel').value),
      email: $('#cad-email').value.trim() || undefined,
    });
    Sessao.entrar(u);
    avisar('Cadastro realizado com sucesso.');
    seguirAposIdentificar();
  } catch (err) {
    mostrarErro('cad-erro', err.message);
  } finally {
    ocupado(btn, false);
  }
}

/* ── Agendar ── */
let _residuos = [];
let _pontosAg = [];

async function initAgendar() {
  const u = Sessao.usuario();
  $('#ag-usuario-nome').textContent = `${u.nome} (${tipoRotulo(u.tipo).toLowerCase()})`;
  $('#ag-qtd-obrig').textContent = u.tipo === 'pj' ? '(obrigatório para empresas)' : '(opcional)';
  $('#ag-qtd').required = u.tipo === 'pj';

  $('#form-agendar').reset();
  limparErro('ag-erro');
  $('#ag-instrucoes').textContent = '';
  $('#ag-ponto-info').textContent = '';
  $('#ag-ponto').innerHTML = '<option value="">Selecione o resíduo primeiro</option>';
  $('#ag-ponto').disabled = true;
  $('#ag-data').disabled = true;
  $('#ag-data').min = hojeBRT();
  $('#ag-slots').innerHTML = '';
  $('#ag-slots-msg').textContent = 'Escolha o ponto e a data para ver os horários.';

  _residuos = await api.getResiduos({ disponiveis: 1 });
  $('#ag-residuo').innerHTML = '<option value="">Selecione…</option>' +
    _residuos.map(r => `<option value="${r.id}">${esc(r.icone || '')} ${esc(r.nome)}</option>`).join('');
}

async function aoMudarResiduo() {
  const rid = $('#ag-residuo').value;
  const sel = $('#ag-ponto');
  $('#ag-slots').innerHTML = '';
  $('#ag-ponto-info').textContent = '';
  $('#ag-data').disabled = true;
  $('#ag-slots-msg').textContent = 'Escolha o ponto e a data para ver os horários.';

  if (!rid) {
    $('#ag-instrucoes').textContent = '';
    sel.innerHTML = '<option value="">Selecione o resíduo primeiro</option>';
    sel.disabled = true;
    return;
  }
  const r = _residuos.find(x => String(x.id) === rid);
  $('#ag-instrucoes').textContent = r && r.instrucoes_descarte ? `Como entregar: ${r.instrucoes_descarte}` : '';

  try {
    _pontosAg = await api.getPontos({ residuo_id: rid });
    sel.innerHTML = '<option value="">Selecione…</option>' +
      _pontosAg.map(p => `<option value="${p.id}">${esc(p.nome)} — ${esc(p.bairro)}</option>`).join('');
    sel.disabled = _pontosAg.length === 0;
    if (!_pontosAg.length) $('#ag-ponto-info').textContent = 'Nenhum ponto aceita este resíduo no momento.';
  } catch (err) {
    mostrarErro('ag-erro', err.message);
  }
}

function aoMudarPonto() {
  const p = _pontosAg.find(x => String(x.id) === $('#ag-ponto').value);
  $('#ag-ponto-info').textContent = p
    ? `${p.endereco}, ${p.bairro}. Funcionamento: ${p.horario_funcionamento}.` : '';
  $('#ag-data').disabled = !p;
  carregarSlots();
}

async function carregarSlots() {
  const pid = $('#ag-ponto').value;
  const data = $('#ag-data').value;
  const box = $('#ag-slots');
  const msg = $('#ag-slots-msg');
  box.innerHTML = '';
  if (!pid || !data) {
    msg.textContent = 'Escolha o ponto e a data para ver os horários.';
    return;
  }
  msg.textContent = 'Carregando horários…';
  limparErro('ag-erro');
  try {
    const d = await api.disponibilidade({ ponto_id: pid, data, residuo_id: $('#ag-residuo').value });
    if (!d.funciona) {
      msg.textContent = `Este ponto não funciona nesta data. Funcionamento: ${d.horario_funcionamento || 'consulte o ponto'}.`;
      return;
    }
    box.innerHTML = d.slots.map(s => `
      <label class="slot">
        <input type="radio" name="slot" value="${esc(s.data_hora)}" ${s.disponivel ? '' : 'disabled'} />
        <span class="slot-box"><strong>${esc(s.hora)}</strong>
          <small>${s.disponivel ? `${s.vagas} ${s.vagas === 1 ? 'vaga' : 'vagas'}` : (s.vagas === 0 ? 'lotado' : 'indisponível')}</small>
        </span>
      </label>`).join('');
    const livres = d.slots.filter(s => s.disponivel).length;
    msg.textContent = livres
      ? `${livres} ${livres === 1 ? 'horário disponível' : 'horários disponíveis'}.`
      : 'Não há horários livres nesta data. Escolha outra data.';
  } catch (err) {
    msg.textContent = '';
    mostrarErro('ag-erro', err.message);
  }
}

async function submeterAgendamento(e) {
  e.preventDefault();
  limparErro('ag-erro');
  const slot = $('input[name="slot"]:checked');
  if (!slot) return mostrarErro('ag-erro', 'Escolha um horário disponível antes de confirmar.');

  const u = Sessao.usuario();
  const btn = $('#ag-enviar');
  ocupado(btn, true, 'Agendando…');
  try {
    const r = await api.criarAgendamento({
      usuario_id: u.id,
      ponto_id: Number($('#ag-ponto').value),
      residuo_id: Number($('#ag-residuo').value),
      data_hora: slot.value,
      quantidade_estimada: $('#ag-qtd').value.trim() || undefined,
      observacoes: $('#ag-obs').value.trim() || undefined,
    });
    Sessao.setUltimo(r);
    irPara('confirmacao');
  } catch (err) {
    mostrarErro('ag-erro', err.message);
    if (/lotado/i.test(err.message)) carregarSlots();
  } finally {
    ocupado(btn, false);
  }
}

/* ── Confirmação ── */
function initConfirmacao() {
  const a = Sessao.ultimo();
  if (!a) return irPara('historico');
  const linhas = [
    ['Código', `#${a.id}`],
    ['Data e horário', fmtDataHora(a.data_hora)],
    ['Ponto de coleta', a.ponto_nome],
    ['Endereço', `${a.ponto_endereco}, ${a.ponto_bairro}`],
    ['Resíduo', a.residuo_nome],
    ['Quantidade estimada', a.quantidade_estimada || 'Não informada'],
  ];
  $('#conf-dados').innerHTML = linhas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  $('#conf-instrucoes').textContent = a.instrucoes_descarte ? `Como entregar: ${a.instrucoes_descarte}` : '';
}

/* ── Histórico ── */
async function initHistorico() {
  const u = Sessao.usuario();
  const corpo = $('#hist-corpo');
  corpo.innerHTML = '<tr><td colspan="5">Carregando…</td></tr>';
  $('#hist-imprimir').hidden = u.tipo !== 'pj';

  const h = await api.historico({ cpf_cnpj: u.cpf_cnpj, telefone: u.telefone });
  const usr = h.usuario;

  $('#hist-usuario').innerHTML = `<strong>${esc(usr.nome)}</strong> · ${usr.tipo === 'pj' ? 'CNPJ' : 'CPF'} ${esc(fmtDoc(usr.cpf_cnpj))}`;
  $('#hist-cabecalho-impressao').innerHTML = `
    <h2>Comprovante de entregas de resíduos especiais</h2>
    <p>${esc(usr.nome)} — ${usr.tipo === 'pj' ? 'CNPJ' : 'CPF'} ${esc(fmtDoc(usr.cpf_cnpj))}
       ${usr.responsavel ? `<br>Responsável: ${esc(usr.responsavel)}` : ''}
       <br>Emitido em ${esc(hojeBRT().split('-').reverse().join('/'))}</p>`;

  const r = h.resumo;
  $('#hist-resumo').innerHTML = [
    ['Total', r.total], ['Confirmados', r.confirmado], ['Concluídos', r.concluido], ['Cancelados', r.cancelado],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  corpo.innerHTML = h.agendamentos.length
    ? h.agendamentos.map(a => `<tr>
        <td data-label="Data e hora">${esc(fmtDataHora(a.data_hora))}</td>
        <td data-label="Resíduo">${esc(a.residuo_nome)}</td>
        <td data-label="Ponto">${esc(a.ponto_nome)}<br><small>${esc(a.ponto_endereco)}, ${esc(a.ponto_bairro)}</small></td>
        <td data-label="Quantidade">${esc(a.quantidade_estimada || '—')}</td>
        <td data-label="Situação">${badge(a.status)}</td></tr>`).join('')
    : '<tr><td colspan="5">Você ainda não tem entregas agendadas. <a href="#agendar">Agendar agora</a>.</td></tr>';
}

/* ═════════════════════ OPERADOR ═════════════════════ */

/* ── Login ── */
function initLoginOperador() { limparErro('op-erro'); }

async function submeterLoginOperador(e) {
  e.preventDefault();
  limparErro('op-erro');
  const btn = $('#op-entrar');
  ocupado(btn, true, 'Verificando…');
  try {
    await Auth.login($('#op-usuario').value.trim(), $('#op-senha').value);
    $('#op-senha').value = '';
    avisar('Login realizado.');
    irPara('op-agendamentos');
  } catch (err) {
    mostrarErro('op-erro', err.message);
  } finally {
    ocupado(btn, false);
  }
}

function sairOperador() {
  Auth.logout();
  avisar('Sessão encerrada.');
  irPara('operador');
}

/* ── Agendamentos ── */
let _filtrosCarregados = false;
let _filtroDataIniciado = false;

async function initOpAgendamentos() {
  if (!_filtroDataIniciado) { $('#f-data').value = hojeBRT(); _filtroDataIniciado = true; }
  if (!_filtrosCarregados) {
    const [pontos, residuos] = await Promise.all([api.getPontos({ incluir_inativos: 1 }, true), api.getResiduos()]);
    $('#f-ponto').innerHTML = '<option value="">Todos</option>' + pontos.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
    $('#f-residuo').innerHTML = '<option value="">Todos</option>' + residuos.map(r => `<option value="${r.id}">${esc(r.nome)}</option>`).join('');
    _filtrosCarregados = true;
  }
  await carregarOpAgendamentos();
}

function linkWhatsApp(a) {
  const tel = soDigitos(a.usuario_telefone);
  const fone = tel.startsWith('55') ? tel : '55' + tel;
  const [data, hora] = fmtDataHora(a.data_hora).split(' às ');
  const msg = `Olá ${a.usuario_nome}! Lembrete da sua entrega de ${a.residuo_nome} no ${a.ponto_nome} em ${data} às ${hora}. Obrigado por descartar corretamente!`;
  return `https://wa.me/${fone}?text=${encodeURIComponent(msg)}`;
}

async function carregarOpAgendamentos() {
  const corpo = $('#op-ag-corpo');
  corpo.innerHTML = '<tr><td colspan="6">Carregando…</td></tr>';
  const lista = await api.getAgendamentos({
    data: $('#f-data').value, ponto_id: $('#f-ponto').value,
    residuo_id: $('#f-residuo').value, status: $('#f-status').value,
  });

  const conta = (s) => lista.filter(a => a.status === s).length;
  $('#op-cards').innerHTML = [
    ['Na lista', lista.length], ['Confirmados', conta('confirmado')],
    ['Concluídos', conta('concluido')], ['Cancelados', conta('cancelado')],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  corpo.innerHTML = lista.length ? lista.map(a => {
    const quem = esc(a.usuario_nome);
    const acoes = a.status === 'confirmado'
      ? `<button type="button" class="btn btn-sm btn-primario" data-acao="concluido" data-id="${a.id}" aria-label="Concluir a entrega de ${quem}">Concluir</button>
         <button type="button" class="btn btn-sm btn-perigo" data-acao="cancelado" data-id="${a.id}" aria-label="Cancelar a entrega de ${quem}">Cancelar</button>
         <a class="btn btn-sm" href="${esc(linkWhatsApp(a))}" target="_blank" rel="noopener noreferrer" aria-label="Avisar ${quem} no WhatsApp (abre em nova aba)">WhatsApp</a>`
      : `<button type="button" class="btn btn-sm" data-acao="confirmado" data-id="${a.id}" aria-label="Reabrir a entrega de ${quem}">Reabrir</button>`;
    return `<tr>
      <td data-label="Data e hora">${esc(fmtDataHora(a.data_hora))}</td>
      <td data-label="Cidadão">${quem}<br><small>${tipoRotulo(a.usuario_tipo)} · <span class="nowrap">${esc(fmtTel(a.usuario_telefone))}</span></small></td>
      <td data-label="Resíduo">${esc(a.residuo_nome)}${a.quantidade_estimada ? `<br><small>${esc(a.quantidade_estimada)}</small>` : ''}</td>
      <td data-label="Ponto">${esc(a.ponto_nome)}</td>
      <td data-label="Situação">${badge(a.status)}</td>
      <td class="celula-acoes"><div class="acoes-linha">${acoes}</div></td></tr>`;
  }).join('') : '<tr><td colspan="6">Nenhum agendamento encontrado para os filtros escolhidos.</td></tr>';
}

async function aoClicarAcaoAgendamento(e) {
  const btn = e.target.closest('button[data-acao]');
  if (!btn) return;
  if (btn.dataset.acao === 'cancelado' && !confirm('Cancelar este agendamento? A vaga volta a ficar disponível.')) return;
  try {
    await api.atualizarStatus(btn.dataset.id, btn.dataset.acao);
    avisar('Situação atualizada.');
    await carregarOpAgendamentos();
  } catch (err) { avisar(err.message, 'erro'); }
}

/* ── Pontos de coleta ── */
let _pontosOp = [];
let _residuosOp = [];

async function initOpPontos() {
  [_pontosOp, _residuosOp] = await Promise.all([api.getPontos({ incluir_inativos: 1 }, true), api.getResiduos()]);
  renderPontosOp();
}

function renderPontosOp() {
  $('#op-pontos-corpo').innerHTML = _pontosOp.length ? _pontosOp.map(p => `<tr>
    <td data-label="Ponto">${esc(p.nome)} ${p.ativo ? '' : '<span class="badge badge-inativo">Inativo</span>'}</td>
    <td data-label="Endereço">${esc(p.endereco)}<br><small>${esc(p.bairro)}${p.cep ? ' · ' + esc(p.cep) : ''}</small></td>
    <td data-label="Funcionamento">${esc(p.horario_funcionamento || '')}<br><small>Horários de ${p.intervalo_minutos} min</small></td>
    <td data-label="Capacidade">${p.capacidade_slot} por horário</td>
    <td data-label="Resíduos">${p.residuos.length ? p.residuos.map(r => esc(r.nome)).join(', ') : '—'}</td>
    <td class="celula-acoes"><div class="acoes-linha">
      <button type="button" class="btn btn-sm" data-acao="editar" data-id="${p.id}" aria-label="Editar ${esc(p.nome)}">Editar</button>
      ${p.ativo
        ? `<button type="button" class="btn btn-sm btn-perigo" data-acao="desativar" data-id="${p.id}" aria-label="Desativar ${esc(p.nome)}">Desativar</button>`
        : `<button type="button" class="btn btn-sm" data-acao="reativar" data-id="${p.id}" aria-label="Reativar ${esc(p.nome)}">Reativar</button>`}
    </div></td></tr>`).join('') : '<tr><td colspan="6">Nenhum ponto cadastrado.</td></tr>';
}

function abrirDialogoPonto(p = null) {
  limparErro('pt-erro');
  $('#form-ponto').reset();
  $('#pt-id').value = p ? p.id : '';
  $('#dlg-ponto-titulo').textContent = p ? 'Editar ponto de coleta' : 'Novo ponto de coleta';
  $('#pt-cep-status').textContent = 'Opcional: o endereço é preenchido pela API ViaCEP.';
  const aceitos = p ? p.residuos.map(r => r.id) : [];
  $('#pt-residuos').innerHTML = _residuosOp.map(r => `
    <label class="campo-radio"><input type="checkbox" name="pt-res" value="${r.id}" ${aceitos.includes(r.id) ? 'checked' : ''} /> ${esc(r.icone || '')} ${esc(r.nome)}</label>`).join('');
  const dias = p ? p.dias_semana.split(',') : ['1', '2', '3', '4', '5'];
  $$('input[name="pt-dia"]').forEach(c => { c.checked = dias.includes(c.value); });
  if (p) {
    $('#pt-nome').value = p.nome; $('#pt-cep').value = p.cep || '';
    $('#pt-endereco').value = p.endereco; $('#pt-bairro').value = p.bairro; $('#pt-cidade').value = p.cidade || 'Barretos';
    $('#pt-abre').value = p.hora_abertura; $('#pt-fecha').value = p.hora_fechamento;
    $('#pt-intervalo').value = p.intervalo_minutos; $('#pt-cap').value = p.capacidade_slot;
    $('#pt-ativo').checked = !!p.ativo;
  }
  abrirDialogo('dlg-ponto');
}

async function buscarCepPonto() {
  const status = $('#pt-cep-status');
  status.textContent = 'Buscando…';
  try {
    const d = await buscarCepViaCep($('#pt-cep').value);
    if (d.logradouro) $('#pt-endereco').value = d.logradouro;
    if (d.bairro) $('#pt-bairro').value = d.bairro;
    if (d.localidade) $('#pt-cidade').value = d.localidade;
    $('#pt-cep').value = fmtCep($('#pt-cep').value);
    status.textContent = 'Endereço preenchido. Confira e complete o número, se necessário.';
  } catch (err) {
    status.textContent = err.message;
  }
}

async function salvarPonto(e) {
  e.preventDefault();
  limparErro('pt-erro');
  const id = $('#pt-id').value;
  const corpo = {
    nome: $('#pt-nome').value.trim(),
    cep: $('#pt-cep').value.trim() || null,
    endereco: $('#pt-endereco').value.trim(),
    bairro: $('#pt-bairro').value.trim(),
    cidade: $('#pt-cidade').value.trim() || 'Barretos',
    dias_semana: $$('input[name="pt-dia"]:checked').map(c => Number(c.value)),
    hora_abertura: $('#pt-abre').value,
    hora_fechamento: $('#pt-fecha').value,
    intervalo_minutos: Number($('#pt-intervalo').value),
    capacidade_slot: Number($('#pt-cap').value),
    residuos: $$('input[name="pt-res"]:checked').map(c => Number(c.value)),
    ativo: $('#pt-ativo').checked,
  };
  if (!corpo.dias_semana.length) return mostrarErro('pt-erro', 'Marque pelo menos um dia de funcionamento.');

  const btn = $('#pt-salvar');
  ocupado(btn, true, 'Salvando…');
  try {
    if (id) await api.atualizarPonto(id, corpo); else await api.criarPonto(corpo);
    fecharDialogo('dlg-ponto');
    avisar('Ponto de coleta salvo.');
    await initOpPontos();
  } catch (err) {
    mostrarErro('pt-erro', err.message);
  } finally {
    ocupado(btn, false);
  }
}

async function aoClicarAcaoPonto(e) {
  const btn = e.target.closest('button[data-acao]');
  if (!btn) return;
  const p = _pontosOp.find(x => String(x.id) === btn.dataset.id);
  try {
    if (btn.dataset.acao === 'editar') return abrirDialogoPonto(p);
    if (btn.dataset.acao === 'desativar') {
      if (!confirm(`Desativar "${p.nome}"? Ele deixa de aparecer para novos agendamentos (o histórico é mantido).`)) return;
      const r = await api.desativarPonto(p.id);
      avisar(`Ponto desativado. Agendamentos futuros já marcados: ${r.agendamentos_futuros_afetados}.`);
    }
    if (btn.dataset.acao === 'reativar') {
      await api.atualizarPonto(p.id, { ativo: true });
      avisar('Ponto reativado.');
    }
    await initOpPontos();
  } catch (err) { avisar(err.message, 'erro'); }
}

/* ── Resíduos ── */
async function initOpResiduos() {
  _residuosOp = await api.getResiduos();
  $('#op-residuos-corpo').innerHTML = _residuosOp.length ? _residuosOp.map(r => `<tr>
    <td data-label="Resíduo">${esc(r.icone || '')} ${esc(r.nome)}</td>
    <td data-label="Descrição">${esc(r.descricao || '—')}</td>
    <td data-label="Instruções">${esc(r.instrucoes_descarte || '—')}</td>
    <td class="celula-acoes"><div class="acoes-linha">
      <button type="button" class="btn btn-sm" data-acao="editar" data-id="${r.id}" aria-label="Editar ${esc(r.nome)}">Editar</button>
      <button type="button" class="btn btn-sm btn-perigo" data-acao="remover" data-id="${r.id}" aria-label="Remover ${esc(r.nome)}">Remover</button>
    </div></td></tr>`).join('') : '<tr><td colspan="4">Nenhum resíduo cadastrado.</td></tr>';
}

function abrirDialogoResiduo(r = null) {
  limparErro('rs-erro');
  $('#form-residuo').reset();
  $('#rs-id').value = r ? r.id : '';
  $('#dlg-residuo-titulo').textContent = r ? 'Editar tipo de resíduo' : 'Novo tipo de resíduo';
  if (r) {
    $('#rs-nome').value = r.nome; $('#rs-desc').value = r.descricao || '';
    $('#rs-instr').value = r.instrucoes_descarte || ''; $('#rs-icone').value = r.icone || '';
  }
  abrirDialogo('dlg-residuo');
}

async function salvarResiduo(e) {
  e.preventDefault();
  limparErro('rs-erro');
  const id = $('#rs-id').value;
  const corpo = {
    nome: $('#rs-nome').value.trim(), descricao: $('#rs-desc').value.trim(),
    instrucoes_descarte: $('#rs-instr').value.trim(), icone: $('#rs-icone').value.trim(),
  };
  const btn = $('#rs-salvar');
  ocupado(btn, true, 'Salvando…');
  try {
    if (id) await api.atualizarResiduo(id, corpo); else await api.criarResiduo(corpo);
    fecharDialogo('dlg-residuo');
    avisar('Tipo de resíduo salvo.');
    await initOpResiduos();
  } catch (err) {
    mostrarErro('rs-erro', err.message);
  } finally {
    ocupado(btn, false);
  }
}

async function aoClicarAcaoResiduo(e) {
  const btn = e.target.closest('button[data-acao]');
  if (!btn) return;
  const r = _residuosOp.find(x => String(x.id) === btn.dataset.id);
  try {
    if (btn.dataset.acao === 'editar') return abrirDialogoResiduo(r);
    if (btn.dataset.acao === 'remover') {
      if (!confirm(`Remover "${r.nome}"?`)) return;
      await api.deletarResiduo(r.id);
      avisar('Tipo de resíduo removido.');
      await initOpResiduos();
    }
  } catch (err) { avisar(err.message, 'erro'); }
}

/* ── Análise de dados (gráficos de barras em HTML) ── */
async function initOpAnalise() { await carregarAnalise(); }

function rotuloPeriodo(r) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(r)) return r.split('-').reverse().join('/');
  if (/^\d{4}-\d{2}$/.test(r)) return r.split('-').reverse().join('/');
  return r;
}

function desenharBarras(idEl, dados, fmt = (x) => x) {
  const el = $('#' + idEl);
  if (!dados.length) { el.innerHTML = '<p class="vazio">Sem dados no período.</p>'; return; }
  const max = Math.max(...dados.map(d => d.total));
  el.innerHTML = `<ul class="barras">${dados.map(d => `
    <li><span class="barra-rotulo">${esc(fmt(d.rotulo))}</span>
      <span class="barra-trilho" aria-hidden="true"><span class="barra-preenchida" style="width:${(d.total / max * 100).toFixed(1)}%"></span></span>
      <span class="barra-valor">${d.total}</span></li>`).join('')}</ul>`;
}

async function carregarAnalise() {
  const a = await api.analise({
    inicio: $('#an-inicio').value, fim: $('#an-fim').value, agrupar: $('#an-agrupar').value,
  });
  const r = a.resumo;
  $('#an-cards').innerHTML = [
    ['Total (com cancelados)', r.total], ['Hoje', r.hoje], ['Concluídos', r.concluidos],
    ['Pessoa física', r.pessoa_fisica], ['Pessoa jurídica', r.pessoa_juridica],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  desenharBarras('g-residuo', a.por_residuo);
  desenharBarras('g-bairro', a.por_bairro);
  desenharBarras('g-ponto', a.por_ponto);
  desenharBarras('g-periodo', a.por_periodo, rotuloPeriodo);
}

/* ═════════════════════ EVENTOS ═════════════════════ */

// Executa um handler assíncrono mostrando erros ao usuário (sem promessa solta)
const seguro = (fn) => (...args) => Promise.resolve(fn(...args)).catch(err => avisar(err.message, 'erro'));

function mascarar(id, formatador) {
  $('#' + id).addEventListener('blur', (e) => { e.target.value = formatador(e.target.value); });
}

function ligarEventos() {
  // Menu (mobile)
  $('#btn-menu').addEventListener('click', () => {
    const aberto = $('#menus').classList.toggle('aberto');
    $('#btn-menu').setAttribute('aria-expanded', String(aberto));
  });
  $('#skip').addEventListener('click', (e) => { e.preventDefault(); $('#conteudo').focus(); });
  $('#btn-sair-op').addEventListener('click', sairOperador);

  // Identificação
  $('#modo-entrar').addEventListener('click', () => definirModo('entrar'));
  $('#modo-cadastro').addEventListener('click', () => { definirModo('cadastro'); ajustarTipoCadastro(); });
  $$('input[name="cad-tipo"]').forEach(r => r.addEventListener('change', ajustarTipoCadastro));
  $('#form-entrar').addEventListener('submit', seguro(submeterEntrar));
  $('#form-cadastro').addEventListener('submit', seguro(submeterCadastro));
  mascarar('ent-doc', fmtDoc); mascarar('cad-doc', fmtDoc);
  mascarar('ent-tel', fmtTel); mascarar('cad-tel', fmtTel);

  // Agendar
  $('#ag-trocar').addEventListener('click', () => { Sessao.sair(); Sessao.setDestino('agendar'); irPara('identificar'); });
  $('#ag-residuo').addEventListener('change', seguro(aoMudarResiduo));
  $('#ag-ponto').addEventListener('change', aoMudarPonto);
  $('#ag-data').addEventListener('change', seguro(carregarSlots));
  $('#form-agendar').addEventListener('submit', seguro(submeterAgendamento));
  $('#conf-imprimir').addEventListener('click', () => window.print());
  $('#hist-imprimir').addEventListener('click', () => window.print());

  // Operador
  $('#form-op-login').addEventListener('submit', seguro(submeterLoginOperador));
  $('#form-filtros').addEventListener('submit', (e) => { e.preventDefault(); seguro(carregarOpAgendamentos)(); });
  $('#f-todas').addEventListener('click', () => { $('#f-data').value = ''; seguro(carregarOpAgendamentos)(); });
  $('#op-ag-corpo').addEventListener('click', aoClicarAcaoAgendamento);

  $('#btn-novo-ponto').addEventListener('click', () => abrirDialogoPonto());
  $('#op-pontos-corpo').addEventListener('click', aoClicarAcaoPonto);
  $('#btn-cep').addEventListener('click', seguro(buscarCepPonto));
  $('#form-ponto').addEventListener('submit', seguro(salvarPonto));

  $('#btn-novo-residuo').addEventListener('click', () => abrirDialogoResiduo());
  $('#op-residuos-corpo').addEventListener('click', aoClicarAcaoResiduo);
  $('#form-residuo').addEventListener('submit', seguro(salvarResiduo));

  $('#form-analise').addEventListener('submit', (e) => { e.preventDefault(); seguro(carregarAnalise)(); });

  // Fechar diálogos
  $$('[data-fechar]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

  // Sessão do operador mudou ou expirou
  window.addEventListener('ecoponto:auth', () => atualizarNav((location.hash || '#inicio').slice(1)));
  window.addEventListener('ecoponto:sessao-expirada', () => {
    avisar('Sua sessão expirou. Faça login novamente.', 'erro');
    irPara('operador');
  });

  window.addEventListener('hashchange', rotear);
}

document.addEventListener('DOMContentLoaded', () => {
  ligarEventos();
  rotear();
});
