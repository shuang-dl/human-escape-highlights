// Small web app: serves the hub and generates last week's report from the Intercom API.
//
// Generation runs as a BACKGROUND JOB so it isn't bound by an HTTP request timeout:
//   POST /api/generate            -> starts a job, returns { jobId }
//   GET  /api/generate/status/:id -> { status: running|done|error, progress, result|error }
// The server never writes to disk; the finished job returns the files for the browser to
// download, and you commit them to GitHub to make them permanent.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { previousWorkWeek } from "./week.js";
import { fetchEscalatedConversations } from "./intercom.js";
import { aggregate } from "./aggregate.js";
import { buildReport } from "./report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPORTS_DIR = path.join(ROOT, "reports");
const INDEX_JSON = path.join(REPORTS_DIR, "index.json");

const PORT = process.env.PORT || 80;
const TOKEN = process.env.INTERCOM_TOKEN || process.env.INTERCOM_API_KEY || "";
const VERSION = process.env.INTERCOM_VERSION || "2.11";
const API_BASE = process.env.INTERCOM_API_BASE || "https://api.intercom.io";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// In-memory job store. Fine for a single instance; jobs are short-lived and it's OK to
// lose them on restart (the user just clicks again).
const jobs = new Map();
function cleanupJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;   // drop jobs older than 30 min
  for (const [id, j] of jobs) if (j.updatedAt < cutoff) jobs.delete(id);
}

function mergedIndex(newEntry) {
  let reports = [];
  try {
    if (fs.existsSync(INDEX_JSON)) {
      const parsed = JSON.parse(fs.readFileSync(INDEX_JSON, "utf8"));
      reports = Array.isArray(parsed?.reports) ? parsed.reports : [];
    }
  } catch { /* start fresh if unreadable */ }
  reports = reports.filter((r) => r.id !== newEntry.id);
  reports.unshift(newEntry);
  reports.sort((a, b) => (b?.dateRange?.start || "").localeCompare(a?.dateRange?.start || ""));
  return { reports };
}

async function runJob(jobId) {
  const set = (patch) => jobs.set(jobId, { ...jobs.get(jobId), ...patch, updatedAt: Date.now() });
  try {
    const range = previousWorkWeek();
    set({ stage: "fetching", message: `Fetching escalations for ${range.label}…` });

    const conversations = await fetchEscalatedConversations(range, {
      token: TOKEN, version: VERSION, base: API_BASE,
      onProgress: (n) => set({ progress: { fetched: n }, message: `Fetched ${n} conversations…` })
    });

    set({ stage: "building", message: `Building report from ${conversations.length} escalations…` });
    const agg = aggregate(conversations);
    const { html, entry, fileName } = buildReport(agg, range);
    const indexJson = mergedIndex(entry);

    set({
      status: "done",
      stage: "done",
      message: `Done — ${agg.totalEscalated} escalations.`,
      result: {
        range: { label: range.label, start: range.startISO, end: range.endISO },
        entry, fileName, reportHtml: html, indexJson
      }
    });
  } catch (err) {
    console.error("job failed:", err);
    set({ status: "error", stage: "error", error: err.message || "Unknown error" });
  }
}

app.post("/api/generate", (req, res) => {
  cleanupJobs();
  if (!TOKEN) {
    return res.status(400).json({
      ok: false,
      error: "Intercom token not set. Add a secret named INTERCOM_API_KEY (or INTERCOM_TOKEN) in your deploy settings."
    });
  }
  const jobId = randomUUID();
  jobs.set(jobId, { status: "running", stage: "starting", message: "Starting…", progress: { fetched: 0 }, updatedAt: Date.now() });
  runJob(jobId);                       // fire-and-forget; client polls for status
  res.json({ ok: true, jobId });
});

app.get("/api/generate/status/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: "Job not found (it may have expired — try again)." });
  res.json({ ok: true, ...job });
});

app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.use("/reports", express.static(REPORTS_DIR));

app.listen(PORT, () => console.log(`Weekly Support AI Insights running on port ${PORT}`));
