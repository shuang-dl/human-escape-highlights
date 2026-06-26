# Human-Escape Highlights

A weekly reporting tool for DoorLoop's Customer Experience team. It turns Intercom data on
**Fin (the AI agent) escalating conversations to humans** into a 1-page report for **Product / R&D**,
highlighting the top UI/product issues to fix.

"Human-escape" = a moment where Fin couldn't resolve a customer's question and had to hand off
("escape") to a human. Every escape is a signal of friction worth fixing.

## How it works (in plain terms)

This is a small web app with a **hub** page and a **button**:

1. You open the hub and click **"Generate last week's report."**
2. The app (a tiny server) calls the **Intercom API**, pulls the previous work week's escalated
   conversations, and groups them by Intercom's own **AI category fields** into topics.
3. It builds the report — the **top 3 fixable issues**, sub-categories, example messages, and a
   **sentiment breakdown** — shows it on screen, and **downloads two files**.
4. You commit those two files to GitHub; the deployed site redeploys and the new week is permanent.

The data source used to be Intercom's "Topics Explorer" (a paid analytics screen). That's going
away, so the app now pulls everything straight from the **Intercom API** instead.

## What's in this folder

| Path | What it is |
|------|------------|
| `index.html` | **The hub.** Lists every week as a card; click one to read its report in a slide-out panel. Has the "Generate" button. |
| `server/` | The app code (Node): `server.js` (web server + `/api/generate`), `intercom.js` (API calls), `aggregate.js` (grouping rules), `report.js` (report builder), `week.js` (date logic). |
| `reports/` | The committed history: one HTML file per week, plus `index.json` (the list the hub reads). |
| `package.json` | App dependencies (Express). |
| `Dockerfile` / `.dockerignore` | How the app is built and run as a container (for DeployBay). |
| `summary.md` | Plain-text executive summary of the latest report. |
| `weekly-support-ai-insights.skill` | **Legacy** — the earlier browser-based skill (drove Topics Explorer). Superseded by this app; kept for reference. |

## Running a weekly report

1. Open the deployed hub in your browser.
2. Click **"Generate last week's report."** Give it up to a minute (it pages through Intercom).
3. It shows the report and downloads **two files**: the week's `weekly-…html` and an updated `index.json`.
4. Put the `weekly-…html` into `reports/`, replace `reports/index.json` with the downloaded one,
   then **commit & push to GitHub**. DeployBay redeploys and the week appears in the hub.

(That commit step is the manual part you chose. If you later want it automatic, we can have the
app commit to GitHub for you — that's an add-on.)

## Data source & caveats

- **Source:** Intercom API → Search Conversations, restricted to user-initiated conversations
  whose Fin **resolution state = Escalated**, created during the previous Mon–Fri.
- **Topics** are grouped from Intercom's AI fields (`Accounting Categories` → `Category Detection`
  → `Conversation Intent`). Each conversation has one primary topic, so counts are **directional**.
  These grouping rules live at the top of `server/aggregate.js` and are easy to adjust.
- **No CX Score:** that percentage is part of the paid analytics product, not the API — so the
  report shows a **sentiment** breakdown instead.
- The **top 3** excludes by-design handoffs (e.g., cancellations) and non-actionable buckets; any
  excluded higher-volume topics are named in the report footer.

## Deployment (GitHub + DeployBay + Docker)

The app is containerized so DeployBay can build and run it from the GitHub repo.

1. Push this folder to a GitHub repo.
2. In DeployBay, create an app from the repo. It detects the `Dockerfile` and builds it.
3. **Add a secret/environment variable** named `INTERCOM_API_KEY` (or `INTERCOM_TOKEN` — the app
   accepts either) with your Intercom API access token (an admin creates this in Intercom's
   Developer Hub). The app reads the token from there — it is never stored in the code or the repo.
4. Port: the app listens on `80` by default, or on `$PORT` if DeployBay provides one. No change needed.

Optional environment variables: `INTERCOM_VERSION` (default `2.11`), `TZ` (default `America/New_York`,
used to decide the work-week boundaries).

**Test locally (if you have Docker):**

```bash
docker build -t insights-hub .
docker run -p 8080:80 -e INTERCOM_API_KEY=your_token_here insights-hub
# then open http://localhost:8080
```

There's a health check at `/api/health` that returns `{"ok":true}`.

## Project structure

```
human-escape-highlights/
├── index.html              ← the hub (open this)
├── server/                 ← the app
│   ├── server.js
│   ├── intercom.js
│   ├── aggregate.js
│   ├── report.js
│   └── week.js
├── reports/
│   ├── index.json          ← the list the hub reads
│   └── weekly-…html        ← one per week (committed)
├── package.json
├── Dockerfile
├── .dockerignore
├── .gitignore
├── summary.md
└── README.md
```

## Possible next steps

- **Auto-commit** generated reports to GitHub (skip the manual push).
- **AI summarization** to add the narrative "what's breaking" bullets and cleaner quote selection.
- **Scheduling** a Monday-morning run, or an n8n workflow.
