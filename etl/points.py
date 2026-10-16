"""市町村の代表点（円地図用）を作る。N03(2025) → 新潟市8区をdissolve → representative_point。
config/municipality_points_override.csv の行は座標を上書きする（method=override）。
再実行しても同じ結果になる（原データ固定・決定的アルゴリズム・丸め・ソート済み）。

出力: data/processed/municipality_points.csv, web/public/data/municipality_points.geojson,
      web/public/data/municipality_boundaries.geojson（簡略化後1MB以下のときのみ）
"""
import csv, io, json, zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
N03_ZIP = ROOT / "data/raw/n03/N03-20250101_15_GML.zip"
N03_NAME = "N03-20250101_15.geojson"
OVERRIDE = ROOT / "config/municipality_points_override.csv"
OUT_CSV = ROOT / "data/processed/municipality_points.csv"
WEB = ROOT / "web/public/data"
SIMPLIFY_M = 150          # 境界の簡略化許容(m)
MAX_BOUNDARY_BYTES = 1_000_000

TO = Transformer.from_crs(6668, 6676, always_xy=True)    # JGD2011 → 平面直角座標系 VIII（新潟）
BACK = Transformer.from_crs(6676, 6668, always_xy=True)
NIIGATA_CITY_CODE = "15100"                               # 政令市の標準コード（区コード 15101〜15108 を束ねる）


def _proj(g):
    return shapely.transform(g, lambda a: np.column_stack(TO.transform(a[:, 0], a[:, 1])))


def _unproj(g):
    return shapely.transform(g, lambda a: np.column_stack(BACK.transform(a[:, 0], a[:, 1])))


def load_municipalities():
    """→ {市町村名: (code, 投影済みdissolve済みgeometry)}。名称は N03_004（新潟市は8区をまとめる）。"""
    with zipfile.ZipFile(N03_ZIP) as z:
        d = json.loads(z.read(N03_NAME))
    geoms, codes = defaultdict(list), defaultdict(set)
    for f in d["features"]:
        p = f["properties"]
        geoms[p["N03_004"]].append(shape(f["geometry"]))
        codes[p["N03_004"]].add(p["N03_007"])
    out = {}
    for name in sorted(geoms):
        code = NIIGATA_CITY_CODE if name == "新潟市" else sorted(codes[name])[0]
        out[name] = (code, _proj(unary_union(geoms[name])))
    return out


def read_overrides():
    if not OVERRIDE.exists():
        return {}
    with open(OVERRIDE, encoding="utf-8") as f:
        return {r["municipality"]: (float(r["lon"]), float(r["lat"]), r["reason"])
                for r in csv.DictReader(f) if r.get("municipality")}


def compute(regions):
    """regions: {市町村名: 地域}。→ 行のリスト（統計側の市町村順）。"""
    muni = load_municipalities()
    over = read_overrides()
    rows = []
    for name in regions:
        code, g = muni[name]
        if name in over:
            lon, lat, _ = over[name]
            method = "override"
        else:
            rp = g.representative_point()
            lon, lat = BACK.transform(rp.x, rp.y)
            method = "n03_representative_point"
        rows.append({"municipality": name, "code": code, "region": regions[name],
                     "lon": round(lon, 5), "lat": round(lat, 5), "method": method})
    return rows


def boundaries(regions):
    muni = load_municipalities()
    feats = []
    for name in regions:
        code, g = muni[name]
        s = _unproj(g.simplify(SIMPLIFY_M, preserve_topology=True))
        feats.append({"type": "Feature", "properties": {"name": name, "region": regions[name]},
                      "geometry": json.loads(shapely.to_geojson(shapely.set_precision(s, 0.0001)))})
    return {"type": "FeatureCollection", "features": feats}


def main():
    series = json.load(open(WEB / "monthly.json"))["series"]
    regions = {s["name"]: s["region"] for s in series}
    rows = compute(regions)
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["municipality", "code", "region", "lon", "lat", "method"])
        w.writeheader(); w.writerows(rows)
    gj = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {k: r[k] for k in ("municipality", "code", "region", "method")},
         "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]}} for r in rows]}
    (WEB / "municipality_points.geojson").write_text(json.dumps(gj, ensure_ascii=False, separators=(",", ":")))
    b = json.dumps(boundaries(regions), ensure_ascii=False, separators=(",", ":"))
    bp = WEB / "municipality_boundaries.geojson"
    if len(b.encode()) <= MAX_BOUNDARY_BYTES:
        bp.write_text(b)
        print(f"boundaries: {len(b.encode())/1024:.0f}KB")
    else:
        bp.unlink(missing_ok=True)
        print(f"boundaries: {len(b.encode())/1024:.0f}KB > 1MB のため出力しない")
    print("points:", len(rows), sum(r["method"] == "override" for r in rows), "overrides")


if __name__ == "__main__":
    main()
