// Scribe's starting modes: how a dictation is rewritten before it's typed in.
// Each one is plain words for Claude. `apps` are Android app ids and Windows
// program names where the mode picks itself; the first mode is the default
// everywhere else. These are copied to a person's own modes (scribe_modes)
// the first time Scribe asks for them; after that they change them there, by
// voice from the keyboard or by asking Claude. `model` is which Claude
// rewrites it: haiku for quick light jobs, sonnet for emails, opus where the
// writing matters.
export type Model = "haiku" | "sonnet" | "opus";
export const MODELS: Model[] = ["haiku", "sonnet", "opus"];
export type Mode = { id: string; name: string; apps: string[]; prompt: string; model: Model };

export const STARTER_MODES: Mode[] = [
  {
    id: "text",
    name: "Text message",
    model: "haiku",
    apps: [
      "com.google.android.apps.messaging",
      "com.samsung.android.messaging",
      "com.whatsapp",
      "org.thoughtcrime.securesms",
      "com.facebook.orca",
      "com.instagram.android",
      "com.discord",
      "com.Slack",
    ],
    prompt: "A text message. Short and casual, the way they'd type it to a friend. Keep their wording and their voice; just make it read cleanly. No greeting or sign-off unless they said one. Contractions are fine. No emoji unless they asked for one.",
  },
  {
    id: "email",
    name: "Email",
    model: "sonnet",
    apps: [
      "com.google.android.gm",
      "com.microsoft.office.outlook",
      "com.samsung.android.email.provider",
      "outlook.exe",
      "thunderbird.exe",
    ],
    prompt: "An email. Clear and warm, in short paragraphs. Start with a greeting using the person's name if they said who it's to, and end with a short sign-off and 'Michael'. Keep what they said and in the order that makes sense; don't add facts, promises or pleasantries they didn't say.",
  },
  {
    id: "clean",
    name: "Clean only",
    model: "haiku",
    apps: [],
    prompt: "Clean up only: remove ums, false starts, repeats and filler, fix punctuation and capitals, and apply any corrections they made out loud ('no, I mean Thursday'). Change nothing else.",
  },
  {
    id: "idea",
    name: "Idea",
    model: "opus",
    apps: [],
    prompt: "A note to self about an idea, often a long ramble. Keep every idea, image, line and question they said, in their words, but put it in a sensible order, merge repeats, and break it into short paragraphs. Don't judge or add to the idea.",
  },
];
