/* The day strip at the top of a day's list (Day view): the whole day as one bar.
   Calendar events are hatched (locked-in time), time you recorded shows as thin marks in its colour, and on today
   the stretch you're in is outlined with the time left until the next event. Time already gone is squeezed to the
   left so what's ahead gets the room. Under it, one line: open time left in the work day against the area goals
   still to do. Tapping that line sets the work hours (kept with the account, so every device agrees). */
import * as store from './store.js';
import * as aday from './areaday.js';
import { timedOn } from './calendar.js';
import { esc, fmtDur, fmtT, lsGet, lsSet, nowMin, pd, today } from './util.js';
import { colorOf } from './tree.js';

const KEY = 'daybook-work-hours', DEF = { from: 480, to: 1080 };
let W = lsGet(KEY, DEF), save = null, editing = false;
const ok = h => h && Number.isFinite(+h.from) && Number.isFinite(+h.to) && +h.from >= 0 && +h.to <= 1440 && +h.from < +h.to;
if (!ok(W)) W = DEF;
export const hours = () => W;
/** Hours set on another device (or by Claude) arrive with the account; f saves changes made here. */
export function useHours(h, f) { if (f) save = f; if (ok(h) && (h.from !== W.from || h.to !== W.to)) { W = { from: +h.from, to: +h.to }; lsSet(KEY, W); } }
export function setHours(from, to) {
  const h = { from: from ?? W.from, to: to ?? W.to }; if (!ok(h)) return false;
  W = h; lsSet(KEY, W); save?.(W); return true;
}
export const toggleEdit = () => { editing = !editing; };

const fmtTT = m => fmtT(m % 1440 === 0 && m ? 1439 : m).replace('11:59pm', 'midnight');

/** Work windows: the work hours (stretched back to now if you started early) less the day's events. */
function windows(E, from, to) {
  const out = []; let t = from;
  for (const e of E) { const s = Math.max(e.s, from), z = Math.min(e.s + (e.m || 0), to); if (z <= t) continue; if (s > t) out.push({ s: t, e: Math.min(s, to) }); t = Math.max(t, z); if (t >= to) break; }
  if (t < to) out.push({ s: t, e: to });
  return out;
}
// Recorded stretches that touch the day, in minutes from its midnight
function stretches(d) {
  const a = pd(d).getTime(), z = a + 864e5, out = [];
  for (const n of store.logged()) for (const e of n.tl) {
    if (e.guess) continue;
    const s = Date.parse(e.start), f = e.end ? Date.parse(e.end) : Date.now();
    if (f <= a || s >= z) continue;
    out.push({ s: Math.max(0, (s - a) / 6e4), e: Math.min(1440, (f - a) / 6e4), c: colorOf(n) });
  }
  return out;
}
/** Area goal minutes still to do that day (areas marked done for the day count as finished). */
export function goalsLeft(d) {
  return aday.cardsOn(d).filter(c => c.target > 0 && !aday.doneOn(c.a, d)).reduce((t, c) => t + Math.max(0, c.target - c.min), 0);
}

export function html(d) {
  const E = timedOn(d).filter(e => e.s + (e.m || 0) > 0 && e.s < 1440), T = today(), isT = d === T, past = d < T;
  const ST = stretches(d), n = isT ? nowMin() : null;
  let a = Math.min(W.from, ...E.map(e => e.s), ...ST.map(x => x.s)), z = Math.max(W.to, ...E.map(e => e.s + (e.m || 0)));
  a = Math.max(0, Math.floor(a / 60) * 60); z = Math.min(1440, Math.ceil(z / 60) * 60);
  // Today: what's gone takes the first 14%, the rest of the day the other 86%
  const squeeze = isT && n > a + 30 && n < z - 30, K = 14;
  const P = m => { m = Math.max(a, Math.min(z, m)); return squeeze ? (m <= n ? (m - a) / (n - a) * K : K + (m - n) / (z - n) * (100 - K)) : (m - a) / (z - a) * 100; };
  const box = (cls, s, e, inner = '', extra = '') => `<div class="${cls}" style="left:${P(s).toFixed(2)}%;width:${(P(e) - P(s)).toFixed(2)}%"${extra}>${inner}</div>`;
  const from = isT ? Math.min(W.from, Math.max(a, n)) : W.from, wins = windows(E, from, W.to);
  const cur = isT && wins.find(w => w.s <= n && n < w.e), next = isT ? E.find(e => e.s > n) : null, inEv = isT && E.find(e => e.s <= n && n < e.s + (e.m || 0));
  const parts = [];
  if (W.from > a) parts.push(box('ds-off', a, W.from)); if (W.to < z) parts.push(box('ds-off', W.to, z));
  if (squeeze) parts.push(box('ds-gone', a, n));
  for (const w of wins) {
    const s = isT ? Math.max(w.s, n) : w.s; if (w.e <= s || (past)) continue;
    if (w === cur) { const left = w.e - n, why = next && next.s === w.e ? `until ${esc(next.t || 'the next event')}` : 'until the end of the work day';
      parts.push(box('ds-cur', s, w.e, `<span><b>${fmtDur(left)}</b><small>left</small></span>`, ` title="${fmtDur(left)} ${why}"`)); }
    else if (P(w.e) - P(s) > 11) parts.push(box('ds-gap', s, w.e, fmtDur(w.e - s)));
  }
  for (const e of E) { const w = P(e.s + (e.m || 0)) - P(e.s), t = e.t || 'Busy'; parts.push(box(`ds-ev${inEv === e ? ' now' : ''}`, e.s, e.s + (e.m || 0), w > t.length * 1.7 ? esc(t) : '', ` title="${esc(t)} · ${fmtT(e.s)} to ${fmtT(e.s + (e.m || 0))}"`)); }
  for (const x of ST) parts.push(`<i class="ds-sw" style="left:${P(x.s).toFixed(2)}%;width:${Math.max(.6, P(x.e) - P(x.s)).toFixed(2)}%;--pc:${x.c}"></i>`);
  if (isT && n >= a && n <= z) parts.push(`<i class="ds-nw" style="left:${P(n).toFixed(2)}%"></i>`);
  // Times under the bar: now, then when each event ahead starts (dropped where they'd crowd)
  const marks = isT && n >= a && n <= z ? [{ m: n, now: 1 }] : [{ m: a }];
  for (const e of E) if (!isT || e.s > n) marks.push({ m: e.s });
  if (!isT || W.to > n) marks.push({ m: W.to });
  let lastP = -99; const ticks = marks.sort((x, y) => P(x.m) - P(y.m)).filter(t => { const p = P(t.m); if (p - lastP < (t.now ? 0 : 11)) return false; lastP = p; return true; })
    .map(t => `<span class="${t.now ? 'ds-tnow' : ''}" style="left:${P(t.m).toFixed(2)}%">${fmtT(t.m)}</span>`).join('');
  // Open time left against the area goals still to do
  let fit = '';
  if (!past) {
    const open = wins.reduce((t, w) => t + Math.max(0, w.e - Math.max(w.s, isT ? n : 0)), 0), goals = Math.round(goalsLeft(d));
    const over = isT && n >= W.to;
    const lead = over ? `<span>Work day ended at <b>${fmtTT(W.to)}</b></span>` : `<span>Open time ${isT ? 'left ' : ''}<b>${fmtDur(open)}</b></span>`;
    const g = goals ? `<span>Goals left <b>${fmtDur(goals)}</b></span>${over ? '' : `<span class="${open >= goals ? 'ok' : 'short'}">${open >= goals ? fmtDur(open - goals) + ' spare' : fmtDur(goals - open) + ' short'}</span>`}` : `<span>${aday.cardsOn(d).some(c => c.target > 0) ? 'Area goals all met' : 'No area goals'}</span>`;
    fit = `<button class="ds-fit" data-act="ds-hours" aria-expanded="${editing}" title="Change today's goals or your work hours (${fmtT(W.from)} to ${fmtTT(W.to)})">${lead}${g}<span class="ds-adj">${editing ? 'Close' : 'Adjust'}</span></button>`;
    if (editing) {
      // Today's goals, quick to change for this day only (30 minutes a tap); "usual" puts the weekday's hours back
      const rows = aday.areas().map(x => ({ a: x, t: aday.targetOn(x, d), u: Math.max(0, +(x.dg?.[aday.keyOf(d)] || 0)), o: aday.isOverride(x.dg, d) })).filter(r => r.t > 0 || r.u > 0 || r.o);
      if (rows.length) fit += `<div class="ds-goals"><div class="ds-gl">${isT ? 'Today\u2019s' : 'This day\u2019s'} goals <small>for this day only</small></div>${rows.map(r => `<div class="ds-g" style="--pc:${colorOf(r.a)}"><span class="pdot"></span><span class="ds-gn">${esc(r.a.t || 'Untitled area')}${r.o ? `<small>usually ${r.u ? fmtDur(r.u) : 'none'}</small>` : ''}</span><button class="ib" data-act="ds-goal" data-id="${r.a.id}" data-d="${d}" data-by="-30" aria-label="Less ${esc(r.a.t)} time"${r.t ? '' : ' disabled'}>\u2212</button><b>${r.t ? fmtDur(r.t) : 'Off'}</b><button class="ib" data-act="ds-goal" data-id="${r.a.id}" data-d="${d}" data-by="30" aria-label="More ${esc(r.a.t)} time">+</button>${r.o ? `<button class="ds-usual" data-act="ds-goal" data-id="${r.a.id}" data-d="${d}" data-by="usual">Usual</button>` : '<span class="ds-usual"></span>'}</div>`).join('')}</div>`;
      const opts = (v, lo, hi) => { let o = ''; for (let m = lo; m <= hi; m += 30) o += `<option value="${m}"${m === v ? ' selected' : ''}>${fmtTT(m)}</option>`; return o; };
      fit += `<div class="ds-hours"><span>Work hours</span><select id="ds-from" aria-label="Work day starts">${opts(W.from, 240, 840)}</select><span>to</span><select id="ds-to" aria-label="Work day ends">${opts(W.to, 720, 1440)}</select><button class="tb" data-act="ds-hours">Done</button></div>`;
    }
  }
  return `<div class="ds${isT ? ' today' : ''}${past ? ' past' : ''}"><div class="ds-bar" role="img" aria-label="${isT && cur ? `${fmtDur(cur.e - n)} free${next && next.s === cur.e ? ' until ' + esc(next.t || 'the next event') : ''}` : 'The day'}">${parts.join('')}</div><div class="ds-ticks">${ticks}</div>${fit}</div>`;
}
