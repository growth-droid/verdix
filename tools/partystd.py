"""Borrow build_extracts.py's party-name standardiser without running its pipeline.

build_extracts.py has no `if __name__ == '__main__'` guard — importing it regenerates every extract
as a side effect. `std()` is the canonical full-name -> app-code mapper (FULLNAME + _canon +
CODEFIX) and the candidate overlay needs exactly that, so exec the module with file reads blocked
and stop at the first one, by which point std() is defined.

Party codes are canonical and `scripts/alliances.py::canon` is the only place to change them
(India Elections/CLAUDE.md, convention 3), so this never invents a code — EXTRA below only covers
names the workbooks have never seen, because those elections are exactly the ones missing from them.
"""
import builtins, gzip, io, os

_HERE = os.path.dirname(os.path.abspath(__file__))

class _Stop(Exception):
    pass

def _blocked(*a, **k):
    raise _Stop()

# Parties appearing only in the 16 elections the workbooks lack, so std() has never met them.
# Every code here is the app's existing code for that party where one exists (checked against
# src/lib/colors.ts and the shipped extracts) — nothing is invented.
EXTRA = {
    'none of the above': 'NOTA',
    'nota': 'NOTA',
    'mizo national front': 'MNF',
    'zoram people’s movement': 'ZPM',
    'zoram peoples movement': 'ZPM',
    'lok janshakti party (ram vilas)': 'LJP(RV)',
    'lok jan shakti party (ram vilas)': 'LJP(RV)',
    'jammu & kashmir national conference': 'JKNC',
    'jammu and kashmir national conference': 'JKNC',
    'j&k national conference': 'JKNC',
    'jammu & kashmir peoples democratic party': 'JKPDP',
    'jammu and kashmir peoples democratic party': 'JKPDP',
    'jammu & kashmir apni party': 'JKAP',
    'communist party of india (marxist-leninist) (liberation)': 'CPI(ML)L',
    'communist party of india (marxist-leninist)(liberation)': 'CPI(ML)L',
    'communist party of india (marxist-leninist)': 'CPI(ML)L',
    'cpi(m)': 'CPM',
    'cpi(ml)(l)': 'CPI(ML)L',
    'rashtriya lok morcha': 'RLM',
    'hindustani awam morcha (secular)': 'HAM(S)',
    'vikassheel insaan party': 'VIP',
    'indian union muslim league': 'IUML',
    'kerala congress (m)': 'KEC(M)',
    'revolutionary socialist party': 'RSP',
    'all india forward bloc': 'AIFB',
    'sikkim krantikari morcha': 'SKM',
    'asom gana parishad': 'AGP',
    'all india united democratic front': 'AIUDF',
    'united peoples party liberal': 'UPPL',
    "united people's party, liberal": 'UPPL',
    'bodoland peoples front': 'BPF',
    'raijor dal': 'RD',
    'assam jatiya parishad': 'AJP',
    'jharkhand mukti morcha': 'JMM',
    'all jharkhand students union': 'AJSU',
    'janasena party': 'JSP',
    'indian national lok dal': 'INLD',
    'jannayak janta party': 'JJP',
    'azad samaj party (kanshi ram)': 'ASP(KR)',
    'bharat adivasi party': 'BAP',
    'rashtriya loktantrik party': 'RLP',
    # every entry below was produced by diffing this overlay's winners against the app's own
    # recorded winner for the same seat — each is a naming variant, never a re-mapping
    'jp': 'JSP',                                    # Janasena Party, as Andhra's source writes it
    'janasena': 'JSP',
    'all india n.r. congress': 'AINRC',
    'all india nr congress': 'AINRC',
    'kerala congress': 'KEC',
    'kerala congress (jacob)': 'KEC(J)',
    'tamilaga vettri kazhagam': 'TVK',
    'ajsu party': 'AJSU',
    'all jharkhand students union party': 'AJSU',
    'lok janshakti party(ram vilas)': 'LJP(RV)',
    'jharkhand loktantrik krantikari morcha': 'JLKM',
    'jammu & kashmir people conference': 'JKPC',
    'jammu and kashmir people conference': 'JKPC',
    'jammu & kashmir peoples conference': 'JKPC',
    'indian inclusive party': 'IIP',
    'revolutionary marxist party of india': 'RMPI',
    'communist marxist party kerala state committee': 'CMP',
    'latchiya jananayaka katchi (ljk)': 'LJK',
    'latchiya jananayaka katchi': 'LJK',
    'neyam makkal kazhagam': 'NMK',
    # confirmed against the app's OWN party_ae vocabulary by matching each name's aggregate vote
    # share for that exact election (see the build report), not by eye
    'gondvana gantantra party': 'GGP',              # Chhattisgarh 2023: 1.36% vs app GGP 1.11%
    'jan suraaj party': 'JSP',                      # Bihar 2025: 3.36% vs app JSP 3.34%
    'aazad samaj party (kanshi ram)': 'ASP(KR)',    # Rajasthan 2023: 0.88% vs app ASP(KR) 0.89%
    'viduthalai chiruthaigal katchi': 'VCK',        # Puducherry 2026: 0.13% vs app VCK 0.14%
    'jammu and kashmir apni party': 'JKAP',
}

def load_std():
    src = io.open(os.path.join(_HERE, 'build_extracts.py'), encoding='utf-8').read()
    ns = {'__file__': os.path.join(_HERE, 'build_extracts.py'), '__name__': 'build_extracts_prefix'}
    real_open, real_gzopen = builtins.open, gzip.open
    builtins.open, gzip.open = _blocked, _blocked
    try:
        exec(compile(src, 'build_extracts[prefix]', 'exec'), ns)
    except _Stop:
        pass                                   # reached the first file read — std() is defined
    finally:
        builtins.open, gzip.open = real_open, real_gzopen
    base = ns['std']

    def std(p):
        v = base(p)
        return EXTRA.get(str(v or '').strip().lower(), EXTRA.get(str(p or '').strip().lower(), v))
    return std
