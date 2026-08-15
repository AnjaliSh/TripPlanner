// GET /api/long-weekends
// Returns upcoming UK (England & Wales) long weekends with countdowns to
// when each one's ~3-month planning window opens.

const { sendJson } = require("../lib/http.js");
const { fetchBankHolidayEvents, computeLongWeekends } = require("../lib/bankHolidays.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  try {
    const events = await fetchBankHolidayEvents();
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const longWeekends = computeLongWeekends(events, todayUtc, 18);
    sendJson(res, 200, { today: todayUtc.toISOString().slice(0, 10), longWeekends });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
};
