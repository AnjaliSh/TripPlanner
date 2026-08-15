// data/bankHolidaysFallback.js
//
// Snapshot of England & Wales bank holidays, sourced from gov.uk/bank-holidays
// on 2026-08-11. Used only if the live gov.uk fetch fails. Update this list
// (or just let the live fetch take over) once gov.uk publishes 2028 dates.

module.exports = {
  fetchedAt: "2026-08-11",
  source: "https://www.gov.uk/bank-holidays.json",
  events: [
    { title: "New Year's Day", date: "2026-01-01", notes: "", bunting: true },
    { title: "Good Friday", date: "2026-04-03", notes: "", bunting: false },
    { title: "Easter Monday", date: "2026-04-06", notes: "", bunting: true },
    { title: "Early May bank holiday", date: "2026-05-04", notes: "", bunting: true },
    { title: "Spring bank holiday", date: "2026-05-25", notes: "", bunting: true },
    { title: "Summer bank holiday", date: "2026-08-31", notes: "", bunting: true },
    { title: "Christmas Day", date: "2026-12-25", notes: "", bunting: true },
    { title: "Boxing Day", date: "2026-12-28", notes: "Substitute day", bunting: true },
    { title: "New Year's Day", date: "2027-01-01", notes: "", bunting: true },
    { title: "Good Friday", date: "2027-03-26", notes: "", bunting: false },
    { title: "Easter Monday", date: "2027-03-29", notes: "", bunting: true },
    { title: "Early May bank holiday", date: "2027-05-03", notes: "", bunting: true },
    { title: "Spring bank holiday", date: "2027-05-31", notes: "", bunting: true },
    { title: "Summer bank holiday", date: "2027-08-30", notes: "", bunting: true },
    { title: "Christmas Day", date: "2027-12-27", notes: "Substitute day", bunting: true },
    { title: "Boxing Day", date: "2027-12-28", notes: "Substitute day", bunting: true },
  ],
};
