# 🏅 Strava Auto Kudos

> Automatically give kudos to everyone in your feed — triggered the moment **you** post a workout.

No third-party services. No subscriptions. Runs on your own server.

---

## How it works

1. You finish a workout and upload it to Strava
2. Strava sends a signal to your server
3. The bot gives kudos to everyone in your feed who posted in the last 24 hours (and hasn't received yours yet)

That's it. Fully automatic. You train → your friends get kudos.

---

## Requirements

- A server with a public URL (VPS, home server with port forwarding, etc.)
- Node.js 18+
- A free Strava account

---

## Setup guide

### Step 1 — Get the code

```bash
git clone https://github.com/Dimagious/strava-auto-kudos.git
cd strava-auto-kudos
npm install
```

---

### Step 2 — Create a Strava API app

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Fill in the form:
   - **Application Name:** anything you want, e.g. `My Kudos Bot`
   - **Category:** `Other`
   - **Website:** your server URL or any URL (e.g. `http://localhost`)
   - **Authorization Callback Domain:** your server domain (e.g. `myserver.com`) or `localhost` for testing
3. Click **Save** and copy your **Client ID** and **Client Secret**

![Strava API page](docs/strava-api-page.png)

---

### Step 3 — Get your Refresh Token

This is a one-time step. Open this URL in your browser — replace `YOUR_CLIENT_ID` with the number from Step 2:

```
https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read,read_all
```

1. Click **Authorize**
2. You'll be redirected to `http://localhost/?...&code=XXXXXXXX` — the page won't load, that's fine
3. Copy the `code` value from the URL

Now run this in your terminal (replace the values):

```bash
curl -X POST https://www.strava.com/oauth/token \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d code=CODE_FROM_URL \
  -d grant_type=authorization_code
```

From the response, copy the `refresh_token` value.

---

### Step 4 — Find your Athlete ID

Go to your Strava profile in a browser. The URL looks like:

```
https://www.strava.com/athletes/123456789
```

Your Athlete ID is that number — `123456789`.

---

### Step 5 — Configure the bot

Copy the example config file and fill it in:

```bash
cp .env.example .env
```

Open `.env` in any text editor and fill in your values:

```env
STRAVA_CLIENT_ID=123456        # from Step 2
STRAVA_CLIENT_SECRET=abc...    # from Step 2
STRAVA_REFRESH_TOKEN=def...    # from Step 3
STRAVA_ATHLETE_ID=123456789    # from Step 4
STRAVA_VERIFY_TOKEN=make_up_any_random_string_here
PORT=3000
```

> **What is `STRAVA_VERIFY_TOKEN`?**
> It's a password you make up yourself — used once during setup so Strava can verify your server. Write anything you like, e.g. `kudos_bot_secret_42`.

---

### Step 6 — Start the server

```bash
node index.js
```

You should see:
```
[server] Running on port 3000
```

---

### Step 7 — Register the webhook with Strava

This tells Strava where to send notifications. Run once (replace values):

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET \
  -F callback_url=https://YOUR_SERVER_DOMAIN/webhook \
  -F verify_token=YOUR_VERIFY_TOKEN
```

If it worked, you'll get a response like `{"id": 12345}`. Done!

> ⚠️ Your server must be accessible from the internet for Strava to reach it.
> If you're testing locally, use [ngrok](https://ngrok.com): `ngrok http 3000` and use the given URL as `callback_url`.

---

### Step 8 — Test it

Upload any activity to Strava. Watch the server logs:

```
[webhook] Your activity 9876543210 detected — starting kudos run
[kudos] Found 8 activities in feed (last 24h)
[kudos] ✓ Anna Smith — "Evening Run"
[kudos] ✓ Mike Johnson — "Morning Ride"
[kudos] Done. Given: 8, Skipped: 0
```

---

## Keep it running 24/7 (recommended)

Use [PM2](https://pm2.keymetrics.io/) to keep the bot alive after reboots:

```bash
npm install -g pm2
pm2 start index.js --name strava-kudos
pm2 save
pm2 startup   # follow the printed instructions
```

To view logs anytime:
```bash
pm2 logs strava-kudos
```

---

## FAQ

**Will it give kudos to my own activities?**
No. The bot always skips your own workouts.

**What if someone already has my kudos?**
Skipped automatically. No duplicates.

**Is it against Strava's Terms of Service?**
The bot uses the official Strava API. Automated kudos exist in a grey area of their ToS — use at your own discretion.

**Can I run it on multiple accounts?**
Not out of the box. You'd need separate instances with separate `.env` files.

---

## Project structure

```
strava-auto-kudos/
├── index.js          # Main server
├── .env.example      # Config template
├── package.json
└── README.md
```

---

## License

MIT — free to use, modify, and share.
