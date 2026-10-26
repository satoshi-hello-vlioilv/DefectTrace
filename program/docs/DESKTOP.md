# デスクトップ版の作り（版 4.0.0）

版 3.8 までは Python の Flask がポート 5050 で画面と API を出し、ブラウザで開いていた（run.bat が Python と部品を探し、
無ければ社内のプロキシを通して pip で入れていた）。版 4.0.0 からは、exe（Rust・Tauri）がすべてを受け持つ。

| 受け持ち | 中身 |
|---|---|
| 画面（WebView2） | `program/app/static` の HTML・JS・CSS（版 3.8 と同じ画面。問い合わせは `fetch("/api/…")` のまま） |
| 窓（`desktop/src/main.rs`） | 起動・1 つだけ起動・画面の問い合わせを自前の仕組み（`dt://`。Windows は `http://dt.localhost/`）で受ける・更新と配布・ショートカット |
| 中身（`desktop/src/lib.rs` の下） | `.dat`（`dat.rs`）・XML（`xml.rs`）・ロット（`lot.rs`）・画像（`images.rs`・`cab.rs`・`thumb.rs`）・転写とピッチ（`analysis.rs`）・表示項目（`pins.rs`）・問い合わせ（`app.rs`） |

ポートを開かないので、プロキシ・ポートの取り合い・古いサーバーの残りが無い。

## 版 3.8 と同じ答えか

`program/tests/fixture_lot.py` が検査計の形（`.dat`・Shift_JIS の XML・MSZIP の CAB・8 ビットの BMP）を真似た試験のロットを毎回同じに作り、
`program/tests/make_golden.py` が版 3.8 の Flask 版（git の履歴から取り出す）に 106 の問い合わせをして正解データ（`desktop/tests/golden.json`）を作った。
`desktop/tests/golden.rs` が Rust の答えと突き合わせる（数は 1e-9 の差まで）。違えたのは次の 2 つだけ:
- COND*.xml が `wavedata/cond` の下だけにあるロットでも分類名を読む（版 3.6 の README の約束。版 3.8 は読めていなかった）
- `/api/status` に縮小画像の進み（`thumbs`・`thumbs_total`・`named`）を足した

## 画像の読み込み（7 案を測り、別のエージェントが採点して決めた）

決め方の記録: `program/tools/proposals/2026-10-26-image-loading.md`・`.json`。測る道具: `desktop/examples/imgbench.rs`（案）・`openbench.rs`（作った物）。

- 名前は CAB の頭だけを読んで先に出す（開いた瞬間に全部のカードの枠と数）
- CAB は exe の中で 1 回だけ読み、伸ばしながら縮小画像を作る（expand.exe を起こさない・原寸をディスクへ書かない）
- 縮小画像は画面の並びの順に、PC の芯の数だけ並べて作る。いま開いたロットが先・画面が欲しがった CAB は最優先へ割り込む・2 つ以上前に開いたロットの残りはしない
- 作業場所には縮小画像だけを書く（`%LOCALAPPDATA%\DefectTrace\cache`。新しいロットから `cache_keep_lots` 個）
- 原寸は開いたときに CAB をメモリで伸ばし、最近の CAB を `memory_mb`（既定 160MB）まで覚える
- 読めない形の CAB（Quantum など）は、Windows の expand（ほかは cabextract）で読む

## 設定（`%LOCALAPPDATA%\DefectTrace\config.json`）

無ければ配る物の `program/config/config.json` を写して作る。版 3.8 の config.json の項目はそのまま使える（`port` は使わない）。足した項目:
`update_source`（更新の置き場）・`release_users`（配布できる人。空ならだれでも）・`memory_mb`・`workers`（0 = 芯の数）。
表示項目（`pins.json`）も同じ場所に置く（版 3.8 の pins.json を写せばそのまま使える）。
