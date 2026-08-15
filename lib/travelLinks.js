// lib/travelLinks.js
//
// Builds "deep links" into Google Flights, Skyscanner, Booking.com and
// Airbnb's own search results — pre-filled with route, destination and
// dates. No API key, no npm dependency, no scraping: these are the same
// URLs you'd get by using each site's own search box, so what a family
// member sees when they click through is always live, current pricing.
//
// This deliberately doesn't try to show prices *inside* the app — that
// needs a paid flights/hotels API (Skyscanner Partners, Amadeus, etc).
// One click out to a live search is the honest zero-cost version of
// "real hotel/flight data".

const LONDON_AIRPORT_GROUP = "LON"; // aggregates LHR/LGW/LTN/STN/LCY in Google Flights + Skyscanner

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Accepts a Date or 'YYYY-MM-DD' string, returns 'YYYY-MM-DD'. */
function toIsoDate(d) {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Skyscanner's path format wants YYMMDD. */
function toSkyscannerDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${y.slice(2)}${m}${d}`;
}

/**
 * Google Flights deep link. Uses the plain-language `q=` search form, which
 * Google Flights accepts and resolves the same as typing into its own box.
 */
function googleFlightsLink({ destinationName, departDate, returnDate }) {
  const dep = toIsoDate(departDate);
  const ret = toIsoDate(returnDate);
  let query = `Flights to ${destinationName} from London`;
  if (dep && ret) query += ` on ${dep} through ${ret}`;
  else if (dep) query += ` on ${dep}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`;
}

/** Skyscanner deep link — falls back to its "everywhere/flexible" form if no dates given. */
function skyscannerLink({ airportCode, departDate, returnDate }) {
  const dep = toSkyscannerDate(toIsoDate(departDate));
  const ret = toSkyscannerDate(toIsoDate(returnDate));
  const base = `https://www.skyscanner.net/transport/flights/${LONDON_AIRPORT_GROUP.toLowerCase()}/${airportCode.toLowerCase()}/`;
  if (dep && ret) return `${base}${dep}/${ret}/`;
  return base; // flexible-dates search
}

/** Booking.com search results, pre-filled with a place + check-in/out + "entire apartments". */
function bookingLink({ query, checkin, checkout, adults = 2 }) {
  const params = new URLSearchParams({
    ss: query,
    nflt: "privacy_type=3", // "entire homes & apartments" filter
    group_adults: String(adults),
  });
  const ci = toIsoDate(checkin);
  const co = toIsoDate(checkout);
  if (ci) params.set("checkin", ci);
  if (co) params.set("checkout", co);
  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}

/** Airbnb search results for a place, optionally with dates. */
function airbnbLink({ query, checkin, checkout }) {
  const params = new URLSearchParams({});
  const ci = toIsoDate(checkin);
  const co = toIsoDate(checkout);
  if (ci) params.set("checkin", ci);
  if (co) params.set("checkout", co);
  const qs = params.toString();
  return `https://www.airbnb.co.uk/s/${encodeURIComponent(query)}/homes${qs ? `?${qs}` : ""}`;
}

/**
 * Builds the full set of live-search links for a destination.
 * @param {object} destination - entry from data/destinations.js
 * @param {object} [dates] - { checkin, checkout } as Date or 'YYYY-MM-DD'
 */
function buildTravelLinks(destination, dates = {}) {
  const { checkin, checkout } = dates;
  const accommodationQuery = `${destination.name}, ${destination.country}`;
  return {
    flights: {
      googleFlights: googleFlightsLink({ destinationName: destination.name, departDate: checkin, returnDate: checkout }),
      skyscanner: skyscannerLink({ airportCode: destination.airportCode, departDate: checkin, returnDate: checkout }),
    },
    accommodation: {
      booking: bookingLink({ query: accommodationQuery, checkin, checkout }),
      airbnb: airbnbLink({ query: accommodationQuery, checkin, checkout }),
    },
  };
}

module.exports = { buildTravelLinks, googleFlightsLink, skyscannerLink, bookingLink, airbnbLink };
