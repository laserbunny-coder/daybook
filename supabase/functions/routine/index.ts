// Routine setup: the person describes their ideal day and Claude drafts it as habits
// (repeating tasks with a time, a length and the days they happen). The app shows the
// draft to change before anything is saved.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { cors, json, userFrom } from "../_shared/common.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const SYSTEM = `You help someone set up their daily routine in Daybook, a planner where the day is also a game: each habit on the plan is a quest worth gold, and a dragon takes the gold of any quest left unchecked past its time.

From what they tell you about their ideal day, draft their habits:
- A habit is something they mean to do on a regular schedule: waking rituals, exercise, a daily deep-work block, a walk, reading, a shutdown review. Keep their words for titles, short (two to five words).
- Give each a start time (start_min, minutes after midnight) when they said or clearly implied one, in the order of their day. Use null only for things that truly have no time ("sometime that day").
- duration_min: what they said, or a realistic length (5 to 180).
- repeat: "day" for every day, "weekday" for Monday to Friday, "weekend" for Saturday and Sunday. Use what they said; work things default to "weekday".
- area_id: the area it belongs to, from the areas given (personal habits in a Personal area, work blocks in a Business or work area), or null if none fits.
- Don't repeat habits they already have (given as existing). Don't add one-off tasks; big project work is added day by day, not as a habit, unless they describe a fixed daily block for it.
- Keep it doable: if they describe more than about ten habits, keep the ones that matter most and say so.

reply: two or three friendly sentences for the person: what you drafted and anything you guessed (times, lengths) that they should check. Plain words, no lists.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "habits"],
  properties: {
    reply: { type: "string" },
    habits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "start_min", "duration_min", "repeat", "area_id"],
        properties: {
          title: { type: "string" },
          start_min: { type: ["integer", "null"] },
          duration_min: { type: "integer" },
          repeat: { type: "string", enum: ["day", "weekday", "weekend"] },
          area_id: { type: ["string", "null"] },
        },
      },
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const user = await userFrom(req);
  if (!user) return json({ error: "Not signed in" }, 401);
  const { text, existing = [], areas = [] } = await req.json() as { text: string; existing?: unknown[]; areas?: unknown[] };
  if (!text?.trim()) return json({ error: "Tell me about your day first." }, 400);
  try {
    const response = await client.beta.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Areas: ${JSON.stringify(areas)}\nHabits they already have: ${JSON.stringify(existing)}\n\nTheir ideal day:\n${text}` }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    });
    const t = response.content.find((b) => b.type === "text");
    if (response.stop_reason === "refusal" || !t || t.type !== "text") return json({ error: "Claude didn't draft anything. Try saying it another way." }, 502);
    return json(JSON.parse(t.text));
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
});
