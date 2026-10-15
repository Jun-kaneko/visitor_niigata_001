"""P0: 入口ページから年ページ・添付ファイルを取得して data/raw/{年}/ に保存する。"""
import json, re, sys, time
from pathlib import Path
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
ENTRY = "https://www.pref.niigata.lg.jp/sec/kankokikaku/1245960085415.html"
UA = "niigata-tourism-race-etl/0.1 (+https://github.com/Jun-kaneko/visitor_niigata_001)"
S = requests.Session()
S.headers["User-Agent"] = UA
_last = [0.0]

def get(url):
    wait = 1.1 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    r = S.get(url, timeout=60)
    _last[0] = time.time()
    r.raise_for_status()
    return r

def era_to_year(text):
    t = text.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    if "令和元" in t:
        return 2019 if "平成31" in t else 2019
    m = re.search(r"(令和|平成)\s*(\d+)\s*年", t)
    if not m:
        return None
    n = int(m.group(2))
    return 2018 + n if m.group(1) == "令和" else 1988 + n

def main():
    RAW.mkdir(parents=True, exist_ok=True)
    r = get(ENTRY)
    (RAW / "entry.html").write_bytes(r.content)
    soup = BeautifulSoup(r.content, "lxml")
    pages = []
    for a in soup.find_all("a", href=True):
        txt = a.get_text(strip=True)
        if re.search(r"(令和|平成)\s*[0-9０-９元]+\s*年", txt) and "観光入込客統計" in txt:
            pages.append((txt, urljoin(ENTRY, a["href"])))
    seen, out = set(), []
    for txt, u in pages:
        if u not in seen:
            seen.add(u); out.append((txt, u))
    manifest = []
    for txt, u in out:
        y = era_to_year(txt)
        d = RAW / (str(y) if y else re.sub(r"\W", "_", txt)[:20])
        d.mkdir(parents=True, exist_ok=True)
        pr = get(u)
        (d / "page.html").write_bytes(pr.content)
        ps = BeautifulSoup(pr.content, "lxml")
        files = []
        for a in ps.find_all("a", href=True):
            h = a["href"]
            if re.search(r"\.(xlsx?|pdf|csv|zip)$", h, re.I):
                files.append({"label": a.get_text(strip=True), "url": urljoin(u, h)})
        manifest.append({"title": txt, "year": y, "page": u, "dir": str(d.relative_to(ROOT)), "files": files})
        print(txt, y, u, len(files), flush=True)
    (RAW / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
