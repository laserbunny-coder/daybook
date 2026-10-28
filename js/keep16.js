// Hold the Keep's picture, seen from above like a Super Nintendo game: a 256 x 224 screen of 16px tiles with
// the keep in the middle, the village around it, the day's gold out in the field and the dragon on its crag.
// The art is the Ninja Adventure pack by Pixel-Boy and AAA (CC0), packed into js/art/keep-atlas.png (inside js/ so the publish step copies it) (keep-atlas.js says
// where each sprite sits). The dragon is the pack's green boss, recoloured red. crt.js shows it through an old TV.
import { ATLAS } from './keep-atlas.js';

export const SW = 256, SH = 224;
export const SWOOP = 34, RECKON = 44; // how long a dive and the midnight reckoning last, in ticks
export const phaseOf = m => m < 6 * 60 || m >= 21 * 60 ? 'night' : m < 8 * 60 ? 'dawn' : m < 18 * 60 ? 'day' : 'dusk';
const T = 16;
let c = null;
const P = (col, x, y, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w, h); };
const rnd = i => Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1;
const hash = (x, y) => rnd(x * 374761 + y * 668265);
const lerp = (a, b, k) => a + (b - a) * k;
const WOOD = ['#2e1c10', '#4a2e1a', '#6a4426', '#8c5e34'], FIRE = ['#7a1a08', '#c8400c', '#f07818', '#f8b838', '#fff0a0'], GOLD3 = '#fff0a0';

/* ---------- sprites, by name ---------- */
let atlas = null, pix = null, onReady = null;
function load() {
  if (atlas || typeof Image === 'undefined') return;
  atlas = new Image();
  atlas.onload = () => { const k = Object.assign(document.createElement('canvas'), { width: atlas.width, height: atlas.height }), g = k.getContext('2d'); g.drawImage(atlas, 0, 0); pix = g.getImageData(0, 0, k.width, k.height); onReady?.(); };
  atlas.src = new URL('./art/keep-atlas.png', import.meta.url).href;
}
/** Call f once the art has loaded (the first picture is blank until then). */
export const whenReady = f => { load(); if (pix) f(); else onReady = f; };
function S(n, x, y, o = {}) { // top-left at x, y; s scales, sy squashes, flip mirrors, a fades
  const r = ATLAS[n]; if (!r || !pix) return;
  const s = o.s || 1, dw = Math.round(r[2] * s), dh = Math.round(r[3] * (o.sy || s));
  if (o.a != null) c.globalAlpha = o.a;
  if (o.flip) { c.save(); c.translate(Math.round(x) + dw, Math.round(y)); c.scale(-1, 1); c.drawImage(atlas, r[0], r[1], r[2], r[3], 0, 0, dw, dh); c.restore(); }
  else c.drawImage(atlas, r[0], r[1], r[2], r[3], Math.round(x), Math.round(y), dw, dh);
  c.globalAlpha = 1;
}
const SB = (n, x, y, o = {}) => { const r = ATLAS[n]; if (r) S(n, x - r[2] * (o.s || 1) / 2, y - r[3] * (o.sy || o.s || 1), o); }; // centered on x, standing on y
const turnedCache = new Map();
function turned(n, ang) { // a sprite turned to an angle, pixel by pixel so it stays crisp
  const steps = 32, k = ((Math.round(ang / (Math.PI * 2) * steps) % steps) + steps) % steps, id = n + ':' + k;
  if (turnedCache.has(id)) return turnedCache.get(id);
  const [ax, ay, w, h] = ATLAS[n], D = Math.ceil(Math.hypot(w, h)) + 2, a = k / steps * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
  const out = Object.assign(document.createElement('canvas'), { width: D, height: D }), o = out.getContext('2d'), od = o.createImageData(D, D);
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    const dx = x - D / 2 + .5, dy = y - D / 2 + .5, sx = Math.round(dx * cs + dy * sn + w / 2 - .5), sy = Math.round(-dx * sn + dy * cs + h / 2 - .5);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const si = ((ay + sy) * pix.width + ax + sx) * 4, di = (y * D + x) * 4; for (let j = 0; j < 4; j++) od.data[di + j] = pix.data[si + j];
  }
  o.putImageData(od, 0, 0); turnedCache.set(id, out); return out;
}

/* ---------- the map: 16 x 14 tiles. A river down the left with a bridge, a road past the gate and one south, the crag top right ---------- */
const KX = 128, GATE = { x: 128, y: 144 }, LEDGE = { x: 230, y: 12 };
const isRiver = cx => cx <= 2;
const isBridge = (cx, cy) => cx <= 3 && (cy === 9 || cy === 10);
const pathTile = (cx, cy) => {
  if ((cy === 9 || cy === 10) && cx >= 4) return (cx === 7 || cx === 8) ? 'd_c' : cy === 9 ? 'd_t' : 'd_b';
  if (cy >= 11 && (cx === 7 || cx === 8)) return cx === 7 ? 'd_l' : 'd_r';
  return null;
};
const isCrag = (cx, cy) => cx >= 11 && cy <= 3;
/* where each building stands (sprite, x, base y); the keep itself grows in the middle */
const SPOT = { Tent: ['tent', 212, 112], Hut: ['hut', 150, 40], Well: ['well', 60, 98], Farm: ['hay', 84, 44], Watchtower: ['tw0_0', 60, 140], Mill: ['cabin', 60, 224], Smithy: ['smithy', 232, 224], Market: ['shop', 176, 224] };
/* where the day's piles of gold lie, in the order quests fill them */
const PILES = [[200, 160], [106, 190], [242, 130], [62, 62], [170, 172], [98, 214], [242, 174], [80, 168], [138, 178], [210, 130], [138, 212], [226, 152]]; // clear of every building, some on the roads
const pileAt = slot => PILES[slot % PILES.length];
function free(x, y, pad = 8) {
  const cx = x >> 4, cy = y >> 4;
  if (x < 0 || y < 0 || x >= SW || y >= SH) return false;
  if (isRiver(cx) || isBridge(cx, cy) || pathTile(cx, cy) || isCrag(cx, cy) || isCrag((x + pad) >> 4, (y + pad) >> 4)) return false;
  if (pathTile((x - pad) >> 4, cy) || pathTile((x + pad) >> 4, cy) || pathTile(cx, (y + pad) >> 4)) return false;
  if (x > 64 && x < 192 && y > 30 && y < 150) return false; // the keep
  if (PILES.some(([sx, sy]) => Math.abs(sx - x) < 14 && Math.abs(sy - y) < 14)) return false;
  if (Object.values(SPOT).some(([n, vx, vy]) => { const r = ATLAS[n]; return Math.abs(x - vx) < r[2] / 2 + pad && y > vy - r[3] - pad && y < vy + pad; })) return false;
  return true;
}
let ground = null;
const TREES = [];
function paintGround() {
  ground = Object.assign(document.createElement('canvas'), { width: SW, height: SH }); const keep = c; c = ground.getContext('2d');
  for (let cy = 0; cy < 14; cy++) for (let cx = 0; cx < 16; cx++) {
    const x = cx * T, y = cy * T;
    S('g' + (hash(cx, cy) < .55 ? 0 : 1 + Math.floor(hash(cy, cx) * 8)), x, y);
    if (isRiver(cx)) S(cx < 2 ? 'w_c' : 'w_r', x, y);
    if (isBridge(cx, cy)) S('br_' + (cy === 9 ? 't' : 'b') + (cx === 3 ? 'r' : ''), x, y);
    const p = pathTile(cx, cy); if (p) S(p, x, y);
    if (isCrag(cx, cy)) cy <= 1 ? S(cx === 11 ? 'pl_l' : 'pl_c', x, y) : S((cx === 11 ? 'cl_l' : 'cl_m') + (cy === 2 ? '0' : '2'), x, y);
  }
  for (let i = 0; i < 40; i++) { const x = rnd(i + 3) * 240 | 0, y = rnd(i + 77) * 208 | 0; if (free(x + 8, y + 12, 6)) S((i % 3 ? 'flower' : 'bush') + (i % 4), x, y); }
  for (let i = 0; i < 160 && TREES.length < 26; i++) { const x = 8 + rnd(i + 70) * 240 | 0, y = 20 + rnd(i + 170) * 204 | 0; if (!free(x, y, 12) || !free(x - 12, y - 20, 4) || !free(x + 12, y - 20, 4)) continue; if (TREES.some(([tx, ty]) => Math.abs(tx - x) < 18 && Math.abs(ty - y) < 14)) continue; TREES.push([x, y, i % 3 === 0 ? 'pine' : i % 3 === 1 ? 'tree' : 'treeR']); }
  TREES.push([188, 18, 'pine'], [244, 14, 'pine'], [196, 40, 'rockG'], [250, 46, 'pine'], [182, 44, 'pine']);
  c = keep;
}

/* ---------- the keep: 0 campfire, 1 wooden fort, 2 stone keep, 3 with its great hall, 4 walls and towers, 6 castle ---------- */
function stageOf(b) { return b.includes('Castle') ? 6 : b.includes('Castle walls') ? (b.includes('Great hall') ? 5 : 4) : b.includes('Stone keep') ? (b.includes('Great hall') ? 3 : 2) : b.includes('Watchtower') ? 1 : 0; }
function keepAt(stage, t, broken, held) {
  const gy = GATE.y;
  if (stage === 0) { SB('campfire', KX, gy - 6); fire(KX, gy - 18, t); return; }
  const stone = stage >= 2, L = 80, R = 176, back = stage >= 4 ? 72 : 84, piece = stone ? 'wl' : 'pal';
  for (let x = L; x < R; x += 16) S(x === L ? piece + '_l' : x === R - 16 ? piece + '_r' : piece, x, back);
  for (let y = back + 16; y < gy - 16; y += 16) { S(piece + '_v', L, y); S(piece + '_v', R - 16, y); }
  if (stage === 1) SB('frame', KX, gy - 18);
  else {
    if (stage >= 6) { SB('tw2_6', KX - 34, gy - 26); SB('tw2_6', KX + 34, gy - 26); }
    SB('stonehouse', KX, gy - 20);
    if (stage >= 3) SB(stage >= 6 ? 'tw0_9' : 'tw2_6', KX, gy - 52);
    if (stage >= 6) { SB('flag' + (t >> 1) % 4, KX + 4, gy - 80); SB('flagB' + ((t >> 1) + 2) % 4, KX - 30, gy - 56); SB('flagB' + ((t >> 1) + 1) % 4, KX + 38, gy - 56); }
  }
  // a pennant in each held region's colour flies over the castle
  held.forEach((g, i) => { const x = KX - 40 + i * 14, y = gy - 98 + (i % 2) * 4; P(WOOD[0], x, y, 1, 12); for (let k = 0; k < 6; k++) P(g.ink, x + 1 + k, y + Math.round(Math.sin(t * .9 + k * .7)), 1, 4 - (k > 3 ? 1 : 0)); });
  for (let x = L; x < R; x += 16) { if (x >= KX - 16 && x < KX + 16) continue; S(x === L ? piece + '_l' : x === R - 16 ? piece + '_r' : piece, x, gy - 16); }
  if (stage >= 4) {
    SB('arch', KX, gy + 2); gate(KX, gy - 1, broken, 14, 20);
    const tw = 'tw0_' + (broken ? 7 : 6); SB(tw, L - 2, gy + 2); SB(tw, R + 2, gy + 2);
    if (stage === 5 || stage >= 6) { S('ban1', KX - 34, gy - 30); S('ban3', KX + 26, gy - 30); }
  } else gate(KX, gy, broken, 24, 14);
  if (broken) { SB('stone', KX - 12, gy + 6); SB('stoneB', KX + 10, gy + 8); SB('smoke' + (t >> 1) % 6, KX + 2, gy - 18, { a: .8 }); }
  if (stone) { torch(KX - 22, gy - 14, t); torch(KX + 21, gy - 14, t + 1); }
}
function gate(x, y, broken, w, h) {
  const x0 = Math.round(x - w / 2), y0 = y - h;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const r = w / 2, dx = xx - r + .5; if (w < 20 && yy < r - Math.sqrt(Math.max(0, r * r - dx * dx))) continue; P(broken ? '#0a0608' : (xx % 4 === 0 ? WOOD[0] : WOOD[2 + (yy % 6 === 0 ? 1 : 0)]), x0 + xx, y0 + yy); }
  if (!broken) { P(WOOD[0], x0, y0 + 4, w, 1); P(WOOD[0], x0, y0 + h - 5, w, 1); }
  else for (const [dx, dy, l] of [[-6, 2, 7], [w - 2, 1, 6], [3, 3, 5]]) for (let i = 0; i < l; i++) P(WOOD[2], x0 + dx + i, y + dy + (i > l / 2 ? 1 : 0));
}
function fire(x, y, t) { const f = t % 3; P(FIRE[1], x - 4, y + 6, 9, 3); P(FIRE[2], x - 3 + (f === 1), y + 2, 7, 5); P(FIRE[3], x - 2, y - 1 + f % 2, 4 + (f === 2), 4); P(FIRE[4], x - 1, y + 2, 2, 2); if (t % 4 === 0) P(FIRE[3], x + (t % 7) - 3, y - 4); }
function torch(x, y, t) { P(WOOD[0], x, y, 1, 4); P(FIRE[2 + (t % 2)], x - 1, y - 2, 3, 2); P(FIRE[4], x, y - 3 + (t % 2)); }

/* village buildings; a burned one is charred, with smoke and embers */
let aside = null;
function building(name, t, ruined) {
  const [n, x, y] = SPOT[name];
  const draw = () => {
    SB(n, x, y);
    if (name === 'Mill') SB('mill' + (t >> 1) % 4, x + 2, y - 8, { s: .75 });
    if (name === 'Smithy') { const f = (t >> 1) % 6; SB('smoke' + f, x + 20, y - 46 - f * 2, { a: .7, s: .6 }); }
    if (name === 'Watchtower') SB('flag' + (t >> 1) % 4, x + 6, y - 28);
    if (name === 'Farm') { SB('sprout', x - 32, y); SB('sprout', x + 32, y); }
  };
  if (!ruined) return draw();
  aside ||= Object.assign(document.createElement('canvas'), { width: SW, height: SH });
  const o = aside.getContext('2d'), keep = c; o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, SW, SH); c = o; draw(); c = keep;
  o.globalCompositeOperation = 'source-atop'; o.fillStyle = 'rgba(22,14,12,.8)'; o.fillRect(0, 0, SW, SH); c.drawImage(aside, 0, 0);
  SB('smoke' + (t >> 1) % 6, x, y - 20, { a: .8 }); P(t % 2 ? FIRE[3] : FIRE[2], x - 6 + (t % 4), y - 2); P(FIRE[1], x + 6 - (t % 3), y - 3);
}

/* ---------- gold piles ---------- */
function pile(x, y, g, mark, t) {
  const n = Math.min(10, 3 + Math.round(g / 4)), rows = [4, 3, 2, 1]; let left = n, k = 0;
  c.fillStyle = 'rgba(8,16,8,.3)'; c.fillRect(x - 13, y - 1, 26, 3);
  for (let r = 0; r < 4 && left > 0; r++) { const m = Math.min(rows[r], left); for (let i = 0; i < m; i++) { S('coin' + (k === n - 1 && (t + x) % 12 < 4 ? (t >> 1) % 4 : 0), x - m * 3.5 + i * 7, y - 9 - r * 4); k++; } left -= m; }
  if (mark) SB('flag' + (t >> 1) % 4, x + 6, y - 9 - 4 * Math.min(3, Math.ceil(n / 4)));
}
const FONT = { '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111', z: '111001010100111' };
function text(s, x, y, col, bg) {
  const w = s.length * 4 - 1; if (bg) P(bg, x - 2, y - 2, w + 4, 9);
  [...s].forEach((ch, i) => { const g = FONT[ch]; if (g) for (let k = 0; k < 15; k++) if (g[k] === '1') P(col, x + i * 4 + k % 3, y + (k / 3 | 0)); });
}

/* ---------- the dragon: head, wings, body and tail ---------- */
function drawDragon(p, t, ds) {
  const { x, y, alt = 0, ang = Math.PI / 2, folded, carry } = p;
  const sh = 1 - Math.min(.4, alt / 140); c.fillStyle = 'rgba(6,14,6,.35)';
  for (let yy = -5; yy <= 5; yy++) { const w = Math.round(36 * ds * sh * Math.sqrt(1 - yy * yy / 30)); c.fillRect(Math.round(x + alt * .35 - w), Math.round(y + 24 * ds + alt * .9 + yy * sh), w * 2, 1); }
  // the body trails away from where it's heading, falling below the head as in the art
  let bx = -Math.cos(ang), by = -Math.sin(ang) * .6 + .9; const m = Math.hypot(bx, by) || 1; bx /= m; by /= m;
  if (folded) { bx = .3; by = .95; }
  const sp = folded ? 5 : 15, segs = [1, 2, 3].map(k => { const wig = Math.sin(t * .35 + k * 1.2) * (folded ? .5 : 2.2) * k; return [x + bx * sp * ds * k - by * wig, y + 6 * ds + by * sp * ds * k + bx * wig]; });
  const tail = turned('drBodyEnd', Math.atan2(segs[2][1] - segs[1][1], segs[2][0] - segs[1][0]) - Math.PI / 2);
  c.drawImage(tail, Math.round(segs[2][0] - tail.width * ds / 2), Math.round(segs[2][1] - tail.height * ds / 2 + 6), Math.round(tail.width * ds), Math.round(tail.height * ds));
  S('drBody2', segs[1][0] - 15 * ds, segs[1][1] - 13 * ds, { s: ds }); S('drBody1', segs[0][0] - 15 * ds, segs[0][1] - 13 * ds, { s: ds });
  const flap = folded ? .3 : .5 + .5 * Math.abs(Math.cos(t * .55)), wx = folded ? -4 : 8;
  S('drWing', x + wx * ds, y - 50 * ds * flap + 6, { s: ds, sy: ds * flap });
  S('drWing', x - wx * ds - 57 * ds, y - 50 * ds * flap + 6, { s: ds, sy: ds * flap, flip: true });
  S('drHead', x - 22 * ds, y - 30 * ds, { s: ds });
  if (carry) for (let i = 0; i < 3; i++) S('coin' + ((t + i) % 4), x - 12 + i * 8, y + 8 + (i % 2) * 2);
}
function flight(age, dur, tx, ty, hit) {
  const f = age / dur, home = [LEDGE.x, LEDGE.y];
  if (f < .42) { const k = f / .42; return { x: lerp(home[0], tx, k), y: lerp(home[1], ty, k), alt: lerp(40, 4, k * k), ang: Math.atan2(ty - home[1], tx - home[0]) }; }
  if (f < .55) return { x: tx + Math.sin(age) * 1.5, y: ty, alt: 4, ang: Math.atan2(ty - home[1], tx - home[0]), ...hit };
  const k = Math.min(1, (f - .55) / .45);
  return { x: lerp(tx, home[0], k), y: lerp(ty, home[1], k), alt: lerp(4, 40, Math.sqrt(k)) * (k > .9 ? (1 - k) * 10 : 1), ang: Math.atan2(home[1] - ty, home[0] - tx), carry: hit.carry };
}

/* ---------- villagers walking the roads ---------- */
const FOLK = [{ who: 'OldMan', a: [72, 156], b: [250, 156], sp: .5 }, { who: 'Woman', a: [128, 226], b: [128, 160], sp: .4 }, { who: 'Villager', a: [240, 156], b: [90, 156], sp: .35 }];
function folk(t, n) {
  FOLK.slice(0, n).forEach((f, i) => {
    const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]), d = (t * f.sp + i * 60) % (len * 2), k = d < len ? d / len : 2 - d / len, fwd = d < len;
    const dx = (f.b[0] - f.a[0]) * (fwd ? 1 : -1), dy = (f.b[1] - f.a[1]) * (fwd ? 1 : -1), dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 2) : (dy > 0 ? 0 : 1);
    SB(f.who + '_' + dir + '_' + ((t >> 1) % 4), lerp(f.a[0], f.b[0], k), lerp(f.a[1], f.b[1], k));
  });
}

const LAND_TINT = { wood: 'rgba(20,70,30,.22)', marsh: 'rgba(70,80,30,.25)', frost: 'rgba(200,220,255,.3)', storm: 'rgba(20,30,70,.35)', ember: 'rgba(120,30,10,.3)', spires: 'rgba(70,40,120,.3)' };
const PHASE_TINT = { night: 'rgba(10,16,52,.55)', dusk: 'rgba(80,40,90,.25)', dawn: 'rgba(255,150,80,.14)' };

/** Draw the scene: { mode: sleep|perch|circle, piles [{slot, g, mark, hot}], gate (broken), fx [{kind, age, slot, n, g}],
    land, phase, buildings, ruins, held (regions), lvl, hoard, camp, campInk } */
export function paint(cv, Sc, t) {
  load(); c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
  if (!pix) { c.fillStyle = '#1b2a14'; c.fillRect(0, 0, SW, SH); return; }
  if (!ground) paintGround();
  c.drawImage(ground, 0, 0);
  for (let i = 0; i < 14; i++) { const y = (rnd(i) * SH + t * 1.4) % SH, x = 4 + rnd(i + 40) * 30; if (!(y > 140 && y < 178)) P('#c8f0ff', x, y, 3, 1); }
  const b = Sc.buildings || [], fx = Sc.fx || [], stage = Sc.camp ? 0 : stageOf(b);
  const shown = b.filter(n => SPOT[n] && !(n === 'Tent' && b.includes('Castle walls')));
  const rk = !Sc.camp && fx.find(e => (e.kind === 'held' || e.kind === 'breach') && e.age >= 0 && e.age < RECKON);
  const broken = rk ? rk.kind === 'breach' && rk.age > RECKON * .45 : !!Sc.gate;
  const items = TREES.map(([x, y, n]) => [y, () => SB(n, x, y)]);
  shown.forEach(n => items.push([SPOT[n][2], () => building(n, t, (Sc.ruins || []).includes(n))]));
  items.push([GATE.y, () => keepAt(stage, t, broken, Sc.camp ? [] : Sc.held || [])]);
  if (Sc.camp) items.push([GATE.y - 8, () => { P(WOOD[0], KX + 18, GATE.y - 30, 1, 22); for (let k = 0; k < 8; k++) P(Sc.campInk || '#e3b663', KX + 19 + k, GATE.y - 30 + Math.round(Math.sin(t * .9 + k * .7)), 1, 5 - (k > 5 ? 1 : 0)); }]);
  items.push([GATE.y + 1, () => folk(t, Sc.camp ? 0 : Math.min(3, Math.floor(shown.length / 2)))]);
  for (const q of Sc.piles || []) { const [x, y] = pileAt(q.slot); items.push([y, () => pile(x, y, q.g, q.mark, t)]); }
  for (const e of fx) if (e.kind === 'swoop' && e.age < SWOOP * .48 && e.slot != null) { const [x, y] = pileAt(e.slot); items.push([y, () => pile(x, y, e.g || 10, false, t)]); } // still there until it lands
  // the dragon's hoard on its crag: what it took this week
  const hoard = Math.min(8, Math.ceil((Sc.hoard || 0) / 25)); for (let i = 0; i < hoard; i++) items.push([LEDGE.y + 30, () => S('coin0', LEDGE.x - 22 + (i % 4) * 7, LEDGE.y + 22 - Math.floor(i / 4) * 4)]);
  items.sort((a, z) => a[0] - z[0]).forEach(([, f]) => f());
  if (rk?.kind === 'breach' && rk.age > RECKON * .45 && rk.age < RECKON * .45 + 18) SB('boom' + Math.min(8, (rk.age - Math.round(RECKON * .45)) >> 1), GATE.x, GATE.y + 4);
  // labels on the piles, and the ring on the one the dragon is circling
  for (const q of Sc.piles || []) { const [x, y] = pileAt(q.slot), s = String(q.g); text(s, x - (s.length * 4 - 1) / 2 | 0, y + 3, GOLD3, 'rgba(10,8,20,.72)'); }
  const hot = (Sc.piles || []).find(q => q.hot), sw = fx.find(e => e.kind === 'swoop' && e.age < SWOOP);
  const ds = [.6, .68, .75, .82][Sc.lvl] || .7;
  let pose;
  if (rk) pose = flight(rk.age, RECKON, GATE.x, GATE.y - (rk.kind === 'held' ? 40 : 14), rk.kind === 'held' ? { bonk: true } : { carry: true });
  else if (sw && sw.slot != null) { const [x, y] = pileAt(sw.slot); pose = flight(sw.age, SWOOP, x, y - 10, { carry: true }); }
  else if (Sc.mode === 'circle') { const [px, py] = hot ? pileAt(hot.slot) : [160, 190], a = t * .06; pose = { x: px + Math.cos(a) * 34, y: py - 34 + Math.sin(a) * 16, alt: 34, ang: a + Math.PI / 2 }; if (hot) { c.strokeStyle = 'rgba(255,200,90,.7)'; c.setLineDash([2, 2]); c.beginPath(); c.ellipse(px + .5, py - 4.5, 17, 8, 0, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); } }
  else pose = { x: LEDGE.x, y: LEDGE.y, folded: true, sleep: Sc.mode === 'sleep' };
  drawDragon(pose, t, ds);
  if (pose.sleep) for (let i = 0; i < 3; i++) { const k = (t * .12 + i * 1.3) % 4; if (k < 3) text('z', LEDGE.x + 14 + k * 4, LEDGE.y - 22 - k * 6, '#d8d0f0'); }
  if (pose.bonk) for (let i = 0; i < 8; i++) P(i % 2 ? '#fff8d0' : FIRE[3], GATE.x + Math.cos(i * .8 + t) * (6 + i), GATE.y - 34 + Math.sin(i * .8 + t) * 4);
  if (rk?.kind === 'held' && rk.age > RECKON * .4) SB('flag' + (t >> 1) % 4, GATE.x, GATE.y - 30);
  // gold flying from a pile into the keep, and sparkles where something new went up
  for (const e of fx) {
    if (e.kind === 'kept') { const [sx, sy] = e.slot != null ? pileAt(e.slot) : [60, 200]; for (let i = 0; i < (e.n || 6); i++) { const k = (e.age - i * .9) / 10; if (k < 0 || k > 1) continue; S('coin' + ((t + i) % 4), lerp(sx, GATE.x, k) - 5, lerp(sy - 8, GATE.y - 10, k) - Math.sin(k * Math.PI) * 30 - 5); } }
    if (e.kind === 'built' && e.age < 18) for (let i = 0; i < 10; i++) { const a = i * .63 + e.age * .3, r = 4 + e.age * 1.6; if ((e.age + i) % 3) P(i % 2 ? GOLD3 : '#ffffff', KX + Math.cos(a) * r, GATE.y - 30 + Math.sin(a) * r * .7, 2, 2); }
  }
  if (LAND_TINT[Sc.land]) { c.fillStyle = LAND_TINT[Sc.land]; c.fillRect(0, 0, SW, SH); }
  if (PHASE_TINT[Sc.phase]) { c.fillStyle = PHASE_TINT[Sc.phase]; c.fillRect(0, 0, SW, SH); }
  if ((Sc.phase === 'night' || Sc.phase === 'dusk') && stage >= 2) for (const x of [GATE.x - 22, GATE.x + 21]) { c.fillStyle = 'rgba(255,170,70,.2)'; c.fillRect(x - 6, GATE.y - 22, 13, 13); }
}
