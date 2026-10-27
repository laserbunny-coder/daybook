// Quest's picture in 16-bit: the village (or a campaign camp), the sky for the time of day, and the dragon on
// its crag, drawn at 320 x 144 the way a SNES artist would: shaded ramps, ordered dithering, lit windows.
// crt.js shows it through an old TV. Everything is drawn by code, so new buildings are just new functions.
export const SW = 320, SH = 144;
const G = 122; // the ground line
let c = null; // the context being drawn on (a building can be drawn aside, to be burned)

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
const dith = (x, y) => BAYER[((y | 0) & 3) * 4 + ((x | 0) & 3)];
const P = (col, x, y, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, w, h); };
const ramp = (R, v, x, y) => { const f = Math.max(0, Math.min(.999, v)) * R.length, i = Math.floor(f); return R[Math.min(R.length - 1, f - i > dith(x, y) ? i + 1 : i)]; };
const hx = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mixc = (a, b, f) => { const A = hx(a), B = hx(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * f).toString(16).padStart(2, '0')).join(''); };
const rampOf = ink => [mixc(ink, '#000000', .78), mixc(ink, '#000000', .55), mixc(ink, '#000000', .3), ink, mixc(ink, '#ffffff', .35)];
const rnd = i => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
const LIGHT = [-.55, -.75];
function blob(cx, cy, rx, ry, R) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const nx = (x - cx) / rx, ny = (y - cy) / ry, d = nx * nx + ny * ny; if (d > 1) continue;
    P(ramp(R, .45 + .55 * (-(nx * LIGHT[0] + ny * LIGHT[1]) * .7 + Math.sqrt(1 - d) * .45), x, y), x, y);
  }
}

const STONE = ['#24222f', '#3c3c52', '#56586e', '#73768c', '#9a9db0', '#c4c6d4'];
const BLUE = ['#141d42', '#22346e', '#30509e', '#4a74cc', '#7aa2ec'];
const REDR = ['#3a1410', '#6a2218', '#9a3422', '#c8502c', '#e8784a'];
const WOOD = ['#2a1810', '#4a2c1a', '#6a4226', '#8c5c34', '#ac7a48'];
const THATCH = ['#4a3418', '#6e5024', '#967034', '#bc9248', '#dcb468'];
const WALL = ['#6a5e50', '#9a8c76', '#c4b498', '#e2d4b4'];
const CANVAS = ['#5a4a3a', '#8a7a62', '#b8a888', '#ded0b0'];
const FIRE = ['#7a1a08', '#c8400c', '#f07818', '#f8b838', '#fff0a0'];
const GOLD = ['#7a5418', '#b88a2a', '#e3b663', '#fff0a0'];
const LIT = ['#ffb848', '#fff0b0'];

/* ---------- lands: the home vale and each region ---------- */
const LANDS = {
  vale: { far: ['#6a5e8a', '#3e3658'], near: ['#3a4a52', '#2c3a42'], crag: ['#120e18', '#1c1624', '#2a2234', '#3a3046'], grass: ['#1a2c14', '#24401a', '#325620', '#446c28', '#5c8632'], leaf: ['#0e1e14', '#16301e', '#204428', '#2e5c34', '#46783e'], top: '#6a9a3a', snow: true },
  wood: { far: ['#3a5a4a', '#24402e'], near: ['#1c3a24', '#14301c'], crag: ['#0e1a12', '#16261a', '#203424', '#2c4430'], grass: ['#0e2010', '#163018', '#204420', '#2c5a28', '#3c7034'], leaf: ['#08160c', '#0e2414', '#163a1e', '#22522a', '#36703a'], top: '#4a8a3a', trees: 1 },
  marsh: { far: ['#5a6a5a', '#3a4a40'], near: ['#34443a', '#2a3a30'], crag: ['#141a14', '#1e281e', '#2a362a', '#384638'], grass: ['#1e2614', '#2c361a', '#3c4a22', '#4e5e2c', '#647438'], leaf: ['#141c10', '#1e2a16', '#2a3a1e', '#3a4e26', '#506630'], top: '#7a8a4a', water: 1 },
  frost: { far: ['#c8d4e8', '#8a9ab8'], near: ['#6a7a98', '#4a5a78'], crag: ['#1a2234', '#28324a', '#3a4662', '#56627e'], grass: ['#7a8aa4', '#9aaac4', '#bccae0', '#dce6f4', '#f4f8ff'], leaf: ['#0e1e24', '#163036', '#20444a', '#2e5a5e', '#4a7a7a'], top: '#ffffff', snow: true, flakes: 1 },
  storm: { far: ['#4a5a7a', '#2e3a54'], near: ['#26344a', '#1c2a3e'], crag: ['#0c1220', '#141c2e', '#1e2a40', '#2a3852'], grass: ['#14261e', '#1c3428', '#264634', '#305a40', '#3e6e4c'], leaf: ['#0c1a16', '#122620', '#1a362c', '#24483a', '#34604c'], top: '#4a7a5a', rain: 1, sea: 1 },
  ember: { far: ['#5a2e2a', '#3a1c1a'], near: ['#2e1614', '#22100e'], crag: ['#100808', '#1c0e0c', '#2c1410', '#3e1c16'], grass: ['#1a0e0a', '#2a140e', '#3a1c12', '#4e2616', '#66321a'], leaf: ['#1a0e0a', '#2a1610', '#3a2016', '#4a2a1a', '#5a3420'], top: '#8a3a1a', lava: 1 },
  spires: { far: ['#7a6a9a', '#4a3e66'], near: ['#3a3054', '#2c2442'], crag: ['#14101e', '#201a30', '#2e2644', '#40365c'], grass: ['#1e1a2e', '#2a2440', '#383054', '#4a406a', '#5e5482'], leaf: ['#141024', '#1e1834', '#2a2248', '#3a3060', '#4e447a'], top: '#8a7ac0', spires: 1 },
};
export const DRAGON_INK = { vale: '#c84a2c', wood: '#4a9a3a', marsh: '#7a8a3a', frost: '#7ab0e0', storm: '#3a6ac8', ember: '#d86a1a', spires: '#9a6ad8' };
const SKIES = {
  night: [[10, 10, 26], [16, 16, 40], [24, 22, 56], [34, 30, 70], [46, 40, 84], [60, 52, 96]],
  dawn: [[40, 34, 78], [80, 56, 104], [140, 84, 118], [204, 116, 118], [240, 160, 116], [252, 204, 140]],
  day: [[70, 120, 196], [90, 140, 210], [112, 160, 222], [140, 182, 232], [170, 204, 238], [200, 222, 242]],
  dusk: [[18, 14, 40], [34, 24, 62], [62, 36, 84], [104, 52, 92], [168, 78, 88], [222, 128, 84]],
};
export const phaseOf = m => m < 6 * 60 || m >= 21 * 60 ? 'night' : m < 8 * 60 ? 'dawn' : m < 18 * 60 ? 'day' : 'dusk';
const TINT = { ember: [40, -10, -20], spires: [10, -6, 24], frost: [0, 8, 20], storm: [-14, -6, 6], marsh: [-6, 6, -10] };

/* ---------- the backdrop, cached per land and time of day ---------- */
const cache = new Map();
function backdrop(land, phase) {
  const key = land + '|' + phase; if (cache.has(key)) return cache.get(key);
  const cv = Object.assign(document.createElement('canvas'), { width: SW, height: SH }), keep = c; c = cv.getContext('2d');
  const L = LANDS[land], tint = TINT[land] || [0, 0, 0], S = SKIES[phase].map(rgb => rgb.map((v, i) => Math.max(0, Math.min(255, v + tint[i]))));
  for (let y = 0; y < G; y++) for (let x = 0; x < SW; x++) { const f = Math.min(.999, y / (G - 10)) * (S.length - 1), i = Math.floor(f), k = f - i > dith(x, y) ? Math.min(S.length - 1, i + 1) : i; P(`rgb(${S[k]})`, x, y); }
  if (phase === 'day' || phase === 'dawn') { const sx = phase === 'day' ? 250 : 40, sy = phase === 'day' ? 18 : 60; for (let y = -14; y <= 14; y++) for (let x = -14; x <= 14; x++) { const d = Math.hypot(x, y); if (d > 6 && d < 14 && dith(x + 9, y) > (d - 6) / 8 + .4) P('rgba(255,240,200,.35)', sx + x, sy + y); } blob(sx, sy, 6, 6, ['#f8c860', '#ffe090', '#fff4c8', '#ffffff']); }
  else { for (let y = -16; y <= 16; y++) for (let x = -16; x <= 16; x++) { const d = Math.hypot(x, y); if (d > 7 && d < 16 && dith(x + 40, y + 20) > (d - 7) / 9 + .35) P('rgba(110,90,150,.45)', 40 + x, 20 + y); } blob(40, 20, 7, 7, ['#9a8c9c', '#c8bcc0', '#efe6d8', '#fffaf0']); P('#b8acb4', 38, 18, 2, 2); P('#b8acb4', 43, 23, 1, 1); }
  if (L.spires) for (const [x, w, h] of [[70, 6, 44], [96, 4, 30], [170, 8, 56], [206, 5, 36]]) { for (let y = G - h - 20; y < G - 20; y++) for (let xx = x; xx < x + w * (1 - (G - 20 - y) / h * .3); xx++) P(ramp(['#2a2240', '#3e3460', '#5a4e86', '#8a7ab8'], .9 - (xx - x) / w, xx, y), xx, y); blob(x + w / 2, G - h - 22, w * .8, 3, ['#3e3460', '#5a4e86', '#8a7ab8']); }
  for (let x = 0; x < SW; x++) { const h = 34 + 10 * Math.sin(x / 23) + 7 * Math.sin(x / 9.3 + 1) + 3 * Math.sin(x / 3.1); for (let y = G - h; y < G; y++) { const snow = L.snow && y < G - h + 4 && h > 44; P(snow ? (dith(x, y) > .4 ? '#d8d0e8' : '#9a90b8') : y < G - h + 1 ? L.far[0] : L.far[1], x, y); } }
  if (L.sea) for (let y = G - 18; y < G; y++) for (let x = 0; x < SW; x++) if (y > G - 14 + Math.sin(x / 30) * 2) P((x + y * 3) % 17 === 0 ? '#8ab0d8' : y % 3 ? '#1a2c48' : '#22385a', x, y);
  for (let x = 0; x < SW; x++) { const h = 16 + 5 * Math.sin(x / 13 + 2) + 3 * Math.sin(x / 5.7); for (let y = G - h; y < G; y++) P(y < G - h + 1 ? L.near[0] : dith(x, y) > .85 ? L.far[1] : L.near[1], x, y); }
  if (L.trees) for (let x = 0; x < SW; x += 7) { const h = 10 + (rnd(x) * 8 | 0); for (let i = 0; i < h; i++) { const w = Math.max(1, (h - i) / 2.2); for (let xx = x - w; xx < x + w; xx++) P(ramp(L.leaf, .3 + (x - xx) / 12, xx, G - 12 - i), xx, G - 12 - i); } }
  for (let x = 232; x < SW; x++) { const h = Math.max(0, 78 - Math.abs(x - 284) * 1.35 + 3 * Math.sin(x / 2.3)); for (let y = G - h; y < G; y++) P(ramp(L.crag, .55 - (x - 284) / 90 + (y - (G - h)) / -260, x, y), x, y); }
  for (let y = G; y < SH; y++) for (let x = 0; x < SW; x++) P(ramp(L.grass, .8 - (y - G) / 26 + Math.sin(x * .7 + y * 1.3) * .12, x, y), x, y);
  for (let x = 0; x < SW; x++) if (dith(x, 3) > .4) P(L.top, x, G);
  if (L.water) for (const [x, w] of [[20, 40], [196, 34]]) for (let y = G + 6; y < G + 14; y++) for (let xx = x + (y - G - 6); xx < x + w - (y - G - 6); xx++) P((xx + y) % 9 === 0 ? '#9ab0a0' : y % 2 ? '#1e3436' : '#28423e', xx, y);
  if (L.lava) for (let i = 0; i < 14; i++) { let x = rnd(i) * SW | 0, y = G + 3 + (rnd(i + 50) * 18 | 0); for (let k = 0; k < 10; k++) { P(k % 3 ? '#f07818' : '#f8b838', x, y); x += 1; y += rnd(i * 9 + k) > .5 ? 1 : -1; } }
  c = keep; cache.set(key, cv); if (cache.size > 6) cache.delete(cache.keys().next().value); return cv;
}

/* ---------- buildings, each standing on the ground line from its left edge x ---------- */
function bricks(x, y, w, h, shade) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    const row = Math.floor((yy - y) / 3), off = row % 2 ? 3 : 0, mortar = (yy - y) % 3 === 2 || (xx - x + off) % 6 === 5;
    P(ramp(STONE, shade(xx, yy) + (mortar ? -.22 : ((xx * 13 + yy * 7) % 11 === 0 ? .1 : 0)), xx, yy), xx, yy);
  }
}
const crenels = (x, y, w, l = .78) => { for (let i = 0; i < w; i += 5) bricks(x + i, y - 4, Math.min(3, w - i), 4, () => l); };
const win = (x, y, h = 5) => { P(STONE[0], x - 1, y - 1, 4, h + 2); P(LIT[0], x, y, 2, h); P(LIT[1], x, y + 1, 1, h - 3); };
function flagOn(x, top, R, t, len = 9) { P(WOOD[0], x, top, 1, 10); for (let i = 0; i < len; i++) { const yy = top + Math.round(Math.sin(t * 1.4 + i * .7) * 1.2); P(R[i < 3 ? 3 : 2], x + 1 + i, yy, 1, 4 - (i > len - 3 ? 1 : 0)); P(R[4], x + 1 + i, yy, 1, 1); } }
function tower(x, w, top, roof, t, flag) {
  bricks(x, top, w, G - top, xx => { const u = (xx - x) / (w - 1) * 2 - 1; return .55 + .4 * Math.cos((u + .45) * 1.4) - .15; });
  P(STONE[0], x, top, 1, G - top); P(STONE[0], x + w - 1, top, 1, G - top);
  const rh = Math.round(w * 1.3);
  for (let i = 0; i < rh; i++) { const half = (w / 2 + 2) * (1 - i / rh); for (let xx = Math.round(x + w / 2 - half); xx <= x + w / 2 + half; xx++) { const u = (xx - (x + w / 2)) / (half + .01); P(ramp(roof, .65 - u * .45 + (i % 3 === 0 ? -.12 : 0), xx, top - 1 - i), xx, top - 1 - i); } }
  win(x + (w >> 1) - 1, top + 10);
  if (flag) flagOn(x + (w >> 1), top - rh - 9, flag, t);
}
function cottage(x, w, h, t, chimney, roofR = THATCH) {
  const top = G - h;
  for (let yy = top; yy < G; yy++) for (let xx = x; xx < x + w; xx++) P(ramp(WALL, .85 - (xx - x) / w * .5, xx, yy), xx, yy);
  P(WOOD[1], x, top, w, 1); P(WOOD[1], x, top + (h >> 1), w, 1); P(WOOD[1], x, top, 1, h); P(WOOD[1], x + w - 1, top, 1, h);
  for (let i = 0; i < h >> 1; i++) { P(WOOD[1], x + 1 + i, top + 1 + i); P(WOOD[1], x + w - 2 - i, top + 1 + i); }
  P('#2a1810', x + 2, top + (h >> 1) + 2, 4, 4); P(LIT[0], x + 3, top + (h >> 1) + 3, 2, 2); P(LIT[1], x + 3, top + (h >> 1) + 3);
  P(WOOD[0], x + w - 6, G - 7, 4, 7); P(WOOD[2], x + w - 5, G - 6, 2, 6); P(GOLD[2], x + w - 4, G - 4);
  const rh = Math.ceil(w * .55);
  for (let i = 0; i < rh; i++) for (let xx = x - 3 + i; xx < x + w + 3 - i; xx++) P(ramp(roofR, .9 - i / rh * .2 - (xx - x) / w * .35 + ((xx * 7 + i * 3) % 5 === 0 ? -.25 : 0), xx, top - 1 - i), xx, top - 1 - i);
  for (let xx = x - 3; xx < x + w + 3; xx++) P(roofR[0], xx, top - 1);
  if (chimney) { const cx = x + w - 5; P(STONE[2], cx, top - rh + 2, 3, rh - 2); P(STONE[4], cx, top - rh + 2, 1, rh - 2); smoke(cx + 1, top - rh, t, '#8a7e94', '#5e5468'); }
}
function smoke(x, y, t, a, b) { for (let i = 0; i < 5; i++) { const k = (t * .6 + i * .9) % 5; P(k < 2 ? a : b, x + Math.sin(k * 2 + i) * 2, y - k * 4, 2, 2); } }
function fire(x, y, t, s = 1) { const f = t % 3; P(FIRE[1], x - 1, y - 2 * s, 3 * s + 1, 3 * s); P(FIRE[2], x - 1, y - 3 * s - (f === 1 ? 1 : 0), 3 * s, 2 * s); P(FIRE[3], x, y - 3 * s - f % 2, s + 1, 2 * s); P(FIRE[4], x + (f === 2 ? 1 : 0), y - 2 * s, 1, s); }
const B = {
  'Campfire': (x, t) => { P(WOOD[1], x, G - 2, 8, 2); P(WOOD[3], x + 1, G - 3, 6, 1); for (let i = 0; i < 5; i++) P(STONE[2 + i % 2], x - 1 + i * 2, G - 1, 2, 1); fire(x + 3, G - 3, t, 2); if (t % 2) P(FIRE[4], x + 4 + (t % 3), G - 12 - (t % 4)); },
  'Tent': (x, t) => { const w = 14, h = 11; for (let i = 0; i < h; i++) { const half = w / 2 * (i / h); for (let xx = Math.round(x + w / 2 - half); xx <= x + w / 2 + half; xx++) { const u = (xx - (x + w / 2)) / (half + .5); P((xx - x) % 4 === 0 && u < 0 ? '#9a3422' : ramp(CANVAS, .75 - u * .35, xx, G - h + i), xx, G - h + i); } } P('#1a1410', x + 6, G - 5, 3, 5); flagOn(x + 7, G - h - 9, REDR, t, 5); },
  'Hut': (x, t) => cottage(x, 16, 12, t, true),
  'Well': x => { bricks(x, G - 6, 10, 6, xx => .75 - (xx - x) / 20); P(WOOD[1], x + 1, G - 14, 1, 8); P(WOOD[1], x + 8, G - 14, 1, 8); for (let i = 0; i < 6; i++) P(REDR[2 + (i % 2)], x - 1 + i, G - 15 - i * .5, 12 - i * 2, 1); P(WOOD[0], x + 2, G - 12, 6, 1); P('#3a3a48', x + 4, G - 11, 2, 1); P(WOOD[3], x + 4, G - 10, 2, 2); },
  'Farm': (x, t) => { for (let r = 0; r < 4; r++) for (let xx = x; xx < x + 20; xx++) P(ramp(['#6a5418', '#a88a2a', '#d4b448', '#f0d878'], .7 + Math.sin(xx + t * .5 + r) * .2 - r * .08, xx, G + 1 + r * 2), xx, G + 1 + r * 2);
    const bx = x + 14; for (let yy = G - 14; yy < G; yy++) for (let xx = bx; xx < bx + 16; xx++) P(ramp(REDR, .8 - (xx - bx) / 26 + ((xx - bx) % 3 === 0 ? -.15 : 0), xx, yy), xx, yy);
    for (let i = 0; i < 10; i++) for (let xx = bx - 2 + i; xx < bx + 18 - i; xx++) P(ramp(['#2a1a1a', '#4a2a2a', '#6a3a32'], .9 - i / 10, xx, G - 15 - i), xx, G - 15 - i);
    P('#efe6d8', bx + 5, G - 9, 6, 9); P(REDR[1], bx + 6, G - 8, 4, 8); for (let i = 0; i < 4; i++) { P('#efe6d8', bx + 6 + i, G - 8 + i * 2); P('#efe6d8', bx + 9 - i, G - 8 + i * 2); }
    blob(x + 4, G - 3, 4, 3, THATCH); },
  'Watchtower': (x, t) => { for (const lx of [x, x + 10]) { P(WOOD[1], lx, G - 26, 2, 26); P(WOOD[3], lx, G - 26, 1, 26); } for (let i = 0; i < 4; i++) { P(WOOD[0], x + 1 + i * 2.5, G - 6 - i * 5, 2, 1); } P(WOOD[0], x + 2, G - 16, 8, 1);
    for (let yy = G - 32; yy < G - 26; yy++) for (let xx = x - 2; xx < x + 14; xx++) P(ramp(WOOD, .8 - (xx - x) / 22 + ((xx - x) % 3 === 0 ? -.2 : 0), xx, yy), xx, yy);
    for (let i = 0; i < 6; i++) P(ramp(THATCH, .8 - i / 8, x + i, G - 38 + i), x - 3 + i, G - 38 + i, 18 - i * 2, 1); fire(x + 13, G - 33, t); },
  'Mill': (x, t) => { for (let yy = G - 22; yy < G; yy++) { const w = 12 + (yy - (G - 22)) / 5; for (let xx = x + 8 - w / 2; xx < x + 8 + w / 2; xx++) P(ramp(WALL, .9 - (xx - (x + 8 - w / 2)) / w * .7, xx, yy), xx, yy); }
    for (let i = 0; i < 7; i++) P(ramp(THATCH, .8 - i / 9, x, G - 23 - i), x + 1 + i, G - 23 - i, 14 - i * 2, 1); P(WOOD[0], x + 6, G - 6, 4, 6); win(x + 7, G - 16, 3);
    const a0 = t * .35, cx = x + 8, cy = G - 24; for (let k = 0; k < 4; k++) { const a = a0 + k * Math.PI / 2; for (let r = 2; r < 16; r++) { const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; P(WOOD[1], px, py); if (r > 5) { const ox = Math.cos(a + Math.PI / 2) * 2, oy = Math.sin(a + Math.PI / 2) * 2; P(r % 3 ? '#e8e0cc' : '#b8ac94', px + ox, py + oy); P('#d8ceb8', px + ox / 2, py + oy / 2); } } } P(WOOD[0], cx - 1, cy - 1, 3, 3); },
  'Smithy': (x, t) => { bricks(x, G - 12, 22, 12, xx => .7 - (xx - x) / 40); P('#120c0a', x + 3, G - 9, 10, 9); const glow = t % 2 ? FIRE[3] : FIRE[2]; P(FIRE[1], x + 4, G - 4, 8, 3); P(glow, x + 6, G - 4, 4, 2); P(FIRE[4], x + 7, G - 3, 2, 1);
    P('#3a3a48', x + 15, G - 4, 6, 2); P('#56586e', x + 16, G - 6, 4, 2); P('#2a2a34', x + 17, G - 2, 2, 2);
    for (let i = 0; i < 7; i++) for (let xx = x - 2 + i; xx < x + 24 - i; xx++) P(ramp(['#1a1a24', '#2a2a38', '#3c3c50', '#56566e'], .8 - i / 8 - (xx - x) / 50, xx, G - 13 - i), xx, G - 13 - i);
    P(STONE[2], x + 16, G - 24, 4, 6); P(STONE[4], x + 16, G - 24, 1, 6); smoke(x + 17, G - 26, t, '#4a4450', '#2e2a34'); },
  'Stone keep': (x, t) => { bricks(x, G - 46, 36, 46, xx => .72 - (xx - x) / 70); crenels(x, G - 46, 36); P(STONE[0], x + 35, G - 50, 1, 50);
    for (const [wx, wy] of [[x + 6, G - 38], [x + 17, G - 38], [x + 28, G - 38], [x + 11, G - 26], [x + 23, G - 26]]) win(wx, wy);
    gate(x + 11, 14); flagOn(x + 17, G - 62, REDR, t, 11); },
  'Market': (x, t) => { for (const [o, A] of [[0, ['#9a3422', '#efe6d8']], [14, ['#30509e', '#efe6d8']]]) { P(WOOD[1], x + o, G - 10, 1, 10); P(WOOD[1], x + o + 11, G - 10, 1, 10); for (let xx = x + o - 1; xx < x + o + 13; xx++) for (let k = 0; k < 3; k++) P(A[((xx - x) >> 1) % 2], xx, G - 12 + k); for (let xx = x + o - 1; xx < x + o + 13; xx += 2) P(A[0], xx, G - 9);
    for (let yy = G - 5; yy < G; yy++) for (let xx = x + o + 1; xx < x + o + 11; xx++) P(ramp(WOOD, .8 - (yy - (G - 5)) / 8, xx, yy), xx, yy); }
    for (const [gx, col] of [[x + 3, '#d84a2a'], [x + 6, '#e3b663'], [x + 17, '#6aa83a'], [x + 20, '#d84a2a'], [x + 23, '#8a5aa8']]) blob(gx, G - 6, 1.5, 1.2, [mixc(col, '#000000', .4), col, mixc(col, '#ffffff', .4)]); },
  'Castle walls': (x, t) => { bricks(x, G - 22, 108, 22, (xx, yy) => .62 - (yy - (G - 22)) / 80); crenels(x, G - 22, 108, .7); P(STONE[0], x, G - 26, 1, 26); P(STONE[0], x + 107, G - 26, 1, 26); },
  'Great hall': (x, t) => { bricks(x, G - 30, 36, 30, xx => .66 - (xx - x) / 70); for (let i = 0; i < 12; i++) for (let xx = x - 3 + i; xx < x + 39 - i; xx++) P(ramp(REDR, .85 - i / 14 - (xx - x) / 80 + ((xx + i) % 4 === 0 ? -.15 : 0), xx, G - 31 - i), xx, G - 31 - i);
    for (let i = 0; i < 4; i++) { const wx = x + 5 + i * 8; P(STONE[0], wx - 1, G - 26, 4, 10); P(LIT[0], wx, G - 25, 2, 8); P(LIT[1], wx, G - 24, 1, 4); P(STONE[0], wx, G - 26); } },
  'Castle': (x, t, held = []) => {
    held.forEach((r, i) => { const [tx, h] = [[-8, 64], [86, 70], [-16, 56], [94, 60], [16, 74], [70, 76]][i]; tower(x + tx, 10, G - h, rampOf(r.ink), t, rampOf(r.ink)); });
    bricks(x - 6, G - 22, 104, 22, (xx, yy) => .62 - (yy - (G - 22)) / 80); crenels(x - 6, G - 22, 104, .7);
    bricks(x + 26, G - 54, 40, 54, xx => .72 - (xx - (x + 26)) / 80); crenels(x + 26, G - 54, 40); P(STONE[0], x + 65, G - 58, 1, 58);
    for (const [wx, wy] of [[x + 32, G - 46], [x + 44, G - 46], [x + 56, G - 46], [x + 38, G - 34], [x + 52, G - 34]]) win(wx, wy);
    gate(x + 38, 18); for (const tx of [x + 34, x + 57]) { P(WOOD[1], tx, G - 14, 1, 4); fire(tx, G - 15, t); }
    tower(x, 16, G - 64, BLUE, t, REDR); tower(x + 76, 16, G - 64, BLUE, t, null);
    const bx = x + 46; P(WOOD[0], bx, G - 80, 1, 22);
    for (let i = 0; i < 13; i++) { const yy = G - 80 + Math.round(Math.sin(t * 1.2 + i * .6) * 1.5); for (let k = 0; k < 7 - (i > 9 ? i - 9 : 0); k++) P(k === 0 ? REDR[4] : ramp(REDR, .8 - k / 9, bx + 1 + i, yy + k), bx + 1 + i, yy + k); }
  },
};
function gate(gx, w) { const h = w + 2;
  for (let yy = G - h; yy < G; yy++) for (let xx = gx; xx < gx + w; xx++) { const r = w / 2, dx = xx - gx - r + .5, top = G - h + r - Math.sqrt(Math.max(0, r * r - dx * dx)); if (yy >= top) P('#120c10', xx, yy); }
  for (let xx = gx + 2; xx < gx + w - 1; xx += 3) P('#4a4250', xx, G - h + 4, 1, h - 4); for (let yy = G - h + 6; yy < G; yy += 3) P('#4a4250', gx + 1, yy, w - 2, 1); }
// where each building stands; drawn back to front
const AT = { 'Castle walls': 86, 'Great hall': 100, 'Mill': 58, 'Watchtower': 4, 'Stone keep': 126, 'Castle': 98, 'Farm': 14, 'Smithy': 72, 'Hut': 196, 'Tent': 178, 'Campfire': 164, 'Market': 214, 'Well': 88 };
const ORDER = ['Castle walls', 'Great hall', 'Mill', 'Watchtower', 'Stone keep', 'Castle', 'Farm', 'Smithy', 'Hut', 'Tent', 'Campfire', 'Market', 'Well'];

/* ---------- the dragon ---------- */
function dragon(t, s, ink, crown, fat = 0) {
  const DRG = [mixc(ink, '#000000', .8), mixc(ink, '#000000', .6), mixc(ink, '#000000', .35), ink, mixc(ink, '#ffaa66', .3), mixc(ink, '#ffffff', .45)];
  const MEMB = [mixc(ink, '#200010', .75), mixc(ink, '#200010', .58), mixc(ink, '#200010', .42), mixc(ink, '#200010', .28)];
  const ox = 290 - 30 * s, oy = G - 72 - 26 * s + Math.round(Math.sin(t * .9)), flap = Math.sin(t * 1.6), S = v => v * s;
  wing(ox + S(14), oy + S(10), -flap, MEMB.slice(0, 3), S(26), DRG);
  for (let i = 0; i < 26 * s; i++) { const r = Math.max(1.2, S(3.4) - i / 9); blob(ox + S(22) + i, oy + S(22) + Math.sin(i / 5 + t * .4) * 3 + i * .25, r, r, DRG); }
  // it gets fatter the more of your gold it has eaten this week
  const by = S(9) * (1 + fat * .55), bx = S(14) * (1 + fat * .25), belly = oy + S(18) + by - S(3);
  blob(ox + S(18), oy + S(18) + fat * S(3), bx, by, DRG);
  for (let x = ox + S(18) - bx * .7; x < ox + S(18) + bx * .6; x++) for (let k = 0; k < S(3) + fat * 3; k++) if ((Math.round(x) + k) % 3) P(ramp(['#8a5a20', '#c89040', '#e8c070', '#f8e0a0'], .9 - k / 5, x, belly + k), x, belly + k);
  blob(ox + S(12), oy + S(26), S(3), S(4), DRG); blob(ox + S(24), oy + S(26), S(3), S(4), DRG);
  for (let i = 0; i < 10; i++) blob(ox + S(6) - i * S(.9), oy + S(12) - i * S(1.2), S(3.6), S(3.6), DRG);
  blob(ox - S(6), oy, S(6), S(4.5), DRG); blob(ox - S(11), oy + S(2), S(3.5), S(2.5), DRG);
  P('#fff0a0', ox - S(7), oy - 1, 2, 1); P('#f8c040', ox - S(7), oy); P(DRG[0], ox - S(14), oy + S(1));
  for (const [a, b] of [[-3, -4], [-1, -5], [0, -6], [-2, -4]]) P('#e8d8b0', ox + S(a), oy + S(b));
  for (let i = 0; i < 6; i++) P(DRG[4], ox + S(10 + i * 3), oy + S(9) - Math.round(Math.sin(i / 2)), 1, 2);
  if (crown) { P(GOLD[2], ox - S(8), oy - S(7), S(6), 2); for (let i = 0; i < 3; i++) P(GOLD[3], ox - S(8) + i * S(2.5), oy - S(9), 1, 2); }
  wing(ox + S(18), oy + S(9), flap, MEMB, S(32), DRG);
  const breath = (t % 14) / 14; if (breath > .55 && breath < .9) { const L = (breath - .55) / .35 * 46 * s;
    for (let i = 0; i < L; i++) { const sp = i / 7; for (let k = -sp; k <= sp; k++) { const x = ox - S(15) - i, y = oy + S(3) + k + Math.sin(i * .7 + t) * 1.5, v = 1 - i / (50 * s) - Math.abs(k) / (sp + 2) * .6; if (dith(x, y) < v + .2) P(ramp(FIRE, v, x, y), x, y); } } }
}
function wing(x, y, flap, R, span, DRG) {
  const tip = [x + span * .45, y - span * .56 - flap * span * .37], back = [x + span, y - span * .12 - flap * span * .25];
  const s3 = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let yy = Math.floor(Math.min(tip[1], back[1], y)) - 1; yy <= y + 2; yy++) for (let xx = Math.floor(x - 2); xx <= x + span + 1; xx++) {
    const p = [xx, yy], A = [x, y], d1 = s3(A, tip, p), d2 = s3(tip, back, p), d3 = s3(back, A, p);
    if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
    if (d3 < -Math.sin((xx - x) / span * Math.PI * 4) * 1.6 * 18) continue;
    P(ramp(R, .75 - (yy - tip[1]) / 40 + ((xx - x) % 8 === 0 ? -.3 : 0), xx, yy), xx, yy);
  }
  for (let i = 0; i <= 12; i++) { P(DRG[1], x + (tip[0] - x) * i / 12, y + (tip[1] - y) * i / 12); P(DRG[1], tip[0] + (back[0] - tip[0]) * i / 12, tip[1] + (back[1] - tip[1]) * i / 12); }
}

/* ---------- weather and little life ---------- */
function weather(L, t, phase) {
  if (L.flakes) for (let i = 0; i < 40; i++) P('#f4f8ff', (rnd(i) * SW + Math.sin(t * .3 + i) * 4) % SW, (rnd(i + 9) * SH + t * 2.2 * (1 + rnd(i) * .6)) % SH);
  if (L.rain) { for (let i = 0; i < 60; i++) { const x = (rnd(i) * SW + t * 3) % SW, y = (rnd(i + 3) * SH + t * 9) % SH; P('#7a9ac8', x, y, 1, 3); } if (t % 23 === 0) { c.fillStyle = 'rgba(220,230,255,.35)'; c.fillRect(0, 0, SW, G); } }
  if (L.lava || L.trees === undefined && L.spires) for (let i = 0; i < 14; i++) { const x = (rnd(i) * SW + Math.sin(t * .2 + i) * 3) % SW, y = G - ((t * 1.5 + rnd(i + 4) * 80) % 80); P(L.lava ? (i % 2 ? FIRE[3] : FIRE[2]) : '#d8c8ff', x, y); }
  if (phase === 'night' || phase === 'dusk') for (let i = 0; i < 9; i++) { const x = (i * 71 + Math.sin(t * .3 + i) * 6) % SW, y = G - 4 - (i * 13) % 20 + Math.sin(t * .5 + i * 2) * 3; if ((Math.sin(t * 1.3 + i * 4) + 1) / 2 > .45) { P('#f8f0a0', x, y); P('#a8c050', x + 1, y); } }
}
function stars(t, phase) { if (phase !== 'night' && phase !== 'dusk') return; for (let i = 0; i < 50; i++) { const x = rnd(i) * SW | 0, y = rnd(i + 99) * 64 | 0, tw = (Math.sin(t * .7 + i * 1.7) + 1) / 2; if (x > 28 && x < 52 && y < 32) continue; P(tw > .6 ? '#fff4dc' : '#a89cc0', x, y); } }
function clouds(t, phase) { const col = phase === 'day' ? ['#ffffff', '#d8e4f0'] : ['#8a5878', '#5a3a64']; for (let k = 0; k < 3; k++) { const cx = ((t * (1.5 + k * .5) + k * 130) % (SW + 80)) - 40, cy = 30 + k * 11;
  for (let y = -4; y <= 4; y++) for (let x = -26; x <= 26; x++) { const d = (x / 26) ** 2 + (y / 4.5) ** 2 + Math.sin(x * .5 + k) * .12; if (d < 1 && dith(x + 99, y) < 1.1 - d) P(y < 0 ? col[0] : col[1], cx + x, cy + y); } } }

/* ---------- the whole picture ---------- */
const aside = Object.assign(document.createElement('canvas'), { width: SW, height: SH });
function ruinOf(name, draw, t) { // draw a building aside, char it, put it back with smoke and embers
  const o = aside.getContext('2d'), keep = c; o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, SW, SH); c = o; draw(); c = keep;
  o.globalCompositeOperation = 'source-atop'; o.fillStyle = 'rgba(22,14,12,.8)'; o.fillRect(0, 0, SW, SH); c.drawImage(aside, 0, 0);
  const x = AT[name] + 8, top = G - 30; for (let i = 0; i < 6; i++) { const k = (t * .7 + i * .8) % 6; P(k < 3 ? '#6a6070' : '#3e3846', x + Math.sin(k + i) * 3 + (i % 3) * 3, top - k * 4, 2, 2); }
  P(t % 2 ? FIRE[3] : FIRE[2], x - 3 + (t % 4), G - 2); P(FIRE[1], x + 6 - (t % 3), G - 3);
}
/** Draw the scene: { land, phase, buildings, ruins, held (regions, for the castle's towers), crown, lvl, gold, camp } */
export function paint(cv, S, t) {
  c = cv.getContext('2d'); const L = LANDS[S.land] || LANDS.vale;
  c.drawImage(backdrop(S.land in LANDS ? S.land : 'vale', S.phase), 0, 0);
  stars(t, S.phase); clouds(t, S.phase);
  const shown = S.buildings.filter(b => !(b === 'Stone keep' && S.buildings.includes('Castle')) && !(b === 'Campfire' && S.buildings.includes('Stone keep')) && !(b === 'Tent' && S.buildings.includes('Castle walls')) && !(b === 'Castle walls' && S.buildings.includes('Castle')));
  // a path up to the gate once there's a keep
  if (shown.includes('Stone keep') || shown.includes('Castle')) for (let y = G + 1; y < SH; y++) { const w = 6 + (y - G) * 1.1, cx = 144 - (y - G) * .9; for (let x = cx - w / 2; x < cx + w / 2; x++) P(ramp(['#3a2a1c', '#5a4428', '#7a5e38', '#9a7a4a'], .7 - Math.abs(x - cx) / w, x, y), x, y); }
  for (const b of ORDER) { if (!shown.includes(b)) continue; const draw = () => B[b](AT[b], t, S.held); S.ruins.includes(b) ? ruinOf(b, draw, t) : draw(); }
  if (S.gold > 0) { const n = Math.min(12, 3 + Math.floor(S.gold / 600)); for (let i = 0; i < n; i++) for (let k = 0; k <= i; k++) if ((i + k) % 2 === 0) P(ramp(GOLD, .9 - k / n, 168 + i - k, G - 1 - k), 168 + i - k, G - 1 - k); }
  if (S.camp) { const fx = 150; flagOn(fx, G - 30, rampOf(S.campInk || '#e3b663'), t, 10); P(WOOD[0], fx, G - 20, 1, 20); }
  // the dragon's hoard on the crag: what it took this week
  const hoard = Math.min(16, Math.ceil((S.hoard || 0) / 12)); for (let i = 0; i < hoard; i++) for (let k = 0; k <= i / 2; k++) if ((i + k) % 2 === 0) P(ramp(GOLD, .9 - k / 8, 0, 0), 262 + i - k, G - 40 + (i > 8 ? 2 : 0) - k + Math.abs(i - 8) * .6);
  dragon(t, [0.72, .86, 1, 1.14][S.lvl] || .8, DRAGON_INK[S.land] || DRAGON_INK.vale, S.land === 'spires', Math.min(1, (S.hoard || 0) / 200));
  weather(L, t, S.phase);
  for (const [x, s] of [[4, 1.3], [62, .8], [230, .9]]) if (!(x === 62 && shown.includes('Smithy')) && !(x === 4 && shown.includes('Watchtower'))) { P(WOOD[0], x - 1, G + 4 - 8 * s, 3, 8 * s); blob(x, G + 4 - 14 * s, 9 * s, 8 * s, L.leaf); blob(x - 4 * s, G + 4 - 19 * s, 6 * s, 5 * s, L.leaf); }
}
