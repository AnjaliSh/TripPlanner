// lib/rateLimit.js
//
// Soft per-session daily cap on the AI-calling endpoints (plan-trip.js,
// chat.js, extract-preferences.js), so one enthusiastic beta tester can't
// run up the shared Anthropic bill. This is a speed bump, not real quota
// enforcement — counts live in the same Upstash/local-file storage as
// everything else, keyed by session id + today's UTC date, and reset
// naturally each day (Redis key expires; local file just gets a new key).
// Cap is configurable via AI_DAILY_CALL_LIMIT (defaults to 8).

const fs = require("fs");
const path = require("path");
const store = require("./store.js");

const DEFAULT_LIMIT = 8;
const LOCAL_FILE = path.join(__dirname, "..", "data", "ai-usage.local.json");
const TTL_SECONDS = 60 * 60 * 26; // a little over a day, so clock skew can't cut a session off early

function getLimit() {
  const raw = Number(process.env.AI_DAILY_CALL_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LIMIT;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function usageKey(sessionId) {
  return `trip_planner:ai_calls:${sessionId}:${todayUtc()}`;
}

function readLocalMap() {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
  } catch (err) {
    return {};
  }
}

function writeLocalMap(map) {
  fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(map, null, 2));
}

/**
 * Increments today's AI-call counter for this session and reports whether
 * the call is still under the cap. Counts every attempt (not just
 * successful ones) so a burst of failed/retried calls can't be used to
 * dodge the limit.
 * @returns {Promise<{ allowed: boolean, count: number, limit: number }>}
 */
async function checkAndIncrement(sessionId) {
  const limit = getLimit();
  const key = usageKey(sessionId);

  if (store.hasUpstash()) {
    const count = await store.upstashCommand(["INCR", key]);
    if (count === 1) {
      await store.upstashCommand(["EXPIRE", key, String(TTL_SECONDS)]);
    }
    return { allowed: count <= limit, count, limit };
  }

  const map = readLocalMap();
  const count = (map[key] || 0) + 1;
  map[key] = count;
  writeLocalMap(map);
  return { allowed: count <= limit, count, limit };
}

module.exports = { checkAndIncrement, getLimit };
