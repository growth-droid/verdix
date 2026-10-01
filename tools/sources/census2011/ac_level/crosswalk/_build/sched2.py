import os, re, pandas as pd
from build_crosswalk import OPT2
# absolute paths (verifier fix 2026-10-01): the original read '../delim/eci_order_text.txt' relative to the
# working directory, so run_all.py failed when run from _build/ as its docstring says. finalize.py reads
# OPT2 + 'crosswalk/schedule2_assembly_seats.csv', so that is where the table is written (plus a copy here).
t = open(OPT2 + 'delim/eci_order_text.txt', encoding='utf-8', errors='ignore').read()
i = t.index('SCHEDULE II'); j = t.index('SCHEDULE - III')
seg = t[i:j]
seg = seg[seg.index('I. STATES'):]
toks = [x.strip() for x in seg.split('\n') if x.strip()]
rows=[]; name=[]; nums=[]
for x in toks:
    if re.fullmatch(r'\d+\.', x):
        continue
    if re.fullmatch(r'\d+|\.\.', x):
        nums.append(0 if x=='..' else int(x))
        if len(nums)==6:
            rows.append((' '.join(name), *nums)); name=[]; nums=[]
    else:
        if nums: nums=[]
        if x.startswith('II. UNION') or x.startswith('I. STATES'): continue
        name.append(x)
S = pd.DataFrame(rows, columns=['state','tot1976','sc1976','st1976','tot2008','sc2008','st2008'])
S['state']=S.state.str.replace(r'\s+',' ',regex=True).str.strip()
print(S.to_string())
os.makedirs(OPT2 + 'crosswalk', exist_ok=True)
S.to_csv(OPT2 + 'crosswalk/schedule2_assembly_seats.csv', index=False)
S.to_csv('schedule2_assembly_seats.csv', index=False)
