"""P1: 全年をパースして data/processed/*.csv と web/public/data/*.json を生成し、検証レポートを出す。"""
import csv, difflib, json, sys
from collections import defaultdict
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parse as P

ROOT = P.ROOT
OUT = ROOT / "data" / "processed"
WEB = ROOT / "web" / "public" / "data"
REP = ROOT / "reports"
REGION_ORDER = ["下越", "中越", "魚沼", "上越", "佐渡"]


def num(v):
    if v is None:
        return ""
    return str(int(v)) if float(v).is_integer() else f"{v:.2f}".rstrip("0").rstrip(".")


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def load_aliases():
    cfg = yaml.safe_load((ROOT / "config" / "spot_aliases.yml").read_text()) or {}
    m = {}
    for a in cfg.get("aliases") or []:
        for n in a["names"]:
            m[(a.get("municipality"), P.nfkc(n))] = P.nfkc(a["canonical"])
    return m


def main():
    monthly, annual, annual_cat, spots, totals = [], [], [], [], []
    month_totals, annual_totals, cat_totals, region_rows = {}, {}, {}, {}
    t1_by_src = {}
    for y in P.YEARS:
        t5, t6, t1 = P.table5(y), P.table6(y), P.table1(y)
        t1_by_src[y] = t1
        for region, muni, d in t5:
            if region in REGION_ORDER:
                for mi, v in enumerate(d["months"], 1):
                    monthly.append([y, mi, region, muni, num(v)])
                annual.append([y, region, muni, num(d["total"])])
            elif region == "_total":
                month_totals[y] = d["months"]; annual_totals[y] = d["total"]
            elif region == "_region_total":
                region_rows[(y, muni)] = d
        for region, muni, d in t6:
            if region in REGION_ORDER:
                for c, v in zip(P.CATEGORIES, d["cats"]):
                    annual_cat.append([y, muni, c, num(v)])
            elif region == "_total":
                cat_totals[y] = d
        alias = load_aliases()
        for r in P.table7(y):
            name = alias.get((r["municipality"], r["spot"]), alias.get((None, r["spot"]), r["spot"]))
            n = sum(1 for x in spots if x[0] == y and x[1] == r["municipality"] and x[2].split("（")[0] == name)
            note = r["note"]
            if n:  # 原本に同名の地点が複数行ある場合は連番を付けて区別する
                name, note = f"{name}（{n + 1}）", ";".join(filter(None, [note, "同名地点(原本に同名複数行)"]))
            spots.append([y, r["municipality"], name, r["category"], num(r["visitors"]),
                          num(r["prev_year_visitors"]), note])
    # 第1表: 各年のファイル自身の当年値を採用
    for y in P.YEARS:
        v = t1_by_src[y].get(y)
        totals.append([y, num(v[0]) if v else "", f"{v[1]:.1f}" if v else ""])

    OUT.mkdir(parents=True, exist_ok=True)
    write_csv(OUT / "monthly_municipality.csv", ["year", "month", "region", "municipality", "visitors"], monthly)
    write_csv(OUT / "annual_municipality.csv", ["year", "region", "municipality", "visitors"], annual)
    write_csv(OUT / "annual_municipality_category.csv", ["year", "municipality", "category", "visitors"], annual_cat)
    write_csv(OUT / "spots.csv", ["year", "municipality", "spot", "category", "visitors", "prev_year_visitors", "note"], spots)
    write_csv(OUT / "totals.csv", ["year", "total", "yoy_pct"], totals)
    # 集計行（検算用）も保存
    write_csv(OUT / "_published_totals.csv", ["year", "month", "published_total"],
              [[y, m, num(v)] for y, ms in month_totals.items() for m, v in enumerate(ms, 1)]
              + [[y, 0, num(v)] for y, v in annual_totals.items()])

    # 名寄せ候補: 同一市町村で、片方の年にしか無い名称どうしの類似
    by = defaultdict(lambda: defaultdict(set))
    for y, muni, name, *_ in spots:
        by[muni][name].add(y)
    cand = []
    for muni, names in by.items():
        ns = sorted(names)
        for i, a in enumerate(ns):
            for b in ns[i + 1:]:
                if names[a] & names[b]:
                    continue
                r = difflib.SequenceMatcher(None, a, b).ratio()
                if r >= 0.6:
                    cand.append([muni, a, min(names[a]), max(names[a]), b, min(names[b]), max(names[b]), f"{r:.2f}"])
    write_csv(OUT / "spot_alias_candidates.csv",
              ["municipality", "name_a", "a_first", "a_last", "name_b", "b_first", "b_last", "similarity"], cand)

    build_json(monthly, annual, annual_cat, spots, totals)
    write_report(monthly, annual, annual_cat, spots, month_totals, annual_totals, cat_totals, region_rows)
    print("done", len(monthly), len(annual), len(annual_cat), len(spots), len(cand))


def fnum(s):
    return None if s == "" else float(s)


def build_json(monthly, annual, annual_cat, spots, totals):
    WEB.mkdir(parents=True, exist_ok=True)
    frames = [f"{y}-{m:02d}" for y in P.YEARS for m in range(1, 13)]
    idx = {f: i for i, f in enumerate(frames)}
    series = {}
    for y, m, region, muni, v in monthly:
        s = series.setdefault(muni, {"name": muni, "region": region, "values": [None] * len(frames)})
        s["values"][idx[f"{y}-{m:02d}"]] = fnum(v)
    dump = lambda name, obj: (WEB / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    dump("monthly.json", {"frames": frames, "regions": REGION_ORDER, "series": list(series.values())})
    years = P.YEARS
    aser = {}
    for y, region, muni, v in annual:
        s = aser.setdefault(muni, {"name": muni, "region": region, "values": [None] * len(years)})
        s["values"][years.index(y)] = fnum(v)
    dump("annual.json", {"frames": [str(y) for y in years], "regions": REGION_ORDER, "series": list(aser.values())})
    cser = {}
    for y, muni, cat, v in annual_cat:
        s = cser.setdefault(muni, {"name": muni, "region": aser[muni]["region"],
                                   "values": {c: [None] * len(years) for c in P.CATEGORIES}})
        s["values"][cat][years.index(y)] = fnum(v)
    dump("annual_category.json", {"frames": [str(y) for y in years], "categories": P.CATEGORIES,
                                  "regions": REGION_ORDER, "series": list(cser.values())})
    sser = {}
    for y, muni, name, cat, v, pv, note in spots:
        s = sser.setdefault((muni, name), {"name": name, "municipality": muni, "category": cat,
                                           "values": [None] * len(years)})
        s["values"][years.index(y)] = fnum(v)
        s["category"] = cat  # 最新年の分類
    dump("spots.json", {"frames": [str(y) for y in years], "series": list(sser.values()),
                        "break_years": [2020]})
    ann = (yaml.safe_load((ROOT / "config" / "annotations.yml").read_text()) or {}).get("annotations") or []
    dump("annotations.json", [{"ym": str(a["ym"]), "target": a.get("target", ""), "text": a["text"]} for a in ann])
    dump("totals.json", [{"year": int(y), "total": fnum(t), "yoy_pct": fnum(p)} for y, t, p in totals])


def write_report(monthly, annual, annual_cat, spots, month_totals, annual_totals, cat_totals, region_rows):
    lines = ["# P1 検証レポート（自動生成: etl/build.py）", ""]
    lines += ["| 年 | 月別行 | 市町村 | 欠損 | 月合計差(最大) | 年計差 | 地点数 | 地点欠損(当年) |", "|---|---|---|---|---|---|---|---|"]
    by_year = defaultdict(list)
    for r in monthly:
        by_year[r[0]].append(r)
    for y in P.YEARS:
        rows = by_year[y]
        miss = sum(1 for r in rows if r[4] == "")
        diffs = []
        for m in range(1, 13):
            s = sum(float(r[4] or 0) for r in rows if r[1] == m)
            diffs.append(abs(s - month_totals[y][m - 1]))
        ann = sum(float(r[3] or 0) for r in annual if r[0] == y)
        sp = [r for r in spots if r[0] == y]
        lines.append(f"| {y} | {len(rows)} | {len({r[3] for r in rows})} | {miss} | {max(diffs):.2f} | "
                     f"{abs(ann - annual_totals[y]):.2f} | {len(sp)} | {sum(1 for r in sp if r[4] == '')} |")
    (REP / "p1_validation.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
