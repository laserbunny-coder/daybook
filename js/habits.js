// Habits: repeating tasks flagged as habits (hb on the series). A habit is never overdue: a missed day just stays empty.
// The main number is how often a habit is kept (days done out of days it was due), not a streak, so one missed
// day costs a little instead of wiping everything out. Today only counts once it's done, since it's still open.
// Three places read from here: the Habits card at the top of each day's List, each habit's own page (its detail
// panel) and the Habits view in Stats. Both of the last two use the same charts: Weeks, Weekdays, Time of day,
// Trend, and the year in squares.
import * as store from './store.js';
import { occId, repeatsOn, ruleText } from './repeat.js';
import { add, esc, fd, fmtShort, fmtT, pd, today, weekStart } from './util.js';
import { colorOf } from './tree.js';

/** Every habit (the series), in sidebar order. */
export const list = () => store.all().filter(n => n.r && n.hb && !n.x).sort((a, b) => (a.o ?? 0) - (b.o ?? 0));
/** Whether an item is a habit or one of a habit's repeats. */
export const isHabit = n => !!(n && store.seriesOf(n)?.hb);
/** The habit's repeat due on day d (stored or worked out); null when it isn't due that day, or that day was skipped. */
export function occ(s, d) {
  if (!repeatsOn(s.r, s.d, d)) return null;
  const o = store.get(occId(s.id, d));
  return o && !o.x ? o : null;
}
/** The days from a to b (never past today) the habit was due: [{ d, done, o }]. Today counts only once it's done. */
export function days(s, a, b) {
  const T = today(); if (b > T) b = T; if (a < s.d) a = s.d;
  const out = [];
  for (let d = a; d <= b; d = add(d, 1)) { const o = occ(s, d); if (!o || (d === T && !o.done)) continue; out.push({ d, done: !!o.done, o }); }
  return out;
}
/** How often it was kept from a to b: { kept, due, r } (r is null when it wasn't due at all). */
export function rate(s, a, b) { const D = days(s, a, b), kept = D.filter(x => x.done).length; return { kept, due: D.length, r: D.length ? kept / D.length : null }; }
/** Every habit together, a to b */
export function rateAll(hs, a, b) { let kept = 0, due = 0; for (const s of hs) { const r = rate(s, a, b); kept += r.kept; due += r.due; } return { kept, due, r: due ? kept / due : null }; }
/** The longest run of kept days over the last year, and the one going now (today counts once it's done). */
export function runs(s) {
  const D = days(s, add(today(), -365), today()); let run = 0, best = 0;
  for (const x of D) { run = x.done ? run + 1 : 0; best = Math.max(best, run); }
  return { best, now: run, kept: D.filter(x => x.done).length, due: D.length };
}
/** The minute of the day it was ticked off: when it was checked (done_at), else when its timer last stopped. Only on its own day. */
export function tickMin(o) {
  if (!o?.done) return null;
  const t = o.da || [...(o.tl || [])].reverse().find(e => e.end && !e.guess)?.end; if (!t) return null;
  const x = new Date(t); if (fd(x) !== (o.oc || o.d)) return null;
  return x.getHours() * 60 + x.getMinutes();
}

/* Drawing */
const pct = r => r == null ? '–' : Math.round(r * 100) + '%';
const tint = (c, r) => r == null ? 'background:transparent;border:1px solid var(--line)' : `background:color-mix(in srgb,${c} ${Math.round(10 + r * 80)}%,var(--sunk))`;
const name = s => esc(s.t || 'Untitled habit');
const col = s => colorOf(s);
const WD = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The last 16 weeks for each habit: one square a week, brighter the more of its days were kept. */
export function weeksHTML(hs, one = false) {
  const ws = weekStart(today()), W = [...Array(16)].map((_, i) => add(ws, -7 * (15 - i)));
  return `<p class="hb-cap">The last 16 weeks. Each square is a week, brighter when more of its days were kept.</p>
  <div class="hb-rows">${hs.map(s => { const R = W.map(w => rate(s, w, add(w, 6))), all = rate(s, W[0], add(ws, 6));
    return `<div class="hb-wr${one ? ' one' : ''}"><span class="hb-nm">${one ? '' : name(s)}</span><span class="hb-cells">${R.map((r, i) => `<i style="${tint(col(s), r.r)}" title="Week of ${fmtShort(W[i])}: ${r.due ? `${r.kept} of ${r.due}` : 'not due'}"></i>`).join('')}</span><span class="hb-r">${pct(all.r)}</span></div>`; }).join('')}</div>`;
}
/** How often each habit is kept on each weekday, a to b: the weak days stand out. */
export function weekdaysHTML(hs, a, b) {
  const cell = (s, wd) => { let k = 0, t = 0; for (const x of days(s, a, b)) if (pd(x.d).getDay() === wd) { t++; if (x.done) k++; }
    const r = t ? k / t : null; return `<span class="hb-c" style="${tint(col(s), r)};color:${r != null && r > .55 ? 'var(--bg)' : 'var(--muted)'}" title="${t ? `${k} of ${t}` : 'Not due'}">${pct(r)}</span>`; };
  return `<p class="hb-cap">How often it's kept on each weekday, ${fmtShort(a)} to ${fmtShort(b > today() ? today() : b)}.</p>
  <div class="hb-mat${hs.length === 1 ? ' one' : ''}"><span></span>${WD.map(([, l]) => `<span class="hb-h">${l}</span>`).join('')}
  ${hs.map(s => `<span class="hb-nm">${hs.length === 1 ? '' : name(s)}</span>${WD.map(([wd]) => cell(s, wd)).join('')}`).join('')}</div>`;
}
/** When each habit was ticked off over the last 30 days, on a 4am-to-midnight track, with the usual time marked. */
export function timeHTML(hs) {
  const lo = 240, hi = 1440, x = m => ((Math.min(hi, Math.max(lo, m)) - lo) / (hi - lo) * 100).toFixed(2);
  const rows = hs.map(s => { const T = days(s, add(today(), -29), today()).map(d => tickMin(d.o)).filter(m => m != null).sort((p, q) => p - q);
    const med = T.length ? T[Math.floor(T.length / 2)] : null;
    return `<div class="hb-tr${hs.length === 1 ? ' one' : ''}"><span class="hb-nm">${hs.length === 1 ? '' : name(s)}</span><span class="hb-track">${T.map(m => `<i style="left:${x(m)}%;background:${col(s)}"></i>`).join('')}${med != null ? `<b style="left:${x(med)}%"></b>` : ''}</span><span class="hb-r">${med != null ? fmtT(med) : '–'}</span></div>`; }).join('');
  return `<p class="hb-cap">When it was ticked off over the last 30 days. Each line is a day; the bright mark is the usual time.</p>
  <div class="hb-rows">${rows}<div class="hb-tr hb-ax${hs.length === 1 ? ' one' : ''}"><span></span><span class="hb-axis"><span>4am</span><span>8am</span><span>noon</span><span>4pm</span><span>8pm</span><span>12am</span></span><span></span></div></div>`;
}
/** Kept, month by month, for the last 12 months; the dashed line is the average of every habit. */
export function trendHTML(hs, all = hs) {
  const T = pd(today()), M = [...Array(12)].map((_, i) => { const a = new Date(T.getFullYear(), T.getMonth() - 11 + i, 1); return [fd(a), fd(new Date(a.getFullYear(), a.getMonth() + 1, 0))]; });
  const avg = M.map(([a, b]) => rateAll(all, a, b).r), X = i => 4 + i * (192 / 11), Y = r => 56 - r * 50;
  const line = (v, attrs) => { const pts = v.map((r, i) => r == null ? null : `${X(i).toFixed(1)},${Y(r).toFixed(1)}`).filter(Boolean); return pts.length > 1 ? `<polyline fill="none" ${attrs} points="${pts.join(' ')}"/>` : ''; };
  const MO = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  return `<p class="hb-cap">Kept, month by month, over the last 12 months. The dashed line is all your habits together.</p>
  <div class="hb-sm${hs.length === 1 ? ' one' : ''}">${hs.map(s => { const v = M.map(([a, b]) => rate(s, a, b).r), last = [...v].reverse().find(r => r != null);
    return `<div><svg viewBox="0 0 200 72" role="img" aria-label="${name(s)} by month">${line(avg, 'stroke="var(--faint)" stroke-dasharray="3 3" stroke-width="1"')}${line(v, `stroke="${col(s)}" stroke-width="2" stroke-linejoin="round"`)}${M.map(([a], i) => `<text x="${X(i)}" y="70" text-anchor="middle">${MO[pd(a).getMonth()]}</text>`).join('')}</svg><span>${hs.length === 1 ? 'This month' : name(s)} · <b>${pct(last)}</b></span></div>`; }).join('')}</div>`;
}
/** Twelve months of squares for one habit: done, missed, or not due. */
export function yearHTML(s) {
  const T = today(), t = pd(T), R = runs(s), MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let months = '';
  const st = pd(s.d), back = Math.min(11, Math.max(0, (t.getFullYear() - st.getFullYear()) * 12 + t.getMonth() - st.getMonth()));
  for (let m = back; m >= 0; m--) {
    const f = new Date(t.getFullYear(), t.getMonth() - m, 1), last = new Date(f.getFullYear(), f.getMonth() + 1, 0);
    let g = '<i class="e"></i>'.repeat((f.getDay() + 6) % 7);
    for (let d = fd(f); d <= fd(last); d = add(d, 1)) {
      if (d > T || d < s.d) { g += '<i class="e"></i>'; continue; }
      const o = occ(s, d);
      g += !o ? '<i class="n"></i>' : o.done ? `<i class="y" title="${fmtShort(d)}: kept"></i>` : d === T ? '<i class="t" title="Today, still open"></i>' : `<i title="${fmtShort(d)}: missed"></i>`;
    }
    months += `<div class="hb-mo"><h4>${MN[f.getMonth()]}${f.getMonth() === 0 || m === back ? ' ' + f.getFullYear() : ''}</h4><div class="hb-g">${g}</div></div>`;
  }
  return `<div class="hb-yh"><div class="hb-yt"><span class="hb-k">${back === 11 ? '12 months' : 'Since ' + fmtShort(s.d)} to ${fmtShort(T)}</span><b>${R.due ? `Kept ${pct(R.kept / R.due)} of the time` : 'Nothing yet'}</b></div>
    <div class="hb-f"><b>${plural(R.best, 'day')}</b><span>longest run</span></div><div class="hb-f"><b>${plural(R.now, 'day')}</b><span>running now</span></div><div class="hb-f"><b>${R.kept}</b><span>days kept</span></div></div>
  <div class="hb-months" style="--hc:${col(s)}">${months}</div>
  <div class="hb-leg" style="--hc:${col(s)}"><span><i class="y"></i>Kept</span><span><i></i>Missed</span><span><i class="n"></i>Not due</span></div>`;
}

/** The four charts with tabs (Stats and a habit's own page share it). k is the open tab. */
export const TABS = [['weeks', 'Weeks'], ['days', 'Weekdays'], ['time', 'Time of day'], ['trend', 'Trend']];
export function chartsHTML(hs, k, a, b, act) {
  if (!TABS.some(t => t[0] === k)) k = 'weeks';
  const body = k === 'days' ? weekdaysHTML(hs, a, b) : k === 'time' ? timeHTML(hs) : k === 'trend' ? trendHTML(hs, list()) : weeksHTML(hs, hs.length === 1);
  return `<div class="st-tabs" role="tablist" aria-label="Habit charts">${TABS.map(([v, l]) => `<button role="tab" data-act="${act}" data-v="${v}" aria-selected="${k === v}">${l}</button>`).join('')}</div><div class="hb-card">${body}</div>`;
}

/** A habit's own page, in its detail panel: the headline numbers, the charts, the year. */
export function detailHTML(s, k) {
  const T = today(), a = add(T, -29), r = rate(s, a, T), p = rate(s, add(a, -30), add(a, -1)), R = runs(s);
  const ch = r.r != null && p.r != null ? Math.round((r.r - p.r) * 100) : null;
  return `<div class="dt-sec">Habit</div>
  <div class="hb-dt" style="--hc:${col(s)}">
    <div class="hb-top"><div><span class="hb-big">${pct(r.r)}</span><span class="hb-sub">kept, last 30 days${ch ? ` · <span class="${ch > 0 ? 'up' : 'dn'}">${ch > 0 ? 'up' : 'down'} ${Math.abs(ch)}%</span>` : ''}</span></div>
      <div class="hb-f"><b>${plural(R.now, 'day')}</b><span>running now</span></div><div class="hb-f"><b>${plural(R.best, 'day')}</b><span>longest run</span></div></div>
    <div class="hb-note">${esc(ruleText(s.r, s.d))}. Never overdue: a missed day just stays empty.${weakDay(s)}</div>
    ${chartsHTML([s], k, add(T, -90), T, 'hb-tab')}
    ${yearHTML(s)}
  </div>`;
}
// "Mostly missed on Fridays" when one weekday clearly slips
function weakDay(s) {
  const m = [0, 0, 0, 0, 0, 0, 0], t = [0, 0, 0, 0, 0, 0, 0];
  for (const x of days(s, add(today(), -90), today())) { const w = pd(x.d).getDay(); t[w]++; if (!x.done) m[w]++; }
  const tot = m.reduce((p, q) => p + q, 0); if (tot < 3) return '';
  const w = m.indexOf(Math.max(...m)); return m[w] / tot >= .35 ? ` Most misses lately are on ${DAYS[w]}.` : '';
}

/** The Habits view in Stats: every habit ranked for the range, the charts, and one habit's year. sel narrows to one. */
export function statsHTML({ a, b, label, prevA, prevB, prevLabel, sel, card, year }) {
  const hs = list();
  if (!hs.length) return `<div class="st-empty"><b>No habits yet</b><p>Open a repeating task and tap Habit. It then shows in the Habits card at the top of each day, and its record builds up here.</p></div>`;
  const rows = hs.map(s => ({ s, r: rate(s, a, b), p: rate(s, prevA, prevB) })).sort((x, y) => (y.r.r ?? -1) - (x.r.r ?? -1));
  const all = rateAll(hs, a, b), prev = rateAll(hs, prevA, prevB), ch = all.r != null && prev.r != null ? Math.round((all.r - prev.r) * 100) : null;
  const rated = rows.filter(x => x.r.r != null), top = rated[0], low = rated.length > 1 ? rated[rated.length - 1] : null;
  const say = top ? `Steadiest is <b>${name(top.s)}</b>.${low && low.r.r < top.r.r ? ` <b>${name(low.s)}</b> slips most.${weakDay(low.s)}` : ''}` : 'Nothing was due in this range.';
  const one = hs.find(s => s.id === sel), show = one ? [one] : hs, ys = hs.find(s => s.id === (sel || year)) || hs[0];
  const ws = weekStart(today()), spark = s => { const v = [...Array(12)].map((_, i) => rate(s, add(ws, -7 * (11 - i)), add(ws, -7 * (11 - i) + 6)).r);
    const pts = v.map((r, i) => r == null ? null : `${(2 + i * 80 / 11).toFixed(1)},${(20 - r * 18).toFixed(1)}`).filter(Boolean);
    return `<svg class="hb-spk" viewBox="0 0 84 22" aria-hidden="true">${pts.length > 1 ? `<polyline fill="none" stroke="${col(s)}" stroke-width="1.6" stroke-linejoin="round" points="${pts.join(' ')}"/>` : ''}</svg>`; };
  return `<div class="st">
    <section class="st-led st-box"><div class="hb-led">
      <span class="hb-k">${esc(label)}</span>
      <div class="hb-big">${pct(all.r)}</div>
      <p class="hb-sub">of habit days kept${ch != null ? ` · ${ch ? `${ch > 0 ? 'up' : 'down'} ${Math.abs(ch)}% from` : 'same as'} ${esc(prevLabel)}` : ''}</p>
      <p class="hb-say">${say}</p>
      <div class="hb-lh"><span></span><span>Habit</span><span class="hb-spk">12 weeks</span><span>Kept</span><span>Change</span></div>
      ${rows.map(({ s, r, p }) => { const d = r.r != null && p.r != null ? Math.round((r.r - p.r) * 100) : null;
        return `<button class="hb-lr${sel === s.id ? ' sel' : ''}" data-act="hb-sel" data-id="${s.id}" style="--hc:${col(s)}" aria-pressed="${sel === s.id}"><i class="pdot"></i><span class="hb-n"><b>${name(s)}</b><small>${esc(ruleText(s.r, s.d))}</small></span>${spark(s)}<span class="hb-p">${pct(r.r)}</span><span class="hb-d ${d == null ? '' : d >= 0 ? 'up' : 'dn'}">${d == null ? '' : (d >= 0 ? '+' : '−') + Math.abs(d) + '%'}</span></button>`; }).join('')}
      ${one ? `<div class="hb-acts"><button class="chip" data-act="hb-sel" data-id="">Show every habit</button><button class="chip" data-act="open" data-id="${one.id}">Open ${name(one)}</button></div>` : ''}
    </div></section>
    <section class="st-car st-box">${chartsHTML(show, card, a, b, 'hb-card')}</section>
    <section class="st-year st-box"><div class="hb-chips">${hs.map(s => `<button class="chip${s.id === ys.id ? ' set' : ''}" data-act="hb-year" data-id="${s.id}">${name(s)}</button>`).join('')}</div>${yearHTML(ys)}</section>
  </div>`;
}

/** The Habits card at the top of a day's List: the day's habits, one tap each, with the last 7 days as dots.
 *  Once every habit that day is done it folds to one line (tap to open it again). */
export function cardHTML(d, open, fold = false) { // fold: show one line until opened (other days in Week view)
  const hs = list().map(s => ({ s, o: occ(s, d) })).filter(x => x.o); if (!hs.length) return '';
  const done = hs.filter(x => x.o.done).length, n = hs.length, f = done / n;
  if ((done === n || fold) && !open) return `<div class="ad-card hb-cardl${done === n ? ' met' : ''}" style="--pc:var(--hb);--f:${f}"><button class="ad-main" data-act="hb-open" data-d="${d}" aria-expanded="false"><span class="ad-t">Habits</span><span class="ad-s">${done === n ? `<b>All ${n}</b> done` : `<b>${done}</b> of ${n}`} ${d === today() ? 'today' : 'that day'}</span></button></div>`;
  const dots = s => [...Array(7)].map((_, i) => { const day = add(d, i - 6), o = day >= s.d ? occ(s, day) : null; return `<i class="${!o ? 'n' : o.done ? 'y' : day === today() ? 't' : ''}"></i>`; }).join('');
  return `<div class="ad-card hb-cardl${done === n ? ' met' : ''}" style="--pc:var(--hb);--f:${f}"><div class="ad-main">
    <span class="ad-t">Habits</span><span class="ad-s"><b>${done}</b> of ${n} ${d === today() ? 'today' : 'that day'}</span>
    <div class="hb-list">${hs.map(({ s, o }) => `<div class="hb-row${o.done ? ' on' : ''}" style="--hc:${col(s)}"><button class="hb-ck" data-act="hb-tick" data-id="${o.id}" aria-pressed="${!!o.done}" aria-label="${o.done ? 'Undo' : 'Mark'} ${name(s)}"></button><button class="hb-t" data-act="open" data-id="${o.id}">${name(s)}${o.s != null ? ` <small>${fmtT(o.s)}</small>` : ''}</button><span class="hb-wk" title="The last 7 days">${dots(s)}</span></div>`).join('')}</div>
    ${done === n || fold ? `<button class="hb-fold" data-act="hb-open" data-d="${d}">Fold away</button>` : ''}
  </div></div>`;
}
