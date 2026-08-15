// data/emptyProfile.js
//
// Default travel profile a brand-new anonymous session is seeded with. Kept
// structurally identical to the profile shape the rest of the app expects
// (same section ids/titles, so addProfilePoint/removeProfilePoint and the
// AI prompts in lib/ai.js keep working) but with no points — every visitor
// builds their own from an empty slate instead of inheriting anyone else's
// preferences.

module.exports = {
  travelers: "",
  home: "",
  onboarded: false,
  sections: [
    { id: "pace", title: "Pace, Atmosphere & Travel Philosophy", points: [] },
    { id: "accommodation", title: "Accommodation", points: [] },
    { id: "food", title: "Food & Dietary", points: [] },
    { id: "logistics", title: "Flights, Airport & Transit Logistics", points: [] },
  ],
};
