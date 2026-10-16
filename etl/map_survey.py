"""地図フェーズA P0: N03(2025) と統計30市町村の照合、代表点の試算、国土地理院 住所検索APIとの距離検算。
結果は reports/map_p0_survey.json に保存する（docs/map-p0.md の元データ）。"""
import collections, json, math, sys, time
from pathlib import Path
import requests
from pyproj import Transformer
from shapely import transform as shp_transform  # noqa: F401
from shapely.geometry import shape
from shapely.ops import polylabel, unary_union
import shapely

ROOT = Path(__file__).resolve().parent.parent
N03 = ROOT / "data/raw/n03/x/N03-20250101_15.geojson"
UA = "niigata-tourism-race-etl/0.1 (+https://github.com/Jun-kaneko/visitor_niigata_001)"
TO = Transformer.from_crs(6668, 6676, always_xy=True)    # JGD2011 → 平面直角座標系 VIII（新潟）
BACK = Transformer.from_crs(6676, 6668, always_xy=True)


def project(geom):
    return shapely.transform(geom, lambda a: __import__("numpy").column_stack(TO.transform(a[:, 0], a[:, 1])))


def gsi_search(q):
    r = requests.get("https://msearch.gsi.go.jp/address-search/AddressSearch", params={"q": q},
                     headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    time.sleep(1.1)
    return r.json()


def main():
    stats = [s["name"] for s in json.load(open(ROOT / "web/public/data/monthly.json"))["series"]]
    regions = {s["name"]: s["region"] for s in json.load(open(ROOT / "web/public/data/monthly.json"))["series"]}
    d = json.load(open(N03))
    geoms, codes = collections.defaultdict(list), collections.defaultdict(set)
    for f in d["features"]:
        p = f["properties"]
        geoms[p["N03_004"]].append(shape(f["geometry"]))
        codes[p["N03_004"]].add(p["N03_007"])
    out = {"n03_names": len(geoms), "missing_in_n03": sorted(set(stats) - set(geoms)),
           "extra_in_n03": sorted(set(geoms) - set(stats)), "rows": []}
    raw_dir = ROOT / "data/raw/gsi_address_search"
    raw_dir.mkdir(parents=True, exist_ok=True)
    for n in stats:
        u = project(unary_union(geoms[n]))
        c, rp = u.centroid, u.representative_point()
        big = u if u.geom_type == "Polygon" else max(u.geoms, key=lambda x: x.area)
        pl = polylabel(big, tolerance=10)
        res = gsi_search(f"新潟県{n}")
        (raw_dir / f"{n}.json").write_text(json.dumps(res, ensure_ascii=False))
        gx, gy = TO.transform(*res[0]["geometry"]["coordinates"]) if res else (None, None)
        dist = math.hypot(rp.x - gx, rp.y - gy) / 1000 if res else None
        lon, lat = BACK.transform(rp.x, rp.y)
        out["rows"].append({
            "municipality": n, "region": regions[n], "codes": sorted(codes[n]), "area_km2": round(u.area / 1e6, 1),
            "parts": len(u.geoms) if u.geom_type == "MultiPolygon" else 1,
            "rep_lon": round(lon, 5), "rep_lat": round(lat, 5), "rep_inside": bool(u.contains(rp)),
            "centroid_inside": bool(u.contains(c)), "centroid_to_rep_km": round(rp.distance(c) / 1000, 1),
            "polylabel_to_rep_km": round(rp.distance(pl) / 1000, 1),
            "gsi_title": res[0]["properties"]["title"] if res else None, "gsi_results": len(res),
            "gsi_to_rep_km": round(dist, 1) if dist is not None else None,
        })
        print(n, out["rows"][-1]["gsi_to_rep_km"], flush=True)
    (ROOT / "reports/map_p0_survey.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
