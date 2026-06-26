// Small web app: serves the hub and exposes one action — generate last week's
// report from the Intercom API. The server never writes to disk (deploy hosts wipe
// the filesystem on redeploy); instead it returns the generated files so the browser
// can download them, and you commit them to GitHub to make them permanent.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { previousWorkWeek } from "./week.js";
import { fetchEscalatedConversations } from "./intercom.js";
import { aggregate } from "./aggregate.js";
import { buildReport } from "./report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");          // project root
const REPORTS_DIR = path.join(ROOT, "reports");
const INDEX_JSON = path.join(REPORTS_DIR, "index.json");

const PORT = process.env.PORT || 80;
// Accept either name so it works regardless of how the secret is labeled in your host.
const TOKEN = process.env.INTERCOM_TOKEN || process.env.INTERCOM_API_KEY || "";
const VERSION = process.env.INTERCOM_VERSION || "2.11";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Read the committed index.json (the running history) and prepend the new entry,
// de-duplicating by id so re-running a week replaces rather than duplicates it.
function mergedIndex(newEntry) {
  let reports = [];
  try {
    if (fs.existsSync(INDEX_JSON)) {
      const parsed = JSON.parse(fs.readFileSync(INDEX_JSON, "utf8"));
      reports = Array.isArray(parsed?.reports) ? parsed.reports : [];
    }
  } catch { /* start fresh if the file is unreadable */ }

  reports = reports.filter((r) => r.id !== newEntry.id);
  reports.unshift(newEntry);
  reports.sort((a, b) => (b?.dateRange?.start || "").localeCompare(a?.dateRange?.start || ""));
  return { reports };
}

app.post("/api/generate", async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(400).json({
        ok: false,
        error: "Intercom token not set. Add a secret named INTERCOM_API_KEY (or INTERCOM_TOKEN) in your deploy settings."
      });
    }
    const range = previousWorkWeek();
    const conversations = await fetchEscalatedConversations(range, { token: TOKEN, version: VERSION });
    const agg = aggregate(conversations);
    const { html, entry, fileName } = buildReport(agg, range);
    const indexJson = mergedIndex(entry);

    res.json({
      ok: true,
      range: { label: range.label, start: range.startISO, end: range.endISO },
      entry,
      fileName,                 // e.g. weekly-support-ai-insights-jun15-19-2026.html
      reportHtml: html,         // the standalone report (download → reports/<fileName>)
      indexJson                 // updated history (download → reports/index.json)
    });
  } catch (err) {
    console.error("generate failed:", err);
    res.status(500).json({ ok: false, error: err.message || "Unknown error" });
  }
});

// Serve the hub and the committed report files (read-only). Source files in server/
// are intentionally NOT served.
app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.use("/reports", express.static(REPORTS_DIR));

app.listen(PORT, () => console.log(`Weekly Support AI Insights running on port ${PORT}`));
