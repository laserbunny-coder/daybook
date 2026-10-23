// Scribe, the dictation app: a recording comes in from the phone keyboard (or
// the Windows app), is written out by the same speech service as Inkwell's
// Capture, then Claude rewrites it in the chosen style. The device proves who
// it is with a secret made in Inkwell under "Connect Scribe"; only a hash of
// it is kept (scribe_tokens).
//
//   GET  …/scribe/styles  -> { styles: [{ id, name, apps }] }
//   POST …/scribe         multipart: audio (file), style, app, duration (ms)
//                         -> { original, text, style }
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { admin, cors, json } from "../_shared/common.ts";
import { transcribe } from "../inkwell/capture.ts";
import { STYLES, type Style } from "./styles.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const headers = { ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

const HINT = "Someone dictating a text message, an email or a note to type into their phone or computer.";

const SYSTEM = `You turn a dictated voice note into the text the person meant to type, ready to send as is. It was spoken out loud and written out word for word, so it may ramble, repeat itself, correct itself ("no wait, Thursday") or include asides. Write the finished text in their own voice, as them, in the style they picked.

- Use only what they said. Never add facts, names, plans, promises or details of your own.
- If they talk to you ("make this sound friendly", "scratch that last part"), follow it and leave the instruction out of the text.
- Never answer questions in the note or reply to it: it's their message to someone else.
- Plain text only, no Markdown. Only the finished text, with nothing before or after it.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string", description: "The finished text, ready to type in." } },
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

async function rewrite(said: string, style: Style, app: string): Promise<string> {
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Style: ${style.name}. ${style.prompt}${app ? `\n\nThey're typing into: ${app}` : ""}\n\nWhat they said:\n${said.slice(0, 60000)}`,
    }],
    // Low effort keeps it quick enough to wait for with the keyboard open.
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: server-side fallback parameter (beta)
    fallbacks: "default",
  });
  if (response.stop_reason !== "end_turn") throw new Error(`Claude stopped early (${response.stop_reason}).`);
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No answer came back.");
  return String(JSON.parse(text.text).text ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

  if (!await ownerOf(req)) return reply({ error: "Scribe isn't connected. Open Scribe and tap Connect.", code: "not-connected" }, 401);

  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/styles")) {
    return reply({ styles: STYLES.map(({ id, name, apps }) => ({ id, name, apps })) });
  }
  if (req.method !== "POST") return reply({ error: "Not found" }, 404);

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!form || !(audio instanceof File) || !audio.size) return reply({ error: "No recording came through." }, 400);
  const style = STYLES.find((s) => s.id === form.get("style")) ?? STYLES[0];
  const app = String(form.get("app") ?? "").slice(0, 100);

  let original = "";
  try {
    original = await transcribe(audio, audio.name || "scribe.m4a", Number(form.get("duration")) || 0, HINT);
  } catch (err) {
    const e = err as Error & { code?: string; status?: number };
    console.error(e);
    return reply({ error: e.message, code: e.code ?? null }, e.status ?? 500);
  }
  if (!original) return reply({ original: "", text: "", style: style.id });
  if (!style.prompt) return reply({ original, text: original, style: style.id });

  try {
    return reply({ original, text: await rewrite(original, style, app), style: style.id });
  } catch (err) {
    // The words still come back, so nothing said is lost.
    console.error(err);
    return reply({ original, text: original, style: style.id, warning: "Claude couldn't rewrite it this time, so here are your words as said." });
  }
});
