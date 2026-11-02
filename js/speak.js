// Gristlemaw's voice: a line of his, spoken in the voice Michael picked (ElevenLabs, through the voice function).
// Big moments use his stock lines (bank/ in storage, recorded once for every player): a few are loaded ahead, so he
// answers the instant something happens. Any other line is voiced on request with the fast model and kept on the server.
// While he talks, level() says how far his jaw is open, letter by letter from ElevenLabs' timings: vowels wide,
// m/b/p shut, pauses closed. The cave's music ducks under him. Same Sound on/off as the game's other sounds.
import * as sfx from './sfx.js';
import * as cave from './cave.js';

const got = new Map(); // text -> the server's answer: { url, alignment }
let audio = null, timing = null, seq = 0, mouth = 0;

/* ---------- the stock lines ---------- */
const HEARD = 'daybook-voice-heard';
let bank = null, loading = null, last = null; const ready = new Map(); // moment -> { line, audio } loaded and waiting
const pub = (client, p) => client.storage.from('voices').getPublicUrl(p).data.publicUrl;
/** Load the list of his stock lines and get one of each moment ready to play. */
export function prepare(client) {
  if (!client || bank || loading) return loading;
  loading = (async () => {
    const get = async p => { const r = await fetch(pub(client, p) + '?t=' + Math.floor(Date.now() / 36e5)); return r.ok ? r.json() : null; };
    const v = (await get('voice.json'))?.voice_id; if (!v) return;
    bank = ((await get(`bank/${v}/list.json`)) || []).map(x => ({ ...x, url: pub(client, x.f) }));
    for (const m of new Set(bank.map(x => x.m))) ready.set(m, load(next(m)));
  })().catch(() => {}).finally(() => { loading = null; });
  return loading;
}
const shown = t => t.replace(/\[[^\]]*\]\s*/g, '').trim(); // the delivery tags are heard, not read
function next(m) {
  const L = bank.filter(x => x.m === m); let heard = []; try { heard = JSON.parse(localStorage.getItem(HEARD) || '[]'); } catch {}
  const fresh = L.filter(x => !heard.includes(x.t)), from = fresh.length ? fresh : L;
  return from[Math.floor(Math.random() * from.length)];
}
function load(x) { const a = new Audio(x.url); a.preload = 'auto'; a.load(); return { x, a }; }
/** Say a stock line for this moment right away. Returns the words to show (without tags), or null if there's none. */
export function stock(m) {
  const r = ready.get(m); if (!r || !sfx.on()) return null;
  const { x, a } = r; ready.set(m, load(next(m)));
  try { const h = JSON.parse(localStorage.getItem(HEARD) || '[]').filter(t => t !== x.t); h.push(x.t); localStorage.setItem(HEARD, JSON.stringify(h.slice(-150))); } catch {}
  const tm = x.a ? { characters: [...x.a.c], character_start_times_seconds: x.a.s, character_end_times_seconds: [...Array(x.a.s.length - 1).fill(0), x.a.e] } : null;
  play(a, tm); last = { t: shown(x.t), url: x.url, tm };
  return last.t;
}
/** Hear the last stock line again, if these are its words. */
export function again(text) { if (!last || last.t !== text || !sfx.on()) return false; play(new Audio(last.url), last.tm); return true; }

function play(a, t) {
  ++seq; stop(false); audio = a; timing = t; tags(t);
  a.currentTime = 0;
  const done = () => { if (audio === a) { audio = null; cave.duck(false); } };
  a.onended = done; a.onerror = done; a.onpause = done;
  cave.duck(true);
  a.play().catch(done);
}
// which letters sit inside a [tag]: the jaw stays shut through those
let inTag = [];
function tags(t) { let on = false; inTag = (t?.characters || []).map(c => { if (c === '[') on = true; const r = on; if (c === ']') on = false; return r; }); }

/* ---------- any other line ---------- */
function fetchLine(client, text, model) {
  const key = (model || '') + '|' + text;
  if (!got.has(key)) got.set(key, client.functions.invoke('voice', { body: { action: 'say', text, model } })
    .then(({ data, error }) => (error || !data?.url ? null : data)).catch(() => null)
    .then(r => { if (!r) got.delete(key); return r; }));
  return got.get(key);
}

/** Say this line out loud (cutting off whatever he was saying). model 'flash' is ElevenLabs' fast one. */
export async function speak(client, text, model) {
  text = String(text || '').trim();
  if (!client || !text || !sfx.on()) return;
  const my = ++seq; stop(false);
  const r = await fetchLine(client, text, model);
  if (my !== seq || !r || !sfx.on()) return;
  play(new Audio(r.url), r.alignment || r.normalized || null);
}
export function stop(bump = true) { if (bump) seq++; if (audio) { const a = audio; audio = null; a.pause(); } cave.duck(false); }
export const speaking = () => !!audio && !audio.paused;

const OPEN = /[aeiouyáéíóúAEIOUY]/, SHUT = /[mbpMBP]/, MID = /[a-zA-Z0-9]/;
/** How open his jaw is right now while talking, 0..1, eased so it doesn't flap. Call once a frame. */
export function level(dt) {
  let want = 0;
  if (audio && !audio.paused && timing?.characters) {
    const t = audio.currentTime, C = timing.characters, S = timing.character_start_times_seconds, E = timing.character_end_times_seconds;
    let i = 0; while (i < C.length - 1 && S[i + 1] <= t) i++;
    const c = C[i] || ' ';
    want = t > (E?.[C.length - 1] || Infinity) || inTag[i] ? 0 : OPEN.test(c) ? 1 : SHUT.test(c) ? .05 : MID.test(c) ? .45 : 0;
  } else if (audio && !audio.paused) want = .5 + .5 * Math.sin(performance.now() / 70); // no timings: just move
  mouth += (want - mouth) * Math.min(1, dt * (want > mouth ? 22 : 14));
  return mouth;
}
