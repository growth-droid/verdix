"""Re-download the official ORGI Census 2011 HLO tables from the censusindia.gov.in NADA catalogue.

Plain public GET requests only (no login, no cookies sent, no keys). Writes raw/*.xls unmodified and
appends one JSON line per file (catalog URL, download URL, sha256) to raw_manifest.jsonl.

Usage: python fetch_hlo_nada.py HL06,HL07,HL08,HL10,HL12,HL01
"""
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "raw")
UA = {"User-Agent": "Mozilla/5.0"}
SEARCH = ("https://censusindia.gov.in/nada/index.php/api/catalog/search?sk="
          + urllib.parse.quote('"excluding institutional households"') + "&ps=5000")


def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                return r.read(), r.headers
        except Exception as e:  # noqa: BLE001
            print("  retry", k, url, e)
            time.sleep(3 * (k + 1))
    raise RuntimeError("failed " + url)


def main():
    fams = sys.argv[1].split(",") if len(sys.argv) > 1 else ["HL01", "HL06", "HL07", "HL08", "HL10", "HL12"]
    rows = json.loads(get(SEARCH)[0])["result"]["rows"]
    todo = sorted((r for r in rows if "-SC-" not in r["idno"] and "-ST-" not in r["idno"]
                   and r["idno"].rsplit("-", 1)[0].replace("PC11_", "") in fams), key=lambda r: r["idno"])
    print(len(todo), "catalog entries")
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(HERE, "raw_manifest.jsonl"), "a") as man:
        for r in todo:
            cat = f"https://censusindia.gov.in/nada/index.php/catalog/{r['id']}"
            page = get(cat + "/related-materials")[0].decode("utf-8", "replace")
            links = list(dict.fromkeys(re.findall(
                r'title="([^"]+)"\s+href="(https://censusindia\.gov\.in/nada/index\.php/catalog/\d+/download/\d+)"', page)))
            for fname, url in links:
                data, hdr = get(url)
                m = re.search(r'filename="([^"]+)"', hdr.get("Content-Disposition", ""))
                fn = m.group(1) if m else fname
                with open(os.path.join(OUT, fn), "wb") as f:
                    f.write(data)
                man.write(json.dumps(dict(idno=r["idno"], title=" ".join(r["title"].split()), catalog_url=cat,
                                          download_url=url, filename=fn, bytes=len(data),
                                          sha256=hashlib.sha256(data).hexdigest())) + "\n")
                print(r["idno"], fn, len(data))
            time.sleep(0.3)


if __name__ == "__main__":
    main()
