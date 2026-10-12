# Setting up Daybook

This is a one-time setup. It takes about 30 minutes, and it's easiest on a computer. You'll create three free accounts, copy a few values from each one, and paste them into GitHub. After that, every change Claude makes publishes on its own.

You'll collect these values along the way. Keep them in a note while you work, and don't share them in chat:

| Value | Where it comes from |
|---|---|
| Project ref | Supabase (step 2) |
| Project URL | Supabase (step 2) |
| Anon key | Supabase (step 2) |
| Database password | Supabase (step 2, you make it up) |
| Access token | Supabase (step 2) |
| Client ID | Google (step 3) |
| Client secret | Google (step 3) |
| API key | Anthropic (step 5) |

## 1. GitHub: where the app lives

You've already created the `daybook` repository and connected it to Claude. The app's address will be:

`https://YOUR-GITHUB-USERNAME.github.io/daybook/`

Replace `YOUR-GITHUB-USERNAME` with your own username wherever it appears below.

In the repository, go to **Settings → Pages** and under **Build and deployment → Source**, choose **GitHub Actions**.

## 2. Supabase: where your tasks are stored and synced

1. Go to [supabase.com](https://supabase.com) and sign up with your GitHub account.
2. If Supabase asks you to create an organization first, name it anything (like `Personal`), choose **Personal** and the **Free** plan.
3. Click **New project**. Name it `daybook`, make up a strong **database password** (save it in your note), pick the region closest to you, and create it. It takes a minute or two to start.
4. Open **Project Settings → General** and copy the **Project ID**. That's the **project ref**.
5. Click the **Connect** button at the top of the project page. Copy the **Project URL** (`SUPABASE_URL`, it looks like `https://abcd1234.supabase.co`) and the **anon / publishable key** (`SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`; newer ones start with `sb_publishable_`). If there's no Connect button, look under **Project Settings → API Keys**.
6. Click your profile picture in the top right, then **Account preferences → Access Tokens**. Generate a token named `github`, set it to **never expire** (a short expiry would stop publishing when it runs out), and copy it. This is the **access token**.

## 3. Google: so you can sign in and Daybook can read your calendar

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in with the Google account that has your calendar. If it asks you to agree to terms, do; this is free. Skip any free-trial or billing offer, since nothing here needs a credit card.
2. At the top, open the project picker and click **New project**. Name it `Daybook` and create it. Make sure it's selected.
3. Search for **Google Calendar API** in the top search bar, open it, and click **Enable**.
4. Open **Google Auth Platform** (search "OAuth consent screen" if you can't find it) and click **Get started**.
   - App name: `Daybook`. Support email: your email.
   - Audience: **External**.
   - Contact email: your email. Agree and create.
5. In **Data Access**, click **Add or remove scopes**, search for `calendar.readonly`, tick **Google Calendar API … /auth/calendar.readonly**, and save.
6. In **Branding**, fill in:
   - Application home page: `https://YOUR-GITHUB-USERNAME.github.io/daybook/`
   - Application privacy policy link: `https://YOUR-GITHUB-USERNAME.github.io/daybook/privacy.html`
   - Authorized domains: add `YOUR-GITHUB-USERNAME.github.io` and `YOUR-PROJECT-REF.supabase.co`
   - Developer contact email: your email. Save.
7. In **Audience**, click **Publish app** and confirm. This stops Google from signing you out of the calendar connection every week. Google will show you a "this app isn't verified" warning when you sign in. That's expected for a personal app. Click **Advanced → Go to Daybook**.
8. In **Clients**, click **Create client**:
   - Application type: **Web application**. Name: `Daybook`.
   - Under **Authorized redirect URIs**, add `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`, using the project ref from step 2.
   - Create it, then copy the **Client ID** and **Client secret**.

## 4. Back in Supabase: turn on Google sign-in

1. Open **Authentication → Sign In / Providers → Google**. Turn it on, paste the **Client ID** and **Client secret**, and save.
2. Open **Authentication → URL Configuration**.
   - Site URL: `https://YOUR-GITHUB-USERNAME.github.io/daybook/`
   - Redirect URLs: add the same address.

## 5. Anthropic: so "Ask Claude" can answer

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign up.
2. In **Billing**, add a small amount of credit. $5 lasts a long time for one person.
3. In **API Keys**, create a key named `daybook` and copy it.

## 6. Paste everything into GitHub

In the repository, open **Settings → Secrets and variables → Actions**.

On the **Secrets** tab, click **New repository secret** for each of these. The name must match exactly.

| Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | access token |
| `SUPABASE_DB_PASSWORD` | database password |
| `GOOGLE_CLIENT_ID` | Google client ID |
| `GOOGLE_CLIENT_SECRET` | Google client secret |
| `ANTHROPIC_API_KEY` | Anthropic API key |

On the **Variables** tab, click **New repository variable** for each of these:

| Name | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | project ref |
| `SUPABASE_URL` | project URL |
| `SUPABASE_ANON_KEY` | anon key |

## 7. Publish

Open the **Actions** tab, click **Publish Daybook** on the left, then **Run workflow**. When both steps show a green check, open `https://YOUR-GITHUB-USERNAME.github.io/daybook/` and sign in with Google.

## 8. Put it on your phone

- **iPhone:** open the address in Safari, tap the Share button, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the ⋮ menu, then **Install app** or **Add to Home screen**.

It opens full screen like a regular app, and your tasks sync with your computer.

If any step looks different from what's written here, tell Claude what you see.
