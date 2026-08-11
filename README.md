# Verdix — voter verdict intelligence

Interactive retro-analysis of Indian elections **2004–2026**: 112 assembly elections + 5 Lok Sabha
elections, every constituency, with winners, runner-ups, margins, vote share and turnout. Runs
**standalone** on bundled JSON extracts — no backend — and is built to upgrade to a BigQuery/Cloud
Run API later (single swap point in `src/lib/data.ts`).

**Live:** https://verdix-elections.fly.dev · source in the private GitHub repo `growth-droid/verdix`.

## Run

    npm install
    npm run dev          # http://localhost:5173
    npm run build        # type-check + production build
    npm run preview      # serve the production build on :4173

## How it flows

One **global filter** ties the product together: pick a **region** and **arena** (Assembly / Lok
Sabha) once in the sticky Focus bar and it carries into every module.

The eight modules sit in **three menus**, in a deliberate order — where things stand → what moved →
what to act on. Every label is one word:

| Menu | Modules |
|---|---|
| **Results** | National · States |
| **Analysis** | Change · Trends · Compare · Bypolls |
| **Strategy** | Signals · Targets |

On phones the header nav is replaced by a **bottom tab bar** (one tab per menu) that opens a sheet
of that menu's pages. Prev/Next buttons at the foot of each page walk the same order.

## Modules

- **National** — MapLibre choropleth (4,182 assembly / 543 parliamentary constituencies). Colour by
  winner · alliance · margin-heat · turnout · single-party scoreboard; level toggle **Seats /
  States**; KPI strip (seats · turnout with trend sparkline · flips vs last · close seats); click any
  seat for its full **constituency briefing**; top-parties bar + alliance donut, both click-to-filter
  the map. Zooming reveals state names, then constituency names, with overlapping labels auto-hidden.
- **States** — a single-state deep dive (defaults to Andhra Pradesh). Opens with a **scorecard putting
  the latest Assembly result beside the latest Lok Sabha result** — seats and vote share for both, with
  an “LS − AE” gap column that exposes split-ticket voting. Then a seat map with a **Winner / Alliance
  / Safe-vs-Swing** colour toggle, **stronghold & swing** classification, a **who-beats-whom** contest
  matrix, close-seat battlegrounds, swing vs the previous election, turnout, reservation splits, and a
  combined seats + vote-share conversion chart.
- **Change** — flip map versus each seat's previous election, retention matrix, net seat change,
  fortress & churn seats, auto strategist insight chips. Region-aware, with drill-down by state or by
  parliament and click-through to the constituency briefing.
- **Trends** — vote share + seats-won conversion chart; a **trajectory projection** (least-squares fit
  extrapolated one election forward, with fit r²) and a momentum ranking; an **electoral-volatility
  (Pedersen)** line; votes→seats efficiency scatter; strike-rate small multiples; win-quality buckets.
- **Compare** — one tab, two modes behind an **Elections / Parties** toggle. *Elections*: any two
  elections head-to-head (AE×AE, GE×GE or AE×GE) with a generated verdict, vote-share dumbbell,
  seats-Δ table, and for cross-arena pairs a segment-level vote-transfer deep dive. *Parties*: two or
  three parties for any election year — scorecard, trajectory, direct battleground beside a territory
  map, and an auto-generated strategic read.
- **Bypolls** — hold-rate KPIs, defend/raid ledger per party, adjudicated timeline, vacancy causes.
- **Signals** — the **decision layer**, in three views sharing one election picker: **Party SWOT**
  (scorecard + strengths/weaknesses/opportunities/threats + playbooks to make a party win or lose),
  **Alliance simulator** (2–4 parties as one bloc with a 0–100% vote-transfer slider → before/after
  seats, majority line, flip-seat drill), and **Patterns** (auto-flagged signals: vote that doesn't
  convert, thin-margin books, split-field wins, eroding strongholds, tipping point, momentum,
  reservation skew — each with a per-party breakdown and a drill to the exact seats).
- **Targets** — a **path-to-control** seat-projection curve across a ±12% uniform swing (majority
  line, swing-to-majority, tipping seat), an **Attack ⇄ Defend** board, and a plain-language
  swingometer.

## Design

- **Two themes**, toggled in the header and remembered: **light** (cream + forest green + metallic
  gold) and **dark** (near-black teal + gold + a cyan hover glow) — "The New Democracy" visual
  language. Fonts: **Fraunces** (display), **DM Sans** (UI), **Plus Jakarta Sans** (numbers).
- **Mobile-first correctness, verified by measurement**: at 390px there is **zero horizontal page
  scroll** and **zero text below WCAG AA** on every route in both themes. Wide tables and charts
  scroll inside their own card, never the page.
- **Contrast is computed, not eyeballed.** `readable(hex, mode)` nudges a colour until it clears AA on
  that theme's surface; `inkOn(hex, alpha, mode)` picks black/white for text sitting on a tinted fill.
  Party and alliance colours keep full saturation in charts and maps — they carry meaning.
- Inline ⓘ tooltips explain every term in plain English. Changes are always shown as **vote share %**,
  never "pp"/percentage points.
- **Party-agnostic**: every default is the largest party in the current view.
- An **ErrorBoundary** keeps one bad view from blanking the app; maps self-size via a ResizeObserver
  and keep the geography on screen with a pan/zoom fence.
- **Fast**: the build code-splits the heavy vendors (echarts, maplibre, firebase) into separate
  cacheable chunks, and concurrent loads of the large data files are de-duped to a single fetch.

## Deployment

Hosted on **Fly.io** as a container: `Dockerfile` (node build → `caddy:2-alpine`), `Caddyfile`
(security headers, SPA fallback, caching) and `fly.toml`.

    fly deploy           # from this directory; Docker Desktop must be running

**Security** lives in the `Caddyfile`: a strict **Content-Security-Policy** (`script-src 'self'`, so an
injected script is refused by the browser), **HSTS**, clickjacking and MIME-sniffing protection,
`noindex`, and a guard that **403s any direct request** to `/data/*` or `/geo/*` that isn't the app's
own same-origin fetch — blocking curl, bots and hotlinking.

**Access is currently OPEN** (no sign-in). Invite-only Google sign-in is built and one flag away:
set `AUTH_ENABLED = true` in `src/lib/config.ts` and re-add the Firebase domains to the Caddyfile
CSP. Be aware of the ceiling: while access is open, anything the browser renders can be read by a
determined person with dev-tools — real per-row protection needs auth on, or a server-side API.

*(`netlify.toml` and `netlify/` are leftovers from the previous host and are no longer used.)*

## Data

- `tools/build_extracts.py` regenerates `public/data/*.json` from `../bq_export/*.csv.gz` (read-only).
  **Re-run it after any Cowork data refresh.**
- `tools/build_overlay.mjs` builds `public/data/overlay.json` — the **2004 elections** (Lok Sabha +
  the six 2004-cycle assemblies) and recent by-elections, from ECI-derived candidate CSVs. It is
  **additive**: `src/lib/data.ts` merges it at load, so regenerating the main extracts can't wipe it.
  2004 sits on the pre-2008 delimitation, so no swing/flip/history ever joins across 2004↔2009.
- Boundaries in `public/geo/`, map-label fonts in `public/glyphs/`. Remaining gaps are reported by
  `tools/audit_datagaps.py` (2004 turnout is absent from the source; GE-2024 seat-level turnout).

## Conventions & history

Architecture, the global filter spine, seat-number join rules, party/alliance standardisation,
extract quirks and gotchas: **[CLAUDE.md](CLAUDE.md)** (read the ⭐ CURRENT STATE block first).
Plain-English release history: **[CHANGELOG.md](CHANGELOG.md)**.

## Next

- Swap `lib/data.ts` to the Cloud Run API once `bq/load_to_bigquery.sh` has run (types stay identical).
- Fill remaining data gaps: GE-2024 seat-level turnout; full candidate lists for the 16 winners-only
  assembly elections (unlocks alliance-arithmetic and efficiency for those).
- Wireframe screens still to build: 7 (leader tracker — needs name curation), 10 (booth drilldown,
  post-OCR).
