const Database = require('better-sqlite3')
const path = require('path')

const db = new Database(path.join(__dirname, 'financas.db'))

// ─── Schema ───────────────────────────────────────────────────────────────────
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    cpf       TEXT    UNIQUE NOT NULL,
    numero    TEXT    NOT NULL,
    nome      TEXT    NOT NULL,
    criado_em TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categorias (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    nome       TEXT    NOT NULL,
    is_padrao  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(usuario_id, nome)
  );

  CREATE TABLE IF NOT EXISTS transacoes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id   INTEGER NOT NULL,
    tipo         TEXT    NOT NULL,
    valor        REAL    NOT NULL,
    categoria_id INTEGER,
    descricao    TEXT,
    data         TEXT    NOT NULL,
    FOREIGN KEY(usuario_id)   REFERENCES usuarios(id),
    FOREIGN KEY(categoria_id) REFERENCES categorias(id)
  );
`)

// ─── Categorias padrão (usuario_id = NULL, is_padrao = 1) ────────────────────
const CATS_PADRAO = [
  'alimentacao', 'transporte', 'lazer',
  'moradia', 'saude', 'vestuario', 'outros', 'poupanca', 'receita'
]

const insertPadrao = db.prepare('INSERT OR IGNORE INTO categorias (usuario_id, nome, is_padrao) VALUES (0, ?, 1)')
CATS_PADRAO.forEach(function(nome) { insertPadrao.run(nome) })

// ─── Helpers ──────────────────────────────────────────────────────────────────
function limparCPF(cpf) { return String(cpf).replace(/\D/g, '') }

function cpfValido(cpf) {
  cpf = limparCPF(cpf)
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false
  let s = 0
  for (let i = 0; i < 9; i++) s += parseInt(cpf[i]) * (10 - i)
  let r = (s * 10) % 11; if (r >= 10) r = 0
  if (r !== parseInt(cpf[9])) return false
  s = 0
  for (let i = 0; i < 10; i++) s += parseInt(cpf[i]) * (11 - i)
  r = (s * 10) % 11; if (r >= 10) r = 0
  return r === parseInt(cpf[10])
}

// ─── Usuários ─────────────────────────────────────────────────────────────────
function cadastrarOuAtualizar(numero, nome, cpf) {
  cpf = limparCPF(cpf)
  const existente = db.prepare('SELECT * FROM usuarios WHERE cpf = ?').get(cpf)
  if (existente) {
    db.prepare('UPDATE usuarios SET numero = ?, nome = ? WHERE cpf = ?').run(numero, nome, cpf)
    return { acao: 'atualizado', usuario: db.prepare('SELECT * FROM usuarios WHERE cpf = ?').get(cpf) }
  }
  db.prepare('INSERT INTO usuarios (cpf, numero, nome, criado_em) VALUES (?, ?, ?, ?)').run(cpf, numero, nome, new Date().toISOString())
  return { acao: 'cadastrado', usuario: db.prepare('SELECT * FROM usuarios WHERE cpf = ?').get(cpf) }
}

function buscarUsuarioPorNumero(numero) {
  return db.prepare('SELECT * FROM usuarios WHERE numero = ?').get(numero)
}

function listarUsuarios() {
  return db.prepare('SELECT * FROM usuarios ORDER BY nome').all()
}

// ─── Categorias ───────────────────────────────────────────────────────────────

// Retorna todas as categorias visíveis para um usuário (padrão + suas próprias)
function listarCategoriasDeUsuario(usuario_id) {
  // Retorna apenas categorias padrao (is_padrao = 1)
  return db.prepare(
    'SELECT id, nome, is_padrao FROM categorias WHERE usuario_id = 0 AND is_padrao = 1 ORDER BY id'
  ).all()
}

function buscarCategoriaPadraoPorNome(nome) {
  return db.prepare('SELECT * FROM categorias WHERE usuario_id = 0 AND is_padrao = 1 AND nome = ?').get(nome.toLowerCase().trim())
}

function buscarCategoriaUsuarioPorNome(usuario_id, nome) {
  return db.prepare('SELECT * FROM categorias WHERE usuario_id = ? AND is_padrao = 0 AND nome = ?').get(usuario_id, nome.toLowerCase().trim())
}

function adicionarCategoriaUsuario(usuario_id, nome) {
  nome = nome.toLowerCase().trim()
  if (buscarCategoriaPadraoPorNome(nome)) return { ok: false, motivo: 'padrao' }
  try {
    const info = db.prepare('INSERT INTO categorias (usuario_id, nome, is_padrao) VALUES (?, ?, 0)').run(usuario_id, nome)
    return { ok: true, id: info.lastInsertRowid, nome: nome }
  } catch(e) {
    return { ok: false, motivo: 'duplicada' }
  }
}

function deletarCategoriaUsuario(usuario_id, nome) {
  const info = db.prepare('DELETE FROM categorias WHERE usuario_id = ? AND nome = ?').run(usuario_id, nome.toLowerCase().trim())
  return info.changes > 0
}

// Resolve categoria_id para uma transação
// Primeiro tenta categorias padrão, depois categorias do usuário
function resolverCategoriaId(usuario_id, nomeCategoria) {
  nomeCategoria = (nomeCategoria || 'outros').toLowerCase().trim()
  // Busca padrao primeiro
  const padrao = buscarCategoriaPadraoPorNome(nomeCategoria)
  if (padrao) return { id: padrao.id }
  // Busca categoria propria do usuario
  const propria = buscarCategoriaUsuarioPorNome(usuario_id, nomeCategoria)
  if (propria) return { id: propria.id }
  // Fallback: outros
  const outros = buscarCategoriaPadraoPorNome('outros')
  return { id: outros ? outros.id : null }
}

// ─── Transações ───────────────────────────────────────────────────────────────
function salvarTransacao({ usuario_id, tipo, valor, nomeCategoria, descricao }) {
  const cat = resolverCategoriaId(usuario_id, nomeCategoria)
  const data = new Date().toISOString()
  const info = db.prepare(
    'INSERT INTO transacoes (usuario_id, tipo, valor, categoria_id, descricao, data) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(usuario_id, tipo, valor, cat.id, descricao, data)
  return buscarTransacaoPorId(info.lastInsertRowid)
}

function buscarTransacaoPorId(id) {
  return db.prepare(`
    SELECT t.*, u.nome as usuario_nome, u.cpf as usuario_cpf,
      COALESCE(cat.nome, 'outros') as categoria_nome
    FROM transacoes t
    JOIN usuarios u ON u.id = t.usuario_id
    LEFT JOIN categorias cat ON cat.id = t.categoria_id
    WHERE t.id = ?
  `).get(id)
}

function buscarTodasTransacoes() {
  return db.prepare(`
    SELECT t.*, u.nome as usuario_nome, u.cpf as usuario_cpf,
      COALESCE(cat.nome, 'outros') as categoria_nome
    FROM transacoes t
    JOIN usuarios u ON u.id = t.usuario_id
    LEFT JOIN categorias cat ON cat.id = t.categoria_id
    ORDER BY t.data DESC
  `).all()
}

function buscarTransacoesPorUsuario(usuario_id) {
  return db.prepare(`
    SELECT t.*,
      COALESCE(cat.nome, 'outros') as categoria_nome
    FROM transacoes t
    LEFT JOIN categorias cat ON cat.id = t.categoria_id
    WHERE t.usuario_id = ?
    ORDER BY t.data DESC
  `).all(usuario_id)
}

function buscarUltimas(usuario_id, limite) {
  return db.prepare(`
    SELECT t.*,
      COALESCE(cat.nome, 'outros') as categoria_nome
    FROM transacoes t
    LEFT JOIN categorias cat ON cat.id = t.categoria_id
    WHERE t.usuario_id = ?
    ORDER BY t.id DESC
    LIMIT ?
  `).all(usuario_id, limite || 5)
}

function atualizarTransacao(id, { valor, nomeCategoria, descricao, usuario_id }) {
  const cat = resolverCategoriaId(usuario_id, nomeCategoria)
  db.prepare('UPDATE transacoes SET valor = ?, categoria_id = ?, descricao = ? WHERE id = ?').run(valor, cat.id, descricao, id)
  return buscarTransacaoPorId(id)
}

function deletarTransacao(id) {
  db.prepare('DELETE FROM transacoes WHERE id = ?').run(id)
}

function buscarResumoMes(mes, ano, usuario_id) {
  const inicio = ano + '-' + String(mes).padStart(2, '0') + '-01T00:00:00.000Z'
  const fim    = ano + '-' + String(mes).padStart(2, '0') + '-31T23:59:59.999Z'
  const base = `
    SELECT u.nome as usuario_nome, t.tipo, SUM(t.valor) as total
    FROM transacoes t
    JOIN usuarios u ON u.id = t.usuario_id
    WHERE t.data BETWEEN ? AND ?
  `
  if (usuario_id) return db.prepare(base + ' AND t.usuario_id = ? GROUP BY u.nome, t.tipo').all(inicio, fim, usuario_id)
  return db.prepare(base + ' GROUP BY u.nome, t.tipo').all(inicio, fim)
}

module.exports = {
  db,
  limparCPF, cpfValido,
  cadastrarOuAtualizar, buscarUsuarioPorNumero, listarUsuarios,
  listarCategoriasDeUsuario, adicionarCategoriaUsuario, deletarCategoriaUsuario,
  buscarCategoriaPadraoPorNome, buscarCategoriaUsuarioPorNome, resolverCategoriaId,
  salvarTransacao, buscarTodasTransacoes, buscarTransacoesPorUsuario,
  buscarUltimas, atualizarTransacao, deletarTransacao, buscarResumoMes,
  CATS_PADRAO
}
