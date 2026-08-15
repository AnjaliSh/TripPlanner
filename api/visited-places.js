// GET /api/visited-places       -> list
// POST /api/visited-places      -> add { name, country?, year?, notes?, rating? }
//   rating is one of "great" | "okay" | "poor" | omitted
// DELETE /api/visited-places?id=xxx -> remove

const { sendJson, readJsonBody } = require("../lib/http.js");
const store = require("../lib/store.js");
const { resolveSession } = require("../lib/session.js");

module.exports = async function handler(req, res) {
  try {
    const sessionId = resolveSession(req, res);

    if (req.method === "GET") {
      const list = await store.getVisitedPlaces(sessionId);
      return sendJson(res, 200, { visitedPlaces: list });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const entry = await store.addVisitedPlace(sessionId, body);
      return sendJson(res, 201, { visitedPlace: entry });
    }

    if (req.method === "DELETE") {
      const url = new URL(req.url, "http://localhost");
      const id = url.searchParams.get("id");
      if (!id) return sendJson(res, 400, { error: "id query param required" });
      const next = await store.removeVisitedPlace(sessionId, id);
      return sendJson(res, 200, { visitedPlaces: next });
    }

    return sendJson(res, 405, { error: "Method not allowed" });
  } catch (err) {
    sendJson(res, 400, { error: String(err.message || err) });
  }
};
