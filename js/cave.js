// Task Dragon's cave, heard: a soundtrack made on the spot with WebAudio (no sound files).
// A low drone and his slow breathing, fire crackle, water dripping somewhere far off, now and then a few low notes
// of a tune. Tension (0..1, how close a quest is to his jaws) brings in a heartbeat that quickens, then war drums.
// It plays only while the Fight keeps calling tension(); a few seconds without a call and it fades away by itself.
// The same Sound on/off as the game's other sounds (sfx.js).
import * as sfx from './sfx.js';

let ac = null, out = null, verb = null, layers = null, T = 0, alive = 0, timer = 0, next = {};
const now = () => ac.currentTime;
function ctx() {
  if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ac = new A(); }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac.state === 'running' || navigator.userActivation?.isActive ? ac : null;
}
function noiseBuf(sec, brown) {
  const n = ac.sampleRate * sec | 0, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); let last = 0;
  for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; d[i] = brown ? (last = (last + .02 * w) / 1.02) * 3.5 : w; }
  return b;
}
// a cave-sized echo: a few seconds of fading noise as the room's impulse
function reverb() {
  const n = ac.sampleRate * 3.2 | 0, b = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6); }
  const v = ac.createConvolver(); v.buffer = b; return v;
}
function build() {
  out = ac.createGain(); out.gain.value = 0; out.connect(ac.destination);
  verb = reverb(); const wet = ac.createGain(); wet.gain.value = .55; verb.connect(wet).connect(out);
  // the drone: two low saws a hair apart, muffled, the filter breathing slowly
  const dg = ac.createGain(); dg.gain.value = .05; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170; lp.Q.value = 4;
  for (const f of [55, 55.4, 82.6]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); }
  const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = .05; lg.gain.value = 70; lfo.connect(lg).connect(lp.frequency); lfo.start();
  lp.connect(dg).connect(out);
  // his breath: brown noise swelling in and out about every five seconds
  const br = ac.createBufferSource(); br.buffer = noiseBuf(6, true); br.loop = true;
  const bf = ac.createBiquadFilter(); bf.type = 'lowpass'; bf.frequency.value = 380;
  const bg = ac.createGain(); bg.gain.value = .05; const bl = ac.createOscillator(), blg = ac.createGain(); bl.frequency.value = .19; blg.gain.value = .045;
  bl.connect(blg).connect(bg.gain); bl.start(); br.connect(bf).connect(bg).connect(out); br.start();
  // the fire: a steady hiss under the crackles
  const fh = ac.createBufferSource(); fh.buffer = noiseBuf(4); fh.loop = true; const ff = ac.createBiquadFilter(); ff.type = 'bandpass'; ff.frequency.value = 900; ff.Q.value = .7;
  const fg = ac.createGain(); fg.gain.value = .006; fh.connect(ff).connect(fg).connect(out); fh.start();
  // war drums under everything, silent until the tension climbs
  const drums = ac.createGain(); drums.gain.value = 0; drums.connect(out); drums.connect(verb);
  layers = { drums, crack: noiseBuf(.08) };
}
function env(node, t, peak, dur, attack = .005) { node.gain.setValueAtTime(.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + attack); node.gain.exponentialRampToValueAtTime(.0001, t + dur); }
function crackle(t) {
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = layers.crack;
  f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 2600; f.Q.value = 2; env(g, t, .04 + Math.random() * .05, .05 + Math.random() * .06, .001);
  s.connect(f).connect(g).connect(out); s.start(t);
}
function drip(t) {
  const o = ac.createOscillator(), g = ac.createGain(), f = 900 + Math.random() * 1100; o.type = 'sine';
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + .06); env(g, t, .05, .18, .002);
  o.connect(g); g.connect(verb); g.connect(out); o.start(t); o.stop(t + .25);
}
function thump(t, f, v, to = out) {
  const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * .55, t + .18); env(g, t, v, .28, .004);
  o.connect(g).connect(to); o.start(t); o.stop(t + .32);
}
// a few low notes in D minor, far off, so the cave has a tune without one ever getting in the way
const SCALE = [146.8, 174.6, 196, 220, 233.1, 261.6, 293.7];
function motif(t) {
  let i = Math.floor(Math.random() * 3);
  for (let k = 0; k < 4; k++) {
    i = Math.max(0, Math.min(SCALE.length - 1, i + [-1, 1, 2, -2][Math.floor(Math.random() * 4)]));
    const at = t + k * 1.1, o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = SCALE[i] * (T > .7 ? 1 : .5);
    env(g, at, .035, 2.2, .25); o.connect(g); g.connect(verb); g.connect(out); o.start(at); o.stop(at + 2.4);
  }
}
// every 100ms: schedule what's due in the next slice, the heartbeat and drums keyed to the tension
function tick() {
  if (!ac || !layers) return;
  const t = now(), live = Date.now() - alive < 3000 && sfx.on() && document.visibilityState === 'visible';
  out.gain.setTargetAtTime(live ? .9 : 0, t, live ? .8 : .4);
  if (!live) { if (Date.now() - alive > 8000) stop(); return; }
  const due = k => !next[k] || next[k] <= t + .12;
  if (due('crack')) { next.crack = t + .05 + Math.random() * (Math.random() < .3 ? .1 : .7); crackle(next.crack); }
  if (due('drip')) { next.drip = t + 2 + Math.random() * 6; drip(next.drip); }
  if (due('motif')) { next.motif = t + 18 + Math.random() * 20; if (next.motifOn) motif(next.motif); next.motifOn = true; }
  if (T > .3 && due('beat')) { const gap = 60 / (56 + T * 70); next.beat = Math.max(t + .05, (next.beat || t) + gap); thump(next.beat, 62, .16 * T); thump(next.beat + .2, 52, .11 * T); }
  layers.drums.gain.setTargetAtTime(T > .7 ? (T - .7) / .3 * .9 : 0, t, .6);
  if (T > .7 && due('drum')) { const gap = .45 - (T - .7) * .4; next.drum = Math.max(t + .05, (next.drum || t) + gap); next.dn = (next.dn || 0) + 1; thump(next.drum, next.dn % 4 === 0 ? 95 : 70, .3, layers.drums); }
}
function stop() { clearInterval(timer); timer = 0; }
/** Keep the cave sounding, at this tension (0 calm .. 1 a quest in his jaws). Call it every frame or so. */
export function tension(t) {
  T = Math.max(0, Math.min(1, t)); alive = Date.now();
  if (!sfx.on() || timer) return;
  if (!ctx()) return; if (!layers) build();
  next = {}; timer = setInterval(tick, 100); tick();
}
/** A sudden swell: a chomp, a critical hit. */
export function boom() {
  if (!ac || !layers || !sfx.on()) return;
  const t = now(); thump(t, 48, .5); thump(t + .09, 40, .35);
}
// phones only let sound start inside a tap, so every tap wakes the cave's audio if it's asleep
if (typeof document !== 'undefined') document.addEventListener('pointerdown', () => { if (sfx.on() && (!ac || ac.state !== 'running')) ctx(); }, { capture: true, passive: true });
