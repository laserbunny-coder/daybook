// Acro HQ's meeting recordings (Michael, Nov 2): a recording added on HQ's Meetings tab (or shared to HQ
// from the phone) waits there as a meetings doc with status "new". Each step here takes one meeting one
// stage further, through HQ's Acro Meta connector:
//   new     -> written: ElevenLabs writes it out with the speakers told apart (../inkwell/speech.ts)
//   written -> ready:   Claude names the speakers and writes the summary, decisions and suggested tasks,
//                       with HQ's business context (settings/brief, open tasks) and Michael's own rules
//                       (settings/meetings.rules, edited on the board's "Meeting rules")
// A step claims its meeting first (status writing/thinking, lockedUntil), so two runs never do the same one,
// and a run that dies is picked up again once the lock runs out.
import type { Said } from "../inkwell/speech.ts";

export type Tool = (name: string, args: Record<string, unknown>) => Promise<Record<string, any>>;
export type Hear = (blob: null, name: string, opts: { hint: string; terms: string[]; speakers: boolean; url: string }) => Promise<{ said: Said[]; duration: number }>;
export type Think = (system: string, prompt: string) => Promise<Record<string, unknown>>;
export type Deps = { tool: Tool; hear: Hear; think: Think; now?: () => number };

const BY = "Claude (meetings)";
const LOCK_MS = 6 * 60e3;
const TRIES = 3;
const DOC_MAX = 230_000; // board docs are capped at 256 KB
const AREAS = ["Content", "Social", "Ads", "Live", "Admin"];
const SCHOOLS = ["Flip & Dance", "Cheer", "Both"];
const DEFAULT_TITLE = "Meeting recording";
const HINT = "A business meeting between Michael and Nate, who run two online acrobatics schools on Skool: Flippin' Dance Acrobatics and Better Tumbling for Cheerleaders.";
const TERMS = ["Acro HQ", "Flip & Dance", "Flippin' Dance Acrobatics", "Better Tumbling for Cheerleaders", "Skool", "SkoolKit", "Instagram", "TikTok", "Meta Ads", "acro", "cheer", "tumbling"];

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const stamp = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export const SYSTEM = `You write up a recorded business meeting for Acro HQ, the shared board of Michael and Nate, who run two paid online acrobatics schools on Skool: Flippin' Dance Acrobatics ("Flip & Dance", acro for dancers) and Better Tumbling for Cheerleaders ("Cheer"). The notes go on the board's Meetings tab, and the tasks you suggest are added to the task board only if Michael or Nate tick them.

The write-out is split by speaker (S0, S1, …) by a machine that sometimes splits one person in two or runs two together; [m:ss] is when each part starts.

- speakers: a name for each speaker id, from how they address each other or what they say. Usually Michael and Nate; use the team list. If you can't tell, "Speaker 1", "Speaker 2" by id order. Two ids that are clearly the same person get the same name.
- title: a short name for the meeting in plain words, like "Summer camp and ad budget". No date.
- summary: 3 to 8 short points in plain words: what was talked about, what was worked out, and what's still open. Keep their own terms and names. No Markdown.
- decisions: each thing they agreed on or settled, one short sentence each. Only real decisions, not ideas floated.
- tasks: each thing someone said they'd do, or that clearly needs doing, as a short title starting with a verb. assignee: who will do it (one of the team), or "" if nobody took it. area: Content (videos and posts to make), Social (social accounts), Ads (paid ads), Live (live classes and events) or Admin (everything else). school: "Flip & Dance", "Cheer", or "Both" if it's for both or unclear. due: a date (YYYY-MM-DD) only if one was said, worked out from the meeting date, else "". notes: what's needed to do it, from the meeting: context, and where they apply the direct links and short numbered steps (the board's standing rule for every task). Never invent links or steps that weren't said or aren't obvious.
- Don't suggest a task that's already open on the board (the list is given); mention it in notes of a related task if the meeting changed it.
- Use only what was said. Never invent tasks, decisions, names or details.
- Michael's own rules for meeting notes come last, if there are any. Follow them; where they conflict with the above, they win.`;

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "speakers", "summary", "decisions", "tasks"],
  properties: {
    title: { type: "string" },
    speakers: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: { type: "integer" }, name: { type: "string" } } } },
    summary: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    tasks: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["title", "assignee", "area", "school", "due", "notes"],
        properties: { title: { type: "string" }, assignee: { type: "string" }, area: { type: "string", enum: AREAS }, school: { type: "string", enum: SCHOOLS }, due: { type: "string" }, notes: { type: "string" } },
      },
    },
  },
};

type Doc = { id: string; version: number; data: Record<string, any> };

async function get(tool: Tool, collection: string, id: string): Promise<Doc | null> {
  try { return (await tool("board_get", { collection, id })) as Doc; }
  catch (e) { if ((e as { tool?: boolean }).tool && /^No /.test((e as Error).message)) return null; throw e; }
}

async function update(tool: Tool, id: string, version: number, data: Record<string, unknown>) {
  await tool("board_write", { by: BY, writes: [{ collection: "meetings", id, data, mode: "update", if_version: version }] });
  return version + 1;
}

export function prompt(m: Record<string, any>, ctx: { team: string[]; brief: unknown; rules: string; open: { title: string; assignee: string }[] }) {
  const said: Said[] = Array.isArray(m.said) ? m.said : [];
  const parts = [
    `Team: ${ctx.team.join(", ")}`,
    m.date ? `Meeting date: ${m.date}` : "",
    m.recording?.by ? `Recorded by: ${m.recording.by}` : "",
    m.title && m.title !== DEFAULT_TITLE ? `Its name so far: ${m.title}` : "",
    ctx.brief ? `The business right now (from the board's brief):\n${JSON.stringify(ctx.brief).slice(0, 12000)}` : "",
    ctx.open.length ? `Tasks already open on the board:\n${ctx.open.map((t) => `- ${t.title}${t.assignee ? ` (${t.assignee})` : ""}`).join("\n")}` : "",
    `The meeting, written out:\n\n${said.map((x) => `S${Number(x.s) || 0} [${stamp(Number(x.t) || 0)}]: ${x.text}`).join("\n").slice(0, 400_000)}`,
    ctx.rules ? `Michael's rules for meeting notes:\n${ctx.rules.slice(0, 8000)}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function tidy(out: Record<string, any>, team: string[]) {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const person = (v: unknown) => team.find((p) => p.toLowerCase() === str(v, 40).split(/\s+/)[0]?.toLowerCase()) ?? "";
  return {
    title: str(out.title, 120),
    speakers: arr(out.speakers).map((s: any) => ({ id: Number(s?.id) || 0, name: str(s?.name, 60) })).filter((s) => s.name),
    summary: arr(out.summary).map((s) => str(s, 1000)).filter(Boolean).slice(0, 12),
    decisions: arr(out.decisions).map((s) => str(s, 400)).filter(Boolean).slice(0, 30),
    suggestions: arr(out.tasks).map((t: any) => ({
      title: str(t?.title, 200), assignee: person(t?.assignee),
      area: AREAS.includes(t?.area) ? t.area : "Admin", school: SCHOOLS.includes(t?.school) ? t.school : "Both",
      due: /^\d{4}-\d{2}-\d{2}$/.test(str(t?.due, 10)) ? str(t?.due, 10) : "", notes: str(t?.notes, 2000),
    })).filter((t) => t.title).slice(0, 30),
  };
}

const lines = (said: Said[], names: Map<number, string>) =>
  said.map((x) => `${names.get(Number(x.s) || 0) ?? `Speaker ${(Number(x.s) || 0) + 1}`} [${stamp(Number(x.t) || 0)}]: ${x.text}`).join("\n");

// What failed, in words for the board, and whether to wait longer (not counted as a try).
function why(e: Error & { code?: string; status?: number }) {
  if (e.code === "no-transcriber" || e.code === "no-meeting-transcriber") return { text: "Waiting for the speech service (ElevenLabs) to be set up.", wait: 30 * 60e3 };
  if (e.code === "no-claude") return { text: "Waiting for Claude to be set up on Michael's server.", wait: 30 * 60e3 };
  return { text: e.message || "Something went wrong.", wait: 0 };
}

/** One meeting one stage further. "more" when there may be more to do, "idle" when nothing's waiting. */
export async function step(d: Deps): Promise<"more" | "idle"> {
  const now = (d.now ?? Date.now)();
  let pick: { id: string; stage: "new" | "written" } | null = null;
  for (const [status, stage] of [["new", "new"], ["writing", "new"], ["written", "written"], ["thinking", "written"]] as const) {
    const list = await d.tool("board_list", { collection: "meetings", where: [{ field: "status", op: "eq", value: status }], limit: 5 });
    const doc = (list.docs ?? []).find((x: Doc) => !(Number(x.data?.lockedUntil) > now));
    if (doc) { pick = { id: doc.id, stage }; break; }
  }
  if (!pick) return "idle";

  const doc = await get(d.tool, "meetings", pick.id);
  if (!doc || Number(doc.data.lockedUntil) > now) return "more";
  let v: number;
  try { v = await update(d.tool, doc.id, doc.version, { status: pick.stage === "new" ? "writing" : "thinking", lockedUntil: now + LOCK_MS }); }
  catch { return "more"; } // someone else took it
  const m = doc.data;

  try {
    if (pick.stage === "new") {
      const { url } = await d.tool("meeting_audio_link", { id: doc.id });
      const team = await teamOf(d.tool);
      const { said, duration } = await d.hear(null, "meeting", { hint: HINT, terms: [...new Set([...team, ...TERMS])], speakers: true, url });
      if (!said.length) {
        await update(d.tool, doc.id, v, { status: "failed", error: "Nothing was said in that recording.", lockedUntil: 0 });
        return "more";
      }
      await update(d.tool, doc.id, v, {
        status: "written", said, duration: Math.round(duration || 0), transcript: lines(said, new Map()).slice(0, 200_000),
        lockedUntil: 0, attempts: 0, error: null, note: null, writtenAt: now,
      });
      return "more";
    }

    const said: Said[] = Array.isArray(m.said) ? m.said : [];
    if (!said.length) {
      await update(d.tool, doc.id, v, { status: "new", lockedUntil: 0 });
      return "more";
    }
    const team = await teamOf(d.tool);
    const [brief, rules, open] = await Promise.all([
      get(d.tool, "settings", "brief").then((x) => x?.data ?? null),
      get(d.tool, "settings", "meetings").then((x) => str(x?.data?.rules, 8000)),
      d.tool("board_list", { collection: "tasks", where: [{ field: "status", op: "ne", value: "done" }], limit: 60 })
        .then((r) => (r.docs ?? []).map((x: Doc) => ({ title: str(x.data?.title, 200), assignee: str(x.data?.assignee, 40) })).filter((t: { title: string }) => t.title))
        .catch(() => []),
    ]);
    const notes = tidy(await d.think(SYSTEM, prompt(m, { team, brief, rules, open })), team);
    const names = new Map(notes.speakers.map((s) => [s.id, s.name]));
    const data: Record<string, unknown> = {
      status: "ready", speakers: notes.speakers, summary: notes.summary.map((x) => `- ${x}`).join("\n"), decisions: notes.decisions,
      suggestions: notes.suggestions, suggestionsDone: false, transcript: lines(said, names), lockedUntil: 0, attempts: 0, error: null, note: null, notesAt: now,
    };
    if (notes.title && (!m.title || m.title === DEFAULT_TITLE)) data.title = notes.title;
    // Room on the doc: the write-out with timestamps (kept for "Write the notes again") goes first.
    if (JSON.stringify({ ...m, ...data }).length > DOC_MAX) data.said = { __delete__: true };
    if (JSON.stringify({ ...m, ...data, said: undefined }).length > DOC_MAX) data.transcript = String(data.transcript).slice(0, 150_000) + "\n… (cut: the recording is longer than the board can hold)";
    await update(d.tool, doc.id, v, data);
    return "more";
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error(e);
    const w = why(e);
    const tries = (Number(m.attempts) || 0) + (w.wait ? 0 : 1);
    const back = pick.stage;
    await update(d.tool, doc.id, v, tries >= TRIES
      ? { status: "failed", error: w.text, attempts: tries, lockedUntil: 0 }
      : { status: back, note: w.wait ? w.text : "Trying again in a few minutes.", attempts: tries, lockedUntil: now + (w.wait || 3 * 60e3 * tries) },
    ).catch((e2) => console.error("couldn't save the failure", e2));
    return "more";
  }
}

async function teamOf(tool: Tool): Promise<string[]> {
  const t = await get(tool, "settings", "team").catch(() => null);
  const people = Array.isArray(t?.data?.people) ? t!.data.people.map(String).filter(Boolean) : [];
  return people.length ? people : ["Michael", "Nate"];
}
