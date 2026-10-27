// Sends the reminders that are due. Woken every minute by the database's job
// (only when something is due), which proves itself with the secret in push_config.
import { admin, json } from "../_shared/common.ts";
import { send } from "../_shared/webpush.ts";
import { SUBJECT, vapid } from "../_shared/vapid.ts";

Deno.serve(async (req) => {
  const db = admin();
  const { data: cfg } = await db.from("push_config").select("cron_secret").eq("id", 1).single();
  if (!cfg || req.headers.get("x-cron-secret") !== cfg.cron_secret) return json({ error: "Not allowed" }, 401);
  const now = new Date();
  const { data: due } = await db.from("push_plan").select("user_id,key,title,body,tag")
    .is("sent_at", null).lte("at", now.toISOString()).gt("at", new Date(now.getTime() - 30 * 60e3).toISOString()).limit(200);
  if (!due?.length) return json({ sent: 0 });
  // Mark them first, so a slow send can't be picked up twice by the next minute's job
  for (const d of due) await db.from("push_plan").update({ sent_at: now.toISOString() }).eq("user_id", d.user_id).eq("key", d.key).is("sent_at", null);
  const jwk = await vapid();
  const users = [...new Set(due.map((d) => d.user_id))];
  const { data: subs } = await db.from("push_subs").select("user_id,endpoint,p256dh,auth").in("user_id", users);
  let sent = 0;
  for (const d of due) {
    for (const s of (subs ?? []).filter((x) => x.user_id === d.user_id)) {
      const st = await send(s, { title: d.title, body: d.body, tag: d.tag || d.key, url: "./?quest" }, jwk, SUBJECT).catch((e) => { console.error(e); return 0; });
      if (st === 404 || st === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint);
      else if (st >= 200 && st < 300) sent++;
      else console.warn("push status", st);
    }
  }
  return json({ sent });
});
