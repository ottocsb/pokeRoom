let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem('holdem-muted') === '1';
} catch {
  /* ignore */
}

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem('holdem-muted', m ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, delay = 0, hp = 2000) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  card(n = 1) {
    for (let i = 0; i < n; i++) noise(0.06, 0.25, i * 0.08, 2500);
  },
  chip() {
    tone(2400, 0.05, 'triangle', 0.08);
    tone(3100, 0.05, 'triangle', 0.06, 0.04);
  },
  check() {
    noise(0.04, 0.2, 0, 800);
    noise(0.04, 0.2, 0.09, 800);
  },
  fold() {
    noise(0.12, 0.12, 0, 1200);
  },
  turn() {
    tone(880, 0.12, 'sine', 0.05);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.08, i * 0.09));
  },
  lose() {
    [392, 330].forEach((f, i) => tone(f, 0.3, 'sine', 0.06, i * 0.15));
  },
  levelUp() {
    tone(988, 0.1, 'sine', 0.06);
    tone(1319, 0.16, 'sine', 0.06, 0.08);
  },
  click() {
    tone(1200, 0.03, 'square', 0.025);
  },
  /** someone shoves: low boom + a pile of chips + a rising stinger */
  allin() {
    const a = ac();
    if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + 0.65);
    for (let i = 0; i < 10; i++) tone(2200 + Math.random() * 1200, 0.05, 'triangle', 0.06, 0.05 + i * 0.035);
    [392, 523, 659].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.03, 0.15 + i * 0.07));
  },
};
