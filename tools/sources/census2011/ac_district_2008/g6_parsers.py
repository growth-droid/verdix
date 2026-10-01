"""Parsers for the g6 (deferred-delimitation) official AC -> district lists.

Each parser reads one saved official source from raw_g6/ and returns a list of dicts
{ac_no:int, name:str, reserved:str ('', 'SC', 'ST'), district:str, sub:str, page:int|str}.
No network access here; build_g6_as_mn_nl_jh.py calls these.
"""
import html as _html
import os
import re

import fitz  # PyMuPDF

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw_g6')


def _split_res(name):
    name = re.sub(r'\s+', ' ', name).strip()
    m = re.search(r'\(\s*(SC|ST)\s*\)?\s*$', name, re.I)
    res = ''
    if m:
        res = m.group(1).upper()
        name = name[:m.start()].strip()
    # a dangling "(" left by a truncated cell, e.g. "Abhayapuri South ("
    name = re.sub(r'\s*\($', '', name).strip()
    return name, res


# --------------------------------------------------------------------------- Assam
def parse_assam_ceo_2021():
    """CEO Assam, AE-2021 'Total Polling Station and General Electors - PHASE wise'.
    Columns: S.No | Name of Revenue District | Name of the Election District | AC No | AC Name | PS | electors.
    Parsed by x-position of words (the revenue-district cell sometimes wraps or overflows)."""
    path = os.path.join(RAW, 'assam_ceo_ae2021_final_ps_electors_phasewise.pdf')
    doc = fitz.open(path)
    rows = []
    rev = None
    elec = None
    pending_rev_row = None
    for pno in range(doc.page_count):
        words = doc[pno].get_text('words')
        lines = {}
        for w in words:
            x0, y0, x1, y1, t = w[:5]
            lines.setdefault(round(y0 / 3), []).append((x0, t))
        for key in sorted(lines):
            ws = sorted(lines[key])
            texts = {t for x, t in ws}
            if texts & {'Revenue', 'Election', 'Constituency', 'Assembly', 'nos.', 'Total', 'Page',
                        'PHASE-I', 'PHASE-II', 'PHASE-III', 'Phas-II', 'PHASE', 'S.', 'Male'}:
                continue
            sno = [t for x, t in ws if x < 150]
            revw = [t for x, t in ws if 150 <= x < 218]
            elw = [t for x, t in ws if 218 <= x < 296]
            acno = [t for x, t in ws if 296 <= x < 319]
            acnm = [t for x, t in ws if 319 <= x < 425]
            is_ac = len(acno) == 1 and acno[0].isdigit() and acnm
            if sno and sno[0].isdigit() and revw:
                rev = ' '.join(revw)
                pending_rev_row = len(rows)
            elif revw and not is_ac and not acnm and pending_rev_row is not None and \
                    not any(t[0].isdigit() for t in revw) and 'nos.' not in ' '.join(revw):
                # wrapped continuation of the revenue-district cell ("West Karbi" / "Anglong")
                rev = rev + ' ' + ' '.join(revw)
                for r in rows[pending_rev_row:]:
                    r['district_raw'] = rev
                continue
            if elw and any(re.match(r'^\d+-', t) for t in elw):
                elec = ' '.join(elw)
            elif elw and not is_ac and elec:
                elec = elec + ' ' + ' '.join(elw)
            if is_ac:
                name, res = _split_res(' '.join(acnm))
                rows.append({'ac_no': int(acno[0]), 'name': name, 'reserved': res,
                             'district_raw': rev, 'sub': elec, 'page': pno + 1})
    for r in rows:
        d = r['district_raw']
        d = re.sub(r'^\d+-', '', d).strip()
        # overflowing / truncated cells, exactly as printed
        if d.startswith('South Salmar'):
            d = 'South Salmara-Mankachar'
            r['district_note'] = "CEO list prints the cell as '1-South Salmar' (truncated); district is South Salmara-Mankachar"
        if d.startswith('Kamrup Met'):
            d = 'Kamrup Metro'
            r['district_note'] = "CEO list prints 'Kamrup Met' (truncated cell); CEO short label for Kamrup Metropolitan"
        r['district'] = d
        r['sub'] = re.sub(r'^\d+-', '', (r['sub'] or '')).strip()
        # the two cells that overflow their column (election-district text wraps / spills)
        if d == 'South Salmara-Mankachar':
            r['sub'] = 'South Salmara'
        if r['sub'] == 'West Karbi':
            r['sub'] = 'West Karbi Anglong'
    return rows


# --------------------------------------------------------------------------- Manipur
def parse_manipur_ceo_eros():
    """CEO Manipur 'Who's Who' page, Electoral Registration Officers table: District | N - AC | ERO ..."""
    h = open(os.path.join(RAW, 'manipur_ceo_officers_contact.html'), encoding='utf-8', errors='ignore').read()
    i = h.find('Electoral Registration Officers (ERO)')
    j = h.find('Electoral Registration Officers (ERO)', i + 10)
    seg = h[j if j > 0 else i:]
    rows = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', seg, re.S | re.I):
        cells = [re.sub(r'\s+', ' ', _html.unescape(re.sub('<[^>]+>', '', c))).strip()
                 for c in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S | re.I)]
        if len(cells) >= 2:
            m = re.match(r'^(\d+)\s*-\s*(.+)$', cells[1])
            if m:
                name, res = _split_res(m.group(2))
                rows.append({'ac_no': int(m.group(1)), 'name': name, 'reserved': res,
                             'district': cells[0], 'sub': cells[3] if len(cells) > 3 else '', 'page': 'ERO table'})
        if rows and len(rows) >= 60 and rows[-1]['ac_no'] == 60:
            break
    # keep first occurrence of each AC (the page also has an AERO table further down)
    seen, out = set(), []
    for r in rows:
        if r['ac_no'] not in seen:
            seen.add(r['ac_no'])
            out.append(r)
    return out


# --------------------------------------------------------------------------- Nagaland
NL_FILES = ['1. Dimapur', '2. Peren', '3. Kohima', '4. Pughoboto', '5. Phek', '6. Mokokchung', '7. Zunheboto',
            '8. Wokha', '9. Mon', '10. Longleng', '11. Tuensang', '12. Kiphire', '13. Noklak', '14. Tseminyu',
            '15. Chumoukedima', '16. Shamator']


def parse_nagaland_ceo_ps():
    """CEO Nagaland 'Assembly Constituencies and Polling Stations': one PDF per election district.
    Each AC block starts 'List of Polling Stations for N - NAME Assembly Constituency ...'.
    Returns (rows, anomalies). An AC header found in a file other than its own district file is
    recorded as an anomaly and the district file that contains ONLY its own ACs is used."""
    found = []
    for f in NL_FILES:
        dist = f.split('. ', 1)[1]
        doc = fitz.open(os.path.join(RAW, 'nagaland_ceo_ps', f + '.pdf'))
        for pno in range(doc.page_count):
            t = ' '.join(doc[pno].get_text().split())
            for m in re.finditer(r'List of Polling Stations for\s*(\d+)\s*[-–]?\s*(.*?)\s*(?:A/C\s*)?Assembly', t, re.I):
                found.append({'ac_no': int(m.group(1)), 'name': m.group(2).strip(), 'district': dist,
                              'file': f + '.pdf', 'page': pno + 1})
    by_ac = {}
    for r in found:
        by_ac.setdefault(r['ac_no'], []).append(r)
    rows, anomalies = [], []
    for ac in sorted(by_ac):
        cands = by_ac[ac]
        if len(cands) == 1:
            pick = cands[0]
        else:
            # The Zunheboto file carries 9 extra pages (pp.11-19) that repeat ACs 49-58 of other districts;
            # prefer the occurrence that is NOT in that appended block.
            non_z = [c for c in cands if not (c['file'].startswith('7. Zunheboto') and c['page'] >= 11)]
            pick = non_z[0] if len(non_z) == 1 else cands[0]
            anomalies.append((ac, [(c['file'], c['page'], c['name']) for c in cands], pick['file']))
        name, res = _split_res(pick['name'].title())
        nm = re.sub(r'\s*-\s*', '-', name)
        nm = re.sub(r'-(I{1,3})$', lambda mm: '-' + mm.group(1).upper(), nm, flags=re.I)
        rows.append({'ac_no': ac, 'name': nm,
                     'reserved': res, 'district': pick['district'], 'sub': '', 'page': pick['page'],
                     'file': pick['file']})
    return rows, anomalies


# --------------------------------------------------------------------------- Jharkhand
def parse_jharkhand_ceo_acpc():
    """CEO Jharkhand 'AC & PC LIST - JHARKHAND' (ACPCList.html), district-wise half of the table."""
    h = open(os.path.join(RAW, 'jharkhand_ceo_acpclist.html'), encoding='utf-8', errors='ignore').read()
    rows = []
    dist = None
    division = None
    pc_side = {}
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', h, re.S | re.I):
        cells = [re.sub(r'\s+', ' ', _html.unescape(re.sub('<[^>]+>', '', c))).strip()
                 for c in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S | re.I)]
        # locate the district-wise AC cell: 'N-Name' followed by a numeric parts count
        idx = None
        for k in range(len(cells) - 1):
            if re.match(r'^\d+\s*-\s*\S', cells[k]) and re.match(r'^\d+$', cells[k + 1]):
                idx = k
                break
        if idx is None:
            continue
        before = [c for c in cells[:idx] if re.match(r'^\d+\s*-\s*\S', c)]
        if len(before) == 2:
            division, dist = before
        elif len(before) == 1:
            dist = before[0]
        m = re.match(r'^(\d+)\s*-\s*(.+)$', cells[idx])
        name, res = _split_res(m.group(2))
        # PC-side AC cell = last cell of the row
        mp = re.match(r'^(\d+)\s*-\s*(.+)$', cells[-1])
        if mp and cells[-1] != cells[idx]:
            pn, pr = _split_res(mp.group(2))
            pc_side[int(mp.group(1))] = pn
        rows.append({'ac_no': int(m.group(1)), 'name': name, 'reserved': res,
                     'district': re.sub(r'^\d+\s*-\s*', '', dist).strip(),
                     'sub': re.sub(r'^\d+\s*-\s*', '', division or '').strip(), 'page': 'district-wise table'})
    for r in rows:
        r['pc_side_name'] = pc_side.get(r['ac_no'], '')
    return rows


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    a = parse_assam_ceo_2021()
    print('ASSAM', len(a))
    for r in sorted(a, key=lambda r: r['ac_no']):
        print(r['ac_no'], r['name'], r['reserved'], '|', r['district'], '|', r['sub'], '| p', r['page'])
    m = parse_manipur_ceo_eros()
    print('MANIPUR', len(m))
    for r in m:
        print(r['ac_no'], r['name'], r['reserved'], '|', r['district'], '|', r['sub'])
    n, an = parse_nagaland_ceo_ps()
    print('NAGALAND', len(n), 'anomalies', an)
    for r in n:
        print(r['ac_no'], r['name'], r['reserved'], '|', r['district'], '|', r['file'], r['page'])
    j = parse_jharkhand_ceo_acpc()
    print('JHARKHAND', len(j))
    for r in j:
        print(r['ac_no'], r['name'], r['reserved'], '|', r['district'], '|', r['sub'], '| pc-side:', r['pc_side_name'])
