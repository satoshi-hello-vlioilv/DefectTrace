# -*- coding: utf-8 -*-
"""アプリの版と更新履歴（窓〈desktop/src/update.rs〉・配る ZIP の組み立て〈desktop/bundle/bundle.py〉が読む）。

- APP_VERSION は「大.中.小」。配るたびに上げる（直した・足した: 小、画面や使い方が変わる: 中、作り直し: 大）。
- CHANGELOG の先頭は APP_VERSION と同じ。新しい版を上に足す。
- RELEASE は「配った版と、そのときの配る物の中身の要約」。手で書かず `python app_build.py --release` で書く。
  tests/test_version.py が、いまの中身と RELEASE を比べる（版を上げずにプログラムを変えると失敗する）。
  手順: プログラムを直す → APP_VERSION を上げ、CHANGELOG の先頭に1件足す → python app_build.py --release → テスト
"""
APP_VERSION = "4.0.0"
RELEASE = {"version": "4.0.0", "digest": "025c548fc7d47fb5"}

CHANGELOG = [
    {"version": "4.0.0", "date": "2026-10-26", "notes": [
        "exe から起動するデスクトップ版にしました。Python・Flask・ブラウザは要りません（中身は Rust、画面はこれまでと同じ HTML）。"
        "ポートを開かないので、プロキシやポートの取り合いもありません。",
        "画像の読み込みを速くしました。ロットを開いた瞬間に全部の画像の枠と数が出て、縮小画像は画面の頭から PC の芯の数だけ並べて作ります。"
        "CAB は exe の中で展開し（expand.exe を起こしません）、作業場所には縮小画像だけを書きます（書く量は前の約 20 分の 1）。"
        "原寸は開いたときにメモリで伸ばし、最近の CAB は覚えておきます。",
        "配り方と更新の仕組みを足しました。共有に置いた exe を 1 回開くとこの PC へ写り、以後はショートカットから開きます。"
        "新しい版は使っている間に裏で取り込み、次に開いたときに入れ替わります（開けなければ前の版に戻ります）。",
        "COND*.xml が wavedata/cond の下だけにあるロットでも、分類名・記号・色を読むようにしました（前は分類1・分類2 … になっていました）。",
    ]},
    {"version": "3.8.0", "date": "2026-10-24", "notes": [
        "多量の判定を INSP_INFO.error_count と DETECT_INFO（type=2・kindID=1100）に合わせました。",
        "ロット情報に検査状態チェック（多量・欠陥数上限）と日時の整合を足しました。",
    ]},
]


def version_key(v):
    """版を数の組に（1.10.0 は 1.9.3 より新しい）。足りない桁は 0。"""
    parts = [int(x) for x in str(v).split(".")]
    return tuple(parts + [0] * (3 - len(parts)))[:3]
