# 作る・配る・試す道具を Rust へ（版 4.9.0・画面に出ない改良）

利用者の依頼: 「アプリ内に Python が残っているところはありますか？ Rust をメインに再構築したいです」→ 調べた結果のうち
①アイコン ②版の正本 ③版の管理・配る ZIP ④試験のロット・自己診断の設定・更新の通し を「全部進めてください」。
⑤（採点の集計 ui_score.py・実データの確かめ scan_rebuild.py／real_data_check.py）と、版 3.8（Flask）から正解データを取り出す
make_golden.py は対象外（make_golden.py は役目そのものが「古い Python 版を動かすこと」）。

## 測り方（評価関数）

- `program/tools/python-audit.sh [--run]`: Python のファイル（置き場ごとの数・行）・Python を起こす行の数（作る・試験・CI・撮影の道具）。
  `--run` は PATH の python・python3 を「無い」にすり替え、DT_PYTHON も外して、作る（アイコンを描くところから）・正解データとの突き合わせ・
  試験のロットを作る・配る ZIP を作る、の 4 工程を実際に流す
- 道具の置き場の重さ: `cargo tree` の依存の数と、まっさらから作る時間（手元・芯 4・この作業の scratchpad で測った）

## 今（版 4.8.0）の困りごと（測った数）

| 工程（Python を隠して流す） | 結果 |
|---|---|
| a. 作る（`cargo build`。アイコンを描くところから） | **通らない**（build.rs が python で app_icon.py を呼ぶ・15 秒で止まる） |
| b. 正解データとの突き合わせ（`cargo test --test golden`） | **通らない**（試験のロットを python の fixture_lot.py で作る） |
| c. 試験のロットを作る | **通らない** |
| d. 配る ZIP を作る | **通らない** |

- Python のファイル 15・1,976 行（app 2・tests 6・tools 3・bundle 3・版の管理 1）。Python を起こす行 32（build.rs 3・golden.rs 2・ci.yml 13・desktop.yml 12・撮影の道具 2）
- 窓（exe）が動いているときに Python を呼ぶ所は 0。ただし exe は配る形の `program/app/version.py` を字として読み、版を確かめる
  （`update.rs` の `program_version`・`validate_dist`）。**配った古い窓（〜4.8.0）は、置き場の新しい版も version.py で確かめる**ので、
  version.py を急に無くすと古い PC が更新できない
- 正解データ（`desktop/tests/golden.json`）の画像（/img）は中身の SHA-256 で比べる。試験のロットの画像は Python の乱数
  （MT19937・文字の種は SHA-512 を足して種にする・`randbytes`・`randrange`・`uniform`）で作るので、乱数がビットまで同じでないと正解データと合わない
  → 試作（scratchpad の probe）で、Rust の MT19937 が Python の `random.Random("2026_10_25_22_03_53").random()` 3 個・
  `random.Random(5).randbytes(8)` とビットまで一致することを確かめた
- 道具の置き場の重さ: 窓のパッケージ（Tauri）は依存 320・まっさらから作ると **325 秒でもまだ途中**（WebKitGTK が要る。CI の program の職には無い）。
  道具だけのクレート（flate2・zip・sha2・serde_json・chrono・encoding_rs）は依存 36・**8.8 秒**

## 案（7 案。方向: 置き場〈A・B・C〉・減らし方〈D〉・言語〈E〉・版の持ち方〈F〉・答えの持ち方〈G〉）

| 案 | 中身 |
|---|---|
| A 作業用クレート 1 つ（`cargo xtask`）・版は version.json・乱数を再現 | `desktop/` を workspace にし、`desktop/xtask`（lib ＋ コマンド）に アイコン・試験のロット・版の管理・配る ZIP・自己診断の設定・更新の通しをまとめる。`cargo xtask <仕事>`（Rust の慣れた型）。build.rs は xtask のアイコンを build-dependency で直に呼ぶ（外のプログラムを起こさない）。golden.rs は dev-dependency で試験のロットを直に作る。版の正本は `program/app/version.json`（版・記録・更新履歴）。窓は version.json を読み、無ければ version.py（古い版の置き場）。配る ZIP には古い窓のための `version.py`（版の 1 行）を作って入れる。試験のロットは Python の乱数を Rust で再現し、正解データはそのまま |
| B 窓のパッケージの examples に置く | 新しいクレートを作らず、serve.rs の隣に fixture.rs・bundle.rs・verify.rs。アイコンは build.rs に直に書く。golden.rs は fixture を `#[path]` で取り込む。道具を使うたびに窓の依存 320 を作る（WebKitGTK が要る） |
| C 道具ごとの小さなクレート | dt-icon・dt-fixture・dt-release・dt-verify の 4 つ。依存は最小だが、置き場とコマンドが 4 つに分かれる |
| D 描いたアイコンを git に置く ＋ A | 描く道具を無くす（作るときに描かない）。絵を変えるときは別の道具が要り、同じ絵が 2 か所（今の build.rs の方針「.ico をリポジトリへ置くと同じ絵が 2 箇所」に反する） |
| E Node（.mjs）に寄せる | 撮影の道具が既に Node なので、試験のロット・ZIP・更新の通しを JavaScript に。作るとき（build.rs）のアイコンは Rust。依頼の「Rust をメインに」から外れ、言語が 2 つ残る |
| F A ＋ 版の正本を Cargo.toml 1 か所に | tauri.conf.json の version を外し（Tauri は Cargo.toml の版を使う）、`program/app/version.json` は git に置かず作るときに書き出す。更新履歴は別のファイル。版を書く所は 1 か所になるが、git の program だけでは版が分からない（撮影の道具・試しの入口が作る手順を待つ） |
| G A ＋ 乱数は Rust の物・正解データを作り直す | 試験のロットを Rust の乱数で作り、版 3.8（Flask）に問い直して golden.json を作り直す（pip install flask pillow）。乱数の再現の作りは要らないが、正解データを作り直す一度だけ Python と版 3.8 が要り、正解データの差（画像の中身）を人が確かめられない |

## 決めた案と、作った後（測った数）

採点（別のエージェント）: **A 作業用クレート 1 つ（cargo xtask）84.6 点**で決めた（F 71.2・G 68.6・D 63.3・C 62.8・B 57.2・E 54.2・今 52.5）。

| 工程（Python を隠して流す。python-audit.sh --run） | 今（版 4.8.0） | 作った後（版 4.9.0） |
|---|---|---|
| a. 作る（アイコンを描くところから） | 通らない | **通る**（17 秒） |
| b. 正解データとの突き合わせ | 通らない | **通る**（21 秒） |
| c. 試験のロットを作る | 通らない | **通る**（0 秒） |
| d. 配る ZIP を作る | 通らない | **通る**（18 秒） |
| Python のファイル | 15・1,976 行 | 4・617 行（make_golden.py と program/tools の 3 つ。対象外） |
| Python を起こす行 | 32 | 3（ci.yml の program の職が、残した Python の道具を lint する） |

Python と同じ物ができるか（評価関数で突き合わせた）:

- 試験のロット: 正解データ用の木・大きなロット（--bench 3 256 200）・画像なしのロット（--dl2 … --eq DL3 --max-status 0）の 3 つで、
  ファイル 49 個がバイトまで同じ・CAB 6 個は展開した中身と頭が同じ（圧縮のバイトだけ違ってよい）。正解データとの突き合わせ（golden 4 試験）が通る
- アイコン: 256px の RGBA 262,144 値がすべて同じ。.ico の大きさ 8 つ
- 配る物の要約: Python と同じ値（2f5d720ffa598503・23 ファイル。version.json を除く同じ並びで）
- 配る ZIP: 同じ exe から Python（HEAD の bundle.py）と Rust で作り、名前・権限・中身を比べた。違いは version.json が足されたことと
  version.py が版の 1 行の写しになったことだけ（作る途中で、Rust の ZIP が exe の実行の権限を書いていない違いを見つけて直した）
- 本物の窓: 自己診断 24 項目・更新の通し 28 項目が通る（Linux・WebKitGTK）
- 古い PC: git の HEAD から作った版 4.8.0 の窓が、新しい 4.9.0 の ZIP を取り込み、次の起動で 4.9.0 に入れ替わった。
  対照として version.py の写しを抜いた ZIP では「program\app\version.py の版を読めません」と断った（写しが古い PC の更新を守る）
