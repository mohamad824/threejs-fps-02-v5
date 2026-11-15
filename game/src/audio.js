// audio.js — procedural WebAudio: every sound is synthesised, no assets.
// One shared noise buffer; short envelopes; nothing allocated per shot
// beyond the nodes the WebAudio graph itself needs.
let ctx = null;
let noiseBuf = null;
let master = null;

export function audioInit() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    const len = ctx.sampleRate * 0.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
}

function burst(dur, freq, gain, type) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

function tone(freq, dur, gain, type, slide) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}

export function sndShot(kind, dist) {
  const v = Math.max(0.05, 0.6 - (dist || 0) * 0.012);
  if (kind === 'zenith') { burst(0.28, 900, v, 'lowpass'); tone(90, 0.22, v * 0.7, 'sine', 40); }
  else if (kind === 'comet') { burst(0.09, 2400, v * 0.8, 'bandpass'); }
  else if (kind === 'eclipse') { burst(0.12, 1800, v * 0.9, 'bandpass'); tone(160, 0.08, v * 0.4, 'square', 70); }
  else { burst(0.13, 1600, v, 'lowpass'); tone(120, 0.1, v * 0.5, 'sine', 55); }
}
export function sndDry() { tone(900, 0.05, 0.15, 'square'); }
export function sndReload() { tone(420, 0.06, 0.18, 'square'); setTimeout(() => tone(300, 0.06, 0.18, 'square'), 160); setTimeout(() => tone(520, 0.07, 0.22, 'square'), 420); }
export function sndHit(head) { tone(head ? 1500 : 1050, 0.07, 0.25, 'sine'); }
export function sndKill() { tone(700, 0.09, 0.25, 'sine', 1100); setTimeout(() => tone(1100, 0.1, 0.2, 'sine'), 70); }
export function sndHurt() { burst(0.1, 500, 0.4, 'lowpass'); tone(140, 0.14, 0.3, 'sine', 70); }
export function sndPlantBeep() { tone(1250, 0.07, 0.22, 'square'); }
export function sndExplosion() { burst(1.4, 220, 0.9, 'lowpass'); tone(55, 1.1, 0.8, 'sine', 28); }
export function sndFlash() { tone(3200, 0.7, 0.16, 'sine'); burst(0.3, 4000, 0.3, 'highpass'); }
export function sndSmoke() { burst(0.7, 700, 0.25, 'lowpass'); }
export function sndFlare() { burst(0.5, 3000, 0.3, 'highpass'); tone(900, 0.4, 0.12, 'sawtooth', 1400); }
export function sndStep() { burst(0.05, 300, 0.12, 'lowpass'); }
export function sndRadio() { tone(880, 0.05, 0.12, 'square'); setTimeout(() => tone(660, 0.05, 0.1, 'square'), 60); }
export function sndBuy() { tone(760, 0.08, 0.2, 'sine'); setTimeout(() => tone(980, 0.1, 0.2, 'sine'), 80); }
export function sndRound(win) {
  if (win) { tone(523, 0.14, 0.25, 'sine'); setTimeout(() => tone(659, 0.14, 0.25, 'sine'), 130); setTimeout(() => tone(784, 0.24, 0.28, 'sine'), 260); }
  else { tone(392, 0.16, 0.22, 'sine'); setTimeout(() => tone(330, 0.16, 0.22, 'sine'), 150); setTimeout(() => tone(262, 0.3, 0.22, 'sine'), 300); }
}
export function sndMelee() { burst(0.09, 1200, 0.35, 'bandpass'); }
export function sndPickup() { tone(660, 0.07, 0.2, 'sine'); setTimeout(() => tone(990, 0.09, 0.2, 'sine'), 70); }
export function sndDefuse() { tone(980, 0.06, 0.18, 'sine'); }
