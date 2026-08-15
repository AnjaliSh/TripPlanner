// GET /api/landmark-photos?landmarkQuery=Dom%20Lu%C3%ADs%20I%20Bridge
// -> { photos: [{ url, caption }] }
//
// Extra real photos for a destination's landmark, pulled live from
// Wikimedia — same keyless approach as lib/wikiImage.js's hero image, just
// fetched on demand when the user asks to see more photos on the detail
// page, not bundled into every suggestions load.

const { sendJson } = require("../lib/http.js");
const { getLandmarkGallery } = require("../lib/wikiImage.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  const url = new URL(req.url, "http://localhost");
  const landmarkQuery = url.searchParams.get("landmarkQuery");
  if (!landmarkQuery) {
    return sendJson(res, 400, { error: "landmarkQuery query param required" });
  }
  const photos = await getLandmarkGallery(landmarkQuery);
  sendJson(res, 200, { photos });
};
