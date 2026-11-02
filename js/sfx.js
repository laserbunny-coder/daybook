// Little chiptune sounds for Hold the Keep, made on the spot with WebAudio (no sound files):
// a coin clink when gold goes into the keep, a roar when the dragon dives, a fanfare when a building goes up.
import { lsGet, lsSet } from './util.js';

const KEY = 'daybook-keep-sound';
let ac = null, hush = () => false;
export const on = () => lsGet(KEY, true) !== false;
export function set(v) { lsSet(KEY, !!v); if (v) ctx(); }
/** quiet: a function that says when to stay silent (Quiet mode). */
export function init(o) { hush = o.quiet ?? hush; }
function ctx() {
  if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ac = new A(); }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
// a sound that can't play now (no tap yet to unlock audio) is dropped, not saved up for the first tap
const ready = () => { const a = ctx(); return a && (a.state === 'running' || navigator.userActivation?.isActive) ? a : null; };
const can = () => on() && !hush();
// browsers only let sound start after a tap, so wake the audio on the first one
if (typeof document !== 'undefined') document.addEventListener('pointerdown', () => { if (on()) ctx(); }, { once: true, capture: true });

function tone(type, f0, f1, at, dur, vol = .08) {
  const a = ready(); if (!a) return; const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .02);
}
function noise(at, dur, f0, f1, vol = .12) {
  const a = ready(); if (!a) return; const t = a.currentTime + at, n = a.sampleRate * dur | 0, b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); s.buffer = b;
  f.type = 'lowpass'; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  s.connect(f).connect(g).connect(a.destination); s.start(t);
}
/** Gold into the keep. Twice as bright for the dragon's mark. */
export function coin(double = false) {
  if (!can()) return;
  tone('square', 988, 988, 0, .07, .05); tone('square', 1319, 1319, .07, .22, .05);
  if (double) { tone('square', 1319, 1319, .2, .07, .04); tone('square', 1760, 1760, .27, .25, .04); }
}
/** The dragon dives and takes gold. */
export function roar() {
  if (!can()) return;
  noise(0, .9, 1800, 160, .14); tone('sawtooth', 220, 55, 0, .9, .06); tone('square', 110, 40, .05, .8, .04);
}
/** A building goes up. */
export function fanfare() {
  if (!can()) return;
  [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, i * .11, i === 3 ? .45 : .12, .045));
  tone('triangle', 262, 262, .33, .5, .06);
}
/** Half the gold chased back from the dragon. */
export function chase() { if (!can()) return; tone('square', 659, 659, 0, .08, .045); tone('square', 523, 523, .09, .2, .045); }
/** Midnight, the keep held: the dragon thuds off the gate. */
export function thud() { if (!can()) return; tone('triangle', 140, 50, 0, .35, .12); noise(0, .25, 600, 100, .08); }
/** Midnight, the gate gives way. */
export function crash() { if (!can()) return; noise(0, .7, 3000, 200, .16); tone('square', 90, 40, 0, .5, .05); noise(.18, .4, 1200, 150, .1); }
/** Task Dragon: the timeline cranks up a notch every quarter hour. */
export function tick() { if (!can()) return; tone('square', 180, 120, 0, .05, .03); tone('triangle', 90, 70, .03, .08, .05); }
