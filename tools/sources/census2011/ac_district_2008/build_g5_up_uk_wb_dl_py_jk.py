#!/usr/bin/env python3
"""
Official AC -> district (as delimited) lists for Uttar Pradesh, Uttarakhand, West Bengal, Delhi, Puducherry and the
Jammu & Kashmir ANNEXURE (87 ACs, incl. the 4 Ladakh ACs 47-50), parsed from TABLE A / PART A of the ECI
"Delimitation of Parliamentary and Assembly Constituencies Order, 2008" (English), plus a
2008-district -> Census-2011-district lineage table for each state.

Source PDF (read only):
  ../ac_district_lists/raw/eci_delimitation_order_2008_english.pdf
  https://www.eci.gov.in/Documents/Delimitation/DelimitationofParliamentaryAssemblyConstituenciesOrder-2008(English).pdf
Printed page numbers == 0-based PDF page indexes.

Outputs (next to this script), per state slug (uttar_pradesh, uttarakhand, west_bengal, delhi, puducherry,
jammu_kashmir):
  <slug>_acs.csv        state,ac_no,ac_name,district_2008,source,page,note
  <slug>_districts.csv  state,district_2008,continuing_2011_code,carved_2011_codes,note
  g5_validation.txt     every check run (counts, contiguity, name agreement vs app, district-code coverage)

Supporting raw file (raw_g5/):
  ceodelhi_DEOs_2011.pdf  CEO Delhi list of the 9 District Election Officers, as archived 2011-10-11:
  https://web.archive.org/web/20111011210400/http://ceodelhi.gov.in/WriteReadData/TelephoneDirectory/DEOs.pdf
  (used only to name Delhi's 9 pre-2012 revenue districts; it does not assign ACs to districts)

Read-only cross-checks:
  ../../../../public/data/seats_ae.json     app seats (first post-2008 assembly election of each state)
  ../pca/pca_district_2011.csv              Census 2011 district names/codes (tru == 'Total')
  ../seat_district_overlay.csv              AC-polygon x 2011-district overlay (INFO: polygon district attribute
                                            agreement + which placements the veto would reject)

Notes
  * Delhi: Schedule XXXI Table A has NO district headings (ACs are described by 2001 MCD wards / EBs / villages),
    so the order gives no AC -> district assignment; district_2008 is left blank for every Delhi AC.
  * J&K: the Annexure reproduces J&K Delimitation Commission Order No. 1 (gazetted 27-04-1995) - the 87 ACs used for
    the 1996, 2002, 2008 and 2014 J&K assembly elections. ACs 47-50 (Nobra, Leh, Kargil, Zanskar) are written with
    state = 'Ladakh' (the app's state for them); everything else is 'Jammu & Kashmir'.

Run: python build_g5_up_uk_wb_dl_py_jk.py      Requires: PyMuPDF (fitz), pandas.
"""
import csv, difflib, json, os, re
from collections import Counter, OrderedDict

import fitz  # PyMuPDF
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = os.path.normpath(os.path.join(HERE, '..', 'ac_district_lists', 'raw', 'eci_delimitation_order_2008_english.pdf'))
APP_SEATS = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', 'public', 'data', 'seats_ae.json'))
PCA = os.path.normpath(os.path.join(HERE, '..', 'pca', 'pca_district_2011.csv'))
SRC = 'ECI Delimitation of Parliamentary and Assembly Constituencies Order, 2008 (English), %s'

# slug, app state, source label, first/last page (0-based == printed), name-column split x, contiguity gap for name
# text running past the split (None = off), seat count, first post-2008 AE year in the app, census-2011 state name,
# whether Table A has district headings
STATES = [
    ('uttar_pradesh', 'Uttar Pradesh', 'Schedule XXVIII Uttar Pradesh, Part A', 458, 501, 208, None, 403, 2012,
     'UTTAR PRADESH', True),
    ('uttarakhand', 'Uttarakhand', 'Schedule XXIX Uttarakhand, Part A', 506, 515, 210, None, 70, 2012,
     'UTTARAKHAND', True),
    ('west_bengal', 'West Bengal', 'Schedule XXX West Bengal, Table A', 516, 539, 206, None, 294, 2011,
     'WEST BENGAL', True),
    ('delhi', 'Delhi', 'Schedule XXXI NCT of Delhi, Table A', 543, 556, 208, 4.5, 70, 2013,
     'NCT OF DELHI', False),
    ('puducherry', 'Puducherry', 'Schedule XXXII Puducherry, Table A', 557, 560, 195, None, 30, 2011,
     'PUDUCHERRY', True),
    ('jammu_kashmir', 'Jammu & Kashmir', 'Annexure-I Jammu and Kashmir (Assembly Constituencies only)', 561, 571,
     195, None, 87, 2014, 'JAMMU & KASHMIR', True),
]
# Delhi's first post-2008 AE was Nov 2008, but the app's Delhi series starts in 2013 (same 2008 map).
# J&K's first post-2008 AE in the app is 2014 (J&K 83 ACs + 'Ladakh' 4 ACs 47-50), same 1995 map as 2008.
LADAKH_ACS = {47, 48, 49, 50}

CHECKS = []


def check(name, ok, detail=''):
    CHECKS.append(('OK  ' if ok else 'FAIL') + ' | ' + name + (' | ' + str(detail) if detail != '' else ''))
    print(CHECKS[-1])


def info(name, detail=''):
    CHECKS.append('INFO | ' + name + (' | ' + str(detail) if detail != '' else ''))
    print(CHECKS[-1])


def clean(s):
    s = s.replace('�', '-').replace('–', '-').replace('—', '-').replace('\xad', '-')
    return re.sub(r'\s+', ' ', s).strip()


def norm(s):
    s = re.sub(r'\((SC|ST)\)', '', s.upper())
    return re.sub(r'[^A-Z]', '', s)


# ------------------------------------------------------------------ PDF text helpers
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


def name_chars(cs, split, ext_gap):
    """Chars of the name column: x0 < split, then (optionally) chars running on past the split with no real gap."""
    out = [c for c in cs if c[1] < split]
    if ext_gap is None or not out:
        return out
    last = max((c[2] for c in out if c[3] != ' '), default=None)
    for c in cs:
        if c[1] < split:
            continue
        if c[3] == ' ':
            continue
        if last is not None and c[1] - last <= ext_gap:
            out.append(c)
            last = c[2]
        else:
            break
    out.sort(key=lambda t: t[1])
    return out


HEAD_RE = re.compile(r'^\s*(\d+)\s*-?\s*DISTRICT?\s*:\s*(.+?)\s*$')   # 'DISTRIC' typo occurs (UP 12, 66)
END_RE = re.compile(r'(TABLE|PART)\s*-?\s*B\s*-')
START_RE = re.compile(r'(TABLE|PART)\s*-?\s*A\s*-|ASSEMBLY CONSTITUENCIES & THEIR EXTENT')
FOOT_RE = re.compile(r'^(NOTE|Note)\b|^Any reference in|^\(#\)|^\(\d\) Any reference')
NUM_RE = re.compile(r'^(\d+)\s*[.\-]?\s*(.*)$')


def stream(doc, p0, p1, split, ext_gap, headings):
    """Ordered list of ('H', page, district) / ('N', page, name-column text) / ('E', page, extent text)."""
    out, started = [], False
    for pn in range(p0, p1 + 1):
        for y, cs in char_rows(doc[pn]):
            full = clean(join_chars(cs))
            if END_RE.search(full):
                return out
            if not headings and START_RE.search(full):
                started = True
                continue
            m = HEAD_RE.match(full)
            if m and 'DISTRIC' in full:
                out.append(('H', pn, clean(m.group(2))))
                started = True
                continue
            if not started:
                continue
            if FOOT_RE.search(full):
                if full.startswith(('Note', 'NOTE')):   # J&K annexure ends with "Note: - Any reference ..."
                    return out
                continue
            nm = name_chars(cs, split, ext_gap)
            ids = {id(c) for c in nm}
            ext = clean(join_chars([c for c in cs if id(c) not in ids]))
            if ext and not (re.fullmatch(r'\d{3}', ext) and int(ext) == pn):
                out.append(('E', pn, ext))
            txt = clean(join_chars(nm))
            if not txt or txt.startswith('Sl. No') or re.fullmatch(r'\d{3}', txt) and int(txt) == pn:
                continue
            out.append(('N', pn, txt))
    return out


def parse_state(doc, p0, p1, split, ext_gap, headings):
    acs, dist, cur, conts = [], ('' if not headings else None), None, []
    for kind, pn, txt in stream(doc, p0, p1, split, ext_gap, headings):
        if kind == 'H':
            dist = txt
            cur = None
            continue
        if kind == 'E':
            if cur is not None:
                cur['extent'] = (cur.get('extent', '') + ' ' + txt).strip()
            continue
        m = NUM_RE.match(txt)
        nxt = (acs[-1]['ac_no'] + 1) if acs else 1
        if m and int(m.group(1)) == nxt:
            cur = OrderedDict(ac_no=nxt, raw=m.group(2), district_2008=dist, page=pn)
            acs.append(cur)
        elif acs:
            # wrapped AC name (or a name vertically centred after its number); attach to the last AC
            a = acs[-1]
            conts.append((a['ac_no'], pn, txt))
            a['raw'] = (a['raw'] + txt) if a['raw'].endswith('-') else (a['raw'] + ' ' + txt)
        else:
            info('unattached name-column text p%d' % pn, txt)
    for a in acs:
        raw = clean(a['raw']).strip(' .,')
        raw = re.sub(r'\s*-\s*', '-', raw)
        res = re.findall(r'\(\s*(SC|ST)\s*\)', raw)
        name = re.sub(r'\s*\(\s*(SC|ST)\s*\)\s*', ' ', raw).strip(' .,')
        a['ac_name'] = re.sub(r'\s+', ' ', name)
        a['res'] = res[0] if res else ''
    return acs, conts


# ------------------------------------------------------------------ 2008 district -> Census 2011 lineage
# (district_2008 exactly as the order's heading prints it) -> (continuing 2011 code, [carved 2011 codes], note)
UP_NOTE_POST = ('Census 2011 froze district boundaries before the Sep-2011 UP districts (Shamli/Prabuddh Nagar, '
                'Sambhal/Bhim Nagar, Hapur/Panchsheel Nagar) and the Jul-2010 Chhatrapati Shahuji Maharaj Nagar '
                '(Amethi); none of them is a Census 2011 district')
LINEAGE = {
    'Uttar Pradesh': OrderedDict([
        ('SAHARANPUR', ('132', [], '')),
        ('MUZAFFARNAGAR', ('133', [], 'Shamli (Prabuddh Nagar) carved Sep 2011 - after Census 2011, not a census district')),
        ('BIJNOR', ('134', [], '')),
        ('MORADABAD', ('135', [], 'Sambhal (Bhim Nagar) carved Sep 2011 - after Census 2011, not a census district')),
        ('RAMPUR', ('136', [], '')),
        ('JYOTIBA PHULE NAGAR', ('137', [], 'renamed Amroha (2012)')),
        ('MEERUT', ('138', [], '')),
        ('BAGHPAT', ('139', [], '')),
        ('GHAZIABAD', ('140', [], 'Hapur (Panchsheel Nagar) carved Sep 2011 - after Census 2011, not a census district')),
        ('GAUTAM BUDDHA NAGAR', ('141', [], '')),
        ('BULANDSHAHAR', ('142', [], 'Census 2011 spelling Bulandshahr')),
        ('ALIGARH', ('143', [], 'order heading misprinted "DISTRIC : ALIGARH"')),
        ('MAHAMAYA NAGAR', ('144', [], 'renamed Hathras (2012)')),
        ('MATHURA', ('145', [], '')),
        ('AGRA', ('146', [], '')),
        ('FIROZABAD', ('147', [], '')),
        ('ETAH', ('201', ['202'], 'Kanshiram Nagar (now Kasganj, 202) carved 17-Apr-2008 from Etah (Kasganj, Patiyali, '
                                  'Sahawar tehsils) - after this order, before Census 2011')),
        ('MAINPURI', ('148', [], '')),
        ('BUDAUN', ('149', [], '')),
        ('BAREILLY', ('150', [], '')),
        ('PILIBHIT', ('151', [], '')),
        ('SHAHJAHANPUR', ('152', [], '')),
        ('KHERI', ('153', [], '')),
        ('SITAPUR', ('154', [], '')),
        ('HARDOI', ('155', [], '')),
        ('UNNAO', ('156', [], '')),
        ('LUCKNOW', ('157', [], '')),
        ('RAE BARELI', ('158', [], 'CSM Nagar (Amethi) carved Jul 2010 partly from Rae Bareli is NOT a Census 2011 district')),
        ('SULTANPUR', ('179', [], 'CSM Nagar (Amethi) carved Jul 2010 partly from Sultanpur is NOT a Census 2011 district')),
        ('FARRUKHABAD', ('159', [], '')),
        ('KANNAUJ', ('160', [], '')),
        ('ETAWAH', ('161', [], '')),
        ('AURAIYA', ('162', [], '')),
        ('KANPUR DEHAT', ('163', [], '')),
        ('KANPUR NAGAR', ('164', [], '')),
        ('JALAUN', ('165', [], '')),
        ('JHANSI', ('166', [], '')),
        ('LALITPUR', ('167', [], '')),
        ('HAMIRPUR', ('168', [], '')),
        ('MAHOBA', ('169', [], '')),
        ('BANDA', ('170', [], '')),
        ('CHITRAKOOT', ('171', [], '')),
        ('FATEHPUR', ('172', [], '')),
        ('PRATAPGARH', ('173', [], '')),
        ('KAUSHAMBI', ('174', [], '')),
        ('ALLAHABAD', ('175', [], 'renamed Prayagraj (2018)')),
        ('BARABANKI', ('176', ['177'], 'Census 2011 spelling Bara Banki. 177 Faizabad is NOT a new district - it is '
                                       'listed because of a TERRITORY TRANSFER: the order puts AC 271 Rudauli '
                                       '("1-Rudauli Tehsil" + 5 PCs of Ram Sanehi Ghat tehsil) under Barabanki, but '
                                       'Census 2011 has Rudauli sub-district (00902) inside Faizabad (177); the '
                                       'polygon overlay agrees (271 = 88% in 177)')),
        ('FAIZABAD', ('177', [], 'renamed Ayodhya (2018); in Census 2011 it also contains Rudauli tehsil, which the '
                                 'order counts under Barabanki (AC 271)')),
        ('AMBEDKAR NAGAR', ('178', [], '')),
        ('BAHRAICH', ('180', [], '')),
        ('SHRAWASTI', ('181', [], '')),
        ('BALRAMPUR', ('182', [], '')),
        ('GONDA', ('183', [], '')),
        ('SIDDHARTHNAGAR', ('184', [], '')),
        ('BASTI', ('185', [], '')),
        ('SANT KABIR NAGAR', ('186', [], '')),
        ('MAHARAJGANJ', ('187', [], 'Census 2011 spelling Mahrajganj')),
        ('GORAKHPUR', ('188', [], '')),
        ('KUSHI NAGAR', ('189', [], 'Census 2011 spelling Kushinagar')),
        ('DEORIA', ('190', [], '')),
        ('AZAMGARH', ('191', [], '')),
        ('MAU', ('192', [], '')),
        ('BALLIA', ('193', [], '')),
        ('JAUNPUR', ('194', [], '')),
        ('GHAZIPUR', ('195', [], '')),
        ('CHANDAULI', ('196', [], 'order heading misprinted "DISTRIC : CHANDAULI"')),
        ('VARANASI', ('197', [], '')),
        ('SANT RAVIDAS NAGAR', ('198', [], 'Census 2011: Sant Ravidas Nagar (Bhadohi)')),
        ('MIRZAPUR', ('199', [], '')),
        ('SONBHADRA', ('200', [], '')),
    ]),
    'Uttarakhand': OrderedDict([
        ('UTTARKASHI', ('056', [], '')),
        ('CHAMOLI', ('057', [], '')),
        ('RUDRYAPRAYAG', ('058', [], 'order heading misprint of Rudraprayag')),
        ('TEHRI GARHWAL', ('059', [], '')),
        ('DEHRADUN', ('060', [], '')),
        ('HARDWAR', ('068', [], 'also spelt Haridwar')),
        ('GARHWAL', ('061', [], 'Pauri Garhwal')),
        ('PITHORAGARH', ('062', [], '')),
        ('BAGESHWAR', ('063', [], '')),
        ('ALMORA', ('064', [], '')),
        ('CHAMPAWAT', ('065', [], '')),
        ('NAINITAL', ('066', [], '')),
        ('UDHAMSINGH NAGAR', ('067', [], 'Census 2011 spelling Udham Singh Nagar')),
    ]),
    'West Bengal': OrderedDict([
        ('COOCHBEHAR', ('329', [], 'Census 2011 spelling Koch Bihar')),
        ('JALPAIGURI', ('328', [], 'Alipurduar carved Jun 2014 - after Census 2011, not a census district')),
        ('DARJEELING', ('327', [], 'Census 2011 spelling Darjiling; Kalimpong carved 2017 - after Census 2011')),
        ('UTTAR DINAJPUR', ('330', [], '')),
        ('DAKSHIN DINAJPUR', ('331', [], '')),
        ('MALDAHA', ('332', [], 'Census 2011 spelling Maldah')),
        ('MURSHIDABAD', ('333', [], '')),
        ('NADIA', ('336', [], '')),
        ('NORTH 24 PARGANAS', ('337', [], 'Census 2011: North Twenty Four Parganas')),
        ('SOUTH 24 PARGANAS', ('343', [], 'Census 2011: South Twenty Four Parganas')),
        ('KOLKATA', ('342', [], '')),
        ('HOWRAH', ('341', [], 'Census 2011 spelling Haora')),
        ('HOOGHLY', ('338', [], 'Census 2011 spelling Hugli')),
        ('PURBO MEDINIPUR', ('345', [], 'Census 2011: Purba Medinipur')),
        ('PASCHIM MEDINIPUR', ('344', [], 'Jhargram carved 2017 - after Census 2011')),
        ('PURULIA', ('340', [], 'Census 2011 spelling Puruliya')),
        ('BANKURA', ('339', [], '')),
        ('BARDHAMAN', ('335', [], 'Census 2011 spelling Barddhaman; split into Purba/Paschim Bardhaman 2017 - after Census 2011')),
        ('BIRBHUM', ('334', [], '')),
    ]),
    # Delhi: the order has no district headings. The 9 revenue districts of 1997-2012 (= Census 2001 and 2011
    # districts) are listed for completeness, named as in CEO Delhi's 2011 list of District Election Officers.
    'Delhi': OrderedDict([
        ('NORTH WEST', ('090', [], '')),
        ('NORTH', ('091', [], '')),
        ('NORTH EAST', ('092', [], '')),
        ('EAST', ('093', [], '')),
        ('NEW DELHI', ('094', [], '')),
        ('CENTRAL', ('095', [], '')),
        ('WEST', ('096', [], '')),
        ('SOUTH WEST', ('097', [], '')),
        ('SOUTH', ('098', [], '')),
    ]),
    'Puducherry': OrderedDict([
        ('PUDUCHERRY REGION', ('635', [], 'Census 2011: Puducherry (Pondicherry)')),
        ('KARAIKAL REGION', ('637', [], '')),
        ('MAHE REGION', ('636', [], '')),
        ('YANAM REGION', ('634', [], '')),
    ]),
    # J&K: annexure districts are the 14 districts of the 1995 order; 8 new districts were created 2006-08,
    # all before Census 2011 (22 districts).
    'Jammu & Kashmir': OrderedDict([
        ('KUPWARA', ('001', [], '')),
        ('BARAMULLA', ('008', ['009'], 'Census 2011 spelling Baramula; Bandipore (009: Gurez, Bandipora, Sonawari '
                                        'tehsils) carved from Baramulla 2007 (Wikipedia: Bandipora district)')),
        ('SRINAGAR', ('010', ['011'], 'Ganderbal (011: Lar, Kangan, Ganderbal tehsils) carved from Srinagar 2007 '
                                      '(Wikipedia: Ganderbal district)')),
        ('BUDGAM', ('002', [], 'Census 2011 spelling Badgam')),
        ('PULWAMA', ('012', ['013'], 'Shupiyan (013) carved from Pulwama Mar 2007 (Wikipedia: Shopian district)')),
        ('ANANTNAG', ('014', ['015'], 'Kulgam (015) separated from Anantnag 2 Apr 2007 (Wikipedia: Kulgam district)')),
        ('LEH', ('003', [], 'Census 2011: Leh(Ladakh); UT of Ladakh since 2019')),
        ('KARGIL', ('004', [], 'UT of Ladakh since 2019')),
        ('DODA', ('016', ['018', '017'], 'Kishtwar (018) and Ramban (017: Ramban, Banihal tehsils) carved from Doda '
                                         '2006-07 (Wikipedia: Kishtwar district, Ramban district)')),
        ('UDHAMPUR', ('019', ['020'], 'Reasi (020) separated from Udhampur 2006 (Wikipedia: Reasi district); Census '
                                      '2011 lists Gool-Gulabgarh sub-district (the Gool part of AC 59 Gool Arnas) under Reasi '
                                      '(020); Ramban (017) holds only Ramban + Banihal tehsils (ex-Doda), so no Udhampur '
                                      'territory is expected in 017')),
        ('KATHUA', ('007', ['022'], 'Samba (022) formed 2006; Wikipedia: "this area was part of Jammu district and '
                                    'Kathua district" - listed under both parents (Kathua share uncertain/small)')),
        ('JAMMU', ('021', ['022'], 'Samba (022) formed 2006 mainly from Jammu district (see Kathua note)')),
        ('RAJOURI', ('006', [], '')),
        ('POONCH', ('005', [], 'Census 2011 spelling Punch')),
    ]),
}
DIST_SRC = {
    'Delhi': 'district list: CEO Delhi "District Election Officers in NCT of Delhi" (2011; raw_g5/ceodelhi_DEOs_2011.pdf) + Census 2011',
}


def census_districts(c11_state):
    d = pd.read_csv(PCA, dtype=str)
    d = d[(d.tru == 'Total') & (d.state_name == c11_state)]
    return OrderedDict((r.district_code, r.district_name) for r in d.itertuples())


def write_csv(path, cols, rows):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, '') for k in cols})


def judge(order_name, app_name, app_prev, app_next):
    """'spelling' when the two names are recognisably the same seat, 'SHIFT?' when it matches a neighbour instead."""
    a, b = norm(order_name), norm(app_name)
    r = difflib.SequenceMatcher(None, a, b).ratio()
    rp = difflib.SequenceMatcher(None, a, norm(app_prev or '')).ratio()
    rn = difflib.SequenceMatcher(None, a, norm(app_next or '')).ratio()
    if max(rp, rn) > max(r, 0.75):
        return 'SHIFT?', r
    return ('spelling' if r >= 0.6 or a in b or b in a else 'CHECK'), r


OVERLAY = os.path.normpath(os.path.join(HERE, '..', 'seat_district_overlay.csv'))
OVERLAY_STATE = {'Uttar Pradesh': ['UTTAR PRADESH'], 'Uttarakhand': ['UTTARAKHAND', 'UTTARKHAND'],
                 'West Bengal': ['WEST BENGAL'], 'Delhi': ['DELHI'], 'Puducherry': ['PUDUCHERRY'],
                 'Jammu & Kashmir': ['JAMMU & KASHMIR']}
# district-name aliases between the order's headings and the AC-polygon attribute 'dist_2008' (spelling only)
ALIAS = {'BULANDSHAHAR': 'BULANDSHAHR', 'MAHAMAYANAGAR': 'HATHRAS', 'RUDRYAPRAYAG': 'RUDRAPRAYAG',
         'BARAMULLA': 'BARAMULA', 'BUDGAM': 'BADGAM', 'LEH': 'LEHLADAKH', 'RAJOURI': 'RAJAURI', 'POONCH': 'PUNCH',
         'PUDUCHERRYREGION': 'PONDICHERRY', 'KARAIKALREGION': 'KARAIKAL', 'MAHEREGION': 'MAHE',
         'YANAMREGION': 'YANAM'}


def overlay_check(st, acs, lin, headings, c11):
    """INFO only: (a) does the AC polygons' own district attribute agree with the order's heading;
    (b) which polygon placements (largest-share 2011 district) fall outside continuing+carved codes (= vetoes)."""
    if not os.path.exists(OVERLAY) or not headings:
        info('%s: overlay cross-check skipped' % st, 'no headings in order' if not headings else 'no overlay file')
        return
    o = pd.read_csv(OVERLAY, dtype=str)
    o = o[(o.layer == 'AC') & (o.geo_state.isin(OVERLAY_STATE[st]))].copy()
    o['n'] = o.seat_no.astype(int)
    o['code'] = o.district_code.astype(int).map(lambda v: '%03d' % v)
    o['share'] = o.share.astype(float)
    by = {a['ac_no']: a for a in acs}
    attr_bad, veto, spill = [], [], []
    for n_, g in o.groupby('n'):
        a = by.get(n_)
        if a is None:
            continue
        cont, carved, _ = lin[a['district_2008']]
        ok = {cont, *carved}
        attr = g.dist_2008.dropna()
        if len(attr):
            nn = lambda v: re.sub(r'[^A-Z]', '', str(v).upper())
            x = nn(attr.iloc[0])
            y = nn(a['district_2008'])
            okn = {y, ALIAS.get(y, y)} | {nn(c11.get(c, '')) for c in ok}
            if not any(x == z or (z and (x.startswith(z) or z.startswith(x))) or
                       difflib.SequenceMatcher(None, x, z).ratio() >= 0.8 for z in okn):
                attr_bad.append((n_, a['district_2008'], attr.iloc[0]))
        top = g.sort_values('share', ascending=False).iloc[0]
        if top.code not in ok:
            veto.append((n_, a['ac_name'], a['district_2008'], 'overlay top %s (%.2f)' % (top.code, top.share)))
        out = g[~g.code.isin(ok)]
        if len(out) and out.share.sum() >= 0.05:
            spill.append((n_, round(out.share.sum(), 2)))
    info('%s: AC-polygon dist_2008 attribute vs order heading (spelling-insensitive) disagreements' % st,
         attr_bad if attr_bad else 'none')
    info('%s: overlay largest-share district outside continuing+carved codes (would be vetoed): %d' % (st, len(veto)),
         veto if veto else '')
    info('%s: ACs with >=5%% overlay share outside continuing+carved codes: %d' % (st, len(spill)), spill)


# hand-reviewed verdicts where the similarity heuristic is not enough, and source misprints worth a note
MANUAL_VERDICT = {
    ('Jammu & Kashmir', 75): 'spelling (R. S. Pura is the abbreviation of Ranbir Singh Pura)',
    ('Jammu & Kashmir', 30): 'spelling (Chrar-i-Sharief, short form Chrar)',
    ('Uttar Pradesh', 34): 'spelling (order prints Suar; ECI results name Suar Tanda - extent is Suar tehsil incl. Tanda KC)',
    ('Uttar Pradesh', 28): 'spelling (Moradabad Nagar vs Moradabad)',
    ('Uttar Pradesh', 124): 'spelling (Bareilly vs Bareilly City)',
}
MISPRINT = {
    ('West Bengal', 19): 'order misprints the name as "ABGRAM-FULBARI" - the seat is Dabgram-Fulbari (extent: '
                         'Siliguri M Corp wards 31-44, Dabgram-I, ...)',
    ('West Bengal', 136): "app 2011 spelling 'JAQYNAGAR' is an app-side typo for Jaynagar",
    ('Jammu & Kashmir', 76): 'order misprints the name as "Suehetgarh" - the seat is Suchetgarh',
    ('Uttar Pradesh', 271): 'listed under BARABANKI (extent: 1-Rudauli Tehsil + PCs 1-5 of Banikodar KC, Ram Sanehi '
                            'Ghat tehsil) but Rudauli tehsil is in Census-2011 Faizabad (177) - in 2011 terms this '
                            'AC lies mostly in 177, a small part in 176 Bara Banki',
}


SUBDIST = os.path.normpath(os.path.join(HERE, '..', 'boundaries', 'subdistricts', '2011-IndiaStateDistSbDist-0000.xlsx'))
SUBDIST_STATE = {'Uttar Pradesh': '09', 'Uttarakhand': '05', 'West Bengal': '19', 'Jammu & Kashmir': '01'}
_SUB = {}


def transfer_scan(st, acs, lin):
    """INFO: tehsils (UP/UK/J&K) or CD blocks (WB) named in a district's Table-A extents that Census 2011 places in a
    district outside that heading's continuing+carved codes - i.e. territory moved between districts. Name hits that
    also match a sub-district inside the allowed districts are homonyms and are skipped."""
    if st not in SUBDIST_STATE or not os.path.exists(SUBDIST):
        return
    if not _SUB:
        x = pd.read_excel(SUBDIST, dtype=str, usecols=['State', 'District', 'Level', 'Name', 'TRU'])
        _SUB['x'] = x[(x.TRU == 'Total') & (x.Level == 'SUB-DISTRICT')]
    x = _SUB['x']
    nn = lambda v: re.sub(r'[^A-Z]', '', str(v).upper())
    subs = [(nn(r.Name), r.District, r.Name.strip()) for r in x[x.State == SUBDIST_STATE[st]].itertuples()]
    ext = {}
    for a in acs:
        ext.setdefault(a['district_2008'], []).append(a.get('extent', ''))
    hits = []
    for d, exts in ext.items():
        cont, carved, _ = lin[d]
        ok = {cont, *carved}
        t = ' '.join(exts)
        if st == 'West Bengal':
            names = re.findall(r'CDB\s+([A-Z][A-Za-z.]*(?:\s*-\s*I{1,3}V?)?)', t)
        else:
            names = re.findall(r'(?:\d+\s*-\s*|Tehsil\s+|Tehsils?\s+of\s+)([A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,2})'
                               r'\s*(?:\([^)]*\))?\s*-?\s*Tehsil', t)
            names += re.findall(r'(?:in|of)\s+Tehsil\s+([A-Z][A-Za-z.]*(?:\s+[A-Z][a-z][A-Za-z.]*){0,2})', t)
        for k in sorted({nn(v) for v in names if nn(v)}):
            best = max(subs, key=lambda sb: difflib.SequenceMatcher(None, k, sb[0]).ratio())
            r = difflib.SequenceMatcher(None, k, best[0]).ratio()
            if r < 0.8 or best[1] in ok:
                continue
            if any(sb[1] in ok and difflib.SequenceMatcher(None, k, sb[0]).ratio() >= 0.75 for sb in subs):
                continue  # homonym: the same name also exists inside the allowed districts
            hits.append((d, k, best[2], best[1], round(r, 2)))
    fp = [h for h in hits if (st, h[0], h[1]) in TRANSFER_FALSE_POS]
    hits = [h for h in hits if (st, h[0], h[1]) not in TRANSFER_FALSE_POS]
    check('%s: no unexplained tehsil/CD-block transfer out of a heading continuing+carved districts' % st,
          not hits, hits if hits else 'none')
    if fp:
        info('%s: transfer-scan hits reviewed by hand as false positives' % st,
             ['%s %s: %s' % (h[0], h[1], TRANSFER_FALSE_POS[(st, h[0], h[1])]) for h in fp])


TRANSFER_FALSE_POS = {
    ('West Bengal', 'PURBO MEDINIPUR', 'NANDA'): 'fragment of "CDB Nanda Kumar" (Purba Medinipur), fuzzy-matched '
                                                 'to Nawda (Murshidabad)',
    ('Jammu & Kashmir', 'SRINAGAR', 'BADGAM'): 'AC 23 Amirakadal extent EXCLUDES patches in Tehsil Badgam',
    ('Jammu & Kashmir', 'SRINAGAR', 'CHADOORA'): 'AC 23 Amirakadal extent EXCLUDES patches in Tehsil Chadoora',
}


def main():
    doc = fitz.open(PDF)
    seats = json.load(open(APP_SEATS, encoding='utf-8'))
    summary = []
    for slug, st, lab, p0, p1, split, ext_gap, n, yr, c11s, headings in STATES:
        acs, conts = parse_state(doc, p0, p1, split, ext_gap, headings)
        if st == 'Jammu & Kashmir':
            app = {r['n']: r['c'] for r in seats if r['s'] in ('Jammu & Kashmir', 'Ladakh') and r['y'] == yr}
            app_res = {r['n']: r.get('r', '') for r in seats if r['s'] in ('Jammu & Kashmir', 'Ladakh') and r['y'] == yr}
        else:
            app = {r['n']: r['c'] for r in seats if r['s'] == st and r['y'] == yr}
            app_res = {r['n']: r.get('r', '') for r in seats if r['s'] == st and r['y'] == yr}
        print('\n=====', st, len(acs))
        for k, pn, txt in conts:
            info('%s: name continuation line attached to AC %d (p%d)' % (st, k, pn), txt)

        # ---------------- counts / contiguity
        nums = [a['ac_no'] for a in acs]
        check('%s: AC count = %d' % (st, n), len(acs) == n, 'got %d' % len(acs))
        check('%s: AC numbers contiguous 1..%d' % (st, n), nums == list(range(1, n + 1)),
              'first=%s last=%s' % (nums[:1], nums[-1:]))

        # ---------------- district blocks
        dists = list(OrderedDict.fromkeys(a['district_2008'] for a in acs))
        blocks = [k for k, _ in __import__('itertools').groupby(a['district_2008'] for a in acs)]
        if headings:
            check('%s: each district heading is one contiguous block' % st, len(blocks) == len(dists),
                  '%d headings' % len(dists))
        else:
            info('%s: Table A has no district headings' % st, 'district_2008 left blank for all %d ACs' % len(acs))
        cnt = Counter(a['district_2008'] for a in acs)
        info('%s: ACs per district_2008' % st, '; '.join('%s=%d' % (d or '(none)', cnt[d]) for d in dists))

        # ---------------- name agreement with the app
        mism = []
        for a in acs:
            k = a['ac_no']
            ap = app.get(k)
            if ap is None:
                mism.append((k, a['ac_name'], '(missing in app)', 'CHECK', 0))
                continue
            if norm(ap) != norm(a['ac_name']):
                v, r = judge(a['ac_name'], ap, app.get(k - 1), app.get(k + 1))
                v = MANUAL_VERDICT.get((st, k), v)
                mism.append((k, a['ac_name'], ap, v, r))
        agree = len(acs) - len(mism)
        pct = round(100.0 * agree / max(len(acs), 1), 1)
        info('%s: name agreement vs app %s %d (normalised)' % (st, st if st != 'Jammu & Kashmir' else 'J&K+Ladakh', yr),
             '%d/%d = %.1f%%' % (agree, len(acs), pct))
        for k, o, ap, v, r in mism:
            info('%s: name mismatch AC %d' % (st, k), 'order=%r app=%r ratio=%.2f -> %s' % (o, ap, r, v))
        extra = sorted(set(app) - set(nums))
        check('%s: every app seat number exists in the order' % st, not extra, extra)
        shifts = [m for m in mism if not m[3].startswith('spelling')]
        check('%s: no suspected row shift among name mismatches' % st, not shifts, shifts)

        # ---------------- reservation flags (info)
        rdiff = [(a['ac_no'], app_res.get(a['ac_no']), a['res'] or 'GEN') for a in acs
                 if (app_res.get(a['ac_no']) or 'GEN') != (a['res'] or 'GEN')]
        info('%s: reservation (SC/ST) order vs app differences' % st, rdiff if rdiff else 'none')

        # ---------------- district lineage
        c11 = census_districts(c11s)
        lin = LINEAGE[st]
        if headings:
            check('%s: every district heading has a lineage row' % st, set(dists) == set(lin),
                  'missing=%s extra=%s' % (sorted(set(dists) - set(lin)), sorted(set(lin) - set(dists))))
        used = []
        bad = []
        for d, (cont, carved, note) in lin.items():
            for c in [cont] + carved:
                used.append(c)
                if c not in c11:
                    bad.append((d, c))
        check('%s: every lineage code is a real Census-2011 district of %s' % (st, c11s), not bad, bad)
        unmapped = [(c, nm) for c, nm in c11.items() if c not in used]
        check('%s: every Census-2011 district (%d) appears as continuing or carved' % (st, len(c11)), not unmapped,
              unmapped)
        conts_ = [v[0] for v in lin.values()]
        check('%s: continuing codes unique' % st, len(conts_) == len(set(conts_)))

        # ---------------- read-only cross-check vs the polygon overlay (../seat_district_overlay.csv)
        overlay_check(st, acs, lin, headings, c11)
        transfer_scan(st, acs, lin)

        # ---------------- write
        rows = []
        for a in acs:
            notes = []
            if a['res']:
                notes.append('reserved=' + a['res'])
            ap = app.get(a['ac_no'])
            if ap and norm(ap) != norm(a['ac_name']):
                notes.append("app %d spelling '%s'" % (yr, ap))
            if (st, a['ac_no']) in MISPRINT:
                notes.append(MISPRINT[(st, a['ac_no'])])
            if not headings:
                notes.append('order Table A has no district headings (ACs described by 2001 MCD wards/EBs/villages); '
                              'no official AC->district assignment')
            state_out = 'Ladakh' if (st == 'Jammu & Kashmir' and a['ac_no'] in LADAKH_ACS) else st
            if st == 'Jammu & Kashmir':
                notes.append('J&K Delimitation Commission Order No.1 (1995) as reproduced in the annexure; '
                             'map in force for AE 2008 and 2014')
            rows.append(OrderedDict(state=state_out, ac_no=a['ac_no'], ac_name=a['ac_name'],
                                    district_2008=a['district_2008'], source=SRC % lab, page=a['page'],
                                    note='; '.join(notes)))
        write_csv(os.path.join(HERE, slug + '_acs.csv'),
                  ['state', 'ac_no', 'ac_name', 'district_2008', 'source', 'page', 'note'], rows)
        drows = []
        for d, (cont, carved, note) in lin.items():
            nm = '2011: %s %s' % (cont, c11.get(cont, '?'))
            if carved:
                nm += '; carved: ' + ', '.join('%s %s' % (c, c11.get(c, '?')) for c in carved)
            if not headings:
                nm += '; ' + DIST_SRC.get(st, '') + '; NOT a heading in the order (no AC is assigned to it)'
            else:
                nm += '; ACs in order: %d' % cnt.get(d, 0)
            if note:
                nm += '; ' + note
            sts = st
            if st == 'Jammu & Kashmir' and d in ('LEH', 'KARGIL'):
                sts = 'Ladakh'
            drows.append(OrderedDict(state=sts, district_2008=d, continuing_2011_code=cont,
                                     carved_2011_codes=';'.join(carved), note=nm))
        write_csv(os.path.join(HERE, slug + '_districts.csv'),
                  ['state', 'district_2008', 'continuing_2011_code', 'carved_2011_codes', 'note'], drows)
        summary.append((st, len(acs), n, pct, len(dists), [m for m in mism], unmapped))

    with open(os.path.join(HERE, 'g5_validation.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(CHECKS) + '\n')
    print('\nFAIL count:', sum(1 for c in CHECKS if c.startswith('FAIL')))
    return summary


if __name__ == '__main__':
    main()
