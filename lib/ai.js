// lib/ai.js — calls the Claude API's plain REST endpoint directly (no SDK
// needed). Set ANTHROPIC_API_KEY to enable the "Plan with AI" feature.

const { slugify } = require("./store.js");

const MODEL = "claude-sonnet-4-5-20250929";

function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Renders a profile's sections as "### Title\n- point\n- point" markdown, shared by every prompt builder below. */
function formatProfileSections(profile) {
  return profile.sections
    .map((s) => `### ${s.title}\n` + s.points.map((p) => `- ${p}`).join("\n"))
    .join("\n\n");
}

function buildSystemPrompt(profile) {
  const who = profile.travelers ? `(${profile.travelers})` : "";
  const home = profile.home ? ` based in ${profile.home}` : "";
  const intro = [
    `You are an expert travel advisor for a traveler${home} ${who}.`.replace(/\s+/g, " ").trim(),
    "Tailor every recommendation, daily itinerary, dining suggestion, and",
    "logistical note to the exact travel profile below — its own sections",
    "already say how fast-paced, budget-conscious, or particular this",
    "traveler wants things, so don't impose a pace or style the profile",
    "doesn't state. Never suggest a place already in the visited-places list.",
  ].join(" ");

  return `${intro}\n\n${formatProfileSections(profile)}`;
}

/**
 * Ask Claude for a tailored trip plan.
 * @param {object} opts
 * @param {object} opts.profile - the visitor's stored profile (see lib/store.js), data/emptyProfile.js shape
 * @param {object} opts.destination - a destination object from data/destinations.js
 * @param {Array} opts.visitedPlaces - current visited-places list (for exclusion context)
 * @param {string} opts.dates - human-readable date range, e.g. "25-28 Dec 2026"
 * @param {string} [opts.extra] - any extra free-text ask from the user
 */
async function planTrip({ profile, destination, visitedPlaces, dates, extra }) {
  if (!isAiConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const system = buildSystemPrompt(profile);
  const visitedNames = visitedPlaces.map((p) => p.name).join(", ") || "none logged yet";

  const userMessage = [
    `Plan a ${dates} trip to ${destination.name}, ${destination.country}.`,
    `Destination notes: ${destination.whyProfile}`,
    `Accommodation leads: ${destination.accommodationNotes}`,
    `Food & drink notes: ${destination.foodNotes || destination.vegFoodNotes}`,
    `Activity notes: ${destination.activityNotes || destination.kidNotes}`,
    `Logistics notes: ${destination.logisticsNotes || destination.airportNotes}`,
    `Places already visited (do not suggest visiting these again): ${visitedNames}.`,
    extra ? `Extra request: ${extra}` : "",
    "",
    "Please produce: (1) a day-by-day itinerary paced the way the traveler's",
    "profile describes, (2) 2-3 accommodation search leads matching the",
    "profile's stated accommodation preferences, (3) a rough total budget",
    "range, (4) dining picks matching the profile's stated food preferences,",
    "(5) flight/airport logistics notes relevant to the profile's stated",
    "logistics preferences.",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }
  const json = await res.json();
  const text = (json.content || []).map((b) => b.text || "").join("\n");
  return text;
}

/**
 * Reads a visited-place note and proposes candidate additions to the travel
 * profile, as short single-sentence bullets tagged to the section they fit
 * best. Returns [] if the AI didn't find anything worth surfacing — not
 * every note contains a durable preference.
 *
 * @param {object} opts
 * @param {object} opts.profile - the visitor's stored profile (see lib/store.js), data/emptyProfile.js shape
 * @param {string} opts.placeName
 * @param {string} opts.notes - the free-text note the user wrote
 */
async function extractPreferences({ profile, placeName, notes }) {
  if (!isAiConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  if (!notes || !notes.trim()) return [];

  const sectionList = profile.sections.map((s) => `- id: "${s.id}", title: "${s.title}"`).join("\n");
  const existingPoints = profile.sections
    .flatMap((s) => s.points)
    .map((p) => `- ${p}`)
    .join("\n");

  const system = [
    "You read a family's trip notes and extract durable travel PREFERENCES —",
    "not one-off facts. A preference is something that would meaningfully",
    "change future trip suggestions if added to their profile. Skip anything",
    "that's just a factual recap of the trip, or that duplicates a preference",
    "they've already recorded.",
    "",
    "Respond with ONLY a JSON array (no prose, no code fences). Each item:",
    '{ "text": "<one sentence, written as a standing preference, not a recap>", "sectionId": "<one of the ids below>" }',
    "If there's nothing worth adding, respond with exactly: []",
    "",
    "Valid sectionIds:",
    sectionList,
    "",
    "Preferences already recorded (do not repeat these):",
    existingPoints,
  ].join("\n");

  const userMessage = `Trip note about ${placeName}:\n"""\n${notes.trim()}\n"""`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }
  const json = await res.json();
  const text = (json.content || []).map((b) => b.text || "").join("\n").trim();

  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse AI response as JSON: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) return [];

  const validSectionIds = new Set(profile.sections.map((s) => s.id));
  return parsed.filter(
    (item) => item && typeof item.text === "string" && item.text.trim() && validSectionIds.has(item.sectionId)
  );
}

/**
 * Free-form follow-up chat about a specific destination, grounded in the
 * same profile + destination context as planTrip(), but conversational
 * rather than forced into a fixed itinerary structure. The client owns
 * message history — this call is stateless server-side.
 *
 * @param {object} opts
 * @param {object} opts.profile
 * @param {object} opts.destination
 * @param {Array} opts.visitedPlaces
 * @param {Array<{role: "user"|"assistant", content: string}>} opts.messages
 */
async function chatAboutTrip({ profile, destination, visitedPlaces, messages }) {
  if (!isAiConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages array is required");
  }
  const cleanMessages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim() }));
  if (cleanMessages.length === 0) throw new Error("no valid messages");

  const visitedNames = visitedPlaces.map((p) => p.name).join(", ") || "none logged yet";
  const system = [
    buildSystemPrompt(profile),
    "",
    `You're in a back-and-forth chat with the traveler about a possible trip to ${destination.name}, ${destination.country}.`,
    `Destination notes: ${destination.whyProfile}`,
    `Accommodation leads: ${destination.accommodationNotes}`,
    `Food & drink notes: ${destination.foodNotes || destination.vegFoodNotes}`,
    `Activity notes: ${destination.activityNotes || destination.kidNotes}`,
    `Places already visited (don't re-suggest): ${visitedNames}.`,
    "Answer conversationally and specifically — this is a chat, not a formal itinerary document.",
    "Keep replies focused and reasonably short unless they ask for a full day-by-day plan.",
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system,
      messages: cleanMessages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }
  const json = await res.json();
  return (json.content || []).map((b) => b.text || "").join("\n");
}

// ---------- Personalized suggestions (search-grounded) ----------
//
// Replaces the old fixed-criteria/fixed-destination-list approach
// (lib/matchScore.js + data/destinations.js, still used as the fallback
// when ANTHROPIC_API_KEY isn't set) with an agent that derives its own
// criteria from whichever profile is asking — a parent needing strollers
// and veg food, a bachelor wanting pub scene and no stroller access,
// whoever — instead of one hardcoded checklist serving every visitor.
//
// Specific, checkable claims (stroller/pram accessibility, current flight
// routes, weather) come from the model's training data alone unless we
// make it verify them — exactly the kind of thing an LLM can state
// confidently and be wrong about. So this is a two-phase tool-use call in
// one request, not a single forced tool call: the model gets both
// `web_search` (server-executed — Anthropic's API loops internally
// through searches within this one response, no manual round trips on
// our side) and the client-side `provide_suggestions` tool, with
// tool_choice left on "auto" so it can research before committing.
// Because MODEL here is a pre-4.6 Sonnet snapshot, we use the *basic*
// `web_search_20250305` tool type — the newer dynamic-filtering variant
// (`web_search_20260209`) needs Sonnet 4.6+/Opus 4.6+.

const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search" };

const PROVIDE_SUGGESTIONS_TOOL = {
  name: "provide_suggestions",
  description:
    "Return the final personalized destination shortlist once research is complete. Call this only after using web_search to verify the specific, checkable claims in your candidates (stroller/pram accessibility where relevant, current flight routes and rough time from the traveler's home, typical weather for a plausible travel window) — do not call this as your first action.",
  input_schema: {
    type: "object",
    properties: {
      criteria: {
        type: "array",
        items: { type: "string" },
        description: "5-6 concrete, checkable criteria derived from THIS traveler's actual stated profile — not a generic checklist.",
      },
      destinations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "URL-safe slug, e.g. 'lisbon'" },
            name: { type: "string" },
            country: { type: "string" },
            region: { type: "string" },
            landmarkQuery: { type: "string", description: "Exact real Wikipedia article title for this destination's most famous landmark or sight" },
            airportCode: { type: "string", description: "IATA code of the nearest major airport" },
            coordinates: {
              type: "object",
              properties: { lat: { type: "number" }, lng: { type: "number" } },
              required: ["lat", "lng"],
              additionalProperties: false,
            },
            flightTimeFromHome: { type: "string", description: "Approx flight time from the traveler's home, e.g. '~2h30' — verify via web_search" },
            budgetTier: { type: "string", enum: ["£", "££", "£££"] },
            typicalWeather: { type: "string", description: "Typical weather for a plausible travel window — verify via web_search" },
            bestSeasons: { type: "array", items: { type: "string" } },
            vibeTags: { type: "array", items: { type: "string" } },
            whyProfile: { type: "string", description: "1-2 sentences on why this fits THIS traveler specifically" },
            accommodationNotes: { type: "string" },
            foodNotes: { type: "string" },
            activityNotes: { type: "string" },
            logisticsNotes: { type: "string" },
            matchedCriteria: { type: "array", items: { type: "string" }, description: "Subset of the top-level criteria this destination meets" },
          },
          required: [
            "id", "name", "country", "region", "landmarkQuery", "airportCode", "coordinates",
            "flightTimeFromHome", "budgetTier", "typicalWeather", "bestSeasons", "vibeTags",
            "whyProfile", "accommodationNotes", "foodNotes", "activityNotes", "logisticsNotes", "matchedCriteria",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["criteria", "destinations"],
    additionalProperties: false,
  },
};

/**
 * Validates + normalizes the model's provide_suggestions call. Never trusts
 * the model's own unmatchedCriteria (there isn't one in the schema above —
 * unmatched is always derived as criteria-minus-matched, so the two sets
 * are guaranteed to partition `criteria` by construction rather than by
 * hoping the model's two lists agree).
 */
function validateGeneratedSuggestions(input) {
  if (!input || !Array.isArray(input.criteria) || !Array.isArray(input.destinations)) {
    throw new Error("Malformed provide_suggestions input from model");
  }
  // Deduped, not just filtered: a duplicate criterion string would otherwise
  // make matched.length + unmatched.length disagree with criteria.length —
  // the score denominator shown on the frontend wouldn't match the actual
  // number of rendered pills.
  const criteria = [...new Set(input.criteria.filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim()))].slice(0, 8);
  if (criteria.length === 0) throw new Error("Model returned no usable criteria");

  const seenIds = new Set();
  const destinations = input.destinations
    .filter((d) => d && d.name && d.country && d.landmarkQuery)
    .slice(0, 10)
    .map((d) => {
      let id = slugify(String(d.id || d.name));
      while (seenIds.has(id)) id = `${id}-${seenIds.size + 1}`;
      seenIds.add(id);
      const matched = Array.isArray(d.matchedCriteria) ? d.matchedCriteria.filter((c) => criteria.includes(c)) : [];
      const unmatched = criteria.filter((c) => !matched.includes(c));
      const coords = d.coordinates && typeof d.coordinates.lat === "number" && typeof d.coordinates.lng === "number" ? d.coordinates : null;
      return {
        id,
        name: d.name,
        country: d.country,
        region: d.region || "",
        landmarkQuery: d.landmarkQuery,
        airportCode: d.airportCode || "",
        coordinates: coords,
        flightTimeFromHome: d.flightTimeFromHome || "",
        budgetTier: d.budgetTier || "££",
        typicalWeather: d.typicalWeather || "",
        bestSeasons: Array.isArray(d.bestSeasons) ? d.bestSeasons : [],
        vibeTags: Array.isArray(d.vibeTags) ? d.vibeTags : [],
        whyProfile: d.whyProfile || "",
        accommodationNotes: d.accommodationNotes || "",
        foodNotes: d.foodNotes || "",
        activityNotes: d.activityNotes || "",
        logisticsNotes: d.logisticsNotes || "",
        matchedCriteria: matched,
        unmatchedCriteria: unmatched,
      };
    });
  if (destinations.length === 0) throw new Error("Model returned no usable destinations");
  return { criteria, destinations };
}

/**
 * @param {object} opts
 * @param {object} opts.profile - the visitor's stored profile
 * @param {Array} opts.visitedPlaces - excluded from suggestions
 * @returns {Promise<{criteria: string[], destinations: object[]}>}
 */
async function generateSuggestions({ profile, visitedPlaces }) {
  if (!isAiConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const visitedText = visitedPlaces.length ? visitedPlaces.map((p) => p.name).join(", ") : "none yet";

  const system = [
    "You are a travel-suggestion agent. Given a traveler's profile, derive",
    "the specific, concrete criteria that actually matter to THIS traveler —",
    "do not reuse a generic checklist — then research and propose real",
    "destinations that fit, scored transparently against those criteria.",
    "",
    "Before calling provide_suggestions, use web_search to verify specific,",
    "checkable claims for your candidate destinations: accessibility (e.g.",
    "stroller/pram-friendliness of the old town or key areas) if relevant to",
    "this profile, current flight routes and rough flight time from the",
    `traveler's home (${profile.home || "not specified — use your best judgement"}),`,
    "and typical weather for a plausible travel window. Do not state a",
    "specific, checkable claim without having searched for it. Roughly 3-6",
    "searches covering your shortlist is enough — don't search exhaustively",
    "for every minor detail.",
    "",
    `Exclude anywhere in the traveler's visited-places list: ${visitedText}.`,
    "",
    "Once research is sufficient, call provide_suggestions exactly once with",
    "exactly 10 destinations and 5-6 shared criteria, matching its schema.",
  ].join("\n") + "\n\n" + formatProfileSections(profile);

  const userMessage = `Traveler: ${profile.travelers || "not specified"}, based in ${profile.home || "not specified"}. Propose 10 personalized destination suggestions.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: userMessage }],
      tools: [WEB_SEARCH_TOOL, PROVIDE_SUGGESTIONS_TOOL],
      tool_choice: { type: "auto" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }
  const json = await res.json();
  const toolBlock = (json.content || []).find((b) => b.type === "tool_use" && b.name === "provide_suggestions");
  if (!toolBlock) {
    throw new Error(`Model did not finalize suggestions (stop_reason: ${json.stop_reason})`);
  }
  return validateGeneratedSuggestions(toolBlock.input);
}

module.exports = { planTrip, extractPreferences, chatAboutTrip, generateSuggestions, isAiConfigured, buildSystemPrompt, MODEL };
