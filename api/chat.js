// POST /api/chat { destinationId, messages: [{ role: "user"|"assistant", content }] }
// -> { reply }
//
// Stateless — the client keeps the running conversation and resends the
// whole thing each turn. Needs ANTHROPIC_API_KEY, same as plan-trip.js.

const { sendJson, readJsonBody } = require("../lib/http.js");
const store = require("../lib/store.js");
const { chatAboutTrip, isAiConfigured } = require("../lib/ai.js");
const { resolveSession } = require("../lib/session.js");
const { checkAndIncrement } = require("../lib/rateLimit.js");
const { resolveDestination } = require("../lib/destinationLookup.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  if (!isAiConfigured()) {
    return sendJson(res, 501, { error: "ANTHROPIC_API_KEY isn't configured, so AI chat isn't available yet." });
  }
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

  try {
    const [profile, visitedPlaces] = await Promise.all([store.getProfile(sessionId), store.getVisitedPlaces(sessionId)]);
    const reply = await chatAboutTrip({ profile, destination, visitedPlaces, messages: body.messages });
    sendJson(res, 200, { reply });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
};
