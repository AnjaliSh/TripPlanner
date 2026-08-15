// lib/places.js
//
// Live accommodation search via the Google Places API (Text Search, New).
// Set GOOGLE_MAPS_API_KEY to enable — free tier ($200/mo credit) comfortably
// covers personal use. Without a key, isPlacesConfigured() is false and
// api/accommodations.js falls back to the curated notes + Booking/Airbnb
// deep links from lib/travelLinks.js, same graceful-degradation pattern
// used for bank holidays (lib/bankHolidays.js) and email (lib/email.js).

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_PHOTO_URL = "https://places.googleapis.com/v1/";

function isPlacesConfigured() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

/**
 * Search for aparthotel / serviced-apartment style stays near a destination.
 * Returns a small, normalized list — real names, ratings, an address, a
 * Google Maps link, and (if available) a photo URL.
 *
 * @param {object} destination - entry from data/destinations.js
 * @param {number} [maxResults]
 */
async function searchAccommodation(destination, maxResults = 6) {
  if (!isPlacesConfigured()) {
    throw new Error("GOOGLE_MAPS_API_KEY not configured");
  }

  const textQuery = `aparthotel OR serviced apartment with kitchen in ${destination.region || destination.name}, ${destination.country}`;

  const res = await fetch(PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY,
      // FieldMask keeps this call cheap — only ask for what the UI uses.
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.rating",
        "places.userRatingCount",
        "places.googleMapsUri",
        "places.photos",
        "places.priceLevel",
      ].join(","),
    },
    body: JSON.stringify({
      textQuery,
      maxResultCount: maxResults,
      locationBias: destination.coordinates
        ? {
            circle: {
              center: { latitude: destination.coordinates.lat, longitude: destination.coordinates.lng },
              radius: 15000,
            },
          }
        : undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Places API error ${res.status}: ${body}`);
  }

  const json = await res.json();
  const places = json.places || [];

  return places.map((p) => ({
    id: p.id,
    name: p.displayName?.text || "Unnamed property",
    address: p.formattedAddress || "",
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? 0,
    priceLevel: p.priceLevel || null,
    mapsUrl: p.googleMapsUri || null,
    photoUrl: buildPhotoUrl(p.photos?.[0]?.name),
  }));
}

/** Turns a Places photo resource name into a fetchable image URL (max 640px wide). */
function buildPhotoUrl(photoName) {
  if (!photoName || !process.env.GOOGLE_MAPS_API_KEY) return null;
  return `${PLACES_PHOTO_URL}${photoName}/media?maxWidthPx=640&key=${process.env.GOOGLE_MAPS_API_KEY}`;
}

module.exports = { isPlacesConfigured, searchAccommodation };
