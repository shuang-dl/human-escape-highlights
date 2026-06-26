// Work out the "previous completed work week" (Monday–Friday) relative to `now`.
// Dates are computed in the server's local timezone (set TZ in the Dockerfile),
// so the boundaries line up with how the support team thinks about a work week.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// "Jun 15 – 19, 2026" or "Jun 29 – Jul 3, 2026"
function formatLabel(mon, fri) {
  const m1 = MONTHS[mon.getMonth()], m2 = MONTHS[fri.getMonth()];
  if (mon.getMonth() === fri.getMonth()) {
    return `${m1} ${mon.getDate()} – ${fri.getDate()}, ${fri.getFullYear()}`;
  }
  return `${m1} ${mon.getDate()} – ${m2} ${fri.getDate()}, ${fri.getFullYear()}`;
}

export function previousWorkWeek(now = new Date()) {
  // Walk back from yesterday to the most recent Friday — that's the last
  // fully-completed work week (so running on Monday reports the prior Mon–Fri,
  // and running mid-week still reports the previous, complete week).
  const fri = new Date(now);
  fri.setHours(0, 0, 0, 0);
  fri.setDate(fri.getDate() - 1);
  while (fri.getDay() !== 5) {          // 5 = Friday
    fri.setDate(fri.getDate() - 1);
  }
  const mon = new Date(fri);
  mon.setDate(mon.getDate() - 4);       // Monday of that week

  const start = new Date(mon); start.setHours(0, 0, 0, 0);
  const end   = new Date(fri); end.setHours(23, 59, 59, 999);

  return {
    startUnix: Math.floor(start.getTime() / 1000),
    endUnix:   Math.floor(end.getTime() / 1000),
    startISO:  ymd(mon),
    endISO:    ymd(fri),
    label:     formatLabel(mon, fri),
    // e.g. rpt-2026-06-15-19  (used as a stable id + filename stem)
    id:        `rpt-${ymd(mon)}-${pad(fri.getDate())}`,
    fileStem:  `weekly-support-ai-insights-${MONTHS[mon.getMonth()].toLowerCase()}${mon.getDate()}-${fri.getDate()}-${fri.getFullYear()}`
  };
}
