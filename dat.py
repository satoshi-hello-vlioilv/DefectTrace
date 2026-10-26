# -*- coding: utf-8 -*-
"""
Reader for inspection .dat record files (RecordFileEx) driven by option/InspectDataInfo.xml

File layout (verified with LS3 data 2026-10-25):
  int32  header length (incl. this field)
  int32  dataVersion (= structure id in InspectDataInfo.xml)
  int32  record size
  byte   name length + name (ASCII)
  [records] : 1 byte flag + <record size> bytes, repeated to EOF
A String field without length takes the remaining bytes of the fixed-size record.
"""
import datetime as dt
import struct
import threading
import xml.etree.ElementTree as ET
from pathlib import Path

from xmlutil import parse_root, clean_label

SIZES = {"System.Int32": (4, "i"), "System.UInt32": (4, "I"), "System.Int64": (8, "q"), "System.UInt64": (8, "Q"),
         "System.Int16": (2, "h"), "System.UInt16": (2, "H"), "System.Byte": (1, "B"), "System.SByte": (1, "b"),
         "System.Double": (8, "d"), "System.Single": (4, "f"), "System.DateTime": (8, "q"), "System.Boolean": (1, "?")}

_lock = threading.Lock()
_defs_cache, _dat_cache = {}, {}


class Defs:
    def __init__(self, path):
        root = parse_root(path, comments=True)
        self.structs, self.default_ver = {}, {}
        d = root.find("definitions")
        for s in (d if d is not None else []):
            if s.tag != "structure":
                continue
            items, last = [], None
            for c in s:
                if c.tag is ET.Comment:
                    last = clean_label(c.text or "")
                    continue
                if c.tag == "link":
                    items.append(("link", c.get("id")))
                elif c.tag == "field":
                    items.append(("field", {"name": c.get("name"), "type": c.get("type"),
                                            "length": int(c.get("length") or 0), "cnt": int(c.get("item_cnt") or 1),
                                            "label": last or ""}))
                last = None
            self.structs[s.get("id")] = {"name": s.get("name"), "items": items}
        sd = root.find("system_default")
        for c in (sd if sd is not None else []):
            if isinstance(c.tag, str) and c.get("dataVersion"):
                self.default_ver[c.tag] = c.get("dataVersion")

    def fields(self, sid, seen=None):
        seen = seen or set()
        if sid in seen or sid not in self.structs:
            return []
        seen.add(sid)
        out = []
        for kind, v in self.structs[sid]["items"]:
            out += self.fields(v, seen) if kind == "link" else [dict(v)]
        return out


def load_defs(path):
    st = Path(path).stat()
    ck = (str(path), st.st_mtime)
    with _lock:
        if ck not in _defs_cache:
            _defs_cache[ck] = Defs(path)
        return _defs_cache[ck]


def _fsize(f):
    t = f["type"]
    if t in ("System.String", "System.Byte[]"):
        return f["length"] * f["cnt"] if f["length"] else None
    s = SIZES.get(t)
    return s[0] * f["cnt"] if s else None


def resolve_sizes(fields, rec_size):
    """fill the size of one variable-length field from the record size"""
    sizes = [_fsize(f) for f in fields]
    unknown = [i for i, s in enumerate(sizes) if s is None]
    known = sum(s for s in sizes if s is not None)
    if len(unknown) == 1 and rec_size and rec_size >= known:
        sizes[unknown[0]] = rec_size - known
    elif unknown:
        return None
    return sizes


# ------------------------------------------------------------------ DateTime
# 8 bytes = 2 bit Kind (0:Unspecified 1:Utc 2:Local) + 62 bit ticks (100ns since 0001-01-01)
# Two ways of storing are seen in the field:
#   "binary"   (DateTime.ToBinary)  : Kind=Local/Utc ticks are UTC  -> add UTC offset
#   "internal" (raw struct copy)    : ticks are already local time  -> use as is
# The interpretation is decided per file by comparing with a reference time (lot folder name).
UTC_OFFSET = dt.timedelta(hours=9)          # overwritten by app (config "utc_offset_hours")
EPOCH = dt.datetime(1, 1, 1)


def ticks_kind(v):
    v &= 0xFFFFFFFFFFFFFFFF
    return (v >> 62) & 3, v & 0x3FFFFFFFFFFFFFFF


def ticks_to_dt(v, mode="binary"):
    kind, t = ticks_kind(v)
    if t <= 0:
        return None
    try:
        d = EPOCH + dt.timedelta(microseconds=t // 10)
    except Exception:
        return None
    if kind in (1, 2) and mode == "binary":
        d = d + UTC_OFFSET
    return d


def ticks_to_str(v, mode="binary"):
    d = ticks_to_dt(v, mode)
    return d.strftime("%Y/%m/%d %H:%M:%S") if d else ""


def dec_str(b):
    b = b.split(b"\x00")[0]
    for enc in ("utf-8", "cp932"):
        try:
            return b.decode(enc).strip()
        except UnicodeDecodeError:
            pass
    return b.decode("cp932", "replace").strip()


def parse_rec(data, off, fields, sizes):
    r = {}
    for f, sz in zip(fields, sizes):
        t, cnt = f["type"], f["cnt"]
        if t == "System.String":
            L = sz // cnt
            vals = [dec_str(data[off + i * L: off + (i + 1) * L]) for i in range(cnt)]
        elif t == "System.Byte[]":
            off += sz
            continue
        else:
            fmt = SIZES[t][1]
            vals = list(struct.unpack_from("<" + fmt * cnt, data, off))
            if t == "System.DateTime":
                vals = [("__dt__", v) for v in struct.unpack_from("<" + "Q" * cnt, data, off)]
        off += sz
        r[f["name"]] = vals[0] if cnt == 1 else vals
    return r


def read_header(data):
    hl, ver, rs = struct.unpack_from("<iii", data, 0)
    n = data[12]
    name = data[13:13 + n].decode("ascii", "replace")
    return hl, str(ver), rs, name


def _dt_items(r):
    for k, v in r.items():
        if isinstance(v, tuple) and v and v[0] == "__dt__":
            yield k, v[1]
        elif isinstance(v, list):
            for x in v:
                if isinstance(x, tuple) and x and x[0] == "__dt__":
                    yield k, x[1]


def decide_mode(records, ref):
    """binary / internal : which interpretation of Kind=Local/Utc values is closer to ref (datetime)"""
    if ref is None:
        return "binary", None
    db = di = 0.0
    n = 0
    for r in records[:50]:
        for _k, v in _dt_items(r):
            kind, _t = ticks_kind(v)
            if kind not in (1, 2):
                continue
            a, b = ticks_to_dt(v, "binary"), ticks_to_dt(v, "internal")
            if a is None:
                continue
            db += abs((a - ref).total_seconds())
            di += abs((b - ref).total_seconds())
            n += 1
    if not n:
        return "binary", None
    return ("binary" if db <= di else "internal"), n


def _finish(records, mode):
    for r in records:
        for k, v in list(r.items()):
            if isinstance(v, tuple) and v and v[0] == "__dt__":
                r[k] = ticks_to_str(v[1], mode)
            elif isinstance(v, list) and v and isinstance(v[0], tuple):
                r[k] = [ticks_to_str(x[1], mode) if isinstance(x, tuple) else x for x in v]


def read_dat(path, defs, name, limit=300000, ref=None):
    path = Path(path)
    st = path.stat()
    ck = (str(path), st.st_mtime, st.st_size, ref)
    with _lock:
        if ck in _dat_cache:
            return _dat_cache[ck]
    data = path.read_bytes()
    res = {"name": name, "version": None, "fields": [], "records": [], "layout": None, "error": None}
    try:
        hl, ver, rs, hname = read_header(data)
        res["version"] = ver
        sid = ver if ver in defs.structs else defs.default_ver.get(name)
        fields = defs.fields(sid) if sid else []
        sizes = resolve_sizes(fields, rs) if fields else None
        res["fields"] = [{"name": f["name"], "label": f["label"], "type": f["type"]} for f in fields]
        if not fields:
            res["error"] = f"定義が見つかりません (version={ver})"
        elif sizes is None or sum(sizes) != rs:
            res["error"] = f"レコード長が定義と一致しません (定義={sum(s or 0 for s in (sizes or []))}, ファイル={rs})"
        else:
            step = rs + 1
            n = max(0, (len(data) - hl) // step)
            res["layout"] = {"header": hl, "record_size": rs, "count": n, "name": hname, "rest": (len(data) - hl) % step}
            for i in range(min(n, limit)):
                off = hl + i * step
                r = parse_rec(data, off + 1, fields, sizes)
                r["_flag"] = data[off]
                res["records"].append(r)
            mode, n = decide_mode(res["records"], ref)
            _finish(res["records"], mode)
            res["dt_mode"] = mode if n else None
    except Exception as e:
        res["error"] = f"読込エラー: {e}"
    with _lock:
        if len(_dat_cache) > 200:
            _dat_cache.clear()
        _dat_cache[ck] = res
    return res
