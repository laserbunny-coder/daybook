// Scribe's styles: how a dictation is rewritten before it's typed in. Each
// one is plain words for Claude. `apps` are Android app ids (and later Windows
// program names) where the style is picked on its own; the first style is the
// default everywhere else. To change a style, edit it here and publish.
export type Style = { id: string; name: string; apps: string[]; prompt: string };

export const STYLES: Style[] = [
  {
    id: "text",
    name: "Text message",
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
    apps: [],
    prompt: "Clean up only: remove ums, false starts, repeats and filler, fix punctuation and capitals, and apply any corrections they made out loud ('no, I mean Thursday'). Change nothing else.",
  },
  {
    id: "raw",
    name: "Word for word",
    apps: [],
    prompt: "",
  },
];
