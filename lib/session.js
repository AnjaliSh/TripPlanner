// lib/session.js
//
// Anonymous per-visitor identity for the public beta. No login, no email —
// on first request we mint a random session ID, HMAC-sign it (Node's
// built-in `crypto`, same zero-dependency approach the rest of this repo
// uses) so it can't be forged into someone else's data, and hand it back as
// an HttpOnly cookie. Every later request carries that cookie and resolves
// back to the same ID, which lib/store.js uses to scope a visitor's own
// profile and visited-places list.

const crypto = require("crypto");

const COOKIE_NAME = "tripsy_sid";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year
const INSECURE_DEV_SECRET = "dev-insecure-session-secret-change-me";

let warnedMissingSecret = false;

function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn(
      "[tripsy] SESSION_SECRET is not set — signing visitor session cookies with an " +
        "insecure default. Fine for local dev, but set a real SESSION_SECRET before " +
        "deploying publicly, or anyone can forge another visitor's session id."
    );
  }
  return INSECURE_DEV_SECRET;
}

function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    jar[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return jar;
}

function mintSignedCookie() {
  const id = crypto.randomBytes(18).toString("base64url");
  return { id, cookieValue: `${id}.${sign(id)}` };
}

/** Verifies a cookie's signature and returns the session id, or null if missing/tampered. */
function verifySignedCookie(cookieValue) {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot === -1) return null;
  const id = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  const expected = sign(id);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

/**
 * Reads the visitor's session cookie, verifying its signature. If it's
 * missing or invalid (tampered, or signed under a rotated secret), mints a
 * fresh one and sets it on the response. Returns the session id — safe to
 * use directly as a storage key, since it's random and never sent unsigned.
 */
function resolveSession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = verifySignedCookie(cookies[COOKIE_NAME]);
  if (existing) return existing;

  const { id, cookieValue } = mintSignedCookie();
  const isProd = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  const attrs = [`${COOKIE_NAME}=${cookieValue}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE_SECONDS}`];
  if (isProd) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
  return id;
}

module.exports = { resolveSession };
