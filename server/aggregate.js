// Turn a list of escalated Fin conversations into the report's data shape:
// topic groups (by Intercom's AI category fields), a top-3 of *fixable* issues,
// example quotes, and a sentiment breakdown.
//
// The grouping rules live in clearly-named constants at the top so they're easy to
// tweak as we learn which Intercom fields work best (the data source is new, so
// expect to adjust these).

// Which conversation custom-attribute we group on, in priority order. The first
// one that has a meaningful value wins. ("Unknown"/blank are treated as no signal.)
const TOPIC_FIELD_PRIORITY = [
  "Accounting Categories",
  "Category Detection",
  "Conversation Intent"
];

// Secondary field used for the per-topic "sub-categories" breakdown.
const SUBCATEGORY_FIELDS = ["Conversation Intent", "Category Detection", "AI Title"];

// Topics that represent *by-design* handoffs (Fin isn't allowed to act), or that
// aren't actionable product issues. These are still counted and listed, but excluded
// from the "top 3 fixable issues".
const SKIP_FROM_TOP3 = [/cancel/i, /unsubscrib/i, /^uncategorized$/i, /^unknown$/i];

const TOP_N = 3;
const EXAMPLES_PER_TOPIC = 5;

function attr(c, name) {
  const v = c?.custom_attributes?.[name];
  return (v === undefined || v === null) ? "" : String(v).trim();
}

function isMeaningful(v) {
  return v && !/^unknown$/i.test(v);
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&rsquo;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function topicOf(c) {
  for (const f of TOPIC_FIELD_PRIORITY) {
    const v = attr(c, f);
    if (isMeaningful(v)) return v;
  }
  return "Uncategorized";
}

function subcategoryOf(c, topicSourceUnused) {
  for (const f of SUBCATEGORY_FIELDS) {
    const v = attr(c, f);
    if (isMeaningful(v)) return v;
  }
  return "Other";
}

function sentimentOf(c) {
  const raw = attr(c, "Sentiment Detection");
  if (/negative/i.test(raw)) return "Negative";
  if (/positive/i.test(raw)) return "Positive";
  if (/neutral/i.test(raw))  return "Neutral";
  return "Unknown";
}

function quoteOf(c, max = 170) {
  let q = stripHtml(c?.source?.body);
  if (!q) q = attr(c, "AI Title");
  if (!q) q = "(no opening message captured)";
  if (q.length > max) q = q.slice(0, max - 1).trimEnd() + "…";
  return q;
}

function isSkipped(topic) {
  return SKIP_FROM_TOP3.some((re) => re.test(topic));
}

export function aggregate(conversations) {
  const total = conversations.length;

  // Group by topic.
  const groups = new Map();
  const sentimentTotals = { Negative: 0, Neutral: 0, Positive: 0, Unknown: 0 };

  for (const c of conversations) {
    const topic = topicOf(c);
    const sentiment = sentimentOf(c);
    sentimentTotals[sentiment] = (sentimentTotals[sentiment] || 0) + 1;

    if (!groups.has(topic)) {
      groups.set(topic, { topic, count: 0, sentiments: { Negative: 0, Neutral: 0, Positive: 0, Unknown: 0 }, subcats: new Map(), examples: [], seenQuotes: new Set() });
    }
    const g = groups.get(topic);
    g.count += 1;
    g.sentiments[sentiment] += 1;

    const sub = subcategoryOf(c);
    g.subcats.set(sub, (g.subcats.get(sub) || 0) + 1);

    if (g.examples.length < EXAMPLES_PER_TOPIC) {
      const q = quoteOf(c);
      if (!g.seenQuotes.has(q)) {
        g.seenQuotes.add(q);
        g.examples.push({ quote: q, sentiment });
      }
    }
  }

  // Sort topics by volume.
  const allTopics = [...groups.values()]
    .map((g) => ({
      topic: g.topic,
      count: g.count,
      share: total ? g.count / total : 0,
      sentiments: g.sentiments,
      examples: g.examples,
      subcats: [...g.subcats.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      skipped: isSkipped(g.topic)
    }))
    .sort((a, b) => b.count - a.count);

  const topIssues = allTopics.filter((t) => !t.skipped).slice(0, TOP_N);
  const skippedHigherVolume = allTopics
    .filter((t) => t.skipped && topIssues.length && t.count >= topIssues[topIssues.length - 1].count);

  const top3Count = topIssues.reduce((s, t) => s + t.count, 0);

  return {
    totalEscalated: total,
    topicsFound: allTopics.length,
    sentimentTotals,
    topIssues,
    top3Count,
    top3Share: total ? top3Count / total : 0,
    allTopics,
    skippedHigherVolume
  };
}
