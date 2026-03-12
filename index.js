require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ─── Config ───────────────────────────────────────────────────────────────────

const {
  STRAVA_ATHLETE_ID,
  STRAVA_VERIFY_TOKEN,
  PORT = 3002,
} = process.env;

const REQUIRED_VARS = ['STRAVA_ATHLETE_ID', 'STRAVA_VERIFY_TOKEN'];

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env variable: ${key}`);
    console.error('   Copy .env.example to .env and fill in your values.');
    process.exit(1);
  }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SESSION_FILE = path.join(__dirname, 'session.txt');

// ─── Session management ───────────────────────────────────────────────────────

let currentSession = null;

function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    const val = fs.readFileSync(SESSION_FILE, 'utf8').trim();
    if (val) return val;
  }
  // Fallback to .env
  return process.env.STRAVA_SESSION_COOKIE || null;
}

function saveSession(value) {
  if (value === currentSession) return;
  currentSession = value;
  fs.writeFileSync(SESSION_FILE, value, 'utf8');
  console.log('[session] Cookie updated and saved');
}

function getSession() {
  if (!currentSession) {
    currentSession = loadSession();
    if (!currentSession) {
      throw new Error('No session cookie found. Add STRAVA_SESSION_COOKIE to .env or session.txt');
    }
  }
  return currentSession;
}

// Extract session cookie value from Set-Cookie response headers
function extractSessionCookie(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) {
    const match = cookie.match(/^_strava4_session=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

// Wrapper: makes a request and auto-saves new session if Strava rotates it
async function stravaFetch(url, options = {}) {
  const session = getSession();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Cookie: `_strava4_session=${session}`,
      'User-Agent': UA,
    },
  });

  const newSession = extractSessionCookie(res);
  if (newSession) saveSession(newSession);

  return res;
}

// ─── CSRF token ───────────────────────────────────────────────────────────────

let cachedCsrf = null;
let csrfFetchedAt = 0;
const CSRF_TTL = 30 * 60 * 1000; // 30 min

async function getCsrfToken() {
  if (cachedCsrf && Date.now() - csrfFetchedAt < CSRF_TTL) {
    return cachedCsrf;
  }

  const res = await stravaFetch('https://www.strava.com/dashboard');
  const html = await res.text();
  const match = html.match(/csrf-token" content="([^"]+)"/);

  if (!match) {
    throw new Error('Could not extract CSRF token — session cookie may have expired');
  }

  cachedCsrf = match[1];
  csrfFetchedAt = Date.now();
  console.log('[csrf] Token refreshed');
  return cachedCsrf;
}

// ─── Strava web API ───────────────────────────────────────────────────────────

async function getFeedActivities() {
  const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const activities = [];
  let before = Math.floor(Date.now() / 1000);
  let pages = 0;

  while (pages < 10) {
    const url = `https://www.strava.com/dashboard/feed?num_entries=50&activity_type=&before=${before}&cursor_type=time`;
    const res = await stravaFetch(url, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Feed request failed: HTTP ${res.status}`);
    }

    const data = await res.json();
    const entries = data.entries || [];
    if (entries.length === 0) break;

    let oldestRank = before;
    let reachedOld = false;

    for (const entry of entries) {
      if (entry.entity !== 'Activity') continue;
      const activity = entry.activity;
      if (!activity) continue;

      const startDate = new Date(activity.startDate).getTime() / 1000;
      if (startDate < since) {
        reachedOld = true;
        continue;
      }

      activities.push({
        id: activity.id,
        name: activity.activityName,
        athleteName: activity.athlete?.athleteName || 'Unknown',
        athleteId: activity.athlete?.athleteId,
        hasKudoed: activity.kudosAndComments?.hasKudoed ?? false,
        canKudo: activity.kudosAndComments?.canKudo ?? false,
        ownedByCurrentAthlete: activity.ownedByCurrentAthlete ?? false,
      });

      if (entry.cursorData?.rank) {
        oldestRank = Math.min(oldestRank, Math.floor(entry.cursorData.rank / 1000));
      }
    }

    if (reachedOld || !data.pagination?.hasMore) break;

    before = oldestRank - 1;
    pages++;
  }

  return activities;
}

async function giveKudos(activityId) {
  const csrf = await getCsrfToken();

  const res = await stravaFetch(`https://www.strava.com/feed/activity/${activityId}/kudo`, {
    method: 'POST',
    headers: {
      'X-CSRF-Token': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
      'Content-Length': '0',
      Referer: 'https://www.strava.com/dashboard',
    },
  });

  if (res.status === 401 || res.status === 403) {
    cachedCsrf = null; // Force refresh on next attempt
  }

  return res.status;
}

// ─── Core logic ───────────────────────────────────────────────────────────────

async function giveKudosToFeed() {
  console.log('[kudos] Starting kudos run...');

  const activities = await getFeedActivities();
  console.log(`[kudos] ${activities.length} activities in feed (last 24h)`);

  let given = 0;
  let skipped = 0;

  for (const activity of activities) {
    if (String(activity.athleteId) === String(STRAVA_ATHLETE_ID) || activity.ownedByCurrentAthlete) {
      skipped++;
      continue;
    }

    if (activity.hasKudoed || !activity.canKudo) {
      skipped++;
      continue;
    }

    const status = await giveKudos(activity.id);

    if (status === 200) {
      given++;
      console.log(`[kudos] ✓ ${activity.athleteName} — "${activity.name}"`);
    } else {
      console.log(`[kudos] ✗ ${activity.athleteName} — "${activity.name}" (status ${status})`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[kudos] Done — given: ${given}, skipped: ${skipped}`);
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

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

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const event = req.body;
  console.log('[webhook] Event received:', event.object_type, event.aspect_type, `owner:${event.owner_id}`);

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

  // Validate session on startup
  try {
    const s = getSession();
    console.log(`[session] Loaded (${s.length} chars)`);
  } catch (err) {
    console.error(`[session] ❌ ${err.message}`);
    process.exit(1);
  }
});
