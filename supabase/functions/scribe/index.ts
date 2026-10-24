// Scribe, the dictation app: a recording comes in from the phone keyboard (or
// the Windows app), is written out by the same speech service as Inkwell's
// Capture, then Claude rewrites it in the chosen mode (Text message, Email, …).
// The device proves who it is with a secret made in Inkwell under "Connect
// Scribe"; only a hash of it is kept (scribe_tokens). Modes are the person's
// own (scribe_modes), starting from modes.ts.
//
//   GET  …/scribe/modes                     -> { modes }
//   POST …/scribe  multipart: audio, mode, app, duration (ms)
//                                           -> { original, text, mode }
//   POST …/scribe  multipart: action=make-mode, audio, [current = the mode being changed, as JSON]
//                                           -> { said, mode }  (not saved yet)
//   POST …/scribe  JSON { action: "redo", original, mode, app } -> { text, mode }
//   POST …/scribe  JSON { action: "save-mode", mode: { id?, name, prompt, apps, model? } } -> { mode }
//   POST …/scribe  JSON { action: "delete-mode", id } -> { ok }
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { admin, cors } from "../_shared/common.ts";
import { transcribe } from "../inkwell/capture.ts";
import { type Mode, type Model, MODELS, STARTER_MODES } from "./modes.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const headers = { ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

const HINT = "Someone dictating a text message, an email or a note to type into their phone or computer.";

const SYSTEM = `You turn a dictated voice note into the text the person meant to type, ready to send as is. It was spoken out loud and written out word for word, so it may ramble, repeat itself, correct itself ("no wait, Thursday") or include asides. Write the finished text in their own voice, as them, in the mode they picked.

- Use only what they said. Never add facts, names, plans, promises or details of your own.
- If they talk to you ("make this sound friendly", "scratch that last part"), follow it and leave the instruction out of the text.
- Never answer questions in the note or reply to it: it's their message to someone else.
- Plain text only, no Markdown. Only the finished text, with nothing before or after it.`;

const TEXT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string", description: "The finished text, ready to type in." } },
};

const MODE_SYSTEM = `You help someone set up a mode in Scribe, their dictation keyboard. A mode is a short instruction, in plain words, for how their dictated words get rewritten before they're typed in (for example "A text message. Short and casual, keep my wording, no emoji."). They describe the mode they want out loud, or a change to one they have.

- name: two or three words, like "Work Slack" or "Email".
- prompt: the instruction, written as they'd say it, 1 to 4 sentences. Keep everything they asked for and add nothing they didn't. For a change, start from the current instruction and change only what they asked.
- model: which Claude writes it. "haiku" is quick and cheap, right for texts, chat and light clean-ups; "sonnet" suits emails and everyday writing with some tone; "opus" is for writing that matters: long idea dumps, journaling, characters and voices, anything creative. If they name one ("use Opus for this", "the cheap one", "the best one"), use it. For a change they didn't ask about, keep the current one; for a new mode, pick by what it's for.
- apps: the apps they said it's for, as Android app ids (Slack is "com.Slack", Gmail "com.google.android.gm", WhatsApp "com.whatsapp", Google Messages "com.google.android.apps.messaging", Outlook "com.microsoft.office.outlook", LinkedIn "com.linkedin.android", Discord "com.discord") plus the Windows program name when there's a desktop app ("slack.exe", "outlook.exe"). Only apps they named or that are already on the mode; empty if none.`;

const MODE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "prompt", "model", "apps"],
  properties: {
    name: { type: "string" },
    prompt: { type: "string" },
    model: { type: "string", enum: MODELS },
    apps: { type: "array", items: { type: "string" } },
  },
};

async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function ownerOf(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const { data } = await admin().from("scribe_tokens").select("user_id").eq("token_hash", await sha256(token)).maybeSingle();
  return data?.user_id ?? null;
}

// The person's modes, in order; the starting set is copied in the first time.
async function modesOf(userId: string): Promise<Mode[]> {
  const sb = admin();
  const { data, error } = await sb.from("scribe_modes").select("id,name,prompt,apps,model").eq("user_id", userId).order("sort").order("id");
  if (error) throw error;
  if (data.length) return data as Mode[];
  const rows = STARTER_MODES.map((m, i) => ({ ...m, user_id: userId, sort: i * 10 }));
  const { error: e2 } = await sb.from("scribe_modes").upsert(rows, { onConflict: "user_id,id", ignoreDuplicates: true });
  if (e2) throw e2;
  return STARTER_MODES;
}

const clean = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
const cleanApps = (a: unknown) =>
  (Array.isArray(a) ? a : []).filter((x) => typeof x === "string" && x.trim()).map((x: string) => x.trim().slice(0, 100)).slice(0, 20);

const MODEL_IDS: Record<Model, string> = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
const modelOf = (m: unknown): Model | null => (MODELS as unknown[]).includes(m) ? m as Model : null;

async function ask(system: string, content: string, schema: { [key: string]: unknown }, model: Model = "opus"): Promise<Record<string, unknown>> {
  const request = {
    model: MODEL_IDS[model],
    max_tokens: 16000,
    system,
    messages: [{ role: "user" as const, content }],
    // Low effort keeps it quick enough to wait for with the keyboard open.
    output_config: { effort: "low" as const, format: { type: "json_schema" as const, schema } },
  };
  // Opus retries a declined request on another model by itself; the smaller
  // models don't have that, so a decline there goes to Opus instead.
  const response = model === "opus"
    // @ts-ignore: server-side fallback parameter (beta)
    ? await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
    : await client.beta.messages.create(request);
  if (response.stop_reason === "refusal" && model !== "opus") return ask(system, content, schema, "opus");
  if (response.stop_reason !== "end_turn") throw new Error(`Claude stopped early (${response.stop_reason}).`);
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No answer came back.");
  return JSON.parse(text.text);
}

async function rewrite(said: string, mode: Mode, app: string): Promise<string> {
  if (!mode.prompt.trim()) return said;
  const out = await ask(SYSTEM, `Mode: ${mode.name}. ${mode.prompt}${app ? `\n\nThey're typing into: ${app}` : ""}\n\nWhat they said:\n${said.slice(0, 60000)}`, TEXT_SCHEMA, modelOf(mode.model) ?? "opus");
  return String(out.text ?? "").trim() || said;
}

// Writes out an uploaded recording; errors come back as a ready reply.
async function writeOut(form: FormData): Promise<string | Response> {
  const audio = form.get("audio");
  if (!(audio instanceof File) || !audio.size) return reply({ error: "No recording came through." }, 400);
  try {
    return await transcribe(audio, audio.name || "scribe.m4a", Number(form.get("duration")) || 0, HINT);
  } catch (err) {
    const e = err as Error & { code?: string; status?: number };
    console.error(e);
    return reply({ error: e.message, code: e.code ?? null }, e.status ?? 500);
  }
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "mode";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  const userId = await ownerOf(req);
  if (!userId) return reply({ error: "Scribe isn't connected. Open Scribe and tap Connect.", code: "not-connected" }, 401);

  try {
    if (req.method === "GET" && new URL(req.url).pathname.endsWith("/modes")) return reply({ modes: await modesOf(userId) });
    if (req.method !== "POST") return reply({ error: "Not found" }, 404);

    const isForm = (req.headers.get("Content-Type") ?? "").includes("multipart/form-data");
    const form = isForm ? await req.formData().catch(() => null) : null;
    const body = isForm ? null : await req.json().catch(() => null) as Record<string, unknown> | null;
    const action = String(form?.get("action") ?? body?.action ?? "dictate");
    const modes = await modesOf(userId);
    const pick = (id: unknown) => modes.find((m) => m.id === id) ?? modes[0];

    if (action === "dictate" && form) {
      const said = await writeOut(form);
      if (typeof said !== "string") return said;
      const mode = pick(form.get("mode"));
      if (!said) return reply({ original: "", text: "", mode: mode.id });
      const app = clean(form.get("app"), 100);
      try {
        return reply({ original: said, text: await rewrite(said, mode, app), mode: mode.id });
      } catch (err) {
        // The words still come back, so nothing said is lost.
        console.error(err);
        return reply({ original: said, text: said, mode: mode.id, warning: "Claude couldn't rewrite it this time, so here are your words as said." });
      }
    }

    if (action === "redo" && body) {
      const said = clean(body.original, 60000);
      if (!said) return reply({ error: "Nothing to redo." }, 400);
      const mode = pick(body.mode);
      return reply({ text: await rewrite(said, mode, clean(body.app, 100)), mode: mode.id });
    }

    if (action === "make-mode" && form) {
      const said = await writeOut(form);
      if (typeof said !== "string") return said;
      if (!said) return reply({ error: "Didn't catch anything. Try again a little closer." }, 422);
      // The mode being changed: sent whole (it may be an unsaved draft), else by id.
      let current: Mode | undefined = modes.find((m) => m.id === form.get("mode"));
      try {
        const c = JSON.parse(String(form.get("current") ?? "null"));
        if (c && typeof c === "object") current = { id: clean(c.id, 40), name: clean(c.name, 40), prompt: clean(c.prompt, 2000), apps: cleanApps(c.apps), model: modelOf(c.model) ?? modes.find((m) => m.id === c.id)?.model ?? "opus" };
      } catch { /* not sent */ }
      const out = await ask(MODE_SYSTEM, current
        ? `The mode now:\nName: ${current.name}\nInstruction: ${current.prompt}\nModel: ${current.model}\nApps: ${current.apps.join(", ") || "none"}\n\nThe change they asked for:\n${said}`
        : `The mode they asked for:\n${said}`, MODE_SCHEMA);
      return reply({ said, mode: { id: current?.id || null, name: clean(out.name, 40), prompt: clean(out.prompt, 2000), apps: cleanApps(out.apps), model: modelOf(out.model) ?? current?.model ?? "opus" } });
    }

    if (action === "save-mode" && body && typeof body.mode === "object" && body.mode) {
      const m = body.mode as Record<string, unknown>;
      const name = clean(m.name, 40);
      if (!name) return reply({ error: "A mode needs a name." }, 400);
      let id = clean(m.id, 40);
      if (!id) { id = slug(name); while (modes.some((x) => x.id === id)) id = `${slug(name)}-${Math.floor(Math.random() * 1000)}`; }
      const at = modes.findIndex((x) => x.id === id);
      // A phone app from before models came in sends none: keep what the mode had.
      const model = modelOf(m.model) ?? (at >= 0 ? modes[at].model : null) ?? "opus";
      const row = { user_id: userId, id, name, prompt: clean(m.prompt, 2000), apps: cleanApps(m.apps), model, sort: at >= 0 ? at * 10 : modes.length * 10, updated_at: new Date().toISOString() };
      const { error } = await admin().from("scribe_modes").upsert(row, { onConflict: "user_id,id" });
      if (error) throw error;
      return reply({ mode: { id, name: row.name, prompt: row.prompt, apps: row.apps, model } });
    }

    if (action === "delete-mode" && body) {
      if (modes.length <= 1) return reply({ error: "Keep at least one mode." }, 400);
      const { error } = await admin().from("scribe_modes").delete().eq("user_id", userId).eq("id", clean(body.id, 40));
      if (error) throw error;
      return reply({ ok: true });
    }

    return reply({ error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return reply({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.APIError) return reply({ error: `Claude returned an error (${err.status}).` }, 502);
    return reply({ error: "Something went wrong in Scribe's server step." }, 500);
  }
});
