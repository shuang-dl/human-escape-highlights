// Build the standalone weekly report (a full HTML document) and the matching
// index.json entry, from the aggregated data.

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function pct(x) { return `${Math.round(x * 100)}%`; }

function sentimentPill(sentiments) {
  // Dominant sentiment becomes the pill label/color.
  const entries = Object.entries(sentiments).filter(([k]) => k !== "Unknown");
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0] && entries[0][1] > 0 ? entries[0][0] : "Mixed";
  const cls = top === "Negative" ? "s-neg" : top === "Positive" ? "s-pos" : top === "Neutral" ? "s-neu" : "s-mix";
  return `<span class="pill ${cls}">${esc(top)}</span>`;
}

function issueCard(issue, rank) {
  const subs = issue.subcats.map((s) => `<li><b>${esc(s.name)}</b> — ${s.count}</li>`).join("\n          ");
  const quotes = issue.examples.map((e) =>
    `<li>"${esc(e.quote)}" <span>(${esc(e.sentiment)})</span></li>`).join("\n          ");
  return `
    <div class="issue">
      <div class="issue-top">
        <div class="rank">${rank}</div>
        <div class="issue-title">
          <h3>${esc(issue.topic)}</h3>
          <div class="sub">Grouped from Intercom's AI category fields</div>
        </div>
        <div class="stats"><span class="big">${issue.count}</span>escalations · ${pct(issue.share)} of all<br>${sentimentPill(issue.sentiments)}</div>
      </div>
      <div class="breakdown">
        <div class="col">
          <h4>Sub-categories in this topic</h4>
          <ul>
          ${subs || "<li>—</li>"}
          </ul>
        </div>
        <div class="col quotes">
          <h4>Example escalations (customer's opening message)</h4>
          <ul>
          ${quotes || "<li>—</li>"}
          </ul>
        </div>
      </div>
    </div>`;
}

const STYLE = `
  :root{--navy:#0b1f3a;--blue:#1f6feb;--blue-soft:#eaf1fe;--ink:#1a2230;--muted:#5b6675;--line:#e3e8ef;--bg:#f6f8fb;--green:#1f9d6b;--amber:#c98a00;--red:#d64545;--card:#fff;}
  *{box-sizing:border-box;} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.45;font-size:14px;}
  .page{max-width:1040px;margin:0 auto;padding:26px 28px 40px;}
  header.r{border-left:6px solid var(--blue);padding:4px 0 4px 16px;margin-bottom:16px;}
  header.r .eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:700;color:var(--blue);margin:0 0 4px;}
  header.r h1{font-size:22px;margin:0 0 6px;color:var(--navy);}
  header.r .meta{font-size:12.5px;color:var(--muted);}
  .metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:18px 0 14px;}
  .metric{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:11px 12px;}
  .metric .val{font-size:19px;font-weight:700;color:var(--navy);} .metric.flag .val{color:var(--blue);}
  .metric .lbl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin-top:3px;}
  .share{font-size:13px;color:var(--muted);margin:0 0 6px;} .share b{color:var(--ink);}
  h2.section{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);border-bottom:2px solid var(--line);padding-bottom:6px;margin:24px 0 14px;}
  .issue{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px 17px;margin-bottom:13px;}
  .issue-top{display:flex;align-items:flex-start;gap:12px;margin-bottom:8px;}
  .rank{flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:var(--navy);color:#fff;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;}
  .issue-title{flex:1 1 auto;} .issue-title h3{margin:0;font-size:16px;color:var(--navy);} .issue-title .sub{font-size:11.5px;color:var(--muted);margin-top:2px;}
  .stats{flex:0 0 auto;text-align:right;font-size:11.5px;color:var(--muted);white-space:nowrap;} .stats .big{font-size:18px;font-weight:700;color:var(--ink);display:block;}
  .pill{display:inline-block;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:999px;margin-top:4px;}
  .pill.s-neg{background:#fbe6e6;color:var(--red);} .pill.s-pos{background:#e7f6ef;color:var(--green);} .pill.s-neu{background:#eef1f5;color:var(--muted);} .pill.s-mix{background:#fbf2dc;color:var(--amber);}
  .breakdown{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:6px;}
  .breakdown h4{margin:0 0 5px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--blue);}
  .breakdown ul{margin:0;padding-left:16px;} .breakdown li{margin-bottom:4px;font-size:12.5px;}
  .quotes li{color:var(--muted);font-style:italic;} .quotes li span{font-style:normal;color:#9aa3b0;}
  footer.notes{margin-top:22px;border-top:1px solid var(--line);padding-top:12px;font-size:11px;color:var(--muted);}
  footer.notes b{color:var(--ink);} footer.notes ul{margin:6px 0 0;padding-left:16px;} footer.notes li{margin-bottom:3px;}
  @media print{body{background:#fff;} .page{max-width:none;padding:0;} .issue,.metric{break-inside:avoid;}}
`;

export function buildReport(agg, range, now = new Date()) {
  const s = agg.sentimentTotals;
  const fileName = `${range.fileStem}.html`;
  const generatedOn = now.toISOString().slice(0, 10);

  const issuesHtml = agg.topIssues.map((it, i) => issueCard(it, i + 1)).join("\n");

  const fullTopicList = agg.allTopics
    .map((t) => `${esc(t.topic)} ${t.count}`)
    .join(" · ");

  const skippedNote = agg.skippedHigherVolume.length
    ? `Higher-volume topics excluded as by-design handoffs / non-actionable: ${
        agg.skippedHigherVolume.map((t) => `${esc(t.topic)} (${t.count})`).join(", ")}.`
    : `No higher-volume by-design handoffs were excluded this week.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Weekly Support AI Insights — ${esc(range.label)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="page">
  <header class="r">
    <p class="eyebrow">Weekly Support AI Insights · Human-Escape Loop</p>
    <h1>Top UI Issues Driving Fin Failures &amp; Human Escalations</h1>
    <div class="meta">Reporting week: <b>${esc(range.label)}</b> · Generated ${esc(generatedOn)} · Prepared for Product / R&amp;D ·
      Source: <b>Intercom API</b> (Search Conversations; Fin resolution state = Escalated, user-initiated)</div>
  </header>

  <div class="metrics">
    <div class="metric flag"><div class="val">${agg.totalEscalated}</div><div class="lbl">Escalated to a human</div></div>
    <div class="metric"><div class="val">${agg.topicsFound}</div><div class="lbl">Distinct topics</div></div>
    <div class="metric"><div class="val">${pct(agg.top3Share)}</div><div class="lbl">Top 3 share</div></div>
    <div class="metric"><div class="val">${s.Negative}</div><div class="lbl">Negative sentiment</div></div>
    <div class="metric"><div class="val">${s.Neutral}</div><div class="lbl">Neutral</div></div>
    <div class="metric"><div class="val">${s.Positive}</div><div class="lbl">Positive</div></div>
  </div>
  <p class="share">The top 3 fixable issues below account for <b>${agg.top3Count} of ${agg.totalEscalated} escalations (${pct(agg.top3Share)})</b>.</p>

  <h2 class="section">Top 3 fixable issues this week</h2>
  ${issuesHtml || "<p>No escalations found for this week.</p>"}

  <footer class="notes">
    <b>How this was built &amp; caveats</b>
    <ul>
      <li><b>Source &amp; scope:</b> Intercom API → Search Conversations, created ${esc(range.startISO)} to ${esc(range.endISO)}, restricted to user-initiated conversations where Fin's resolution state is <b>Escalated</b>.</li>
      <li><b>Topics</b> are grouped from Intercom's own AI category fields (Accounting Categories → Category Detection → Conversation Intent), so counts are <b>directional</b>, not exact root-cause tallies. CX Score is a paid-analytics metric not available via the API, so sentiment is shown instead.</li>
      <li><b>"Fixable issue" framing:</b> the top 3 exclude by-design handoffs and non-actionable buckets. ${skippedNote}</li>
      <li><b>All topics this week:</b> ${fullTopicList || "—"}.</li>
    </ul>
  </footer>
</div>
</body>
</html>`;

  const top = agg.topIssues[0];
  const entry = {
    id: range.id,
    weekLabel: range.label,
    dateRange: { start: range.startISO, end: range.endISO },
    generatedOn,
    file: `reports/${fileName}`,
    totalEscalated: agg.totalEscalated,
    headline: top
      ? `${agg.totalEscalated} escalations to a human · top issue: ${top.topic} (${top.count})`
      : `${agg.totalEscalated} escalations to a human`,
    chips: agg.topIssues.map((t) => `${t.topic} ${t.count}`)
  };

  return { html, entry, fileName };
}
