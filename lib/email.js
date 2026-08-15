// lib/email.js — sends email via Resend's plain REST API (no SDK needed).
// Set RESEND_API_KEY and RESEND_FROM (e.g. "Tripsy <planner@yourdomain.com>")
// as env vars, plus a recipient per feature (RESEND_TO for the weekly cron
// digest, FEEDBACK_TO for the feedback button — see api/feedback.js) — kept
// separate so configuring one doesn't silently switch the other on. If
// unset, callers should treat sendEmail as a no-op / log-only fallback.

function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

async function sendEmail({ to, subject, html, text }) {
  if (!isEmailConfigured()) {
    return { sent: false, reason: "RESEND_API_KEY / RESEND_FROM not configured" };
  }
  if (!to) {
    return { sent: false, reason: "no recipient configured" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [to],
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
  return { sent: true };
}

module.exports = { sendEmail, isEmailConfigured };
