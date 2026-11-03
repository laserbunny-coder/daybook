// Phone alerts (Web Push).
// From the app (signed in): "key" hands out the public key a browser subscribes with, "test" buzzes
// the person's own devices (or just one), so they can check it gets through Do Not Disturb.
// From the database (a new note, shown by the secret in push_config): checks the person's switches
// in alert_prefs and sends the note to each device they turned alerts on for.
import { admin, cors, json, userFrom } from "../_shared/common.ts";
import { send, type Sub, vapidPublic } from "../_shared/webpush.ts";
import { SUBJECT, vapid } from "../_shared/vapid.ts";

type Note = { id: string; user_id: string; author: string | null; title: string | null; body: string | null; link: string | null; kind: string | null; project: string | null; resolved_at: string | null };
type Prefs = { review: boolean; needs: boolean; notes: boolean };
const DEFAULTS: Prefs = { review: true, needs: true, notes: false };
const KIND = { decision: "a decision", blocked: "blocked on you", review: "ready to review" } as Record<string, string>;
const APP = "https://laserbunny-coder.github.io/daybook/";

/** Which switch a note falls under. */
export function kindOf(n: Pick<Note, "kind" | "author" | "title">): keyof Prefs {
  if (n.kind) return "needs";
  if ((n.author ?? "") === "Inkwell" && (n.title ?? "") === "Your day review") return "review";
  return "notes";
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** What the notification says, and where tapping it goes. */
export function message(n: Note) {
  const k = kindOf(n);
  if (k === "needs") {
    return {
      title: clip(n.title || "Something needs you", 80),
      body: `${n.project ? n.project + " · " : ""}${KIND[n.kind!] ?? "needs you"}`,
      tag: "needs-" + n.id, url: n.link || APP + "?needs", ttl: 24 * 3600,
    };
  }
  if (k === "review") {
    return { title: "Your day review", body: "Take a few minutes to look back over today in Inkwell.", tag: "review", url: n.link || APP, ttl: 3 * 3600 };
  }
  return { title: clip(n.title || `A note from ${n.author || "Claude"}`, 80), body: clip(n.body || "", 160), tag: "note-" + n.id, url: APP + "?notes", ttl: 12 * 3600 };
}

async function deliver(subs: Sub[], payload: Record<string, unknown>, ttl: number) {
  const db = admin(), jwk = await vapid();
  let sent = 0;
  for (const s of subs) {
    const st = await send(s, payload, jwk, SUBJECT, ttl).catch((e) => { console.error(e); return 0; });
    if (st === 404 || st === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint);
    else if (st >= 200 && st < 300) sent++;
    else console.warn("push status", st);
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const args = await req.json().catch(() => ({})) as { action?: string; note?: string; endpoint?: string };

  // A new note, from the database trigger
  const secret = req.headers.get("x-cron-secret");
  if (secret) {
    const { data: cfg } = await db.from("push_config").select("cron_secret").eq("id", 1).single();
    if (!cfg || secret !== cfg.cron_secret) return json({ error: "Not allowed" }, 401);
    const { data: n } = await db.from("notes").select("id,user_id,author,title,body,link,kind,project,resolved_at").eq("id", args.note ?? "").maybeSingle();
    if (!n || n.resolved_at) return json({ sent: 0, skipped: "no open note" });
    const { data: p } = await db.from("alert_prefs").select("review,needs,notes").eq("user_id", n.user_id).maybeSingle();
    const prefs = { ...DEFAULTS, ...(p ?? {}) } as Prefs, k = kindOf(n);
    if (!prefs[k]) return json({ sent: 0, skipped: `${k} alerts are off` });
    const { data: subs } = await db.from("push_subs").select("endpoint,p256dh,auth").eq("user_id", n.user_id);
    const { ttl, ...m } = message(n);
    return json({ sent: await deliver(subs ?? [], m, ttl), kind: k });
  }

  // From the app
  const user = await userFrom(req);
  if (!user) return json({ error: "Not signed in" }, 401);
  if (args.action === "key") return json({ key: vapidPublic(await vapid()) });
  if (args.action === "test") {
    let q = db.from("push_subs").select("endpoint,p256dh,auth").eq("user_id", user.id);
    if (args.endpoint) q = q.eq("endpoint", args.endpoint);
    const { data: subs } = await q;
    const sent = await deliver(subs ?? [], { title: "Daybook alerts are on", body: "This is how a Needs you or your 9 pm day review will look.", tag: "test", url: APP }, 600);
    return json({ sent, devices: subs?.length ?? 0 });
  }
  return json({ error: "Unknown action" }, 400);
});
