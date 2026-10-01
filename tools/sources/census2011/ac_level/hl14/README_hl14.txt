Census of India 2011 - HL-14 household amenities at VILLAGE / TOWN / WARD level, all 640 districts
===================================================================================================
Built 2026-10-01 by build_hl14_units.py. The raw files were downloaded by fetch_hl14_nada.py using plain
anonymous HTTPS GETs (no login, no cookies sent, no keys, no CAPTCHA). Every input file's URL and
sha256 is listed in hl14_sources_manifest.csv. All 53 checks in hl14_validation.csv pass.

SOURCE
  ORGI table HL-14, "Percentage of households to total households by amenities and assets" (the sheet
  prints it as TABLE HH-14). NADA catalogue https://censusindia.gov.in/nada/index.php/catalog/<id>, idno
  PC11_HL14-SS-DDD. There is one xlsx per district (HLPCA-SSDDD-2011_H14_census.xlsx), 640 in all,
  570 MB (546 MiB). They were enumerated through the NADA search API
  (api/catalog/search?sk="amenities and assets"), and each link was taken from that entry's
  /related-materials page. Rows go DISTRICT > SUB-DISTRICT > VILLAGE / TOWN part > WARD. All 135 value
  columns are PERCENTAGES with one decimal. HL-14 publishes no household counts.
  Raw copies are kept outside the repo, in <scratch>/census/option2/hl14/raw/ (unmodified). The 15 files
  saved earlier in ../../hlo/raw/hl14_sample/ are byte-identical to the new downloads.

FILES
  hl14_units.parquet          687,719 rows. One row per HL-14 unit: 597,508 VILLAGE, 8,048 TOWN (one row per
                              sub-district part of a town), 82,163 WARD.
  hl14_district_subdistrict_rows.parquet   the published DISTRICT and SUB-DISTRICT rows (T/R/U), with the
                              same pct_* columns and the official HLO household total (HL-07).
  hl14_validation.csv         all checks, each with expected / got / ok.
  hl14_rebuild_accuracy.csv   rebuild error per weighting x level x reference x T/R/U x indicator.
  hl14_sources_manifest.csv   1,316 rows: 640 HL-14 + 35 HL-07 + 640 PCA-TV files + the NADA search response.
                              Each row has catalog URL, download URL, bytes and sha256.
  pca_units_absent_from_hl14.parquet   PCA-TV units that have no HL-14 row, so no rates (see CAVEATS).
  fetch_hl14_nada.py / build_hl14_units.py   to reproduce: "python fetch_hl14_nada.py search", then
                              "get 0 2" and "get 1 2", then "python build_hl14_units.py --refresh".

hl14_units.parquet COLUMNS
  state, district, subdistt, town_village, ward
                       Census 2011 codes, zero-padded STRINGS (2/3/5/6/4). town_village is the 6-digit MDDS
                       village code, or the town code (8xxxxx = statutory town, else a census town). ward is
                       '0000' on village and town rows.
  level                VILLAGE | TOWN | WARD.   tru  Rural (villages) | Urban (towns, wards).
  name                 the area name as printed in HL-14.
  town_type            statutory | census_town (blank for villages).
  has_wards, is_leaf   In HL-14 every town is split into wards: a census town shows up as one "Ward No.1",
                       and a town's outgrowths (OG) show up as extra wards. So is_leaf = villages + wards.
                       A TOWN row equals the sum of its wards (households) and is their household-weighted
                       mean (%). AGGREGATE LEAF ROWS ONLY, or the towns get counted twice.
  total_households     int. Households EXCLUDING institutional households, which is the HL-14 denominator
                       (India 246,740,228). How each level gets its figure (hh_method):
                         TOWN     hl07_town_exact. The official count from the HL-07 row of that town part.
                         VILLAGE  hl07_subdistrict_rural_split. The official HL-07 sub-district RURAL total,
                                  split across the sub-district's villages.
                         WARD     hl07_town_split. The official town-part total, split across its wards.
                       How the split works: each unit starts at its share of the official PCA 2011 No_HH
                       (hh_prior). Those shares are then calibrated so that the household-weighted mean of the
                       units' own published HL-14 % columns reproduces the published sub-district-rural row,
                       or town row, on all 134 % columns. The calibration is bounded chi-square/GREG with a
                       ridge (mu = 1e-3), and each share stays within [0.2, 5] x its prior (before integer
                       rounding; after rounding, units with tiny priors realise ratios from 0.125 to 8.0:
                       217 units at <= 0.21 and 113 at >= 4.9 out of 675,655 split units). The result is
                       integerised by largest remainder, so every group sums EXACTLY to its official total,
                       and every unit gets at least 1 household. Only official ORGI numbers are used.
                       ":calibrated" means the group was calibrated. ":single_unit" means the group has one
                       unit, which takes the whole total.
  hh_prior             the same official totals, split by PCA No_HH share only (no calibration). Kept for
                       comparison.
  prior_imputed        True when the unit has no usable PCA weight. That covers 406 wards in 161 town parts
                       whose ward numbering differs between houselisting (2010) and the PCA (2011), e.g.
                       Noida (CT), Jalgaon (Jamod), Pachora, Delhi's census towns; 2 unmatched villages;
                       and 1,390 villages with PCA No_HH = 0.
                       A ward then starts from the median of its town's matched wards, a village from 1
                       household, and calibration does the rest.
  group_fit_max        how well the unit's group (sub-district rural, or town) is rebuilt after calibration:
                       the largest |rebuilt - published| over the 11 core indicators, per summed component,
                       in % units. Median 0.04. Over 0.5 in only 10 sub-districts and 9 towns. The worst are
                       Renukoot (NP + OG) 11.4 and Meenambakkam (TP + OG) 7.1: their ward rows cannot
                       combine into the published town row, so treat those two ward splits with caution.
                       The town totals themselves are exact.
  pca_no_hh, pca_tot_p the unit's PCA 2011 No_HH and population, from PCA-TV. pca_no_hh includes institutional
                       households (India 249,501,663). It is 0 where there is no PCA match.
  pct_* (float, 1 dp)  % of households, exactly as published. A summed indicator is the sum of its published
                       1-dp parts. Same names and definitions as ../../hlo/hlo_district_2011.csv. HL-14
                       column numbers (1-based, as printed) in brackets:
     core:  pct_electricity_lighting (85), pct_lpg_png_cooking (114), pct_latrine_within_premises (91),
            pct_tap_water = tap from treated + un-treated source (72+73), pct_banking_services (127),
            pct_tv (129), pct_telephone_any = landline only + mobile only + both (132+133+134),
            pct_computer_laptop = with + without internet (130+131), pct_two_wheeler (136),
            pct_car_jeep_van (137), pct_none_of_assets (139)
     extra: pct_kerosene_lighting (86), pct_firewood_cooking (109), pct_open_defecation (102),
            pct_tap_water_treated (72), pct_drinking_water_within_premises (82), pct_mobile_any (133+134),
            pct_computer_with_internet (130), pct_bicycle (135), pct_radio (128), pct_house_good (12),
            pct_house_dilapidated (14)
  pca_name             the PCA-TV unit name. For an outgrowth ward this reads "<OG> (OG) WARD NO.-0018 (Rural
                       MDDS CODE:001962)".
  og_rural_code        the 6-digit village code parsed from pca_name (963 OG wards). Use it to place an OG
                       ward in village-keyed LGD / AC mappings.
  state_name, district_name, subdistt_name, src_file   as printed, plus the source xlsx.

TO AGGREGATE TO AN AC (or any area): sum total_households over its leaf units, and take each
  pct_x = sum(pct_x * total_households) / sum(total_households). Never average the percentages unweighted.

VALIDATION (from hl14_validation.csv / hl14_rebuild_accuracy.csv)
  (c) Coverage: 640/640 catalogue entries downloaded. sha256 matches. One header signature across all 640
      files (59 files carry 9 blank extra columns, with no data in them). 0 blank or non-numeric cells.
      640/640 districts have a district row and unit rows.
  (b) Households: summing the units reproduces the official totals exactly.
      - hlo_district_2011_counts.csv: 640/640 districts x Total/Rural/Urban, India 246,740,228.
      - Every HL-07 sub-district Rural/Urban total: 5,988/5,988.
      - Every town as the sum of its wards: 8,048/8,048.
      PCA side: unit pca_no_hh + the PCA units absent from HL-14 = the PCA-TV district No_HH for 640/640
      districts (India 249,501,663).
  (a) District % rebuilt as the household-weighted mean of the units, 11 core indicators:
      - vs each file's own district row: 99.90% (Total) / 99.88% (Rural) / 100% (Urban) within 1-dp
        rounding (0.1 per summed component), max 0.28.
      - vs hlo_district_2011.csv: 100% / 99.99% / 100% within 0.2, max 0.24.
      - Sub-district rows: 99.6% within rounding. Towns from their wards: 99.8%.
      Towns use exact counts, so Urban is a pure rounding check: 100% within rounding even with no
      calibration at all.
      NOTE (independent verification): the figures above aggregate VILLAGE + TOWN rows. Aggregating the
      LEAF rows instead (villages + wards, which is what an AC build uses) gives Total 99.86% / Rural
      99.88% / Urban 99.61% within rounding vs the file's district row (max 0.20 / 0.28 / 0.94), and
      99.99% / 99.99% / 99.84% within 0.2 of hlo_district_2011.csv. The Urban misses come from the badly
      fitting ward splits listed under group_fit_max (worst: Sonbhadra 09-200, via Renukoot).
      Independent table check: HL-14's % electricity equals HL-07's own electricity / households counts
      within 0.05 for all 8,048 town parts and all 15,138 sub-district rows.
  (a') OUT-OF-SAMPLE. The (a) numbers are partly in-sample, because the shipped weights are calibrated on
      all % columns. To show the calibration recovers real household weights and is not just fitting, a
      second run calibrates on the 72 HOUSING columns only (house condition, roof / wall / floor, rooms,
      household size, ownership, married couples, bathing, drainage, kitchen, structure) and is then scored
      on the 11 core amenity indicators, which it never saw. Results, out-of-sample vs the uncalibrated PCA
      prior:
        sub-district rural rows   92.0% vs 78.3% within rounding (p99 0.66 vs 1.75)
        district rural rows       97.5% vs 85.0%                 (p99 0.28 vs 0.85)
        towns from their wards    98.2% vs 79.9%                 (p99 0.29 vs 1.90)
      A leave-the-assets-out run (prototype) gave the same picture. Adding columns to the calibration
      improved the held-out fit (wards 98.5% -> 99.4%), which is why the shipped weights use every column.
      The ridge value mu = 1e-3 was chosen on this holdout. Results were flat across mu 3e-4 to 3e-3 and
      across bounds 0.1-10 / 0.2-5 / 0.33-3.
  Spot check: 330 values in 30 random units, re-read with openpyxl (a different xlsx reader), 0 mismatches.

CAVEATS
  - Village and ward household counts are ESTIMATES: official totals split by calibrated official weights.
    Town-part, sub-district and district totals are exact. Where the published rows fit tightly
    (group_fit_max <= 0.1 for 98.2% of sub-districts and 99.3% of towns), the split is well determined.
  - Frames differ between houselisting (April-Sept 2010, which HL-14 uses) and the PCA (Feb 2011):
      * 43,443 PCA villages (71,938 PCA households, mostly uninhabited or tiny) have no HL-14 row, so they
        have no rates.
      * 469 PCA wards (1.20 M PCA households) belong to town parts that HL-14 does have, but the two
        frames number the wards differently. Example: Delhi's census towns, which HL-14 shows as a single
        "Ward No.1" while the PCA splits them by municipal ward number. These households are NOT lost:
        they sit in HL-14's own ward rows for that town, and the town total is exact.
      * Only 19 PCA town parts (+30 wards, 47,133 PCA households) are missing from the HL-14 frame
        altogether. Examples: the BBMP parts that the PCA files under Bangalore North / South / East,
        which houselisting counted inside the "not under any sub-district" unit 99999; and a few
        defence-area census towns (Air Force Area, Chakeri).
      * All of these are listed in pca_units_absent_from_hl14.parquet, so an AC builder can see the gap
        rather than lose it silently.
  - One corrupted published cell was repaired: Jabalpur (M Corp. + OG) Ward 77 carries state code
    "0<diamond>" in HLPCA-23451. It was restored to "23" from the file name. Every other code matches its
    file.
  - PCA-TV lists a town with outgrowths twice under one code: "X (M Cl + OG)" and "X (M Cl)". 660 such
    rows exist. HL-14's single town row is the "+ OG" whole, so that row's No_HH is used; it equals the sum
    of its wards.
  - Universe and timing: households excluding institutional households, as of houselisting 2010. Do not mix
    with the PCA No_HH denominator.

INDEPENDENT VERIFICATION (2026-10-01; separate code, nothing reused from build_hl14_units.py)
  - sha256 + byte size re-hashed for all 1,316 manifest sources: 0 mismatches. 640 unique HL-14 idnos, file
    names and download URLs. The NADA search response lists exactly 640 PC11_HL14-SS-DDD entries.
  - All 640 raw files re-parsed: 704,765 rows = 1,908 district + 15,138 sub-district + 597,508 villages +
    8,048 town parts + 82,163 wards. Unit keys unique. Every one of the 687,719 output rows joins back on
    the 5-part zero-padded key, with the same level / tru, and ALL 22 pct_* columns equal the raw cells (or
    the sum of raw cells) exactly. The column mapping was checked against the printed headers, and every
    published HL-14 district row matches the count-based ../../hlo/hlo_district_2011.csv within rounding on
    all 22 indicators.
  - 30 random units (18 villages, 7 wards, 5 towns) were re-read by hand with openpyxl: 0 of 330 core values
    differ. Each unit's PCA-TV pairing (name, TRU, No_HH) was re-read from the PCA-TV xlsx, and each town's
    HL-07 row from the HL-07 xls: 30 of 30 correct.
  - Household totals recomputed: they match hlo_district_2011_counts for all 640 districts on T/R/U (India
    246,740,228). The 12 district T/R/U rows absent from HL-14 have 0 households. They also match every
    HL-07 sub-district Rural and Urban total (5,988), every HL-07 town part (8,048 of 8,048; the other 42
    HL-07 town rows are whole-town summaries that equal the sum of their parts), and every town's ward sum.
  - PCA: pca_no_hh equals the independently parsed PCA-TV No_HH on all 687,311 matched units (the '+ OG' row
    is kept where a town code is duplicated). The absent-unit list was rebuilt independently: identical
    43,961 keys. Reconciliation to 249,501,663 holds for 640 of 640 districts.
  - The (a') out-of-sample claim was reproduced with an independent linear-GREG calibration on housing
    columns only, over 497 random sub-districts: core indicators within rounding rose from 77.9% with the
    PCA prior to 92.0% at a suitable ridge. This is the same picture as the author's 78.3% -> 92.0%.
  - FIX APPLIED: 48 villages in Rajasthan (38 in Ganganagar 08-099, 10 in Hanumangarh 08-100) are stored
    in HL-14 as Excel TIME cells. The original village names are things like "2 P" and "3 AM", so the
    name column read "14:00:00" and similar. Those 48 names were replaced in hl14_units.parquet by the PCA-TV name for the same code; no other column
    changed. build_hl14_units.py applies the same fix, so a rebuild reproduces it.

LICENCE / ATTRIBUTION
  ORGI Census of India 2011 tables (GoI). ORGI site T&C: reproduce accurately, not in a derogatory or
  misleading context, and acknowledge the source prominently. The same ORGI HLO tables are on data.gov.in
  under the Government Open Data License - India (commercial use with attribution). See
  ../../hlo/LICENCE_AND_SOURCES.txt for the quoted terms and the conservative option of a courtesy e-mail
  to ORGI. No SHRUG or other non-commercial-licensed data was used.
  Suggested credit: "Source: Census of India 2011, Houselisting & Housing Census table HL-14 (village /
  town / ward), HL-07 and PCA-TV, Office of the Registrar General & Census Commissioner, India."
