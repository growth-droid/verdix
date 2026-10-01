#!/usr/bin/env python3
"""
Build AC -> district (current + Census-2011 parent) -> PC lists for assembly constituencies that have
no usable polygon in the app, from OFFICIAL constituency lists (delimitation orders / CEO lists).

Outputs (written next to this script):
  jk_2022_ac_district.csv        J&K, 90 ACs, Delimitation Commission final order 05-05-2022 (AE 2024)
  assam_2023_ac_district.csv     Assam, 126 ACs, ECI final delimitation order 11-08-2023 (AE 2026)
  gj_mp_noshape_ac_district.csv  Gujarat ACs 45-56 + 160-167, Madhya Pradesh ACs 205-208 (ECI DPACO 2008)
  census2011_district_codes.csv  every district_2011 value used above -> Census 2011 state/district code
  validation.csv                 every check run by this script (count, uniqueness, cross-source agreement)

Inputs: raw/ (see SOURCES.json for URL + sha256 of every file). Read-only cross-checks, used if present:
  ../hlo/hlo_district_2011.csv            Census 2011 district names/codes (ORGI HLO tables)
  ../../../../public/data/seats_ae.json   the app's own ECI-results AC names (read only, never written)
  raw/wikipedia_crosscheck_*.csv          facts-only extracts of Wikipedia lists (fetch_wikipedia_crosscheck.py)

Run:  python build_ac_district_lists.py          (uses raw/assam_final_order_ocr_p51-82.json)
      python build_ac_district_lists.py --ocr    (re-OCRs the scanned Assam order; needs rapidocr-onnxruntime)
Requires: PyMuPDF (fitz), pandas.
"""
import csv, json, os, re, sys
from collections import Counter, OrderedDict

import fitz  # PyMuPDF

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
HLO = os.path.normpath(os.path.join(HERE, '..', 'hlo', 'hlo_district_2011.csv'))
APP_SEATS = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', 'public', 'data', 'seats_ae.json'))

# ---- official source URLs (exact URLs fetched; see SOURCES.json for sha256/bytes/date) ----
JK_ORDER_URL = 'https://ceojk.nic.in/pdf/Delimitation/English%20Final%20JK.pdf'
JK_GOI_URL = 'https://ceojk.nic.in/pdf/Delimitation/GoI%20gazette%20notification%20delimitation.pdf'
JK_CEO24_URL = 'https://ceojk.nic.in/pdf/Assembly_Elections_2024/Final_Publication_Data_2024.pdf'
AS_ORDER_URL = 'https://ceoassam.nic.in/Final_Order_and_Notification.pdf'
AS_CEO26_URL = 'https://ceoassam.nic.in/assembly/2026/pdf/AC_wise_PS_&_Electors_Details_2026.pdf'
DPACO_URL = ('https://www.eci.gov.in/Documents/Delimitation/'
             'DelimitationofParliamentaryAssemblyConstituenciesOrder-2008(English).pdf')

F_JK_ORDER = os.path.join(RAW, 'jk_delimitation_final_order_2022_JK_gazette_english.pdf')
F_JK_CEO24 = os.path.join(RAW, 'jk_ceo_final_publication_data_2024.pdf')
F_AS_ORDER = os.path.join(RAW, 'assam_eci_final_order_and_notification_2023.pdf')
F_AS_OCR = os.path.join(RAW, 'assam_final_order_ocr_p51-82.json')
F_AS_CEO26 = os.path.join(RAW, 'assam_ceo_ac_wise_ps_electors_2026.pdf')
F_DPACO = os.path.join(RAW, 'eci_delimitation_order_2008_english.pdf')

COLS = ['state', 'ac_no', 'ac_name', 'district_current', 'district_2011', 'pc_no', 'pc_name', 'source_url', 'note']
CHECKS = []


def check(name, ok, expected='', got=''):
    CHECKS.append(OrderedDict(check=name, ok=bool(ok), expected=str(expected), got=str(got)))
    print(('OK  ' if ok else 'FAIL') + ' | ' + name + ' | expected=' + str(expected) + ' | got=' + str(got))


def clean(s):
    s = s.replace('�', '-').replace('–', '-').replace('—', '-').replace('­', '-')
    s = re.sub(r'\s*-\s*', '-', s)
    return re.sub(r'\s+', ' ', s).strip()


def split_res(name):
    m = re.search(r'\s*\((SC|ST)\)\s*$', name)
    return (name[:m.start()].strip(), m.group(1)) if m else (name.strip(), '')


def norm(s):
    s = re.sub(r'\((sc|st)\)', '', s.lower())
    return re.sub(r'[^a-z0-9]', '', s)


def app_names(state, year):
    if not os.path.exists(APP_SEATS):
        return {}
    d = json.load(open(APP_SEATS, encoding='utf-8'))
    return {r['n']: r['c'] for r in d if r['s'] == state and r['y'] == year}


def census2011_districts():
    import pandas as pd
    d = pd.read_csv(HLO, dtype=str)
    d = d[d.tru == 'Total']
    return {(r.state_name, r.district_name): (r.state_code, r.district_code) for r in d.itertuples()}


def app_reservation_diff(state, year, acs):
    """INFO: compare the app's seats_ae 'r' flag with the order's reservation (read-only cross-check)."""
    if not os.path.exists(APP_SEATS):
        return
    d = json.load(open(APP_SEATS, encoding='utf-8'))
    r = {x['n']: x.get('r', '') for x in d if x['s'] == state and x['y'] == year}
    diff = [(a['ac_no'], r.get(a['ac_no']), a['res'] or 'GEN') for a in acs
            if (r.get(a['ac_no']) or 'GEN') != (a['res'] or 'GEN')]
    check('%s: INFO app seats_ae %d reservation flag vs order (app, order) - app-side data issue, not ours'
          % (state, year), True, '0 differences expected', '%d differ: %s' % (len(diff), diff))


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


# ================================================================== (a) JAMMU & KASHMIR
JK_2011 = {'Kupwara': 'Kupwara', 'Baramulla': 'Baramula', 'Bandipora': 'Bandipore', 'Ganderbal': 'Ganderbal',
           'Srinagar': 'Srinagar', 'Budgam': 'Badgam', 'Pulwama': 'Pulwama', 'Shopian': 'Shupiyan',
           'Kulgam': 'Kulgam', 'Anantnag': 'Anantnag', 'Kishtwar': 'Kishtwar', 'Doda': 'Doda', 'Ramban': 'Ramban',
           'Reasi': 'Reasi', 'Udhampur': 'Udhampur', 'Kathua': 'Kathua', 'Samba': 'Samba', 'Jammu': 'Jammu',
           'Rajouri': 'Rajouri', 'Poonch': 'Punch'}
JK_KERNING_FIX = {'U ri': 'Uri', 'Billawa r': 'Billawar'}  # PDF glyph-spacing artefacts, checked vs Table B
JK_PCS = [(1, 'Baramulla'), (2, 'Srinagar'), (3, 'Anantnag-Rajouri'), (4, 'Udhampur'), (5, 'Jammu')]


def parse_jk():
    doc = fitz.open(F_JK_ORDER)
    acs, district, started, tb_rows = [], None, False, []
    in_b = False
    for pi in range(doc.page_count):
        for y, cs in char_rows(doc[pi]):
            txt = join_chars(cs)
            if y < 90:  # running header
                continue
            if re.match(r'^TABLE\W*A$', txt):
                started = True
                continue
            if re.match(r'^TABLE\W*B$', txt):
                started, in_b = False, True
                continue
            if in_b:
                tb_rows.append(txt)
                continue
            if not started:
                continue
            m = re.match(r'^[\d ]+\W*DISTRICT\s*:\s*(.+)$', txt)
            if m:
                district = m.group(1).strip().title()
                continue
            if cs[0][3].isdigit() and cs[0][1] < 90:
                num = ''.join(c[3] for c in cs if c[1] < 95 and c[3].isdigit())
                name = join_chars([c for c in cs if 95 <= c[1] < 187])
                acs.append(dict(ac_no=int(num), raw=name, district=district, page=pi + 1, y=y))
            elif acs and acs[-1]['page'] == pi + 1 and y - acs[-1]['y'] < 20:
                part = join_chars([c for c in cs if 95 <= c[1] < 187])
                if part:  # wrapped AC name (e.g. "Srigufwara-" / "Bijbehara")
                    acs[-1]['raw'] += ' ' + part
    for a in acs:
        n = a['raw']
        for k, v in JK_KERNING_FIX.items():
            n = n.replace(k, v)
        a['name_full'] = clean(n)
        a['name'], a['res'] = split_res(a['name_full'])
    # ---- Table B (PC extents in terms of AC numbers)
    tb = ' '.join(tb_rows)
    tb = tb.split('NOTE')[0].replace('�', '-').replace('–', '-')
    for _ in range(3):
        tb = re.sub(r'(?<!\d)(\d) (\d)(?=\s*-)', r'\1\2', tb)
    hdr = [(m.start(), int(m.group(1))) for m in
           re.finditer(r'(?<!\d)([1-5])-(Baramulla|Srinagar|Anantnag-|Udhampur|Jammu)(?![\w-]*\s*(West|East|North|South))', tb)]
    # keep the first occurrence of each PC header, in order
    seen, heads = set(), []
    for pos, n in hdr:
        if n not in seen:
            seen.add(n)
            heads.append((pos, n))
    pc_of, b_names = {}, {}
    for m in re.finditer(r'(?<!\d)(\d{1,2})\s*-\s*([A-Z][A-Za-z.\- ]*?(?:\s*\((?:SC|ST)\))?)(?=,|\s*&|\.\s+\d|\.\s*$|\s+\d|$)', tb):
        n = int(m.group(1))
        pos = m.start()
        if any(pos == hp for hp, _ in heads):
            continue
        prev = [pn for hp, pn in heads if hp < pos]
        if prev:
            pc_of.setdefault(n, []).append(prev[-1])
            b_names[n] = clean(m.group(2))
    return acs, pc_of, b_names


def parse_jk_ceo24():
    doc = fitz.open(F_JK_CEO24)
    lines = []
    for p in doc:
        lines += [l.strip() for l in p.get_text().splitlines()]
    out, want = {}, 1
    for i in range(len(lines) - 1):
        if lines[i] == str(want) and re.match(r'^[A-Z][A-Z .()\-]+$', lines[i + 1]):
            out[want] = lines[i + 1]
            want += 1
    return out


def build_jk(c11):
    acs, pc_of, b_names = parse_jk()
    ceo = parse_jk_ceo24()
    app = app_names('Jammu & Kashmir', 2024)
    nums = [a['ac_no'] for a in acs]
    check('J&K: Table-A AC count', len(acs) == 90, 90, len(acs))
    check('J&K: AC numbers are exactly 1..90', nums == list(range(1, 91)), '1..90', 'ok' if nums == list(range(1, 91)) else nums)
    dists = list(OrderedDict.fromkeys(a['district'] for a in acs))
    check('J&K: districts in Table-A', len(dists) == 20, 20, len(dists))
    goi = os.path.join(RAW, 'jk_delimitation_final_order_2022_GoI_gazette.pdf')
    if os.path.exists(goi):
        t = ''.join(p.get_text() for p in fitz.open(goi))
        gh = [d.title() for _, d in re.findall(r'(\d+)\s*[-–�]\s*DISTRICT\s*:\s*([A-Z]+)', t)]
        check('J&K: district headings identical in the Gazette of India copy', gh == dists, dists, gh)
    res = Counter(a['res'] for a in acs)
    check('J&K: reserved seats SC/ST (Order No.1: 7 SC, 9 ST)', res['SC'] == 7 and res['ST'] == 9, 'SC=7 ST=9',
          'SC=%d ST=%d' % (res['SC'], res['ST']))
    once = all(len(pc_of.get(n, [])) == 1 for n in range(1, 91))
    check('J&K: every AC in exactly one PC in Table-B', once, 'all 90 once',
          [n for n in range(1, 91) if len(pc_of.get(n, [])) != 1] or 'all 90 once')
    pcc = Counter(pc_of[n][0] for n in range(1, 91) if n in pc_of)
    check('J&K: ACs per PC (Table-B)', all(v == 18 for v in pcc.values()) and len(pcc) == 5, '5 PCs x 18', dict(sorted(pcc.items())))
    single_letter = [a['name'] for a in acs if re.search(r'(^| )[a-z]( |$)', a['name'])]
    check('J&K: no glyph-spacing artefacts left in names', not single_letter, 'none', single_letter or 'none')
    rows, mism_b, mism_ceo, mism_app = [], [], [], []
    pcname = dict(JK_PCS)
    for a in acs:
        n = a['ac_no']
        notes = []
        if a['res']:
            notes.append('reserved=' + a['res'])
        bn = b_names.get(n, '')
        if bn and norm(bn) != norm(a['name_full']):
            mism_b.append((n, a['name_full'], bn))
            notes.append("Table-B spelling '%s'" % split_res(bn)[0])
        cn = ceo.get(n, '')
        if cn and norm(cn) != norm(a['name_full']):
            mism_ceo.append((n, cn))
            notes.append("CEO J&K 2024 roll spelling '%s'" % cn)
        ap = app.get(n, '')
        if ap and norm(ap) != norm(a['name_full']):
            mism_app.append((n, ap))
            notes.append("ECI-results/app spelling '%s'" % ap)
        d11 = JK_2011[a['district']]
        if d11 != a['district']:
            notes.append("Census-2011 spelling of same district '%s'" % d11)
        notes.append('district 1:1 with Census 2011 (no J&K district created since 2007)')
        pc = pc_of[n][0]
        rows.append(OrderedDict(state='Jammu & Kashmir', ac_no=n, ac_name=a['name'], district_current=a['district'],
                                district_2011=d11, pc_no=pc, pc_name=pcname[pc],
                                source_url=JK_ORDER_URL, note='; '.join(notes + ['src: order Table-A (name, district) + Table-B (PC)'])))
        c11.add(('JAMMU & KASHMIR', d11))
    check('J&K: Table-A vs Table-B name agreement', len(mism_b) <= 1, '<=1 known (87 Thannamandi/Thanamandi)', mism_b or 'all agree')
    app_reservation_diff('Jammu & Kashmir', 2024, acs)
    check('J&K: CEO J&K 2024 roll parsed', len(ceo) == 90, 90, len(ceo))
    check('J&K: Table-A vs CEO J&K 2024 roll names (info)', True, 'listed in note', mism_ceo or 'all agree')
    check('J&K: Table-A vs app ECI-results names (info)', True, 'listed in note', mism_app or 'all agree')
    wiki = os.path.join(RAW, 'wikipedia_crosscheck_jk.csv')
    if os.path.exists(wiki):
        w = {int(r['ac_no']): r for r in csv.DictReader(l for l in open(wiki, encoding='utf-8') if not l.startswith('#'))}
        dd = [(r['ac_no'], r['district_current'], w[r['ac_no']]['district']) for r in rows
              if norm(w[r['ac_no']]['district'])[:5] != norm(r['district_current'])[:5]]
        pp = [(r['ac_no'], r['pc_name'], w[r['ac_no']]['pc']) for r in rows
              if norm(w[r['ac_no']]['pc'])[:6] != norm(r['pc_name'])[:6]]
        check('J&K: district agrees with Wikipedia cross-check', not dd, '90/90', dd or '90/90')
        check('J&K: PC agrees with Wikipedia cross-check', not pp, '90/90', pp or '90/90')
    return rows


# ================================================================== (b) ASSAM
# CEO-2026 district label -> (official current name, Census-2011 parent, lineage note)
AS_DIST = {
    'Kokrajhar': ('Kokrajhar', 'Kokrajhar', ''), 'Dhubri': ('Dhubri', 'Dhubri', ''),
    'South Salmara': ('South Salmara-Mankachar', 'Dhubri', 'district carved from Dhubri in 2016'),
    'Goalpara': ('Goalpara', 'Goalpara', ''), 'Bongaigaon': ('Bongaigaon', 'Bongaigaon', ''),
    'Chirang': ('Chirang', 'Chirang', ''),
    'Bajali': ('Bajali', 'Barpeta', 'district carved from Barpeta (2021); merged back into Barpeta 31-12-2022, '
               'so the 2023 order lists this AC under BARPETA; re-created by Assam cabinet 25-08-2023 as ACs 21+26'),
    'Barpeta': ('Barpeta', 'Barpeta', ''), 'Kamrup': ('Kamrup', 'Kamrup', ''),
    'Kamrup Metro': ('Kamrup Metropolitan', 'Kamrup Metropolitan', ''),
    'Nalbari': ('Nalbari', 'Nalbari', ''), 'Baksa': ('Baksa', 'Baksa', ''),
    'Tamulpur': ('Tamulpur', 'Baksa', 'district carved from Baksa (2022); merged back into Baksa 31-12-2022, '
                 'so the 2023 order lists this AC under BAKSA; re-created 25-08-2023 as ACs 43+44'),
    'Udalguri': ('Udalguri', 'Udalguri', ''), 'Darrang': ('Darrang', 'Darrang', ''),
    'Morigaon': ('Morigaon', 'Morigaon', ''), 'Nagaon': ('Nagaon', 'Nagaon', ''),
    'Hojai': ('Hojai', 'Nagaon', 'district carved from Nagaon (Hojai/Doboka/Lanka) in 2015; merged back into Nagaon '
              '31-12-2022, so the 2023 order lists this AC under NAGAON; re-created 25-08-2023 as ACs 62-64'),
    'Sonitpur': ('Sonitpur', 'Sonitpur', ''),
    'Biswanath': ('Biswanath', 'Sonitpur', 'district carved from Sonitpur in 2015; merged back into Sonitpur '
                  '31-12-2022, so the 2023 order lists this AC under SONITPUR; re-created 25-08-2023 as ACs 70-72'),
    'Lakhimpur': ('Lakhimpur', 'Lakhimpur', ''), 'Dhemaji': ('Dhemaji', 'Dhemaji', ''),
    'Tinsukia': ('Tinsukia', 'Tinsukia', ''), 'Dibrugarh': ('Dibrugarh', 'Dibrugarh', ''),
    'Charaideo': ('Charaideo', 'Sivasagar', 'district carved from Sivasagar in 2015'),
    'Sibsagar': ('Sivasagar', 'Sivasagar', ''),
    'Majuli': ('Majuli', 'Jorhat', 'district carved from Jorhat in 2016'),
    'Jorhat': ('Jorhat', 'Jorhat', ''), 'Golaghat': ('Golaghat', 'Golaghat', ''),
    'Karbi Anglong': ('Karbi Anglong', 'Karbi Anglong', ''),
    'West Karbi Anglong': ('West Karbi Anglong', 'Karbi Anglong', 'district carved from Karbi Anglong in 2016'),
    'Dima Hasao': ('Dima Hasao', 'Dima Hasao', ''), 'Cachar': ('Cachar', 'Cachar', ''),
    'Hailakandi': ('Hailakandi', 'Hailakandi', ''),
    'Sribhumi': ('Sribhumi', 'Karimganj', 'Karimganj district renamed Sribhumi (Nov-2024), same area; '
                 'the 2023 order lists it as KARIMGANJ'),
}
# 2026 district -> district heading used in the 2023 order (for the consistency check)
AS_2026_TO_2023 = {'Bajali': 'Barpeta', 'Tamulpur': 'Baksa', 'Hojai': 'Nagaon', 'Biswanath': 'Sonitpur',
                   'Sribhumi': 'Karimganj', 'Kamrup Metro': 'Kamrup (Metropolitan)', 'Sibsagar': 'Sibsagar'}


def ocr_assam():
    from rapidocr_onnxruntime import RapidOCR
    import tempfile
    eng = RapidOCR()
    doc = fitz.open(F_AS_ORDER)
    pages = {}
    for i in range(50, 82):
        fn = os.path.join(tempfile.gettempdir(), 'as_order_p%d.png' % (i + 1))
        doc[i].get_pixmap(dpi=200).save(fn)
        res, _ = eng(fn)
        pages[str(i + 1)] = [[b, t, float(s)] for b, t, s in (res or [])]
    json.dump({'_about': 'RapidOCR output, pages 51-82, 200 dpi', 'pages': pages}, open(F_AS_OCR, 'w'))


def ocr_lines(boxes, tol=12):
    items = []
    for b, t, s in boxes:
        xs = [p[0] for p in b]
        ys = [p[1] for p in b]
        items.append((sum(ys) / 4, min(xs), t))
    items.sort()
    rows = []
    for it in items:
        if rows and abs(rows[-1][0] - it[0]) <= tol:
            rows[-1][1].append(it)
        else:
            rows.append([it[0], [it]])
    return [(y, sorted(its, key=lambda i: i[1])) for y, its in rows]


def parse_assam_order():
    P = {int(k): v for k, v in json.load(open(F_AS_OCR))['pages'].items()}
    acs, district, stage, pcs = [], None, 0, []
    for pn in sorted(P):
        for y, its in ocr_lines(P[pn]):
            full = ' '.join(i[2] for i in its)
            if stage == 0 and re.fullmatch(r'TABLE\s*-?\s*A', full.strip()):
                stage = 1
                continue
            if stage == 1 and re.fullmatch(r'TABLE\s*-?\s*B', full.strip()):
                stage = 2
                continue
            if stage == 1:
                m = re.search(r'DISTRICT\s*[-:.]?\s*(.+)$', full)
                if m and len(full) < 60:
                    district = m.group(1).strip()
                    continue
                first = its[0]
                mm = re.match(r'^(\d{1,3})\s*[.,]?\s*(.*)$', first[2].strip())
                if first[1] < 260 and mm:
                    name = (mm.group(2) + ' ' + ' '.join(i[2] for i in its[1:] if 260 <= i[1] < 540)).strip()
                    acs.append(dict(ac_no=int(mm.group(1)), raw=name, district=district, page=pn, y=y))
                else:
                    nm = [i[2] for i in its if 260 <= i[1] < 540]
                    if nm and acs and acs[-1]['page'] == pn and y - acs[-1]['y'] < 80:
                        acs[-1]['raw'] += ' ' + ' '.join(nm)  # wrapped name, e.g. "Ram Krishana Nagar" / "(SC)"
            elif stage == 2:
                if full.strip().startswith('NOTE'):
                    stage = 3
                    break
                if any(k in full for k in ('Name of Parliamentary', 'Extent in terms', 'PARLIAMENTARY CONSTITUENCIES')) \
                        or full.strip() == 'Constituency':
                    continue
                sno = [i[2] for i in its if i[1] < 280 and re.fullmatch(r'\d{1,2}\.?', i[2].strip())]
                nm = [i[2] for i in its if 280 <= i[1] < 600]
                ext = ' '.join(i[2] for i in its if i[1] >= 600)
                if nm:
                    pcs.append(dict(name=clean(' '.join(nm)), sno=sno[0] if sno else '', ext=ext))
                elif pcs:
                    pcs[-1]['ext'] += ' ' + ext
        if stage == 3:
            break
    for a in acs:
        a['name_full'] = clean(a['raw'])
        a['name'], a['res'] = split_res(a['name_full'])
    pc_of = {}
    for k, p in enumerate(pcs, start=1):
        p['no'] = k
        for m in re.finditer(r'(?<!\d)(\d{1,3})\s*-\s*[A-Za-z]', p['ext']):
            pc_of.setdefault(int(m.group(1)), []).append(k)
    return acs, pcs, pc_of


def parse_assam_ceo26():
    doc = fitz.open(F_AS_CEO26)
    out = []
    for pi, p in enumerate(doc):
        ws = [w for w in p.get_text('words') if w[1] > 58]
        nums = sorted([w for w in ws if 150 <= w[0] < 175 and re.fullmatch(r'\d+', w[4])], key=lambda w: w[1])
        recs = [dict(ac_no=int(w[4]), y=(w[1] + w[3]) / 2, name=[], dist=[]) for w in nums]
        frags = []
        for w in ws:
            if not (175 <= w[0] < 270 or 85 <= w[0] < 150):
                continue
            if w[4] in ('District', 'Total', 'State', 'Name') or 'Total' in w[4] or w[4].startswith('Dist.'):
                continue
            frags.append(((w[1] + w[3]) / 2, w))
        pending = []
        for yc, w in frags:
            col = 'name' if w[0] >= 175 else 'dist'
            same = [r for r in recs if abs(r['y'] - yc) <= 3]
            if same:
                same[0][col].append((round(yc), w[0], w[4]))
            else:
                pending.append((yc, w, col))
        groups = OrderedDict()
        for yc, w, col in pending:
            groups.setdefault((round(yc / 3), col), []).append((yc, w, col))
        for (_, col), items in groups.items():
            yc = items[0][0]
            cands = [r for r in recs if abs(r['y'] - yc) <= 14]
            if not cands:
                continue
            empty = [r for r in cands if not r[col]]
            r = min(empty or cands, key=lambda r: abs(r['y'] - yc))
            for yc2, w, _ in items:
                r[col].append((round(yc2), w[0], w[4]))
        for r in recs:
            r['name'] = clean(' '.join(t for _, _, t in sorted(r['name'])))
            r['dist'] = ' '.join(t for _, _, t in sorted(r['dist']))
        out += recs
    district = None
    for r in out:  # district cell is printed once per group; forward-fill. "West Karbi" / "Anglong" wraps.
        if r['dist'] == 'Anglong':
            r['dist'] = ''
        if r['dist'] == 'West Karbi':
            r['dist'] = 'West Karbi Anglong'
        if r['dist']:
            district = r['dist']
        r['district'] = district
    return {r['ac_no']: r for r in out}


def build_assam(c11):
    acs, pcs, pc_of = parse_assam_order()
    ceo = parse_assam_ceo26()
    app = app_names('Assam', 2026)
    nums = [a['ac_no'] for a in acs]
    check('Assam: Table-A AC count (2023 order)', len(acs) == 126, 126, len(acs))
    check('Assam: AC numbers are exactly 1..126', nums == list(range(1, 127)), '1..126',
          'ok' if nums == list(range(1, 127)) else nums)
    d23 = list(OrderedDict.fromkeys(a['district'] for a in acs))
    check('Assam: districts in 2023 order (ECI Final Paper-1 says 31)', len(d23) == 31, 31, len(d23))
    res = Counter(a['res'] for a in acs)
    check('Assam: reserved seats (Order: 9 SC, 19 ST)', res['SC'] == 9 and res['ST'] == 19, 'SC=9 ST=19',
          'SC=%d ST=%d' % (res['SC'], res['ST']))
    check('Assam: PCs in Table-B', len(pcs) == 14, 14, len(pcs))
    snos = [(p['no'], p['sno']) for p in pcs if p['sno']]
    check('Assam: Table-B serial numbers OCRed agree with row order', all(str(n) == s.strip('.') for n, s in snos),
          'agree', snos)
    once = all(len(pc_of.get(n, [])) == 1 for n in range(1, 127))
    check('Assam: every AC in exactly one PC in Table-B', once, 'all 126 once',
          [n for n in range(1, 127) if len(pc_of.get(n, [])) != 1] or 'all 126 once')
    ge = os.path.join(os.path.dirname(APP_SEATS), 'seats_ge.json')
    if os.path.exists(ge):
        g = {r['n']: r['c'] for r in json.load(open(ge, encoding='utf-8')) if r['s'] == 'Assam' and r['y'] == 2024}
        bad = [(p['no'], p['name'], g.get(p['no'])) for p in pcs if norm(g.get(p['no'], ''))[:6] != norm(p['name'])[:6]]
        check('Assam: Table-B PC order = app GE-2024 PC numbering', not bad, '14/14', bad or '14/14')
    pres = Counter(split_res(p['name'])[1] for p in pcs)
    check('Assam: PC reservation (Order: 1 SC, 2 ST)', pres['SC'] == 1 and pres['ST'] == 2, 'SC=1 ST=2',
          'SC=%d ST=%d' % (pres['SC'], pres['ST']))
    check('Assam: CEO 2026 list parsed', sorted(ceo) == list(range(1, 127)), '1..126', len(ceo))
    d26 = list(OrderedDict.fromkeys(ceo[n]['district'] for n in range(1, 127)))
    check('Assam: districts in CEO 2026 list (35 after Aug-2023 restorations)', len(d26) == 35, 35, len(d26))
    unknown = [d for d in d26 if d not in AS_DIST]
    check('Assam: every CEO-2026 district has a Census-2011 parent', not unknown, 'none unmapped', unknown or 'none')
    bad23 = []
    for a in acs:
        c = ceo[a['ac_no']]['district']
        exp = AS_2026_TO_2023.get(c, c)
        if norm(exp)[:8] != norm(a['district'])[:8]:
            bad23.append((a['ac_no'], a['district'], c))
    check('Assam: 2026 district consistent with 2023-order district (via lineage)', not bad23, '126/126', bad23 or '126/126')
    rows, mism_ceo, mism_app = [], [], []
    for a in acs:
        n = a['ac_no']
        c = ceo[n]
        cur, d11, lineage = AS_DIST[c['district']]
        notes = []
        if a['res']:
            notes.append('reserved=' + a['res'])
        if norm(c['name']) != norm(a['name_full']):
            mism_ceo.append((n, a['name_full'], c['name']))
            notes.append("ECI/CEO-2026 spelling '%s'" % split_res(c['name'])[0])
        ap = app.get(n, '')
        if ap and norm(ap) != norm(a['name_full']) and norm(ap) != norm(c['name']):
            mism_app.append((n, ap))
            notes.append("app ECI-results spelling '%s'" % ap)
        if norm(a['district'])[:8] != norm(cur)[:8]:
            notes.append('2023-order district: ' + a['district'])
        if lineage:
            notes.append(lineage)
        if c['district'] != cur:
            notes.append("CEO-2026 label '%s'" % c['district'])
        pc = pcs[pc_of[n][0] - 1]
        rows.append(OrderedDict(state='Assam', ac_no=n, ac_name=a['name'], district_current=cur, district_2011=d11,
                                pc_no=pc['no'], pc_name=split_res(pc['name'])[0],
                                source_url=AS_ORDER_URL + ' | ' + AS_CEO26_URL,
                                note='; '.join(notes + ['src: order pp.51-82 Table-A (name) + Table-B (PC); district_current from CEO-2026 roll list'])))
        c11.add(('ASSAM', d11))
    app_reservation_diff('Assam', 2026, acs)
    check('Assam: order vs ECI/CEO-2026 name differences (info; typos in gazette e.g. Dibrugrah)', True,
          'listed in note', mism_ceo)
    check('Assam: app names not matching order or CEO-2026 (info)', True, 'listed in note', mism_app or 'none')
    wiki = os.path.join(RAW, 'wikipedia_crosscheck_assam.csv')
    if os.path.exists(wiki):
        w = {int(r['ac_no']): r for r in csv.DictReader(l for l in open(wiki, encoding='utf-8') if not l.startswith('#'))}
        dd = [(r['ac_no'], r['district_current'], w[r['ac_no']]['district']) for r in rows
              if norm(r['district_current'])[:5] not in norm(w[r['ac_no']]['district'])
              and norm(AS_DIST_REV.get(r['district_current'], r['district_current']))[:5] not in norm(w[r['ac_no']]['district'])]
        pp = [(r['ac_no'], r['pc_name'], w[r['ac_no']]['pc']) for r in rows
              if norm(w[r['ac_no']]['pc'])[:5] != norm(r['pc_name'])[:5]]
        check('Assam: district agrees with Wikipedia cross-check', not dd, '126/126', dd or '126/126')
        check('Assam: PC agrees with Wikipedia cross-check', not pp, '126/126', pp or '126/126')
    return rows


AS_DIST_REV = {'Sivasagar': 'Sibsagar', 'Sribhumi': 'Karimganj', 'Kamrup Metropolitan': 'Kamrup Metro',
               'South Salmara-Mankachar': 'South Salmara'}


# ================================================================== (c) GUJARAT + MADHYA PRADESH (DPACO 2008)
GJ_MP = [
    # state, ac_no, name, reserved, district(2008 order heading), census-2011 district, pc_no, pc_name, extent summary
    ('Gujarat', 45, 'Naranpura', '', 'Ahmedabad', 'Ahmadabad', 6, 'Gandhinagar', 'AMC wards 11-14'),
    ('Gujarat', 46, 'Nikol', '', 'Ahmedabad', 'Ahmadabad', 7, 'Ahmedabad East', 'AMC wards 31, 34, 35'),
    ('Gujarat', 47, 'Naroda', '', 'Ahmedabad', 'Ahmadabad', 7, 'Ahmedabad East', 'AMC wards 23, 24, 27 + Ahmedabad Cantonment'),
    ('Gujarat', 48, 'Thakkarbapa Nagar', '', 'Ahmedabad', 'Ahmadabad', 7, 'Ahmedabad East', 'AMC wards 22, 25, 26 + Asarva (OG) ward 44'),
    ('Gujarat', 49, 'Bapunagar', '', 'Ahmedabad', 'Ahmadabad', 7, 'Ahmedabad East', 'AMC wards 21, 28, 29'),
    ('Gujarat', 50, 'Amraiwadi', '', 'Ahmedabad', 'Ahmadabad', 8, 'Ahmedabad West', 'AMC wards 32, 33, 41'),
    ('Gujarat', 51, 'Dariapur', '', 'Ahmedabad', 'Ahmadabad', 8, 'Ahmedabad West', 'AMC wards 2, 3, 4, 16'),
    ('Gujarat', 52, 'Jamalpur-Khadia', '', 'Ahmedabad', 'Ahmadabad', 8, 'Ahmedabad West', 'AMC wards 1, 5, 6, 39'),
    ('Gujarat', 53, 'Maninagar', '', 'Ahmedabad', 'Ahmadabad', 8, 'Ahmedabad West', 'AMC wards 36, 37, 43'),
    ('Gujarat', 54, 'Danilimda', 'SC', 'Ahmedabad', 'Ahmadabad', 8, 'Ahmedabad West', 'villages Piplaj, Shahwadi, Saijpur-Gopalpur + AMC wards 30, 38, 40'),
    ('Gujarat', 55, 'Sabarmati', '', 'Ahmedabad', 'Ahmadabad', 6, 'Gandhinagar', 'Kali, Ranip, Chandlodiya (M) + AMC ward 15'),
    ('Gujarat', 56, 'Asarwa', 'SC', 'Ahmedabad', 'Ahmadabad', 8, 'Ahmedabad West', 'AMC wards 17-20'),
    ('Gujarat', 160, 'Surat North', '', 'Surat', 'Surat', 24, 'Surat', 'SMC wards 4, 6, 7, 29, 31, 32'),
    ('Gujarat', 161, 'Varachha Road', '', 'Surat', 'Surat', 24, 'Surat', 'SMC wards 28, 43, 44, 45'),
    ('Gujarat', 162, 'Karanj', '', 'Surat', 'Surat', 24, 'Surat', 'SMC wards 36, 46, 47, 48'),
    ('Gujarat', 163, 'Limbayat', '', 'Surat', 'Surat', 25, 'Navsari', 'SMC wards 35, 49-52'),
    ('Gujarat', 164, 'Udhna', '', 'Surat', 'Surat', 25, 'Navsari', 'SMC wards 53-56, 66'),
    ('Gujarat', 165, 'Majura', '', 'Surat', 'Surat', 25, 'Navsari', 'SMC wards 13, 33, 34, 37, 57-62'),
    ('Gujarat', 166, 'Katargam', '', 'Surat', 'Surat', 24, 'Surat', 'SMC wards 38-42'),
    ('Gujarat', 167, 'Surat West', '', 'Surat', 'Surat', 24, 'Surat', 'SMC wards 14-27, 63-65'),
    ('Madhya Pradesh', 205, 'Indore-2', '', 'Indore', 'Indore', 26, 'Indore', 'Indore M.Corp wards 7-8, 10-16, 32-33'),
    ('Madhya Pradesh', 206, 'Indore-3', '', 'Indore', 'Indore', 26, 'Indore', 'Indore M.Corp wards 18, 26-30, 41-45, 57-61'),
    ('Madhya Pradesh', 207, 'Indore-4', '', 'Indore', 'Indore', 26, 'Indore', 'Indore M.Corp wards 22-23, 46-56, 66'),
    ('Madhya Pradesh', 208, 'Indore-5', '', 'Indore', 'Indore', 26, 'Indore', 'Indore M.Corp wards 9, 31, 34-40, 62-65'),
]
# (Table-A pages, district heading, next district heading) and (Table-B page, PC header regexes in order)
DPACO_TA = {'Ahmedabad': ([123, 124, 125], 'AHMEDABAD', 'SURENDRANAGAR'),
            'Surat': ([142, 143, 144], 'SURAT', 'TAPI'),
            'Indore': ([247, 248], 'INDORE', 'UJJAIN')}
DPACO_TB = {'Gujarat': (147, [(6, r'6-Gandhinagar'), (7, r'7-Ahmedabad East'), (8, r'8-\s*Ahmedabad\s+West'),
                              (9, r'9-Surendranagar')]),
            'Gujarat2': (148, [(23, r'23-Bardoli'), (24, r'24-Surat'), (25, r'25-Navsari'), (26, r'26-Valsad')]),
            'Madhya Pradesh': (253, [(25, r'25-DHAR'), (26, r'26-INDORE'), (27, r'27-KHARGONE')])}


def name_col_stream(doc, pages):
    """Name column of Table-A (x0<120, x1<186) plus district headings, in reading order."""
    out = []
    for pn in pages:
        for b in doc[pn - 1].get_text('dict')['blocks']:
            for l in b.get('lines', []):
                t = ''.join(s['text'] for s in l['spans'])
                x0, y0, x1, y1 = l['bbox']
                if 'DISTRICT' in t:
                    out.append((pn, y0, x0, clean(t)))
                elif x0 < 120 and x1 < 186 and t.strip():
                    out.append((pn, y0, x0, t.strip()))
    out.sort()
    return ' '.join(t for _, _, _, t in out).replace('–', '-')


def build_gj_mp(c11):
    doc = fitz.open(F_DPACO)
    rows = []
    streams = {k: name_col_stream(doc, v[0]) for k, v in DPACO_TA.items()}
    tbtext = {k: doc[v[0] - 1].get_text().replace('–', '-') for k, v in DPACO_TB.items()}
    app = {('Gujarat', k): v for k, v in app_names('Gujarat', 2022).items()}
    app.update({('Madhya Pradesh', k): v for k, v in app_names('Madhya Pradesh', 2023).items()})
    bad_name, bad_dist, bad_pc = [], [], []
    for st, n, name, res, dist, d11, pcno, pcname, ext in GJ_MP:
        s = streams[dist]
        pat = r'(?<!\d)%d\s*-\s*' % n + r'\s*-?\s*'.join(re.escape(p) for p in re.split(r'[\s-]+', name))
        if res:
            pat += r'\s*\(%s\)' % res
        m = re.search(pat, s)
        if not m:
            bad_name.append((n, name))
        else:
            h = s.find('DISTRICT : ' + DPACO_TA[dist][1]) if 'DISTRICT : ' + DPACO_TA[dist][1] in s else \
                re.search(r'DISTRICT\s*:\s*' + DPACO_TA[dist][1], s).start()
            nx = re.search(r'DISTRICT\s*:\s*' + DPACO_TA[dist][2], s)
            if not (h < m.start() and (nx is None or m.start() < nx.start())):
                bad_dist.append((n, dist))
        # PC membership from Table-B
        found = None
        for key, (pg, heads) in DPACO_TB.items():
            if not key.startswith(st[:5]) and not (st == 'Gujarat' and key.startswith('Gujarat')):
                continue
            t = tbtext[key]
            hp = [(re.search(h, t).start(), no) for no, h in heads if re.search(h, t)]
            am = re.search(r'(?<!\d)%d\s*-\s*%s' % (n, re.escape(re.split(r'[\s-]+', name)[0])), t)
            if am:
                prev = [no for p, no in hp if p < am.start()]
                found = prev[-1] if prev else None
        if found != pcno:
            bad_pc.append((n, pcno, found))
        notes = []
        if res:
            notes.append('reserved=' + res)
        ap = app.get((st, n), '')
        if ap and norm(ap) != norm(name):
            notes.append("app ECI-results spelling '%s'" % ap)
        notes.append('extent (2008 order): %s' % ext)
        if st == 'Gujarat' and dist == 'Ahmedabad':
            notes.append('wholly inside Ahmedabad City taluka; Census-2011 district Ahmadabad (Botad, carved 2013 '
                         'from Ahmadabad+Bhavnagar, does not touch these wards)')
        elif st == 'Gujarat':
            notes.append('wholly inside Surat City taluka; Census-2011 district Surat (Tapi was carved in 2007, '
                         'before the census)')
        else:
            notes.append('wholly inside Indore tehsil (Indore Municipal Corporation); Indore district unchanged since 2011')
        if pcno == 8:
            notes.append('PC 8 Ahmedabad West is reserved SC')
        rows.append(OrderedDict(state=st, ac_no=n, ac_name=name, district_current=dist, district_2011=d11,
                                pc_no=pcno, pc_name=pcname, source_url=DPACO_URL,
                                note='; '.join(notes + ['src: DPACO-2008 Table-A (name, district) + Table-B (PC)'])))
        c11.add((st.upper(), d11))
    cnt = Counter((r['state'], r['district_current']) for r in rows)
    check('GJ/MP: counts Ahmedabad 12 + Surat 8 + Indore 4',
          cnt[('Gujarat', 'Ahmedabad')] == 12 and cnt[('Gujarat', 'Surat')] == 8 and cnt[('Madhya Pradesh', 'Indore')] == 4,
          '12+8+4', dict(cnt))
    check('GJ/MP: each AC number+name found verbatim in 2008 order Table-A', not bad_name, '24/24', bad_name or '24/24')
    check('GJ/MP: each AC sits under the expected district heading', not bad_dist, '24/24', bad_dist or '24/24')
    check('GJ/MP: PC membership verified in 2008 order Table-B', not bad_pc, '24/24', bad_pc or '24/24')
    miss = [(r['state'], r['ac_no']) for r in rows if (r['state'], r['ac_no']) in app and
            norm(app[(r['state'], r['ac_no'])]) != norm(r['ac_name'])]
    check('GJ/MP: names equal app ECI-results names (GJ 2022 / MP 2023)', not miss, '24/24', miss or '24/24')
    return rows


# ================================================================== main
def write_csv(path, rows, cols=COLS):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def main():
    if '--ocr' in sys.argv or not os.path.exists(F_AS_OCR):
        ocr_assam()
    c11 = set()
    jk = build_jk(c11)
    asm = build_assam(c11)
    gm = build_gj_mp(c11)
    codes = census2011_districts()
    lk = {(s.upper(), d): v for (s, d), v in codes.items()}
    missing = [k for k in c11 if k not in lk]
    check('district_2011 values all exist in Census 2011 district list (../hlo/hlo_district_2011.csv)', not missing,
          'all found', missing or '%d found' % len(c11))
    write_csv(os.path.join(HERE, 'jk_2022_ac_district.csv'), jk)
    write_csv(os.path.join(HERE, 'assam_2023_ac_district.csv'), asm)
    write_csv(os.path.join(HERE, 'gj_mp_noshape_ac_district.csv'), gm)
    crow = []
    for (s, d) in sorted(c11):
        sc, dc = lk.get((s, d), ('', ''))
        crow.append(OrderedDict(state_2011=s, district_2011=d, census2011_state_code=sc, census2011_district_code=dc))
    write_csv(os.path.join(HERE, 'census2011_district_codes.csv'), crow,
              ['state_2011', 'district_2011', 'census2011_state_code', 'census2011_district_code'])
    write_csv(os.path.join(HERE, 'validation.csv'), CHECKS, ['check', 'ok', 'expected', 'got'])
    nfail = sum(1 for c in CHECKS if not c['ok'])
    print('\n%d checks, %d failed' % (len(CHECKS), nfail))
    return 1 if nfail else 0


if __name__ == '__main__':
    sys.exit(main())
