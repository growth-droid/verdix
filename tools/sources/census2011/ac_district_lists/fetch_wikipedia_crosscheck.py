#!/usr/bin/env python3
"""
Facts-only cross-check extracts from Wikipedia (CC BY-SA 4.0). Only four facts per AC are kept
(ac_no, name, district, Lok Sabha constituency) for comparison against the official orders; no prose is copied.
These files are NEVER the source of any value in the output CSVs - they only feed validation.csv.

Writes raw/wikipedia_crosscheck_jk.csv and raw/wikipedia_crosscheck_assam.csv (with page revision id).
Plain public GETs only (no login, no keys).
"""
import csv, io, json, os, urllib.request
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {'User-Agent': 'VerdixCensusResearch/1.0 (constituency cross-check; plain GET)'}
PAGES = {
    'jk': 'List_of_constituencies_of_the_Jammu_and_Kashmir_Legislative_Assembly',
    'assam': 'List_of_constituencies_of_the_Assam_Legislative_Assembly',
}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read().decode('utf-8')


def main():
    for key, title in PAGES.items():
        rev = json.loads(get('https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=ids|timestamp'
                             '&format=json&titles=' + title))
        page = next(iter(rev['query']['pages'].values()))
        revid, ts = page['revisions'][0]['revid'], page['revisions'][0]['timestamp']
        html = get('https://en.wikipedia.org/w/index.php?title=%s&action=render&oldid=%s' % (title, revid))
        tabs = pd.read_html(io.StringIO(html))
        if key == 'jk':
            t = tabs[0]
            t.columns = ['ac_no', 'name', 'district', 'pc', 'electors', 'x']
        else:  # first table whose columns include 'District(s)' = current (post-2023) list
            t = next(x for x in tabs if 'District(s)' in [str(c) for c in x.columns])
            t = t.rename(columns={'#': 'ac_no', 'Name': 'name', 'District(s)': 'district',
                                  'Lok Sabha constituency': 'pc'})
        t = t[pd.to_numeric(t['ac_no'], errors='coerce').notna()].copy()
        t['ac_no'] = t['ac_no'].astype(int)
        out = os.path.join(HERE, 'raw', 'wikipedia_crosscheck_%s.csv' % key)
        with open(out, 'w', newline='', encoding='utf-8') as f:
            f.write('# facts-only cross-check extract; source https://en.wikipedia.org/w/index.php?title=%s&oldid=%s '
                    '(revision %s); licence CC BY-SA 4.0; not used as a data source\n' % (title, revid, ts))
            t[['ac_no', 'name', 'district', 'pc']].to_csv(f, index=False)
        print(key, len(t), 'rows, revid', revid, ts)


if __name__ == '__main__':
    main()
