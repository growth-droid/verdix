#!/usr/bin/env python3
"""
Official AC -> district (as delimited) lists for Punjab, Rajasthan, Sikkim, Tamil Nadu, Tripura,
parsed from TABLE A / PART A of the ECI "Delimitation of Parliamentary and Assembly Constituencies Order, 2008"
(English), plus a 2008-district -> Census-2011-district lineage table.

Source PDF (read only):
  ../ac_district_lists/raw/eci_delimitation_order_2008_english.pdf
  https://www.eci.gov.in/Documents/Delimitation/DelimitationofParliamentaryAssemblyConstituenciesOrder-2008(English).pdf
Printed page numbers == 0-based PDF page indexes.

Outputs (next to this script), per state slug:
  <slug>_acs.csv        state,ac_no,ac_name,district_2008,source,page,note
  <slug>_districts.csv  state,district_2008,continuing_2011_code,carved_2011_codes,note
  g4_validation.txt     every check run (counts, contiguity, name agreement vs app, district-code coverage)

Read-only cross-checks:
  ../../../../public/data/seats_ae.json     app seats (first post-2008 assembly election of each state)
  ../pca/pca_district_2011.csv              Census 2011 district names/codes (tru == 'Total')

Run: python build_g4_pb_rj_sk_tn_tr.py      Requires: PyMuPDF (fitz), pandas.
"""
import csv, json, os, re
from collections import Counter, OrderedDict

import fitz  # PyMuPDF
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = os.path.normpath(os.path.join(HERE, '..', 'ac_district_lists', 'raw', 'eci_delimitation_order_2008_english.pdf'))
APP_SEATS = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', 'public', 'data', 'seats_ae.json'))
PCA = os.path.normpath(os.path.join(HERE, '..', 'pca', 'pca_district_2011.csv'))
SRC = 'ECI Delimitation of Parliamentary and Assembly Constituencies Order 2008 (English), Schedule %s Table A'

# app state, order state label, schedule no, first/last Table-A page (0-based == printed), name-column split x,
# seat count, app year of the first post-2008 assembly election, census-2011 state name
STATES = [
    ('Punjab',     'PUNJAB',     'XXIII', 336, 348, 232, 117, 2012, 'PUNJAB'),
    ('Rajasthan',  'RAJASTHAN',  'XXIV',  350, 365, 193, 200, 2013, 'RAJASTHAN'),
    ('Sikkim',     'SIKKIM',     'XXV',   367, 371, 196, 32,  2009, 'SIKKIM'),
    ('Tamil Nadu', 'TAMIL NADU', 'XXVI',  372, 447, 220, 234, 2011, 'TAMIL NADU'),
    ('Tripura',    'TRIPURA',    'XXVII', 450, 457, 235, 60,  2013, 'TRIPURA'),
]
# NB Rajasthan's first post-2008 AE was Dec 2008, but the app's Rajasthan series starts in 2013 (same 2008 map).

CHECKS = []


def check(name, ok, detail=''):
    CHECKS.append(('OK  ' if ok else 'FAIL') + ' | ' + name + (' | ' + str(detail) if detail != '' else ''))
    print(CHECKS[-1])


def info(name, detail=''):
    CHECKS.append('INFO | ' + name + (' | ' + str(detail) if detail != '' else ''))
    print(CHECKS[-1])


def clean(s):
    s = s.replace('�', '-').replace('–', '-').replace('—', '-').replace('­', '-')
    return re.sub(r'\s+', ' ', s).strip()


def norm(s):
    s = re.sub(r'\((SC|ST|BL)\)', '', s.upper())
    return re.sub(r'[^A-Z]', '', s)


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
    return s.strip()


HEAD_RE = re.compile(r'^\s*(\d+)\s*-?\s*DISTRICT\s*:\s*(.+?)\s*$')
END_RE = re.compile(r'(TABLE|PART)\s*-?\s*B\s*-')
FOOT_RE = re.compile(r'crucial date|operations in the State|^Any reference in Table')


def stream(doc, p0, p1, split):
    """Ordered list of ('H', page, district) / ('N', page, name-column text) for one state's Table A."""
    out, started = [], False
    for pn in range(p0, p1 + 1):
        for y, cs in char_rows(doc[pn]):
            full = clean(join_chars(cs))
            if END_RE.search(full):
                return out
            m = HEAD_RE.match(full)
            if m and 'DISTRICT' in full:
                out.append(('H', pn, clean(m.group(2))))
                started = True
                continue
            if not started or FOOT_RE.search(full):
                continue
            # name column first, so an AC's first extent line attaches to that AC (not the previous one)
            txt = clean(join_chars([c for c in cs if c[1] < split]))
            if txt and not txt.startswith('Sl. No') and not (re.fullmatch(r'\d{3}', txt) and int(txt) == pn):
                out.append(('N', pn, txt))
            ext = clean(join_chars([c for c in cs if c[1] >= split]))
            if ext and not (re.fullmatch(r'\d{3}', ext) and int(ext) == pn):
                out.append(('E', pn, ext))
    return out


NUM_RE = re.compile(r'^(\d+)\s*[.\-]?\s*(.*)$')


def parse_state(doc, p0, p1, split):
    acs, dist, cur = [], None, None
    for kind, pn, txt in stream(doc, p0, p1, split):
        if kind == 'H':
            dist = txt
            cur = None
            continue
        if kind == 'E':
            if cur is not None:
                cur['extent'] = cur.get('extent', '') + ' ' + txt
            continue
        m = NUM_RE.match(txt)
        nxt = (acs[-1]['ac_no'] + 1) if acs else 1
        if m and int(m.group(1)) == nxt:
            cur = OrderedDict(ac_no=nxt, raw=m.group(2), district_2008=dist, page=pn)
            acs.append(cur)
        elif cur is not None:
            # a wrapped word ("Kilvaithinankuppa" / "m (SC)") or a hyphen-wrapped name joins without a space
            glue = cur['raw'].endswith('-') or re.match(r'[a-z]', txt)
            cur['raw'] = (cur['raw'] + txt) if glue else (cur['raw'] + ' ' + txt)
        else:
            info('unattached name-column text p%d' % pn, txt)
    for a in acs:
        raw = clean(a['raw']).strip(' .,')
        raw = re.sub(r'\s*-\s*', '-', raw)
        res = re.findall(r'\(\s*(SC|ST|BL)\s*\)', raw)
        name = re.sub(r'\s*\(\s*(SC|ST|BL)\s*\)\s*', ' ', raw).strip(' .,')
        a['ac_name'] = name
        a['res'] = res[0] if res else ''
    return acs


# ------------------------------------------------------------------ 2008 district -> Census 2011 lineage
# (district_2008 heading as printed, continuing census-2011 code, carved census-2011 codes, note)
WP = 'Wikipedia district article'
DISTRICTS = {
    'Punjab': [
        ('GURDASPUR', '035', [], 'Pathankot district was carved from Gurdaspur on 27-07-2011, after the Census-2011 '
                                 'frame; Census 2011 still counts it inside Gurdaspur (subdistricts incl. Pathankot, Dhar Kalan)'),
        ('AMRITSAR', '049', ['050'], 'Tarn Taran carved out of Amritsar in 2006 (%s; Census-2011 Tarn Taran = Tarn Taran, '
                                     'Patti, Khadur Sahib tehsils)' % WP),
        ('KAPURTHALA', '036', [], ''),
        ('JALANDHAR', '037', [], ''),
        ('HOSHIARPUR', '038', [], ''),
        ('NAWAN SHAHR', '039', [], 'renamed Shahid Bhagat Singh Nagar in 2008 (same district: Nawanshahr + Balachaur tehsils)'),
        ('RUPNAGAR', '051', ['052'], 'SAS Nagar (Mohali) carved in April 2006 from Ropar (Mohali, Kharar tehsils) and '
                                     'Patiala (Dera Bassi tehsil) (%s; Census-2011 subdistricts Kharar, SAS Nagar, Dera Bassi)' % WP),
        ('FATEHGARH SAHIB', '040', [], ''),
        ('LUDHIANA', '041', [], ''),
        ('MOGA', '042', [], ''),
        ('FIROZPUR', '043', [], 'Fazilka district was carved from Firozpur on 27-07-2011, after the Census-2011 frame; '
                                'Census 2011 still counts it inside Firozpur (subdistricts incl. Fazilka, Abohar, Jalalabad)'),
        ('MUKTSAR', '044', [], 'officially Sri Muktsar Sahib'),
        ('FARIDKOT', '045', [], ''),
        ('BATHINDA', '046', [], ''),
        ('MANSA', '047', [], ''),
        ('SANGRUR', '053', ['054'], 'Barnala carved out of Sangrur on 19-11-2006 (%s; Census-2011 Barnala = Barnala, Tapa)' % WP),
        ('PATIALA', '048', ['052'], 'Dera Bassi tehsil of Patiala went to the new SAS Nagar district in 2006 '
                                    '(order AC 112 Dera Bassi = Dera Bassi Tehsil)'),
    ],
    'Rajasthan': [
        ('GANGANAGAR', '099', [], ''),
        ('HANUMANGARH', '100', [], ''),
        ('BIKANER', '101', [], ''),
        ('CHURU', '102', [], ''),
        ('JHUNJHUNU', '103', [], 'Census spelling Jhunjhunun'),
        ('SIKAR', '111', [], ''),
        ('JAIPUR', '110', [], ''),
        ('ALWAR', '104', [], ''),
        ('BHARATPUR', '105', [], ''),
        ('DHOLPUR', '106', [], 'Census spelling Dhaulpur'),
        ('KARAULI', '107', [], ''),
        ('DAUSA', '109', [], ''),
        ('SAWAI MADHOPUR', '108', [], ''),
        ('TONK', '120', [], ''),
        ('AJMER', '119', [], ''),
        ('NAGAUR', '112', [], ''),
        ('PALI', '118', [], ''),
        ('JODHPUR', '113', [], ''),
        ('JAISALMER', '114', [], ''),
        ('BARMER', '115', [], ''),
        ('JALORE', '116', [], 'Census spelling Jalor'),
        ('SIROHI', '117', [], ''),
        ('UDAIPUR', '130', ['131'], 'Pratapgarh district (26-01-2008) took Dhariyawad tehsil from Udaipur (%s; Census-2011 '
                                    'Pratapgarh subdistricts Dhariawad, Peepalkhoont, Chhoti Sadri, Pratapgarh, Arnod)' % WP),
        ('DUNGARPUR', '124', [], ''),
        ('BANSWARA', '125', ['131'], 'Pratapgarh district (26-01-2008) took Peepal Khoont from Banswara (%s)' % WP),
        ('CHITTORGARH', '126', ['131'], 'Census spelling Chittaurgarh; Pratapgarh district (26-01-2008) took Pratapgarh, '
                                        'Arnod and Chhoti Sadri tehsils from Chittorgarh (%s)' % WP),
        ('RAJSAMAND', '123', [], ''),
        ('BHILWARA', '122', [], ''),
        ('BUNDI', '121', [], ''),
        ('KOTA', '127', [], ''),
        ('BARAN', '128', [], ''),
        ('JHALAWAR', '129', [], ''),
    ],
    'Sikkim': [
        ('WEST', '242', [], 'Census name West District'),
        ('SOUTH', '243', [], 'Census name South District'),
        ('EAST', '244', [], 'Census name East District'),
        ('NORTH', '241', [], 'Census name North District'),
    ],
    'Tamil Nadu': [
        ('THIRUVALLUR', '602', [], ''),
        ('CHENNAI', '603', [], 'Census-2011 Chennai = the pre-2018 city district; the 2011 corporation expansion did not '
                               'move district lines until 2018'),
        ('KANCHEEPURAM', '604', [], ''),
        ('VELLORE', '605', [], ''),
        ('KRISHNAGIRI', '631', [], 'carved from Dharmapuri in 2004, already separate in the order'),
        ('DHARMAPURI', '630', [], ''),
        ('TIRUVANNAMALAI', '606', [], ''),
        ('VILUPPURAM', '607', [], ''),
        ('SALEM', '608', [], ''),
        ('NAMAKKAL', '609', [], ''),
        ('ERODE', '610', ['633'], 'Tiruppur district (22-02-2009) carved out of Coimbatore and Erode (%s); from Erode it '
                                  'took Dharapuram and Kangeyam taluks (Census-2011 Tiruppur subdistricts)' % WP),
        ('THE NILGIRIS', '611', [], ''),
        ('COIMBATORE', '632', ['633'], 'Tiruppur district (22-02-2009) carved out of Coimbatore and Erode (%s); from '
                                       'Coimbatore it took Tiruppur, Avanashi, Palladam, Udumalaipettai (+Madathukulam)' % WP),
        ('DINDIGUL', '612', [], ''),
        ('KARUR', '613', [], ''),
        ('TIRUCHIRAPPALLI', '614', [], ''),
        ('PERAMBALUR', '615', ['616'], 'Ariyalur re-carved out of Perambalur on 23-11-2007 (%s; Census-2011 Ariyalur = '
                                       'Ariyalur, Udayarpalayam, Sendurai taluks)' % WP),
        ('CUDDALORE', '617', [], ''),
        ('NAGAPATTINAM', '618', [], ''),
        ('THIRUVARUR', '619', [], ''),
        ('THANJAVUR', '620', [], ''),
        ('PUDUKKOTTAI', '621', [], ''),
        ('SIVAGANGA', '622', [], ''),
        ('MADURAI', '623', [], ''),
        ('THENI', '624', [], ''),
        ('VIRUDHUNAGAR', '625', [], ''),
        ('RAMANATHAPURAM', '626', [], ''),
        ('THOOTHUKKUDI', '627', [], ''),
        ('TIRUNELVELI', '628', [], ''),
        ('KANNIYAKUMARI', '629', [], ''),
    ],
    'Tripura': [
        ('WEST TRIPURA', '289', [], 'Tripura went from 4 to 8 districts in Jan 2012, after the Census-2011 frame'),
        ('SOUTH TRIPURA', '290', [], 'Tripura went from 4 to 8 districts in Jan 2012, after the Census-2011 frame'),
        ('DHALAI', '291', [], ''),
        ('NORTH TRIPURA', '292', [], 'Tripura went from 4 to 8 districts in Jan 2012, after the Census-2011 frame'),
    ],
}

# ACs whose printed extent crosses the district heading they sit under (found by scanning every extent for
# "District"; verified by reading the order). Machine-readable token first, then the evidence.
AC_NOTES = {
    ('Sikkim', 8): 'also_in_district_2008=SOUTH; extent = Nayabazar of Soreng Sub-Division in District West + Jorethang (NTA) '
                   'and Salghari Revenue Block of Namchi Sub-Division in District South - the AC straddles West and South',
    ('Sikkim', 16): 'also_in_district_2008=EAST; extent = Paiyong, Lingmo, Pepthang of Rabong Sub-Division in District South + '
                    'Rakdong, Tintek, Kambal, Samdong, Raley-Khese, Tumen, Patuk, Singbel of Gangtok Sub-Division in '
                    'District East - the AC straddles South and East',
    ('Sikkim', 29): 'also_in_district_2008=EAST; extent = Mangan Sub-Division blocks of District North + Lingdok, Nampong, '
                    'Navey, Shotak, Penlong, Upper Chandmari, Kyongnosla, Pangthang and Gangtok Forest Blocks of Gangtok '
                    'Sub-Division in District East - the AC straddles North and East',
    ('Tamil Nadu', 139): 'enclave_of=PUDUKKOTTAI; includes Komangalam village (Iluppur Taluk, Pudukkottai revenue district), '
                         'which the order says lies physically inside Srirangam AC',
    ('Tamil Nadu', 175): 'enclave_of=PUDUKKOTTAI; includes Kalyaranviduthy, Kavalipatti, Kaduvettividuthy villages (Alangudi '
                         'Taluk, Pudukkottai revenue district), physically inside Orathanadu AC per the order',
    ('Tamil Nadu', 177): 'enclave_of=PUDUKKOTTAI; includes Kattathi village (Alangudi Taluk, Pudukkottai revenue district), '
                         'physically inside Peravurani AC per the order',
    ('Tamil Nadu', 179): 'enclave_of=TIRUCHIRAPPALLI; includes Kavinaripatti, Puthakudi, Kappakudi villages (Manaparai Taluk, '
                         'Tiruchirappalli revenue district), physically inside Viralimalai AC per the order',
    ('Tamil Nadu', 185): 'enclave_of=PUDUKKOTTAI; includes Palakkuruchi village (Thirumayam Taluk, Pudukkottai revenue '
                         'district), physically inside Tiruppattur AC per the order',
}

# every app-vs-order spelling difference, judged by reading both (none is a row shift - see the shift test)
VARIANTS = {
    ('Rajasthan', 2): 'honorific prefix: app SRI GANGANAGAR = order Ganganagar',
    ('Rajasthan', 3): 'honorific prefix: app SRI KARANPUR = order Karanpur',
    ('Rajasthan', 38): 'spelling: Neema Ka Thana / Neem Ka Thana',
    ('Rajasthan', 106): 'spelling: Ladnun / Ladnu',
    ('Rajasthan', 167): 'spelling: Kapasan / Kapasin',
    ('Rajasthan', 179): 'spelling: Sahara / Sahada (r/d transliteration)',
    ('Sikkim', 7): 'spelling: Soreng / Soreong',
    ('Sikkim', 8): 'truncation in app: Salghari-Zoom / SALGHARI-ZOO',
    ('Sikkim', 18): 'truncation in app: West Pendam / WEST PENDA',
}
TN_VARIANT = 'Tamil transliteration variant (same seat)'
# the 30 Tamil Nadu differences, each read side by side (e.g. Gummidipoondi/GUMMIDIPUNDI, Sirkazhi/SIRKALI,
# Udumalaipettai/UDUMALPET); a NEW difference after a re-run is reported UNJUDGED and fails the check
TN_VARIANT_NOS = {1, 10, 24, 35, 38, 39, 46, 47, 57, 74, 77, 78, 86, 93, 96, 100, 111, 125, 130, 140, 141, 142, 160,
                  166, 170, 175, 183, 207, 212, 226}


def similar(a, b):
    import difflib
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


def write_csv(path, rows, cols):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, '') for c in cols})


def main():
    doc = fitz.open(PDF)
    seats = json.load(open(APP_SEATS, encoding='utf-8'))
    pca = pd.read_csv(PCA, dtype=str)
    pca = pca[pca.tru == 'Total']
    overlay_f = os.path.join(HERE, '..', 'seat_district_overlay.csv')
    overlay = pd.read_csv(overlay_f, dtype=str) if os.path.exists(overlay_f) else None
    summary = []
    for st, lab, sch, p0, p1, split, nseats, yr, c11 in STATES:
        print('\n=====', st)
        slug = re.sub(r'[^a-z0-9]+', '_', st.lower()).strip('_')
        acs = parse_state(doc, p0, p1, split)
        src = SRC % sch
        rows = []
        for a in acs:
            notes = []
            if a['res']:
                notes.append('reserved=' + a['res'])
            if (st, a['ac_no']) in AC_NOTES:
                notes.append(AC_NOTES[(st, a['ac_no'])])
            rows.append(OrderedDict(state=st, ac_no=a['ac_no'], ac_name=a['ac_name'], district_2008=a['district_2008'],
                                    source=src, page=a['page'], note='; '.join(notes)))
        if st == 'Sikkim':
            rows.append(OrderedDict(state=st, ac_no=32, ac_name='Sangha', district_2008='', source=(
                'ECI Delimitation Order 2008, Schedule II footnote ** (RP Act 1950 s.7(1A))'), page=7,
                note='reserved=Sangha; NON-TERRITORIAL seat for the Sanghas (monasteries) of the whole state - not '
                     'listed in Table A, has no district; never veto/place it by polygon'))
        # ---- checks: count, contiguity, uniqueness
        nos = [r['ac_no'] for r in rows]
        check('%s: AC count = %d seats' % (st, nseats), len(rows) == nseats, 'got %d' % len(rows))
        check('%s: AC numbers contiguous 1..%d, no duplicates' % (st, nseats), nos == list(range(1, nseats + 1)))
        check('%s: every AC has a district (Sikkim 32 Sangha excepted)' % st,
              all(r['district_2008'] for r in rows if not (st == 'Sikkim' and r['ac_no'] == 32)))
        # ---- name agreement with the app's first post-2008 election
        app = {r['n']: r['c'] for r in seats if r['s'] == st and r['y'] == yr}
        check('%s: app %d has %d seats' % (st, yr, nseats), len(app) == nseats, 'got %d' % len(app))
        same, mism, shifts, unjudged = 0, [], [], []
        for r in rows:
            ap = app.get(r['ac_no'], '')
            if norm(ap) == norm(r['ac_name']):
                same += 1
                continue
            k = (st, r['ac_no'])
            judged = VARIANTS.get(k) or (TN_VARIANT if st == 'Tamil Nadu' and r['ac_no'] in TN_VARIANT_NOS else None)
            sim0 = similar(ap, r['ac_name'])
            nb = max([similar(app.get(r['ac_no'] + d, ''), r['ac_name']) for d in (-1, 1)])
            if nb > sim0:
                shifts.append((r['ac_no'], r['ac_name'], ap, round(sim0, 2), round(nb, 2)))
            if not judged:
                unjudged.append((r['ac_no'], r['ac_name'], ap))
            mism.append('%d %s | app %s | sim %.2f | %s' % (r['ac_no'], r['ac_name'], ap, sim0, judged or 'UNJUDGED'))
        pct = round(100.0 * same / len(rows), 2)
        info('%s: exact name agreement vs app %d (normalised: upper, no (SC)/(ST)/(BL), letters only)' % (st, yr),
             '%d/%d = %.2f%%' % (same, len(rows), pct))
        for m in mism:
            info('%s: name differs' % st, m)
        check('%s: every name difference judged a spelling variant' % st, not unjudged, unjudged or '')
        check('%s: row-shift test - no mismatch matches a neighbouring app seat better than its own' % st,
              not shifts, shifts or '')
        # ---- reservation vs app (info)
        rapp = {r['n']: r.get('r', '') for r in seats if r['s'] == st and r['y'] == yr}
        rdiff = []
        for r in rows:
            mo = re.search(r'reserved=(\w+)', r['note'])
            o = mo.group(1) if mo else 'GEN'
            o = {'Sangha': 'GEN'}.get(o, o)
            if (rapp.get(r['ac_no']) or 'GEN') != o:
                rdiff.append((r['ac_no'], rapp.get(r['ac_no']), o))
        info('%s: reservation vs app r-field (Sangha counted as GEN, as the app stores it)' % st,
             '%d differ %s' % (len(rdiff), rdiff if rdiff else ''))
        # ---- district lineage
        drows = DISTRICTS[st]
        heads = list(OrderedDict.fromkeys(r['district_2008'] for r in rows if r['district_2008']))
        ok = [d[0] for d in drows] == heads
        check('%s: lineage table covers exactly the order headings (%d)' % (st, len(heads)), ok,
              '' if ok else (heads, [d[0] for d in drows]))
        cstate = pca[pca.state_name == c11]
        codes = dict(zip(cstate.district_code, cstate.district_name))
        used, bad = set(), []
        for d, cont, carved, _ in drows:
            for c in [cont] + carved:
                if c in codes:
                    used.add(c)
                else:
                    bad.append((d, c))
        check('%s: every lineage code is a real Census-2011 district of %s' % (st, c11), not bad, bad or '')
        missing = sorted(set(codes) - used)
        check('%s: every Census-2011 district (%d) appears as continuing or carved' % (st, len(codes)), not missing,
              [(m, codes[m]) for m in missing] or '')
        conts = Counter(d[1] for d in drows)
        check('%s: no Census-2011 code is the continuing code of two order districts' % st,
              all(v == 1 for v in conts.values()))
        dout = []
        for d, cont, carved, note in drows:
            nm = codes.get(cont, '?')
            extra = [] if nm.upper() == d else ['Census-2011 name %s' % nm]
            if extra and note.startswith('Census'):
                extra = []
            dout.append(OrderedDict(state=st, district_2008=d, continuing_2011_code=cont,
                                    carved_2011_codes=';'.join(carved),
                                    note='; '.join([x for x in extra + [note] if x])))
            info('%s: %s -> %s %s%s (%d ACs)' % (st, d, cont, nm, (' + carved ' + ';'.join(
                '%s %s' % (c, codes[c]) for c in carved)) if carved else '',
                sum(1 for r in rows if r['district_2008'] == d)))
        # ---- informational: the polygon overlay vs the allowed set
        if overlay is not None:
            allowed = {d: {cont, *carved} for d, cont, carved, _ in drows}
            ov = overlay[(overlay.layer == 'AC') & (overlay.geo_state == c11)]
            veto = []
            for r in rows:
                if not r['district_2008']:
                    continue
                al = set(allowed[r['district_2008']])
                mo = re.search(r'also_in_district_2008=([A-Z ]+?);', r['note'] + ';')
                if mo:
                    al |= allowed[mo.group(1)]
                for o in ov[ov.seat_no == str(r['ac_no'])].itertuples():
                    dc = str(o.district_code).zfill(3)
                    if dc not in al and float(o.share) >= 0.05:
                        veto.append('%d %s -> %s %s share %s' % (r['ac_no'], r['ac_name'], dc, codes.get(dc, '?'),
                                                                 o.share))
            info('%s: polygon-overlay pieces (share>=5%%) the official list would veto' % st,
                 '%d: %s' % (len(veto), veto))
        write_csv(os.path.join(HERE, slug + '_acs.csv'), rows,
                  ['state', 'ac_no', 'ac_name', 'district_2008', 'source', 'page', 'note'])
        write_csv(os.path.join(HERE, slug + '_districts.csv'), dout,
                  ['state', 'district_2008', 'continuing_2011_code', 'carved_2011_codes', 'note'])
        summary.append((st, len(rows), nseats, len(heads), pct, mism))
    with open(os.path.join(HERE, 'g4_validation.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(CHECKS) + '\n')
    print('\nFAILS:', sum(c.startswith('FAIL') for c in CHECKS))
    return summary


if __name__ == '__main__':
    main()
