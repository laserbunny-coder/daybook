// The Fight: Task Dragon's home screen (rules in dragon.js). The close-up dragon on the left, your day in order on the
// right, scrolling up into his jaws: steady, with a little crank every quarter hour. The red NOW line sits at his mouth.
// Quests past it shake in his jaws until CHOMP. Finishing one flips its card and sends its coins to your purse.
// The screen is one element kept across renders, so the dragon keeps breathing while the rest of the app redraws.
// Your hand of power cards sits at the bottom: tap one, then the quest (or two) it works on. Quests 2+ hours out
// move freely with their arrows; closer than that they're locked, and only a card can move them.
// The dragon is painted in code for now; the painted-parts rig for real artwork plugs in where draw() is.
import * as dragon from './dragon.js';
import * as sfx from './sfx.js';
import * as store from './store.js';
import { colorOf } from './tree.js';
import { esc, fmtT, lsGet, lsSet, today, nowMin, add, pd, DAYL, MON } from './util.js';

const NOW_Y = 250, PPM = 1.1, GAP = 56, BW = 390;
const NAME = 'Gristlemaw';
let client = null, onUpdate = () => {};
let root = null, cv = null, ctx = null, el = {}, view = null, S = null, R = null, LH = 760, k = 1, raf = 0, last = 0, seen = null, pose = null;
const cards = new Map(); // quest id -> { el, y }
const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export function init(o) { client = o.client ?? client; onUpdate = o.update ?? onUpdate; }

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
    <div class="td-lane" aria-label="Your quests, in order"></div>
    <div class="td-now"><span></span></div>
    <button class="td-say" data-td="poke"><small>${NAME.toUpperCase()}</small><span></span></button>
    <div class="td-banner" hidden></div>
    <div class="td-foot"><div class="td-belly"></div><div class="td-aim" hidden></div><div class="td-hand"></div></div>
    <div class="td-verdict" hidden></div>
    <div class="td-flash"></div></div>`;
  const $ = s => root.querySelector(s);
  el = { stage: $('.td-stage'), lane: $('.td-lane'), now: $('.td-now span'), nowLine: $('.td-now'), rnd: $('.td-rnd'), purse: $('.td-purse b'), say: $('.td-say span'), banner: $('.td-banner'), belly: $('.td-belly'), rounds: $('.td-rounds'), hand: $('.td-hand'), aim: $('.td-aim'), verdict: $('.td-verdict'), flash: $('.td-flash') };
  cv = $('.td-cv'); ctx = cv.getContext('2d');
  // while a card is picked, tapping a quest plays it there instead of opening or finishing it
  root.addEventListener('click', e => {
    if (!aim) return; const q = e.target.closest('.td-q'); if (!q || !q.dataset.id) return;
    e.preventDefault(); e.stopPropagation(); target(q.dataset.id);
  }, true);
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-td]'); if (!b) return;
    if (b.dataset.td === 'poke') { poke(); }
    else if (b.dataset.td === 'card') pickCard(b.dataset.c);
    else if (b.dataset.td === 'aim-x') { aim = null; hand(); }
    else if (b.dataset.td === 'up' || b.dataset.td === 'down') nudge(b.dataset.id, b.dataset.td === 'up' ? -1 : 1);
    else if (b.dataset.td === 'verdict-x') { lsSet(SEEN, { ...lsGet(SEEN, {}), [view]: 1 }); refresh(); }
    else if (b.dataset.td === 'verdict') { const v = lsGet(SEEN, {}); delete v[view]; lsSet(SEEN, v); refresh(); }
  });
  addEventListener('resize', () => { if (root?.isConnected) fit(); });
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
    R.R.forEach((x, i) => { if (seen.r[i] === 'open' && x.res !== 'open') roundOver(x); });
  }
  seen = { q: st, r: R.R.map(x => x.res) };
  hud(); lane(); foot(); verdict(); say();
}
function hud() {
  const live = view === today(), r = R.R.find(x => x.live) || R.R[R.R.length - 1];
  el.purse.textContent = S.gold;
  if (view > today()) el.rnd.innerHTML = `<b>${view === add(today(), 1) ? 'Tomorrow' : DAYL[pd(view).getDay()]}</b><span>${R.Qs.length} quests · ${R.total} gold on the table</span>`;
  else if (!live || R.closed) el.rnd.innerHTML = `<b>${live ? 'Today' : DAYL[pd(view).getDay()] + ' ' + MON[pd(view).getMonth()] + ' ' + pd(view).getDate()}</b><span>${R.you} kept · ${R.him} eaten</span>`;
  else { const sw = R.swoops.find(x => !x.past);
    el.rnd.innerHTML = `<b>${r.name} round</b><span>${r.total ? `${r.kept} of ${r.total} kept · need ${r.need}` : 'Nothing due this round'}</span>${sw ? `<span class="td-sw">Swoops at ${fmtT(sw.t)} on the richest in his jaws</span>` : ''}`; }
  el.nowLine.hidden = !live || R.closed;
  el.rounds.innerHTML = R.R.map(x => `<i class="td-pip ${x.res}${x.live && live && !R.closed ? ' live' : ''}" title="${x.name}: ${x.res === 'none' ? 'no contest' : `${x.kept} of ${x.total}`}"></i>`).join('');
}
/** The quests still in play, positioned by when they reach his jaws, never closer than one card apart. */
function lane() {
  const live = view === today() && !R.closed;
  const L = R.Qs.filter(q => view > today() || (live && (q.st === 'open' || q.st === 'jaws')));
  const keep = new Set(L.map(q => q.n.id));
  for (const [id, c] of cards) if (!keep.has(id) && !c.leaving) { c.el.remove(); cards.delete(id); }
  for (const q of L) {
    let c = cards.get(q.n.id);
    if (!c) { const b = document.createElement('div'); b.className = 'td-q'; el.lane.appendChild(b); c = { el: b, y: null }; cards.set(q.n.id, c); }
    c.q = q;
    const habit = !!q.n.rs, nt = esc(q.n.t || 'Untitled');
    const when = q.st === 'jaws' ? `<em>In his jaws</em>` : q.soft ? `by ${fmtT(q.e)}` : fmtT(q.s0);
    const tag = q.mark ? '<i class="td-tag mk">His mark · ×2</i>' : q.shield ? '<i class="td-tag sh">Shielded</i>' : q.bet ? '<i class="td-tag bt">Bet</i>' : q.left ? '<i class="td-tag">Leftover · half</i>' : habit && q.run ? `<i class="td-tag">↻ ${q.run} day${q.run === 1 ? '' : 's'}</i>` : '';
    const free = live && q.e - nowMin() >= FREE, lock = live && !free ? LOCK : '';
    const arrows = free ? `<span class="td-mv"><button data-td="up" data-id="${q.n.id}" aria-label="Move ${nt} earlier">▲</button><button data-td="down" data-id="${q.n.id}" aria-label="Move ${nt} later">▼</button></span>` : '';
    const h = `<button class="td-ck" data-act="toggle" data-id="${q.n.id}" aria-label="Finish ${nt}"></button><button class="td-n" data-act="open" data-id="${q.n.id}"><span class="td-r1"><span class="td-tm">${lock}${when}</span>${tag}</span><b>${habit ? '↻ ' : ''}${nt}</b></button><span class="td-g"><i></i>${q.g}</span>${arrows}`;
    if (c.h !== h) { c.el.innerHTML = h; c.h = h; }
    c.el.dataset.id = q.n.id;
    c.el.className = `td-q${aim ? ' aimable' : ''}${q.mark ? ' marked' : ''}${q.shield ? ' shielded' : ''}${q.st === 'jaws' ? ' jaws' : ''}${habit ? ' habit' : ''}${q.foil?.n ? ' foil-' + q.foil.n : ''}${q.left ? ' left' : ''}`;
    c.el.style.setProperty('--c', colorOf(q.n) || 'transparent');
  }
  place(true);
}
function targets() {
  const live = view === today(), m = live ? nowF() : null, base = view > today() ? Math.min(...R.Qs.map(q => q.e), 24 * 60) : m;
  const L = [...cards.values()].filter(c => !c.leaving).sort((a, b) => a.q.e - b.q.e || a.q.s0 - b.q.s0);
  let prev = -1e9;
  for (const c of L) {
    const q = c.q;
    let y = q.st === 'jaws' ? NOW_Y - 16 - Math.min(1, (m - q.e) / Math.max(1, q.by - q.e)) * 34 : NOW_Y + (q.e - base) * PPM + GAP / 2;
    y = Math.max(y, prev + GAP); prev = y; c.ty = y;
  }
  return L;
}
let crank = 0;
function place(snap) {
  for (const c of targets()) {
    if (c.y == null || snap && Math.abs(c.y - c.ty) > 300) c.y = c.ty;
    c.y += (c.ty - c.y) * (snap ? 1 : 0.12);
    const sh = c.q.st === 'jaws' && !reduce ? (Math.random() - 0.5) * 3 : 0;
    c.el.style.transform = `translate(${sh}px,${(c.y - 25 + crank).toFixed(1)}px)`;
  }
}
function foot() {
  const live = view === today();
  const eaten = live || view < today() ? R.Qs.filter(q => q.st === 'eaten') : [];
  el.belly.innerHTML = eaten.length ? `<span class="td-bl">In his belly</span>${eaten.map(q => `<span class="td-bone"><button class="td-ck" data-act="toggle" data-id="${q.n.id}" aria-label="Finish ${esc(q.n.t)} to win half back"></button><button class="td-n" data-act="open" data-id="${q.n.id}">${esc(q.n.t || 'Untitled')}</button><em>½ ${Math.ceil(q.g / 2)}</em></span>`).join('')}` : '';
  hand();
}
/* ---------- your hand ---------- */
const FREE = 120;
const LOCK = '<svg class="td-lock" viewBox="0 0 10 12" aria-label="Locked: only a card moves it"><path d="M2.5 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="5" width="8" height="6.5" rx="1.2" fill="currentColor"/></svg>';
let aim = null; // { c, ids: [] } while a card waits for its quest(s)
const AIM_TXT = { shield: 'Tap the quest to shield', swap: 'Tap the first quest to swap', back: 'Tap the quest to send back', split: 'Tap the big quest to split' };
function hand() {
  const live = view === today() && !R.closed;
  if (!live) { el.hand.innerHTML = ''; el.aim.hidden = true; return; }
  const n = R.hand.length;
  el.hand.innerHTML = R.hand.map((c, i) => { const off = i - (n - 1) / 2, sel = aim?.c === c.c;
    return `<button class="td-card${c.used ? ' used' : ''}${sel ? ' sel' : ''}" data-td="card" data-c="${c.c}" style="--off:${off}" aria-pressed="${sel}"${c.used ? ' disabled' : ''}><b>${c.n}</b><span>${c.t}</span></button>`; }).join('');
  el.aim.hidden = !aim;
  if (aim) el.aim.innerHTML = `<span>${aim.c === 'swap' && aim.ids.length ? 'Now tap the quest to trade with' : AIM_TXT[aim.c]}</span><button data-td="aim-x">Cancel</button>`;
  for (const c of cards.values()) c.el.classList.toggle('aimable', !!aim);
}
function pickCard(c) {
  const card = R.hand.find(h => h.c === c); if (!card || card.used) return;
  if (aim?.c === c) { aim = null; hand(); return; }
  if (!card.aim) { if (dragon.play(c, [], { deal: R.Qs })) played(card); return; }
  aim = { c, ids: [] }; hand();
}
function target(id) {
  const card = R.hand.find(h => h.c === aim.c); if (!card) { aim = null; return; }
  if (!aim.ids.includes(id)) aim.ids.push(id);
  if (aim.ids.length < card.aim) { hand(); return; }
  const ok = dragon.play(aim.c, aim.ids, { deal: R.Qs }); aim = null;
  if (ok) played(card); else { hand(); show('That card won\'t work there.'); }
}
function played(card) {
  happened.push(`played ${card.n}`); sfx.coin(); flinch = .8;
  el.banner.hidden = false; el.banner.className = 'td-banner card'; el.banner.innerHTML = `<b>${card.n}</b><span>${card.t}</span>`;
  clearTimeout(roundOver.t); roundOver.t = setTimeout(() => { el.banner.hidden = true; }, 2600);
  refresh(); line(true);
}
/** The free move: a quest 2+ hours out trades places with its neighbour, if that one is free to move too. */
function nudge(id, dir) {
  const L = targets(), i = L.findIndex(c => c.q.n.id === id), j = i + dir; if (i < 0 || j < 0 || j >= L.length) return;
  const a = L[i].q, b = L[j].q; if (b.e - nowMin() < FREE) { show('That one is too close to move for free. Use Swap.'); return; }
  store.updateMany([[a.n.id, { s: b.s, ds: dragon.orderOf(b.n) }], [b.n.id, { s: a.s, ds: dragon.orderOf(a.n) }]]);
}
const VERDICT = {
  starves: ['He starves', 'Every round, every coin. He curls up on an empty hoard, whimpering.'],
  driven: ['You drove him off', 'He sulks back to his cave with scraps. The day is yours.'],
  stuffed: ['He\'s stuffed', 'He rolls onto his back, burping up your quest names. Rematch at dawn.'],
  rest: ['A quiet day', 'No quests, no gold. He napped on his hoard.']
};
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
    ${live ? `<p class="td-bye">Phone down. See you at dawn.</p>` : ''}<button class="td-btn" data-td="verdict-x">${live ? 'Good night' : 'Close'}</button></div>`;
}

/* ---------- moments ---------- */
let snapT = 0, flinch = 0, happened = [];
function saved(q) {
  const c = cards.get(q.n.id); flinch = 1; happened.push(`${q.st === 'late' ? 'chased down half of' : 'kept'}: ${q.n.t}`);
  sfx[q.st === 'late' ? 'chase' : 'coin']();
  if (c) {
    c.leaving = true; c.el.classList.add('saved');
    const y = c.y; c.el.innerHTML = `<span class="td-gold"><i></i>+${q.you}</span>`;
    coins(300, y, 330, 22, Math.min(12, 3 + q.you / 3 | 0));
    setTimeout(() => { c.el.remove(); cards.delete(q.n.id); }, 900);
  }
  line(true);
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
    game: 'task_dragon', you_are: NAME, time: fmtT(m), round: r.name, round_gold: r.total, round_kept_so_far: r.kept, round_need_to_win: r.need,
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
  // the dragon
  ctx.save(); ctx.translate(HX + p.lean, HY + p.bob); ctx.rotate(p.tilt);
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
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(ex - 46, ey - 46, 92, 92); ctx.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.translate(ex, ey); ctx.rotate(.18);
  ctx.beginPath(); ctx.ellipse(0, 0, 15, 7 * (1 - p.blink) + .5, 0, 0, Math.PI * 2);
  g = ctx.createRadialGradient(-3, -2, 1, 0, 0, 15); g.addColorStop(0, '#fff6b0'); g.addColorStop(.5, '#ffb52a'); g.addColorStop(1, '#b4400e'); ctx.fillStyle = g; ctx.fill();
  if (p.blink < .7) { ctx.fillStyle = '#140608'; ctx.beginPath(); ctx.ellipse(3 + p.look * 4, 0, 2.2, 6 * (1 - p.blink), 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = '#1a0608'; ctx.beginPath(); ctx.ellipse(P.nostril[0], P.nostril[1], 6, 3, -.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
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
  if (Math.random() < dt * 2.2) smoke.push({ x: HX + P.nostril[0], y: HY + P.nostril[1], vx: 10 + Math.random() * 8, vy: -14 - Math.random() * 6, r: 6, life: 1 });
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
  snapT = Math.max(0, snapT - dt * 3); flinch = Math.max(0, flinch - dt * 2);
  blinkT -= dt; if (blinkT < 0) { blink = 1; blinkT = 2.5 + Math.random() * 3; } blink = Math.max(0, blink - dt * 6);
  const time = ts / 1000, v = !live && view <= today() ? R.verdict : null;
  const open = .06 + danger * .36 + Math.sin(time * 1.4) * .025;
  pose = {
    jaw: snapT > .6 ? 0 : v === 'stuffed' ? .22 : v === 'starves' ? 0 : open * (1 - snapT * .8), heat: v ? (v === 'stuffed' ? .4 : 0) : danger,
    eye: v === 'starves' ? 0 : danger, look: danger, lean: v === 'driven' ? -24 : danger * 8 - flinch * 14, bob: Math.sin(time * .9) * 3 + (v === 'starves' ? 26 : 0),
    tilt: danger * .05 - (snapT > .6 ? .06 : 0) + (v === 'starves' ? .16 : 0) - flinch * .05, flicker: .8 + .12 * Math.sin(time * 9.3) + .08 * Math.sin(time * 23.7 + 1),
    blink: v === 'starves' ? .8 : blink > .5 ? 1 : blink * 2
  };
  place(false);
  draw(pose, time, dt);
  raf = requestAnimationFrame(loop);
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden && root?.isConnected && !raf) { last = performance.now(); refresh(); raf = requestAnimationFrame(loop); } });
