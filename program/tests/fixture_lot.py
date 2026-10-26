# -*- coding: utf-8 -*-
"""試験用のロットを作る（検査計の共有フォルダを真似る。標準の部品だけで動き、毎回同じ物ができる）。

    python fixture_lot.py <作る場所>                  正解データ（golden）用の小さな木（3 ロット）
    python fixture_lot.py <作る場所> --bench N W H     速さを測る大きなロット（N 個の CAB × 100 枚、W×H の BMP）

作る木（設備 > 年 > 年月 > 日 > ロット。<作る場所>/LS3/2026/2026_10/2026_10_25/2026_10_25_22_03_53 など）:
  - LS3 のロット: img/0000.cab …（MSZIP の CAB・IMAGE_LINK）と fm_img/0000/*.bmp（フォルダ・FM_IMAGE_LINK）
    表と裏で幅方向位置が近い欠陥（転写候補）、等間隔の欠陥の列（ピッチ候補）、多量（type=2・kindID=1100）を含む
  - DL2 のロット: 画像なし。表裏の group が LS3 と逆。COND*.xml は wavedata/cond の下だけにある
  - フォルダ名がロットの形でないフォルダ（一覧に出るがロットではない）
.dat の形と DateTime の保存方式（UTC 保存・現地時刻保存）は program/docs/DATA_FORMAT.md。
"""
from __future__ import annotations

import random
import struct
import sys
import zlib
from datetime import datetime, timedelta
from pathlib import Path

EPOCH = datetime(1, 1, 1)
UTC_OFFSET = timedelta(hours=9)

# ------------------------------------------------------------------ 定義（InspectDataInfo.xml）
STRUCTS = {
    "DETECT_INFO": ("100", [
        ("欠陥No", "detectNo", "System.Int32", 0, 1),
        ("記録の種類", "type", "System.Int32", 0, 1),
        ("分類", "kindID", "System.Int32", 0, 1),
        ("面", "group", "System.Int32", 0, 1),
        ("カメラ", "camera", "System.Int32", 0, 1),
        ("X座標(mm)", "x_mm", "System.Double", 0, 1),
        ("基準X", "base_x", "System.Double", 0, 1),
        ("X終点", "x_end", "System.Double", 0, 1),
        ("Y座標(mm) for length", "y_mm", "System.Double", 0, 1),
        ("幅", "width_mm", "System.Double", 0, 1),
        ("長さ", "length_mm", "System.Double", 0, 1),
        ("面積", "area_mm", "System.Double", 0, 1),
        ("ピークレベル明", "peek_level1", "System.Int16", 0, 1),
        ("ピークレベル暗", "peek_level2", "System.Int16", 0, 1),
        ("平均レベル暗", "ave_level2", "System.Single", 0, 1),
        ("ライン速度", "line_speed", "System.Single", 0, 1),
        ("発生日時", "datetime", "System.DateTime", 0, 1),
        ("画像ID", "image_id", "System.Int64", 0, 1),
        ("予備", "reserve", "System.Byte[]", 6, 1),
    ]),
    "IMAGE_LINK": ("200", [
        ("画像ファイル番号", "image_fileno", "System.Int32", 0, 1),
        ("欠陥レコード番号", "detect_recno", "System.Int32", 0, 1),
        ("画像ID", "image_id", "System.Int64", 0, 1),
    ]),
    "FM_IMAGE_LINK": ("210", [
        ("画像ファイル番号", "image_fileno", "System.Int32", 0, 1),
        ("欠陥レコード番号", "detect_recno", "System.Int32", 0, 1),
        ("画像ID", "image_id", "System.Int64", 0, 1),
    ]),
    "INSP_INFO": ("300", [
        ("検査開始日時", "start_time", "System.DateTime", 0, 1),
        ("検査終了日時", "end_time", "System.DateTime", 0, 1),
        ("検査長 comment 1", "insp_end_y", "System.Double", 0, 1),
        ("欠陥総数", "detect_total_cnt", "System.Int32", 0, 1),
        ("画像総数", "image_total_cnt", "System.Int32", 0, 1),
        ("検査範囲始点", "insp_area_st", "System.Double", 0, 1),
        ("検査範囲終点", "insp_area_ed", "System.Double", 0, 1),
        ("分類別件数", "classification_count", "System.Int32", 0, 8),
        ("多量集計数", "error_count", "System.Int32", 0, 1),
        ("欠陥数上限", "detect_max_status", "System.Byte", 0, 1),
        ("検査状態", "insp_state", "System.Int16", 0, 1),
        ("良否", "ok", "System.Boolean", 0, 1),
        ("品名", "product", "System.String", 16, 1),
        ("備考", "note", "System.String", 0, 1),     # 長さの無い文字列 = 残りのバイト
    ]),
    "STAT_INFO": ("400", [
        ("時刻", "time", "System.DateTime", 0, 1),
        ("件数", "count", "System.UInt16", 0, 1),
    ]),
    "SLIT_MASK_STAT": ("500", [
        ("設定日時", "date_time", "System.DateTime", 0, 1),
        ("マスク", "mask", "System.UInt32", 0, 2),
    ]),
}
# 共通の頭（link で取り込む）
COMMON = ("900", [("連番", "seq", "System.UInt32", 0, 1)])
LINKED = {"STAT_INFO"}
FMT = {"System.Int32": "i", "System.UInt32": "I", "System.Int64": "q", "System.UInt64": "Q", "System.Int16": "h",
       "System.UInt16": "H", "System.Byte": "B", "System.SByte": "b", "System.Double": "d", "System.Single": "f",
       "System.DateTime": "Q", "System.Boolean": "?"}


def defs_xml() -> str:
    out = ['<?xml version="1.0" encoding="shift_jis"?>', "<InspectDataInfo>", " <definitions>"]
    for sid, fields in [COMMON] + list(STRUCTS.values()):
        name = next((k for k, v in STRUCTS.items() if v[0] == sid), "COMMON")
        out.append(f'  <structure id="{sid}" name="{name}">')
        if name in LINKED:
            out.append(f'   <link id="{COMMON[0]}"/>')
        for label, fname, typ, length, cnt in fields:
            out.append(f"   <!-- {label} -->")
            attrs = f'name="{fname}" type="{typ}"' + (f' length="{length}"' if length else "") + (f' item_cnt="{cnt}"' if cnt > 1 else "")
            out.append(f"   <field {attrs}/>")
        out.append("  </structure>")
    out.append(" </definitions>")
    out.append(" <system_default>")
    for name, (sid, _f) in STRUCTS.items():
        out.append(f'  <{name} dataVersion="{sid}"/>')
    out.append(" </system_default>")
    out.append("</InspectDataInfo>")
    return "\n".join(out) + "\n"


def fields_of(name):
    f = list(STRUCTS[name][1])
    return (list(COMMON[1]) if name in LINKED else []) + f


def ticks(d: datetime, kind=2, utc=True) -> int:
    """DateTime の 8 バイト。utc=True は ToBinary の形（Kind=Local/Utc の値を UTC で持つ）"""
    if utc and kind in (1, 2):
        d = d - UTC_OFFSET
    t = int((d - EPOCH).total_seconds() * 10_000_000)
    return (kind << 62) | t


def write_dat(path: Path, name: str, records: list[dict], rec_size: int | None = None, version: str | None = None):
    fields = fields_of(name)
    parts = []
    for r in records:
        b = b""
        for _label, fname, typ, length, cnt in fields:
            v = r.get(fname)
            if typ == "System.String":
                L = length or (rec_size - fixed_size(fields)) if rec_size else length
                raw = (v or "").encode("cp932")[:L]
                b += raw + b"\0" * (L - len(raw))
            elif typ == "System.Byte[]":
                b += b"\xAB" * length
            else:
                vals = v if isinstance(v, list) else [v if v is not None else 0]
                b += struct.pack("<" + FMT[typ] * cnt, *vals)
        parts.append(b)
    rs = rec_size or (len(parts[0]) if parts else fixed_size(fields))
    nm = name.encode("ascii")
    head = struct.pack("<iii", 13 + len(nm), int(version or STRUCTS[name][0]), rs) + bytes([len(nm)]) + nm
    body = b"".join(bytes([1]) + p for p in parts)
    path.write_bytes(head + body)


def fixed_size(fields):
    n = 0
    for _l, _f, typ, length, cnt in fields:
        if typ in ("System.String", "System.Byte[]"):
            n += length * cnt
        else:
            n += struct.calcsize("<" + FMT[typ]) * cnt
    return n


# ------------------------------------------------------------------ XML（条件の定義）
def cond_xml(kinds, lot_no, comments) -> bytes:
    rows = ['<?xml version="1.0" encoding="Shift_JIS"?>', "<condition>", '  <header><cond_name value="条件A-01"/></header>',
            "  <target_conditions><target><roll_info><comments>"]
    for c in comments:
        rows.append(f'    <comment value="{c}"/>')
    rows.append("  </comments></roll_info></target></target_conditions>")
    rows.append("  <classification_conditions>")
    for name, mark, color in kinds:
        rows.append(f'    <classification_condition><name value="{name}"/><map_mark value="{mark}"/><mark_color value="{color}"/></classification_condition>')
    rows.append("  </classification_conditions>")
    rows.append("</condition>")
    return ("\n".join(rows) + "\n").encode("cp932")


def common_xml(groups) -> bytes:
    rows = ['<?xml version="1.0" encoding="shift_jis"?>', "<condition>", "  <group_conditions>"]
    for name, color in groups:
        rows.append(f'    <group><disp_name value="{name}"/><disp_color value="{color}"/></group>')
    rows.append("  </group_conditions>")
    rows.append("</condition>")
    return ("\n".join(rows) + "\n").encode("cp932")


def system_xml(groups) -> str:
    rows = ['<?xml version="1.0" encoding="utf-8"?>', "<condition>", "  <group_conditions>"]
    for scan, cams in groups:
        rows.append(f'    <group><camera_amount value="{len(cams)}"/><scan_direction value="{scan}"/><camera_conditions>')
        for i, (st, ed) in enumerate(cams):
            rows.append(f'      <camera_info><visual_field><start_mm value="{st}"/><end_mm value="{ed}"/></visual_field>'
                        f'<configuration_info><lsc_no value="{i + 1}"/></configuration_info></camera_info>')
        rows.append("    </camera_conditions></group>")
    rows.append("  </group_conditions>")
    rows.append("</condition>")
    return "\n".join(rows) + "\n"


INSP_DEF = """<?xml version="1.0" encoding="utf-8"?>
<condition>
  <!-- 条件の頭 -->
  <header>
    <!-- 条件名 -->
    <cond_name value=""/>
  </header>
  <target_conditions><target><roll_info>
    <!-- コメント -->
    <comments><comment value=""/></comments>
  </roll_info></target></target_conditions>
  <!-- 分類（色・記号） -->
  <classification_conditions><classification_condition>
    <!-- 分類名 -->
    <name value=""/>
  </classification_condition></classification_conditions>
  <!-- 面の条件 -->
  <group_conditions><group>
    <!-- 表示名 -->
    <disp_name value=""/>
  </group></group_conditions>
</condition>
"""


# ------------------------------------------------------------------ 画像（8 ビットの BMP）と CAB（MSZIP）
NOISE = bytes(150 + (i * 41 // 256) for i in range(256))


def bmp(w: int, h: int, seed: int) -> bytes:
    rnd = random.Random(seed)
    stride = (w + 3) & ~3
    noise = rnd.randbytes(stride * h).translate(NOISE)      # 実物に近い圧縮の効きにくさ（地の濃淡のばらつき）
    rows = []
    cx, cy, r = rnd.randrange(w // 4, 3 * w // 4), rnd.randrange(h // 4, 3 * h // 4), max(4, min(w, h) // 10)
    for y in range(h):
        row = bytearray(noise[y * stride:(y + 1) * stride])
        if abs(y - cy) < r:
            a, b = max(0, cx - r), min(w, cx + r)
            row[a:b] = bytes([40]) * (b - a)
        rows.append(bytes(row))
    pixels = b"".join(rows)
    pal = b"".join(bytes([i, i, i, 0]) for i in range(256))
    off = 14 + 40 + len(pal)
    head = b"BM" + struct.pack("<IHHI", off + len(pixels), 0, 0, off)
    info = struct.pack("<IiiHHIIiiII", 40, w, h, 1, 8, 0, len(pixels), 2835, 2835, 256, 0)
    return head + info + pal + pixels


def cab(files: list[tuple[str, bytes]]) -> bytes:
    """CAB（1 フォルダ・MSZIP）。CFDATA は 32KB ごとに独立した deflate（前の塊を辞書に使わない）"""
    data = b"".join(b for _n, b in files)
    blocks = []
    for i in range(0, max(len(data), 1), 32768):
        raw = data[i:i + 32768]
        c = zlib.compressobj(9, zlib.DEFLATED, -15)
        blocks.append((b"CK" + c.compress(raw) + c.flush(), len(raw)))
    cffiles = b""
    pos = 0
    for name, body in files:
        nm = name.encode("ascii") + b"\0"
        cffiles += struct.pack("<IIHHHH", len(body), pos, 0, 0x5A21, 0x8000, 0x20) + nm
        pos += len(body)
    head_len = 36
    folder_len = 8
    data_off = head_len + folder_len + len(cffiles)
    cfdata = b"".join(struct.pack("<IHH", 0, len(c), n) + c for c, n in blocks)
    total = data_off + len(cfdata)
    header = b"MSCF" + struct.pack("<IIIIIBBHHHHH", 0, total, 0, head_len + folder_len, 0, 3, 1, 1, len(files), 0, 0, 0)
    folder = struct.pack("<IHH", data_off, len(blocks), 1)      # 1 = MSZIP
    return header + folder + cffiles + cfdata


# ------------------------------------------------------------------ ロット
LS3_KINDS = [("未分類", "・", "128,128,128"), ("穴", "●", "220,40,40"), ("汚れ", "▲", "40,120,220"),
             ("キズ", "■", "40,160,80"), ("周期", "★", "200,120,0")]
COMMENTS = ["L2610-0042", "3", "C-12", "缶材", "A5182", "H19", "0.245", "1650", "K-88", "1", "標準", "飲料缶"]


def lot_dir(root: Path, eq: str, name: str) -> Path:
    y, mo, d = name[:4], name[5:7], name[8:10]
    p = root / eq / y / f"{y}_{mo}" / f"{y}_{mo}_{d}" / name
    p.mkdir(parents=True, exist_ok=True)
    return p


def detects_for(ref: datetime, n_img: int, rnd: random.Random):
    """欠陥の並び。転写（表裏で近い位置）・ピッチ（等間隔）・多量を含む"""
    recs = []

    def add(group, x, y, kind=1, typ=1, w=1.2, ln=2.5, cam=None):
        i = len(recs)
        recs.append({"detectNo": i + 1, "type": typ, "kindID": kind, "group": group,
                     "camera": cam if cam is not None else (group * 3 + int(x // 560)), "x_mm": 100.0 + x, "base_x": 100.0,
                     "x_end": 100.0 + 1650.0, "y_mm": y * 1000.0, "width_mm": w, "length_mm": ln, "area_mm": round(w * ln * 0.8, 3),
                     "peek_level1": 200 + i % 40, "peek_level2": -(30 + i % 50), "ave_level2": 61.5 + (i % 7) * 0.25,
                     "line_speed": 250.0, "datetime": ticks(ref + timedelta(seconds=30 + y * 0.24)), "image_id": 70000 + i * 3})
    for k in range(n_img):
        add(k % 2, rnd.uniform(50, 1600), rnd.uniform(1, 3000), kind=1 + k % 4)
    # 転写: 表(1)と裏(0)で幅方向が 2mm 以内
    for k in range(6):
        x, y = 300 + k * 180.0, 500 + k * 400.0
        add(1, x, y, kind=2)
        add(0, x + rnd.uniform(-2, 2), y + rnd.uniform(-3, 3), kind=2)
    # ピッチ: 面 1、幅 812mm、間隔 1.571m（1 つ欠け）
    for j in (0, 1, 2, 4, 5, 6):
        add(1, 812 + rnd.uniform(-1.5, 1.5), 1200 + j * 1.571 + rnd.uniform(-0.01, 0.01), kind=4)
    # 多量: type=2・kindID=1100
    for j in range(5):
        add(0, 900.0, 2500 + (j // 2) * 0.5, kind=1100, typ=2, w=1650, ln=500)
    return recs


def make_ls3(root: Path, name: str, n_cab: int, per_cab: int, w: int, h: int, fm: bool = True) -> Path:
    lot = lot_dir(root, "LS3", name)
    ref = datetime.strptime(name, "%Y_%m_%d_%H_%M_%S")
    rnd = random.Random(name)
    (lot / "cond").mkdir(exist_ok=True)
    (lot / "option").mkdir(exist_ok=True)
    (lot / "cond" / "COND01.xml").write_bytes(cond_xml(LS3_KINDS, "L2610-0042", COMMENTS))
    (lot / "cond" / "Common.xml").write_bytes(common_xml([("裏面", "30,90,168"), ("表面", "200,60,40")]))
    (lot / "cond" / "SystemCond.xml").write_bytes(system_xml([("0", [(0, 560), (560, 1120), (1120, 1700)]),
                                                              ("1", [(0, 560), (560, 1120), (1120, 1700)])]).encode("utf-8"))
    (lot / "option" / "InspectDataInfo.xml").write_bytes(defs_xml().encode("cp932"))
    (lot / "option" / "InspCondDef.xml").write_bytes(INSP_DEF.encode("utf-8"))
    n_img = n_cab * per_cab
    recs = detects_for(ref, max(n_img, 40), rnd)
    write_dat(lot / "DETECT_INFO.dat", "DETECT_INFO", recs)
    links, fno = [], 0
    if n_cab:
        img = lot / "img"
        img.mkdir(exist_ok=True)
        for c in range(n_cab):
            files = []
            for k in range(per_cab):
                files.append((f"{fno}.bmp", bmp(w, h, fno)))
                if k < 3 and w <= 128:   # 画像ごとの XML（画像情報に出る。正解データの小さなロットだけ）
                    files.append((f"{fno}_info.xml", f'<?xml version="1.0" encoding="utf-8"?><image><camera_gain value="{1.5 + k}"/><memo>試験 {fno}</memo></image>'.encode()))
                # 画像 N.bmp → 欠陥。順番を少しずらす（記録順と画像の順は一致しない）
                di = (fno * 7) % len(recs) if recs[(fno * 7) % len(recs)]["type"] == 1 else 0
                links.append({"image_fileno": fno, "detect_recno": di, "image_id": recs[di]["image_id"]})
                fno += 1
            (img / f"{c:04d}.cab").write_bytes(cab(files))
        write_dat(lot / "IMAGE_LINK.dat", "IMAGE_LINK", links)
    if fm:
        fmd = lot / "fm_img" / "0000"
        fmd.mkdir(parents=True, exist_ok=True)
        fl = []
        for k in range(6):
            (fmd / f"{k}.bmp").write_bytes(bmp(64, 48, 1000 + k))
            fl.append({"image_fileno": k, "detect_recno": k + 1, "image_id": recs[k + 1]["image_id"]})
        write_dat(lot / "FM_IMAGE_LINK.DAT", "FM_IMAGE_LINK", fl)
    cc = [0] * 8
    for r in recs:
        if r["type"] == 1 and r["kindID"] < 8:
            cc[r["kindID"]] += 1
    # INSP_INFO は現地時刻のまま保存（Kind=Local）。DETECT_INFO は UTC 保存
    insp = {"start_time": ticks(ref + timedelta(seconds=5), utc=False), "end_time": ticks(ref + timedelta(minutes=13), utc=False),
            "insp_end_y": 3021500.0, "detect_total_cnt": sum(1 for r in recs if r["type"] == 1), "image_total_cnt": n_img,
            "insp_area_st": 12.5, "insp_area_ed": 1662.5, "classification_count": cc, "error_count": 5, "detect_max_status": 0,
            "insp_state": 1, "ok": True, "product": "缶材 A5182", "note": "試験ロット"}
    fields = fields_of("INSP_INFO")
    write_dat(lot / "INSP_INFO.DAT", "INSP_INFO", [insp], rec_size=fixed_size(fields) + 24)
    write_dat(lot / "STAT_INFO.dat", "STAT_INFO", [{"seq": i, "time": ticks(ref + timedelta(minutes=i), kind=0, utc=False), "count": i * 3}
                                                  for i in range(12)])
    write_dat(lot / "SLIT_MASK_STAT.dat", "SLIT_MASK_STAT", [{"date_time": ticks(ref - timedelta(minutes=2)), "mask": [3, 5]}])
    (lot / "notes.txt").write_bytes(b"memo")
    return lot


def make_dl2(root: Path, name: str) -> Path:
    """画像なし・表裏が逆・COND は wavedata/cond だけ・欠陥数上限オーバー"""
    lot = lot_dir(root, "DL2", name)
    ref = datetime.strptime(name, "%Y_%m_%d_%H_%M_%S")
    wc = lot / "wavedata" / "cond"
    wc.mkdir(parents=True, exist_ok=True)
    (lot / "option").mkdir(exist_ok=True)
    kinds = [("未分類", "・", "128,128,128"), ("表濃", "●", "200,0,0"), ("表淡", "○", "200,90,90"), ("裏濃", "◆", "0,0,200"),
             ("裏淡", "◇", "90,90,200"), ("表周期", "★", "200,120,0"), ("裏周期", "☆", "0,120,200")]
    (wc / "COND02.xml").write_bytes(cond_xml(kinds, "D-7781", ["D-7781"] + COMMENTS[1:]))
    (lot / "option" / "Common.xml").write_bytes(common_xml([("表面", "200,60,40"), ("裏面", "30,90,168")]))
    (lot / "option" / "InspectDataInfo.xml").write_bytes(defs_xml().encode("cp932"))
    rnd = random.Random(name)
    recs = detects_for(ref, 30, rnd)
    write_dat(lot / "DETECT_INFO.dat", "DETECT_INFO", recs)
    insp = {"start_time": ticks(ref + timedelta(minutes=25)), "end_time": ticks(ref + timedelta(minutes=40)),
            "insp_end_y": 1800000.0, "detect_total_cnt": len(recs), "image_total_cnt": 0, "insp_area_st": 0.0, "insp_area_ed": 1250.0,
            "classification_count": [0] * 8, "error_count": 0, "detect_max_status": 1, "insp_state": 2, "ok": False,
            "product": "DL", "note": ""}
    write_dat(lot / "INSP_INFO.DAT", "INSP_INFO", [insp], rec_size=fixed_size(fields_of("INSP_INFO")) + 8)
    return lot


def golden_tree(root: Path) -> list[Path]:
    lots = [make_ls3(root, "2026_10_25_22_03_53", n_cab=3, per_cab=8, w=96, h=72),
            make_ls3(root, "2026_10_25_08_15_00", n_cab=0, per_cab=0, w=0, h=0, fm=False),
            make_dl2(root, "2026_10_23_21_27_46")]
    (root / "LS3" / "2026" / "2026_10" / "2026_10_25" / "work").mkdir(parents=True, exist_ok=True)
    return lots


def bench_lot(root: Path, n_cab: int, w: int, h: int) -> Path:
    return make_ls3(root, "2026_10_26_10_00_00", n_cab=n_cab, per_cab=100, w=w, h=h, fm=False)


if __name__ == "__main__":
    out = Path(sys.argv[1])
    if "--bench" in sys.argv:
        i = sys.argv.index("--bench")
        n, w, h = (int(x) for x in sys.argv[i + 1:i + 4])
        print(bench_lot(out, n, w, h))
    else:
        for p in golden_tree(out):
            print(p)
