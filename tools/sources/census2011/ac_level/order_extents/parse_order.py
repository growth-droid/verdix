"""Coordinate-aware parser for the Delimitation of PCs & ACs Order, 2008 (official ECI PDF, text layer).
Splits Table/Part A of a state's schedule into one extent-description per AC and classifies it by the
smallest territorial unit it uses. Output: order_ac_extents_<state>.csv + summary."""
import fitz, re, sys, os, json, collections
PDF=os.path.join(os.path.dirname(__file__),'..','delim','DelimitationOrder2008_English_eci.pdf')
d=fitz.open(PDF)
def norm_dash(s): return s.replace('\u2013','-').replace('\u2014','-').replace('\ufffd','-')
def schedule_pages(roman):
    start=None
    for i in range(d.page_count):
        t=norm_dash(d[i].get_text())
        if re.search(r'SCHEDULE\s*-?\s*%s\s*\n'%roman,t): start=i; break
    end=start
    for j in range(start+1,d.page_count):
        t=norm_dash(d[j].get_text())
        if re.search(r'(PART|TABLE)\s*-?\s*B\b',t): end=j; break
    return start,end
NUMRE=re.compile(r'^\(?0?(\d{1,3})\)?\s*[\.\-]?\s*([A-Za-z].*)?$')
def parse(roman, expected):
    a,b=schedule_pages(roman)
    acs=[]; cur=None
    for pn in range(a,b+1):
        p=d[pn]; words=p.get_text('words')
        if pn==b:  # stop at PART/TABLE B heading
            cut=[w[1] for w in words if re.match(r'(PART|TABLE)$',w[4]) ]
            ymax=min(cut) if cut else 1e9
        else: ymax=1e9
        lines=collections.defaultdict(list)
        for w in words:
            if w[1]>=ymax: continue
            lines[round(w[1]/3)].append(w)
        xs=collections.Counter(round(min(w[0] for w in ws)) for ws in lines.values())
        left_margin=min(xs) if xs else 0
        # description column x = most common start among non-left lines
        cands=[x for x,c in xs.most_common() if x>left_margin+40]
        desc_x=cands[0] if cands else left_margin+100
        for k in sorted(lines):
            ws=sorted(lines[k],key=lambda w:w[0])
            txt=norm_dash(' '.join(w[4] for w in ws))
            if re.search(r'DISTRICT\s*:',txt) or re.match(r'^\d{1,3}$',txt.strip()) or 'Extent of' in txt or 'SCHEDULE' in txt or 'ASSEMBLY CONSTITUENCIES' in txt: continue
            left=[w for w in ws if w[0]<desc_x-8]; right=[w for w in ws if w[0]>=desc_x-8]
            ltxt=norm_dash(' '.join(w[4] for w in left)).strip()
            m=re.match(r'^0?(\d{1,3})\s*[\.\-]?\s*-?\s*(.*)$',ltxt)
            if left and m and m.group(2) and re.match(r'[A-Za-z]',m.group(2)):
                cur={'n':int(m.group(1)),'name':m.group(2).strip(),'extent':''}; acs.append(cur)
            elif left and cur is not None and ltxt and not re.match(r'^\d',ltxt):
                cur['name']+=' '+ltxt  # e.g. "(SC)" on next line
            if cur is not None and right:
                cur['extent']+=' '+norm_dash(' '.join(w[4] for w in right))
    # keep first occurrence of each AC number in sequence
    seen=set(); out=[]
    for r in acs:
        if r['n'] in seen: continue
        seen.add(r['n']); r['extent']=re.sub(r'\s+',' ',r['extent']).strip(); out.append(r)
    return out
PART=re.compile(r'\(Part\)|\(Partly\)|Partly|\bexcluding\b|\bExcept\b|\(Part ',re.I)
SUB=re.compile(r'Gram Panchayat|\bG\.?P\.?s?\b|\bGPs?\b|village|mouza|\bKCs?\b|\bPCs?\b|ILRC|Circle|hobli|Revenue Inspector|\bRI\b|Patwar|Kanungo|\bGPU\b|Panchayat|Saza|Halqa|Nyaya',re.I)
URB=re.compile(r'\bWard|\bE\.?\s?B\.?\s?No|Enumeration Block|Block No',re.I)
def classify(e):
    has_urb=bool(URB.search(e)); has_sub=bool(SUB.search(e)); has_part=bool(PART.search(e))
    if has_urb: return 'C_ward_or_EB_level'
    if has_sub: return 'B_sub_tehsil_units(GP/village/circle/KC/PC/mouza)'
    if has_part: return 'B2_part_unit_other'
    return 'A_whole_subdistricts_and_towns_only'
if __name__=='__main__':
    todo=json.loads(sys.argv[1])
    summ={}
    for st,(roman,exp) in todo.items():
        rows=parse(roman,exp)
        for r in rows: r['class']=classify(r['extent'])
        import pandas as pd
        df=pd.DataFrame(rows); df.to_csv(os.path.join(os.path.dirname(__file__),f'order_ac_extents_{st.replace(" ","_")}.csv'),index=False)
        c=df['class'].value_counts().to_dict()
        summ[st]={'parsed':len(df),'expected':exp,'numbers_1..N_complete':sorted(df.n.tolist())==list(range(1,exp+1)),**c}
        print(st,summ[st])
    json.dump(summ,open(os.path.join(os.path.dirname(__file__),'order_class_summary.json'),'w'),indent=1)
