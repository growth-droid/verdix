"""Download all 640 district files of Census 2011 table HL-14 ("Percentage of households to total
households by amenities and assets", village/town/ward level) from the official ORGI NADA catalogue.

Plain anonymous public HTTPS GETs only (curl, no cookies kept or sent, no credentials, no keys).
Resume-safe: a file already present whose sha256 matches its manifest line is skipped.
Polite: run at most 2 workers (worker k of n takes every n-th entry), small sleeps between requests.

  python fetch_hl14_nada.py search          # 1 request: NADA search API -> meta/hl14_catalog.json
  python fetch_hl14_nada.py get 0 2         # worker 0 of 2   (run "get 1 2" in parallel)

Each worker appends JSON lines (idno, catalog_url, related_materials_url, download_url, filename,
bytes, sha256, fetched_utc) to meta/manifest_w<k>.jsonl. The build script merges them.
"""
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time

DL = os.environ.get("HL14_DIR", os.path.join(
    os.environ["LOCALAPPDATA"], "Temp", "claude", "C--Users-minds-OneDrive-Desktop-Data-Project",
    "b4ee2c9a-d22a-44f3-9d75-56cb29e4f656", "scratchpad", "census", "option2", "hl14"))
META = os.path.join(DL, "meta")
RAW = os.path.join(DL, "raw")
SEARCH = ("https://censusindia.gov.in/nada/index.php/api/catalog/search?sk=%22amenities%20and%20assets%22&ps=2000")
CAT = "https://censusindia.gov.in/nada/index.php/catalog/{id}"


def curl(url, tries=5):
    """anonymous GET -> (bytes, content-disposition filename or None)"""
    for k in range(tries):
        fd, tf = tempfile.mkstemp(); os.close(fd)
        hf = tf + ".h"
        r = subprocess.run(["curl", "-s", "-L", "--max-time", "300", "-A", "Mozilla/5.0", "-D", hf, "-o", tf,
                            "-w", "%{http_code}", url], capture_output=True, text=True)
        ok = r.stdout.strip() == "200" and os.path.getsize(tf) > 0
        data = open(tf, "rb").read() if ok else None
        hdr = open(hf, "r", errors="replace").read() if os.path.exists(hf) else ""
        for p in (tf, hf):
            if os.path.exists(p):
                os.remove(p)
        if ok:
            m = re.search(r'filename="([^"]+)"', hdr)
            return data, (m.group(1) if m else None)
        print("  retry", k, r.stdout.strip(), url, flush=True)
        time.sleep(5 * (k + 1))
    raise RuntimeError("download failed " + url)


def search():
    os.makedirs(META, exist_ok=True)
    data, _ = curl(SEARCH)
    open(os.path.join(META, "search_amenities.json"), "wb").write(data)
    rows = json.loads(data)["result"]["rows"]
    dist = sorted((dict(id=r["id"], idno=r["idno"], title=" ".join(r["title"].split()))
                   for r in rows if re.fullmatch(r"PC11_HL14-\d\d-\d\d\d", r["idno"])), key=lambda r: r["idno"])
    json.dump(dict(search_url=SEARCH, fetched_utc=dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                   n=len(dist), entries=dist), open(os.path.join(META, "hl14_catalog.json"), "w"), indent=1)
    print(len(dist), "district entries")


def done_map():
    m = {}
    for f in os.listdir(META):
        if f.startswith("manifest_w") and f.endswith(".jsonl"):
            for line in open(os.path.join(META, f)):
                if line.strip():
                    r = json.loads(line); m[r["idno"]] = r
    return m


def get(k, n):
    os.makedirs(RAW, exist_ok=True)
    cat = json.load(open(os.path.join(META, "hl14_catalog.json")))["entries"]
    done = done_map()
    man = open(os.path.join(META, f"manifest_w{k}.jsonl"), "a")
    todo = [e for i, e in enumerate(cat) if i % n == k]
    for i, e in enumerate(todo):
        d = done.get(e["idno"])
        if d and os.path.exists(os.path.join(RAW, d["filename"])) and \
                hashlib.sha256(open(os.path.join(RAW, d["filename"]), "rb").read()).hexdigest() == d["sha256"]:
            continue
        cu = CAT.format(id=e["id"])
        html = curl(cu + "/related-materials")[0].decode("utf-8", "replace")
        links = list(dict.fromkeys(re.findall(
            r'title="([^"]+)"\s+href="(https://censusindia\.gov\.in/nada/index\.php/catalog/%s/download/\d+)"' % e["id"], html)))
        if len(links) != 1:
            print("WARN", e["idno"], "links:", links, flush=True)
        if not links:
            continue
        time.sleep(0.3)
        for title, url in links:
            data, fn = curl(url)
            fn = fn or title
            open(os.path.join(RAW, fn), "wb").write(data)
            man.write(json.dumps(dict(idno=e["idno"], title=e["title"], catalog_url=cu,
                                      related_materials_url=cu + "/related-materials", download_url=url,
                                      filename=fn, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                                      fetched_utc=dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"))) + "\n")
            man.flush()
            print(k, i + 1, "/", len(todo), e["idno"], fn, len(data), flush=True)
        time.sleep(0.5)
    print("DONE worker", k, flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "search":
        search()
    else:
        get(int(sys.argv[2]), int(sys.argv[3]))
