# -*- coding: utf-8 -*-
"""
DefectTrace (inspection image viewer, Flask) v3.8
- Tree: equipment > year > month > day > lot (1 lot = 1 row : lot no + time)
- Image sources (auto detected per image folder):
    CAB files (img/0000.cab ...)   -> extracted in background to local cache (share is read-only)
    sub folders (img/0000/*.bmp)   -> read directly from the share (DL2 etc.)
    loose images (img/*.bmp)       -> read directly from the share
- .dat files read with header (hdr len / version / record size / name) + 1 byte flag per record
- Image card: DETECT_INFO linked by IMAGE_LINK / FM_IMAGE_LINK
    detect No / class name + map mark (COND*.xml classification_conditions[kindID])
    face (Common.xml group_conditions[group]) / pinned values (OS~(mm), length(m), area)
- Transfer candidates: front/back defect pairs with width position difference within tolerance
- Pitch detection: same face, same width position, >= N intervals of equal length pitch
- Display places are set by pins (D&D or [+]) :
  list / summary / lot / image / card / mapx / mapy
"""
import bisect
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_file

import dat as DAT
from xmlutil import xml_pairs, def_labels, label_for

try:
    from PIL import Image
    HAS_PIL = True
except Exception:
    HAS_PIL = False

BASE = Path(__file__).resolve().parent
CFG_PATH = BASE / "config.json"
PINS_PATH = BASE / "pins.json"

DEFAULT_CFG = {
    "equipments": [
        {"name": "LS3", "path": r"\\NlmFaNgyShr6d\LS3"},
        {"name": "LS4", "path": r"\\NlmFaNgyShr6d\LS4"},
        {"name": "DL2", "path": r"\\NlmFaNgyShr6d\DL2"},
        {"name": "NS1", "path": r"\\NlmFaNgyShr6d\NS1"},
        {"name": "TLV", "path": r"\\NlmFaNgyShr6d\TLV"},
    ],
    "lot_regex": r"^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}$",
    "link_map": {"img": "IMAGE_LINK", "fm_img": "FM_IMAGE_LINK"},
    "xml_defs": {"cond/COND*.xml": "InspCondDef.xml", "cond/Common.xml": "InspCondDef.xml",
                 "cond/SystemCond.xml": "SystemCondDef.xml"},
    "kind_names": {},
    "defs_dir": "",
    "image_xml_patterns": [],
    "cache_dir": "",
    "cache_keep_lots": 30,
    "workers": 4,
    "thumb_size": 256,
    "work_info_csv": "",
    "port": 5050,
    "utc_offset_hours": 9,               # for DateTime values stored as UTC (Kind=Utc/Local)
    "overload_names": ["多量"],          # class names that mean "overload / not inspected correctly" (fallback)
    "overload_types": [2],               # DETECT_INFO.type of overload records (verified LS3: type=2, kindID=1100)
    "overload_kind_ids": [1100],         # DETECT_INFO.kindID of overload records
    "time_warn_minutes": 10,             # lot folder time vs data time : difference to warn
}

C = "condition/target_conditions/target/roll_info/comments/comment[{}]@value"
D = "dat:DETECT_INFO"
I = "dat:INSP_INFO"


def _p(pid, scope, place, label, file, key, scale=None, fmt=None):
    p = {"id": pid, "scope": scope, "place": place, "label": label, "file": file, "key": key}
    if scale:
        p["scale"] = scale
    if fmt:
        p["fmt"] = fmt
    return p


# pseudo source "@lot" : values from the lot folder name (yyyy_mm_dd_hh_mm_ss)
LOT_META = [("time", "作業時刻"), ("date", "作業日")]
TIME_FMTS = {"hhmm": "hh:mm", "hhmmss": "hh:mm:ss"}
DATE_FMTS = {"mmdd": "mm/dd", "yyyymmdd": "yyyy/mm/dd"}


DEFAULT_PINS = [
    _p("d_list_lot", "lot", "list", "ロットNo", "cond/COND*.xml", C.format(0)),
    _p("d_list_time", "lot", "list", "時刻", "@lot", "time", fmt="hhmm"),
    _p("d_s_lot", "lot", "summary", "ロットNo", "cond/COND*.xml", C.format(0)),
    _p("d_s_mat", "lot", "summary", "材質", "cond/COND*.xml", C.format(4)),
    _p("d_s_tmp", "lot", "summary", "調質", "cond/COND*.xml", C.format(5)),
    _p("d_s_t", "lot", "summary", "板厚", "cond/COND*.xml", C.format(6)),
    _p("d_s_w", "lot", "summary", "板幅", "cond/COND*.xml", C.format(7)),
    _p("d_s_use", "lot", "summary", "用途名", "cond/COND*.xml", C.format(11)),
    _p("d_s_len", "lot", "summary", "検査長(m)", I, "insp_end_y", 0.001),
    _p("d_s_dc", "lot", "summary", "欠陥数", I, "detect_total_cnt"),
    _p("d_s_wid", "lot", "summary", "検査幅(mm)", I, "@insp_width"),
    _p("d_l_ord", "lot", "lot", "検査順", "cond/COND*.xml", C.format(1)),
    _p("d_l_cno", "lot", "lot", "条件No", "cond/COND*.xml", C.format(2)),
    _p("d_l_use", "lot", "lot", "用途", "cond/COND*.xml", C.format(3)),
    _p("d_l_ino", "lot", "lot", "検査番号", "cond/COND*.xml", C.format(8)),
    _p("d_l_out", "lot", "lot", "出巻", "cond/COND*.xml", C.format(9)),
    _p("d_l_crs", "lot", "lot", "コース", "cond/COND*.xml", C.format(10)),
    _p("d_l_cnd", "lot", "lot", "検査条件", "cond/COND*.xml", "condition/header/cond_name@value"),
    _p("d_l_st", "lot", "lot", "検査開始日時", I, "start_time"),
    _p("d_l_ed", "lot", "lot", "検査終了日時", I, "end_time"),
    _p("d_l_ic", "lot", "lot", "画像数", I, "image_total_cnt"),
    _p("d_c_x", "image", "card", "幅方向OS～(mm)", D, "@os_x"),
    _p("d_c_y", "image", "card", "長さ方向(m)", D, "y_mm", 0.001),
    _p("d_c_a", "image", "card", "面積(mm²)", D, "area_mm"),
    _p("d_i_w", "image", "image", "幅(mm)", D, "width_mm"),
    _p("d_i_l", "image", "image", "長さ(mm)", D, "length_mm"),
    _p("d_i_p1", "image", "image", "ピークレベル明", D, "peek_level1"),
    _p("d_i_p2", "image", "image", "ピークレベル暗", D, "peek_level2"),
    _p("d_i_a2", "image", "image", "平均レベル暗", D, "ave_level2"),
    _p("d_i_cam", "image", "image", "カメラ", D, "camera"),
    _p("d_i_sp", "image", "image", "ライン速度", D, "line_speed"),
    _p("d_i_dt", "image", "image", "発生日時", D, "datetime"),
    _p("d_mx", "image", "mapx", "幅方向OS～(mm)", D, "@os_x"),
    _p("d_my", "image", "mapy", "長さ方向(m)", D, "y_mm", 0.001),
]
PLACES = {"list": "lot", "summary": "lot", "lot": "lot", "image": "any", "card": "image",
          "mapx": "image", "mapy": "image"}
SINGLE = {"mapx", "mapy"}
KIND_KEYS = {"kindID", "kindID2", "original_kindID"}
IMG_EXT = {".bmp", ".jpg", ".jpeg", ".png", ".tif", ".tiff"}


def _sub(a, b):
    try:
        return float(a) - float(b)
    except Exception:
        return None


# virtual fields computed from DETECT_INFO
VIRTUAL = {"@os_x": ("幅方向OS～(mm)", lambda r: _sub(r.get("x_mm"), r.get("base_x"))),
           "@insp_width": ("検査幅(mm)", lambda r: _sub(r.get("insp_area_ed"), r.get("insp_area_st")))}
# default pin ids that existed in v3.3 (used to add only new default pins to an existing pins.json)
V33_DEFAULT_IDS = {"d_list_lot", "d_s_lot", "d_s_mat", "d_s_tmp", "d_s_t", "d_s_w", "d_s_use", "d_s_len", "d_s_dc",
                   "d_l_ord", "d_l_cno", "d_l_use", "d_l_ino", "d_l_out", "d_l_crs", "d_l_cnd", "d_l_st", "d_l_ed",
                   "d_l_ic", "d_c_x", "d_c_y", "d_c_a", "d_i_w", "d_i_l", "d_i_p1", "d_i_p2", "d_i_a2", "d_i_cam",
                   "d_i_dt", "d_mx", "d_my"}


def load_cfg():
    cfg = dict(DEFAULT_CFG)
    if CFG_PATH.exists():
        try:
            cfg.update(json.loads(CFG_PATH.read_text(encoding="utf-8-sig")))
        except Exception as e:
            print("[WARN] config.json:", e)
    if not cfg["cache_dir"]:
        cfg["cache_dir"] = str(Path(os.environ.get("USERPROFILE", str(Path.home()))) / "ls3viewer_cache")
    return cfg


CFG = load_cfg()
DAT.UTC_OFFSET = __import__("datetime").timedelta(hours=float(CFG.get("utc_offset_hours", 9)))
LOT_RE = re.compile(CFG["lot_regex"])
CACHE = Path(CFG["cache_dir"])
CACHE.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.json.ensure_ascii = False
pool = ThreadPoolExecutor(max_workers=int(CFG["workers"]))
iopool = ThreadPoolExecutor(max_workers=8)
jobs, jobs_lock = {}, threading.Lock()
cab_locks, cab_locks_lock = {}, threading.Lock()

# ================================================================== pins
pins_lock = threading.Lock()


PINS_META = BASE / "pins_meta.json"


def load_pins():
    """existing pins.json is kept; default pins added in a newer version are appended once"""
    if not PINS_PATH.exists():
        pins = [dict(p) for p in DEFAULT_PINS]
    else:
        try:
            pins = json.loads(PINS_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            print("[WARN] pins.json:", e)
            return [dict(p) for p in DEFAULT_PINS]
        try:
            seen = set(json.loads(PINS_META.read_text(encoding="utf-8")).get("seen_defaults", []))
        except Exception:
            seen = set(V33_DEFAULT_IDS)
        have = {p["id"] for p in pins}
        for i, p in enumerate(DEFAULT_PINS):
            if p["id"] in seen or p["id"] in have:
                continue
            # insert after the previous default pin of the same place
            pos = len(pins)
            for q in reversed(DEFAULT_PINS[:i]):
                j = next((k for k, x in enumerate(pins) if x["id"] == q["id"]), None)
                if j is not None and q["place"] == p["place"]:
                    pos = j + 1
                    break
            pins.insert(pos, dict(p))
        # restore unit scale of default pins if lost
        dmap = {p["id"]: p for p in DEFAULT_PINS}
        for p in pins:
            d = dmap.get(p["id"])
            if d and d.get("scale") and "scale" not in p and p.get("key") == d["key"]:
                p["scale"] = d["scale"]
    try:
        PINS_META.write_text(json.dumps({"seen_defaults": [p["id"] for p in DEFAULT_PINS]}), encoding="utf-8")
        PINS_PATH.write_text(json.dumps(pins, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception as e:
        print("[WARN] pins save:", e)
    return pins


PINS = load_pins()


def save_pins():
    PINS_PATH.write_text(json.dumps(PINS, ensure_ascii=False, indent=1), encoding="utf-8")
    lotsum_cache.clear()


def key_regex(key):
    return re.compile("^" + re.escape(key).replace(r"\[\*\]", r"(?:\[\d+\])?") + "$")


def match_values(pairs, key):
    rx = key_regex(key)
    return [v.strip() for k, v in pairs if rx.match(k)]


# ================================================================== helpers
def natkey(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def safe_part(x):
    if x in ("", ".", "..") or "/" in x or "\\" in x:
        abort(400)
    return x


def lot_cache_dir(lot: Path) -> Path:
    parts = lot.parts
    eq = parts[-5] if len(parts) >= 5 else "x"
    return CACHE / (re.sub(r"[^\w]", "_", eq) + "_" + lot.name)


def cab_lock(key):
    with cab_locks_lock:
        return cab_locks.setdefault(key, threading.Lock())


def generalize(rel):
    rel = rel.replace("\\", "/")
    d, _, f = rel.rpartition("/")
    f = re.sub(r"\*+", "*", re.sub(r"\d+", "*", f))
    return (d + "/" if d else "") + f


def fmt_val(v):
    if isinstance(v, float):
        return f"{v:.3f}".rstrip("0").rstrip(".") if abs(v) < 1e7 else f"{v:.6g}"
    if isinstance(v, list):
        return " ".join(fmt_val(x) for x in v[:16]) + (" …" if len(v) > 16 else "")
    return "" if v is None else str(v).strip()


def fmt_num(v, scale=None):
    if isinstance(v, bool) or v is None:
        return fmt_val(v)
    if isinstance(v, (int, float)):
        x = v * scale if scale else v
        return f"{x:.2f}" if (isinstance(x, float) or scale) else str(x)
    return fmt_val(v)


def rgb(s, default="#888"):
    m = re.match(r"^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$", s or "")
    return f"rgb({m.group(1)},{m.group(2)},{m.group(3)})" if m else default


# ================================================================== lot resources
class LotRes:
    def __init__(self, lot: Path):
        self.lot = lot
        self.files, self.rel = {}, []
        for dp, dns, fns in os.walk(lot):
            dns[:] = [d for d in dns if d.lower() not in ("img", "fm_img", "wavedata")]
            for fn in fns:
                p = Path(dp) / fn
                self.files.setdefault(fn.lower(), p)
                self.rel.append(p)
        self.lock = threading.Lock()
        self._defs, self._dats, self._kinds, self._sides = None, {}, None, None

    def find(self, name):
        p = self.files.get(name.lower())
        if p:
            return p
        if CFG.get("defs_dir"):
            q = Path(CFG["defs_dir"]) / name
            if q.exists():
                return q
        q = BASE / "defs" / name
        return q if q.exists() else None

    def defs(self):
        if self._defs is None:
            p = self.find("InspectDataInfo.xml")
            try:
                self._defs = DAT.load_defs(p) if p else False
            except Exception as e:
                print("[WARN] defs:", e)
                self._defs = False
        return self._defs or None

    def dat(self, name):
        with self.lock:
            if name in self._dats:
                return self._dats[name]
        p = self.find(name + ".dat")
        d = self.defs()
        if not p:
            r = {"name": name, "error": "ファイルなし", "records": [], "fields": []}
        elif not d:
            r = {"name": name, "error": "InspectDataInfo.xml が見つかりません", "records": [], "fields": []}
        else:
            try:
                r = DAT.read_dat(p, d, name, ref=self.ref_time())
            except Exception as e:
                r = {"name": name, "error": str(e), "records": [], "fields": []}
        with self.lock:
            self._dats[name] = r
        return r

    def ref_time(self):
        """lot folder name (yyyy_mm_dd_hh_mm_ss) as datetime"""
        import datetime as _dt
        m = re.match(r"(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})", self.lot.name)
        if not m:
            return None
        try:
            return _dt.datetime(*map(int, m.groups()))
        except ValueError:
            return None

    def xml_labels_for(self, rel):
        rel = rel.replace("\\", "/")
        for pat, defname in CFG["xml_defs"].items():
            if Path(rel).match(pat):
                p = self.find(defname)
                return def_labels(p) if p else {}
        p = self.find(Path(rel).stem + "Def.xml")
        return def_labels(p) if p else {}

    def cond_xml(self):
        for p in sorted((self.lot / "cond").glob("COND*.xml"), key=lambda x: natkey(x.name)):
            return p
        cands = sorted((p for n, p in self.files.items() if re.match(r"cond\d+\.xml$", n)), key=lambda x: natkey(x.name))
        return cands[0] if cands else None

    def sides(self):
        """group index -> {name, color} (Common.xml group_conditions)"""
        if self._sides is not None:
            return self._sides
        out = {}
        for p in (self.lot / "cond" / "Common.xml", self.files.get("common.xml"), self.cond_xml()):
            if not p or not p.exists():
                continue
            for k, v in xml_pairs(p):
                m = re.match(r"condition/group_conditions/group(?:\[(\d+)\])?/(disp_name|disp_color)@value$", k)
                if m and v.strip():
                    out.setdefault(int(m.group(1) or 0), {}).setdefault("name" if m.group(2) == "disp_name" else "color", v)
        self._sides = {i: {"name": d.get("name", f"G{i}"), "color": rgb(d.get("color"), "#1e5aa8")} for i, d in out.items()}
        return self._sides

    def system(self):
        """SystemCond.xml : cameras (global index -> group, no in group, range mm) and scan direction"""
        if getattr(self, "_system", None) is not None:
            return self._system
        out = {"cams": {}, "scan": {}}
        p = self.lot / "cond" / "SystemCond.xml"
        if not p.exists():
            p = self.files.get("systemcond.xml")
        if p and p.exists():
            grp = {}
            for k, v in xml_pairs(p):
                m = re.match(r"condition/group_conditions/group(?:\[(\d+)\])?/(camera_amount|scan_direction)@value$", k)
                if m:
                    grp.setdefault(int(m.group(1) or 0), {})[m.group(2)] = v
                    continue
                m = re.match(r"condition/group_conditions/group(?:\[(\d+)\])?/camera_conditions/camera_info(?:\[(\d+)\])?/"
                             r"(?:visual_field/(start_mm|end_mm)|configuration_info/(lsc_no))@value$", k)
                if m:
                    g, c = int(m.group(1) or 0), int(m.group(2) or 0)
                    grp.setdefault(g, {}).setdefault("cams", {}).setdefault(c, {})[m.group(3) or m.group(4)] = v
            base = 0
            for g in sorted(grp):
                d = grp[g]
                out["scan"][g] = d.get("scan_direction")
                n = int(d.get("camera_amount") or len(d.get("cams", {})) or 0)
                for c in range(n):
                    ci = d.get("cams", {}).get(c, {})
                    out["cams"][base + c] = {"group": g, "no": c + 1, "lsc": ci.get("lsc_no"),
                                             "st": to_num(ci.get("start_mm")), "ed": to_num(ci.get("end_mm"))}
                base += n
        self._system = out
        return out

    def cam_label(self, v):
        try:
            c = self.system()["cams"].get(int(v))
        except Exception:
            c = None
        if not c:
            return fmt_val(v)
        s = side_info(self.sides(), c["group"])["name"]
        rng = f" ({c['st']:.0f}～{c['ed']:.0f}mm)" if c["st"] is not None and c["ed"] is not None else ""
        return f"{s} カメラ{c['no']}{rng}"

    def kinds(self):
        """kindID -> {name, mark, color} (COND*.xml classification_conditions, index = kindID)"""
        if self._kinds is not None:
            return self._kinds
        out = {}
        p = self.cond_xml()
        if p:
            for k, v in xml_pairs(p):
                m = re.match(r"condition/classification_conditions/classification_condition(?:\[(\d+)\])?/(name|map_mark|mark_color)@value$", k)
                if m:
                    out.setdefault(int(m.group(1) or 0), {})[m.group(2)] = v
        res = {str(i): {"name": d.get("name", f"分類{i}"), "mark": d.get("map_mark", "●"),
                        "color": rgb(d.get("mark_color"), "#333")} for i, d in out.items()}
        for k, v in (CFG.get("kind_names") or {}).items():
            res.setdefault(str(k), {"mark": "●", "color": "#333"})["name"] = v
        self._kinds = res
        return res


lotres_cache, lotres_lock = {}, threading.Lock()


def lotres(path) -> LotRes:
    key = str(path)
    with lotres_lock:
        r = lotres_cache.get(key)
        if r is None:
            lot = Path(path)
            if not lot.is_dir():
                abort(404, "lot not found")
            r = LotRes(lot)
            if len(lotres_cache) > 300:
                lotres_cache.clear()
            lotres_cache[key] = r
        return r


def rec_get(rec, key):
    if rec is None:
        return None
    if key in VIRTUAL:
        return VIRTUAL[key][1](rec)
    return rec.get(key)


def lot_meta_value(name, key, fmt=None):
    m = re.match(r"(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})", name)
    if not m:
        return ""
    y, mo, d, h, mi, s = m.groups()
    if key == "time":
        return f"{h}:{mi}" if (fmt or "hhmm") == "hhmm" else f"{h}:{mi}:{s}"
    if key == "date":
        return f"{mo}/{d}" if fmt == "mmdd" else f"{y}/{mo}/{d}"
    return ""


def resolve_lot_pin(res: LotRes, p):
    f = p["file"]
    if f == "@lot":
        return lot_meta_value(res.lot.name, p["key"], p.get("fmt"))
    if f.startswith("dat:"):
        d = res.dat(f[4:])
        if d.get("records"):
            v = rec_get(d["records"][0], p["key"])
            return fmt_num(v, p.get("scale")) if p.get("scale") else fmt_val(v)
        return ""
    try:
        for fp in sorted(res.lot.glob(f), key=lambda x: natkey(x.name)):
            vals = match_values(xml_pairs(fp), p["key"])
            if vals:
                return " ".join(v for v in vals if v)
    except Exception:
        pass
    return ""


def kind_info(kinds, v):
    k = kinds.get(str(v))
    if k:
        return k
    try:
        if int(v) in {int(x) for x in CFG.get("overload_kind_ids", [1100])}:
            return {"name": "多量", "mark": "■", "color": "#c62828"}
    except (TypeError, ValueError):
        pass
    return {"name": f"分類{v}" if v is not None else "", "mark": "●", "color": "#333"}


def side_info(sides, v):
    try:
        return sides.get(int(v)) or {"name": f"G{v}", "color": "#1e5aa8"}
    except Exception:
        return {"name": "", "color": "#888"}


def rec_value(p, rec, sides, kinds, card=False, res=None):
    v = rec_get(rec, p["key"])
    if v is None:
        return ""
    if p["key"] == "camera" and res is not None:
        return res.cam_label(v)
    if p["key"] == "group":
        return side_info(sides, v)["name"]
    if p["key"] in KIND_KEYS:
        return kind_info(kinds, v)["name"]
    if card or p.get("scale"):
        return fmt_num(v, p.get("scale"))
    return fmt_val(v)


# ================================================================== CAB / thumbs
SKIP_DIRS = {"cond", "option", "wavedata"}


class Unit:
    """one image block in an image folder : kind = cab / dir / loose"""
    __slots__ = ("stem", "kind", "path")

    def __init__(self, stem, kind, path):
        self.stem, self.kind, self.path = stem, kind, path


def _has_images(p):
    try:
        return any(f.is_file() and os.path.splitext(f.name)[1].lower() in IMG_EXT for f in os.scandir(p))
    except OSError:
        return False


def image_groups(lot: Path):
    """{group(folder name): [Unit,...]}  group = img / fm_img / ... (any folder with images)"""
    groups = {}
    try:
        tops = [c for c in os.scandir(lot) if c.is_dir() and c.name.lower() not in SKIP_DIRS]
    except OSError:
        tops = []
    for c in tops:
        units = []
        try:
            ents = list(os.scandir(c.path))
        except OSError:
            continue
        cabs = sorted((e for e in ents if e.is_file() and e.name.lower().endswith(".cab")), key=lambda e: natkey(e.name))
        units += [Unit(Path(e.name).stem, "cab", Path(e.path)) for e in cabs]
        subs = sorted((e for e in ents if e.is_dir() and _has_images(e.path)), key=lambda e: natkey(e.name))
        units += [Unit(e.name, "dir", Path(e.path)) for e in subs]
        if any(e.is_file() and os.path.splitext(e.name)[1].lower() in IMG_EXT for e in ents):
            units.append(Unit("_", "loose", Path(c.path)))
        if units:
            groups[c.name] = units
    return dict(sorted(groups.items(), key=lambda kv: (kv[0].lower() != "img", kv[0].lower())))


def cab_groups(lot: Path):
    """compat : {group: [Unit]}"""
    return image_groups(lot)


def extract_cab(cab: Path, dest: Path):
    if (dest / ".done").exists():
        return
    with cab_lock(str(dest)):
        if (dest / ".done").exists():
            return
        tmp = dest.with_name(dest.name + ".tmp")
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            r = subprocess.run(["expand", str(cab), "-F:*", str(tmp)], capture_output=True, creationflags=0x08000000)
            if r.returncode != 0:
                raise RuntimeError(r.stdout.decode("cp932", "ignore") + r.stderr.decode("cp932", "ignore"))
        else:
            r = subprocess.run(["cabextract", "-q", "-d", str(tmp), str(cab)], capture_output=True)
            if r.returncode != 0:
                raise RuntimeError(r.stderr.decode(errors="ignore"))
        shutil.rmtree(dest, ignore_errors=True)
        tmp.rename(dest)
        (dest / ".done").write_text("ok")


def make_thumb(src: Path, dst: Path, size: int):
    if dst.exists() or not HAS_PIL:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im.thumbnail((size, size))
        if im.mode not in ("L", "RGB"):
            im = im.convert("RGB")
        im.save(dst, "JPEG", quality=85)


def prune_cache():
    keep = int(CFG["cache_keep_lots"])
    try:
        dirs = sorted([d for d in CACHE.iterdir() if d.is_dir()], key=lambda d: d.stat().st_mtime, reverse=True)
    except OSError:
        return
    active = {lot_cache_dir(Path(k)).name for k in jobs}
    for d in dirs[keep:]:
        if d.name not in active:
            shutil.rmtree(d, ignore_errors=True)


def list_images(d: Path):
    return sorted([f.name for f in d.iterdir() if f.suffix.lower() in IMG_EXT], key=natkey)


class Job:
    def __init__(self, lot: Path):
        self.lot = lot
        self.groups = image_groups(lot)
        self.state, self.images, self.errors = {}, {}, {}
        self.started = time.time()
        self.lock = threading.Lock()
        for g, units in self.groups.items():
            for u in units:
                self.state[f"{g}/{u.stem}"] = "pending"

    def unit(self, g, stem):
        return next((u for u in self.groups.get(g, []) if u.stem == stem), None)

    def dest(self, g, stem):
        """folder that holds the image files"""
        u = self.unit(g, stem)
        if u is not None and u.kind != "cab":
            return u.path
        return lot_cache_dir(self.lot) / g / stem

    def thumb_dir(self, g, stem):
        return lot_cache_dir(self.lot) / g / stem / ".thumb"

    def run_one(self, g, u: Unit):
        key = f"{g}/{u.stem}"
        with self.lock:
            if self.state.get(key) in ("running", "done"):
                return
            self.state[key] = "running"
        try:
            if u.kind == "cab":
                d = self.dest(g, u.stem)
                extract_cab(u.path, d)
            else:
                d = u.path
            names = list_images(d)
            with self.lock:
                self.images[key] = names
                self.state[key] = "done"
            td = self.thumb_dir(g, u.stem)
            for n in names:
                make_thumb(d / n, td / (n + ".jpg"), int(CFG["thumb_size"]))
        except Exception as e:
            with self.lock:
                self.state[key] = "error"
                self.errors[key] = str(e)[:300]

    def start(self):
        for g, units in self.groups.items():
            for u in units:
                pool.submit(self.run_one, g, u)

    def ensure(self, g, stem):
        u = self.unit(g, stem)
        if u is None:
            abort(404)
        k = f"{g}/{stem}"
        while True:
            with self.lock:
                s = self.state.get(k)
            if s != "running":
                break
            time.sleep(0.05)
        if s != "done":
            self.run_one(g, u)

    def status(self):
        with self.lock:
            st, errs = dict(self.state), dict(self.errors)
            imgs = {k: list(v) for k, v in self.images.items()}
        cabs = []
        kinds = {}
        for g, lst in self.groups.items():
            for u in lst:
                k = f"{g}/{u.stem}"
                kinds[u.kind] = kinds.get(u.kind, 0) + 1
                cabs.append({"group": g, "cab": u.stem, "kind": u.kind, "state": st[k], "images": imgs.get(k, []),
                             "error": errs.get(k)})
        total = len(st)
        done = sum(1 for v in st.values() if v in ("done", "error"))
        return {"cabs": cabs, "total": total, "done": done, "finished": done == total, "kinds": kinds,
                "elapsed": round(time.time() - self.started, 1)}


def get_job(lot_path: str, start=False) -> Job:
    lot = Path(lot_path)
    with jobs_lock:
        j = jobs.get(str(lot))
        if j is None:
            if not lot.is_dir():
                abort(404, "lot not found")
            j = Job(lot)
            jobs[str(lot)] = j
            if start:
                j.start()
                threading.Thread(target=prune_cache, daemon=True).start()
        return j


# ================================================================== image <-> detect mapping
imgmap_cache = {}


def image_map(lot_path: str, g: str):
    """{'cab/name': detect_index} : N.bmp -> IMAGE_LINK(image_fileno=N) -> DETECT_INFO[detect_recno]"""
    j = get_job(lot_path, start=True)
    st = j.status()
    cabs = [c for c in st["cabs"] if c["group"] == g]
    nimg = sum(len(c["images"]) for c in cabs)
    ck = (lot_path, g)
    if ck in imgmap_cache and imgmap_cache[ck]["n"] == nimg and imgmap_cache[ck]["final"]:
        return imgmap_cache[ck]
    res = lotres(lot_path)
    det = res.dat("DETECT_INFO")
    linkname = CFG["link_map"].get(g)
    link = res.dat(linkname) if linkname else {"records": []}
    complete = all(c["state"] in ("done", "error") for c in cabs)
    out = {"map": {}, "n": nimg, "final": complete, "info": {}}
    if not det.get("records") or not link.get("records"):
        out["info"] = {"detect": det.get("error") or len(det.get("records", [])),
                       "link": link.get("error") or len(link.get("records", []))}
        imgmap_cache[ck] = out
        return out
    allnames, seen, stems_unique = [], set(), True
    for c in cabs:
        for n in c["images"]:
            allnames.append((c["cab"], n))
            s = Path(n).stem
            if not s.isdigit() or s in seen:
                stems_unique = False
            seen.add(s)
    if not stems_unique and not complete:
        out["final"] = False
        return out
    fileno_of = {(cab, n): int(Path(n).stem) for cab, n in allnames} if stems_unique \
        else {k: i for i, k in enumerate(allnames)}
    by_fno = {}
    for r in link["records"]:
        by_fno.setdefault(r.get("image_fileno", -1), r)
    drecs = det["records"]
    ok0 = sum(1 for r in link["records"][:200]
              if 0 <= r.get("detect_recno", -1) < len(drecs) and drecs[r["detect_recno"]].get("image_id") == r.get("image_id"))
    id2idx = None if ok0 else {d.get("image_id"): i for i, d in enumerate(drecs)}
    for k, fno in fileno_of.items():
        r = by_fno.get(fno)
        if not r:
            continue
        di = id2idx.get(r.get("image_id")) if id2idx is not None else r.get("detect_recno", -1)
        if di is not None and 0 <= di < len(drecs):
            out["map"][f"{k[0]}/{k[1]}"] = di
    out["info"] = {"links": len(link["records"]), "detects": len(drecs), "matched": len(out["map"]),
                   "by": "recno" if ok0 else "image_id"}
    imgmap_cache[ck] = out
    return out


# ================================================================== lot info
lotsum_cache = {}


def lot_dt(name):
    m = re.match(r"(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})", name)
    if not m:
        return "", ""
    y, mo, d, h, mi, s = m.groups()
    return f"{y}/{mo}/{d}", f"{h}:{mi}:{s}"


def lot_summary(path: str):
    if path in lotsum_cache:
        return lotsum_cache[path]
    d, t = lot_dt(Path(path).name)
    try:
        res = lotres(path)
        items = [{"id": p["id"], "label": p["label"], "key": p["key"], "file": p["file"],
                  "value": resolve_lot_pin(res, p)} for p in PINS if p["place"] == "list"]
    except Exception:
        items = []
    try:
        flags = lot_flags(lotres(path))
    except Exception as e:
        flags = {"error": str(e)[:100]}
    r = {"date": d, "time": t, "items": items, "flags": flags}
    lotsum_cache[path] = r
    return r


def work_info(lot_name):
    p = CFG.get("work_info_csv") or ""
    if not p or not Path(p).exists():
        return None
    for enc in ("utf-8-sig", "cp932"):
        try:
            with open(p, encoding=enc, newline="") as f:
                for r in csv.DictReader(f):
                    if (r.get("lot") or "").strip() == lot_name:
                        return r
            return None
        except UnicodeDecodeError:
            continue
    return None


def lot_info(path: str):
    res = lotres(path)
    lot = res.lot
    d, t = lot_dt(lot.name)
    pinned = [{"id": p["id"], "place": p["place"], "label": p["label"], "value": resolve_lot_pin(res, p)}
              for p in PINS if p["scope"] == "lot"]
    xmls, files, total = [], [], 0
    for fp in res.rel:
        try:
            sz = fp.stat().st_size
        except OSError:
            sz = 0
        total += sz
        rel = str(fp.relative_to(lot)).replace("\\", "/")
        files.append({"name": rel, "size": sz})
        low = fp.name.lower()
        if fp.suffix.lower() == ".xml" and sz < 5_000_000 and not low.endswith("def.xml") and low != "inspectdatainfo.xml":
            labels = res.xml_labels_for(rel)
            xmls.append({"name": rel, "glob": generalize(rel),
                         "items": [[k, v, label_for(k, labels)] for k, v in xml_pairs(fp)]})
    files.sort(key=lambda x: natkey(x["name"]))
    xmls.sort(key=lambda x: (not x["name"].lower().startswith("cond/cond"), natkey(x["name"])))
    dats = []
    for f in files:
        if f["name"].lower().endswith(".dat") and "/" not in f["name"]:
            name = f["name"][:-4]
            r = res.dat(name)
            n = len(r.get("records", []))
            item = {"name": name, "count": n, "error": r.get("error"), "fields": []}
            if 1 <= n <= 3:
                rec = r["records"][0]
                item["fields"] = [[f2["name"], fmt_val(rec.get(f2["name"])), f2["label"]] for f2 in r["fields"]
                                  if f2["type"] != "System.Byte[]"]
            dats.append(item)
    meta = [[k, lot_meta_value(lot.name, k, "hhmmss" if k == "time" else "yyyymmdd"), lab] for k, lab in LOT_META]
    return {"lot": lot.name, "path": str(lot), "date": d, "time": t, "pinned": pinned, "xml": xmls, "dat": dats,
            "meta": meta, "classes": class_summary(res), "overload": overload_count(res, detail=True),
            "timecheck": time_check(res),
            "files": files, "cab_groups": {k: units_label(v) for k, v in image_groups(lot).items()}, "total_bytes": total,
            "sides": res.sides(), "kinds": res.kinds(), "work": work_info(lot.name)}


def units_label(units):
    n = {}
    for u in units:
        n[u.kind] = n.get(u.kind, 0) + 1
    lab = {"cab": "CAB", "dir": "フォルダ", "loose": "直下"}
    return " ".join(f"{lab[k]}{v if k != 'loose' else ''}" for k, v in n.items())


def class_summary(res: LotRes):
    """counts per class : INSP_INFO.classification_count (index = kindID) + per face counts from DETECT_INFO"""
    kinds, sides = res.kinds(), res.sides()
    per = {}
    det = res.dat("DETECT_INFO")
    for r in det.get("records", []):
        if r.get("type", 1) != 1:
            continue
        k = str(r.get("kindID"))
        per.setdefault(k, {})
        g = r.get("group")
        per[k][g] = per[k].get(g, 0) + 1
    insp = res.dat("INSP_INFO")
    cc = insp["records"][0].get("classification_count") if insp.get("records") else None
    ids = set(per)
    if isinstance(cc, list):
        ids |= {str(i) for i, v in enumerate(cc) if v and v > 0}
    out = []
    for k in sorted(ids, key=lambda x: int(x) if x.lstrip("-").isdigit() else 999):
        ki = kind_info(kinds, k)
        total = cc[int(k)] if isinstance(cc, list) and k.isdigit() and int(k) < len(cc) and cc[int(k)] >= 0 else None
        out.append({"kind": k, "name": ki["name"], "mark": ki["mark"], "color": ki["color"], "total": total,
                    "sides": {str(g): n for g, n in per.get(k, {}).items()}})
    return {"rows": out, "sides": {str(g): s for g, s in sides.items()}}


# ================================================================== lot checks
def overload_kinds(res: LotRes):
    """kindIDs whose class name is an overload name (fallback for equipments that define 多量 as a class)"""
    names = [n for n in (CFG.get("overload_names") or []) if n]
    return {k: v["name"] for k, v in res.kinds().items() if any(n in v.get("name", "") for n in names)}


def is_overload_rec(r, ok_ids=()):
    if r.get("type") in set(CFG.get("overload_types") or [2]):
        return True
    k = r.get("kindID")
    return k in set(CFG.get("overload_kind_ids") or [1100]) or str(k) in ok_ids


def overload_count(res: LotRes, detail=False):
    """多量 (overload) check.
    1st : INSP_INFO.error_count  (InspectDataInfo.xml : 多量集計数) - small file, used for the lot list
    2nd : DETECT_INFO records type=2 / kindID=1100 (verified : LS3 2026_10_24_19_42_05, 397 = error_count)
    3rd : class name 多量 in COND*.xml (fallback)"""
    ok = overload_kinds(res)
    insp = res.dat("INSP_INFO")
    ir = insp["records"][0] if insp.get("records") else {}
    ec = ir.get("error_count") if isinstance(ir.get("error_count"), int) else None
    out = {"defined": ec is not None or bool(ok), "names": ["多量"], "count": None, "by": None, "sides": {},
           "insp_count": ec, "detect_max_status": ir.get("detect_max_status"), "events": 0, "cams": {},
           "detect_total": ir.get("detect_total_cnt"), "image_total": ir.get("image_total_cnt"),
           "y_first": None, "y_last": None}
    if ec is not None:
        out.update(count=ec, by="INSP_INFO.error_count")
    elif ok:
        cc = ir.get("classification_count")
        if isinstance(cc, list):
            vals = [cc[int(k)] for k in ok if k.isdigit() and int(k) < len(cc) and cc[int(k)] is not None and cc[int(k)] >= 0]
            if vals:
                out.update(count=sum(vals), by="INSP_INFO.classification_count")
    if not detail and out["count"] is not None:
        return out
    det = res.dat("DETECT_INFO")
    if det.get("records") and not det.get("error"):
        n, ys = 0, set()
        for r in det["records"]:
            if not is_overload_rec(r, ok):
                continue
            n += 1
            g = str(r.get("group"))
            out["sides"][g] = out["sides"].get(g, 0) + 1
            c = str(r.get("camera"))
            out["cams"][c] = out["cams"].get(c, 0) + 1
            if r.get("y_mm") is not None:
                ys.add(round(r["y_mm"], 1))
        out["events"] = len(ys)
        if ys:
            out["y_first"], out["y_last"] = round(min(ys) / 1000, 2), round(max(ys) / 1000, 2)
        out["detect_count"] = n
        if out["count"] is None:
            out.update(count=n, by="DETECT_INFO", defined=True)
        out["cams"] = {res.cam_label(k): v for k, v in sorted(out["cams"].items(), key=lambda kv: int(kv[0]) if kv[0].lstrip("-").isdigit() else 0)}
    return out


def lot_flags(res: LotRes):
    """quick check for the lot list (INSP_INFO only)"""
    ov = overload_count(res)
    insp = res.dat("INSP_INFO")
    ir = insp["records"][0] if insp.get("records") else {}
    tc = time_check(res, quick=True)
    return {"overload": ov["count"], "overload_defined": ov["defined"], "overload_names": ov["names"],
            "insp_state": ir.get("insp_state"), "error_count": ir.get("error_count"),
            "detect_max_status": ir.get("detect_max_status"),
            "time_warn": tc["warn"], "time_max_diff": tc["max_diff"]}


def _parse_dt(s):
    import datetime as _dt
    try:
        return _dt.datetime.strptime(s, "%Y/%m/%d %H:%M:%S")
    except Exception:
        return None


def time_check(res: LotRes, quick=False):
    """compare lot folder time with the times in the data"""
    ref = res.ref_time()
    lim = float(CFG.get("time_warn_minutes", 10))
    rows = []

    insp = res.dat("INSP_INFO")
    ir = insp["records"][0] if insp.get("records") else {}
    end = _parse_dt(ir.get("end_time")) if isinstance(ir.get("end_time"), str) else None

    def add(label, s, src, mode=None, expect="near"):
        d = _parse_dt(s) if isinstance(s, str) else None
        diff = round((d - ref).total_seconds() / 60.0, 1) if (d and ref) else None
        bad = diff is not None and (abs(diff) > lim if expect == "near" else diff < -lim)
        if not bad and d and end and expect == "inlot":      # must be between start and end
            bad = (diff is not None and diff < -lim) or (d - end).total_seconds() / 60.0 > lim
        rows.append({"label": label, "value": s or "", "src": src, "diff_min": diff, "warn": bad, "mode": mode})

    # day folder (yyyy_mm_dd) must match the lot folder date
    day = res.lot.parent.name
    if ref and re.match(r"^\d{4}_\d{2}_\d{2}$", day) and day != res.lot.name[:10]:
        rows.append({"label": "日付フォルダ", "value": day.replace("_", "/"), "src": "フォルダ構成",
                     "diff_min": None, "warn": True, "mode": None})
    add("検査開始", ir.get("start_time"), "INSP_INFO.start_time", insp.get("dt_mode"))
    add("検査終了", ir.get("end_time"), "INSP_INFO.end_time", insp.get("dt_mode"), expect="after")
    if not quick:
        det = res.dat("DETECT_INFO")
        ts = sorted(r.get("datetime") for r in det.get("records", []) if r.get("datetime"))
        if ts:
            add("最初の欠陥", ts[0], "DETECT_INFO.datetime", det.get("dt_mode"), expect="inlot")
            add("最後の欠陥", ts[-1], "DETECT_INFO.datetime", det.get("dt_mode"), expect="inlot")
        st = res.dat("STAT_INFO")
        ts = [r.get("time") for r in st.get("records", []) if r.get("time")]
        if ts:
            add("統計 最初", ts[0], "STAT_INFO.time", st.get("dt_mode"), expect="inlot")
            add("統計 最後", ts[-1], "STAT_INFO.time", st.get("dt_mode"), expect="inlot")
        sm = res.dat("SLIT_MASK_STAT")
        if sm.get("records") and sm["records"][0].get("date_time"):
            add("スリット設定", sm["records"][0]["date_time"], "SLIT_MASK_STAT.date_time", sm.get("dt_mode"))
    diffs = [abs(r["diff_min"]) for r in rows if r["diff_min"] is not None and r["label"] == "検査開始"]
    if quick:
        return {"ref": ref.strftime("%Y/%m/%d %H:%M:%S") if ref else "", "rows": rows,
                "warn": any(r["warn"] for r in rows), "max_diff": max(diffs) if diffs else None, "limit": lim}
    return {"ref": ref.strftime("%Y/%m/%d %H:%M:%S") if ref else "", "rows": rows,
            "warn": any(r["warn"] for r in rows), "max_diff": max(diffs) if diffs else None, "limit": lim}


# ================================================================== routes
@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/equipments")
def api_equipments():
    return jsonify([{"name": e["name"], "path": e["path"]} for e in CFG["equipments"]])


@app.get("/api/children")
def api_children():
    p = Path(request.args["path"])
    try:
        ents = [e for e in os.scandir(p) if e.is_dir()]
    except OSError as e:
        return jsonify(error=f"開けません: {p} ({e.strerror or e})"), 400
    out = [{"name": e.name, "path": e.path, "kind": "lot" if LOT_RE.match(e.name) else "dir"} for e in ents]
    out.sort(key=lambda x: natkey(x["name"]), reverse=True)
    return jsonify(out)


@app.post("/api/lotsum")
def api_lotsum():
    paths = request.json.get("paths", [])
    return jsonify(dict(zip(paths, iopool.map(lot_summary, paths))))


@app.post("/api/open")
def api_open():
    get_job(request.json["lot"], start=True)
    return jsonify(ok=True)


@app.get("/api/status")
def api_status():
    return jsonify(get_job(request.args["lot"]).status())


@app.get("/api/info")
def api_info():
    return jsonify(lot_info(request.args["lot"]))


@app.get("/api/dat")
def api_dat():
    r = lotres(request.args["lot"]).dat(safe_part(request.args["name"]))
    n = int(request.args.get("n", 20))
    return jsonify({k: (v[:n] if k == "records" else v) for k, v in r.items()} | {"count": len(r.get("records", []))})


def card_of(rec, sides, kinds, cpins, res=None):
    k = kind_info(kinds, rec.get("kindID"))
    s = side_info(sides, rec.get("group"))
    return {"no": rec.get("detectNo"), "kind": rec.get("kindID"), "kname": k["name"], "kmark": k["mark"],
            "kcolor": k["color"], "side": rec.get("group"), "sname": s["name"], "scolor": s["color"],
            "vals": [rec_value(p, rec, sides, kinds, card=True, res=res) if p["file"] == D else "" for p in cpins]}


@app.get("/api/imgmap")
def api_imgmap():
    lot, g = request.args["lot"], safe_part(request.args["g"])
    m = image_map(lot, g)
    res = lotres(lot)
    det = res.dat("DETECT_INFO")
    sides, kinds = res.sides(), res.kinds()
    cpins = [p for p in PINS if p["place"] == "card"]
    out = {k: card_of(det["records"][di], sides, kinds, cpins, res) | {"d": di} for k, di in m["map"].items()}
    return jsonify(map=out, final=m["final"], info=m["info"], sides=sides, kinds=kinds,
                   card=[{"id": p["id"], "label": p["label"]} for p in cpins])


def image_xml_sources(job, g, stem, name):
    d = job.dest(g, stem)
    istem = Path(name).stem
    out = []
    u = job.unit(g, stem)
    ready = (d / ".done").exists() if (u is None or u.kind == "cab") else d.is_dir()
    if ready:
        for f in d.iterdir():
            if f.suffix.lower() == ".xml" and (f.stem == istem or f.stem.startswith(istem + "_")):
                out.append((f"{stem}.cab/{f.name}", f))
    for pat in CFG.get("image_xml_patterns") or []:
        p = job.lot / pat.format(group=g, cab=stem, idx=istem, name=name)
        if p.exists():
            out.append((pat, p))
    return out


@app.get("/api/imginfo")
def api_imginfo():
    lot, g, stem, name = _args()
    j = get_job(lot, start=True)
    res = lotres(lot)
    sides, kinds = res.sides(), res.kinds()
    m = image_map(lot, g)
    di = m["map"].get(f"{stem}/{name}")
    det = res.dat("DETECT_INFO")
    rec = det["records"][di] if di is not None else None
    fields = []
    if rec:
        for vk, (vl, fn) in VIRTUAL.items():
            fields.append([vk, fmt_num(fn(rec)), vl])
        for f in det["fields"]:
            if f["type"] == "System.Byte[]":
                continue
            v = rec.get(f["name"])
            if f["name"] == "group":
                sv = f"{v} {side_info(sides, v)['name']}"
            elif f["name"] == "camera":
                sv = f"{v} {res.cam_label(v)}"
            elif f["name"] in KIND_KEYS:
                sv = f"{v} {kind_info(kinds, v)['name']}"
            else:
                sv = fmt_val(v)
            fields.append([f["name"], sv, f["label"]])
    xmls = [{"name": label, "items": [[k, v, ""] for k, v in xml_pairs(fp)]}
            for label, fp in image_xml_sources(j, g, stem, name)]
    pairs = [(k, v) for x in xmls for k, v, _ in x["items"]]
    pinned = {"card": [], "image": []}
    for p in PINS:
        if p["place"] not in pinned or p["scope"] != "image":
            continue
        val = rec_value(p, rec, sides, kinds, card=p["place"] == "card", res=res) if p["file"] == D \
            else " ".join(match_values(pairs, p["key"]))
        pinned[p["place"]].append({"id": p["id"], "label": p["label"], "value": val})
    p = j.dest(g, stem) / name
    w = h = bits = 0
    try:
        with open(p, "rb") as fh:
            b = fh.read(30)
        if b[:2] == b"BM":
            w = int.from_bytes(b[18:22], "little", signed=True)
            h = abs(int.from_bytes(b[22:26], "little", signed=True))
            bits = int.from_bytes(b[28:30], "little")
    except Exception:
        pass
    head = card_of(rec, sides, kinds, [], res) if rec else None
    return jsonify(width=w, height=h, bits=bits, detect_index=di, head=head, detect=fields, xml=xmls,
                   card=pinned["card"], pinned=pinned["image"], map_final=m["final"], map_info=m["info"])


def to_num(v, scale=None):
    try:
        x = float(v)
        return x * scale if scale else x
    except Exception:
        return None


@app.get("/api/map")
def api_map():
    lot, g = request.args["lot"], safe_part(request.args["g"])
    res = lotres(lot)
    det = res.dat("DETECT_INFO")
    pins = {p["place"]: p for p in PINS if p["place"] in SINGLE}
    if not det.get("records"):
        return jsonify(ok=False, msg=det.get("error") or "DETECT_INFO なし", points=[])
    if not all(pins.get(k) and pins[k]["file"] == D for k in ("mapx", "mapy")):
        return jsonify(ok=False, msg="MAP X/Y に DETECT_INFO の項目を設定してください", points=[])
    m = image_map(lot, g)
    rev = {v: k for k, v in m["map"].items()}
    px, py = pins["mapx"], pins["mapy"]
    pts = []
    for i, r in enumerate(det["records"]):
        if r.get("type", 1) != 1:
            continue
        x, y = to_num(rec_get(r, px["key"]), px.get("scale")), to_num(rec_get(r, py["key"]), py.get("scale"))
        if x is None or y is None:
            continue
        pts.append([round(x, 3), round(y, 4), r.get("group", 0), r.get("kindID", 0), rev.get(i), r.get("detectNo"), i])
        if len(pts) >= 50000:
            break
    insp = res.dat("INSP_INFO")
    ir = insp["records"][0] if insp.get("records") else {}
    bands = []
    if px["key"] in ("@os_x", "x_mm") and py["key"] == "y_mm":
        for r in det["records"]:
            if not is_overload_rec(r):
                continue
            xc = to_num(rec_get(r, px["key"]))
            if xc is None or r.get("y_mm") is None:
                continue
            w = r.get("width_mm") or 0
            bands.append([round(xc - w / 2, 1), round(xc + w / 2, 1), round(r["y_mm"] * (py.get("scale") or 1), 4),
                          round((r.get("length_mm") or 0) * (py.get("scale") or 1), 4), r.get("group", 0)])
            if len(bands) >= 20000:
                break
    return jsonify(ok=True, points=pts, bands=bands, sides=res.sides(), kinds=res.kinds(), final=m["final"],
                   labels={k: pins[k]["label"] for k in pins},
                   len_m=to_num(ir.get("insp_end_y"), 0.001))


# ================================================================== transfer candidates (front/back pairs)
@app.get("/api/pairs")
def api_pairs():
    """front/back defect pairs whose width position (OS~) differs within tol mm"""
    lot, g = request.args["lot"], safe_part(request.args.get("g", "img"))
    try:
        tol = max(0.0, float(request.args.get("tol", 5)))
    except ValueError:
        tol = 5.0
    maxdy = request.args.get("maxdy", "")
    try:
        maxdy = float(maxdy) if maxdy not in ("", None) else None
    except ValueError:
        maxdy = None
    mirror = request.args.get("mirror") == "1"
    res = lotres(lot)
    det = res.dat("DETECT_INFO")
    if not det.get("records"):
        return jsonify(ok=False, msg=det.get("error") or "DETECT_INFO なし", defects=[], pairs=[])
    m = image_map(lot, g)
    rev = {v: k for k, v in m["map"].items()}
    sides, kinds = res.sides(), res.kinds()
    front = [i for i, s in sides.items() if "表" in s.get("name", "")]
    back = [i for i, s in sides.items() if "裏" in s.get("name", "")]
    fg = front[0] if front else 1
    bg = back[0] if back else 0
    defects, F, B = [], [], []
    for i, r in enumerate(det["records"]):
        if r.get("type", 1) != 1:
            continue
        x = _sub(r.get("x_mm"), r.get("base_x"))
        if x is None:
            continue
        width = _sub(r.get("x_end"), r.get("base_x"))
        k = kind_info(kinds, r.get("kindID"))
        d = {"i": i, "no": r.get("detectNo"), "side": r.get("group"), "x": round(x, 2),
             "y": round((r.get("y_mm") or 0) / 1000.0, 3), "a": round(r.get("area_mm") or 0, 2),
             "kind": r.get("kindID"), "kname": k["name"], "kmark": k["mark"], "kcolor": k["color"],
             "img": rev.get(i), "w": round(width, 2) if width else None}
        defects.append(d)
        if r.get("group") == fg:
            F.append(d)
        elif r.get("group") == bg:
            B.append(d)

    def bx(d):
        return (d["w"] - d["x"]) if (mirror and d["w"]) else d["x"]

    B.sort(key=bx)
    bxs = [bx(d) for d in B]
    pairs = []
    for f in F:
        lo = bisect.bisect_left(bxs, f["x"] - tol)
        hi = bisect.bisect_right(bxs, f["x"] + tol)
        for b in B[lo:hi]:
            dy = b["y"] - f["y"]
            if maxdy is not None and abs(dy) > maxdy:
                continue
            pairs.append([f["i"], b["i"], round(bx(b) - f["x"], 2), round(dy, 3)])
        if len(pairs) >= 50000:
            break
    scan = res.system()["scan"]
    sf, sb = scan.get(fg), scan.get(bg)
    return jsonify(ok=True, defects=defects, pairs=pairs, front=fg, back=bg, tol=tol, mirror=mirror,
                   sides=sides, final=m["final"], nf=len(F), nb=len(B),
                   scan={"front": sf, "back": sb, "known": sf is not None and sb is not None,
                         "same": sf == sb})


# ================================================================== pitch detection (same face)
def find_pitches(items, tol, ytol, min_n, pmin, pmax, skip, cap=3000):
    """items: [{i, side, x(mm), y(m)}]
    chain = same face, width position within +-tol(mm) of the chain mean,
            intervals equal to the pitch within +-ytol(m), >= min_n intervals.
    skip : number of missing occurrences allowed between members (0 = consecutive only)"""
    by = {}
    for d in items:
        by.setdefault(d["side"], []).append(d)
    found = []
    for side, L in by.items():
        L.sort(key=lambda d: d["y"])
        ys = [d["y"] for d in L]
        n = len(L)

        def near(y, x0, excl):
            lo = bisect.bisect_left(ys, y - ytol)
            hi = bisect.bisect_right(ys, y + ytol)
            best = None
            for k in range(lo, hi):
                if k in excl or abs(L[k]["x"] - x0) > tol:
                    continue
                e = abs(ys[k] - y) + abs(L[k]["x"] - x0) * 1e-5
                if best is None or e < best[0]:
                    best = (e, k)
            return best[1] if best else None

        for a in range(n):
            xa, ya = L[a]["x"], ys[a]
            hi = n if pmax is None else bisect.bisect_right(ys, ya + pmax + ytol)
            for b in range(bisect.bisect_left(ys, ya + pmin), hi):
                if abs(L[b]["x"] - xa) > tol:
                    continue
                p = ys[b] - ya
                if near(ya - p, xa, ()) is not None:     # not the first of a chain
                    continue
                mem, gaps, pm = [a, b], [1], p
                xm = (xa + L[b]["x"]) / 2
                while True:
                    nxt = None
                    for mlt in range(1, skip + 2):
                        k = near(ys[mem[-1]] + pm * mlt, xm, mem)
                        if k is not None:
                            nxt = (k, mlt)
                            break
                    if nxt is None:
                        break
                    mem.append(nxt[0])
                    gaps.append(nxt[1])
                    pm = (ys[mem[-1]] - ya) / sum(gaps)
                    xm = sum(L[k]["x"] for k in mem) / len(mem)
                if len(mem) - 1 >= min_n:
                    found.append((side, [L[k] for k in mem], pm, gaps))
                if len(found) >= cap:
                    break
            if len(found) >= cap:
                break
    found.sort(key=lambda c: (-len(c[1]), c[1][0]["y"]))
    kept = []
    for side, mem, pm, gaps in found:
        s = {d["i"] for d in mem}
        if any(k[0] == side and s <= k[1] for k in kept):
            continue
        kept.append((side, s, mem, pm, gaps))
    return kept


@app.get("/api/pitch")
def api_pitch():
    lot, g = request.args["lot"], safe_part(request.args.get("g", "img"))

    def num(name, default, lo=0.0):
        try:
            v = request.args.get(name, "")
            return default if v in ("", None) else max(lo, float(v))
        except ValueError:
            return default
    tol = num("tol", 5.0)
    ytol = num("ytol", 0.03)
    min_n = int(num("n", 3, 1))
    pmin = num("pmin", 0.1)
    pmax = num("pmax", None)
    skip = int(min(3, num("skip", 0)))
    res = lotres(lot)
    det = res.dat("DETECT_INFO")
    if not det.get("records"):
        return jsonify(ok=False, msg=det.get("error") or "DETECT_INFO なし", chains=[])
    m = image_map(lot, g)
    rev = {v: k for k, v in m["map"].items()}
    sides, kinds = res.sides(), res.kinds()
    items = []
    for i, r in enumerate(det["records"]):
        if r.get("type", 1) != 1:
            continue
        x = _sub(r.get("x_mm"), r.get("base_x"))
        if x is None or r.get("y_mm") is None:
            continue
        k = kind_info(kinds, r.get("kindID"))
        items.append({"i": i, "no": r.get("detectNo"), "side": r.get("group"), "x": round(x, 2),
                      "y": round(r["y_mm"] / 1000.0, 4), "a": round(r.get("area_mm") or 0, 2),
                      "kind": r.get("kindID"), "kname": k["name"], "kmark": k["mark"], "kcolor": k["color"],
                      "img": rev.get(i)})
    chains = []
    for side, s, mem, pm, gaps in find_pitches(items, tol, ytol, min_n, pmin, pmax, skip):
        iv = [round(mem[j + 1]["y"] - mem[j]["y"], 4) for j in range(len(mem) - 1)]
        dev = max(abs(iv[j] - pm * gaps[j]) for j in range(len(iv)))
        xs = [d["x"] for d in mem]
        chains.append({"side": side, "pitch": round(pm, 4), "n": len(mem), "intervals": iv, "gaps": gaps,
                       "dev": round(dev, 4), "x": round(sum(xs) / len(xs), 2), "xr": round(max(xs) - min(xs), 2),
                       "y0": mem[0]["y"], "y1": mem[-1]["y"], "dia": round(pm * 1000 / 3.141592653589793, 1),
                       "members": mem})
    return jsonify(ok=True, chains=chains, sides=sides, final=m["final"],
                   cond={"tol": tol, "ytol": ytol, "n": min_n, "pmin": pmin, "pmax": pmax, "skip": skip})


def _args():
    a = request.args
    return a["lot"], safe_part(a["g"]), safe_part(a["cab"]), safe_part(a["name"])


def _image_path(thumb=False):
    lot, g, stem, name = _args()
    j = get_job(lot, start=True)
    j.ensure(g, stem)
    d = j.dest(g, stem)
    src = d / name
    if not src.exists():
        abort(404)
    if thumb and HAS_PIL:
        t = j.thumb_dir(g, stem) / (name + ".jpg")
        if not t.exists():
            make_thumb(src, t, int(CFG["thumb_size"]))
        return t
    return src


@app.get("/img")
def img():
    return send_file(_image_path(), max_age=3600)


@app.get("/thumb")
def thumb():
    return send_file(_image_path(thumb=True), max_age=3600)


# ---------------- pins API
@app.get("/api/pins")
def api_pins():
    return jsonify(PINS)


def _compatible(scope, place):
    need = PLACES.get(place)
    return need == "any" or need == scope


@app.post("/api/pins")
def api_pins_add():
    b = request.json
    if not _compatible(b["scope"], b["place"]):
        return jsonify(error="この表示先には設定できない項目です"), 400
    fmt = None
    if b.get("file") == "@lot":
        fmt = "hhmm" if b["key"] == "time" else "mmdd" if b["key"] == "date" else None
    p = _p("p_" + uuid.uuid4().hex[:8], b["scope"], b["place"], b.get("label", ""), b.get("file", "@image"), b["key"], fmt=fmt)
    with pins_lock:
        if p["place"] in SINGLE:
            PINS[:] = [x for x in PINS if x["place"] != p["place"]]
        idx = len(PINS)
        if b.get("before"):
            idx = next((i for i, x in enumerate(PINS) if x["id"] == b["before"]), idx)
        PINS.insert(idx, p)
        save_pins()
    return jsonify(PINS)


@app.patch("/api/pins/<pid>")
def api_pins_patch(pid):
    b = request.json
    with pins_lock:
        p = next((x for x in PINS if x["id"] == pid), None)
        if not p:
            abort(404)
        if "label" in b:
            p["label"] = b["label"]
        if "fmt" in b and b["fmt"] in {**TIME_FMTS, **DATE_FMTS}:
            p["fmt"] = b["fmt"]
        if "place" in b:
            if not _compatible(p["scope"], b["place"]):
                return jsonify(error="この表示先には設定できない項目です"), 400
            if b["place"] in SINGLE:
                PINS[:] = [x for x in PINS if x["place"] != b["place"] or x["id"] == pid]
            p["place"] = b["place"]
        if "before" in b and b["before"] != pid:
            PINS.remove(p)
            idx = len(PINS)
            if b["before"]:
                idx = next((i for i, x in enumerate(PINS) if x["id"] == b["before"]), idx)
            PINS.insert(idx, p)
        save_pins()
    return jsonify(PINS)


@app.delete("/api/pins/<pid>")
def api_pins_del(pid):
    with pins_lock:
        PINS[:] = [x for x in PINS if x["id"] != pid]
        save_pins()
    return jsonify(PINS)


@app.post("/api/pins/reset")
def api_pins_reset():
    with pins_lock:
        PINS[:] = [dict(p) for p in DEFAULT_PINS]
        save_pins()
    return jsonify(PINS)


if __name__ == "__main__":
    port = int(CFG["port"])
    print(f"[DefectTrace] http://127.0.0.1:{port}/   cache={CACHE}   pillow={HAS_PIL}")
    if "--no-browser" not in sys.argv:
        import webbrowser
        threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{port}/")).start()
    app.run(host="127.0.0.1", port=port, threaded=True, debug=False)
