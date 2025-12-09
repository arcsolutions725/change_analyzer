import { useEffect, useRef, useState } from 'react'
import './index.css'

const windows = [
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
  } catch { void 0 }
  try {
    const ta = document.createElement('textarea')
    ta.value = String(text)
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus(); ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  } catch { void 0 }
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

function useBatchMetrics(token) {
  const [rowsByWindow, setRowsByWindow] = useState({})
  const [nextRefreshTs, setNextRefreshTs] = useState(null)
  const timerRef = useRef(null)
  const initialDelayRef = useRef(null)
  const authTokenRef = useRef(token || null)
  useEffect(() => {
    authTokenRef.current = token || null
    const headers = authTokenRef.current ? { Authorization: 'Bearer ' + authTokenRef.current } : {}
    let alive = true
    async function load() {
      try {
        const winList = windows.map(w => w.sec).join(',')
        const res = await fetch(`/api/metrics/batch?windows=${winList}&limit=20`, { headers })
        if (res.status === 401) {
          try { localStorage.removeItem('authToken') } catch { void 0 }
          setRowsByWindow({})
          setNextRefreshTs(Date.now() + 20000)
          return
        }
        const obj = await res.json()
        const out = {}
        try {
          for (const k of Object.keys(obj || {})) {
            const sec = Number(k)
            const arr = Array.isArray(obj[k]) ? obj[k] : []
            out[sec] = arr.map(r => ({ symbol: r.symbol, changePct: Number(r.changePct || 0), minTs: Number(r.minTs || NaN), maxTs: Number(r.maxTs || NaN) }))
          }
        } catch { }
        if (alive) setRowsByWindow(out)
      } catch { }
      setNextRefreshTs(Date.now() + 20000)
    }
    if (initialDelayRef.current == null) initialDelayRef.current = Math.floor(Math.random() * 500)
    setNextRefreshTs(Date.now() + initialDelayRef.current)
    setTimeout(async () => { await load() }, initialDelayRef.current)
    timerRef.current = setInterval(() => { load() }, 20000)
    return () => { alive = false; if (timerRef.current) clearInterval(timerRef.current) }
  }, [token])
  return { rowsByWindow, nextRefreshTs }
}

function MetricsSection({ windowSec, label, rows, nextRefreshTs, selectedSymbol, onSelectSymbol, ignoredSet, onRequestIgnore }) {
  const prevTopRef = useRef(new Set())
  const [highlightSet, setHighlightSet] = useState(new Set())
  const countsRef = useRef(new Map())
  const [rankCounts, setRankCounts] = useState({})
  const [remainSec, setRemainSec] = useState(0)
  const pressTimerRef = useRef(null)
  const didLongPressRef = useRef(false)
  const [sortMode, setSortMode] = useState('change')
  const [sortDir, setSortDir] = useState('desc')
  useEffect(() => {
    try {
      const t = localStorage.getItem('sort:'+String(windowSec))
      if (t) {
        const o = JSON.parse(t)
        if (o && (o.mode==='count' || o.mode==='change')) setTimeout(() => { setSortMode(o.mode) }, 0)
        if (o && (o.dir==='asc' || o.dir==='desc')) setTimeout(() => { setSortDir(o.dir) }, 0)
      }
    } catch { void 0 }
  }, [windowSec])
  useEffect(() => {
    try { localStorage.setItem('sort:'+String(windowSec), JSON.stringify({ mode: sortMode, dir: sortDir })) } catch { void 0 }
  }, [windowSec, sortMode, sortDir])
  function handleRowClick(e, symbol) { if (didLongPressRef.current) { didLongPressRef.current = false; return } onSelectSymbol(symbol); onRowClick(e, symbol) }
  function handlePairClick(e, symbol) { onSelectSymbol(symbol); onPairClick(e, symbol) }
  function startPress(symbol) {
    clearTimeout(pressTimerRef.current)
    didLongPressRef.current = false
    pressTimerRef.current = setTimeout(() => { didLongPressRef.current = true; onRequestIgnore(symbol) }, 600)
  }
  function endPress() { clearTimeout(pressTimerRef.current); pressTimerRef.current = null }
  function toggleSort(mode) {
    if (sortMode === mode) { setSortDir(d => d === 'desc' ? 'asc' : 'desc') } else { setSortMode(mode); setSortDir('desc') }
  }
  function metricVal(r) { return sortMode === 'count' ? Number((rankCounts && rankCounts[r.symbol]) || 0) : Number(r.changePct || 0) }
  const displayedRows = (() => {
    const filtered = rows.filter(rr => !(ignoredSet && ignoredSet.has(rr.symbol)))
    const sorted = [...filtered].sort((a,b) => {
      const va = metricVal(a)
      const vb = metricVal(b)
      return sortDir === 'desc' ? (vb - va) : (va - vb)
    })
    return sorted.slice(0,20)
  })()
  useEffect(() => {
    try {
      const topSymbols = rows.slice(0,20).map(r=>r.symbol)
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
      const m = countsRef.current || new Map()
      const topSet = new Set(topSymbols)
      for (const s of topSymbols) { m.set(s, Number(m.get(s) || 0) + 1) }
      for (const [sym] of Array.from(m.entries())) { if (!topSet.has(sym)) m.set(sym, 0) }
      countsRef.current = m
      setRankCounts(Object.fromEntries(m.entries()))
    } catch { }
  }, [rows])
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
            <th className="nowrap col-no"><div className="hdr"><span>Count</span><button className={'hdr-btn ' + (sortMode==='count' ? 'active' : '')} onClick={()=>toggleSort('count')}>{sortMode==='count' && sortDir==='desc' ? '▼' : '▲'}</button></div></th>
            <th className="nowrap col-pair">Pair</th>
            <th className="nowrap cell"><div className="hdr"><span>Change %</span><button className={'hdr-btn ' + (sortMode==='change' ? 'active' : '')} onClick={()=>toggleSort('change')}>{sortMode==='change' && sortDir==='desc' ? '▼' : '▲'}</button></div></th>
          </tr>
        </thead>
        <tbody>
          {displayedRows.map((r) => (
            <tr key={r.symbol} className={'row ' + (selectedSymbol === r.symbol ? 'selected ' : '') + (highlightSet && highlightSet.has(r.symbol) ? 'new' : '')} onMouseDown={()=>startPress(r.symbol)} onMouseUp={endPress} onMouseLeave={endPress} onClick={(e)=>{ handleRowClick(e,r.symbol) } } onDoubleClick={(e)=>onRowDblClick(e,r.symbol)}>
              <td className="num col-no">{Number((rankCounts && rankCounts[r.symbol]) || 0)}</td>
              <td className="col-pair copyable" title="Click to copy; Ctrl+Click to open" onClick={(e)=>handlePairClick(e,r.symbol)}>{r.symbol.replace('_','/')}</td>
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
  const [selectedSymbol, setSelectedSymbol] = useState(null)
  const [pw, setPw] = useState('')
  const [missions, setMissions] = useState(() => {
    try {
      const t = localStorage.getItem('missions')
      const arr = t ? JSON.parse(t) : []
      return Array.isArray(arr) ? arr.map(x => (typeof x === 'string' ? { text: x, status: 'current' } : { text: String(x && x.text || ''), status: ['achieved','current','not_achieved'].includes(String(x && x.status)) ? String(x.status) : 'current' })) : []
    } catch { return [] }
  })
  const [ignoredTokens, setIgnoredTokens] = useState(() => {
    try {
      const t = localStorage.getItem('ignoredTokens')
      const arr = t ? JSON.parse(t) : []
      return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : []
    } catch { return [] }
  })
  const [rules, setRules] = useState(() => {
    try {
      const t = localStorage.getItem('rules')
      return t ? JSON.parse(t) : []
    } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem('rules', JSON.stringify(rules)) } catch { void 0 }
  }, [rules])
  useEffect(() => {
    try { localStorage.setItem('missions', JSON.stringify(missions)) } catch { void 0 }
  }, [missions])
  useEffect(() => {
    try { localStorage.setItem('ignoredTokens', JSON.stringify(ignoredTokens)) } catch { void 0 }
  }, [ignoredTokens])
  const [showRuleDlg, setShowRuleDlg] = useState(false)
  const [showMissionDlg, setShowMissionDlg] = useState(false)
  const [showIgnoredDlg, setShowIgnoredDlg] = useState(false)
  const [draftRules, setDraftRules] = useState([])
  const [draftMissions, setDraftMissions] = useState([])
  const [draftIgnored, setDraftIgnored] = useState([])
  const [newRuleText, setNewRuleText] = useState('')
  const [newMissionText, setNewMissionText] = useState('')
  const [newIgnoredText, setNewIgnoredText] = useState('')
  const [showConfirmIgnoreDlg, setShowConfirmIgnoreDlg] = useState(false)
  const [confirmIgnoreSymbol, setConfirmIgnoreSymbol] = useState(null)
  const [toastText, setToastText] = useState('')
  const toastTimerRef = useRef(null)
  const { rowsByWindow, nextRefreshTs } = useBatchMetrics(token)
  function openRuleManager() {
    setDraftRules(Array.isArray(rules) ? [...rules] : [])
    setNewRuleText('')
    setShowRuleDlg(true)
  }
  function openMissionManager() {
    setDraftMissions(Array.isArray(missions) ? missions.map(m => ({ text: String(m && m.text || ''), status: String(m && m.status || 'current') })) : [])
    setNewMissionText('')
    setShowMissionDlg(true)
  }
  function openIgnoredManager() {
    setDraftIgnored(Array.isArray(ignoredTokens) ? [...ignoredTokens] : [])
    setNewIgnoredText('')
    setShowIgnoredDlg(true)
    setTimeout(async () => { try { await loadIgnoredTokensFromServer(); setDraftIgnored(Array.isArray(ignoredTokens) ? [...ignoredTokens] : []) } catch { void 0 } }, 0)
  }
  function closeRuleManager() {
    setShowRuleDlg(false)
  }
  function closeMissionManager() {
    setShowMissionDlg(false)
  }
  function closeIgnoredManager() {
    setShowIgnoredDlg(false)
  }
  function saveRuleManager() {
    setRules(draftRules)
    setShowRuleDlg(false)
  }
  function saveMissionManager() {
    setMissions(draftMissions)
    setShowMissionDlg(false)
  }
  function saveIgnoredManager() {
    const uniq = Array.from(new Set(draftIgnored.filter(x => String(x).trim())))
    setIgnoredTokens(uniq)
    setShowIgnoredDlg(false)
    try { uploadIgnoredTokens(uniq) } catch (e) { void e }
  }
  function updateDraftRule(i, text) {
    setDraftRules(prev => prev.map((r, idx) => idx === i ? text : r))
  }
  function updateDraftMission(i, text) {
    setDraftMissions(prev => prev.map((r, idx) => idx === i ? { ...r, text } : r))
  }
  function setDraftMissionStatus(i, status) {
    const st = ['achieved','current','not_achieved'].includes(String(status)) ? String(status) : 'current'
    setDraftMissions(prev => prev.map((r, idx) => idx === i ? { ...r, status: st } : r))
  }
  function deleteDraftRule(i) {
    setDraftRules(prev => prev.filter((_, idx) => idx !== i))
  }
  function deleteDraftMission(i) {
    setDraftMissions(prev => prev.filter((_, idx) => idx !== i))
  }
  const editPrevRef = useRef(new Map())
  function updateDraftIgnored(i, text) {
    setDraftIgnored(prev => prev.map((r, idx) => idx === i ? String(text) : r))
  }
  async function commitDraftIgnored(i) {
    try {
      const prev = editPrevRef.current.get(i)
      const next = String(draftIgnored[i] || '').trim()
      if (!prev || !next || prev === next) return
      const ok = await serverRenameIgnore(prev, next)
      if (ok) {
        setIgnoredTokens(list => Array.from(new Set(list.map(x => (String(x) === prev ? next : x)))))
        showToast('Updated')
      } else {
        showToast('Update failed')
      }
    } catch { showToast('Update failed') }
  }
  async function deleteDraftIgnored(i) {
    const sym = String(draftIgnored[i] || '')
    setDraftIgnored(prev => prev.filter((_, idx) => idx !== i))
    try {
      const ok = await serverRemoveIgnore(sym)
      if (ok) {
        setIgnoredTokens(prev => prev.filter(x => String(x) !== sym))
        showToast('Removed')
      } else {
        showToast('Remove failed')
      }
    } catch { showToast('Remove failed') }
  }
  function addDraftRule() {
    const t = String(newRuleText || '').trim()
    if (!t) return
    setDraftRules(prev => [...prev, t])
    setNewRuleText('')
  }
  function addDraftMission() {
    const t = String(newMissionText || '').trim()
    if (!t) return
    setDraftMissions(prev => [...prev, { text: t, status: 'current' }])
    setNewMissionText('')
  }
  async function addDraftIgnored() {
    const t = String(newIgnoredText || '').trim()
    if (!t) return
    setDraftIgnored(prev => Array.from(new Set([...prev, t])))
    setNewIgnoredText('')
    try {
      const ok = await serverAddIgnore(t)
      if (ok) {
        setIgnoredTokens(prev => Array.from(new Set([...prev, t])))
        showToast('Added')
      } else {
        showToast('Add failed')
      }
    } catch { showToast('Add failed') }
  }
  
  async function uploadIgnoredTokens(list) {
    try {
      const headers = token ? { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } : { 'Content-Type': 'application/json' }
      const dedup = Array.from(new Set((Array.isArray(list) ? list : []).map(x => String(x).trim()).filter(Boolean)))
      const res = await fetch('/api/ignored-tokens', { method: 'POST', headers, body: JSON.stringify({ tokens: dedup }) })
      if (!res.ok) return false
      return true
    } catch { return false }
  }
  async function serverAddIgnore(sym) {
    try {
      console.log(sym)
      const headers = token ? { 'Content-Type':'application/json', Authorization: 'Bearer ' + token } : { 'Content-Type':'application/json' }
      const res = await fetch('/api/ignored-tokens/add', { method: 'POST', headers, body: JSON.stringify({ symbol: String(sym) }) })
      console.log(res.status)
      if (res.ok) return true
      const status = res.status
      if (status === 404 || status === 405) {
        const next = Array.from(new Set([...(ignoredTokens || []), String(sym)]))
        return await uploadIgnoredTokens(next)
      }
      return false
    } catch { return false }
  }
  async function serverRemoveIgnore(sym) {
    try {
      const headers = token ? { 'Content-Type':'application/json', Authorization: 'Bearer ' + token } : { 'Content-Type':'application/json' }
      const res = await fetch('/api/ignored-tokens/remove', { method: 'POST', headers, body: JSON.stringify({ symbol: String(sym) }) })
      if (res.ok) return true
      const status = res.status
      if (status === 404 || status === 405) {
        const next = Array.from((ignoredTokens || []).filter(x => String(x) !== String(sym)))
        return await uploadIgnoredTokens(next)
      }
      return false
    } catch { return false }
  }
  async function serverRenameIgnore(oldSym, nextSym) {
    try {
      const headers = token ? { 'Content-Type':'application/json', Authorization: 'Bearer ' + token } : { 'Content-Type':'application/json' }
      const res = await fetch('/api/ignored-tokens/rename', { method: 'POST', headers, body: JSON.stringify({ old: String(oldSym), next: String(nextSym) }) })
      if (res.ok) return true
      const status = res.status
      if (status === 404 || status === 405) {
        const next = Array.from(new Set((ignoredTokens || []).map(x => (String(x) === String(oldSym) ? String(nextSym) : String(x)))))
        return await uploadIgnoredTokens(next)
      }
      return false
    } catch { return false }
  }
  async function loadIgnoredTokensFromServer() {
    try {
      const headers = token ? { Authorization: 'Bearer ' + token } : {}
      const res = await fetch('/api/ignored-tokens', { method: 'GET', headers })
      if (!res.ok) return false
      const data = await res.json()
      const serverList = Array.from(new Set((Array.isArray(data && data.tokens) ? data.tokens : []).map(x => String(x)).filter(Boolean)))
      setIgnoredTokens(serverList)
      return true
    } catch { return false }
  }
  function requestIgnoreToken(symbol) {
    setConfirmIgnoreSymbol(String(symbol))
    setShowConfirmIgnoreDlg(true)
  }
  async function confirmIgnoreNow() {
    if (confirmIgnoreSymbol) {
      try {
        const ok = await serverAddIgnore(String(confirmIgnoreSymbol))
        if (!ok) {
          showToast('Unlock required')
        }
        if (ok) {
          setIgnoredTokens(prev => Array.from(new Set([...prev, String(confirmIgnoreSymbol)])))
          await loadIgnoredTokensFromServer()
        }
      } catch { void 0 }
    }
    setShowConfirmIgnoreDlg(false)
    setConfirmIgnoreSymbol(null)
    try { showToast('Ignored ' + String(confirmIgnoreSymbol || '')) } catch { void 0 }
  }
  function cancelIgnoreNow() {
    setShowConfirmIgnoreDlg(false)
    setConfirmIgnoreSymbol(null)
  }
  function showToast(msg) {
    clearTimeout(toastTimerRef.current)
    setToastText(String(msg || ''))
    toastTimerRef.current = setTimeout(() => { setToastText('') }, 2400)
  }
  async function syncIgnoredNow() {
    try {
      await uploadIgnoredTokens(ignoredTokens)
      await loadIgnoredTokensFromServer()
      showToast('Synced ignored list')
    } catch {
      showToast('Sync failed')
    }
  }
  useEffect(() => {
    if (token) {
      try {
        setTimeout(async () => {
          try {
            const headers = { Authorization: 'Bearer ' + token }
            const res = await fetch('/api/ignored-tokens', { method: 'GET', headers })
            if (!res.ok) return
            const data = await res.json()
            const serverList = Array.from(new Set((Array.isArray(data && data.tokens) ? data.tokens : []).map(x => String(x)).filter(Boolean)))
            setIgnoredTokens(serverList)
          } catch { void 0 }
        }, 0)
      } catch { void 0 }
    }
  }, [token])
  

  

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
          
          <div className="rule-bar">
            {rules.map((r,i) => (
              <>
                <span key={i} className={('rule-chip ' + (/!/.test(String(r)) ? 'warn' : ''))}><span className="text nowrap">{r}</span></span>
                {i < rules.length - 1 ? <span className="rule-sep" /> : null}
              </>
            ))}
          </div>
          <div className="mission-bar">
            {missions.map((m,i) => (
              <>
                <span key={i} className={'mission-chip ' + String(m && m.status || 'current')}><span className="icon">{String(m && m.status)==='achieved' ? '✓' : (String(m && m.status)==='current' ? '•' : '✗')}</span><span className="text nowrap">{String(m && m.text || '')}</span></span>
                {i < missions.length - 1 ? <span className="rule-sep" /> : null}
              </>
            ))}
          </div>
          <div className="toolbar-spacer" />
          <button className={'seg-option'} onClick={openRuleManager} title="Manage Rules"><svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16M4 12h16M4 18h16" stroke="#e6e6e6" strokeWidth="2" fill="none" strokeLinecap="round"/></svg></button>
          <button className={'seg-option'} onClick={openMissionManager} title="Manage Missions"><svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M6 4v16" stroke="#e6e6e6" strokeWidth="2" strokeLinecap="round"/><path d="M6 4h11l-4 3 4 3H6" fill="#e6e6e6"/></svg></button>
          <button className={'seg-option'} onClick={openIgnoredManager} title="Manage Ignored"><svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8" stroke="#e6e6e6" strokeWidth="2" fill="none"/><path d="M5 5l14 14" stroke="#e6e6e6" strokeWidth="2" strokeLinecap="round"/></svg></button>
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
      {showMissionDlg && (
        <div style={{position:'fixed',inset:0,background:'#0f1115cc',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:'#171b24',border:'1px solid #2a3140',borderRadius:12,padding:20,minWidth:380,maxWidth:700,width:'60%'}}>
            <div style={{fontWeight:600,marginBottom:8}}>Manage Missions</div>
            <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:'50vh',overflow:'auto'}}>
              {draftMissions.map((r,i) => (
                <div key={i} style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input className="rule-input" value={String(r && r.text || '')} onChange={e=>updateDraftMission(i, e.target.value)} placeholder="Mission" />
                  <div className="mission-status">
                    <button className={'mission-btn achieved '+ (String(r && r.status)==='achieved' ? 'active' : '')} onClick={()=>setDraftMissionStatus(i,'achieved')}>Achieved</button>
                    <button className={'mission-btn current '+ (String(r && r.status)==='current' ? 'active' : '')} onClick={()=>setDraftMissionStatus(i,'current')}>Current</button>
                    <button className={'mission-btn not_achieved '+ (String(r && r.status)==='not_achieved' ? 'active' : '')} onClick={()=>setDraftMissionStatus(i,'not_achieved')}>Non-achieved</button>
                  </div>
                  <button className="seg-option" onClick={()=>deleteDraftMission(i)}>Delete</button>
                </div>
              ))}
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <input className="rule-input" placeholder="New mission" value={newMissionText} onChange={e=>setNewMissionText(e.target.value)} onKeyDown={e=>{ if (e.key==='Enter') addDraftMission() }} />
                <button className="seg-option" onClick={addDraftMission}>Add</button>
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:12}}>
              <button className="seg-option" onClick={closeMissionManager}>Cancel</button>
              <button className="seg-option active" onClick={saveMissionManager}>Save</button>
            </div>
          </div>
        </div>
      )}
      {showIgnoredDlg && (
        <div style={{position:'fixed',inset:0,background:'#0f1115cc',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:'#171b24',border:'1px solid #2a3140',borderRadius:12,padding:20,minWidth:380,maxWidth:700,width:'60%'}}>
            <div style={{fontWeight:600,marginBottom:8}}>Manage Ignored Tokens</div>
            <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:'50vh',overflow:'auto'}}>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <input className="rule-input" placeholder="New symbol" value={newIgnoredText} onChange={e=>setNewIgnoredText(e.target.value)} onKeyDown={e=>{ if (e.key==='Enter') addDraftIgnored() }} />
                <button className="seg-option" onClick={addDraftIgnored}>Add</button>
              </div>
              {draftIgnored.map((r,i) => (
                <div key={i} style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input className="rule-input" value={String(r || '')} onFocus={()=>{ editPrevRef.current.set(i, String(r || '')) }} onBlur={()=>commitDraftIgnored(i)} onChange={e=>updateDraftIgnored(i, e.target.value)} placeholder="Symbol (e.g., BTC_USDT)" />
                  <button className="seg-option" onClick={()=>deleteDraftIgnored(i)}>Delete</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:12}}>
              <button className="seg-option" onClick={closeIgnoredManager}>Cancel</button>
              <button className="seg-option" onClick={syncIgnoredNow}>Sync</button>
              <button className="seg-option active" onClick={saveIgnoredManager}>Save</button>
            </div>
          </div>
        </div>
      )}
      {showConfirmIgnoreDlg && (
        <div style={{position:'fixed',inset:0,background:'#0f1115cc',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:'#171b24',border:'1px solid #2a3140',borderRadius:12,padding:20,minWidth:320}}>
            <div style={{fontWeight:600,marginBottom:8}}>Ignore Token</div>
            <div className="small">Add <span className="text nowrap">{String(confirmIgnoreSymbol || '')}</span> to ignored list?</div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:12}}>
              <button className="seg-option" onClick={cancelIgnoreNow}>Cancel</button>
              <button className="seg-option active" onClick={confirmIgnoreNow}>Ignore</button>
            </div>
          </div>
        </div>
      )}
      {toastText && (
        <div style={{position:'fixed',right:16,bottom:16,zIndex:9999}}>
          <div className="toast">{toastText}</div>
        </div>
      )}
      <div className="sections-grid">
        {windows.map(it => <MetricsSection key={it.id} windowSec={it.sec} label={it.label} rows={(rowsByWindow[it.sec] || [])} nextRefreshTs={nextRefreshTs} selectedSymbol={selectedSymbol} onSelectSymbol={setSelectedSymbol} ignoredSet={new Set(ignoredTokens)} onRequestIgnore={requestIgnoreToken} />)}
      </div>
    </div>
  )
}
