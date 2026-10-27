// Reminders, from the app's side: hands out the public key a browser subscribes with,
// and sends a test notification to the person's own browsers.
import { admin, cors, json, userFrom } from "../_shared/common.ts";
import { send, vapidPublic } from "../_shared/webpush.ts";
import { SUBJECT, vapid } from "../_shared/vapid.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const user = await userFrom(req);
  if (!user) return json({ error: "Not signed in" }, 401);
  const { action, title, body } = await req.json().catch(() => ({})) as { action?: string; title?: string; body?: string };
  const jwk = await vapid();
  if (action === "key") return json({ key: vapidPublic(jwk) });
  if (action === "test") {
    const db = admin();
    const { data: subs } = await db.from("push_subs").select("endpoint,p256dh,auth").eq("user_id", user.id);
    let sent = 0;
    for (const s of subs ?? []) {
      const st = await send(s, { title: title || "Daybook", body: body || "Reminders are on.", tag: "test", url: "./?quest" }, jwk, SUBJECT).catch(() => 0);
      if (st === 404 || st === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint);
      else if (st >= 200 && st < 300) sent++;
    }
    return json({ sent });
  }
  return json({ error: "Unknown action" }, 400);
});
