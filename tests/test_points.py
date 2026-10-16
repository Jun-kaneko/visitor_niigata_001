"""円地図用の座標の検証。事前に `python etl/build.py` と `python etl/points.py` を実行しておく。"""
import csv
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "etl"))
WEB = ROOT / "web" / "public" / "data"
BBOX = (137.5, 36.6, 140.0, 38.7)  # 新潟県（佐渡・粟島を含む）を十分に覆う範囲


def points():
    with open(ROOT / "data/processed/municipality_points.csv", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_30_points():
    rows = points()
    assert len(rows) == 30 and len({r["municipality"] for r in rows}) == 30
    assert all(r["lon"] and r["lat"] and r["code"] for r in rows)


def test_points_within_niigata():
    for r in points():
        assert BBOX[0] <= float(r["lon"]) <= BBOX[2] and BBOX[1] <= float(r["lat"]) <= BBOX[3], r


def test_points_inside_own_n03_polygon():
    import points as P
    from pyproj import Transformer
    from shapely.geometry import Point
    to = Transformer.from_crs(6668, 6676, always_xy=True)
    muni = P.load_municipalities()
    for r in points():
        x, y = to.transform(float(r["lon"]), float(r["lat"]))
        assert muni[r["municipality"]][1].contains(Point(x, y)), r["municipality"]


def test_joinable_with_race_data():
    names = {r["municipality"] for r in points()}
    for f in ("monthly.json", "annual.json", "annual_category.json"):
        series = json.load(open(WEB / f))["series"]
        assert {s["name"] for s in series} == names, f
    geo = json.load(open(WEB / "municipality_points.geojson"))
    assert {x["properties"]["municipality"] for x in geo["features"]} == names


def test_regions_match_race_data():
    reg = {s["name"]: s["region"] for s in json.load(open(WEB / "monthly.json"))["series"]}
    assert all(reg[r["municipality"]] == r["region"] for r in points())


def test_idempotent():
    import points as P
    regions = {r["municipality"]: r["region"] for r in points()}
    assert P.compute(regions) == P.compute(regions)


def test_override_applied():
    import points as P
    with open(P.OVERRIDE, encoding="utf-8") as f:
        ov = {r["municipality"]: r for r in csv.DictReader(f)}
    by = {r["municipality"]: r for r in points()}
    for m, r in ov.items():
        assert by[m]["method"] == "override"
        assert (float(by[m]["lat"]), float(by[m]["lon"])) == (float(r["lat"]), float(r["lon"]))
    assert all(r["method"] in ("override", "n03_representative_point") for r in by.values())


def test_category_json_consistent_with_csv():
    d = json.load(open(WEB / "annual_category.json"))
    rows = list(csv.DictReader(open(ROOT / "data/processed/annual_municipality_category.csv", encoding="utf-8")))
    idx = {y: i for i, y in enumerate(d["frames"])}
    s = {x["name"]: x for x in d["series"]}
    for r in rows:
        assert s[r["municipality"]]["values"][r["category"]][idx[r["year"]]] == float(r["visitors"])
