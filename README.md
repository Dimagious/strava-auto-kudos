# 👍 Strava Auto Kudos

> Automatically give kudos to everyone in your feed — triggered the moment **you** post a workout.

No third-party services. No subscriptions. Runs on your own server.

---

## How it works

1. You finish a workout and upload it to Strava
2. Strava sends a webhook to your server
3. The bot gives kudos to everyone in your feed who posted in the last 24 hours

Fully automatic. You train → your friends get kudos.

---

## How it authenticates

The bot uses your browser session cookie (`_strava4_session`) to act as you on the Strava website. You copy it once during setup. After that, **the bot automatically captures and saves session renewals** from Strava's responses — so the session stays alive indefinitely as long as the bot is running.

---

## Requirements

- A server with a public HTTPS URL
- Node.js 18+
- A Strava account
- A Strava API app (free, needed for the webhook only)

---

## Setup guide

### Step 1 — Get the code

```bash
git clone https://github.com/Dimagious/strava-auto-kudos.git
cd strava-auto-kudos
npm install
```

---

### Step 2 — Get your session cookie

1. Open [strava.com](https://www.strava.com) in Chrome and log in
2. Open DevTools → **Application** → **Cookies** → `https://www.strava.com`
3. Find `_strava4_session` and copy its value

---

### Step 3 — Find your Athlete ID

Go to your Strava profile. The URL looks like:

```
https://www.strava.com/athletes/123456789
```

Your Athlete ID is that number — `123456789`.

---

### Step 4 — Configure the bot

```bash
cp .env.example .env
```

Fill in `.env`:

```env
STRAVA_ATHLETE_ID=123456789        # from Step 3
STRAVA_VERIFY_TOKEN=any_secret     # make up any random string
STRAVA_SESSION_COOKIE=abc123...    # from Step 2
PORT=3002
```

---

### Step 5 — Start the server

```bash
node index.js
```

You should see:
```
[session] Loaded (32 chars)
[server] ✓ Running on port 3002
```

---

### Step 6 — Create a Strava API app (for the webhook)

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Fill in the form — Application Name, Category, Website can be anything
3. Copy your **Client ID** and **Client Secret**

---

### Step 7 — Register the webhook with Strava

Run once (replace the values):

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET \
  -F callback_url=https://YOUR_SERVER_DOMAIN/webhook \
  -F verify_token=YOUR_VERIFY_TOKEN
```

You'll get back `{"id": 12345}`. Done — Strava will now notify your server on every activity.

> Your server must be reachable from the internet (HTTPS). For local testing use [ngrok](https://ngrok.com): `ngrok http 3002`.

---

### Step 8 — Test it

```bash
curl -X POST http://localhost:3002/webhook \
  -H "Content-Type: application/json" \
  -d '{"object_type":"activity","aspect_type":"create","owner_id":YOUR_ATHLETE_ID,"object_id":1}'
```

Watch the logs:
```
[webhook] Your activity 1 detected — giving kudos to feed
[csrf] Token refreshed
[kudos] 12 activities in feed (last 24h)
[kudos] ✓ Anna Smith — "Evening Run"
[kudos] ✓ Mike Johnson — "Morning Ride"
[kudos] Done — given: 11, skipped: 1
```

---

## Keep it running 24/7

Use [PM2](https://pm2.keymetrics.io/):

```bash
npm install pm2          # or: npm install -g pm2
./node_modules/.bin/pm2 start index.js --name strava-kudos
./node_modules/.bin/pm2 save
./node_modules/.bin/pm2 startup  # follow the printed instructions
```

Logs:
```bash
./node_modules/.bin/pm2 logs strava-kudos
```

---

## Session management

The session cookie is saved to `session.txt` (gitignored) and auto-updated on every request — Strava rotates the cookie value, and the bot captures the new value automatically.

**If the bot stops working** (session was explicitly invalidated — e.g. you changed your Strava password or logged out everywhere):

1. Copy a fresh `_strava4_session` from your browser DevTools
2. Paste it into `session.txt` on the server (or re-set `STRAVA_SESSION_COOKIE` in `.env`)
3. Restart the bot: `pm2 restart strava-kudos --update-env`

---

## FAQ

**Will it give kudos to my own activities?**
No. The bot always skips your own workouts.

**What if someone already has my kudos?**
Skipped automatically. No duplicates.

**Is it against Strava's Terms of Service?**
Automated kudos are a grey area in Strava's ToS — use at your own discretion.

**Can I run it on multiple accounts?**
Yes — clone the repo into a separate folder with its own `.env` and `session.txt`.

---

## Project structure

```
strava-auto-kudos/
├── index.js          # Main server
├── session.txt       # Auto-managed session cookie (gitignored)
├── .env.example      # Config template
├── package.json
└── README.md
```

---

## License

MIT — free to use, modify, and share.
