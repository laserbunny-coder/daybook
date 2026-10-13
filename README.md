# Daybook

A personal planner for projects, tasks and Google Calendar, on a phone and a computer.

- Projects break down into sub-projects and tasks. Checking off a task moves its project forward.
- Plan a day or a week as a simple list, or as time blocks next to your calendar events.
- Drag and drop everywhere, including press-and-hold on phones.
- Open any task or project to keep notes and steps.
- Ask Claude to plan your week, break down a task, or point out what's at risk.
- Give any task a link back to where its notes live, like a Thymer page, and open it in one tap.
- Connect Daybook to Claude so any Claude chat can read and change your tasks.

To set it up, follow [SETUP.md](SETUP.md).

## How it's built

- A plain HTML, CSS and JavaScript web app with no build step (`index.html`, `app.css`, `js/`). It installs to the home screen and works offline (`sw.js`, `manifest.webmanifest`).
- [Supabase](https://supabase.com) for Google sign-in, the database (`supabase/migrations`) and live sync between devices.
- Three Supabase Edge Functions:
  - `calendar` reads Google Calendar events. It is read-only.
  - `ask` sends the question and a summary of the planner to Claude. Claude proposes changes, and the app applies them with an Undo button.
  - `mcp` is a Claude connector (an MCP server). Its address carries a secret made in the app, stored only as a hash in `mcp_tokens`. It can list, add and change tasks.
- GitHub Actions (`.github/workflows/deploy.yml`) updates the database and functions, then publishes the site to GitHub Pages on every push to `main`.

Opening `index.html` without Supabase settings runs the app with sample data stored only in that browser.

To run it locally, run `python3 -m http.server` in this folder and open http://localhost:8000.
