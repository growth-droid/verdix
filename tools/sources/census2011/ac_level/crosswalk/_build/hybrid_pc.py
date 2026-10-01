import pandas as pd
from build_crosswalk import *
pd.set_option('display.max_rows',500); pd.set_option('display.width',250)
d, seg = load_app(); fr = build_frames(d, seg)
R = pd.read_csv(OUT+'lgd_ac_to_eci.csv', dtype=str)
out=[]
for s, newid in [('Assam','2023-Assam'),('Jammu & Kashmir','2022-JK')]:
    new = [f for f in fr[s] if f['id']==newid][0]['seats']
    pk = {}
    for r in new.itertuples():
        for n in r.names: pk.setdefault(pkey(n), r)
    for r in R[R.state==s].itertuples():
        nr = pk.get(pkey(r.lgd_ac_name))
        old_ok = r.pc_check=='agrees'
        new_pc = nr.app_pc_name if nr is not None else None
        new_ok = (sim(r.lgd_pc_name, new_pc) >= 0.8) if new_pc else None
        out.append(dict(state=s, lgd_ac_code=r.lgd_ac_code, lgd_ac_name=r.lgd_ac_name, lgd_pc_name=r.lgd_pc_name,
                        old_map_pc=r.app_pc_name, lgd_pc_matches_old_map=old_ok,
                        newer_map_same_name_seat=(nr.app_name if nr is not None else None), newer_map_pc=new_pc,
                        lgd_pc_matches_newer_map=new_ok))
H = pd.DataFrame(out)
H.to_csv(OUT+'hybrid_pc_grouping_assam_jk.csv', index=False)
for s,g in H.groupby('state'):
    print(s, len(g), 'old-map PC agrees', int(g.lgd_pc_matches_old_map.sum()),
          '| has same-name seat in newer map', int(g.newer_map_same_name_seat.notna().sum()),
          'of which LGD PC agrees with newer map', int((g.lgd_pc_matches_newer_map==True).sum()))
    x=g[(g.lgd_pc_matches_old_map==False)]
    print(x[['lgd_ac_name','lgd_pc_name','old_map_pc','newer_map_same_name_seat','newer_map_pc','lgd_pc_matches_newer_map']].to_string())
