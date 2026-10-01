#!/usr/bin/env python3
"""g6 - DEFERRED-DELIMITATION states: Assam, Manipur, Nagaland, Jharkhand.

The 2008 delimitation was deferred in these states (Delimitation Act 2002 s.10A, Presidential Order of
8-Feb-2008), so the ACs actually used (Assam AE 2011/2016/2021, Manipur 2012/2017/2022, Nagaland
2013/2018/2023, Jharkhand 2009/2014/2019/2024) are those of the Delimitation of Parliamentary and Assembly
Constituencies Order, 1976 (Jharkhand renumbered 1-81 by the Bihar Reorganisation Act 2000).

Outputs (this folder):  <slug>_acs.csv, <slug>_districts.csv for assam / manipur / nagaland / jharkhand,
                        g6_validation.txt, raw_g6/SOURCES_g6.json (sha256 of every raw file).

district_2008  = the district as given by the official CEO (state election office) list for these ACs:
    Assam     CEO Assam, AE-2021 'Total Polling Station and General Electors - Phase wise' (Revenue District)
    Manipur   CEO Manipur 'Who's Who' - Electoral Registration Officers table (District column)
    Nagaland  CEO Nagaland 'Assembly Constituencies and Polling Stations' - one PDF per election district
    Jharkhand CEO Jharkhand 'AC & PC LIST - JHARKHAND' (district-wise half)
ac_name        = the name in the 1976 Order (OCR of the archived ECI print, read against the ECI's 2008
                 compilation which reprints the same unchanged schedule; see g6_orders.py). CEO spelling
                 is added to note when it differs.
note tokens    = ';'-separated. Machine-readable ones:
    reserved=SC|ST
    also_2011=<codes>      DOCUMENTED: the 1976 extent includes units (thana / police station / mouza /
                           circle / villages) that lie in these OTHER Census-2011 districts.
    possible_2011=<codes>  PLAUSIBLE, unverified: a Census-2011 revenue circle used by the AC is split
                           between districts ('(Pt)' in the 2011 sub-district table) and/or the polygon
                           overlay puts >=10% of the AC in an adjacent 2011 district carved from the same
                           1976 district. Use for a lenient veto only.
No network access: run fetch steps are recorded in raw_g6/SOURCES_g6.json; re-run offline from raw_g6/.
"""
import collections
import csv
import difflib
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from g6_parsers import (parse_assam_ceo_2021, parse_manipur_ceo_eros, parse_nagaland_ceo_ps,  # noqa: E402
                        parse_jharkhand_ceo_acpc)
from g6_orders import (parse_reprint, dpaco_partb, norm, token_set, DPACO_SCHEDULE,  # noqa: E402
                       DPACO_PRINTED_PAGES, ORDER2008, DPACO_TXT)

APP = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', 'public', 'data', 'seats_ae.json'))
PCA = os.path.normpath(os.path.join(HERE, '..', 'pca', 'pca_district_2011.csv'))
SUBDIST = os.path.normpath(os.path.join(HERE, '..', 'boundaries', 'subdistricts', '2011-IndiaStateDistSbDist-0000.xlsx'))
OVERLAY = os.path.normpath(os.path.join(HERE, '..', 'seat_district_overlay.csv'))
RAW = os.path.join(HERE, 'raw_g6')

STATES = ['Assam', 'Manipur', 'Nagaland', 'Jharkhand']
SLUG = {s: re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_') for s in STATES}
N_SEATS = {'Assam': 126, 'Manipur': 60, 'Nagaland': 60, 'Jharkhand': 81}
APP_YEAR = {'Assam': 2021, 'Manipur': 2012, 'Nagaland': 2013, 'Jharkhand': 2009}
CENSUS_STATE = {'Assam': 'ASSAM', 'Manipur': 'MANIPUR', 'Nagaland': 'NAGALAND', 'Jharkhand': 'JHARKHAND'}

SOURCE = {
    'Assam': ("CEO Assam, AE-2021 'Total Polling Station and General Electors - PHASE wise' (Name of Revenue "
              "District) + Delimitation Order 1976 Sch.IV Part B (name, extent)"),
    'Manipur': ("CEO Manipur, Who's Who - Electoral Registration Officers table (District) + Delimitation "
                "Order 1976 Sch.XIV Part B (name, extent)"),
    'Nagaland': ("CEO Nagaland, 'Assembly Constituencies and Polling Stations' PDF of the election district + "
                 "Delimitation Order 1976 Sch.XVI (name, extent)"),
    'Jharkhand': ("CEO Jharkhand, 'AC & PC LIST - JHARKHAND' (district-wise) + Delimitation Order 1976 Sch.V "
                  "Bihar Part B as renumbered 1-81 by the Bihar Reorganisation Act 2000 (name, extent)"),
}

# ----------------------------------------------------------------------------------------------------
# 1976 Order: district headings (the order's own grouping) by AC number, read from the OCR text
HEAD_1976 = {
    'Assam': [(1, 15, 'CACHAR'), (16, 16, 'NORTH CACHAR HILLS'), (17, 20, 'MIKIR HILLS'), (21, 39, 'GOALPARA'),
              (40, 63, 'KAMRUP'), (64, 78, 'DARRANG'), (79, 92, 'NOWGONG'), (93, 108, 'SIBSAGAR'),
              (109, 114, 'LAKHIMPUR'), (115, 126, 'DIBRUGARH')],
    'Manipur': [(1, 40, 'MANIPUR CENTRAL'), (41, 42, 'TENGNOUPAL'), (43, 45, 'MANIPUR EAST'),
                (46, 51, 'MANIPUR NORTH'), (52, 54, 'MANIPUR WEST'), (55, 60, 'MANIPUR SOUTH')],
    'Nagaland': [(1, 15, 'KOHIMA'), (16, 20, 'PHEK'), (21, 30, 'MOKOKCHUNG'), (31, 36, 'ZUNHEBOTO'),
                 (37, 40, 'WOKHA'), (41, 47, 'MON'), (48, 60, 'TUENSANG')],
}
# Jharkhand: 1976 Bihar AC number (Sch.V Part A lists) for each 1-81 AC, and the 1976 Bihar district
JH_1976_NO = {1: 147, 2: 148, 3: 149, 4: 150, 5: 151, 6: 152, 7: 153, 8: 154, 9: 155, 10: 160, 11: 161, 12: 159,
              13: 157, 14: 156, 15: 158, 16: 162, 17: 163, 18: 164, 19: 262, 20: 270, 21: 263, 22: 266, 23: 267,
              24: 268, 25: 269, 26: 265, 27: 264, 28: 271, 29: 272, 30: 273, 31: 274, 32: 275, 33: 276, 34: 277,
              35: 278, 36: 279, 37: 286, 38: 282, 39: 283, 40: 284, 41: 285, 42: 280, 43: 281, 44: 287, 45: 288,
              46: 289, 47: 290, 48: 291, 49: 292, 50: 293, 51: 294, 52: 295, 53: 296, 54: 297, 55: 298, 56: 299,
              57: 300, 58: 301, 59: 302, 60: 303, 61: 304, 62: 305, 63: 306, 64: 307, 65: 308, 66: 309, 67: 310,
              68: 313, 69: 314, 70: 312, 71: 311, 72: 315, 73: 317, 74: 316, 75: 318, 76: 319, 77: 322, 78: 323,
              79: 324, 80: 320, 81: 321}
JH_1976_DIST = [(147, 164, 'SANTHAL PARGANAS'), (262, 270, 'HAZARIBAGH'), (271, 278, 'GIRIDIH'),
                (279, 286, 'DHANBAD'), (287, 300, 'SINGHBHUM'), (301, 315, 'RANCHI'), (316, 324, 'PALAMAU')]


def head_1976(state, n):
    if state == 'Jharkhand':
        b = JH_1976_NO[n]
        return next(name for a, z, name in JH_1976_DIST if a <= b <= z)
    return next(name for a, z, name in HEAD_1976[state] if a <= n <= z)


# Name fixes for line-wrap artefacts of the reprint parse (each checked against the 1976 OCR and the page)
NAME_FIX = {('Assam', 32): 'Bongaigaon', ('Assam', 69): 'Udalguri', ('Manipur', 17): 'Lamsang',
            ('Nagaland', 7): 'Peren', ('Nagaland', 38): 'Wokha', ('Nagaland', 60): 'Pungro-Kiphire'}
RES_FIX = {('Nagaland', 60): 'ST', ('Nagaland', 25): 'ST', ('Nagaland', 26): 'ST', ('Nagaland', 27): 'ST'}
RES_FIX_NOTE = {('Nagaland', 25): "the ECI 2008 compilation prints no '(ST)' after this name (and after 26, 27); ST per the app's ECI results and Wikipedia (59 of 60 Nagaland seats are ST, all but 1 Dimapur-I)",
                ('Nagaland', 26): "see AC 25 on the missing '(ST)' in the 2008 compilation",
                ('Nagaland', 27): "see AC 25 on the missing '(ST)' in the 2008 compilation"}
# expected reserved-seat counts (SC, ST) for the 1976-order assemblies
RES_EXPECTED = {'Assam': (8, 16), 'Manipur': (1, 19), 'Nagaland': (0, 59), 'Jharkhand': (9, 28)}

# Wikipedia district labels (cross-check only) that differ from the CEO labels
WP_ALIAS = {'karimaganj': '317', 'south salmara mankachar': '301', 'marigaon': '304', 'sibsagar': '311',
            'chumoukedima and niuland': '265', 'chumoukedima': '265', 'tseminyu': '270', 'zunheboto': '263',
            'sahibganj': '352', 'kodarma': '348', 'seraikela kharsawan': '369'}

# ----------------------------------------------------------------------------------------------------
# district_2008 (CEO name) -> Census-2011 district code, with lineage note
DISTRICTS = {
    'Assam': {
        'Karimganj': ('317', '2011: 317 Karimganj (renamed Sribhumi in Nov-2024)'),
        'Hailakandi': ('318', '2011: 318 Hailakandi'),
        'Cachar': ('316', '2011: 316 Cachar'),
        'Dima Hasao': ('315', '2011: 315 Dima Hasao (= North Cachar Hills district of the 1976 order, renamed 2010)'),
        'Karbi Anglong': ('314', '2011: 314 Karbi Anglong (= Mikir Hills district of the 1976 order)'),
        'West Karbi Anglong': ('314', 'post-2011 district (2015-16) carved wholly out of Karbi Anglong; continuing code = its 2011 parent 314 Karbi Anglong'),
        'South Salmara-Mankachar': ('301', 'post-2011 district (2015-16) carved wholly out of Dhubri; continuing code = its 2011 parent 301 Dhubri'),
        'Dhubri': ('301', '2011: 301 Dhubri'),
        'Kokrajhar': ('300', '2011: 300 Kokrajhar'),
        'Chirang': ('320', '2011: 320 Chirang (BTAD district of 2004, i.e. before 2011)'),
        'Bongaigaon': ('319', '2011: 319 Bongaigaon'),
        'Goalpara': ('302', '2011: 302 Goalpara'),
        'Barpeta': ('303', '2011: 303 Barpeta'),
        'Bajali': ('303', 'post-2011 district (2020-21) carved out of Barpeta (merged back 31-12-2022, re-created 25-08-2023); continuing code = its 2011 parent 303 Barpeta'),
        'Kamrup': ('321', '2011: 321 Kamrup'),
        'Kamrup Metro': ('322', "2011: 322 Kamrup Metropolitan (CEO short label 'Kamrup Metro')"),
        'Nalbari': ('323', '2011: 323 Nalbari'),
        'Baksa': ('324', '2011: 324 Baksa (BTAD district of 2004, i.e. before 2011)'),
        'Udalguri': ('326', '2011: 326 Udalguri (BTAD district of 2004, i.e. before 2011)'),
        'Darrang': ('325', '2011: 325 Darrang'),
        'Sonitpur': ('306', '2011: 306 Sonitpur'),
        'Biswanath': ('306', 'post-2011 district (2015) carved wholly out of Sonitpur; continuing code = its 2011 parent 306 Sonitpur'),
        'Morigaon': ('304', '2011: 304 Morigaon'),
        'Nagaon': ('305', '2011: 305 Nagaon'),
        'Hojai': ('305', 'post-2011 district (2015) carved wholly out of Nagaon; continuing code = its 2011 parent 305 Nagaon'),
        'Golaghat': ('313', '2011: 313 Golaghat'),
        'Jorhat': ('312', '2011: 312 Jorhat'),
        'Majuli': ('312', 'post-2011 district (2016) = the Majuli sub-division/circle of Jorhat; continuing code = its 2011 parent 312 Jorhat'),
        'Sivasagar': ('311', '2011: 311 Sivasagar'),
        'Charaideo': ('311', 'post-2011 district (2015) carved wholly out of Sivasagar; continuing code = its 2011 parent 311 Sivasagar'),
        'Lakhimpur': ('307', '2011: 307 Lakhimpur'),
        'Dhemaji': ('308', '2011: 308 Dhemaji'),
        'Dibrugarh': ('310', '2011: 310 Dibrugarh'),
        'Tinsukia': ('309', '2011: 309 Tinsukia'),
    },
    'Manipur': {
        'Imphal East': ('278', '2011: 278 Imphal East'),
        'Imphal West': ('277', '2011: 277 Imphal West'),
        'Bishnupur': ('275', '2011: 275 Bishnupur'),
        'Thoubal': ('276', '2011: 276 Thoubal (the CEO still files ACs 36-39 of the 2016 Kakching district under Thoubal; both are 276 in 2011)'),
        'Jiribam': ('278', 'post-2011 district (Dec-2016) = Jiribam sub-division of Imphal East; continuing code = its 2011 parent 278 Imphal East'),
        'Chandel': ('280', '2011: 280 Chandel (AC 42 Tengnoupal lies in the 2016 Tengnoupal district, also 280 in 2011)'),
        'Ukhrul': ('279', '2011: 279 Ukhrul (AC 43 Phungyar lies in the 2016 Kamjong district, also 279 in 2011)'),
        'Kangpokpi': ('272', 'post-2011 district (Dec-2016) = Sadar Hills of Senapati; continuing code = its 2011 parent 272 Senapati'),
        'Senapati': ('272', '2011: 272 Senapati'),
        'Tamenglong': ('273', '2011: 273 Tamenglong (AC 54 Nungba lies in the 2016 Noney district, also 273 in 2011)'),
        'Churachandpur': ('274', '2011: 274 Churachandpur (ACs 55-56 lie in the 2016 Pherzawl district, also 274 in 2011)'),
    },
    'Nagaland': {
        'Dimapur': ('265', '2011: 265 Dimapur'),
        'Chumoukedima': ('265', 'post-2011 district (Dec-2021) carved out of Dimapur (Niuland district of the same date also from Dimapur); continuing code = its 2011 parent 265 Dimapur'),
        'Peren': ('271', '2011: 271 Peren'),
        'Kohima': ('270', '2011: 270 Kohima'),
        'Tseminyu': ('270', 'post-2011 district (Dec-2021) = Tseminyu sub-division of Kohima; continuing code = its 2011 parent 270 Kohima'),
        'Pughoboto': ('263', "CEO 'election district' under the ADC Pughoboto, not a revenue district; Census 2011 lists the Pughoboto and Ghathashi circles (sub-districts 01775, 01776) in 263 Zunheboto, so its 2011 district is 263 (the 1976 order filed this AC under Kohima, the circle having been in Kohima Sadar sub-division in 1975)"),
        'Phek': ('266', '2011: 266 Phek (AC 20 Meluri lies in the post-2011 Meluri district, also 266 in 2011; the CEO still files it under Phek)'),
        'Mokokchung': ('262', '2011: 262 Mokokchung'),
        'Zunheboto': ('263', '2011: 263 Zunheboto'),
        'Wokha': ('264', '2011: 264 Wokha'),
        'Mon': ('261', '2011: 261 Mon (includes ACs 48 Moka and 55 Tobu: the Tobu/Mopong circles are in Mon in Census 2011 although the 1976 order filed both ACs under Tuensang)'),
        'Longleng': ('268', '2011: 268 Longleng (district of 2004, i.e. before 2011)'),
        'Tuensang': ('267', '2011: 267 Tuensang'),
        'Kiphire': ('269', '2011: 269 Kiphire (district of 2004, i.e. before 2011)'),
        'Noklak': ('267', 'post-2011 district (2017) carved out of Tuensang; continuing code = its 2011 parent 267 Tuensang'),
        'Shamator': ('267', 'post-2011 district (c. 2021-22) carved out of Tuensang; continuing code = its 2011 parent 267 Tuensang'),
    },
    'Jharkhand': {
        'Sahebganj': ('352', "2011: 352 Sahibganj (Census spelling 'Sahibganj')"),
        'Pakur': ('353', '2011: 353 Pakur'),
        'Dumka': ('362', '2011: 362 Dumka'),
        'Jamtara': ('363', '2011: 363 Jamtara'),
        'Deoghar': ('350', '2011: 350 Deoghar'),
        'Godda': ('351', '2011: 351 Godda'),
        'Koderma': ('348', "2011: 348 Kodarma (Census spelling 'Kodarma')"),
        'Hazaribagh': ('360', '2011: 360 Hazaribagh'),
        'Ramgarh': ('361', '2011: 361 Ramgarh (district of 2007, i.e. before 2011)'),
        'Chatra': ('347', '2011: 347 Chatra'),
        'Giridih': ('349', '2011: 349 Giridih'),
        'Bokaro': ('355', '2011: 355 Bokaro'),
        'Dhanbad': ('354', '2011: 354 Dhanbad'),
        'East Singhbhum': ('357', "2011: 357 Purbi Singhbhum (Census spelling)"),
        'Seraikella-Kharsawan': ('369', "2011: 369 Saraikela-Kharsawan (Census spelling)"),
        'West Singhbhum': ('368', "2011: 368 Pashchimi Singhbhum (Census spelling)"),
        'Ranchi': ('364', '2011: 364 Ranchi'),
        'Khunti': ('365', '2011: 365 Khunti (district of 2007, i.e. before 2011)'),
        'Gumla': ('366', '2011: 366 Gumla'),
        'Simdega': ('367', '2011: 367 Simdega'),
        'Lohardaga': ('356', '2011: 356 Lohardaga'),
        'Latehar': ('359', '2011: 359 Latehar'),
        'Palamu': ('358', '2011: 358 Palamu'),
        'Garhwa': ('346', '2011: 346 Garhwa'),
    },
}

# ----------------------------------------------------------------------------------------------------
# Cross-district territory, from the 1976 extents read against the Census-2011 sub-district table.
# ALSO = documented; POSSIBLE = plausible, unverified.  {ac: (codes, explanation)}
ALSO = {
    'Assam': {
        8: ('316', 'extent includes circle Nos. 23 and 24 of Silchar thana, Silchar sub-division (Cachar)'),
        39: ('301', 'extent includes villages of South Salmara thana, Dhubri sub-division (South Salmara circle is in Dhubri in 2011)'),
        42: ('323', 'extent includes Tihu mouza of Barama thana, Nalbari sub-division (Tihu circle: Nalbari 67,656 / Baksa 17,508 persons in 2011)'),
        51: ('321', 'extent includes Pub-Bongsor mouza (Hajo thana), Borbongsor mouza (Kamalpur thana) and parts of Sila Sinduri Ghopa mouza, i.e. rural Kamrup (North Guwahati circle is split Kamrup 48,227 / Kamrup Metropolitan 28,400 in 2011)'),
        80: ('305', 'extent includes Barapujia mouza of Raha thana, Nowgong sub-division (Nagaon)'),
        83: ('304', 'extent includes Moirabari mouza of Laharighat thana, Marigaon sub-division (Morigaon)'),
        84: ('304', 'extent includes Silpukhuri mouza of Mikirbheta thana, Marigaon sub-division (Morigaon)'),
        97: ('313', 'extent = Dergaon and Kakodanga mouzas of Dergaon thana, Golaghat sub-division (Dergaon circle is in Golaghat in 2011) + 4 mouzas of Jorhat thana, Jorhat sub-division'),
        121: ('309', 'extent includes Rangagora, Ghorbondi (part) and Bogdung (part) mouzas of Tinsukia thana in Tinsukia sub-division (Tinsukia)'),
    },
    'Manipur': {
        6: ('272', '11 villages of Sadar Hills East sub-division, Manipur North district (Senapati in 2011) - a sliver'),
        8: ('272', '11 villages of Sadar Hills East sub-division, Manipur North district (Senapati in 2011) - a sliver'),
        9: ('272', '2 villages (Tharon, Langol Tarun) of Sadar Hills West sub-division (Senapati in 2011) - a sliver'),
        20: ('272', '3 Langthabal villages of Sadar Hills East sub-division (Senapati in 2011) - a sliver'),
        24: ('272', '2 villages of Sadar Hills West sub-division (Senapati in 2011) - a sliver'),
        25: ('272', '1 village (Chingkha Oinam Kabui) of Sadar Hills West sub-division (Senapati in 2011) - a sliver'),
        30: ('272', '1 village (Chingkham Kabui) of Sadar Hills East sub-division (Senapati in 2011) - a sliver'),
        32: ('272', '2 villages (Chaobok Kabui, Lisamlok) of Sadar Hills East sub-division (Senapati in 2011) - a sliver'),
        33: ('272', '2 villages (Saram Tangkhul, Kwarok Maring) of Sadar Hills East sub-division (Senapati in 2011) - a sliver'),
    },
    'Nagaland': {
        4: ('271', '1 village (Kiyevi) of Jaluke circle, Jaluke sub-division (Peren in 2011) - a sliver'),
        5: ('271', '1 village (Maowa) of Pedi circle, Jaluke sub-division (Peren in 2011) - a sliver'),
        57: ('269', '5 villages of Pungro circle, Kiphire sub-division (Kiphire in 2011) - a sliver'),
    },
    'Jharkhand': {
        2: ('351', 'extent includes Boarijor police station (less 5 GPs), Godda sub-division (Boarijor block is in Godda in 2011)'),
        3: ('351', 'extent includes Sundarpahari police station + 5 GPs of Boarijor PS, Godda sub-division (Godda)'),
        4: ('362', 'extent includes Gopikandar police station, Dumka Sadar sub-division (Dumka)'),
        5: ('352', 'extent includes Barharwa police station, Rajmahal sub-division (Barharwa block is in Sahibganj in 2011)'),
        12: ('350', 'extent includes Sarawan police station, Deoghar sub-division (Sarwan block is in Deoghar in 2011)'),
        14: ('363', 'extent includes 7 GPs (Karmatanr etc.) of Jamtara police station (Karma Tanr Vidyasagar block, Jamtara)'),
        16: ('362', 'extent includes Saraiyahat police station, Dumka Sadar sub-division (Dumka)'),
        20: ('348', 'extent includes Jainagar police station, Kodarma sub-division (Jainagar block is in Kodarma in 2011)'),
        22: ('360', 'extent = Barkagaon police station (Barkagaon + Keredari blocks, Hazaribagh) + 18 GPs of Ramgarh PS (Patratu area, Ramgarh)'),
        24: ('361', 'extent = Mandu police station (Mandu block, Ramgarh) + Bishungarh police station (Hazaribagh)'),
        33: ('355', 'extent includes Nawadih police station, Bermo sub-division (Nawadih block is in Bokaro in 2011)'),
        57: ('368', 'extent includes 10 GPs of Chaibasa Mufassil police station, Chaibasa Sadar sub-division (Pashchimi Singhbhum)'),
        58: ('365', 'extent = Tamar, Erki and Bundu police stations; Erki = Erki (Tamar II) block of Khunti in 2011'),
        59: ('367', 'extent includes Bano police station, Simdega sub-division (Bano block is in Simdega in 2011)'),
        69: ('356', 'extent includes Senha police station, Lohardaga sub-division (Lohardaga)'),
        70: ('366', 'extent includes Palkot police station, Gumla sub-division (Gumla)'),
        76: ('346', 'extent includes Bhandaria police station, Garhwa sub-division (Garhwa)'),
        77: ('346', 'extent includes Majhiaon police station, Garhwa sub-division (Garhwa)'),
    },
}
POSSIBLE = {
    'Assam': {
        24: ('300', 'villages of Golakganj and Bilasipara thanas; Golokganj and Bilasipara circles are split with Kokrajhar in 2011; overlay 61% Kokrajhar'),
        25: ('300', 'Golokganj circle split Dhubri 192,587 / Kokrajhar 26,671 in 2011; overlay 19% Kokrajhar'),
        26: ('300', "Sapatgram town committee lay 'in Dhubri and Kokrajhar sub-divisions' (1976 text); Bilasipara and Chapar circles split with Kokrajhar in 2011; overlay 32% Kokrajhar"),
        27: ('300', 'Bilasipara (8,736) and Chapar (20,425) circle parts are in Kokrajhar in 2011; overlay 16% Kokrajhar'),
        28: ('301', 'Gossaigaon circle split Kokrajhar 270,952 / Dhubri 53,842 in 2011'),
        29: ('301', 'villages of Gossaigaon thana; Gossaigaon circle split with Dhubri in 2011'),
        31: ('319;300', 'Sidli circle split Chirang 158,881 / Bongaigaon 58,371 in 2011; also villages of Kokrajhar thana (overlay 27% Kokrajhar)'),
        32: ('320', 'Bongaigaon thana (part) lay in Kokrajhar sub-division in 1975; Bongaigaon circle split with Chirang in 2011; overlay 57% Chirang'),
        33: ('319', 'Bijni circle split Chirang 233,586 / Bongaigaon 130,242 in 2011'),
        34: ('320', 'villages of Bijni thana (Kokrajhar sub-division in 1975); Bijni circle split with Chirang in 2011'),
        40: ('324', 'Barnagar circle split Barpeta 234,235 / Baksa 139,149 / Chirang 9,500 in 2011; overlay 75% Baksa'),
        41: ('324', 'Sarupeta circle split Barpeta 129,853 / Baksa 55,011 in 2011; overlay 72% Baksa'),
        42: ('324', 'Tihu mouza (Tihu circle split Nalbari / Baksa in 2011); Bajali and Sarupeta circles split with Baksa'),
        50: ('322', 'Palasbari thana adjoins the Azara circle of Kamrup Metropolitan; overlay 30% Kamrup Metropolitan'),
        54: ('321', 'Dakhin Rani, Ram Charani and Bholagaon mouzas of Palasbari thana (rural Kamrup); overlay 20% Kamrup'),
        56: ('324', 'Rangia circle split Kamrup 155,333 / Baksa 14,357 in 2011; overlay 42% Baksa'),
        57: ('324', 'Rangia and Goreswar circles split Kamrup / Baksa in 2011; overlay 22% Baksa'),
        62: ('323', 'Barama circle split Baksa 49,715 / Nalbari 13,642 in 2011'),
        63: ('303', 'Chapaguri/Kaklabari mouzas of Patacharkuchi thana (Barpeta sub-division); Jalah circle split Baksa 81,979 / Barpeta 21,538 in 2011'),
        65: ('326', 'Kalaigaon circle split Udalguri 85,616 / Darrang 25,246 in 2011; overlay 61% Udalguri'),
        68: ('326', 'Dalgaon circle split Darrang 473,585 / Udalguri 52,627 in 2011'),
        70: ('325', 'Orang (part) mouza of Dalgaon thana (Dalgaon circle split Darrang / Udalguri in 2011); overlay 10% Darrang'),
        112: ('308', 'Gohain and Dhakuakhana mouzas of Dhakuakhana thana (Dhemaji sub-division in 1975); Dhakuakhana circle split Lakhimpur 114,295 / Dhemaji 29,575 in 2011; overlay 22% Dhemaji'),
        113: ('307', 'most of Dhakuakhana thana (Dhemaji sub-division in 1975); Dhakuakhana and Subansiri circles are mostly in Lakhimpur in 2011'),
    },
    'Manipur': {},
    'Nagaland': {},
    'Jharkhand': {},
}

# CEO list anomalies worth recording on the row
ROW_NOTES = {
    ('Nagaland', 13): "1976 order filed this AC under KOHIMA (Pughoboto circle then in Kohima Sadar sub-division); in Census 2011 the Pughoboto and Ghathashi circles are in 263 Zunheboto",
    ('Nagaland', 48): "1976 order filed this AC under TUENSANG; its Champang-circle villages (Mon sub-division) and Tobu-circle villages are in 261 Mon in Census 2011 (CEO files it under Mon)",
    ('Nagaland', 55): "1976 order filed this AC under TUENSANG; the Tobu circle is in 261 Mon in Census 2011 (CEO files it under Mon)",
    ('Assam', 97): "CEO 2021 files Dergaon under Jorhat (election district 9-Jorhat) although most of it is the Dergaon circle of Golaghat",
    ('Jharkhand', 22): "CEO files Barkagaon under Ramgarh although Barkagaon and Keredari blocks are in Hazaribagh",
    ('Jharkhand', 24): "CEO files Mandu under Hazaribagh although Mandu block itself is in Ramgarh",
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load_census_districts():
    out = collections.defaultdict(dict)
    with open(PCA, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if r['tru'] == 'Total':
                out[r['state_name'].strip().upper()][r['district_code']] = r['district_name'].strip()
    return out


def load_app():
    with open(APP, encoding='utf-8') as f:
        d = json.load(f)
    by = collections.defaultdict(dict)
    for r in d:
        by[(r['s'], r['y'])][r['n']] = r
    return by


def load_overlay():
    ov = collections.defaultdict(dict)
    with open(OVERLAY, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if r['layer'] == 'AC':
                ov[(r['geo_state'], int(r['seat_no']))][r['district_code']] = float(r['share'])
    return ov


def appnorm(s):
    s = re.sub(r'\((SC|ST)\)', '', s.upper())
    return re.sub(r'[^A-Z]', '', s)


def ceo_rows(state):
    if state == 'Assam':
        return parse_assam_ceo_2021(), []
    if state == 'Manipur':
        return parse_manipur_ceo_eros(), []
    if state == 'Nagaland':
        return parse_nagaland_ceo_ps()
    return parse_jharkhand_ceo_acpc(), []


def main():
    log = []

    def L(level, msg):
        log.append(f'{level:<5}| {msg}')

    census = load_census_districts()
    app = load_app()
    overlay = load_overlay()
    summary = {}

    for state in STATES:
        slug = SLUG[state]
        n = N_SEATS[state]
        log.append(f'\n== {state} ({n} ACs; deferred delimitation, 1976 Order in force)')
        ceo, anomalies = ceo_rows(state)
        ceo = {r['ac_no']: r for r in ceo}
        rep = parse_reprint(state)
        partb = dpaco_partb(state)
        partb_norm = norm(partb)
        partb_tokens = token_set(partb)
        cdist = census[CENSUS_STATE[state]]
        dmap = DISTRICTS[state]

        # ---- completeness
        nums = sorted(ceo)
        ok = nums == list(range(1, n + 1))
        L('OK' if ok else 'FAIL', f'{state}: CEO list AC numbers contiguous 1..{n} (got {len(nums)}, first {nums[:1]}, last {nums[-1:]})')
        ok2 = all(rep.get(k) for k in range(1, n + 1))
        L('OK' if ok2 else 'FAIL', f'{state}: 1976-order schedule (as reprinted) parsed 1..{n} = {sum(1 for k in range(1, n + 1) if rep.get(k))}')
        for a in anomalies:
            L('INFO', f'{state}: AC {a[0]} appears in more than one CEO file {a[1]} -> used {a[2]} (the 9 pages 11-19 appended to '
                      f'the Zunheboto PDF repeat ACs 49-58 of the Longleng/Tuensang/Noklak/Shamator files; one header there even misprints 51 as Noklak)')

        # ---- name verification: reprint name present in the 1976 OCR text
        name_ok, name_fuzzy = 0, []
        for k in range(1, n + 1):
            nm = NAME_FIX.get((state, k), rep[k]['name'])
            nn = norm(nm)
            if nn and nn in partb_norm:
                name_ok += 1
            else:
                # fuzzy: best ratio over windows of the same length
                best = 0.0
                L_ = len(nn)
                for i in range(0, max(1, len(partb_norm) - L_), 3):
                    r_ = difflib.SequenceMatcher(None, nn, partb_norm[i:i + L_]).ratio()
                    if r_ > best:
                        best = r_
                        if best > 0.95:
                            break
                name_fuzzy.append((k, nm, round(best, 2)))
        L('OK' if name_ok + sum(1 for x in name_fuzzy if x[2] >= 0.7) == n else 'WARN',
          f'{state}: AC names found verbatim in the 1976 OCR text {name_ok}/{n}; OCR-noisy (best fuzzy window) {name_fuzzy}')

        # ---- extents: reprint extent tokens contained in the 1976 OCR text
        cont = []
        for k in range(1, n + 1):
            tk = token_set(rep[k].get('extent', ''))
            tk = {t for t in tk if len(t) >= 4}
            if tk:
                cont.append(len(tk & partb_tokens) / len(tk))
        cont.sort()
        med = cont[len(cont) // 2]
        L('OK' if med >= 0.85 else 'WARN',
          f'{state}: 2008-compilation extents vs 1976 OCR - share of extent words (>=4 letters) found in the 1976 schedule text: '
          f'median {med:.2f}, min {cont[0]:.2f} (OCR noise only; the 2008 compilation reprints the 1976 schedule)')

        # ---- build rows
        rows = []
        used_dist = collections.Counter()
        for k in range(1, n + 1):
            c = ceo[k]
            d = c['district'].replace(' Revenue', '').strip()
            if d not in dmap:
                L('FAIL', f'{state}: AC {k} district {d!r} not in lineage table')
                continue
            used_dist[d] += 1
            code = dmap[d][0]
            name = NAME_FIX.get((state, k), rep[k]['name'])
            res = c.get('reserved') or RES_FIX.get((state, k)) or rep[k]['reserved']
            notes = []
            if res:
                notes.append(f'reserved={res}')
            if (state, k) in RES_FIX_NOTE:
                notes.append(RES_FIX_NOTE[(state, k)])
            if c.get('reserved') and rep[k]['reserved'] and c['reserved'] != rep[k]['reserved']:
                notes.append(f"order compilation prints reserved={rep[k]['reserved']}")
            if k in ALSO[state]:
                codes, why = ALSO[state][k]
                notes.append(f'also_2011={codes}')
            if k in POSSIBLE[state]:
                pc, pwhy = POSSIBLE[state][k]
                notes.append(f'possible_2011={pc}')
            if k in ALSO[state]:
                notes.append('also: ' + ALSO[state][k][1])
            if k in POSSIBLE[state]:
                notes.append('possible: ' + POSSIBLE[state][k][1])
            if (state, k) in ROW_NOTES:
                notes.append(ROW_NOTES[(state, k)])
            if state == 'Jharkhand':
                notes.append(f'1976 order: Bihar AC {JH_1976_NO[k]}, {head_1976(state, k)} district')
            else:
                notes.append(f'1976 order heading: {head_1976(state, k)} district')
            if state == 'Assam' and c.get('sub'):
                notes.append(f"CEO election district: {c['sub']}")
            if c.get('district_note'):
                notes.append(c['district_note'])
            ceo_nm = c['name']
            if state == 'Jharkhand' and c.get('pc_side_name') and appnorm(c['pc_side_name']) == appnorm(name) \
                    and appnorm(ceo_nm) != appnorm(name):
                notes.append(f"CEO district-wise table prints '{ceo_nm}' (its PC-wise table prints '{c['pc_side_name']}')")
            elif appnorm(ceo_nm) != appnorm(name):
                notes.append(f"CEO spelling '{ceo_nm}'")
            src = SOURCE[state]
            page = c['page']
            if state == 'Nagaland':
                page = f"{c['file']} p.{c['page']}"
            rows.append({'state': state, 'ac_no': k, 'ac_name': name, 'district_2008': d, 'source': src,
                         'page': page, 'note': '; '.join(notes)})

        # ---- write ACs
        with open(os.path.join(HERE, f'{slug}_acs.csv'), 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=['state', 'ac_no', 'ac_name', 'district_2008', 'source', 'page', 'note'])
            w.writeheader()
            w.writerows(rows)
        L('OK' if len(rows) == n else 'FAIL', f'{state}: wrote {slug}_acs.csv rows {len(rows)} (expected {n})')

        # ---- write districts
        drows = []
        for d, (code, why) in dmap.items():
            if d not in used_dist:
                continue
            note = f'{why}; {used_dist[d]} ACs'
            drows.append({'state': state, 'district_2008': d, 'continuing_2011_code': code,
                          'carved_2011_codes': '', 'note': note})
        unused = [d for d in dmap if d not in used_dist]
        with open(os.path.join(HERE, f'{slug}_districts.csv'), 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=['state', 'district_2008', 'continuing_2011_code', 'carved_2011_codes', 'note'])
            w.writeheader()
            w.writerows(drows)
        L('OK', f'{state}: wrote {slug}_districts.csv: {len(drows)} CEO districts (lineage entries unused: {unused})')

        # ---- district codes valid + coverage
        codes_used = {r['continuing_2011_code'] for r in drows}
        extra = set()
        for k in ALSO[state].values():
            extra |= set(k[0].split(';'))
        for k in POSSIBLE[state].values():
            extra |= set(k[0].split(';'))
        bad = sorted((codes_used | extra) - set(cdist))
        L('OK' if not bad else 'FAIL', f'{state}: every code used (continuing + also + possible) is a real Census-2011 district of '
                                       f'{CENSUS_STATE[state]}; bad={bad}')
        uncovered = sorted(set(cdist) - codes_used)
        L('OK' if not uncovered else 'FAIL', f'{state}: every Census-2011 district ({len(cdist)}) appears as a continuing code; '
                                             f'uncovered={[(u, cdist[u]) for u in uncovered]}')
        carved = {}
        for r in drows:
            if r['carved_2011_codes']:
                carved[r['district_2008']] = r['carved_2011_codes']
        L('INFO', f'{state}: carved_2011_codes are empty by construction - the CEO district names are all 2011-or-later '
                  f'entities, so no 2011 district was carved out of any of them; post-2011 districts map back to their 2011 '
                  f'parent as continuing code')

        # ---- name agreement with the app
        yr = APP_YEAR[state]
        a = app.get((state, yr), {})
        L('OK' if sorted(a) == list(range(1, n + 1)) else 'FAIL', f'{state}: app seats_ae {yr} has {len(a)} seats (n 1..{max(a) if a else 0})')
        agree = 0
        mism = []
        app_names = {k: appnorm(v['c']) for k, v in a.items()}
        for r in rows:
            k = r['ac_no']
            on = appnorm(r['ac_name'])
            an = app_names.get(k, '')
            if on == an:
                agree += 1
                continue
            sim = difflib.SequenceMatcher(None, on, an).ratio()
            best_other = max(((difflib.SequenceMatcher(None, on, v).ratio(), kk) for kk, v in app_names.items() if kk != k),
                             default=(0, None))
            ceo_n = appnorm(ceo[k]['name'])
            verdict = 'spelling variant' if sim >= best_other[0] else f'CHECK: closer app name at n={best_other[1]}'
            mism.append((k, r['ac_name'], a[k]['c'] if k in a else None, round(sim, 2), verdict,
                         'CEO=app' if ceo_n == an else ''))
        pct = 100.0 * agree / n
        summary[state] = {'agree': agree, 'pct': round(pct, 1), 'mism': mism}
        L('INFO', f'{state}: name agreement vs app {yr} = {agree}/{n} ({pct:.1f}%); mismatches {len(mism)}')
        for m in mism:
            L('', f'       MISMATCH {state} AC {m[0]}: order {m[1]!r} vs app {m[2]!r} (sim {m[3]}) -> {m[4]} {m[5]}')

        # ---- reservation vs app
        rdiff = []
        for r in rows:
            mres = re.search(r'reserved=(SC|ST)', r['note'])
            ours = mres.group(1) if mres else 'GEN'
            theirs = a.get(r['ac_no'], {}).get('r')
            if theirs and theirs != ours:
                rdiff.append((r['ac_no'], ours, theirs))
        L('INFO', f'{state}: reservation (CEO list where it prints one, else the order) vs app {yr} r-flag (ours, app): '
                  f'{len(rdiff)} differ {rdiff}')

        # ---- reserved-seat counts and CEO-vs-order reservation
        sc = sum(1 for r in rows if 'reserved=SC' in r['note'])
        stn = sum(1 for r in rows if 'reserved=ST' in r['note'])
        L('OK' if (sc, stn) == RES_EXPECTED[state] else 'WARN',
          f'{state}: reserved seats SC={sc} ST={stn} (expected SC={RES_EXPECTED[state][0]} ST={RES_EXPECTED[state][1]})')
        rd = []
        for k in range(1, n + 1):
            cr, orr = ceo[k].get('reserved', ''), rep[k]['reserved']
            if cr and cr != orr:
                rd.append((k, cr, orr))
        L('INFO', f'{state}: CEO-printed reservation vs order compilation (ac, CEO, order): {rd}')

        # ---- Wikipedia cross-check (facts only; not a value source)
        wpf = os.path.join(RAW, f'wikipedia_crosscheck_{slug}.csv')
        if os.path.exists(wpf):
            import unicodedata
            wp = {}
            for r_ in csv.DictReader(open(wpf, encoding='utf-8')):
                wp[int(r_['ac_no'])] = r_
            agree_d, dis_d, agree_r, dis_r = 0, [], 0, []
            for r in rows:
                k = r['ac_no']
                w_ = wp.get(k)
                if not w_:
                    continue
                lab = unicodedata.normalize('NFKD', w_['district']).encode('ascii', 'ignore').decode().lower().strip()
                code_wp = WP_ALIAS.get(lab) or next((v[0] for kk, v in dmap.items() if kk.lower() == lab), None)
                ours = dmap[r['district_2008']][0]
                extra_codes = set()
                for tok in ('also_2011', 'possible_2011'):
                    mt = re.search(tok + r'=([\d;]+)', r['note'])
                    if mt:
                        extra_codes |= set(mt.group(1).split(';'))
                if code_wp == ours:
                    agree_d += 1
                else:
                    dis_d.append((k, r['ac_name'], r['district_2008'], w_['district'], code_wp,
                                  'wp code is in our also/possible set' if code_wp in extra_codes else 'NOT in also/possible'))
                mres = re.search(r'reserved=(SC|ST)', r['note'])
                if (mres.group(1) if mres else '') == w_['reservation']:
                    agree_r += 1
                else:
                    dis_r.append((k, mres.group(1) if mres else '', w_['reservation']))
            L('OK' if agree_d >= n - 3 else 'WARN', f'{state}: Census-2011 district code agrees with Wikipedia cross-check {agree_d}/{n}; '
                                                    f'differences {dis_d}')
            L('OK' if not dis_r else 'INFO', f'{state}: reservation agrees with Wikipedia {agree_r}/{n}; differences {dis_r}')

        # ---- overlay check (does the official list agree with the polygon overlay?)
        geo = CENSUS_STATE[state]
        strict_low, lenient_low = [], []
        for r in rows:
            k = r['ac_no']
            o = overlay.get((geo, k), {})
            allowed = {dmap[r['district_2008']][0]}
            mm = re.search(r'also_2011=([\d;]+)', r['note'])
            if mm:
                allowed |= set(mm.group(1).split(';'))
            s_strict = sum(v for c_, v in o.items() if c_ in allowed)
            mp = re.search(r'possible_2011=([\d;]+)', r['note'])
            if mp:
                allowed |= set(mp.group(1).split(';'))
            s_len = sum(v for c_, v in o.items() if c_ in allowed)
            if s_strict < 0.5:
                strict_low.append((k, r['ac_name'], r['district_2008'], {c_: round(v, 2) for c_, v in o.items()}))
            if s_len < 0.999:
                lenient_low.append((k, round(s_len, 2)))
        L('INFO', f'{state}: polygon overlay puts <50% of the AC inside district_2008 (+also) for {len(strict_low)} ACs - '
                  f'these are the placements the veto corrects: {strict_low}')
        L('INFO', f'{state}: overlay share outside district_2008+also+possible (any amount) for {len(lenient_low)} ACs: {lenient_low}')

    # ---- sources manifest
    files = []
    for root, _, fs in os.walk(RAW):
        for fn in sorted(fs):
            if fn == 'SOURCES_g6.json':
                continue
            p = os.path.join(root, fn)
            files.append({'file': os.path.relpath(p, HERE).replace('\\', '/'), 'bytes': os.path.getsize(p), 'sha256': sha256(p)})
    files.append({'file': os.path.relpath(ORDER2008, HERE).replace('\\', '/'), 'bytes': os.path.getsize(ORDER2008),
                  'sha256': sha256(ORDER2008), 'note': 'shared raw (fetched by ac_district_lists); reading aid only'})
    meta = json.load(open(os.path.join(RAW, 'SOURCES_g6.meta.json'), encoding='utf-8'))
    for f_ in files:
        f_.update(meta.get(f_['file'].split('/')[-1], {}) if f_['file'].startswith('raw_g6') else {})
        if f_['file'].startswith('raw_g6/nagaland_ceo_ps/'):
            f_.update(meta.get('nagaland_ceo_ps/*', {}))
            f_['url'] = 'https://ceo.nagaland.gov.in/media/polling_stations/' + f_['file'].split('/')[-1].replace(' ', '%20')
    with open(os.path.join(RAW, 'SOURCES_g6.json'), 'w', encoding='utf-8') as f:
        json.dump({'fetched_by': 'plain public HTTPS GET (curl); no login, no cookies, no API keys', 'files': files}, f, indent=1)

    with open(os.path.join(HERE, 'g6_validation.txt'), 'w', encoding='utf-8') as f:
        f.write('g6 validation - Assam, Manipur, Nagaland, Jharkhand (deferred delimitation; 1976 Order ACs)\n')
        f.write('Generated by build_g6_as_mn_nl_jh.py\n')
        f.write("NB: the ECI 2008 compilation ('Delimitation of Parliamentary and Assembly Constituencies Order, 2008') does NOT\n"
                "contain unimplemented 2008 schedules for these four states: its Schedules V (Assam), XIII (Jharkhand), XVIII\n"
                "(Manipur) and XXI (Nagaland) RE-PRINT the 1976 extents that stayed in force (Jharkhand renumbered 1-81). It was\n"
                "used only as a clean-text reading aid for the OCR of the 1976 print; the checks below show the two agree.\n"
                "Note tokens: also_2011=<codes>     documented cross-district territory (from the 1976 extents);\n"
                "             possible_2011=<codes> plausible, unverified (Census-2011 split circles / polygon overlay).\n")
        f.write('\n'.join(log) + '\n')
    sys.stdout.reconfigure(encoding='utf-8')
    print('\n'.join(log))
    out = os.environ.get('G6_SUMMARY')
    if out:
        json.dump(summary, open(out, 'w', encoding='utf-8'), indent=1)


if __name__ == '__main__':
    main()
