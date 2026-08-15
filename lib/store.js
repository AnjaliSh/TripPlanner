// lib/store.js
//
// Storage for each anonymous visitor's "visited places" and travel profile,
// scoped by the signed session id lib/session.js hands out (see there for
// how the id is minted/verified). Every function here takes that sessionId
// as its first argument — there is no more single shared record.
// - In production (Vercel): backed by Upstash Redis's plain HTTPS REST API.
//   No SDK needed — just fetch() with a bearer token, so there's nothing to
//   npm install. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
// - Locally (no Upstash env vars set): falls back to a JSON file on disk,
//   so `npm run dev` works immediately with zero external accounts. Each
//   local file holds a { [sessionId]: ... } map instead of one record.

const fs = require("fs");
const path = require("path");

const LOCAL_FILE = path.join(__dirname, "..", "data", "visited-places.local.json");
const PROFILE_LOCAL_FILE = path.join(__dirname, "..", "data", "profile.local.json");
const SUGGESTIONS_CACHE_LOCAL_FILE = path.join(__dirname, "..", "data", "suggestions-cache.local.json");
const SUGGESTIONS_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const emptyProfile = require("../data/emptyProfile.js");

function hasUpstash() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function visitedKey(sessionId) {
  return `trip_planner:visited_places:${sessionId}`;
}

function profileKey(sessionId) {
  return `trip_planner:profile:${sessionId}`;
}

function suggestionsCacheKey(sessionId) {
  return `trip_planner:suggestions_cache:${sessionId}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------- Local-file map helpers (dev fallback only) ----------
// Older versions of these files held a single flat array/object (one shared
// record, no sessions). If we find that legacy shape, treat it as empty
// rather than trying to guess who it belonged to — a visitor-scoped store
// can't inherit an unscoped record.

function readLocalMap(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeLocalMap(file, map) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2));
}

async function upstashCommand(commandArray) {
  const base = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
  const res = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commandArray),
  });
  if (!res.ok) throw new Error(`Upstash error ${res.status}`);
  const json = await res.json();
  return json.result;
}

// ---------- Visited places ----------

async function getVisitedPlaces(sessionId) {
  if (hasUpstash()) {
    const raw = await upstashCommand(["GET", visitedKey(sessionId)]);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const map = readLocalMap(LOCAL_FILE);
  return Array.isArray(map[sessionId]) ? map[sessionId] : [];
}

async function saveVisitedPlaces(sessionId, list) {
  if (hasUpstash()) {
    await upstashCommand(["SET", visitedKey(sessionId), JSON.stringify(list)]);
    return;
  }
  const map = readLocalMap(LOCAL_FILE);
  map[sessionId] = list;
  writeLocalMap(LOCAL_FILE, map);
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function addVisitedPlace(sessionId, { name, country, year, notes, rating }) {
  if (!name || !name.trim()) {
    throw new Error("name is required");
  }
  const list = await getVisitedPlaces(sessionId);
  const entry = {
    id: `${slugify(name)}-${Date.now().toString(36)}`,
    name: name.trim(),
    country: (country || "").trim(),
    year: year || null,
    notes: (notes || "").trim(),
    rating: ["great", "okay", "poor"].includes(rating) ? rating : null,
    addedAt: new Date().toISOString(),
  };
  list.push(entry);
  await saveVisitedPlaces(sessionId, list);
  return entry;
}

async function removeVisitedPlace(sessionId, id) {
  const list = await getVisitedPlaces(sessionId);
  const next = list.filter((p) => p.id !== id);
  await saveVisitedPlaces(sessionId, next);
  return next;
}

/** Loose match used to filter suggested destinations against visited places. */
function isPlaceVisited(destination, visitedList) {
  const haystacks = [destination.name, destination.region, destination.country]
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  return visitedList.some((v) => {
    const needle = v.name.toLowerCase();
    return haystacks.some((h) => h.includes(needle) || needle.includes(h));
  });
}

// ---------- Travel profile (editable, persisted the same way as visited places) ----------

/** Returns the visitor's stored profile, seeding an empty one the first time it's read. */
async function getProfile(sessionId) {
  if (hasUpstash()) {
    const raw = await upstashCommand(["GET", profileKey(sessionId)]);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        /* fall through to reseed */
      }
    }
    const seeded = clone(emptyProfile);
    await upstashCommand(["SET", profileKey(sessionId), JSON.stringify(seeded)]);
    return seeded;
  }
  const map = readLocalMap(PROFILE_LOCAL_FILE);
  if (map[sessionId]) return map[sessionId];
  const seeded = clone(emptyProfile);
  map[sessionId] = seeded;
  writeLocalMap(PROFILE_LOCAL_FILE, map);
  return seeded;
}

async function saveProfile(sessionId, profile) {
  if (hasUpstash()) {
    await upstashCommand(["SET", profileKey(sessionId), JSON.stringify(profile)]);
    return;
  }
  const map = readLocalMap(PROFILE_LOCAL_FILE);
  map[sessionId] = profile;
  writeLocalMap(PROFILE_LOCAL_FILE, map);
}

async function addProfilePoint(sessionId, sectionId, text) {
  if (!text || !text.trim()) throw new Error("text is required");
  const profile = await getProfile(sessionId);
  const section = profile.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error(`Unknown section: ${sectionId}`);
  section.points.push(text.trim());
  await saveProfile(sessionId, profile);
  return profile;
}

async function removeProfilePoint(sessionId, sectionId, index) {
  const profile = await getProfile(sessionId);
  const section = profile.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error(`Unknown section: ${sectionId}`);
  section.points.splice(index, 1);
  await saveProfile(sessionId, profile);
  return profile;
}

// Top-level profile fields the onboarding flow (public/app.js) can set
// directly, as opposed to section points which go through add/removePoint.
const UPDATABLE_FIELDS = ["travelers", "home", "onboarded"];

async function updateProfileFields(sessionId, fields) {
  const profile = await getProfile(sessionId);
  for (const key of UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      profile[key] = fields[key];
    }
  }
  await saveProfile(sessionId, profile);
  return profile;
}

// ---------- AI-personalized suggestions cache ----------
//
// Caches the fully-assembled suggestions response (post-image-lookup,
// post-travel-links, post-match-shape) per session, keyed by a fingerprint
// of the profile content that produced it (see api/suggestions.js). A
// cache hit is genuinely free — no AI call, no Wikipedia lookups, nothing
// rebuilt — and only misses when the visitor's profile or visited-places
// list actually changes.

async function getCachedSuggestions(sessionId) {
  if (hasUpstash()) {
    const raw = await upstashCommand(["GET", suggestionsCacheKey(sessionId)]);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const map = readLocalMap(SUGGESTIONS_CACHE_LOCAL_FILE);
  return map[sessionId] || null;
}

async function saveCachedSuggestions(sessionId, data) {
  if (hasUpstash()) {
    await upstashCommand(["SET", suggestionsCacheKey(sessionId), JSON.stringify(data)]);
    await upstashCommand(["EXPIRE", suggestionsCacheKey(sessionId), String(SUGGESTIONS_CACHE_TTL_SECONDS)]);
    return;
  }
  const map = readLocalMap(SUGGESTIONS_CACHE_LOCAL_FILE);
  map[sessionId] = data;
  writeLocalMap(SUGGESTIONS_CACHE_LOCAL_FILE, map);
}

module.exports = {
  getVisitedPlaces,
  saveVisitedPlaces,
  addVisitedPlace,
  removeVisitedPlace,
  isPlaceVisited,
  hasUpstash,
  upstashCommand,
  getProfile,
  saveProfile,
  addProfilePoint,
  removeProfilePoint,
  updateProfileFields,
  getCachedSuggestions,
  saveCachedSuggestions,
  slugify,
};
