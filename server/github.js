// Commit the generated report + updated index.json straight to GitHub via the
// Contents API, so the hub updates itself (no manual download/push).
//
// Configure with env vars:
//   GITHUB_TOKEN   - a token scoped to this repo with Contents: read/write
//   GITHUB_REPO    - "owner/repo"
//   GITHUB_BRANCH  - branch to commit to (default "main")
//   GITHUB_API_BASE- optional, default https://api.github.com (for GitHub Enterprise)

const DEFAULT_API = "https://api.github.com";

function headers(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "weekly-support-ai-insights",
    "Content-Type": "application/json"
  };
}

// Accept several common names, and a repo given as either "owner/repo" or a full URL.
function parseRepo(raw) {
  if (!raw) return "";
  let s = String(raw).trim();
  const m = s.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  if (m) return m[1];
  s = s.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  return /^[^/]+\/[^/]+$/.test(s) ? s : "";
}

export function githubConfig() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
    || process.env.GITHUB_API_KEY || process.env.GITHUB_PAT || "";
  const repo = parseRepo(process.env.GITHUB_REPO || process.env.GH_REPO || process.env.GITHUB_REPOSITORY || "");
  const branch = process.env.GITHUB_BRANCH || process.env.GH_BRANCH || "main";
  const api = process.env.GITHUB_API_BASE || DEFAULT_API;
  return { enabled: Boolean(token && repo), token, repo, branch, api };
}

function b64(text) { return Buffer.from(text, "utf8").toString("base64"); }

async function getFileSha({ api, token, owner, repo, branch, path }) {
  const url = `${api}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: headers(token) });
  if (res.status === 404) return null;        // file doesn't exist yet
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GitHub GET ${path} failed (HTTP ${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) throw new Error(`${path} is a directory, not a file.`);
  return data.sha || null;
}

async function putFile({ api, token, owner, repo, branch, path, contentText, message }) {
  const sha = await getFileSha({ api, token, owner, repo, branch, path });
  const url = `${api}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
  const body = { message, content: b64(contentText), branch, ...(sha ? { sha } : {}) };
  const res = await fetch(url, { method: "PUT", headers: headers(token), body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GitHub PUT ${path} failed (HTTP ${res.status}): ${t.slice(0, 200)}`);
  }
  return res.json();
}

// Read the current reports/index.json from the repo so we merge against the real
// source of truth (not the possibly-stale copy baked into the running container).
async function fetchIndexFromRepo({ api, token, owner, repo, branch }) {
  const url = `${api}/repos/${owner}/${repo}/contents/reports/index.json?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: headers(token) });
  if (res.status === 404) return { reports: [] };
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GitHub GET reports/index.json failed (HTTP ${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  try {
    const text = Buffer.from(data.content || "", "base64").toString("utf8");
    const parsed = JSON.parse(text);
    return { reports: Array.isArray(parsed?.reports) ? parsed.reports : [] };
  } catch {
    return { reports: [] };
  }
}

function mergeIndex(existing, newEntry) {
  let reports = (existing.reports || []).filter((r) => r.id !== newEntry.id);
  reports.unshift(newEntry);
  reports.sort((a, b) => (b?.dateRange?.start || "").localeCompare(a?.dateRange?.start || ""));
  return { reports };
}

// Fetch a single file's raw contents from the repo (used to serve reports live, so the
// hub reflects new commits immediately without waiting for a redeploy). Returns the text,
// or null if GitHub isn't configured or the file doesn't exist.
export async function fetchRepoFile(repoPath) {
  const cfg = githubConfig();
  if (!cfg.enabled) return null;
  const [owner, repo] = cfg.repo.split("/");
  if (!owner || !repo) return null;
  const encoded = repoPath.split("/").map(encodeURIComponent).join("/");
  const url = `${cfg.api}/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(cfg.branch)}`;
  const h = { ...headers(cfg.token), "Accept": "application/vnd.github.raw" };
  const res = await fetch(url, { headers: h });
  if (res.status === 404) return null;
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GitHub GET ${repoPath} failed (HTTP ${res.status}): ${t.slice(0, 150)}`);
  }
  return res.text();
}

// Commit the report file + merged index.json. Returns the merged index that was written.
export async function commitReport({ fileName, reportHtml, newEntry }) {
  const cfg = githubConfig();
  if (!cfg.enabled) throw new Error("GitHub is not configured.");
  const [owner, repo] = cfg.repo.split("/");
  if (!owner || !repo) throw new Error(`GITHUB_REPO must be "owner/repo" (got "${cfg.repo}").`);
  const ctx = { api: cfg.api, token: cfg.token, owner, repo, branch: cfg.branch };

  const current = await fetchIndexFromRepo(ctx);
  const indexJson = mergeIndex(current, newEntry);

  await putFile({ ...ctx, path: `reports/${fileName}`, contentText: reportHtml,
    message: `Add weekly report: ${newEntry.weekLabel}` });
  await putFile({ ...ctx, path: "reports/index.json", contentText: JSON.stringify(indexJson, null, 2) + "\n",
    message: `Update reports index: ${newEntry.weekLabel}` });

  return { indexJson, repo: cfg.repo, branch: cfg.branch };
}
