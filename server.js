const express = require('express')
const QRCode  = require('qrcode')
const http    = require('http')
const { WebSocketServer } = require('ws')
const path    = require('path')
const {
  listarUsuarios, buscarTodasTransacoes, buscarTransacoesPorUsuario,
  atualizarTransacao, deletarTransacao, listarCategoriasDeUsuario,
  buscarUsuarioPorNumero
} = require('./db')

const app    = express()
const server = http.createServer(app)
const wss    = new WebSocketServer({ server })

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ─── WebSocket ────────────────────────────────────────────────────────────────
function broadcast(evento, dados) {
  const msg = JSON.stringify({ evento, dados })
  wss.clients.forEach(function(c) { if (c.readyState === 1) c.send(msg) })
}

wss.on('connection', function(ws) {
  console.log('Painel conectado via WebSocket')
  ws.on('error', console.error)
})

// ─── QR Code ──────────────────────────────────────────────────────────────────
let currentQR = null
function setQR(qr) { currentQR = qr }

app.get('/qr', async function(req, res) {
  if (!currentQR) return res.send('<h2 style="font-family:sans-serif;padding:40px;background:#111;color:#fff;margin:0">Ja conectado!</h2>')
  const img = await QRCode.toDataURL(currentQR)
  res.send('<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#111"><img src="' + img + '"/></body></html>')
})

// ─── API ──────────────────────────────────────────────────────────────────────
app.get('/api/transacoes', function(req, res) {
  res.json(req.query.usuario_id
    ? buscarTransacoesPorUsuario(parseInt(req.query.usuario_id))
    : buscarTodasTransacoes())
})

app.get('/api/usuarios', function(req, res) {
  res.json(listarUsuarios())
})

app.get('/api/categorias', function(req, res) {
  const usuario_id = parseInt(req.query.usuario_id)
  if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatorio' })
  res.json(listarCategoriasDeUsuario(usuario_id))
})

app.put('/api/transacoes/:id', function(req, res) {
  const { valor, nomeCategoria, descricao, usuario_id } = req.body
  const atualizado = atualizarTransacao(parseInt(req.params.id), {
    valor: parseFloat(valor),
    nomeCategoria,
    descricao,
    usuario_id: parseInt(usuario_id)
  })
  broadcast('transacao_atualizada', atualizado)
  res.json({ ok: true })
})

app.delete('/api/transacoes/:id', function(req, res) {
  const id = parseInt(req.params.id)
  deletarTransacao(id)
  broadcast('transacao_deletada', { id })
  res.json({ ok: true })
})

// ─── Painel ───────────────────────────────────────────────────────────────────
app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'painel.html'))
})

function iniciar(porta) {
  server.listen(porta, function() {
    console.log('Painel disponivel em http://localhost:' + porta)
  })
}

module.exports = { iniciar, broadcast, setQR }
