// POST /api/feedback { message, page? } -> { received: true, emailed: boolean }
//
// Feedback button in the header (public/app.js). Always logged server-side
// (visible in Vercel's function logs) so nothing is lost even if email
// isn't configured; also emailed via lib/email.js when FEEDBACK_TO is set.
// Deliberately a separate env var from RESEND_TO (used by the dormant
// weekly cron digest, see api/cron/weekly-check.js) so configuring one
// doesn't silently switch the other on.

const { sendJson, readJsonBody } = require("../lib/http.js");
const { sendEmail, isEmailConfigured } = require("../lib/email.js");
const { resolveSession } = require("../lib/session.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  const sessionId = resolveSession(req, res);
  const body = await readJsonBody(req);
  const message = (body.message || "").trim();
  if (!message) {
    return sendJson(res, 400, { error: "message is required" });
  }
  const page = (body.page || "").trim();

  console.log(`[bagsy] feedback from session ${sessionId.slice(0, 8)}… (page: ${page || "unknown"}): ${message}`);

  let emailed = false;
  if (isEmailConfigured() && process.env.FEEDBACK_TO) {
    try {
      const result = await sendEmail({
        to: process.env.FEEDBACK_TO,
        subject: "Bagsy beta feedback",
        text: `From session: ${sessionId}\nPage: ${page || "unknown"}\n\n${message}`,
        html: `<p><strong>From session:</strong> ${sessionId}</p><p><strong>Page:</strong> ${page || "unknown"}</p><p>${message.replace(/\n/g, "<br>")}</p>`,
      });
      emailed = result.sent;
    } catch (err) {
      console.warn("[bagsy] feedback email failed:", err.message);
    }
  }

  sendJson(res, 200, { received: true, emailed });
};
