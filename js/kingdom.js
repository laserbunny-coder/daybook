// The kingdom map: every region beyond the home vale, who holds it, and the campaign under way.
// It opens in its own sheet over Quest. Marching, retreating and claiming go through quest.js.
import * as quest from './quest.js';
import { CAMPAIGN_DAYS, HOME, MARCH_AT, REGIONS, regionOf, TITLES } from './regions.js';
import { esc, fmtShort } from './util.js';
import { screen, mount } from './crt.js';
import * as k3 from './keep3d.js';

let onChange = () => {}, sel = null, askRetreat = false, anim = 0, tick = 0;
const el = document.createElement('div'); el.className = 'kg-sheet'; el.hidden = true; document.body.appendChild(el);
export function init(o) { if (o.changed) onChange = o.changed; }
export function open() { quest.settle(); const R = quest.realm(); sel = R.camp?.id || REGIONS.find(r => !R.held.includes(r.id))?.id || 'wood'; askRetreat = false; el.hidden = false; draw(); }
function close() { el.hidden = true; clearInterval(anim); }

/* ---------- the map: the kingdom as an island, built in 3D and seen from the same corner as the keep ---------- */
const W = 192, H = 112, ALL = [HOME, ...REGIONS], SEA = -1;
const SW = 256, SH = 160; // the screen
const mapSrc = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: SW, height: SH }) : null;
const hash = (x, y) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const owner = new Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // each spot belongs to the nearest region's heart, with ragged borders
  let best = 0, bd = 1e9;
  ALL.forEach((r, i) => { const d = (x - r.seed[0]) ** 2 + (y - r.seed[1]) ** 2 * 1.4 + (hash(x >> 3, y >> 3) - .5) * 700 + (hash(x >> 1, y >> 1) - .5) * 200; if (d < bd) { bd = d; best = i; } });
  // the coast: a ragged edge of sea all round
  const edge = Math.min(x, y, W - 1 - x, H - 1 - y) + (hash(x >> 2, y >> 2) - .5) * 6 + (hash(x >> 3, y >> 3) - .5) * 6;
  owner[y * W + x] = edge < 3 ? SEA : best;
}
const ownAt = (x, y) => x < 0 || y < 0 || x >= W || y >= H ? SEA : owner[(y | 0) * W + (x | 0)];
const LANDC = { vale: 0x567a3a, wood: 0x2c5a32, marsh: 0x5e6a3a, frost: 0x8a96a6, storm: 0x4a6a72, ember: 0x5a2c1e, spires: 0x5e5470, fog: 0x6a6478 };
const noise = (x, y) => Math.sin(x / 7.3) * Math.cos(y / 6.1) * 1.4 + Math.sin((x + y) / 4.1) * .8 + (hash(x >> 2, y >> 2) - .5) * 1.6;
function heightOf(id, x, y) {
  if (id === 'frost') return 4 + Math.max(0, noise(x * 1.6, y * 1.6) + 1.2) * 4.5 + hash(x >> 2, y >> 2) * 3;
  if (id === 'ember') return 1.4 + noise(x, y) * .7;
  if (id === 'marsh') return .5 + noise(x * 2, y * 2) * .45;
  if (id === 'storm') return .9 + noise(x, y) * .5;
  if (id === 'spires') return 2.4 + noise(x, y) * .6;
  if (id === 'wood') return 1.5 + noise(x, y) * .6;
  return 1.2 + noise(x, y) * .5;
}

let K = null; // the 3D map, made once the library has loaded
function build3d() {
  const T = window.THREE, { M, add, addJ, box, glow, jit, makeView } = k3;
  const view = makeView(SW, SH), scene = new T.Scene(); scene.background = new T.Color(0x1a2a40);
  const sun = new T.DirectionalLight(0xffffff, 1); sun.position.set(60, 110, 50); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 1, far: 400 }); scene.add(sun, sun.target);
  scene.add(new T.HemisphereLight(0xbcd8ff, 0x405020, .45));
  // the camera: the keep's corner view, a little higher, framing the whole island
  const A = .61, EL = 42 * Math.PI / 180, fw = 212, fh = fw * SH / SW;
  const cam = new T.OrthographicCamera(-fw / 2, fw / 2, fh / 2, -fh / 2, 1, 900), r = 300;
  cam.position.set(Math.sin(A) * r * Math.cos(EL), r * Math.sin(EL), Math.cos(A) * r * Math.cos(EL)); cam.lookAt(4, 0, -6);
  const wx = x => x - W / 2, wz = y => y - H / 2; // map spot to world
  // the sea, then the land: one colour per face, darker along the borders, heights smoothed across them
  add(new T.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), M(0x22487a), 0, 0, 0, scene, false);
  const S = 2, nx = W / S + 6, ny = H / S + 6, hts = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const x = (i - 3) * S, y = (j - 3) * S, o = ownAt(x, y); hts.push(o === SEA ? -2.5 : heightOf(ALL[o].id, x, y)); }
  const sm = hts.map((h, k) => { const i = k % (nx + 1), j = (k / (nx + 1)) | 0; let a = 0, n = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii > nx || jj > ny) continue; a += hts[jj * (nx + 1) + ii]; n++; } return ownAt((i - 3) * S, (j - 3) * S) === SEA ? Math.min(h, a / n) : a / n; });
  const geo = new T.PlaneGeometry(nx * S, ny * S, nx, ny); geo.rotateX(-Math.PI / 2); geo.translate(-W / 2 + (nx * S) / 2 - 3 * S, 0, -H / 2 + (ny * S) / 2 - 3 * S);
  { const p = geo.attributes.position; for (let k = 0; k < p.count; k++) p.setY(k, sm[k]); geo.computeVertexNormals(); }
  const land = geo.toNonIndexed(), cols = new Float32Array(land.attributes.position.count * 3);
  land.setAttribute('color', new T.BufferAttribute(cols, 3));
  const lm = add(land, new T.MeshToonMaterial({ vertexColors: true, gradientMap: M(0).gradientMap }), 0, 0, 0, scene, false); lm.receiveShadow = true;
  // things on the land: woods, peaks, pools, lava, spires, the coast's rocks; each region keeps its own group
  const deco = new Map(ALL.map(r => [r.id, new T.Group()])); deco.forEach(g => scene.add(g));
  const groundAt = (x, y) => { const i = Math.round(x / S) + 3, j = Math.round(y / S) + 3; return sm[Math.max(0, Math.min(ny, j)) * (nx + 1) + Math.max(0, Math.min(nx, i))]; };
  for (let k = 0; k < 900; k++) {
    const x = hash(k, 1) * W, y = hash(k, 2) * H, o = ownAt(x, y); if (o === SEA) continue;
    const id = ALL[o].id, g = deco.get(id), gy = groundAt(x, y), n = hash(k, 3);
    if (Math.hypot(x - ALL[o].seed[0], y - ALL[o].seed[1]) < 8) continue; // keep the heart clear for its banner
    if (id === 'wood' && n < .75) { addJ(new T.ConeGeometry(2.2, 5, 6), n < .4 ? 0x1e5a32 : 0x2e7a34, wx(x), gy + 2.5, wz(y), g, .08); }
    else if (id === 'vale' && n < .18) { addJ(new T.IcosahedronGeometry(1.8, 0), 0x2e7a34, wx(x), gy + 2, wz(y), g, .08); }
    else if (id === 'marsh' && n < .2) { add(new T.CylinderGeometry(1.4 + n * 6, 1.4 + n * 6, .2, 8), M(0x3a5a6a), wx(x), gy + .15, wz(y), g, false); }
    else if (id === 'marsh' && n < .45) { add(box(.3, 1.6, .3), M(0x8a9a48), wx(x), gy + .8, wz(y), g, false); }
    else if (id === 'frost' && n < .12) { addJ(new T.ConeGeometry(4 + n * 20, 7 + n * 30, 5), 0xe8eef6, wx(x), gy + 3 + n * 10, wz(y), g, .06); }
    else if (id === 'storm' && n < .2) { addJ(new T.DodecahedronGeometry(1.2 + n * 4, 0), 0x5a6a76, wx(x), gy + .6, wz(y), g, .1); }
    else if (id === 'ember' && n < .22) { add(box(2 + n * 8, .3, .7), glow(n < .1 ? 0xffa030 : 0xd84a10), wx(x), gy + .2, wz(y), g, false).rotation.y = n * 30; }
    else if (id === 'ember' && n < .3) { addJ(new T.ConeGeometry(2, 4, 5), 0x3a1a12, wx(x), gy + 2, wz(y), g, .1); }
    else if (id === 'spires' && n < .07) { const h = 10 + n * 160; addJ(new T.CylinderGeometry(.6, 2.6, h, 5), 0x6a5e80, wx(x), gy + h / 2, wz(y), g, .08); addJ(new T.ConeGeometry(.9, 3, 5), 0xc8b0f0, wx(x), gy + h + 1.2, wz(y), g, .05); }
  }
  // clouds over the regions you can't see yet
  const fogG = new Map(REGIONS.filter(r => r.locked).map(r => [r.id, new T.Group()]));
  fogG.forEach((g, id) => { const r = regionOf(id); scene.add(g); for (let k = 0; k < 18; k++) { const a = hash(k, 9) * Math.PI * 2, d = Math.sqrt(hash(k, 8)) * 15; add(new T.SphereGeometry(3 + hash(k, 7) * 3.5, 7, 5), M(0xc4c0d2), wx(r.seed[0] + Math.cos(a) * d), 11 + hash(k, 6) * 4, wz(r.seed[1] + Math.sin(a) * d * .7), g, true); } });
  // the gold border of the region you're looking at
  const borders = new Map(ALL.map((r, i) => { const v = []; for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { if (owner[y * W + x] !== i) continue; if (owner[y * W + x + 1] !== i) v.push(wx(x + 1), groundAt(x + 1, y) + .6, wz(y), wx(x + 1), groundAt(x + 1, y + 1) + .6, wz(y + 1)); if (owner[(y + 1) * W + x] !== i) v.push(wx(x), groundAt(x, y + 1) + .6, wz(y + 1), wx(x + 1), groundAt(x + 1, y + 1) + .6, wz(y + 1)); if (owner[y * W + x - 1] !== i) v.push(wx(x), groundAt(x, y) + .6, wz(y), wx(x), groundAt(x, y + 1) + .6, wz(y + 1)); if (owner[(y - 1) * W + x] !== i) v.push(wx(x), groundAt(x, y) + .6, wz(y), wx(x + 1), groundAt(x + 1, y) + .6, wz(y)); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(v, 3)); const l = new T.LineSegments(g, new T.LineBasicMaterial({ color: 0xe3b663 })); l.visible = false; scene.add(l); return [r.id, l]; }));
  // your castle in the vale
  const home = new T.Group(); { const [x, y] = HOME.seed; home.position.set(wx(x), groundAt(x, y), wz(y)); home.rotation.y = .3; scene.add(home); }
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) { addJ(new T.CylinderGeometry(1.3, 1.4, 6, 8), 0xa9a192, x, 3, z, home, .05); addJ(new T.ConeGeometry(1.8, 2.8, 8), 0x3a5cc0, x, 7.4, z, home, .04); }
  for (const [x, z, w, d] of [[0, -4, 8, 1], [0, 4, 8, 1], [-4, 0, 1, 8], [4, 0, 1, 8]]) addJ(box(w, 3.4, d), 0x8e887a, x, 1.7, z, home, .05);
  addJ(box(4.4, 8, 4.4), 0xa9a192, 0, 4, 0, home, .05); addJ(new T.ConeGeometry(3.6, 4, 4).rotateY(Math.PI / 4), 0x3a5cc0, 0, 10, 0, home, .04);
  // a marker on each region's heart: a banner, a camp, or the dragon's red flag
  const marks = new Map(), flags = [];
  const flag = (g, h, col, ink) => { add(new T.CylinderGeometry(.2, .2, h, 4), M(0x4e2e18), 0, h / 2, 0, g); const f = add(new T.PlaneGeometry(3.6, 2.2, 6, 1), M(col, { side: T.DoubleSide }), 1.8, h - 1.1, 0, g); f.userData.base = f.geometry.attributes.position.array.slice(); flags.push(f); if (ink != null) add(box(1, 1, .1), M(ink), 1.8, h - 1.1, .1, g, false); };
  for (const r of REGIONS) {
    const set = {}, [x, y] = r.seed, base = new T.Vector3(wx(x), groundAt(x, y), wz(y));
    const mk = f => { const g = new T.Group(); g.position.copy(base); g.visible = false; scene.add(g); f(g); return g; };
    set.held = mk(g => { for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) addJ(new T.CylinderGeometry(.9, 1, 4, 7), 0xa9a192, px, 2, pz, g, .05); addJ(box(3.4, 3, 3.4), 0x8e887a, 0, 1.5, 0, g, .05); const s = new T.Group(); s.position.y = 3; g.add(s); flag(s, 7, 0xe3b663, new T.Color(r.ink).getHex()); });
    set.camp = mk(g => { addJ(new T.ConeGeometry(2.4, 3.4, 6), 0xd8c8a0, -2, 1.7, 0, g, .05); addJ(new T.ConeGeometry(2, 3, 6), 0xd8c8a0, 2.4, 1.5, 1.6, g, .05); add(new T.ConeGeometry(.8, 1.8, 5), glow(0xffa030), 0, .9, 3, g, false); const s = new T.Group(); s.position.set(-4, 0, -1); g.add(s); flag(s, 8, 0xe3b663); });
    set.foe = mk(g => flag(g, 8, 0xc83a22));
    marks.set(r.id, set);
  }
  // a little dragon that circles the region you're looking at
  const drg = new T.Group(); scene.add(drg); const RED = 0xc83a22;
  { const b = addJ(new T.SphereGeometry(1.6, 7, 5), RED, 0, 0, 0, drg, .06); b.scale.set(1, .8, 1.6); addJ(new T.SphereGeometry(.9, 6, 4), RED, 0, .8, 2.6, drg, .05); addJ(box(1.2, .9, 1.8), RED, 0, 1.1, 3.6, drg, .05); addJ(new T.ConeGeometry(.5, 3.4, 5).rotateX(-Math.PI / 2), 0x8a2214, 0, 0, -3.4, drg, .05); }
  const wings = [-1, 1].map(s => { const g = new T.Group(); g.position.set(s * .8, .5, .2); drg.add(g); const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute([0, 0, 1.2, s * 6, 0, -.4, 0, 0, -1.4, s * 6, 0, -.4, s * 3.4, 0, -2.4, 0, 0, -1.4], 3)); geo.computeVertexNormals(); add(geo, M(0x9a2a1a, { side: T.DoubleSide }), 0, 0, 0, g); return g; });
  drg.scale.setScalar(1.3);
  // rain over the storm coast, and the ember glow
  const st = regionOf('storm'), n = 60, pos = new Float32Array(n * 6);
  for (let k = 0; k < n; k++) { const x = wx(st.seed[0] + (hash(k, 11) - .5) * 50), y = hash(k, 12) * 26, z = wz(st.seed[1] + (hash(k, 13) - .5) * 40); pos.set([x, y, z, x + .6, y - 2.4, z + .3], k * 6); }
  const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.BufferAttribute(pos, 3)); const rain = new T.LineSegments(rg, new T.LineBasicMaterial({ color: 0x6a84a8 })); scene.add(rain);
  const ray = new T.Raycaster(), lmFaces = land.attributes.position.count / 3;
  K = { view, scene, cam, land, cols, lm, lmFaces, deco, fogG, borders, marks, flags, drg, wings, rain, ray, wx, wz, groundAt, last: '' };
}
/** Colours the land for who holds what: hidden regions go grey under cloud. */
function colour(heldN) {
  const T = window.THREE, p = K.land.attributes.position, c = new T.Color();
  for (let f = 0; f < K.lmFaces; f++) {
    let x = 0, z = 0, y = 0; for (let k = 0; k < 3; k++) { x += p.getX(f * 3 + k); y += p.getY(f * 3 + k); z += p.getZ(f * 3 + k); } x = x / 3 + W / 2; z = z / 3 + H / 2; y /= 3;
    const o = ownAt(x, z), r = o === SEA ? null : ALL[o], fog = r?.locked && heldN < r.locked;
    if (!r) c.setHex(y > -1.2 ? 0xb8a87a : 0x22487a); // sand on the shore
    else { c.setHex(LANDC[fog ? 'fog' : r.id]); if (r.id === 'frost' && y > 10) c.setHex(0xe8eef6); }
    const edge = r && [[2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dz]) => ownAt(x + dx, z + dz) !== o && ownAt(x + dx, z + dz) !== SEA);
    const k = (edge ? .55 : 1) * (1 + (hash(f, 5) - .5) * .1);
    for (let v = 0; v < 3; v++) { K.cols[(f * 3 + v) * 3] = c.r * k; K.cols[(f * 3 + v) * 3 + 1] = c.g * k; K.cols[(f * 3 + v) * 3 + 2] = c.b * k; }
  }
  K.land.attributes.color.needsUpdate = true;
}
function paint(cv, R, t) {
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
  if (!K) { c.fillStyle = '#101820'; c.fillRect(0, 0, SW, SH); return; }
  const held = new Set(R.held), campId = R.camp?.id, s = t * .08;
  const key = R.held.join() + '|' + campId; if (key !== K.last) { K.last = key; colour(R.held.length); }
  K.fogG.forEach((g, id) => { g.visible = R.held.length < regionOf(id).locked; g.children.forEach((m, i) => { m.position.x += Math.sin(s + i) * .02; }); });
  for (const r of REGIONS) { const m = K.marks.get(r.id), fog = r.locked && R.held.length < r.locked; m.held.visible = held.has(r.id); m.camp.visible = !held.has(r.id) && r.id === campId; m.foe.visible = !held.has(r.id) && r.id !== campId && !fog; }
  K.borders.forEach((l, id) => { l.visible = id === sel && (t | 0) % 6 < 4; });
  K.flags.forEach((f, i) => { const p = f.geometry.attributes.position, b = f.userData.base; for (let k = 0; k < p.count; k++) p.setZ(k, b[k * 3 + 2] + Math.sin(s * 6 + b[k * 3] * 1.5 + i) * .3 * (b[k * 3] + 1.8) / 3.6); p.needsUpdate = true; });
  const r = regionOf(sel); K.drg.visible = !!r && !held.has(sel);
  if (K.drg.visible) { const a = s * 1.4, [x, y] = r.seed; K.drg.position.set(K.wx(x) + Math.cos(a) * 12, K.groundAt(x, y) + 16 + Math.sin(s * 3), K.wz(y) + Math.sin(a) * 9); K.drg.rotation.set(0, -a, .3); K.wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * Math.sin(s * 9) * .6; }); }
  K.rain.position.y = -((s * 30) % 10);
  c.drawImage(K.view.render(K.scene, K.cam), 0, 0);
}
/** Which region a tap on the map lands on. */
function regionAtTap(cv, e) {
  if (!K) return null; const T = window.THREE, b = cv.getBoundingClientRect();
  K.ray.setFromCamera(new T.Vector2((e.clientX - b.left) / b.width * 2 - 1, -((e.clientY - b.top) / b.height * 2 - 1)), K.cam);
  const hit = K.ray.intersectObject(K.lm)[0]; if (!hit) return null;
  const o = ownAt(hit.point.x + W / 2, hit.point.z + H / 2); return o === SEA ? null : ALL[o];
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
    <div class="kg-map"><div id="kg-map"></div><span class="kg-held">${R.held.length} of ${REGIONS.length} held</span></div>
    <div class="kg-picks">${REGIONS.map(r => `<button class="kg-pick${r.id === sel ? ' on' : ''}${R.held.includes(r.id) ? ' held' : ''}" data-kg="pick" data-id="${r.id}">${esc(r.name)}</button>`).join('')}</div>
    ${regionCard(R)}
    <div class="kg-titles">${TITLES.map((t, i) => `<span class="${i === rank ? 'cur' : i < rank ? 'past' : ''}">${esc(t)}</span>`).join('<i>›</i>')}</div>
  </div>`;
  const scr = screen('map', SW, SH), cv = scr.cv; paint(mapSrc, R, tick); scr.show(mapSrc); mount(scr, el.querySelector('#kg-map'), 'Map of the kingdom');
  if (!K) k3.whenReady(() => { if (!K && window.THREE) { build3d(); if (!el.hidden) draw(); } });
  clearInterval(anim); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) anim = setInterval(() => { if (el.hidden || !cv.isConnected) { clearInterval(anim); return; } tick += 1; paint(mapSrc, R, tick); scr.show(mapSrc); }, 80);
  cv.onclick = e => { const r = regionAtTap(cv, e); if (r && r.id !== 'vale') { sel = r.id; askRetreat = false; draw(); } };
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
