const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const {
  cpfValido, cadastrarOuAtualizar, buscarUsuarioPorNumero,
  listarCategoriasDeUsuario, salvarTransacao, buscarUltimas, buscarResumoMes
} = require('./db')

// ─── Sessoes aguardando escolha de categoria ──────────────────────────────────
const pendentes = {}

// ─── Parser ───────────────────────────────────────────────────────────────────
function parsearMensagem(texto) {
  const t = texto.toLowerCase().trim()
  if (/^resumo/.test(t))          return { acao: 'resumo' }
  if (/^(ultimas|historico)/.test(t)) return { acao: 'historico' }
  if (/^(ajuda|help|\?)/.test(t)) return { acao: 'ajuda' }

  const mGasto = t.match(/(?:gastei|gastamos|gasto|paguei|paguemos|comprei|compramos|saiu|usei|usamos|quitei|quitamos|reembolsei|desembolsei|debitou|cobrou|custou|gastou|tirei|tirou)\s+([\d]+(?:[.,]\d{1,2})?)\s*(?:reais|r\$)?\s*(?:no?|na|em|com|de|pra|para)?\s*(.*)/i)
  if (mGasto) {
    const valor = parseFloat(mGasto[1].replace(',', '.'))
    const descricao = mGasto[2].trim() || 'sem descricao'
    return { acao: 'gasto', valor, descricao, categoriaAuto: detectarCategoria(descricao) }
  }

  const mEcon = t.match(/(?:guardei|guardamos|economizei|economizamos|poupei|poupamos|salvei|separei|separamos|reservei|reservamos|investi|investimos|juntei|juntamos)\s+([\d]+(?:[.,]\d{1,2})?)/i)
  if (mEcon) return { acao: 'economia', valor: parseFloat(mEcon[1].replace(',', '.')), descricao: 'poupanca', categoriaAuto: 'poupanca' }

  const mRec = t.match(/(?:recebi|recebemos|entrou|ganhei|ganhamos|adquiri|adquirimos|consegui|conseguimos|caiu|depositou|transferiu|rendeu|faturei|faturamos)\s+([\d]+(?:[.,]\d{1,2})?)\s*(?:reais|r\$)?\s*(?:de|do|da|pelo?|com)?\s*(.*)/i)
  if (mRec) {
    const valor = parseFloat(mRec[1].replace(',', '.'))
    const descricao = mRec[2].trim() || 'receita'
    return { acao: 'receita', valor, descricao, categoriaAuto: 'receita' }
  }
  return null
}

function detectarCategoria(descricao) {
  const d = descricao.toLowerCase()
  if (/ifood|restaurante|lanche|almoco|jantar|pizza|hamburguer|mercado|supermercado|feira/.test(d)) return 'alimentacao'
  if (/uber|99|gasolina|combustivel|onibus|metro|passagem/.test(d)) return 'transporte'
  if (/netflix|spotify|steam|jogo|cinema|show/.test(d)) return 'lazer'
  if (/aluguel|condominio|luz|agua|internet|conta/.test(d)) return 'moradia'
  if (/farmacia|remedio|medico|consulta|hospital/.test(d)) return 'saude'
  if (/roupa|sapato|shopping/.test(d)) return 'vestuario'
  return 'outros'
}

// ─── Mensagens ────────────────────────────────────────────────────────────────
const CAT_EMOJIS = {
  alimentacao: '\u{1F354}',
  transporte:  '\u{1F697}',
  lazer:       '\u{1F3AE}',
  moradia:     '\u{1F3E0}',
  saude:       '\u{1F48A}',
  vestuario:   '\u{1F455}',
  outros:      '\u{1F4E6}',
  poupanca:    '\u{1F3E6}',
  receita:     '\u{1F4B0}'
}

function menuCategorias(categoriaAuto, usuario_id) {
  const cats = listarCategoriasDeUsuario(usuario_id)
  let msg = '\u{1F5C2}\uFE0F *Em qual categoria entra esse gasto?*\n\n'
  cats.forEach(function(cat, i) {
    const marcador = cat.nome === categoriaAuto ? '  \u2705 _detectada_' : ''
    const label = cat.nome.charAt(0).toUpperCase() + cat.nome.slice(1)
    const emoji = CAT_EMOJIS[cat.nome] || '\u{1F4CC}'
    msg += emoji + ' *' + (i + 1) + '.* ' + label + marcador + '\n'
  })
  msg += '\n\u23F1\uFE0F _Sem resposta em 60s? Usarei a categoria detectada automaticamente._'
  return msg
}

function formatarResumo(mes, ano, usuario_id) {
  const dados = buscarResumoMes(mes, ano, usuario_id)
  const nomeMes = new Date(ano, mes - 1).toLocaleString('pt-BR', { month: 'long' })
  if (dados.length === 0) {
    return '\u{1F4EB} Nenhuma transa\u00E7\u00E3o registrada em *' + nomeMes + '/' + ano + '*.\n\n_Comece enviando algo como:_\n_"gastei 50 no mercado"_ \u{1F609}'
  }

  const totais = {}
  dados.forEach(function(row) {
    if (!totais[row.usuario_nome]) totais[row.usuario_nome] = { gasto: 0, economia: 0, receita: 0 }
    totais[row.usuario_nome][row.tipo] = (totais[row.usuario_nome][row.tipo] || 0) + row.total
  })

  let msg = '\u{1F4CA} *Resumo de ' + nomeMes + '/' + ano + '*\n'
  msg += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n'
  let tG = 0, tE = 0, tR = 0

  Object.entries(totais).forEach(function(e) {
    const nome = e[0]
    const t = e[1]
    msg += '\u{1F464} *' + nome + '*\n'
    if (t.gasto)    { msg += '   \u{1F4B8} Gastos:   *R$ ' + t.gasto.toFixed(2) + '*\n';    tG += t.gasto }
    if (t.receita)  { msg += '   \u{1F4B0} Receitas: *R$ ' + t.receita.toFixed(2) + '*\n';  tR += t.receita }
    if (t.economia) { msg += '   \u{1F3E6} Poupan\u00E7a: *R$ ' + t.economia.toFixed(2) + '*\n'; tE += t.economia }
    msg += '\n'
  })

  const saldo = tR - tG
  const saldoEmoji = saldo >= 0 ? '\u{1F4C8}' : '\u{1F4C9}'
  msg += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'
  msg += '\u{1F4B8} Total gasto:    *R$ ' + tG.toFixed(2) + '*\n'
  msg += '\u{1F4B0} Total recebido: *R$ ' + tR.toFixed(2) + '*\n'
  msg += '\u{1F3E6} Total poupado:  *R$ ' + tE.toFixed(2) + '*\n\n'
  msg += saldoEmoji + ' *Saldo: R$ ' + saldo.toFixed(2) + '*'
  return msg
}

function formatarHistorico(usuario_id) {
  const rows = buscarUltimas(usuario_id)
  if (rows.length === 0) {
    return '\u{1F4EB} *Nenhuma transa\u00E7\u00E3o registrada ainda.*\n\n_Comece enviando algo como:_\n_"gastei 50 no mercado"_ \u{1F609}'
  }
  let msg = '\u{1F4CB} *Suas \u00FAltimas transa\u00E7\u00F5es:*\n'
  msg += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n'
  rows.forEach(function(r) {
    const data = new Date(r.data).toLocaleDateString('pt-BR')
    const catEmoji = CAT_EMOJIS[r.categoria_nome] || '\u{1F4CC}'
    const tipoEmoji = r.tipo === 'gasto' ? '\u{1F4B8}' : r.tipo === 'receita' ? '\u{1F4B0}' : '\u{1F3E6}'
    msg += tipoEmoji + ' *R$ ' + r.valor.toFixed(2) + '* \u2014 ' + (r.descricao || '\u2014') + '\n'
    msg += '   ' + catEmoji + ' ' + (r.categoria_nome || 'outros') + '  \u2022  \u{1F4C5} ' + data + '  \u2022  _#' + r.id + '_\n\n'
  })
  msg += '\u{1F310} _Para editar: http://localhost:3000_'
  return msg
}

function mensagemAjuda() {
  return '\u{1F916} *Bot Financeiro \u2014 Comandos*\n' +
    '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n' +
    '\u{1F464} *Cadastro ou trocar n\u00FAmero:*\n' +
    '   _!cadastrar SeuNome SeuCPF_\n\n' +
    '\u{1F4B8} *Registrar gasto:*\n' +
    '   _"gastei 50 no mercado"_\n' +
    '   _"paguei 120 aluguel"_\n\n' +
    '\u{1F4B0} *Registrar receita:*\n' +
    '   _"recebi 3000 salario"_\n' +
    '   _"entrou 500 freelance"_\n\n' +
    '\u{1F3E6} *Registrar poupan\u00E7a:*\n' +
    '   _"guardei 200"_\n' +
    '   _"economizei 150"_\n\n' +
    '\u{1F4CA} *Ver resumo do m\u00EAs:*  _"resumo"_\n' +
    '\u{1F4CB} *Ver \u00FAltimas transa\u00E7\u00F5es:*  _"ultimas"_\n\n' +
    '\u{1F310} *Painel web:* http://localhost:3000\n\n' +
    '\u{1F4A1} _Dica: ao registrar um gasto, vou perguntar a categoria!_'
}

// ─── JID limpo ────────────────────────────────────────────────────────────────
function jidLimpo(jid) {
  return jid.replace('@s.whatsapp.net', '').replace('@lid', '').split(':')[0]
}

// ─── Conectar ────────────────────────────────────────────────────────────────
async function conectar(onQR, onConnect, onDisconnect, broadcast) {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')

  const sock = makeWASocket({
    auth: state,
    browser: ['Windows', 'Chrome', '122.0.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async function(update) {
    const { connection, lastDisconnect, qr } = update
    if (qr) onQR(qr)
    if (connection === 'open') onConnect()
    if (connection === 'close') {
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode
      onDisconnect(code !== DisconnectReason.loggedOut)
    }
  })

  sock.ev.on('messages.upsert', async function(upsert) {
    if (upsert.type !== 'notify') return
    const msg = upsert.messages[0]
    if (!msg.message || msg.key.fromMe) return
    if (msg.key.remoteJid.endsWith('@g.us')) return

    const numeroJid = jidLimpo(msg.key.remoteJid)
    const numero = msg.key.participant ? jidLimpo(msg.key.participant) : numeroJid
    const jidResposta = msg.key.remoteJid
    const texto = (msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || '').trim()
    if (!texto) return

    async function reply(txt) { await sock.sendMessage(jidResposta, { text: txt }) }

    // ── Cadastro ──────────────────────────────────────────────────────────────
    const matchCadastro = texto.match(/^!cadastrar\s+(.+?)\s+([\d.\-]+)\s*$/i)
    if (matchCadastro) {
      const nome = matchCadastro[1].trim()
      const cpf  = matchCadastro[2].trim()
      if (!cpfValido(cpf)) {
        await reply('\u274C *CPF inv\u00E1lido.* Verifique os d\u00EDgitos e tente novamente.\n\n\u{1F4DD} _Exemplo:_\n_!cadastrar Felipe 12345678900_')
        return
      }
      const resultado = cadastrarOuAtualizar(numero, nome, cpf)
      if (resultado.acao === 'cadastrado') {
        broadcast('novo_usuario', resultado.usuario)
        await reply('\u{1F389} Ol\u00E1, *' + nome + '*! Seja bem-vindo ao Bot Financeiro!\n\n\u2705 Cadastro realizado com sucesso.\n\u{1F4A1} _Dica: se trocar de n\u00FAmero, use o mesmo CPF para recuperar todo seu hist\u00F3rico._\n\nDigite *ajuda* para ver os comandos! \u{1F609}')
      } else {
        broadcast('usuario_atualizado', resultado.usuario)
        await reply('\u{1F44B} Bem-vindo de volta, *' + nome + '*!\n\n\u2705 N\u00FAmero atualizado com sucesso.\n\u{1F4C2} Seu hist\u00F3rico completo foi mantido!')
      }
      return
    }

    // ── Verifica cadastro ─────────────────────────────────────────────────────
    const usuario = buscarUsuarioPorNumero(numero)
    if (!usuario) {
      await reply('\u{1F44B} *Ol\u00E1! Tudo bem?*\n\nPara usar o Bot Financeiro, primeiro se cadastre:\n\n\u{1F4DD} *!cadastrar SeuNome SeuCPF*\n\n_Exemplo:_\n_!cadastrar Felipe 12345678900_\n\n\u{1F4A1} _Seu CPF garante que voc\u00EA nunca perde seu hist\u00F3rico, mesmo trocando de n\u00FAmero!_')
      return
    }

    console.log('[' + usuario.nome + '] ' + texto)

    // ── Resposta ao menu de categorias ────────────────────────────────────────
    if (pendentes[jidResposta]) {
      const sessao = pendentes[jidResposta]
      clearTimeout(sessao.timeout)
      delete pendentes[jidResposta]

      const cats = listarCategoriasDeUsuario(usuario.id)
      const num = parseInt(texto.trim())
      const categoriaEscolhida = (!isNaN(num) && num >= 1 && num <= cats.length)
        ? cats[num - 1].nome
        : sessao.categoriaAuto

      const catEmoji = CAT_EMOJIS[categoriaEscolhida] || '\u{1F4CC}'
      const transacao = salvarTransacao({ usuario_id: usuario.id, tipo: 'gasto', valor: sessao.parsed.valor, nomeCategoria: categoriaEscolhida, descricao: sessao.parsed.descricao })
      broadcast('nova_transacao', transacao)
      await reply('\u2705 *Gasto registrado com sucesso!*\n\n\u{1F4B8} *R$ ' + sessao.parsed.valor.toFixed(2) + '*\n' + catEmoji + ' Categoria: ' + categoriaEscolhida + '\n\u{1F4DD} ' + sessao.parsed.descricao)
      return
    }

    // ── Interpretar mensagem ──────────────────────────────────────────────────
    const parsed = parsearMensagem(texto)
    if (!parsed) {
      await reply('\u2753 *Hmm, n\u00E3o entendi essa mensagem.*\n\nDigite *ajuda* para ver todos os comandos dispon\u00EDveis! \u{1F609}')
      return
    }

    const agora = new Date()

    if (parsed.acao === 'ajuda') {
      await reply(mensagemAjuda())

    } else if (parsed.acao === 'resumo') {
      await reply(formatarResumo(agora.getMonth() + 1, agora.getFullYear(), usuario.id))

    } else if (parsed.acao === 'historico') {
      await reply(formatarHistorico(usuario.id))

    } else if (parsed.acao === 'receita' || parsed.acao === 'economia') {
      const transacao = salvarTransacao({ usuario_id: usuario.id, tipo: parsed.acao, valor: parsed.valor, nomeCategoria: parsed.categoriaAuto, descricao: parsed.descricao })
      broadcast('nova_transacao', transacao)
      const tipoEmoji = parsed.acao === 'receita' ? '\u{1F4B0}' : '\u{1F3E6}'
      const tipoLabel = parsed.acao === 'receita' ? 'Receita registrada' : 'Poupan\u00E7a registrada'
      await reply(tipoEmoji + ' *' + tipoLabel + ' com sucesso!*\n\n\u{1F4B5} *R$ ' + parsed.valor.toFixed(2) + '*\n\u{1F4DD} ' + parsed.descricao)

    } else if (parsed.acao === 'gasto') {
      const categoriaAuto = parsed.categoriaAuto

      const timeout = setTimeout(async function() {
        if (!pendentes[jidResposta]) return
        delete pendentes[jidResposta]
        const catEmoji = CAT_EMOJIS[categoriaAuto] || '\u{1F4CC}'
        const transacao = salvarTransacao({ usuario_id: usuario.id, tipo: 'gasto', valor: parsed.valor, nomeCategoria: categoriaAuto, descricao: parsed.descricao })
        broadcast('nova_transacao', transacao)
        await reply('\u23F1\uFE0F *Tempo esgotado!*\n\n\u2705 Registrado automaticamente:\n\u{1F4B8} *R$ ' + parsed.valor.toFixed(2) + '*\n' + catEmoji + ' Categoria: ' + categoriaAuto + '\n\u{1F4DD} ' + parsed.descricao)
      }, 60000)

      pendentes[jidResposta] = { parsed, categoriaAuto, timeout }
      await reply('\u{1F4B8} *Gasto de R$ ' + parsed.valor.toFixed(2) + ' detectado!*\n\u{1F4DD} _' + parsed.descricao + '_\n\n' + menuCategorias(categoriaAuto, usuario.id))
    }
  })

  return sock
}

module.exports = { conectar }
