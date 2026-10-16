# 新潟県 観光入込客統計 バーチャートレース

新潟県「観光入込客統計調査」のオープンデータから、市町村（月別）・観光地点（年次）の順位変動を見せる静的サイト。
（現在 P3（副モード・自動キャプション）まで完了。公開準備は P4。仕様: `tourism-race-prompt.md`、調査: `reports/p0_survey.md`）

## データの再生成

```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd etl && ../.venv/bin/python fetch.py && ../.venv/bin/python download.py   # data/raw/ に原本保存（1秒間隔）
cd .. && .venv/bin/python etl/build.py                                      # data/processed/*.csv, web/public/data/*.json
.venv/bin/python -m pytest -q tests                                         # 検算
```

## 決めたこと（既定値）

- 対象は 2011〜2024 暦年（Excel: 2022〜2024 / PDF抽出: 2011〜2021）。2010年度は年度集計のため除外。
- 観光地点（副モード）は全期間を流し、2020 で集計対象が変わる旨を常時注記する（`spots.json` の `break_years`）。
- 値は公表値のまま保持。Excel（令和4〜6年）の一部は按分による小数を含む。検算の許容差は ±1 人。
- 地点の分類は公表ラベルのまま（2023 の表7に大分類・中分類と分類名が食い違う行が元データにある）。
  PDF 年（〜2019）の「都市型観光 －買物・食－」等の副分類は `note` に `副分類:` として保持。
- 原本に同名地点が複数行ある場合（2012 阿賀町「阿賀の夏祭り」）は2件目に「（2）」を付ける。
- 名寄せは NFKC 正規化のみ自動。統合は `config/spot_aliases.yml`（初期は空）。候補は `data/processed/spot_alias_candidates.csv`。
- 2020 第6表 南魚沼市は原本で「その他」が空欄のため 0 として補完（魚沼地域計の列合計で検算済み、`etl/parse.py` の `SIX_BLANK_FIX`）。

## 出力（data/processed/）

| ファイル | 列 |
|---|---|
| monthly_municipality.csv | year, month, region, municipality, visitors |
| annual_municipality.csv | year, region, municipality, visitors |
| annual_municipality_category.csv | year, municipality, category, visitors |
| spots.csv | year, municipality, spot, category, visitors, prev_year_visitors, note |
| totals.csv | year, total, yoy_pct |

## 利用規約・出典

出典: 新潟県観光入込客統計調査（各年）。新潟県オープンデータ利用規約に従い、
クリエイティブ・コモンズ・ライセンス 表示 4.0 国際（CC BY 4.0）で提供されるデータを改変（集計・整形）して利用している。
本サイトは新潟県が作成・保証したものではない。

## フロント（web/）

```
cd web && npm install
npm run dev        # 開発サーバー
npm run build      # dist/ に静的サイトを出力（base: ./）
```

- 市町村×月別のレース（2011年1月〜2024年12月、168コマ）。地域色固定、年月の大表示、再生/一時停止、スライダー、速度、10/20件、範囲（全期間／特定の1年で循環）。
- 共有・検証用に URL ハッシュ `#i=<フレーム番号>`（0〜167）と `p=1`（自動再生）を受け付ける。例: `#i=111&p=1` は2020年4月から再生。

### モードと自動キャプション（P3）

- モード: 月別（市町村）／年間（市町村）／観光地点（年次）。観光地点は分類・市町村で絞り込み、分類色で表示。
- 観光地点では「年により集計対象が異なります」を常時表示。2020年のコマで強調し、掲載地点数（2019年→2020年）はデータから算出する。
- 自動キャプション（最大2件、優先順）: 1位交代 > 前年（同月）比 +50%以上／−30%以下（表示中の上位N件）> TOP10新規入り。
- 手動注記は `config/annotations.yml` に書き、`etl/build.py` で `web/public/data/annotations.json` に出力（初期は空）。
- 検証用ハッシュ: `#m=monthly|annual|spots&i=<コマ>&p=1&c=<分類>&u=<市町村>&a=0`（`a=0` はアニメーション無効。ヘッドレス撮影用）。
- 集計: 「単月・単年」／「累計」。累計は再生範囲の先頭（全期間なら2011年1月、1年範囲ならその年の1月）から現在のコマまでの合計。
  欠損・集計対象外は0として加算するため、観光地点の累計は掲載対象になった年のみの合計になる。累計では前年比キャプションは出さない。
  検証用ハッシュ: `s=cum`。
- 季節表示（月別モードのみ）: 月ごとに季節（春・夏・秋・冬）で背景色を淡く切り替え、モチーフの絵文字と季節ラベルを右下に出す。
  対応は `web/src/season.ts`（参照元: `niigata_001/market-race-spec` の season.ts と同じ月→モチーフ）。ライト/ダーク両対応、
  `prefers-reduced-motion` では切り替えアニメーションを無効化。年間・観光地点モードでは出さない。絵文字は OS により見た目が変わる。

## 公開（P4）

- 公開手順: `docs/DEPLOY.md`、ワークフロー: `.github/workflows/deploy.yml`（このディレクトリを単独リポジトリにして GitHub Pages へ）。
- 利用規約: 全年の年ページでオープンデータのバナー（CC BY 4.0 適用）を確認したが、**令和3年（2021）のページのみバナー・記載が無い**。
  2021年分は残して画面フッターに注記し、他年と同じ出典・CC BY 表記を付けている。県への確認は公開前に行うこと
  （問い合わせ先: 規約記載の ngt000210@pref.niigata.lg.jp）。判断記録: 2026-10-16、利用者が「残して注記を出す」を選択。

## 円の大きさ地図（フェーズA: 市町村単位）

「地図」タブで、市町村ごとの入込客数を円の面積で表示する。年月・再生・速度・範囲はレースと共有（タブを切り替えても年月と再生状態を引き継ぐ）。

- 指標: 月別／年間／分類別（年間・7分類から選択）。観光地点（フェーズB）は未実装（設計メモのみ）。
- 円: 面積が値に比例（半径は√値）。大きさは選択中の指標の**全期間最大値で固定**（最大半径は地図幅の約15%、最小3px）。
  0は塗りなしの輪郭、欠損は描かない。大きい円ほど下、半透明0.5＋白細線、色は地域色。凡例の円も同じ式（`web/src/radius.ts`）。
- 座標: 国土数値情報 N03（新潟県・2025年版、CC BY 4.0）を新潟市8区ぶん dissolve し代表点を計算（`etl/points.py`）。
  代表点が役場付近から10km以上離れる6市町村（村上・三条・魚沼・五泉・胎内・妙高）は、国土地理院 住所検索の点に差し替え（`config/municipality_points_override.csv`、method=override）。
  出力: `data/processed/municipality_points.csv`、`web/public/data/municipality_points.geojson`（境界線 `municipality_boundaries.geojson` は簡略化後188KB。「境界線」チェックで表示）。
  原データ・取得日・SHA は `data/raw/n03/SOURCE.md`。調査経緯は `docs/map-p0.md`。
- ベースマップ: 国土地理院タイル（淡色地図）。**利用手続（申請の要否）は未確認**。仲間内での利用に限る間は出典明示のみで運用し、
  不特定多数に公開する段階で国土地理院（地図の利用手続ナビ／審査係）に確認すること（判断記録: 2026-10-16）。
- 地図タブは動的 import（MapLibre GL JS 6.14.0。JS 約289KB gzip＋ワーカー約500KB）。レースの初回表示は重くならない。
  MapLibre 6 のワーカーは `?url` インポート＋`setWorkerUrl()` で出力している（`web/src/map.ts`）。

### 再生成と検証
```
.venv/bin/python etl/build.py && .venv/bin/python etl/points.py   # JSON/座標（冪等）
.venv/bin/python -m pytest -q tests                                # ETL: 座標30/30・市域内・県内・結合・冪等など
cd web && npm test && npm run build                                # 半径関数の単体テスト、型検査＋ビルド
```

### 手動確認（スマホ Safari / Chrome。`npm run dev -- --host` で実機から）
1. 「地図」タブ: 県全域（佐渡・粟島を含む）が収まり、ピンチ・ドラッグできる。
2. ▶で再生（ボタンは地図の直下）: 円がなめらかに伸び縮みし、最後まで止まらない。年月は地図の左上に大きく出る。ポップアップを開いたまま再生・スクロールしても、地図へ強制的に戻らない。0.2x/0.5x/1x/2x、範囲（1年）でも崩れない。
3. 円（小さい円も）をタップ: ポップアップ（市町村・値・地域・順位・前年同月比）。下の表の行タップでも開く。
4. 指標を 月別 → 年間 → 分類別 と切り替える: 年月が維持され、凡例の基準円と注意書きが更新される。分類別は年のスライダーのみ動く。
5. 「レース」タブへ戻る: 年月と再生状態が引き継がれ、レースが従来どおり動く。
6. 凡例（「円の大きさの目安」）が折りたためる。注意書き（代表点であること）・出典・加工表記が常に見える。
7. 検証用ハッシュ: `#v=map&m=annual|monthly|category&mc=<分類>&i=<コマ>&pop=<市町村>&a=0`。
