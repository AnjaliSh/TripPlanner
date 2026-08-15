// POST /api/plan-trip
// Body: { destinationId, dates, extra? }
// Calls Claude (if ANTHROPIC_API_KEY is set) to generate a tailored
// itinerary for the chosen destination, respecting the family profile and
// excluding already-visited places.

const { sendJson, readJsonBody } = require("../lib/http.js");
const store = require("../lib/store.js");
const { planTrip, isAiConfigured } = require("../lib/ai.js");
const { resolveSession } = require("../lib/session.js");
const { checkAndIncrement } = require("../lib/rateLimit.js");
const { resolveDestination } = require("../lib/destinationLookup.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  if (!isAiConfigured()) {
    return sendJson(res, 501, {
      error: "ANTHROPIC_API_KEY is not configured on this deployment. Add it in your Vercel project's Environment Variables to enable AI itinerary planning.",
    });
  }
  try {
    const sessionId = resolveSession(req, res);
    const usage = await checkAndIncrement(sessionId);
    if (!usage.allowed) {
      return sendJson(res, 429, {
        error: `You've hit today's limit of ${usage.limit} AI requests for this beta. It resets tomorrow — this just keeps one tester from running up the shared AI bill.`,
      });
    }
    const body = await readJsonBody(req);
    const destination = await resolveDestination(sessionId, body.destinationId);
    if (!destination) return sendJson(res, 400, { error: "Unknown destinationId" });

    const [profile, visitedPlaces] = await Promise.all([store.getProfile(sessionId), store.getVisitedPlaces(sessionId)]);
    const itinerary = await planTrip({
      profile,
      destination,
      visitedPlaces,
      dates: body.dates || "your chosen dates",
      extra: body.extra || "",
    });
    sendJson(res, 200, { itinerary });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
};
