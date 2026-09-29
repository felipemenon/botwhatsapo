const { iniciar, broadcast, setQR } = require('./server')
const { conectar } = require('./bot')
const { buscarResumoMes, listarUsuarios } = require('./db')
const cron = require('node-cron')

// Inicia servidor web
iniciar(3000)

// Controla reconexao
let tentativas = 0

async function iniciarBot() {
  try {
    const sock = await conectar(
      function onQR(qr) {
        setQR(qr)
        console.log('QR gerado - acesse http://localhost:3000/qr')
      },
      function onConnect() {
        tentativas = 0
        console.log('WhatsApp conectado!')
      },
      function onDisconnect(podeReconectar) {
        if (podeReconectar) {
          tentativas++
          const delay = Math.min(5000 * tentativas, 30000)
          console.log('Reconectando em ' + (delay / 1000) + 's... (tentativa ' + tentativas + ')')
          setTimeout(iniciarBot, delay)
        } else {
          console.log('Sessao encerrada. Reinicie o bot.')
        }
      },
      broadcast
    )
    return sock
  } catch (err) {
    console.error('Erro ao conectar:', err.message)
    setTimeout(iniciarBot, 5000)
  }
}

// Resumo mensal automatico - ultimo dia do mes as 23:59
cron.schedule('59 23 28-31 * *', async function() {
  const agora = new Date()
  const amanha = new Date(agora)
  amanha.setDate(agora.getDate() + 1)
  if (amanha.getMonth() === agora.getMonth()) return

  console.log('Enviando resumos mensais...')
  // Importa sock dinamicamente para evitar circular
  // O resumo e enviado pelo server via broadcast + notificacao manual
  // Para enviar pelo WhatsApp, expor sock globalmente ou usar event emitter
  // Por ora, loga o resumo (implemente o envio conforme necessidade)
  const usuarios = listarUsuarios()
  usuarios.forEach(function(u) {
    const resumo = require('./bot').gerarResumo
    console.log('Resumo para ' + u.nome + ':')
    console.log(require('./db').buscarResumoMes(agora.getMonth() + 1, agora.getFullYear(), u.id))
  })
})

iniciarBot()
