# ⚡ Rash — Gemini Flash Live Desk Companion

Rash is a Raspberry Pi-friendly desk companion for study and focused work. It uses **Gemini Flash Live only**—there is no Groq client, provider selector, or model failover.

## Desk features

- **Gemini 3.8 Flash Live-only runtime** configured with `GEMINI_API_KEY` and optional `GEMINI_LIVE_MODEL` (default: `gemini-3.8-flash-live`). Model access depends on your Google project.
- **LCD-style desk display** with a live clock and desk-control dashboard.
- **Google Calendar OAuth**: schedules are always saved locally; newly created schedule items also create an event in the primary Google Calendar after connection.
- **Physical mute integration**: wire a hardware-button daemon to `POST /api/controller/mute-toggle`; the UI and controller persist the same mute state.
- **Responsive RGB**: desk lighting changes for focus, break, urgent, and music requests. Hardware controllers can consume the persisted controller state from `GET /api/controller`.
- **Pomodoro controller** with start, reset, focus/break transitions, and persistent state.
- **Proactive reminders** for due scheduled items.
- **Spotify controls** using Spotify Connect Web API (`play`, `pause`, next, previous).

## Setup

```bash
npm install
cp .env.example .env  # create manually if this repository has no template
npm start
```

Minimum `.env`:

```dotenv
GEMINI_API_KEY=AIza...
GEMINI_LIVE_MODEL=gemini-3.8-flash-live
PORT=3000
```

### Google Calendar

Create a Google OAuth Web Application and add your callback URL (for local development: `http://localhost:3000/api/calendar/callback`). Then set:

```dotenv
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/api/calendar/callback
CALENDAR_TIME_ZONE=Asia/Kolkata
```

Open **Desk → Connect Calendar** and complete Google OAuth. The app stores the refresh/access credentials in its local persistent database; keep the database private.

### Spotify

Set a current Spotify access token, and optionally a Connect device ID:

```dotenv
SPOTIFY_ACCESS_TOKEN=...
SPOTIFY_DEVICE_ID=...
```

### Physical hardware

Use any GPIO/button daemon that sends an authenticated local-network request to `POST /api/controller/mute-toggle`. This app intentionally does not assume a GPIO library or pin layout, so it runs on PCs and Raspberry Pi variants without native dependencies. Poll `GET /api/controller` to drive a physical RGB LED/LCD. Do not expose the controller APIs directly to the public internet.

## APIs

- `GET /api/controller` — persistent mute, RGB, and Pomodoro state.
- `POST /api/controller/mute-toggle` — physical or UI mute event.
- `POST /api/controller/rgb` with `{ "color": "#RRGGBB" }`.
- `POST /api/pomodoro` with `start`, `pause`, `reset`, `set`, or `complete`.
- `GET /api/calendar/connect` — begin Google OAuth.
- `POST /api/spotify/play|pause|next|previous` — Spotify Connect commands.
