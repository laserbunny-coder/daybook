// Hold the Keep's picture, built in 3D and drawn tiny: a 256 x 112 strip seen from a corner at three-quarter height,
// lit in hard steps with a dark ink line where depth jumps, then shown through crt.js's old TV. The keep and village
// stand left of centre; the dragon's nest is on a crag to the right, and it flies over to circle and dive.
// three.js (r128, MIT) is in js/vendor and loads the first time the picture is wanted.
export const SW = 256, SH = 128;
export const SWOOP = 34, RECKON = 44; // how long a dive and the midnight reckoning last, in ticks (180ms each)
export const phaseOf = m => m < 6 * 60 || m >= 21 * 60 ? 'night' : m < 8 * 60 ? 'dawn' : m < 18 * 60 ? 'day' : 'dusk';

/** Knobs for trying looks (lab.html): villager size, ink strength (0 = none), and how many steps of light. */
export const LOOK = { folk: .7, ink: 2.5, steps: 6 }; // Michael's pick in the look lab
let PW = SW; // the picture's width in pixels: the canvas it is painted into decides it, and the land always spans the same view
let H = SH, FIT = 1; // the picture's height right now (the person can make it taller), and the zoom that keeps the land filling a tall one
let THREE = null, ready = false, loading = false, failed = false, glLost = false;
const waiting = [];
function load() {
  if (ready || loading || failed || typeof document === 'undefined') return;
  loading = true;
  const s = document.createElement('script'); s.src = new URL('./vendor/three.min.js', import.meta.url).href;
  s.onload = () => { THREE = window.THREE; try { init(); ready = true; } catch (e) { console.warn('keep3d', e); failed = true; } loading = false; waiting.splice(0).forEach(f => f()); };
  s.onerror = () => { loading = false; failed = true; };
  document.head.appendChild(s);
}
/** Call f once the 3D library has loaded (the first picture is blank until then). */
export const whenReady = f => { load(); if (ready || failed) f(); else waiting.push(f); };

/** A ribbon following the river's bends, w wide, at height y. */
function river(w, y, hex) {
  const v = [];
  for (let sz = -330; sz < 330; sz += 3) {
    const pts = [sz, sz + 3].map(z => { const x = riverX(z), d = (riverX(z + .5) - riverX(z - .5)), n = Math.hypot(1, d); return [[x - w / 2 / n, z + d * w / 2 / n], [x + w / 2 / n, z - d * w / 2 / n]].map(q => at(...q)); });
    const [[a, b], [c, e]] = pts; v.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1], b[0], y, b[1], c[0], y, c[1], e[0], y, e[1]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, M(hex, { side: THREE.DoubleSide })); m.receiveShadow = true; return m;
}
const rnd = i => Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1;
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => k * k * (3 - 2 * k);

/* ---------- the map, in screen terms: sx runs right, sz runs toward you along the ground ---------- */
const A = .61, EL = 36 * Math.PI / 180; // the corner turn and the camera's height
const RX = Math.cos(A), RZ = -Math.sin(A), FX = Math.sin(A), FZ = Math.cos(A);
const at = (sx, sz) => [sx * RX + sz * FX, sx * RZ + sz * FZ]; // screen spot to world x, z
const NEST = [46, -12], NEST_Y = 10;
const FAR = 1500, INK = .0025 * 600 / FAR; // the camera sits far back so a low look still sees the near ground; the ink's depth step scales with it
/** Where the river runs: across the screen at sx near -47, winding as it goes, but straight where the bridge crosses it. */
function riverX(sz) {
  const k = Math.min(1, Math.max(0, (Math.abs(sz - CROSS()) - 8) / 30));
  return -47 + (16 * Math.sin(sz * .031 + .6) + 8 * Math.sin(sz * .077 + 2) + 4 * Math.sin(sz * .17)) * k * k * (3 - 2 * k);
}
let crossZ = null; const CROSS = () => crossZ ?? (crossZ = at2s(0, 30)[1]);
const SPOT = { Tent: [30, 14], Hut: [-26, -20], Well: [-32, 4], Farm: [14, -34], Watchtower: [-38, -30], Mill: [40, 30], Smithy: [12, 36], Market: [-36, 40] };
const PILES = [[22, 26], [-26, 18], [40, 4], [-36, -6], [28, -20], [-14, 38], [48, 42], [-40, 26], [0, -36], [26, 42], [-18, -40], [58, 12]];
const pileAt = slot => PILES[slot % PILES.length];
const GATE = [0, 0, 19]; // world: the keep faces +z, so from the corner the gate is to the front left

/* ---------- materials: light in three hard steps, and stone and wood get a little colour per face ---------- */
let grad, VC, GROUND, under;
const mats = new Map();
export const M = (hex, o = {}) => { const k = hex + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshToonMaterial({ color: hex, gradientMap: grad, ...o })); return mats.get(k); };
let seed = 1;
export function jit(geo, hex, amt = .06) { // one colour per face, nudged lighter or darker
  const g = geo.index ? geo.toNonIndexed() : geo, n = g.attributes.position.count, col = new THREE.Color(hex), out = new Float32Array(n * 3);
  for (let f = 0; f < n; f += 3) { const k = 1 + (rnd(seed++) - .5) * 2 * amt; for (let j = 0; j < 3; j++) { out[(f + j) * 3] = col.r * k; out[(f + j) * 3 + 1] = col.g * k; out[(f + j) * 3 + 2] = col.b * k; } }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3)); return g;
}
const C = { grass: 0x4e7c38, dirt: 0x8a6440, stone: 0x9c9486, stone2: 0x8e887a, rock: 0x7a7066, roofB: 0x3a5cc0, roofR: 0xb83c2a, thatch: 0xb08a44, wood: 0x7a4a26, wood2: 0x4e2e18, leaf: 0x2e7a34, leaf2: 0x3e8e3a, pine: 0x1e5a32, cream: 0xcfbe98, gold: 0xe8b830, glass: 0x2a2030, red: 0xd03020, water: 0x2e5cae };
const LAND = { vale: 0x4e7c38, wood: 0x2e6a30, marsh: 0x5e6a30, frost: 0x9aaab8, storm: 0x3e5a48, ember: 0x5a3e2a, spires: 0x4a4070 };
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export function add(geo, mat, x, y, z, parent, shadow = true) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; }
export const addJ = (geo, hex, x, y, z, parent, amt) => add(jit(geo, hex, amt), VC, x, y, z, parent);
export const glow = o => new THREE.MeshBasicMaterial({ color: o });

const INK_FS = `precision highp float; varying vec2 vq; uniform sampler2D tex, dep; uniform vec2 res; uniform float thr;
    float D(vec2 o){ return texture2D(dep, vq + o / res).r; }
    void main(){ vec3 c = texture2D(tex, vq).rgb; float d = D(vec2(0.)), e = 0.;
      float r = D(vec2(1.,0.)), l = D(vec2(-1.,0.)), u = D(vec2(0.,1.)), w = D(vec2(0.,-1.));
      // how far this pixel sits behind a neighbour, beyond what the slope of the surface explains (so ground seen low isn't inked)
      e = max(max(e, (d - r) - max(l - d, 0.)), max((d - l) - max(r - d, 0.), max((d - u) - max(w - d, 0.), (d - w) - max(u - d, 0.))));
      if (e > thr && d < .9999) c *= .28; gl_FragColor = vec4(c, 1.); }`;
/** The ink pass: darkens a pixel that sits just behind a nearer edge, so shapes get a 1px outline. */
function inkPass(target, thr = .0025) {
  return new THREE.ShaderMaterial({ uniforms: { tex: { value: target.texture }, dep: { value: target.depthTexture }, res: { value: new THREE.Vector2(target.width, target.height) }, thr: { value: thr } },
    vertexShader: 'varying vec2 vq; void main(){ vq = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: INK_FS });
}
/** A small screen of its own (w x h pixels) for another 3D picture, drawn the same way: stepped light, ink edges.
    Only after whenReady. render(scene, cam) returns the canvas to copy from, or null while the phone has dropped it. */
export function makeView(w, h) {
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: false, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(w, h, false);
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.BasicShadowMap;
  const t = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  t.depthTexture = new THREE.DepthTexture(w, h); t.depthTexture.type = THREE.UnsignedIntType;
  const q = new THREE.Scene(), qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); q.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), inkPass(t)));
  let lost = false; cv.addEventListener('webglcontextlost', () => { lost = true; }); cv.addEventListener('webglcontextrestored', () => { lost = false; });
  let t2 = t;
  return { canvas: cv, render(sc, c) { if (lost) return null; r.setRenderTarget(t2); r.render(sc, c); r.setRenderTarget(null); r.render(q, qc); return cv; },
    size(w2, h2) { // a taller or shorter screen, same pixels across
      if (t2.width === w2 && t2.height === h2) return; r.setSize(w2, h2, false); t2.dispose(); t2.depthTexture.dispose();
      t2 = new THREE.WebGLRenderTarget(w2, h2, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      t2.depthTexture = new THREE.DepthTexture(w2, h2); t2.depthTexture.type = THREE.UnsignedIntType; q.children[0].material = inkPass(t2);
    } };
}

/* ---------- the scene ---------- */
let R, scene, cam, sun, amb, rt, POST, quad, qs, qcam, out;
let hfolk, ground, groundGeo, landNow = '', village, piles, castle, dragon, nest, fxG, hoardG, ringM, rain;
const flags = [], smokes = [], torches = [], fires = [], embers = [], coins = [], sparks = [], folk = [];
let WIN; // the shared window glass, lit up at night
function init() {
  out = document.createElement('canvas'); out.width = PW; out.height = SH;
  R = new THREE.WebGLRenderer({ canvas: out, antialias: false, preserveDrawingBuffer: true });
  // while the phone has dropped the 3D screen, keep showing the last picture; three.js rebuilds it when it comes back
  out.addEventListener('webglcontextlost', () => { glLost = true; }); out.addEventListener('webglcontextrestored', () => { glLost = false; });
  R.setPixelRatio(1); R.setSize(PW, SH, false); R.shadowMap.enabled = true; R.shadowMap.type = THREE.BasicShadowMap;
  grad = new THREE.DataTexture(new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
  VC = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad }); GROUND = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad, side: THREE.DoubleSide });
  WIN = M(0xffd070, { emissive: 0x402000 });
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a4a20);
  sun = new THREE.DirectionalLight(0xffffff, 1); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 320 }); scene.add(sun, sun.target);
  amb = new THREE.HemisphereLight(0xbcd8ff, 0x405020, .45); scene.add(amb);
  // the camera: high on a corner, looking a little right of the keep so the crag fits
  const k = 105 / 224 / .8; cam = new THREE.OrthographicCamera(-SW / 2 * k, SW / 2 * k, SH / 2 * k, -SH / 2 * k, 1, FAR);
  aim();
  // render small, then ink the edges where depth jumps
  rt = new THREE.WebGLRenderTarget(PW, SH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  rt.depthTexture = new THREE.DepthTexture(PW, SH); rt.depthTexture.type = THREE.UnsignedIntType;
  POST = inkPass(rt, INK); aimed = '';
  qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), POST); qs = new THREE.Scene(); qs.add(quad);

  // ground, river, roads and the crag never change
  groundGeo = new THREE.PlaneGeometry(640, 640, 128, 128); groundGeo.rotateX(-Math.PI / 2); // wide enough that zooming out or turning never reaches its edge
  { const p = groundGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, ht(p.getX(i), p.getZ(i))); groundGeo = groundGeo.toNonIndexed(); groundGeo.computeVertexNormals(); }
  setLand('vale');
  const strip = (a, b, w, mat, y = .08) => { const [ax, az] = at(...a), [bx, bz] = at(...b), m = add(box(w, .12, Math.hypot(bx - ax, bz - az)), mat, (ax + bx) / 2, y, (az + bz) / 2, scene, false); m.rotation.y = Math.atan2(bx - ax, bz - az); return m; };
  scene.add(river(9, .05, 0x6a5a40), river(7, .14, C.water)); // the river and its banks
  { const m = add(box(6, .14, 60), M(C.dirt), 0, .08, 49, scene, false); } // the road south from the gate
  strip(at2s(0, 30), [-62, at2s(0, 30)[1]], 5, M(C.dirt)); // and west to the bridge
  { const [x, z] = at(-47, at2s(0, 30)[1]), b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = -A; scene.add(b);
    addJ(box(11, .6, 6), C.wood, 0, .7, 0, b, .1); for (const s of [-1, 1]) add(box(11, .8, .4), M(C.wood2), 0, 1.4, s * 2.8, b); }
  // the crag, with the nest and the dragon's hoard on top
  nest = new THREE.Group(); { const [x, z] = at(...NEST); nest.position.set(x, 0, z); } scene.add(nest);
  [[0, 3, 0, 7], [-3, 2, 3, 5], [3, 2, 2, 5], [0, 6.5, 0, 6], [2, 8.5, -1, 4.5], [-4, 1.5, -3, 4]].forEach(([x, y, z, r], i) => addJ(new THREE.DodecahedronGeometry(r, 0), i % 2 ? C.rock : 0x8a8074, x, y, z, nest, .1));
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; add(box(.5, .5, 3.6), M(i % 2 ? C.wood : C.wood2), Math.cos(a) * 3.4, NEST_Y + .4, Math.sin(a) * 3.4, nest).rotation.y = -a + .4; }
  hoardG = new THREE.Group(); hoardG.position.y = NEST_Y + .2; nest.add(hoardG);
  for (const [x, z] of [[-6, 4], [5, 6], [6, -3]]) add(new THREE.ConeGeometry(1.2, 3.4, 6), M(C.pine), x, 1.7, z, nest);

  village = new THREE.Group(); scene.add(village); castle = new THREE.Group(); scene.add(castle);
  piles = new THREE.Group(); scene.add(piles); fxG = new THREE.Group(); scene.add(fxG);
  ringM = new THREE.Mesh(new THREE.RingGeometry(4.2, 5, 20).rotateX(-Math.PI / 2), glow(0xffd060)); ringM.visible = false; scene.add(ringM);
  // little lights that come and go: two torches by the gate, fires for burnt buildings and the campfire
  for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffa040, 0, 13, 2), f = add(new THREE.ConeGeometry(.35, .9, 5), glow(0xffc040), 0, 0, 0, scene, false); scene.add(l); torches.push({ l, f }); }
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xff6020, 0, 26, 1.4); scene.add(l); const g = new THREE.Group(); g.visible = false; scene.add(g);
    for (let j = 0; j < 9; j++) { const m = add(box(.9, .9, .9), glow(j % 3 ? 0xff7020 : 0xffd040), 0, 0, 0, g, false); m.userData = { k: j / 9, a: rnd(j + i * 9) * 6.28 }; embers.push(m); }
    fires.push({ l, g }); }
  for (let i = 0; i < 12; i++) { const m = add(new THREE.CylinderGeometry(.6, .6, .25, 8), M(C.gold, { emissive: 0x403000 }), 0, -9, 0, fxG, false); coins.push(m); }
  for (let i = 0; i < 12; i++) { sparks.push(add(box(.6, .6, .6), glow(i % 2 ? 0xfff0a0 : 0xffffff), 0, -9, 0, fxG, false)); }
  for (const skin of [0xd8b080, 0xb07040, 0xe0c090]) { const g = new THREE.Group(); scene.add(g); add(new THREE.CylinderGeometry(.6, .8, 1.8, 6), M([0x3a6ad0, 0x7a3a8a, 0x3a8a4a][folk.length]), 0, .9, 0, g); add(new THREE.SphereGeometry(.65, 6, 5), M(skin), 0, 2.3, 0, g); folk.push(g); }
  const n = 260, pos = new Float32Array(n * 6); for (let i = 0; i < n; i++) { const x = (rnd(i) - .5) * 180, y = rnd(i + 7) * 60, z = (rnd(i + 13) - .5) * 180; pos.set([x, y, z, x + .8, y - 3, z + .4], i * 6); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x6a80a8 })); rain.visible = false; scene.add(rain);
  dragon = buildDragon(); scene.add(dragon);
  hfolk = new THREE.Group(); scene.add(hfolk);
  trees();
}
function at2s(wx, wz) { return [wx * RX + wz * RZ, wx * FX + wz * FZ]; } // world x, z back to a screen spot
function setLand(land) {
  if (land === landNow) return; landNow = land;
  if (ground) scene.remove(ground);
  // one colour per face: the land's own green in light and dark patches, bare earth here and there, rock on the steep hillsides
  const g = groundGeo.clone(), p = g.attributes.position, nm = g.attributes.normal, out = new Float32Array(p.count * 3);
  const base = new THREE.Color(LAND[land] || LAND.vale), rock = new THREE.Color(0x7d7468), earth = new THREE.Color(0x7a6040), c = new THREE.Color();
  for (let f = 0; f < p.count; f += 3) {
    const x = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3, z = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3, y = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3;
    const steep = 1 - nm.getY(f), patch = vn(x, z, 23), fine = vn(x + 50, z, 7);
    c.copy(base).multiplyScalar(.82 + patch * .32 + (fine - .5) * .1 + Math.min(.12, y * .006)); // lighter up high, in soft patches
    if (fine > .78 && patch < .45 && y < 3) c.lerp(earth, .45);
    if (steep > .26) c.lerp(rock, Math.min(.85, (steep - .26) * 4));
    c.multiplyScalar(1 + (rnd(f) - .5) * .06);
    for (let k = 0; k < 9; k++) out[f * 3 + k] = [c.r, c.g, c.b][k % 3];
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  if (!under) { under = add(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ gradientMap: grad }), 0, -40, 0, scene, false); under.receiveShadow = false; }
  under.material.color.copy(base).multiplyScalar(.8); // far below, lit like the land, so whatever the near cut opens up reads as more ground
  ground = add(g, GROUND, 0, 0, 0, scene, false); // both sides, so where the near cut slices a hill its inside shows as earth, not sky
}

/* trees fill the open meadow, clear of the keep, the roads, the river, the crag, the buildings and the gold */
function free(sx, sz, pad) {
  const [wx, wz] = at(sx, sz);
  if (Math.abs(wx) < 22 + pad && Math.abs(wz) < 22 + pad) return false;
  if (Math.abs(sx - riverX(sz)) < 7 + pad) return false;
  if (Math.abs(wx) < 4 + pad && wz > 17) return false;
  const cross = at2s(0, 30)[1]; if (Math.abs(sz - cross) < 4 + pad && sx < -10 && sx > -64) return false;
  if (Math.hypot(sx - NEST[0], sz - NEST[1]) < 11 + pad) return false;
  if (Object.values(SPOT).some(([x, z]) => Math.hypot(sx - x, sz - z) < 9 + pad)) return false;
  if (PILES.some(([x, z]) => Math.hypot(sx - x, sz - z) < 5 + pad)) return false;
  return true;
}
// smooth value noise, for hills and colour patches
function vn(x, z, k) { x /= k; z /= k; const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, f = t => t * t * (3 - 2 * t), h = (a, b) => rnd(a * 157 + b * 311 + 7);
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1); return a + (b - a) * f(u) + (c - a) * f(v) + (a - b - c + d) * f(u) * f(v); }
/** The ground's height at world x, z: nearly flat where the village stands, rising into rolling hills and ridges beyond
    it, with the river keeping its valley. */
function ht(x, z) {
  const sx = x * RX + z * RZ, sz = x * FX + z * FZ, out = Math.max(Math.abs(sx) / 74, Math.abs(sz) / 58);
  const rd = Math.abs(sx - riverX(sz)), rise = Math.max(0, Math.min(1, (out - .95) * 1.6)), valley = Math.min(1, Math.max(0, (rd - 7) / 26));
  const bump = Math.sin(x * .15) * Math.cos(z * .12) * .3 + rise * (vn(x, z, 18) - .5) * 1.6;
  const hills = vn(x, z, 46) * 22 + vn(x + 300, z, 19) * 9 + Math.max(0, vn(x, z + 200, 31) - .55) * 40; // rolling hills, and a few sharp ridges
  // gentle rises in the meadow too, but only well clear of everything that stands on the ground
  const y = bump + rise * rise * hills * valley + (1 - rise) * Math.max(0, vn(x + 90, z, 20) - .4) * 7 * clear(sx, sz, x, z, rd);
  return rd < 6 ? Math.min(y, 0) : y; // the river always shows
}
/** 0 on or near the keep, the buildings, the gold, the crag, the roads and the river, rising to 1 well away from them. */
function clear(sx, sz, x, z, rd) {
  let d = Math.min(Math.hypot(x, z) - 40, rd - 9, Math.hypot(sx - NEST[0], sz - NEST[1]) - 15);
  for (const [px, pz] of Object.values(SPOT)) d = Math.min(d, Math.hypot(sx - px, sz - pz) - 12);
  for (const [px, pz] of PILES) d = Math.min(d, Math.hypot(sx - px, sz - pz) - 8);
  d = Math.min(d, (z > 17 ? Math.abs(x) : Math.hypot(x, z - 17)) - 7); // the road south
  if (sx < at2s(0, 30)[0] + 4 && sx > -70) d = Math.min(d, Math.abs(sz - CROSS()) - 7); // the road west
  return Math.max(0, Math.min(1, d / 12));
}
// woods beyond the meadow: thicker where this gentle noise is high, so they gather into groves rather than an even scatter
const wood = (sx, sz) => Math.sin(sx * .045 + 1.3) * Math.cos(sz * .05 - .7) + Math.sin((sx + sz) * .021) * .6;
/** Many small static things as one mesh, so the phone draws them all at once. */
function merge(groups) {
  const parts = [];
  for (const g of groups) {
    g.updateMatrixWorld(true);
    g.traverse(o => { if (!o.isMesh) return; let geo = o.geometry.attributes.color ? (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()) : jit(o.geometry.clone(), o.material.color.getHex(), .04); geo.applyMatrix4(o.matrixWorld); parts.push(geo); });
  }
  const n = parts.reduce((a, p) => a + p.attributes.position.count, 0), out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'color']) { const arr = new Float32Array(n * 3); let o = 0; for (const p of parts) { arr.set(p.attributes[k].array, o); o += p.attributes[k].array.length; } out.setAttribute(k, new THREE.BufferAttribute(arr, 3)); }
  return out;
}
function trees() {
  const forest = [], placed = [], near = (sx, sz, d) => placed.some(([x, z]) => Math.hypot(x - sx, z - sz) < d);
  const tree = (sx, sz, i) => {
    placed.push([sx, sz]); const [x, z] = at(sx, sz), t = new THREE.Group(), r = rnd(i), big = Math.max(Math.abs(sx) / 70, Math.abs(sz) / 54) > 1.3 ? .35 : 0;
    t.position.set(x, ht(x, z) - .3, z); t.scale.set(1, 1, 1).multiplyScalar(.6 + r * .7 + big * rnd(i + 3)); t.scale.y *= .85 + rnd(i + 5) * .5; t.rotation.y = rnd(i + 9) * 6.28; forest.push(t); // young saplings to old giants
    add(new THREE.CylinderGeometry(.45, .7, 3, 6), M(C.wood), 0, 1.5, 0, t);
    if (i % 3 === 0 || ht(x, z) > 9) { for (let j = 0; j < 3; j++) addJ(new THREE.ConeGeometry(3.2 - j * .7, 4.4 - j * .4, 6), C.pine, 0, 4 + j * 1.7, 0, t, .07); return; }
    [[0, 5, 0, 3], [-1.6, 4.4, 1, 2.2], [1.5, 6.2, -.6, 2.1]].forEach(([bx, by, bz, r], j) => addJ(new THREE.IcosahedronGeometry(r, 0), j % 2 ? C.leaf2 : C.leaf, bx, by, bz, t, .08));
  };
  // the meadow around the village: a light scatter
  for (let i = 0; i < 400 && placed.length < 34; i++) { const sx = -66 + rnd(i + 70) * 136, sz = -50 + rnd(i + 170) * 100; if (free(sx, sz, 2) && !near(sx, sz, 7)) tree(sx, sz, i); }
  // and the woods all around it, out past where the camera can go
  for (let i = 0; i < 2600 && placed.length < 190; i++) {
    const sx = -240 + rnd(i + 900) * 480, sz = -190 + rnd(i + 3100) * 380, out = Math.max(Math.abs(sx) / 70, Math.abs(sz) / 54);
    if (out < 1 || Math.abs(sx - riverX(sz)) < 9 || wood(sx, sz) < .15 - Math.min(.5, (out - 1) * .25) || near(sx, sz, 6.5)) continue;
    tree(sx, sz, i + 500);
  }
  // a few boulders among the grass, and rocky outcrops up on the hills: a big stone with smaller ones leaning on it
  for (let i = 0; i < 18; i++) { const sx = -150 + rnd(i + 77) * 300, sz = -120 + rnd(i + 99) * 240; if (!free(sx, sz, 3) || near(sx, sz, 5)) continue; const [x, z] = at(sx, sz), b = new THREE.Group(); addJ(new THREE.DodecahedronGeometry(1.2 + rnd(i) * 1.4, 0), i % 2 ? C.rock : 0x8a8074, x, ht(x, z) + .6, z, b, .1); forest.push(b); }
  for (let i = 0, n = 0; i < 600 && n < 26; i++) {
    const sx = -230 + rnd(i + 4400) * 460, sz = -180 + rnd(i + 5400) * 360, [x, z] = at(sx, sz), y = ht(x, z);
    if (y < 5 || near(sx, sz, 8)) continue; n++; placed.push([sx, sz]);
    const b = new THREE.Group(); b.position.set(x, y, z); b.rotation.y = rnd(i) * 6.28; forest.push(b);
    const s = 2.4 + rnd(i + 1) * 3.2; addJ(new THREE.DodecahedronGeometry(s, 0), C.rock, 0, s * .45, 0, b, .12).scale.set(1, .7 + rnd(i + 2) * .6, 1);
    for (let j = 0; j < 3; j++) { const a = j * 2.1 + rnd(i + j) * 1.4, r2 = s * (.35 + rnd(i + j + 7) * .3); addJ(new THREE.DodecahedronGeometry(r2, 0), j % 2 ? 0x8a8074 : C.rock, Math.cos(a) * s * .9, r2 * .4, Math.sin(a) * s * .9, b, .12); }
  }
  // low mountains far off all round, hazy blue-grey with the odd snowy top: lumpy ridges, not cones
  const haze = new THREE.Color(0x8c94a8), snow = new THREE.Color(0xe4eaf2), cc = new THREE.Color();
  for (let i = 0; i < 34; i++) {
    const a = i / 34 * Math.PI * 2 + rnd(i + 6000) * .15, r = 300 + rnd(i + 6100) * 40, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 26 + rnd(i + 6300) * 22, h = 18 + rnd(i + 6200) * 26, m = new THREE.Group(); m.position.set(x, ht(x, z) - 6, z); m.rotation.y = -a; forest.push(m);
    const geo = new THREE.IcosahedronGeometry(1, 2), p = geo.attributes.position, col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) { // squash into a ridge, push the surface in and out, and flatten the bottom
      const vx = p.getX(k), vy = p.getY(k), vz = p.getZ(k), n = 1 + (rnd(Math.round((vx * 7 + vy * 13 + vz * 17) * 10) + i * 97) - .5) * .35;
      p.setXYZ(k, vx * w * n, Math.max(0, vy) * h * n * (1 + Math.cos(vx * 2.4 + i) * .25), vz * w * .55 * n);
    }
    geo.computeVertexNormals();
    for (let f = 0; f < p.count; f += 3) { const y = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3; cc.copy(haze).multiplyScalar(.9 + rnd(f + i) * .14); if (h > 34 && y > h * .78) cc.lerp(snow, .85); for (let v = 0; v < 3; v++) col.set([cc.r, cc.g, cc.b], (f + v) * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); add(geo, VC, 0, 0, 0, m, false);
  }
  add(merge(forest), VC, 0, 0, 0, scene);
}

/* ---------- the keep: 0 campfire, 1 wooden fort, 2 stone keep, 3 with its great hall, 4 walls and towers, 5 banners, 6 castle ---------- */
function stageOf(b) { return b.includes('Castle') ? 6 : b.includes('Castle walls') ? (b.includes('Great hall') ? 5 : 4) : b.includes('Stone keep') ? (b.includes('Great hall') ? 3 : 2) : b.length >= 6 ? 1 : 0; }
function crenels(g, w, d, y, s, hex) { for (let x = -w / 2 + s * .4; x <= w / 2 + .01; x += s * 2) { add(box(s, s, s), M(hex), x, y, -d / 2, g); add(box(s, s, s), M(hex), x, y, d / 2, g); } for (let z = -d / 2 + s * 2.4; z <= d / 2 - s; z += s * 2) { add(box(s, s, s), M(hex), -w / 2, y, z, g); add(box(s, s, s), M(hex), w / 2, y, z, g); } }
function flag(g, x, y, z, col, size = 1) { add(new THREE.CylinderGeometry(.12, .12, 3 * size, 4), M(C.wood2), x, y + 1.5 * size, z, g); const f = add(new THREE.PlaneGeometry(2.2 * size, 1.2 * size, 5, 1), M(col, { side: THREE.DoubleSide }), x + 1.1 * size, y + 2.4 * size, z, g); f.userData.base = f.geometry.attributes.position.array.slice(); flags.push(f); }
function tower(g, x, z, r, h, roof) {
  addJ(new THREE.CylinderGeometry(r, r * 1.15, h, 10, 2), C.stone, x, h / 2, z, g, .05);
  addJ(new THREE.CylinderGeometry(r * 1.25, r * 1.05, 1.2, 10), C.stone2, x, h + .2, z, g, .05);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) add(box(.8, 1, .8), M(C.stone), x + Math.cos(a) * r * 1.15, h + 1.2, z + Math.sin(a) * r * 1.15, g);
  addJ(new THREE.ConeGeometry(r * 1.45, r * 2.6, 10), roof, x, h + 1.6 + r * 1.3, z, g, .04);
  add(new THREE.SphereGeometry(.35, 6, 4), M(C.gold), x, h + 1.7 + r * 2.6, z, g);
  add(box(.7, 1.3, .3), WIN, x + Math.sin(.4) * r * 1.02, h * .55, z + Math.cos(.4) * r * 1.02, g, false).rotation.y = .4;
  flag(g, x, h + 1.8 + r * 2.6, z, roof === C.roofB ? 0x3a6ae0 : C.red);
}
function stoneKeep(g, z, h, tall) {
  addJ(box(13, 2, 13), C.stone2, 0, 1, z, g, .06); addJ(box(11, h, 11), C.stone, 0, 2 + h / 2, z, g, .06);
  addJ(box(12, 1, 12), C.stone2, 0, 2.5 + h, z, g, .05); const k = new THREE.Group(); k.position.z = z; g.add(k); crenels(k, 12, 12, 3.5 + h, 1, C.stone);
  for (const x of [-3, 3]) add(box(1.3, 2, .3), WIN, x, h * .7, z + 5.6, g, false);
  add(box(2.6, 3.2, .4), M(C.wood2), 0, 3.6, z + 5.6, g, false);
  if (tall) { addJ(new THREE.CylinderGeometry(2.6, 2.8, 7, 10), C.stone, 0, 2 + h + 3.5, z - 1, g, .05); addJ(new THREE.ConeGeometry(3.6, 5, 10), C.roofB, 0, 2 + h + 9.5, z - 1, g, .04); flag(g, 0, 2 + h + 12, z - 1, C.red); }
  else flag(g, 3.5, 3.6 + h, z + 3.5, C.red);
}
function greatHall(g, x, z) { const h = new THREE.Group(); h.position.set(x, 0, z); h.rotation.y = Math.PI / 2; g.add(h); addJ(box(12, 5, 4.4), C.cream, 0, 2.5, 0, h, .03); addJ(new THREE.CylinderGeometry(0, 3.4, 13, 4, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 4), C.roofR, 0, 6.2, 0, h, .05).scale.set(1, .7, 1); for (const x of [-3.5, 0, 3.5]) add(box(1.2, 1.6, .2), WIN, x, 2.8, 2.25, h, false); }
function walls(g, s, wh, broken, stage) {
  for (const [x, z, w, d] of [[0, -s / 2, s, 2], [-s / 2, 0, 2, s], [s / 2, 0, 2, s], [-10.5, s / 2, 13, 2], [10.5, s / 2, 13, 2]]) {
    addJ(box(w, wh, d), C.stone2, x, wh / 2, z, g, .06); addJ(box(w + .6, .6, d + .6), C.stone, x, wh + .3, z, g, .04);
    for (let i = -Math.max(w, d) / 2 + .6; i <= Math.max(w, d) / 2; i += 1.8) add(box(d > w ? 2 : .9, .9, d > w ? .9 : 2), M(C.stone2), x + (w > d ? i : 0), wh + 1.05, z + (d > w ? i : 0), g);
  }
  for (const [x, z] of [[-s / 2, -s / 2], [s / 2, -s / 2], [-s / 2, s / 2], [s / 2, s / 2]]) tower(g, x, z, 2.8, 10, C.roofB);
  for (const x of [-4.5, 4.5]) tower(g, x, s / 2 + .5, 2, 9, C.roofR);
  add(box(6.6, 2, 3.4), M(C.stone2), 0, 7.5, s / 2, g);
  gate(g, 0, s / 2 + .9, 5, 6, broken);
  if (stage >= 5) for (const x of [-9, 9]) add(new THREE.PlaneGeometry(1.8, 3.6), M(x < 0 ? C.red : C.roofB, { side: THREE.DoubleSide }), x, 3.4, s / 2 + 1.05, g, false);
}
function gate(g, x, z, w, h, broken) {
  if (!broken) { add(box(w, h, .8), M(C.wood), x, h / 2, z, g); for (let i = -2; i <= 2; i++) add(box(.25, h, .25), M(0x2a2a2a), x + i * w / 5, h / 2, z + .5, g, false); return; }
  add(box(w, h, .3), M(0x0a0608), x, h / 2, z - .3, g, false); // the dark gap where the gate was
  [[-2, .5, 2.2, .4], [1.6, .4, 2.8, -.5], [.2, .3, 3.6, .9], [2.8, .6, 1.4, .2]].forEach(([dx, y, dz, r]) => addJ(box(1.6, .9, 1.2), C.stone2, x + dx, y, z + dz, g, .1).rotation.y = r);
  for (const [dx, dz, r] of [[-1.4, 2, .6], [1, 1.4, -.4]]) add(box(3, .3, .6), M(C.wood), x + dx, .3, z + dz, g).rotation.y = r;
  for (let i = 0; i < 3; i++) { const p = add(new THREE.SphereGeometry(.7 + i * .2, 5, 4), M(0x5a5450), x, 6, z, g, false); p.userData = { k: i, x: x, y: 5, z: z }; smokes.push(p); }
}
function palisade(g, s) {
  for (const [x0, z0, x1, z1] of [[-s / 2, -s / 2, s / 2, -s / 2], [-s / 2, -s / 2, -s / 2, s / 2], [s / 2, -s / 2, s / 2, s / 2], [-s / 2, s / 2, -3, s / 2], [3, s / 2, s / 2, s / 2]]) {
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.1);
    for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / n), z = lerp(z0, z1, i / n), h = 4.4 + rnd(i + x * 3) * .8; add(new THREE.CylinderGeometry(.5, .55, h, 5), M(i % 2 ? C.wood : 0x6a4020), x, h / 2, z, g); add(new THREE.ConeGeometry(.5, .9, 5), M(C.wood2), x, h + .45, z, g, false); }
  }
}
function campfire(g, x, z) {
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; addJ(new THREE.DodecahedronGeometry(.5, 0), C.stone2, x + Math.cos(a) * 1.5, .3, z + Math.sin(a) * 1.5, g, .1); }
  for (const r of [0, 1.1, 2.2]) add(box(2.6, .4, .4), M(C.wood2), x, .4, z, g).rotation.y = r;
  const f = add(new THREE.ConeGeometry(.9, 2.2, 5), glow(0xffa030), x, 1.4, z, g, false); f.userData.flame = true;
  add(new THREE.ConeGeometry(.45, 1.4, 5), glow(0xfff0a0), x, 1.2, z, g, false);
}
function buildKeep(stage, broken, held, camp, ink) {
  castle.clear(); flags.length = 0; smokes.length = 0; seed = 1;
  const g = castle;
  if (stage === 0) { const cf = new THREE.Group(); cf.scale.setScalar(1.8); cf.position.set(0, 0, 4); g.add(cf); campfire(cf, 0, 0); for (const [x, z, r] of [[-3, -1, .4], [3, 0, -.3]]) add(box(3.2, .6, 1.2), M(0x8a3a2a), x, .3, z, cf).rotation.y = r; if (camp) flag(g, 4, 0, 1, new THREE.Color(ink || '#e3b663').getHex(), 1.4); }
  else if (stage === 1) { palisade(g, 24); const h = new THREE.Group(); h.position.set(0, 0, -2); g.add(h); addJ(box(10, 5, 8), C.wood, 0, 2.5, 0, h, .08); addJ(new THREE.CylinderGeometry(0, 6, 11.6, 4, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 4), C.thatch, 0, 6.5, 0, h, .06).scale.set(1, .75, 1); add(box(2, 3, .3), M(C.wood2), 0, 1.5, 4.05, h, false); flag(g, 9, 4.4, 9, C.red); gate(g, 0, 12, 5.5, 4.5, broken); }
  else if (stage <= 3) {
    for (const [x, z, w, d] of [[0, -13, 26, 1.6], [-13, 0, 1.6, 26], [13, 0, 1.6, 26], [-8.5, 13, 9, 1.6], [8.5, 13, 9, 1.6]]) { addJ(box(w, 3.6, d), C.stone2, x, 1.8, z, g, .06); for (let i = -Math.max(w, d) / 2 + .5; i <= Math.max(w, d) / 2; i += 1.6) add(box(d > w ? 1.6 : .8, .8, d > w ? .8 : 1.6), M(C.stone2), x + (w > d ? i : 0), 4, z + (d > w ? i : 0), g); }
    gate(g, 0, 13, 7, 3.6, broken); stoneKeep(g, -1, 10, stage === 3); if (stage === 3) greatHall(g, 9, -2);
  } else if (stage <= 5) { walls(g, 34, 6, broken, stage); stoneKeep(g, -3, 11, true); if (stage === 5) greatHall(g, 11, -3); }
  else { // the castle: a great keep with corner turrets and a hipped roof
    walls(g, 34, 6, broken, 6);
    const k = new THREE.Group(); k.position.set(0, 0, -3); g.add(k);
    addJ(box(15, 2, 15), C.stone2, 0, 1, 0, k, .06); addJ(box(13, 13, 13), C.stone, 0, 8.5, 0, k, .06);
    addJ(box(14, 1, 14), C.stone2, 0, 15.3, 0, k, .05); crenels(k, 14, 14, 16.3, 1, C.stone);
    for (const [x, z] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) { addJ(new THREE.CylinderGeometry(1.6, 1.2, 5, 8), C.stone, x, 15.5, z, k, .05); addJ(new THREE.ConeGeometry(2.1, 3.6, 8), C.roofB, x, 19.8, z, k, .04); }
    addJ(new THREE.ConeGeometry(8.4, 7, 4).rotateY(Math.PI / 4), C.roofB, 0, 19.6, 0, k, .05);
    add(new THREE.SphereGeometry(.45, 6, 4), M(C.gold), 0, 23.2, 0, k); flag(k, 0, 23.4, 0, C.red, 1.3);
    for (const y of [7, 11.5]) for (const x of [-3.5, 3.5]) { add(box(1.4, 2.2, .3), WIN, x, y, 6.6, k, false); add(box(1.9, .35, .5), M(C.stone2), x, y - 1.2, 6.65, k, false); }
    add(box(3, 3.4, .4), M(C.wood2), 0, 3.7, 6.6, k, false);
    for (const x of [-4.5, 4.5]) add(new THREE.PlaneGeometry(1.6, 4.5), M(x < 0 ? C.red : C.roofB, { side: THREE.DoubleSide }), x * 1.25, 11, 6.62, k, false);
  }
  // a pennant in each held region's colour flies along the back wall
  held.forEach((r, i) => flag(g, -12 + i * 5, stage >= 4 ? 7.2 : 4.6, stage >= 4 ? -17 : -13, new THREE.Color(r.ink).getHex(), .9));
  const tz = stage >= 4 ? 19.3 : 13.9; torches.forEach(({ f, l }, i) => { const x = (i ? 1 : -1) * (stage >= 4 ? 3.4 : 4.6); f.position.set(x, 5, tz); l.position.set(x, 5.6, tz + .8); f.userData.on = stage >= 2; });
  if (stage === 0) { torches[0].f.position.set(0, 2.2, 4); torches[0].l.position.set(0, 4, 6); torches[0].f.userData.on = true; } // the campfire lights the camp at night
}

/* ---------- village buildings; a burnt one is charred, smoking and still alight ---------- */
const CHAR = 0x2a2220;
function cottage(g, roofHex, w = 6, d = 5, ruined) {
  const c = hex => ruined ? CHAR : hex;
  addJ(box(w + .6, 1, d + .6), c(C.stone2), 0, .5, 0, g, .1); addJ(box(w, 3.6, d), c(C.cream), 0, 2.8, 0, g, .03);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(.4, 3.6, .4), M(c(C.wood2)), sx * (w / 2 - .1), 2.8, sz * (d / 2 - .1), g);
  if (!ruined) addJ(new THREE.CylinderGeometry(0, (w + d) / 2.5, w + 1.6, 4, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 4), roofHex, 0, 6.1, 0, g, .05).scale.set(1, .85, 1);
  else for (const [x, r] of [[-1, .5], [1.2, -.4]]) add(box(w * .7, .4, .5), M(CHAR), x, 4.8, 0, g).rotation.z = r;
  add(box(1.3, 2.4, .25), M(c(C.wood)), 0, 2.2, d / 2 + .05, g, false);
  for (const sx of [-1.9, 1.9]) add(box(1, 1, .2), ruined ? M(0xff7020, { emissive: 0x802000 }) : WIN, sx * w / 6, 3, d / 2 + .06, g, false);
}
const BUILD = {
  Tent: (g, r) => { addJ(new THREE.ConeGeometry(4, 5.5, 6), r ? CHAR : 0xb8a47e, 0, 2.75, 0, g, .06); add(box(1.4, 2.2, .2), M(0x2a1810), 0, 1.1, 3.3, g, false); if (!r) flag(g, 0, 5.2, 0, C.red, .8); },
  Hut: (g, r) => cottage(g, C.thatch, 6, 5, r),
  Well: (g, r) => { addJ(new THREE.CylinderGeometry(2, 2.2, 2, 10), r ? CHAR : C.stone, 0, 1, 0, g, .1); add(new THREE.CylinderGeometry(1.5, 1.5, .1, 10), M(C.water), 0, 1.9, 0, g, false); for (const s of [-1, 1]) add(box(.35, 4.5, .35), M(C.wood2), s * 1.9, 2.5, 0, g); if (!r) addJ(new THREE.CylinderGeometry(0, 3, 4.4, 4, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 4), C.roofR, 0, 5.2, 0, g, .05).scale.set(1, .6, 1); },
  Farm: (g, r) => { for (let i = -2; i <= 2; i++) addJ(box(12, .8, 1.6), r ? CHAR : i % 2 ? 0xc8a040 : 0x8a9a38, 0, .4, i * 2.4, g, .1); if (!r) for (const [x, z] of [[-7.5, -4], [7.5, 3]]) addJ(new THREE.CylinderGeometry(1.4, 1.6, 2.4, 8), C.thatch, x, 1.2, z, g, .1); },
  Watchtower: (g, r) => { for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) add(box(.5, 10, .5), M(r ? CHAR : C.wood), x, 5, z, g); addJ(box(5, .6, 5), r ? CHAR : C.wood2, 0, 9.5, 0, g, .1); if (!r) { addJ(new THREE.ConeGeometry(3.8, 3.4, 4).rotateY(Math.PI / 4), C.thatch, 0, 12.4, 0, g, .05); flag(g, 0, 14, 0, C.red, .8); } },
  Mill: (g, r) => { addJ(new THREE.CylinderGeometry(2.4, 3, 8, 8), r ? CHAR : 0xb8a888, 0, 4, 0, g, .04); if (!r) { addJ(new THREE.ConeGeometry(3.2, 3.4, 8), C.roofR, 0, 9.7, 0, g, .04); const s = new THREE.Group(); s.position.set(0, 7.4, 3.2); g.add(s); for (let i = 0; i < 4; i++) { const a = new THREE.Group(); a.rotation.z = i * Math.PI / 2; s.add(a); add(box(1.1, 6, .15), M(0xe8dcc0), 0, 3.2, 0, a, false); add(box(.25, 6.4, .3), M(C.wood2), .55, 3.2, .1, a, false); } s.userData.sails = true; } },
  Smithy: (g, r) => { cottage(g, C.roofB, 7, 5.5, r); addJ(box(1.4, 4.6, 1.4), C.stone2, 2.4, 7.6, -1.4, g, .1); add(box(2, 1.6, .2), M(0xff7020, { emissive: 0x803000 }), -1.8, 1.8, 2.82, g, false); for (let i = 0; i < 3; i++) { const p = add(new THREE.SphereGeometry(.5 + i * .15, 5, 4), M(0xd8d8d8), 2.4, 10, -1.4, g, false); p.userData = { k: i, x: 2.4, y: 10, z: -1.4 }; smokes.push(p); } },
  Market: (g, r) => { [[-3.2, 0xd04040], [3.2, 0x3a6ad0], [0, 0xe0b030]].forEach(([x, col], i) => { const z = i === 2 ? -4 : 0; for (const sx of [-1.4, 1.4]) for (const sz of [-1.1, 1.1]) add(box(.3, 3, .3), M(C.wood2), x + sx, 1.5, z + sz, g); addJ(box(3, .9, 2.2), r ? CHAR : C.wood, x, .9, z, g, .1); if (!r) { add(box(3.6, .3, 2.8), M(col), x, 3.1, z, g); add(box(3.6, .25, 1.2), M(0xf0e8d8), x, 3.15, z, g, false); } }); },
};
function buildVillage(names, ruins) {
  village.clear(); seed = 40; const fireAt = [];
  names.forEach(n => {
    if (!SPOT[n]) return; const [x, z] = at(...SPOT[n]), g = new THREE.Group(), ruined = ruins.includes(n);
    g.position.set(x, 0, z); g.rotation.y = Math.atan2(-x, -z) * .5 - A * .5; village.add(g); BUILD[n](g, ruined);
    if (ruined) { fireAt.push([x, z]); for (let i = 0; i < 3; i++) { const p = add(new THREE.SphereGeometry(.7 + i * .2, 5, 4), M(0x3a3430), x, 7, z, village, false); p.userData = { k: i, x, y: 5, z, world: true }; smokes.push(p); } }
  });
  fires.forEach((f, i) => { const p = fireAt[i]; f.on = !!p; if (p) { f.l.position.set(p[0], 6, p[1]); f.g.position.set(p[0], 0, p[1]); } });
}

/* ---------- habit villagers: a peasant in a straw hat, a guard with helm and spear, a knight with plume and shield ---------- */
function villager(rank, i) {
  const g = new THREE.Group(), body = [[0x8a6440, 0x6a7a4a, 0x9a5a40][i % 3], 0x3a5cc0, 0xc8ccd4][rank];
  add(new THREE.CylinderGeometry(.6, .8, 1.8, 6), M(body), 0, .9, 0, g);
  add(new THREE.SphereGeometry(.65, 6, 5), M(rank === 2 ? 0xc8ccd4 : [0xd8b080, 0xb07040, 0xe0c090][i % 3]), 0, 2.3, 0, g);
  if (rank === 0) add(new THREE.ConeGeometry(1.1, .6, 8), M(C.thatch), 0, 2.9, 0, g);
  if (rank === 1) { add(new THREE.ConeGeometry(.75, .8, 6), M(0x9aa0a8), 0, 2.95, 0, g); add(new THREE.CylinderGeometry(.08, .08, 4, 4), M(C.wood2), .9, 2, .2, g); add(new THREE.ConeGeometry(.22, .6, 4), M(0xe8ecf0), .9, 4.3, .2, g); }
  if (rank === 2) { add(box(.25, .9, 1), M(C.red), 0, 3.2, -.1, g); add(box(.2, 1.5, 1.2), M(C.red), -.8, 1.2, .1, g); add(box(.22, .3, 1.22), M(C.gold), -.8, 1.4, .1, g, false); add(new THREE.CylinderGeometry(.07, .07, 3.4, 4), M(0xe8ecf0), .85, 1.8, .4, g).rotation.x = .5; }
  g.scale.setScalar(rank === 2 ? 1.9 : 1.6);
  return g;
}
function buildFolk(list) { hfolk.clear(); list.forEach((f, i) => { const g = villager(f.rank, i); g.userData = { ...f, i }; hfolk.add(g); }); }

/* ---------- gold piles ---------- */
function buildPiles(list) {
  piles.clear();
  for (const q of list) {
    const [sx, sz] = pileAt(q.slot), [x, z] = at(sx, sz), p = new THREE.Group(); p.position.set(x, 0, z); piles.add(p);
    const n = Math.min(18, 5 + Math.round(q.g / 2));
    for (let i = 0; i < n; i++) { const a = i * 2.4, r = Math.sqrt(i / n) * 2.2, y = (1 - r / 2.2) * 1.6 + .15; add(new THREE.CylinderGeometry(.5, .5, .2, 6), M(i % 5 ? C.gold : 0xfff0a0), Math.cos(a) * r, y, Math.sin(a) * r, p).rotation.set(rnd(i) - .5, 0, rnd(i + 3) - .5); }
    if (q.mark) flag(p, 1.6, 1, 0, C.red, .8);
    p.userData = { slot: q.slot, g: q.g };
  }
}

/* ---------- the dragon: chest, haunch, neck, horned head, spade tail, and bat wings that fold ---------- */
const DRG = 0xc83a22, DRG2 = 0x8a2214, BELLY = 0xf0b070, MEMB = 0x9a2a1a;
let wingRig = [], neckBits = [], tailBits = [], headG = null, legs = [], carryG = null;
function buildDragon() {
  const d = new THREE.Group(), body = new THREE.Group(); d.add(body); d.userData.body = body;
  const chest = addJ(new THREE.SphereGeometry(1.9, 7, 5), DRG, 0, .2, .9, body, .06); chest.scale.set(1, .95, 1.2);
  addJ(new THREE.SphereGeometry(1.6, 7, 5), DRG, 0, 0, -1.4, body, .06).scale.set(1, .9, 1.3);
  add(new THREE.SphereGeometry(1.5, 7, 4), M(BELLY), 0, -.75, 0, body, false).scale.set(.85, .45, 2);
  for (let i = 0; i < 5; i++) add(new THREE.ConeGeometry(.28, .8, 4), M(C.cream), 0, 1.9 - i * .05, 1.6 - i * .8, body).rotation.x = -.4;
  for (let i = 0; i < 4; i++) neckBits.push(addJ(new THREE.SphereGeometry(.95 - i * .08, 7, 5), i % 2 ? DRG : DRG2, 0, 0, 0, body, .05));
  headG = new THREE.Group(); body.add(headG);
  addJ(box(1.9, 1.5, 2.1), DRG, 0, 0, 0, headG, .05);
  addJ(new THREE.CylinderGeometry(.55, .85, 2.2, 4).rotateX(Math.PI / 2), DRG, 0, -.2, 1.9, headG, .05).rotation.z = Math.PI / 4;
  add(box(1.3, .35, 2.2), M(BELLY), 0, -.75, 1.4, headG); add(box(2.1, .4, .7), M(DRG2), 0, .75, .7, headG);
  for (const s of [-1, 1]) {
    add(new THREE.ConeGeometry(.32, 1.6, 5), M(C.cream), s * .7, 1.1, -.6, headG).rotation.set(-1.0, 0, s * -.25);
    add(box(.55, .5, .25), M(0xfff4c0, { emissive: 0x403000 }), s * .62, .25, 1.02, headG, false); add(box(.22, .45, .1), M(0x101010), s * .62, .25, 1.16, headG, false);
  }
  for (let i = 0; i < 8; i++) tailBits.push(addJ(new THREE.SphereGeometry(.95 - i * .095, 7, 5), i % 2 ? DRG : DRG2, 0, 0, 0, body, .05));
  const tip = addJ(new THREE.ConeGeometry(.9, 1.6, 4).rotateX(-Math.PI / 2), DRG2, 0, 0, 0, body, .05); tip.scale.set(1.4, .3, 1); tailBits.push(tip);
  for (const [x, z] of [[-1.2, 1.2], [1.2, 1.2], [-1.1, -1.8], [1.1, -1.8]]) { const lg = new THREE.Group(); lg.position.set(x, -.6, z); body.add(lg); addJ(new THREE.CylinderGeometry(.42, .3, 1.6, 6), DRG, 0, -.8, 0, lg, .05); add(box(.7, .3, .9), M(DRG2), 0, -1.6, .2, lg); legs.push(lg); }
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 1.1, .7, .8); body.add(sh);
    add(new THREE.CylinderGeometry(.22, .18, 3.4, 5).rotateZ(Math.PI / 2), M(DRG2), s * 1.7, 0, 0, sh);
    const el = new THREE.Group(); el.position.set(s * 3.4, 0, 0); sh.add(el); const fingers = [];
    for (let i = 0; i < 3; i++) { const f = new THREE.Group(); el.add(f); const len = 4.6 - i * .5; add(new THREE.CylinderGeometry(.12, .07, len, 4).rotateZ(Math.PI / 2), M(DRG2), s * len / 2, 0, 0, f); f.userData = { len, base: -.2 - i * .59 }; fingers.push(f); }
    const mem = new THREE.Mesh(new THREE.BufferGeometry(), M(MEMB, { side: THREE.DoubleSide })); mem.castShadow = true; body.add(mem);
    wingRig.push({ side: s, sh, el, fingers, mem });
  }
  carryG = new THREE.Group(); carryG.position.set(0, -2.2, .6); body.add(carryG); carryG.visible = false;
  for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(.5, .5, .2, 6), M(C.gold, { emissive: 0x403000 }), (i - 2) * .6, (i % 2) * .3, 0, carryG, false);
  return d;
}
const tv = () => new THREE.Vector3();
function membrane(w, body) {
  const loc = o => body.worldToLocal(o.getWorldPosition(tv()));
  const sh = loc(w.sh), el = loc(w.el), tips = w.fingers.map(f => body.worldToLocal(f.localToWorld(new THREE.Vector3(w.side * f.userData.len, 0, 0))));
  const hip = new THREE.Vector3(w.side * .8, .4, -2.6), v = [], tri = (a, b, c) => v.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  tri(sh, el, tips[0]); for (let i = 0; i < tips.length - 1; i++) { const mid = tips[i].clone().lerp(tips[i + 1], .5).lerp(el, .25); tri(el, tips[i], mid); tri(el, mid, tips[i + 1]); }
  tri(el, tips[tips.length - 1], hip); tri(sh, el, hip);
  const g = w.mem.geometry; g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
}
let fold = 1, prevPos = null;
function poseDragon(p, s, dt) {
  // p: { x, y, z, folded, sleep, carry, bank, face }
  fold += ((p.folded ? 1 : 0) - fold) * Math.min(1, dt * 3);
  dragon.position.set(p.x, p.y, p.z);
  const body = dragon.userData.body;
  let yaw = p.face;
  if (yaw == null && prevPos) { const dx = p.x - prevPos.x, dz = p.z - prevPos.z; if (Math.hypot(dx, dz) > .01) yaw = Math.atan2(dx, dz); }
  if (yaw != null) { let d = yaw - dragon.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); dragon.rotation.y += d * Math.min(1, dt * 6); }
  prevPos = { x: p.x, z: p.z };
  body.rotation.z = lerp(p.bank || 0, 0, fold);
  const f = fold, beat = Math.sin(s * 5);
  wingRig.forEach(w => {
    const sd = w.side;
    w.sh.rotation.set(0, lerp(0, sd * .9, f), lerp(sd * beat * .55, sd * .9, f));
    w.el.rotation.set(0, lerp(sd * .25, sd * 2.4, f), lerp(sd * beat * .3, 0, f));
    w.fingers.forEach(x => { x.rotation.y = sd * lerp(-x.userData.base, .15, f); });
    membrane(w, body);
  });
  neckBits.forEach((n, i) => n.position.set(0, .5 + i * .52, 1.9 + i * .6));
  const nap = p.sleep ? 1 : 0;
  headG.position.set(0, .5 + neckBits.length * .52 + .3 - nap * 2.2, 1.9 + neckBits.length * .6 + .4 - nap * .6);
  headG.rotation.set(Math.sin(s * 1.4) * .08 + f * .2 + nap * .5, Math.sin(s * .7) * .25 * f * (1 - nap), 0);
  tailBits.forEach((b, i) => { b.position.set(Math.sin(s * 2.2 - i * .5) * (.1 + i * .1) * (1 - nap * .8) + f * Math.sin(i * .5) * i * .25, -.2 - i * .06 - f * i * .1, -2.6 - i * .85); if (i === tailBits.length - 1) b.rotation.y = Math.cos(s * 2.2 - i * .5) * .4; });
  legs.forEach((lg, i) => { lg.rotation.x = lerp(i < 2 ? -1.1 : 1.1, 0, f); });
  carryG.visible = !!p.carry;
}
function flight(age, dur, tx, tz, low) { // out from the nest, down to the target, and home again
  const f = age / dur, [nx, nz] = at(...NEST), hy = NEST_Y + 2.6;
  if (f < .42) { const k = ease(f / .42); return { x: lerp(nx, tx, k), y: lerp(hy, low, k) + Math.sin(k * Math.PI) * 12, z: lerp(nz, tz, k), bank: .2 }; }
  if (f < .55) return { x: tx, y: low + Math.sin(age) * .3, z: tz, bank: 0, hit: true };
  const k = ease(Math.min(1, (f - .55) / .45));
  return { x: lerp(tx, nx, k), y: lerp(low, hy, k) + Math.sin(k * Math.PI) * 12, z: lerp(tz, nz, k), folded: k > .97, bank: -.2, home: true };
}

/* ---------- moods: the light drifts toward one that fits the moment ---------- */
const MOODS = {
  dawn: { sun: [-80, 28, 50], sc: 0xffb8a0, si: .95, sky: 0xa8a8e0, gnd: 0x503848, ai: .42, bg: 0xd8a890, torch: 0, win: 0, rain: 0, bolt: 0, fire: 0 },
  day: { sun: [50, 90, 40], sc: 0xffffff, si: 1, sky: 0xbcd8ff, gnd: 0x405020, ai: .45, bg: 0x9cc4e8, torch: 0, win: 0, rain: 0, bolt: 0, fire: 0 },
  dusk: { sun: [90, 24, 30], sc: 0xff9050, si: 1.1, sky: 0x8a70b0, gnd: 0x402030, ai: .36, bg: 0x6a4a80, torch: .2, win: .5, rain: 0, bolt: 0, fire: 0 },
  night: { sun: [-40, 80, -30], sc: 0x7a9ae0, si: .7, sky: 0x5468a4, gnd: 0x18203a, ai: .55, bg: 0x0c1430, torch: 1, win: 1, rain: 0, bolt: 0, fire: 0 },
  storm: { sun: [20, 90, 20], sc: 0x8a98a8, si: .5, sky: 0x6a7888, gnd: 0x202820, ai: .4, bg: 0x4a5560, torch: .6, win: .4, rain: 1, bolt: 1, fire: 0 },
  fire: { sun: [60, 40, 40], sc: 0xc06040, si: .45, sky: 0x5a3848, gnd: 0x200c08, ai: .32, bg: 0x200c08, torch: .8, win: 0, rain: 0, bolt: 0, fire: 1 },
};
let cur = null, bolt = 0, nextBolt = 3;
function moodStep(name, s, dt, jump) {
  const m = MOODS[name] || MOODS.day, k = jump ? 1 : Math.min(1, dt * 1.6);
  if (!cur) { cur = { ...m, sun: [...m.sun] }; for (const key of ['sc', 'sky', 'gnd', 'bg']) cur[key] = new THREE.Color(m[key]); }
  for (const key of ['si', 'ai', 'torch', 'win', 'rain', 'bolt', 'fire']) cur[key] += (m[key] - cur[key]) * k;
  for (const key of ['sc', 'sky', 'gnd', 'bg']) cur[key].lerp(new THREE.Color(m[key]), k);
  for (let i = 0; i < 3; i++) cur.sun[i] += (m.sun[i] - cur.sun[i]) * k;
  nextBolt -= dt; if (nextBolt < 0) { nextBolt = 2.5 + rnd(s) * 4; if (cur.bolt > .5) bolt = 1; }
  const b = bolt > .66 || (bolt > .2 && bolt < .4) ? 1 : 0; bolt = Math.max(0, bolt - dt * 4);
  sun.position.set(...cur.sun); sun.color.copy(cur.sc).lerp(new THREE.Color(0xe8f0ff), b); sun.intensity = cur.si + b * 1.2;
  amb.color.copy(cur.sky); amb.groundColor.copy(cur.gnd); amb.intensity = cur.ai + b * .8; scene.background.copy(cur.bg);
  torches.forEach(({ l, f }, i) => { const on = f.userData.on ? cur.torch : 0; l.intensity = on * (.75 + Math.sin(s * 11 + i * 2) * .2 + Math.sin(s * 23 + i) * .15); f.visible = on > .2; f.scale.y = 1 + Math.sin(s * 13 + i) * .2; });
  WIN.emissive.setRGB(.25 + cur.win * .75, .13 + cur.win * .5, cur.win * .1);
  // burnt buildings always smoulder; the fire mood makes them blaze
  fires.forEach(({ l, g, on }, i) => { const heat = on ? .45 + cur.fire * .55 : 0; l.intensity = heat * (2.2 + Math.sin(s * 9 + i * 3) * .5 + Math.sin(s * 17) * .3); g.visible = heat > .2; });
  embers.forEach(e => { const k = (s * .7 + e.userData.k) % 1; e.position.set(Math.cos(e.userData.a) * (1.5 + k), 3 + k * 8, Math.sin(e.userData.a) * (1.5 + k)); e.scale.setScalar((1 - k) * 1.2 + .2); });
  rain.visible = cur.rain > .3; if (rain.visible) { rain.position.y = -((s * 40) % 20); rain.position.x = (s * 10) % 8 - 4; }
}

/* ---------- labels: the gold on each pile, and the sleeping dragon's z's, drawn in pixels over the picture ---------- */
const FONT = { '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111', z: '111001010100111' };
/** Tiny pixel text, centred on x (left edge when centre is false); drawn in bigger pixels when the picture is finer, so it stays readable. */
function text(c, s, x, y, col, bg, centre = false) {
  const u = Math.max(1, Math.round(PW / SW)), w = (s.length * 4 - 1) * u; if (centre) x -= w / 2 | 0;
  if (bg) { c.fillStyle = bg; c.fillRect(x - 2 * u, y - 2 * u, w + 4 * u, 9 * u); }
  c.fillStyle = col; [...s].forEach((ch, i) => { const g = FONT[ch]; if (g) for (let k = 0; k < 15; k++) if (g[k] === '1') c.fillRect(x + (i * 4 + k % 3) * u, y + (k / 3 | 0) * u, u, u); });
}
const onScreen = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(cam); return [Math.round((v.x + 1) / 2 * PW), Math.round((1 - v.y) / 2 * H)]; };

/** Draw the scene: { mode: sleep|perch|circle, piles [{slot, g, mark, hot}], gate (broken), fx [{kind, age, slot, n, g}],
    land, phase, buildings, ruins, held (regions), lvl, hoard, camp, campInk } */
/** A taller (or shorter) picture: same width and scale, more ground above and below. */
function resize(h) {
  H = h; FIT = Math.max(1, h * SW / PW / 300); aimed = ''; out.width = PW; R.setSize(PW, h, false);
  rt.dispose(); rt.depthTexture.dispose();
  rt = new THREE.WebGLRenderTarget(PW, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  rt.depthTexture = new THREE.DepthTexture(PW, h); rt.depthTexture.type = THREE.UnsignedIntType;
  POST = inkPass(rt, INK); quad.material = POST;
}
/* ---------- the person's own view: pan, zoom and turn the camera with their fingers ---------- */
export const view = { x: 0, z: 0, zoom: 1, rot: 0, tilt: 0 };
const elev = () => Math.min(1.45, Math.max(.1, EL + view.tilt)); // the camera's height as an angle, kept between a low look and straight down
const VK = 105 / 224 / .8;
let aimed = '';
function aim() {
  const k = [view.x, view.z, view.zoom, view.rot, view.tilt].join(); if (k === aimed) return; aimed = k;
  const a = A + view.rot, e = elev(), [lx, lz] = at(6, 2), x = lx + view.x, z = lz + view.z, r = FAR / 2;
  cam.position.set(x + Math.sin(a) * r * Math.cos(e), 4 + r * Math.sin(e), z + Math.cos(a) * r * Math.cos(e)); cam.lookAt(x, 4, z);
  // anything nearer the camera than a cut a little way past the village is left out, like the cut edge of a model, so
  // hills and mountains on the near side never block the view when looking low; the ink's depth step follows the range
  const sm = Math.min(1, Math.max(0, (e - .3) / .25)), g = 110 + 120 * sm * sm * (3 - 2 * sm);
  cam.near = Math.max(1, r - g * Math.cos(e)); if (POST) POST.uniforms.thr.value = 1.5 / (cam.far - cam.near);
  // and when the cut edge would show inside the picture, the view slides up so the land runs to the bottom and the
  // sky and far mountains fill the top, like looking out to the horizon
  const vk = VK * SW / PW, z2 = view.zoom * FIT, half = H / 2 * vk / z2;
  cam.left = -PW / 2 * vk; cam.right = PW / 2 * vk;
  const off = Math.min(half * .9, Math.max(0, half - g * Math.sin(e) + 2));
  cam.top = (half + off) * z2; cam.bottom = (-half + off) * z2;
  cam.zoom = z2; cam.updateProjectionMatrix();
}
/** Move the view by a drag of dx, dy screen pixels on a picture w pixels wide, zoom by a factor, turn around and tilt by angles. */
export function nudge(dx, dy, w, zoom = 1, turn = 0, tilt = 0) {
  const a = A + view.rot, e = elev(), s = SW * VK / (view.zoom * FIT) / Math.max(1, w);
  view.x -= (Math.cos(a) * dx + Math.sin(a) * dy / Math.sin(e)) * s;
  view.z -= (-Math.sin(a) * dx + Math.cos(a) * dy / Math.sin(e)) * s;
  view.tilt = Math.min(1.45 - EL, Math.max(.1 - EL, view.tilt + tilt));
  const d = Math.hypot(view.x, view.z); if (d > 70) { view.x *= 70 / d; view.z *= 70 / d; }
  view.zoom = Math.min(3.5, Math.max(.6, view.zoom * zoom)); view.rot += turn;
}
export const resetView = () => Object.assign(view, { x: 0, z: 0, zoom: 1, rot: 0, tilt: 0 });
export const viewMoved = () => Math.abs(view.x) + Math.abs(view.z) > .5 || Math.abs(view.zoom - 1) > .02 || Math.abs(view.rot) > .02 || Math.abs(view.tilt) > .02;
let sig = {}, lastMs = 0, lastT = 0;
export function paint(cv, Sc, t) {
  load();
  const c = cv.getContext('2d');
  if (!ready) { c.fillStyle = '#16200f'; c.fillRect(0, 0, cv.width, cv.height); return; }
  if (cv.height !== H || cv.width !== PW) { PW = cv.width; resize(cv.height); }
  if (grad.image.width !== LOOK.steps) { const n = LOOK.steps, d = new Uint8Array(n * 4); for (let i = 0; i < n; i++) d.fill(Math.round(70 + 185 * i / (n - 1)), i * 4, i * 4 + 3), d[i * 4 + 3] = 255; grad.image = { data: d, width: n, height: 1 }; grad.needsUpdate = true; }
  const now = performance.now(), dt = lastMs ? Math.min(.2, (now - lastMs) / 1000) : 1; lastMs = now;
  aim();
  const s = t * .18, first = !sig.keep;
  const b = Sc.buildings || [], fx = Sc.fx || [], stage = Sc.camp ? 0 : stageOf(b);
  const rk = !Sc.camp && fx.find(e => (e.kind === 'held' || e.kind === 'breach') && e.age >= 0 && e.age < RECKON);
  const broken = rk ? rk.kind === 'breach' && rk.age > RECKON * .45 : !!Sc.gate;
  const held = Sc.camp ? [] : Sc.held || [];
  // rebuild only what changed
  setLand(Sc.land || 'vale');
  const kSig = [stage, broken, held.map(r => r.id).join(), Sc.camp, Sc.campInk].join('|');
  if (kSig !== sig.keep) { sig.keep = kSig; buildKeep(stage, broken, held, Sc.camp, Sc.campInk); }
  const shown = b.filter(n => SPOT[n] && !(n === 'Tent' && b.includes('Castle walls')));
  const vSig = shown.join() + '|' + (Sc.ruins || []).join();
  if (vSig !== sig.village) { sig.village = vSig; buildVillage(shown, Sc.ruins || []); }
  const sw = fx.find(e => e.kind === 'swoop' && e.age < SWOOP && e.slot != null);
  const pl = [...(Sc.piles || [])]; if (sw && sw.age < SWOOP * .48 && !pl.some(q => q.slot === sw.slot)) pl.push({ slot: sw.slot, g: sw.g || 10 }); // still there until it lands
  const pSig = pl.map(q => q.slot + ':' + q.g + ':' + !!q.mark).join();
  if (pSig !== sig.piles) { sig.piles = pSig; buildPiles(pl); }
  const fSig = (Sc.folk || []).map(f => f.rank + (f.done ? 'd' : '')).join();
  if (fSig !== sig.folk) { sig.folk = fSig; buildFolk(Sc.folk || []); }
  const hoard = Math.min(10, Math.ceil((Sc.hoard || 0) / 20));
  if (hoard !== sig.hoard) { sig.hoard = hoard; hoardG.clear(); for (let i = 0; i < hoard; i++) add(new THREE.CylinderGeometry(.5, .5, .2, 6), M(C.gold), Math.cos(i * 2.4) * Math.sqrt(i) * .7, .15 + (i > 6 ? .2 : 0), Math.sin(i * 2.4) * Math.sqrt(i) * .7, hoardG, false); }

  // the mood: a breach burns, a broken gate brings storms, a circling dragon brings the sunset, otherwise the time of day
  const mood = rk?.kind === 'breach' && rk.age > RECKON * .4 ? 'fire' : broken ? 'storm' : Sc.mode === 'circle' && Sc.phase !== 'night' ? 'dusk' : Sc.phase || 'day';
  moodStep(mood, s, dt, first);

  // the dragon
  const hot = (Sc.piles || []).find(q => q.hot), ds = [1.3, 1.45, 1.6, 1.75][Sc.lvl] || 1.4;
  dragon.scale.setScalar(ds);
  const [nx, nz] = at(...NEST), perch = { x: nx, y: NEST_Y + 2.6, z: nz, folded: true, face: Math.atan2(-nx, -nz) };
  let pose;
  if (rk) { const p = flight(rk.age, RECKON, GATE[0], GATE[2] + 4, rk.kind === 'held' ? 12 : 5); pose = p.home && p.folded ? perch : p; pose.bonk = rk.kind === 'held' && p.hit; pose.carry = rk.kind === 'breach' && rk.age > RECKON * .5; }
  else if (sw) { const [x, z] = at(...pileAt(sw.slot)), p = flight(sw.age, SWOOP, x, z, 3.5); pose = p.home && p.folded ? perch : p; pose.carry = sw.age > SWOOP * .5; }
  else if (Sc.mode === 'circle') { const [x, z] = hot ? at(...pileAt(hot.slot)) : at(0, 12), a = s * .7; pose = { x: x + Math.cos(a) * 12, y: 16 + Math.sin(s * 1.3), z: z + Math.sin(a) * 12, bank: .35, face: -a }; }
  else pose = { ...perch, sleep: Sc.mode === 'sleep' };
  poseDragon(pose, s, dt);
  ringM.visible = !!hot && Sc.mode === 'circle' && (t | 0) % 4 < 3; if (hot) { const [x, z] = at(...pileAt(hot.slot)); ringM.position.set(x, .2, z); }

  // the rest of the motion: flags, smoke, the mill, villagers, campfire, gold flying into the keep, sparkles
  flags.forEach((f, i) => { const p = f.geometry.attributes.position, bs = f.userData.base; for (let k = 0; k < p.count; k++) p.setZ(k, bs[k * 3 + 2] + Math.sin(s * 6 + bs[k * 3] * 2 + i) * .25 * (bs[k * 3] + 1.1)); p.needsUpdate = true; });
  smokes.forEach(p => { const k = (s * .5 + p.userData.k / 3) % 1; p.position.y = p.userData.y + k * 5; p.position.x = p.userData.x + k * 1.4; p.scale.setScalar(.6 + k); p.visible = k < .9; });
  village.traverse(o => { if (o.userData.sails) o.rotation.z = s * .8; });
  castle.traverse(o => { if (o.userData.flame) o.scale.set(1 + Math.sin(s * 9) * .1, 1 + Math.sin(s * 13) * .2, 1); });
  const walkers = Sc.camp || hfolk.children.length ? 0 : Math.min(3, Math.floor(shown.length / 2)), cross = at(-44, at2s(0, 30)[1]);
  const paths = [[[0, 21], [0, 48]], [[0, 30], cross], [[0, 24], [0, 40]]];
  folk.forEach((g, i) => {
    g.visible = i < walkers; if (!g.visible) return;
    const [[ax, az], [bx, bz]] = paths[i], len = Math.hypot(bx - ax, bz - az), d = (s * (2.2 - i * .4) + i * 17) % (len * 2), k = d < len ? d / len : 2 - d / len;
    g.position.set(lerp(ax, bx, k), 0, lerp(az, bz, k)); g.rotation.y = Math.atan2(bx - ax, bz - az) + (d < len ? 0 : Math.PI);
  });
  // habit villagers: the ones done today walk their rounds of the village, the rest wait by the well
  let wait = 0;
  hfolk.children.forEach(g => {
    const { i, done } = g.userData;
    if (done) { const r = 25 + (i % 3) * 4, dir = i % 2 ? -1 : 1, a = s * .22 * dir + i * 2.1; g.position.set(Math.cos(a) * r, Math.abs(Math.sin(s * 5 + i)) * .25, Math.sin(a) * r); g.rotation.y = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir); }
    else { const [x, z] = at(-27 + (wait % 4) * 3, 10 + Math.floor(wait / 4) * 3); wait++; g.position.set(x, 0, z); g.rotation.y = Math.atan2(-x, -z) + Math.sin(s * .8 + i) * .4; }
  });
  let ci = 0, si2 = 0;
  for (const e of fx) {
    if (e.kind === 'kept') { const [x0, z0] = e.slot != null ? at(...pileAt(e.slot)) : at(-20, 30); for (let i = 0; i < (e.n || 6) && ci < coins.length; i++) { const k = (e.age - i * .9) / 10; if (k < 0 || k > 1) continue; coins[ci++].position.set(lerp(x0, GATE[0], k), 1 + Math.sin(k * Math.PI) * 12, lerp(z0, GATE[2], k)); } }
    if (e.kind === 'built' && e.age < 18) for (let i = 0; i < 10 && si2 < sparks.length; i++) { const a = i * .63 + e.age * .3, r = 3 + e.age * .8; if ((Math.floor(e.age) + i) % 3) sparks[si2++].position.set(Math.cos(a) * r, 14 + Math.sin(a) * 2, -3 + Math.sin(a) * r); }
  }
  if (pose.bonk) for (let i = 0; i < 6 && si2 < sparks.length; i++) { const a = i * 1.05 + s * 4; sparks[si2++].position.set(GATE[0] + Math.cos(a) * 3, 13 + Math.sin(a * 2) * .5, GATE[2] + 4 + Math.sin(a) * 3); }
  for (; ci < coins.length; ci++) coins[ci].position.y = -9;
  for (; si2 < sparks.length; si2++) sparks[si2].position.y = -9;

  if (glLost) return;
  POST.uniforms.thr.value = LOOK.ink > 0 ? 1.5 / (cam.far - cam.near) / LOOK.ink : 9;
  for (const g of [...folk, ...hfolk.children]) g.scale.setScalar((g.userData.s ||= g.scale.x) * LOOK.folk);
  R.setRenderTarget(rt); R.render(scene, cam); R.setRenderTarget(null); R.render(qs, qcam);
  c.imageSmoothingEnabled = false; c.drawImage(out, 0, 0);
  // the breach: a flash and a burst at the gate
  if (rk?.kind === 'breach' && rk.age > RECKON * .45 && rk.age < RECKON * .45 + 10) { const [gx, gy] = onScreen(GATE[0], 3, GATE[2]), r = 3 + (rk.age - RECKON * .45) * 2.4; c.fillStyle = 'rgba(255,200,90,.85)'; c.beginPath(); c.arc(gx, gy, r, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(255,250,220,.9)'; c.beginPath(); c.arc(gx, gy, r * .5, 0, Math.PI * 2); c.fill(); }
  for (const q of Sc.piles || []) { const [x, z] = at(...pileAt(q.slot)), [px, py] = onScreen(x, 0, z), str = String(q.g); text(c, str, px, py + 3 * Math.round(PW / SW), '#fff0a0', 'rgba(10,8,20,.72)', true); }
  if (pose.sleep) { const [px, py] = onScreen(nx, NEST_Y + 6, nz); for (let i = 0; i < 3; i++) { const k = (s * .7 + i * 1.3) % 4; if (k < 3) { const u = Math.round(PW / SW); text(c, 'z', px + (6 + Math.round(k * 3)) * u, py - (4 + Math.round(k * 5)) * u, '#d8d0f0'); } } }
}
