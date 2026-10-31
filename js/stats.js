// Stats: where the recorded time went, for a day, a week, a month, a year, all time or any range.
// The Ledger sits on top (hours and share per area, and how that changed since the period before),
// a row of charts underneath swipes sideways (Share, Days, Projects, Rhythm, Pace, Flow), and the
// year in squares closes the page. Tapping an area narrows the whole page to its projects.
// Every stretch in the time log counts, cut at midnight. A guessed stretch (checked off without
// the timer) counts toward the hours, since the work was done, but never toward Pace.
import * as store from './store.js';
import * as track from './track.js';
import { add, DAYL, daysBetween, esc, fd, fmtShort, MON, nowMin, pd, today, weekStart } from './util.js';
import { children, hasKids, ink, leaves, projColor, rootOf, targetOf } from './tree.js';

let C = null; // what the app hands over: { S, render }
export function init(ctx) { C = ctx; }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const KINDS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All'], ['custom', 'Custom']];
const CARDS = [['share', 'Share'], ['days', 'Days'], ['projects', 'Projects'], ['rhythm', 'Rhythm'], ['pace', 'Pace'], ['flow', 'Flow']];
const NOAREA = '#B9BCD0';
const cssVar = (k, d) => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d;
const bg = () => cssVar('--bg', '#1C1A17'); // the look's background, for shading

/* Colours */
const hexOk = c => /^#[0-9a-f]{6}$/i.test(c || '');
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function mix(a, b, t) { if (!hexOk(a)) a = NOAREA; const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
const lum = c => { const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const shade = (c, k) => k ? mix(c, bg(), [0, .3, .5, .62, .7][Math.min(k, 4)]) : (hexOk(c) ? c : NOAREA);

/* Hours */
export const fmtH = m => { m = Math.round(m); const h = Math.floor(m / 60), mm = m % 60; return h ? (mm ? `${h}h ${mm}m` : `${h}h`) : `${mm}m`; };
const fmtHs = m => { const h = m / 60; return h >= 10 ? Math.round(h) + 'h' : h >= 1 ? (Math.round(h * 10) / 10) + 'h' : Math.round(m) + 'm'; };
const pct = (v, t) => t ? Math.round(v / t * 100) : 0;

/* Every stretch of recorded time, cut at midnight: its day, the minute it starts, how long, and whose it is */
function pieces() {
  const out = [], now = Date.now();
  for (const n of store.logged()) {
    let host = n.rs ? (store.get(n.rs) || n) : n; // a repeat counts where its series lives
    if (host.k === 'block') { const t = targetOf(host); if (t) host = t; } // time in an area or project block counts for that area or project
    const root = rootOf(host);
    for (const e of n.tl) {
      let a = Date.parse(e.start); const b = e.end ? Date.parse(e.end) : now;
      if (!(b > a)) continue;
      while (a < b) {
        const t = new Date(a), mid = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime(), c = Math.min(b, mid);
        out.push({ d: fd(t), s: t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60, m: (c - a) / 60000, n: host, root, g: !!e.guess });
        a = c;
      }
    }
  }
  return out;
}
const areaKey = r => (r.k === 'area' ? r.id : r.ar && store.get(r.ar)?.k === 'area' ? r.ar : '~'); // ~ stands for no area

/* The range on show: the period around S.stAt, or the custom days */
export function range() {
  const S = C.S, k = S.stK || 'week', T = today(), at = S.stAt || T;
  let a, b, label;
  if (k === 'day') { a = b = at; label = at === T ? 'Today' : at === add(T, -1) ? 'Yesterday' : `${DAYL[pd(at).getDay()]}, ${fmtShort(at)}`; }
  else if (k === 'week') { a = weekStart(at); b = add(a, 6); const tw = weekStart(T); label = a === tw ? 'This week' : a === add(tw, -7) ? 'Last week' : `${fmtShort(a)} – ${fmtShort(b)}`; }
  else if (k === 'month') { const d = pd(at); a = fd(new Date(d.getFullYear(), d.getMonth(), 1)); b = fd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); label = MONTHS[d.getMonth()] + (d.getFullYear() !== pd(T).getFullYear() ? ' ' + d.getFullYear() : ''); }
  else if (k === 'year') { const y = pd(at).getFullYear(); a = `${y}-01-01`; b = `${y}-12-31`; label = String(y); }
  else if (k === 'all') { a = first() || T; b = T; label = 'All time'; }
  else { a = S.stFrom || add(T, -29); b = S.stTo || T; if (a > b) [a, b] = [b, a]; label = `${fmtShort(a)} – ${fmtShort(b)}`; }
  return { k, a, b, label };
}
function first() { // the first day anything was recorded
  let f = null; for (const n of store.logged()) for (const e of n.tl) { const d = fd(new Date(e.start)); if (!f || d < f) f = d; }
  return f;
}
/** Earlier or later by one period (a custom range moves by its own length). */
export function go(dir) {
  const S = C.S, R = range(), at = S.stAt || today();
  if (R.k === 'day') S.stAt = add(at, dir);
  else if (R.k === 'week') S.stAt = add(at, 7 * dir);
  else if (R.k === 'month') { const d = pd(R.a); S.stAt = fd(new Date(d.getFullYear(), d.getMonth() + dir, 1)); }
  else if (R.k === 'year') S.stAt = `${pd(R.a).getFullYear() + dir}-01-01`;
  else if (R.k === 'custom') { const n = (daysBetween(R.a, R.b) + 1) * dir; S.stFrom = add(R.a, n); S.stTo = add(R.b, n); }
  else return;
  C.render();
}
export function goToday() {
  const S = C.S; S.stAt = today();
  if (S.stK === 'custom') { const R = range(), n = daysBetween(R.a, R.b); S.stTo = today(); S.stFrom = add(today(), -n); }
  C.render();
}

/* Everything the page shows, worked out once per draw */
function model() {
  const S = C.S, R = range(), P = pieces(), T = today();
  const area = S.stArea && (S.stArea === '~' || store.get(S.stArea)?.k === 'area') ? S.stArea : null; // the area tapped, if it's still there
  if (area == null) S.stArea = null;
  const span = daysBetween(R.a, R.b) + 1, pa = add(R.a, -span), f0 = first();
  // A period still going is weighed against the one before up to the same point (this week so far against last week by now)
  const going = R.b >= T && R.a <= T, pb = going ? add(pa, daysBetween(R.a, T)) : add(R.a, -1), cut = going ? nowMin() : 1440;
  const prevPart = p => p.d < pb ? p.m : p.d === pb ? Math.max(0, Math.min(p.m, cut - p.s)) : 0;
  const mine = P.filter(p => area == null || areaKey(p.root) === area);
  const G = new Map(), gKey = p => area == null ? areaKey(p.root) : p.root.id;
  const grp = (p, k) => {
    let g = G.get(k); if (g) return g;
    if (area == null) { const a = k !== '~' && store.get(k); g = { key: k, name: a ? a.t || 'Untitled area' : 'No area', base: a ? ink(a.c) : ink(), act: 'st-area', id: k }; }
    else g = { key: k, name: p.root.k === 'area' ? 'Area time' : p.root.t || 'Untitled', base: projColor(p.root), act: 'open', id: p.root.id };
    Object.assign(g, { m: 0, pm: 0, gm: 0, subs: new Map() }); G.set(k, g); return g;
  };
  const inR = [];
  for (const p of mine) {
    if (p.d >= R.a && p.d <= R.b) {
      const g = grp(p, gKey(p)); g.m += p.m; if (p.g) g.gm += p.m; inR.push(p);
      if (area == null) { let s = g.subs.get(p.root.id); if (!s) g.subs.set(p.root.id, s = { id: p.root.id, name: p.root.k === 'area' ? 'Area time' : p.root.t || 'Untitled', base: projColor(p.root), m: 0 }); s.m += p.m; }
    } else if (p.d >= pa && p.d <= pb && prevPart(p) > 0) grp(p, gKey(p)).pm += prevPart(p);
  }
  const groups = [...G.values()].filter(g => g.m > 0 || g.pm > 0).sort((x, y) => y.m - x.m || y.pm - x.pm);
  // Colours: an area wears its own; projects that share their area's colour get darker shades of it, in order of time
  const used = new Map(), tone = c => { const k = used.get(c) || 0; used.set(c, k + 1); return shade(c, k); };
  if (area != null) groups.forEach(g => g.c = tone(g.base));
  else groups.forEach(g => { g.c = hexOk(g.base) ? g.base : NOAREA; const u = new Map(); g.subs = [...g.subs.values()].sort((x, y) => y.m - x.m); g.subs.forEach(s => { const c = s.base === g.base || !hexOk(s.base) ? g.c : s.base; const k = u.get(c) || 0; u.set(c, k + 1); s.c = shade(c, k); }); });
  if (area != null) groups.forEach(g => g.subs = []);
  const gi = new Map(groups.map((g, i) => [g.key, i]));
  const total = groups.reduce((a, g) => a + g.m, 0), ptotal = groups.reduce((a, g) => a + g.pm, 0), guessed = groups.reduce((a, g) => a + g.gm, 0);
  const lo = f0 && f0 > R.a ? f0 : R.a, hi = R.b < T ? R.b : T;
  const elapsed = Math.max(1, daysBetween(lo, hi) + 1);
  const areaName = area == null ? null : area !== '~' ? store.get(area)?.t || 'Untitled area' : 'No area';
  const areaC = area == null ? null : area !== '~' ? ink(store.get(area)?.c) : ink();
  return { R, span, area, areaName, areaC, groups, gi, gKey, ps: inR, mine, total, ptotal, guessed, prevOk: !!f0 && pa >= f0 && R.k !== 'all', elapsed, any: P.length > 0 };
}

/* Bins along the range: hours for one day, days up to six weeks, then weeks (Flow) or months */
function bins(M, fine) {
  const R = M.R, n = M.groups.length, z = () => new Array(n).fill(0), T = today();
  if (M.span === 1) {
    const b = Array.from({ length: 24 }, (_, h) => ({ lab: h % 6 ? '' : String(h).padStart(2, '0'), v: z() }));
    M.ps.forEach(p => hours(p, (h, m) => b[h].v[M.gi.get(M.gKey(p))] += m));
    return { b, unit: 'hour' };
  }
  const last = fine && R.b > T ? T : R.b; // the flow stops at today
  if (M.span <= 45) {
    const b = []; for (let d = R.a; d <= last; d = add(d, 1)) { const x = pd(d); b.push({ d, lab: M.span <= 7 ? 'MTWTFSS'[(x.getDay() + 6) % 7] : (x.getDate() % 5 === 1 && x.getDate() < 30 ? String(x.getDate()) : ''), v: z(), future: d > T, now: d === T, go: ['day', d] }); }
    M.ps.forEach(p => b[daysBetween(R.a, p.d)].v[M.gi.get(M.gKey(p))] += p.m);
    return { b, unit: 'day' };
  }
  if (fine) {
    const b = []; for (let d = R.a; d <= last; d = add(d, 7)) b.push({ d, v: z() });
    M.ps.forEach(p => { const w = b[Math.floor(daysBetween(R.a, p.d) / 7)]; if (w) w.v[M.gi.get(M.gKey(p))] += p.m; });
    return { b, unit: 'week' };
  }
  const b = []; let x = pd(R.a); x = new Date(x.getFullYear(), x.getMonth(), 1);
  const many = daysBetween(R.a, R.b) > 400;
  while (fd(x) <= R.b) { const d = fd(x); b.push({ d, y: x.getFullYear(), mo: x.getMonth(), lab: many && x.getMonth() % 3 ? '' : MON[x.getMonth()][0], v: z(), future: d > T, now: d.slice(0, 7) === T.slice(0, 7), go: ['month', d] }); x = new Date(x.getFullYear(), x.getMonth() + 1, 1); }
  M.ps.forEach(p => { const q = b.find(c => c.d.slice(0, 7) === p.d.slice(0, 7)); if (q) q.v[M.gi.get(M.gKey(p))] += p.m; });
  return { b, unit: 'month' };
}
function hours(p, fn) { let t = p.s; const end = p.s + p.m; while (t < end - 1e-6) { const h = Math.floor(t / 60), nx = Math.min(end, (h + 1) * 60); fn(Math.min(23, h), nx - t); t = nx; } }
const sum = v => v.reduce((a, x) => a + x, 0);
function niceMax(v) { const s = [30, 60, 120, 180, 240, 360, 480, 600, 720, 960, 1200, 1800, 2400, 3000, 3600, 4800, 6000, 7200, 9000, 12000, 18000, 24000, 36000, 48000]; return s.find(x => x >= v) || Math.ceil(v / 12000) * 12000; }
const words = R => ({ day: R.label === 'Today' ? 'today' : R.label === 'Yesterday' ? 'yesterday' : 'that day', week: R.label === 'This week' ? 'this week' : R.label === 'Last week' ? 'last week' : 'that week', month: 'in ' + R.label, year: 'in ' + R.label, all: 'so far', custom: 'in these days' }[R.k]);
const before = R => ({ day: 'the day before', week: 'the week before', month: 'the month before', year: 'the year before', custom: 'the days before' }[R.k] || '');
const none = M => `<div class="st-none">Nothing recorded ${words(M.R)}${M.area != null ? ` in ${esc(M.areaName)}` : ''}.</div>`;

/* A. The Ledger: one line split by area, then each area with its hours, share and change */
function ledger(M) {
  const R = M.R;
  let sub = '';
  if (M.total && M.prevOk && M.ptotal) { const d = M.total - M.ptotal; const by = R.b >= today() && R.k !== 'day' ? ' by now' : ''; sub = Math.abs(d) < 30 ? `About the same as ${before(R)}${by}` : `${d > 0 ? 'Up' : 'Down'} ${fmtH(Math.abs(d))} from ${before(R)}${by}`; }
  else if (M.total && R.k !== 'day') sub = `${fmtH(M.total / M.elapsed)} a day on average`;
  const filt = M.area != null ? `<button class="st-filter" data-act="st-area" data-id="" style="--pc:${M.areaC}" title="Show every area"><i></i>${esc(M.areaName)}<span aria-hidden="true">×</span></button>` : '';
  const head = `<div class="st-lh"><div><div class="st-k">${esc(R.label)}</div><div class="st-big">${fmtH(M.total)}</div>${sub ? `<div class="st-sub">${sub}</div>` : ''}</div>${filt}</div>`;
  if (!M.total) return head + none(M);
  const g0 = M.groups[0];
  const line = `<div class="st-line">${M.groups.filter(g => g.m).map(g => `<i style="flex:${g.m.toFixed(1)};background:${g.c}"></i>`).join('')}</div>`;
  const B = M.span > 1 ? bins(M) : null;
  const rows = M.groups.filter(g => g.m || g.pm).map((g, i) => {
    const d = g.m - g.pm, ch = !M.prevOk ? '' : Math.abs(d) < 15 ? '<span class="eq">=</span>' : `<span class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : '−'}${fmtHs(Math.abs(d))}</span>`;
    let spark = '';
    if (B && B.b.length > 1) {
      const gi = M.gi.get(g.key), pts = B.b.filter(x => !x.future).map(x => x.v[gi]), mx = Math.max(1, ...pts);
      if (pts.length > 1) spark = `<svg class="st-spark" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${g.c}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" points="${pts.map((p, j) => `${(j / (pts.length - 1) * 58 + 1).toFixed(1)},${(15 - p / mx * 13).toFixed(1)}`).join(' ')}"/></svg>`;
    }
    const subs = g.subs.slice(0, 4).map(s => `<button class="st-row sub" data-act="open" data-id="${s.id}"><span></span><span class="n">${esc(s.name)}</span><span></span><span class="h">${fmtH(s.m)}</span><span class="p">${pct(s.m, M.total)}%</span><span></span></button>`).join('')
      + (g.subs.length > 4 ? `<button class="st-row sub more" data-act="st-area" data-id="${g.key}"><span></span><span class="n">${g.subs.length - 4} more</span><span></span><span class="h">${fmtH(sum(g.subs.slice(4).map(s => s.m)))}</span><span class="p"></span><span></span></button>` : '');
    return `<button class="st-row" data-act="${g.act}" data-id="${g.id}" title="${M.area == null ? 'Show only ' + esc(g.name) : 'Open ' + esc(g.name)}"><span class="dot" style="background:${g.c}"></span><span class="n">${esc(g.name)}</span>${spark || '<span></span>'}<span class="h">${fmtH(g.m)}</span><span class="p">${pct(g.m, M.total)}%</span><span class="c">${ch}</span></button>${subs}`;
  }).join('');
  const lead = `<div class="st-say">Mostly ${esc(g0.name)}, ${pct(g0.m, M.total)}% of your time ${words(R)}.</div>`;
  const foot = M.guessed >= 5 ? `<div class="st-foot">${fmtH(M.guessed)} of it is guessed, from tasks checked off without the timer.</div>` : '';
  return head + lead + line + `<div class="st-rows">${rows}</div>` + foot;
}

/* Share: areas on the inner ring, their projects on the outer one, the total in the middle */
function arc(cx, cy, r0, r1, a0, a1) {
  if (a1 - a0 > Math.PI * 2 - .001) a1 = a0 + Math.PI * 2 - .001;
  const p = (r, a) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`, L = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)}A${r1},${r1} 0 ${L} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${L} 0 ${p(r0, a0)}Z`;
}
function share(M) {
  if (!M.total) return none(M);
  const pad = M.groups.filter(g => g.m).length > 1 ? .014 : 0, outer = M.area == null;
  let a = 0, g1 = '', g2 = '';
  for (const g of M.groups) {
    if (!g.m) continue; const da = g.m / M.total * Math.PI * 2;
    g1 += `<path class="st-seg" data-g="${esc(g.key)}" d="${arc(150, 150, outer ? 80 : 86, outer ? 106 : 120, a + pad / 2, a + da - pad / 2)}" fill="${g.c}"><title>${esc(g.name)} ${fmtH(g.m)}</title></path>`;
    let b = a; for (const s of g.subs) { const db = s.m / M.total * Math.PI * 2; g2 += `<path class="st-seg" data-g="${esc(g.key)}" d="${arc(150, 150, 111, 122, b + pad / 2, b + db - pad / 2)}" fill="${s.c}" opacity=".9"><title>${esc(s.name)} ${fmtH(s.m)}</title></path>`; b += db; }
    a += da;
  }
  const mid = `<text x="150" y="140" text-anchor="middle" class="st-tk">${esc(M.R.label.toUpperCase())}</text><text x="150" y="171" text-anchor="middle" class="st-tb">${fmtHs(M.total)}</text>`;
  const key = M.groups.filter(g => g.m).map(g => `<span class="st-key"><i style="background:${g.c}"></i>${esc(g.name)} <b>${pct(g.m, M.total)}%</b></span>`).join('');
  return `<svg class="st-ring" viewBox="0 0 300 300">${g1}${g2}${mid}</svg><div class="st-keys">${key}</div>`;
}

/* Days: a bar for each hour, day or month, stacked by area. Tap one to look at just that day or month. */
function daysCard(M) {
  const { b, unit } = bins(M);
  const W = 320, H = 168, top = 8, bot = 20, left = 28, n = b.length, slot = (W - left) / n, bw = Math.max(2, Math.min(24, slot * .62));
  const mx = niceMax(Math.max(30, ...b.map(x => sum(x.v)))), y = v => top + (H - top - bot) * (1 - v / mx);
  let g = '';
  [0, .5, 1].forEach(t => { const yy = y(mx * t).toFixed(1); g += `<line x1="${left}" x2="${W}" y1="${yy}" y2="${yy}" class="st-grid${t ? '' : ' base'}"/><text x="${left - 6}" y="${+yy + 3}" text-anchor="end">${fmtHs(mx * t)}</text>`; });
  b.forEach((x, j) => {
    const cx = left + slot * j + slot / 2; let acc = 0; const parts = [];
    x.v.forEach((v, i) => { if (!v) return; const y1 = y(acc), y2 = y(acc + v); parts.push(`<rect class="st-seg" data-g="${esc(M.groups[i].key)}" x="${(cx - bw / 2).toFixed(1)}" y="${y2.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(.6, y1 - y2 - (acc ? 1.2 : 0)).toFixed(1)}" rx="${Math.min(3, bw / 3).toFixed(1)}" fill="${M.groups[i].c}"/>`); acc += v; });
    if (x.go && !x.future) g += `<g class="st-go" data-act="st-at" data-k="${x.go[0]}" data-d="${x.go[1]}"><rect x="${(cx - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" fill="transparent"/>${parts.join('')}</g>`;
    else g += parts.join('');
    if (x.future) g += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(0) - 2}" width="${bw.toFixed(1)}" height="2" rx="1" class="st-fut"/>`;
    if (x.lab) g += `<text x="${cx.toFixed(1)}" y="${H - 5}" text-anchor="middle"${x.now ? ' class="now"' : ''}>${x.lab}</text>`;
  });
  let note = '';
  if (M.total && unit !== 'hour') {
    const best = b.reduce((m, x) => sum(x.v) > m.t ? { t: sum(x.v), x } : m, { t: 0 });
    note = unit === 'day' ? `Longest: ${M.span <= 7 ? DAYL[pd(best.x.d).getDay()] : fmtShort(best.x.d)}, ${fmtH(best.t)}` : `Busiest: ${MONTHS[best.x.mo]}${best.x.y !== pd(today()).getFullYear() ? ' ' + best.x.y : ''}, ${fmtH(best.t)}`;
  } else if (M.total) note = `${M.ps.length} stretch${M.ps.length === 1 ? '' : 'es'} recorded`;
  return `<svg viewBox="0 0 ${W} ${H}" class="st-chart">${g}</svg>${note ? `<div class="st-note">${note}${unit === 'day' || unit === 'month' ? '<span>Tap a bar to look closer</span>' : ''}</div>` : ''}`;
}

/* Projects: every tile is as big as its time; areas are columns and their projects stack inside */
function mosaic(M) {
  if (!M.total) return none(M);
  const H = 236, gs = M.groups.filter(g => g.m);
  const tile = (id, name, m, c, tall, wide) => { const fg = lum(c) > .25 ? '#0B0D18' : '#F1F2FA', show = tall >= 40 && wide; return `<button class="st-tile" data-act="open" data-id="${id}" style="flex:${m.toFixed(1)};background:${c};color:${fg}" title="${esc(name)} ${fmtH(m)}">${show ? `<b>${esc(name)}</b><span>${fmtHs(m)}</span>` : ''}</button>`; };
  let cols;
  if (M.area == null) cols = gs.map(g => `<div class="st-mcol" style="flex:${g.m.toFixed(1)}">${g.subs.map(s => tile(s.id, s.name, s.m, s.c, s.m / g.m * H, g.m / M.total > .16)).join('')}</div>`).join('');
  else cols = `<div class="st-mcol wrap">${gs.map(g => tile(g.id, g.name, g.m, g.c, H, g.m / M.total > .1)).join('')}</div>`;
  const caps = M.area == null ? `<div class="st-mcap">${gs.map(g => `<div style="flex:${g.m.toFixed(1)};color:${g.c}">${g.m / M.total > .18 ? `${esc(g.name)} ${pct(g.m, M.total)}%` : ''}</div>`).join('')}</div>` : '';
  const top = M.area == null ? gs.flatMap(g => g.subs).sort((a, b) => b.m - a.m)[0] : gs[0];
  return `${caps}<div class="st-mosaic${M.area == null ? '' : ' row'}" style="height:${H}px">${cols}</div><div class="st-note">${esc(top.name)} took the most, ${fmtH(top.m)}</div>`;
}

/* Rhythm: a 24-hour clock of when the work happens, as an average over the days in range */
function rhythm(M) {
  if (!M.total) return none(M);
  const hrs = Array.from({ length: 24 }, () => new Array(M.groups.length).fill(0));
  M.ps.forEach(p => hours(p, (h, m) => hrs[h][M.gi.get(M.gKey(p))] += m));
  const tot = hrs.map(sum), mx = Math.max(...tot), cx = 150, cy = 150, r0 = 58, r1 = 126;
  let g = `<circle cx="${cx}" cy="${cy}" r="${r0 - 5}" class="st-face"/>`;
  [0, 6, 12, 18].forEach(h => { const a = h / 24 * Math.PI * 2, s = Math.sin(a), c = Math.cos(a); g += `<line x1="${(cx + (r0 - 5) * s).toFixed(1)}" y1="${(cy - (r0 - 5) * c).toFixed(1)}" x2="${(cx + (r1 + 6) * s).toFixed(1)}" y2="${(cy - (r1 + 6) * c).toFixed(1)}" class="st-grid"/><text x="${(cx + (r1 + 17) * s).toFixed(1)}" y="${(cy - (r1 + 17) * c + 3).toFixed(1)}" text-anchor="middle">${h}:00</text>`; });
  hrs.forEach((v, h) => { let acc = r0; const a0 = h / 24 * Math.PI * 2 + .03, a1 = (h + 1) / 24 * Math.PI * 2 - .03; v.forEach((m, i) => { if (!m) return; const len = m / mx * (r1 - r0); g += `<path class="st-seg" data-g="${esc(M.groups[i].key)}" d="${arc(cx, cy, acc, acc + len, a0, a1)}" fill="${M.groups[i].c}"/>`; acc += len + (len > 3 ? 1 : 0); }); });
  let pk = 0, pv = -1; for (let h = 0; h < 23; h++) { const t = tot[h] + tot[h + 1]; if (t > pv) { pv = t; pk = h; } }
  const lead = (a, b) => { const s = new Array(M.groups.length).fill(0); for (let h = a; h < b; h++) hrs[h].forEach((m, i) => s[i] += m); const m = Math.max(...s); return m >= M.total * .05 ? M.groups[s.indexOf(m)].name : null; };
  const when = new Map(); [[5, 12, 'mornings'], [12, 17, 'afternoons'], [17, 24, 'evenings']].forEach(([a, b, w]) => { const n = lead(a, b); if (n) when.set(n, [...(when.get(n) || []), w]); });
  const bits = [...when].map(([n, ws]) => `${esc(n)} ${ws.join(' and ')}`);
  g += `<text x="${cx}" y="${cy - 8}" text-anchor="middle" class="st-tk">PEAK</text><text x="${cx}" y="${cy + 15}" text-anchor="middle" class="st-tm">${pk}–${pk + 2}</text>`;
  const per = M.elapsed > 1 ? `, about ${fmtH(pv / M.elapsed)} a day` : '';
  return `<svg class="st-ring" viewBox="-12 -12 324 324">${g}</svg><div class="st-note">${M.span > 1 && bits.length ? bits.join(', ') + '. ' : ''}Your best two hours are ${pk}:00 to ${pk + 2}:00${per}.</div>`;
}

/* Pace: how long things really take next to how long they were planned */
export function paceOf(n) {
  if (!n || n.r || n.k === 'area') return null;
  if (!hasKids(n.id)) { const ac = track.total(n); if (!n.done || !ac) return null; const pl = n.pl?.duration_min ?? n.m ?? 60; return { leaf: true, ac, pl, r: ac / pl }; }
  let ac = 0; const walk = x => { ac += track.total(x); children(x.id).forEach(walk); }; walk(n);
  const L = leaves(n.id).filter(l => !l.r), done = L.filter(l => l.done);
  const pl = done.reduce((a, l) => a + (l.pl?.duration_min ?? l.m ?? 60), 0), left = L.filter(l => !l.done).reduce((a, l) => a + (l.m ?? 60), 0);
  if (!ac || !pl || ac / pl > 4 || ac / pl < .25) return null; // way off means the steps aren't being checked off as the work goes, so there's nothing to compare
  return { leaf: false, ac, pl, left, done: done.length, of: L.length, r: ac / pl };
}
const paceCls = r => r > 1.2 ? 'dn' : r < .95 ? 'up' : 'eq';
export function paceSay(p) {
  const o = Math.round((p.r - 1) * 100);
  if (p.leaf) return o >= 5 ? `Took ${o}% longer than planned` : o <= -5 ? `Done ${-o}% faster than planned` : 'Right on plan';
  const s = `${p.done} of ${p.of} steps done. They were planned at ${fmtH(p.pl)} and took ${fmtH(p.ac)}.`;
  return p.left ? `${s} At that pace the rest takes about ${fmtH(p.left * p.r)}.` : s;
}
/** The small pace line inside an opened task or project */
export function paceHTML(n) {
  const p = paceOf(n); if (!p) return '';
  const mx = Math.max(p.ac, p.pl);
  return `<div class="st-pd"><div class="st-track"><i class="pl" style="width:${(p.pl / mx * 100).toFixed(1)}%"></i><i class="ac" style="width:${(p.ac / mx * 100).toFixed(1)}%;background:${projColor(rootOf(n))}"></i></div><b class="${paceCls(p.r)}">×${p.r.toFixed(2)}</b><p>${paceSay(p)}</p></div>`;
}
function pace(M) {
  const ids = M.area == null ? M.groups.flatMap(g => g.subs.map(s => s.id)) : M.groups.map(g => g.id);
  const rows = ids.map(id => ({ n: store.get(id), p: paceOf(store.get(id)) })).filter(x => x.p).slice(0, 6);
  if (!rows.length) return `<div class="st-none">Pace shows once you finish something you timed: check off a task you recorded, or a step of a project you recorded.</div>`;
  const ac = sum(rows.map(x => x.p.ac)), pl = sum(rows.map(x => x.p.pl)), r = ac / pl, o = Math.round((r - 1) * 100);
  const mx = Math.max(...rows.map(x => Math.max(x.p.ac, x.p.pl)));
  const list = rows.map(({ n, p }) => `<button class="st-prow" data-act="open" data-id="${n.id}"><span class="n">${esc(n.t || 'Untitled')}</span><b class="${paceCls(p.r)}">×${p.r.toFixed(2)}</b><span class="st-track"><i class="pl" style="width:${(p.pl / mx * 100).toFixed(1)}%"></i><i class="ac" style="width:${(p.ac / mx * 100).toFixed(1)}%;background:${projColor(rootOf(n))}"></i></span></button>`).join('');
  return `<div class="st-say">${o >= 5 ? `Finished work took ${o}% longer than planned.` : o <= -5 ? `Finished work went ${-o}% faster than planned.` : 'Finished work went right on plan.'}</div><div class="st-pace">${list}</div>
    <div class="st-legend"><span><i class="pl"></i>planned</span><span><i class="ac"></i>recorded</span><span>all the finished work on these, guesses left out</span></div>`;
}

/* Flow: the mix flowing over the range, thicker where there was more */
function flow(M) {
  const { b, unit } = bins(M, true);
  if (!M.total || b.length < 2) return none(M);
  const W = 320, H = 180, mid = H / 2 - 8, n = b.length, k = M.groups.length;
  const sm = b.map((_, j) => Array.from({ length: k }, (_, i) => { let s = 0, w = 0; for (let d = -1; d <= 1; d++) { const q = b[j + d]; if (q) { const ww = d ? .5 : 1; s += q.v[i] * ww; w += ww; } } return s / w; }));
  const tots = sm.map(sum), sc = (H - 44) / Math.max(1, ...tots), X = j => j / (n - 1) * W;
  const curve = pts => { let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`; for (let j = 1; j < pts.length; j++) { const [x0, y0] = pts[j - 1], [x1, y1] = pts[j], c = ((x0 + x1) / 2).toFixed(1); d += `C${c},${y0.toFixed(1)} ${c},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`; } return d; };
  let base = tots.map(t => mid - t * sc / 2), g = '', labs = '';
  M.groups.forEach((G, i) => {
    const lo = base.map((y, j) => y + sm[j][i] * sc);
    g += `<path class="st-seg" data-g="${esc(G.key)}" d="${curve(base.map((y, j) => [X(j), y]))}L${curve(lo.map((y, j) => [X(j), y]).reverse()).slice(1)}Z" fill="${G.c}" opacity=".9"/>`;
    let bj = -1, bt = 0; for (let j = 2; j < n - 2; j++) { const t = Math.min(sm[j - 1][i], sm[j][i], sm[j + 1][i]); if (t > bt) { bt = t; bj = j; } } // thick for a while, so the name fits
    if (bj > 0 && bt * sc > 16 && W / (n - 1) * 2 > G.name.length * 4.5) labs += `<text x="${Math.min(W - 44, Math.max(44, X(bj))).toFixed(1)}" y="${(base[bj] + bt * sc / 2 + 3.5).toFixed(1)}" text-anchor="middle" class="st-sl" style="fill:${lum(G.c) > .25 ? '#0B0D18' : '#F1F2FA'}">${esc(G.name.length > 18 ? G.name.slice(0, 17) + '…' : G.name)}</text>`;
    base = lo;
  });
  const l0 = unit === 'hour' ? '0:00' : fmtShort(b[0].d), l1 = unit === 'hour' ? '24:00' : fmtShort(unit === 'week' ? (M.R.b > today() ? today() : M.R.b) : b[n - 1].d);
  return `<svg viewBox="0 0 ${W} ${H}" class="st-chart">${g}${labs}<text x="0" y="${H - 2}">${l0}</text><text x="${W}" y="${H - 2}" text-anchor="end">${l1}</text></svg><div class="st-note">The mix ${unit === 'hour' ? 'through the day' : `${unit} by ${unit}`}</div>`;
}

/* The year in squares: a small calendar for each of twelve months, brighter on days with more time,
   tinted by whatever led that day. Days outside the range sit dimmer. Tap a day to look at it. */
function year(M) {
  const R = M.R, T = today(), end = R.k === 'year' ? R.b : (R.b < T ? R.b : T), e = pd(end);
  const by = new Map(); for (const p of M.mine) { let v = by.get(p.d); if (!v) by.set(p.d, v = new Map()); const k = M.gKey(p); v.set(k, (v.get(k) || 0) + p.m); }
  const colour = k => { const i = M.gi.get(k); if (i != null) return M.groups[i].c; if (M.area == null) { const a = k !== '~' && store.get(k); return ink(a?.c); } return projColor(store.get(k) || {}); };
  const st = 10, cell = 8.4, dim = !(R.k === 'year' || R.k === 'all');
  let months = '', run = 0, best = 0, bestDay = null, days = 0, tot = 0;
  for (let m = 11; m >= 0; m--) {
    const f = new Date(e.getFullYear(), e.getMonth() - m, 1), nd = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate(), lead0 = (f.getDay() + 6) % 7;
    let g = '';
    for (let k = 0; k < nd; k++) {
      const d = fd(new Date(f.getFullYear(), f.getMonth(), k + 1)), c = lead0 + k, x = (c % 7) * st, y = Math.floor(c / 7) * st;
      if (d > T) { g += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" class="st-dz"/>`; continue; }
      const v = by.get(d), t = v ? sum([...v.values()]) : 0;
      let fill = mix(bg(), cssVar('--fg', '#E8E2D6'), .07);
      if (t > 0) { let lk = null, lm = -1; v.forEach((m2, k2) => { if (m2 > lm) { lm = m2; lk = k2; } }); const lvl = t < 60 ? 1 : t < 150 ? 2 : t < 270 ? 3 : 4; fill = mix(bg(), colour(lk), [0, .3, .52, .76, 1][lvl]); run++; days++; tot += t; best = Math.max(best, run); if (!bestDay || t > bestDay.t) bestDay = { t, d }; } else run = 0;
      const out = dim && (d < R.a || d > R.b);
      g += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${fill}"${out ? ' opacity=".4"' : ''}${d === T ? ' class="st-today"' : ''} data-act="st-at" data-k="day" data-d="${d}"><title>${MONTHS[f.getMonth()].slice(0, 3)} ${k + 1}: ${t ? fmtH(t) : 'nothing recorded'}</title></rect>`;
    }
    months += `<div class="st-mo"><span>${MON[f.getMonth()]}${f.getMonth() === 0 || m === 11 ? ` <em>${f.getFullYear()}</em>` : ''}</span><svg viewBox="0 0 ${7 * st - (st - cell)} ${6 * st - (st - cell)}">${g}</svg></div>`;
  }
  const title = R.k === 'year' ? R.label : `12 months to ${fmtShort(end)}`;
  return `<div class="st-yh"><div><div class="st-k">${esc(title)}${M.area != null ? ` · ${esc(M.areaName)}` : ''}</div><div class="st-mid">${days} day${days === 1 ? '' : 's'} with time</div></div>
    <div class="st-facts"><div><b>${best} day${best === 1 ? '' : 's'}</b><span>longest streak</span></div><div><b>${bestDay ? fmtH(bestDay.t) : '–'}</b><span>${bestDay ? 'best day, ' + fmtShort(bestDay.d) : 'best day'}</span></div><div><b>${days ? fmtH(tot / days) : '–'}</b><span>on a day you worked</span></div></div></div>
    <div class="st-months">${months}</div>`;
}

const DRAW = { share, days: daysCard, projects: mosaic, rhythm, pace, flow };
export function html() {
  const S = C.S, M = model();
  if (!M.any) return `<div class="st-empty"><b>No time recorded yet</b><p>Press ▶ on a task or a project to record how long you work on it. A task you check off without the timer counts the time it was planned for.</p><p>Then this page shows where your hours go, day by day and over the year.</p></div>`;
  const card = Math.max(0, CARDS.findIndex(c => c[0] === S.stCard));
  const custom = M.R.k === 'custom' ? `<div class="st-custom"><label>From <input type="date" id="st-from" value="${M.R.a}" max="${today()}"></label><label>to <input type="date" id="st-to" value="${M.R.b}" max="${today()}"></label></div>` : '';
  return `<div class="st">${custom}
    <section class="st-led st-box">${ledger(M)}</section>
    <section class="st-car st-box"><div class="st-tabs" role="tablist" aria-label="Charts">${CARDS.map(([k, l], i) => `<button role="tab" data-act="st-card" data-v="${k}" aria-selected="${i === card}">${l}</button>`).join('')}</div>
      <div class="st-cards" id="st-cards">${CARDS.map(([k]) => `<div class="st-card" data-card="${k}">${DRAW[k](M)}</div>`).join('')}</div></section>
    <section class="st-year st-box">${year(M)}</section></div>`;
}
/** After drawing: back to the chart that was showing, and follow the swipe */
export function mounted() {
  const box = document.getElementById('st-cards'); if (!box) return;
  const S = C.S, i = Math.max(0, CARDS.findIndex(c => c[0] === S.stCard));
  box.scrollLeft = i * box.clientWidth;
  let t = 0;
  box.addEventListener('scroll', () => { cancelAnimationFrame(t); t = requestAnimationFrame(() => {
    const j = Math.round(box.scrollLeft / Math.max(1, box.clientWidth)), k = CARDS[j]?.[0]; if (!k) return;
    if (S.stCard !== k) { S.stCard = k; C.saveUI(); }
    box.parentElement.querySelectorAll('.st-tabs button').forEach((b, n) => b.setAttribute('aria-selected', n === j));
  }); }, { passive: true });
}
/** Shows one chart, gliding there */
export function showCard(k) {
  const box = document.getElementById('st-cards'), i = CARDS.findIndex(c => c[0] === k); if (!box || i < 0) return;
  box.scrollTo({ left: i * box.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
