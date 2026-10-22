// Voice captures from Inkwell: the recording (already in the person's folder in
// the writing-files bucket) is written out by a speech service, then Claude
// adds a short tidy outline. Claude never rewrites the words themselves.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { admin, json } from "../_shared/common.ts";

const OUTLINE_SYSTEM = `You help a writer and filmmaker keep their ideas. They record ideas out loud (often while driving or walking) and the recording has been written out word for word. Under it, you add a short, tidy outline of the idea so it's easy to scan later.

- Use only what they said. Never add ideas, names, plot or details of your own, and never judge the idea.
- A few short lines, each starting with a label and a colon, in this order, and only the ones the recording actually has: Premise, Characters, World, Moments, Images, Lines (dialogue or jokes worth keeping), Questions (things they wondered or left open), Links (other projects or ideas they connected it to).
- Each line is a short phrase or two, in plain words, close to their wording. No Markdown, no bullets, no quotes around lines.
- If the recording is very short, or is a single thought, a reminder or a list, return no lines: the words already say it.`;

const OUTLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outline"],
  properties: { outline: { type: "array", items: { type: "string" } } },
};

const OPENAI_LIMIT = 25 * 1024 * 1024;

async function transcribe(blob: Blob, name: string, durationMs: number): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw Object.assign(new Error("Writing out recordings isn't set up yet."), { code: "no-transcriber", status: 503 });
  if (blob.size > OPENAI_LIMIT) throw Object.assign(new Error("That recording is too long to write out in one go."), { status: 413 });
  // The newer model is the most accurate, but it can stop early on long
  // recordings; past a few minutes the older one writes out the whole thing.
  const model = durationMs && durationMs < 7 * 60 * 1000 ? "gpt-4o-transcribe" : "whisper-1";
  const form = new FormData();
  form.append("file", blob, name);
  form.append("model", model);
  form.append("response_format", "json");
  form.append("prompt", "A writer and filmmaker talking through an idea for a story, a film, a show or a scene.");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (res.status === 401) throw Object.assign(new Error("The speech service's key isn't set up correctly."), { code: "no-transcriber", status: 503 });
  if (!res.ok) throw Object.assign(new Error(`The speech service returned an error (${res.status}).`), { status: 502 });
  const out = await res.json();
  return typeof out.text === "string" ? out.text.trim() : "";
}

async function outlineOf(client: Anthropic, transcript: string): Promise<string[]> {
  if (transcript.split(/\s+/).length < 25) return [];
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: OUTLINE_SYSTEM,
    messages: [{ role: "user", content: `The recording, written out:\n\n${transcript.slice(0, 60000)}` }],
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTLINE_SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: server-side fallback parameter (beta)
    fallbacks: "default",
  });
  if (response.stop_reason !== "end_turn") return [];
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return [];
  const out = JSON.parse(text.text);
  return (out.outline ?? []).filter((s: unknown) => typeof s === "string").slice(0, 12);
}

type CaptureBody = { file?: string; transcript?: string; duration?: number };

export async function capture(client: Anthropic, userId: string, body: CaptureBody): Promise<Response> {
  let transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  try {
    if (!transcript) {
      if (typeof body.file !== "string" || !/^[\w-]+$/.test(body.file)) return json({ error: "Missing recording" }, 400);
      const { data, error } = await admin().storage.from("writing-files").download(`${userId}/${body.file}`);
      if (error || !data) return json({ error: "The recording hasn't reached the cloud yet." }, 404);
      const type = data.type || "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "webm";
      transcript = await transcribe(data, `capture.${ext}`, Number(body.duration) || 0);
    }
  } catch (err) {
    const e = err as Error & { code?: string; status?: number };
    console.error(e);
    return json({ error: e.message, code: e.code ?? null }, e.status ?? 500);
  }
  // The words are kept even if the outline can't be made this time.
  let outline: string[] = [];
  try { outline = await outlineOf(client, transcript); } catch (err) { console.error(err); }
  return json({ transcript, outline });
}
