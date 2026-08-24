# Verdix — Conventions & Rules

**Do not rediscover these.** Every entry below is a rule, constraint, magic number or gotcha that is
CURRENTLY TRUE in the codebase and cost real time to learn. Mined from the dated build log in
[CLAUDE.md](CLAUDE.md) so that file could stay readable — this is the reference, that is the state + history.

Last synced with the code: **2026-08-12**. If you change one of these, update it here in the same commit.

## Contents
- [Build & dev-server gotchas](#build--devserver-gotchas) (14)
- [Data & extracts](#data--extracts) (24)
- [Map & geo joins](#map--geo-joins) (18)
- [Charts (ECharts)](#charts-echarts) (18)
- [Theming & design tokens](#theming--design-tokens) (12)
- [Global filter & navigation](#global-filter--navigation) (10)
- [Analysis logic](#analysis-logic) (23)
- [Performance](#performance) (5)
- [Access control & misc](#access-control--misc) (22)

## Build & dev-server gotchas

_Things that waste an hour if you do not know them._

- Never put `*/` inside an index.css comment (e.g. writing `slate-*/white`) — it closes the comment early and produces an "Unexpected *" warning plus invalid CSS.
- A DEV-only auth-bypass flag (`VITE_AUTH_BYPASS`, gated by `import.meta.env.DEV`) may be added for headless QA but must be removed before commit — never ship it to prod.
- `src/lib/firebase.ts` has a `firebaseReady` guard so a keyless checkout still builds and shows the "unconfigured" screen instead of throwing.
- Vite inlines `VITE_*` env vars at BUILD time, and the build runs locally — so `.env.local` must exist on the build machine; host-side env vars can never apply to an already-built `dist`.
- Reduced-motion-only bugs never appear in default headless QA — emulate them: `page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])`.
- `public/geo/india_states_borders.geojson` is GENERATED — regenerate with `node tools/build_state_borders.mjs` from `product/app`. The simplified PC geojson is NOT topology-preserved (adjacent PCs don't share vertices) so an edge-counting dissolve fails (kept 66%); the generator unions each state's PCs with `polygon-clipping` (a devDependency).
- Windows path gotcha in node tool scripts: resolve paths with `fileURLToPath(new URL('.', import.meta.url))` + `path.join` — the raw `.pathname` leaves `%20` in "Data Project" and `readFileSync` ENOENTs.
- PORTAL GOTCHA: App.tsx's per-route `animate-fadeUp` applies a `transform`, which creates a containing block and traps `position:fixed` overlays (they anchor to the tall page, not the viewport). ANY fixed overlay must `createPortal(…, document.body)` — SeatDrawer does, at `z-[60]`.
- Verify loop and known-good behaviours: `npx tsc --noEmit` → `npm run build` → headless smoke of every route (flip every `<select>`, click every `Seg`, check region carry) in dark AND light, expecting 0 console/page errors. A hard `goto` reload resets the in-memory store BY DESIGN — only the theme persists.
- TypeScript gotcha: a `.reduce(..., -1)` used to find a last index infers a nullable type — use an explicit `for` loop instead.
- DIAGNOSIS SHORTCUT (don't redo blind): reports of "many errors / dropdowns not changing" were (a) cross-page filter fragmentation and (b) a stale dev-server/HMR state on the owner's machine — an exhaustive headless sweep found ZERO console errors and full reactivity. Clean restart = `Stop-Process node`, `rm node_modules/.vite`, `npm run dev`.
- Do NOT install shadcn / `@efferd/dashboard-*` blocks: Verdix is a bespoke React+Vite+Tailwind app with no `components.json`/Radix, `shadcn init` would clobber the hand-built design system, and blocks 6-10 need a paid token. Adopt the patterns natively instead.
- MapLibre gotcha: never gate a source remount on `once('load')` — it fires once per MAP LIFETIME, and `isStyleLoaded()` is false whenever the style is dirty; retry via `once('idle')` (see `mount()`). `window.__map` is exposed in dev for inspection.
- Visual-verify pattern (the Chrome-extension MCP is often disconnected): `npm i --no-save puppeteer-core`, drive system Chrome headless with `--enable-unsafe-swiftshader --use-angle=swiftshader` against the dev server, and screenshot. Temp `_*.mjs`/`_*.png` files are deleted afterwards.

## Data & extracts

_How public/data is produced and what is quirky in it._

- `build_extracts.py` `VOTESHARE_SUPPLEMENT` backfills null `v` for winners-only rows for 7 AE elections (fetched from ECI/Wikipedia) so the seats+vote-share combo chart's vote line appears; a `voteShareMissing` banner flags any that remain. Combined-Independent residuals (Haryana/J&K) are deliberately excluded as unreliable.
- Reservation categories are DYNAMIC — GEN/SC/ST plus Sikkim's BL (Bhutia-Lepcha) and anything else present; never silently fold an unknown category into GEN. `build_extracts.fill_reservation()` back-fills an EMPTY reservation from the same seat's other elections (keyed state+`j`) and reports residual blanks; the 2026-06-14 audit found zero true blanks (AE = GEN 10482 / SC 2139 / ST 1743 / BL 36; GE = GEN/SC/ST only), so the fill is a safety net for future refreshes.
- `state_turnout.json` (`loadStateTurnout()`): AE turnout comes from `dim_ae_index` keyed by `state_asthen` (full 106/106 coverage incl. wiki-era 2023–26); GE turnout comes from `agg_ge_state_turnout` with the fact_ge_winners PC-turnout mean only as a per-(state,year) fallback. Charts prefer this official series over the per-seat mean.
- ComparePage's `states` list must UNION AE + GE party data — being AE-only made a GE-only region silently fall back to UP.
- GE state turnout in `build_extracts.py` reads `agg_ge_state_turnout` as the PRIMARY source (ECI finals, full coverage incl. 2024) and only falls back to the `fact_ge_winners` PC-turnout mean for a (state, year) it lacks.
- Known open data gaps (per `tools/audit_datagaps.py`) — do NOT fabricate or "fix" silently: SEAT-LEVEL turnout for GE-2024 and ~20 recent AE (state-level now covers the KPIs/charts); the 16 winners-only AE candidate lists; bypoll votes/retention partial (missing retention 128, votes 59).
- `tools/build_extracts.py` derives ALL `public/data/*.json` from `../../bq_export/*.csv.gz` (read-only) — RE-RUN it after any Cowork refresh of bq_export.
- `j` = the normalized seat number used for cross-year continuity: AE uses the undivided-AP domain (AP 2014+ = n+119); GE uses the current domain (AP ≤2014 = n−17, DNH&DD by name 1/2, Ladakh→1, J&K ≤2019 with n≥5 → n−1).
- `fact_ae_candidates` / `fact_ge_candidates_pc` INTERLEAVE bypoll rows — always filter on `election_type`.
- PARTY STANDARDISATION `std()` in build_extracts must be applied at EVERY party read (seats / party / segments / bypolls / split / alliance_cf): it folds full English names → codes via the FULLNAME map, applies `alliances.canon`, unifies codes (`TRS`/`BHRS` → `BRS`) and drops Wikipedia infobox JUNK rows ("Votes cast/Turnout", "Valid votes", "Other parties"). Without it the AE×GE compare double-counts the same party.  
  **Why:** Sources disagree — TCPD uses short codes while wiki-era AE summaries (agg_ae_party_summary, 2023–26) use full names plus infobox junk.
- `std()` normalises cp1252 MOJIBAKE (stray `U+0096` where an en-dash belongs, `U+0092` for an apostrophe) and smart quotes, and collapses internal whitespace BEFORE the FULLNAME lookup; FULLNAME includes BAP/RLD/SDF/UPPL/VPP(`VOTPP`)/ZPM/NCP(SP). An unmatched name = seat bars with no vote line in the seats+vote-share combo.
- Remaining "no vote line" cases — Assam RD, J&K JKPC, MP BAP, Mizoram-AE ZPM — are GENUINE null-`v` winners-only source rows, not party-name bugs. Don't chase them as name-mapping issues.
- GE party summaries (state + national) are computed from `fact_ge_candidates_pc`, because the shipped `agg_ge_*` tables LACK 2024 and `agg_ge_national_summary.seats_contested` is broken (INC 2009 shows "75"). Validated: 2009 INC 440/206/28.55%, 2024 BJP 240/36.56%.
- `fact_ge_segment_winners` lacks 2024 → 2024 segment winners are derived from segment candidates (positions 1/2). J&K segments are numbered 1-90 even pre-2022 (anachronistic) → J&K and Ladakh are EXCLUDED from the split files.
- margin%/share% backfills: GE-2024 is computed from raw votes ÷ `pc_valid` (the source `total_valid_votes` = 0), and AE 2023-26 wiki-era rows derive the denominator as `winner_votes ÷ (winner_share/100)`. Without these, EVERY post-2023 assembly election had null margins and close-seats/battleground/margin-map/swingometer were silently empty (INC <5% targets went 72 → 223 after the fix). Validated: TN-26 Tiruppattur 0.0%, Mumbai-NW-24 0.01%.
- Split pairs use the NEAREST AE (tie → the earlier one); per-state split files are lazy-loaded from `data/split/`.
- ALLIANCE STANDARDISATION `astd(s, y, p, a)` in build_extracts is applied at EVERY alliance read (seats, party AE/GE, segments 2009-19 + 2024, split rows, alliance_cf): regional NDA/UPA brands fold to the canonical bloc (`ALLIANCE_FOLD` 'kutami' → 'BJP Alliance (NDA)'); a party whose "alliance" is its own name → Unaligned; BJP/INC ALWAYS anchor their own bloc (never Unaligned/own-name); independents → one label; plus per-(state, year, party) `ALLIANCE_OVERRIDE`s (Andhra-2024 NDA = TDP+JSP+BJP; Telangana-2023 CPI → INC bloc).
- The alliance junk filter is case-insensitive and strips footnote markers (`Independents[29]`), which stopped 8 Wikipedia infobox rows leaking into party_ae (5087→5080).
- `allianceBase()` strips the bloc suffix so "BJP Alliance (NDA)" colours and rolls up with every other "BJP Alliance". Don't recompute alliance labels in the app — they are baked into the data.
- The canonical alliance/party-code mapper is `scripts/alliances.py` (the Cowork lane); `astd()`/`std()` in build_extracts are app-lane corrections and should stay SHORT — push permanent fixes upstream.
- Known residual alliance disagreements deliberately left alone (genuine micro-ally judgment calls, for Cowork/alliances.py): Maharashtra-2024 RYSP and Rajasthan-2023 RLP+. Audited-as-genuinely-solo parties (do not "fix" them into blocs): BJD, BRS, ZPM, AAP, JD(S)-2023, TIPRA, YSRCP, IND; SKM/NPP/MNF ran their own state blocs.
- The Compare segment deep-dive FOLLOWS the assembly-year picker via the per-state extract `split/ae_<slug>.json` (`{ ae_year: { "segDom|party": share } }`, emitted by build_extracts for every AE year with candidate data, read by `loadAESegShares`), which overrides each split row's `av` with the SELECTED AE year's segment share. If the picked AE has no entry (winners-only, e.g. AP AE 2024) `paired` empties → show the "AE {yr} is winners-only for {state}; pick an assembly year with complete data" message. The fixed `splitFile.ay` baseline is now unused by the deep-dive.
- `alliance_cf.json` (the pooling counterfactual): UNALIGNED parties NEVER pool, and it is gated to elections with ≥98% candidate coverage and ≥3 candidates/seat.
- Don't recompute alliance labels in the app — they're baked into the data by the extract build.

## Map & geo joins

_ChoroplethMap: seat-number joins, aliases, camera behaviour._

- MAP FOCUS BUG (fixed, don't regress): `fitBounds(duration:0)` fires its `moveend` SYNCHRONOUSLY, so the pan-fence ran before the new fills painted and before `lastGoodRef` updated, yanking the camera back to the all-India default (picking any state showed central India). Fix: set `lastGoodRef` to the focused bbox centre BEFORE calling `fitBounds` in the focus effect.
- The ChoroplethMap FILLS its parent: root = `relative ${height}`, map box = `absolute inset-0`; callers control size via the `height` prop on a sized wrapper (e.g. `height="h-full"` inside `lg:col-span-2 min-h-[480px]`, where the grid's `items-stretch` makes the map column match the KPI column exactly).
- The pan/zoom fence is BEHAVIORAL, not `maxBounds`: on `moveend`, if the central third of the viewport contains no `seats-fill` feature, `easeTo` back to `lastGoodRef`. `maxBounds` on the full bbox failed because the Andaman/Lakshadweep islands leave ocean gaps you could pan into — keep the behavioral fence.
- PAN-FENCE RECURSION: MapLibre turns `easeTo` into an INSTANT jump under `prefers-reduced-motion`, and that jump's `moveend` fires SYNCHRONOUSLY → the fence re-enters itself until "Maximum call stack size exceeded". Fix in place = a `fenceCorrecting` re-entry flag + an "already at the good centre" early-out. ANY future self-triggering `easeTo`/`flyTo` must be guarded the same way.
- The `state-line` border layer is drawn ABOVE `seats-fill`/`seats-line` and below `seats-hover`; colour = `MAP_PAL[theme].stateLine` (dark `rgba(226,232,240,.55)`, light `rgba(15,23,42,.5)`), width interpolates zoom 3→0.9px … 7→2.2px, repainted in the theme effect. The per-seat hairline `seats-line` stays `pal.line` (near-background) so ONLY state borders read as a bright line. The mount effect's dep array is `[geo, stateGeo]`.
- State-border generation must keep only the EXTERIOR ring of each part (`poly[0]`, dropping holes — no Indian state is a donut at this resolution) and drop sliver parts (`ringArea(poly[0]) > 1e-5`, shoelace); otherwise interior gap-holes and slivers render as stray white lines INSIDE states. Expected output: 36 states, 0 union failures, 4781 holes + 93 slivers dropped, file 372K, 0 interior rings.
- ChoroplethMap's focus effect MUST include `stateGeo` in its deps — when the border layer resolved after `geo`, the mount effect re-added the full-geo source and the map silently reverted to all-India.
- Map labels are two symbol layers: `state-labels` (on the `states` source, field `st_name`, uppercase Bold, minzoom 3.2, fades as you zoom in) and `seat-labels` (on the `seats` source, `['coalesce', AC_NAME, pc_name]` so it shows assembly OR parliament names per arena, minzoom 4.5). `text-allow-overlap` stays at its default (false) so MapLibre auto-hides any overlapping label — the map self-declutters.
- MapLibre needs a `glyphs` URL to render ANY text — the old blank style had none. Self-hosted Open Sans PBFs are bundled at `public/glyphs/{OpenSans-Regular,OpenSans-Bold}/{0-255,256-511}.pbf` (Latin only; all names are romanized) and the style sets `glyphs: '/glyphs/{fontstack}/{range}.pbf'`. No external font calls. Label colours live in `MAP_PAL.*.{stateText,seatText,halo}` and repaint on theme switch.
- There is NO map fullscreen anywhere (removed product-wide 2026-06-16): `ChoroplethMap` lost its `full` state, expand button and fixed-overlay container, and uses a **ResizeObserver → `map.resize()`** instead so maps stay crisp in flex layouts. Don't re-add fullscreen.
- A definite-height flex stage (`flex-1 min-h-0`) is what makes ECharts `height:'100%'` reliable — a `minHeight` clamp is not enough.
- ChoroplethMap pan-fence + focus: the focus effect's `fitBounds` fires `moveend` before the filtered fill paints, so the fence found no centre features and eased back to the all-India default — with a single-state source that renders a BLANK map. `lastGoodRef` must be pinned to the focused centre around `fitBounds`.
- State seat-map Colour `Seg` = Winner | Alliance | Safe vs Swing; the old winner-mode caption ("Winner colours · hover for the result · scroll to zoom") was removed on purpose — keep only the security-mode explanation and the click-for-report hint.
- `geoKey()` STATE ALIASES (data→geo) — do not rediscover: Odisha→ORISSA, Uttarakhand→UTTARKHAND (an AC shapefile typo), A&N Islands→ANDAMAN & NICOBAR (PC layer), Ladakh→J&K shapes (both layers), Telangana→ANDHRA PRADESH (AC layer, because the geo keeps undivided AP).
- AC NUMBERING join rules: the geo is undivided-AP (TG 1-119, AP 120-294), so AP data from 2014+ joins as `n+119`; Telangana joins as-is; AP 2009 is already 120-294. Ladakh AE 2014 = J&K ACs 47-50.
- PC NUMBERING join rules: GE AP ≤2014 is undivided (TG block 1-17 first, residual AP 18-42) → `n−17`. GE J&K 2024: n≥4 → `n+1` (the new numbering skips Ladakh). Ladakh GE → `J&K|4` in all years. DNH&DD is a merged UT sitting on two pre-merger shapes and 2009-19 has DUPLICATE `(s,n)=(…,1)` rows → join by NAME ('DAMAN' in `c`).
- `DELIM_BREAK` (AE): J&K ≥2020 and Assam ≥2023 get a uniform statewide-leader fill + an amber note instead of a seat join. Assam 2026 names match the OLD shapes only 1/126 — never seat-join it.
- True no-shape gaps (leave as no-data, don't chase): Gujarat ACs 45-56 & 160-167 (Ahmedabad/Surat) and MP 205-208 (Indore) — the shapefile only has unnamed AC_NO=0 slivers there; Sikkim 32 = Sangha, non-territorial by design. Join coverage is GE 543/543 every year, AE ~99.4%; all number-offset rules were verified by constituency-NAME matching, not assumed.

## Charts (ECharts)

_Conventions for every chart in the app._

- Use the `Chart` wrapper from ui.tsx, NEVER a raw `<ReactECharts>` — it reads `useTheme()` and passes a stable theme-object ref so echarts-for-react disposes + reinits on a theme switch.
- ECharts option helpers (`baseOpt`/`catAxis`/`valAxis`) hold NO colours; axis/grid/tooltip colours come from the `DARK_ECHARTS`/`LIGHT_ECHARTS` theme objects in theme.ts. For inline labels/gridlines the registered theme can't reach (Sankey/pie labels, custom splitLines) use `labelColor(mode)` / `faintLine(mode)` and add `mode` to that memo's deps.
- `ui.tsx`'s `Chart` forwards `onEvents` to echarts-for-react (`params.name` = the clicked category/slice) and honours its declared `notMerge` prop (it used to force notMerge always-on).
- Every Signals detector must emit `rows: SignalRow[]` — one tone-coloured mini-bar per party (capped at 8 + "+N more") — so a card shows the WHOLE field, not just the 1–2 extreme parties. Each Signal also carries `group: SignalGroup` (`control`/`soft`/`momentum`/`coalition`) driving the segmented sections.  
  **Why:** Owner rejected cards that showed only 2 parties as "not consumable".
- National map click-to-filter: `MapPage` holds `pick: {kind:'party'|'alliance', value} | null`, reset on arena change; the party bar (`barEvents`) and alliance donut (`donutEvents`) toggle it (clicking the active one clears). While set, the map's `colorOf`/`subOf`/`legendItems` colour ONLY the picked party/alliance and grey everything else (`OUT`), with a clearable banner above the map.
- ⛔ "pp" / "percentage points" / "points" is BANNED product-wide. Express deltas as "vote share" or "change in vote share" with a `%` suffix (axis `v + '%'`, "+14% vote share") — never `pp`/`+14pp`, in labels, tooltips, glossary or insight strings.
- Seats and vote share always live in ONE chart (`VoteSeatChart`, used by Trends + State): dual-axis combo, seats as columns and vote share as a line, multi-select with ALL parties ON by default; click a party chip to toggle.  
  **Why:** Owner rule — never split them into two cards.
- State page interactions are CLICK-to-filter, not hover: the "Who beats whom" contest matrix (winner × runner-up, click a cell → `contestSel`/`contestSeats`) and the close-seat tornado (click a bar → `battleSel`). The contest detail table sits BESIDE the matrix (`xl:flex-row`, matrix `xl:shrink-0` left, table `xl:flex-1` right), mirroring the Close-seats card's `lg:grid-cols-2` layout.
- Trends win-quality is a colour-conditional HEATMAP (not grouped bars) with a `%/#` toggle (default `%`), assembly seats grouped by parliament (AC→PC via `segments`, latest year wins), sorted high→low, and CLICK (not hover — hover made it "shake") on a cell opens the constituency list.
- Swing chart (StatePage `swingData`): `swing()` returns `d = to − from` (current − previous vote share). Carry `from`/`to` on each data object and read `q.data.from`/`q.data.to` in BOTH tooltip and label — never index a parallel array (`sw[q.dataIndex]`) against `.reverse()`-ed series data, which showed the MIRROR party's shares. Axis is padded by `max(6, range*0.32)` so end labels don't clip.
- Premium ECharts tooltips are custom HTML "glass cards" styled with the design-system CSS vars (`rgb(var(--s800/--s900))` surface, `rgb(var(--s50))` text) so they are theme-aware for free with NO `mode` dependency; the ECharts container is neutralised (`backgroundColor:'transparent', padding:0, borderWidth:0, extraCssText:'box-shadow:none'`, `confine:true`) so the inner card carries all chrome. The swing tooltip reads `q.data.clr`.
- `voteSeatOption` in theme.ts renders the same glass-card axis tooltip: year header + `SEATS · VOTE SHARE` caption, then one row per party SORTED BY SEATS DESC (nulls last) — colour dot, name, right-aligned seats, right-aligned share in the party's colour, `–` when winners-only. Keep the swing and combo tooltips in sync.
- Long drill tables live in a `max-h-[420px] overflow-y-auto` container with a STICKY header; seat names render as capped clickable chips (flow ≤12, net ≤6 gained + ≤6 lost, each with "+N more") and every chip opens the constituency report. The by-state "+N more" is an expand toggle (an `expanded` Set, reset on drill/groupBy change).
- On Trends, the dashed projection series is `silent` and filtered out of the axis tooltip by its name suffix ` proj`; `endLabel` shows the projected %. Momentum chips are gated to |slope| > 0.3. Both projections are captioned as directional what-ifs, not forecasts.
- The Assembly-vs-Lok-Sabha vote-share card keeps BOTH views behind a "Per-segment dots / Party summary" `Seg` (default = dots/scatter) because the owner flip-flopped; both read off the same filter-responsive `paired`. The `SplitDumbbell` is pure HTML: each party's MEAN assembly segment share ○──● its MEAN Lok Sabha segment share, sorted by LS share, line blue = runs stronger nationally / amber = stronger in state.
- OWNER CHART RULES from the reference decks: NO stacked bars (use lines / grouped bars / distributions instead); maps must support state-grouping.
- National map has a Level toggle Seats|States (uniform state-leader fills) plus a Party scoreboard mode (won = green, runner-up = red, out-of-top-2 = dark), per the Telangana deck.
- Every chart that shows 2024 GE segments or wiki-era elections must carry the footnotes from `../10_metrics_catalog.md` (caveats section).

## Theming & design tokens

_The two-token-block system, fonts, colour rules._

- index.css holds the two CSS-var token blocks — `:root` (dark) and `[data-theme=light]` — that re-point `--s50..--s950` and `--white`; every `slate-*`/`white` Tailwind utility resolves through them via `rgb(var(--sX) / <alpha-value>)` in tailwind.config, so the WHOLE app re-skins from those two blocks with zero per-element edits.  
  **Why:** It is the single lever for theming; per-component colour edits fight it.
- Light is a tuned MIRROR of the slate scale (small numbers = dark text, large numbers = light surfaces), not a naive invert. Semantic aliases exist: `text-ink` / `text-muted` / `text-faint`.
- `.card:hover` gets a gold (light) / cyan (dark) glow border and must NOT use a transform — chart and map cards must not jump on hover.
- Font roles (index.html + tailwind.config): Fraunces = `display`/`serif` + base `h1,h2`; DM Sans = default `sans`; Plus Jakarta = `num`; Cormorant Garamond = `quote`. Outfit is a fallback only.
- Numbers route to Plus Jakarta automatically because `.tabular-nums` / `.num` are mapped to it in index.css — KPI values, tables and year displays should use tabular-nums rather than a hardcoded font class.
- Chrome accent is gold (`--gold`, `text-gold`/`bg-gold`/`.btn-gold`/`.eyebrow`); all `orange-{300,400,500,600}` utility classes were swept to gold across every page. Gold is a GENERIC accent, NOT BJP — BJP's colour is a hex in `colors.ts`.  
  **Why:** Re-introducing orange chrome would read as a party colour.
- PRESERVED as data (never re-skinned as chrome): `colors.ts` party/alliance palette, and data-viz colours — safe/lean/swing, margin bands, the ChangePage "flipped" legend `#f97316`, volatility amber. `MAP_PAL` + `theme.ts` DARK/LIGHT_ECHARTS are the theme-tuned parts.
- `--white` resolves to forest-green in the light theme, so a `bg-white` button (e.g. the Google sign-in CTA) renders as a green CTA in light — intentional, not a bug.
- `useThemeStore` / `useTheme()` live in store.ts, persist to localStorage key `verdix-theme` (default dark), and `main.tsx` sets `data-theme` on <html> pre-paint so there is no flash. `useTheme()` must stay REACTIVE — the Chart wrapper and the map repaint off it.
- `ChoroplethMap` owns `MAP_PAL[dark|light]` (bg/noData/line/hover/stateLine/stateText/seatText/halo) and a `useTheme()`-driven effect that repaints bg/line/hover and re-runs `paint()` on switch; the colours memo must list `themeMode` explicitly in its deps.
- `colors.ts` party/alliance palette is a SINGLE dual-theme set (old neon-light tones were deepened to mid-tones: TDP #eab308, BJD #65a30d, IND #475569). Only greys/tracks/bands that can't satisfy both canvases go theme-aware per-component: ChoroplethMap `MARGIN_BANDS_L/D` + `TURNOUT_BANDS_L/D`, MapPage party-scoreboard `OUT` fill, Trajectory strike-rate track (`faintLine(mode)`).
- `SeatDrawer` uses its own black/neutral palette — a `C` object keyed on `useTheme()` mode (`#000`/`#0c0c0e`/`#141417` + neutral grey text/axes in dark, white in light) — NOT the slate vars, and forces ECharts `axisLabel` to neutral grey.

## Global filter & navigation

_The shared filter spine and nav._

- Any "default this once" ref-guard must key on a REGION-QUALIFIED id (`${state}|${arena}|${year}`) — the election key alone (`arena|year`) does NOT change when you switch All-India→a state, so a state-agnostic guard keeps a stale selection (the Signals alliance bloc showed TN with `INC + TDP`). Same `simKey` pattern defaults the SWOT party.
- The Signals election picker is SINGLE-select in the Party SWOT and Alliance-simulator views (clicking switches the analysed election) and multi-select only in Patterns — a shared multi-select made the SWOT appear not to change because the what-if views analyse only the most recent selected election.
- `/signals` is in `FilterBar`'s `STATE_CENTRIC` set but deliberately NOT in `ARENA_PAGES` — the page owns arena via its own Assemblies/Parliaments/Both Scope toggle, so the global Assembly/Lok-Sabha `Seg` is hidden there.
- Compare is NOT in `FilterBar` `ARENA_PAGES` — its Parties view carries its OWN Assembly/Lok-Sabha and election-year pickers, driving an `activeByState(rows, arena, vy)` snapshot.
- ChangePage is REGION-AWARE: it reads `state` from `useFilters` (all-India → national change with the by-state drill; a picked region → `byState` scoped, map `focusState` + remount `key`, fortresses/churn filtered). `/change` is in `FilterBar` `STATE_CENTRIC` so picking a region updates Change in place instead of bouncing to `/state`.
- ChangePage's `activeYear` falls back to the EARLIEST year below the range (not a jump to latest) when the slider lands outside the data.
- `StatePage` is single-state only: `allIndia` is hard-`false` and `st = state && states.includes(state) ? state : 'Andhra Pradesh'`. `FilterBar` drops "All India" from its Region dropdown ONLY on `/state` (`onStatePage`/`dispState`); every other page keeps All-India. The all-India branches inside StatePage are dead code left in place (harmless).
- `src/store.ts` `useFilters` is the single source of truth for the shared dimensions **{arena, year, state, party}**; every page reads it and renders only PAGE-SPECIFIC controls (compare pickers, margin band, map colour, GE-year, scope toggle, swing slider).
- `FilterBar` owns Region + Arena. Picking a region on a non-state-centric page NAVIGATES to `/state` (a selection must always produce visible movement); on `STATE_CENTRIC` pages it updates in place. The Arena toggle shows only on arena-driven pages (`ARENA_PAGES`); Bypolls keeps its own All/AE/GE toggle (a superset of the global arena) and Trends its own scope.
- StatePage has no local year state — it reads the global `year` CLAMPED to an election the state actually held in that arena. Map/Change sliders write the global `year`.

## Analysis logic

_Metrics, detectors, projections — formulas and magic numbers._

- `detectSignals(ctx: SignalCtx)` in `src/lib/signals.ts` is pure: 7 detectors → `Signal[]` sorted by a severity-weighted score with `SEV = {critical:100, watch:60, note:30}`. `Signal = {id, severity, party, a, headline, soWhat, metric, metricSub?, seats:Seat[], score}`; `SignalCtx = {seats, allRows, partyRows, vy, isState, arena}`.
- Signals detector thresholds (magic numbers): `thinBook` = a party holding ≥12% of its seats by <5% margin; `dividedField` = wins under 40% vote share; `erodingStrongholds` = a stronghold whose margin shrank >5 across its last 2 elections (via `seatHistories`); `momentum` = `linearTrend` r² ≥ 0.5 and |slope| ≥ 1 on vote share; `reservationSkew` = win-rate gap across GEN/SC/ST.
- `efficiencyGap` (concentration-vs-spread) and the alliance simulator need vote-share data, so they return nothing for all-India ASSEMBLY scope; `tippingPoint` only runs in houseMode (a single-state AE or the all-India GE).
- `simulateAlliance(seats, shareOf, bloc, transfer)` in `projections.ts`: a bloc holds its members' seats, and a non-bloc seat flips IN when `transfer × (the OTHER bloc members' statewide vote share) ≥ the losing margin`. It is a FLOOR, not a forecast — seats where the bloc ran 3rd or lower aren't in top-two data.
- `partyStrategy(ctx)` in `src/lib/strategy.ts` degrades gracefully when vote share is absent (all-India AE → seat-based reads only); it derives from strongholds/erosion (`seatHistories`), thin and split-field margins, vote→seat conversion, `linearTrend` momentum, reservation win-rates and rival structure.
- Vote share / strike rate need candidate-vote data, so the party head-to-head (Matchup) shows "–" for all-India ASSEMBLY scope; seats, margins and the territory map still work there.
- Party defaults are DYNAMIC (the largest party in the current view), never hardcoded: Battleground/Trajectory win-quality use `ranked[0]` (by presence), the National scoreboard uses `rankedParties[0]`. Never reintroduce a hardcoded 'INC'/'BJP' default — the app must read symmetric for every party.
- `SeatDrawer` computes everything from the seat's `seatHistories` keyed `state|j` (all years). Its "defining rivalry" only names a pair when that pair recurs ≥2×, else it says "challengers rotate"; the swing math is margin/2 (the swing from winner→runner needed to flip).
- The Change-page net-change drill decomposes `netChange` EXACTLY under the same comparable-only rule, so Σ(states) = the national net. Both drills (net-change bar and retention cell) reset on arena/year change.
- The Change drill's By state / By parliament toggle is ASSEMBLY-ONLY (GE seats ARE parliaments). By-parliament maps each AC→PC via `loadSegments` → `pcByKey` keyed `state::norm(acName)`, latest delimitation wins (the same map as TrajectoryPage win-quality), and the per-group cap lifts to 99 so every seat shows.
- Drill rows carry `{key, label, sub}` from `groupOf`; the by-parliament key must be STATE-QUALIFIED (`${pc}|${state}`) so same-named PCs across states — and the `Unmapped` bucket — split per state instead of merging.
- `analysis.classifyState(rows, state, arena)` classifies each seat over the comparable election window: `safe` = one party won every time, `lean` = ≥60%, else `swing`. It drives the Stronghold & swing card and the map's Safe-vs-Swing colour mode.
- The National map's Alliance colour mode colours each seat by `allianceBase(r.a)` via ALLIANCE_COLORS and shows alliance seat tallies in the legend; the delimitation fallback fill handles it too. State also has a Party | Alliance roll-up toggle on its seats trend.
- The Swingometer is deliberately plain-language, NOT a chart: a sentence ("If N in every 100 votes shift from A→B…") + two before→after bars (faded = now, solid = projected) + per-party delta + the flip-seat list. Logic lives in `insights.swingometer` — a seat flips when margin < 2× swing.
- ⚠ `activeByState(rows, arena, year)` returns each state's latest election **≤ year**. It once demanded an election in EXACTLY that year for GE, so Battleground passing 2026 for Lok Sabha got an empty map and looked broken. Callers may pass ANY year — never re-add an exact-year match for GE.
- In `SeatDrawer`, `prev` must be the election immediately BEFORE `seat.y`, not `hist[len-2]` (the overall second-newest) — otherwise clicking an older-year seat mixes that year with unrelated latest history. The copy reads "holds the seat" only when `seat.y` is the latest election, else "took {year}".
- ALL projection math is pure in `src/lib/projections.ts` so it can be reasoned about/spot-checked independently: `projSeatsAt`/`seatCurve` (uniform-swing "field" model — gains every `q===P` seat within 2·s as s rises, sheds every `p===P` seat within 2·|s| as s falls; monotone), `swingToMajority`, `tippingSeat`, `linearTrend` (least-squares + r², needs ≥3 points), `pedersen`.
- `houseMode = arena==='AE' ? state!=='All states' : state==='All states'` — i.e. a single assembly, or the all-India Lok Sabha, but NOT all-India AE or a single-state GE subset. The majority line on the path-to-control curve only shows in houseMode; non-house shows a reach/exposure curve + net@±5%. Note the sentinel string is `'All states'`.
- National Avg-turnout KPI: the HEADLINE is the mean over the ACTIVE SNAPSHOT (matching the map), falling back to official `state_turnout.json` when seat-level `t` is absent. NEVER compute the headline as a single-year mean — for AE that's only the states that voted that year (≈86% for 2026-only) instead of the 70.7% national snapshot. The sparkline + Δ are GE-ONLY, because a Lok Sabha year is one clean national cycle while AE years mix state sets (avoids headline≠tail confusion).
- `MapPage` `turnoutTrend.stMean` must be SEAT-COUNT-WEIGHTED, not an unweighted state mean — unweighted GE-2024 = 69.6% (skewed by many small high-turnout states) vs weighted 66.8% vs true elector-weighted ECI 65.8%. Seats are a close electorate proxy; hitting 65.8 exactly would need per-state electors.
- ComparePage compares ANY two elections for the focus state (AE×AE, GE×GE, AE×GE) via two `Select`s over `elabels` with a ⇄ swap; each side is parsed from a label key like `AE 2018` / `LS 2024`. "Seats" is put on the same assembly map for both sides — AE = seats won (`wo`), GE = assembly SEGMENTS LED (from `segments.json`) — so a state ballot and a national ballot compare like-for-like.
- The segment-transfer deep-dive renders for CROSS-ARENA (AE×GE) pairs only and is keyed to the GE side's year plus its nearest-AE baseline (`split/{geYear}_{state}.json`, `file.ay`); it is hidden for same-arena pairs.
- Insight chips are heuristics in `lib/insights.ts` — extend there and keep the formulas documented in the UI notes.

## Performance

_Fixes that must not be reverted._

- `vite.config.ts` splits firebase into its own chunk (≈169 KB gzip) so the app chunk stays ≈146 KB gzip.
- `data.ts` caches the IN-FLIGHT PROMISE (not just the resolved value) so concurrent first-paint loaders (FilterBar + page) share ONE fetch+parse of the large JSON; failed fetches evict the entry so they retry. Do not revert this to value-only caching.
- `vite.config` `manualChunks` splits ONLY the two framework-agnostic giants (echarts core + maplibre) into their own chunks (app bundle 2.2 MB → 385 KB / 124 KB gzip). Do NOT also split react/react-router into a separate chunk — that creates a circular vendor↔react chunk; and keep `echarts-for-react` (the wrapper) with the app to avoid an echarts↔app cycle.
- ChangePage builds `seatHistories(rows)` ONCE (`histAll` memo) and threads it into `seatChanges(…, hist?)` (an optional 4th arg, default = build) and the strongholds/churn memo; it used to be rebuilt twice, including on every year-slider tick.
- Caching policy that must not regress: content-hashed `/assets` + `/glyphs` = immutable (1 yr), `/geo` = 1 day, `/data` = 1 hour. A default `max-age=0, must-revalidate` on hashed assets caused a revalidation round-trip per chunk on every load and made the app feel "very slow".

## Access control & misc

_Auth machinery and everything else._

- The super-admin email is a `SUPER_ADMIN` const in `src/lib/auth.tsx` AND is mirrored in `firestore.rules` `isAdmin()` — change both together.
- The allow-list is Firestore `allowed_users/{email}` with doc id = LOWER-CASED email and fields `email`, `addedBy`, `addedAt`; the gate does exactly one `getDoc` of the signed-in user's OWN doc.
- `firestore.rules` is the real security boundary (the UI gate is cosmetic): a user may read only their own doc, only the admin may `list`/`create`/`update`/`delete`, everything else default-deny.
- `AdminPage` (`/admin`) is deliberately NOT in `MODULES` nav — it is reached via the header "Manage users" link in `AccountMenu`, and `App.tsx` renders it chrome-free via `isModulePage`.
- The Firebase web config (apiKey/authDomain/projectId/appId) is PUBLIC and safe in the bundle — access is enforced by rules, not secrecy. It lives in gitignored `.env.local`, documented by `.env.example`. The OAuth client SECRET is never used (a static SPA can't hold one) — keep it for the future Cloud Run/BigQuery API.
- Google sign-in uses `signInWithPopup`; a full-page `signInWithRedirect` was tried and BROKE sign-in — do not "fix" it back.
- When merging signals from several elections, prefix each signal `id` with its election so React keys stay unique, and badge each card with its election.
- `/matchup` is a `<Navigate to="/compare" replace>` — there is no separate Matchup tab; `CompareHub` renders `ComparePage` (elections) or `MatchupPage` (parties) and passes the `Seg` toggle into each view's `StickyControls` so switching swaps the whole view instead of stacking control rows.
- **A grid/flex child needs `min-w-0`, not just `.card { min-width: 0 }`.** Grid and flex items default to `min-width: auto`, so any wide table inside one stretches the whole document. `.card` covers the cards; a **plain wrapper `<div>` used as a grid track does not** — that was the cause of the last three horizontal-overflow bugs (States' close-seats split, Change's map column, Bypolls' right rail). Add `min-w-0` to the track itself.
- **`<Info>` portals its bubble to `<body>` as `position: fixed`, clamped into the viewport, and renders NOTHING while closed.** It used to be an in-flow `absolute` span centred on the glyph, which pushed the page 148px wide at 390px whenever a ⓘ sat near the right edge — an absolutely-positioned child still counts toward the document's scroll area. Any scroll/resize/Esc closes it. If you change the default width off `w-60`, update the `W = 240` constant it clamps with.
- Reusable primitives live in ui.tsx: `.card`, `.glass`, `.kicker`, `.skeleton`+`<Skeleton/>`, `Seg`, `Select`, `KPI` (label/value accept ReactNode, optional `delta` + `spark`), `SortTable` (sortable, searchable, optional `onRowClick`), `Chart`, `Spark`, `Dot`, `Info`, `VoteSeatChart`. `ChartCard` title is a ReactNode so an `<Info>` can sit in a title.
- App shell: sticky blurred header, and route content wrapped in `animate-fadeUp` keyed by pathname.
- `lib/glossary.ts` holds the plain-English definitions (margin, swing, strike rate, stronghold/swing, flippability, friendly fight, pooling, transfer, delimitation, EVM-only, reservation…). When you add a jargon term, add it to glossary.ts and drop an inline `<Info>` ⓘ next to its first use.
- Each page's own toggles/dropdowns sit in a STICKY control bar that freezes under the global FilterBar on scroll (`StickyControls`); they must not float away.
- Deliberately removed from State and not to be re-added silently: the "Alliance arithmetic" pooled-vs-actual card (both arenas), the constituency-grid table and its Export CSV (with the now-unused `gridCols`/`exportCSV`) — clicking any seat/row already opens the full constituency report. If CSV export is wanted back, re-add it to the sticky controls.
- State and Change are cross-linked, not merged: ChangePage header → "Full {region} deep-dive →" (`/state`), StatePage sticky header → "What changed in {st} →" (`/change`) when a state is focused; the region carries via the global filter spine.
- GENERAL RULE: never `.slice(0, N)` a findings list without surfacing the full count/everything — it reads as "that's all there is". Fortresses/Churn were capped at 12 while GE-national actually has 230 fortresses and 246 churn seats; they now render as full `SortTable`s with the count in the title.
- The anti-scrape 403 guard covers `/data` + `/geo` ONLY, NOT `/glyphs` — if you extend it to `/glyphs`, map labels stop rendering.
- `MODULES` in `lib/nav.ts` is the SINGLE source of truth for modules (a flat ordered array with `tab`, `tagline`, `blurb` and a `group` field) — it drives the nav, `PageTagline` and the Prev/Next journey; add a module HERE. Routes in App.tsx are path-keyed so their order is irrelevant. `NAV_GROUPS` derives the menus and `groupOf(path)` highlights the active group.
- `src/components/ErrorBoundary.tsx` wraps `<Routes>` with `resetKey = path`, so one bad view degrades to a recovery card instead of a blank white screen.
- Library map: `lib/data.ts` (loaders; the API SWAP POINT) · `lib/nav.ts` (MODULES) · `store.ts` (useFilters + theme) · `lib/joins.ts` (`DELIM_BREAK` + `comparable()`) · `lib/analysis.ts` (seat histories via normalized `j`, seatChanges, retention, netChange, swing, activeByState, classifyState, allianceBase) · `lib/insights.ts` (majorityCushion, shallow/minority wins, worstDefence, flipConcentration, swingometer) · `lib/theme.ts` (`voteSeatOption`, `vgrad`) · `lib/colors.ts` (single colour truth) · `lib/glossary.ts`.
- Leader Tracker (wireframe screen 7) stays blocked on the name-curation pass — `leader_key` spelling variants (see the metrics catalog).
- API SWAP POINT: after the BigQuery load, replace the BODIES in `lib/data.ts` with `fetch(import.meta.env.VITE_API_URL + '/...')` and keep the types identical. Endpoint spec is at the bottom of `../12_dashboard_wireframes.md`; the heavy queries are already defined in `../bq/ddl.sql`.
- Hard rules: all colours only via `lib/colors.ts`; all filters only via `store.ts`; URL-sync filters when adding new ones.
