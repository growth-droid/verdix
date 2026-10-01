"""Readers for the governing (1976) delimitation text of the four deferred-delimitation states.

Two copies of the SAME schedules are read:
  * DPACO-1976: 'The Delimitation of Parliamentary and Assembly Constituencies Order, 1976' (ECI), archived
    scan at archive.org item 1976-dpaco (OCR text saved in raw_g6/dpaco_1976_archiveorg_djvu.txt).
    Assam = Schedule IV, Bihar (Jharkhand area) = Schedule V, Manipur = Schedule XIV, Nagaland = Schedule XVI.
  * The ECI's 2008 compilation (raw ../ac_district_lists/raw/eci_delimitation_order_2008_english.pdf) whose
    schedules for these four states RE-PRINT the 1976 extents unchanged (delimitation deferred under s.10A of
    the Delimitation Act 2002), with Jharkhand renumbered 1-81 as amended by the Bihar Reorganisation Act 2000.
    It is used ONLY as a clean-text reading aid for the OCR of the 1976 print (names / extents are compared
    and must agree); no value is taken from it that the 1976 print does not also carry.
"""
import os
import re
import unicodedata

import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw_g6')
ORDER2008 = os.path.normpath(os.path.join(HERE, '..', 'ac_district_lists', 'raw',
                                          'eci_delimitation_order_2008_english.pdf'))
DPACO_TXT = os.path.join(RAW, 'dpaco_1976_archiveorg_djvu.txt')

# 0-based PDF page index ranges in the 2008 compilation (TOC printed page = index)
REPRINT_PAGES = {'Assam': (42, 73), 'Jharkhand': (166, 174), 'Manipur': (280, 293), 'Nagaland': (311, 318)}
# line ranges of each schedule inside the 1976 OCR text (1-based, inclusive start, exclusive end),
# located by the 'SCHEDULE IV/V/XIV/XVI' headings; Jharkhand ACs sit inside the Bihar schedule.
DPACO_LINES = {'Assam': (3265, 7319), 'Jharkhand': (7319, 10856), 'Manipur': (25160, 26223), 'Nagaland': (28131, 28813)}
DPACO_SCHEDULE = {'Assam': 'Schedule IV (Assam)', 'Jharkhand': 'Schedule V (Bihar), Jharkhand districts',
                  'Manipur': 'Schedule XIV (Manipur)', 'Nagaland': 'Schedule XVI (Nagaland)'}
DPACO_PRINTED_PAGES = {'Assam': '41-56', 'Jharkhand': '78-124 (Jharkhand ACs pp.103-104, 118-124)',
                       'Manipur': '310-320', 'Nagaland': '347-356'}

N_EXPECTED = {'Assam': 126, 'Jharkhand': 81, 'Manipur': 60, 'Nagaland': 60}

EXTENT_WORDS = re.compile(r'(?i)\b(villages?|thana|ward|circle|police|mouza|sub-?division|town|municipality|'
                          r'excluding|district|g\.\s*ps|station|compound|h\.\s*q)\b')


def norm(s):
    s = unicodedata.normalize('NFKD', s)
    s = re.sub(r'\((SC|ST)\)', ' ', s, flags=re.I)
    return re.sub(r'[^A-Z]', '', s.upper())


def reprint_text(state):
    d = fitz.open(ORDER2008)
    a, b = REPRINT_PAGES[state]
    out = []
    for i in range(a, b + 1):
        for line in d[i].get_text().split('\n'):
            out.append((i, line.rstrip()))
    return out


def parse_reprint(state):
    """Sequential parse of Table/Part A entries 'N. Name', 'N- Name', 'N.Name'. Returns {n: dict}."""
    lines = reprint_text(state)
    n_exp = N_EXPECTED[state]
    res = {}
    pos = 0
    cur = None
    for n in range(1, n_exp + 1):
        pat = re.compile(r'^\s*%d\s*[.\-–]\s*(?!\s*[—\-])([A-Za-z(].*)$' % n)
        k = pos
        while k < len(lines):
            m = pat.match(lines[k][1])
            if m and not re.match(r'^\s*DISTRICT', m.group(1), re.I):
                break
            k += 1
        if k >= len(lines):
            res[n] = None
            continue
        if cur is not None:
            cur['extent'] = ' '.join(l for _, l in lines[cur['_start']:k])
        name = m.group(1).strip()
        j = k + 1
        # name continuation lines: short, not extent-like ('Pakhanglakpa', '(ST)', 'Chessore (ST)')
        while j < len(lines):
            nxt = lines[j][1].strip()
            if not nxt:
                j += 1
                continue
            if len(nxt) <= 28 and not EXTENT_WORDS.search(nxt) and not re.match(r'^\d', nxt) and \
                    (nxt.startswith('(') or (nxt[:1].isupper() and len(nxt.split()) <= 3 and
                                              not re.search(r'[,;]', nxt))) and \
                    not re.search(r'\((SC|ST)\)\s*$', name) and 'DISTRICT' not in nxt.upper():
                name = name + ' ' + nxt
                j += 1
                continue
            break
        name = re.sub(r'\s+', ' ', name).strip().rstrip('.').strip()
        resv = ''
        mres = re.search(r'\(\s*(SC|ST)\s*\)\s*$', name, re.I)
        if mres:
            resv = mres.group(1).upper()
            name = name[:mres.start()].strip()
        cur = {'n': n, 'name': name, 'reserved': resv, 'pdf_index': lines[k][0], '_start': j}
        res[n] = cur
        pos = j
    if cur is not None:
        cur['extent'] = ' '.join(l for _, l in lines[cur['_start']:])
    # district headings ('N - DISTRICT : NAME') preceding each AC
    heads = []
    for idx, (pg, l) in enumerate(lines):
        mh = re.match(r'^\s*\d+\s*[-–]\s*DISTRICT\s*:?\s*(.+?)\s*$', l, re.I)
        if mh:
            heads.append((idx, mh.group(1).strip()))
    starts = {}
    for n, r in res.items():
        if r:
            starts[n] = r['_start']
    for n, r in res.items():
        if not r:
            continue
        h = [name for idx, name in heads if idx < r['_start']]
        r['heading'] = h[-1] if h else ''
    return res


def dpaco_text(state):
    a, b = DPACO_LINES[state]
    with open(DPACO_TXT, encoding='utf-8') as f:
        lines = f.read().split('\n')
    return '\n'.join(lines[a - 1:b - 1])


def dpaco_partb(state):
    """Return the Part-B text (assembly constituencies) of the 1976 schedule, OCR as is."""
    t = dpaco_text(state)
    i = t.find('PART B')
    if state == 'Nagaland':
        i = 0
    if state == 'Jharkhand':
        i = t.find('SANTHAL PARGANAS DISTRICT')
    return t[i:] if i >= 0 else t


def token_set(s):
    return set(w for w in re.findall(r'[a-z]{3,}', s.lower()))


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    for st in ['Assam', 'Manipur', 'Nagaland', 'Jharkhand']:
        r = parse_reprint(st)
        miss = [n for n, v in r.items() if not v]
        print('==', st, 'parsed', sum(1 for v in r.values() if v), 'missing', miss)
        for n, v in r.items():
            if v:
                print(' ', n, repr(v['name']), v['reserved'], '|', v['heading'], '| idx', v['pdf_index'])
