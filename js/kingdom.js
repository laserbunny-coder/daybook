// The kingdom map: every region beyond the home vale, who holds it, and the campaign under way.
// It opens in its own sheet over Quest. Marching, retreating and claiming go through quest.js.
import * as quest from './quest.js';
import { CAMPAIGN_DAYS, HOME, MARCH_AT, REGIONS, regionOf, TITLES } from './regions.js';
import { esc, fmtShort } from './util.js';

let onChange = () => {}, sel = null, askRetreat = false, anim = 0;
const el = document.createElement('div'); el.className = 'kg-sheet'; el.hidden = true; document.body.appendChild(el);
export function init(o) { if (o.changed) onChange = o.changed; }
export function open() { quest.settle(); const R = quest.realm(); sel = R.camp?.id || REGIONS.find(r => !R.held.includes(r.id))?.id || 'wood'; askRetreat = false; el.hidden = false; draw(); }
function close() { el.hidden = true; clearInterval(anim); }

/* ---------- the map, in pixels ---------- */
const W = 192, H = 112, ALL = [HOME, ...REGIONS];
const hash = (x, y) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const owner = new Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // each pixel belongs to the nearest region's heart, with ragged borders
  let best = 0, bd = 1e9;
  ALL.forEach((r, i) => { const d = (x - r.seed[0]) ** 2 + (y - r.seed[1]) ** 2 * 1.4 + (hash(x >> 3, y >> 3) - .5) * 700 + (hash(x >> 1, y >> 1) - .5) * 200; if (d < bd) { bd = d; best = i; } });
  owner[y * W + x] = best;
}
function paint(cv, R, t) {
  const c = cv.getContext('2d'), P = (col, x, y, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const si = ALL.findIndex(r => r.id === sel), held = new Set(R.held), campId = R.camp?.id;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = owner[y * W + x], r = ALL[i];
    const edge = x > 0 && y > 0 && (owner[y * W + x - 1] !== i || owner[(y - 1) * W + x] !== i);
    const fog = r.locked && R.held.length < r.locked;
    P(edge ? '#15130f' : fog ? (hash(x, y) > .7 ? '#6a6478' : '#4a4456') : hash(x, y) > .85 ? r.col[1] : r.col[0], x, y);
  }
  for (let y = 4; y < H - 4; y += 6) for (let x = 3; x < W - 4; x += 7) { // a little terrain
    const r = ALL[owner[y * W + x]], n = hash(x * 3, y * 7); if (n < .5) continue; const ox = x + Math.round(n * 3);
    if (r.id === 'wood' || r.id === 'vale') { P('#14301c', ox - 1, y - 1, 3, 2); P('#14301c', ox, y - 2); P('#4a3220', ox, y + 1); }
    else if (r.id === 'frost') { P('#e8eef4', ox, y - 2); P('#9aaabb', ox - 1, y - 1, 3, 1); P('#7d8ea0', ox - 2, y, 5, 1); }
    else if (r.id === 'storm') P('#5a7c9a', ox, y, 3, 1);
    else if (r.id === 'marsh') { P('#2a3a2a', ox, y, 2, 1); P('#6a8a50', ox + 2, y - 1); }
    else if (r.id === 'ember') P(n > .85 && t % 2 ? '#f2a33a' : '#3a1a12', ox, y, 2, 1);
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { // the chosen region glows at its border
    const i = owner[y * W + x]; if (i !== si) continue;
    if (owner[y * W + x - 1] !== i || owner[(y - 1) * W + x] !== i || owner[y * W + x + 1] !== i || owner[(y + 1) * W + x] !== i) P(t % 2 ? '#e3b663' : '#c99a3a', x, y);
  }
  const [vx, vy] = HOME.seed; // your castle
  P('#9a9ca6', vx - 5, vy - 8, 3, 8); P('#9a9ca6', vx + 2, vy - 8, 3, 8); P('#8e9098', vx - 3, vy - 5, 6, 5); P('#2a2430', vx - 1, vy - 2, 2, 2);
  P('#3a6ab8', vx - 5, vy - 9, 3, 1); P('#3a6ab8', vx + 2, vy - 9, 3, 1); P('#5b3a22', vx, vy - 14, 1, 6); P('#e3b663', vx + 1, vy - 14, 3, 2);
  for (const r of REGIONS) {
    const [x, y] = r.seed;
    if (held.has(r.id)) { P('#5b3a22', x, y - 7, 1, 7); P('#e3b663', x + 1, y - 7 + (t % 2), 4, 3); P(r.ink, x + 2, y - 6 + (t % 2), 1, 1); }
    else if (r.id === campId) { P('#5b3a22', x - 3, y - 6, 1, 6); P('#e3b663', x - 2, y - 6, 3, 2); P('#c99a3a', x - 1, y - 1, 5, 1); P('#f2a33a', x + 1, y - 3 - (t % 2), 1, 2); }
    else if (r.locked && R.held.length < r.locked) { for (let i = 0; i < 8; i++) P('rgba(220,214,230,.5)', x - 9 + i * 2 + (t % 2), y - 4 + (i % 3), 4, 2); }
    else { P('#5b3a22', x, y - 6, 1, 6); P('#d8644a', x + 1, y - 6, 3, 2); }
  }
  const r = ALL[si]; // a dragon circles the region you're looking at, unless you hold it
  if (r && r.id !== 'vale' && !held.has(r.id)) { const a = t / 3, dx = Math.round(r.seed[0] + Math.cos(a) * 9), dy = Math.round(r.seed[1] - 12 + Math.sin(a) * 3);
    P('#c4503a', dx, dy, 4, 2); P('#8a3a3a', dx + 1, dy - 2 + (t % 2) * 3, 3, 2); P('#ffe08a', dx, dy); }
}

/* ---------- the sheet ---------- */
function regionCard(R) {
  const r = regionOf(sel), held = R.held.includes(sel), C = R.camp, here = C?.id === sel;
  const fog = r.locked && R.held.length < r.locked;
  const state = held ? `<span class="kg-chip ok">Yours since ${esc(fmtShort(Q_won(sel)))}</span>` : here ? `<span class="kg-chip on">${C.begun ? `Day ${C.day} of ${CAMPAIGN_DAYS}` : 'Marching'}</span>` : fog ? '<span class="kg-chip">Hidden in cloud</span>' : `<span class="kg-chip dr">${esc(r.dragon)}</span>`;
  let act = '';
  if (held) act = `<p class="kg-note">The ${esc(r.relic)} is yours: ${esc(r.relicTxt)}</p>`;
  else if (here) act = askRetreat ? `<div class="kg-acts"><span>Retreat? The campaign ends and you'd start over next time.</span><button class="kg-btn danger" data-kg="retreat">Retreat</button><button class="kg-btn quiet" data-kg="stay">Keep fighting</button></div>`
    : `<div class="kg-acts"><button class="kg-btn quiet" data-kg="ask-retreat">Retreat from ${esc(r.name)}</button></div>`;
  else if (C) act = `<p class="kg-note">You're campaigning in ${esc(C.reg.name)}. One campaign at a time.</p>`;
  else if (fog) act = `<p class="kg-note">The clouds lift once you hold ${r.locked} regions. You hold ${R.held.length}.</p>`;
  else if (R.vault < MARCH_AT) act = `<p class="kg-note">Finish your castle to march out: ${R.vault.toLocaleString()} of ${MARCH_AT.toLocaleString()} gold in the vault.</p>`;
  else act = `<div class="kg-acts"><button class="kg-btn" data-kg="march">March on ${esc(r.name)}</button><span>The campaign begins tomorrow at dawn and lasts ${CAMPAIGN_DAYS} days.</span></div>`;
  return `<div class="kg-card"><div class="kg-card-top"><div><b>${esc(r.name)}</b>${r.why && !held ? `<small>${esc(r.why)}</small>` : ''}</div>${state}</div>
    <dl><dt>Dragon</dt><dd>${esc(r.dragon)}</dd><dt>Twist</dt><dd>${esc(r.twist)}</dd><dt>To claim it</dt><dd>${esc(r.win)}</dd><dt>Relic</dt><dd>${esc(r.relic)}: ${esc(r.relicTxt)}</dd></dl>${act}</div>`;
}
const Q_won = id => quest.kingdom().won[id];
function draw() {
  const R = quest.realm(), rank = TITLES.indexOf(R.title);
  el.innerHTML = `<div class="kg-bg" data-kg="close"></div><div class="kg-panel" role="dialog" aria-label="Your kingdom">
    <div class="kg-top"><div><small>${esc(R.title)}</small><b>Your kingdom</b></div><button class="rt-x" data-kg="close" aria-label="Close">×</button></div>
    <div class="kg-map"><canvas id="kg-map" width="${W}" height="${H}" aria-label="Map of the kingdom"></canvas><span class="kg-held">${R.held.length} of ${REGIONS.length} held</span></div>
    <div class="kg-picks">${REGIONS.map(r => `<button class="kg-pick${r.id === sel ? ' on' : ''}${R.held.includes(r.id) ? ' held' : ''}" data-kg="pick" data-id="${r.id}">${esc(r.name)}</button>`).join('')}</div>
    ${regionCard(R)}
    <div class="kg-titles">${TITLES.map((t, i) => `<span class="${i === rank ? 'cur' : i < rank ? 'past' : ''}">${esc(t)}</span>`).join('<i>›</i>')}</div>
  </div>`;
  const cv = el.querySelector('#kg-map'); let t = 0; paint(cv, R, t);
  clearInterval(anim); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) anim = setInterval(() => { if (el.hidden || !cv.isConnected) { clearInterval(anim); return; } paint(cv, R, ++t); }, 500);
  cv.addEventListener('click', e => { const b = cv.getBoundingClientRect(), x = Math.floor((e.clientX - b.left) / b.width * W), y = Math.floor((e.clientY - b.top) / b.height * H);
    const r = ALL[owner[y * W + x]]; if (r && r.id !== 'vale') { sel = r.id; askRetreat = false; draw(); } });
}
el.addEventListener('click', e => {
  const b = e.target.closest('[data-kg]'); if (!b) return;
  const a = b.dataset.kg;
  if (a === 'close') close();
  else if (a === 'pick') { sel = b.dataset.id; askRetreat = false; draw(); }
  else if (a === 'march') { if (quest.march(sel)) { draw(); onChange(`Marching on ${regionOf(sel).name}. The campaign begins tomorrow at dawn.`); } }
  else if (a === 'ask-retreat') { askRetreat = true; draw(); }
  else if (a === 'stay') { askRetreat = false; draw(); }
  else if (a === 'retreat') { quest.retreat(); askRetreat = false; draw(); onChange('You retreated. The region is still there when you want it.'); }
});
addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) { e.stopPropagation(); close(); } }, true);
