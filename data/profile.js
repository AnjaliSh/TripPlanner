// data/profile.js
//
// Anjali's family travel profile. Shown on the Profile page, and fed into
// the AI itinerary prompt so every suggestion respects it automatically.
// Edit this file any time your preferences change.

module.exports = {
  travelers: "2 adults + young kids/toddlers",
  home: "London, UK",
  sections: [
    {
      id: "pace",
      title: "Pace, Atmosphere & Travel Philosophy",
      points: [
        "Kid happiness & a welcoming atmosphere first — warm, patient, family-friendly locals matter more than ticking off sights (Bilbao is the benchmark).",
        "Low-stress pace: a full day at the beach, a park, or a playground beats a packed sightseeing day.",
        "Max 1-2 planned sights per day, with large buffers for toddler pacing, food stops, diaper changes, and tantrums.",
        "Pair one iconic sight with immediate kid fun nearby (playground, plaza, gelato, a quick grocery run for picnic supplies).",
        "In historic cities, frame sights around big visual stories (gods, monsters, heroes) or interactive/LEGO-style exhibits that hook a 3-year-old.",
      ],
    },
    {
      id: "accommodation",
      title: "Accommodation",
      points: [
        "Strongly prefer aparthotels / serviced apartments (Limehome-style) over standard hotel rooms.",
        "Need a full kitchen/kitchenette and a separate living area — essential for toddler meals and naps without hiding in a dark bedroom.",
        "Ground-floor or lift access required for the stroller.",
      ],
    },
    {
      id: "food",
      title: "Food & Dietary",
      points: [
        "Wife is vegetarian and dislikes mushrooms — avoid mushroom-only veg options; look for genuinely varied vegetarian menus.",
        "Prioritise warm, staff-friendly local spots; keep a reliable Mexican/Italian backup for when traditional local spots are veg-light.",
        "Love specialty-coffee brunch cafes with strong vegetarian options.",
        "Always flag quick familiar kid snacks (chicken fries, bakery pastries) for emergency toddler fuel.",
        "Casual, low-effort, delivery-friendly evenings are welcome, including good local Indian delivery.",
        "Enjoy local wines and drinks (Txakoli, Naxian wine, lime radlers) and casual grab-and-go options for outdoor days.",
      ],
    },
    {
      id: "logistics",
      title: "Flights, Airport & Transit Logistics",
      points: [
        "Prefer driving to the airport and using long-stay parking over public transport, to avoid managing sleeping kids/luggage/car seats on transit.",
        "Always note stroller gate-check return point (aircraft door vs baggage carousel) and suggest compact cabin-approved strollers/carriers.",
        "Flag Priority Pass lounge eligibility and strict check-in/bag-drop windows (e.g. Wizz Air's 2-hour cutoff).",
        "For island trips, prefer large conventional ferries (e.g. Blue Star Ferries) over small high-speed catamarans, for space to move/nap.",
        "At the destination, love good stroller-accessible public transport (trams, metro, walkable plazas).",
      ],
    },
  ],
};
