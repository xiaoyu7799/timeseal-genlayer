// TimeSeal ambient sound, generated with the Web Audio API — no audio
// file, no download, no autoplay. It only starts after the user taps the
// sound toggle. The pad is two slow, detuned sine tones breathing through
// a lowpass filter; the unlock chime is a soft major arpeggio that plays
// when a transaction reaches FINALIZED while the sound is on.
export function createTimeEngine() {
  let ctx = null
  let master = null
  let nodes = []
  let on = false

  function start() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
      if (ctx.state === 'suspended') void ctx.resume()
      if (on) return true
      master = ctx.createGain()
      master.gain.setValueAtTime(0.0001, ctx.currentTime)
      master.connect(ctx.destination)
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'; filter.frequency.value = 520; filter.Q.value = 0.8
      filter.connect(master)
      const freqs = [110, 165.41, 220]
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq
        const g = ctx.createGain(); g.gain.value = i === 2 ? 0.05 : 0.12
        osc.connect(g); g.connect(filter); osc.start(); nodes.push(osc)
      })
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 180
      lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start(); nodes.push(lfo)
      master.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 2)
      on = true
      return true
    } catch { return false }
  }

  function stop() {
    try {
      if (!ctx || !on) { on = false; return }
      on = false
      const t = ctx.currentTime
      master.gain.cancelScheduledValues(t)
      master.gain.setValueAtTime(master.gain.value, t)
      master.gain.exponentialRampToValueAtTime(0.0001, t + 0.8)
      const toStop = nodes
      setTimeout(() => { toStop.forEach(n => { try { n.stop() } catch {} }); nodes = [] }, 900)
    } catch {}
  }

  function chime() {
    try {
      if (!ctx || !on) return
      const t = ctx.currentTime
      ;[523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t + i * 0.16)
        g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.16 + 0.05)
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.9)
        osc.connect(g); g.connect(ctx.destination)
        osc.start(t + i * 0.16); osc.stop(t + i * 0.16 + 0.95)
      })
    } catch {}
  }

  return { start, stop, chime, get isOn() { return on } }
}
