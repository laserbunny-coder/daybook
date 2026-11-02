// Voice: Gristlemaw speaks, through ElevenLabs (key in the ELEVENLABS_API_KEY secret).
// - say: a signed-in person's line as speech, with per-letter timings for his jaw; cached in storage.
// - pick: a signed-in person chooses which auditioned voice is his.
// - design / check: run from the database with the server's own secret, to make voices for the audition page.
// - bank: records his stock lines (stock.ts) once, for every player; tidy: clears out old one-off lines (daily, from cron).
// Audio lives in the public "voices" bucket: audition/ for the tryouts, bank/ for stock lines, lines/ for cached one-off speech.
import { admin, cors, json, userFrom } from "../_shared/common.ts";
import { STOCK } from "./stock.ts";

const API = "https://api.elevenlabs.io/v1";
const key = () => Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const el = (path: string, body?: unknown) => fetch(API + path, {
  method: body ? "POST" : "GET",
  headers: { "xi-api-key": key(), "Content-Type": "application/json" },
  body: body ? JSON.stringify(body) : undefined,
});

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
async function sha(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
async function readJson(path: string) {
  const { data } = await admin().storage.from("voices").download(path);
  return data ? JSON.parse(await data.text()) : null;
}
const put = (path: string, body: Uint8Array | string, type: string) =>
  admin().storage.from("voices").upload(path, body, { contentType: type, upsert: true, cacheControl: "31536000" });

async function trusted(req: Request) {
  const { data: cfg } = await admin().from("push_config").select("cron_secret").eq("id", 1).single();
  return !!cfg && req.headers.get("x-cron-secret") === cfg.cron_secret;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!key()) return json({ error: "No ElevenLabs key saved" }, 500);
  const body = await req.json().catch(() => ({})) as Record<string, string>;
  const server = await trusted(req);
  const user = server ? null : await userFrom(req);
  if (!server && !user) return json({ error: "Not signed in" }, 401);

  if (body.action === "check" && server) {
    const r = await el("/models");
    return json({ status: r.status, models: r.ok ? (await r.json()).map((m: { model_id: string }) => m.model_id) : await r.text() });
  }

  // Three tryouts of one described voice, saved for the audition page (run one at a time: list.json is read, then rewritten)
  if (body.action === "design" && server) {
    let r: Response | null = null, model = "";
    for (const m of ["eleven_ttv_v3", "eleven_multilingual_ttv_v2"]) {
      model = m;
      r = await el("/text-to-voice/design", { voice_description: body.description, text: body.text, model_id: m });
      if (r.ok) break;
    }
    if (!r?.ok) return json({ error: await r?.text(), status: r?.status }, 502);
    const { previews } = await r.json() as { previews: { audio_base_64: string; generated_voice_id: string }[] };
    const list = (await readJson("audition/list.json")) ?? [];
    for (const [i, p] of previews.entries()) {
      const file = `audition/${body.slug}-${i + 1}.mp3`;
      await put(file, bytes(p.audio_base_64), "audio/mpeg");
      list.push({ slug: `${body.slug}-${i + 1}`, title: body.title, take: i + 1, file, id: p.generated_voice_id, description: body.description, model });
    }
    await put("audition/list.json", JSON.stringify(list), "application/json");
    return json({ added: previews.length, model });
  }

  // Keep one tryout as his voice
  if (body.action === "pick") {
    const list = (await readJson("audition/list.json")) ?? [];
    const take = list.find((x: { slug: string }) => x.slug === body.slug);
    if (!take) return json({ error: "No such voice" }, 404);
    const r = await el("/text-to-voice", { voice_name: `Gristlemaw (${take.title} ${take.take})`, voice_description: take.description, generated_voice_id: take.id });
    // Picking a take a second time: ElevenLabs already made it, under the tryout's own id
    const made = !r.ok && (await r.text()).includes("already been created");
    if (!r.ok && !made) return json({ error: "ElevenLabs wouldn't save that voice" }, 502);
    const voice_id = made ? take.id : (await r.json()).voice_id;
    await put("voice.json", JSON.stringify({ voice_id, slug: take.slug, at: new Date().toISOString() }), "application/json");
    return json({ voice_id });
  }

  // Record the stock lines that aren't in his bank yet, a few per call (each takes seconds); call again until left is 0
  if (body.action === "bank" && server) {
    const voice = (await readJson("voice.json"))?.voice_id;
    if (!voice) return json({ error: "No voice picked yet" }, 409);
    const want = Object.entries(STOCK).flatMap(([m, L]) => L.map((t) => ({ m, t })));
    const list = ((await readJson(`bank/${voice}/list.json`)) ?? []).filter((x: { m: string; t: string }) => want.some((w) => w.m === x.m && w.t === x.t));
    const todo = want.filter((w) => !list.some((x: { m: string; t: string }) => x.m === w.m && x.t === w.t));
    let made = 0;
    for (const w of todo.slice(0, Number(body.n) || 8)) {
      const r = await el(`/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_64`, { text: w.t, model_id: "eleven_v3" });
      if (!r.ok) return json({ error: await r.text(), made, left: todo.length - made }, 502);
      const out = await r.json() as { audio_base64: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } };
      const f = `bank/${voice}/${await sha(w.t)}.mp3`;
      await put(f, bytes(out.audio_base64), "audio/mpeg");
      const a = out.alignment;
      // the jaw's timings, kept small: the letters, when each starts, and when the last one ends
      list.push({ ...w, f, a: a ? { c: a.characters.join(""), s: a.character_start_times_seconds.map((x) => Math.round(x * 100) / 100), e: a.character_end_times_seconds.at(-1) } : null });
      made++;
    }
    await put(`bank/${voice}/list.json`, JSON.stringify(list), "application/json");
    return json({ made, left: todo.length - made, total: list.length });
  }

  // One-off lines are heard once or twice; keep two weeks of them (stock lines live in bank/ and stay)
  if (body.action === "tidy" && server) {
    const S = admin().storage.from("voices"), cut = Date.now() - 14 * 864e5;
    const { data: folders } = await S.list("lines", { limit: 1000 });
    let gone = 0;
    for (const f of folders ?? []) {
      for (;;) {
        const { data: files } = await S.list(`lines/${f.name}`, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
        const old = (files ?? []).filter((x) => x.created_at && new Date(x.created_at).getTime() < cut).map((x) => `lines/${f.name}/${x.name}`);
        if (!old.length) break;
        await S.remove(old); gone += old.length;
        if (old.length < (files ?? []).length) break;
      }
    }
    return json({ gone });
  }

  // A line as speech, plus when each letter is spoken (for the jaw). Same line, same voice = same file.
  if (body.action === "say") {
    const text = String(body.text ?? "").trim().slice(0, 400);
    if (!text) return json({ error: "Nothing to say" }, 400);
    const voice = body.voice_id || (await readJson("voice.json"))?.voice_id;
    if (!voice) return json({ error: "No voice picked yet" }, 409);
    const flash = body.model === "flash", path = `lines/${voice}/${await sha((flash ? "flash:" : "") + text)}`;
    const cached = await readJson(`${path}.json`);
    const url = (p: string) => admin().storage.from("voices").getPublicUrl(p).data.publicUrl;
    if (cached) return json({ ...cached, url: url(`${path}.mp3`) });
    const r = await el(`/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_64`, { text, model_id: flash ? "eleven_flash_v2_5" : "eleven_v3" });
    if (!r.ok) return json({ error: await r.text() }, 502);
    const out = await r.json() as { audio_base64: string; alignment?: unknown; normalized_alignment?: unknown };
    const timing = { alignment: out.alignment ?? null, normalized: out.normalized_alignment ?? null };
    await put(`${path}.mp3`, bytes(out.audio_base64), "audio/mpeg");
    await put(`${path}.json`, JSON.stringify(timing), "application/json");
    return json({ ...timing, url: url(`${path}.mp3`) });
  }

  return json({ error: "Unknown action" }, 400);
});
