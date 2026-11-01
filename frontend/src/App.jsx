import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CATEGORIES, CONTRACT_ADDRESS, CHAIN_ID, RPC_URL, connectWalletAddress,
  explorerAddress, explorerTx, parseRecord, readClient, reviewerClient,
  waitFinal, writeClient, fetchUtcPreview, countdownTo, sha256Hex, generateSalt,
} from './genlayer.js'
import { LANGS, STRINGS, categoryLabelFor } from './i18n.js'
import { createTimeEngine } from './sound.js'

function tomorrowISO() {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10)
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

// Scroll-reveal: content flows in (rises + scales) as it enters view.
function Reveal({ children, delay = 0 }) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect() }
    }, { threshold: 0.12 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return <div ref={ref} className={`reveal ${inView ? 'in' : ''}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>
}

// The whole page flows: a canvas river of drifting time-motes behind everything.
function ParticleCanvas() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf = 0, w = 0, h = 0, parts = []
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      w = window.innerWidth; h = window.innerHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const n = Math.min(90, Math.floor((w * h) / 18000))
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: 1 + Math.random() * 2.4, vy: 0.12 + Math.random() * 0.35,
        vx: (Math.random() - 0.5) * 0.2, ph: Math.random() * Math.PI * 2,
        c: ['232,180,74', '139,124,246', '45,212,191'][Math.floor(Math.random() * 3)],
      }))
    }
    function draw(t) {
      ctx.clearRect(0, 0, w, h)
      for (const p of parts) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 900 + p.ph))
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${p.c}, ${0.55 * tw})`
        ctx.fill()
        if (!reduced) {
          p.y -= p.vy; p.x += p.vx + 0.12 * Math.sin(t / 1600 + p.ph)
          if (p.y < -6) { p.y = h + 6; p.x = Math.random() * w }
          if (p.x < -6) p.x = w + 6
          if (p.x > w + 6) p.x = -6
        }
      }
      if (!reduced && !document.hidden) raf = requestAnimationFrame(draw)
    }
    resize()
    if (reduced) draw(0)
    else raf = requestAnimationFrame(draw)
    function onVis() { if (!document.hidden && !reduced) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw) } }
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  return <canvas className="river-canvas" ref={ref} aria-hidden="true" />
}

function shortSource(url) {
  if (!url) return '—'
  if (url.includes('timeapi')) return 'timeapi.io'
  if (url.includes('timezone')) return 'worldtime.timezone.io'
  return url
}

function truncHash(h) {
  if (!h) return '—'
  return `${h.slice(0, 10)}…${h.slice(-8)}`
}

// One vault card. Sealed cards show the public question + the truncated
// commitment (never the prediction — the chain does not have it), plus
// the reveal form and a browser-only local hash check. Revealed cards
// show the published prediction, reveal date and source.
function CapsuleCard({ c, t, lang, nowMs, canWrite, revealing, onReveal }) {
  const sealed = c.status === 'sealed'
  const cd = sealed ? countdownTo(c.unlock_date, nowMs) : null
  const [revPred, setRevPred] = useState('')
  const [revKey, setRevKey] = useState('')
  const [locPred, setLocPred] = useState('')
  const [locKey, setLocKey] = useState('')
  const [locResult, setLocResult] = useState(null)
  const [locBusy, setLocBusy] = useState(false)

  async function doLocalCheck() {
    if (!locPred || !locKey) return
    setLocBusy(true)
    try {
      const hash = await sha256Hex(locKey + '\n' + locPred)
      setLocResult(hash === c.commitment ? 'match' : 'mismatch')
    } catch { setLocResult('mismatch') }
    finally { setLocBusy(false) }
  }

  return (
    <article className={`cap tilt ${sealed ? 'cap-locked' : 'cap-unlocked'}`}>
      <div className="cap-top">
        <div>
          <div className="cap-title">{c.question}</div>
          <div className="cap-meta">#{c.id} · {categoryLabelFor(lang, c.category)} · {sealed ? `${t.featuredLocked} ${c.unlock_date}` : `${t.featuredUnlocked} ${c.revealed_date || ''}`}</div>
        </div>
        <span className={`badge ${sealed ? 'badge-locked' : 'badge-unlocked'}`}>{sealed ? t.locked : t.unlocked}</span>
      </div>
      {sealed && (
        <>
          <p className="cap-note"><span className="muted small">{t.commitmentShort}: </span><span className="mono">{truncHash(c.commitment)}</span></p>
          {cd && (
            <div className="countdown">
              <div><b>{cd.days}</b><span>{t.cdDays}</span></div>
              <div><b>{String(cd.hours).padStart(2, '0')}</b><span>{t.cdHours}</span></div>
              <div><b>{String(cd.mins).padStart(2, '0')}</b><span>{t.cdMins}</span></div>
              <div><b>{String(cd.secs).padStart(2, '0')}</b><span>{t.cdSecs}</span></div>
            </div>
          )}
          {!cd && <p className="ready">{t.revealReady}</p>}
          <div className="reveal-form">
            <p className="muted small">{t.revealFormHint}</p>
            <Field label={t.fieldRevealPrediction}><input value={revPred} onChange={e => setRevPred(e.target.value)} maxLength={500} placeholder="…" /></Field>
            <Field label={t.fieldRevealKey}><input value={revKey} onChange={e => setRevKey(e.target.value)} maxLength={64} placeholder="…" /></Field>
            <div className="actions">
              <button className="btn small gold" disabled={!canWrite || revealing || revPred.length < 2 || !revKey} onClick={() => onReveal(c.id, revPred, revKey)}>
                {revealing ? t.revealing : t.revealBtn}
              </button>
            </div>
            <details className="local-check">
              <summary>{t.localCheckTitle}</summary>
              <p className="muted small">{t.localCheckHint}</p>
              <Field label={t.fieldRevealPrediction}><input value={locPred} onChange={e => setLocPred(e.target.value)} maxLength={500} placeholder="…" /></Field>
              <Field label={t.fieldRevealKey}><input value={locKey} onChange={e => setLocKey(e.target.value)} maxLength={64} placeholder="…" /></Field>
              <button className="btn small ghost" disabled={locBusy || !locPred || !locKey} onClick={doLocalCheck}>{locBusy ? t.loading : t.localCheckBtn}</button>
              {locResult === 'match' && <p className="status">{locResult && t.localCheckMatch}</p>}
              {locResult === 'mismatch' && <p className="error">{t.localCheckMismatch}</p>}
              <p className="muted small">{t.localCheckNote}</p>
            </details>
          </div>
        </>
      )}
      {!sealed && (
        <>
          <p className="cap-note"><b>{t.revealedPredictionLabel}: </b>{c.revealed_prediction}</p>
          <p className="muted small">{t.revealedDateLabel} {c.revealed_date} · {t.sourceLabel}: {shortSource(c.source)}</p>
        </>
      )}
      <div className="cap-foot">
        <span className="mono">by {c.requester?.slice(0, 6)}…{c.requester?.slice(-4)}</span>
      </div>
    </article>
  )
}

export default function App() {
  const [lang, setLang] = useState(() => {
    try {
      const saved = localStorage.getItem('ts-lang')
      return LANGS.some(l => l.id === saved) ? saved : 'en'
    } catch { return 'en' }
  })
  const t = STRINGS[lang] || STRINGS.en
  const [soundOn, setSoundOn] = useState(false)
  const soundRef = useRef(null)
  if (!soundRef.current) soundRef.current = createTimeEngine()
  const [intro, setIntro] = useState(() => {
    try {
      if (sessionStorage.getItem('ts-intro-seen')) return false
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
      return true
    } catch { return false }
  })
  const [introLeaving, setIntroLeaving] = useState(false)

  // Commit form state. The prediction and salt live only in this
  // browser; only the computed commitment is ever sent on-chain.
  const [question, setQuestion] = useState('')
  const [prediction, setPrediction] = useState('')
  const [showPrediction, setShowPrediction] = useState(false)
  const [salt, setSalt] = useState('')
  const [commitment, setCommitment] = useState('')
  const [copiedKey, setCopiedKey] = useState(false)
  const [category, setCategory] = useState(CATEGORIES[0])
  const [unlockDate, setUnlockDate] = useState(tomorrowISO())
  const [wallet, setWallet] = useState(null)
  const [client, setClient] = useState(null)
  const [snapFailed, setSnapFailed] = useState(false)
  const [walletMode, setWalletMode] = useState(null)
  const [ephemeralAddress, setEphemeralAddress] = useState(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [tx, setTx] = useState(null)
  const [utcCheck, setUtcCheck] = useState(null)
  const [utcBusy, setUtcBusy] = useState(false)
  const [capsules, setCapsules] = useState([])
  const [listBusy, setListBusy] = useState(false)
  const [revealingId, setRevealingId] = useState(null)
  const [createdId, setCreatedId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [nowMs, setNowMs] = useState(Date.now())
  const [utcClock, setUtcClock] = useState(null)
  const minDate = tomorrowISO()
  const configured = Boolean(CONTRACT_ADDRESS)

  useEffect(() => {
    try { localStorage.setItem('ts-lang', lang) } catch {}
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!intro) return
    const t1 = setTimeout(() => setIntroLeaving(true), 2100)
    const t2 = setTimeout(() => {
      setIntro(false)
      try { sessionStorage.setItem('ts-intro-seen', '1') } catch {}
    }, 2800)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [intro])

  function dismissIntro() {
    if (!intro || introLeaving) return
    setIntroLeaving(true)
    setTimeout(() => {
      setIntro(false)
      try { sessionStorage.setItem('ts-intro-seen', '1') } catch {}
    }, 450)
  }

  useEffect(() => {
    if (soundOn && /finalized/i.test(status)) soundRef.current.chime()
  }, [status, soundOn])

  useEffect(() => () => { soundRef.current.stop() }, [])

  function toggleSound() {
    if (soundOn) { soundRef.current.stop(); setSoundOn(false) }
    else if (soundRef.current.start()) setSoundOn(true)
  }

  // Recompute the commitment whenever the secret inputs change.
  useEffect(() => {
    if (prediction.length >= 2 && salt) {
      let live = true
      sha256Hex(salt + '\n' + prediction).then(h => { if (live) setCommitment(h) }).catch(() => {})
      return () => { live = false }
    }
    setCommitment('')
  }, [prediction, salt])

  // Mouse playfulness (fine pointers only): cursor glow, hero parallax,
  // card/panel tilt, magnetic hero CTAs. Everything resets on leave.
  const glowRef = useRef(null)
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return
    const glow = glowRef.current
    if (!glow) return
    let tx = window.innerWidth / 2, ty = window.innerHeight / 2, cx = tx, cy = ty
    let raf = 0, shown = false, lastTilt = null, lastMag = null
    const loop = () => {
      cx += (tx - cx) * 0.16; cy += (ty - cy) * 0.16
      glow.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    function onMove(e) {
      tx = e.clientX; ty = e.clientY
      if (!shown) { glow.classList.add('visible'); shown = true }
      glow.classList.toggle('big', Boolean(e.target.closest('a,button,.chip,input,select,textarea,.cap,.panel')))
      const hero = e.target.closest('.hero')
      if (hero) {
        const r = hero.getBoundingClientRect()
        hero.style.setProperty('--px', (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3))
        hero.style.setProperty('--py', (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3))
      }
      const tiltEl = e.target.closest('.tilt')
      if (tiltEl !== lastTilt) { if (lastTilt) lastTilt.style.transform = ''; lastTilt = tiltEl }
      if (tiltEl) {
        const r = tiltEl.getBoundingClientRect()
        const rx = (0.5 - (e.clientY - r.top) / r.height) * 6
        const ry = ((e.clientX - r.left) / r.width - 0.5) * 6
        tiltEl.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-2px)`
      }
      const magEl = e.target.closest('.magnetic')
      if (magEl !== lastMag) { if (lastMag) lastMag.style.transform = ''; lastMag = magEl }
      if (magEl) {
        const r = magEl.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
        magEl.style.transform = `translate(${(dx * 0.16).toFixed(1)}px, ${(dy * 0.16).toFixed(1)}px)`
      }
    }
    function onLeave() { glow.classList.remove('visible'); shown = false }
    document.addEventListener('mousemove', onMove)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousemove', onMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  async function loadCapsules() {
    if (!configured) return
    setListBusy(true)
    try {
      const c = readClient()
      const raw = await c.readContract({ address: CONTRACT_ADDRESS, functionName: 'list_capsules', args: [0n, 20n] })
      const list = parseRecord(raw)
      setCapsules(Array.isArray(list) ? list.slice().reverse() : [])
    } catch (e) {
      setError('Could not load capsules: ' + (e?.message || e))
    } finally { setListBusy(false) }
  }
  useEffect(() => { loadCapsules() }, [])

  async function doCheckTime() {
    setError(''); setUtcBusy(true)
    try {
      const res = await fetchUtcPreview()
      setUtcCheck(res)
      setUtcClock({ utcMs: Date.parse(res.utcDateTime) || Date.now(), fetchedAtMs: Date.now(), source: res.source, local: res.local })
    } catch (e) { setError('UTC check failed: ' + (e?.message || e)) }
    finally { setUtcBusy(false) }
  }
  useEffect(() => { doCheckTime() }, [])

  async function doConnect() {
    setError(''); setSnapFailed(false)
    try {
      const address = await connectWalletAddress()
      setWallet(address)
      const client = writeClient(address)
      try {
        await client.connect('studionet')
        setClient(client); setWalletMode('snap'); setStatus('Wallet connected on Stable Studionet (GenLayer Snap ready).')
      } catch (snapErr) {
        setSnapFailed(true)
        const msg = snapErr?.message || String(snapErr)
        setError(/wallet_getSnaps|wallet_requestSnaps|32601|method not found/i.test(msg)
          ? 'This wallet does not support MetaMask Snaps (wallet_getSnaps not found). GenLayer writes need desktop MetaMask with Snaps — or use the reviewer test account below, which works with any wallet.'
          : 'GenLayer Snap could not be installed in this wallet (' + msg + '). You can still continue with the reviewer test account below.')
      }
    } catch (e) { setError(e?.message || String(e)) }
  }

  function doUseReviewerAccount() {
    const { address, client } = reviewerClient()
    setEphemeralAddress(address); setClient(client); setWalletMode('ephemeral'); setSnapFailed(false); setError('')
    setStatus('Reviewer test account ready. Writes will be signed by this ephemeral Studionet account, not by your wallet.')
  }

  function doGenerateSalt() {
    setSalt(generateSalt(16)); setCopiedKey(false)
  }

  async function doCopyKey() {
    try {
      await navigator.clipboard.writeText(salt)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2500)
    } catch { /* clipboard unavailable: the key is still visible above */ }
  }

  async function doSeal() {
    if (!wallet || !client) { setError('Connect a wallet first.'); return }
    if (question.trim().length < 2 || question.trim().length > 120) { setError('Give the capsule a public question (2–120 chars) first.'); return }
    if (prediction.length < 2 || prediction.length > 500) { setError('Write a secret prediction (2–500 chars) first.'); return }
    if (!salt) { setError('Generate a reveal key first.'); return }
    if (!commitment || commitment.length !== 64) { setError('Commitment is not computed yet — wait a moment and try again.'); return }
    setError(''); setTx(null); setStatus('Submitting seal…')
    try {
      // Only question, commitment, category, unlock date go on-chain.
      // The prediction and salt are deliberately NOT arguments here.
      const hash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName: 'seal_capsule', args: [question.trim(), commitment, category, unlockDate], value: 0n, leaderOnly: false })
      setTx({ kind: 'Seal', hash }); setStatus('Seal submitted — waiting for GenLayer finalization…')
      await waitFinal(readClient(), hash, (s) => setStatus(s === 'finalized' ? 'Seal finalized.' : 'Seal submitted — waiting for GenLayer finalization…'))
      const countRaw = await readClient().readContract({ address: CONTRACT_ADDRESS, functionName: 'get_count', args: [] })
      const id = Number(countRaw) - 1
      setCreatedId(id); setStatus(`Seal finalized as capsule #${id}. ${t.sealReminder}`)
      await loadCapsules()
    } catch (e) { setError('Seal failed: ' + (e?.message || e)); setStatus('') }
  }

  async function doReveal(id, revPrediction, revSalt) {
    if (!wallet || !client) { setError('Connect a wallet first.'); return }
    setError(''); setRevealingId(id); setTx(null); setStatus(`Revealing #${id} — validators are independently checking the UTC date and the contract is re-checking the hash…`)
    try {
      const hash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName: 'reveal_capsule', args: [BigInt(id), revPrediction, revSalt], value: 0n, leaderOnly: false })
      setTx({ kind: 'Reveal', hash }); setStatus('Reveal submitted — waiting for validator consensus and finalization…')
      await waitFinal(readClient(), hash, (s) => setStatus(s === 'finalized' ? `Capsule #${id} revealed and finalized.` : 'Reveal submitted — waiting for validator consensus…'))
      await loadCapsules()
    } catch (e) { setError('Reveal failed (the capsule stays sealed and can be retried — most often this means its reveal date has not arrived yet, or the prediction/key do not match the commitment): ' + (e?.message || e)); setStatus('') }
    finally { setRevealingId(null) }
  }

  const sealed = capsules.filter(c => c.status === 'sealed')
  const revealed = capsules.filter(c => c.status === 'revealed')
  const featured = [...sealed].sort((a, b) => a.unlock_date.localeCompare(b.unlock_date))[0] || capsules[0]
  const featuredCd = featured && featured.status === 'sealed' ? countdownTo(featured.unlock_date, nowMs) : null
  const visible = capsules.filter(c => filter === 'all' || c.status === filter)
  const statusBusy = /waiting|submitting|revealing/i.test(status)
  const clockMs = utcClock ? utcClock.utcMs + (nowMs - utcClock.fetchedAtMs) : nowMs
  const clockText = new Date(clockMs).toISOString().slice(11, 19)
  const clockDate = new Date(clockMs).toISOString().slice(0, 10)
  const tickerItems = [
    `UTC ${clockText}`,
    ...capsules.slice(0, 6).map(c => `#${c.id} ${c.question} → ${c.status === 'sealed' ? c.unlock_date : 'revealed'}`),
    'TimeSeal v2 · hidden commitments, revealed by consensus',
  ]
  const ticker = [...tickerItems, ...tickerItems].join('  ✦  ')

  return (
    <div className="page">
      <ParticleCanvas />
      <div className="cursor-glow" ref={glowRef} aria-hidden="true" />
      {intro && (
        <div className={`intro ${introLeaving ? 'leaving' : ''}`} onClick={dismissIntro} role="button" aria-label={t.skipIntro}>
          <div className="intro-seal"><img src="./logo.svg" alt="TimeSeal logo" /></div>
          <div className="intro-title">TimeSeal</div>
          <div className="intro-tag">{t.introTag}</div>
          <div className="intro-bar"><i /></div>
          <div className="intro-skip">{t.skipIntro}</div>
        </div>
      )}

      <header className="top">
        <div className="brand"><img src="./logo.svg" alt="TimeSeal logo" /><div><b>TimeSeal</b><span>{t.brandTag}</span></div></div>
        <div className="top-right">
          <div className="langswitch" role="group" aria-label="Language">
            {LANGS.map(l => <button key={l.id} className={lang === l.id ? 'lang active' : 'lang'} onClick={() => setLang(l.id)}>{l.label}</button>)}
          </div>
          <button className={`soundbtn ${soundOn ? 'on' : ''}`} onClick={toggleSound} aria-pressed={soundOn} title={soundOn ? t.soundOff : t.soundOn}>
            {soundOn ? '♪ ' + t.soundOn : '♪ ' + t.soundOff}
          </button>
          <span className="net">Stable Studionet · {CHAIN_ID}</span>
          {wallet ? <span className="wallet mono">{wallet.slice(0, 6)}…{wallet.slice(-4)}{walletMode === 'ephemeral' && ephemeralAddress ? ` · test acct ${ephemeralAddress.slice(0, 6)}…${ephemeralAddress.slice(-4)}` : ''}</span> : <button className="btn gold" onClick={doConnect}>{t.connectWallet}</button>}
        </div>
      </header>

      <div className="ticker" aria-hidden="true"><div className="ticker-track">{ticker}</div></div>

      <section className="hero">
        <div>
          <p className="kicker"><i>✦</i> {t.kicker}</p>
          <h1>{t.heroPre}<em>{t.heroEm}</em>{t.heroPost}</h1>
          <p className="lede">{t.lede}</p>
          <div className="hero-actions">
            <a className="btn gold big magnetic" href="#seal" style={{ textDecoration: 'none' }}>{t.ctaSeal}</a>
            <a className="btn ghost magnetic" href="#vault" style={{ textDecoration: 'none' }}>{t.ctaVault}</a>
          </div>
          <p className="hero-note">{t.heroNote}</p>
          {!configured && <div className="warn">This build has no contract address configured yet. Set <code>VITE_CONTRACT_ADDRESS</code> and rebuild — browsing and the UTC check still work.</div>}
        </div>
        <div className="river-card tilt">
          <div className="river-top">
            <span className="eyebrow">{t.liveClock}</span>
            <span className="clock-live">● {t.utcLabel}</span>
          </div>
          <div className="big-clock">{clockText}</div>
          <div className="clock-date">{clockDate} · {utcClock ? utcClock.source : '…'}{utcClock?.local ? ' (browser)' : ''}</div>
          <div className="river-divider" />
          {featured ? (
            <>
              <div className="eyebrow">{featured.status === 'sealed' ? t.nextUnlock : t.featuredUnlocked}</div>
              <div className="river-place">{featured.question}</div>
              <div className="river-meta">{categoryLabelFor(lang, featured.category)} · #{featured.id} · {featured.status === 'sealed' ? `${t.featuredLocked} ${featured.unlock_date}` : `${t.featuredUnlocked} ${featured.revealed_date || ''}`}</div>
              {featuredCd && (
                <div className="countdown">
                  <div><b>{featuredCd.days}</b><span>{t.cdDays}</span></div>
                  <div><b>{String(featuredCd.hours).padStart(2, '0')}</b><span>{t.cdHours}</span></div>
                  <div><b>{String(featuredCd.mins).padStart(2, '0')}</b><span>{t.cdMins}</span></div>
                  <div><b>{String(featuredCd.secs).padStart(2, '0')}</b><span>{t.cdSecs}</span></div>
                </div>
              )}
            </>
          ) : (
            <p className="muted">{t.noLocked}</p>
          )}
        </div>
      </section>

      <Reveal>
        <section className="stats" aria-label="Live stats">
          <div className="stat"><b>{capsules.length}</b><span>{t.statTotal}</span></div>
          <div className="stat"><b>{sealed.length}</b><span>{t.statLocked}</span></div>
          <div className="stat"><b>{revealed.length}</b><span>{t.statUnlocked}</span></div>
          <div className="stat"><b>{clockDate}</b><span>{t.statUtcToday}</span></div>
        </section>
      </Reveal>

      <Reveal delay={80}>
        <ol className="steps">
          <li><div className="step-no">01</div><b>{t.step1Title}</b><span>{t.step1Desc}</span></li>
          <li><div className="step-no">02</div><b>{t.step2Title}</b><span>{t.step2Desc}</span></li>
          <li><div className="step-no">03</div><b>{t.step3Title}</b><span>{t.step3Desc}</span></li>
        </ol>
      </Reveal>

      <main className="grid">
        <Reveal>
          <section className="panel tilt" id="seal">
            <h2>{t.sealTitle}</h2>
            <p className="panel-sub">{t.sealSub}</p>
            <p className="public-note">⚠ {t.hiddenNote}</p>
            <div className="chips">
              {CATEGORIES.map(c => <button key={c} className={category === c ? 'chip active' : 'chip'} onClick={() => setCategory(c)}>{categoryLabelFor(lang, c)}</button>)}
            </div>
            <Field label={t.fieldQuestion}><input value={question} onChange={e => setQuestion(e.target.value)} maxLength={120} placeholder="e.g. What will the final score be?" /></Field>
            <Field label={t.fieldPrediction}>
              <div className="input-row">
                <input type={showPrediction ? 'text' : 'password'} value={prediction} onChange={e => setPrediction(e.target.value)} maxLength={500} placeholder="Your secret prediction — never sent until reveal…" />
                <button type="button" className="btn small ghost" onClick={() => setShowPrediction(!showPrediction)}>{showPrediction ? t.hidePrediction : t.showPrediction}</button>
              </div>
            </Field>
            <Field label={t.fieldRevealKey}>
              <div className="input-row">
                <input value={salt} onChange={e => { setSalt(e.target.value); setCopiedKey(false) }} maxLength={64} placeholder="…" />
                <button type="button" className="btn small gold" onClick={doGenerateSalt}>{t.btnGenerateKey}</button>
                {salt && <button type="button" className="btn small ghost" onClick={doCopyKey}>{copiedKey ? t.keyCopied : t.copyKey}</button>}
              </div>
            </Field>
            {salt && <p className="public-note">⚠ {t.keyWarning}</p>}
            {commitment ? (
              <div className="preview">
                <span className="preview-tag">{t.commitmentLabel}</span>
                <div className="utc-line mono" style={{ fontSize: 15, wordBreak: 'break-all' }}>{commitment}</div>
                <div className="muted small">{t.commitmentNote}</div>
              </div>
            ) : (
              <p className="muted small">{t.commitmentPending}</p>
            )}
            <Field label={t.fieldUnlockDate}><input type="date" value={unlockDate} min={minDate} max="2100-12-31" onChange={e => setUnlockDate(e.target.value)} /></Field>
            <div className="actions">
              <button className="btn gold big" onClick={doSeal} disabled={!configured || !wallet || !commitment}>{t.btnSeal}</button>
              <button className="btn ghost" onClick={doCheckTime} disabled={utcBusy}>{utcBusy ? t.loading : t.btnCheckTime}</button>
            </div>
            {!wallet && <p className="muted">{t.needWallet}<b>{t.needWalletEm}</b>{t.needWalletEnd}</p>}
            {utcCheck && (
              <div className="preview">
                <span className="preview-tag">{t.checkTimeTag}</span>
                <div className="utc-line"><b>{utcCheck.utcDate}</b> · {utcCheck.utcDateTime}</div>
                <div className="muted small">Source: {utcCheck.source}{utcCheck.local ? t.checkTimeLocal : ''}</div>
              </div>
            )}
            {status && <p className={`status ${statusBusy ? 'busy' : ''}`}><span className="dot" />{status}</p>}
            {error && <p className="error">{error}</p>}
            {snapFailed && (
              <div className="preview">
                <span className="preview-tag">{t.reviewerTag}</span>
                <p className="muted">Your wallet (OKX, Rabby, mobile, …) cannot install the GenLayer Snap — that is a GenLayer limitation, not a bug in this app. You can still test the full on-chain flow: this generates a temporary test account in your browser, on gasless Studionet only. Its key never leaves your browser and is discarded on refresh. Transactions will be real on-chain transactions, but the requester shown on-chain will be this test account, <b>not</b> your wallet address.</p>
                <button className="btn gold" onClick={doUseReviewerAccount}>{t.reviewerBtn}</button>
              </div>
            )}
            {walletMode === 'ephemeral' && ephemeralAddress && <p className="muted small">Writing as ephemeral test account {ephemeralAddress} (Studionet only, browser-only key, discarded on refresh) — not as your wallet {wallet}.</p>}
            {tx && <p className="txline">{tx.kind} tx: <a href={explorerTx(tx.hash)} target="_blank" rel="noreferrer" className="mono">{tx.hash.slice(0, 18)}… ↗</a></p>}
            {createdId !== null && <p className="status">⚠ {t.sealReminder} <span className="mono">{salt}</span></p>}
          </section>
        </Reveal>

        <Reveal delay={120}>
          <section className="panel tilt" id="vault">
            <div className="panel-head"><h2>{t.vaultTitle}</h2><button className="btn small ghost" onClick={loadCapsules} disabled={listBusy}>{listBusy ? t.loading : t.refresh}</button></div>
            <p className="panel-sub">{t.vaultSub}</p>
            <div className="chips">
              <button className={filter === 'all' ? 'chip active' : 'chip'} onClick={() => setFilter('all')}>{t.filterAll}</button>
              <button className={filter === 'sealed' ? 'chip active' : 'chip'} onClick={() => setFilter('sealed')}>{t.filterLocked}</button>
              <button className={filter === 'revealed' ? 'chip active' : 'chip'} onClick={() => setFilter('revealed')}>{t.filterUnlocked}</button>
            </div>
            {!configured && <p className="muted">No contract configured in this build.</p>}
            {configured && capsules.length === 0 && !listBusy && <p className="muted">{t.noCapsules}</p>}
            <div className="timeline">
              <div className="river-line" />
              {visible.map((c, i) => <Reveal key={c.id} delay={i * 70}><CapsuleCard c={c} t={t} lang={lang} nowMs={nowMs} canWrite={Boolean(wallet)} revealing={revealingId === c.id} onReveal={doReveal} /></Reveal>)}
            </div>
            <p className="muted small">Network: Stable Studionet ({CHAIN_ID}), RPC {RPC_URL}. Contract: {configured ? <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="mono">{CONTRACT_ADDRESS.slice(0, 10)}… ↗</a> : 'not configured'}.</p>
          </section>
        </Reveal>
      </main>

      <Reveal>
        <section className="trust">
          <div>
            <h2>{t.trustTitle}</h2>
            <p>{t.trustP1}</p>
            <p className="muted small">{t.trustPublic}</p>
          </div>
          <ul className="tolerance">
            <li><span>{t.tolDate}</span><b>{t.tolDateVal}</b></li>
            <li><span>{t.tolSource}</span><b>{t.tolSourceVal}</b></li>
            <li><span>{t.tolGate}</span><b>{t.tolGateVal}</b></li>
            <li><span>{t.tolHash}</span><b>{t.tolHashVal}</b></li>
          </ul>
        </section>
      </Reveal>

      <footer>{t.footer}<br /><span className="mono">UTC {clockText} · {clockDate}</span></footer>
    </div>
  )
}
