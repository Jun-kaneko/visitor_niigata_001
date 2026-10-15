# 公開手順（GitHub Pages）

1. このディレクトリを単独のリポジトリにする（例: `git init` → GitHub に作成 → push）。`.venv/`・`node_modules/` は `.gitignore` 済み。
2. GitHub のリポジトリ設定 → Pages → Source を「GitHub Actions」にする。
3. main に push すると `.github/workflows/deploy.yml` が、テスト（`tests/`）→ ビルド（`web/`）→ 公開を行う。
4. サイトは相対パス（`base: './'`）なので、`https://<ユーザー>.github.io/<リポジトリ>/` のどこでも動く。

## データを更新するとき（年1回）

```
.venv/bin/python etl/fetch.py && .venv/bin/python etl/download.py   # 入口ページの新しい年を取得
# etl/parse.py の EXCEL_FILES に新年のファイルを追加（Excel が出る年）
.venv/bin/python etl/build.py && .venv/bin/python -m pytest -q tests
git add data web/public/data && git commit && git push
```

注意: `data/raw/` は約11MB。リポジトリに含めても問題ない大きさだが、含めない場合は `data/processed` と `web/public/data` のみで公開できる
（CI のテストは `data/processed` を読む）。
