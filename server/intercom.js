// Thin Intercom API client: pull the escalated Fin conversations for a date range.
//
// We filter server-side by created_at AND Fin's resolution state. The "escalated"
// value was previously named "routed_to_team", so we try both (depending on the
// API version the workspace honors). We deliberately do NOT fall back to pulling
// every conversation for the week — that can be huge and time out behind a gateway.

const DEFAULT_BASE = "https://api.intercom.io";
const PAGE_TIMEOUT_MS = 20000;       // per-request safety timeout
const ESCALATED_VALUES = ["escalated", "routed_to_team"];

function authHeaders(token, version) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Intercom-Version": version
  };
}

async function postJson(url, body, { token, version }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(token, version),
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (netErr) {
    if (netErr.name === "AbortError") {
      throw new Error(`Intercom request timed out after ${PAGE_TIMEOUT_MS / 1000}s.`);
    }
    throw new Error(`Could not reach the Intercom API at ${url} (network error: ${netErr.message}).`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Intercom API returned HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function searchAllPages(query, { token, version, maxPages, base }) {
  const url = `${base}/conversations/search`;
  const all = [];
  let startingAfter = null;
  for (let page = 0; page < maxPages; page++) {
    const body = {
      query,
      pagination: { per_page: 150, ...(startingAfter ? { starting_after: startingAfter } : {}) }
    };
    const data = await postJson(url, body, { token, version });
    for (const c of (data.conversations || [])) all.push(c);
    startingAfter = data?.pages?.next?.starting_after || null;
    if (!startingAfter) break;
  }
  return all;
}

// Escalated if Fin's resolution state is "escalated" (or the older "routed_to_team").
export function isEscalated(c) {
  const state = String(c?.ai_agent?.resolution_state || "").toLowerCase();
  if (state === "escalated" || state === "routed_to_team") return true;
  const attr = String(c?.custom_attributes?.["Fin AI Agent resolution state"] || "").toLowerCase();
  return attr === "escalated" || attr === "routed to team";
}

function isUserInitiated(c) {
  const t = c?.source?.author?.type;
  return !t || t === "user";
}

export async function fetchEscalatedConversations(range, {
  token,
  version = "2.11",
  maxPages = 40,
  base = DEFAULT_BASE
} = {}) {
  if (!token) throw new Error("Intercom token is not set.");

  const dateClauses = [
    { field: "created_at", operator: ">", value: range.startUnix },
    { field: "created_at", operator: "<", value: range.endUnix }
  ];

  // Try each resolution-state value; keep the first non-empty result.
  let conversations = null;
  let lastClientError = null;
  for (const value of ESCALATED_VALUES) {
    const query = {
      operator: "AND",
      value: [...dateClauses, { field: "ai_agent.resolution_state", operator: "=", value }]
    };
    try {
      const result = await searchAllPages(query, { token, version, maxPages, base });
      if (result.length) { conversations = result; break; }
      if (conversations === null) conversations = result;   // remember a valid empty result
    } catch (e) {
      if (e.status && e.status >= 400 && e.status < 500) { lastClientError = e; continue; }
      throw e;   // network/timeout/5xx — surface as-is
    }
  }

  if (conversations === null) {
    throw new Error(
      `Intercom rejected the resolution-state filter (${lastClientError?.message || "client error"}). ` +
      `The API token may lack Fin AI Agent access, or the API version may need updating ` +
      `(set INTERCOM_VERSION to a newer value).`
    );
  }

  return conversations.filter((c) => isEscalated(c) && isUserInitiated(c));
}
