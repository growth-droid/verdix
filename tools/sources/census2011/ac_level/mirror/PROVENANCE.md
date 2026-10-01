# LGD mirror: provenance, licence and accuracy (snapshot 29 Sep 2026)

STATUS 2026-10-01. Written for the AC-level Census 2011 build (each AC = the Census 2011 villages, census towns and
statutory towns/wards that the Local Government Directory (LGD) maps to it). Every number below comes from
`validation.csv` in this folder. `validate_mirror.py` and `order_check.py` regenerate it. Not legal advice.

STATUS 2026-10-01 (independent verifier). Every claim was recomputed without reusing the scripts here. Section 6
lists what was confirmed, what was wrong, and each fix made to this file, `validation.csv` (new rows O17, O18, E06
and section V) and `validate_mirror.py`. The main correction is that LGD's AC mapping is **worse than section 3d
first showed**. An all-India district-level check found 13 more confirmed misplacements, about 2.0 M rural people.
Delhi has no AC mapping in LGD at all, and J&K is mostly on the pre-2022 ACs.

## 0. Bottom line

* **Route 1, where I download the LGD files through the CAPTCHA, was not done.** I do not solve or bypass CAPTCHAs.
  Every LGD report and Download Directory output sits behind one. The same rule bars both doing it by hand and
  scripting it. So, as the request says, the build goes with **route 2: the public mirror**.
* **What the mirror is.** It is `ramSeraph/opendata`, a GitHub release called `lgd-latest`, scraped daily from
  lgdirectory.gov.in. Our 12 files are byte-for-byte the release assets: each sha256 matches the digest GitHub
  published, as recorded in the release metadata saved on 2026-09-29. The 3 files still live were re-confirmed on
  2026-10-01. The mirror also matches the LGD's own captcha-free home-page statistics exactly. States, districts,
  sub-districts, villages (by status), ULBs, ACs (4,116) and PCs (543) all agree.
* **Caveat 1: how the mirror got the data.** The mirror's README says the scraper *"Uses google tesseract to break the
  captchas"*. The bytes are LGD's own, but they were obtained by automated CAPTCHA-breaking. LGD's written terms say
  nothing either way about automated access (section 2). The CAPTCHA is still a clear technical signal. Whether to
  ship data obtained that way is the owner's call. A clean option exists: a person downloads the official
  "Constituency Coverage Details" report in a browser, one state at a time. That copy can confirm or replace the
  mirror state by state.
* **Caveat 2: the source data has errors.** The mirror copies LGD faithfully, but LGD's own AC mapping contains
  errors and gaps. Sections 3, 4 and 6 list them. The build has to handle them. The errors are not rare:
  * whole tehsils are given to the wrong AC, often a homonym in another district (Muhammadabad Gohna → Mohammadabad,
    Fatehabad → Fatehpur, Bishnupur-I → Bishnupur);
  * the Anandpur Sahib PC in Punjab is scrambled;
  * Delhi's 70 ACs carry no land at all;
  * J&K is on the old ACs.

  A random sample of 30 villages put 2 in the wrong AC (section 6).
* **Caveat 3: the upstream release changes daily.** `lgd-latest` is replaced every day and is not immutable. On
  2026-10-01 at about 07:50 UTC, `constituency_coverage.29Sep2026.csv.7z` (and the 30Sep file) already returned
  HTTP 404. Later the same day, the verifier found 9 of our 12 files gone from both `lgd-latest` and
  `lgd-latest-extra1`. Only `urban_local_bodies`, `urban_local_body_wards` and `villages` remain, with unchanged
  digests. Pin by sha256. The verified CSVs are persisted in `../lgd/` and match the scratchpad copies exactly.
  That folder is **gitignored**, so it is now the only surviving copy outside the scratchpad. Back it up.

## 1. Identity of the mirror

| item | value |
|---|---|
| repository | https://github.com/ramSeraph/opendata (public; scraper code in `lgd/`; site https://ramseraph.github.io/opendata/lgd/) |
| release | tag `lgd-latest`, "Local Government Directory Current Month dumps", release id 203603729, published 2025-03-04, assets updated daily (`immutable: false`) |
| snapshot used | files dated **29Sep2026**, uploaded by `github-actions[bot]` 2026-09-29 10:24-10:25 UTC. Archive mtimes are 15:52-15:54 IST the same day. |
| how scraped | `python -m scrape` against lgdirectory.gov.in Download Directory + Reports. README: "Uses google tesseract to break the captchas". |
| release metadata saved | `option2/lgd/rel_latest.json` (sha256 1b099096…e2fe), `option2/lgd/releases.json` (8bbb5a4f…8c9341, truncated JSON). The ramSeraph/indian_admin_boundaries releases in `option2/web/iab_releases*.json` / `iab_constituencies.json` are the boundary repo, **not** the LGD CSV source. |

Assets used. The URL for each is `https://github.com/ramSeraph/opendata/releases/download/lgd-latest/<file>.7z`.
`evidence/github_release_lgd-latest_assets_used.json` keeps names, sizes, digests and upload times. The `.7z` sha256
equals GitHub's `digest`, and each CSV is the archive's content (checks P01-P12).

| file | rows | CSV sha256 | .7z sha256 (= GitHub digest) | .7z bytes |
|---|---:|---|---|---:|
| assembly_constituencies.29Sep2026.csv | 4,042 | 953532c017e22378e38b1fdd4e1c6035b644a459ab32adf84675a5ad0b1938b7 | 911d108703e00474f1d0e38ef7bc035903b9bf55c2578177494c2f5d39a10607 | 31,239 |
| constituencies_mapping_urban.29Sep2026.csv | 115,755 | 490523c83cff080fb5befe82c5e3be6083b1dc1cb675ed8f2a63e4775428434e | 67d3bc41e97397d08f401cdc5d9885a244c78aeb760d8a61628f442bbd3a564d | 1,012,538 |
| constituency_coverage.29Sep2026.csv | 498,049 | db6c5231c6de3e94c2c2f34dbc57f0eae5a9426960aa08e5cdbf948d03b8c73f | 73d565e2a6d6c5c8fc1c86e31e95ede4e19b96777218800efc1cc3dae1a3ac93 | 4,548,335 |
| districts.29Sep2026.csv | 784 | ff37eb5ac4fdfad369ef792b13410fff635294f50104b1061fc94b5800be4b2b | 21d4a9d29e584e11a65bb41ed1ed8ef74caffcfa6591b07ba70aac5c8764a513 | 8,744 |
| invalidated_census_villages.29Sep2026.csv | 4,953 | e002aebc22455d1af4f87fcb0fde5ea34b6e678597f6d9f6d611fcc965472cca | eb3daf665b736a16eba22badfee1104e802ef85a15e375653760eabaa1522987 | 56,614 |
| parliament_constituencies.29Sep2026.csv | 463 | c96f86d29a3c5158d11980d030f513159b36d75b34462467179723bd64a666e8 | 6636ceb3892970d8c74d3b54afde09e4f77976a6383e5bd152a2e1951edfc5e4 | 3,999 |
| states.29Sep2026.csv | 36 | 17c44a8e083f767f729887efe42388dd9aebfbca7152a0dc33eee7ac1aa0ddaa | 5ccc1be798d0a68a5ebab770819a8138c25f2400f2dcafa29accde7dc8060554 | 1,074 |
| statewise_ulbs_coverage.29Sep2026.csv | 35,039 | 7baf0bf3e0e8a4c08f3b8d6bba38a91d07e6b29acc858f9f926a1eac6948519d | e7b589709e6f874f56db3edc1aff71b3da314fafcae9c5db7a2f51ddf1097246 | 354,686 |
| subdistricts.29Sep2026.csv | 7,092 | b4d147974448f509570b282df058bdbd2da78674f5df86e95ef77f93e0332d4a | 7331c35f1456db8a111c53ae16ec6c6e02b5228de12e5b9355c835ef48557ccd | 90,140 |
| urban_local_bodies.29Sep2026.csv | 5,051 | 5ccf97b9069190c40ae7b138639d66995829c0726cc210ec02556c3152b4f9e5 | ecfd497ed5b3bd4cbedb1e9e34893ae3c8eaa94f47501dd33e96496dc59e9994 | 75,956 |
| urban_local_body_wards.29Sep2026.csv | 98,236 | 302e1e2d702abe91f420e42e38f227825d76ddff5883bf94aa2ac063462fd1a2 | 7c11bc18b6ab558cb1af02d26cdf2d75185979e5a728425f9c26dc8c75dc70fb | 1,007,827 |
| villages.29Sep2026.csv | 677,663 | 2b390726387eb7b34707c8f712894e926a5378565316fdb1ebf025f1d29acb1c | 8c9cd1fbf5ea4b4e4ccd07586706f983e8a4fc57e5c2d8d400d0e9cfd9d602ca | 9,335,955 |

### Licence the mirror states

* Repo licence file `UNLICENSE`, copied to `evidence/`. It opens: *"The following covers code in this repository
  which I have written. Anything which was copied and cannot be covered under this has an explicit license mentioned
  in the file or in its proximity."* That is a public-domain dedication of the **code**. GitHub's API reports the
  repo licence as "Other" (`NOASSERTION`).
* The LGD release, the lgd README and the project site state **no separate data licence**.
* **Correction to the earlier notes.** `option2/sources_and_licences.json` says "Mirror licence statement: CC0 but
  attribute LGD". That wording comes from `ramSeraph/indianopenmaps/DATA_LICENSE.md` ("CC0 1.0 … attribute Datameet
  … and the original government sources"), which covers the map layers. It does not cover the LGD CSV dumps.
* Either way, a mirror cannot grant more rights than the publisher. Rely on LGD's own policy in section 2.

## 2. LGD's own copyright policy and terms (saved 2026-09-29; text in `evidence/`)

**Copyright Policy** (https://lgdirectory.gov.in/copyRightPolicy.do; saved page sha256 b5191333…9340):
> "Material featured on this site may be reproduced free of charge in any format or media without requiring specific
> permission. This is subject to the material being reproduced accurately and not being used in a derogatory manner
> or in a misleading context. Where the material is being published or issued to others, the source must be
> prominently acknowledged. However, the permission to reproduce this material doesn't extend to any material on this
> site, which is explicitly identified as being the copyright of a third party."

**Terms & Conditions** (https://lgdirectory.gov.in/termsconditions.do; saved page sha256 a661484c…f3a88):
> "Though all efforts have been made to ensure the accuracy and currency of the content on this website, the same
> should not be constructed as a statement of law or used for any legal purposes. In case of any ambiguity or doubts,
> users are advised to verify/check with the State Departments and/or other source(s) … Under no circumstances will
> this Department/Ministry be liable for any expense, loss or damage … arising from use, or loss of use, of data …"

**What reuse they allow.** Free reproduction in any format or medium without asking permission. Commercial use is
not excluded. Three conditions apply: reproduce accurately, do not use the material in a derogatory or misleading
way, and acknowledge the source prominently. Material marked as third-party copyright is excluded. Accuracy is
disclaimed, and users are told to verify with State departments.

**Automated access.** Neither page mentions scraping, bots, crawlers, rate limits, bulk download or CAPTCHAs.
`https://lgdirectory.gov.in/robots.txt` returns 404 (checked 2026-10-01). In practice every report and download form
requires a CAPTCHA answer (`captchaAnswer`), a technical barrier to automated bulk access. The copyright policy
covers *reproducing* the material. It says nothing that authorises getting past that barrier.

Suggested credit line: *Source: Local Government Directory (lgdirectory.gov.in), Ministry of Panchayati Raj,
Government of India, snapshot of 29 Sep 2026 (via the ramSeraph/opendata mirror).*

## 3. Accuracy

### 3a. Against official LGD content that needs no CAPTCHA

These are the only official LGD views I could compare without a CAPTCHA:

* **Home-page "Statistical/Analytical Summary".** Saved 2026-09-29 19:10 IST, the same day as the scrape (sha256
  d62e7b0e…c6), and fetched again 2026-10-01. The checks are O01-O10, and **all pass exactly**: 36 states,
  784 districts, 7,092 sub-districts, 677,663 villages (658,154 inhabited, 18,371 uninhabited, 1,138 forest),
  5,051 ULBs, 4,116 ACs and 543 PCs. By 2026-10-01 LGD shows 677,673 villages, so it has kept moving.
* **State dropdowns on official report forms.** The forms are `rptMappedGPNWardforPCAC.do` ("Report on PC/AC Wise
  Mapped Landregion/LocalBodies/Ward", saved as `off_rptMappedGPNWardforPCAC.do.html`), `rptMappedListAcPcLandRegion.do`
  (`off_rptMappedListAcPcLandRegion.do.html`) and the Download Directory. All three lists match states.csv on code
  and name, 36 of 36 (O14-O16).
* **The report outputs themselves need a CAPTCHA.** The two saved `off_rpt*.html` files are input forms: state, PC
  and AC pickers plus a `captchaAnswer` field. They contain no report rows. Their PC/AC pickers fill through DWR
  JavaScript POST calls that carry session tokens, so I did not use them. data.gov.in has an LGD catalogue under the
  Government Open Data Licence (GODL), updated 25/09/2026, but its public resource listing returned HTTP 500 to a
  plain GET, so I did not use it either.
* **The mirror's own constituency lists are incomplete.** `assembly_constituencies.csv` lists only 96 of Andhra
  Pradesh's 175 ACs. It has 4,037 non-blank codes, and its last row is a report-footer timestamp.
  `parliament_constituencies.csv` lists 463 PCs. The union of the constituency files gives exactly LGD's 4,116 and
  543 (O11, O12).
* **Verifier correction: no single file has all the ACs.** `constituency_coverage` ∪ `constituencies_mapping_urban`
  gives only **4,039** ACs. 77 ACs appear only in `assembly_constituencies.csv` and carry **no coverage rows at all**
  (O17):
  * **all 70 Delhi ACs**;
  * Jamalpur-Khadia, Habba Kadal, Kozhikode South, Nemom, Raj Bhavan, Sardarpura and Kota South.

  LGD cannot place any land or population in these. Take AC identity from the union of all three files.
* **J&K (O18).** LGD has 83 J&K ACs, mostly the pre-2022 set. 11 of its names exist only before 2022, and 16 of the
  90 ACs of 2022 are missing (Trehgam, Lal Chowk, Padder-Nagseni, Shri Mata Vaishno Devi …). It cannot serve J&K
  2024.

### 3b. Internal consistency (I01-I13)

* There are 9,714 exact duplicate rows in `constituency_coverage`. They are harmless; drop them.
* Every Village, SubDistrict, District and Localbody code in `constituency_coverage` exists in its master file. Of the
  Ward codes, 358 rows (1.1%) are not in the ward master, mostly in Karnataka.
* Each AC code has one name and sits under one PC. No sub-district is "Fully Covered" by two ACs, and no village is
  listed under two ACs.
* **FAIL I11: 2,684 villages (3.9 M people, 0.47% of rural India) conflict.** Each is listed under AC X while its
  sub-district is "Fully Covered" by a different AC Y. They fall in 99 sub-districts, mostly in Bihar, Madhya
  Pradesh, Rajasthan and Assam. The cases checked against the Order show that the "Fully Covered" sub-district row
  is the wrong one. Example: Seoni, Kurai and Seoni Nagar tehsils of Seoni district are marked as fully inside
  Balaghat AC.
* **Verifier: rows with AC code 0 (I07, now FLAG).** These are not only UTs without an assembly. Puducherry has a
  30-seat assembly, yet 2 of its local bodies and 37 of its wards are assigned to the PC and to no AC.
* **Verifier: "Fully Covered" District rows.** There are 14 such rows (AC not 0, deduplicated), and 3 are wrong:
  * Shahid Bhagat Singh Nagar → Anandpur Sahib. The district is actually 46 Banga, 47 Nawan Shahr and 48 Balachaur.
    Its 472 villages (486,894 people) reach an AC only through this row.
  * Mumbai → Malabar Hill. Mumbai City has 10 ACs.
  * Kolkata → Kolkata Port. Kolkata has 11 ACs.

  The Chandigarh row names a UT with no assembly. See V07.
* `constituencies_mapping_urban` reuses an ECI AC number twice: Haryana 42 (Dabwali and Kalawali) and Maharashtra 5
  (Mehkar and Sakri).
* LGD `State Code` is LGD's own code and is **not zero-padded** ('8' = Rajasthan). Join on `states.csv`
  "Census 2011 Code" with `zfill(2)`.

### 3c. Against the Census 2011 village and town directory (C01-C10)

The Census inputs are `bpf/2011-IndiaStateDistSbDistVill-0000.xlsx` (sha256 2a6ffc68…dbbc1, equal to the download
manifest) and its parse `work/india_village_level.parquet`. The parse ties exactly to 1,210,854,977 total and
833,748,852 rural. 19,436 rows streamed straight from the xlsx matched on code, name and population.

| check | result |
|---|---|
| Census 2011 villages found in LGD by Census code | 636,246 of 640,949 (99.27%), covering 99.66% of rural population |
| Census villages missing from LGD | 4,703. Of these, 4,694 are on LGD's own *invalidated census villages* list, which is consistent. They hold 2.86 M people. |
| LGD "Census 2011 Code" values that are not 2011 village codes | 4,521 (0.71%). Flag. |
| village names where codes match | 93.7% exact, 98.2% similarity ≥ 0.8, 0.19% similarity < 0.5 |
| village's LGD district → Census 2011 district | 99.85% agree (91% of villages sit in districts that carry a 2011 code) |
| village's LGD sub-district → Census 2011 sub-district | 96.9% agree |
| ULB Census 2011 town codes | 3,859 of 5,051 ULBs carry one. 97.1% of those are valid 2011 town codes, and 93.9% of names are similar. |
| **completeness: rural population placed in exactly one AC** | **97.70%** (814,569,740 of 833,748,852; verifier-corrected, see V06). Conflicts (I11) 0.47%; in LGD but with no AC 1.48%; code not in LGD 0.34%. "No AC" includes UTs with no assembly (about 0.68 M people) and all Delhi villages (about 0.38 M). "Exactly one AC" is completeness, not correctness: it counts the SBS Nagar district fallback and every misplacement in 3d and 6. |

The gaps cluster in whole tehsils. For example, Behat, Lambhua, Bilhaur, Rudhauli, Menhdawal, Ghanghata, Nautanwa and
Pharenda in Uttar Pradesh carry only urban wards, so their villages have no AC. Sihora and Rehli tehsils in Madhya
Pradesh are unassigned.

### 3d. Against the ECI Delimitation Order 2008 (D, D-detail, E, S)

The Order (sha256 9e1ac49a…5e69) is still the AC map in these states. The mirror is checked against
`delim/eci_order_text.txt` (sha256 718536b4…28c9).

* `order_check.py` re-extracts every AC's extent from the raw text itself. The earlier coordinate parse
  (`order_parse/*.csv`) misallocated text across page breaks for 13 Maharashtra and 6 West Bengal ACs, so the raw
  re-extraction is used.
* **Sampled states and design.** Maharashtra, West Bengal and Madhya Pradesh were sampled. The three use different
  units (tehsil, CD block and tehsil+R.I. circle), and the earlier pass had rated Madhya Pradesh weakest. In each
  state, 20 seeded-random ACs (seed 2011) were drawn for each of two checks:
  * **A.** Is every sub-district that LGD marks "Fully Covered" named in that AC's extent? It is matched by its LGD
    name or its Census-2011 name, and the check records whether it is named whole or only "(Part)".
  * **B.** The reverse. For every tehsil or block the Order names *whole*, what share of its 2011 population does LGD
    put in the same AC?
* AC identity was confirmed by LGD's ECI number plus name (MH and MP: 20/20). In West Bengal it rests on the name
  alone for 14 of the 20, because LGD has ECI numbers only for ACs with urban rows.
* **Every non-OK row was reviewed by hand against the raw text.**

| state | A: "Fully Covered" rows | named whole | confirmed wrong | post-2001 sub-district (plausible) | B: whole units | ≥95% same AC | wrong / unassigned |
|---|---:|---:|---:|---:|---:|---:|---:|
| Maharashtra | 26 | 25 | 1 | 0 | 34 | 34 | 0 |
| West Bengal | 28 | 26 | 2 | 0 | 22 | 21 | 1 |
| Madhya Pradesh | 34 | 30 | 1 | 3 | 24 | 21 | 1 (+2 at 82% / 93%) |

Confirmed LGD errors, with 2011 rural population and the Order line in `eci_order_text.txt`:

| error | population | Order |
|---|---:|---|
| MH, Dharashiv (Osmanabad) tehsil given wholly to Osmanabad AC. Its Bembli, Padoli and Ter circles belong to 241 Tuljapur. | 291,798 (tehsil) | l.19628-19634 |
| WB, Jorebunglow Sukiapokhri block given wholly to Darjeeling. Five GPs belong to 24 Kurseong. | 86,637 (block) | l.40779-40783 |
| WB, CDB Binpur-I given to Binpur AC. The Order puts it in Jhargram. | 156,153 | l.42075 |
| MP, Pipariya tehsil given to Sohagpur. The Order puts it in 139 Pipariya (SC). | 106,254 | l.17436 |
| WB, CDB Khargram given to Jangipur. The Order puts it in 66 Khargram (SC). | 273,332 | l.41033 |
| MP, Sihora tehsil: 98% of its population has no AC in LGD (completeness). | 133,460 | Order: Kundam + Sihora tehsils |
| Spot finding outside the sample: WB, CDB Manbazar-I given to Bandwan. The Order puts it in 243 Manbazar. | 144,550 | l.42187 |
| Spot finding outside the sample: MP, Seoni, Kurai and Seoni Nagar tehsils given to Balaghat AC. The Order puts them in Seoni and Barghat; it is the same PC, so this looks like a PC-for-AC entry error. | 362,050 | l.17215 |
| Spot finding outside the sample: MP, Kesli tehsil given to Rehli. The Order puts it in 38 Deori. | 116,951 | l.16748 |

What the samples show:

* **Wrong whole-unit assignments.** In 60 random ACs, 4 of 88 "Fully Covered" sub-district claims were wrong
  (4.5%), touching 4 of the 60 ACs (7%).
* **Reverse check.** 76 of the 80 units the Order names whole put at least 95% of their 2011 population in the right
  AC. Of the other four, one is in the wrong AC (Khargram), one is unassigned (Sihora), and two are partial (82% and
  93%).
* **ECI numbers (E01-E06, corrected by the verifier).** Of 2,292 LGD ECI numbers in 15 states, 2,250 agree
  automatically. The other 42 were reviewed. 37 are spelling or renaming differences, or name artefacts in the
  earlier parse. **4 are wrong**:
  * Dabwali carries 42; the Order gives 43.
  * Mehkar carries 5; the Order gives 25. The Order's own PC table misprints "5. Mehkar".
  * Baharagora carries 41; the Order gives 44.
  * Chanditala carries 195; the Order gives 194.

  The verifier's all-state check (V18) also found **Mummidivaram (AP) carrying 62; the Order gives 162**. AP was
  skipped earlier.

  *Durg-nagar 65 was wrongly listed as a wrong number.* LGD has a separate Durg-city carrying 64, and no Bhilai
  Nagar, so Durg-nagar sits in the 65 = Bhilai Nagar slot. What is wrong is its name and content (E06):
  * it holds Bhilai Charoda (M), which the Order puts in 67 Ahiwara;
  * all 140 Bhilai (M Corp.) wards sit in 66 Vaishali Nagar, though the Order splits them across 63, 65 and 66.
* **Automated run on all ACs in 15 states (S01-S15).** It was not reviewed by hand, so treat it as an upper bound on
  disagreement. Name-matching misses, post-2001 sub-districts, homonyms and wrong ECI numbers all inflate it. It
  points to the same problem areas: Jharkhand, Madhya Pradesh, Gujarat, Chhattisgarh, and Rajasthan "(Part)" tehsils.
  *Verifier:* it also flagged Mohammadabad, Fatehpur and Shahkot ("NOT NAMED"), which are real errors (section 6).
  *Verifier:* checks A and B match **names only**, so they cannot see a homonym in another district.
  "Bishnupur - I" (South 24 Parganas), marked Fully Covered by the Bankura Bishnupur, was rated "named whole", a
  false pass. Punjab and Uttar Pradesh belong on the problem list.

## 4. What the build should do with this

1. Take AC identity from the union of `constituency_coverage`, `constituencies_mapping_urban` **and**
   `assembly_constituencies.csv` (4,116), dropping AC code 0 and the blank or footer row. Using the first two alone
   (4,039) silently loses all 70 Delhi ACs and 7 others (O17). Drop exact duplicate rows first.
2. Resolve each village in this order: its explicit Village row, then a "Fully Covered" SubDistrict row, then a
   "Fully Covered" District row. A Village row must override a contradicting "Fully Covered" sub-district (I11).
   **Do not use the District fallback for Shahid Bhagat Singh Nagar, Mumbai or Kolkata**, because those rows are
   wrong (V07).
3. Apply an override table for the confirmed errors in 3d **and in section 6**, taking the Order as authority. Treat
   every "Fully Covered" sub-district as suspect where the automated run flags it. **Add a district guard to every
   AC.** Compute the share of the AC's population that lies in the Order's district(s) for that AC (the app's
   `../../ac_district_2008/` schedules), and review every AC below about 80% before shipping.
   `evidence/verifier_ac_vs_order_district.csv` lists the 41 such ACs; 22 of them are still unreviewed. Name-only
   checks miss homonyms.
4. Do not trust LGD's ECI AC number alone. Join on number and name against the ECI list. Fix the 5 known wrong
   numbers (Dabwali, Mehkar, Baharagora, Chanditala, Mummidivaram) and Durg-nagar's name (it is Bhilai Nagar).
5. Report completeness per AC. About 1.5% of rural population has no AC in LGD, whole tehsils at a time. Those ACs
   need a fallback, such as the Order's own extent text, or they must be shown as partial. **Delhi (70 ACs) and the 7
   ACs in O17 need a non-LGD source entirely. J&K 2024 (90 ACs) cannot come from LGD (O18).** Treat the Punjab
   Anandpur Sahib PC (ACs 45-53) as unusable in LGD.
6. Join on Census codes as zero-padded strings: village `zfill(6)`, sub-district `zfill(5)`, district `zfill(3)`,
   state `zfill(2)` via "Census 2011 Code". Never join on LGD's State Code.
7. Pin the snapshot by the sha256s above, credit LGD as in section 2, and keep this folder with the build.
8. If the owner wants official-only data, a person can download "Constituency Coverage Details" for Maharashtra,
   West Bengal and Madhya Pradesh in a browser. That gives a row-level check of the mirror, or a replacement for it.

## 5. Reproduce, and what was not done

* Run, in order: `python order_check.py`, then `python order_check.py all`, then `python validate_mirror.py`. Inputs
  are read from the session scratchpad (`.../scratchpad/census/option2`). Working outputs go to
  `.../scratchpad/mirror_verify`.
* `validation.csv` columns are `id, section, check, compared_against, expected, observed, result, note`. The
  sections are:

  | section | contents |
  |---|---|
  | P | integrity |
  | O | official LGD |
  | I | internal consistency |
  | C | Census 2011 |
  | E | ECI numbers |
  | D | Order summaries |
  | D-detail | every sampled row, with the hand review |
  | S | automated all-AC run |
  | V | the independent verifier's rows, kept in `verifier_findings.csv` and appended on every run |

  The result values are PASS, FAIL, FLAG, PLAUSIBLE, REVIEW, INFO and FIXED.
* Network use on 2026-10-01 was plain public GETs only:
  * the GitHub API (repo, licence, release tags);
  * raw.githubusercontent.com (README, UNLICENSE, indianopenmaps DATA_LICENSE);
  * the LGD home page and robots.txt;
  * one data.gov.in listing call, which returned 500;
  * HEAD and range probes of the release URLs.

  No CAPTCHA was solved or submitted, no DWR or form POSTs were made, and no stored cookies were sent. The old
  `cj.txt` files in `option2/` were not used. The scratchpad folder `option2/pca/tv/` was not touched.

## 6. Independent verification (2026-10-01)

A separate verifier re-opened every output and recomputed the checks with its own code, without running
`validate_mirror.py` or `order_check.py` to get its numbers. Working files are in `scratchpad/verifier_mirror/`.
Network use was plain public GETs only:
* the GitHub API (repo, release tags, paged release assets);
* raw.githubusercontent.com;
* the LGD home page and robots.txt.

No CAPTCHA was touched, and no form or DWR POSTs were made.

**Confirmed as stated:**
* **Integrity.** The 12 sha256s of the CSVs and `.7z` files match. Each archive's content matches its CSV. The
  `../lgd/` copies match.
* **Release metadata.** Release id 203603729 and the `immutable: false` flag check out.
* **Licence.** The quotes from the licence and LGD terms are verbatim. Neither LGD page says anything about automated
  access, and robots.txt returns 404.
* **Counts.** All home-page counts match, and the live page now shows 677,673 villages. The state dropdowns on all 3
  official forms match.
* **Internal checks I01-I11** reproduce exactly: 9,714 duplicate rows, 358 orphan ward rows, and 2,684 conflict
  villages in 99 sub-districts.
* **Census checks C03-C09** reproduce from the official xlsx, read directly. Village-name agreement depends on how
  names are normalised (93.4-93.7%).
* **Errors in 3d.** All 9 confirmed LGD errors were re-read in the Order text, and the LGD side was re-checked:
  * Dharashiv, Jorebunglow Sukiapokhri, Binpur-I, Pipariya, Khargram;
  * Sihora, Manbazar-I, Seoni/Kurai/Seoni Nagar, Kesli.
* **"Village row wins" (I11)** is supported by further Order spot checks: Weir, Khilchipur and Sihawal.
* **Join hazards.** As stored, LGD Census-2011 codes match only 537,163 villages, and 636,277 after `zfill(6)`. The
  village xlsx also holds 12 West Bengal codes as floats. Both hazards were handled.

**Wrong or incomplete, and corrected:**

| # | what | fix |
|---|---|---|
| 1 | §3a/§4: "take AC identity from constituency_coverage ∪ constituencies_mapping_urban". That gives 4,039 ACs and drops all 70 Delhi ACs plus 7 more, none of which has any coverage row. | Text corrected. New validation row O17 (FAIL). O11 note corrected, and its count now excludes the blank code (4,037). |
| 2 | J&K not mentioned. LGD has 83 ACs, mostly pre-2022. | New row O18 (FLAG). §3a and §4 rule 5. |
| 3 | I07 marked PASS as "only UTs without an assembly". Puducherry has an assembly, yet 39 of its rows have no AC. | I07 is now FLAG, with the explanation. |
| 4 | E: "Durg-nagar carries 65; Durg City is 64" is a misidentification. Durg-city 64 exists separately, and Durg-nagar is the 65 (Bhilai Nagar) slot. Its name and content are what is wrong. | Removed from the wrong-number list (now 4 in 15 states). New row E06 (FLAG). |
| 5 | Mummidivaram (AP) carries ECI 62 instead of 162. It was missed because AP was skipped. | Row V18; §3d; §4 rule 4. |
| 6 | C10 "exactly one AC" used `drop_duplicates` on the Census code. That dropped the second half of 17 split villages, 72,069 people, so the categories did not add up to the rural total. | Script sums the parts. Now 814,569,740 (97.70% unchanged). Row V06. |
| 7 | The "Fully Covered" **District** fallback was recommended without a warning, but 3 of its 14 rows are wrong (SBS Nagar, Mumbai, Kolkata). | §3b; §4 rule 2; row V07. |
| 8 | The error picture was incomplete. Checks A and B match names only, so they cannot see a homonym in another district, and Bishnupur-I got a false pass. | A national district check was added. It compares each LGD AC's village population with the Order's district for that AC (V08; `evidence/verifier_ac_vs_order_district.csv`). The table below lists 13 confirmed new errors; 22 flagged ACs remain unreviewed. |
| 9 | Release persistence. 9 of the 12 assets are now gone upstream, and `../lgd/` is gitignored. | §0 caveat 3 and row V01. |

**LGD errors found by the verifier** (rural population from Census 2011; Order line numbers refer to
`eci_order_text.txt`):

| LGD error | population | Order |
|---|---:|---|
| UP: Muhammadabad Gohna tehsil (Mau) "Fully Covered" by Mohammadabad (Ghazipur, 378). It belongs to 355 Muhammadabad-Gohna. | 407,950 | l.39232-39234 |
| UP: Fatehabad tehsil (Agra) "Fully Covered" by Fatehpur (Fatehpur, 240). It belongs to 93 Fatehabad. | 404,170 | l.37501-37503 |
| Punjab: SBS Nagar district "Fully Covered" by Anandpur Sahib. It is 46 Banga, 47 Nawan Shahr and 48 Balachaur. | 486,894 | l.25342-25359 |
| Punjab: Kapurthala tehsil "Fully Covered" by Shahkot. It belongs to 26 Bholath, 27 Kapurthala and 28 Sultanpur Lodhi. | 220,052 | l.25189-25213 |
| WB: CDB Bishnupur-I (South 24 Parganas) "Fully Covered" by Bishnupur (Bankura, 255). It belongs to 146 Bishnupur (SC). This is a homonym, and it got a false pass. | 204,385 | l.41566 |
| Gujarat: Santalpur taluka villages listed under Kankrej. They belong to 16 Radhanpur. | 127,557 | l.9064-9066 |
| Punjab: Sultanpur Lodhi tehsil villages listed under Kartarpur. They belong to 28 Sultanpur Lodhi. | 104,527 | l.25203-25204 |
| Punjab: Garhshankar, Balachaur and Nawan Shahr hold only Rupnagar villages, and Rajpura almost only (Morinda, Nangal). | ~30,000 | l.25336-25359 |
| HP: Bangana tehsil villages (Una) listed under Hamirpur. 38 Hamirpur is Hamirpur tehsil only. | 29,521 | l.12092-12095 |
| Kerala: Kozhenchery taluk villages (Elanthoor and others) listed under Elathur. They belong to 113 Aranmula. This is a homonym. | 15,344 | l.16073-16076 |

**Random checks:**
* **30 random village pairings.** 30 random Census-2011 villages (seed 20261001) were traced to their LGD AC, and each
  pairing was read against the Order text (`evidence/verifier_random30_pairings.csv`). 27 are consistent, 1 is
  plausible, and 2 are wrong, both in Punjab.
* **20 random rows.** Of 10 random `constituency_coverage` rows and 10 random D-detail PASS rows, all were reproduced.

**What this means for the decision.** Route 2 holds as a *source of the bytes LGD publishes*: the mirror matches LGD
wherever LGD can be checked without a CAPTCHA. It does not hold as a *ready-made AC map*. Expect several percent of
units to be wrong, and expect them to cluster:
* homonyms;
* PC-for-AC entries;
* Punjab's Anandpur Sahib PC;
* Delhi and J&K, which are missing or outdated.

The build needs the district guard and override table in §4 before any AC figure ships.
