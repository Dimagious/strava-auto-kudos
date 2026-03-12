require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

// ─── Config ───────────────────────────────────────────────────────────────────

const {
  STRAVA_CLIENT_ID,
  STRAVA_CLIENT_SECRET,
  STRAVA_REFRESH_TOKEN,
  STRAVA_ATHLETE_ID,
  STRAVA_VERIFY_TOKEN,
  PORT = 3000,
} = process.env;

const REQUIRED_VARS = [
  'STRAVA_CLIENT_ID',
  'STRAVA_CLIENT_SECRET',
  'STRAVA_REFRESH_TOKEN',
  'STRAVA_ATHLETE_ID',
  'STRAVA_VERIFY_TOKEN',
];

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env variable: ${key}`);
    console.error('   Copy .env.example to .env and fill in your values.');
    process.exit(1);
  }
}

// ─── Token management ─────────────────────────────────────────────────────────

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  // Return cached token if still valid (with 1 min buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();

  if (!data.access_token) {
    throw new Error(`Failed to refresh token: ${JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  tokenExpiresAt = data.expires_at * 1000;
  console.log('[token] Refreshed, valid until', new Date(tokenExpiresAt).toISOString());

  return cachedToken;
}

// ─── Strava API ───────────────────────────────────────────────────────────────

async function getFeedActivities(token) {
  const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000); // unix 24h ago
  const url = `https://www.strava.com/api/v3/activities/following?after=${since}&per_page=200`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Could not fetch feed: HTTP ${res.status}`);
  }

  return res.json();
}

async function giveKudos(token, activityId) {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}/kudos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  return res.status; // 201 = success, 400 = already kudosed or own activity
}

// ─── Core logic ───────────────────────────────────────────────────────────────

async function giveKudosToFeed() {
  console.log('[kudos] Starting kudos run...');

  const token = await getAccessToken();
  const activities = await getFeedActivities(token);

  console.log(`[kudos] ${activities.length} activities in feed (last 24h)`);

  let given = 0;
  let skipped = 0;

  for (const activity of activities) {
    const name = `${activity.athlete.firstname} ${activity.athlete.lastname}`;

    // Skip own activities
    if (String(activity.athlete.id) === String(STRAVA_ATHLETE_ID)) {
      skipped++;
      continue;
    }

    // Skip already kudosed
    if (activity.kudosed) {
      skipped++;
      continue;
    }

    const status = await giveKudos(token, activity.id);

    if (status === 201) {
      given++;
      console.log(`[kudos] ✓ ${name} — "${activity.name}"`);
    } else {
      console.log(`[kudos] ✗ ${name} — "${activity.name}" (status ${status})`);
    }

    // Small delay to respect Strava API rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[kudos] Done — given: ${given}, skipped: ${skipped}`);
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

// Strava calls this once during webhook registration to verify your server
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === STRAVA_VERIFY_TOKEN) {
    console.log('[webhook] ✓ Verified by Strava');
    return res.json({ 'hub.challenge': challenge });
  }

  console.warn('[webhook] ✗ Verification failed — check STRAVA_VERIFY_TOKEN');
  res.sendStatus(403);
});

// Strava sends activity events here
app.post('/webhook', async (req, res) => {
  // Always respond immediately — Strava expects a fast response
  res.sendStatus(200);

  const event = req.body;
  console.log('[webhook] Event received:', event.object_type, event.aspect_type, `owner:${event.owner_id}`);

  // Only trigger when YOU create a new activity
  const isMyNewActivity =
    event.object_type === 'activity' &&
    event.aspect_type === 'create' &&
    String(event.owner_id) === String(STRAVA_ATHLETE_ID);

  if (isMyNewActivity) {
    console.log(`[webhook] Your activity ${event.object_id} detected — giving kudos to feed`);
    giveKudosToFeed().catch(err => console.error('[kudos] Error:', err.message));
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] ✓ Running on port ${PORT}`);
  console.log(`[server]   Webhook endpoint: POST /webhook`);
});
