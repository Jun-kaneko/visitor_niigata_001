"""manifest.json から Excel と別表PDF（+2010は別表1～9）を data/raw/{年}/ に原本保存する。"""
import json, re
from pathlib import Path
from fetch import get, ROOT

def pick(files):
    out = []
    for f in files:
        l, u = f["label"], f["url"]
        if u.lower().endswith(".xlsx") or "別表" in l:
            if "参考資料" in l and "別表" in l and "P6" in l:  # 2011/2010 の参考資料別表は除外
                continue
            if "参考資料別表" in l or "参考資料　別表" in l:
                continue
            out.append(f)
    return out

for m in json.load(open(ROOT / "data/raw/manifest.json")):
    d = ROOT / m["dir"]
    for f in pick(m["files"]):
        dest = d / Path(f["url"]).name
        if dest.exists():
            continue
        dest.write_bytes(get(f["url"]).content)
        print(m["year"], dest.name, f["label"][:30], dest.stat().st_size, flush=True)
