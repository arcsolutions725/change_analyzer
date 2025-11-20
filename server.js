import http from 'http'
import https from 'https'
import { WebSocketServer } from 'ws'
import WebSocket from 'ws'
import fs from 'fs'
import path from 'path'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, 'public')
const port = process.env.PORT || 5173

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0]
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html'
  if (reqPath === '/api/ticker24') {
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
wss.on('connection', (ws) => {
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

setInterval(pollAndBroadcast, 10000)
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
      if (msg && msg.publicMiniTickers && msg.publicMiniTickers.items) {
        const items = msg.publicMiniTickers.items
        lastPayload = items
        const out = JSON.stringify({ type: 'miniTickers', data: items, ts: Date.now() })
        for (const client of wsClients) {
          if (client.readyState === client.OPEN) client.send(out)
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