import { useEffect, useRef, useState } from 'react'
import './index.css'

const windows = [
  { id: 'w5m', label: '5m', sec: 300 },
  { id: 'w10m', label: '10m', sec: 600 },
  { id: 'w30m', label: '30m', sec: 1800 },
  { id: 'w1h', label: '1h', sec: 3600 },
  { id: 'w4h', label: '4h', sec: 14400 },
  { id: 'w1d', label: '1d', sec: 86400 },
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
  try { navigator.clipboard && navigator.clipboard.writeText(url) } catch { void 0 }
  if (e.ctrlKey) { try { window.open(url, '_blank') } catch { void 0 } }
}
function onRowClick(e, symbol) {
  const url = pairUrl(symbol)
  if (e.ctrlKey) { try { window.open(url, '_blank') } catch { void 0 }; return }
  if ((e.detail || 1) >= 2) return
  try { navigator.clipboard && navigator.clipboard.writeText(url) } catch { void 0 }
}

function onRowDblClick(e, symbol) {
  const url = pairUrl(symbol)
  try { window.open(url, '_blank') } catch { void 0 }
}

function fmtNum(v, digits = 6) {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (Number.isNaN(n)) return ''
  if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function useMetrics(windowSec, token) {
  const [rows, setRows] = useState([])
  const timerRef = useRef(null)
  const authTokenRef = useRef(token || null)

  useEffect(() => {
    authTokenRef.current = token || null
    const headers = authTokenRef.current ? { Authorization: 'Bearer ' + authTokenRef.current } : {}
    let alive = true
    async function load() {
      try {
        const res = await fetch(`/api/metrics?window=${windowSec}&limit=100`, { headers })
        const arr = await res.json()
        const out = Array.isArray(arr) ? arr.map(r => ({ symbol: r.symbol, current: Number(r.current || r.price || NaN), min: Number(r.min || NaN), max: Number(r.max || NaN), changePct: Number(r.changePct || 0), minTs: Number(r.minTs || NaN), maxTs: Number(r.maxTs || NaN) })) : []
        out.sort((a,b) => Number(b.changePct || 0) - Number(a.changePct || 0))
        if (alive) setRows(out)
      } catch { void 0 }
    }
    load()
    timerRef.current = setInterval(load, 60000)
    return () => { alive = false; if (timerRef.current) clearInterval(timerRef.current) }
  }, [windowSec, token])

  return rows
}

function MetricsSection({ windowSec, label, token, selectedSymbol, onSelect }) {
  const rows = useMetrics(windowSec, token)
  const prevChangeRef = useRef({})
  useEffect(() => {
    try {
      const next = { ...prevChangeRef.current }
      for (const r of rows) { if (r && r.symbol) next[r.symbol] = Number(r.changePct || 0) }
      prevChangeRef.current = next
    } catch { void 0 }
  }, [rows])
  return (
    <div className="section">
      <div className="section-title">{label}</div>
      <table>
        <thead>
          <tr>
            <th className="nowrap col-no">No</th>
            <th className="nowrap col-pair">Pair</th>
            <th className="nowrap cell">Change %</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0,20).map((r,i) => (
            <tr key={r.symbol} className={'row ' + (selectedSymbol===r.symbol?'selected':'')} onClick={(e)=>{onRowClick(e,r.symbol); onSelect && onSelect(r.symbol)}} onDoubleClick={(e)=>onRowDblClick(e,r.symbol)}>
              <td className="num col-no">{i+1}</td>
              <td className="col-pair copyable" title="Click to copy; Ctrl+Click to open" onClick={(e)=>onPairClick(e,r.symbol)}>{r.symbol.replace('_','/')}</td>
              {(() => {
                const cls = (Number(r.minTs) < Number(r.maxTs)) ? 'pos' : (Number(r.minTs) > Number(r.maxTs) ? 'neg' : 'muted')
                const cur = Number(r.changePct || 0)
                return (
                  <>
                    <td className={'num cell '+cls}>{cur.toFixed(2)}%</td>
                  </>
                )
              })()}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('authToken') || null } catch { return null }
  })
  const [pw, setPw] = useState('')
  const [selectedSymbol, setSelectedSymbol] = useState(null)
  

  

  async function submitLogin() {
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ password: pw }) })
      if (!res.ok) return
      const data = await res.json()
      const tok = data && data.token
      if (tok) { try { localStorage.setItem('authToken', tok) } catch { void 0 }; setToken(tok) }
    } catch { void 0 }
  }

  async function initDb() {
    try {
      const ok = typeof window !== 'undefined' ? window.confirm('This will truncate DB tables. Proceed?') : false
      if (!ok) return
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = 'Bearer ' + token
      const res = await fetch('/api/admin/init-db', { method: 'POST', headers })
      if (!res.ok) { alert('Init failed'); return }
      try { const data = await res.json(); if (!(data && data.ok)) { alert('Init failed'); return } } catch { void 0 }
      alert('Database initialized')
    } catch {
      alert('Init failed')
    }
  }

  async function trim3d() {
    try {
      const ok = typeof window !== 'undefined' ? window.confirm('Delete histories older than 3 days?') : false
      if (!ok) return
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = 'Bearer ' + token
      const res = await fetch('/api/admin/trim-3d', { method: 'POST', headers })
      if (!res.ok) { alert('Trim failed'); return }
      try { const data = await res.json(); if (!(data && data.ok)) { alert('Trim failed'); return } } catch { void 0 }
      alert('Trim completed')
    } catch {
      alert('Trim failed')
    }
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
          <div className="brand"><span style={{display:'inline-flex',alignItems:'center',gap:6}}><svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#0f1115"/><path d="M4 16l5-5 4 3 7-7" stroke="#17c964" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg> Keep Ruls for Success!</span></div>
          <div style={{ marginLeft: 'auto' }}></div>
          <button className={'seg-option'} onClick={initDb}>Init DB</button>
          <button className={'seg-option'} onClick={trim3d}>Trim to 3 days</button>
        </div>
      </header>
      <div className="sections-grid">
        {windows.map(it => <MetricsSection key={it.id} windowSec={it.sec} label={it.label} token={token} selectedSymbol={selectedSymbol} onSelect={setSelectedSymbol} />)}
      </div>
    </div>
  )
}
