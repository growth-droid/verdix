// Build the 2004 overlay extract (GE 2004 + the six 2004-cycle assembly elections) from the
// datameet/india-election-data candidate-wise CSVs (ECI-derived). ADDITIVE app-lane overlay:
// writes public/data/overlay_2004.json which data.ts merges at load — the Cowork workbooks,
// bq_export and build_extracts.py are untouched (regeneration cannot wipe this).
//
//   node tools/build_2004_overlay.mjs <dir-with-parliament.csv+assembly.csv>
//
// Conventions honoured (India Elections/CLAUDE.md):
//  1. State_Current: old-delimitation Telangana-region seats → "Telangana"; J&K's LADAKH PC →
//     "Ladakh"; ORISSA→Odisha, NCT OF DELHI→Delhi, A&N→Andaman & Nicobar Islands, and the
//     merged "Dadra & Nagar Haveli and Daman & Diu" UT.
//  2. 2004 is a DIFFERENT delimitation (pre-2008): j is offset +1000 so no seat chains into the
//     2009+ continuity domain; AE comparability breaks are declared in joins.ts.
//  3. Party codes canonicalised to the app's codes (ADMK→AIADMK, CPI(M)→CPM, …).
//  4. 2004-specific pre-poll alliances (researched): NDA-2004 (BJP, SHS, JD(U), BJD, SAD,
//     AIADMK, TDP, AITC, INLD, MNF, NPF, SDF, IFDP) → "BJP Alliance (NDA)"; the Congress-side
//     seat pacts (INC, RJD, LJP, NCP, DMK, PMK, MDMK, TRS, JMM, IUML, KEC(M), PDP, RPI(A), MUL)
//     → "INC Alliance (UPA)"; CPM/CPI/RSP/AIFB → "Left Front" EXCEPT where they were inside an
//     INC pre-poll pact (TN DPA; the AP-2004 assembly pact) — state overrides below.
import fs from 'fs'
import path from 'path'

const SRC = process.argv[2] || '.'
const OUT = path.join('public', 'data', 'overlay.json')

// ── 2026 by-elections missing from the June-2026 data refresh (verified from press/ECI
// reporting, Aug 2026). Existing convention: mo = POLLING month; v/m null where official
// shares aren't published; n = official AC number where known.
const BYPOLLS_2026 = [
  // April-cycle round (counted 4 May 2026) — 5 of its 8 seats are already in bypolls.json;
  // Ponda (Goa) was CANCELLED before polling (deliberately absent).
  { arena: 'AE', s: 'Karnataka', y: 2026, mo: 4, n: null, c: 'DAVANAGERE SOUTH', r: null, p: 'INC', a: 'INC Alliance', w: 'Samarth Mallikarjun', v: null, m: null, prev: 'INC', ret: 'Y', cause: 'Died' },
  { arena: 'AE', s: 'Maharashtra', y: 2026, mo: 4, n: null, c: 'RAHURI', r: null, p: 'BJP', a: 'BJP Alliance', w: 'Akshay Kardile', v: null, m: null, prev: 'BJP', ret: 'Y', cause: 'Died' },
  // July-30 round (counted 3 Aug 2026)
  { arena: 'AE', s: 'Madhya Pradesh', y: 2026, mo: 7, n: 22, c: 'DATIA', r: null, p: 'INC', a: 'INC Alliance', w: 'Ghanshyam Singh', v: 42.39, m: 3.82, prev: 'INC', ret: 'Y', cause: 'Disqualified (conviction)' },
  { arena: 'AE', s: 'Bihar', y: 2026, mo: 7, n: 182, c: 'BANKIPUR', r: null, p: 'JSP', a: 'Unaligned', w: 'Prashant Kishor', v: null, m: null, prev: 'BJP', ret: 'N', cause: 'Elected to Rajya Sabha' },
  { arena: 'AE', s: 'Gujarat', y: 2026, mo: 7, n: 145, c: 'MANJALPUR', r: null, p: 'BJP', a: 'BJP Alliance', w: 'Satish Patel', v: null, m: null, prev: 'BJP', ret: 'Y', cause: 'Died' },
]

// ── tiny CSV parser (handles quoted fields) ──
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (cell !== '' || row.length) { row.push(cell); rows.push(row); row = []; cell = '' } }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  const h = rows[0]
  return rows.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])))
}

const tc = s => (s || '').toLowerCase().replace(/(^|[\s(\-./'])([a-z])/g, (_, a, b) => a + b.toUpperCase()).trim()

// ── state normalisation (CSV name → the app's State_Current name) ──
const STATE = {
  'A&N ISLANDS': 'Andaman & Nicobar Islands', 'ANDHRA PRADESH': 'Andhra Pradesh', 'ARUNACHAL PRADESH': 'Arunachal Pradesh',
  'ASSAM': 'Assam', 'BIHAR': 'Bihar', 'CHANDIGARH': 'Chandigarh', 'CHHATTISGARH': 'Chhattisgarh',
  'D&N HAVELI': 'Dadra & Nagar Haveli and Daman & Diu', 'DAMAN & DIU': 'Dadra & Nagar Haveli and Daman & Diu',
  'GOA': 'Goa', 'GUJARAT': 'Gujarat', 'HARYANA': 'Haryana', 'HIMACHAL PRADESH': 'Himachal Pradesh',
  'JAMMU & KASHMIR': 'Jammu & Kashmir', 'JHARKHAND': 'Jharkhand', 'KARNATAKA': 'Karnataka', 'KERALA': 'Kerala',
  'LAKSHADWEEP': 'Lakshadweep', 'MADHYA PRADESH': 'Madhya Pradesh', 'MAHARASHTRA': 'Maharashtra', 'MANIPUR': 'Manipur',
  'MEGHALAYA': 'Meghalaya', 'MIZORAM': 'Mizoram', 'NAGALAND': 'Nagaland', 'NCT OF DELHI': 'Delhi', 'ORISSA': 'Odisha',
  'PUDUCHERRY': 'Puducherry', 'PUNJAB': 'Punjab', 'RAJASTHAN': 'Rajasthan', 'SIKKIM': 'Sikkim', 'TAMIL NADU': 'Tamil Nadu',
  'TRIPURA': 'Tripura', 'UTTAR PRADESH': 'Uttar Pradesh', 'UTTARAKHAND': 'Uttarakhand', 'WEST BENGAL': 'West Bengal',
  // assembly.csv uses title case already
  'Andhra Pradesh': 'Andhra Pradesh', 'Arunachal Pradesh': 'Arunachal Pradesh', 'Karnataka': 'Karnataka',
  'Maharashtra': 'Maharashtra', 'Orissa': 'Odisha', 'Sikkim': 'Sikkim',
}

// Old-delimitation Telangana-region Lok Sabha PCs (16 of undivided AP's 42; CSV spellings).
// Bhadrachalam PC = old Khammam district (Telangana region); Mahabubnagar spelt with the A.
const TG_PCS_2004 = new Set(['ADILABAD', 'PEDDAPALLI', 'KARIMNAGAR', 'NIZAMABAD', 'MEDAK', 'HANAMKONDA', 'WARANGAL',
  'KHAMMAM', 'BHADRACHALAM', 'NALGONDA', 'MIRYALGUDA', 'NAGARKURNOOL', 'MAHABUBNAGAR', 'HYDERABAD', 'SECUNDERABAD', 'SIDDIPET'])

// ── party canonicalisation (ECI 2004 codes → app codes) ──
const CANON = {
  ADMK: 'AIADMK', 'AC': 'AC', 'CPI(M)': 'CPM', CPM: 'CPM', 'CPI(ML)(L)': 'CPI(ML)L', 'CPI(ML)L': 'CPI(ML)L',
  JD: 'JD(U)', 'JD(U)': 'JD(U)', 'JD(S)': 'JD(S)', LJNSP: 'LJP', LJSP: 'LJP', 'SHS': 'SHS', 'TRC': 'TRC',
  MUL: 'IUML', 'IUML': 'IUML', 'KEC(M)': 'KEC(M)', 'JKN': 'JKNC', 'JKNC': 'JKNC', 'PDP': 'JKPDP', 'JKPDP': 'JKPDP',
  'NLP': 'NLP', 'AITC': 'AITC', 'TDP': 'TDP', 'TRS': 'BRS', 'BRS': 'BRS', 'RSP': 'RSP', 'AIFB': 'AIFB', 'FBL': 'AIFB',
  'INLD': 'INLD', 'SDF': 'SKM' /* no: SDF is SDF */,
}
delete CANON.SDF // SDF stays SDF
const canon = p => CANON[p] ?? p

// ── 2004 alliance rules ──
const NDA04 = new Set(['BJP', 'SHS', 'JD(U)', 'BJD', 'SAD', 'AIADMK', 'TDP', 'AITC', 'INLD', 'MNF', 'NPF', 'IFDP', 'SDF'])
const INC04 = new Set(['INC', 'RJD', 'LJP', 'NCP', 'DMK', 'PMK', 'MDMK', 'BRS', 'JMM', 'IUML', 'KEC(M)', 'JKPDP', 'RPI(A)', 'MUL'])
const LEFT = new Set(['CPM', 'CPI', 'RSP', 'AIFB'])
function allianceOf(party, state, arena) {
  // state overrides where Left sat inside an INC pre-poll pact in 2004
  if (LEFT.has(party)) {
    if (state === 'Tamil Nadu') return 'INC Alliance (DPA)'                       // DPA swept TN
    if (arena === 'AE' && (state === 'Andhra Pradesh' || state === 'Telangana')) return 'INC Alliance'  // INC+TRS+Left pact
    return 'Left Front'
  }
  if (NDA04.has(party)) return 'BJP Alliance (NDA)'
  if (INC04.has(party)) return 'INC Alliance (UPA)'
  return 'Unaligned'
}

// ── load sources ──
const parl = parseCSV(fs.readFileSync(path.join(SRC, 'parliament.csv'), 'utf8')).filter(r => r.YEAR === '2004')
const assy = parseCSV(fs.readFileSync(path.join(SRC, 'assembly.csv'), 'utf8')).filter(r => r.YEAR === '2004')

// group candidate rows into seats
function buildSeats(rows, opts) {
  const seats = new Map()
  rows.forEach(r => {
    const k = opts.key(r)
    if (!seats.has(k)) seats.set(k, [])
    seats.get(k).push(r)
  })
  const out = []
  let seq = new Map() // per-state sequence for GE n
  for (const [k, cands] of seats) {
    cands.sort((a, b) => (+b.VOTES || 0) - (+a.VOTES || 0))
    const tot = cands.reduce((s, c) => s + (+c.VOTES || 0), 0)
    const unopposed = tot === 0 && cands.length >= 1   // blank votes = uncontested win (e.g. SK/AR 2004)
    if (!tot && !unopposed) continue
    const w = cands[0], ru = unopposed ? undefined : cands[1]
    const stRaw = opts.state(w)
    let s = STATE[stRaw] ?? tc(stRaw)
    const cName = opts.seat(w).toUpperCase()
    // State_Current back-mapping
    if (opts.arena === 'GE') {
      if (s === 'Andhra Pradesh' && TG_PCS_2004.has(cName)) s = 'Telangana'
      if (s === 'Jammu & Kashmir' && cName === 'LADAKH') s = 'Ladakh'
    }
    let n
    if (opts.arena === 'GE') { const c = (seq.get(stRaw) ?? 0) + 1; seq.set(stRaw, c); n = c }
    else n = +w.AC_NO
    const p = canon(w.PARTY), q = ru ? canon(ru.PARTY) : null
    const v = unopposed ? null : +(100 * (+w.VOTES) / tot).toFixed(2)
    const m = unopposed || !ru ? null : +(100 * ((+w.VOTES) - (+ru.VOTES)) / tot).toFixed(2)
    // turnout (GE only — parliament.csv has ELECTORS)
    let t = null
    if (opts.arena === 'GE' && +w.ELECTORS > 0) t = +(100 * tot / +w.ELECTORS).toFixed(2)
    // reservation: AE has AC_TYPE; GE derived — all candidates SC → SC seat, all ST → ST
    let r = null
    if (opts.arena === 'AE') r = w.AC_TYPE || 'GEN'
    else {
      const cats = new Set(cands.map(c => c.CATEGORY).filter(Boolean))
      r = cats.size === 1 && cats.has('SC') ? 'SC' : cats.size === 1 && cats.has('ST') ? 'ST' : 'GEN'
    }
    out.push({
      s, y: 2004, n, j: 1000 + n, c: cName, r,
      p, a: allianceOf(p, s, opts.arena), w: tc(w.NAME), v,
      q, qn: ru ? tc(ru.NAME) : null, m, t,
      _st: stRaw, _tot: tot, _wv: +w.VOTES, _el: +w.ELECTORS || 0,
    })
  }
  return out
}

const geSeats = buildSeats(parl, { arena: 'GE', key: r => r.STATE + '|' + r.PC, state: r => r.STATE, seat: r => r.PC })
const aeSeats = buildSeats(assy, { arena: 'AE', key: r => r.ST_NAME + '|' + r.AC_NO, state: r => r.ST_NAME, seat: r => r.AC_NAME })

// ── AP 2004 → Telangana back-mapping (old delimitation ≠ the post-2008 "AC≤119" rule) ──
// Assign by name-match against the CURRENT Telangana/AP constituency name sets (the 2008
// delimitation kept most names), then fill unmatched seats from their numeric neighbours
// (old numbering is geographically contiguous by district). Validated against the known
// old-Telangana size (107 of undivided AP's 294).
{
  const cur = JSON.parse(fs.readFileSync(path.join('public', 'data', 'seats_ae.json'), 'utf8'))
  const tgNames = new Set(cur.filter(r => r.s === 'Telangana').map(r => r.c.toUpperCase()))
  const apNames = new Set(cur.filter(r => r.s === 'Andhra Pradesh').map(r => r.c.toUpperCase()))
  const ap04 = aeSeats.filter(r => r.s === 'Andhra Pradesh').sort((a, b) => a.n - b.n)
  const assign = new Map() // n -> 'TG' | 'AP' | null
  ap04.forEach(r => {
    const inTG = tgNames.has(r.c), inAP = apNames.has(r.c)
    assign.set(r.n, inTG && !inAP ? 'TG' : inAP && !inTG ? 'AP' : null)
  })
  // neighbour fill (up to 3 passes): unresolved seats take the nearest resolved neighbour by AC no
  for (let pass = 0; pass < 3; pass++) {
    ap04.forEach(r => {
      if (assign.get(r.n)) return
      for (let d = 1; d <= 4; d++) {
        const lo = assign.get(r.n - d), hi = assign.get(r.n + d)
        if (lo && hi && lo !== hi) continue           // conflicting neighbours — try wider
        const pick = lo || hi
        if (pick) { assign.set(r.n, pick); return }
      }
    })
  }
  let tg = 0, un = []
  ap04.forEach(r => {
    const a = assign.get(r.n)
    if (a === 'TG') { r.s = 'Telangana'; tg++ }
    else if (!a) un.push(`${r.n}:${r.c}`)
  })
  console.log(`AP-2004 → TG back-map: ${tg} Telangana / ${ap04.length - tg} AP | unresolved: ${un.length}${un.length ? ' → ' + un.join(', ') : ''}`)
}

// ── party aggregates ──
function partyAgg(candRows, seatRows, opts) {
  // votes by state×party (vote share), fought & won counts — keyed to State_Current via the seat rows
  const stateOf = new Map(seatRows.map(r => [opts.seatId(r), r.s]))
  const votes = new Map(), tot = new Map(), fought = new Map(), won = new Map(), aOf = new Map()
  candRows.forEach(r => {
    const sid = opts.candSeatId(r)
    const s = stateOf.get(sid); if (!s) return
    const p = canon(r.PARTY), v = +r.VOTES || 0
    votes.set(s + '|' + p, (votes.get(s + '|' + p) || 0) + v)
    tot.set(s, (tot.get(s) || 0) + v)
    fought.set(s + '|' + p, (fought.get(s + '|' + p) || 0) + 1)
  })
  seatRows.forEach(r => { won.set(r.s + '|' + r.p, (won.get(r.s + '|' + r.p) || 0) + 1); aOf.set(r.p, r.a) })
  const out = []
  for (const [k, f] of fought) {
    const [s, p] = k.split('|')
    out.push({ s, y: 2004, p, a: aOf.get(p) ?? allianceOf(p, s, opts.arena), f, wo: won.get(k) || 0, v: +((100 * (votes.get(k) || 0)) / (tot.get(s) || 1)).toFixed(2) })
  }
  return out.sort((x, y) => x.s.localeCompare(y.s) || y.wo - x.wo)
}
const geParty = partyAgg(parl, geSeats, { arena: 'GE', seatId: r => r._st + '|' + r.c, candSeatId: r => r.STATE + '|' + r.PC.toUpperCase() })
const aeParty = partyAgg(assy, aeSeats, { arena: 'AE', seatId: r => r._st + '|' + r.n, candSeatId: r => r.ST_NAME + '|' + (+r.AC_NO) })

// national GE aggregate
const natVotes = new Map(), natF = new Map(), natW = new Map()
let natTot = 0
parl.forEach(r => { const p = canon(r.PARTY); const v = +r.VOTES || 0; natVotes.set(p, (natVotes.get(p) || 0) + v); natTot += v; natF.set(p, (natF.get(p) || 0) + 1) })
geSeats.forEach(r => natW.set(r.p, (natW.get(r.p) || 0) + 1))
const geNat = [...natF.entries()].map(([p, f]) => ({ y: 2004, p, a: allianceOf(p, 'IN', 'GE'), f, wo: natW.get(p) || 0, v: +((100 * (natVotes.get(p) || 0)) / natTot).toFixed(2) })).sort((a, b) => b.wo - a.wo || b.v - a.v)

// GE state turnout (sum votes / sum electors per State_Current)
const elByState = new Map(), vByState = new Map()
for (const seat of geSeats) {
  if (seat._el > 0) { elByState.set(seat.s, (elByState.get(seat.s) || 0) + seat._el); vByState.set(seat.s, (vByState.get(seat.s) || 0) + seat._tot) }
}
const geTurnout = {}
for (const [s, el] of elByState) geTurnout[`${s}|2004`] = +((100 * (vByState.get(s) || 0)) / el).toFixed(1)

// ae_index rows (one per 2004 assembly election, State_AsThen naming)
const AE_STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Karnataka', 'Maharashtra', 'Odisha', 'Sikkim']
const aeIndex = AE_STATES.map(st => {
  const seats = aeSeats.filter(r => (st === 'Andhra Pradesh' ? (r.s === 'Andhra Pradesh' || r.s === 'Telangana') : r.s === st))
  const tally = new Map(); seats.forEach(r => tally.set(r.p, (tally.get(r.p) || 0) + 1))
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['–', 0]
  return { State_AsThen: st, Election_Year: 2004, Seats: seats.length, Turnout_Pct: null, Leading_Party: top[0], Leading_Party_Seats: top[1] }
})

// strip build-only fields
const clean = r => { const { _st, _tot, _wv, _el, ...rest } = r; return rest }

const overlay = {
  built: '2004 elections from datameet/india-election-data (ECI-derived candidate CSVs) + 2026 bypoll updates',
  seats_ge: geSeats.map(clean), seats_ae: aeSeats.map(clean),
  party_ge_state: geParty, party_ge_nat: geNat, party_ae: aeParty,
  ge_turnout: geTurnout, ae_index: aeIndex, bypolls: BYPOLLS_2026,
}
fs.writeFileSync(OUT, JSON.stringify(overlay))
console.log('WROTE', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB')

// ── validation report ──
const tally = arr => { const m = new Map(); arr.forEach(r => m.set(r.p, (m.get(r.p) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]) }
console.log('\nGE 2004:', geSeats.length, 'seats | AP split:', geSeats.filter(r => r.s === 'Andhra Pradesh').length, 'AP +', geSeats.filter(r => r.s === 'Telangana').length, 'TG | Ladakh:', geSeats.filter(r => r.s === 'Ladakh').length)
console.log('GE top winners:', tally(geSeats).slice(0, 12).map(([p, n]) => p + ' ' + n).join(', '))
for (const st of AE_STATES) {
  const seats = aeSeats.filter(r => (st === 'Andhra Pradesh' ? (r.s === 'Andhra Pradesh' || r.s === 'Telangana') : r.s === st))
  console.log(`AE ${st}: ${seats.length} seats |`, tally(seats).slice(0, 5).map(([p, n]) => p + ' ' + n).join(', '))
}
console.log('\nGE nat turnout check: total votes', natTot.toLocaleString(), '| INC nat v%', geNat.find(r => r.p === 'INC')?.v, '| BJP', geNat.find(r => r.p === 'BJP')?.v)
