# -*- coding: utf-8 -*-
"""配る物の中身の要約で版を管理する（版を上げずにプログラムを変えて配ることを止める）。

    python app_build.py            いまの要約を出す
    python app_build.py --release  版を上げて更新履歴を足したあと、app/version.py の RELEASE を書く
    python app_build.py --amend    まだ配っていない版を直しただけのとき（版はそのままで要約だけ書き直す）

配る物: app/（画面・名前・版・アイコン）と config/*.json。説明（.md）とテストは含めない。app/version.py 自身も含めない（RELEASE を書くと要約が変わるため）。
窓（desktop/）は版を Cargo.toml・tauri.conf.json に持ち、tests/test_version.py が APP_VERSION と同じかを見る。
"""
import hashlib
import os
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
RELEASE_GLOBS = ("app/**/*", "config/*.json")
RELEASE_SKIP = {"app/version.py"}


def release_files(base=BASE):
    base = Path(base).resolve()
    out = {}
    for pattern in RELEASE_GLOBS:
        for p in base.glob(pattern):
            if not p.is_file() or "__pycache__" in p.parts or p.suffix in (".pyc", ".md"):
                continue
            rel = os.path.relpath(p, base).replace(os.sep, "/")
            if rel not in RELEASE_SKIP:
                out[rel] = p
    return dict(sorted(out.items()))


def release_digest(base=BASE):
    """配る物の中身の要約（16 桁）。改行は LF にそろえる（Windows で取り出して CRLF になっても同じ要約）。"""
    h = hashlib.sha256()
    for rel, p in release_files(base).items():
        h.update(rel.encode("utf-8") + b"\0" + p.read_bytes().replace(b"\r\n", b"\n") + b"\0")
    return h.hexdigest()[:16]


def _version_module(base):
    """app/version.py を原文から読む（__pycache__ の控えは、同じ秒・同じ大きさの書き直しに気づかないことがある）。"""
    path = Path(base) / "app" / "version.py"
    ns = {}
    exec(compile(path.read_text(encoding="utf-8"), str(path), "exec"), ns)
    return ns


def _write_release(base, version, digest):
    path = Path(base) / "app" / "version.py"
    text = path.read_text(encoding="utf-8")
    new, n = re.subn(r'^RELEASE = .*$', f'RELEASE = {{"version": "{version}", "digest": "{digest}"}}', text, flags=re.M)
    if n != 1:
        raise SystemExit("app/version.py に RELEASE の行が見つかりません。")
    path.write_text(new, encoding="utf-8")


def record_release(base=BASE, amend=False):
    """RELEASE を書く。版を上げずに中身だけ変えた記録は作らない（上げ忘れを止めるための仕組みなので）。"""
    v = _version_module(base)
    digest = release_digest(base)
    cur, rel, key = v["APP_VERSION"], v["RELEASE"], v["version_key"]
    if v["CHANGELOG"][0]["version"] != cur:
        raise SystemExit(f"更新履歴（CHANGELOG）の先頭が版 {cur} ではありません。先頭に {cur} の1件を足してください。")
    if rel["version"] == cur and rel["digest"] == digest:
        return f"記録済みです（{cur}・{digest}）。"
    if rel["version"] == cur and rel["digest"] and not amend:
        raise SystemExit(f"版 {cur} は記録済みで、そのあとプログラムが変わっています。"
                         f"版を上げて（app/version.py の APP_VERSION と CHANGELOG の先頭）からもう一度。"
                         f"まだ配っていない {cur} を直しただけなら --amend。")
    if key(cur) < key(rel["version"]):
        raise SystemExit(f"版 {cur} が、記録済みの {rel['version']} より古くなっています。")
    _write_release(base, cur, digest)
    return f"記録しました: {cur}・{digest}"


if __name__ == "__main__":
    if "--release" in sys.argv or "--amend" in sys.argv:
        print(record_release(BASE, amend="--amend" in sys.argv))
    else:
        print(f"配る物の要約 {release_digest()}（{len(release_files())} ファイル）")
