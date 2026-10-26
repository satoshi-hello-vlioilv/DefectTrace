# -*- coding: utf-8 -*-
"""配る ZIP を組み立てる（窓の exe と、アプリ program）。配り方は program/docs/DISTRIBUTION.md。

    python bundle.py brand <項目>                    名前の定義（program/app/brand.json）の値を出す（CI が名前を書き写さない）
    python bundle.py build --exe <exe> --out <出力先> 配る ZIP と release.json・.sha256 を作る
    python bundle.py version                         アプリの版（program/app/version.py）を出す（Releases の札 v<版> に使う）
    python bundle.py notes --release <release.json>  Releases の説明（その版の更新履歴・配り方・指紋）を出す

配る形（ZIP の中。先頭のフォルダはアプリ名）:
    <name>/<exe>          窓（Rust。検査データ・画像・解析も exe の中）。上へたどって program/app/static/index.html を探す
    <name>/program/       画面と設定の既定（git ls-files の program/app・program/config。試験・道具・説明は入れない）
    <name>/README.md

Python は要らない（使う PC には何も入れなくてよい）。Python はこの道具と、作るときのアイコン描き（build.rs）だけが使う。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PROGRAM = REPO / "program"
MAX_BYTES = 1 << 30          # 取り込む側（desktop/src/update.rs）が断る大きさ


def brand() -> dict:
    return {k: v for k, v in json.loads((PROGRAM / "app" / "brand.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}


def _version_py(program: Path = PROGRAM) -> dict:
    ns: dict = {}
    exec(compile((program / "app" / "version.py").read_text(encoding="utf-8"), "version.py", "exec"), ns)
    return ns


def app_version(program: Path = PROGRAM) -> str:
    return _version_py(program)["APP_VERSION"]


def changelog(program: Path = PROGRAM) -> list[dict]:
    """更新履歴（新しい版が先）。"""
    return _version_py(program)["CHANGELOG"]


def release_notes(rel: dict, history: list[dict]) -> str:
    """GitHub Releases の説明（Markdown）。その版の更新履歴・配り方（README の「更新のしかた」と同じ言葉）・指紋。
    rel は release.json（build が作る物）。更新履歴にその版が無ければ止める（版を上げずに書き忘れた）。"""
    entry = next((e for e in history if e["version"] == rel["version"]), None)
    if entry is None:
        raise SystemExit(f"更新履歴（program/app/version.py の CHANGELOG）に版 {rel['version']} がありません")
    lines = [f"## 版 {rel['version']}（{entry['date']}）", "", "### 変わったこと", *[f"- {n}" for n in entry["notes"]], "",
             "### 配り方", "",
             f"1. 下の `{rel['zip']}` を取ります（`release.json`・`.sha256` も同じ版の物です）。",
             "2. アプリの「配布」→「ZIP から版を置く…」で選ぶと、中身を確かめてから更新の置き場に版のフォルダを作ります。"
             "置いただけでは配りません。",
             "3. 試してから、一覧の「この版を配る」を押します。各 PC は起動したとき・30 分ごとに確かめ、開き直したときにこの版になります。", "",
             f"指紋（SHA-256）: `{rel['sha256']}`", ""]
    return "\n".join(lines)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


SHIP = ("program/app/", "program/config/")    # 配る物（画面・名前・版・設定の既定）


def program_files() -> list[str]:
    """配るアプリのファイル（git が知っている物だけ。.py は版の管理と作るときの道具なので入れない。version.py は窓が版を読む）。"""
    out = subprocess.run(["git", "ls-files", "-z", "program"], cwd=REPO, check=True, capture_output=True).stdout
    files = (p for p in out.decode("utf-8").split("\0") if p)
    return sorted(p for p in files if p.startswith(SHIP) and (not p.endswith(".py") or p == "program/app/version.py"))


def safe_name(name: str) -> bool:
    """release.json の zip・exe は 1 つの名前（区切り・..・ドライブ名を含まない）。"""
    return bool(name) and name not in (".", "..") and not any(c in name for c in "/\\:") and name == name.strip()


def legacy_exe(b: dict) -> list[str]:
    """配る形に、いまの exe と同じ中身で置く前の名前の exe（brand.json の legacy_exe。名前の歴史）。"""
    out = [x for x in b.get("legacy_exe", []) if x != b["exe"]]
    if not all(safe_name(x) and x.lower().endswith(".exe") for x in out):
        raise SystemExit(f"brand.json の legacy_exe に使えない名前があります: {out}")
    return out


def release_json(b: dict, version: str, zip_name: str, sha: str) -> dict:
    """版のフォルダの目印（desktop/src/release.rs が読む形・schema 1）。"""
    if not (safe_name(zip_name) and safe_name(b["exe"])):
        raise SystemExit(f"名前に使えない文字があります: {zip_name} / {b['exe']}")
    return {"schema": 1, "app_id": b["app_id"], "name": b["name"], "version": version, "zip": zip_name, "sha256": sha, "exe": b["exe"]}


def zip_dir(root: Path, top: str, out: Path) -> int:
    """root の中身を top/… として ZIP にする（並びは名前順）。→ ファイルの数"""
    files = sorted(p for p in root.rglob("*") if p.is_file())
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files:
            z.write(p, f"{top}/{p.relative_to(root).as_posix()}")
    return len(files)


def build(exe: Path, out: Path) -> dict:
    b, version = brand(), app_version()
    stage = out / "stage" / b["name"]
    shutil.rmtree(out / "stage", ignore_errors=True)
    stage.mkdir(parents=True)
    shutil.copy2(exe, stage / b["exe"])
    for old in legacy_exe(b):     # 名前の歴史: 前の版の窓は入れ替えたあと前の名前の exe で開き直す（無いと開き直せずショートカットも切れる）
        shutil.copy2(exe, stage / old)
    for rel in program_files():
        dst = stage / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / rel, dst)
    shutil.copy2(REPO / "README.md", stage / "README.md")
    zip_name = f"{b['name']}-{version}-windows.zip"
    zpath = out / zip_name
    n = zip_dir(stage, b["name"], zpath)
    if zpath.stat().st_size > MAX_BYTES:
        raise SystemExit("配る ZIP が 1 GB を超えました（取り込む側が断ります）")
    sha = sha256_file(zpath)
    rel = release_json(b, version, zip_name, sha)
    (out / "release.json").write_text(json.dumps(rel, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (out / f"{zip_name}.sha256").write_text(f"{sha}  {zip_name}\n", encoding="ascii")
    summary = {**rel, "path": str(zpath), "files": n, "bytes": zpath.stat().st_size, "stage": str(stage)}
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return summary


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("brand")
    s.add_argument("key")
    s = sub.add_parser("build")
    s.add_argument("--exe", required=True, type=Path)
    s.add_argument("--out", required=True, type=Path)
    sub.add_parser("version")
    s = sub.add_parser("notes")
    s.add_argument("--release", required=True, type=Path)
    a = ap.parse_args(argv)
    if a.cmd == "brand":
        print(brand()[a.key])
    elif a.cmd == "version":
        print(app_version())
    elif a.cmd == "notes":
        print(release_notes(json.loads(a.release.read_text(encoding="utf-8")), changelog()), end="")
    else:
        build(a.exe, a.out)


if __name__ == "__main__":
    main()
