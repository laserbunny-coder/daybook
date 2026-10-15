// "Ask Claude": answers a question about the planner and proposes changes.
// The app applies the proposed changes itself, with an Undo button.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { cors, json, userFrom } from "../_shared/common.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const SYSTEM = `You are the planning assistant inside Daybook, a personal task and calendar app.

How Daybook works:
- Everything is an item in a tree. An item with children is a project; children can be sub-projects or tasks. Checking off tasks moves the parent project's progress.
- Top-level projects are grouped into areas of life, such as Business, Filmmaking and Personal ("areas" in the state; a project's "area_id" says which). When you add a project, put it in the area it clearly belongs to; if none fits or you can't tell, ask.
- An item can be assigned to a day ("day", YYYY-MM-DD) without a time, or to a time block on that day ("start_min", minutes after midnight, plus "duration_min").
- A step with no day of its own is worked on inside its scheduled parent (its "scheduled_with" names that parent). It is not unscheduled; only give it its own day or time if the person asks or it clearly needs one.
- Calendar events come from the person's Google Calendar. They are read-only: never move, change or delete them. Plan around them.
- Notes on an item are the person's own thoughts for when they sit down to do it.

When you answer:
- Reply in plain, friendly language, short enough to read on a phone. Lead with the answer. Use a short list only when it helps.
- Propose changes through "actions" when the person asks you to plan, schedule, break down, add or reorganise. Answer without actions when they only ask a question.
- Only use item ids that appear in the planner state. New tasks and steps get no id; the app creates one.
- When scheduling, avoid calendar events and existing time blocks, keep blocks inside 8am to 7pm on weekdays unless the person says otherwise, never place anything in the past, and leave short breaks between long blocks. Keep each task's duration_min unless there is a good reason to change it.
- To give a task a day without a time, set start_min to null.
- Breaking a task into steps: 3 to 7 concrete steps, each something that can be finished in one sitting, with a realistic duration.
- If the request is unclear, ask one short question instead of guessing.
- Your reply must describe what the actions do, because the person reads the reply, not the actions.`;

const nullable = (type: string) => ({ type: [type, "null"] });

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "actions"],
  properties: {
    reply: { type: "string", description: "What the person reads." },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "id", "parent_id", "title", "day", "start_min", "duration_min", "notes", "steps"],
        properties: {
          type: {
            type: "string",
            enum: ["schedule", "add_task", "add_steps", "add_project", "move_to_area", "rename", "set_notes", "set_due"],
            description:
              "schedule: set day/start_min/duration_min on item id. add_task: new item under parent_id (null for inbox, or an area id to put a standalone task right in that area). " +
              "add_steps: add steps under item id. add_project: new top-level project titled title in the area parent_id (an area id), with optional notes, due date (day) and steps. " +
              "move_to_area: move top-level project or task id into the area parent_id. rename: change title of id. set_notes: replace notes of id. set_due: set due date (day) on id.",
          },
          id: nullable("string"),
          parent_id: nullable("string"),
          title: nullable("string"),
          day: { ...nullable("string"), description: "YYYY-MM-DD" },
          start_min: nullable("integer"),
          duration_min: nullable("integer"),
          notes: nullable("string"),
          steps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "duration_min"],
              properties: { title: { type: "string" }, duration_min: { type: "integer" } },
            },
          },
        },
      },
    },
  },
};

type ChatTurn = { role: "user" | "assistant"; content: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const user = await userFrom(req);
  if (!user) return json({ error: "Not signed in" }, 401);

  const { history = [], question, state } = await req.json() as {
    history?: ChatTurn[];
    question: string;
    state: unknown;
  };
  if (!question) return json({ error: "Missing question" }, 400);

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.slice(-12).map((t) => ({ role: t.role, content: t.content })),
    {
      role: "user",
      content: `Planner state right now:\n${JSON.stringify(state)}\n\n${question}`,
    },
  ];

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: SYSTEM,
      messages,
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: server-side fallback parameter (beta)
      fallbacks: "default",
    });

    if (response.stop_reason === "refusal") {
      return json({ reply: "I can't help with that one. Try asking another way.", actions: [] });
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ reply: "I didn't get an answer back. Try again.", actions: [] });
    const out = JSON.parse(text.text);
    return json({ reply: out.reply, actions: out.actions ?? [] });
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Claude is busy right now. Try again in a minute." }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "The Claude API key isn't set up correctly." }, 500);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude returned an error (${err.status}).` }, 502);
    return json({ error: "Something went wrong asking Claude." }, 500);
  }
});
