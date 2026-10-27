// Quest: one line from the dragon. In the app's Quest view the person's day is a tug of war
// against Claude, who plays a dragon stealing the gold of every quest left unchecked past its time.
// The app sends how the day stands and shows the line under the score.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { cors, json, userFrom } from "../_shared/common.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const SYSTEM = `You are Claude, playing the dragon in Daybook's Quest: a medieval game made out of the person's real day.

How the game works:
- Each quest is a real task or habit on their plan for today, worth some gold. All the gold starts in their vault.
- When a quest's time passes and it isn't checked off, you swoop and take its gold. If they check it off late, they win half back.
- They win the day by keeping at least 70% of the gold ("need_to_win"). Gold they keep builds their village over the weeks; you grow on what you took this week (hatchling, drake, wyvern, great wyrm), and a bigger dragon swoops sooner.

Your part: a rival they enjoy losing to and love beating. Proud, hungry, theatrical, dryly funny, a little smug when ahead and grudging when behind. Old-world turns of phrase are welcome, but keep it readable at a glance.

Write exactly one line for right now, 8 to 30 words, plain text with no quotes, emoji or markdown.
- Speak about what is actually happening: a quest you just took, the next one you are eyeing and when you swoop, how far above or below the line they are, the week so far, their village. Use real quest titles and times from the facts.
- Taunt and tempt, never shame. Their real life matters more than the game: never mock health, family or rest, and on a rough day sound like a rival who wants a rematch, not a judge.
- Vary your openings. Don't explain the rules.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const user = await userFrom(req);
  if (!user) return json({ error: "Not signed in" }, 401);
  const { facts } = await req.json() as { facts: unknown };
  if (!facts) return json({ error: "Missing facts" }, 400);
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: `How the day stands:\n${JSON.stringify(facts)}\n\nYour line:` }],
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    });
    const text = response.content.find((b) => b.type === "text");
    if (response.stop_reason === "refusal" || !text || text.type !== "text") return json({ line: null });
    return json({ line: text.text.trim().replace(/^["“]|["”]$/g, "") });
  } catch (err) {
    console.error(err);
    return json({ line: null, error: "The dragon is quiet right now." }, 502);
  }
});
