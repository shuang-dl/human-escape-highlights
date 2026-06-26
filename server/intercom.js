// Thin Intercom API client: pull the escalated Fin conversations for a date range.
//
// We use the Search Conversations endpoint, filtered by created_at. We try to also
// filter server-side by Fin's resolution state; if that field isn't searchable on
// this workspace, we fall back to a created_at-only search and filter in code. Either
// way the final list is restricted to conversations that Fin escalated to a human and
// that were started by a real user.

const SEARCH_URL = "https://api.intercom.com/conversations/search";

function authHeaders(token, version) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Intercom-Version": version
  };
}

async function runSearch(query, { token, version, maxPages }) {
  const all = [];
  let startingAfter = null;
  for (let page = 0; page < maxPages; page++) {
    const body = {
      query,
      pagination: { per_page: 150, ...(startingAfter ? { starting_after: startingAfter } : {}) }
    };
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: authHeaders(token, version),
      body: JSON.stringify(body)
    });
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
  maxPages = 60
} = {}) {
  if (!token) throw new Error("INTERCOM_TOKEN is not set.");

  const dateClauses = [
    { field: "created_at", operator: ">", value: range.startUnix },
    { field: "created_at", operator: "<", value: range.endUnix }
  ];

  let conversations;
  try {
    // Preferred: let Intercom filter to escalated server-side (much smaller pull).
    conversations = await runSearch(
      { operator: "AND", value: [...dateClauses, { field: "ai_agent.resolution_state", operator: "=", value: "escalated" }] },
      { token, version, maxPages }
    );
  } catch (e) {
    if (e.status && e.status >= 400 && e.status < 500) {
      // Field not searchable on this workspace — fall back to date-only, filter in code.
      conversations = await runSearch(
        { operator: "AND", value: dateClauses },
        { token, version, maxPages }
      );
    } else {
      throw e;
    }
  }

  // Defensive final filter (works regardless of which path above ran).
  return conversations.filter((c) => isEscalated(c) && isUserInitiated(c));
}
