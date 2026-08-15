// GET /api/accommodations?destinationId=porto&checkin=2026-09-18&checkout=2026-09-21
//
// Returns real accommodation listings (via Google Places, if configured)
// plus live Booking.com/Airbnb search links, and — always — the curated
// notes already written for that destination. checkin/checkout are optional
// and only affect the deep-link dates, not the Places results (Places
// doesn't do live availability/pricing, just what exists).

const { sendJson } = require("../lib/http.js");
const { isPlacesConfigured, searchAccommodation } = require("../lib/places.js");
const { buildTravelLinks } = require("../lib/travelLinks.js");
const { resolveSession } = require("../lib/session.js");
const { resolveDestination } = require("../lib/destinationLookup.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  const sessionId = resolveSession(req, res);
  const url = new URL(req.url, "http://localhost");
  const destinationId = url.searchParams.get("destinationId");
  const checkin = url.searchParams.get("checkin") || undefined;
  const checkout = url.searchParams.get("checkout") || undefined;

  const destination = await resolveDestination(sessionId, destinationId);
  if (!destination) return sendJson(res, 400, { error: "Unknown destinationId" });

  const links = buildTravelLinks(destination, { checkin, checkout });

  let listings = [];
  let source = "curated-notes-only";
  if (isPlacesConfigured()) {
    try {
      listings = await searchAccommodation(destination);
      source = "google-places";
    } catch (err) {
      // Degrade gracefully — curated notes + search links still work.
      source = `places-error: ${String(err.message || err)}`;
    }
  }

  sendJson(res, 200, {
    destinationId,
    source,
    listings,
    curatedNotes: destination.accommodationNotes,
    links,
  });
};
