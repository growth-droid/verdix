# Verdix App — build context

React 18 + TypeScript + Vite + Tailwind + ECharts + MapLibre + zustand + react-router.

    npm install && npm run dev     # http://localhost:5173
    npm run build                  # tsc -b && vite build
    npm run preview                # serve the built dist on :4173
    fly deploy                     # ship it (Docker Desktop must be running)

**Three docs, three jobs — keep them that way:**
| File | What belongs in it |
|---|---|
| **CLAUDE.md** (this) | The **current state** of the app + a condensed, dated **history**. |
| **[CONVENTIONS.md](CONVENTIONS.md)** | Every **rule / gotcha / magic number** that is still true. *Do not rediscover these.* |
| **[CHANGELOG.md](CHANGELOG.md)** | Plain-English release notes for a **human reader**. |
| **[README.md](README.md)** | What the product **is**, and how to run and deploy it. |

**The four gotchas that bite hardest** (the rest are in CONVENTIONS.md):
1. A long-running `vite` does **not** pick up `tailwind.config.js` edits — stale config makes custom utilities "not exist", PostCSS errors, and the page goes blank white with no error. **Restart the dev server** after touching it. (Custom classes in index.css — `.card`, `.glass`, `.kicker`, `.skeleton` — use plain CSS, not `@apply`, to stay immune.)
2. **`dark:` variants DO NOT WORK here.** tailwind.config sets no `darkMode`, so `dark:` follows the OS, not our `data-theme`. Use `readable()` / `inkOn()` from `lib/colors.ts`, or a mid-tone that clears both canvases.
3. **`<Chart>` has no `className` prop.** To size a chart, wrap it: `<div className="h-[220px] sm:h-[300px]"><Chart … style={{height:'100%'}} /></div>`.
4. Wide content must scroll **inside its own card** (`overflow-x-auto` + `min-w-[…]`), never the page. `.card { min-width: 0 }` in index.css is what makes that possible — don't remove it.

---

## ⭐ CURRENT STATE — read this first (updated 2026-08-12)

### Deploy & access
**Live:** https://verdix-elections.fly.dev — **Fly.io** (app `verdix-elections`, org *Mindshare Growth*, region sin/Singapore), **moved off Netlify 2026-08-10**. Served by **Caddy in a container**: `Dockerfile` (node build → `caddy:2-alpine`) + `Caddyfile` (holds ALL security) + `fly.toml` (port 8080, auto-stop). **Redeploy = `fly deploy`** from this dir (builds Docker locally; flyctl authed as growth@themindshare.in). Source: **private** GitHub `growth-droid/verdix` (app-only — repo root = this `product/app`). ⚠ `netlify.toml` + `netlify/` are **dead files**; the old Netlify site is stale. See [[verdix-deploy]].

**Access is currently OPEN — no login.** `AUTH_ENABLED = false` in `src/lib/config.ts` is the master switch; while false Firebase is **not even initialised** and `<LoginGate>` passes everyone through. The invite-only machinery is built and one flag away — Google sign-in + a Firestore allow-list, super-admin `sai.prasanth@themindshare.in`, admin-only **Manage users** panel at `/admin`. Firebase project **verdix-d369c** is already configured (sign-in on, Firestore + rules published; public config in gitignored `.env.local`).
**To turn it back on:** (1) `AUTH_ENABLED = true`; (2) re-add the Firebase/Google domains to the `Caddyfile` CSP (listed in a comment there); (3) authorize `verdix-elections.fly.dev` in Firebase → Authentication → Settings → Authorized domains. ⚠ Sign-in uses `signInWithPopup` — a full-page `signInWithRedirect` was tried and **broke** sign-in; don't "fix" it back.

**Security** lives in the `Caddyfile`: strict **CSP** (`script-src 'self'` — an injected/XSS script is refused), **HSTS**, `/data`+`/geo` **403** unless the request looks like the app's own fetch (`Sec-Fetch-Site`/`Referer`) which blocks curl/bots/hotlinking, CORS locked to own origin, `noindex` + `robots.txt`, immutable caching on hashed assets. **No secrets in the repo.**
⚠ **Honest ceiling:** with access OPEN, anything the browser renders is reachable by a determined person with dev-tools. Real protection = auth back on, or analysis moved server-side (Cloud Run/BigQuery).

### Data & coverage
**2004–2026: 112 assembly elections + 5 Lok Sabha.** Standalone on `public/data/*.json` — no backend.
- **Candidate positions**: `tools/build_candidates.py` → `public/data/cand/<state>.json` (top-5 per seat per election, ~3.6 MB across 36 files, one fetched at a time). ⚠ It **gates every row against the app's own `seats_ae`/`seats_ge`**, which is what strips by-election rows (2,726 of them) and normalises legacy state spellings (`NCT OF Delhi`→`Delhi`). Source has no 2004 candidates, so 2004 shows no positions.
- **Candidate overlay** (2026-08-25): `bq_export/fact_ae_candidates.csv.gz` has **zero** candidate rows for 16 recent assembly elections, so those years had nothing to show. `tools/build_cand_overlay.py` fills **14 of the 16** into `public/data/cand_overlay/<slug>.json` (422 KB, lazy per state), merged in `loadCandidates` — **additive**, like `overlay.json` for 2004, so re-running `build_candidates.py` or a Cowork refresh cannot wipe it, and the base file always wins on a year both hold. Sources: `thecont1/india-votes-data` (HR/JH/JK 2024, BR/DL 2025, AS/KL/PY 2026), `azadecon/assembly_elections_2023` (CG/MP/MZ/RJ 2023), `data-analytics.github.io/Election_Data_2024` (AP + Odisha 2024) — all ECI-derived third-party compilations. **Gate: an election ships only if ≥98% of its seats' top candidate matches the app's OWN recorded winner** — all 14 passed at **100%** (1,631 seats). ⚠ **Arunachal Pradesh 2024 and Sikkim 2024 remain unfilled** — no fetchable candidate source exists for either (Lok Dhaba is frozen at June 2023 and its API is down; the ECI purges old result folders). Party names go through `tools/partystd.py`, which borrows `build_extracts.std()` **without running its pipeline** (that module has no `__main__` guard — importing it regenerates every extract).
- **Main extracts**: `tools/build_extracts.py` ← `../bq_export/*.csv.gz` (read-only). Re-run after any Cowork data refresh.
- **2004 + recent bypolls**: `public/data/overlay.json`, built by `tools/build_overlay.mjs` from datameet/india-election-data (ECI-derived candidate CSVs). **Additive** — merged in the `data.ts` loaders, so regenerating the main extracts cannot wipe it (bypoll merge dedupes by `s|y|c`). Adds GE-2004 (543) + the six 2004-cycle AEs (AP 294 → back-mapped 107 TG / 187 AP by name-match, KA 224, MH 288, OD 147, SK 32, AR 60) + party aggregates + the 5 bypolls missing from the June refresh (Davanagere South, Rahuri, Datia, **Bankipur — Prashant Kishor's first MLA, a BJP→JSP flip**, Manjalpur; Ponda was CANCELLED and is deliberately absent).
- ⚠ **2004 is the pre-2008 delimitation**: overlay seats carry `j = 1000+n` (an isolated continuity domain, so no seat chains 2004↔2009) and `joins.ts` `DELIM_2008` blocks AE comparability across 2008 for the six states + Telangana. **Validated seat-perfect vs official** (INC 145 / BJP 138 / CPM 43…; national vote share INC 26.53 / BJP 22.16 exact; KA 79/65/58; MH 71/69/62/54; AP 185/47/26).
- ⚠ **A handful of overlay seats disagree with the workbooks on vote SHARE** (17 of 140 in Kerala 2026, 3 of 90 in J&K 2024; median delta across all of them is 0.00pp). Winner and party agree everywhere — it is the denominator that differs. Spot-checked Kerala AC 52 Ottappalam: the overlay's per-candidate EVM+postal numbers are internally consistent and total 170,104, while the app's stored 56.65% implies a total of 133,033 and leaves BJP under 7% in a seat where they demonstrably polled 42,476. The overlay carries the source's own counts; neither side was rewritten to match the other.
- **Known gaps** (do not silently "fix"): 2004 has **no turnout** (the source CSV's `ELECTORS` is blank for 2004); the map paints 2004 winners on post-2008 shapes where names match; GE-2024 seat-level turnout missing; 16 winners-only AE elections lack candidate lists. Audit with `tools/audit_datagaps.py`.

### Navigation & modules
**8 modules in 3 grouped menus** — `lib/nav.ts` is the single source (`MODULES` stays a FLAT ordered array driving `PageTagline` + Prev/Next, with a `group` field; `NAV_GROUPS` derives the menus; `groupOf(path)` highlights the active one). `components/NavMenu.tsx` renders it (click to open; closes on outside-click/Esc/navigate).

| Menu | Modules |
|---|---|
| **Results** | National `/` · States `/state` |
| **Analysis** | Change `/change` · Trends `/trends` · Compare `/compare` · Bypolls `/bypolls` |
| **Strategy** | Signals `/signals` · Targets `/battleground` |

- **Nomenclature is standardised: every tab label is ONE word** — Overview→**National**, State→**States**, "What changed"→**Change**, Battlegrounds→**Targets**. Step numbers are gone from the nav; `PageTagline` shows a `Group / Module` breadcrumb. **Routes are UNCHANGED** (`/battleground` etc. still valid).
- **Nav is a LEFT RAIL** (`components/SideNav.tsx`, owner-set 2026-08-25: "split everything and keep them to the left side one below the other"). All 8 modules are visible at once, stacked, with the group names kept as quiet section labels — nothing costs a click. `lg+` only; below `lg` it is replaced by `components/MobileNav.tsx`, a fixed **bottom tab bar** (one tab per group) opening a sheet of that group's pages. The rail pins under the header via `--app-top`. ⚠ `<main>` carries **`min-w-0`** — it is a flex child now, so without it a wide table stretches the document instead of scrolling in its own card. ⚠ The grouped header dropdown (`NavMenu.tsx`) is **superseded**; the file is unrouted but left on disk.
- **Layout is FULL BLEED** (owner-set 2026-08-25: "so much realestate wastage"). The shell had a `max-w-[1720px]` cap while the header ran edge to edge, which left **200px unused at 1920px and 840px at 2560px** — a third of the screen on a wide monitor. The cap is gone: the rail sits flush left, `<main>` runs to the right edge. Main went 1530→1720px at 1920 and 1530→**2360px** at 2560.
- **Full-screen / focus mode** (`components/FocusMode.tsx` + `useFocusStore`): the header button hides the app's own chrome (header + rail) AND calls `requestFullscreen()` so the browser drops its tab strip and address bar. ⚠ The two are **decoupled on purpose** — `requestFullscreen` needs a user gesture and can be refused, and when it is, hiding our chrome is still most of the win. Esc is handled **in the app as well as by the browser**, because a refused fullscreen leaves nothing for the browser's own Esc to exit. `fullscreenchange` syncs the flag back whenever fullscreen ends by any route (Esc, F11, the OS). The FilterBar stays (it is the control surface) and gains right padding, since the fixed corner chip sits over its right end; that chip carries a module switcher and the way out.
- **REMOVED:** the **Story** deck (08-11; `/story` redirects to `/`, `StoryPage.tsx` left on disk but unrouted/unbundled) · National's **Grid view + Map/Grid toggle** (08-12; `?view=` is no longer read) · the ⌘K command palette and the "?" glossary overlay (06-19). Don't reintroduce them without being asked.
- One shared global filter (`useFilters` + sticky `FilterBar`) carries region + arena across every module.
- `/admin` is deliberately **not** in `MODULES` — it's reached from the header account menu and renders chrome-free.

### Design system — dual light + dark (TND)
"The New Democracy" language: **light** = cream/ivory + forest-green text + metallic gold; **dark** = near-black teal + gold + a cyan hover-glow. Fonts: **Fraunces** (display/serif + base `h1,h2`), **DM Sans** (default `sans`), **Plus Jakarta** (`num`), Cormorant Garamond (`quote`).
`index.css` holds the two CSS-var token blocks — `:root` (dark) and `[data-theme=light]` — that re-point the `--s50..--s950` ramp every `slate-*`/`white` utility resolves through, so **the whole app re-skins from those two blocks**. `useThemeStore`/`useTheme()` (store.ts) drive a header **ThemeToggle** (persisted `verdix-theme`, default **dark**; `main.tsx` sets `data-theme` pre-paint, no flash).
⚠ This **SUPERSEDES** the old "dark-only glossy matte-black" decision and [[verdix-black-bg]] — the app is dual-theme; **don't re-remove the toggle**.
**Party/alliance colours (`colors.ts`) and data-viz colours are PRESERVED** — they're data, not chrome. Chrome accent is gold (`--gold`, `text-gold`, `.btn-gold`, `.eyebrow`); gold is generic, **not BJP**.

**Contrast is computed, never eyeballed** (verified 2026-08-11):
- Light ramp's `--s400/--s500` darkened, dark ramp's lifted; **light `--gold` deepened to `#8A6414`** (the old `#B0812A` measured 3.1:1 on cream and failed every gold link/eyebrow/active-sort header) — so a filled gold chip needs white ink (`[data-theme=light] .bg-gold.text-black`).
- `index.css` carries **light-theme overrides for the mid-tone Tailwind palette classes** (amber/emerald/red/rose/violet/sky/cyan 300–700), which are tuned for a dark canvas and land at 3.1–3.8:1 on cream.
- Party colour used as **TEXT** → `readable(hex, mode)`. Text sitting **ON** a tinted fill (contest matrix, bucket heat-map) → `inkOn(hex, alpha, mode)`, which picks black/white from the *blended* colour. Chart `itemStyle` and map fills keep full saturation.

### Mobile
Verified by measurement at 390px: **0 horizontal overflow + 0 sub-AA text on all 8 routes in BOTH themes**; desktop unchanged (every fix is mobile-first with an `sm:`/`lg:` restore).
- Two **systemic** causes were behind nearly all overflow — fix these first if it ever returns: (1) `StickyControls`' bleed must match the page padding (`-mx-3 px-3 sm:-mx-5 sm:px-5`); (2) **`.card { min-width: 0 }`**, because grid/flex children default to `min-width:auto` so one wide table stretched the whole document.
- Chrome is compact: controls collapse to ~2 rows (labels are desktop-only, toggles share one side-scrolling strip), straplines that merely repeat the breadcrumb/Focus bar are hidden, the map legend shows the top 4 with "+N more", and the delimitation caveats collapse to a tappable chip. Content starts ~254px in on National, ~212px on States.
- Use `useIsPhone()` (`src/lib/useMedia.ts`, reactive matchMedia) for JS-gated layout — **never** a bare `window.innerWidth` read during render. `index.html` carries `viewport-fit=cover` (the tab bar needs the safe-area inset) + PWA meta.

### Map
`ChoroplethMap` — symbol-layer **labels**: state names (always, fade-in) + constituency names (`AC_NAME` / `pc_name`, zoom ≥ 4.5) with `text-allow-overlap: false` so overlaps auto-hide. **Self-hosted Open Sans glyphs** in `public/glyphs` (the style needs a `glyphs` URL or text won't render at all). No fullscreen (ResizeObserver sizing). Winner / Alliance / Safe-vs-Swing colour modes; behavioural pan/zoom fence. **Join rules and the camera-regression warnings are in [CONVENTIONS.md](CONVENTIONS.md) — read them before touching the map.**

### Per-module notes
- **Signals** (`/signals`) — the decision layer. `lib/signals.ts` (7 pure detectors → severity-ranked `Signal[]`) + `SignalsPage.tsx`. Three views behind one `Seg`, sharing a scope toggle (Assemblies/Parliaments/Both) + multi-election picker: **Party SWOT** (default; scorecard + SWOT + win/lose playbooks, `lib/strategy.ts`), **Alliance simulator** (2–4-party bloc + 0–100% transfer slider → before/after seats, majority line, flip drill; `simulateAlliance` in projections.ts), **Patterns** (the auto-flags, each with a per-party breakdown, segmented control/soft/momentum/coalition). Every flag drills to the exact seats → `SeatDrawer`. Detector thresholds are in CONVENTIONS.md. See [[verdix-signals]].
- **Compare** — ONE tab, two modes behind an **Elections / Parties** toggle (`CompareHub` wraps `ComparePage` + `MatchupPage`). Parties mode has its own arena + year pickers. `/matchup` → `/compare`.
- **States page order (owner-set 2026-08-24):** the **seat map + swing + strongholds lead the page**, followed by the rest of the analysis cards (vote share + seats, who-beats-whom, turnout, reservation, close seats). Then the **scorecard, standalone and full-width** — its table is capped at `max-w-3xl` because six columns spread across 1550px turned into mostly whitespace. Last, the **winner matrix and the positions table, each FULL WIDTH, stacked one above the other**. ⚠ Both earlier pairings are **superseded** — first scorecard+positions, then matrix+positions (owner, 2026-08-25: "these are not good side by side"). Neither belongs in a half-width column: they are wide, horizontally-scrolling tables, and side by side each showed about four of its columns with the rest behind an inner scrollbar. Full width, the matrix needs no inner scroll at all up to ~1900px and the positions table shows 1638 of its 1666px. The matrix's `<table>` carries `w-full` so its columns spread to fill a card wider than they need (a state with few elections used to leave half the card empty); once the columns need more room their `min-w-[104px]` wins and it scrolls as before.
- **Positions table** (`components/PositionsTable.tsx`, on States) — top-5 candidates per seat (name, party, votes, share) with a **parliament-seat filter** (AC→PC from `segments.json`, latest segment year), search, and a hover card computing margin-in-votes, deposit-forfeited (<1/6 of votes) and turnout. Data = `public/data/cand/<state>.json`, **lazy-loaded per state** (`loadCandidates`), built by `tools/build_candidates.py`.
  **Colour-coded on the "podium fill" ramp** (`TIERS` at the top of the file, 2026-08-24): Position 1 is the *exact* WinnerMatrix contract — `colorFor(party)` at **alpha 1**, ink from `inkOn(col,1,mode)` — and positions 2–5 are the SAME hue at 0.34 / 0.24 / 0.17 / 0.11, each with a tapering 4→2px party rail (`readable(col,mode,6.0)`, an inset box-shadow so it costs no width) and a vote-share rule drawn as a `backgroundImage` gradient on an absolute 0–100% scale. So a row reads as the *shape* of the contest before it reads as five names. A candidate under the one-sixth deposit line drops to the faintest tier and loses its bar — **but only for `i > 0`**; the winner is never clamped (the one seat in the whole dataset that exercises this is Haryana 2009 ASSANDH, won on 15.8%). ⚠ Three rules: use the `backgroundColor` **longhand** (the `background` shorthand resets `backgroundImage` and silently kills the share rule); **no `text-ink` / `text-muted` / `readable()` on text inside a filled cell** — those are computed against the *card* surface and that premise is void once the cell has its own fill, so every text run is `inkOn`-derived; and row-hover is an **outline** (`.pos-row` / `.pos-cell` in index.css), because a background wash can no longer show through cells that paint themselves.
- **States at a glance** (`components/StatesAtAGlance.tsx`, on National) — the macro counterpart: one row per state with leader, share-of-house bar, majority tick, sub-5% seat count and turnout; sortable, searchable, hover explains the majority arithmetic, click opens the state. Pure derivation from the seats already loaded — no new fetch.
- **Winner matrix** (`components/WinnerMatrix.tsx`, on States) — constituency × election grid, every cell filled with the winner's party colour. **Every cell now reads the same four facts** (2026-08-25): party → how many of the seat's assembly seats/segments it led → vote share → lead over the next party. Lok Sabha cells get the segment count from `segments.json`; **AE · roll-up** cells get the party's *mean* vote share across the PC's assembly segments from the candidate files (assembly seats inside a PC are drawn near-equal in population, so an unweighted mean is fair — per-seat electorate weights are not in the extracts). ⚠ A roll-up delta can be **negative** and that is the interesting case: the party won the most seats there on fewer votes than a rival, so the tooltip names the rival and says so rather than printing "-6.6 ahead". Loads its own data (`loadSeats` both arenas + `loadSegments`). **AC view**: AE cells join on `j`; the interleaved `LS · segment` cells come from `segments.json` joined on the normalised AC name (segment `mg` is in VOTES → converted to a share of `sv`). **PC view**: GE cells join on `j`, plus an `AE · roll-up` column (party winning most ACs inside the PC, via the AC→PC map from the latest segment year). ⚠ The roll-up joins BY NAME, so it is gated by `comparableAE()` to avoid silently crossing a delimitation; `prune()` then drops any column with no data (which is what removes the 2004 columns). Clicking an AE/GE cell opens `SeatDrawer` through StatePage's separate `mPick` state, since the matrix can pick from either arena.
- **States** — single-state only, defaults to **Andhra Pradesh** ("All India" removed from its Focus dropdown). Opens with the **seat map** (left, big) beside swing + strongholds (right); the **Assembly-vs-Lok-Sabha scorecard** (both arenas in one table + an "LS − AE" split-ticket gap) now sits lower down — see the page-order note above.
- **Targets / Trends** — forward-looking projections in `lib/projections.ts` (path-to-control seat curve + Attack/Defend; vote-share extrapolation + momentum + Pedersen volatility).
- **SeatDrawer** — click any seat anywhere for a consultant-grade briefing; includes in-state benchmarking (closeness rank, turnout/share vs the state average).

### Verify loop
`npx tsc --noEmit` → `npm run build` → headless puppeteer-core against `npm run preview` (temp `_*.mjs`/`_*.png`, deleted afterwards; they're gitignored). For UI work, **measure** rather than eyeball: assert `scrollWidth <= innerWidth` at 390px and compute WCAG ratios on the rendered DOM in **both** themes (skip elements whose background is a gradient — unmeasurable, and a source of false positives).

---

## History (newest first)

Condensed. Each entry is what changed and why; the durable rules from all of them now live in **[CONVENTIONS.md](CONVENTIONS.md)**.

> This file was restructured on 2026-08-12 (37 jumbled dated sections → state + condensed history + a
> rules reference). The **original round-by-round build log** is preserved verbatim in git —
> `git show 5c17c33:CLAUDE.md` — if you ever need the unabridged detail of a specific round.

### 2026-08-12 — Candidate positions + the national macro table
Top-5 candidates per seat on States (with a parliament-seat filter and hover insights) and a per-state macro table on National. Validated against the owner's own reference sheet: Vijayawada Central 2019 matches exactly (YSRCP 70,721/39.73% · TDP 70,696/39.71% · CPM 29,333/16.48%). Hover verified with a real mouse — React's onMouseEnter ignores synthetic events.

### 2026-08-12 — Winner matrix on the States page
Constituency × election grid with every cell painted the winning party's colour, in AC and PC views, with search and click-through to the seat briefing. Verified: AP renders 175 ACs x 8 elections and 25 PCs x 8, 100% of cells painted, 0 console errors, no page overflow at 390px.

### 2026-08-11/12 — Mobile app layout, measured contrast overhaul, Story + Grid removed
Made the app work like a native app on a phone and fixed text that was too light. Bottom tab bar below `lg`; chrome compacted (National 560px→254px before content); header nav moved centre→right. Contrast fixed at the root (ramps, gold, Tailwind mid-tone overrides, `readable()`/`inkOn()`), verified **0 overflow + 0 sub-AA text on all 8 routes in both themes**. **Story module** and the National **Grid view + Map/Grid toggle** removed. Method: a 10-agent audit found 116 layout + 170 contrast defects, 14 agents applied 283 fixes one-file-each, then a measured verification pass closed the last 27.

### 2026-08-10/11 — 2004 coverage · grouped nav · Fly.io · open access
Coverage extended back to **2004** as an additive overlay (validated seat-perfect; delimitation-isolated). Nav went from a flat 9-tab row to **3 grouped menus with one-word labels**. Hosting **moved off Netlify to Fly.io** (Caddy container) and access set **OPEN** behind the `AUTH_ENABLED` flag, with security re-implemented in the `Caddyfile` (strict CSP, HSTS, anti-scrape 403).

### 2026-07-04 — TND design system (dual themes) · invite-only access (built, now switched off)
Reskinned the whole app to the TND language with **light + dark themes** and a header toggle — this reversed the earlier dark-only decision. Also built invite-only **Google sign-in + a Firestore allow-list** with a live admin panel; it was later switched off (see Deploy & access above), but the machinery and `firestore.rules` remain.

### 2026-06-23 — Signals: the decision layer
New module that stops making the user read charts and instead **auto-flags the patterns a strategist would act on**, each stating its numbers and drilling to the exact seats. Iterated the same day into per-party breakdowns, themed sections, the **alliance simulator**, and the **Party SWOT** + win/lose playbooks — then reorganised into the three-view toggle it has today.

### 2026-06-21 — Compare merged · State reorg · map-focus fix
Party head-to-head folded into **Compare** behind an Elections/Parties toggle (the separate `/matchup` tab went away). State page reordered (seat map + swing on top). Fixed a map-focus bug where picking a state showed central India — the pan-fence reverted the camera before the new fills painted.

### 2026-06-19 — Map labels · single-state State page · first deploy
Zoom-revealed state/constituency labels with self-hosted glyphs; State page became single-state (Andhra Pradesh default); first public deploy. **Also removed** the light theme, ⌘K palette and glossary overlay — ⚠ the light theme was brought *back* on 07-04; the palette and glossary are still gone.

### 2026-06-17 — Quality + performance pass · drill-downs · seat briefing · projections
Full QA sweep (build clean, headless smoke of every route, 3-agent code audit) with real fixes: promise-cache dedupe, **code-split 2.2 MB → 124 KB gzip**, map focus-race, seat-drawer prev-year. Added the constituency **briefing drawer**, What-changed **drill-downs** (by state / by parliament), the forward-looking **projections** (path-to-control, Attack/Defend, trend extrapolation, Pedersen volatility), state borders + click-to-filter on the National map, and the premium hover cards.

### 2026-06-15/16 — Global filter spine · guided flow · alliance normalisation · Compare
The **shared filter spine** (`useFilters` + sticky FilterBar) that makes region/arena carry across every module, plus an ErrorBoundary and the guided Prev/Next journey. **Alliance normalisation** (`astd()` in build_extracts) cut seats-vs-summary disagreements 13→2. Built the general **Compare-two-elections** module. Also wired in a Cowork data refresh (GE state turnout incl. 2024, refreshed bypolls). *(The Story deck was also built across this period — since removed.)*

### 2026-06-13 — Sprint 1: the real India map · design system v1 · reference-deck analyses
`ChoroplethMap` over real boundaries (GE 543/543, AE ~99.4% join coverage) — the join rules from this work are still load-bearing and live in CONVENTIONS.md. First premium design system (light/dark, Outfit/Plus Jakarta at the time), plain-language glossary + ⓘ tooltips, and the analyses derived from the owner's reference decks (stronghold/swing, reservation, alliance pooling, win-quality buckets).

### Superseded decisions — do not "restore" these
| Decision | Superseded by |
|---|---|
| Dark-only glossy matte-black; light theme removed (06-19) | **TND dual light + dark** (07-04) — the toggle is intentional |
| Flat 9-tab nav with step numbers (06-17 reorder) | **3 grouped menus, one-word labels** (08-10) |
| Story deck (06-16, v3.2 by 06-16) | **Removed** (08-11) |
| Grid tile view at `?view=grid` (06-13) | **Removed** (08-12) — map is the only view |
| Netlify hosting + edge function + `netlify.toml` caching | **Fly.io + Caddyfile** (08-10) |
| Invite-only gate always on (07-04) | **`AUTH_ENABLED` flag, currently OPEN** (08-10) |
| Outfit as the text font | **DM Sans** (UI) + **Fraunces** (display) (07-04) |

---

## Still to do
- **API swap**: once `../bq/load_to_bigquery.sh` has run, point `src/lib/data.ts` at the Cloud Run API — the exported types stay identical, so pages need no changes.
- **Data gaps**: GE-2024 seat-level turnout; candidate lists for the 16 winners-only AE elections; 2004 turnout (needs a source that publishes electors).
- **Wireframes not built**: 7 (leader tracker — needs name curation), 10 (booth drilldown — post-OCR).
