# Training App

A small, free, self-hosted app that shows your daily training from your
"Training Sessions: 2026 Olympic Mid Season" sheet, with a check-off and a
notes log. No backend, no monthly cost.

It works two ways:

- **Snapshot mode (default, zero setup):** opens instantly showing your real
  workouts (currently January–June 2026, pulled straight from your sheet).
  Check-offs and notes are saved in the browser you're using.
- **Live sync (optional, ~10-min one-time setup):** click "Sync live" to
  sign in with Google. Then it reads new weeks as your coaches add them and
  writes your check-offs/notes back into the sheet itself.

## Opening it

It's a plain HTML/CSS/JS site — no build step. To run it on your computer:

```
cd ~/Desktop/workout-app
python3 -m http.server 4712
```

Then open **http://localhost:4712/** in your browser. That's it — your
workouts load immediately.

To use it from your phone anywhere, host it free on GitHub Pages (see below).

## Refreshing the snapshot (until live sync is set up)

The snapshot in `data.js` is a point-in-time copy of your sheet. When your
coaches add new weeks, just ask Claude to regenerate `data.js` from the
sheet and it'll update — or set up live sync so it never needs refreshing.

## Optional: Live sync setup (~10 minutes, one time)

This lets the app read new workouts and save your logs back into the sheet
automatically. It signs in with "Sign in with Google" — no password or key
is stored in the code.

1. Go to [console.cloud.google.com](https://console.cloud.google.com),
   create a new project (any name).
2. Search **"Google Sheets API"** → **Enable**.
3. **APIs & Services → OAuth consent screen**: User type **External**; fill
   the required name/email fields; under **Test users**, add your own Google
   account (the one that owns the training sheet). Staying in "Testing" mode
   is free forever and needs no Google review.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Type: **Web application**.
   - **Authorized JavaScript origins**: add `http://localhost:4712` and,
     once you have it, your GitHub Pages URL.
   - Create, then copy the **Client ID** (ends `.apps.googleusercontent.com`).
5. Open `app.js`, find `CONFIG` at the top, paste your Client ID in place of
   `YOUR_CLIENT_ID.apps.googleusercontent.com`.

Now the "Sync live" button works. First time you save while live, the app
creates a "Logs" tab in the sheet automatically — it never edits your
existing monthly tabs.

## Optional: Host it free on your phone (GitHub Pages)

1. Free account at [github.com](https://github.com).
2. New repository; push this `workout-app` folder's contents into it.
3. Repo **Settings → Pages** → source = main branch (root) → save. You get a
   URL like `https://yourname.github.io/repo-name/`.
4. If you set up live sync, add that URL to the OAuth Client's authorized
   origins (step 4 above).

## Files

- `index.html` / `styles.css` / `app.js` — the app.
- `data.js` — the snapshot of your workouts (`window.SNAPSHOT`).
