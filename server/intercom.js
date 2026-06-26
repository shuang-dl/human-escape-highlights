// Thin Intercom API client: pull the escalated Fin conversations for a date range.
//
// We use the Search Conversations endpoint, filtered by created_at. We try to also
// filter server-side by Fin's resolution state; if that field isn't searchable on
// this workspace, we fall back to a created_at-only search and filter in code. Either
// way the final list is restricted to conversations that Fin escalated to a human and
// that were started by a real user.

// Intercom's API host. US = https://api.intercom.io (default). EU/AU workspaces
// can override via the INTERCOM_API_BASE env var (https://api.eu.intercom.io or
// https://api.au.intercom.io).
const DEFAULT_BASE = "https://api.intercom.io";

function authHeaders(token, version) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Intercom-Version": version
  };
}

async function runSearch(query, { token, version, maxPages, base }) {
  const url = `${base}/conversations/search`;
  const all = [];
  let startingAfter = null;
  for (let page = 0; page < maxPages; page++) {
    const body = {
      query,
      pagination: { per_page: 150, ...(startingAfter ? { starting_after: startingAfter } : {}) }
    };
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: authHeaders(token, version),
        body: JSON.stringify(body)
      });
    } catch (netErr) {
      throw new Error(`Could not reach the Intercom API at ${base} (network error: ${netErr.message}). ` +
        `Check that the deploy host allows outbound internet, and that the region is right ` +
        `(set INTERCOM_API_BASE to https://api.eu.intercom.io or https://api.au.intercom.io if your workspace is EU/AU).`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`Intercom search failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    for (const c of (data.conversations || [])) all.push(c);
    startingAfter = data?.pages?.next?.starting_after || null;
    if (!startingAfter) break;
  }
  return all;
}

// A conversation counts as an escalation-to-human if Fin's resolution state is
// "escalated". We check both the structured field and the custom attribute, since
// either may be present depending on workspace configuration.
export function isEscalated(c) {
  const state = c?.ai_agent?.resolution_state
    || c?.custom_attributes?.["Fin AI Agent resolution state"];
  return String(state || "").toLowerCase() === "escalated";
}

function isUserInitiated(c) {
  // Mirrors the old "type = USER" filter (exclude leads/visitors where typed).
  const t = c?.source?.author?.type;
  return !t || t === "user";
}

export async function fetchEscalatedConversations(range, {
  token,
  version = "2.11",
  maxPages = 60,
  base = DEFAULT_BASE
} = {}) {
  if (!token) throw new Error("Intercom token is not set.");

  const dateClauses = [
    { field: "created_at", operator: ">", value: range.startUnix },
    { field: "created_at", operator: "<", value: range.endUnix }
  ];

  let conversations;
  try {
    // Preferred: let Intercom filter to escalated server-side (much smaller pull).
    conversations = await runSearch(
      { operator: "AND", value: [...dateClauses, { field: "ai_agent.resolution_state", operator: "=", value: "escalated" }] },
      { token, version, maxPages, base }
    );
  } catch (e) {
    if (e.status && e.status >= 400 && e.status < 500) {
      // Field not searchable on this workspace — fall back to date-only, filter in code.
      conversations = await runSearch(
        { operator: "AND", value: dateClauses },
        { token, version, maxPages, base }
      );
    } else {
      throw e;
    }
  }

  // Defensive final filter (works regardless of which path above ran).
  return conversations.filter((c) => isEscalated(c) && isUserInitiated(c));
}
