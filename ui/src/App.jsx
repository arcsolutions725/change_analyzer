import { useEffect, useRef, useState } from 'react'
import './index.css'

const windows = [
  { id: 'w40s', label: '40s', sec: 40 },
  { id: 'w1m', label: '1m', sec: 60 },
  { id: 'w2m', label: '2m', sec: 120 },
  { id: 'w5m', label: '5m', sec: 300 },
  { id: 'w10m', label: '10m', sec: 600 },
  { id: 'w1h', label: '1h', sec: 3600 },
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
function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text))
      return
    }
  } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = String(text)
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus(); ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  } catch {}
}
function copyTokenCompact(symbol) {
  copyText(String(symbol).replace('_',''))
}
function onPairClick(e, symbol) {
  e.stopPropagation()
  copyTokenCompact(symbol)
  if (e.ctrlKey) { try { window.open(pairUrl(symbol), '_blank') } catch { void 0 } }
}
function onRowClick(e, symbol) {
  if (e.ctrlKey) { try { window.open(pairUrl(symbol), '_blank') } catch { void 0 }; return }
  if ((e.detail || 1) >= 2) return
  copyTokenCompact(symbol)
}

function onRowDblClick(e, symbol) {
  const url = pairUrl(symbol)
  try { window.open(url, '_blank') } catch { void 0 }
}

function useMetrics(windowSec, token) {
  const [rows, setRows] = useState([])
  const timerRef = useRef(null)
  const authTokenRef = useRef(token || null)
  const initialDelayRef = useRef(null)
  const prevTopRef = useRef(new Set())
  const [highlightSet, setHighlightSet] = useState(new Set())
  // lastRefreshAt was replaced by nextRefreshTs flow; kept only nextRefreshTs
  const [nextRefreshTs, setNextRefreshTs] = useState(null)

  useEffect(() => {
    authTokenRef.current = token || null
    const headers = authTokenRef.current ? { Authorization: 'Bearer ' + authTokenRef.current } : {}
    let alive = true
    async function load() {
      try {
        const res = await fetch(`/api/metrics?window=${windowSec}&limit=100`, { headers })
        if (res.status === 401) {
          try { localStorage.removeItem('authToken') } catch {}
          setRows([])
          setNextRefreshTs(Date.now() + 20000)
          return
        }
        const arr = await res.json()
        const out = Array.isArray(arr) ? arr.map(r => ({ symbol: r.symbol, current: Number(r.current || r.price || NaN), min: Number(r.min || NaN), max: Number(r.max || NaN), changePct: Number(r.changePct || 0), minTs: Number(r.minTs || NaN), maxTs: Number(r.maxTs || NaN) })) : []
        out.sort((a,b) => Number(b.changePct || 0) - Number(a.changePct || 0))
        if (alive) {
          setRows(out)
          try {
            const topSymbols = out.slice(0,20).map(r=>r.symbol)
            const prevSet = prevTopRef.current || new Set()
            let changed = false
            if (prevSet.size !== topSymbols.length) changed = true
            if (!changed) {
              for (const s of topSymbols) { if (!prevSet.has(s)) { changed = true; break } }
              if (!changed) {
                for (const s of prevSet) { if (!topSymbols.includes(s)) { changed = true; break } }
              }
            }
            if (changed) {
              const ns = new Set()
              for (const s of topSymbols) { if (!prevSet.has(s)) ns.add(s) }
              setHighlightSet(ns)
              prevTopRef.current = new Set(topSymbols)
            }
          } catch { void 0 }
        }
      } catch { void 0 }
      setNextRefreshTs(Date.now() + 20000)
    }
    if (initialDelayRef.current == null) initialDelayRef.current = Math.floor(Math.random() * 500)
    setNextRefreshTs(Date.now() + initialDelayRef.current)
    setTimeout(async () => { await load() }, initialDelayRef.current)
    timerRef.current = setInterval(() => { load() }, 20000)
    return () => { alive = false; if (timerRef.current) clearInterval(timerRef.current) }
  }, [windowSec, token])

  return { rows, highlightSet, nextRefreshTs }
}

function MetricsSection({ windowSec, label, token }) {
  const { rows, highlightSet, nextRefreshTs } = useMetrics(windowSec, token)
  const [remainSec, setRemainSec] = useState(0)
  useEffect(() => {
    function update() {
      if (nextRefreshTs != null) {
        const s = Math.max(0, Math.ceil((nextRefreshTs - Date.now())/1000))
        setRemainSec(s)
      }
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [nextRefreshTs])
  return (
    <div className="section" data-sec={windowSec} data-remain={remainSec}>
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
            <tr key={r.symbol} className={'row'} onClick={(e)=>{ onRowClick(e,r.symbol) } } onDoubleClick={(e)=>onRowDblClick(e,r.symbol)}>
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
  const [rules, setRules] = useState(() => {
    try {
      const t = localStorage.getItem('rules')
      return t ? JSON.parse(t) : []
    } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem('rules', JSON.stringify(rules)) } catch { void 0 }
  }, [rules])
  const [globalRemain, setGlobalRemain] = useState('')
  useEffect(() => {
    function computeGlobalRemain() {
      try {
        const secs = windows.map(w => {
          const u = document.querySelector(`[data-sec="${w.sec}"]`)
          if (!u) return null
          const t = Number(u.getAttribute('data-remain') || '0')
          return Number.isFinite(t) ? t : null
        }).filter(v => v != null)
        if (secs.length === 0) { setGlobalRemain(''); return }
        const min = Math.min(...secs)
        setGlobalRemain(String(min) + 's')
      } catch { setGlobalRemain('') }
    }
    const id = setInterval(computeGlobalRemain, 1000)
    computeGlobalRemain()
    return () => clearInterval(id)
  }, [])
  const [showRuleDlg, setShowRuleDlg] = useState(false)
  const [draftRules, setDraftRules] = useState([])
  const [newRuleText, setNewRuleText] = useState('')
  function openRuleManager() {
    setDraftRules(Array.isArray(rules) ? [...rules] : [])
    setNewRuleText('')
    setShowRuleDlg(true)
  }
  function closeRuleManager() {
    setShowRuleDlg(false)
  }
  function saveRuleManager() {
    setRules(draftRules)
    setShowRuleDlg(false)
  }
  function updateDraftRule(i, text) {
    setDraftRules(prev => prev.map((r, idx) => idx === i ? text : r))
  }
  function deleteDraftRule(i) {
    setDraftRules(prev => prev.filter((_, idx) => idx !== i))
  }
  function addDraftRule() {
    const t = String(newRuleText || '').trim()
    if (!t) return
    setDraftRules(prev => [...prev, t])
    setNewRuleText('')
  }
  

  

  async function submitLogin() {
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ password: pw }) })
      if (!res.ok) return
      const data = await res.json()
      const tok = data && data.token
      if (tok) { try { localStorage.setItem('authToken', tok) } catch { void 0 }; setToken(tok) }
    } catch { void 0 }
  }

  

  

  return (
    <div className="container">
      {!token && (
        <div style={{position:'fixed',inset:0,background:'#0f1115cc',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:'#171b24',border:'1px solid #2a3140',borderRadius:12,padding:20,minWidth:280,display:'flex',flexDirection:'column',gap:10}}>
            <div className="small muted">Enter password to unlock</div>
            <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Password" style={{padding:'8px 10px',borderRadius:8,border:'1px solid #2a3140',background:'#141821',color:'#e6e6e6',outline:'none'}} />
            <button onClick={submitLogin} style={{padding:'8px 10px',borderRadius:8,border:'1px solid #2a3140',background:'#17c964',color:'#0f1115',cursor:'pointer'}}>Unlock</button>
            <div className="small muted">401 errors mean you need to unlock.</div>
          </div>
        </div>
      )}
      <header className="sticky-wrap">
        <div className="toolbar">
          <div className="brand"><span style={{display:'inline-flex',alignItems:'center',gap:6}}><svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#0f1115"/><path d="M4 16l5-5 4 3 7-7" stroke="#17c964" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg> Keep Rules for Success!</span></div>
          <div className="timers">Next refresh: {globalRemain}</div>
          <div className="rule-bar">
            {rules.map((r,i) => (
              <>
                <span key={i} className={('rule-chip ' + (/!/.test(String(r)) ? 'warn' : ''))}><span className="text nowrap">{r}</span></span>
                {i < rules.length - 1 ? <span className="rule-sep" /> : null}
              </>
            ))}
          </div>
          <div className="toolbar-spacer" />
          <button className={'seg-option'} onClick={openRuleManager}>Manage Rules</button>
        </div>
      </header>
      {showRuleDlg && (
        <div style={{position:'fixed',inset:0,background:'#0f1115cc',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:'#171b24',border:'1px solid #2a3140',borderRadius:12,padding:20,minWidth:380,maxWidth:700,width:'60%'}}>
            <div style={{fontWeight:600,marginBottom:8}}>Manage Rules</div>
            <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:'50vh',overflow:'auto'}}>
              {draftRules.map((r,i) => (
                <div key={i} style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input className="rule-input" value={r} onChange={e=>updateDraftRule(i, e.target.value)} placeholder="Rule (add ! to mark warning)" />
                  <button className="seg-option" onClick={()=>deleteDraftRule(i)}>Delete</button>
                </div>
              ))}
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <input className="rule-input" placeholder="New rule" value={newRuleText} onChange={e=>setNewRuleText(e.target.value)} onKeyDown={e=>{ if (e.key==='Enter') addDraftRule() }} />
                <button className="seg-option" onClick={addDraftRule}>Add</button>
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:12}}>
              <button className="seg-option" onClick={closeRuleManager}>Cancel</button>
              <button className="seg-option active" onClick={saveRuleManager}>Save</button>
            </div>
          </div>
        </div>
      )}
      <div className="sections-grid">
        {windows.map(it => <MetricsSection key={it.id} windowSec={it.sec} label={it.label} token={token} />)}
      </div>
    </div>
  )
}
