#!/usr/bin/env python3
"""
Official AC -> 2008-delimitation district lists for Gujarat, Haryana, Himachal Pradesh, Karnataka, Kerala
(group g2), parsed from TABLE/PART A of the ECI "Delimitation of Parliamentary and Assembly Constituencies
Order, 2008" (English), plus a 2008-district -> Census-2011 district-code lineage table.

Outputs (next to this script):
  <slug>_acs.csv        state,ac_no,ac_name,district_2008,source,page,note
  <slug>_districts.csv  state,district_2008,continuing_2011_code,carved_2011_codes,note
  g2_validation.txt     every check run (counts, contiguity, reservation totals, app-name agreement,
                        census-code coverage, extent-vs-2011-sub-district cross-check)

Inputs (read only):
  ../ac_district_lists/raw/eci_delimitation_order_2008_english.pdf   the order (572 pp.)
  ../pca/pca_district_2011.csv                                       Census 2011 districts (tru == 'Total')
  ../boundaries/subdistricts/2011-IndiaStateDistSbDist-0000.xlsx     Census 2011 sub-district list (optional
                                                                     cross-check of the lineage table)
  ../../../../public/data/seats_ae.json                              the app's ECI-results seat names

Method: PyMuPDF rawdict.  Each PDF text LINE is classed as "Sl. No. & Name" column when it starts left of a
per-state x threshold, else "Extent" column; lines are then grouped into visual rows.  A row whose text is a
"<n> - DISTRICT : <NAME>" heading sets the current district; a name-column row starting with a number opens
a new AC; other name-column rows continue a wrapped name ("(SC)", "Chikkanayaka-" / "nahalli").
ac_name = name as printed without the "(SC)"/"(ST)" suffix (kept in note as reserved=SC/ST).
page = 1-based PDF page (= printed page number + 1; printed numbers equal 0-based PDF indexes in this file).

Run:  python build_g2_gj_hr_hp_ka_kl.py        (needs PyMuPDF; pandas+openpyxl for the optional cross-check)
"""
import csv, difflib, json, os, re, sys
from collections import Counter, OrderedDict, defaultdict

import fitz  # PyMuPDF

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = os.path.normpath(os.path.join(HERE, '..', 'ac_district_lists', 'raw', 'eci_delimitation_order_2008_english.pdf'))
PCA = os.path.normpath(os.path.join(HERE, '..', 'pca', 'pca_district_2011.csv'))
SUBDIST = os.path.normpath(os.path.join(HERE, '..', 'boundaries', 'subdistricts', '2011-IndiaStateDistSbDist-0000.xlsx'))
APP_SEATS = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', 'public', 'data', 'seats_ae.json'))

REPL = chr(0xFFFD)                       # the order's en-dashes extract as U+FFFD
DASHES = REPL + chr(0x2013) + chr(0x2014)

# state -> schedule (roman), 0-based page span (Table A + Table B), name-column x threshold, expected ACs,
# reserved totals (Schedule II of the order), app comparison year (first post-2008 AE in seats_ae.json),
# Census 2011 state name, Census 2011 state code
STATES = OrderedDict([
    ('Gujarat', dict(sched='IX', pages=(115, 147), xthr=175, n=182, sc=13, st=27, year=2012, c11='GUJARAT')),
    ('Haryana', dict(sched='X', pages=(148, 157), xthr=180, n=90, sc=17, st=0, year=2009, c11='HARYANA')),
    ('Himachal Pradesh', dict(sched='XI', pages=(158, 164), xthr=195, n=68, sc=17, st=3, year=2012,
                              c11='HIMACHAL PRADESH')),
    ('Karnataka', dict(sched='XIV', pages=(175, 208), xthr=222, n=224, sc=36, st=15, year=2013, c11='KARNATAKA')),
    ('Kerala', dict(sched='XV', pages=(209, 225), xthr=205, n=140, sc=14, st=2, year=2011, c11='KERALA')),
])

# ------------------------------------------------------------------ 2008 district -> Census 2011 lineage
# (district_2008 exactly as the order's heading, continuing 2011 code, carved 2011 codes, note)
# Every carve-out below is confirmed by the Census 2011 sub-district list: the carved district's 2011
# sub-districts are exactly the parent's taluks/tehsils named in the order's extents (checked in code).
LINEAGE = {
    'Gujarat': [
        ('KACHCHH', '468', '', ''), ('BANASKANTHA', '469', '', 'Census 2011 spelling Banas Kantha'),
        ('PATAN', '470', '', ''), ('MAHESANA', '471', '', ''),
        ('SABARKANTHA', '472', '', 'Census 2011 spelling Sabar Kantha'), ('GANDHINAGAR', '473', '', ''),
        ('AHMEDABAD', '474', '', 'Census 2011 spelling Ahmadabad (Botad, 2013, is post-census)'),
        ('SURENDRANAGAR', '475', '', ''), ('RAJKOT', '476', '', ''), ('JAMNAGAR', '477', '', ''),
        ('PORBANDAR', '478', '', ''), ('JUNAGADH', '479', '', ''), ('AMRELI', '480', '', ''),
        ('BHAVNAGAR', '481', '', ''), ('ANAND', '482', '', ''), ('KHEDA', '483', '', ''),
        ('PANCHMAHALS', '484', '', 'Census 2011 spelling Panch Mahals'),
        ('DAHOD', '485', '', 'Census 2011 spelling Dohad'), ('VADODARA', '486', '', ''),
        ('NARMADA', '487', '', ''), ('BHARUCH', '488', '', ''),
        ('SURAT', '492', '493',
         'Tapi (493) was formed in 2007 out of Surat talukas (Wikipedia: Tapi district); the order still lists '
         'its area under SURAT: AC 171 Vyara (Vyara taluka), AC 172 Nizar (Nizar, Uchchhal, part Songadh) and '
         'parts of AC 170 Mahuva (Valod taluka) and AC 157 Mandvi (part Songadh). Census 2011 Tapi sub-districts '
         '= Nizar, Uchchhal, Songadh, Vyara, Valod'),
        ('DANGS', '489', '', 'Census 2011 spelling The Dangs'), ('NAVSARI', '490', '', ''), ('VALSAD', '491', '', ''),
    ],
    'Haryana': [
        ('PANCHKULA', '069', '', ''), ('AMBALA', '070', '', ''), ('YAMUNANAGAR', '071', '', ''),
        ('KURUKSHETRA', '072', '', ''), ('KAITHAL', '073', '', ''), ('KARNAL', '074', '', ''),
        ('PANIPAT', '075', '', ''), ('SONIPAT', '076', '', ''), ('JIND', '077', '', ''), ('FATEHABAD', '078', '', ''),
        ('SIRSA', '079', '', ''), ('HISAR', '080', '', ''), ('BHIWANI', '081', '', ''), ('ROHTAK', '082', '', ''),
        ('JHAJJAR', '083', '', ''), ('MAHENDRAGARH', '084', '', ''), ('REWARI', '085', '', ''),
        ('GURGAON', '086', '087',
         'Mewat (087; now Nuh) created 4-Apr-2005 from Gurgaon + the Hathin sub-division of Faridabad (Wikipedia: '
         'Nuh district); the order (2001-census district frame) still lists ACs 79 Nuh, 80 Ferozepur Jhirka, '
         '81 Punahana and the Taoru tehsil of AC 78 Sohna under GURGAON. Census 2011 Mewat sub-districts = '
         'Taoru, Nuh, Ferozepur Jhirka, Punahana (all ex-Gurgaon)'),
        ('FARIDABAD', '088', '089',
         'Palwal (089) became a district on 15-Aug-2008, separated from Faridabad (tehsils Palwal, Hodal, Hathin; '
         'Wikipedia: Palwal district): ACs 82 Hathin, 83 Hodal, 84 Palwal and part of 85 Prithla. Mewat (087) is '
         'NOT listed: its 2005 share of Faridabad (Hathin) moved to Palwal in 2008, and Census 2011 Mewat has no '
         'ex-Faridabad sub-district'),
    ],
    'Himachal Pradesh': [
        ('CHAMBA', '023', '', ''), ('KANGRA', '024', '', ''),
        ('LAHAUL & SPITI', '025', '', 'Census 2011 spelling Lahul & Spiti'), ('KULLU', '026', '', ''),
        ('MANDI', '027', '', ''), ('HAMIRPUR', '028', '', ''), ('UNA', '029', '', ''), ('BILASPUR', '030', '', ''),
        ('SOLAN', '031', '', ''), ('SIRMOUR', '032', '', 'Census 2011 spelling Sirmaur'), ('SHIMLA', '033', '', ''),
        ('KINNAUR', '034', '', ''),
    ],
    'Karnataka': [
        ('BELGAUM', '555', '', ''), ('BAGALKOT', '556', '', ''), ('BIJAPUR', '557', '', ''),
        ('GULBARGA', '579', '580',
         'Yadgir (580) carved out of Gulbarga as the 30th district (Wikipedia: Yadgir district, 2009-10; it is in '
         'Census 2011): ACs 36 Shorapur, 37 Shahapur, 38 Yadgir, 39 Gurmitkal. Census 2011 Yadgir sub-districts = '
         'Shorapur, Shahpur, Yadgir'),
        ('BIDAR', '558', '', ''), ('RAICHUR', '559', '', ''), ('KOPPAL', '560', '', ''), ('GADAG', '561', '', ''),
        ('DHARWAD', '562', '', ''), ('UTTARA KANNADA', '563', '', ''), ('HAVERI', '564', '', ''),
        ('BELLARY', '565', '', ''), ('CHITRADURGA', '566', '', ''),
        ('DAVANAGERE', '567', '', 'Harapanahalli taluk (ACs 103-104) was still in Davanagere in 2011 (moved to '
                                  'Ballari only in 2018)'),
        ('SHIMOGA', '568', '', ''), ('UDUPI', '569', '', ''),
        ('CHICKMAGALUR', '570', '', 'Census 2011 spelling Chikmagalur'), ('TUMKUR', '571', '', ''),
        ('KOLAR', '581', '582',
         'Chikkaballapura (582) carved out of Kolar on 23-Aug-2007 (Wikipedia: Chikkaballapur district): ACs '
         '139 Gauribidanur, 140 Bagepalli, 141 Chikkaballapur, 142 Sidlaghatta, 143 Chintamani. Census 2011 '
         'sub-districts = Gauribidanur, Chikkaballapura, Gudibanda, Bagepalli, Sidlaghatta, Chintamani'),
        ('BANGALORE', '572', '', 'Census 2011 name Bangalore (Bangalore Urban)'),
        ('BANGALORE RURAL', '583', '584',
         'Ramanagara (584) carved out of Bangalore Rural on 23-Aug-2007 (Wikipedia: Ramanagara district): ACs '
         '182 Magadi, 183 Ramanagaram, 184 Kanakapura, 185 Channapatna, plus the Solur circle of Magadi taluk '
         'inside AC 181 Nelamangala. Census 2011 sub-districts = Magadi, Ramanagara, Channapatna, Kanakapura'),
        ('MANDYA', '573', '', ''), ('HASSAN', '574', '', ''), ('DAKSHINA KANNADA', '575', '', ''),
        ('KODAGU', '576', '', ''), ('MYSORE', '577', '', ''), ('CHAMARAJANAGAR', '578', '', ''),
    ],
    'Kerala': [
        ('KASARAGOD', '588', '', ''), ('KANNUR', '589', '', ''), ('WAYANAD', '590', '', ''),
        ('KOZHIKODE', '591', '', ''), ('MALAPPURAM', '592', '', ''), ('PALAKKAD', '593', '', ''),
        ('THRISSUR', '594', '', ''), ('ERNAKULAM', '595', '', ''), ('IDUKKI', '596', '', ''),
        ('KOTTAYAM', '597', '', ''), ('ALAPPUZHA', '598', '', ''), ('PATHANAMTHITTA', '599', '', ''),
        ('KOLLAM', '600', '', ''), ('THIRUVANANTHAPURAM', '601', '', ''),
    ],
}

LOG = []


def log(msg=''):
    LOG.append(msg)
    print(msg)


def check(name, ok, detail=''):
    log(('OK   ' if ok else 'FAIL ') + name + (' | ' + str(detail) if detail != '' else ''))
    return ok


def slug(s):
    return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')


# ------------------------------------------------------------------ PDF helpers
def join_chars(cs, gap=2.0):
    s, px = '', None
    for _, x0, x1, c in cs:
        if px is not None and x0 - px > gap and not s.endswith(' ') and c != ' ':
            s += ' '
        s += c
        px = x1
    return s.strip()


def clean(s):
    for d in DASHES + chr(0xAD):
        s = s.replace(d, '-')
    s = re.sub(r'\s*-\s*', '-', s)
    return re.sub(r'\s+', ' ', s).strip()


def split_res(name):
    m = re.search(r'\s*\(\s*(SC|ST)\s*\)\s*$', name)
    return (name[:m.start()].strip(), m.group(1)) if m else (name.strip(), '')


def norm(s):
    """Comparison key: uppercase-insensitive, (SC)/(ST) stripped, letters only."""
    s = re.sub(r'\(\s*(sc|st)\s*\)', '', s.lower())
    return re.sub(r'[^a-z]', '', s)


HEAD_RE = re.compile(r'^\s*\d{1,2}\s*[-.' + DASHES + r']?\s*DISTRICT\s*[:\-.]?\s*(.+?)\s*$', re.I)
AC_RE = re.compile(r'^\s*(\d{1,3})\s*[-.' + DASHES + r']?\s*(.*)$')
PART_A = re.compile(r'(PART|TABLE)\s*[-' + DASHES + r']?\s*A\b')
PART_B = re.compile(r'(PART|TABLE)\s*[-' + DASHES + r']?\s*B\b')


def line_rows(page, xthr, ytol=3, colgap=7.0):
    """Visual rows of a page, each split into [y, name-column chars, extent-column chars].

    Classification is per PDF text LINE (rawdict), not per character: a line that starts left of xthr is
    the "Sl. No. & Name" column even when it overruns the column edge ('134-Thiruvananthapuram' ends at
    x=223 while the Kerala extent column starts at x=212 on the same baseline).  A name line that
    swallowed extent text (e.g. '59. Bawani Khera (SC)' + 'PCs ...', gap 11pt) is cut at the first gap
    >= colgap that lands at/after xthr-10."""
    items = []
    for b in page.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            cs = []
            for sp in l['spans']:
                for c in sp['chars']:
                    x0, y0, x1, y1 = c['bbox']
                    cs.append((round((y0 + y1) / 2), x0, x1, c['c']))
            vis = [c for c in cs if c[3].strip()]
            if not vis:
                continue
            cs.sort(key=lambda t: t[1])
            ym = round(sum(c[0] for c in cs) / len(cs))
            if vis[0][1] < xthr:
                name, ext, last = [], [], None  # last = right edge of the last visible name char
                for c in cs:
                    if ext or (last is not None and c[3].strip() and c[1] >= xthr - 10 and c[1] - last >= colgap):
                        ext.append(c)
                    else:
                        name.append(c)
                        if c[3].strip():
                            last = c[2]
                items.append((ym, name, ext))
            else:
                items.append((ym, [], cs))
    items.sort(key=lambda t: t[0])
    rows = []
    for ym, name, ext in items:
        if rows and abs(rows[-1][0] - ym) <= ytol:
            rows[-1][1].extend(name)
            rows[-1][2].extend(ext)
        else:
            rows.append([ym, list(name), list(ext)])
    for r in rows:
        r[1].sort(key=lambda t: t[1])
        r[2].sort(key=lambda t: t[1])
    return rows


def parse_state(doc, st, cfg):
    p0, p1 = cfg['pages']
    xthr = cfg['xthr']
    acs, heads, warns = [], [], []
    district, started, done, foot = None, False, False, False
    for pi in range(p0, p1 + 1):
        for y, name_cs, ext_cs in line_rows(doc[pi], xthr):
            full = join_chars(sorted(name_cs + ext_cs, key=lambda t: t[1]))
            if not started:
                started = bool(PART_A.search(full))
                continue
            if PART_B.search(full):
                done = True
                break
            if y > 735:  # printed page-number footer
                continue
            if re.match(r'^Sl\.?\s*No', full) or full.startswith('Extent of'):
                continue
            if full.startswith('*') or full.startswith('Abbreviation'):
                foot = True  # Karnataka footnotes (Pattanagere CMC wards; abbreviations)
                continue
            hm = HEAD_RE.match(full)
            if hm and 'DISTRICT' in full.upper()[:20]:
                district = clean(hm.group(1)).upper()
                heads.append((district, pi + 1, clean(full)))
                foot = False
                continue
            nm = join_chars(name_cs)
            ex = join_chars(ext_cs)
            m = AC_RE.match(nm) if nm else None
            if m:
                foot = False
                acs.append(dict(ac_no=int(m.group(1)), raw=m.group(2), district=district, page=pi + 1, y=y,
                                pdf_index=pi, ext=ex))
                continue
            if foot:
                continue
            if nm:
                if acs and acs[-1]['pdf_index'] == pi and 0 < y - acs[-1]['y'] < 40:
                    r = acs[-1]['raw'].rstrip()
                    if r.endswith('-') and nm[:1].islower():
                        acs[-1]['raw'] = r[:-1] + nm          # 'Chikkanayaka-' + 'nahalli'
                    elif r.endswith('-'):
                        acs[-1]['raw'] = r + nm
                    elif nm[:1].islower():
                        acs[-1]['raw'] = r + nm               # 'Hagaribommana' + 'halli' (word split)
                    else:
                        acs[-1]['raw'] = r + ' ' + nm          # wrapped name / '(SC)' on its own row
                else:
                    warns.append('%s p%d y%d stray name-column text: %r' % (st, pi + 1, y, nm))
            if ex and acs:
                acs[-1]['ext'] += ' ' + ex
        if done:
            break
    for a in acs:
        a['name_full'] = clean(a['raw'])
        a['name'], a['res'] = split_res(a['name_full'])
        a['ext'] = clean(a['ext'])
    return acs, heads, warns


# ------------------------------------------------------------------ Census 2011 reference data
def census_districts():
    out = defaultdict(dict)
    with open(PCA, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if r['tru'] == 'Total':
                out[r['state_name'].upper()][r['district_code']] = r['district_name']
    return out


def census_subdistricts():
    """{(state_code, district_code): [sub-district names]} from the Census 2011 PCA sub-district list."""
    if not os.path.exists(SUBDIST):
        return None
    import pandas as pd
    x = pd.read_excel(SUBDIST, dtype=str, usecols=['State', 'District', 'Subdistt', 'Level', 'Name', 'TRU'])
    x = x[(x.TRU == 'Total') & (x.Level == 'SUB-DISTRICT')]
    out = defaultdict(list)
    for r in x.itertuples():
        out[r.District].append(r.Name.strip())
    return out


TALUK_RE = re.compile(r"((?:[A-Z][A-Za-z.'\-]*)(?:\s+[A-Z][A-Za-z.'\-]*){0,3})\s+(?:Sub-?\s?)?"
                      r"(?:[Tt]aluka|[Tt]aluk|[Tt]ehsil)\b")
OF_DISTRICT_RE = re.compile(r"([A-Z][A-Za-z .]+?)\s+(?:Taluka|Taluk|Tehsil)\s*(?:\(Part\))?\s+of\s+([A-Z][A-Za-z]+)\s+"
                            r"District\s+(Villages?)\s*-?\s*([^.]+)")
STOP = {'entire', 'the', 'remaining', 'whole', 'of', 'and', 'sub'}
# order spelling -> Census 2011 sub-district spelling (name keys), for the extent cross-check only
ALIASES = {'morbi': 'morvi', 'dahod': 'dohad', 'dahegam': 'dehgam', 'maliyamiyana': 'maliya',
           'maliahatina': 'malia', 'veraval': 'patanveraval', 'vadia': 'kunkavavvadia', 'dangs': 'thedangs',
           'dehra': 'deragopipur', 'sadarbilaspur': 'bilaspursadar', 'bharmour': 'brahmaur', 'salooni': 'saluni',
           'dheera': 'dhira', 'sujanpur': 'tirasujanpur', 'shillai': 'shalai', 'nerwa': 'nerua', 'chopal': 'chaupal',
           'paravoor': 'paravur', 'kodungaloor': 'kodungallur', 'meham': 'maham', 'sullia': 'sulya'}


def subdistrict_matcher(dist_codes, subd):
    """name-key -> set of 2011 district codes, for the state's sub-districts."""
    idx = defaultdict(set)
    for dc in dist_codes:
        for n in subd.get(dc, []):
            idx[norm(n)].add(dc)
    keys = list(idx)

    def match(phrase):
        phrase = re.split(r'\s*(?:Sub-?\s?)?(?:Taluka|Taluk|Tehsil)\b', phrase)[0]  # 'Anjar Taluka-Entire'
        words = [w for w in phrase.split() if w.lower() not in STOP]
        for k in range(len(words)):  # longest suffix first: 'Nadapa Habay Bhuj' -> 'Bhuj'
            key = norm(' '.join(words[k:]))
            if len(key) < 3:
                continue
            key = ALIASES.get(key, key)
            if key in idx:
                return key, idx[key]
        for k in range(len(words)):
            key = norm(' '.join(words[k:]))
            if len(key) < 4:
                continue
            cm = difflib.get_close_matches(key, keys, n=1, cutoff=0.82)
            if cm:
                return cm[0], idx[cm[0]]
        return None, set()
    return match


# ------------------------------------------------------------------ main
def write_csv(path, rows, cols):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def main():
    doc = fitz.open(PDF)
    c11 = census_districts()
    subd = census_subdistricts()
    app = json.load(open(APP_SEATS, encoding='utf-8')) if os.path.exists(APP_SEATS) else []
    nfail = 0
    summary = []
    for st, cfg in STATES.items():
        log('=' * 100)
        log('%s  (Schedule %s, PDF index %d-%d, app comparison AE %d)' % (st, cfg['sched'], cfg['pages'][0],
                                                                        cfg['pages'][1], cfg['year']))
        source = ('ECI Delimitation of Parliamentary and Assembly Constituencies Order, 2008 (English), '
                  'Schedule %s %s, Table A' % (cfg['sched'], st))
        acs, heads, warns = parse_state(doc, st, cfg)
        for w in warns:
            log('  WARN ' + w)
        ok = True
        nums = [a['ac_no'] for a in acs]
        ok &= check('%s: AC count = %d' % (st, cfg['n']), len(acs) == cfg['n'], len(acs))
        ok &= check('%s: AC numbers exactly 1..%d in order' % (st, cfg['n']), nums == list(range(1, cfg['n'] + 1)),
                    'ok' if nums == list(range(1, cfg['n'] + 1)) else nums)
        ok &= check('%s: every AC has a district heading' % st, all(a['district'] for a in acs),
                    [a['ac_no'] for a in acs if not a['district']] or 'all')
        ok &= check('%s: every AC has extent text' % st, all(len(a['ext']) >= 10 for a in acs),
                    [a['ac_no'] for a in acs if len(a['ext']) < 10] or 'all')
        res = Counter(a['res'] for a in acs)
        ok &= check('%s: reserved seats = Schedule II (SC %d, ST %d)' % (st, cfg['sc'], cfg['st']),
                    res['SC'] == cfg['sc'] and res['ST'] == cfg['st'], 'SC=%d ST=%d' % (res['SC'], res['ST']))
        dheads = [h[0] for h in heads]
        ok &= check('%s: district headings unique' % st, len(dheads) == len(set(dheads)), len(dheads))
        for d, pg, txt in heads:
            ns = [a['ac_no'] for a in acs if a['district'] == d]
            contig = ns == list(range(ns[0], ns[-1] + 1)) if ns else False
            ok &= check('%s:   heading %-34r p%-3d ACs %3d-%-3d (%2d)' % (st, txt, pg, ns[0] if ns else 0,
                                                                      ns[-1] if ns else 0, len(ns)), contig)
        # ---- app name agreement
        appn = {r['n']: r for r in app if r['s'] == st and r['y'] == cfg['year']}
        mism = [a for a in acs if norm(a['name_full']) != norm(appn.get(a['ac_no'], {}).get('c', ''))]
        agree = 100.0 * (len(acs) - len(mism)) / len(acs)
        log('INFO %s: name agreement with app AE %d = %d/%d (%.1f%%)' % (st, cfg['year'], len(acs) - len(mism),
                                                                     len(acs), agree))
        for a in mism:
            ap = appn.get(a['ac_no'], {}).get('c', '')
            # judge: same seat if the two keys are close, or the order name matches the app name at +-1 (shift)
            r = difflib.SequenceMatcher(None, norm(a['name_full']), norm(ap)).ratio()
            shift = [k for k in (a['ac_no'] - 1, a['ac_no'] + 1)
                     if norm(appn.get(k, {}).get('c', '')) == norm(a['name_full'])]
            verdict = 'ROW SHIFT?' if shift else ('spelling variant' if r >= 0.7 else 'CHECK')
            a['app_mismatch'] = (ap, verdict, r)
            log('     %3d  order %-26r app %-24r ratio %.2f  -> %s' % (a['ac_no'], a['name_full'], ap, r, verdict))
        real = [a['ac_no'] for a in mism if a['app_mismatch'][1] != 'spelling variant']
        ok &= check('%s: every app-name mismatch is a spelling variant (no row shift)' % st, not real, real or 'yes')
        appres = [(a['ac_no'], a['res'] or 'GEN', appn.get(a['ac_no'], {}).get('r'))
                  for a in acs if (a['res'] or 'GEN') != (appn.get(a['ac_no'], {}).get('r') or 'GEN')]
        ok &= check('%s: reservation agrees with app AE %d for every AC' % (st, cfg['year']), not appres, appres or 'yes')
        # ---- lineage table
        lin = LINEAGE[st]
        lin_d = {d: (c, cv, n) for d, c, cv, n in lin}
        cd = c11[cfg['c11']]
        ok &= check('%s: lineage rows = order district headings (same set)' % st, set(lin_d) == set(dheads),
                    sorted(set(lin_d) ^ set(dheads)) or '%d districts' % len(dheads))
        codes_used = []
        for d, c, cv, n in lin:
            codes_used += [c] + [x for x in cv.split(';') if x]
        bad = [x for x in codes_used if x not in cd]
        ok &= check('%s: every lineage code is a real Census 2011 district of the state' % st, not bad, bad or 'yes')
        unmapped = sorted(set(cd) - set(codes_used))
        ok &= check('%s: every Census 2011 district (%d) appears as continuing or carved' % (st, len(cd)),
                    not unmapped, ['%s %s' % (x, cd[x]) for x in unmapped] or 'yes')
        conts = [c for _, c, _, _ in lin]
        ok &= check('%s: continuing codes are 1:1' % st, len(conts) == len(set(conts)), len(set(conts)))
        # ---- extent cross-check vs Census 2011 sub-districts (independent evidence for the lineage)
        ac_notes = defaultdict(list)
        if subd is not None:
            match = subdistrict_matcher(cd, subd)
            touched = defaultdict(set)
            unmatched, spill = Counter(), []
            for a in acs:
                allowed = {lin_d[a['district']][0]} | {x for x in lin_d[a['district']][1].split(';') if x}
                hit = OrderedDict()
                for m in TALUK_RE.finditer(a['ext']):
                    key, codes = match(m.group(1))
                    if not codes:
                        unmatched[m.group(1)] += 1
                        continue
                    pick = (codes & allowed) or codes
                    for c in sorted(pick):
                        hit.setdefault(c, set()).add(m.group(1).split()[-1] if len(m.group(1).split()) > 2
                                                     else m.group(1))
                for c in hit:
                    touched[a['district']].add(c)
                outside = [c for c in hit if c not in allowed]
                for m in OF_DISTRICT_RE.finditer(a['ext']):
                    ac_notes[a['ac_no']].append("extent also takes %s %s of %s Taluka (Part), %s District (cross-"
                                                "district exception in the order)" % (m.group(3).lower(),
                                                                                     m.group(4).strip(),
                                                                                     m.group(1).strip(),
                                                                                     m.group(2)))
                if outside:
                    spill.append((a['ac_no'], a['name'], a['district'], ['%s %s' % (c, cd[c]) for c in outside]))
                if set(hit) - {lin_d[a['district']][0]}:
                    ac_notes[a['ac_no']].append('extent taluks/tehsils fall in 2011 districts: ' + ', '.join(
                        '%s %s (%s)' % (c, cd[c], '/'.join(sorted(v))) for c, v in hit.items()))
            log('INFO %s: extent taluk/tehsil phrases not matched to a 2011 sub-district (info only): %s'
                % (st, dict(unmatched.most_common(12)) or 'none'))
            for d, c, cv, n in lin:
                want = {c} | {x for x in cv.split(';') if x}
                got = touched.get(d, set())
                miss_carved = [x for x in cv.split(';') if x and x not in got]
                ok &= check('%s: %s carved codes confirmed by extents' % (st, d), not miss_carved,
                            'touched %s' % sorted(got)) if cv else True
                extra = sorted(got - want)
                if extra:
                    log('INFO %s: %s extents also touch %s (cross-district villages, see AC notes)'
                        % (st, d, ['%s %s' % (x, cd[x]) for x in extra]))
            log('INFO %s: ACs whose extent names a taluk of a 2011 district outside their heading lineage: %s'
                % (st, spill or 'none'))
        else:
            log('INFO %s: Census sub-district list not found; extent cross-check skipped' % st)
        # ---- write
        rows = []
        for a in acs:
            notes = []
            if a['res']:
                notes.append('reserved=' + a['res'])
            if a.get('app_mismatch'):
                notes.append("app AE %d spelling '%s' (%s)" % (cfg['year'], a['app_mismatch'][0], a['app_mismatch'][1]))
            notes += ac_notes.get(a['ac_no'], [])
            rows.append(OrderedDict(state=st, ac_no=a['ac_no'], ac_name=a['name'], district_2008=a['district'],
                                    source=source, page=a['page'], note='; '.join(notes)))
        drows = []
        for d, c, cv, n in lin:
            nn = '2011: %s %s' % (c, cd.get(c, '?'))
            if cv:
                nn += ' + carved ' + ', '.join('%s %s' % (x, cd.get(x, '?')) for x in cv.split(';'))
            nac = sum(1 for a in acs if a['district'] == d)
            drows.append(OrderedDict(state=st, district_2008=d, continuing_2011_code=c, carved_2011_codes=cv,
                                     note='; '.join(x for x in (nn, '%d ACs' % nac, n) if x)))
        write_csv(os.path.join(HERE, slug(st) + '_acs.csv'), rows,
                  ['state', 'ac_no', 'ac_name', 'district_2008', 'source', 'page', 'note'])
        write_csv(os.path.join(HERE, slug(st) + '_districts.csv'), drows,
                  ['state', 'district_2008', 'continuing_2011_code', 'carved_2011_codes', 'note'])
        log('wrote %s_acs.csv (%d rows), %s_districts.csv (%d rows)' % (slug(st), len(rows), slug(st), len(drows)))
        nfail += 0 if ok else 1
        summary.append((st, len(acs), cfg['n'], agree, ok))
    log('=' * 100)
    for s in summary:
        log('SUMMARY %-17s ACs %3d/%3d  app-name agreement %.1f%%  %s' % (s[0], s[1], s[2], s[3],
                                                                         'ALL CHECKS OK' if s[4] else 'HAS FAILURES'))
    with open(os.path.join(HERE, 'g2_validation.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(LOG) + '\n')
    return 1 if nfail else 0


if __name__ == '__main__':
    sys.exit(main())
