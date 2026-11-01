// Time tracking: the ▶ on a task or project records how long it's really worked on.
// Each item keeps its stretches of work in tl (time_log), oldest first: { start, end } as
// ISO times, end null while recording. Only one thing records at a time.
// Checking a task off moves its block to when it was really done (its last stretch), and
// remembers where it was planned in pl, so Claude can compare plan and reality.
// Checked off without recording, it's taken as finished just now, after as long as planned:
// that stretch is marked guess, and stops being a guess as soon as someone corrects it.
import * as store from './store.js';
import { fd } from './util.js';

const iso = ms => new Date(ms).toISOString();
const ms = s => Date.parse(s);
export const running = () => store.recording();
export const openOf = n => n?.tl?.find(e => !e.end) || null;
export const isRec = n => !!openOf(n);
/** Minutes in one stretch (up to now while it's recording) */
export const mins = e => Math.max(0, Math.round(((e.end ? ms(e.end) : Date.now()) - ms(e.start)) / 60000));
export const real = n => (n.tl || []).filter(e => !e.guess);
/** Minutes really recorded on an item, the running stretch included */
export const total = n => real(n).reduce((a, e) => a + mins(e), 0);
/** Where an instant falls in local time: its date and minute of the day */
export const local = s => { const d = new Date(s); return { d: fd(d), m: d.getHours() * 60 + d.getMinutes() }; };

// A new log for an item, with how long it really took following what's recorded.
// Real time pushes guesses out; stretches stay in time order.
function withLog(n, tl) {
  if (tl.some(e => !e.guess)) tl = tl.filter(e => !e.guess);
  tl = tl.slice().sort((a, b) => ms(a.start) - ms(b.start));
  const p = { tl: tl.length ? tl : null };
  const t = tl.filter(e => !e.guess && e.end).reduce((a, e) => a + mins(e), 0);
  if (t > 0) p.am = Math.min(t, 10080);
  else if (real(n).length) p.am = null; // its recorded time was all taken out
  return p;
}
// Ends the recording stretch at a moment. Shorter than a minute, it was a slip of the finger and goes.
function closed(n, at) {
  return (n.tl || []).flatMap(e => {
    if (e.end) return [e];
    const c = { ...e, end: iso(Math.max(at, ms(e.start))) };
    return mins(c) >= 1 ? [c] : [];
  });
}
// A finished task's block sits on its last stretch
function placeOn(e) {
  const a = local(e.start);
  return { d: a.d, s: a.m, m: Math.max(5, Math.min(mins(e), 1440 - a.m)), a: null };
}

/** Starts recording an item, stopping whatever else was recording. */
export function start(id) {
  const now = Date.now(), ch = [], r = running();
  if (r && r.id !== id) ch.push([r.id, withLog(r, closed(r, now))]);
  const n = store.get(id); if (!n || isRec(n)) return;
  ch.push([id, withLog(n, [...(n.tl || []), { start: iso(now), end: null }])]);
  store.updateMany(ch);
}
/** Stops recording (the task stays open). */
export function stop(id) { const n = store.get(id); if (isRec(n)) store.update(id, withLog(n, closed(n, Date.now()))); }
/** Moves the start of the recording stretch by some minutes (negative: it started earlier). */
export function nudge(id, by) {
  const n = store.get(id), e = openOf(n); if (!e) return;
  const prev = (n.tl || []).filter(x => x.end && ms(x.end) <= ms(e.start)).reduce((a, x) => Math.max(a, ms(x.end)), 0);
  const s = Math.max(prev, Math.min(Date.now(), ms(e.start) + by * 60000));
  store.update(id, withLog(n, n.tl.map(x => x === e ? { ...x, start: iso(s) } : x)));
}

/** What checking a task off changes: its recording stops, and its block moves to when it was really done.
    place false (a step riding along with its project): nothing recorded on it, so it stays off the plan. */
export function donePatch(n, place = true) {
  const now = Date.now();
  let tl = closed(n, now).filter(e => !e.guess);
  if (!place && !tl.length) return { done: true, ...(n.tl ? withLog(n, tl) : {}) };
  if (!tl.length) tl = [{ start: iso(now - (n.m || 60) * 60000), end: iso(now), guess: true }];
  const p = { done: true, ...withLog(n, tl) };
  const last = p.tl[p.tl.length - 1];
  Object.assign(p, placeOn(last));
  if (!n.pl) p.pl = { day: n.d ?? null, start_min: n.s ?? null, duration_min: n.m ?? 60 };
  return p;
}
/** Reopening a task puts it back where it was planned, and forgets the guess (and how long it was said to take). */
export function undonePatch(n) {
  const p = { done: false, ...withLog(n, (n.tl || []).filter(e => !e.guess && !e.est)) };
  if (n.pl) Object.assign(p, { d: n.pl.day, s: n.pl.start_min, m: n.pl.duration_min ?? n.m, a: null, pl: null });
  return p;
}

/** A project is done when all its steps are: its recording stops, and its block moves to when it was really
    worked on, as a task's does. Off the plan and never recorded, it stays off. */
export function finishPatch(n) { const { done, ...p } = donePatch(n, !!n.d); return p; }
/** A project with a step reopened goes back to where it was planned. */
export function reopenPatch(n) { const { done, ...p } = undonePatch(n); return p; }

// Changes to the log by hand. A done task's block follows its last stretch.
function setLog(n, tl) {
  const p = withLog(n, tl);
  const place = !store.seriesOf(n)?.hb && (n.d != null || n.p == null); // a habit, or a step off the plan, stays where it is
  if (n.done && p.tl && place) { const last = p.tl.filter(e => e.end).pop(); if (last) Object.assign(p, placeOn(last)); }
  store.update(n.id, p);
}
/** Changes one stretch. A corrected guess becomes real time. */
export function edit(id, i, start, end) {
  const n = store.get(id), e = n?.tl?.[i]; if (!e) return 'gone';
  const s = ms(start), f = end == null ? null : ms(end);
  if (isNaN(s) || (f != null && isNaN(f))) return 'bad';
  if (s > Date.now() || (f != null && f > Date.now() + 60000)) return 'future';
  if (f != null && f <= s) return 'order';
  const c = { start: iso(s), end: f == null ? null : iso(f) };
  setLog(n, n.tl.map((x, j) => j === i ? c : x));
  return null;
}
export function remove(id, i) { const n = store.get(id); if (n?.tl?.[i]) setLog(n, n.tl.filter((_, j) => j !== i)); }
/** Adds time that wasn't recorded: by default, as long as planned, ending now. */
export function addTime(id) {
  const n = store.get(id); if (!n) return;
  const now = Date.now(), m = Math.min(n.m || 30, 240);
  setLog(n, [...(n.tl || []), { start: iso(now - m * 60000), end: iso(now) }]);
}

/* How long it really took, said after the fact (took.js asks right after a check-off).
   The answer is one stretch ending when it was done, marked est: a rough number from the person,
   not timed, but real enough to count everywhere a guess doesn't. It takes the place of the guess. */
const said = e => e.guess || e.est;
/** The stretch a check-off answer sits on (the guess, or an earlier answer), or null */
export const saidOf = n => [...(n?.tl || [])].reverse().find(said) || null;
/** Sets how long a finished item took: m minutes, ending when it was done. 0 takes the time out. */
export function setTook(id, m) {
  const n = store.get(id); if (!n) return;
  const tl = n.tl || [], e = saidOf(n);
  const end = e ? ms(e.end) : n.da ? ms(n.da) : Date.now();
  const rest = tl.filter(x => x !== e && !x.guess);
  const s = { start: iso(end - Math.max(1, m) * 60000), end: iso(end), est: true };
  setLog(n, m > 0 ? [...rest, s] : rest);
}
/** Moves the start of the last timed stretch: +10 means it really started 10 minutes earlier (the timer went on late). */
export function stretchLast(id, by) {
  const n = store.get(id); const tl = n?.tl || [];
  const i = tl.reduce((k, x, j) => x.end && !said(x) && (k < 0 || ms(x.end) >= ms(tl[k].end)) ? j : k, -1); if (i < 0) return;
  const e = tl[i], prev = tl.filter((x, j) => j !== i && x.end && ms(x.end) <= ms(e.start)).reduce((a, x) => Math.max(a, ms(x.end)), 0);
  const s = Math.max(prev, Math.min(ms(e.end) - 60000, ms(e.start) - by * 60000));
  setLog(n, tl.map((x, j) => j === i ? { ...x, start: iso(s) } : x));
}
