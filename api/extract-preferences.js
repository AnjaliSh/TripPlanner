// POST /api/extract-preferences { placeName, notes }
// -> { suggestions: [{ text, sectionId, sectionTitle }] }
//
// Reads a visited-place note and proposes profile additions. This only
// *proposes* — nothing is written to the profile until the user accepts a
// suggestion from the UI, which then calls POST /api/profile separately.

const { sendJson, readJsonBody } = require("../lib/http.js");
const store = require("../lib/store.js");
const { extractPreferences, isAiConfigured } = require("../lib/ai.js");
const { resolveSession } = require("../lib/session.js");
const { checkAndIncrement } = require("../lib/rateLimit.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  if (!isAiConfigured()) {
    return sendJson(res, 501, {
      error: "ANTHROPIC_API_KEY isn't configured, so preference extraction isn't available yet.",
    });
  }
  const sessionId = resolveSession(req, res);
  const usage = await checkAndIncrement(sessionId);
  if (!usage.allowed) {
    return sendJson(res, 429, {
      error: `You've hit today's limit of ${usage.limit} AI requests for this beta. It resets tomorrow — this just keeps one tester from running up the shared AI bill.`,
    });
  }
  const body = await readJsonBody(req);
  if (!body.placeName || !body.notes) {
    return sendJson(res, 400, { error: "placeName and notes are required" });
  }
  try {
    const profile = await store.getProfile(sessionId);
    const raw = await extractPreferences({ profile, placeName: body.placeName, notes: body.notes });
    const sectionTitleById = Object.fromEntries(profile.sections.map((s) => [s.id, s.title]));
    const suggestions = raw.map((s) => ({ ...s, sectionTitle: sectionTitleById[s.sectionId] }));
    sendJson(res, 200, { suggestions });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
};
