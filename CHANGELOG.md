# Changelog — Verdix

Readable history of the app (newest first) in plain English. Dates are 2026.

For engineering detail: **[CLAUDE.md](CLAUDE.md)** = current state + condensed history ·
**[CONVENTIONS.md](CONVENTIONS.md)** = the rules and gotchas · **[README.md](README.md)** = what it
is and how to run it.

> **Where the product stands (2026-08-12):** 2004–2026 coverage, 8 modules in 3 menus, light + dark
> themes, mobile-ready, live on Fly.io at https://verdix-elections.fly.dev with access **open** (no
> login). Entries below this line are history — several describe things that were later changed or
> removed (the Story deck, the Grid view, dark-only, Netlify hosting).

---

## 2026-08-12 — Winner matrix: a state's whole electoral history in one grid
- **New on the States page: a deep dive that paints every result.** One row per constituency, one
  column per election, and **every cell filled with the winning party's colour** — so a seat's entire
  history reads as a colour band at a glance. An unbroken band is a fortress; alternating colours mark
  a swing seat.
- **Two views.** *Assembly (AC)* puts each seat's own assembly results **next to the Lok Sabha result
  measured inside the same area**, so split-ticket voting jumps out on a single row. *Parliament (PC)*
  shows each parliamentary seat's own results plus a roll-up of which party won the most assembly
  seats inside it.
- **Search any constituency** by name or number, and click any cell for that seat's full briefing.
- Elections on an older constituency map (pre-2008 delimitation) are left out rather than joined to
  today's seats — the rows would not be the same places.

## 2026-08-11 — Works like an app on your phone, and everything is readable
- **Mobile.** The dashboard is now built for a phone: a **bottom tab bar** (Results · Analysis ·
  Strategy) sits in thumb reach and opens a sheet listing that group's pages, the header shrinks to
  the wordmark plus your account, and every page is compact — no wasted padding. It can be added to
  your home screen and behaves like an installed app.
- **No more sideways scrolling.** Every screen used to slide left-right on a phone. All eight now
  sit inside the screen; wide tables and charts scroll *inside their own card* instead of dragging
  the whole page.
- **Text you can actually read.** Secondary text was too light in both themes — darkened on the
  cream theme, lifted on the dark one. Gold links and headings were the worst offenders on cream and
  are now a deeper gold. Party names shown in their party colour, and the numbers inside coloured
  heat-map cells, now adjust automatically so they stay legible on either background.
- Verified by measurement, not by eye: **zero sideways scroll and zero unreadable text** across all
  eight screens in both themes. Desktop is unchanged.
- **Story deck removed** (old links land on National), and the menus now sit centre-right.
- **The Grid view is gone too** (2026-08-12). The map was the only view anyone used, so the
  Map/Grid toggle had nothing left to switch between — an old `?view=grid` link simply shows the
  map. One less control row on a phone.

## 2026-08-10 — Simpler navigation: menus instead of nine tabs
- The header no longer lists nine tabs in a row. The modules are now grouped into
  menus: **Results** (National · States), **Analysis** (Change · Trends · Compare · Bypolls),
  **Strategy** (Signals · Targets) — and, at the time, Story. Each menu lists its pages with a
  one-line description, so you can see what's inside before clicking.
  *(Story was removed the next day, leaving the three menus the app has now.)*
- **Names standardised — every page is now a single word**: "Overview" → **National**,
  "State" → **States**, "What changed" → **Change**, "Battlegrounds" → **Targets**. The step
  numbers are gone from the nav, and each page now shows a small *Group / Page* breadcrumb.
- Nothing moved or was removed — same nine modules, same links, just fewer things to scan.

## 2026-08-10 — 2004 elections + fresh by-elections
- **The dataset now reaches back to 2004.** The 2004 General Election (all 543 seats) and the
  six assembly elections of the 2004 cycle — undivided Andhra Pradesh (294, split into today's
  Telangana/AP), Karnataka, Maharashtra, Odisha, Sikkim, Arunachal — join the product, with
  party vote shares, margins, winners and runner-ups, **validated seat-for-seat against the
  official results** (INC 145 / BJP 138 nationally; NCP 71/INC 69 in Maharashtra; BJP 79/INC 65/JDS 58
  in Karnataka; the INC+TRS+Left sweep of undivided AP…).
- **2004's own alliances**, correctly: NDA-2004 (with TDP, AIADMK, Trinamool, SAD, BJD…),
  the Congress-side seat pacts that became the UPA, the Left Front — including the TN and AP
  cases where the Left sat inside the Congress pact. New party colours for the 2004-era parties
  (JD(S), SAD, PMK, LJP, MDMK…).
- **Honest boundaries:** 2004 was the pre-2008 constituency map, so no swing, flip or seat-history
  math ever crosses 2004→2009 — the app marks them as different delimitations.
- **By-elections brought current:** the five results missing from the last refresh — Davanagere
  South (INC hold), Rahuri (BJP hold), Datia (INC hold), Manjalpur (BJP hold), and **Bankipur,
  where Prashant Kishor won Jan Suraaj's first-ever assembly seat off the BJP**. (Ponda's bypoll
  was cancelled and is correctly absent.)
- Known gap: 2004 turnout percentages aren't in the source and show as n/a.

## 2026-07-04 — New look: "The New Democracy" design system, light + dark
- **A full visual redesign** in the TND house style — a premium, editorial look built on
  three colours: **cream + forest-green + metallic gold** in the light theme, and a
  **near-black teal with gold and a soft cyan glow** in the dark theme.
- **Both themes ship, with a sun/moon toggle** in the top-right of the header (your choice
  sticks between visits). Opens in dark by default; switch to the cream light theme anytime.
- **Serif headlines** (Fraunces) for the Verdix wordmark and every section title, clean
  **DM Sans** for labels and controls, and the tabular number font kept for the data.
- Cards are glass with a subtle gold (light) / cyan (dark) glow on hover; the toggles,
  active tabs and links are now **gold** instead of orange.
- The **party and alliance colours are untouched** — those carry meaning, so only the
  surrounding "chrome" changed. The India map now sits on the themed canvas (teal in dark,
  cream in light) with matching borders.
- Shipped live and verified in both themes.

## 2026-07-04 — Private access: Google sign-in + admin user management
- **Verdix is now invite-only.** Opening the app shows a **"Sign in with Google"** screen; only
  accounts on the allow-list get in. Anyone else sees a "no access — request it from the admin"
  screen with a one-click email to Sai. (Gates the dashboard itself; the raw `/data` files stay as
  before — locking those down is the planned next step.)
- **sai.prasanth@themindshare.in is the admin.** Permanent access, can never be locked out, and is
  the only account allowed to change who can get in.
- **Live user management, no redeploy.** A new **Manage users** panel (visible to Sai only) lets him
  add a person by email or remove them; the change takes effect the next time that person signs in.
  The list is held in Firebase/Firestore and protected by server-side rules so only the admin can edit it.
- **Setup pending (owner, one-time ~10 min).** Enable Google sign-in + Firestore on the existing
  Google Cloud (BigQuery) project, paste the web config into `.env.local`, publish `firestore.rules`,
  add the Netlify domain as an authorized domain — then a normal rebuild + deploy. Until that's done
  the app shows a "login isn't configured yet" screen. Code is built, type-checked and headless-verified;
  the live login flow gets verified once the project is configured.

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
- **Readable, every-party breakdown.** Each flag now opens with the **whole field** — a compact
  per-party mini-bar chart (vote→seat conversion, thin-margin book, split-field wins, momentum,
  the house tally, …, across *all* parties, not just the one or two at the extremes) under a
  short title, with a one-line takeaway beneath. Replaces the earlier text-heavy headline, so a
  flag is scannable at a glance.
- **Segmented board.** The flags are grouped into themed sections — *Control of the house ·
  Where the lead is soft · Momentum & conversion · Social coalition* — in a two-column layout,
  so the board reads at a glance instead of one long stack.
- **Alliance simulator + vote-transfer slider.** A new panel answers the what-if: pick **2–4
  parties** to contest as **one bloc**, set a **0–100% vote-transfer** slider, and watch the seat
  count move from what they win apart to what they'd win together — whether it crosses the
  majority line, how many internal contests it consolidates, and exactly which seats flip in
  (drill to each). Honest model: a seat flips when the chosen transfer of the allies' statewide
  vote covers the losing margin; seats where the bloc ran third can't be judged from the data, so
  the gain is a floor, not a forecast.
- **Party SWOT + win/lose playbooks.** Pick a party for a senior-strategist read: a scorecard, a
  full **SWOT** (strengths · weaknesses · opportunities · threats, each line quoting the numbers),
  and two ordered playbooks — **what to do to make it win**, and **what to do to make it lose** —
  every move drilling to the exact seats. Computed from strongholds & erosion, thin / split-field
  margins, vote→seat conversion, momentum, the social base, and who beats it. Signals is now
  **three views behind one toggle** — *Party SWOT · Alliance simulator · Patterns* — sharing the
  election picker, so the page stays focused instead of one long scroll.
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
