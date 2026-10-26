# 配り方と更新の仕組み

LotScope の仕組みに倣った。使う PC には exe だけを入れる（Python・Flask は要らない）。

## 版のつくり方

1. プログラムを直す
2. 版を上げる: `program/app/version.py` の `APP_VERSION` と `CHANGELOG` の先頭（1 件足す）、`desktop/Cargo.toml` と `desktop/tauri.conf.json` の `version`
   （直した・足した: 小、画面や使い方が変わる: 中、作り直し: 大）
3. `cd program && python app_build.py --release`（配る物の中身の要約を `RELEASE` に書く。版を上げ忘れると `tests/test_version.py` が止める）
4. main に入ると、GitHub Actions（`.github/workflows/desktop.yml`）が Windows で exe を作り、本物の WebView2 で自己診断と更新の通しを流し、
   配る ZIP（`DefectTrace-<版>-windows.zip`・`release.json`・`.sha256`）を Releases に版の札 `v<版>` で載せる

手元で作るとき: `cd desktop && cargo build --release` → `python desktop/bundle/bundle.py build --exe desktop/target/release/DefectTrace.exe --out out`

配る ZIP の中身:

```text
DefectTrace/
  DefectTrace.exe          窓・検査データ・画像・解析（全部 exe の中）
  program/app/             画面（static）・名前（brand.json）・版（version.py）
  program/config/          設定の既定（config.json）
  README.md
```

## 更新の置き場

共有フォルダ（や同期フォルダ）に置き場を作り、各 PC の設定（`%LOCALAPPDATA%\DefectTrace\config.json` の `update_source`）に書く。
候補は「;」で複数書ける・`%環境変数%` も使える・同期フォルダの見え方が PC で違っても、下の名前を付け直して探す。

```text
<置き場>\DefectTrace\
  distribute.json          配る版（schema・app_id・version・entry・setAt・setBy・previous・recommended）
  DefectTrace.exe          配る入口（配る版の exe。新しい PC へはこのアドレスだけを渡す）
  <版>\release.json        版の目印（app_id・version・zip・sha256・exe・置いた人と日時）
  <版>\DefectTrace-<版>-windows.zip
```

画面の「配布」（`release_users` に名前がある人。空ならだれでも）で:
- **ZIP から版を置く**: 中身（app_id・版・画面）と指紋を確かめてから、`.<版>.placing-<pid>` へ写し、確かめ直してから名前を変える（各 PC が置きかけを読まない）
- **この版を配る**: `distribute.json` を書き、配る入口（その版の exe）を置き換える。前の版に戻すのも同じ操作
- **推奨の札**: 配っている版に理由を添えて付ける。各 PC は、まだその版でなければ開き直しを強く促す
- **消す**: 配っている版は消せない。`.<版>.removing-<pid>` へ名前を変えてから消す（各 PC から消しかけが見えない）

## 各 PC での流れ

```text
共有の exe・配る入口を開く ──→ この PC の作業場所 app\ へ写す（app\ が無い・古いとき）──→ app\DefectTrace.exe を開き直す
app\DefectTrace.exe（ショートカット）──→ desktop\<印>\DefectTrace.exe（版ごとの写し）で窓を開く（動いている窓が app\ を掴まない）
起動の最初: 置き場を確かめ（8 秒まで待つ）、新しい版があれば取り込み（update\stage）、app\ と入れ替える（前の版は update\old）
使っている間: 30 分ごとに置き場を確かめ、新しい版を裏で取り込んでおく（画面に「開き直して更新」）
入れ替えた版の画面が 30 秒で開けない（/__desktop/ready が来ない）: その版に印（update\FAILED.json）を付け、前の版へ戻して開き直す
```

ショートカット: 無ければ画面が「作りますか」と尋ねる（「今後たずねない」もできる）。共有の exe を指すショートカットは、次の起動でこの PC の app\ を指すように直す。

確かめ方: `desktop/bundle/verify.py update`（共有から写る → 裏で取り込む → 次の起動で入れ替わる → 閉じている間に置いた版に 1 回の起動で入れ替わる →
開けない版は控えへ戻す → 配る版を戻す → 配る入口から新しい PC。CI が Linux と Windows の本物の窓で流す）。
