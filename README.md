# Verdix — voter verdict intelligence

Interactive retro-analysis of every Indian election 2009–2026 (106 assembly elections + 4 Lok Sabha). Runs **standalone** on bundled JSON extracts — no backend needed — and is built to upgrade to a BigQuery/Cloud Run API later (single swap point in `src/lib/data.ts`).

## Run
    npm install
    npm run dev          # http://localhost:5173
    npm run build        # type-check + production build

## How it flows
One **global filter** ties the whole product together: pick a **region** and **arena** (Assembly / Lok Sabha) once in the sticky Focus bar and it carries across every module. The numbered tabs follow a deliberate narrative — **Overview → State → What changed → Compare → Trends → Bypolls → Battlegrounds → Story** (macro picture → one state → what shifted there → compare any two → the long arc → midterm signals → what's next → the narrated deck) — and the per-page "what you're looking at" line + Next/Back buttons walk you through it as a guided journey.

## Modules (8, all live)
- **Overview** — MapLibre choropleth (4,182 ACs / 543 PCs). Colour by winner · alliance · margin-heat · turnout · single-party scoreboard; level toggle **Seats / States**; KPI strip (seats · turnout w/ trend sparkline · flips vs last · close seats); click any seat → its full **constituency report**; top-parties bar + alliance donut (click to filter the map); grid fallback at `?view=grid`.
- **State** — an Election-year dropdown drives the whole page; state seat map with a **Winner / Alliance / Safe-vs-Swing** colour toggle (click any seat → its full constituency report); **Stronghold & swing** classification + the stronghold seat list; a **"who beats whom"** contest matrix and a close-seat **battlegrounds** view (both click-to-filter); swing vs previous election (change in vote share); turnout; **seats-won by reservation (GEN/SC/ST)**; and a combined **seats-won + vote-share** conversion chart (columns + line on one timeline, switch party/alliance).
- **What changed** — flip map (vs each seat's previous election), retention matrix, net seat change, fortress & churn seats, auto strategist insight chips. Region-aware (All-India or a picked state); the net-change bar and retention cells **drill down by state or by parliament**, with click-through to the constituency report.
- **Compare** — head-to-head of **any two elections** — two assembly years, two Lok Sabha years, or one of each — with a **generated verdict**, a vote-share dumbbell, and a same-map seats-Δ table. Cross-arena pairs also get a segment-level deep-dive — a **scatter ⇄ dumbbell** toggle of assembly-vs-Lok-Sabha vote share that follows the assembly-year pick, a split-ticket table, and a PC-won/ground-held matrix.
- **Trends** — a combined **vote-share + seats-won** conversion chart (columns + line, per party); a **trajectory projection** that fits each party's vote share with a least-squares trend and extrapolates one election forward (dashed tail + projected-% labels) with a **momentum ranking** (rising/fading fastest, with fit r²); an **electoral-volatility (Pedersen index)** line with a dealignment verdict; votes→seats efficiency scatter, strike-rate small multiples, **win-quality buckets**, alliance roll-up.
- **Bypolls** — hold-rate KPIs, defend/raid ledger per party, adjudicated timeline, vacancy causes.
- **Battlegrounds** — a **path-to-control** seat-projection curve (projected seats across a −12%…+12% uniform swing, with the *now* marker, the *majority line* and the *swing-to-majority* + *tipping-point seat* when the scope is one legislature); an **Attack ⇄ Defend** board — flippability-scored targets (margin + momentum + bypoll + LS-segment) *and* the mirror **defensive-exposure** board (your thin holds, ranked by eroding-lead / lost-bypoll / lost-segment risk); KPIs for targets, seats-at-risk and swing-to-majority; and a plain-language **swingometer** (before→after for any party pair).
- **Story** — a fit-to-screen, narrated **strategist deck**: pick **India or any state** and it tells the whole story across assembly *and* Lok Sabha in 10 chapters — the battlefield (safe/lean/swing), incumbency, mandate depth, vote-share trends, the split-ticket, the social coalition (reservation), vote→seat leverage, the path to power (swingometer), and the decisive board. Action-title insights computed from the data; breadcrumbs + autoplay.

## What makes it readable
- A single tuned **glossy matte-black theme** — a neutral true-black palette (no navy/slate tint) with a soft top sheen, across the whole UI, charts, and maps.
- Fonts: **Outfit** for text, **Plus Jakarta Sans** for numbers.
- Inline ⓘ tooltips explain every term (margin, swing, strike rate, flippability…) in plain English. Changes are always shown as **vote share %**, never "pp"/percentage-points.
- **Party-agnostic**: every default is the largest party in the current view — nothing is hard-coded to one party.
- An **ErrorBoundary** keeps one bad view from blanking the app; maps self-size via a ResizeObserver and keep the geography on-screen with a pan/zoom fence.
- **Fast**: the production build code-splits the two heavy vendor libs (echarts, maplibre) into separate cacheable chunks, and concurrent loads of the large data files are de-duped to one fetch.

## Data
`tools/build_extracts.py` regenerates all `public/data/*.json` from `../bq_export/*.csv.gz` (read-only). **Re-run it after any Cowork data refresh.** Boundaries live in `public/geo/`. Outstanding data gaps are reported by `tools/audit_datagaps.py`.

## Architecture & conventions
See [CLAUDE.md](CLAUDE.md) — design system, theme mechanics, the global filter spine, the seat-number join rules, party/alliance standardisation, extract quirks, and gotchas (e.g. restart `vite` after editing `tailwind.config.js`).

## Next
- Swap `lib/data.ts` to the Cloud Run API once `bq/load_to_bigquery.sh` has run (types stay identical).
- Fill remaining data gaps (per `audit_datagaps.py`): GE-2024 seat-level turnout; full candidate lists for the 16 winners-only assembly elections (unlocks alliance-arithmetic / efficiency for those).
- Wireframe screens still to build: 7 (leader tracker — needs name-curation), 10 (booth drilldown, post-OCR).
