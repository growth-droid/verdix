#!/usr/bin/env python3
"""
Official AC -> district (2008) lists for Madhya Pradesh, Maharashtra, Meghalaya, Mizoram and Orissa (Odisha),
parsed from TABLE A ("PART A" for Maharashtra) of the ECI "Delimitation of Parliamentary and Assembly
Constituencies Order, 2008" (English), plus a 2008-district -> Census-2011-district crosswalk.

Outputs (this folder), per state slug:
  <slug>_acs.csv        state,ac_no,ac_name,district_2008,source,page,note
  <slug>_districts.csv  state,district_2008,continuing_2011_code,carved_2011_codes,note
  g3_validation.txt     every check run (count/contiguity, name agreement vs app, district-code validity)

Method: words of each Table-A page are grouped into rows by y; a row containing "DISTRICT" is a district
heading; words left of a per-state x threshold form the "Sl. No. & Name" column, words right of it the extent.
An AC starts where the name column begins with the next expected serial number; wrapped name lines are
appended. Parsing stops at the TABLE B / PART B heading. "page" = printed page number of the order
(= 0-based PDF page index of eci_delimitation_order_2008_english.pdf).

Read-only inputs: ../ac_district_lists/raw/eci_delimitation_order_2008_english.pdf, ../pca/pca_district_2011.csv,
../../../../public/data/seats_ae.json. Requires PyMuPDF (fitz).
"""
import csv, json, os, re
from collections import OrderedDict

import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = os.path.normpath(os.path.join(HERE, '..', 'ac_district_lists', 'raw', 'eci_delimitation_order_2008_english.pdf'))
PCA = os.path.normpath(os.path.join(HERE, '..', 'pca', 'pca_district_2011.csv'))
SEATS = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', 'public', 'data', 'seats_ae.json'))
SOURCE = 'ECI Delimitation of Parliamentary and Assembly Constituencies Order 2008 (English), Table A'

# state in order, app name, slug, first/last Table-A page (printed = 0-based index), x threshold of name column,
# seat count, census-2011 state name, app comparison year (first post-2008 AE present in seats_ae.json)
STATES = [
    dict(order='Madhya Pradesh', app='Madhya Pradesh', slug='madhya_pradesh', pages=(226, 252), T=189, seats=230,
         c11='MADHYA PRADESH', year=2013),
    dict(order='Maharashtra', app='Maharashtra', slug='maharashtra', pages=(253, 279), T=205, seats=288,
         c11='MAHARASHTRA', year=2009),
    dict(order='Meghalaya', app='Meghalaya', slug='meghalaya', pages=(294, 301), T=205, seats=60,
         c11='MEGHALAYA', year=2013),
    dict(order='Mizoram', app='Mizoram', slug='mizoram', pages=(302, 310), T=203, seats=40,
         c11='MIZORAM', year=2013),
    dict(order='Orissa', app='Odisha', slug='odisha', pages=(319, 335), T=203, seats=147,
         c11='ODISHA', year=2009),
]

# 2008-order district heading (as printed, whitespace-normalised) -> (continuing 2011 code, carved 2011 codes, note)
DIST = {
    'Madhya Pradesh': OrderedDict([
        ('SHEOPUR', ('418', '', '')),
        ('MORENA', ('419', '', '')),
        ('BHIND', ('420', '', '')),
        ('GWALIOR', ('421', '', '')),
        ('DATIA', ('422', '', '')),
        ('SHIVPURI', ('423', '', '')),
        ('GUNA', ('458', '', '')),
        ('ASHOK NAGAR', ('459', '', 'census 2011 spelling Ashoknagar')),
        ('SAGAR', ('427', '', '')),
        ('TIKAMGARH', ('424', '', 'Niwari district carved 2018 (after census) - not a 2011 code')),
        ('CHHATARPUR', ('425', '', '')),
        ('DAMOH', ('428', '', '')),
        ('PANNA', ('426', '', '')),
        ('SATNA', ('429', '', 'Maihar district carved 2023 (after census)')),
        ('REWA', ('430', '', 'Mauganj district carved 2023 (after census)')),
        ('SIDHI', ('462', '463', 'Singrauli (463) carved out of Sidhi on 24-05-2008 (Singrauli, Deosar/Devsar and '
                                 'Chitrangi tehsils): order ACs 79 Chitrangi, 80 Singrauli, 81 Devsar lie in Singrauli; '
                                 'ACs 78 Sihawal and 82 Dhauhani also take one R.I. circle each of Devsar tehsil')),
        ('SHAHDOL', ('460', '', '')),
        ('ANUPPUR', ('461', '', '')),
        ('UMARIA', ('431', '', '')),
        ('KATNI', ('450', '', '')),
        ('JABALPUR', ('451', '', '')),
        ('DINDORI', ('453', '', '')),
        ('MANDLA', ('454', '', '')),
        ('BALAGHAT', ('457', '', '')),
        ('SEONI', ('456', '', '')),
        ('NARSINGPUR', ('452', '', 'census 2011 spelling Narsimhapur')),
        ('CHHINDWARA', ('455', '', 'Pandhurna district carved 2023 (after census)')),
        ('BETUL', ('447', '', '')),
        ('HARDA', ('448', '', '')),
        ('HOSHANGABAD', ('449', '', 'renamed Narmadapuram 2022')),
        ('RAISEN', ('446', '', '')),
        ('VIDISHA', ('443', '', '')),
        ('BHOPAL', ('444', '', '')),
        ('SEHORE', ('445', '', '')),
        ('RAJGARH', ('442', '', '')),
        ('SHAJAPUR', ('436', '', 'Agar Malwa district carved 2013 (after census)')),
        ('DEWAS', ('437', '', '')),
        ('EAST NIMAR (Khandwa)', ('466', '', 'census 2011 name Khandwa (East Nimar)')),
        ('BURHANPUR', ('467', '', '')),
        ('WEST NIMAR (Khaorgone)', ('440', '', "heading misprints Khargone as 'Khaorgone'; census 2011 name "
                                                 "Khargone (West Nimar)")),
        ('BADWANI', ('441', '', 'census 2011 spelling Barwani')),
        ('JHABUA', ('464', '465', 'Alirajpur (465) carved out of Jhabua on 17-05-2008 (Alirajpur, Jobat, Bhavra/'
                                  'Chandrashekhar Azad Nagar tehsils): order ACs 191 Alirajpur, 192 Jobat lie in '
                                  'Alirajpur; AC 193 Jhabua also takes 5 Patwari circles of Jobat tehsil')),
        ('DHAR', ('438', '', '')),
        ('INDORE', ('439', '', '')),
        ('UJJAIN', ('435', '', '')),
        ('RATLAM', ('434', '', '')),
        ('MANDSOUR', ('433', '', 'census 2011 spelling Mandsaur')),
        ('NEEMUCH', ('432', '', '')),
    ]),
    'Maharashtra': OrderedDict([
        ('NANDURBAR', ('497', '', '')),
        ('DHULE', ('498', '', '')),
        ('JALGAON', ('499', '', '')),
        ('BULDHANA', ('500', '', 'census 2011 spelling Buldana')),
        ('AKOLA', ('501', '', '')),
        ('WASHIM', ('502', '', '')),
        ('AMRAVATI', ('503', '', '')),
        ('WARDHA', ('504', '', '')),
        ('NAGPUR', ('505', '', '')),
        ('BHANDARA', ('506', '', '')),
        ('GONDIYA', ('507', '', '')),
        ('GADCHIROLI', ('508', '', '')),
        ('CHANDRAPUR', ('509', '', '')),
        ('YAVATMAL', ('510', '', '')),
        ('NANDED', ('511', '', '')),
        ('HINGOLI', ('512', '', '')),
        ('PARBHANI', ('513', '', '')),
        ('JALNA', ('514', '', '')),
        ('AURANGABAD', ('515', '', 'renamed Chhatrapati Sambhajinagar 2023')),
        ('NASHIK', ('516', '', '')),
        ('THANE', ('517', '', 'Palghar district carved 01-08-2014 (after census) - not a 2011 code')),
        ('MUMBAI SUBURBAN', ('518', '', '')),
        ('MUMBAI CITY', ('519', '', 'census 2011 name Mumbai')),
        ('RAIGAD', ('520', '', 'census 2011 spelling Raigarh')),
        ('PUNE', ('521', '', '')),
        ('AHMEDNAGAR', ('522', '', 'census 2011 spelling Ahmadnagar; renamed Ahilyanagar 2024')),
        ('BEED', ('523', '', 'census 2011 spelling Bid')),
        ('LATUR', ('524', '', '')),
        ('OSMANABAD', ('525', '', 'renamed Dharashiv 2023')),
        ('SOLAPUR', ('526', '', '')),
        ('SATARA', ('527', '', '')),
        ('RATNAGIRI', ('528', '', '')),
        ('SINDHUDURG', ('529', '', "heading printed without colon ('DISTRICT SINDHUDURG')")),
        ('KOLHAPUR', ('530', '', '')),
        ('SANGLI', ('531', '', '')),
    ]),
    'Meghalaya': OrderedDict([
        ('JAINTIA HILLS', ('299', '', 'split 2012 into West/East Jaintia Hills (after census)')),
        ('RIBHOI', ('297', '', '')),
        ('EAST KHASI HILLS', ('298', '', '')),
        ('WEST KHASI HILLS', ('296', '', 'South West Khasi Hills (2012) and Eastern West Khasi Hills (2021) '
                                         'carved after census')),
        ('EAST GARO HILLS', ('294', '', 'North Garo Hills carved 2012 (after census)')),
        ('WEST GARO HILLS', ('293', '', 'South West Garo Hills carved 2012 (after census)')),
        ('SOUTH GARO HILLS', ('295', '', '')),
    ]),
    'Mizoram': OrderedDict([
        ('MAMIT', ('281', '', '')),
        ('KOLASIB', ('282', '', '')),
        ('AIZAWL', ('283', '', '')),
        ('CHAMPHAI', ('284', '', '')),
        ('SERCHHIP', ('285', '', '')),
        ('LUNGLEI', ('286', '', '')),
        ('LAWNGTLAI', ('287', '', '')),
        ('SAIHA', ('288', '', 'renamed Siaha')),
    ]),
    'Orissa': OrderedDict([
        ('BARGARH', ('370', '', '')),
        ('JHARSUGUDA', ('371', '', '')),
        ('SUNDARGARH', ('374', '', '')),
        ('SAMBALPUR', ('372', '', '')),
        ('DEOGARH', ('373', '', 'census 2011 spelling Debagarh')),
        ('KEONJHAR', ('375', '', 'census 2011 spelling Kendujhar')),
        ('MAYURBHANJ', ('376', '', '')),
        ('BALASORE', ('377', '', 'census 2011 spelling Baleshwar')),
        ('BHADRAK', ('378', '', '')),
        ('JAJPUR', ('382', '', 'census 2011 spelling Jajapur')),
        ('DHENKANAL', ('383', '', '')),
        ('ANGUL', ('384', '', 'census 2011 spelling Anugul')),
        ('SUBARNAPUR', ('392', '', '')),
        ('BOLANGIR', ('393', '', 'census 2011 spelling Balangir')),
        ('NUAPADA', ('394', '', '')),
        ('NABARANGPUR', ('397', '', 'census 2011 spelling Nabarangapur')),
        ('KALAHANDI', ('395', '', '')),
        ('KANDHAMAL', ('390', '', '')),
        ('BOUDH', ('391', '', 'census 2011 spelling Baudh')),
        ('CUTTACK', ('381', '', '')),
        ('KENDRAPARA', ('379', '', '')),
        ('JAGATSINGHPUR', ('380', '', 'census 2011 spelling Jagatsinghapur')),
        ('PURI', ('387', '', '')),
        ('KHURDA', ('386', '', 'census 2011 spelling Khordha')),
        ('NAYAGARH', ('385', '', '')),
        ('GANJAM', ('388', '', '')),
        ('GAJAPATI', ('389', '', '')),
        ('RAYAGADA', ('396', '', '')),
        ('KORAPUT', ('398', '', '')),
        ('MALKANGIRI', ('399', '', '')),
    ]),
}

# known glyph/wrap artefacts of the PDF text layer, fixed after visual check of the page
NAME_FIX = {}

LOG = []


def log(s=''):
    print(s)
    LOG.append(s)


def rows_of(page, ytol=3):
    ws = sorted(page.get_text('words'), key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    out = []
    for w in ws:
        yc = (w[1] + w[3]) / 2
        if out and abs(out[-1][0] - yc) <= ytol:
            out[-1][1].append(w)
        else:
            out.append([yc, [w]])
    for r in out:
        r[1].sort(key=lambda w: w[0])
    return out


DASH = '-–—�­'


def clean(s):
    for ch in DASH[1:]:
        s = s.replace(ch, '-')
    s = re.sub(r'\s*-\s*', '-', s)
    s = re.sub(r'\(\s*', '(', s)
    s = re.sub(r'\s*\)', ')', s)
    s = re.sub(r'\s*\((SC|ST)\)', r' (\1)', s)
    return re.sub(r'\s+', ' ', s).strip()


def norm(s):
    # uppercase, strip reservation tags -- (SC)/(ST) and the app's '(S.C.)'/'(S.T.)' form -- then non-letters
    s = s.upper()
    s = re.sub(r'\(\s*S\s*\.?\s*[CT]\s*\.?\s*\)', '', s)
    return re.sub(r'[^A-Z]', '', s)


def parse_state(doc, st):
    a, b = st['pages']
    T = st['T']
    acs, district, started, done = [], None, False, False
    expect = 1
    heads = []
    for p in range(a, b + 1):
        if done:
            break
        for yc, ws in rows_of(doc[p]):
            full = ' '.join(w[4] for w in ws)
            if re.search(r'(TABLE|PART)\s*[-–�]?\s*B\b', full):
                done = True
                break
            if re.search(r'(TABLE|PART)\s*[-–�]?\s*A\b', full):
                started = True
                continue
            if not started:
                continue
            m = re.match(r'^\s*\d+\s*[' + DASH + r']?\s*DISTRICT\s*:?\s*(.+?)\s*$', full)
            if m:
                district = re.sub(r'\s+', ' ', m.group(1)).strip()
                heads.append((district, p))
                continue
            left = ' '.join(w[4] for w in ws if w[0] < T).strip()
            right = ' '.join(w[4] for w in ws if w[0] >= T).strip()
            if left in ('Sl. No. & Name', 'Sl. No. &', 'Name'):
                continue
            # serial number + name ("1-Sheopur", "1 - Akkalkuwa (ST)", "64 BIRMAHARAJPUR"), or a bare serial
            # number whose name wraps to the next row ("125." / "KABISURYANAGAR")
            mm = re.match(r'^(\d{1,3})\s*[' + DASH + r'.]?\s*([A-Za-z].*)?$', left) if left else None
            if mm and int(mm.group(1)) == expect:
                acs.append(dict(ac_no=expect, raw=mm.group(2) or '', district=district, page=p, extent=right))
                expect += 1
            elif left and acs:
                r = acs[-1]['raw']
                acs[-1]['raw'] = (r + left) if (r.endswith('-') or not r) else (r + ' ' + left)
                if right:
                    acs[-1]['extent'] += ' ' + right
            elif right and acs:
                acs[-1]['extent'] += ' ' + right
            elif left and not acs:
                log('  [%s] unparsed pre-AC name-column text p%d: %r' % (st['order'], p, left))
    for r in acs:
        r['name_full'] = NAME_FIX.get((st['order'], r['ac_no']), clean(r['raw']))
        m = re.search(r'\s*\((SC|ST)\)\s*$', r['name_full'])
        r['res'] = m.group(1) if m else ''
        r['name'] = r['name_full'][:m.start()].strip() if m else r['name_full']
        r['extent'] = clean(r['extent'])
    return acs, heads


def census2011():
    out = {}
    for r in csv.DictReader(open(PCA, encoding='utf-8')):
        if r['tru'] == 'Total':
            out[r['district_code']] = (r['state_name'], r['district_name'])
    return out


_SEATS = None


def app_rows(state, year):
    global _SEATS
    if _SEATS is None:
        _SEATS = json.load(open(SEATS, encoding='utf-8'))
    return {r['n']: r for r in _SEATS if r['s'] == state and r['y'] == year}


def app_names(state, year):
    return {n: r['c'] for n, r in app_rows(state, year).items()}


def app_years(state):
    app_rows(state, 0)
    return sorted({r['y'] for r in _SEATS if r['s'] == state and r['y'] >= 2008})


def write_csv(path, cols, rows):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow(r)


# spelling-variant judgements for every name mismatch vs the app (filled after inspecting the diff)
VERDICT = {
    # Madhya Pradesh vs app AE 2013 (app spells seats the way ECI's 2013 results did - Hindi transliterations)
    ('Madhya Pradesh', 3): 'spelling variant (Sabalgarh/Sabalagadh)',
    ('Madhya Pradesh', 4): 'spelling variant (app AE 2023 spells JOURA, as the order)',
    ('Madhya Pradesh', 5): 'spelling variant (Sumawali/Sumaoli)',
    ('Madhya Pradesh', 18): 'spelling variant (Bhitarwar/Bhitrwar)',
    ('Madhya Pradesh', 19): 'spelling variant (Dabra/Dabara)',
    ('Madhya Pradesh', 30): 'spelling variant (Chachoura/Chachoda, r/d transliteration)',
    ('Madhya Pradesh', 40): 'spelling variant (Naryoli/Naryawali)',
    ('Madhya Pradesh', 59): 'spelling variant (Gunnaor/Gunnour)',
    ('Madhya Pradesh', 80): 'spelling variant (Singrauli/Singarouli)',
    ('Madhya Pradesh', 82): 'spelling variant (app AE 2023 spells DHAUHANI, as the order)',
    ('Madhya Pradesh', 86): 'spelling variant (Kotma/Kotama)',
    ('Madhya Pradesh', 88): 'spelling variant (Pushprajgarh/Pusprajgarh)',
    ('Madhya Pradesh', 90): 'spelling variant (Manpur/Manapur)',
    ('Madhya Pradesh', 91): 'spelling variant (app AE 2023 spells BARWARA, as the order)',
    ('Madhya Pradesh', 93): 'spelling variant (app AE 2023 spells MURWARA, as the order)',
    ('Madhya Pradesh', 97): 'translation variant (Purba = East)',
    ('Madhya Pradesh', 98): 'translation variant (Uttar = North)',
    ('Madhya Pradesh', 100): 'translation variant (Paschim = West)',
    ('Madhya Pradesh', 117): 'spelling variant (Lakhnadon/Lakhanadon)',
    ('Madhya Pradesh', 125): 'spelling variant (Saunsar/Sausar)',
    ('Madhya Pradesh', 127): 'spelling variant (Parasia/Parasiya)',
    ('Madhya Pradesh', 132): 'spelling variant (Ghoradongri/Ghodadongri)',
    ('Madhya Pradesh', 152): 'spelling variant (Dakshin-Paschim/Dakshina-Pashchim)',
    ('Madhya Pradesh', 174): 'spelling variant (Bagali/Bagli)',
    ('Madhya Pradesh', 182): 'spelling variant (Badwah/Badwaha; later app years BARWAH)',
    ('Madhya Pradesh', 187): 'spelling variant (Sendhawa/Sendhwa)',
    ('Madhya Pradesh', 190): 'spelling variant (Badwani/Barwani)',
    ('Madhya Pradesh', 212): 'spelling variant (Khachrod/Khacharod)',
    ('Madhya Pradesh', 216): 'translation variant (Uttar = North)',
    ('Madhya Pradesh', 217): 'translation variant (Dakshin = South)',
    ('Madhya Pradesh', 223): 'spelling variant (Alot/Alote)',
    # Maharashtra vs app AE 2009
    ('Maharashtra', 32): 'spelling variant (Murtizapur/Murtijapur)',
    ('Maharashtra', 36): 'spelling variant - app typo DHAMAMGAON',
    ('Maharashtra', 126): 'spelling variant (app AE 2024 spells DEOLALI, as the order)',
    ('Maharashtra', 208): 'spelling variant - app typo VADGAOL',
    # Orissa/Odisha vs app AE 2009
    ('Orissa', 13): 'spelling variant (Rajgangpur/Rajgangapur)',
    ('Orissa', 50): 'spelling variant (Barachana/Barchana)',
    ('Orissa', 73): 'spelling variant (app AE 2024 spells UMERKOTE, as the order)',
    ('Orissa', 103): 'spelling variant (Erasama/Ersama)',
    ('Orissa', 108): 'spelling variant (Brahmagiri/Bramhagiri)',
    ('Orissa', 125): 'spelling variant - app drops an A (Kabisuryangar)',
}

# cross-district extents found in Table A (AC listed under one district heading but extent names
# area of another district) - filled after reading the extents
CROSS = {
    # Mizoram: the order itself puts part of these ACs in another district
    ('Mizoram', 6): ('ALSO_DISTRICT=AIZAWL(283): extent includes villages Saiphai and Saipum "under Sakawrdai '
                     'Sub-Division (Civil) in Thingdawl R. D. Block under Aizawl District"'),
    ('Mizoram', 27): ('ALSO_DISTRICT=AIZAWL(283): extent includes Tlungvel, Darlawng and Phulmawi "in '
                      'Thingsulthliah R. D. Block of District Aizawl"'),
    ('Mizoram', 28): ('ALSO_DISTRICT=CHAMPHAI(284): extent includes village Biate "in E. Lungdar R. D. Block of '
                      'Champhai District"'),
    # Madhya Pradesh: districts carved in 2008 after the order was drawn (Sidhi -> Singrauli, Jhabua -> Alirajpur)
    ('Madhya Pradesh', 78): ('2011: Sidhi (462) mostly; extent also has Devsar Gird-I R.I. Circle of Devsar Tehsil '
                             '- Devsar tehsil went to Singrauli (463) in 2008, so the AC may straddle 462/463'),
    ('Madhya Pradesh', 79): '2011: Singrauli (463) - Chitrangi Tehsil',
    ('Madhya Pradesh', 80): '2011: Singrauli (463) - Singrauli Tehsil parts + Singrauli M.Corp',
    ('Madhya Pradesh', 81): '2011: Singrauli (463) - Devsar/Singrauli Tehsil parts',
    ('Madhya Pradesh', 82): ('2011: Sidhi (462) mostly (Kusmi + Majholi tehsils); extent also has Dhauhani R.I. '
                             'Circle of Devsar Tehsil - may straddle 462/463'),
    ('Madhya Pradesh', 191): '2011: Alirajpur (465) - Alirajpur Tehsil parts + Alirajpur (M)',
    ('Madhya Pradesh', 192): '2011: Alirajpur (465) - Bhavra Tehsil + Jobat/Alirajpur Tehsil parts',
    ('Madhya Pradesh', 193): ('2011: Jhabua (464) mostly; extent also has 5 Patwari Circles of Udaigarh R.I. Circle '
                              'of Jobat Tehsil - Jobat tehsil went to Alirajpur (465) in 2008, so may straddle '
                              '464/465'),
}


def main():
    doc = fitz.open(PDF)
    c11 = census2011()
    summary = []
    for st in STATES:
        log('=' * 100)
        log('%s (app: %s)  pages %d-%d' % (st['order'], st['app'], *st['pages']))
        acs, heads = parse_state(doc, st)
        dmap = DIST[st['order']]
        # ---- district headings
        hnames = [h for h, _ in heads]
        log('  district headings: %d (crosswalk %d)' % (len(hnames), len(dmap)))
        unknown = [h for h in hnames if h not in dmap]
        unused = [k for k in dmap if k not in hnames]
        log('  CHECK headings all in crosswalk: %s %s' % (not unknown, unknown or ''))
        log('  CHECK crosswalk keys all used: %s %s' % (not unused, unused or ''))
        # ---- counts / contiguity
        nos = [a['ac_no'] for a in acs]
        ok = nos == list(range(1, st['seats'] + 1))
        log('  CHECK ACs contiguous 1..%d: %s (parsed %d)' % (st['seats'], ok, len(acs)))
        nodist = [a['ac_no'] for a in acs if a['district'] is None]
        log('  CHECK every AC under a district heading: %s %s' % (not nodist, nodist or ''))
        # ---- app comparison
        app = app_names(st['app'], st['year'])
        mism = []
        for a in acs:
            ap = app.get(a['ac_no'])
            if ap is None:
                mism.append((a['ac_no'], a['name_full'], None))
            elif norm(ap) != norm(a['name']):
                mism.append((a['ac_no'], a['name_full'], ap))
        agree = 100.0 * (len(acs) - len(mism)) / max(1, len(acs))
        log('  CHECK name agreement vs app %s %d: %d/%d = %.1f%%' % (st['app'], st['year'], len(acs) - len(mism),
                                                                     len(acs), agree))
        app_by_norm = {norm(v): k for k, v in app.items()}
        shifts = []
        for n, o, ap in mism:
            log('     MISMATCH ac %3d  order=%-30r app=%-30r verdict=%s' % (n, o, ap,
                                                                          VERDICT.get((st['order'], n), '?')))
            other = app_by_norm.get(norm(o))
            if other is not None and other != n:
                shifts.append((n, o, other))
        unjudged = [n for n, _, _ in mism if (st['order'], n) not in VERDICT]
        log('  CHECK every mismatch judged: %s %s' % (not unjudged, unjudged or ''))
        log('  CHECK no row shift (no order name equals the app name of a DIFFERENT seat number): %s %s'
            % (not shifts, shifts or ''))
        for y in app_years(st['app']):
            ay = app_names(st['app'], y)
            k = sum(1 for a in acs if a['ac_no'] in ay and norm(ay[a['ac_no']]) == norm(a['name']))
            log('  INFO name agreement vs app %s %d: %d/%d' % (st['app'], y, k, len(ay)))
        ar = app_rows(st['app'], st['year'])
        resdiff = [(a['ac_no'], a['res'] or 'GEN', ar[a['ac_no']].get('r')) for a in acs
                   if a['ac_no'] in ar and (a['res'] or 'GEN') != ar[a['ac_no']].get('r')]
        log('  INFO reservation (order vs app %d r-flag) differences: %d %s' % (st['year'], len(resdiff),
                                                                                resdiff or ''))
        # ---- census codes
        badcode = []
        used = set()
        for k, (cont, carved, _) in dmap.items():
            for c in [cont] + [x for x in carved.split(';') if x]:
                used.add(c)
                if c not in c11 or c11[c][0] != st['c11']:
                    badcode.append((k, c, c11.get(c)))
        log('  CHECK every crosswalk code is a real 2011 code in %s: %s %s' % (st['c11'], not badcode, badcode or ''))
        state_codes = sorted(c for c, v in c11.items() if v[0] == st['c11'])
        missing = [(c, c11[c][1]) for c in state_codes if c not in used]
        log('  CHECK every 2011 district of the state covered: %s (%d codes) %s' % (not missing, len(state_codes),
                                                                                  missing or ''))
        conts = [v[0] for v in dmap.values()]
        dup = sorted(set(c for c in conts if conts.count(c) > 1))
        log('  CHECK continuing codes unique: %s %s' % (not dup, dup or ''))
        # ---- cross-district extents (AC extent naming another district)
        for a in acs:
            hits = re.findall(r'(?:District\s+(?:of\s+)?([A-Z][A-Za-z]+)|([A-Z][A-Za-z]+)\s+District)', a['extent'])
            if hits:
                log('     extent mentions district: ac %d (%s, heading %s): %s' % (
                    a['ac_no'], a['name_full'], a['district'], hits))
        # ---- write
        rows = []
        for a in acs:
            notes = []
            if a['res']:
                notes.append('reserved=' + a['res'])
            ap = app.get(a['ac_no'])
            if ap is not None and norm(ap) != norm(a['name']):
                notes.append("app %d spelling '%s' (%s)" % (st['year'], ap, VERDICT.get((st['order'], a['ac_no']),
                                                                                       'unjudged')))
            if a['ac_no'] in ar and (a['res'] or 'GEN') != ar[a['ac_no']].get('r'):
                notes.append("app %d r-flag '%s' disagrees with the order (%s) - app-side issue"
                             % (st['year'], ar[a['ac_no']].get('r'), a['res'] or 'GEN'))
            if (st['order'], a['ac_no']) in CROSS:
                notes.append(CROSS[(st['order'], a['ac_no'])])
            rows.append(OrderedDict(state=st['app'], ac_no=a['ac_no'], ac_name=a['name_full'],
                                    district_2008=a['district'], source=SOURCE, page=a['page'],
                                    note='; '.join(notes)))
        write_csv(os.path.join(HERE, st['slug'] + '_acs.csv'),
                  ['state', 'ac_no', 'ac_name', 'district_2008', 'source', 'page', 'note'], rows)
        drows = []
        for k, (cont, carved, note) in dmap.items():
            n = [note] if note else []
            n.append('2011: ' + c11[cont][1] + ('; carved: ' + ', '.join(c11[c][1] for c in carved.split(';'))
                                               if carved else ''))
            n.append('ACs %d' % sum(1 for a in acs if a['district'] == k))
            drows.append(OrderedDict(state=st['app'], district_2008=k, continuing_2011_code=cont,
                                     carved_2011_codes=carved, note='; '.join(n)))
        write_csv(os.path.join(HERE, st['slug'] + '_districts.csv'),
                  ['state', 'district_2008', 'continuing_2011_code', 'carved_2011_codes', 'note'], drows)
        summary.append((st['app'], len(acs), st['seats'], round(agree, 1), len(hnames)))
    log('=' * 100)
    for s in summary:
        log('SUMMARY %s: %d/%d ACs, name agreement %.1f%%, %d district headings' % s)
    with open(os.path.join(HERE, 'g3_validation.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(LOG) + '\n')


if __name__ == '__main__':
    main()
