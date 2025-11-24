import http from 'http'
import https from 'https'
import { WebSocketServer } from 'ws'
import WebSocket from 'ws'
import fs from 'fs'
import path from 'path'
import url from 'url'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const runtimeDir = (typeof process !== 'undefined' && process.pkg) ? path.dirname(process.execPath) : __dirname
function loadDotEnv(file = path.join(runtimeDir, '.env')) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    text.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) return
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    })
  } catch {}
}
loadDotEnv()
const publicDir = path.join(__dirname, 'public')
const port = process.env.PORT || 5173
const APP_PASSWORD = process.env.APP_PASSWORD || null
const AUTH_TOKEN = process.env.AUTH_TOKEN || APP_PASSWORD || null
const MYSQL_HOST = process.env.MYSQL_HOST || ''
const MYSQL_PORT = Number(process.env.MYSQL_PORT || '3306')
const MYSQL_USER = process.env.MYSQL_USER || ''
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || ''
const MYSQL_DB = process.env.MYSQL_DB || ''
let dbPool = null
async function initDb() {
  if (!MYSQL_HOST || !MYSQL_USER || !MYSQL_DB) return
  dbPool = mysql.createPool({ host: MYSQL_HOST, port: MYSQL_PORT, user: MYSQL_USER, password: MYSQL_PASSWORD, database: MYSQL_DB, waitForConnections: true, connectionLimit: 5 })
  try {
    await dbPool.query('CREATE TABLE IF NOT EXISTS prices (id BIGINT AUTO_INCREMENT PRIMARY KEY, symbol VARCHAR(64) NOT NULL, ts BIGINT NOT NULL, price DOUBLE NOT NULL, INDEX idx_symbol_ts (symbol, ts))')
  } catch {}
}
initDb()
let writeBuf = []
function queueWrite(symbol, ts, p) { writeBuf.push({ symbol, ts, p }) }
async function flushWrites() {
  if (!dbPool || writeBuf.length === 0) return
  const batch = writeBuf.splice(0, writeBuf.length)
  const values = batch.map(r => [r.symbol, r.ts, r.p])
  const placeholders = values.map(() => '(?, ?, ?)').join(',')
  try { await dbPool.query('INSERT INTO prices (symbol, ts, price) VALUES ' + placeholders, values.flat()) } catch {}
}
setInterval(flushWrites, 1000)

function getReqToken(req) {
  try {
    const h = req.headers['authorization']
    if (h && typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7)
  } catch {}
  try {
    const u = new URL('http://x' + req.url)
    const t = u.searchParams.get('auth')
    if (t) return t
  } catch {}
  return null
}

function ensureAuth(req, res) {
  if (!AUTH_TOKEN) return true
  const tok = getReqToken(req)
  if (tok && tok === AUTH_TOKEN) return true
  res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' })
  res.end(JSON.stringify({ error: 'Unauthorized' }))
  return false
}

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0]
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html'
  if (reqPath === '/api/login') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8')
        const parsed = JSON.parse(body || '{}')
        const pw = parsed && parsed.password
        if (!APP_PASSWORD) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Password not set' }))
          return
        }
        if (typeof pw === 'string' && pw === APP_PASSWORD) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ token: AUTH_TOKEN }))
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid password' }))
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Bad Request' }))
      }
    })
    return
  }
  if (reqPath === '/api/ticker24') {
    if (!ensureAuth(req, res)) return
    const targetUrl = 'https://api.mexc.com/api/v3/ticker/24hr'
    https.get(targetUrl, (upstream) => {
      const chunks = []
      upstream.on('data', (c) => chunks.push(c))
      upstream.on('end', () => {
        const body = Buffer.concat(chunks)
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        })
        res.end(body)
      })
    }).on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Bad Gateway' }))
    })
    return
  }
  if (reqPath.startsWith('/api/symbols')) {
    if (!ensureAuth(req, res)) return
    const targetUrl = 'https://api.mexc.com/api/v3/exchangeInfo'
    https.get(targetUrl, (upstream) => {
      const chunks = []
      upstream.on('data', (c) => chunks.push(c))
      upstream.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          const parsed = JSON.parse(body)
          const urlObj = new URL('http://x' + req.url)
          const quote = urlObj.searchParams.get('quote') || 'USDT'
          const items = (parsed.symbols || []).filter(s => s.quoteAsset === quote && s.isSpotTradingAllowed)
          const symbols = items.map(s => s.symbol)
          const out = { quote, symbols }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
          res.end(JSON.stringify(out))
        } catch {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Bad Gateway' }))
        }
      })
    }).on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Bad Gateway' }))
    })
    return
  }
  if (reqPath.startsWith('/api/futures/contracts')) {
    if (!ensureAuth(req, res)) return
    const targetUrl = 'https://contract.mexc.com/api/v1/contract/detail'
    https.get(targetUrl, (upstream) => {
      const chunks = []
      upstream.on('data', (c) => chunks.push(c))
      upstream.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          const parsed = JSON.parse(body)
          const list = Array.isArray(parsed.data) ? parsed.data : []
          const urlObj = new URL('http://x' + req.url)
          const settle = urlObj.searchParams.get('settle') || 'USDT'
          const filtered = list.filter(item => item && item.settleCoin === settle)
          const symbols = filtered.map(item => item.symbol)
          const out = { settle, symbols }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
          res.end(JSON.stringify(out))
        } catch {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Bad Gateway' }))
        }
      })
    }).on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Bad Gateway' }))
    })
    return
  }
  if (reqPath.startsWith('/api/history')) {
    if (!ensureAuth(req, res)) return
    const u = new URL('http://x' + req.url)
    const symbol = u.searchParams.get('symbol') || ''
    const limit = Number(u.searchParams.get('limit') || '200')
    if (!symbol) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'symbol required' })); return }
    try {
      if (!dbPool) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end('[]'); return }
      const [rows] = await dbPool.query('SELECT ts, price FROM prices WHERE symbol = ? ORDER BY ts DESC LIMIT ?', [symbol, limit])
      const out = rows.map(r => ({ ts: Number(r.ts), p: Number(r.price) }))
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify(out))
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end('[]')
    }
    return
  }
  const filePath = path.join(publicDir, reqPath)
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    const types = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json'
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' })
    res.end(data)
  })
})

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`)
})

// Local WebSocket broadcasting REST ticker updates
const wss = new WebSocketServer({ server, path: '/stream' })
let wsClients = new Set()
wss.on('connection', (ws, req) => {
  if (AUTH_TOKEN) {
    const tok = getReqToken(req)
    if (!(tok && tok === AUTH_TOKEN)) {
      try { ws.close(1008) } catch {}
      return
    }
  }
  wsClients.add(ws)
  ws.on('close', () => wsClients.delete(ws))
})

async function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    https.get(urlStr, (up) => {
      const chunks = []
      up.on('data', c => chunks.push(c))
      up.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

let lastPayload = null
async function pollAndBroadcast() {
  try {
    const payload = await fetchJson('https://api.mexc.com/api/v3/ticker/24hr')
    lastPayload = payload
    const msg = JSON.stringify({ type: 'ticker24', data: payload, ts: Date.now() })
    for (const ws of wsClients) {
      if (ws.readyState === ws.OPEN) ws.send(msg)
    }
  } catch {}
}

setInterval(pollAndBroadcast, 20000)
// push once after startup when a client connects
wss.on('connection', (ws) => {
  if (lastPayload) {
    ws.send(JSON.stringify({ type: 'ticker24', data: lastPayload, ts: Date.now() }))
  }
})

function connectMiniTickers() {
  const upstream = new WebSocket('wss://wbs.mexc.com/ws')
  let pingTimer = null
  upstream.on('open', () => {
    const sub = { method: 'SUBSCRIPTION', params: [ 'spot@public.miniTickers.v3.api@UTC+8' ] }
    upstream.send(JSON.stringify(sub))
    pingTimer = setInterval(() => { try { upstream.ping() } catch {} }, 20000)
  })
  upstream.on('message', (buf) => {
    try {
      const text = buf.toString('utf8')
      const msg = JSON.parse(text)
      let items = null
      if (msg && msg.publicMiniTickers && msg.publicMiniTickers.items) {
        items = msg.publicMiniTickers.items
      } else if (msg && msg.data && msg.data.items) {
        items = msg.data.items
      } else if (msg && msg.items) {
        items = msg.items
      }
      if (items) {
        lastPayload = items
        const out = JSON.stringify({ type: 'miniTickers', data: items, ts: Date.now() })
        for (const client of wsClients) {
          if (client.readyState === client.OPEN) client.send(out)
        }
        const nowTs = Date.now()
        for (const it of items) {
          try {
            const symbol = it.symbol || (it.s || '')
            const price = (it.price ?? it.p ?? it.lastPrice ?? null)
            if (symbol && typeof price !== 'undefined') queueWrite(symbol, nowTs, Number(price))
          } catch {}
        }
      }
    } catch {}
  })
  upstream.on('close', () => {
    if (pingTimer) clearInterval(pingTimer)
    setTimeout(connectMiniTickers, 2000)
  })
  upstream.on('error', () => {
    if (pingTimer) clearInterval(pingTimer)
  })
}

connectMiniTickers()
