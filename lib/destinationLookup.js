// lib/destinationLookup.js
//
// Resolves a destinationId to a full destination object. Checks the
// visitor's own cached AI-generated suggestions (lib/store.js's
// getCachedSuggestions) first, then falls back to the static curated list
// (data/destinations.js) — cache-first, not static-first, because an
// AI-generated id can coincidentally collide with a static one (e.g.
// "porto"), and preferring the session's own live list avoids resolving
// to the wrong, old-schema object even when AI mode is active.

const destinations = require("../data/destinations.js");
const store = require("./store.js");

async function resolveDestination(sessionId, destinationId) {
  const cached = await store.getCachedSuggestions(sessionId);
  const fromCache = cached?.suggestions.find((d) => d.id === destinationId);
  if (fromCache) return fromCache;
  return destinations.find((d) => d.id === destinationId) || null;
}

module.exports = { resolveDestination };
