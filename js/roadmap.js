// The Roadmap: where things stand over the coming weeks and months, across every area.
// Time runs left to right, one column per week. Each area is a lane; each top-level
// project is a bar from its start date to its due date (a project with no start begins at
// its earliest scheduled step), and opening one shows its sub-projects as thinner bars.
// Milestones are diamonds on their lane, red when the date can't move. A line marks today,
// and a strip along the top weighs each week's scheduled hours against the free hours set.
// Drag a bar to shift it, drag its ends to change its dates; projects with no dates at all
// wait in a tray at the bottom and can be dragged onto the timeline.
import * as store from './store.js';
import { add, daysBetween, esc, fmtShort, MON, pd, today, weekStart } from './util.js';
import { colorOf, hasKids, isDone, isProj, progress, projColor } from './tree.js';

const ZOOMS = { 1: 4.4, 3: 13, 6: 26 };   // weeks in view at each zoom (months)
const DUR = 27;                            // a project dropped from the tray gets four weeks
let C = null;                              // what the app hands over: { S, openItem, saveUI, render, toast, setFree }
let G = null;                              // the geometry of what's drawn: from, dayPx, x()
export function init(ctx) { C = ctx; }

/* Which days a project or sub-project covers. Its own start and due when set; otherwise
   its scheduled steps fill in. Null when nothing about it has a date. */
function kidsMap() { const m = new Map(); for (const n of store.all()) if (n.p) { const k = m.get(n.p) || []; k.push(n); m.set(n.p, k); } return m; }
function spanOf(n, K) {
  let lo = null, hi = null;
  const walk = x => { if (x.d) { if (!lo || x.d < lo) lo = x.d; if (!hi || x.d > hi) hi = x.d; } (K.get(x.id) || []).forEach(walk); };
  walk(n);
  let s = n.st || lo, e = n.due || hi;
  if (!s && !e) return null;
  const sSet = !!n.st, eSet = !!n.due;
  if (!s) s = e; if (!e) e = s;
  if (s > e) [s, e] = [e, s];
  return { s, e, sSet, eSet };
}
const subsOf = (id, K) => (K.get(id) || []).filter(c => (K.get(c.id) || []).length).sort((a, b) => a.o - b.o);
const laneOf = n => (n.ar && store.get(n.ar) ? n.ar : '');
const rootOf = n => { let r = n; while (r.p && store.get(r.p)) r = store.get(r.p); return r; };

/* Hours of scheduled tasks in each week (Monday first) */
function weekHours(from, weeks) {
  const h = new Array(weeks).fill(0);
  for (const n of store.all()) if (n.d && n.d >= from) { const w = Math.floor(daysBetween(from, n.d) / 7); if (w < weeks) h[w] += (n.m || 60) / 60; }
  return h;
}

export function html(width) {
  const S = C.S, T = today(), K = kidsMap(), zoom = S.rmZoom in ZOOMS ? S.rmZoom : 3;
  const areas = store.areas(), all = store.all();
  const tops = all.filter(n => n.p == null && isProj(n));
  const lanes = areas.map(a => ({ a, id: a.id, items: [], ms: [] }));
  const byLane = new Map(lanes.map(l => [l.id, l]));
  const noArea = { a: null, id: '', items: [], ms: [] };
  const lane = id => byLane.get(id) || noArea;
  const tray = []; let lo = null, hi = null;
  const seen = (s, e) => { if (!lo || s < lo) lo = s; if (!hi || e > hi) hi = e; };
  for (const p of tops) {
    const sp = spanOf(p, K), done = isDone(p);
    if (!sp) { if (!done) tray.push(p); continue; }
    if (done && sp.e < add(T, -56)) continue; // finished a while ago
    lane(laneOf(p)).items.push({ n: p, sp }); seen(sp.s, sp.e);
    for (const c of subsOf(p.id, K)) if (!isDone(c) && !spanOf(c, K)) tray.push(c);
  }
  for (const m of all) {
    if (!m.ms || hasKids(m.id)) continue;
    const d = m.due || m.d; if (!d) continue;
    lane(laneOf(rootOf(m))).ms.push({ n: m, d }); seen(d, d);
  }
  // From four weeks back (or the earliest bar) to a year ahead (or the last one), in whole weeks
  let from = weekStart(add(T, -28)); if (lo && lo < from) from = weekStart(lo < add(T, -365) ? add(T, -365) : lo);
  let to = add(T, 371); if (hi && hi > to) to = hi < add(T, 1100) ? hi : add(T, 1100);
  const weeks = Math.ceil((daysBetween(from, to) + 15) / 7);
  const cw = Math.max(12, Math.round(width / ZOOMS[zoom] * 10) / 10), dayPx = cw / 7;
  const x = d => daysBetween(from, d) * dayPx;
  G = { from, dayPx, cw, x, weeks };

  // Weekly hours against free hours
  const free = +S.free > 0 ? +S.free : 10, H = weekHours(from, weeks), tw = Math.floor(daysBetween(from, T) / 7);
  const hrs = H.map((h, i) => {
    const r = h / free, cls = i < tw ? ' past' : r > 1.0001 ? ' over' : r > .85 ? ' full' : '';
    return `<button class="rm-h${cls}" data-act="rm-week" data-d="${add(from, i * 7)}" title="Week of ${fmtShort(add(from, i * 7))}: ${fmtH(h)} scheduled of ${free}h free" style="--r:${Math.min(r, 1.5).toFixed(3)}">${cw >= 40 && h ? `<span>${fmtH(h)}</span>` : ''}<i></i></button>`;
  }).join('');
  // Week and month labels
  // A month's name where it starts, and the date of each Monday where there's room; nothing overlaps
  let wk = '', prevM = -1, free_at = -1;
  for (let i = 0; i < weeks; i++) {
    const d = add(from, i * 7), m = pd(d).getMonth(), nm = m !== prevM; prevM = m;
    const mt = nm ? MON[m] + (m === 0 ? ' ' + pd(d).getFullYear() : '') : '', num = String(pd(d).getDate());
    const w = 8 + (mt ? mt.length * 7 + 5 : 0) + num.length * 7;
    if (nm || (cw >= 22 && i * cw >= free_at)) { wk += `<span class="rm-w${nm ? ' m' : ''}" style="left:${i * cw}px">${mt ? `<b>${mt}</b> ` : ''}${num}</span>`; free_at = i * cw + w + 4; }
  }
  const months = []; for (let d = from.slice(0, 8) + '01'; d <= add(from, weeks * 7); d = add(d, 32).slice(0, 8) + '01') if (d >= from) months.push(`<i class="rm-ml" style="left:${x(d)}px"></i>`);

  const laneHTML = l => {
    if (!l.items.length && !l.ms.length) return '';
    const lc = l.a ? l.a.c || '#B9BCD0' : '#B9BCD0';
    l.items.sort((a, b) => a.sp.s.localeCompare(b.sp.s) || a.n.o - b.n.o);
    let rows = '';
    // Milestones share rows, a new row only where labels would collide
    if (l.ms.length) {
      const R = [], put = [];
      for (const m of l.ms.sort((a, b) => a.d.localeCompare(b.d))) {
        const cx = x(m.d) + dayPx / 2, w = 22 + Math.min(m.n.t.length, 34) * 6.4;
        let r = R.findIndex(e => e < cx - 8); if (r < 0) { r = R.length; R.push(0); } R[r] = cx + w; put.push([m, r, cx]);
      }
      rows += R.map((_, r) => `<div class="rm-row ms">${put.filter(p => p[1] === r).map(([m, , cx]) => msHTML(m, cx)).join('')}</div>`).join('');
    }
    for (const it of l.items) {
      const open = !!S.col['rm:' + it.n.id], subs = subsOf(it.n.id, K);
      rows += `<div class="rm-row">${barHTML(it.n, it.sp, subs.length ? open : null, T)}</div>`;
      if (open) for (const c of subs) { const sp = spanOf(c, K); if (sp) rows += `<div class="rm-row sub">${barHTML(c, sp, null, T)}</div>`; }
    }
    return `<section class="rm-lane" style="--lc:${lc}"><div class="rm-lh"><span><i></i>${esc(l.a ? l.a.t || 'Untitled area' : 'No area')}</span></div>${rows}</section>`;
  };
  const body = lanes.map(laneHTML).join('') + laneHTML(noArea);
  const W = weeks * cw;
  const trayHTML = tray.length ? `<div class="rm-tray" id="rm-tray"><div class="rm-tray-h">Not scheduled<small>drag onto the timeline</small></div><div class="rm-chips">${tray.map(n => {
    const par = n.p && store.get(n.p);
    return `<button class="rm-chip" data-act="open" data-id="${n.id}" data-rm-chip="${n.id}" style="--pc:${colorOf(n)}"><i></i><span>${par ? `<small>${esc(par.t)} ›</small>` : ''}${esc(n.t || 'Untitled')}</span></button>`;
  }).join('')}</div></div>` : '';
  return `<div class="rm-sc" id="rmsc" data-zoom="${zoom}"><div class="rm-in" style="--cw:${cw}px;--dp:${dayPx}px;width:${W}px">
    <div class="rm-top"><div class="rm-hrs" style="--free:'${free}h'">${hrs}</div><div class="rm-wks">${wk}</div></div>
    <div class="rm-grid" aria-hidden="true">${months.join('')}</div>
    <div class="rm-lanes">${body || `<div class="rm-empty">Give a project a start or due date, or schedule a few of its steps, and it shows up here.</div>`}</div>
    <div class="rm-today" style="left:${x(T)}px" aria-hidden="true"><span>Today</span></div>
  </div></div>${trayHTML}`;
}
const fmtH = h => (Math.round(h * 2) / 2) + 'h';
const range = sp => sp.s === sp.e ? fmtShort(sp.s) : `${fmtShort(sp.s)} – ${fmtShort(sp.e)}`;
function waitNote(n) { const w = n.w && store.get(n.w); return w ? `Waiting on ${w.t}${isDone(w) ? ' (done)' : ''}` : ''; }
function barHTML(n, sp, open, T) {
  const pr = progress(n.id), pct = pr.total ? pr.done / pr.total : 0, late = n.due && n.due < T && pr.done < pr.total;
  const l = G.x(sp.s), w = Math.max((daysBetween(sp.s, sp.e) + 1) * G.dayPx, 8), wn = waitNote(n);
  const tip = [n.t, range(sp) + (sp.sSet ? '' : ' (start from its steps)'), pr.total ? `${pr.done} of ${pr.total} steps done` : '', late ? 'Past its due date' : '', wn].filter(Boolean).join('\n');
  const out = w < Math.min(n.t.length, 40) * 6.8 + (open != null ? 40 : 24) ? ' out' : ''; // too short for its name: the name sits just after it
  return `<div class="rm-bar${late ? ' late' : ''}${sp.sSet ? '' : ' s-auto'}${sp.eSet ? '' : ' e-auto'}${isDone(n) ? ' done' : ''}${out}" data-act="open" data-id="${n.id}" data-rm="${n.id}" data-s="${sp.s}" data-e="${sp.e}" data-tip="${esc(tip)}" style="left:${l}px;width:${w}px;--pc:${n.p ? colorOf(n) : projColor(n)};--p:${pct.toFixed(3)}" role="button" aria-label="${esc(n.t)}, ${range(sp)}">
    <i class="rm-fill"></i><b class="rm-hd l"></b><b class="rm-hd r"></b>
    <span class="rm-t">${open != null ? `<button class="rm-fold" data-act="rm-fold" data-id="${n.id}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} sub-projects">${open ? '▾' : '▸'}</button>` : ''}${esc(n.t || 'Untitled')}${wn ? '<em class="rm-wait" aria-label="Waiting on something">⧗</em>' : ''}</span></div>`;
}
function msHTML(m, cx) {
  const n = m.n, wn = waitNote(n), tip = [n.t, fmtShort(m.d) + (n.hd ? ' · hard deadline' : ''), n.p ? rootOf(n).t : '', wn].filter(Boolean).join('\n');
  return `<button class="rm-ms${n.hd ? ' hard' : ''}${isDone(n) ? ' done' : ''}" data-act="open" data-id="${n.id}" data-tip="${esc(tip)}" style="left:${cx}px;--pc:${colorOf(n)}"><i></i><span>${esc(n.t)}${wn ? ' <em class="rm-wait">⧗</em>' : ''}</span></button>`;
}

/* After drawing: put the view back where it was (by date, so a redraw that widens the range doesn't jump),
   or open on this week the first time. */
let keepAt = null;
export function mounted(first) {
  const sc = document.getElementById('rmsc'); if (!sc || !G) return;
  if (!sc.clientWidth) { requestAnimationFrame(() => { if (sc.isConnected) mounted(first); }); return; } // a phone shows the tab a moment later
  const at = !first && keepAt ? keepAt : { d: add(weekStart(today()), -2), top: 0 };
  sc.scrollLeft = Math.max(0, G.x(at.d) + (at.off || 0)); sc.scrollTop = at.top;
  sc.addEventListener('scroll', remember, { passive: true }); remember();
}
function remember() {
  const sc = document.getElementById('rmsc'); if (!sc || !G || !sc.clientWidth) return;
  const days = Math.floor(sc.scrollLeft / G.dayPx); keepAt = { d: add(G.from, days), off: sc.scrollLeft - days * G.dayPx, top: sc.scrollTop };
}
export function setZoom(z) { remember(); if (keepAt) keepAt.off = 0; C.S.rmZoom = z; C.saveUI(); C.render(); }
/** Prev / Next slide along by a month (a week at the closest zoom); Today comes back to this week */
export function go(dir) { const sc = document.getElementById('rmsc'); if (sc) sc.scrollBy({ left: dir * G.cw * (C.S.rmZoom === 1 ? 1 : 4), behavior: 'smooth' }); }
export function goToday() { const sc = document.getElementById('rmsc'); if (sc) sc.scrollTo({ left: G.x(add(weekStart(today()), -2)), behavior: 'smooth' }); }

/* Hover note: dates, progress, and what it's waiting on */
const tipEl = document.createElement('div'); tipEl.className = 'rm-tip'; tipEl.setAttribute('role', 'tooltip');
document.addEventListener('mouseover', e => {
  const t = e.target instanceof Element && !R && e.target.closest('#rmsc [data-tip]');
  if (!t) { tipEl.remove(); return; }
  const [h, ...rest] = t.dataset.tip.split('\n');
  tipEl.innerHTML = `<b>${esc(h)}</b>${rest.map(l => `<span${l.startsWith('Waiting on') ? ' class="w"' : l.startsWith('Past') ? ' class="late"' : ''}>${esc(l)}</span>`).join('')}`;
  document.body.appendChild(tipEl);
  const r = t.getBoundingClientRect(), tr = tipEl.getBoundingClientRect();
  tipEl.style.left = Math.max(8, Math.min(e.clientX - tr.width / 2, innerWidth - tr.width - 8)) + 'px';
  tipEl.style.top = (r.bottom + 8 + tr.height > innerHeight ? r.top - tr.height - 8 : r.bottom + 8) + 'px';
});

/* Dragging. A mouse grabs right away; a finger presses and holds first, so a swipe still scrolls.
   The ends of a bar change its start or due date; the middle shifts both. A tray chip dropped on
   the timeline starts there and runs four weeks. Days snap; nothing is saved until the drop. */
let R = null, hold = 0, eatClick = false;
const flag = document.createElement('div'); flag.className = 'rm-flag';
function begin(t, x, y, touch) {
  const chip = t.closest('[data-rm-chip]');
  if (chip) { R = { chip: chip.dataset.rmChip, x, y, ox: x, live: false, el: chip }; return; }
  const bar = t.closest('.rm-bar'); if (!bar || t.closest('.rm-fold')) return;
  const r = bar.getBoundingClientRect(), edge = touch ? 14 : 8;
  const how = r.width > edge * 3 && x - r.left < edge ? 'start' : r.width > edge * 3 && r.right - x < edge ? 'end' : 'move';
  R = { bar, id: bar.dataset.rm, how, x, y, ox: x, s: bar.dataset.s, e: bar.dataset.e, left: parseFloat(bar.style.left), width: parseFloat(bar.style.width), live: false };
}
function live() {
  R.live = true; document.body.classList.add('rm-dragging'); tipEl.remove();
  if (R.chip) { R.ghost = R.el.cloneNode(true); R.ghost.className = 'rm-chip rm-ghost'; document.body.appendChild(R.ghost); }
  else R.bar.classList.add('dragging');
  document.body.appendChild(flag);
}
function dayAt(clientX) { const sc = document.getElementById('rmsc'); const r = sc.getBoundingClientRect(); return add(G.from, Math.floor((clientX - r.left + sc.scrollLeft) / G.dayPx)); }
function move(x, y) {
  if (!R) return;
  if (!R.live) { if (Math.hypot(x - R.x, y - R.y) < 4) return; live(); }
  flag.style.left = x + 'px'; flag.style.top = (y - 34) + 'px';
  if (R.chip) {
    R.ghost.style.transform = `translate(${x + 8}px,${y - 14}px)`;
    const sc = document.getElementById('rmsc'), r = sc?.getBoundingClientRect();
    R.over = r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    sc?.classList.toggle('drop', !!R.over);
    if (R.over) { R.at = dayAt(x); flag.textContent = `${fmtShort(R.at)} – ${fmtShort(add(R.at, DUR))}`; flag.hidden = false; } else flag.hidden = true;
    edgeScroll(x);
    return;
  }
  const dd = Math.round((x - R.x) / G.dayPx);
  let s = R.s, e = R.e;
  if (R.how === 'move') { s = add(R.s, dd); e = add(R.e, dd); }
  else if (R.how === 'start') s = add(R.s, dd) > R.e ? R.e : add(R.s, dd);
  else e = add(R.e, dd) < R.s ? R.s : add(R.e, dd);
  R.ns = s; R.ne = e;
  R.bar.style.left = G.x(s) + 'px'; R.bar.style.width = Math.max((daysBetween(s, e) + 1) * G.dayPx, 8) + 'px';
  flag.textContent = R.how === 'start' ? `Starts ${fmtShort(s)}` : R.how === 'end' ? `Due ${fmtShort(e)}` : `${fmtShort(s)} – ${fmtShort(e)}`;
  edgeScroll(x);
}
let es = 0;
function edgeScroll(x) {
  cancelAnimationFrame(es); const sc = document.getElementById('rmsc'); if (!sc || !R?.live) return;
  const r = sc.getBoundingClientRect(), dx = x - R.ox, v = x < r.left + 40 && dx < -20 ? -8 : x > r.right - 40 && dx > 20 ? 8 : 0; // only once carried toward that edge
  if (v) es = requestAnimationFrame(() => { sc.scrollLeft += v; R.x -= v; move(x, R.lastY ?? R.y); });
}
function end() {
  cancelAnimationFrame(es); clearTimeout(hold);
  if (!R) return; const r = R; R = null;
  document.body.classList.remove('rm-dragging'); flag.remove();
  if (!r.live) return;
  eatClick = true; setTimeout(() => { eatClick = false; }, 50);
  if (r.chip) {
    r.ghost.remove(); document.getElementById('rmsc')?.classList.remove('drop');
    if (r.over && r.at) { const n = store.get(r.chip); store.update(r.chip, { st: r.at, due: add(r.at, DUR) }); C.toast(`${n.t}: ${fmtShort(r.at)} – ${fmtShort(add(r.at, DUR))}`); }
    return;
  }
  r.bar.classList.remove('dragging');
  if (!r.ns || (r.ns === r.s && r.ne === r.e)) { C.render(); return; }
  const n = store.get(r.id); if (!n) return;
  // Shifting a bar fixes both its dates; an end only changes that end
  const patch = r.how === 'start' ? { st: r.ns } : r.how === 'end' ? { due: r.ne } : { st: r.ns, due: r.ne };
  store.update(r.id, patch);
}
// A drag never counts as a tap that opens the project
window.addEventListener('click', e => { if (eatClick) { eatClick = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
document.addEventListener('mousedown', e => { if (e.button === 0 && e.target instanceof Element && e.target.closest('#rmsc, #rm-tray')) { begin(e.target, e.clientX, e.clientY, false); if (R) e.preventDefault(); } });
document.addEventListener('mousemove', e => { if (R) { R.lastY = e.clientY; move(e.clientX, e.clientY); } });
document.addEventListener('mouseup', end);
document.addEventListener('touchstart', e => {
  if (e.touches.length !== 1 || !(e.target instanceof Element) || !e.target.closest('#rmsc, #rm-tray')) return;
  const t = e.touches[0]; begin(e.target, t.clientX, t.clientY, true); if (!R) return;
  clearTimeout(hold); hold = setTimeout(() => { if (R && !R.live) { navigator.vibrate?.(10); live(); move(R.x, R.y); } }, 320);
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!R) return; const t = e.touches[0];
  if (!R.live) { if (Math.hypot(t.clientX - R.x, t.clientY - R.y) > 8) { clearTimeout(hold); R = null; } return; } // a swipe: let it scroll
  if (e.cancelable) e.preventDefault(); R.lastY = t.clientY; move(t.clientX, t.clientY);
}, { passive: false });
document.addEventListener('touchend', e => { if (R?.live) e.preventDefault(); end(); });
document.addEventListener('touchcancel', end);
document.addEventListener('contextmenu', e => { if (R) e.preventDefault(); });
