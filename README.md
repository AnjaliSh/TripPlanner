# Bagsy

A small, (almost) dependency-free web app for planning family trips from London:

- **Long Weekend Radar** — pulls live UK bank holiday dates from gov.uk and shows every upcoming long weekend, with a countdown to when its ~3-month planning window opens.
- **Suggestions** — with `ANTHROPIC_API_KEY` set, a genuinely personalized shortlist: an AI agent derives its own criteria from *your* stored profile (not a fixed checklist — a parent needing strollers and a bachelor wanting nightlife get different criteria and different destinations) and proposes 10 real places, using live web search to verify specific claims (accessibility, flight routes, weather) rather than guessing from training data. Regenerates only when your profile or visited-places list actually changes (cached per session in between — see `lib/store.js`), and shares the same daily AI-call budget as "Plan with AI"/chat (`AI_DAILY_CALL_LIMIT`). Without an API key, falls back to the original curated shortlist scored by fixed keyword criteria (`lib/matchScore.js`) — same as before, byte-for-byte. Either way, cards show a real photo of the destination's landmark as a dimmed background (pulled live from Wikipedia, no key needed). Click "View details" on any card for a full breakdown, hero photo, weather norms, and which specific criteria it does/doesn't clear. Excludes anywhere already in your visited-places list.
- **Map** — every remaining suggestion plotted on a map from London, via Leaflet + OpenStreetMap (no API key needed), with a landmark photo thumbnail in each pin's popup.
- **AI chat customization** — inside a destination's detail view, "💬 Customize with AI chat" opens a real back-and-forth conversation about that specific trip (swap a day, ask about a specific park, adjust pacing) — grounded in your profile and that destination's notes. Needs `ANTHROPIC_API_KEY`. Conversation lives in the browser only (nothing saved server-side), so it resets if you leave the detail view or reload.
- **Find real stays** — click "Find real stays" on any destination card for actual aparthotel/serviced-apartment listings with names, ratings and photos (via Google Places), plus one-click links into live Booking.com and Airbnb searches. Works without a Google Maps key too — you just get the search links instead of inline results.
- **Visited Places** — add/remove places you've already been, with a quick 🟢/🟡/🔴 rating chip. Shown as passport-stamp cards. Suggestions update instantly.
- **Notes → Profile** — write a free-text note on a visited place and hit "✨ Process & extract preferences" — Claude reads it and proposes specific additions to your travel profile (e.g. "prefers large conventional ferries"), which you accept or skip individually. Needs `ANTHROPIC_API_KEY`.
- **Plan with AI** — pick a destination and dates, and Claude generates a day-by-day itinerary, accommodation leads, budget range, and dining picks tailored to your exact profile (needs your own Anthropic API key). Also surfaces live flight/hotel search links for those exact dates.
- **Travel Profile** — now editable in the app itself (add/remove preference bullets per section), not just in `data/profile.js`. Edits persist the same way visited places do.
- **Weekly nudge** — a cron job checks for long weekends entering the 3-month window and emails you a shortlist (needs Vercel + a free Resend account).
- **Mobile-first nav** — the tab bar becomes a sticky bottom bar with icons on small screens.

> **No login, by design — but still no rate limiting.** Every visitor gets an anonymous, signed session cookie (see `lib/session.js`) the first time they hit the app, and their travel profile + visited-places list are scoped to that cookie — nobody can read or edit another visitor's data. There's still no login and no cap on API usage, though: anyone with the link can use "Plan with AI" / chat / notes-extraction and spend your Anthropic API budget. Worth adding basic rate limiting before a high-traffic public launch.

No frameworks, no build step. The only non-npm dependency is Leaflet, loaded from a CDN in the browser for the Map tab — there's still nothing to `npm install` to run this locally.

## Run it locally

```bash
npm install   # installs nothing right now — just here so `npm run dev` works
npm run dev
```

Open http://localhost:3000. Visited places are stored in `data/visited-places.local.json` until you connect Upstash Redis (see below).

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **New Project → Import** your repo. No framework preset needed — Vercel will detect the `/api` functions and serve `/public` automatically. No build command required.
3. Add environment variables under **Project → Settings → Environment Variables**:

   | Variable | Required for | Notes |
   |---|---|---|
   | `SESSION_SECRET` | Signing anonymous visitor session cookies | **Required before a public deploy.** Any long random string (e.g. `openssl rand -hex 32`). Without it, sessions are signed with a hardcoded fallback and anyone can forge another visitor's session id. |
   | `UPSTASH_REDIS_REST_URL` | Persisting each visitor's profile/visited places online | Free tier at [upstash.com](https://upstash.com) → create a Redis database → copy the REST URL |
   | `UPSTASH_REDIS_REST_TOKEN` | Persisting each visitor's profile/visited places online | Same Upstash database → REST token |
   | `ANTHROPIC_API_KEY` | "Plan with AI" tab + AI chat customization + notes→profile extraction | Your own key from [console.anthropic.com](https://console.anthropic.com) |
   | `AI_DAILY_CALL_LIMIT` | Optional | Soft per-session daily cap on AI-calling endpoints (plan/chat/extract), so one tester can't run up the bill. Defaults to 8 if unset. |
   | `GOOGLE_MAPS_API_KEY` | Real accommodation listings in "Find real stays" | Free tier ($200/mo credit) at [console.cloud.google.com](https://console.cloud.google.com) — enable the **Places API (New)**. Without this, "Find real stays" still gives you live Booking.com/Airbnb search links, just no inline results. |
   | `RESEND_API_KEY` | Feedback button email + weekly email nudge | Free tier at [resend.com](https://resend.com) |
   | `RESEND_FROM` | Feedback button email + weekly email nudge | e.g. `Bagsy <planner@yourdomain.com>` — Resend requires a verified sending domain, or use their shared test domain while you set this up |
   | `FEEDBACK_TO` | Emailing feedback-button submissions | Your inbox. Feedback is always logged server-side (visible in Vercel function logs) even without this set. |
   | `RESEND_TO` | Weekly email nudge | **Intentionally left unset for the beta** — see "Weekly email nudge is disabled" below. |
   | `CRON_SECRET` | Optional hardening | If set, only Vercel Cron's authenticated request can trigger `/api/cron/weekly-check` |

   Landmark photos need no env var at all — they come from Wikipedia's public API, which is keyless.

4. Deploy. The cron in `vercel.json` runs daily at 08:00 UTC and hits `/api/cron/weekly-check`, which currently no-ops immediately (see below).

**Without Upstash configured**, visited places will reset on every deploy (Vercel's filesystem is read-only/ephemeral in production) — so for a real deployment, set up Upstash Redis.

**Weekly email nudge is disabled.** It predates anonymous per-visitor sessions and personalized itself against a single shared "visited places" list that no longer exists — every visitor has their own now, so there's nothing coherent left to personalize the digest against. `api/cron/weekly-check.js` short-circuits and returns immediately unless `RESEND_TO` is set, which it deliberately isn't. Leave it unset until this is rebuilt as a real opt-in per-visitor feature.

**Without Resend configured** (`RESEND_API_KEY` + `RESEND_FROM`), the feedback button still works — submissions are always logged server-side (Vercel function logs) — they just aren't emailed to you.

**Without an Anthropic key**, every tab works except "Plan with AI", which will show a clear message instead of erroring.

**Without a Google Maps key**, "Find real stays" falls back to the curated accommodation notes plus live Booking.com/Airbnb search links — still useful, just not inline photos/ratings.

## Project structure

```
api/                    Serverless functions (also used directly by the local dev server)
  long-weekends.js       GET  - computed long weekends + countdowns
  visited-places.js      GET/POST/DELETE - visited places CRUD (rating included)
  suggestions.js          GET  - curated destinations + match score + landmark photo + live flight links, filtered by visited places
  accommodations.js        GET  - live Google Places results (or fallback links) for a destination
  plan-trip.js               POST - AI itinerary generation
  profile.js                   GET/POST - your travel profile, now editable
  extract-preferences.js         POST - reads a visited-place note, proposes profile additions
  chat.js                          POST - AI chat customization for a specific destination
  feedback.js                        POST - feedback-button submissions, logged server-side + optionally emailed
  cron/weekly-check.js               GET  - weekly email nudge, currently disabled (see README above)
data/
  destinations.js         Curated destination shortlist — coordinates, airport codes, typical weather, landmark photo query
  emptyProfile.js             Blank travel profile every new anonymous session is seeded with
  bankHolidaysFallback.js     Snapshot used only if the live gov.uk fetch fails
  visited-places.local.json     Local dev fallback store — { [sessionId]: [...] } map, auto-created, gitignored
  profile.local.json               Local dev fallback store — { [sessionId]: profile } map, auto-created, gitignored
  ai-usage.local.json                Local dev fallback store — { [sessionId+date]: count } map for the AI rate limit, auto-created, gitignored
lib/
  bankHolidays.js          Long-weekend calculation logic
  session.js                 Mints/verifies each visitor's signed, anonymous session cookie
  store.js                   Visited-places + profile storage, scoped by session id (Upstash in prod, local files in dev)
  rateLimit.js                 Soft per-session daily cap on the AI-calling endpoints
  destinationLookup.js           Resolves a destinationId against the visitor's cached AI suggestions, falling back to the static list
  ai.js                             Claude API calls: itinerary generation, notes-to-profile extraction, chat, AND search-grounded suggestion generation
  places.js                          Google Places API call for live accommodation search
  wikiImage.js                         Live landmark photo lookup via Wikipedia's free REST API
  matchScore.js                          Fixed-criteria scoring — only used as the no-API-key fallback now (see api/suggestions.js)
  travelLinks.js                           Builds Google Flights/Skyscanner/Booking.com/Airbnb deep links
  email.js                                   Resend API call, used by the feedback button and the (disabled) nudge
  http.js                                      Tiny JSON helpers shared by every API handler
public/                  Static frontend — plain HTML/CSS/JS, no build step (Leaflet via CDN for the map)
  manifest.json             PWA manifest (name, icons, theme color)
  sw.js                        Service worker — caches the app shell so an already-loaded tab works offline
  icons/                          Generated app icons (see scripts/generate-icons.js)
scripts/generate-icons.js  Regenerates public/icons/*.png — zero-dependency PNG encoder, no image library
server.js                Zero-dependency local dev server
vercel.json              Cron schedule + a 60s maxDuration on api/suggestions.js (search-grounded generation can take 10-30s; raise further on a Pro/Enterprise plan if needed)
```

## Extending it

- **Add destinations**: edit `data/destinations.js` — each entry needs `coordinates: {lat, lng}` and `airportCode` now (used by the map and flight links), alongside the existing fields. These are shown to every visitor, unlike the per-session profile/visited places.
- **Update your travel profile**: use the Profile tab in the app — it's per-visitor now, scoped to your session cookie, and feeds both the Profile tab and the AI itinerary prompt. `data/emptyProfile.js` only controls what a *brand-new* visitor starts with.
- **Log a visited place**: use the Visited Places tab in the app (or `POST /api/visited-places`).
- **Change the reminder cadence**: edit the `schedule` in `vercel.json` (cron syntax). Note Vercel's free Hobby plan runs cron jobs at most once a day.
