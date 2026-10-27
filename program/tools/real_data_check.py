"""実データの .dat の読み方を、定義（InspectDataInfo.xml）に頼らずに確かめる（評価関数）。

    python program/tools/scan_rebuild.py <作り直し> scan_*.txt     # 解析結果から .dat を作り直す
    python program/tools/real_data_check.py <作り直し>              # 設備ごとに確かめる

解析結果（scan_*.txt）は .dat の全バイトを持つが、定義の XML は先頭 20 行しか無い。そこで、アプリの読み方が頼っている
「形」を、データだけから確かめる。欄の位置は決め打ちせず、データから探す（次の解析でも同じに使える）:
  1. 入れ物: 頭の長さ ＋ 件数 ×（1 件のバイト数 ＋ 印 1 バイト）＝ ファイルの大きさ（余りが 0）
  2. 日時: 8 バイトの日時（Kind ＋ tick）。INSP_INFO の検査開始がロットのフォルダ名の時刻と同じ・欠陥の時刻が検査の間に入る。
     Kind（0＝時刻の種類なし・1＝UTC・2＝現地）。アプリは Kind 1・2 のときだけ時差を見る
  3. 画像と欠陥: IMAGE_LINK（画像の ID・画像の番号・欠陥の記録の番号）の番号の欠陥の記録に、同じ画像の ID があるか
  4. 単位: 欠陥の長さ方向の位置（時間とともに増える欄）が、INSP_INFO の検査長（insp_end_y）を超えない＝同じ単位（mm）
  5. 記録の種類: DETECT_INFO の先頭の int32（1＝欠陥・2＝多量・ほか）の数と、画像の数
どれかが外れたら、終了コード 1。
"""

import collections
import datetime as dt
import struct
import sys
from pathlib import Path

EPOCH = dt.datetime(1, 1, 1)


def records(path: Path):
    b = path.read_bytes()
    hl, _ver, rs = struct.unpack_from("<iii", b, 0)
    step = rs + 1
    n, rest = divmod(len(b) - hl, step)
    return [b[hl + i * step + 1:hl + (i + 1) * step] for i in range(n)], rest, rs


def ticks(v: int):
    kind, t = v >> 62, v & ((1 << 62) - 1)
    try:
        return kind, EPOCH + dt.timedelta(microseconds=t // 10)
    except OverflowError:
        return kind, None


def find_dt(recs, lo, hi, limit=200):
    """日時の欄の位置: 先頭の記録で、lo〜hi に入る 8 バイトがいちばん多い位置。"""
    c = collections.Counter()
    for r in recs[:limit]:
        for o in range(0, len(r) - 7):
            k, d = ticks(struct.unpack_from("<Q", r, o)[0])
            if d and lo <= d <= hi:
                c[(o, k)] += 1
    return c.most_common(1)[0][0] if c else (None, None)


def check_lot(lot: Path, say) -> int:
    bad = 0
    name = lot.name
    ref = dt.datetime.strptime(name[:19], "%Y_%m_%d_%H_%M_%S")
    # 1. 入れ物
    for p in sorted(lot.rglob("*")):
        if p.suffix.lower() != ".dat" or p.name.lower() == "dirinfo.dat":   # dirinfo.dat は別の形（アプリは読まない）
            continue
        recs, rest, rs = records(p)
        if rest:
            bad += 1
            say(f"NG 入れ物 {p.relative_to(lot)}: 余り {rest} バイト")
    ii, _, _ = records(lot / "INSP_INFO.DAT")
    det, _, _ = records(lot / "DETECT_INFO.dat")
    link, _, _ = records(lot / "IMAGE_LINK.dat")
    # 2. 日時（INSP_INFO の検査開始・終了と、欠陥の時刻）
    o, kind = find_dt(ii, ref - dt.timedelta(minutes=1), ref + dt.timedelta(minutes=1))
    if o is None:
        bad += 1
        say(f"NG 日時 INSP_INFO に、フォルダ名の時刻 {ref} の日時が無い")
        return bad
    st = ticks(struct.unpack_from("<Q", ii[0], o)[0])[1]
    ed = ticks(struct.unpack_from("<Q", ii[0], o + 8)[0])[1]
    do, dk = find_dt(det, st - dt.timedelta(minutes=1), ed + dt.timedelta(minutes=1))
    out = sum(1 for r in det if not (st - dt.timedelta(minutes=1) <= ticks(struct.unpack_from("<Q", r, do)[0])[1] <= ed + dt.timedelta(minutes=1)))
    say(f"   日時: 検査 {st:%H:%M:%S}〜{ed:%H:%M:%S}（Kind {kind}）・欠陥の時刻（位置 {do}・Kind {dk}）が検査の外 {out}/{len(det)}")
    bad += out > 0
    # 3. 画像と欠陥（IMAGE_LINK: 画像の ID・画像の番号・欠陥の記録の番号）
    lk = [struct.unpack_from("<iii", r, 0) for r in link]
    pos = collections.Counter()
    for iid, _fno, rn in lk[:200]:
        if 0 <= rn < len(det):
            for p in range(0, len(det[rn]) - 7):
                if struct.unpack_from("<q", det[rn], p)[0] == iid:
                    pos[p] += 1
    ip = pos.most_common(1)[0][0] if pos else None
    ok = sum(1 for iid, _f, rn in lk if ip is not None and 0 <= rn < len(det) and struct.unpack_from("<q", det[rn], ip)[0] == iid)
    say(f"   画像と欠陥: IMAGE_LINK {len(lk)} 件のうち、番号の欠陥の記録に同じ画像の ID がある {ok} 件（欠陥の記録の位置 {ip}）")
    bad += ok != len(lk)
    # 4. 単位（INSP_INFO の検査長 ＝ 日時 2 つ・範囲の始点・終点の次の double）
    end_y = struct.unpack_from("<d", ii[0], o + 16 + 24)[0]
    best = None
    for p in range(0, len(det[0]) - 7):
        v = [struct.unpack_from("<d", r, p)[0] for r in det]
        if all(0 <= x <= end_y * 1.001 for x in v) and max(v) > end_y * 0.5:
            inc = sum(1 for a, c in zip(v, v[1:]) if c >= a) / max(1, len(v) - 1)
            if not best or inc > best[0]:
                best = (inc, p, max(v))
    if best:
        say(f"   単位: 検査長 insp_end_y {end_y:,.1f} mm（= {end_y / 1000:,.2f} m）・欠陥の長さ方向の位置（位置 {best[1]}）の最大 {best[2]:,.1f}（増える割合 {best[0]:.0%}）")
    else:
        bad += 1
        say(f"NG 単位: 検査長 {end_y} を超えない、増えていく欄が見つからない")
    # 5. 記録の種類（先頭の int32）と画像の数
    types = collections.Counter(struct.unpack_from("<i", r, 0)[0] for r in det)
    say(f"   記録の種類: {dict(sorted(types.items()))}（1＝欠陥）・画像 {len(lk)} 枚・画像の無い欠陥 {types.get(1, 0) - len(lk)}")
    return bad


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    bad = 0
    for lot in sorted(p.parent for p in Path(argv[0]).rglob("INSP_INFO.DAT")):
        print(f"== {lot.parent.name} {lot.name}")
        bad += check_lot(lot, print)
    print("全部 OK" if not bad else f"NG {bad} 件")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
