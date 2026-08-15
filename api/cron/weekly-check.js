// GET /api/cron/weekly-check
// Designed to be hit by Vercel Cron (see vercel.json) roughly weekly.
// Finds any long weekend whose ~3-month planning window has just opened
// (within the last 7 days) and, if email is configured, sends a nudge with
// destination/budget/accommodation suggestions that respect the profile and
// exclude visited places.
//
// DORMANT BY DEFAULT — see the RESEND_TO check at the top of the handler.
// If RESEND_API_KEY isn't set (but RESEND_TO is), this still runs and
// returns what it *would* have sent, so you can test it via curl/browser
// without email configured.

const { sendJson } = require("../../lib/http.js");
const { fetchBankHolidayEvents, computeLongWeekends } = require("../../lib/bankHolidays.js");
const store = require("../../lib/store.js");
const destinations = require("../../data/destinations.js");
const { sendEmail, isEmailConfigured } = require("../../lib/email.js");

// Fixed, unscoped key for the rare case this runs while RESEND_TO *is* set:
// a scheduled job has no visitor session to key off, and per-visitor
// visited-places (lib/session.js) mean there's no single "the" list to
// exclude from the digest anymore anyway — this will just read empty.
const CRON_SCOPE = "cron-system";

function renderEmailHtml({ longWeekend, suggestions }) {
  const topPicks = suggestions.slice(0, 4);
  const picksHtml = topPicks
    .map(
      (d) => `
      <li style="margin-bottom:14px;">
        <strong>${d.name}, ${d.country}</strong> (${d.flightTimeFromLondon} flight, ${d.budgetTier})<br/>
        <span style="color:#555;">${d.whyProfile}</span><br/>
        <span style="color:#555;"><em>Stay:</em> ${d.accommodationNotes}</span>
      </li>`
    )
    .join("");

  return `
    <div style="font-family: -apple-system, Arial, sans-serif; max-width: 600px;">
      <h2>Time to plan your ${longWeekend.label} trip 🧳</h2>
      <p><strong>${longWeekend.startDate} → ${longWeekend.endDate}</strong> (${longWeekend.lengthDays} days) is about 3 months away —
      the sweet spot for booking flights and an aparthotel before prices climb.</p>
      <h3>Shortlist (already excludes places you've visited):</h3>
      <ul>${picksHtml}</ul>
      <p>Open the Trip Planner dashboard to see the full list, log a decision, or ask Claude to build the day-by-day itinerary.</p>
    </div>
  `;
}

module.exports = async function handler(req, res) {
  // Disabled for now. Anonymous per-visitor sessions (lib/session.js) mean
  // there's no longer a single coherent "visited list" or profile to
  // personalize this digest against — and building a real opt-in digest
  // (subscribe/unsubscribe tied to a session) would undercut the no-signup,
  // no-email design of the public beta. Gating on RESEND_TO keeps this
  // fully dormant rather than quietly emailing a stale, unpersonalized
  // shortlist. Don't set RESEND_TO until this is deliberately rebuilt as a
  // real opt-in feature.
  if (!process.env.RESEND_TO) {
    return sendJson(res, 200, { triggered: false, message: "Weekly digest is disabled (RESEND_TO not set)." });
  }

  // Optional hardening: if CRON_SECRET is set, only accept requests carrying
  // it (Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
  // when the env var exists). Left open if you haven't set one, so it's easy
  // to test locally with a plain curl/browser hit.
  if (process.env.CRON_SECRET) {
    const auth = req.headers?.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }
  }
  try {
    const events = await fetchBankHolidayEvents();
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const longWeekends = computeLongWeekends(events, todayUtc, 18);

    // A window "just opened" if it opened within the last 7 days (matches a
    // weekly cron cadence) and the trip itself hasn't happened yet.
    const justOpened = longWeekends.filter(
      (lw) => lw.daysUntilWindowOpens <= 0 && lw.daysUntilWindowOpens > -7 && lw.daysUntilTrip >= 0
    );

    if (justOpened.length === 0) {
      return sendJson(res, 200, { triggered: false, message: "No long weekend entered its 3-month window this week." });
    }

    const visited = await store.getVisitedPlaces(CRON_SCOPE);
    const suggestions = destinations.filter((d) => !store.isPlaceVisited(d, visited));

    const results = [];
    for (const longWeekend of justOpened) {
      const html = renderEmailHtml({ longWeekend, suggestions });
      let emailResult = { sent: false, reason: "email not configured" };
      if (isEmailConfigured()) {
        emailResult = await sendEmail({
          to: process.env.RESEND_TO,
          subject: `Plan your ${longWeekend.label} trip (${longWeekend.startDate})`,
          html,
        });
      }
      results.push({ longWeekend, emailResult });
    }

    sendJson(res, 200, { triggered: true, results });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
};
