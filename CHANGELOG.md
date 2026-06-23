# Changelog — Verdix

Readable history of the app (newest first). Engineering detail + gotchas live in
[CLAUDE.md](CLAUDE.md); this is the plain-English summary. Dates are 2026.

---

## 2026-06-23 — Signals: the decision layer
- **New Signals module** (2nd tab, right after Overview). Instead of leaving you to read the
  charts, Verdix now **scans the selected election and flags the patterns a strategist would
  act on** — ranked cards, each with the numbers behind it and the decision it informs:
  - **vote that doesn't convert** — one party winning on concentrated pockets while a rival's
    broad vote spreads thin (the efficient minority that beats the broad-but-thin majority),
    plus **thin-margin books**, **split-field (under-40%) wins**, **eroding strongholds**, the
    **tipping-point** seats that decide control, **momentum**, and **reservation skew**.
  - Each flag is **critical / watch / note**, states its parameters, and expands to the
    **exact seats** behind it → click any seat for its full constituency report. The last
    mile, auto-surfaced.
  - All detected from constituency data — **no booth data needed**. (Pick the region in the
    Focus bar; vote-efficiency and momentum flags need vote-share data, so they sit out for
    all-India assembly.)
- **One election or many.** The Signals page has its own **Assemblies / Parliaments / Both**
  switch and a **multi-election picker**: scan a single election (the default) or select
  several — across assemblies, parliaments, or both — and the flags merge into one ranked
  board, each tagged with the election it came from; drill any flag to the seats in that election.
- Shipped live on Netlify and verified on the production build.

## 2026-06-21 — Compare does parties too
- **Compare → Elections / Parties toggle.** The Compare tab now has two modes:
  - **Elections** — any two elections head-to-head (unchanged).
  - **Parties** — compare **2 or 3 parties** for any state/all-India and any election year:
    a framing verdict, a head-to-head scorecard, a trajectory with momentum, the direct
    battleground (who-beats-whom) beside a territory map coloured by which party won each
    seat, and an auto-generated **strategic read**. (Built first as a separate "Matchup"
    tab, then merged in; `/matchup` now redirects to `/compare`.)
  - Parties mode carries its own Assembly/Lok-Sabha + **election-year** pickers; the
    head-to-head sits to the left of the territory map.
- **State page reordered** — Seat map + Swing on top, then the Stronghold/Swing list, Vote
  share + seats, Who-beats-whom, then Turnout / Reservation / Close seats. The Stronghold
  card's left panel is reserved (blank for now); its tallies moved to the top of the right list.
- **Fixed:** picking a state (e.g. Arunachal Pradesh) showed central India — the map now
  always focuses the selected state. Added long-cache headers (faster repeat loads).

## 2026-06-19 — Dark-only redesign, projections, map labels, first deploy
- **Removed** the light theme, the ⌘K command palette, and the "?" glossary overlay — the
  app is now a single tuned **glossy matte-black** theme.
- **Nav reordered** to a clearer narrative: Overview → State → What changed → Compare →
  Trends → Bypolls → Battlegrounds → Story.
- **New forward-looking projections**:
  - *Battlegrounds* — a path-to-control seat-projection curve (swing-to-majority, tipping
    seat) and an **Attack / Defend** board (offensive targets + defensive exposure).
  - *Trends* — a vote-share **trajectory projection** (+ momentum ranking) and an
    **electoral-volatility (Pedersen) index**.
- **Map labels** — zoom the map to reveal state names, then constituency names; overlapping
  labels are auto-hidden so it never clutters (fonts self-hosted, no external calls).
- **State page** is now a single-state deep-dive defaulting to Andhra Pradesh.
- **Shipped live** on Netlify (private GitHub repo) with **anti-scrape** protection on the
  data endpoints, and fixed a map crash that hit users with "reduced motion" enabled.

## 2026-06-17 — Owner UI sweep + QA
- State map gained Winner / Alliance / Safe-vs-Swing colouring; click any seat → a
  full-screen **consultant-grade constituency report**.
- *What changed* became region-aware with drill-downs by state or parliament.
- *Compare* deep-dive follows the assembly-year picker; premium hover cards everywhere.
- Banned "pp"/percentage-points (vote-share % only). Full QA: 0 errors, bundle code-split
  (2.2 MB → ~124 KB gzip first load).

## 2026-06-16 — Global filter spine + Story deck
- One shared **Focus bar** (region + arena) carries across every module; guided Prev/Next
  journey; an **ErrorBoundary** so one bad view can't blank the app.
- New **Compare** module (any two elections). New strategist **Story deck** — a narrated,
  fit-to-screen deck for India or any state, assembly and Lok Sabha woven together.

## 2026-06-14 — Premium UI, themes, strategist metrics
- Premium visual overhaul; Outfit (text) + Plus Jakarta Sans (numbers); plain-language
  glossary + inline ⓘ tooltips; party-agnostic defaults.
- Stronghold/swing classification, reservation (GEN/SC/ST) breakdown, alliance-pooling
  counterfactual, win-quality buckets, AE→GE vote transfer, alliance map mode.

## 2026-06-13 — Sprint 1–2: the foundation
- Real India choropleth (4,182 assembly constituencies / 543 parliamentary, MapLibre);
  the extract pipeline (`tools/build_extracts.py`) turning the data warehouse into bundled
  JSON; the first analysis modules (Overview, State, What changed, Trends, Bypolls,
  Battlegrounds) validated against official results.

---

Runs **standalone** on bundled JSON extracts; the planned upgrade is a BigQuery + Cloud Run
API (single swap point in `src/lib/data.ts`).
