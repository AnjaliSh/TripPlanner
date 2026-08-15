// lib/wikiImage.js
//
// Pulls a real photo of each destination's landmark from Wikipedia's public
// MediaWiki Action API (no key, no npm package — just fetch()). We keep a
// curated `landmarkQuery` per destination (the Wikipedia article title) in
// data/destinations.js rather than guessing city names, since "most famous
// place" needs a human call, not a heuristic.

const API_URL = "https://en.wikipedia.org/w/api.php";

// Landmark photos barely ever change, but the static suggestions list re-runs
// this lookup for all ~10 destinations on every single page load (no
// per-session cache like the AI path has). Under bursty traffic — several
// testers/visitors loading the page around the same time — that's enough
// parallel requests to trip Wikimedia's anti-abuse rate limit (HTTP 429),
// which silently blanks out every card's photo at once since a failed fetch
// is treated as "no image" by design. A short in-memory cache turns repeat
// page loads into zero Wikipedia requests instead of ~10, which is both
// cheaper and avoids re-triggering the exact rate limit that caused this.
const imageCache = new Map(); // pageTitle -> { value, expiresAt }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCached(pageTitle) {
  const entry = imageCache.get(pageTitle);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    imageCache.delete(pageTitle);
    return undefined;
  }
  return entry.value;
}

function setCached(pageTitle, value) {
  imageCache.set(pageTitle, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * @param {string} pageTitle - e.g. "Dom Luís I Bridge"
 * @returns {Promise<{ imageUrl: string, pageUrl: string } | null>}
 */
async function getLandmarkImage(pageTitle) {
  if (!pageTitle) return null;
  const cached = getCached(pageTitle);
  if (cached !== undefined) return cached;
  try {
    // We used to hit the REST "page/summary" endpoint and hand-rewrite its
    // thumbnail URL's width segment to upsize it (e.g. "/330px-" -> "/800px-").
    // That silently broke every card: Wikimedia's image scaler only serves a
    // per-file allow-list of widths that some real wiki page already rendered
    // at (anti-hotlinking-abuse measure) and 400s on anything else, so an
    // arbitrary guessed width like 800 works for some files and not others.
    // The Action API's `pithumbsize` is a real request param MediaWiki
    // resolves server-side to a width it has actually generated/allowed, so
    // the URL it hands back is guaranteed loadable.
    const params = new URLSearchParams({
      action: "query",
      titles: pageTitle,
      prop: "pageimages|info",
      inprop: "url",
      pithumbsize: "800",
      format: "json",
      formatversion: "2",
    });
    const res = await fetch(`${API_URL}?${params}`, {
      headers: { "User-Agent": "family-trip-planner (personal project)" },
    });
    if (!res.ok) return null; // don't cache — e.g. a transient 429, worth retrying next load
    const json = await res.json();
    const page = json.query?.pages?.[0];
    const source = page?.thumbnail?.source;
    if (!source) return null;
    const result = { imageUrl: source, pageUrl: page.canonicalurl || null };
    setCached(pageTitle, result);
    return result;
  } catch (err) {
    return null; // image is decorative — never let a failed fetch break the page
  }
}

/** Fetches images for several titles in parallel, tolerating individual failures. */
async function getLandmarkImages(pageTitles) {
  const results = await Promise.all(pageTitles.map((t) => getLandmarkImage(t)));
  return Object.fromEntries(pageTitles.map((t, i) => [t, results[i]]));
}

// Wikipedia articles reference plenty of non-photo images alongside real
// photos — flags, locator maps, the Commons logo, tiny UI icons. There's no
// clean API flag for "this is a photo", so this is a best-effort heuristic
// (same "decorative, never breaks the page on failure" spirit as the hero
// image above): drop anything that's an SVG (covers nearly all icons/flags/
// diagrams on Wikipedia), drop filenames that name themselves as one of
// those things, and require a minimum resolution to catch what slips
// through (a real landmark photo is never 261×347).
const GALLERY_EXCLUDE_PATTERN = /logo|icon|flag|locator|coat.?of.?arms|\bsymbol\b|\bmap\b/i;
const GALLERY_MIN_WIDTH = 400;
const GALLERY_MIN_HEIGHT = 300;

/**
 * @param {string} pageTitle
 * @param {object} [opts]
 * @param {number} [opts.limit] - max photos to return
 * @returns {Promise<Array<{ url: string, caption: string }>>}
 */
async function getLandmarkGallery(pageTitle, { limit = 8 } = {}) {
  if (!pageTitle) return [];
  try {
    const params = new URLSearchParams({
      action: "query",
      titles: pageTitle,
      generator: "images",
      gimlimit: "40",
      prop: "imageinfo",
      iiprop: "url|size",
      iiurlwidth: "700",
      format: "json",
      formatversion: "2",
    });
    const res = await fetch(`${API_URL}?${params}`, {
      headers: { "User-Agent": "family-trip-planner (personal project)" },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const pages = json.query?.pages || [];
    return pages
      .filter((p) => {
        if (/\.svg$/i.test(p.title)) return false;
        if (GALLERY_EXCLUDE_PATTERN.test(p.title)) return false;
        const info = p.imageinfo?.[0];
        if (!info || !info.thumburl) return false;
        return (info.width || 0) >= GALLERY_MIN_WIDTH && (info.height || 0) >= GALLERY_MIN_HEIGHT;
      })
      .map((p) => ({
        url: p.imageinfo[0].thumburl,
        caption: p.title.replace(/^File:/, "").replace(/\.[a-zA-Z]+$/, "").replace(/_/g, " "),
      }))
      .slice(0, limit);
  } catch (err) {
    return []; // gallery is decorative — never let a failed fetch break the page
  }
}

module.exports = { getLandmarkImage, getLandmarkImages, getLandmarkGallery };
