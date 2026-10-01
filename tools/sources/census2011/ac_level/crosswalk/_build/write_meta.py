import json, shutil, os, hashlib
import pandas as pd
from build_crosswalk import OUT, OPT2

R = pd.read_csv(OUT + 'lgd_ac_to_eci.csv', dtype=str)
P = pd.read_csv(OUT + 'lgd_pc_to_eci.csv', dtype=str)
S = pd.read_csv(OUT + 'state_summary.csv', dtype=str)
H = pd.read_csv(OUT + 'hybrid_pc_grouping_assam_jk.csv', dtype=str)


def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


lgd_files = ['assembly_constituencies', 'constituency_coverage', 'constituencies_mapping_urban',
             'parliament_constituencies', 'states']
meta = {
    'what': 'Crosswalk from Local Government Directory (LGD) assembly/parliamentary constituency codes to the ECI '
            'constituency numbers used by the Verdix app (public/data/seats_ae.json, seats_ge.json, segments.json).',
    'built': '2026-10-01',
    'sources': {
        'lgd': {'publisher': 'Local Government Directory, Ministry of Panchayati Raj (lgdirectory.gov.in)',
                'copy_used': 'ramSeraph/opendata GitHub release "lgd-latest" (daily scrape of the LGD Download '
                             'Directory), files dated 29Sep2026. The official LGD download is CAPTCHA-gated, so '
                             'it was not fetched directly.',
                'files': {f + '.29Sep2026.csv': sha(OPT2 + 'lgd/' + f + '.29Sep2026.csv') for f in lgd_files},
                'terms': 'LGD copyright policy: free reproduction with accurate reproduction and source '
                         'acknowledgement.'},
        'app': ['public/data/seats_ae.json', 'public/data/segments.json', 'public/data/seats_ge.json'],
        'validation_only': ['ECI Delimitation of Parliamentary and Assembly Constituencies Order 2008 (gazette PDF, '
                            'Schedule II seat totals + per-AC names/reservation parsed for 15 states)'],
    },
    'method': [
        'LGD AC list = union of assembly_constituencies (4,037 ACs, but only 96 of 175 for Andhra Pradesh), '
        'constituency_coverage (adds the missing 79 AP ACs) and constituencies_mapping_urban (carries an '
        '"Assembly Constituency ECI Code" for 2,931 ACs). No AC code conflicts between the three files.',
        'Each LGD state is matched against every app "frame" (one delimitation\'s seat list); the frame with the '
        'most ECI-code + exact-name matches is the map LGD follows.',
        '1 eci_code: LGD ECI code -> app seat number (or app j for undivided-AP numbering 120-294), accepted only '
        'when the names agree (similarity >= 0.6, phonetic key equal, or same PC and similarity >= 0.45), and '
        'overruled when a DIFFERENT seat carries the LGD name (similarity >= 0.85) or when LGD gives the same code '
        'to two ACs.',
        '2 exact_name: normalised names equal (case, punctuation, (SC)/(ST) tags, North/Uttar/East/Purba etc. '
        'folded), unique on both sides; duplicate names in a state broken by PC.',
        '3 fuzzy: phonetic key equal (transliteration: th/t, w/v, y/i, oo/u, double letters; official renames '
        'such as Kalaburagi=Gulbarga, Belagavi=Belgaum, Burdwan=Bardhaman), else mutual-best similarity with a '
        'PC-agreement bonus.',
        '4 manual: 8 LGD ACs that carry a NEWER delimitation\'s name on an OLD-map slot (6 Assam, 2 J&K), each '
        'with a reason in the note column.',
        'Every pairing that is not an exact name or an ECI code with an identical name is listed in '
        'review_non_exact.csv.',
    ],
    'delimitation_values': {
        '2008': 'Delimitation Order 2008 map (all states except those below). App uses this map for every year.',
        '1976-deferred': 'Old (1976-order) map kept because delimitation was deferred: Arunachal Pradesh, '
                         'Manipur, Nagaland, Jharkhand (still current), and Assam (LGD; the app uses it for '
                         '2011-2021 only).',
        '1995-JK': 'Old J&K map (J&K Delimitation Order 1995, 87 seats incl. 4 Ladakh). Not in the task\'s list '
                   'of values, added because none of 2008 / 2022-JK fits: LGD J&K is this map. App uses it for '
                   '2014 only.',
        '2022-JK / 2023-Assam': 'Not followed by LGD for any AC.',
        'unknown': '9 ACs whose LGD label comes from the newer map (Assam: Bajali, Srijangram, Abhayapuri, '
                   'Bhowanipur Sorbhog, Birsing Jarua, Demow; J&K: Bahu, Jammu North, RS Pura South). They sit on '
                   'an old-map slot (LGD ECI code / elimination), but whether LGD also re-drew their villages is '
                   'not verified.',
        'n/a': 'Chandigarh LGD placeholder AC 273 (no legislative assembly).',
    },
    'lgd_map_not_app_map': {
        'Assam': 'LGD = old 126-seat map (1976-deferred) with 6 ACs relabelled to 2023 names, and 16 of 126 ACs '
                 'grouped under 2023-map PCs (e.g. Majuli under Jorhat, Chabua under Dibrugarh, Hojai/Lumding '
                 'under Kaziranga). App 2011/2016/2021 = this map (all 126 matched); app 2026 = 2023 delimitation, '
                 'which LGD does not have (only 1 ECI code + 74 exact names would match it, and many of those '
                 'names now cover different areas). LGD-based AC profiles therefore attach to Assam 2011-2021 '
                 'seats only.',
        'Jammu & Kashmir': 'LGD = old 1995 map without Ladakh (83 ACs), 3 Jammu-city ACs relabelled to 2022 names; '
                           '7 Kashmir ACs (Budgam, Beerwah, Tral, Pampore, Pulwama, Rajpora, Shopian) grouped '
                           'under 2022-map PCs. App 2014 = this map (83 matched); app 2024 = 2022 delimitation '
                           '(90 seats), which LGD does not have.',
        'Ladakh': 'LGD has no AC for Ladakh (UT without legislature), so the app\'s 2014 Ladakh seats '
                  '(47 Nubra, 48 Leh, 49 Kargil, 50 Zanskar) have no LGD AC.',
        'Sikkim': 'App seat 32 Sangha (monastic electorate, no territory) has no LGD AC - expected.',
    },
    'app_data_issues_found': {
        'reservation_r_field': 'The app r field is right for every 2008/1976-deferred state except Telangana '
                               '32 Husnabad (app SC, statute unreserved) and Madhya Pradesh 104 Dindori (app SC, '
                               'statute ST). It is wrong for Assam (app SC 16 / ST 32 in every year vs statute 8/16 '
                               'on the old map and 9/19 on the 2023 map) and J&K (2014: app SC 12 / ST 7 vs 7/0; '
                               '2024: app SC 12 / ST 9 vs 7/9). See reservation_totals_vs_statute.csv and '
                               'app_r_reliable in lgd_ac_to_eci.csv.',
        'continuity_j': 'For Assam and J&K the app j is the seat number of the map in force that year, so the same j '
                        'is a different seat in Assam 2026 / J&K 2024 than in the old-map years. The crosswalk\'s '
                        'app_j belongs to the old map (app_year_matched 2021 / 2014).',
        'old_assam_name_typos': 'App Assam 2011-2021 names GOSSALGAON (Gossaigaon), GAHPUR (Gohpur), MORIANI '
                                '(Mariani) - matched anyway via LGD ECI codes.',
    },
    'lgd_data_issues_found': {
        'eci_ac_codes': '7 of 2,931 LGD ECI AC codes are wrong (Dabwali/Kalanwali share 42; Chanditala given '
                        'Jangipara\'s 195; Mehkar given Sakri\'s 5; Baharagora 41; Mummidivaram 62; Assam Bajali 26 '
                        'and Demow 95 are 2023 numbers). The name rules overrule them.',
        'eci_pc_codes': f"LGD 'Parliament Constituency ECI Code' agrees with the ECI number for only "
                        f"{int((P.lgd_eci_pc_code_agrees == 'yes').sum())} of "
                        f"{int(P.lgd_eci_pc_code_agrees.isin(['yes', 'no']).sum())} PCs - do not use it.",
        'pc_labels': 'Gujarat: LGD puts Morbi AC under Rajkot PC; ECI has it in Kachchh PC.',
        'reservation_tags': 'Only Manipur (20 "(st)") and Assam ("Majuli ST") carry tags in LGD names; Manipur '
                            'Kangpokpi is tagged (st) in LGD but is the unreserved hill seat.',
        # verifier addition 2026-10-01: matters for the AC-profile build, which takes territory from coverage
        'no_coverage_rows': (lambda z: f"{len(z)} LGD ACs appear in no constituency_coverage row (lgd_sources = "
                             f"AC_list only), so LGD gives them NO villages/wards/sub-districts: "
                             + '; '.join(f'{s} {n}' for s, n in z.groupby('state').size().items())
                             + ' (' + ', '.join(z[z.state != 'Delhi'].lgd_ac_name) + '). '
                             'Delhi is entirely absent from LGD coverage. The crosswalk pairing is unaffected; '
                             'their territory must come from another source.')(R[R.lgd_sources == 'AC_list']),
    },
    'counts': {
        'lgd_acs': int(len(R)), 'matched': int(R.eci_ac_no.notna().sum()),
        'methods': R.method.value_counts().to_dict(), 'delimitation': R.delimitation.value_counts().to_dict(),
        'lgd_pcs': int(len(P)), 'pcs_matched': int(P.eci_pc_no.notna().sum()),
        'duplicate_eci_numbers': int(S.duplicate_eci_no.astype(int).sum()),
    },
    'files': {
        'lgd_ac_to_eci.csv': 'one row per LGD AC (4,116 incl. the Chandigarh placeholder). Task columns first: '
                             'state (app spelling), lgd_ac_code, lgd_ac_name, lgd_pc_code, lgd_pc_name, eci_ac_no '
                             '(app n in the latest year of the matched map = current ECI number; AP 1-175), '
                             'app_j, app_name, app_year_matched, method, similarity, delimitation. Extras: '
                             'app_years, app_r, app_r_reliable, lgd_res_tag, lgd_eci_ac_code, lgd_eci_code_agrees, '
                             'app_pc_no/app_pc_name (PC of the app seat from segments.json), lgd_pc_as_eci, '
                             'pc_check, note, lgd_sources.',
        'lgd_pc_to_eci.csv': 'one row per LGD PC (543). eci_pc_no = majority of member ACs\' app PC (method '
                             'ac_majority, ac_share) or name match for UTs without ACs; Assam/J&K also give the '
                             'same-named 2024 PC.',
        'review_non_exact.csv': 'every non-exact pairing (fuzzy, manual, ECI code with a differently spelled name) '
                                'and every AC whose LGD PC disagrees with the app seat\'s PC.',
        'unmatched_app_seats.csv': 'app seats of the matched map with no LGD AC (Ladakh 47-50, Sikkim Sangha).',
        'lgd_eci_code_conflicts.csv': 'LGD ECI codes rejected by the name check.',
        'state_summary.csv': 'per state: LGD ACs, matched, app seats in the matched map, unmatched, delimitation, '
                             'whether it is the app\'s latest map, method counts, wrong LGD ECI codes, duplicate '
                             'ECI numbers (0 everywhere), PC disagreements, score against the other map.',
        'reservation_check.csv': 'seat-level reservation disagreements with verdicts (Delimitation Order 2008 '
                                 'vs app; LGD name tags vs app).',
        'reservation_totals_vs_statute.csv': 'per state and map: statutory SC/ST seat totals vs the app r field.',
        'hybrid_pc_grouping_assam_jk.csv': 'Assam/J&K: each LGD AC\'s PC vs the old-map PC and the newer map\'s '
                                           'PC of the same-named seat.',
        '_build/': 'scripts that produced these files (paths point at the session scratchpad copy of LGD).',
    },
}
json.dump(meta, open(OUT + 'crosswalk_meta.json', 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
os.makedirs(OUT + '_build', exist_ok=True)
for f in ['build_crosswalk.py', 'finalize.py', 'hybrid_pc.py', 'sched2.py', 'write_meta.py', 'run_all.py',
          'schedule2_assembly_seats.csv']:
    dst = OUT + '_build/' + f
    # verifier fix 2026-10-01: skip the copy when run from _build/ itself (shutil.SameFileError otherwise)
    if os.path.exists(f) and not (os.path.exists(dst) and os.path.samefile(f, dst)):
        shutil.copy(f, dst)
print(json.dumps(meta['counts'], indent=1))
