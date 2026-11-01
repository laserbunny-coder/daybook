// "How long did it take?": right after something is checked off, a small sheet at the bottom offers
// a few lengths built around the plan. One tap saves and the sheet stays a moment with −5 / +5 to
// nudge it. Left alone it slips away and the plan stands, marked guessed, as before.
// When a timer ran, the sheet starts from what it recorded and only offers quick corrections
// (+5 / +10 / +15 for a timer started late, −5 / −10 for one stopped late).
// The answer is real time marked est (see track.setTook): it counts in areas, Stats and Pace.
import * as store from './store.js';
import * as track from './track.js';
import { esc, fmtDur } from './util.js';

const LADDER = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480];
/** The lengths to offer for a plan of p minutes: a spread below it, the plan, and a step or two above. */
export function picks(p) {
  p = Math.max(5, Math.min(480, Math.round(p || 30)));
  const lo = LADDER.filter(v => v < p && v >= Math.max(5, p / 10)).slice(-6), hi = LADDER.filter(v => v > p);
  return [...lo, p, ...hi.slice(0, lo.length >= 4 ? 1 : 2)];
}
/** The chips, for this sheet and for the Fix guessed times list in Stats. act names the click. */
export function chipsHTML(id, p, act, on = null) {
  p = Math.max(5, Math.min(480, Math.round(p || 30))); // the plan's chip has an outline
  return picks(p).map(v => `<button class="tk-c${v === p ? ' plan' : ''}${v === on ? ' on' : ''}" data-act="${act}" data-id="${esc(id)}" data-m="${v}">${fmtDur(v)}</button>`).join('');
}

let el = null, T = null, cur = null, onHide = null;
const WAIT = 12000, AFTER = 4500;
function mount() {
  if (el) return el;
  el = document.createElement('div'); el.className = 'took'; el.id = 'took'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'How long did it take?');
  document.body.appendChild(el);
  el.addEventListener('click', click);
  // While a finger or the mouse is on it, it stays
  el.addEventListener('pointerenter', () => clearTimeout(T));
  el.addEventListener('pointerleave', () => later(cur?.saved != null ? AFTER : WAIT));
  el.addEventListener('focusin', () => clearTimeout(T));
  return el;
}
function later(ms) { clearTimeout(T); T = setTimeout(hide, ms); }
export function hide() {
  clearTimeout(T); cur = null; if (!el) return;
  el.classList.remove('show'); document.body.classList.remove('took-on');
  setTimeout(() => { if (!cur && el) el.hidden = true; }, 220);
  onHide?.();
}
export const isOpen = () => !!cur;
/** Closes the sheet if it's asking about item id (it was just reopened). */
export function hideFor(id) { if (cur?.id === id) hide(); }
/** Asks how long item id took. plan: its planned (or usual) minutes. A timer that ran makes it a correction. */
export function ask(id, plan) {
  const n = store.get(id); if (!n?.done) return;
  const real = track.real(n).filter(e => !e.est), rec = real.reduce((a, e) => a + track.mins(e), 0);
  cur = { id, t: n.t || 'It', plan: Math.max(5, plan || n.m || 30), rec: rec > 0 ? rec : null, saved: null, typing: false };
  draw(); later(WAIT);
}
export function init(ctx = {}) { onHide = ctx.onHide; }
// Taken back with Undo (or reopened on the other device): nothing left to ask about
store.onChange(() => { if (cur && !store.get(cur.id)?.done) hide(); });

function draw() {
  mount(); if (!cur) return;
  const c = cur, t = esc(c.t.length > 40 ? c.t.slice(0, 39) + '…' : c.t);
  let body;
  if (c.rec != null) {
    const n = store.get(c.id), now = n ? track.real(n).filter(e => !e.est).reduce((a, e) => a + track.mins(e), 0) : c.rec;
    body = `<div class="tk-q"><b>${t}</b> done. The timer says <b>${fmtDur(Math.max(1, now))}</b>.</div>
      <div class="tk-row">${[5, 10, 15].map(v => `<button class="tk-c" data-act="tk-fix" data-m="${v}">+${v}</button>`).join('')}${[5, 10].map(v => `<button class="tk-c" data-act="tk-fix" data-m="${-v}">−${v}</button>`).join('')}</div>
      <div class="tk-bar"><span class="tk-sm">Started it late? Add it. Forgot to stop? Take it off.</span><button class="tk-b" data-act="tk-close">Looks right</button></div>`;
  } else if (c.saved != null) {
    body = `<div class="tk-q"><b>${t}</b> took <b>${fmtDur(c.saved)}</b>. Saved.</div>
      <div class="tk-row"><button class="tk-c" data-act="tk-nudge" data-m="-5">−5</button><button class="tk-c" data-act="tk-nudge" data-m="5">+5</button><button class="tk-c" data-act="tk-nudge" data-m="-15">−15</button><button class="tk-c" data-act="tk-nudge" data-m="15">+15</button><span class="tk-sp"></span><button class="tk-b q" data-act="tk-close">Done</button></div>`;
  } else if (c.typing) {
    body = `<div class="tk-q"><b>${t}</b> done. How many minutes did it take?</div>
      <form class="tk-row tk-type" data-form="took"><input id="tk-in" type="number" inputmode="numeric" min="1" max="1440" placeholder="${c.plan}" aria-label="Minutes"><span class="tk-sm">minutes</span><span class="tk-sp"></span><button class="tk-b">Save</button></form>`;
  } else {
    body = `<div class="tk-q"><b>${t}</b> done. How long did it take? <span class="tk-pl">Planned ${fmtDur(c.plan)}</span></div>
      <div class="tk-row">${chipsHTML(c.id, c.plan, 'tk-pick')}</div>
      <div class="tk-bar"><span class="tk-sm">Leave it and it counts as planned.</span><button class="tk-b q" data-act="tk-type">Type it</button><button class="tk-b q" data-act="tk-close" aria-label="Close">✕</button></div>`;
  }
  el.innerHTML = body; el.hidden = false;
  requestAnimationFrame(() => { if (!cur) return; el.classList.add('show'); document.body.classList.add('took-on'); document.body.style.setProperty('--took-h', el.offsetHeight + 'px'); });
  if (c.typing) { const f = el.querySelector('form'); f.addEventListener('submit', e => { e.preventDefault(); const v = Math.round(+f.querySelector('input').value); if (v > 0) save(Math.min(1440, v)); }); setTimeout(() => el.querySelector('#tk-in')?.focus(), 30); }
}
function save(m) {
  if (!cur) return; if (!store.get(cur.id)?.done) { hide(); return; } // undone meanwhile
  track.setTook(cur.id, m);
  cur.saved = m; cur.typing = false; draw(); later(AFTER);
}
function click(e) {
  e.stopPropagation(); // the app's own taps (opening, adding) never reach through the sheet
  const b = e.target.closest('button[data-act]'); if (!b || !cur) return;
  const m = +b.dataset.m;
  switch (b.dataset.act) {
    case 'tk-pick': save(m); break;
    case 'tk-nudge': save(Math.max(5, cur.saved + m)); break;
    case 'tk-fix': if (!store.get(cur.id)?.done) { hide(); break; } track.stretchLast(cur.id, m); draw(); later(AFTER); break;
    case 'tk-type': cur.typing = true; clearTimeout(T); draw(); break;
    case 'tk-close': hide(); break;
  }
}
