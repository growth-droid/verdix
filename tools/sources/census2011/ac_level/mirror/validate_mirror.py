"""Provenance + accuracy checks for the LGD mirror (ramSeraph/opendata, release 'lgd-latest', files dated 29Sep2026).

Writes validation.csv (this folder) and evidence/ (small text extracts of the pages the checks rely on).
Inputs live in the session scratchpad (see PROVENANCE.md for every path + sha256):
  OPT/lgd/*.29Sep2026.csv(.7z), OPT/lgd/rel_latest.json   - mirror files + GitHub release metadata
  OPT/web/lgd_home.html, MV/lgd_home_now.html            - official LGD home page (statistics block, no CAPTCHA)
  OPT/lgd/off_rpt*.html, OPT/lgd/downloadDirectory.html  - official LGD report forms (state dropdowns only; reports are CAPTCHA-gated)
  OPT/work/india_village_level.parquet, india_town_level.parquet - Census 2011 PCA (parsed from the official xlsx; re-verified here)
  OPT/order_parse/*.csv + MV/order_check_*.csv           - Delimitation Order 2008 checks produced by order_check.py
Run:  python order_check.py ; python order_check.py all ; python validate_mirror.py
Only plain reads of local files happen here; nothing is fetched.
"""
import os, re, json, html, hashlib, subprocess, tempfile, glob, difflib, shutil
import pandas as pd, numpy as np

SP = r'C:/Users/minds/AppData/Local/Temp/claude/C--Users-minds-OneDrive-Desktop-Data-Project/b4ee2c9a-d22a-44f3-9d75-56cb29e4f656/scratchpad'
OPT = SP + '/census/option2'
MV = os.environ.get('MIRROR_WORK', SP + '/mirror_verify')
HERE = os.path.dirname(os.path.abspath(__file__))
EVID = os.path.join(HERE, 'evidence'); os.makedirs(EVID, exist_ok=True)
L = OPT + '/lgd/'
TAG = '29Sep2026'
FILES = ['assembly_constituencies', 'constituencies_mapping_urban', 'constituency_coverage', 'districts',
         'invalidated_census_villages', 'parliament_constituencies', 'states', 'statewise_ulbs_coverage',
         'subdistricts', 'urban_local_bodies', 'urban_local_body_wards', 'villages']
rows = []
def add(sec, check, compared, expected, observed, result, note=''):
    rows.append(dict(id=f'{sec}{sum(1 for r in rows if r["section"] == sec) + 1:02d}', section=sec, check=check,
                     compared_against=compared, expected=expected, observed=observed, result=result, note=note))
def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()
def page_text(p):
    t = open(p, encoding='utf-8', errors='replace').read()
    t = re.sub(r'(?s)<script.*?</script>|<style.*?</style>', ' ', t)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t))).strip()
rd = lambda f: pd.read_csv(f'{L}{f}.{TAG}.csv', dtype=str, keep_default_na=False)

# ============ P: provenance / file integrity ============
rel = json.load(open(L + 'rel_latest.json', encoding='utf-8'))
assets = {a['name']: a for a in rel['assets']}
seven = r'C:/Program Files/7-Zip/7z.exe'
tmp = tempfile.mkdtemp(dir=MV) if os.path.exists(seven) else None
keep = []
for f in FILES:
    a = assets.get(f'{f}.{TAG}.csv.7z')
    z = f'{L}{f}.{TAG}.csv.7z'; c = f'{L}{f}.{TAG}.csv'
    zs = sha(z); cs = sha(c)
    gh = (a or {}).get('digest', '').replace('sha256:', '')
    inner = ''
    if tmp:
        subprocess.run([seven, 'x', '-y', f'-o{tmp}', z], capture_output=True)
        inner = sha(os.path.join(tmp, f'{f}.{TAG}.csv'))
    ok = (zs == gh) and (not tmp or inner == cs)
    add('P', f'{f}.{TAG}.csv.7z sha256 = GitHub release asset digest; CSV = archive content',
        'GitHub API release asset digest (lgd-latest)', gh, f'7z {zs}; csv {cs}' + ('; csv inside 7z identical' if inner == cs else ''),
        'PASS' if ok else 'FAIL', f"size {os.path.getsize(z)} B; asset uploaded {a['created_at'] if a else '?'}; {a['browser_download_url'] if a else ''}")
    keep.append(dict(name=a['name'], size=a['size'], digest=a['digest'], created_at=a['created_at'],
                     browser_download_url=a['browser_download_url']) if a else {'name': f, 'missing': True})
if tmp: shutil.rmtree(tmp, ignore_errors=True)
json.dump(dict(release=rel['html_url'], tag=rel['tag_name'], name=rel['name'], release_published_at=rel['published_at'],
               release_updated_at=rel['updated_at'], assets_used=keep), open(os.path.join(EVID, 'github_release_lgd-latest_assets_used.json'), 'w'), indent=1)
same_readme = os.path.exists(MV + '/readme_lgd.md') and open(MV + '/readme_lgd.md', 'rb').read() == open(L + 'README.md', 'rb').read()
add('P', 'saved lgd/README.md is the repo file ramSeraph/opendata master:lgd/README.md', 'raw.githubusercontent.com fetch 2026-10-01',
    'identical', 'identical' if same_readme else 'differs/missing', 'PASS' if same_readme else 'FLAG',
    'README states the scraper "Uses google tesseract to break the captchas" on lgdirectory.gov.in')

# ============ O: official LGD content viewable without a CAPTCHA ============
def stats(p):
    t = open(p, encoding='utf-8', errors='replace').read()
    seg = t[t.find('id="StatisticalSummary"'):][:8000]
    pairs = re.findall(r'<div class="col-8">\s*([^<]+?)\s*</div>\s*<div class="col-4">\s*(\d+)\s*</div>', seg)
    return {re.sub(r'\s+', ' ', k).strip(): int(v) for k, v in pairs}
s29 = stats(OPT + '/web/lgd_home.html')
s01 = stats(MV + '/lgd_home_now.html') if os.path.exists(MV + '/lgd_home_now.html') else {}
for nm, d in [('2026-09-29', s29), ('2026-10-01', s01)]:
    with open(os.path.join(EVID, f'lgd_home_statistics_{nm}.txt'), 'w', encoding='utf-8') as fh:
        fh.write(f'Source: https://lgdirectory.gov.in/ (home page, block "Statistical/Analytical Summary"), saved {nm}\n')
        for k, v in d.items(): fh.write(f'{k}\t{v}\n')
st, dist, sdist, vil, ulb = rd('states'), rd('districts'), rd('subdistricts'), rd('villages'), rd('urban_local_bodies')
cc_raw = rd('constituency_coverage'); mu = rd('constituencies_mapping_urban'); acl = rd('assembly_constituencies'); pcl = rd('parliament_constituencies')
ward = rd('urban_local_body_wards'); inv = rd('invalidated_census_villages')
vs = vil['Village Status'].value_counts()
A = set(cc_raw['Assembly Constituency Code']) | set(mu['Assembly Constituency Code']) | set(acl['Assembly Constituency Code']); A -= {'0', ''}
P = (set(cc_raw['Parliament Constituency Code']) | set(mu['Parliament Constituency code']) | set(acl['Parliament Constituency Code'])
     | set(pcl['Parliament Constituency Code'])); P -= {'0', ''}
comp = [('No. of States/Union Territories (UTs)', len(st), 'states.csv rows'),
        ('No. of Districts', len(dist), 'districts.csv rows'),
        ('No. of Sub-Districts', len(sdist), 'subdistricts.csv rows'),
        ('No. of Villages', len(vil), 'villages.csv rows'),
        ('No. of Inhabited Village', int(vs.get('Inhabitant', 0)), "villages.csv Village Status = Inhabitant"),
        ('No. of Un-inhabited Villages', int(vs.get('Un-Inhabitant', 0)), "villages.csv Village Status = Un-Inhabitant"),
        ('No. of Forest Villages', int(vs.get('Forest', 0)), "villages.csv Village Status = Forest"),
        ('No. of Urban Local Bodies', len(ulb), 'urban_local_bodies.csv rows'),
        ('No. of Assembly Constituencies', len(A), 'distinct AC codes across constituency_coverage + constituencies_mapping_urban + assembly_constituencies'),
        ('No. of Parliament Constituencies', len(P), 'distinct PC codes across the four constituency files')]
for k, mine, how in comp:
    off = s29.get(k); now = s01.get(k)
    add('O', f'LGD home-page count "{k}" vs mirror ({how})', 'lgdirectory.gov.in home page, saved 2026-09-29 19:10 IST (same day as the 29Sep2026 scrape)',
        off, mine, 'PASS' if off == mine else 'FAIL', f'home page on 2026-10-01: {now}' + (' (changed since snapshot)' if now is not None and now != off else ''))
# verifier fix 2026-10-01: exclude the blank code (UT rows + the report-footer timestamp row), and do not tell the
# build to drop this file - 77 ACs (all 70 of Delhi + 7 urban ACs) exist ONLY here (see O17).
ac_only = acl.loc[acl['Assembly Constituency Code'] != '', 'Assembly Constituency Code'].nunique()
add('O', 'assembly_constituencies.csv alone vs LGD AC count', 'LGD home page', s29.get('No. of Assembly Constituencies'), ac_only, 'FLAG',
    f"file is incomplete: Andhra Pradesh has {acl[acl['State Code'] == '28']['Assembly Constituency Code'].nunique()} of 175 ACs; the 79 missing AP ACs are present in constituency_coverage.csv. "
    "Take AC identities from the UNION of constituency_coverage + constituencies_mapping_urban + this file (4,116); the first two alone give only 4,039 (O17). "
    "The file's last row is a report-footer timestamp, not data.")
add('O', 'parliament_constituencies.csv alone vs LGD PC count', 'LGD home page', s29.get('No. of Parliament Constituencies'), pcl['Parliament Constituency Code'].nunique(), 'FLAG',
    'file lists 463 PCs, all with blank AC columns; the union of the four constituency files gives all 543')
vc = vil['Village Category'].str.capitalize().value_counts()
add('O', 'LGD home-page Villages (Rural)/(Urban) vs villages.csv Village Category', 'LGD home page',
    f"Rural {s29.get('No. of Villages (Rural)')}, Urban {s29.get('No. of Villages (Urban)')}",
    f"Rural {vc.get('Rural', 0)}, Urban {vc.get('Urban', 0)}, Both {vc.get('Both', 0)}, Unmapped {vc.get('Unmapped', 0)}", 'INFO',
    'not reconcilable: the home page uses a definition the export does not expose (Both/Unmapped). Not used for accuracy.')
ms = dict(zip(st['State Code'], st['State Name (In English)'].str.lower()))
for f, label in [(OPT + '/lgd/off_rptMappedGPNWardforPCAC.do.html', 'Report on PC/AC wise mapped Landregion/LocalBodies/Ward (rptMappedGPNWardforPCAC.do)'),
                 (OPT + '/lgd/off_rptMappedListAcPcLandRegion.do.html', 'rptMappedListAcPcLandRegion.do'),
                 (OPT + '/lgd/downloadDirectory.html', 'Download Directory (downloadDirectory.do)')]:
    t = open(f, encoding='utf-8', errors='replace').read()
    gated = bool(re.search(r'(?i)captchaAnswer|captcha_answer', t))
    for sid, body in re.findall(r'(?s)<select[^>]*id="([^"]+)"[^>]*>(.*?)</select>', t):
        opts = [(v, n) for v, n in re.findall(r'<option[^>]*value="?([^" >]*)"?[^>]*>\s*([^<]*?)\s*</option>', body) if v not in ('', '0', '-1')]
        if len(opts) == 36 and all(v.isdigit() for v, _ in opts):
            ok = sum(ms.get(v) == n.lower() for v, n in opts)
            add('O', f'state list (code + name) in official form {label}, select #{sid}', 'official LGD page (form only)', '36 of 36 agree', f'{ok} of 36 agree',
                'PASS' if ok == 36 else 'FAIL', 'the report itself sits behind a CAPTCHA (form field captchaAnswer); only the dropdown is comparable' if gated else '')
            break
# verifier additions 2026-10-01: ACs that carry no coverage at all, and the J&K AC set
CM = (set(cc_raw['Assembly Constituency Code']) | set(mu['Assembly Constituency Code'])) - {'0', ''}
only_acl = acl[acl['Assembly Constituency Code'].isin(A - CM)]
add('O', 'ACs with NO coverage rows (in neither constituency_coverage nor constituencies_mapping_urban)', 'LGD AC count 4,116',
    0, f"{len(A - CM)} (constituency_coverage + mapping_urban give {len(CM):,} ACs)", 'FAIL',
    'only in assembly_constituencies.csv, so LGD cannot place any land in them: ' + json.dumps(only_acl['State Name'].value_counts().to_dict())
    + '; non-Delhi: ' + ', '.join(only_acl[only_acl['State Name'] != 'Delhi']['Assembly Constituency Name'])
    + '. Delhi (70 ACs) has no AC mapping in LGD at all and needs another source.')
jk = {a for a, s in zip(acl['Assembly Constituency Code'], acl['State Name']) if s == 'Jammu And Kashmir'} | \
     {a for a, s in zip(cc_raw['Assembly Constituency Code'], cc_raw['State Name']) if s == 'Jammu And Kashmir'}
jk -= {'0', ''}
add('O', 'Jammu & Kashmir AC set vs the 2022 delimitation (90 ACs)', 'J&K Delimitation Commission order 2022', 90, len(jk), 'FLAG',
    'LGD is mostly the pre-2022 (1995-order) set: 11 names exist only before 2022 (Amira kadal, Batmaloo, Bijbehara, Darhal, Gool Arnas, Hom Shali Bugh, '
    'Kala kote, Noorabad, Sangrama, Shangus, Wachi), 3 only in 2022 (JAMMU NORTH, RS Pura South, Bahu), and 16 of the 90 ACs of 2022 are absent '
    '(e.g. Trehgam, Lal Chowk, Padder-Nagseni, Shri Mata Vaishno Devi; checked against ../../ac_district_lists/jk_2022_ac_district.csv). '
    'Do not use LGD for J&K 2024 ACs.')

# ============ I: internal consistency of the mirror ============
key = [c for c in cc_raw.columns if c != 'S.No.']
dups = int(cc_raw.duplicated(key).sum())
add('I', 'constituency_coverage exact duplicate rows (all columns except S.No.)', 'itself', 0, dups, 'INFO', 'harmless; drop before use')
cc = cc_raw.drop_duplicates(key)
masters = {'Village': set(vil['Village Code']), 'SubDistrict': set(sdist['Sub-district Code']), 'District': set(dist['District Code']),
           'Localbody': set(ulb['Local Body Code']), 'Ward': set(ward['Ward Code'])}
for et, sset in masters.items():
    x = cc[cc['Entity Type'] == et]; found = int(x['Entity Code'].isin(sset).sum())
    add('I', f'constituency_coverage {et} codes exist in the {et} master file', 'mirror master files', len(x), found,
        'PASS' if found == len(x) else ('FLAG' if found / len(x) > 0.98 else 'FAIL'),
        '' if found == len(x) else f"{len(x) - found} rows missing: " + json.dumps(x[~x['Entity Code'].isin(sset)]['State Name'].value_counts().head(5).to_dict()))
c0 = cc[cc['Assembly Constituency Code'] != '0']
# verifier fix 2026-10-01: Puducherry HAS an assembly, so its AC-0 rows are unassigned wards, not a PASS
z0 = cc[cc['Assembly Constituency Code'] == '0']['State Name'].value_counts().to_dict()
add('I', "rows with Assembly Constituency Code '0'", 'itself', 'only UTs without an assembly (A&N, Ladakh, Lakshadweep, DNHDD)', int((cc['Assembly Constituency Code'] == '0').sum()),
    'FLAG' if 'Puducherry' in z0 else 'PASS', json.dumps(z0) + ('; Puducherry has a 30-seat assembly: its AC-0 rows are 2 local bodies + 37 wards that LGD assigns to the PC but to no AC' if 'Puducherry' in z0 else ''))
n_names = c0.groupby('Assembly Constituency Code')['Assembly Constituency Name'].nunique().max()
n_pc = c0.groupby('Assembly Constituency Code')['Parliament Constituency Code'].nunique().max()
add('I', 'each AC code has one name and sits under one PC', 'itself', '1 and 1', f'{n_names} and {n_pc}', 'PASS' if n_names == 1 and n_pc == 1 else 'FAIL')
sfull = c0[(c0['Entity Type'] == 'SubDistrict') & (c0['Coverage Type'] == 'Fully Covered')]
m1 = int((sfull.groupby('Entity Code')['Assembly Constituency Code'].nunique() > 1).sum())
vr = c0[c0['Entity Type'] == 'Village']
m2 = int((vr.groupby('Entity Code')['Assembly Constituency Code'].nunique() > 1).sum())
add('I', "a sub-district 'Fully Covered' by two different ACs", 'itself', 0, m1, 'PASS' if m1 == 0 else 'FAIL')
add('I', 'a village listed under two different ACs', 'itself', 0, m2, 'PASS' if m2 == 0 else 'FAIL')
vv = vr.merge(vil[['Village Code', 'Sub-District Code', 'Census 2011 Code']], left_on='Entity Code', right_on='Village Code')
x = vv.merge(sfull[['Entity Code', 'Assembly Constituency Code']].rename(columns={'Entity Code': 'Sub-District Code', 'Assembly Constituency Code': 'ac_sd'}), on='Sub-District Code')
conf = x[x.ac_sd != x['Assembly Constituency Code']]
add('I', "village listed under AC X while its sub-district is 'Fully Covered' by a different AC Y", 'itself', 0,
    int(conf['Village Code'].nunique()), 'FAIL',
    f"{conf['Sub-District Code'].nunique()} sub-districts; by state {json.dumps(conf['State Name'].value_counts().head(8).to_dict())}. "
    "Sampled cases (e.g. Seoni/Kurai/Seoni Nagar tehsils 'Fully Covered' by Balaghat AC; Order 2008 puts them in Seoni/Barghat) show the Fully-Covered "
    "sub-district row is the wrong one, so explicit Village rows must win over a Fully-Covered sub-district in the build.")
m = mu[mu['Assembly Constituency Code'] != '0'][['State Code', 'Assembly Constituency Code', 'Assembly Constituency ECI Code', 'Assembly Constituency Name']].drop_duplicates()
d = m[m.duplicated(['State Code', 'Assembly Constituency ECI Code'], keep=False)]
add('I', 'ECI AC number unique within a state (constituencies_mapping_urban)', 'itself', 0, int(len(d) / 2) if len(d) else 0,
    'FLAG' if len(d) else 'PASS', '; '.join(f"state {r['State Code']} ECI {r['Assembly Constituency ECI Code']} {r['Assembly Constituency Name']}" for _, r in d.iterrows()))
add('I', 'State Code formatting in LGD files', 'itself', 'Census-style 2-digit codes', "LGD codes, not zero-padded ('8' = Rajasthan); LGD codes differ from Census codes for 1-38",
    'INFO', 'join on states.csv "Census 2011 Code" (zfill 2), never on the LGD State Code')

# ============ C: independent official source - Census 2011 PCA (village & town directory) ============
vm = [json.loads(l) for l in open(OPT + '/bpf/manifest.jsonl')]
vx = [r for r in vm if r['filename'] == '2011-IndiaStateDistSbDistVill-0000.xlsx'][0]
cen = pd.read_parquet(OPT + '/work/india_village_level.parquet')
tot = {lv: pd.to_numeric(cen[(cen.Level == lv) & (cen.TRU == 'Total')].TOT_P).sum() for lv in ['STATE']}
rural = pd.to_numeric(cen[cen.Level == 'VILLAGE'].TOT_P).sum()
xs = sha(OPT + '/bpf/' + vx['filename'])
add('C', 'Census village PCA file = official download; parse ties to the national totals', vx['download_url'],
    f"sha256 {vx['sha256']}; India 1,210,854,977; rural 833,748,852", f"sha256 {xs}; states sum {tot['STATE']:,}; village rows sum {rural:,}",
    'PASS' if xs == vx['sha256'] and tot['STATE'] == 1210854977 and rural == 833748852 else 'FAIL',
    '19,436 village rows streamed straight from the xlsx matched the parquet on code, name and TOT_P (2026-10-01)')
cv = cen[cen.Level == 'VILLAGE'].copy(); cv['code'] = cv['Town/Village'].str.zfill(6); cv['P'] = pd.to_numeric(cv.TOT_P)
v2 = vil.copy(); v2['c11'] = np.where(v2['Census 2011 Code'].isin(['', '0']), '', v2['Census 2011 Code'].str.zfill(6))
withc = v2[v2.c11 != '']
cset = set(cv.code); lset = set(withc.c11)
add('C', 'LGD villages carrying a Census 2011 village code', 'Census 2011 village PCA', f'{len(cv):,} Census villages',
    f"{len(withc):,} LGD villages with a code ({withc.c11.nunique():,} distinct)", 'INFO', f"{len(v2) - len(withc):,} LGD villages have code 0 (post-2011 villages)")
found = cv.code.isin(lset)
add('C', 'Census 2011 villages found in LGD by code', 'Census 2011 village PCA', f'{len(cv):,} villages / {rural:,} people',
    f"{int(found.sum()):,} villages ({found.mean():.2%}); {cv.loc[found, 'P'].sum():,} people ({cv.loc[found, 'P'].sum() / rural:.2%})", 'PASS')
miss = cv[~found]; invs = set(inv['Census Code 2011'].str.zfill(6))
add('C', "Census villages missing from LGD are on LGD's own 'invalidated census villages' list", 'LGD invalidated_census_villages.csv',
    f'{len(miss):,}', f'{int(miss.code.isin(invs).sum()):,}', 'PASS' if miss.code.isin(invs).mean() > 0.99 else 'FLAG',
    f'population of the missing villages {miss.P.sum():,} ({miss.P.sum() / rural:.2%} of rural)')
nf = withc[~withc.c11.isin(cset)]
add('C', 'LGD Census-2011 codes that are not Census 2011 village codes', 'Census 2011 village PCA', 0, f'{len(nf):,} ({len(nf) / len(withc):.2%})', 'FLAG',
    json.dumps(nf['State Name(In English)'].value_counts().head(6).to_dict()))
mm = withc.merge(cv.drop_duplicates('code', keep=False)[['code', 'Name', 'State', 'District', 'Subdistt']], left_on='c11', right_on='code')
nrm = lambda s: re.sub(r'[^a-z]', '', re.sub(r'\(.*?\)', '', str(s).lower()))
mm['a'] = mm['Village Name (In English)'].map(nrm); mm['b'] = mm['Name'].map(nrm)
mm['r'] = [1.0 if a == b else difflib.SequenceMatcher(None, a, b).ratio() for a, b in zip(mm.a, mm.b)]
add('C', 'village name agreement where LGD and Census share a code', 'Census 2011 village PCA', 'near 100% (spelling variants allowed)',
    f"exact {(mm.r == 1).mean():.2%}; similarity>=0.8 {(mm.r >= 0.8).mean():.2%}; <0.5 {(mm.r < 0.5).mean():.2%}", 'PASS', f'{len(mm):,} pairs')
dmap = dict(zip(dist['District Code'], dist['Census 2011 Code'].str.zfill(3)))
mm['d11'] = mm['District Code'].map(dmap); hd = mm.d11.notna() & (mm.d11 != '000')
add('C', "village's LGD district -> Census 2011 district code agrees with the village's Census district", 'Census 2011 village PCA', 'near 100%',
    f"{(mm.loc[hd, 'd11'] == mm.loc[hd, 'District']).mean():.3%} of {int(hd.sum()):,}", 'PASS', f'{(~hd).mean():.1%} of villages sit in post-2011 districts without a Census 2011 code')
smap = dict(zip(sdist['Sub-district Code'], sdist['Census 2011 Code'].str.zfill(5)))
mm['s11'] = mm['Sub-District Code'].map(smap); hs = mm.s11.notna() & (mm.s11 != '00000')
add('C', "village's LGD sub-district -> Census 2011 sub-district code agrees", 'Census 2011 village PCA', 'high',
    f"{(mm.loc[hs, 's11'] == mm.loc[hs, 'Subdistt']).mean():.3%} of {int(hs.sum()):,}", 'PASS', 'residual = villages moved between sub-districts since 2011')
tw = pd.read_parquet(OPT + '/work/india_town_level.parquet'); tw = tw[tw.Level == 'TOWN'].copy(); tw['code'] = tw['Town/Village'].str.zfill(6)
u2 = ulb[~ulb['Census 2011 Code'].isin(['', '0'])].copy(); u2['c11'] = u2['Census 2011 Code'].str.zfill(6)
um = u2.merge(tw.drop_duplicates('code')[['code', 'Name']], left_on='c11', right_on='code')
um['r'] = [difflib.SequenceMatcher(None, nrm(a), nrm(b)).ratio() for a, b in zip(um['Local Body Name (In English)'], um['Name'])]
add('C', 'urban local bodies: Census 2011 town code valid and name agrees', 'Census 2011 town PCA (2011-IndiaStateDistSbDistTwn-0000.xlsx)',
    f'{len(ulb):,} ULBs', f"{len(u2):,} carry a 2011 code; {u2.c11.isin(set(tw.code)).sum():,} valid ({u2.c11.isin(set(tw.code)).mean():.1%}); name similarity>=0.8 {(um.r >= 0.8).mean():.1%}",
    'PASS', 'low-similarity pairs are renamings (Cuddapah/Kadapa, GVMC/Visakhapatnam, Danapur/Dinapur Nizamat)')
# completeness of the village -> AC mapping, weighted by Census 2011 rural population
vrw = vr[['Entity Code', 'Assembly Constituency Code']].rename(columns={'Entity Code': 'Village Code', 'Assembly Constituency Code': 'ac_v'}).drop_duplicates('Village Code')
srw = sfull[['Entity Code', 'Assembly Constituency Code']].rename(columns={'Entity Code': 'Sub-District Code', 'Assembly Constituency Code': 'ac_s'}).drop_duplicates('Sub-District Code')
dfull = c0[(c0['Entity Type'] == 'District') & (c0['Coverage Type'] == 'Fully Covered')]
drw = dfull[['Entity Code', 'Assembly Constituency Code']].rename(columns={'Entity Code': 'District Code', 'Assembly Constituency Code': 'ac_d'}).drop_duplicates('District Code')
z = v2.merge(vrw, on='Village Code', how='left').merge(srw, on='Sub-District Code', how='left').merge(drw, on='District Code', how='left')
z['ac'] = z.ac_v.where(z.ac_v.notna(), z.ac_s.where(z.ac_s.notna(), z.ac_d))
z['conf'] = z.ac_v.notna() & z.ac_s.notna() & (z.ac_v != z.ac_s)
z = z[z.c11 != '']
g = z.groupby('c11').agg(nac=('ac', lambda s: s.dropna().nunique()), conf=('conf', 'any'))
# verifier fix 2026-10-01: 17 Census-2011 village codes appear twice (part-villages split across sub-districts);
# drop_duplicates('code') silently lost 72,069 people. Sum the parts instead.
cvu = cv.groupby('code', as_index=False)['P'].sum().merge(g, left_on='code', right_index=True, how='left')
T = cvu.P.sum()
def pct(mask): return f'{cvu.loc[mask, "P"].sum():,} ({cvu.loc[mask, "P"].sum() / T:.2%})'
add('C', 'Census 2011 rural population that the mirror places in exactly one AC', 'Census 2011 village PCA', 'all rural population',
    pct((cvu.nac == 1) & ~cvu.conf.fillna(False).astype(bool)), 'FLAG',
    f"village-vs-sub-district conflict {pct(cvu.conf.fillna(False).astype(bool))}; split 2011 village in >1 AC {pct(cvu.nac > 1)}; "
    f"in LGD but no AC {pct(cvu.nac == 0)}; 2011 code not in LGD {pct(cvu.nac.isna())}. Gaps cluster in whole tehsils: e.g. UP Behat, Lambhua, "
    "Bilhaur, Rudhauli, Menhdawal, Ghanghata, Nautanwa, Pharenda carry only urban wards; MP Sihora, Rehli tehsils unassigned.")

# ============ E: ECI AC numbers carried by LGD vs the Order's numbering ============
GEN = {('6', '42'): 'Dabwali is No. 43 in the Order (42 is Kalanwali)', ('27', '5'): 'Mehkar is No. 25 in Part A (the Order\'s own PC table misprints "5. Mehkar")',
       ('20', '41'): 'Baharagora is No. 44 in the Order (41 is Jharia)',
       ('19', '195'): 'Chanditala is No. 194 in the Order (195 is Jangipara)'}
# verifier fix 2026-10-01: ('22','65') "Durg-nagar" was listed here as a wrong number. It is not: LGD has a separate
# "Durg-city" carrying 64, and LGD's Durg PC has no "Bhilai Nagar", so "Durg-nagar" occupies slot 65 = Bhilai Nagar.
# The defect is its name and content, reported as its own FLAG row below.
code_of = {r['State Name (In English)'].replace(' ', '_'): r['State Code'] for _, r in st.iterrows()}
mu1 = mu[mu['Assembly Constituency Code'] != '0'].drop_duplicates('Assembly Constituency Code')
tot_e = ok_e = 0; non = []
for f in sorted(glob.glob(OPT + '/order_parse/order_ac_extents_*.csv')):
    s = f.split('extents_')[1][:-4]
    if s == 'Andhra_Pradesh': continue
    o = pd.read_csv(f); num = dict(zip(o.n.astype(str), o['name'].map(lambda q: nrm(re.sub(r'\((SC|ST)\)', '', str(q))))))
    for _, r in mu1[mu1['State Code'] == code_of[s]].iterrows():
        e = r['Assembly Constituency ECI Code']; k = nrm(r['Assembly Constituency Name']); tot_e += 1
        good = e in num and (num[e] == k or difflib.SequenceMatcher(None, num[e], k).ratio() >= 0.8)
        ok_e += good
        if not good: non.append((code_of[s], e, r['Assembly Constituency Name']))
gen = [n for n in non if (n[0], n[1]) in GEN]
add('E', 'LGD "Assembly Constituency ECI Code" = AC number in the Delimitation Order 2008 (15 states, ACs with urban rows)',
    'ECI Delimitation Order 2008 text (delim/eci_order_text.txt)', f'{tot_e}', f'{ok_e} agree automatically; {len(non)} need review; {len(gen)} confirmed wrong',
    'FLAG', 'the other non-agreements were reviewed: name spellings/renamings (Fatwah/Fatuha, Gulbarga->Kalaburagi, Bangalore->Bengaluru, Dehgam/Dahegam) '
    'or name-parse artefacts of the order_parse CSVs (Ahmedabad "(Part)" names, Bihar 168/169, Odisha 124/125/137)')
for n in gen:
    add('E', f'wrong ECI number: state {n[0]} AC "{n[2]}" carries {n[1]}', 'Delimitation Order 2008 text', 'Order number', n[1], 'FAIL', GEN[(n[0], n[1])])
add('E', 'state 22 AC "Durg-nagar" carries 65: number right, name and content wrong', 'Delimitation Order 2008 text l.8248-8278',
    '65 Bhilai Nagar = Bhilai Nagar (M Corp.) wards 17, 27-53, 56, 57', '65; name "Durg-nagar"; holds Bhilai Charoda (M) + Supela/Khursipar villages', 'FLAG',
    'LGD Durg PC has Durg-city (64) and Durg-nagar (65) but no Bhilai Nagar, so Durg-nagar is the Bhilai Nagar slot. Its content is wrong: Order puts Bhilai Charoda (M) '
    'in 67 Ahiwara, and LGD maps all 140 Bhilai (M Corp.) wards to 66 Vaishali Nagar although the Order splits them across 63, 65 and 66.')

# ============ D: Delimitation Order 2008 extent checks (order_check.py) ============
summ = pd.read_csv(MV + '/order_check_summary.csv')
A_ = pd.read_csv(MV + '/order_check_A.csv'); B_ = pd.read_csv(MV + '/order_check_B.csv')
REVIEW = {  # manual review of every non-OK sampled row against the raw Order text (line numbers refer to eci_order_text.txt)
    ('A', 'Maharashtra', 242, 'Dharashiv'): ('FAIL', 'Order l.19628-19634: Osmanabad tehsil RCs Bembli, Padoli, Ter -> 241 Tuljapur; RCs Dhoki, Osmanabad + MC -> 242. LGD gives the whole tehsil (Dharashiv = Census-2011 Osmanabad tehsil) to 242 and none to Tuljapur.'),
    ('A', 'West Bengal', 23, 'Jorebunglow Sukiapokhri'): ('FAIL', 'Order l.40779-40783: five GPs of this block (Gorabari Margaret\'s Hope, Lower Sonada-I/II, Munda Kothi, Upper Sonada) belong to 24 Kurseong; LGD gives the whole block to 23 Darjeeling.'),
    ('A', 'West Bengal', 237, 'Binpur - I'): ('FAIL', 'Order l.42075: CDB Binpur-I is in 222 Jhargram; 237 Binpur = CDB Binpur-II + CDB Jamboni. LGD gives Binpur-I to Binpur.'),
    ('A', 'Madhya Pradesh', 138, 'Pipariya'): ('FAIL', 'Order l.17436-17437: 139 Pipariya (SC) = Pipariya Tehsil + Bankhedi Tehsil. LGD gives Pipariya tehsil to 138 Sohagpur.'),
    ('A', 'Madhya Pradesh', 2, 'Beerpur'): ('PLAUSIBLE', 'post-2001 tehsil (no Census 2001 code) in Sheopur district, whose only ACs are Sheopur (Sheopur Tehsil) and Vijaypur (Vijaypur + Karahal); consistent with being carved from Vijaypur.'),
    ('A', 'Madhya Pradesh', 48, 'Maharajpur'): ('PLAUSIBLE', 'post-2001 tehsil; Order 48 = "Nowgaon Tehsil" whole; Maharajpur tehsil is carved from Nowgong.'),
    ('A', 'Madhya Pradesh', 223, 'Tal'): ('PLAUSIBLE', 'post-2001 tehsil; Order 223 Alot = Alot Tehsil + part of Jaora; Tal tehsil is carved from Alot.'),
    ('B', 'West Bengal', 66, 'khargram'): ('FAIL', 'Order l.41033-41034: 66 Khargram = CDB Khargram + GPs. LGD marks CDB Khargram Fully Covered by 58 Jangipur.'),
    ('B', 'Madhya Pradesh', 24, 'pohari'): ('FLAG', 'completeness: 18% of the tehsil\'s 2011 population has no AC in LGD; nothing wrongly assigned.'),
    ('B', 'Madhya Pradesh', 92, 'barhi'): ('FLAG', '7% of current Barhi tehsil is mapped to Barwara; plausible post-2008 tehsil boundary change.'),
    ('B', 'Madhya Pradesh', 102, 'sihora'): ('FAIL', 'completeness: 98% of Sihora tehsil\'s 2011 population is not mapped to any AC; LGD lists only Kundam tehsil under Sihora.'),
}
for _, r in summ.iterrows():
    add('D', f"{r.state}: Order extents re-extracted from raw text", 'eci_order_text.txt vs earlier coordinate parse (order_parse/*.csv)',
        f'{r.order_acs} ACs', f"{r.raw_extents_found} extracted; {r.raw_vs_parse_below_0_8} differ from the coordinate parse (similarity<0.8)", 'INFO',
        'every differing case inspected was a page-break mis-allocation in the coordinate parse; the raw re-extraction is used')
    add('D', f"{r.state}: A - LGD 'Fully Covered' sub-districts named in the AC's Order extent (20 seeded-random ACs)",
        'ECI Delimitation Order 2008', f'{r.A_rows} sub-district rows', f"named whole {r.A_named_whole}; named only '(Part)' {r.A_named_part}; not named {r.A_not_named} (of which post-2001 sub-districts {r.A_not_named_post2001})",
        'PASS' if r.A_named_part + r.A_not_named - r.A_not_named_post2001 == 0 else 'FLAG', 'non-OK rows reviewed one by one below (D-detail)')
    add('D', f"{r.state}: B - whole tehsils/blocks in the Order: share of their 2011 population LGD puts in the same AC (20 seeded-random ACs)",
        'ECI Delimitation Order 2008 + Census 2011 village population', f'{r.B_rows} units >=95%',
        f"OK {r.B_ok}; 80-95% {r.B_mostly}; <80% {r.B_mismatch}; unresolved {r.B_unresolved}", 'PASS' if r.B_mismatch == 0 else 'FLAG', 'non-OK rows reviewed below')
detail = []
for _, r in A_.iterrows():
    k = ('A', r.state, int(r.order_ac_no), r.lgd_subdistrict)
    res, note = REVIEW.get(k, ('PASS' if r.verdict == 'named whole' else 'REVIEW', ''))
    detail.append(dict(id='', section='D-detail', check=f"A {r.state} AC {int(r.order_ac_no)} {r.order_ac_name}: LGD Fully Covered sub-district '{r.lgd_subdistrict}'",
                       compared_against='Order 2008 extent: ' + str(r.order_extent)[:300], expected='named whole',
                       observed=r.verdict + (f" ({r.match} match via {r.matched_via})" if isinstance(r.match, str) and r.match else ''),
                       result=res, note=f"AC identity: {r.ac_identity}. {note}".strip()))
for _, r in B_.iterrows():
    k = ('B', r.state, int(r.order_ac_no), r.order_whole_unit)
    okv = str(r.verdict).startswith('OK')
    res, note = REVIEW.get(k, ('PASS' if okv else 'REVIEW', ''))
    detail.append(dict(id='', section='D-detail', check=f"B {r.state} AC {int(r.order_ac_no)} {r.order_ac_name}: Order names '{r.order_whole_unit}' whole",
                       compared_against='Order 2008 extent: ' + str(r.order_extent)[:300], expected='>=95% of the unit\'s 2011 population in this AC',
                       observed=f"{r.share_pop_lgd_same_ac if pd.notna(r.share_pop_lgd_same_ac) else ''} in AC; unassigned {r.share_pop_unassigned if pd.notna(r.share_pop_unassigned) else ''}; elsewhere: {r.lgd_other_acs if isinstance(r.lgd_other_acs, str) else '-'} [{r.verdict}]",
                       result=res, note=f"AC identity: {r.ac_identity if isinstance(r.ac_identity, str) else ''}. {note}".strip()))
# hand-verified findings outside the random samples
for chk, obs, note in [
    ('Manbazar (WB 243): CDB Manbazar-I', "LGD: 'Fully Covered' by Bandwan", 'Order l.42187: 243 MANBAZAR (ST) = CDB Manbazar-I, CDB Puncha + 3 GPs of Hura. Bandwan = Barabazar, Manbazar-II, Bandwan.'),
    ('Balaghat (MP 111): Seoni, Kurai, Seoni Nagar sub-districts', "LGD: 'Fully Covered' by Balaghat AC", 'Order l.17215-17217: 111 Balaghat = Kumhari & Bharweli patwari circles, Balaghat (M+OG), Lalbarra Tehsil. Seoni-district tehsils belong to Seoni/Barghat ACs (Balaghat PC).'),
    ('Deori (MP 38): Keshli/Kesli tehsil', "LGD: 'Fully Covered' by Rehli (39)", 'Order l.16748-16749: 38 Deori = Keshli Tehsil + Deori Tehsil.'),
]:
    detail.append(dict(id='', section='D-detail', check='spot finding (outside the samples, verified by hand): ' + chk, compared_against='ECI Delimitation Order 2008',
                       expected='as in the Order', observed=obs, result='FAIL', note=note))
sall = pd.read_csv(MV + '/order_check_summary_all.csv') if os.path.exists(MV + '/order_check_summary_all.csv') else None
if sall is not None:
    for _, r in sall.iterrows():
        bpart = (f"B: OK {r.B_ok}, 80-95% {r.B_mostly}, <80% {r.B_mismatch}, unresolved {r.B_unresolved} of {r.B_rows}" if r.B_rows else 'B: not run (Order unit convention not parsed)')
        add('S', f"{r.state}: all ACs, automated, NOT reviewed by hand", 'ECI Delimitation Order 2008',
            'see sampled states for reviewed rates', f"A: whole {r.A_named_whole}, Part {r.A_named_part}, not named {r.A_not_named} (post-2001 {r.A_not_named_post2001}) of {r.A_rows}; {bpart}",
            'INFO', 'upper bound on disagreement: includes name-matching misses, post-2001 sub-districts and homonyms')
for i, d in enumerate(detail, 1): d['id'] = f'DD{i:03d}'
out = pd.DataFrame(rows + detail)[['id', 'section', 'check', 'compared_against', 'expected', 'observed', 'result', 'note']]
# independent-verifier rows (2026-10-01), kept as a static file so a re-run of this script preserves them
VF = os.path.join(HERE, 'verifier_findings.csv')
if os.path.exists(VF):
    out = pd.concat([out, pd.read_csv(VF, dtype=str, keep_default_na=False)[out.columns]], ignore_index=True)
out.to_csv(os.path.join(HERE, 'validation.csv'), index=False, encoding='utf-8')
print(out.section.value_counts().to_dict()); print(out.result.value_counts().to_dict())

# ============ evidence extracts (text only, no session tokens) ============
for src, dst, lo, hi in [(OPT + '/web/lgd_copyRightPolicy.html', 'lgd_copyright_policy.txt', 'Copyright Policy Material', 'Close Site'),
                         (OPT + '/web/lgd_termsconditions.html', 'lgd_terms_and_conditions.txt', 'Terms and Conditions This', 'Close Site')]:
    t = page_text(src); a = t.find(lo); b = t.find(hi, a)
    open(os.path.join(EVID, dst), 'w', encoding='utf-8').write(f'Source: https://lgdirectory.gov.in/{os.path.basename(src)[4:].replace(".html", ".do")} saved 2026-09-29\n\n' + t[a:b].strip() + '\n')
for src, dst in [(MV + '/UNLICENSE.txt', 'ramSeraph_opendata_UNLICENSE.txt'), (MV + '/readme_lgd.md', 'ramSeraph_opendata_lgd_README.md'),
                 (MV + '/iom_DATA_LICENSE.md', 'ramSeraph_indianopenmaps_DATA_LICENSE.md')]:
    if os.path.exists(src): open(os.path.join(EVID, dst), 'wb').write(open(src, 'rb').read())
