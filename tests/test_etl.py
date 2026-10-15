"""P1 検証（仕様4.4）。事前に `python etl/build.py` を実行しておく。"""
import csv
from collections import defaultdict
from pathlib import Path

import pytest

P = Path(__file__).resolve().parent.parent / "data" / "processed"
YEARS = list(range(2011, 2025))
TOL = 1.0  # 丸め許容（按分推計の小数あり）


def rows(name):
    with open(P / name, encoding="utf-8") as f:
        return list(csv.DictReader(f))


@pytest.fixture(scope="module")
def monthly():
    return rows("monthly_municipality.csv")


@pytest.fixture(scope="module")
def annual():
    return rows("annual_municipality.csv")


def test_30_municipalities_every_year(monthly):
    for y in YEARS:
        ms = {r["municipality"] for r in monthly if int(r["year"]) == y}
        assert len(ms) == 30, y
        assert sum(1 for r in monthly if int(r["year"]) == y) == 360


def test_region_sizes(annual):
    for y in YEARS:
        cnt = defaultdict(int)
        for r in annual:
            if int(r["year"]) == y:
                cnt[r["region"]] += 1
        assert dict(cnt) == {"下越": 12, "中越": 9, "魚沼": 5, "上越": 3, "佐渡": 1}, y


def test_no_missing_values(monthly):
    assert all(r["visitors"] != "" for r in monthly)


def test_month_totals_match_published_total_row(monthly):
    pub = {(int(r["year"]), int(r["month"])): float(r["published_total"])
           for r in rows("_published_totals.csv") if r["month"] != "0"}
    s = defaultdict(float)
    for r in monthly:
        s[(int(r["year"]), int(r["month"]))] += float(r["visitors"])
    for k, v in pub.items():
        assert abs(s[k] - v) <= TOL, (k, s[k], v)


def test_months_sum_to_annual_per_municipality(monthly, annual):
    s = defaultdict(float)
    for r in monthly:
        s[(int(r["year"]), r["municipality"])] += float(r["visitors"])
    for r in annual:
        assert abs(s[(int(r["year"]), r["municipality"])] - float(r["visitors"])) <= TOL, r


def test_annual_sum_matches_table1_total(annual):
    tot = {int(r["year"]): float(r["total"]) for r in rows("totals.csv")}
    s = defaultdict(float)
    for r in annual:
        s[int(r["year"])] += float(r["visitors"])
    for y in YEARS:
        assert abs(s[y] - tot[y]) <= TOL, (y, s[y], tot[y])


def test_category_sum_matches_annual(annual):
    s = defaultdict(float)
    for r in rows("annual_municipality_category.csv"):
        s[(int(r["year"]), r["municipality"])] += float(r["visitors"])
    for r in annual:
        assert abs(s[(int(r["year"]), r["municipality"])] - float(r["visitors"])) <= TOL, r


def test_known_values(monthly, annual):
    m = {(int(r["year"]), int(r["month"]), r["municipality"]): float(r["visitors"]) for r in monthly}
    assert m[(2024, 1, "新潟市")] == 1017654
    assert m[(2024, 1, "湯沢町")] == 544260
    assert m[(2024, 1, "弥彦村")] == 306595
    assert m[(2024, 8, "新潟市")] == 2382324
    assert m[(2024, 8, "長岡市")] == 1446068
    pub = {(int(r["year"]), int(r["month"])): float(r["published_total"]) for r in rows("_published_totals.csv")}
    assert round(pub[(2024, 1)]) == 3879247
    assert round(pub[(2024, 8)]) == 9261771
    a = {(int(r["year"]), r["municipality"]): float(r["visitors"]) for r in annual}
    assert a[(2024, "新潟市")] == 16018815
    assert a[(2024, "長岡市")] == 7379306
    assert round(pub[(2024, 0)]) == 63363172
    t = {int(r["year"]): r for r in rows("totals.csv")}
    assert float(t[2020]["total"]) == 42006752 and abs(float(t[2020]["yoy_pct"]) - 57.3) < 0.05
    assert float(t[2024]["total"]) == 63363172 and abs(float(t[2024]["yoy_pct"]) - 101.5) < 0.05


def test_known_spots():
    s = {(int(r["year"]), r["spot"]): r for r in rows("spots.csv")}
    assert (s[(2024, "道の駅あらい")]["municipality"], float(s[(2024, "道の駅あらい")]["visitors"])) == ("妙高市", 2855710)
    assert (s[(2024, "寺泊魚の市場通り")]["municipality"], float(s[(2024, "寺泊魚の市場通り")]["visitors"])) == ("長岡市", 1953000)
    assert (s[(2024, "新潟ふるさと村")]["municipality"], float(s[(2024, "新潟ふるさと村")]["visitors"])) == ("新潟市", 1556500)


def test_spots_no_duplicates_and_valid_category():
    cats = {"自然", "歴史・文化", "温泉・健康", "スポーツ・レクリエーション", "都市型観光", "その他", "行祭事・イベント"}
    seen = set()
    for r in rows("spots.csv"):
        k = (r["year"], r["municipality"], r["spot"])
        assert k not in seen, k
        seen.add(k)
        assert r["category"] in cats, r
        assert r["municipality"], r


def test_spots_cross_year_consistency():
    """N年の値と、N+1年ファイルの『前年』値が（同一市町村・地点で）概ね一致する。
    市町村対応（PDF座標抽出）の誤りを検出するための検算。"""
    cur = {(int(r["year"]), r["municipality"], r["spot"]): r for r in rows("spots.csv")}
    ok = bad = 0
    for (y, m, s), r in cur.items():
        if y + 1 in YEARS and r["visitors"]:
            nxt = cur.get((y + 1, m, s))
            if nxt and nxt["prev_year_visitors"]:
                if abs(float(nxt["prev_year_visitors"]) - float(r["visitors"])) <= max(TOL, 0.001 * float(r["visitors"])):
                    ok += 1
                else:
                    bad += 1
    assert ok > 1500
    assert bad / (ok + bad) < 0.10, (ok, bad)
