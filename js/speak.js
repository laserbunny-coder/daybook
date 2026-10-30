// Gristlemaw's voice: a line of his, spoken in the voice Michael picked (ElevenLabs, through the voice function).
// The server keeps every line it has spoken, so a replay costs nothing. While he talks, level() says how far his
// jaw is open, letter by letter from ElevenLabs' timings: vowels wide, m/b/p shut, pauses closed.
// The cave's music ducks under him. Same Sound on/off as the game's other sounds.
import * as sfx from './sfx.js';
import * as cave from './cave.js';

const got = new Map(); // text -> the server's answer: { url, alignment }
let audio = null, timing = null, seq = 0, mouth = 0;

function fetchLine(client, text) {
  if (!got.has(text)) got.set(text, client.functions.invoke('voice', { body: { action: 'say', text } })
    .then(({ data, error }) => (error || !data?.url ? null : data)).catch(() => null)
    .then(r => { if (!r) got.delete(text); return r; }));
  return got.get(text);
}

/** Say this line out loud (cutting off whatever he was saying). */
export async function speak(client, text) {
  text = String(text || '').trim();
  if (!client || !text || !sfx.on()) return;
  const my = ++seq; stop(false);
  const r = await fetchLine(client, text);
  if (my !== seq || !r || !sfx.on()) return;
  const a = new Audio(r.url); audio = a; timing = r.alignment || r.normalized || null;
  const done = () => { if (audio === a) { audio = null; cave.duck(false); } };
  a.onended = done; a.onerror = done; a.onpause = done;
  cave.duck(true);
  a.play().catch(done);
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
    want = t > (E?.[C.length - 1] ?? Infinity) ? 0 : OPEN.test(c) ? 1 : SHUT.test(c) ? .05 : MID.test(c) ? .45 : 0;
  } else if (audio && !audio.paused) want = .5 + .5 * Math.sin(performance.now() / 70); // no timings: just move
  mouth += (want - mouth) * Math.min(1, dt * (want > mouth ? 22 : 14));
  return mouth;
}
