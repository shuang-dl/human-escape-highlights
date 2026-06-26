// Offline self-test: exercises the date logic, aggregation, and report builder on
// representative mock conversations (no network / no token needed).
//   node server/selftest.js

import assert from "node:assert";
import fs from "node:fs";
import { previousWorkWeek } from "./week.js";
import { aggregate } from "./aggregate.js";
import { buildReport } from "./report.js";
import { isEscalated } from "./intercom.js";

function conv({ body, accountingCat, category, intent, sentiment, title, escalated = true, authorType = "user" }) {
  return {
    source: { body, author: { type: authorType } },
    ai_agent: { resolution_state: escalated ? "escalated" : "confirmed_resolved" },
    custom_attributes: {
      "Accounting Categories": accountingCat,
      "Category Detection": category,
      "Conversation Intent": intent,
      "Sentiment Detection": sentiment,
      "AI Title": title,
      "Fin AI Agent resolution state": escalated ? "Escalated" : "Confirmed resolved"
    }
  };
}

const convos = [
  conv({ body: "<p>Why is only $885 in my bank when the tenant paid $1,250?</p>", accountingCat: "Deposits & Payouts", sentiment: "Negative Sentiment", title: "Missing payout" }),
  conv({ body: "Where is the money that shows deposited but isn't in my bank?", accountingCat: "Deposits & Payouts", sentiment: "Negative Sentiment", title: "Payout" }),
  conv({ body: "Deposit shows uncleared on reconciliation but not in bank txns.", accountingCat: "Deposits & Payouts", sentiment: "Neutral Sentiment", title: "Reconciliation" }),
  conv({ body: "Re-linking my merchant account keeps failing verification.", accountingCat: "Merchant Account & Stripe", intent: "Setup & Feature Activation", sentiment: "Negative Sentiment", title: "Merchant re-link" }),
  conv({ body: "Stripe says verification incomplete though my account is active.", accountingCat: "Merchant Account & Stripe", sentiment: "Negative Sentiment", title: "Verification loop" }),
  conv({ body: "No save button when finishing my lease template.", category: "Leasing", intent: "Lease Setup", sentiment: "Neutral Sentiment", title: "Lease template" }),
  conv({ body: "Tenant can't see the signature field on the renewal lease.", category: "Leasing", intent: "Lease Renewal", sentiment: "Negative Sentiment", title: "E-sign" }),
  conv({ body: "Dates conflict error when renewing my lease.", category: "Leasing", intent: "Lease Renewal", sentiment: "Neutral Sentiment", title: "Renewal error" }),
  conv({ body: "I want to cancel my subscription effective today.", category: "Subscription cancellation", intent: "Cancellation", sentiment: "Negative Sentiment", title: "Cancel" }),
  conv({ body: "Please cancel my plan before renewal.", category: "Subscription cancellation", intent: "Cancellation", sentiment: "Negative Sentiment", title: "Cancel 2" }),
  conv({ body: "Talk to a person", category: "Unknown", sentiment: "Neutral Sentiment", title: "Payment Status" }),
  // A non-escalated + a non-user one that must be filterable out upstream:
  conv({ body: "resolved already", accountingCat: "Deposits & Payouts", sentiment: "Positive Sentiment", title: "x", escalated: false })
];

// --- isEscalated filter ---
assert.equal(isEscalated(convos[0]), true, "escalated convo should be detected");
assert.equal(isEscalated(convos[convos.length - 1]), false, "resolved convo should not be escalated");

// Simulate the server's final filter (escalated only) before aggregation:
const escalated = convos.filter(isEscalated);

// --- week logic ---
const wk = previousWorkWeek(new Date("2026-06-25T12:00:00"));
assert.equal(wk.startISO, "2026-06-15", `Monday should be 2026-06-15, got ${wk.startISO}`);
assert.equal(wk.endISO, "2026-06-19", `Friday should be 2026-06-19, got ${wk.endISO}`);
assert.ok(/Jun 15 . 19, 2026/.test(wk.label), `label looks wrong: ${wk.label}`);
assert.equal(wk.fileStem, "weekly-support-ai-insights-jun15-19-2026");

// --- aggregation ---
const agg = aggregate(escalated);
assert.equal(agg.totalEscalated, 11, `expected 11 escalated, got ${agg.totalEscalated}`);
assert.equal(agg.topIssues.length, 3, `expected 3 top issues, got ${agg.topIssues.length}`);
assert.ok(!agg.topIssues.some(t => /cancel/i.test(t.topic)), "cancellations must be excluded from top 3");
assert.ok(!agg.topIssues.some(t => /unknown/i.test(t.topic)), "Unknown must be excluded from top 3");
assert.ok(agg.skippedHigherVolume.length >= 0);
assert.ok(agg.top3Share > 0 && agg.top3Share <= 1, "share in (0,1]");
assert.ok(agg.topIssues[0].examples.length >= 1 && agg.topIssues[0].examples.length <= 5);

// --- report build ---
const { html, entry, fileName } = buildReport(agg, wk, new Date("2026-06-29T09:00:00"));
assert.ok(html.startsWith("<!DOCTYPE html>"), "html doc");
assert.ok(html.includes("<title>"), "has title");
assert.ok(html.includes("Jun 15 – 19, 2026"), "week label in report");
assert.ok(html.includes("Escalated to a human"), "metrics label present");
assert.ok(html.includes("Top 3 fixable issues this week"), "section present");
assert.equal(fileName, "weekly-support-ai-insights-jun15-19-2026.html");
assert.equal(entry.file, "reports/weekly-support-ai-insights-jun15-19-2026.html");
assert.equal(entry.id, "rpt-2026-06-15-19");
assert.ok(Array.isArray(entry.chips) && entry.chips.length === 3);

// balanced div tags (rough)
const open = (html.match(/<div/g) || []).length;
const close = (html.match(/<\/div>/g) || []).length;
assert.equal(open, close, `div tags unbalanced: ${open}/${close}`);

fs.writeFileSync("/tmp/selftest-report.html", html);

console.log("SELF-TEST PASSED");
console.log("  week:", wk.label, `(${wk.startISO}..${wk.endISO})`);
console.log("  total escalated:", agg.totalEscalated, "| topics:", agg.topicsFound, "| top-3 share:", Math.round(agg.top3Share * 100) + "%");
console.log("  top 3:", agg.topIssues.map(t => `${t.topic} (${t.count})`).join(", "));
console.log("  skipped (by-design/non-actionable, higher vol):", agg.skippedHigherVolume.map(t => `${t.topic} (${t.count})`).join(", ") || "none");
console.log("  headline:", entry.headline);
console.log("  report written to /tmp/selftest-report.html (" + html.length + " bytes)");
