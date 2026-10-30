// The Fight: Task Dragon's home screen (rules in dragon.js). The close-up dragon on the left, your day in order on the
// right, scrolling up into his jaws: steady, with a little crank every quarter hour. The red NOW line sits at his mouth.
// Quests past it shake in his jaws until CHOMP. Finishing one flips its card, then a quick hit: strike when his eye flashes, flick the coins into your purse.
// The screen is one element kept across renders, so the dragon keeps breathing while the rest of the app redraws.
// Your hand of power cards sits at the bottom: tap one, then the quest (or two) it works on. The Fight never moves
// your plan by itself: only Swap, Send back and Split do, and each says what it will change and waits for a yes.
// The dragon is Michael's two paintings (mouth closed, mouth open, art/), swayed and blended here; the one painted in code is the fallback.
import * as dragon from './dragon.js';
import * as sfx from './sfx.js';
import * as store from './store.js';
import { colorOf, isDone } from './tree.js';
import { esc, fmtT, lsGet, lsSet, today, nowMin, add, pd, DAYL, MON } from './util.js';

// NOW_Y is his mouth; the timeline starts lower, at LANE_Y, below his open lower jaw, and a quest jumps up into his mouth when its time comes
const NOW_Y = 250, PPM = 0.6, GAP = 48, HALF = 21, BW = 390, LANE_Y = NOW_Y + 90;
const NAME = 'Gristlemaw';
let client = null, onUpdate = () => {}, freeH = () => 10;
let root = null, cv = null, ctx = null, el = {}, view = null, S = null, R = null, LH = 760, k = 1, raf = 0, last = 0, seen = null, pose = null;
const cards = new Map(); // quest id -> { el, y }
const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export function init(o) { client = o.client ?? client; onUpdate = o.update ?? onUpdate; freeH = o.free ?? freeH; }

/** The Fight for day d. opts.adder: the + (or the new-task form) for that day. */
export function html(d, opts = {}) {
  return `<div class="td-host" id="td-host" data-d="${d}"><div class="td-add">${opts.adder || ''}</div></div>`;
}
export function mounted(d) {
  const host = document.getElementById('td-host'); if (!host) return;
  if (!root) build();
  host.prepend(root);
  if (view !== d) { view = d; seen = null; cards.forEach(c => c.el.remove()); cards.clear(); }
  fit(); refresh(true);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
}

/* ---------- building the screen ---------- */
function build() {
  root = document.createElement('div'); root.className = 'td';
  root.innerHTML = `<div class="td-stage"><canvas class="td-cv" aria-hidden="true"></canvas>
    <button class="td-poke" data-td="poke" aria-label="Poke ${NAME}"></button>
    <div class="td-hud"><div class="td-rnd"></div><div class="td-hr"><div class="td-purse" title="Your gold"><i></i><b></b></div><div class="td-rounds"></div></div></div>
    <div class="td-lane" aria-label="Your quests, in order"><div class="td-ruler" aria-hidden="true"></div></div>
    <button class="td-back2" data-td="now" hidden>Back to now</button>
    <div class="td-now"><span></span></div>
    <button class="td-say" data-td="poke"><small>${NAME.toUpperCase()}</small><span></span></button>
    <div class="td-banner" hidden></div>
    <div class="td-foot"><div class="td-belly"></div><div class="td-aim" hidden></div><div class="td-hand"></div></div>
    <div class="td-verdict" hidden></div>
    <button class="td-pill" data-td="dawn" hidden></button>
    <div class="td-dawn" hidden></div>
    <button class="td-drg" data-td="lair">Dragons</button><button class="td-help" data-td="help" aria-label="How the Fight works">?</button>
    <div class="td-dawn td-lair" hidden></div>
    <div class="td-hit" hidden></div><div class="td-combo" hidden></div>
    <div class="td-flash"></div></div>`;
  const $ = s => root.querySelector(s);
  el = { stage: $('.td-stage'), lane: $('.td-lane'), now: $('.td-now span'), nowLine: $('.td-now'), rnd: $('.td-rnd'), purse: $('.td-purse b'), say: $('.td-say span'), banner: $('.td-banner'), belly: $('.td-belly'), rounds: $('.td-rounds'), hand: $('.td-hand'), aim: $('.td-aim'), verdict: $('.td-verdict'), flash: $('.td-flash'), dawn: $('.td-dawn'), pill: $('.td-pill'), lair: $('.td-lair'), drg: $('.td-drg'), who: $('.td-say small'), ruler: $('.td-ruler'), back: $('.td-back2'), hit: $('.td-hit'), combo: $('.td-combo') };
  cv = $('.td-cv'); ctx = cv.getContext('2d');
  // while a card is picked, tapping a quest plays it there instead of opening or finishing it
  root.addEventListener('click', e => {
    if (!aim) return; const q = e.target.closest('.td-q'); if (!q || !q.dataset.id) return;
    e.preventDefault(); e.stopPropagation(); target(q.dataset.id);
  }, true);
  root.addEventListener('click', e => {
    if (e.target.closest('[data-act="goday"],[data-act="ask"]')) { lairOpen = null; lair(); }
    const b = e.target.closest('[data-td]'); if (!b) return;
    if (b.dataset.td === 'poke') { poke(); }
    else if (b.dataset.td === 'card') pickCard(b.dataset.c);
    else if (b.dataset.td === 'aim-x') { aim = null; hand(); }
    else if (b.dataset.td === 'aim-go') go();
    else if (b.dataset.td === 'undo-card') undoCard();
    else if (b.dataset.td === 'help') { lairOpen = lairOpen === 'help' ? null : 'help'; lair(); }
    else if (b.dataset.td === 'verdict-x') { lsSet(SEEN, { ...lsGet(SEEN, {}), [view]: 1 }); refresh(); }
    else if (b.dataset.td === 'verdict') { const v = lsGet(SEEN, {}); delete v[view]; lsSet(SEEN, v); refresh(); }
    else if (b.dataset.td === 'dawn') { dawnOpen = true; refresh(); }
    else if (b.dataset.td === 'dawn-x') { dawnOpen = false; if (!dragon.dawnSeen(today())) dragon.seeDawn(today()); else refresh(); }
    else if (b.dataset.td === 'buy') { if (dragon.buy(b.dataset.id, S)) sfx.coin(); }
    else if (b.dataset.td === 'pack') { if (dragon.openPack(b.dataset.id, S)) sfx.fanfare(); }
    else if (b.dataset.td === 'eq') dragon.equip(b.dataset.id, b.getAttribute('aria-pressed') !== 'true');
    else if (b.dataset.td === 'off') dragon.dayOff(today(), b.dataset.k || null);
    else if (b.dataset.td === 'lair') { lairOpen = lairOpen ? null : 'list'; lair(); }
    else if (b.dataset.td === 'now') { scroll.to = 0; }
    else if (b.dataset.td === 'lair-list') { lairOpen = 'list'; lair(); }
    else if (b.dataset.td === 'tab') { lairOpen = b.dataset.v; lair(); }
    else if (b.dataset.td === 'lair-x') { lairOpen = null; lair(); }
    else if (b.dataset.td === 'goal') { lairOpen = b.dataset.id; lair(); }
    else if (b.dataset.td === 'hatch') { dragon.hatch(b.dataset.id); lairOpen = b.dataset.id; nameIt(b.dataset.id); }
    else if (b.dataset.td === 'rename') { const g = S.goals.find(x => x.id === b.dataset.id), n = prompt('His name', g?.name || ''); if (n?.trim()) dragon.rename(b.dataset.id, n.trim()); }
    else if (b.dataset.td === 'name-ai') nameIt(b.dataset.id, true);
    else if (b.dataset.td === 'push') { const g = S.goals.find(x => x.id === b.dataset.id); if (g) store.update(g.id, { due: add(g.due && g.due > today() ? g.due : today(), 7) }); }
    else if (b.dataset.td === 'release') { if (confirm('Let him go? The project stays; it just stops being a big goal.')) { dragon.release(b.dataset.id); lairOpen = 'list'; } }
  });
  hitEvents();
  addEventListener('resize', () => { if (root?.isConnected) fit(); });
  // drag (or wheel) the lane to look further ahead; a drag never counts as a tap on a quest
  const inLane = e => { if (e.target.closest('.td-hit,.td-foot,.td-dawn,.td-verdict,.td-hud,.td-pill,.td-drg,.td-help,.td-banner,.td-say,.td-poke,.td-back2,.td-add')) return false; const r = el.stage.getBoundingClientRect(); return (e.clientX - r.left) / k > 140; };
  el.stage.addEventListener('pointerdown', e => { if (!inLane(e) || aim) return; scroll.drag = { y0: e.clientY, s0: scroll.to, id: e.pointerId, moved: false }; });
  el.stage.addEventListener('pointermove', e => { const d = scroll.drag; if (!d || d.id !== e.pointerId) return; const dy = (d.y0 - e.clientY) / k;
    if (!d.moved && Math.abs(dy) > 6) { d.moved = true; el.stage.setPointerCapture?.(e.pointerId); }
    if (d.moved) { scroll.to = d.s0 + dy; scroll.at = Date.now(); e.preventDefault(); } });
  const end = e => { const d = scroll.drag; if (!d || d.id !== e.pointerId) return; scroll.drag = null; if (d.moved) scroll.at = scroll.end = Date.now(); };
  root.addEventListener('click', e => { if (Date.now() - (scroll.end || 0) < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
  el.stage.addEventListener('pointerup', end); el.stage.addEventListener('pointercancel', end);
  el.stage.addEventListener('wheel', e => { if (!inLane(e)) return; e.preventDefault(); scroll.to += e.deltaY / k; scroll.at = Date.now(); }, { passive: false });
}
const SEEN = 'daybook-td-verdict-seen';
/** The stage is drawn 390 wide and scaled to the screen; its height is whatever is left above the tab bar. */
function fit() {
  const host = root.parentElement; if (!host) return;
  const mb = host.closest('.mbody'), top = host.getBoundingClientRect().top, bottom = mb ? mb.getBoundingClientRect().bottom : innerHeight;
  const w = host.clientWidth, h0 = bottom - top - 6; k = Math.min(w / BW, 1.35, Math.max(.8, h0 / 620));
  const h = Math.max(480 * k, h0); LH = Math.min(Math.round(h / k), 980);
  host.style.height = h + 'px';
  el.stage.style.cssText = `width:${BW}px;height:${LH}px;transform:scale(${k})`;
  root.style.width = BW * k + 'px';
  const dpr = Math.min(2, devicePixelRatio || 1) * k;
  cv.width = Math.round(BW * dpr); cv.height = Math.round(LH * dpr); cv.style.width = BW + 'px'; cv.style.height = LH + 'px'; ctx._dpr = dpr;
}

/* ---------- the state, and what changed ---------- */
const nowF = () => { const t = new Date(); return t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60; };
function refresh(force) {
  S = dragon.state(); R = dragon.dayView(view, S);
  const live = view === today();
  // what changed since the last look: saves get their quick hit, eaten ones their CHOMP, finished rounds a banner
  const st = new Map(R.Qs.map(q => [q.n.id, q.st]));
  if (seen && live) {
    for (const q of R.Qs) {
      const was = seen.q.get(q.n.id);
      if (was && was !== q.st && (q.st === 'kept' || q.st === 'late')) saved(q);
      else if (was && (was === 'open' || was === 'jaws') && q.st === 'eaten') chomped(q);
    }
    R.R.forEach((x, i) => { if (seen.r[i] === 'open' && (x.res === 'won' || x.res === 'lost')) roundOver(x); });
  }
  seen = { q: st, r: R.R.map(x => x.res) };
  goalMoments(); duty(); hud(); comboMeter(); lane(); foot(); verdict(); dawn(); lair(); say();
}
function hud() {
  const live = view === today(), r = R.R.find(x => x.live) || R.R[R.R.length - 1];
  el.purse.textContent = S.gold;
  if (view > today()) el.rnd.innerHTML = `<b>${view === add(today(), 1) ? 'Tomorrow' : DAYL[pd(view).getDay()]}</b><span>${R.Qs.length} quests · ${R.total} gold on the table</span>`;
  else if (!live || R.closed) el.rnd.innerHTML = `<b>${live ? 'Today' : DAYL[pd(view).getDay()] + ' ' + MON[pd(view).getMonth()] + ' ' + pd(view).getDate()}</b><span>${R.you} kept · ${R.him} eaten</span>`;
  else if (R.off) el.rnd.innerHTML = `<b>Day off</b><span>${OFF[R.off]} He sleeps; nothing counts.</span>`;
  else { const sw = R.swoops.find(x => !x.past);
    el.rnd.innerHTML = `<b>${r.name} round</b><span>${r.total ? `${r.kept} of ${r.total} kept · need ${r.need}` : 'Nothing due this round'}</span>${sw ? `<span class="td-sw">Swoops at ${fmtT(sw.t)} on the richest in his jaws</span>` : ''}${R.curses.length ? `<span class="td-cu">Cursed: ${R.curses.map(c => dragon.CURSES[c].n).join(', ')}</span>` : ''}`; }
  el.nowLine.hidden = !live || R.closed;
  el.rounds.innerHTML = R.R.map(x => `<i class="td-pip ${x.res}${x.live && live && !R.closed ? ' live' : ''}" title="${x.name}: ${x.res === 'none' ? 'no contest' : `${x.kept} of ${x.total}`}"></i>`).join('');
}
/** The quests still in play, positioned by when they reach his jaws, never closer than one card apart. */
function lane() {
  const live = view === today() && !R.closed;
  const L = R.off ? [] : R.Qs.filter(q => view > today() || (live && (q.st === 'open' || q.st === 'jaws')));
  const keep = new Set(L.map(q => q.n.id));
  for (const [id, c] of cards) if (!keep.has(id) && !c.leaving) { c.el.remove(); cards.delete(id); }
  for (const q of L) {
    let c = cards.get(q.n.id);
    if (!c) { const b = document.createElement('div'); b.className = 'td-q'; el.lane.appendChild(b); c = { el: b, y: null }; cards.set(q.n.id, c); }
    c.q = q;
    const habit = !!q.n.rs, nt = esc(q.n.t || 'Untitled'), fog = live && R.curses.includes('fog') && q.e - nowMin() > 180;
    const when = q.st === 'jaws' ? `<em>In his jaws</em>` : q.soft ? `by ${fmtT(q.e)}` : `${fmtT(q.s0).replace(/(am|pm)$/, fmtT(q.s0).slice(-2) === fmtT(q.e).slice(-2) ? '' : '$1')}–${fmtT(q.e)}`;
    const tag = q.boss ? '<i class="td-tag mk">Boss day · ×3</i>' : q.mark ? '<i class="td-tag mk">His mark · ×2</i>' : q.shield ? '<i class="td-tag sh">Shielded</i>' : q.bet ? '<i class="td-tag bt">Bet</i>' : q.sloth ? `<i class="td-tag cu">Sloth bit ${q.sloth}</i>` : q.wind ? '<i class="td-tag bt">Second Wind</i>' : q.left ? '<i class="td-tag">Leftover · half</i>' : habit && q.run ? `<i class="td-tag">↻ ${q.run} day${q.run === 1 ? '' : 's'}</i>` : '';
    const h = `<button class="td-ck" data-act="${aim ? 'aim' : 'toggle'}" data-id="${q.n.id}" aria-label="Finish ${nt}"></button><button class="td-n" data-act="${aim ? 'aim' : 'open'}" data-id="${q.n.id}"><span class="td-r1"><span class="td-tm">${when}</span>${tag}</span><b>${fog ? 'Face down in the fog' : (habit ? '↻ ' : '') + nt}</b></button><span class="td-g"><i></i>${q.g}</span>`;
    if (c.h !== h) { c.el.innerHTML = h; c.h = h; }
    c.el.dataset.id = q.n.id;
    c.el.className = `td-q${aim ? ' aimable' : ''}${q.mark ? ' marked' : ''}${q.boss ? ' boss' : ''}${q.shield ? ' shielded' : ''}${q.st === 'jaws' ? ' jaws' : ''}${habit ? ' habit' : ''}${q.foil?.n ? ' foil-' + q.foil.n : ''}${q.left ? ' left' : ''}${fog ? ' fog' : ''}`;
    c.el.style.setProperty('--c', colorOf(q.n) || 'transparent');
  }
  place(true);
}
let anchors = [], base0 = 0;
function targets() {
  const live = view === today(), m = live ? nowF() : null, base = view > today() ? Math.min(...R.Qs.map(q => q.e), 24 * 60) : m;
  base0 = base; anchors = [];
  const L = [...cards.values()].filter(c => !c.leaving).sort((a, b) => a.q.e - b.q.e || a.q.s0 - b.q.s0);
  let prev = -1e9;
  for (const c of L) {
    const q = c.q;
    let y = q.st === 'jaws' ? NOW_Y - 16 - Math.min(1, (m - q.e) / Math.max(1, q.by - q.e)) * 34 : LANE_Y + (q.e - base) * PPM - HALF; // its bottom edge is the minute it reaches his jaws
    y = Math.max(y, prev + GAP); prev = y; c.ty = y;
    if (q.st !== 'jaws') anchors.push([q.e, y + HALF]);
  }
  return L;
}
let crank = 0;
function place(snap) {
  const L = targets();
  // scrolling ahead: drag or wheel the lane; it drifts back to now after a while
  const lastY = L.length ? L[L.length - 1].ty : NOW_Y, max = Math.max(0, lastY + 60 - (LH - 150));
  if (!scroll.drag && Date.now() - scroll.at > 15000) scroll.to = 0;
  scroll.to = Math.min(max, Math.max(0, scroll.to));
  scroll.y += (scroll.to - scroll.y) * (snap || scroll.drag ? 1 : 0.18);
  const off = crank - scroll.y;
  for (const c of L) {
    if (c.y == null || snap && Math.abs(c.y - c.ty) > 300) c.y = c.ty;
    c.y += (c.ty - c.y) * (snap ? 1 : 0.12);
    const sh = c.q.st === 'jaws' && !reduce ? (Math.random() - 0.5) * 3 : 0;
    c.el.style.transform = `translate(${sh}px,${(c.y - HALF + off).toFixed(1)}px)`;
  }
  el.nowLine.style.transform = `translateY(${(LANE_Y - NOW_Y - scroll.y).toFixed(1)}px)`;
  el.back.hidden = scroll.to < 20;
  ruler(off);
}
/** Where minute t of the day sits on the lane: steady time, stretched wherever quests are packed closer than a card apart. */
function laneY(t) {
  const A = [[base0, LANE_Y], ...anchors.filter(a => a[0] > base0)];
  for (let i = A.length - 1; i >= 0; i--) if (t >= A[i][0]) {
    const a = A[i], b = A[i + 1]; if (!b) return a[1] + (t - a[0]) * PPM;
    return a[1] + (b[1] - a[1]) * (t - a[0]) / Math.max(1, b[0] - a[0]);
  }
  return LANE_Y + (t - base0) * PPM;
}
/** The time behind the quests: a line every half hour, the hours named, noon and 5pm marked as round ends, bedtime last. */
const ticks = new Map();
function ruler(off) {
  const live = view === today() && !R.closed, show = (live || view > today()) && !R.off;
  const want = new Set();
  if (show) {
    const bed = dragon.times().bed;
    for (let t = Math.ceil((base0 + 1) / 30) * 30; t <= bed; t += 30) want.add(t);
    want.add(bed);
  }
  for (const [t, e] of ticks) if (!want.has(t)) { e.remove(); ticks.delete(t); }
  const bed = dragon.times().bed;
  for (const t of want) {
    let e = ticks.get(t);
    if (!e) { e = document.createElement('div'); const hr = t % 60 === 0, end = t === 720 || t === 1020;
      e.className = `td-tk${hr ? ' hr' : ''}${end ? ' end' : ''}${t === bed ? ' bed' : ''}`;
      e.innerHTML = t === bed ? '<span>Bed</span>' : end ? `<span>${t === 720 ? 'Noon' : '5pm'}</span>` : hr ? `<span>${fmtT(t).replace(':00', '')}</span>` : '';
      if (end || t === bed) e.title = t === bed ? `Bedtime ${fmtT(t)}: the day closes` : 'Round ends';
      el.ruler.appendChild(e); ticks.set(t, e); }
    e.style.transform = `translateY(${(laneY(t) + off).toFixed(1)}px)`;
  }
}
const scroll = { y: 0, to: 0, at: 0, drag: null };
function foot() {
  const live = view === today();
  const eaten = live || view < today() ? R.Qs.filter(q => q.st === 'eaten') : [];
  el.belly.innerHTML = eaten.length ? `<span class="td-bl" title="Finish one and he coughs up half">In his gut · finish to make him cough up half</span>${eaten.map(q => `<span class="td-bone"><button class="td-ck" data-act="toggle" data-id="${q.n.id}" aria-label="Finish ${esc(q.n.t)} to make him cough up half"></button><button class="td-n" data-act="open" data-id="${q.n.id}">${esc(q.n.t || 'Untitled')}</button><em>½ ${Math.ceil(q.g / 2)}</em></span>`).join('')}` : '';
  hand();
}
/* ---------- your hand ---------- */
let aim = null; // { c, ids: [], plan } while a card waits for its quest(s), then for your yes
const AIM_TXT = { wind: 'Tap the quest to give a Second Wind', shield: 'Tap the quest to shield', swap: 'Tap the first quest to swap', back: 'Tap the quest to send back', split: 'Tap the big quest to split' };
function hand() {
  const live = view === today() && !R.closed;
  if (!live || R.off) { el.hand.innerHTML = ''; el.aim.hidden = true; return; }
  const n = R.hand.length;
  el.hand.innerHTML = R.hand.map((c, i) => { const off = i - (n - 1) / 2, sel = aim?.c === c.c;
    return `<button class="td-card${c.used ? ' used' : ''}${c.comeback ? ' comeback' : ''}${sel ? ' sel' : ''}" data-td="card" data-c="${c.c}" style="--off:${off};--sp:${n > 3 ? 90 : 114}px" aria-pressed="${sel}"${c.used ? ' disabled' : ''}><b>${c.n}</b><span>${c.t}</span><small class="${c.plan ? 'pl' : ''}">${c.plan ? 'Moves your plan' : 'Game only'}</small></button>`; }).join('');
  el.aim.hidden = !aim;
  if (aim) el.aim.innerHTML = aim.plan
    ? `<span><b>${dragon.CARDS[aim.c].n}:</b> ${esc(aim.plan.text)}</span><span class="td-aim-b"><button data-td="aim-x">Cancel</button><button class="go" data-td="aim-go">Play it</button></span>`
    : `<span>${aim.c === 'swap' && aim.ids.length ? 'Now tap the quest to trade with' : AIM_TXT[aim.c]}</span><button data-td="aim-x">Cancel</button>`;
  el.aim.classList.toggle('ask', !!aim?.plan);
  for (const c of cards.values()) c.el.classList.toggle('aimable', !!aim);
}
function pickCard(c) {
  const card = R.hand.find(h => h.c === c); if (!card || card.used) return;
  if (aim?.c === c) { aim = null; hand(); return; }
  if (!card.aim) { if (dragon.play(c, [], { deal: R.Qs, hand: R.hand })) played(card); return; }
  aim = { c, ids: [] }; hand();
}
function target(id) {
  const card = R.hand.find(h => h.c === aim.c); if (!card) { aim = null; return; }
  if (aim.plan) return; // waiting for Play it or Cancel
  if (!aim.ids.includes(id)) aim.ids.push(id);
  if (aim.ids.length < card.aim) { hand(); return; }
  if (card.plan) { // say exactly what moves, and wait for a yes
    const P = dragon.planOf(aim.c, aim.ids, R.Qs);
    if (!P) { aim = null; hand(); show('That card won\'t work there.'); return; }
    aim.plan = P; hand(); return;
  }
  go();
}
function go() {
  if (!aim) return; const card = R.hand.find(h => h.c === aim.c), text = aim.plan?.text;
  const ok = card && dragon.play(aim.c, aim.ids, { deal: R.Qs, hand: R.hand }); aim = null;
  if (ok) played(card, text); else { hand(); show('That card won\'t work there.'); }
}
let undoable = null;
function played(card, text) {
  happened.push(`played ${card.n}`); sfx.coin(); flinch = .8; undoable = card.plan ? card : null;
  el.banner.hidden = false; el.banner.className = 'td-banner card';
  el.banner.innerHTML = `<b>${card.n}</b><span>${esc(text || card.t)}</span>${card.plan ? '<button class="td-btn" data-td="undo-card">Undo</button>' : ''}`;
  clearTimeout(roundOver.t); roundOver.t = setTimeout(() => { el.banner.hidden = true; undoable = null; }, card.plan ? 7000 : 2600);
  refresh(); line(true);
}
/** Takes back the card just played: its plan change and the card itself. */
function undoCard() {
  if (!undoable) return; store.undo(); dragon.unplay(); undoable = null;
  el.banner.hidden = true; show('Fine. Put back as it was.'); refresh();
}
const VERDICT = {
  starves: ['He starves', 'Every round, every coin. He curls up on an empty hoard, whimpering.'],
  driven: ['You drove him off', 'He sulks back to his cave with scraps. The day is yours.'],
  stuffed: ['He\'s stuffed', 'He rolls onto his back, burping up your quest names. Rematch at dawn.'],
  rest: ['A quiet day', 'No quests, no gold. He napped on his hoard.'],
  off: ['A day off', 'He slept right through it. Nothing counted, nothing lost.']
};
const OFF = { rest: 'Rest day.', sick: 'Sick day.', holiday: 'Holiday.' };
function verdict() {
  const live = view === today(), show = view < today() || (live && R.closed);
  const dismissed = !!lsGet(SEEN, {})[view];
  if (!show) { el.verdict.hidden = true; return; }
  if (view < S.start) { el.verdict.hidden = false; el.verdict.className = 'td-verdict mini'; el.verdict.innerHTML = `<button disabled><b>Before your first fight</b><span>It began ${DAYL[pd(S.start).getDay()]}</span></button>`; return; }
  const [t, sub] = VERDICT[R.verdict];
  if (dismissed) { el.verdict.hidden = false; el.verdict.className = 'td-verdict mini'; el.verdict.innerHTML = `<button data-td="verdict"><b>${t}</b><span>${R.you} kept · ${R.him} eaten</span></button>`; return; }
  el.verdict.hidden = false; el.verdict.className = `td-verdict ${R.verdict}`;
  el.verdict.innerHTML = `<div class="td-vc"><small>${live ? 'Bedtime verdict' : 'The verdict'}</small><h2>${t}</h2><p>${sub}</p>
    ${R.rest ? '' : `<ol>${R.R.map((x, i) => `<li class="${x.res}" style="--i:${i}"><b>${x.name}</b><span>${x.res === 'none' ? 'No contest' : `${x.res === 'won' ? 'Won' : 'Lost'} · ${x.kept} of ${x.total}`}</span></li>`).join('')}</ol>`}
    <div class="td-chest"><span><i></i>${R.you}</span><small>kept ${live ? 'today' : 'that day'}${R.him ? ` · he ate ${R.him}` : ''}</small></div>
    ${hit().map(g => `<div class="td-wl"><b>${esc(g.name)}</b><span class="td-bar"><i style="width:${Math.round(g.wild * 100)}%"></i></span><small>Wildness ${Math.round(g.wild * 100)}%</small></div>`).join('')}
    ${R.chest ? `<div class="td-box"><i></i><span><b>+${R.chest}</b> from the bedtime chest</span></div>` : ''}
    ${live ? `<p class="td-bye">Phone down. See you at dawn.</p>` : ''}<button class="td-btn" data-td="verdict-x">${live ? 'Good night' : 'Close'}</button></div>`;
}

/* ---------- dawn: the morning look, the Market, packs, charms, days off ---------- */
let dawnOpen = false;
const DAWN = ['I\'m up. I\'m hungry. Guess whose list I\'ve been reading.', 'Morning. I can smell your to-do list from here.', 'Another dawn, another menu. Let\'s see what you\'ve cooked for me.', 'Stretch. Yawn. Count your quests. I already did.'];
function dawn() {
  const T = today(), live = view === T && !R.closed && !!S.start;
  const auto = live && !dragon.dawnSeen(T), open = live && (auto || dawnOpen);
  // the pill brings Dawn back: the Market before noon, a pack waiting, or just the day's look
  el.pill.hidden = !live || open;
  if (!el.pill.hidden) el.pill.innerHTML = S.packs > 0 ? '<b>A pack waits</b>' : dragon.marketOpen() ? '<b>Market</b><span>open till noon</span>' : '<b>Dawn</b>';
  root.parentElement?.classList.toggle('td-dawning', open || !!lairOpen);
  if (!open) { el.dawn.hidden = true; el.dawn.innerHTML = ''; return; }
  const mk = R.mark, sw = R.swoops, mkt = dragon.market(T), offer = S.packs > 0 ? dragon.packOffer() : null;
  const coin = '<i class="td-c"></i>';
  const item = (x, extra) => `<div class="td-it ${x.k}"><div><small>${x.k === 'card' ? 'Card' : `${x.r} charm`}</small><b>${x.n}</b><span>${x.t}</span></div>${extra || ''}</div>`;
  const offs = R.off
    ? `<p class="td-dm">${OFF[R.off]} He sleeps today.</p><button class="td-btn td-gh" data-td="off">Undo, let's fight</button>`
    : `<div class="td-offs">${dragon.restLeft(T) ? '<button data-td="off" data-k="rest">Rest day <small>one a week</small></button>' : '<button disabled>Rest day <small>used this week</small></button>'}<button data-td="off" data-k="sick">Sick</button><button data-td="off" data-k="holiday">Holiday</button></div>`;
  const again = !el.dawn.hidden; el.dawn.hidden = false;
  el.dawn.innerHTML = `<div class="td-vc td-dc${again ? ' still' : ''}"><small>Dawn · ${DAYL[pd(T).getDay()]} ${MON[pd(T).getMonth()]} ${pd(T).getDate()}</small>
    <h2>${R.off ? 'He sleeps' : 'He wakes hungry'}</h2><p class="td-q1">“${esc(pick(DAWN, T))}”</p>
    ${R.off ? '' : `<ul class="td-facts"><li><b>${R.Qs.length}</b> quest${R.Qs.length === 1 ? '' : 's'} · <b>${R.total}</b> gold on the table</li>
      ${sw.length ? `<li>Swoops at ${sw.map(x => fmtT(x.t)).join(', ')}</li>` : ''}
      ${mk ? `<li>His mark: <b>${esc(mk.n.t || 'Untitled')}</b>, worth double</li>` : ''}
      ${R.curses.map(c => `<li class="cu">Cursed with <b>${dragon.CURSES[c].n}</b>: ${dragon.CURSES[c].t}</li>`).join('')}
      ${R.hand.some(h => h.comeback) ? '<li class="ok">Two rough days: a free <b>Second Wind</b> is in your hand.</li>' : ''}
      <li>Your hand: ${R.hand.map(h => h.n).join(', ')}</li></ul>`}
    ${offer ? `<h3>A pack <small>keep one, the other two sell for ${dragon.SELL} each</small></h3><div class="td-its">${offer.map(x => item(x, `<button class="td-btn" data-td="pack" data-id="${x.id}">Keep</button>`)).join('')}</div>` : ''}
    ${R.off ? '' : dragon.marketOpen() ? `<h3>Morning Market <small>open till noon · you have ${coin}${S.gold}</small></h3><div class="td-its">${mkt.map(x => item(x,
      x.bought || x.owned ? `<button class="td-btn" disabled>${x.bought ? 'Bought' : 'Owned'}</button>` : `<button class="td-btn" data-td="buy" data-id="${x.id}"${S.gold < x.g ? ' disabled' : ''}>${coin}${x.g}</button>`)).join('')}</div>` : '<h3>Market <small>closed till tomorrow morning</small></h3>'}
    ${S.charms.length ? `<h3>Charms <small>${S.eq.length} of ${dragon.EQUIP} worn</small></h3><div class="td-chs">${S.charms.map(id => { const c = dragon.CHARMS[id], on = S.eq.includes(id);
      return `<button data-td="eq" data-id="${id}" aria-pressed="${on}" title="${c.t}"><b>${c.n}</b><span>${c.t}</span></button>`; }).join('')}</div>` : ''}
    <p class="td-dm">Shards ${S.shards % dragon.PACK} of ${dragon.PACK} to the next pack · deck of ${S.deck.length}</p>
    <h3>${R.off ? 'Day off' : 'Taking today off?'}</h3>${offs}
    <button class="td-btn go" data-td="dawn-x">${R.off ? 'Close' : 'To the fight'}</button></div>`;
}

/* ---------- goal dragons: on duty, the Dragons panel, his page ---------- */
let lairOpen = null, on = null, goalSeen = null, tint = 'none';
const hit = () => { const ids = new Set(R.Qs.filter(q => q.goal && (q.st === 'kept' || q.st === 'late')).map(q => q.goal)); return S.goals.filter(g => ids.has(g.id)); };
const hueOf = hex => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || ''); if (!m) return 0;
  const [r, g, b] = m.slice(1).map(x => parseInt(x, 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
/** When the next quest belongs to a big goal, that goal's dragon slides in for it: his colour, his name. */
function duty() {
  const live = view === today() && !R.closed && !R.off;
  const next = live ? R.Qs.find(q => q.st === 'jaws' || q.st === 'open') : null;
  const g = next?.goal ? S.goals.find(x => x.id === next.goal) : null;
  if ((g?.id || null) !== (on?.id || null) && g) { el.banner.hidden = false; el.banner.className = 'td-banner card'; el.banner.innerHTML = `<b>${esc(g.name)}</b><span>takes over for ${esc(next.n.t || 'this quest')}</span>`; clearTimeout(roundOver.t); roundOver.t = setTimeout(() => { el.banner.hidden = true; }, 3000); }
  on = g || null;
  tint = on ? `hue-rotate(${Math.round(hueOf(on.color) - 6)}deg) saturate(1.1)` : 'none';
  el.who.textContent = (on ? on.name.split(/[\s,]/)[0] : NAME).toUpperCase();
}
/** Taming and escapes get their moment when they happen. */
function goalMoments() {
  const st = new Map(S.goals.map(g => [g.id, g.status]));
  if (goalSeen) for (const g of S.goals) {
    const was = goalSeen.get(g.id); if (!was || was === g.status) continue;
    if (g.status === 'tamed') { el.banner.hidden = false; el.banner.className = 'td-banner won'; el.banner.innerHTML = `<b>Tamed!</b><span>${esc(g.name)} joins your lair. A pack waits at dawn.</span>`; sfx.fanfare(); }
    else if (g.status === 'escaped') { el.banner.hidden = false; el.banner.className = 'td-banner lost'; el.banner.innerHTML = `<b>${esc(g.name)} escaped</b><span>Push the due date to hunt him again.</span>`; sfx.thud(); }
    else continue;
    clearTimeout(roundOver.t); roundOver.t = setTimeout(() => { el.banner.hidden = true; }, 6000);
  }
  goalSeen = st;
}
/** Asks Claude for a better name. Kept only if it comes back looking like a name. */
async function nameIt(id, loud) {
  const p = store.get(id); if (!client || !p?.t) return;
  try {
    const { data } = await client.functions.invoke('quest', { body: { kind: 'name', facts: { goal: p.t, steps: (dragon.goals().find(g => g.id === id)?.steps) || 0, due: p.due || null } } });
    const n = (data?.line || '').trim().replace(/[."]+$/, '');
    if (n && n.length <= 40 && n.split(/\s+/).length <= 5) dragon.rename(id, n); else if (loud) show('He prefers the name he has.');
  } catch { if (loud) show('He prefers the name he has.'); }
}
const STATUS = { hunting: 'Hunting', escaped: 'Escaped', tamed: 'Tamed' };
const portrait = (g, big) => `<span class="td-pt${big ? ' big' : ''} ${g.status}" style="--h:${Math.round(hueOf(g.color) - 6)}deg"></span>`;
const dueTxt = d => d ? `${MON[pd(d).getMonth()]} ${pd(d).getDate()}` : 'no due date';
function lair() {
  el.drg.hidden = !S.start;
  root.parentElement?.classList.toggle('td-dawning', !!lairOpen || !el.dawn.hidden);
  if (!lairOpen) { el.lair.hidden = true; el.lair.innerHTML = ''; return; }
  const T = today(), again = !el.lair.hidden; el.lair.hidden = false;
  const g = !TABS[lairOpen] && S.goals.find(x => x.id === lairOpen);
  let h;
  if (lairOpen === 'help') h = helpView();
  else if (lairOpen === 'week') h = weekView();
  else if (lairOpen === 'realm') h = realmView();
  else if (lairOpen === 'lair') h = lairView();
  else if (g) {
    const bar = `<span class="td-bar"><i style="width:${Math.round(g.wild * 100)}%"></i></span>`;
    const left = g.due && g.status !== 'tamed' ? Math.max(0, Math.round((pd(g.due) - pd(T)) / 864e5)) : null;
    h = `<small><button class="td-back" data-td="lair-list">‹ Dragons</button></small>
      <div class="td-gh">${portrait(g, true)}<div><h2>${esc(g.name)}</h2><p>Dragon of <b>${esc(g.p.t || 'Untitled')}</b></p></div></div>
      <p class="td-st ${g.status}">${STATUS[g.status]}${g.esc ? ` · escaped ${g.esc}× (his quests pay +${g.esc * 25}%)` : ''}${g.tamed ? ` · since ${dueTxt(g.tamed)}` : ''}</p>
      ${g.status === 'tamed' ? '<p>He lounges on your hoard now. You finished every step.</p>' : `<div class="td-wl"><b>Wildness</b>${bar}<small>${Math.round(g.wild * 100)}%</small></div>
      <p class="td-dm">${Math.round(g.left / 60 * 10) / 10} of ${Math.round(g.total / 60 * 10) / 10} planned hours left · due ${dueTxt(g.due)}${left != null ? ` (${left} day${left === 1 ? '' : 's'})` : ''}</p>`}
      ${g.bosses.length ? `<h3>Boss days <small>milestones pay ×3</small></h3><ul class="td-facts">${g.bosses.map(b => `<li class="${b.done ? 'ok' : b.d && b.d < T ? 'cu' : ''}">${esc(b.n.t || 'Milestone')} · ${b.d ? dueTxt(b.d) : 'no date'}${b.done ? ' · beaten' : ''}</li>`).join('')}</ul>` : '<p class="td-dm">No milestones yet. Mark a step as a milestone on the Roadmap to give him boss days.</p>'}
      <div class="td-acts">${g.status !== 'tamed' ? `<button class="td-btn" data-td="push" data-id="${g.id}">Push due a week</button>` : ''}<button class="td-btn td-gh2" data-td="rename" data-id="${g.id}">Rename</button>${client ? `<button class="td-btn td-gh2" data-td="name-ai" data-id="${g.id}">Ask Claude to name him</button>` : ''}<button class="td-btn td-gh2" data-td="release" data-id="${g.id}">Let him go</button></div>`;
  } else {
    const tops = store.all().filter(n => n.p == null && !dragon.isGoal(n.id) && n.k !== 'area' && !isDone(n) && store.all().some(c => c.p === n.id));
    h = `${tabs('list')}<h2>Dragons</h2>
      ${S.goals.length ? `<div class="td-gl">${S.goals.map(g => `<button class="td-gi ${g.status}" data-td="goal" data-id="${g.id}">${portrait(g)}<span><b>${esc(g.name)}</b><small>${esc(g.p.t || '')} · ${STATUS[g.status]}${g.status === 'hunting' ? ` · ${Math.round(g.wild * 100)}% wild` : ''}</small></span></button>`).join('')}</div>` : '<p>No goal dragons yet. Pick a big project and he hatches.</p>'}
      ${tops.length ? `<h3>Hatch a goal dragon <small>from a project</small></h3><div class="td-offs td-hatch">${tops.slice(0, 8).map(n => `<button data-td="hatch" data-id="${n.id}">${esc(n.t || 'Untitled')}</button>`).join('')}</div>` : ''}`;
  }
  el.lair.innerHTML = `<div class="td-vc td-dc${again ? ' still' : ''}">${h}<button class="td-btn go" data-td="lair-x">Back to the fight</button></div>`;
}

/** How it works: what you do here, and what can change your plan. */
function helpView() {
  return `<small>How the Fight works</small><h2>Your day against ${NAME}</h2>
    <h3>What you do here</h3><ul class="td-facts">
      <li><b>Tap the circle</b> when a quest is done. <b>Tap its name</b> to open it.</li>
      <li>Quests ride up the time line toward his jaws. When a quest's time ends it sits in his jaws for a little while, then he eats its gold. Finish it late and he coughs up half.</li>
      <li>Drag the list up to look ahead. It drifts back to now on its own.</li></ul>
    <h3>Bonus gold when you finish one</h3><ul class="td-facts">
      <li><b>Strike:</b> right after you check a quest off, his eye flashes once. Tap while it flashes for a critical hit, +25% of its gold.</li>
      <li><b>Flick:</b> then swipe the pile of coins up toward your purse. A quick, clean flick adds +10%.</li>
      <li><b>Combo:</b> keep quests on time within half an hour of each other and each one adds +10% more, up to +50%. Ticking several in the same minute doesn't count.</li></ul>
    <h3>What changes your plan</h3><ul class="td-facts">
      <li>Nothing here moves your plan unless you play <b>Swap</b>, <b>Send back</b> or <b>Split</b>. Each one says exactly what will move and waits for <b>Play it</b>. You can undo right after.</li>
      <li>Every other card and charm is <b>game only</b>: it changes the gold, never your plan.</li>
      <li>To plan or rearrange your day, use <b>List</b> or <b>Time blocks</b>. The Fight follows whatever you plan there.</li></ul>
    <h3>Winning</h3><ul class="td-facts">
      <li>The day has three rounds: morning till noon, afternoon till 5pm, evening till bedtime. Keep 70% of a round's gold to win it.</li>
      <li>At bedtime: win every round and keep everything and he starves; win 2 and you drive him off; otherwise he's stuffed.</li></ul>`;
}
const TABS = { list: 'Dragons', week: 'War Table', realm: 'Realm', lair: 'Lair' };
const tabs = at => `<nav class="td-tabs">${Object.entries(TABS).map(([k, n]) => `<button data-td="tab" data-v="${k}" aria-pressed="${k === at}">${n}</button>`).join('')}</nav>`;
const hrs = m => `${Math.round(m / 6) / 10}h`;
/** The War Table: the week ahead, each day's quests and gold, planned hours against your free hours (provisions). */
function weekView() {
  const T = today(), days = [...Array(7)].map((_, i) => add(T, i)).map(d => ({ d, r: dragon.dayView(d, S) }));
  const planned = days.reduce((a, x) => a + x.r.Qs.reduce((b, q) => b + q.m, 0), 0), free = freeH() * 60, over = planned > free;
  const gl = new Map(S.goals.map(g => [g.id, g]));
  return `${tabs('week')}<h2>War Table</h2><p>The week ahead. Free hours are your provisions: plan more than you have and he feasts.</p>
    <div class="td-wl"><b>Provisions</b><span class="td-bar${over ? ' over' : ''}"><i style="width:${Math.min(100, Math.round(planned / Math.max(1, free) * 100))}%"></i></span><small>${hrs(planned)} of ${hrs(free)}</small></div>
    <div class="td-wk">${days.map(({ d, r }) => { const ids = [...new Set(r.Qs.map(q => q.goal).filter(Boolean))].map(id => gl.get(id)).filter(Boolean);
      const off = r.off ? `<em>${OFF[r.off].replace('.', '')}</em>` : '';
      return `<button class="td-wd${d === T ? ' td-here' : ''}" data-act="goday" data-d="${d}"><b>${d === T ? 'Today' : DAYL[pd(d).getDay()].slice(0, 3)}</b><small>${MON[pd(d).getMonth()]} ${pd(d).getDate()}</small>
        <span>${off || `${r.Qs.length} quest${r.Qs.length === 1 ? '' : 's'} · ${r.total}g`}</span><span class="td-dm2">${hrs(r.Qs.reduce((a, q) => a + q.m, 0))}${r.Qs.some(q => q.boss) ? ' · <i class="td-boss">Boss</i>' : ''}</span>
        <span class="td-pts">${ids.map(g => portrait(g)).join('')}</span></button>`; }).join('')}</div>
    ${S.goals.filter(g => g.status === 'hunting').length ? `<h3>On the hunt</h3><ul class="td-facts">${S.goals.filter(g => g.status === 'hunting').map(g => { const n = days.reduce((a, x) => a + x.r.Qs.filter(q => q.goal === g.id).length, 0);
      return `<li>${esc(g.name)}: ${n ? `${n} quest${n === 1 ? '' : 's'} this week` : '<b>no quests this week</b>, he grows bolder'}</li>`; }).join('')}</ul>` : ''}
    <div class="td-acts"><button class="td-btn" data-act="ask" data-q="Plan my week">Ask Claude to draft the week</button></div>`;
}
/** The Realm Map: your year, a lair for each goal dragon in the month he's due. */
function realmView() {
  const T = today(), t = pd(T), months = [...Array(12)].map((_, i) => new Date(t.getFullYear(), t.getMonth() + i, 1));
  const key = d => d.slice(0, 7), mk = m => `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
  const by = new Map(); for (const g of S.goals) if (g.due && g.status !== 'escaped') { const k = key(g.due); by.set(k, [...(by.get(k) || []), g]); }
  const wild = S.goals.filter(g => g.status === 'escaped'), lost = S.goals.filter(g => !g.due && g.status !== 'tamed');
  const lair = g => `<button class="td-rl ${g.status}" data-td="goal" data-id="${g.id}" title="${esc(g.name)}">${portrait(g)}<small>${esc(g.name.split(/[\s,]/)[0])}</small></button>`;
  return `${tabs('realm')}<h2>The Realm</h2><p>Your year. Each goal dragon makes his lair in the month he's due.</p>
    <div class="td-map">${months.map((m, i) => { const L = by.get(mk(m)) || [];
      return `<div class="td-mo${i === 0 ? ' td-here' : ''}${L.length ? '' : ' empty'}" style="--i:${i}"><small>${MON[m.getMonth()]}${m.getMonth() === 0 || i === 0 ? ` ${m.getFullYear()}` : ''}</small><div>${L.map(lair).join('') || '<i class="td-tree"></i>'}</div></div>`; }).join('')}</div>
    ${wild.length ? `<h3>Wild lands <small>escaped; push his due date to hunt him again</small></h3><div class="td-rw">${wild.map(lair).join('')}</div>` : ''}
    ${lost.length ? `<h3>Uncharted <small>no due date yet</small></h3><div class="td-rw">${lost.map(lair).join('')}</div>` : ''}
    <div class="td-acts"><button class="td-btn td-gh2" data-td="tab" data-v="list">Hatch a new goal dragon</button></div>`;
}
/** The Lair: tamed dragons lounging on your hoard, your Hunter rank and trophies. */
function lairView() {
  const tamed = S.goals.filter(g => g.status === 'tamed'), R2 = S.rank;
  return `${tabs('lair')}<h2>Your Lair</h2>
    <div class="td-den">${tamed.length ? tamed.map((g, i) => `<button class="td-tamed" data-td="goal" data-id="${g.id}" style="--i:${i}">${portrait(g, true)}<small>${esc(g.name.split(/[\s,]/)[0])}</small></button>`).join('') : '<p>No dragons tamed yet. Finish a big goal and his dragon moves in here.</p>'}<i class="td-pile"></i></div>
    <h3>${R2.n} <small>Hunter rank${R2.next ? ` · ${R2.to} to ${R2.next.n}` : ' · the highest'}</small></h3>
    <span class="td-bar"><i style="width:${Math.round(R2.p * 100)}%"></i></span>
    <p class="td-dm">Every quest saved, dragon tamed and day in your best run raises it.</p>
    <h3>Trophies</h3><ul class="td-tro">
      <li><b>${S.gold}</b><small>gold in your purse</small></li><li><b>${S.kept}</b><small>gold kept all time</small></li>
      <li><b>${S.shards}</b><small>quests saved</small></li><li><b>${S.best}</b><small>best run of days</small></li>
      <li><b>${S.tally.starves}</b><small>days he starved</small></li><li><b>${tamed.length}</b><small>dragons tamed</small></li></ul>`;
}

/* ---------- moments ---------- */
let snapT = 0, flinch = 0, happened = [];
function saved(q) {
  const c = cards.get(q.n.id), late = q.st === 'late'; flinch = 1;
  happened.push(`${late ? 'coughed up half of (they finished it after you ate it)' : 'kept'}: ${q.n.t}${q.combo > 1 ? ` (combo x${q.combo})` : ''}`);
  // the quick hit plays only for a check-off made just now, one at a time
  const done = (q.n.tl || []).filter(x => x.end).pop(), fresh = done && Date.now() - new Date(done.end) < 90e3;
  const play = fresh && !moment && !reduce && view === today();
  let x = 300, y = NOW_Y;
  if (late) { cough = 1; sfx.thud(); x = HX + 150; y = HY + 24; } else sfx.coin();
  if (c) {
    c.leaving = true; c.el.classList.add('saved');
    y = late ? y : c.y - scroll.y; c.el.innerHTML = `<span class="td-gold"><i></i>+${q.you}</span>`;
    setTimeout(() => { c.el.remove(); cards.delete(q.n.id); }, 900);
  }
  if (q.combo > 1) pop(`Combo ×${q.combo}`, `+${q.comboB}`);
  if (play) startHit(q, late ? x : 300, y);
  else if (c || late) coins(x, y, 330, 22, Math.min(12, 3 + q.you / 3 | 0));
  line(true);
}
/* ---------- the quick hit: strike when his eye flashes, then flick the coins into your purse ---------- */
let moment = null, cough = 0;
function startHit(q, x, y) {
  const now = performance.now(), h = dragon.hits(q.n.id);
  moment = { id: q.n.id, g: q.g, x, y, phase: h.s || q.st === 'late' ? 'flick' : 'strike', t0: now, glow: now + 700 + Math.random() * 1100, len: 520, late: q.st === 'late', flicked: !!h.f };
  el.hit.hidden = false;
  if (moment.phase === 'strike') el.hit.innerHTML = `<p class="td-hp">Strike when his eye flashes</p>`;
  else toFlick();
}
function toFlick() {
  const m = moment; if (!m) return;
  if (m.flicked) { coins(m.x, m.y, 330, 22, 6); return endHit(); }
  m.phase = 'flick'; m.t0 = performance.now();
  el.hit.innerHTML = `<div class="td-pile" style="left:${m.x - 34}px;top:${m.y - 26}px">${'<i></i>'.repeat(7)}</div><p class="td-hp">${m.late ? 'He coughed it up! ' : ''}Flick the gold into your purse ↗</p>`;
}
function endHit() { moment = null; el.hit.hidden = true; el.hit.innerHTML = ''; }
function pop(a, b) {
  const e = document.createElement('div'); e.className = 'td-popx'; e.innerHTML = `<b>${a}</b><span>${b}</span>`; el.stage.appendChild(e);
  setTimeout(() => e.remove(), 1600);
}
function hitEvents() {
  const at = e => { const r = el.stage.getBoundingClientRect(); return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]; };
  el.hit.addEventListener('pointerdown', e => {
    const m = moment; if (!m) return; e.preventDefault(); e.stopPropagation();
    const now = performance.now();
    if (m.phase === 'strike') {
      if (now >= m.glow && now <= m.glow + m.len) { dragon.hit(m.id, 's'); flinch = 1.4; snapT = 0; sfx.roar(); el.flash.animate([{ opacity: .5 }, { opacity: 0 }], { duration: 300 }); pop('Critical hit!', `+${dragon.STRIKE(m.g)}`); }
      else pop(now < m.glow ? 'Too soon' : 'Too late', 'no bonus');
      m.phase = 'wait'; setTimeout(toFlick, 650); return;
    }
    if (m.phase === 'flick') {
      const [px, py] = at(e);
      if (Math.hypot(px - m.x, py - m.y) > 60) { coins(m.x, m.y, 330, 22, 6); return endHit(); } // tapped away: the coins go in anyway
      m.drag = { x: px, y: py, t: now, id: e.pointerId }; el.hit.setPointerCapture?.(e.pointerId);
    }
  });
  el.hit.addEventListener('pointermove', e => { const m = moment, d = m?.drag; if (!d || d.id !== e.pointerId) return;
    const [px, py] = at(e), pile = el.hit.querySelector('.td-pile'); if (pile) pile.style.translate = `${px - d.x}px ${py - d.y}px`;
    d.lx = px; d.ly = py; d.lt = performance.now(); });
  el.hit.addEventListener('pointerup', e => { const m = moment, d = m?.drag; if (!d || d.id !== e.pointerId) return;
    const [px, py] = at(e), dt = Math.max(1, performance.now() - d.t), dx = px - d.x, dy = py - d.y, v = Math.hypot(dx, dy) / dt;
    // clean: quick, and aimed at the purse (top right)
    const want = Math.atan2(22 - m.y, 330 - m.x), got = Math.atan2(dy, dx), off = Math.abs(((got - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const clean = Math.hypot(dx, dy) > 40 && v > 0.35 && off < 0.7;
    coins(m.x + dx, m.y + dy, 330, 22, clean ? 12 : 6);
    if (clean) { dragon.hit(m.id, 'f'); sfx.coin(true); pop('Clean flick!', `+${dragon.FLICK(m.g)}`); } else if (Math.hypot(dx, dy) > 20) pop('Sloppy', 'no bonus');
    endHit(); });
}
function hitTick(now) {
  const m = moment; if (!m) return 0;
  if (m.phase === 'strike' && now > m.glow + m.len + 400) { m.phase = 'wait'; toFlick(); }
  if (m.phase === 'flick' && !m.drag && now - m.t0 > 4500) { coins(m.x, m.y, 330, 22, 6); endHit(); }
  return m.phase === 'strike' && now >= m.glow && now <= m.glow + m.len ? 1 : 0;
}
/** The combo meter: how many in a row, and how long until the chain breaks. */
function comboMeter() {
  const c = R.combo, live = view === today() && !R.closed, left = c && live ? c.until - nowF() : 0;
  if (!c || c.n < 2 || left <= 0) { el.combo.hidden = true; return; }
  el.combo.hidden = false;
  el.combo.innerHTML = `<b>Combo ×${c.n}</b><span>next one +${Math.round(Math.min(dragon.COMBO.max, dragon.COMBO.step * c.n) * 100)}% · ${Math.ceil(left)}m</span><i style="--p:${(left / dragon.COMBO.gap).toFixed(3)}"></i>`;
}
function chomped(q) {
  const c = cards.get(q.n.id); snapT = 1; happened.push(`${q.swooped ? 'swooped on' : 'ate'}: ${q.n.t}`);
  if (q.swooped) { el.banner.hidden = false; el.banner.className = 'td-banner lost'; el.banner.innerHTML = `<b>SWOOP</b><span>He took ${esc(q.n.t)} early</span>`; clearTimeout(roundOver.t); roundOver.t = setTimeout(() => { el.banner.hidden = true; }, 3500); }
  sfx.roar();
  if (c) { c.leaving = true; c.el.classList.add('chomp'); setTimeout(() => { c.el.remove(); cards.delete(q.n.id); }, 600); }
  coins(280, NOW_Y - 20, 230, 200, 6);
  el.flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 600 });
  if (!reduce) el.stage.animate([{ translate: '0 0' }, { translate: '-5px 3px' }, { translate: '4px -3px' }, { translate: '0 0' }], { duration: 260 });
  line(true);
}
function roundOver(x) {
  el.banner.hidden = false; el.banner.className = 'td-banner ' + x.res;
  el.banner.innerHTML = `<b>${x.name} ${x.res === 'won' ? 'won' : 'lost'}</b><span>${x.kept} of ${x.total} kept</span>`;
  (x.res === 'won' ? sfx.fanfare : sfx.thud)();
  clearTimeout(roundOver.t); roundOver.t = setTimeout(() => { el.banner.hidden = true; }, 5000);
}
function coins(x, y, tx, ty, n) {
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i'); c.className = 'td-coin'; c.style.left = x + 'px'; c.style.top = y + 'px'; el.stage.appendChild(c);
    const mx = x + (Math.random() - 0.5) * 90, my = y - 30 - Math.random() * 60;
    c.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${mx - x}px,${my - y}px)`, offset: 0.35 }, { transform: `translate(${tx - x}px,${ty - y}px) scale(.6)`, opacity: 0.9 }], { duration: 650 + i * 40, easing: 'cubic-bezier(.3,.1,.3,1)' }).onfinish = () => c.remove();
  }
}

/* ---------- his voice ---------- */
const pick = (L, seed) => L[Math.abs([...String(seed)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)) % L.length];
function fallback() {
  const m = nowMin(), seed = view + R.you + R.him + Math.floor(m / 15) + said.n;
  const next = R.Qs.find(q => q.st === 'open' || q.st === 'jaws'), jaws = R.Qs.find(q => q.st === 'jaws'), last = R.Qs.filter(q => q.st === 'eaten').pop();
  if (view > today()) return pick(['Tomorrow\'s menu. I\'ve already picked my favourite.', `${R.total} gold on tomorrow's table. Sleep well. I won't.`, 'Planning ahead? Adorable. I plan too. Mostly lunch.'], seed);
  if (view < today()) return VERDICT[R.verdict][1];
  if (R.off) return pick(['Zzz. Day off. Don\'t think I\'m not counting.', 'Mmh. Wake me tomorrow. I\'ll be twice as hungry.'], seed);
  if (R.rest) return pick(['An empty day? Then I nap on my hoard. Wake me when there\'s something to eat.', 'No quests. No gold. No fun. Add something, I\'m starving.'], seed);
  if (R.closed) return pick(['Bedtime. Put the phone down, I\'ll still be here at dawn.', 'The day is done. Go to sleep, I\'ll count my coins.'], seed);
  if (jaws) return pick([`${jaws.n.t} is in my mouth. I'm just savouring it.`, `Mmm. ${jaws.n.t}. ${Math.max(1, Math.round(jaws.by - m))} minutes and it's mine.`, `Careful. ${jaws.n.t} is between my teeth.`, `I can taste the gold on ${jaws.n.t} already.`], seed);
  if (last && happened.some(h => h.startsWith('ate'))) return pick([`${last.n.t}. Delicious. Do it again.`, 'Thank you for your donation.', 'Mm. Tastes like procrastination.'], seed);
  if (!next) return R.him ? pick(['Nothing left to chase. I\'ll digest.', 'You\'re done for today? Fine. I ate well enough.'], seed) : pick(['Not one coin. I\'m going to sulk on my rock.', 'You left me nothing. Nothing! I\'m telling the other dragons.'], seed);
  const soon = Math.round(next.e - m);
  if (soon <= 30) return pick([`${next.n.t} reaches my jaws in ${soon} minutes. I'm stretching.`, `Tick. Tock. ${next.n.t}.`, `Closer. Closer. ${next.n.t}, come to me.`], seed);
  return pick(['Take your time. Really. I\'m patient. And hungry.', 'Every minute you scroll, I get a coin.', `${next.n.t}? I'll eat it right out of your day.`, 'Your list is my menu, you know.', `${R.total - R.you - R.him} gold still out there. I only need you to look away.`, 'I\'ve been watching you. You\'re doing that thing where you don\'t do the thing.'], seed);
}
const LINES = 'daybook-td-lines';
let said = { n: 0 }, asking = null, lastAsk = 0;
function line(fresh = false) {
  const base = fallback(), T = today();
  if (view !== T || R.closed) return show(base);
  const m = nowMin(), key = `${R.you}|${R.him}|${R.Qs.filter(q => q.st === 'open').length}|${R.Qs.filter(q => q.st === 'jaws').length}|${Math.floor(m / 20)}`;
  const L = lsGet(LINES, {}), have = L.d === T && L.L?.[key];
  if (client && !asking && (!have || fresh) && Date.now() - lastAsk > (fresh ? 8e3 : 60e3)) {
    lastAsk = Date.now();
    asking = ask(L.d === T ? L.recent || [] : []).then(t => { if (!t) return; const s = lsGet(LINES, {}); if (s.d !== T) { s.d = T; s.L = {}; s.recent = []; } s.L[key] = t; s.recent = [...(s.recent || []), t].slice(-6); lsSet(LINES, s); show(t); }).finally(() => { asking = null; });
  }
  show(have || base);
}
function show(t) { if (el.say.textContent !== t) { el.say.textContent = t; el.say.parentElement.animate([{ opacity: 0.2, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 300 }); } }
function say() { line(false); }
function poke() { said.n++; flinch = 0.6; line(true); }
const ANGLES = ['gloat about something specific that happened', 'make a precise threat naming a quest and the minute it reaches your jaws', 'mock-sympathetic', 'a backhanded compliment', 'brag about your hoard', 'propose a cheeky wager', 'grumble like a sore loser', 'a two-line rhyming couplet', 'pretend to be bored and not watching (you are watching)', 'scheme out loud about the next quest you will eat', 'count coins out loud', 'a dramatic proclamation'];
async function ask(recent) {
  const m = nowMin(), r = R.R.find(x => x.live) || R.R[2];
  const facts = {
    game: 'task_dragon', you_are: on ? on.name : NAME, ...(on ? { you_are_the_dragon_of_their_big_goal: on.p.t, your_wildness_percent: Math.round(on.wild * 100), times_you_escaped_them: on.esc } : {}), time: fmtT(m), round: r.name, round_gold: r.total, round_kept_so_far: r.kept, round_need_to_win: r.need,
    rounds: R.R.map(x => ({ round: x.name, result: x.res, kept: x.kept, of: x.total })),
    gold_today: R.total, kept_today: R.you, you_ate_today: R.him, their_purse: S.gold, your_belly_all_time: S.belly, their_run_of_days_you_did_not_win: S.run, your_hunger: S.hunt.n,
    quests: R.Qs.map(q => ({ title: q.n.t, gold: q.g, reaches_your_jaws: fmtT(Math.round(q.e)), you_eat_it_at: fmtT(Math.round(q.by)), state: q.st, ...(q.left ? { leftover_from_yesterday: true } : {}), ...(q.n.rs ? { habit_days_running: q.run } : {}) })),
    just_happened: happened.slice(-5), your_recent_lines_do_not_repeat: recent, angle_for_this_line: ANGLES[Math.floor(Math.random() * ANGLES.length)]
  };
  happened = [];
  try { const { data, error } = await client.functions.invoke('quest', { body: { facts, kind: 'fight' } }); return error || !data?.line ? null : String(data.line).slice(0, 220); } catch { return null; }
}

/* ---------- the dragon, painted in code ---------- */
const P = {
  head: [[-150,20],[-140,-40],[-105,-78],[-50,-92],[-10,-80],[20,-66],[70,-52],[120,-42],[150,-34],[172,-16],[176,0],[160,8],[110,6],[50,4],[0,2],[-40,26],[-90,44],[-130,40]],
  hinge: [-10, 6],
  jaw: [[-20,-4],[50,2],[110,6],[160,10],[174,18],[160,30],[110,38],[50,44],[-10,46],[-50,38],[-62,16]],
  lip: [[172,2],[160,8],[110,6],[50,4],[0,2],[-20,4]],
  jtop: [[-20,-4],[50,2],[110,6],[160,10],[172,14]],
  hornA: [[-80,-84],[-100,-124],[-112,-164],[-116,-200],[-92,-156],[-70,-116],[-44,-88]],
  hornB: [[-120,-62],[-150,-96],[-178,-128],[-196,-160],[-160,-120],[-128,-90],[-100,-70]],
  frill: [[-112,12],[-176,-8],[-158,20],[-196,36],[-150,46],[-120,40]],
  brow: [[-52,-86],[-34,-108],[-10,-90],[10,-72],[-20,-76]],
  neckR: [[-50,44],[-22,110],[-30,220],[-56,340],[-76,470],[-90,700]],
  eye: [-14, -52], nostril: [150, -24]
};
const HX = 130, HY = 178;
const neck = h => [[-110,36],[-50,44],[-22,110],[-30,220],[-56,340],[-76,470],[-90,h],[-230,h],[-186,340],[-172,220],[-182,110],[-204,30],[-172,-20]];
function crPath(c, pts) {
  const n = pts.length; c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) { const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    c.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]); }
  c.closePath();
}
const bbox = pts => pts.reduce((b, [x, y]) => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const yAt = (pts, x) => { for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if ((x - a[0]) * (x - b[0]) <= 0) return a[1] + (b[1] - a[1]) * (x - a[0]) / ((b[0] - a[0]) || 1); } return pts[pts.length - 1][1]; };
const jawXf = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [P.hinge[0] + p[0] * c - p[1] * s, P.hinge[1] + p[0] * s + p[1] * c]; };
const local = (c, sx, sy) => { const m = c.getTransform().inverse(), p = m.transformPoint(new DOMPoint(sx * c._dpr, sy * c._dpr)); return [p.x, p.y]; };
let scalePat = null;
function pattern() {
  const c = document.createElement('canvas'); c.width = 28; c.height = 24; const g = c.getContext('2d'); g.lineWidth = 1.4;
  for (const [x, y] of [[0, 0], [14, 0], [28, 0], [7, 12], [21, 12], [0, 24], [14, 24], [28, 24]]) {
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.arc(x, y, 8, .15 * Math.PI, .85 * Math.PI); g.stroke();
    g.strokeStyle = 'rgba(255,190,140,.10)'; g.beginPath(); g.arc(x, y - 1.5, 7, .25 * Math.PI, .75 * Math.PI); g.stroke();
  }
  return ctx.createPattern(c, 'repeat');
}
function part(pts, col, lights, scales = true) {
  const b = bbox(pts);
  ctx.save(); ctx.beginPath(); crPath(ctx, pts);
  const g = ctx.createLinearGradient(0, b.y0, 0, b.y1); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]); ctx.fillStyle = g; ctx.fill(); ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  for (const L of lights) { const [lx, ly] = local(ctx, L.x, L.y), rg = ctx.createRadialGradient(lx, ly, 0, lx, ly, L.r); rg.addColorStop(0, L.c); rg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = rg; ctx.fillRect(b.x0 - 10, b.y0 - 10, b.x1 - b.x0 + 20, b.y1 - b.y0 + 20); }
  ctx.globalCompositeOperation = 'source-over';
  if (scales) { scalePat = scalePat || pattern(); ctx.fillStyle = scalePat; ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
  ctx.lineWidth = 10;
  ctx.save(); ctx.translate(5, 6); ctx.beginPath(); crPath(ctx, pts); ctx.strokeStyle = col[2] || 'rgba(140,170,255,.32)'; ctx.stroke(); ctx.restore();
  ctx.save(); ctx.translate(-4, -6); ctx.beginPath(); crPath(ctx, pts); ctx.strokeStyle = col[3] || 'rgba(255,130,50,.28)'; ctx.stroke(); ctx.restore();
  ctx.restore();
  ctx.save(); ctx.beginPath(); crPath(ctx, pts); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(10,4,6,.55)'; ctx.stroke(); ctx.restore();
}
function teeth(line, xs, down, fangs) {
  for (const x of xs) {
    const y = yAt(line, x), L = fangs.includes(x) ? 18 : 9, w = fangs.includes(x) ? 6 : 4.5;
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - 1, y + (down ? L : -L) * .6, x + 1, y + (down ? L : -L)); ctx.lineTo(x + w, y); ctx.closePath();
    const g = ctx.createLinearGradient(0, y, 0, y + (down ? L : -L)); g.addColorStop(0, '#b8a27a'); g.addColorStop(1, '#fff6e0'); ctx.fillStyle = g; ctx.fill();
  }
}
const embers = [], smoke = [];
const COINS = Array.from({ length: 70 }, (_, i) => { const a = hash(i) * Math.PI, r = Math.sqrt(hash(i + 50)); return { x: 80 + Math.cos(a) * r * 150 * (hash(i + 3) < .5 ? -1 : 1), y: -Math.sin(a) * r * 50 + 6, s: 5 + hash(i + 7) * 4, t: hash(i + 11) }; }).sort((a, b) => a.y - b.y);
/* ---------- the painted dragon: two paintings of the same pose, mouth closed and mouth open ---------- */
// Points on the 1024 x 1536 paintings: the eye, the snout tip, the bottom of the closed jaw (which sits on the NOW line),
// and the base of the neck he sways from.
const ART = { w: 1024, h: 1536, eye: [536, 344], tip: [1000, 470], nose: [945, 452], jaw: 600, base: [330, 1536], lid: [44, 17] };
const art = { ok: false, open: 0 };
if (typeof Image !== 'undefined') {
  const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  Promise.all([load('art/dragon-closed.webp'), load('art/dragon-open.webp')]).then(([c, o]) => { if (c && o) { art.closed = c; art.opened = o; art.ok = true; } });
}
function painted(p, H, dt) {
  const s = Math.min(.44, Math.max(.36, (H - 400) / 936)), x0 = 312 - ART.tip[0] * s, y0 = NOW_Y - ART.jaw * s;
  // the jaw: open while a quest is near or in his teeth, snapping shut on a CHOMP
  art.open += ((p.jaw > .28 ? 1 : 0) - art.open) * Math.min(1, dt * 14);
  const [bx, by] = [x0 + ART.base[0] * s, y0 + ART.base[1] * s];
  ctx.save(); ctx.filter = tint;
  ctx.translate(bx + p.lean, by + p.bob); ctx.rotate(p.tilt * .6); ctx.scale(1, 1 + Math.sin(performance.now() / 1300) * .004); ctx.translate(-bx, -by);
  ctx.drawImage(art.closed, x0, y0, ART.w * s, ART.h * s);
  if (art.open > .01) { ctx.globalAlpha = art.open; ctx.drawImage(art.opened, x0, y0, ART.w * s, ART.h * s); ctx.globalAlpha = 1; }
  ctx.filter = 'none';
  const ex = x0 + ART.eye[0] * s, ey = y0 + ART.eye[1] * s; art.nose = [x0 + ART.nose[0] * s + p.lean, y0 + ART.nose[1] * s + p.bob];
  // his eye burns hotter as a quest gets close, and flares for a strike
  ctx.globalCompositeOperation = 'lighter';
  let g = ctx.createRadialGradient(ex, ey, 1, ex, ey, 30); g.addColorStop(0, `rgba(255,200,90,${.12 + p.eye * .5})`); g.addColorStop(1, 'rgba(255,120,30,0)'); ctx.fillStyle = g; ctx.fillRect(ex - 30, ey - 30, 60, 60);
  if (p.flare) { g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 80); g.addColorStop(0, 'rgba(255,255,220,.95)'); g.addColorStop(.25, 'rgba(255,220,120,.6)'); g.addColorStop(1, 'rgba(255,160,40,0)'); ctx.fillStyle = g; ctx.fillRect(ex - 80, ey - 80, 160, 160); }
  ctx.globalCompositeOperation = 'source-over';
  if (p.blink > .05 && !p.flare) { // a scaled lid drops over it
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(-.12); ctx.beginPath(); ctx.ellipse(0, -ART.lid[1] * s * (1 - p.blink), ART.lid[0] * s, ART.lid[1] * s * p.blink + .5, 0, 0, Math.PI * 2);
    g = ctx.createLinearGradient(0, -ART.lid[1] * s, 0, ART.lid[1] * s); g.addColorStop(0, '#c4421e'); g.addColorStop(1, '#8a2414'); ctx.fillStyle = g; ctx.fill(); ctx.restore();
  }
  ctx.restore();
}
function draw(p, time, dt) {
  const H = LH, hy = H - 150; // the hoard sits just above the rounds
  ctx.setTransform(ctx._dpr, 0, 0, ctx._dpr, 0, 0);
  // the cave
  let g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#120b18'); g.addColorStop(.55, '#1e1018'); g.addColorStop(1, '#2c140e'); ctx.fillStyle = g; ctx.fillRect(0, 0, BW, H);
  ctx.fillStyle = 'rgba(40,22,40,.75)';
  for (const [x, w] of [[230, 70], [330, 90], [20, 60]]) { ctx.beginPath(); ctx.moveTo(x - w / 2, H); ctx.quadraticCurveTo(x - w * .3, H * .45, x - w * .1, 0); ctx.lineTo(x + w * .2, 0); ctx.quadraticCurveTo(x + w * .35, H * .45, x + w / 2, H); ctx.fill(); }
  ctx.fillStyle = '#0c0810';
  for (let i = 0; i < 9; i++) { const x = 160 + i * 30 + hash(i) * 12, l = 30 + hash(i + 9) * 60; ctx.beginPath(); ctx.moveTo(x - 10, 0); ctx.lineTo(x, l); ctx.lineTo(x + 10, 0); ctx.fill(); }
  g = ctx.createRadialGradient(90, hy, 10, 90, hy, 340); g.addColorStop(0, `rgba(255,150,60,${.42 * p.flicker})`); g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(0, 250, BW, H - 250); ctx.globalCompositeOperation = 'source-over';
  // the dragon: Michael's paintings once they've loaded, else the one painted in code
  if (art.ok) painted(p, H, dt); else {
  ctx.save(); ctx.filter = tint; ctx.translate(HX + p.lean, HY + p.bob); ctx.rotate(p.tilt);
  const lights = [{ x: 90, y: hy, r: 520, c: `rgba(255,120,40,${.3 * p.flicker})` }, { x: HX + 70, y: HY + 30, r: 120 + p.jaw * 200, c: `rgba(255,140,50,${.15 + p.heat * .45 * p.flicker})` }];
  const skin = ['#7d2a22', '#3a0f12'];
  part(neck(H - HY + 40), skin, lights);
  ctx.fillStyle = '#c9b48a';
  const back = [[-200, 34], [-182, 110], [-172, 220], [-186, 340]];
  for (let i = 0; i < 7; i++) {
    const t = i / 6, kk = Math.min(2, Math.floor(t * 3)), u = t * 3 - kk, a = back[kk], b = back[kk + 1];
    const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, nx = -(b[1] - a[1]), ny = b[0] - a[0], nl = Math.hypot(nx, ny), L = 34 - i * 2, w = 14;
    ctx.beginPath(); ctx.moveTo(x - w * (b[0] - a[0]) / nl, y - w * (b[1] - a[1]) / nl); ctx.lineTo(x + nx / nl * L - 8, y + ny / nl * L - 10); ctx.lineTo(x + w * (b[0] - a[0]) / nl, y + w * (b[1] - a[1]) / nl); ctx.fill();
  }
  part(P.hornB, ['#8a7a60', '#3a3024', 'rgba(160,180,255,.25)', 'rgba(255,140,60,.2)'], []);
  const jt = P.jtop.map(q => jawXf(q, p.jaw));
  ctx.beginPath(); ctx.moveTo(P.lip[0][0], P.lip[0][1]); for (const q of P.lip) ctx.lineTo(q[0], q[1]); for (const q of jt) ctx.lineTo(q[0], q[1] + 4); ctx.closePath();
  g = ctx.createRadialGradient(10, 14, 4, 30, 20, 190); g.addColorStop(0, `rgba(255,${180 + p.heat * 60 | 0},90,${.5 + p.heat * .5})`); g.addColorStop(.35, '#a1231a'); g.addColorStop(1, '#2a0608'); ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.translate(P.hinge[0], P.hinge[1]); ctx.rotate(p.jaw);
  teeth(P.jtop, [36, 52, 68, 84, 100, 116, 132, 148, 160], false, [60, 148]);
  part(P.jaw, ['#5a1c1a', '#2a0a0e'], lights);
  ctx.restore();
  teeth(P.lip.slice().reverse(), [20, 34, 48, 62, 76, 90, 104, 118, 132, 146, 158], true, [44, 140]);
  part(P.head, skin, lights);
  part(P.frill, ['#a8442c', '#4a1612'], lights, false);
  part(P.brow, ['#6a2420', '#2a0a0e'], lights);
  part(P.hornA, ['#efe2c4', '#7a6a50', 'rgba(170,190,255,.35)', 'rgba(255,140,60,.25)'], []);
  const [ex, ey] = P.eye, gl = .35 + p.eye * .65;
  g = ctx.createRadialGradient(ex, ey, 2, ex, ey, 46); g.addColorStop(0, `rgba(255,200,80,${.65 * gl})`); g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(ex - 46, ey - 46, 92, 92);
  if (p.flare) { g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 90); g.addColorStop(0, 'rgba(255,255,220,.95)'); g.addColorStop(.25, 'rgba(255,220,120,.6)'); g.addColorStop(1, 'rgba(255,160,40,0)'); ctx.fillStyle = g; ctx.fillRect(ex - 90, ey - 90, 180, 180); }
  ctx.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.translate(ex, ey); ctx.rotate(.18);
  ctx.beginPath(); ctx.ellipse(0, 0, 15, 7 * (1 - p.blink) + .5, 0, 0, Math.PI * 2);
  g = ctx.createRadialGradient(-3, -2, 1, 0, 0, 15); g.addColorStop(0, '#fff6b0'); g.addColorStop(.5, '#ffb52a'); g.addColorStop(1, '#b4400e'); ctx.fillStyle = g; ctx.fill();
  if (p.blink < .7) { ctx.fillStyle = '#140608'; ctx.beginPath(); ctx.ellipse(3 + p.look * 4, 0, 2.2, 6 * (1 - p.blink), 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = '#1a0608'; ctx.beginPath(); ctx.ellipse(P.nostril[0], P.nostril[1], 6, 3, -.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  }
  // his hoard
  ctx.save(); ctx.translate(0, hy);
  g = ctx.createRadialGradient(80, 10, 10, 80, 20, 190); g.addColorStop(0, '#ffdc7a'); g.addColorStop(.5, '#c98a2a'); g.addColorStop(1, '#4a2a10');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(80, 28, 190, 64, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
  for (const c of COINS) { ctx.fillStyle = c.t > .5 ? '#f2c14e' : '#d9a23c'; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.s, c.s * .45, c.t * .6 - .3, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(90,50,10,.6)'; ctx.lineWidth = 1; ctx.stroke();
    if (Math.sin(time * 2 + c.t * 40) > .93) { ctx.fillStyle = '#fff8d8'; ctx.beginPath(); ctx.arc(c.x - 1, c.y - 1, 1.8, 0, 7); ctx.fill(); } }
  ctx.restore();
  // embers and smoke
  if (Math.random() < dt * (6 + p.heat * 30)) embers.push({ x: 80 + Math.random() * 120, y: hy + Math.random() * 20, vx: (Math.random() - .4) * 14, vy: -20 - Math.random() * 40, life: 1 });
  if (p.jaw > .18 && Math.random() < dt * p.heat * 40) embers.push({ x: HX + 60 + Math.random() * 100, y: HY + 20, vx: 20 + Math.random() * 30, vy: -30 - Math.random() * 30, life: .8 });
  if (Math.random() < dt * 2.2) smoke.push({ x: art.ok ? art.nose[0] : HX + P.nostril[0], y: art.ok ? art.nose[1] : HY + P.nostril[1], vx: 10 + Math.random() * 8, vy: -14 - Math.random() * 6, r: 6, life: 1 });
  for (const e of embers) { e.x += e.vx * dt; e.y += e.vy * dt; e.vx += Math.sin(e.y * .05) * 6 * dt; e.life -= dt * .35; }
  for (const s of smoke) { s.x += s.vx * dt; s.y += s.vy * dt; s.r += dt * 10; s.life -= dt * .5; }
  while (embers.length && (embers[0].life <= 0 || embers.length > 160)) embers.shift();
  while (smoke.length && smoke[0].life <= 0) smoke.shift();
  for (const s of smoke) { g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r); g.addColorStop(0, `rgba(120,110,120,${.25 * s.life})`); g.addColorStop(1, 'rgba(120,110,120,0)'); ctx.fillStyle = g; ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2); }
  ctx.globalCompositeOperation = 'lighter';
  for (const e of embers) { ctx.fillStyle = `rgba(255,${150 + e.life * 80 | 0},60,${e.life})`; ctx.fillRect(e.x, e.y, 2.2, 2.2); }
  ctx.globalCompositeOperation = 'source-over';
  g = ctx.createRadialGradient(BW / 2, H / 2, 200, BW / 2, H / 2, 560); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.6)'); ctx.fillStyle = g; ctx.fillRect(0, 0, BW, H);
}

/* ---------- the loop ---------- */
let blinkT = 2, blink = 0, lastQuarter = null, lastRefresh = 0;
function loop(ts) {
  raf = 0;
  if (!root?.isConnected || document.hidden) return; // starts again on the next mount
  const dt = Math.min(.05, (ts - last) / 1000 || .016); last = ts;
  if (ts - lastRefresh > 5000) { lastRefresh = ts; refresh(); }
  const live = view === today() && !R.closed, m = nowF();
  let danger = 0;
  if (live) for (const q of R.Qs) if (q.st === 'open' || q.st === 'jaws') danger = Math.max(danger, Math.min(1, Math.max(0, 1 - (q.e - m) / 110)));
  // the crank: every quarter hour the column clunks up a notch
  const qtr = Math.floor(m / 15);
  if (live && lastQuarter != null && qtr !== lastQuarter && !reduce) { crank = 5; sfx.tick?.(); }
  lastQuarter = qtr; crank *= .85;
  snapT = Math.max(0, snapT - dt * 3); flinch = Math.max(0, flinch - dt * 2); cough = Math.max(0, cough - dt * .8);
  const glow = hitTick(ts);
  blinkT -= dt; if (blinkT < 0) { blink = 1; blinkT = 2.5 + Math.random() * 3; } blink = Math.max(0, blink - dt * 6);
  const time = ts / 1000, v = !live && view <= today() ? R.verdict : null;
  const open = .06 + danger * .36 + Math.sin(time * 1.4) * .025;
  pose = {
    jaw: cough > 0 ? Math.max(open, Math.sin((1 - cough) * Math.PI) * .55) : snapT > .6 ? 0 : v === 'stuffed' ? .22 : v === 'starves' ? 0 : open * (1 - snapT * .8), heat: v ? (v === 'stuffed' ? .4 : 0) : danger,
    eye: glow ? 1 : v === 'starves' ? 0 : danger, flare: glow, look: danger, lean: v === 'driven' ? -24 : danger * 8 - flinch * 14 + Math.sin(cough * Math.PI) * 16, bob: Math.sin(time * .9) * 3 + (v === 'starves' ? 26 : 0),
    tilt: danger * .05 - (snapT > .6 ? .06 : 0) + (v === 'starves' ? .16 : 0) - flinch * .05, flicker: .8 + .12 * Math.sin(time * 9.3) + .08 * Math.sin(time * 23.7 + 1),
    blink: v === 'starves' ? .8 : blink > .5 ? 1 : blink * 2
  };
  place(false);
  draw(pose, time, dt);
  raf = requestAnimationFrame(loop);
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden && root?.isConnected && !raf) { last = performance.now(); refresh(); raf = requestAnimationFrame(loop); } });
