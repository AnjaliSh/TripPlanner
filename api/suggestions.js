// GET /api/suggestions
//
// Without ANTHROPIC_API_KEY: the original curated destination shortlist,
// scored against fixed criteria (lib/matchScore.js) — unchanged from
// before, byte-for-byte, with field names aliased to match the AI path's
// schema (below) so the frontend can use one consistent shape either way.
//
// With ANTHROPIC_API_KEY: a personalized shortlist from lib/ai.js's
// generateSuggestions(), which derives its own criteria from the
// visitor's actual profile instead of a fixed checklist — see that file
// for why criteria have to be search-grounded, not just generated.
// Cached per session, keyed by a fingerprint of the profile content that
// produced it (lib/store.js's getCachedSuggestions/saveCachedSuggestions)
// — regenerates only when the profile or visited-places list actually
// changes, so a plain re-view of the tab is a free cache hit, not a new
// AI call.

const crypto = require("crypto");
const { sendJson } = require("../lib/http.js");
const store = require("../lib/store.js");
const destinations = require("../data/destinations.js");
const { buildTravelLinks } = require("../lib/travelLinks.js");
const { scoreDestination } = require("../lib/matchScore.js");
const { getLandmarkImages } = require("../lib/wikiImage.js");
const { resolveSession } = require("../lib/session.js");
const { isAiConfigured, generateSuggestions } = require("../lib/ai.js");
const { checkAndIncrement } = require("../lib/rateLimit.js");

function computeProfileFingerprint(profile, visited) {
  const relevant = {
    travelers: profile.travelers,
    home: profile.home,
    sections: profile.sections.map((s) => ({ id: s.id, points: s.points })),
    visited: visited.map((v) => v.name).sort(),
  };
  return crypto.createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}

async function buildStaticSuggestions(visited) {
  const shortlisted = destinations.filter((d) => !store.isPlaceVisited(d, visited));
  const images = await getLandmarkImages(shortlisted.map((d) => d.landmarkQuery));
  const suggestions = shortlisted
    .map((d) => ({
      ...d,
      foodNotes: d.vegFoodNotes,
      activityNotes: d.kidNotes,
      logisticsNotes: d.airportNotes,
      flightTimeFromHome: d.flightTimeFromLondon,
      links: buildTravelLinks(d),
      match: scoreDestination(d),
      image: images[d.landmarkQuery] || null,
    }))
    .sort((a, b) => b.match.score - a.match.score);
  return { suggestions, hiddenCount: destinations.length - suggestions.length, personalized: false };
}

async function buildAiSuggestions(sessionId, profile, visited) {
  const fingerprint = computeProfileFingerprint(profile, visited);
  const cached = await store.getCachedSuggestions(sessionId);
  if (cached && cached.fingerprint === fingerprint) {
    return { suggestions: cached.suggestions, hiddenCount: 0, personalized: true, criteria: cached.criteria };
  }

  const usage = await checkAndIncrement(sessionId);
  if (!usage.allowed) {
    if (cached) {
      return { suggestions: cached.suggestions, hiddenCount: 0, personalized: true, criteria: cached.criteria, stale: true };
    }
    return {
      status: 429,
      error: `You've hit today's limit of ${usage.limit} AI requests for this beta. It resets tomorrow — this just keeps one tester from running up the shared AI bill.`,
    };
  }

  let generated;
  try {
    generated = await generateSuggestions({ profile, visitedPlaces: visited });
  } catch (err) {
    if (cached) {
      return { suggestions: cached.suggestions, hiddenCount: 0, personalized: true, criteria: cached.criteria, stale: true };
    }
    return { status: 502, error: `Couldn't generate personalized suggestions: ${String(err.message || err)}` };
  }

  // Belt-and-braces: the prompt already tells the model to exclude visited
  // places, but don't rely on instruction-following alone for something
  // the static path double-enforces mechanically.
  const stillUnvisited = generated.destinations.filter((d) => !store.isPlaceVisited(d, visited));
  const images = await getLandmarkImages(stillUnvisited.map((d) => d.landmarkQuery));
  const suggestions = stillUnvisited.map((d) => ({
    ...d,
    match: { score: d.matchedCriteria.length, total: generated.criteria.length, matched: d.matchedCriteria, unmatched: d.unmatchedCriteria },
    links: buildTravelLinks(d),
    image: images[d.landmarkQuery] || null,
  }));

  await store.saveCachedSuggestions(sessionId, {
    fingerprint,
    suggestions,
    criteria: generated.criteria,
    generatedAt: new Date().toISOString(),
  });
  return { suggestions, hiddenCount: 0, personalized: true, criteria: generated.criteria };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  try {
    const sessionId = resolveSession(req, res);
    const visited = await store.getVisitedPlaces(sessionId);

    if (!isAiConfigured()) {
      return sendJson(res, 200, await buildStaticSuggestions(visited));
    }

    const profile = await store.getProfile(sessionId);
    const result = await buildAiSuggestions(sessionId, profile, visited);
    if (result.status) {
      return sendJson(res, result.status, { error: result.error });
    }
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
};
