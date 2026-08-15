// lib/bankHolidays.js
//
// Fetches official UK bank holiday data from gov.uk and turns it into a list
// of "long weekends" (any run of 3+ consecutive days that are all Saturday,
// Sunday, or a bank holiday), each annotated with the date its 3-month
// planning window opens.
//
// No npm dependencies: uses the built-in `fetch` (Node 18+).

const GOV_UK_BANK_HOLIDAYS_URL = "https://www.gov.uk/bank-holidays.json";
const DIVISION = "england-and-wales"; // Anjali is based in London

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PLANNING_WINDOW_DAYS = 90; // "prompt me ~3 months before"

function toDateOnly(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function isWeekend(date) {
  const day = date.getUTCDay(); // 0 = Sun, 6 = Sat
  return day === 0 || day === 6;
}

function fmt(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Fetch the raw gov.uk bank holidays payload.
 * Falls back to a bundled snapshot (data/bankHolidaysFallback.js) if the
 * network call fails, so the app degrades gracefully instead of 500-ing.
 */
async function fetchBankHolidayEvents() {
  try {
    const res = await fetch(GOV_UK_BANK_HOLIDAYS_URL, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`gov.uk responded ${res.status}`);
    const json = await res.json();
    const events = json?.[DIVISION]?.events;
    if (!Array.isArray(events) || events.length === 0) {
      throw new Error("Unexpected gov.uk payload shape");
    }
    return events; // [{ title, date: 'YYYY-MM-DD', notes, bunting }, ...]
  } catch (err) {
    const fallback = require("../data/bankHolidaysFallback.js");
    return fallback.events;
  }
}

/**
 * Turn a flat list of bank holiday events into long-weekend blocks.
 *
 * Algorithm: mark every date in the scan range as "off" if it's a Saturday,
 * Sunday, or a bank holiday. Any contiguous run of 3+ "off" days is a long
 * weekend. This naturally merges things like Good Friday + the weekend +
 * Easter Monday into one 4-day block, and Christmas Day/Boxing Day (when
 * they fall on/near a weekend) into an extended block, without special-casing
 * each holiday by name.
 *
 * @param {Array<{title:string, date:string}>} events
 * @param {Date} today - UTC date-only "today"
 * @param {number} monthsAhead - how far forward to scan
 */
function computeLongWeekends(events, today, monthsAhead = 18) {
  const holidayMap = new Map(); // 'YYYY-MM-DD' -> title
  for (const e of events) {
    holidayMap.set(e.date, e.title);
  }

  const start = toDateOnly(today);
  const end = addDays(start, Math.round(monthsAhead * 30.44));

  const blocks = [];
  let currentBlock = null;

  for (let d = start; d <= end; d = addDays(d, 1)) {
    const key = fmt(d);
    const holidayTitle = holidayMap.get(key);
    const off = isWeekend(d) || Boolean(holidayTitle);

    if (off) {
      if (!currentBlock) {
        currentBlock = { startDate: d, endDate: d, holidays: [] };
      } else {
        currentBlock.endDate = d;
      }
      if (holidayTitle) currentBlock.holidays.push({ date: key, title: holidayTitle });
    } else if (currentBlock) {
      blocks.push(currentBlock);
      currentBlock = null;
    }
  }
  if (currentBlock) blocks.push(currentBlock);

  // Only keep blocks that are 3+ days AND actually contain a bank holiday
  // (plain weekends aren't "long weekends" on their own).
  const longWeekends = blocks
    .filter((b) => {
      const lengthDays = Math.round((b.endDate - b.startDate) / MS_PER_DAY) + 1;
      return lengthDays >= 3 && b.holidays.length > 0;
    })
    .map((b) => {
      const lengthDays = Math.round((b.endDate - b.startDate) / MS_PER_DAY) + 1;
      const planningWindowOpens = addDays(b.startDate, -PLANNING_WINDOW_DAYS);
      const daysUntilTrip = Math.round((b.startDate - start) / MS_PER_DAY);
      const daysUntilWindowOpens = Math.round((planningWindowOpens - start) / MS_PER_DAY);
      return {
        label: b.holidays.map((h) => h.title).join(" + "),
        startDate: fmt(b.startDate),
        endDate: fmt(b.endDate),
        lengthDays,
        holidays: b.holidays,
        planningWindowOpens: fmt(planningWindowOpens),
        daysUntilTrip,
        daysUntilWindowOpens,
        // "hot" = we're inside the ~3 month window right now and haven't left yet
        windowIsOpenNow: daysUntilWindowOpens <= 0 && daysUntilTrip >= 0,
      };
    });

  return longWeekends;
}

module.exports = {
  fetchBankHolidayEvents,
  computeLongWeekends,
  PLANNING_WINDOW_DAYS,
  DIVISION,
};
