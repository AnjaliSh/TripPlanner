// lib/matchScore.js
//
// A transparent, honest alternative to a fabricated "98% match" figure.
// Each destination in data/destinations.js was already hand-picked to fit
// the family's travel profile — so this doesn't re-decide whether a place
// belongs in the list, it surfaces *which specific criteria* it clears,
// based on keywords actually present in the curated notes. "5/6 criteria
// met, here's which ones" is something you can sanity-check by reading the
// same notes; an invented percentage isn't.

const CRITERIA = [
  {
    id: "accommodation",
    label: "Aparthotel / kitchen stock",
    test: (d) => /aparthotel|serviced apartment|kitchen/i.test(d.accommodationNotes || ""),
  },
  {
    id: "vegFood",
    label: "Strong vegetarian food",
    test: (d) => {
      const text = d.vegFoodNotes || "";
      if (/meat[/-]fish-heavy|meat-heavy|lean seafood\/meat|harder to find|limited veg/i.test(text)) return false;
      return /strong|genuinely|excellent|great fit|easiest|growing|reliable|friendly/i.test(text);
    },
  },
  {
    id: "kidPacing",
    label: "Kid-paced activities nearby",
    test: (d) => /playground|beach|park|stroller|gelato|kid-friendly/i.test(d.kidNotes || ""),
  },
  {
    id: "flightTime",
    label: "Under ~3h flight",
    test: (d) => {
      const match = (d.flightTimeFromLondon || "").match(/(\d+)h(\d{1,2})?/);
      if (!match) return false;
      const hours = Number(match[1]) + (match[2] ? Number(match[2]) / 60 : 0);
      return hours <= 3;
    },
  },
  {
    id: "budget",
    label: "Budget-friendly (£/££)",
    test: (d) => d.budgetTier === "£" || d.budgetTier === "££",
  },
  {
    id: "atmosphere",
    label: "Warm, welcoming vibe",
    test: (d) => /warm|welcoming|friendly|patient|relaxed|low-key|unhurried|gentle|toddler-pace|slow[ -]pace|easy pace/i.test(d.whyProfile || ""),
  },
];

/** @param {object} destination - entry from data/destinations.js */
function scoreDestination(destination) {
  const matched = [];
  const unmatched = [];
  for (const c of CRITERIA) {
    (c.test(destination) ? matched : unmatched).push(c.label);
  }
  return { score: matched.length, total: CRITERIA.length, matched, unmatched };
}

module.exports = { scoreDestination, CRITERIA };
