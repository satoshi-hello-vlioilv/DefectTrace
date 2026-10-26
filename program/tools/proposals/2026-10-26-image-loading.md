# 画像の読み込み方（版 4.0.0・画面に出ない改良）

## 今（版 3.8・Python）の困りごと（測った数）

試験のロット（`program/tests/fixture_lot.py --bench 20 512 400`: CAB 20 個 × 100 枚・8 ビット 512×400 の BMP・266 MB）を、
版 3.8 の Python 版（Flask・`expand`〔Linux では cabextract〕・Pillow・糸 4 本）で開いた（手元のディスク・回線の遅れなし）:

| 測った物 | 版 3.8 |
|---|---|
| 1 つめの CAB が済む | 0.16 秒 |
| 全部の CAB を展開し終える（＝全部の画像の名前が分かる） | 2.3〜2.7 秒 |
| 全部の縮小画像がそろう | 2.5〜3.0 秒 |
| 作業場所に書く量 | 原寸 410 MB ＋ 縮小画像 |

- 画像の名前は、CAB を展開し終えるまで分からない（それまで画面にカードの枠を並べられない・数が分からない）
- 展開は CAB ごとに `expand.exe` を起こし、ディスクへ書いてから読み直して縮める（Windows では起こすたびに時間がかかる）
- 縮小画像は CAB を展開した糸が 1 枚ずつ作る。画面で見ている所かどうかに関係なく、CAB の順に進む
- 原寸を開くと、その CAB の展開が済むまで待つ（`ensure` が回るのを待つ）
- 実際の共有フォルダ（SMB）では、開くたびの遅れと回線の太さが効く

## 測り方（評価関数）

`desktop/examples/imgbench.rs`。同じロットで案ごとに測る:

```sh
cd desktop
cargo build --release --example imgbench
./target/release/examples/imgbench <ロット> <同じ日の 2 つめのロット>                       # 共有を真似る（開くたび 3ms・回線 110MB/s を全部の糸で分け合う）
./target/release/examples/imgbench <ロット> <2 つめ> --latency-ms 0 --mbps 100000          # 手元のディスク（計算と書き込みの速さ）
```

names（全部の名前が分かる）・screen（画面 1 枚分 45 枚の縮小画像がそろう）・all（全部そろう）・view（開いて 0.3 秒後に後ろの方の画像を原寸で開き、出るまで）・
lot2（同じ日の 2 つめのロット）・cache_mb（作業場所に書いた量）・screen_kb（画面 1 枚分のために画面へ送る量）。

## 案（7 案。何で解くか: 速さ〈v1・v2〉・流れの順〈v3〉・減らし方〈v4・v7〉・先回り〈v5〉・置き場〈v6・v7〉）

| 案 | 中身 |
|---|---|
| v1 Rust で同じ流れ | 版 3.8 と同じ順（CAB ごとに展開してディスクへ → 読み直して縮める）。展開は exe の中（expand.exe を起こさない）。糸 4 本 |
| v2 メモリで一度に | CAB を 1 回で読み、伸ばしながら原寸と縮小画像を書く（読み直さない）。糸は芯の数 |
| v3 見ている所から | 名前は CAB の頭だけを読んで先に出す。CAB は画面の並びの順、縮小は 1 枚ずつ芯へ配る（前ほど先）。原寸を開いたらその CAB を最優先へ割り込ませる |
| v4 縮小画像を作らない | 原寸を展開するだけ。画面は原寸の BMP をそのまま縮めて見せる |
| v5 先回り | v3 に加えて、ロットを見終えた空き時間に同じ日の次のロットを裏で用意しておく |
| v6 CAB のまま持つ | v3 の順で、原寸は展開せず CAB を手元へ写す。原寸は開いたときに手元の CAB をメモリで伸ばす |
| v7 縮小画像だけを持つ | v3 の順で、作業場所には縮小画像だけを書く。原寸は開いたときに共有の CAB を読み直してメモリで伸ばす |

## 測った数（1 回目・案を作った者が流した物。採点する者は自分で流し直す）
### 共有を真似る（3ms・110MB/s）
```
{"lot1":{"all":2.808,"cache_mb":431.357,"names":2.674,"screen":0.437,"screen_kb":441.594,"view":1.74},"lot2":{"all":2.86,"cache_mb":431.357,"names":2.742,"screen":0.317,"screen_kb":441.594,"view":1.733},"threads":4,"variant":"v1"}
{"lot1":{"all":3.079,"cache_mb":431.357,"names":3.079,"screen":0.295,"screen_kb":441.594,"view":1.887},"lot2":{"all":3.36,"cache_mb":431.357,"names":3.36,"screen":0.283,"screen_kb":441.594,"view":1.903},"threads":4,"variant":"v2"}
{"lot1":{"all":4.157,"cache_mb":431.357,"names":0.072,"screen":0.881,"screen_kb":441.594,"view":0.366},"lot2":{"all":3.303,"cache_mb":431.357,"names":0.024,"screen":0.639,"screen_kb":441.594,"view":0.341},"threads":4,"variant":"v3"}
{"lot1":{"all":2.738,"cache_mb":411.756,"names":2.738,"screen":0.227,"screen_kb":9264.51,"view":1.732},"lot2":{"all":2.787,"cache_mb":411.756,"names":2.787,"screen":0.458,"screen_kb":9264.51,"view":1.733},"threads":4,"variant":"v4"}
{"lot1":{"all":3.417,"cache_mb":431.357,"names":0.026,"screen":0.645,"screen_kb":441.594,"view":0.343},"lot2":{"all":0.001,"cache_mb":431.357,"names":0.0,"screen":0.001,"view":0.0},"threads":4,"variant":"v5"}
{"lot1":{"all":2.789,"cache_mb":297.886,"names":0.023,"screen":0.504,"screen_kb":441.594,"view":0.423},"lot2":{"all":2.908,"cache_mb":297.886,"names":0.024,"screen":0.496,"screen_kb":441.594,"view":0.417},"threads":4,"variant":"v6"}
{"lot1":{"all":2.765,"cache_mb":19.601,"names":0.022,"screen":0.275,"screen_kb":441.594,"view":0.339},"lot2":{"all":2.775,"cache_mb":19.601,"names":0.024,"screen":0.54,"screen_kb":441.594,"view":0.339},"threads":4,"variant":"v7"}
```
### 手元のディスク
```
{"lot1":{"all":1.859,"cache_mb":431.357,"names":1.657,"screen":0.308,"screen_kb":441.594,"view":0.81},"lot2":{"all":1.836,"cache_mb":431.357,"names":1.669,"screen":0.276,"screen_kb":441.594,"view":0.864},"threads":4,"variant":"v1"}
{"lot1":{"all":1.617,"cache_mb":431.357,"names":1.617,"screen":0.125,"screen_kb":441.594,"view":0.655},"lot2":{"all":2.328,"cache_mb":431.357,"names":2.328,"screen":0.2,"screen_kb":441.594,"view":1.059},"threads":4,"variant":"v2"}
{"lot1":{"all":2.464,"cache_mb":431.357,"names":0.078,"screen":0.422,"screen_kb":441.594,"view":0.007},"lot2":{"all":2.056,"cache_mb":431.357,"names":0.025,"screen":0.376,"screen_kb":441.594,"view":0.028},"threads":4,"variant":"v3"}
{"lot1":{"all":1.209,"cache_mb":411.756,"names":1.209,"screen":0.121,"screen_kb":9264.51,"view":0.459},"lot2":{"all":1.32,"cache_mb":411.756,"names":1.32,"screen":0.098,"screen_kb":9264.51,"view":0.47},"threads":4,"variant":"v4"}
{"lot1":{"all":2.068,"cache_mb":431.357,"names":0.021,"screen":0.265,"screen_kb":441.594,"view":0.006},"lot2":{"all":0.001,"cache_mb":431.357,"names":0.0,"screen":0.001,"view":0.0},"threads":4,"variant":"v5"}
{"lot1":{"all":1.657,"cache_mb":297.886,"names":0.031,"screen":0.231,"screen_kb":441.594,"view":0.106},"lot2":{"all":1.467,"cache_mb":297.886,"names":0.022,"screen":0.213,"screen_kb":441.594,"view":0.082},"threads":4,"variant":"v6"}
{"lot1":{"all":0.962,"cache_mb":19.601,"names":0.019,"screen":0.119,"screen_kb":441.594,"view":0.004},"lot2":{"all":0.961,"cache_mb":19.601,"names":0.026,"screen":0.123,"screen_kb":441.594,"view":0.004},"threads":4,"variant":"v7"}
```
