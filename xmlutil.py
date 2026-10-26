# -*- coding: utf-8 -*-
"""XML helpers: tolerant parse (SHIFT_JIS etc.), flatten to (key, value), labels from *Def.xml comments"""
import re
import threading
import xml.etree.ElementTree as ET
from pathlib import Path

_lock = threading.Lock()
_pairs_cache = {}
_label_cache = {}


def parse_root(path, comments=False):
    data = Path(path).read_bytes()
    m = re.search(rb'encoding=["\']([\w\-]+)["\']', data[:200])
    enc = (m.group(1).decode() if m else "utf-8").lower()
    if enc in ("shift_jis", "shift-jis", "sjis", "x-sjis"):
        enc = "cp932"
    try:
        txt = data.decode(enc)
    except Exception:
        txt = data.decode("cp932", "replace")
    txt = re.sub(r"^\ufeff?\s*<\?xml[^>]*\?>", "", txt)
    parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=comments))
    parser.feed(txt)
    return parser.close()


def _tag(el):
    return el.tag.split("}")[-1] if isinstance(el.tag, str) else None


def norm(path):
    return re.sub(r"\[\d+\]", "", path)


def _walk(el, p, out, limit, comments_map=None):
    if comments_map is None:
        for k, v in el.attrib.items():
            out.append((f"{p}@{k}", v))
        txt = (el.text or "").strip()
        if txt and len([c for c in el if _tag(c)]) == 0:
            out.append((p, txt))
    kids = list(el)
    cnt = {}
    for c in kids:
        t = _tag(c)
        if t:
            cnt[t] = cnt.get(t, 0) + 1
    idx, last_comment = {}, None
    for c in kids:
        if len(out) >= limit:
            return
        if c.tag is ET.Comment:
            last_comment = (c.text or "").strip()
            continue
        t = _tag(c)
        if not t:
            continue
        if cnt[t] > 1:
            i = idx.get(t, 0)
            idx[t] = i + 1
            cp = f"{p}/{t}[{i}]"
        else:
            cp = f"{p}/{t}"
        if comments_map is not None and last_comment:
            comments_map.setdefault(cp, last_comment)
            comments_map.setdefault(norm(cp), last_comment)
        last_comment = None
        _walk(c, cp, out, limit, comments_map)


def xml_pairs(path, limit=6000):
    path = Path(path)
    try:
        st = path.stat()
    except OSError:
        return []
    ck = (str(path), st.st_mtime, st.st_size)
    with _lock:
        if ck in _pairs_cache:
            return _pairs_cache[ck]
    out = []
    try:
        root = parse_root(path)
        _walk(root, _tag(root), out, limit)
    except Exception as e:
        out = [("(parse error)", str(e))]
    with _lock:
        if len(_pairs_cache) > 4000:
            _pairs_cache.clear()
        _pairs_cache[ck] = out
    return out


def clean_label(c):
    c = re.sub(r"(?i)comment\s*\d+", "", c)
    c = re.sub(r"(?i)\bfor\b.*$", "", c)
    c = re.sub(r"//.*$", "", c)
    c = re.sub(r"[（(].*?[)）]", "", c)
    c = c.replace("--", " ").strip()
    c = re.split(r"\s{2,}|\n", c)[0].strip()
    return c[:24]


def def_labels(path):
    path = Path(path)
    try:
        st = path.stat()
    except OSError:
        return {}
    ck = (str(path), st.st_mtime)
    with _lock:
        if ck in _label_cache:
            return _label_cache[ck]
    m = {}
    try:
        root = parse_root(path, comments=True)
        raw = {}
        _walk(root, _tag(root), [], 10 ** 9, raw)
        m = {k: clean_label(v) for k, v in raw.items() if clean_label(v)}
    except Exception:
        m = {}
    with _lock:
        _label_cache[ck] = m
    return m


def label_for(key, labels):
    if not labels:
        return ""
    el, _, attr = key.partition("@")
    for k in (el, norm(el)):
        if k in labels:
            return labels[k] + ("" if attr in ("", "value") else "@" + attr)
    return ""
