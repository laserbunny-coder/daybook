/* The day strip at the top of a day's list (Day view): the whole day as one bar.
   Calendar events are hatched (locked-in time), time you recorded shows as thin marks in its colour, and on today
   the stretch you're in is outlined with the time left until the next event. Time already gone is dimmed. The scale is
   fixed (6am to midnight) so it never shifts through the day. Under it, one line: open time left in the work day against the area goals
   still to do. Tapping that line sets the work hours (kept with the account, so every device agrees). */
import * as store from './store.js';
import * as aday from './areaday.js';
import { eventsOn, timedOn } from './calendar.js';
import { add, esc, fmtDur, fmtT, lsGet, lsSet, nowMin, pd, today } from './util.js';
import { colorOf } from './tree.js';

/* Work hours. from/to are the usual day; week can give a weekday its own hours or the day off ({off:1});
   days holds one-date changes (YYYY-MM-DD), which win over the week. Kept with the account. */
const KEY = 'daybook-work-hours', DEF = { from: 480, to: 1080 }, WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ok = h => h && Number.isFinite(+h.from) && Number.isFinite(+h.to) && +h.from >= 0 && +h.to <= 1440 && +h.from < +h.to;
const okDay = h => h && (h.off === 1 || h.off === true || ok(h));
const clean = h => {
  if (!ok(h)) return null;
  const out = { from: +h.from, to: +h.to }, cut = add(today(), -60);
  const week = Object.fromEntries(Object.entries(h.week || {}).filter(([k, v]) => WD.includes(k) && okDay(v)).map(([k, v]) => [k, v.off ? { off: 1 } : { from: +v.from, to: +v.to }]));
  const days = Object.fromEntries(Object.entries(h.days || {}).filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k >= cut && okDay(v)).map(([k, v]) => [k, v.off ? { off: 1 } : { from: +v.from, to: +v.to }]));
  if (Object.keys(week).length) out.week = week; if (Object.keys(days).length) out.days = days;
  return out;
};
let W = clean(lsGet(KEY, DEF)) || DEF, save = null, editing = false, weekEdit = false;
export const hours = () => W;
/** Hours set on another device (or by Claude) arrive with the account; f saves changes made here. */
export function useHours(h, f) { if (f) save = f; const c = clean(h); if (c && JSON.stringify(c) !== JSON.stringify(W)) { W = c; lsSet(KEY, W); } }
const commit = h => { const c = clean(h); if (!c) return false; W = c; lsSet(KEY, W); save?.(W); return true; };
const wkey = d => WD[pd(d).getDay()];
/** A weekday's usual hours, or null when it's a day off. */
export const usualOn = d => { const w = W.week?.[wkey(d)]; return w ? (w.off ? null : w) : { from: W.from, to: W.to }; };
/** The hours for one date: a change for that date, else the weekday's usual. null = not working. */
export const hoursOn = d => { const x = W.days?.[d]; return x ? (x.off ? null : x) : usualOn(d); };
export const isChanged = d => !!W.days?.[d];
/** Change one date's start or finish by 'by' minutes (half an hour a tap). */
export function stepDay(d, end, by) {
  const h = { ...(hoursOn(d) || usualOn(d) || { from: W.from, to: W.to }) }; h[end] = Math.max(0, Math.min(1440, h[end] + by));
  if (!ok(h)) return false;
  const u = usualOn(d), days = { ...W.days };
  if (u && u.from === h.from && u.to === h.to) delete days[d]; else days[d] = { from: h.from, to: h.to };
  return commit({ ...W, days });
}
export function dayOff(d, off) {
  const days = { ...W.days }, u = usualOn(d);
  if (off) { if (u) days[d] = { off: 1 }; else delete days[d]; }
  else { if (u) delete days[d]; else days[d] = { from: W.from, to: W.to }; }
  return commit({ ...W, days });
}
export const dayUsual = d => { const days = { ...W.days }; delete days[d]; return commit({ ...W, days }); };
/** Weekly hours: k is mon..sun; v is {from,to}, {off:1}, or a part of {from,to}. */
export function setWeek(k, v) {
  const cur = W.week?.[k] && !W.week[k].off ? W.week[k] : { from: W.from, to: W.to };
  const nv = v.off ? { off: 1 } : { ...cur, ...v }; if (!v.off && !ok(nv)) return false;
  return commit({ ...W, week: { ...W.week, [k]: nv } });
}
export function copyMonday() {
  const m = W.week?.mon || { from: W.from, to: W.to };
  return commit({ ...W, week: { ...W.week, tue: m, wed: m, thu: m, fri: m } });
}
export function setHours(from, to) { return commit({ ...W, from: from ?? W.from, to: to ?? W.to }); }
export const toggleEdit = () => { editing = !editing; if (!editing) weekEdit = false; };
export const toggleWeek = () => { weekEdit = !weekEdit; };
/* The little bars in Weekly hours: drag either end (half an hour at a time) and the dropdowns follow when you let go.
   The bar runs from 4am to midnight. */
const WA = 240, WZ = 1440, WP = m => ((m - WA) / (WZ - WA) * 100).toFixed(2);
let changed = () => {};
export const onChange = f => { changed = f; };
if (typeof document !== 'undefined') {
  let g = null;
  const at = (x, r) => Math.round((WA + (x - r.left) / r.width * (WZ - WA)) / 30) * 30;
  document.addEventListener('pointerdown', e => { const h = e.target.closest?.('.ds-wh'); if (!h) return; e.preventDefault(); e.stopPropagation();
    const bar = h.parentElement, k = h.dataset.wk, v = W.week?.[k] && !W.week[k].off ? W.week[k] : { from: W.from, to: W.to };
    g = { k, end: h.dataset.end, bar, v: { ...v } }; h.setPointerCapture?.(e.pointerId); }, true);
  document.addEventListener('pointermove', e => { if (!g) return; const m = at(e.clientX, g.bar.getBoundingClientRect());
    if (g.end === 'from') g.v.from = Math.max(WA, Math.min(g.v.to - 30, m)); else g.v.to = Math.min(WZ, Math.max(g.v.from + 30, m));
    g.bar.querySelector('.ds-won').style.cssText = `left:${WP(g.v.from)}%;width:${WP(g.v.to) - WP(g.v.from)}%`;
    g.bar.querySelector('[data-end="from"]').style.left = WP(g.v.from) + '%'; g.bar.querySelector('[data-end="to"]').style.left = WP(g.v.to) + '%'; });
  const up = () => { if (!g) return; const x = g; g = null; setWeek(x.k, { from: x.v.from, to: x.v.to }); changed(); };
  document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  // Arrow keys move a focused end by half an hour
  document.addEventListener('keydown', e => { const h = e.target.closest?.('.ds-wh'); if (!h || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault();
    const k = h.dataset.wk, v = W.week?.[k] && !W.week[k].off ? W.week[k] : { from: W.from, to: W.to }, by = e.key === 'ArrowLeft' ? -30 : 30, end = h.dataset.end;
    setWeek(k, { [end]: Math.max(WA, Math.min(WZ, v[end] + by)) }); changed(); document.querySelector(`.ds-wh[data-wk="${k}"][data-end="${end}"]`)?.focus(); });
}
// Tapping an event on the strip (or an all-day pill) shows its full name and times under the strip; tapping it again hides them
let sel = null;
export const pick = k => { sel = sel === k ? null : k; };
const okColor = c => /^#[0-9a-f]{3,8}$/i.test(c || '');
const tint = e => okColor(e.color) ? `--c:${e.color}` : '';
const evTimes = e => e.allDay ? 'All day' : `${fmtT(e.s)} to ${fmtT(e.s + (e.m || 0))}`;
/** All-day events as small pills in their calendar colour, above the strip. */
function allDay(d, A) {
  return A.length ? `<div class="ds-ad">${A.map((e, i) => `<button class="ds-adp${sel === `${d}|a${i}` ? ' sel' : ''}" style="${tint(e)}" data-act="ds-ev" data-k="${d}|a${i}" title="${esc(e.t || 'All day')}">${esc(e.t || 'All day')}</button>`).join('')}</div>` : '';
}
function caption(d, E, A) {
  if (!sel || !sel.startsWith(d + '|')) return '';
  const k = sel.slice(d.length + 1), e = k[0] === 'a' ? A[+k.slice(1)] : E[+k.slice(1)];
  if (!e) return '';
  const n = d === today() ? nowMin() : null, soon = !e.allDay && n != null && e.s > n ? ` \u00b7 in ${fmtDur(e.s - n)}` : '';
  return `<div class="ds-cap" style="${tint(e)}"><span class="pdot"></span><b>${esc(e.t || 'Busy')}</b><small>${evTimes(e)}${soon}</small></div>`;
}

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

const span = (E, ST = []) => [Math.max(0, Math.floor(Math.min(360, ...E.map(e => e.s), ...ST.map(x => x.s)) / 60) * 60), 1440];

export function html(d) {
  const E = timedOn(d).filter(e => e.s + (e.m || 0) > 0 && e.s < 1440), T = today(), isT = d === T, past = d < T;
  const ST = stretches(d), n = isT ? nowMin() : null, H = hoursOn(d), off = !H, h = H || { from: 720, to: 720 };
  // A steady scale: always 6am to midnight (earlier only if something starts before 6am), never rescaled through the day
  const [a, z] = span(E, ST);
  const P = m => (Math.max(a, Math.min(z, m)) - a) / (z - a) * 100;
  const box = (cls, s, e, inner = '', extra = '') => `<div class="${cls}" style="left:${P(s).toFixed(2)}%;width:${(P(e) - P(s)).toFixed(2)}%"${extra}>${inner}</div>`;
  const from = isT && H ? Math.min(h.from, Math.max(a, n)) : h.from, wins = H ? windows(E, from, h.to) : [];
  const cur = isT && wins.find(w => w.s <= n && n < w.e), next = isT ? E.find(e => e.s > n) : null, inEv = isT && E.find(e => e.s <= n && n < e.s + (e.m || 0));
  const parts = [];
  if (off) parts.push(box('ds-off', a, z)); else { if (h.from > a) parts.push(box('ds-off', a, h.from)); if (h.to < z) parts.push(box('ds-off', h.to, z)); }
  if (isT && n > a) parts.push(box('ds-gone', a, Math.min(n, z)));
  // Faint hour lines every 3 hours so the steady scale reads at a glance (noon a bit stronger)
  for (let m = Math.ceil((a + 1) / 180) * 180; m < z; m += 180) parts.push(`<i class="ds-hr${m === 720 ? ' noon' : ''}" style="left:${P(m).toFixed(2)}%"></i>`);
  for (const w of wins) {
    const s = isT ? Math.max(w.s, n) : w.s; if (w.e <= s || (past)) continue;
    if (w === cur) { const left = w.e - n, why = next && next.s === w.e ? `until ${esc(next.t || 'the next event')}` : 'until the end of the work day';
      parts.push(box('ds-cur', s, w.e, '', ` title="${fmtDur(left)} ${why}"`)); }
  }
  if (isT && !cur && !inEv && next && !past) parts.push(box('ds-cur ds-free', n, next.s, '', ` title="${fmtDur(next.s - n)} free until ${esc(next.t || 'the next event')}"`));
  // The free time between one event and the next, work hours or not (say from Desk until Bed); the stretch you're in has its countdown under the bar
  if (!past) { let end = null;
    // the work day's start and finish count as edges too, but only before the first event and after the last
    const B = [...(H && (!E.length || E[0].s > h.from) ? [{ s: h.from, m: 0 }] : []), ...E, ...(H && (!E.length || Math.max(...E.map(e => e.s + (e.m || 0))) < h.to) ? [{ s: h.to, m: 0 }] : [])];
    for (const e of B) { const g0 = end == null ? null : isT ? Math.max(end, n) : end;
      if (g0 != null && e.s - g0 >= 15) {
      // split where the work day starts or ends, so the evening (or early morning) gets its own number;
      // today, the piece you're in now is skipped (its countdown is under the bar) but the ones after it still show
      const cuts = [g0, ...(H ? [h.from, h.to].filter(m => m > g0 && m < e.s) : []), e.s];
      for (let j = 1; j < cuts.length; j++) { if (isT && cuts[j - 1] === n) continue;
        if (cuts[j] - cuts[j - 1] >= 15 && P(cuts[j]) - P(cuts[j - 1]) > 9) parts.push(box('ds-gap', cuts[j - 1], cuts[j], fmtDur(cuts[j] - cuts[j - 1]))); } }
      end = Math.max(end ?? 0, e.s + (e.m || 0)); } }
  E.forEach((e, i) => { const w = P(e.s + (e.m || 0)) - P(e.s), t = e.t || 'Busy', k = `${d}|e${i}`;
    parts.push(box(`ds-ev${inEv === e ? ' now' : ''}${sel === k ? ' sel' : ''}`, e.s, e.s + (e.m || 0), w > t.length * 1.7 ? esc(t) : '', ` data-act="ds-ev" data-k="${k}" role="button" title="${esc(t)} · ${evTimes(e)}"`).replace('" data-act', `${tint(e) ? ';' + tint(e) : ''}" data-act`)); });
  for (const x of ST) parts.push(`<i class="ds-sw" style="left:${P(x.s).toFixed(2)}%;width:${Math.max(.6, P(x.e) - P(x.s)).toFixed(2)}%;--pc:${x.c}"></i>`);
  if (isT && n >= a && n <= z) parts.push(`<i class="ds-nw" style="left:${P(n).toFixed(2)}%"></i>`);
  // Over the bar: each event ahead, its time and name in its colour (dropped where they'd crowd, cut short to fit)
  const ahead = E.map((e, i) => ({ e, i, p: P(e.s) })).filter(x => !isT || x.e.s > n).filter(x => x.p < 100);
  const kept = []; for (const x of ahead) if (!kept.length || x.p - kept[kept.length - 1].p >= 9) kept.push(x);
  // The last name may sit against the right edge; then it and the one before share what's left halfway
  const L = kept[kept.length - 1], lastRight = L && L.p > 72, before = kept[kept.length - 2];
  const cut = lastRight ? Math.min(L.p, before ? before.p + (100 - before.p) / 2 : 0) : 100;
  const names = kept.map((x, j) => { const nx = kept[j + 1], right = x === L && lastRight;
    const end = nx === L && lastRight ? cut : nx ? nx.p : 100;
    const pos = right ? `right:0;max-width:${(100 - cut).toFixed(2)}%` : `left:${x.p.toFixed(2)}%;max-width:calc(${(end - x.p).toFixed(2)}% - 10px)`;
    return `<button class="ds-nm" style="${pos}${tint(x.e) ? ';' + tint(x.e) : ''}" data-act="ds-ev" data-k="${d}|e${x.i}"><i>${fmtT(x.e.s)}</i>${esc(x.e.t || 'Busy')}</button>`; }).join('');
  // Then the time now with the countdown, so it never gets squeezed inside a small stretch
  let tick;
  if (isT && n >= a && n <= z) {
    const left = cur ? cur.e - n : 0, why = cur ? (next && next.s === cur.e ? `until ${esc(next.t || 'the next event')}` : 'left in the work day') : '';
    // Outside work hours: in an event, say until when; otherwise the free time until the next event
    const extra = cur ? ` \u00b7 <b>${fmtDur(left)}</b> ${why}` : inEv ? ` \u00b7 ${esc(inEv.t || 'Busy')} until ${fmtT(inEv.s + (inEv.m || 0))}` : next ? ` \u00b7 <b>${fmtDur(next.s - n)}</b> free until ${esc(next.t || 'the next event')}` : '';
    tick = `<span class="ds-tnow" style="left:${P(n).toFixed(2)}%;transform:translateX(-${P(n).toFixed(2)}%)">${fmtT(n)}${extra}</span>`;
  } else tick = `<span style="left:0">${fmtT(a)}</span>`;
  const ticks = tick;
  // Open time left against the area goals still to do
  let fit = '';
  if (!past) {
    const open = wins.reduce((t, w) => t + Math.max(0, w.e - Math.max(w.s, isT ? n : 0)), 0), goals = Math.round(goalsLeft(d));
    const over = !off && isT && n >= h.to;
    const lead = off ? `<span><b>Not a work day</b></span>` : over ? `<span>Work day ended at <b>${fmtTT(h.to)}</b></span>` : `<span>Open time ${isT ? 'left ' : ''}<b>${fmtDur(open)}</b></span>`;
    const g = goals ? `<span>Goals left <b>${fmtDur(goals)}</b></span>${over || off ? '' : `<span class="${open >= goals ? 'ok' : 'short'}">${open >= goals ? fmtDur(open - goals) + ' spare' : fmtDur(goals - open) + ' short'}</span>`}` : `<span>${aday.cardsOn(d).some(c => c.target > 0) ? 'Area goals all met' : 'No area goals'}</span>`;
    fit = `<button class="ds-fit" data-act="ds-hours" aria-expanded="${editing}" title="Change this day's hours or goals${H ? ` (${fmtT(h.from)} to ${fmtTT(h.to)})` : ''}">${lead}${g}<span class="ds-adj">${editing ? 'Close' : 'Adjust'}</span></button>`;
    if (editing) {
      // Today's goals, quick to change for this day only (30 minutes a tap); "usual" puts the weekday's hours back
      const rows = aday.areas().map(x => ({ a: x, t: aday.targetOn(x, d), u: Math.max(0, +(x.dg?.[aday.keyOf(d)] || 0)), o: aday.isOverride(x.dg, d) })).filter(r => r.t > 0 || r.u > 0 || r.o);
      if (rows.length) fit += `<div class="ds-goals"><div class="ds-gl">${isT ? 'Today\u2019s' : 'This day\u2019s'} goals <small>for this day only</small></div>${rows.map(r => `<div class="ds-g" style="--pc:${colorOf(r.a)}"><span class="pdot"></span><span class="ds-gn">${esc(r.a.t || 'Untitled area')}${r.o ? `<small>usually ${r.u ? fmtDur(r.u) : 'none'}</small>` : ''}</span><button class="ib" data-act="ds-goal" data-id="${r.a.id}" data-d="${d}" data-by="-30" aria-label="Less ${esc(r.a.t)} time"${r.t ? '' : ' disabled'}>\u2212</button><b>${r.t ? fmtDur(r.t) : 'Off'}</b><button class="ib" data-act="ds-goal" data-id="${r.a.id}" data-d="${d}" data-by="30" aria-label="More ${esc(r.a.t)} time">+</button>${r.o ? `<button class="ds-usual" data-act="ds-goal" data-id="${r.a.id}" data-d="${d}" data-by="usual">Usual</button>` : '<span class="ds-usual"></span>'}</div>`).join('')}</div>`;
      // This day's hours first: start and finish, half an hour a tap; Usual puts the weekday's hours back
      const day = isT ? 'Today\u2019s' : 'This day\u2019s', u = usualOn(d), chg = isChanged(d);
      const step = (lab, end) => `<div class="ds-g"><span class="ds-gn">${lab}</span><button class="ib" data-act="ds-step" data-d="${d}" data-end="${end}" data-by="-30" aria-label="${lab} earlier">\u2212</button><b>${fmtTT(h[end])}</b><button class="ib" data-act="ds-step" data-d="${d}" data-end="${end}" data-by="30" aria-label="${lab} later">+</button><span class="ds-usual"></span></div>`;
      const usual = u ? `usually ${fmtT(u.from)} to ${fmtTT(u.to)}` : 'usually a day off';
      const hrs = `<div class="ds-goals ds-dh"><div class="ds-gl">${day} hours <small>${chg ? usual : 'for this day only'}</small>${chg ? `<button class="ds-usual" data-act="ds-dayusual" data-d="${d}">Usual</button>` : ''}</div>${off ? `<div class="ds-g"><span class="ds-gn">Not working${isT ? ' today' : ''}</span><button class="tb" data-act="ds-dayoff" data-d="${d}" data-off="0">Work ${isT ? 'today' : 'this day'}</button></div>` : step('Start', 'from') + step('Finish', 'to') + `<button class="ds-link" data-act="ds-dayoff" data-d="${d}" data-off="1">Take ${isT ? 'today' : 'this day'} off</button>`}</div>`;
      fit = fit.replace('<div class="ds-goals">', hrs + '<div class="ds-goals">');
      if (!rows.length) fit += hrs;
      // The weekly schedule, one tap deeper
      const opts = (v, lo, hi) => { let o = ''; for (let m = lo; m <= hi; m += 30) o += `<option value="${m}"${m === v ? ' selected' : ''}>${fmtTT(m)}</option>`; return o; };
      const ORD = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], NM = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
      const wk = k => { const v = W.week?.[k]; return v ? v : { from: W.from, to: W.to }; };
      const total = ORD.reduce((t, k) => { const v = wk(k); return t + (v.off ? 0 : v.to - v.from); }, 0);
      fit += weekEdit ? `<div class="ds-week"><div class="ds-gl">Weekly hours <small>about ${fmtDur(total)} a week</small></div>${ORD.map(k => { const v = wk(k);
        const bar = v.off ? '' : `<div class="ds-wbar" data-wk="${k}"><i class="ds-won" style="left:${WP(v.from)}%;width:${WP(v.to) - WP(v.from)}%"></i><button class="ds-wh" data-wk="${k}" data-end="from" style="left:${WP(v.from)}%" aria-label="Drag ${NM[k]} start"></button><button class="ds-wh" data-wk="${k}" data-end="to" style="left:${WP(v.to)}%" aria-label="Drag ${NM[k]} finish"></button></div>`;
        return `<div class="ds-wr${v.off ? ' off' : ''}"><span class="ds-wd">${NM[k]}</span><span class="ds-wsel">${v.off ? 'Not working' : `<select class="ds-wsel-f" data-wk="${k}" data-end="from" aria-label="${NM[k]} start">${opts(v.from, 240, 840)}</select><span>to</span><select data-wk="${k}" data-end="to" aria-label="${NM[k]} finish">${opts(v.to, 600, 1440)}</select>`}</span><button class="ds-tg" data-act="ds-wkon" data-wk="${k}" aria-pressed="${!v.off}" aria-label="Work on ${NM[k]}"></button>${bar}</div>`; }).join('')}<div class="ds-wfoot"><button class="ds-link" data-act="ds-copymon">Copy Monday to weekdays</button><button class="tb" data-act="ds-week">Done</button></div></div>`
        : `<button class="ds-link ds-wlink" data-act="ds-week">Weekly hours \u203a</button>`;
    }
  }
  const A = eventsOn(d).filter(e => e.allDay);
  return `<div class="ds${isT ? ' today' : ''}${past ? ' past' : ''}">${allDay(d, A)}${names ? `<div class="ds-names">${names}</div>` : ''}<div class="ds-bar" role="img" aria-label="${isT && cur ? `${fmtDur(cur.e - n)} free${next && next.s === cur.e ? ' until ' + esc(next.t || 'the next event') : ''}` : 'The day'}">${parts.join('')}</div><div class="ds-ticks">${ticks}</div>${caption(d, E, A)}${fit}</div>`;
}

/** A day's work windows and what's left: open minutes in the work hours (from now on, for today) and goal minutes still to do. */
export function info(d) {
  const E = timedOn(d).filter(e => e.s + (e.m || 0) > 0 && e.s < 1440), T = today(), isT = d === T, past = d < T, n = isT ? nowMin() : null;
  const H = hoursOn(d), wins = H ? windows(E, isT ? Math.min(H.from, Math.max(0, n)) : H.from, H.to) : [];
  const cur = isT ? wins.find(w => w.s <= n && n < w.e) || null : null, next = isT ? E.find(e => e.s > n) || null : null;
  const open = past ? 0 : wins.reduce((t, w) => t + Math.max(0, w.e - Math.max(w.s, isT ? n : 0)), 0);
  return { E, isT, past, n, wins, cur, next, open, off: !H, H, goals: Math.round(goalsLeft(d)), hasGoals: aday.cardsOn(d).some(c => c.target > 0) };
}
/** Week view: the strip without labels, and the fit line as a small chip that opens the day (where it can be adjusted). */
export function mini(d) {
  const I = info(d), h = I.H || { from: 720, to: 720 }, [A, Z] = span(I.E, stretches(d)), P = m => ((Math.max(A, Math.min(Z, m)) - A) / (Z - A) * 100).toFixed(2);
  const box = (c, s, e) => `<div class="${c}" style="left:${P(s)}%;width:${(P(e) - P(s)).toFixed(2)}%"></div>`;
  let p = I.off ? box('ds-off', A, Z) : (h.from > A ? box('ds-off', A, h.from) : '') + (h.to < Z ? box('ds-off', h.to, Z) : '');
  if (I.isT) p += box('ds-gone', A, I.n);
  if (I.cur) p += box('ds-cur', I.n, I.cur.e);
  for (const e of I.E) p += box('ds-ev', e.s, e.s + (e.m || 0)).replace('%"', `%${tint(e) ? ';' + tint(e) : ''}"`);
  for (const x of stretches(d)) p += `<i class="ds-sw" style="left:${P(x.s)}%;width:${Math.max(1, P(x.e) - P(x.s))}%;--pc:${x.c}"></i>`;
  if (I.isT && I.n >= A && I.n <= Z) p += `<i class="ds-nw" style="left:${P(I.n)}%"></i>`;
  const AD = eventsOn(d).filter(e => e.allDay);
  // all-day pills go under the chip, so the strips of the week still line up
  return `<div class="ds ds-mini"><div class="ds-bar">${p}</div>${chip(d, I)}${AD.length ? `<div class="ds-ad">${AD.map(e => `<span class="ds-adp" style="${tint(e)}" title="${esc(e.t || 'All day')}">${esc(e.t || 'All day')}</span>`).join('')}</div>` : ''}</div>`;
}
/** The fit line as a small chip that opens the day: worked time on past days, open time against goals ahead. */
export function chip(d, I = info(d)) {
  let f;
  if (I.past) { const w = Math.round(Object.values(aday.loggedOn(d)).reduce((t, o) => t + o.min, 0)); f = w ? `<span>Worked <b>${fmtDur(w)}</b></span>` : ''; }
  else if (I.off) f = `<span>Day off${I.goals ? `, <b>${fmtDur(I.goals)}</b> goals` : ''}</span>`;
  else f = `<span><b>${fmtDur(I.open)}</b> open${I.goals ? `, <b>${fmtDur(I.goals)}</b> goals` : ''}</span>${I.goals ? `<span class="${I.open >= I.goals ? 'ok' : 'short'}">${I.open >= I.goals ? fmtDur(I.open - I.goals) + ' spare' : fmtDur(I.goals - I.open) + ' short'}</span>` : ''}`;
  return f ? `<button class="ds-chip" data-act="goday" data-d="${d}" title="Open this day">${f}</button>` : '';
}
/** Timeline (the Time blocks grid): each free stretch of the work day as a faint box with its length; the one you're in counts down. */
export function gaps(d, top, height, busy = []) {
  const I = info(d); if (I.past) return '';
  const B = busy.map(b => [b.s, b.s + (b.m || 60)]).sort((x, y) => x[0] - y[0]), out = [];
  for (const w of I.wins) { // the free bits of each window: what no task, block or recorded stretch already takes
    let t = I.isT ? Math.max(w.s, I.n) : w.s;
    for (const [s, e] of B) { if (e <= t || s >= w.e) continue; if (s > t) out.push({ s: t, e: s, w }); t = Math.max(t, e); }
    if (t < w.e) out.push({ s: t, e: w.e, w });
  }
  return out.filter(g => g.e - g.s >= 20).map(g => { const cur = I.isT && I.cur === g.w && g.s <= I.n;
    const why = cur ? (I.next && I.next.s === g.w.e ? `until ${esc(I.next.t || 'the next event')}` : 'until the end of the work day') : '';
    return `<div class="tl-gap${cur ? ' cur' : ''}" style="top:${top(g.s)};height:${height(g.e - g.s)}">${cur ? `<span><b>${fmtDur(g.w.e - I.n)}</b> left ${why}</span>` : `<span>${fmtDur(g.e - g.s)} free</span>`}</div>`; }).join('');
}
