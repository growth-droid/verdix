#!/usr/bin/env python3
"""
Official AC -> 2008-delimitation district lists for undivided Andhra Pradesh (written as Telangana 1-119 and
Andhra Pradesh 120-294), Arunachal Pradesh, Bihar, Chhattisgarh and Goa (group g1), parsed from TABLE/PART A of
the ECI "Delimitation of Parliamentary and Assembly Constituencies Order, 2008" (English), plus a
2008-district -> Census-2011 district-code lineage table per state.

Outputs (next to this script):
  <slug>_acs.csv        state,ac_no,ac_name,district_2008,source,page,note
  <slug>_districts.csv  state,district_2008,continuing_2011_code,carved_2011_codes,note
  g1_validation.txt     every check run (counts, contiguity, app-name agreement, census-code coverage)

Inputs (read only):
  ../ac_district_lists/raw/eci_delimitation_order_2008_english.pdf
  ../pca/pca_district_2011.csv                (Census 2011 PCA, tru == 'Total')
  ../../../../public/data/seats_ae.json        (the app's ECI-results seat names)

Method: character-coordinate parse (PyMuPDF rawdict). Every visual row is split at a per-state x threshold
into the "Sl. No. & Name" column and the "Extent" column; rows whose full text is a "<n> - DISTRICT : <NAME>"
heading set the current district. An AC starts on a name-column row that begins with the NEXT expected AC
number; following name-column rows (before the next AC / heading) continue the name.
page = 1-based PDF page (= printed page number + 1; printed page numbers equal 0-based PDF indexes).
ac_name is the name as printed minus the trailing (SC)/(ST) tag, which goes to note as reserved=SC/ST.

Run: python build_g1_ap_ar_br_cg_ga.py      Requires: PyMuPDF (fitz).
"""
import csv, json, os, re
from collections import Counter, OrderedDict
from difflib import SequenceMatcher

import fitz  # PyMuPDF

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = os.path.normpath(os.path.join(HERE, '..', 'ac_district_lists', 'raw', 'eci_delimitation_order_2008_english.pdf'))
PCA = os.path.normpath(os.path.join(HERE, '..', 'pca', 'pca_district_2011.csv'))
APP_SEATS = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', 'public', 'data', 'seats_ae.json'))

# order schedule -> (first page idx, Table-B page idx, name-column x threshold, AC count, census state name)
SCHED = OrderedDict([
    ('Andhra Pradesh (undivided)', dict(sched='III', pages=(8, 29), xthr=200, n=294, c11='ANDHRA PRADESH')),
    ('Arunachal Pradesh', dict(sched='IV', pages=(33, 41), xthr=180, n=60, c11='ARUNACHAL PRADESH')),
    ('Bihar', dict(sched='VI', pages=(74, 94), xthr=172, n=243, c11='BIHAR')),
    ('Chhattisgarh', dict(sched='VII', pages=(97, 108), xthr=212, n=90, c11='CHHATTISGARH')),
    ('Goa', dict(sched='VIII', pages=(110, 114), xthr=192, n=40, c11='GOA')),
])

# app state -> (order schedule, AC range in order numbering, app election to compare, app-number offset)
OUT = OrderedDict([
    ('Telangana', dict(src='Andhra Pradesh (undivided)', rng=(1, 119), year=2009, off=0)),
    ('Andhra Pradesh', dict(src='Andhra Pradesh (undivided)', rng=(120, 294), year=2009, off=0)),
    ('Arunachal Pradesh', dict(src='Arunachal Pradesh', rng=(1, 60), year=2009, off=0)),
    ('Bihar', dict(src='Bihar', rng=(1, 243), year=2010, off=0)),
    # Chhattisgarh's first post-order election (Nov 2008) is not in the app; 2013 is its earliest year.
    ('Chhattisgarh', dict(src='Chhattisgarh', rng=(1, 90), year=2013, off=0)),
    ('Goa', dict(src='Goa', rng=(1, 40), year=2012, off=0)),
])

# 2008-order district heading -> (continuing Census-2011 code, [carved 2011 codes], note)
LINEAGE = {
    'Andhra Pradesh (undivided)': OrderedDict([
        ('ADILABAD', ('532', [], '')),
        ('NIZAMABAD', ('533', [], '')),
        ('KARIMNAGAR', ('534', [], '')),
        ('MEDAK', ('535', [], '')),
        ('RANGAREDDI', ('537', [], 'Census 2011 spelling Rangareddy')),
        ('HYDERABAD', ('536', [], '')),
        ('MAHBUBNAGAR', ('538', [], '')),
        ('NALGONDA', ('539', [], '')),
        ('WARANGAL', ('540', [], '')),
        ('KHAMMAM', ('541', [], 'Khammam mandals moved to East/West Godavari in 2014 (AP Reorganisation Act) - '
                                'after the 2011 census, irrelevant here')),
        ('SRIKAKULAM', ('542', [], '')),
        ('VIZIANAGARAM', ('543', [], '')),
        ('VISAKHAPATNAM', ('544', [], '')),
        ('EAST GODAVARI', ('545', [], '')),
        ('WEST GODAVARI', ('546', [], '')),
        ('KRISHNA', ('547', [], '')),
        ('GUNTUR', ('548', [], '')),
        ('PRAKASAM', ('549', [], 'heading printed "8 - DISTRICT : PRAKASAM" (serial should be 18)')),
        ('NELLORE', ('550', [], 'renamed Sri Potti Sriramulu Nellore (2008); same district')),
        ('KADAPA', ('551', [], 'renamed Y.S.R. (YSR Kadapa) in 2010; same district')),
        ('KURNOOL', ('552', [], '')),
        ('ANANTAPUR', ('553', [], '')),
        ('CHITTOOR', ('554', [], '')),
    ]),
    # Arunachal: delimitation was deferred (Presidential order, Feb 2008), so Schedule IV reproduces the 1976
    # order (as amended) with its old 11-district grouping; 2011 districts carved out of those are listed.
    'Arunachal Pradesh': OrderedDict([
        ('TAWANG', ('245', [], '')),
        ('WEST KAMENG', ('246', [], '')),
        ('EAST KAMENG', ('247', [], '')),
        ('LOWER SUBANSIRI', ('255', ['248', '256'],
                             'old-order grouping: Papum Pare carved 1992 and Kurung Kumey carved 2001 from Lower '
                             'Subansiri (both before 2011); ACs under this heading lie in 255, 248 or 256')),
        ('UPPER SUBANSIRI', ('249', [], '')),
        ('WEST SIANG', ('250', [], '')),
        ('EAST SIANG', ('251', ['252'], 'Upper Siang carved from East Siang in 1994 (before 2011)')),
        ('DIBANG VALLEY', ('257', ['258'], 'Lower Dibang Valley carved from Dibang Valley in 2001 (before 2011); '
                                           'Dibang Valley (Anini) continues as 257')),
        ('LOHIT', ('259', ['260'], 'Anjaw carved from Lohit in 2004 (before 2011)')),
        ('CHANGLANG', ('253', [], '')),
        ('TIRAP', ('254', [], '')),
    ]),
    'Bihar': OrderedDict([
        ('PASCHIM CHAMPARAN', ('203', [], 'Census 2011 spelling Pashchim Champaran')),
        ('PURVI CHAMPARAN', ('204', [], 'Census 2011 spelling Purba Champaran')),
        ('SHEOHAR', ('205', [], 'Tariani Chowk CD block of Sheohar lies in AC 30 Belsand (Sitamarhi heading)')),
        ('SITAMARHI', ('206', [], 'AC 30 Belsand also includes Tariani Chowk CD block of Sheohar (205)')),
        ('MADHUBANI', ('207', [], '')),
        ('SUPAUL', ('208', [], '')),
        ('ARARIA', ('209', [], '')),
        ('KISHANGANJ', ('210', [], '')),
        ('PURNIA', ('211', [], '')),
        ('KATIHAR', ('212', [], '')),
        ('MADHEPURA', ('213', [], '')),
        ('SAHARSA', ('214', [], '')),
        ('DARBHANGA', ('215', [], '')),
        ('MUZAFFARPUR', ('216', [], '')),
        ('GOPALGANJ', ('217', [], '')),
        ('SIWAN', ('218', [], '')),
        ('SARAN', ('219', [], '')),
        ('VAISHALI', ('220', [], '')),
        ('SAMASTIPUR', ('221', [], '')),
        ('BEGUSARAI', ('222', [], '')),
        ('KHAGARIA', ('223', [], '')),
        ('BHAGALPUR', ('224', [], '')),
        ('BANKA', ('225', [], '')),
        ('MUNGER', ('226', [], '')),
        ('LAKHISARAI', ('227', [], '')),
        ('SHEIKHPURA', ('228', [], '')),
        ('NALANDA', ('229', [], '')),
        ('PATNA', ('230', [], '')),
        ('BHOJPUR', ('231', [], '')),
        ('BUXAR', ('232', [], '')),
        ('KAIMUR (BHABUA)', ('233', [], '')),
        ('ROHTAS', ('234', [], '')),
        ('ARWAL', ('240', [], 'Arwal was carved from Jehanabad in 2001, already separate in the order')),
        ('JAHANABAD', ('239', [], 'Census 2011 spelling Jehanabad')),
        ('AURANGABAD', ('235', [], '')),
        ('GAYA', ('236', [], '')),
        ('NAWADA', ('237', [], '')),
        ('JAMUI', ('238', [], '')),
    ]),
    'Chhattisgarh': OrderedDict([
        ('KORIA', ('400', [], 'Census 2011 spelling Koriya')),
        ('SURGUJA', ('401', [], '')),
        ('JASHPUR', ('402', [], '')),
        ('RAIGARH', ('403', [], '')),
        ('KORBA', ('404', [], '')),
        ('BILASPUR', ('406', [], '')),
        ('JANJGIR-CHAMPA', ('405', [], '')),
        ('MAHASAMUND', ('411', [], '')),
        ('RAIPUR', ('410', [], '')),
        ('DHAMTARI', ('412', [], '')),
        ('DURG', ('409', [], '')),
        ('KABIRDHAM', ('407', [], 'Census 2011 spelling Kabeerdham (Kawardha)')),
        ('RAJNANDGAON', ('408', [], '')),
        ('UTTAR BASTAR (KANKER)', ('413', [], '')),
        ('BASTAR', ('414', ['415'], 'Narayanpur carved from Bastar on 11 May 2007; the order (based on the 2001 '
                                    'census) still groups its ACs under Bastar')),
        ('DAKSHIN BASTAR (DANTEWADA)', ('416', ['417'], 'Bijapur carved from Dantewada on 11 May 2007; the order '
                                                        '(based on the 2001 census) still groups its ACs under '
                                                        'Dantewada')),
    ]),
    'Goa': OrderedDict([
        ('NORTH GOA', ('585', [], '')),
        ('SOUTH GOA', ('586', [], '')),
    ]),
}

# known cross-district ACs stated in the order itself (AC no -> note), keyed by schedule
CROSS = {
    'Bihar': {30: 'CROSS-DISTRICT: order (printed p.76) puts Tariani Chowk CD block of Sheohar district in this AC '
                  '- AC spans Sitamarhi + Sheohar (2011 codes 206 + 205)',
              22: 'Sheohar district minus Tariani Chowk CD block (that block is in AC 30 Belsand)'},
}

# mismatches the automatic closest-name test flags, adjudicated by hand (all are NOT row shifts)
JUDGED = {
    ('Arunachal Pradesh', 26): 'spelling variant - order DAMPORIJO = app DUMPORIJO; the closer app name DAPORIJO is a '
                               'different seat (AC 24), which itself matches the order exactly at n=24',
    ('Bihar', 42): 'spelling variant - app adds the disambiguator "(SUPAUL)"; the other Pipra is AC 17 (Purvi '
                   'Champaran), which matches the order exactly at n=17',
    ('Chhattisgarh', 48): 'translation variant - Gramin = Rural (app "Raipur City Gramin" = order "Raipur Rural"); '
                          'neighbours 47 and 49 match exactly',
}
# reservation differences that are app-side data issues, verified against the order text
RES_APP_ISSUE = {
    ('Telangana', 32): 'order prints "32. Husnabad" with no (SC) tag (PDF p.11) and the 2009 winner is Aligireddy '
                       'Praveen Reddy - a GENERAL seat; the app flags it SC in every year (app-side data issue)',
}

LOG = []


def log(msg):
    LOG.append(msg)
    print(msg)


def slug(s):
    return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')


def char_rows(page, ytol=3):
    chars = []
    for b in page.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                for c in s['chars']:
                    x0, y0, x1, y1 = c['bbox']
                    chars.append((round((y0 + y1) / 2), x0, x1, c['c']))
    chars.sort(key=lambda t: (t[0], t[1]))
    rows = []
    for ch in chars:
        if rows and abs(rows[-1][0] - ch[0]) <= ytol:
            rows[-1][1].append(ch)
        else:
            rows.append([ch[0], [ch]])
    for r in rows:
        r[1].sort(key=lambda t: t[1])
    return rows


def join_chars(cs, gap=2.0):
    s, px = '', None
    for _, x0, x1, c in cs:
        if px is not None and x0 - px > gap and not s.endswith(' ') and c != ' ':
            s += ' '
        s += c
        px = x1
    return re.sub(r'\s+', ' ', s).strip()


def clean(s):
    s = s.replace('�', '-').replace('–', '-').replace('—', '-').replace('­', '-')
    return re.sub(r'\s+', ' ', s).strip()


HEAD_RE = re.compile(r'^\s*\d*\s*[^A-Za-z0-9]*\s*DISTRICT\s*[^A-Za-z0-9(]*\s*([A-Z][A-Z ()\-]*?)\s*$')
TABLEB_RE = re.compile(r'(TABLE|PART)\s*B\b')
START_RE = re.compile(r'Sl\.\s*No\.')
NUM_RE = re.compile(r'^(\d{1,3})\s*(?:[.\-]\s*)?(.*)$')


def split_res(name):
    m = re.search(r'\s*\((SC|ST)\)\s*$', name)
    return (name[:m.start()].strip(), m.group(1)) if m else (name.strip(), '')


def norm(s):
    s = re.sub(r'\((SC|ST)\)', '', s.upper())
    return re.sub(r'[^A-Z]', '', s)


def extent_x(page):
    """Most common left edge of text lines right of x=120 (the Extent column start on this page)."""
    xs = Counter()
    for b in page.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            t = ''.join(s['text'] for s in l['spans'])
            if t.strip() and l['bbox'][0] > 120 and 'DISTRICT' not in t:
                xs[round(l['bbox'][0])] += 1
    return xs.most_common(1)[0][0] if xs else None


def join_cont(prev, nxt):
    """Join a wrapped name row: a lowercase start means the word was split across lines ("Ramachandrapur" +
    "am", "Raghunath-" + "pur") so join with no space and drop the line-break hyphen; otherwise a new word."""
    prev = prev.rstrip()
    if nxt[:1].islower():
        return (prev[:-1] if prev.endswith('-') else prev) + nxt
    return prev + ('' if prev.endswith('-') else ' ') + nxt


def clusters(cs, gap=8.0):
    """Split a row's chars into runs separated by > gap pt of empty space (spaces ignored)."""
    out, px = [], None
    for c in cs:
        if c[3] == ' ':
            if out:
                out[-1].append(c)
            continue
        if px is None or c[1] - px > gap:
            out.append([])
        out[-1].append(c)
        px = c[2]
    return [cl for cl in out if cl]


def parse_schedule(doc, key, cfg):
    p0, pB = cfg['pages']
    acs, cur, dist, started, extras = [], None, None, False, []
    for pi in range(p0, pB + 1):
        ex = extent_x(doc[pi])
        thr = (ex - 2) if ex and ex > 150 else cfg['xthr']
        if abs(thr - cfg['xthr']) > 12:
            log('INFO | %s page idx %d: name-column threshold %s (default %s)' % (key, pi, thr, cfg['xthr']))
        for y, cs in char_rows(doc[pi]):
            if y > 735:  # page number footer
                continue
            full = clean(join_chars(cs))
            if not started:
                if START_RE.search(full):
                    started = True
                continue
            if TABLEB_RE.search(full):
                return acs, extras
            hm = HEAD_RE.match(full)
            if hm and 'DISTRICT' in full:
                dist = re.sub(r'\s+', ' ', hm.group(1)).strip()
                cur = None
                continue
            name = clean(' '.join(join_chars(cl) for cl in clusters([c for c in cs if c[1] < thr])
                                  if cl[0][1] < cfg['xthr']))
            if not name:
                continue
            m = NUM_RE.match(name)
            nxt = (acs[-1]['ac_no'] + 1) if acs else 1
            if m and int(m.group(1)) == nxt:
                cur = OrderedDict(ac_no=nxt, name_full=m.group(2).strip(), district=dist, page=pi + 1)
                acs.append(cur)
            elif cur is not None:
                cur['name_full'] = join_cont(cur['name_full'], name)
                cur.setdefault('cont', []).append(name)
            else:
                extras.append((pi, y, name))
    return acs, extras


def tidy_name(s):
    s = re.sub(r'\s*-\s*', '-', s)            # "THRIZINO- BURAGAON" -> "THRIZINO-BURAGAON"
    s = re.sub(r'\(\s+', '(', s)
    s = re.sub(r'\s+\)', ')', s)
    s = re.sub(r'\s+', ' ', s).strip().rstrip('.').strip()
    return s


def census():
    out = {}
    for r in csv.DictReader(open(PCA, encoding='utf-8')):
        if r['tru'] == 'Total':
            out.setdefault(r['state_name'].upper(), OrderedDict())[r['district_code']] = r['district_name']
    return out


def main():
    doc = fitz.open(PDF)
    c11 = census()
    app = json.load(open(APP_SEATS, encoding='utf-8'))
    parsed = {}
    for key, cfg in SCHED.items():
        acs, extras = parse_schedule(doc, key, cfg)
        for a in acs:
            a['name'], a['res'] = split_res(tidy_name(a['name_full']))
        parsed[key] = acs
        log('== %s (Schedule %s, PDF idx %d-%d): parsed %d ACs; stray name-column rows before first AC: %s'
            % (key, cfg['sched'], cfg['pages'][0], cfg['pages'][1], len(acs), extras or 'none'))
        nums = [a['ac_no'] for a in acs]
        ok = nums == list(range(1, cfg['n'] + 1))
        log('%s | %s: AC numbers contiguous 1..%d (got %d, last %s)' % ('OK  ' if ok else 'FAIL', key, cfg['n'],
                                                                         len(nums), nums[-1] if nums else None))
        heads = list(OrderedDict.fromkeys(a['district'] for a in acs))
        lin = LINEAGE[key]
        missing = [h for h in heads if h not in lin]
        unused = [h for h in lin if h not in heads]
        log('%s | %s: %d district headings, all in lineage table (missing=%s, unused=%s)'
            % ('OK  ' if not missing and not unused else 'FAIL', key, len(heads), missing, unused))
        cont = ['%d:%s' % (a['ac_no'], '|'.join(a['cont'])) for a in acs if a.get('cont')]
        log('INFO | %s: name-column continuation rows joined into the previous AC name: %s' % (key, cont or 'none'))
        for a in acs:
            if len(a['name']) > 40 or re.search(r'[a-z]{3,}\s+[a-z]{3,}', a['name']):
                log('WARN | %s AC %d name looks long/odd: %r' % (key, a['ac_no'], a['name']))

    # ---------------- write per app state
    for st, oc in OUT.items():
        key = oc['src']
        cfg = SCHED[key]
        lo, hi = oc['rng']
        acs = [a for a in parsed[key] if lo <= a['ac_no'] <= hi]
        src = ('ECI Delimitation of Parliamentary and Assembly Constituencies Order, 2008 (English), Schedule %s %s, '
               'Table A' % (cfg['sched'], 'Andhra Pradesh' if key.startswith('Andhra') else key))
        appn = {r['n']: r['c'] for r in app if r['s'] == st and r['y'] == oc['year']}
        appr = {r['n']: r.get('r') for r in app if r['s'] == st and r['y'] == oc['year']}
        rows, mism = [], []
        for a in acs:
            notes = []
            if a['res']:
                notes.append('reserved=' + a['res'])
            if key == 'Arunachal Pradesh':
                notes.append('delimitation deferred in 2008: pre-2008 AC, heading is the order\'s old district grouping '
                             '(2011 successor districts in arunachal_pradesh_districts.csv)')
            if a['ac_no'] in CROSS.get(key, {}):
                notes.append(CROSS[key][a['ac_no']])
            an = appn.get(a['ac_no'] - oc['off'])
            if an is None:
                notes.append('not in app %d' % oc['year'])
            elif norm(an) != norm(a['name']):
                notes.append("app %d spelling '%s'" % (oc['year'], an))
                mism.append((a['ac_no'], a['name'], an))
            rows.append(OrderedDict(state=st, ac_no=a['ac_no'], ac_name=a['name'],
                                    district_2008=a['district'].title() if False else a['district'],
                                    source=src, page=a['page'], note='; '.join(notes)))
        exp = hi - lo + 1
        ok = [r['ac_no'] for r in rows] == list(range(lo, hi + 1))
        log('%s | %s: rows %d expected %d, numbers contiguous %d..%d' % ('OK  ' if ok else 'FAIL', st, len(rows),
                                                                       exp, lo, hi))
        log('%s | %s: app seats_ae %d has %d seats (n %s..%s)' % (
            'OK  ' if len(appn) == exp else 'FAIL', st, oc['year'], len(appn), min(appn) if appn else None,
            max(appn) if appn else None))
        agree = exp - len(mism)
        log('INFO | %s: name agreement vs app %d = %d/%d (%.1f%%); mismatches %d' % (
            st, oc['year'], agree, exp, 100.0 * agree / exp, len(mism)))
        for n, o, a_ in mism:
            # row-shift test: is the app name at the SAME number the closest app name in the state?
            sims = sorted(((SequenceMatcher(None, norm(o), norm(v)).ratio(), k) for k, v in appn.items()),
                          reverse=True)
            same = SequenceMatcher(None, norm(o), norm(a_)).ratio()
            verdict = ('spelling variant (same-number app name is the closest match, sim %.2f)' % same
                       if sims[0][1] == n or same >= sims[0][0] else
                       'auto-test flags: closer app name at n=%d %r (sim %.2f vs %.2f); JUDGED: %s'
                       % (sims[0][1], appn[sims[0][1]], sims[0][0], same,
                          JUDGED.get((st, n), 'UNRESOLVED - possible row shift')))
            log('       MISMATCH %s AC %d: order %r vs app %r -> %s' % (st, n, o, a_, verdict))
        resd = [(a['ac_no'], a['res'] or 'GEN', appr[a['ac_no']]) for a in acs
                if a['ac_no'] in appr and (a['res'] or 'GEN') != appr[a['ac_no']]]
        real = [d for d in resd if (st, d[0]) not in RES_APP_ISSUE]
        log('%s | %s: reservation (GEN/SC/ST) equal to app %d for every AC; differences=%s%s'
            % ('OK  ' if not real else 'FAIL', st, oc['year'], resd or 'none',
               ''.join(' [AC %d: %s]' % (d[0], RES_APP_ISSUE[(st, d[0])]) for d in resd if (st, d[0]) in RES_APP_ISSUE)))
        with open(os.path.join(HERE, slug(st) + '_acs.csv'), 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=['state', 'ac_no', 'ac_name', 'district_2008', 'source', 'page', 'note'])
            w.writeheader()
            w.writerows(rows)

        # ---------------- district lineage file
        lin = LINEAGE[key]
        heads = list(OrderedDict.fromkeys(r['district_2008'] for r in rows))
        cs = c11[cfg['c11']]
        drows, used = [], []
        for h in heads:
            cont, carved, note = lin[h]
            bad = [c for c in [cont] + carved if c not in cs]
            if bad:
                log('FAIL | %s: %s codes %s not Census-2011 codes of %s' % (st, h, bad, cfg['c11']))
            used += [cont] + carved
            nn = ['2011: %s %s' % (cont, cs.get(cont, '?'))] + ['carved %s %s' % (c, cs.get(c, '?')) for c in carved]
            drows.append(OrderedDict(state=st, district_2008=h, continuing_2011_code=cont,
                                     carved_2011_codes=';'.join(carved),
                                     note='; '.join(nn + ([note] if note else []))))
        allc = [c for d in drows for c in [d['continuing_2011_code']] + [x for x in d['carved_2011_codes'].split(';') if x]]
        badc = [c for c in allc if c not in cs]
        log('%s | %s: all %d district codes used are real Census-2011 codes of %s; bad=%s'
            % ('OK  ' if not badc else 'FAIL', st, len(allc), cfg['c11'], badc or 'none'))
        if st in ('Telangana', 'Andhra Pradesh'):
            # the census lists undivided AP; split coverage by which region's ACs sit in the district
            scope = sorted(set(used))
            log('INFO | %s: uses 2011 codes %s' % (st, ';'.join(scope)))
        else:
            unc = [c for c in cs if c not in used]
            dup = [c for c, k in Counter(used).items() if k > 1]
            log('%s | %s: every Census-2011 district (%d) appears as continuing or carved; uncovered=%s, '
                'listed twice=%s' % ('OK  ' if not unc else 'FAIL', st, len(cs), unc, dup))
        with open(os.path.join(HERE, slug(st) + '_districts.csv'), 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=['state', 'district_2008', 'continuing_2011_code', 'carved_2011_codes',
                                              'note'])
            w.writeheader()
            w.writerows(drows)

    # undivided AP coverage across the two output files
    used = set()
    for st in ('Telangana', 'Andhra Pradesh'):
        for r in csv.DictReader(open(os.path.join(HERE, slug(st) + '_districts.csv'), encoding='utf-8')):
            used.add(r['continuing_2011_code'])
            used.update(c for c in r['carved_2011_codes'].split(';') if c)
    unc = [c for c in c11['ANDHRA PRADESH'] if c not in used]
    log('%s | undivided AP: every Census-2011 AP district (23) covered by telangana+andhra_pradesh files; '
        'uncovered=%s' % ('OK  ' if not unc else 'FAIL', unc))
    with open(os.path.join(HERE, 'g1_validation.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(LOG) + '\n')


if __name__ == '__main__':
    main()
