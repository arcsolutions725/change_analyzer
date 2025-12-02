import { useEffect, useMemo, useRef, useState } from 'react'
import './index.css'

const intervals = [
  { id: 2, label: '1m', sec: 60 },
  { id: 5, label: '10m', sec: 600 },
  { id: 6, label: '30m', sec: 1800 },
  { id: 7, label: '60m', sec: 3600 },
]

function spotToFutures(symbol) {
  if (symbol.includes('_')) return symbol
  const q = 'USDT'
  if (symbol.endsWith(q)) return symbol.slice(0, -q.length) + '_' + q
  return symbol
}
function pairUrl(symbol) {
  return 'https://www.mexc.com/en-GB/futures/' + spotToFutures(symbol) + '?type=linear_swap'
}
function onPairClick(e, symbol) {
  const url = pairUrl(symbol)
  try { navigator.clipboard && navigator.clipboard.writeText(url) } catch {}
  if (e.ctrlKey) { try { window.open(url, '_blank') } catch {} }
}
function onRowClick(e, symbol) {
  const url = pairUrl(symbol)
  try { navigator.clipboard && navigator.clipboard.writeText(url) } catch {}
  if (e.ctrlKey) { try { window.open(url, '_blank') } catch {} }
}

function upCount(ph) {
  if (!ph || ph.length < 2) return 0
  let cnt = 0, steps = 0
  for (let i = ph.length - 1; i > 0 && steps < 20; i--, steps++) {
    const cur = Number(ph[i].p)
    const prev = Number(ph[i-1].p)
    if (Number.isNaN(cur) || Number.isNaN(prev)) continue
    if (cur > prev) cnt++
  }
  return cnt
}
function downCount(ph) {
  if (!ph || ph.length < 2) return 0
  let cnt = 0, steps = 0
  for (let i = ph.length - 1; i > 0 && steps < 20; i--, steps++) {
    const cur = Number(ph[i].p)
    const prev = Number(ph[i-1].p)
    if (Number.isNaN(cur) || Number.isNaN(prev)) continue
    if (cur < prev) cnt++
  }
  return cnt
}
function upStreak(ph) {
  if (!ph || ph.length < 2) return 0
  let cnt = 0
  for (let i = ph.length - 1; i > 0 && cnt < 20; i--) {
    const cur = Number(ph[i].p)
    const prev = Number(ph[i-1].p)
    if (Number.isNaN(cur) || Number.isNaN(prev)) break
    if (cur > prev) cnt++
    else break
  }
  return cnt
}
function downStreak(ph) {
  if (!ph || ph.length < 2) return 0
  let cnt = 0
  for (let i = ph.length - 1; i > 0 && cnt < 20; i--) {
    const cur = Number(ph[i].p)
    const prev = Number(ph[i-1].p)
    if (Number.isNaN(cur) || Number.isNaN(prev)) break
    if (cur < prev) cnt++
    else break
  }
  return cnt
}

function useAgg(intervalSec, token, onRefresh) {
  const [rows, setRows] = useState([])
  const timerRef = useRef(null)
  const authTokenRef = useRef(token || null)

  useEffect(() => {
    authTokenRef.current = token || null
    const headers = authTokenRef.current ? { Authorization: 'Bearer ' + authTokenRef.current } : {}

    let alive = true
    async function load() {
      try {
        const res = await fetch(`/api/agg/latest?intervalSec=${intervalSec}&limit=20`, { headers })
        const arr = await res.json()
        const map = new Map()
        for (const r of arr) {
          const list = map.get(r.symbol) || []
          list.push({ p: Number(r.p), ts: Number(r.ts) })
          map.set(r.symbol, list)
        }
        const out = []
        for (const [symbol, hist] of map.entries()) {
          hist.sort((a,b) => a.ts - b.ts)
          out.push({ symbol, history: hist })
        }
        if (alive) { setRows(out); try { onRefresh && onRefresh(intervalSec, Date.now()) } catch {} }
      } catch {}
    }
    load()
    timerRef.current = setInterval(load, intervalSec * 1000)
    return () => { alive = false; if (timerRef.current) clearInterval(timerRef.current) }
  }, [intervalSec, token])

  useEffect(() => {
    let ws
    try {
      const tok = authTokenRef.current
      const sockUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stream` + (tok ? ('?auth=' + encodeURIComponent(tok)) : '')
      ws = new WebSocket(sockUrl)
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'agg') {
            const items = Array.isArray(msg.data) ? msg.data : []
            const ours = items.filter(it => Number(it.intervalSec) === intervalSec)
            if (!ours.length) return
            setRows(prev => {
              const map = new Map(prev.map(r => [r.symbol, r.history.slice()]))
              for (const it of ours) {
                const hist = map.get(it.symbol) || []
                hist.push({ p: Number(it.p), ts: Number(it.ts) })
                if (hist.length > 20) hist.shift()
                map.set(it.symbol, hist)
              }
              return Array.from(map.entries()).map(([symbol, history]) => ({ symbol, history }))
            })
            try { onRefresh && onRefresh(intervalSec, Date.now()) } catch {}
          }
        } catch {}
      }
    } catch {}
    return () => { try { ws && ws.close() } catch {} }
  }, [intervalSec, token])

  return rows
}

function Section({ intervalSec, label, orderMode, token, onRefresh, selectedSymbol, onSelect }) {
  const rows = useAgg(intervalSec, token, onRefresh)
  const sorted = useMemo(() => {
    const arr = rows.slice()
    arr.sort((a,b) => {
      const sa = orderMode === 'mixed' ? (upStreak(a.history) + upCount(a.history) - downCount(a.history) - downStreak(a.history)) : (
        orderMode === 'upcount' ? upCount(a.history) : (
        orderMode === 'downcount' ? downCount(a.history) : (
        orderMode === 'downstreak' ? downStreak(a.history) : upStreak(a.history))))
      const sb = orderMode === 'mixed' ? (upStreak(b.history) + upCount(b.history) - downCount(b.history) - downStreak(b.history)) : (
        orderMode === 'upcount' ? upCount(b.history) : (
        orderMode === 'downcount' ? downCount(b.history) : (
        orderMode === 'downstreak' ? downStreak(b.history) : upStreak(b.history))))
      if (sb !== sa) return sb - sa
      const al = a.history.length ? Number(a.history[a.history.length-1].p) : NaN
      const bl = b.history.length ? Number(b.history[b.history.length-1].p) : NaN
      if (!Number.isNaN(al) && !Number.isNaN(bl) && bl !== al) return bl - al
      return a.symbol.localeCompare(b.symbol)
    })
    return arr.slice(0,20)
  }, [rows, orderMode])

  return (
    <div className="section">
      <div className="section-title">{label}</div>
      <div className="layout">
        <div className="left">
          <table>
            <thead>
              <tr><th className="nowrap col-no">No</th><th className="nowrap col-pair">Pair</th>{orderMode==='upcount' && <th className="nowrap cell">Up-count</th>}{orderMode==='downcount' && <th className="nowrap cell">Down-count</th>}</tr>
            </thead>
            <tbody>
              {sorted.map((r,i) => (
                <tr key={r.symbol} className={'row ' + (selectedSymbol===r.symbol?'selected':'')} onClick={(e)=>{onRowClick(e,r.symbol); onSelect(r.symbol)}}><td className="num col-no">{i+1}</td><td className="col-pair copyable" title="Click to copy; Ctrl+Click to open" onClick={(e)=>onPairClick(e,r.symbol)}>{r.symbol.replace('_','/')}</td>{orderMode==='upcount' && <td className="num cell">{upCount(r.history)}</td>}{orderMode==='downcount' && <td className="num cell">{downCount(r.history)}</td>}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="right">
          <div className="rightScroller">
            <table>
              <thead>
                <tr>{[...Array(20)].map((_,i) => <th key={i} className="nowrap cell">{'p' + (20-i)}</th>)}</tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.symbol} className={'row ' + (selectedSymbol===r.symbol?'selected':'')} onClick={(e)=>{onRowClick(e,r.symbol); onSelect(r.symbol)}}>
                    {[...Array(20)].map((_,i) => {
                      const idx = r.history.length - 1 - i
                      const v = idx >= 0 ? r.history[idx] : null
                      const prev = idx - 1 >= 0 ? r.history[idx-1] : null
                      if (!(v && v.p != null)) return <td key={i} className="cell muted"></td>
                      const cur = Number(v.p)
                      const pn = prev && prev.p != null ? Number(prev.p) : null
                      let c = 'muted', arrow = '→'
                      if (pn != null && !Number.isNaN(pn)) {
                        if (cur > pn) { c = 'pos'; arrow = '↑' } else if (cur < pn) { c = 'neg'; arrow = '↓' } else { c = 'muted'; arrow = '→' }
                      }
                      return <td key={i} className={'num cell ' + c}>{arrow} {cur.toLocaleString(undefined,{maximumFractionDigits:6})}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [orderMode, setOrderMode] = useState('streak')
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('authToken') || null } catch { return null }
  })
  const [pw, setPw] = useState('')
  const [lastMap, setLastMap] = useState({})
  const [selectedSymbol, setSelectedSymbol] = useState(null)

  function onRefresh(intervalSec, ts) {
    setLastMap(prev => Object.assign({}, prev, { [intervalSec]: ts }))
  }

  function fmtRemain(intervalSec) {
    const last = lastMap[intervalSec] || Date.now()
    const ms = intervalSec * 1000 - (Date.now() - last)
    const s = Math.max(0, Math.floor(ms/1000))
    if (intervalSec < 3600) {
      const m = Math.floor(s/60), rs = s % 60
      return (m ? m + 'm ' : '') + rs + 's'
    }
    const h = Math.floor(s/3600), rm = Math.floor((s%3600)/60), rs = s % 60
    return h + 'h ' + rm + 'm ' + rs + 's'
  }

  async function submitLogin() {
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ password: pw }) })
      if (!res.ok) return
      const data = await res.json()
      const tok = data && data.token
      if (tok) { try { localStorage.setItem('authToken', tok) } catch {}; setToken(tok) }
    } catch {}
  }

  return (
    <div className="container">
      {!token && (
        <div style={{position:'fixed',inset:0,background:'#0f1115cc',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:'#171b24',border:'1px solid #2a3140',borderRadius:12,padding:20,minWidth:280,display:'flex',flexDirection:'column',gap:10}}>
            <div className="small muted">Enter password to unlock</div>
            <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Password" style={{padding:'8px 10px',borderRadius:8,border:'1px solid #2a3140',background:'#141821',color:'#e6e6e6',outline:'none'}} />
            <button onClick={submitLogin} style={{padding:'8px 10px',borderRadius:8,border:'1px solid #2a3140',background:'#17c964',color:'#0f1115',cursor:'pointer'}}>Unlock</button>
          </div>
        </div>
      )}
      <header className="sticky-wrap">
        <div className="toolbar">
          <div className="brand">MEXC Future Mini Tickers</div>
          {['streak','upcount','downstreak','downcount','mixed'].map(m => (
            <button key={m} className={'seg-option' + (orderMode===m?' active':'')} onClick={() => setOrderMode(m)}>{m==='streak'?'Up-streak':m==='downstreak'?'Down-streak':m==='upcount'?'Up-count':m==='downcount'?'Down-count':'Mixed'}</button>
          ))}
        </div>
      </header>
      <div className="sections-grid">
        {intervals.map(it => <Section key={it.id} intervalSec={it.sec} label={it.label} orderMode={orderMode} token={token} onRefresh={onRefresh} selectedSymbol={selectedSymbol} onSelect={setSelectedSymbol} />)}
      </div>
    </div>
  )
}
