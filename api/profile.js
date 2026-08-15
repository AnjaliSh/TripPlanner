// GET  /api/profile                                                  -> { profile }
// POST /api/profile { action: "addPoint", sectionId, text }             -> { profile }
// POST /api/profile { action: "removePoint", sectionId, index }         -> { profile }
// POST /api/profile { action: "updateFields", fields: {travelers, home, onboarded} } -> { profile }
//   Used by the swipe-card onboarding flow (public/app.js) to set the
//   top-level fields and flag onboarding complete once it's done.
//
// The profile is scoped to the visitor's session (see lib/session.js) and
// persisted the same Upstash/local-file way as visited places, seeded empty
// (data/emptyProfile.js) the first time a new session is read. Day-to-day
// edits (including AI-extracted preferences from api/extract-preferences.js)
// go through here.

const { sendJson, readJsonBody } = require("../lib/http.js");
const store = require("../lib/store.js");
const { resolveSession } = require("../lib/session.js");

module.exports = async function handler(req, res) {
  const sessionId = resolveSession(req, res);

  if (req.method === "GET") {
    try {
      const profile = await store.getProfile(sessionId);
      return sendJson(res, 200, { profile });
    } catch (err) {
      return sendJson(res, 500, { error: String(err.message || err) });
    }
  }

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    try {
      let profile;
      if (body.action === "addPoint") {
        profile = await store.addProfilePoint(sessionId, body.sectionId, body.text);
      } else if (body.action === "removePoint") {
        profile = await store.removeProfilePoint(sessionId, body.sectionId, body.index);
      } else if (body.action === "updateFields") {
        profile = await store.updateProfileFields(sessionId, body.fields || {});
      } else {
        return sendJson(res, 400, { error: "Unknown action" });
      }
      return sendJson(res, 200, { profile });
    } catch (err) {
      return sendJson(res, 400, { error: String(err.message || err) });
    }
  }

  return sendJson(res, 405, { error: "Method not allowed" });
};
