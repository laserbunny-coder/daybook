// Routine setup for Quest: say what your ideal day looks like, Claude drafts it as habits,
// you fix the draft, and it's saved as repeating tasks (which Quest scores every day).
// It lives in its own sheet over the app, so the plan redrawing underneath never touches what you're typing.
import * as store from './store.js';
import { gold } from './quest.js';
import { add, esc, today } from './util.js';

let client = null, onDone = () => {};
const el = document.createElement('div'); el.className = 'rt-sheet'; el.hidden = true; document.body.appendChild(el);
let R = { step: 'ask', text: '', reply: '', rows: [], busy: false, err: '' };
const LENS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180];
const REP = { day: 'Every day', weekday: 'Weekdays', weekend: 'Weekends' };
const RULE = { day: { every: 'day' }, weekday: { every: 'weekday' }, weekend: { every: 'week', days: [0, 6], interval: 1 } };
const hm = m => m == null ? '' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const unhm = v => { const x = /^(\d{1,2}):(\d{2})$/.exec(v || ''); return x ? +x[1] * 60 + +x[2] : null; };

export function init(o) { if ('client' in o) client = o.client; if (o.done) onDone = o.done; }
/** The habits already set up: repeating tasks that are still going. */
export const habits = () => store.all().filter(n => n.r && !(n.r.until && n.r.until < today()));
export function open() { R = { step: 'ask', text: R.text, reply: '', rows: [], busy: false, err: '' }; el.hidden = false; draw(); setTimeout(() => el.querySelector('textarea')?.focus(), 50); }
function close() { el.hidden = true; }

function draw() {
  const have = habits();
  const perDay = rows => rows.filter(r => r.repeat !== 'weekend').reduce((a, r) => a + gold(r.m), 0);
  const body = R.step === 'ask' ? `
    <p class="rt-lede">Tell Claude about your ideal day: when you get up, the habits you want, when you work best, how you wind down. Claude drafts it as habits, and you can change anything before it's saved.</p>
    ${have.length ? `<p class="rt-have">You already have ${have.length} habit${have.length > 1 ? 's' : ''}: ${esc(have.slice(0, 6).map(n => n.t).join(', '))}${have.length > 6 ? '…' : ''}. Claude adds to these.</p>` : ''}
    <textarea id="rt-text" rows="7" placeholder="Up at 6:30, glass of water and no phone for the first half hour. Workout at 7 most weekdays. Coffee and plan the day at 8, then 90 minutes of editing. A walk after lunch. Shut down at 5:30 and read before bed.">${esc(R.text)}</textarea>
    ${R.err ? `<p class="rt-err">${esc(R.err)}</p>` : ''}
    <div class="rt-acts"><button class="rt-go" data-rt="draft"${R.busy ? ' disabled' : ''}>${R.busy ? 'Claude is drafting…' : 'Draft my routine'}</button></div>`
  : `
    ${R.reply ? `<p class="rt-lede">${esc(R.reply)}</p>` : ''}
    <div class="rt-rows">${R.rows.map((r, i) => `<div class="rt-row" data-i="${i}">
      <input type="time" value="${hm(r.s)}" data-f="s" aria-label="Time">
      <input value="${esc(r.t)}" data-f="t" aria-label="Habit" placeholder="Habit">
      <select data-f="m" aria-label="Length">${LENS.map(m => `<option value="${m}"${m === r.m ? ' selected' : ''}>${m < 60 ? m + 'm' : m / 60 + 'h'}</option>`).join('')}</select>
      <select data-f="repeat" aria-label="Days">${Object.entries(REP).map(([k, v]) => `<option value="${k}"${k === r.repeat ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <span class="rt-g">${gold(r.m)}</span>
      <button class="rt-x" data-rt="drop" data-i="${i}" aria-label="Remove ${esc(r.t)}">×</button></div>`).join('')}</div>
    <button class="rt-add" data-rt="add">+ Add a habit</button>
    <p class="rt-sum">This routine puts <b>${perDay(R.rows)} gold</b> on the table each weekday. Add a few big tasks each morning on top.</p>
    <div class="rt-acts"><button class="rt-back" data-rt="back">Back</button><button class="rt-go" data-rt="save"${R.rows.some(r => r.t.trim()) ? '' : ' disabled'}>Save ${R.rows.filter(r => r.t.trim()).length} habits</button></div>`;
  el.innerHTML = `<div class="rt-bg" data-rt="close"></div><div class="rt-card" role="dialog" aria-label="Set up your routine">
    <div class="rt-top"><b>Your routine</b><button class="rt-x" data-rt="close" aria-label="Close">×</button></div>${body}</div>`;
}

async function draft() {
  R.text = el.querySelector('#rt-text')?.value.trim() || ''; if (!R.text) { R.err = 'Write a few lines about your day first.'; draw(); return; }
  R.busy = true; R.err = ''; draw();
  const areas = store.areas().map(a => ({ id: a.id, name: a.t }));
  const existing = habits().map(n => ({ title: n.t, start: hm(n.s) || 'any time', minutes: n.m }));
  let out = null;
  if (!client) out = sample(); // trying it out without signing in
  else {
    const { data, error } = await client.functions.invoke('routine', { body: { text: R.text, existing, areas } });
    if (error || !data?.habits) { let m = "Couldn't reach Claude. Check your connection and try again."; try { const b = await error?.context?.json?.(); if (b?.error) m = b.error; } catch { /* keep */ } R.busy = false; R.err = m; draw(); return; }
    out = data;
  }
  R.busy = false; R.step = 'edit'; R.reply = out.reply;
  R.rows = out.habits.map(h => ({ t: h.title, s: h.start_min, m: LENS.reduce((a, x) => Math.abs(x - h.duration_min) < Math.abs(a - h.duration_min) ? x : a, 30), repeat: h.repeat, ar: areas.some(a => a.id === h.area_id) ? h.area_id : null }))
    .sort((a, b) => (a.s ?? 1e4) - (b.s ?? 1e4));
  draw();
}
const sample = () => ({ reply: 'Here is a sample routine, since Claude needs you to be signed in. Change anything you like.', habits: [
  { title: 'Water, no phone', start_min: 390, duration_min: 15, repeat: 'day', area_id: null }, { title: 'Workout', start_min: 420, duration_min: 45, repeat: 'weekday', area_id: null },
  { title: 'Coffee and plan the day', start_min: 480, duration_min: 15, repeat: 'weekday', area_id: null }, { title: 'Deep work', start_min: 510, duration_min: 90, repeat: 'weekday', area_id: null },
  { title: 'Walk outside', start_min: 750, duration_min: 30, repeat: 'day', area_id: null }, { title: 'Read 20 pages', start_min: 1290, duration_min: 30, repeat: 'day', area_id: null }] });

function save() {
  const home = store.areas().find(a => /personal/i.test(a.t))?.id || null, T = today();
  const rows = R.rows.filter(r => r.t.trim());
  // A habit whose time has already gone by today starts tomorrow, so the dragon doesn't take it the moment it's made
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  rows.forEach((r, i) => store.create({ t: r.t.trim(), d: r.s != null && r.s + r.m <= now ? add(T, 1) : T, s: r.s, m: r.m, r: { ...RULE[r.repeat] }, ar: r.ar || home, o: Date.now() / 1000 + i }));
  close(); onDone(rows.length);
}

el.addEventListener('click', e => {
  const b = e.target.closest('[data-rt]'); if (!b) return;
  const a = b.dataset.rt;
  if (a === 'close') close();
  else if (a === 'draft') draft();
  else if (a === 'back') { R.step = 'ask'; draw(); }
  else if (a === 'add') { R.rows.push({ t: '', s: null, m: 30, repeat: 'day', ar: null }); draw(); el.querySelector('.rt-row:last-child [data-f="t"]')?.focus(); }
  else if (a === 'drop') { R.rows.splice(+b.dataset.i, 1); draw(); }
  else if (a === 'save') save();
});
el.addEventListener('change', e => {
  const f = e.target.dataset?.f, row = e.target.closest('.rt-row'); if (!f || !row) return;
  const r = R.rows[+row.dataset.i];
  if (f === 's') { r.s = unhm(e.target.value); R.rows.sort((a, b) => (a.s ?? 1e4) - (b.s ?? 1e4)); draw(); }
  else if (f === 'm') { r.m = +e.target.value; draw(); }
  else if (f === 'repeat') { r.repeat = e.target.value; draw(); }
});
el.addEventListener('input', e => { const row = e.target.closest('.rt-row'); if (row && e.target.dataset.f === 't') R.rows[+row.dataset.i].t = e.target.value; if (e.target.id === 'rt-text') R.text = e.target.value; });
addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) { e.stopPropagation(); close(); } }, true);
