# -*- coding: utf-8 -*-
"""配る形と更新の通しを、本物の窓で確かめる（評価関数）。Windows の CI と、手元の Linux（xvfb-run の下）で流す。

    python verify.py update --exe <作った exe> [--work <作業フォルダ>] [--keep]

利用者の PC を真似る: 作業場所（DT_LOCAL_ROOT）はまっさら、配る形は共有を真似たフォルダ、更新の置き場も共有を真似たフォルダ。
窓は自己診断（DT_SELFTEST）で起こし、結果のファイル（selftest.js が更新の係の状態と、動いている exe・program を添える）を読む。

  1. 共有の exe を開く → この PC の app へ写り、版ごとの写しの窓で開く。使っている間に置き場の次の版（+1）を取り込む（ready）。置き場を控える
  2. app の exe（ショートカットの行き先）を開く → 起動の最初に +1 へ入れ替わり、その版で開く。直前の版は控えに
  3. 閉じている間に次の版（+2）を置く → ショートカットから 1 回開くだけで +2 になる（起動の最初に取り込んで入れ替える）
  4. 閉じている間に画面が開けない版（+3）を置いて 1 回開く → +3 へ入れ替えるが開けず、控え（+2）へ戻して開き直す。+3 には印が付き、もう取り込まない
  5. 配る版を前の版（+1。distribute.json）に戻す → 1 回開くだけで配る版になり、配る版を作業場所に覚える（want.json）
  6. 新しい PC（まっさらな作業場所）が配る入口を開くだけで、配る版をこの PC へ入れて開き、入口の置き場を控える
  ショートカット: 無ければ画面が尋ねる・共有を指すショートカットは次の起動でこの PC の app（作業フォルダも）に直す
  あわせて: 共有の配る形は 1 ファイルも変わらない・終わったあと窓が残らない。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import bundle

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WAIT = 240


def bump(v: str, n: int) -> str:
    a, b, c = (int(x) for x in v.split("."))
    return f"{a}.{b}.{c + n}"


def tree_digest(root: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(x for x in root.rglob("*") if x.is_file()):
        h.update(p.relative_to(root).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def place(stage: Path, version: str, rel_root: Path, broken: bool = False) -> None:
    """配る形 stage の版を書き換えて ZIP にし、置き場の <アプリ>/<版>/ に release.json と並べて置く。"""
    b = bundle.brand()
    work = Path(tempfile.mkdtemp(prefix="da-variant-"))
    try:
        top = work / b["name"]
        shutil.copytree(stage, top)
        vp = top / "program" / "app" / "version.py"
        text = vp.read_text(encoding="utf-8")
        old = bundle.app_version(top / "program")
        vp.write_text(text.replace(f'APP_VERSION = "{old}"', f'APP_VERSION = "{version}"', 1), encoding="utf-8")
        if broken:   # 画面が開けない版（取り込みの確かめは通る。画面の JS が最初に止まり、開けた合図を送らない）
            (top / "program" / "app" / "static" / "app.js").write_text('throw new Error("試験のために壊した版");\n', encoding="utf-8")
        dest = rel_root / b["name"] / version
        dest.mkdir(parents=True, exist_ok=True)
        zip_name = f"{b['name']}-{version}-windows.zip"
        bundle.zip_dir(top, b["name"], dest / zip_name)
        rel = bundle.release_json(b, version, zip_name, bundle.sha256_file(dest / zip_name))
        (dest / "release.json").write_text(json.dumps(rel, ensure_ascii=False, indent=1), encoding="utf-8")
    finally:
        shutil.rmtree(work, ignore_errors=True)


class Run:
    def __init__(self, work: Path, env: dict):
        self.work, self.env, self.n = work, env, 0

    def open(self, exe: Path, label: str) -> dict:
        """exe を開き、自己診断の結果を待つ（入口・写し・開き直しの窓をたどった先の窓が書く）。"""
        self.n += 1
        out = self.work / f"selftest-{self.n}-{label}.json"
        env = {**self.env, "DT_SELFTEST": str(out)}
        subprocess.Popen([str(exe)], cwd=str(exe.parent), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        end = time.time() + WAIT
        while time.time() < end and not out.exists():
            time.sleep(1)
        time.sleep(3)    # 窓が終わるのを待つ
        if not out.exists():
            return {"ok": False, "error": f"{WAIT} 秒たっても結果がありません（{label}）"}
        r = json.loads(out.read_text(encoding="utf-8"))
        # 試験の版は program の版だけを書き換えた物（窓の exe は元の版のまま）なので、「窓の版と中身の版が同じ」は数えない。
        # 本物の配る形では、窓と中身は同じ版で作る（bundle.py・test_version.py）
        res = [x for x in r.get("results", []) if x["name"] != "窓の版と中身の版が同じ"]
        for x in res:
            if not x["ok"]:
                print(f"  [{label}] FAIL {x['name']} -- {x['info']}")
        if "results" in r:
            r["ok"] = bool(res) and all(x["ok"] for x in res)
        return r


def check(cond: bool, what: str, info="") -> bool:
    print(("PASS " if cond else "FAIL ") + what + (f" -- {info}" if info else ""))
    return cond


def make_link(link: Path, target: Path, workdir: Path) -> None:
    """人が作ったショートカットを真似る（Windows は WScript.Shell、ほかは窓の lnk.rs と同じ小さな JSON）。"""
    link.parent.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{link}');$s.TargetPath='{target}';"
              f"$s.WorkingDirectory='{workdir}';$s.Save()")
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
    else:
        link.write_text(json.dumps({"target": str(target), "workdir": str(workdir), "description": ""}), encoding="utf-8")


def read_link(link: Path):
    """→ (指す先, 作業フォルダ)。無ければ None。"""
    if not link.exists():
        return None
    if os.name == "nt":
        ps = f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{link}');$s.TargetPath;$s.WorkingDirectory"
        out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True).stdout.splitlines()
        return (Path(out[0]), Path(out[1])) if len(out) >= 2 else None
    v = json.loads(link.read_text(encoding="utf-8"))
    return Path(v["target"]), Path(v["workdir"])


def same(a, b) -> bool:
    return os.path.normcase(os.path.realpath(str(a))) == os.path.normcase(os.path.realpath(str(b)))


def leftover_windows(root: Path) -> list[str]:
    """作業フォルダの exe（版ごとの写し・入口）がまだ動いていないか（Linux は /proc。Windows は省く）。"""
    if os.name == "nt":
        return []
    out = []
    for d in Path("/proc").iterdir():
        if d.name.isdigit():
            try:
                exe = os.readlink(d / "exe")
            except OSError:
                continue
            if exe.startswith(str(root)):
                out.append(f"{d.name}: {exe}")
    return out


def update(exe: Path, work: Path) -> bool:
    b = bundle.brand()
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    built = bundle.build(exe, work / "out")
    v0 = built["version"]
    v1, v2 = bump(v0, 1), bump(v0, 2)
    share = work / "share"
    with zipfile.ZipFile(built["path"]) as z:
        z.extractall(share)
    share_app = share / b["name"]
    share_exe = share_app / b["exe"]
    if os.name != "nt":
        share_exe.chmod(0o755)
    share_digest = tree_digest(share_app)
    rel_root = work / "Releases"
    place(Path(built["stage"]), v0, rel_root)     # 置き場には配った版も並ぶ（配る版を前の版に戻すときに選ぶ）
    place(Path(built["stage"]), v1, rel_root)
    fixture = work / "fx"
    subprocess.run([sys.executable, str(REPO / "program" / "tests" / "fixture_lot.py"), str(fixture)], check=True, capture_output=True)
    local = work / "local"
    subprocess.run([sys.executable, str(REPO / "program" / "tests" / "selftest_config.py"), str(fixture), str(local), str(rel_root)], check=True)
    links = [work / "links" / "Desktop", work / "links" / "Programs"]
    env = {k: v for k, v in os.environ.items() if k not in ("DT_NO_HANDOFF", "DT_PROGRAM_DIR", "DT_SELFTEST")}
    env.update({"DT_LOCAL_ROOT": str(local), "DT_LINK_DIRS": os.pathsep.join(map(str, links))})
    run = Run(work, env)
    app = local / "app"
    ok = True

    # 1. 共有の exe を開く
    r = run.open(share_exe, "share")
    info, upd = r.get("info") or {}, r.get("update") or {}
    ok &= check(r.get("ok") is True, "1. 共有の exe で開くと自己診断が通る", r.get("error", ""))
    ok &= check(Path(info.get("program", "")).resolve() == (app / "program").resolve(), "1. この PC の app の program で動く", info.get("program"))
    ok &= check(str(local / "desktop") in str(info.get("exe", "")), "1. 窓は版ごとの写しで動く（app を掴まない）", info.get("exe"))
    ok &= check(info.get("installed") is True and info.get("version") == v0, f"1. 版 {v0}", json.dumps(info, ensure_ascii=False))
    ok &= check(upd.get("state") == "ready" and upd.get("ready") == v1, f"1. 使っている間に {v1} を取り込んだ", json.dumps(upd, ensure_ascii=False)[:300])
    ok &= check(bundle.app_version(app / "program") == v0, "1. 取り込んでも動いている app はそのまま")
    sc = ((r.get("install") or {}).get("shortcut") or {})
    ok &= check(sc.get("ask") is True and not sc.get("links"), "1. ショートカットが無いので画面が尋ねる", sc)
    made = [x for x in r.get("results") or [] if "ショートカットができる" in x.get("name", "")]
    ok &= check(len(made) == 1 and made[0].get("ok") is True, "1. 帯の「作る」を押すと、デスクトップとスタートにショートカットができる",
                made[0].get("info") if made else "自己診断が押していない")
    ok &= check(all((d / f"{b['name']}.lnk").is_file() for d in links), "1. 置き場に .lnk ができた", [str(d) for d in links])
    # 人が作った、共有の exe を指し作業フォルダも共有のショートカット（次の起動で直る）
    lnk = links[0] / f"{b['name']}.lnk"
    make_link(lnk, share_exe, share_app)

    # 2. ショートカットの行き先（app の exe）で開く → 入れ替わる
    r = run.open(app / b["exe"], "app")
    info, upd = r.get("info") or {}, r.get("update") or {}
    ok &= check(r.get("ok") is True, "2. app の exe で開くと自己診断が通る", r.get("error", ""))
    ok &= check(info.get("version") == v1, f"2. 起動の最初に {v1} へ入れ替わった", info.get("version"))
    ok &= check(bundle.app_version(local / "update" / "old" / "program") == v0, f"2. 直前の版 {v0} は控えに")
    ok &= check(upd.get("state") == "latest", "2. 置き場の最新を使っている", upd.get("state"))
    got = read_link(lnk)
    ok &= check(bool(got) and same(got[0], app / b["exe"]) and same(got[1], app),
                "2. 共有を指していたショートカットを、この PC の app（作業フォルダも app）に直した", got)

    ok &= check((local / "update" / "source.json").is_file(), "2. 更新の置き場を控えた（次の起動の最初に、中身を起こす前に確かめる）")

    # 3. 閉じている間に次の版を置く → ショートカットから 1 回開くだけで入れ替わる（要望 2026-10: 以前は 2 回開く必要があった）
    v3 = bump(v0, 3)
    place(Path(built["stage"]), v2, rel_root)
    r = run.open(app / b["exe"], "closed-new")
    info, upd = r.get("info") or {}, r.get("update") or {}
    ok &= check(r.get("ok") is True and info.get("version") == v2, f"3. 閉じている間に置いた {v2} に、1 回の起動で入れ替わった", info.get("version"))
    ok &= check(upd.get("state") == "latest", "3. 開いたあとは置き場の最新を使っている", upd.get("state"))

    # 4. 閉じている間に起動できない版を置いて 1 回開く → 入れ替えるが起動できず、控えへ戻して開き直す
    place(Path(built["stage"]), v3, rel_root, broken=True)
    r = run.open(app / b["exe"], "revert")
    info, upd = r.get("info") or {}, r.get("update") or {}
    ok &= check(r.get("ok") is True and info.get("version") == v2, f"4. {v3} は画面が開けず、{v2} に戻して開き直した", info.get("version"))
    failed = json.loads((local / "update" / "FAILED.json").read_text(encoding="utf-8")).get("versions", []) if (local / "update" / "FAILED.json").exists() else []
    ok &= check(failed == [v3], f"4. {v3} に開けなかった印", failed)
    ok &= check(upd.get("state") == "latest" and v3 in (upd.get("failed") or []), "4. 起動できなかった版はもう取り込まない", json.dumps(upd, ensure_ascii=False)[:300])

    # 5. 配る版を前の版（v1）に戻す → 1 回開くだけで配る版になり、配る版を作業場所に覚える
    (rel_root / b["name"] / "distribute.json").write_text(json.dumps(
        {"schema": 1, "app_id": b["app_id"], "version": v1, "entry": b["exe"], "setAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
         "setBy": "verify", "setPc": "verify", "previous": v2}, ensure_ascii=False), encoding="utf-8")
    r = run.open(app / b["exe"], "distribute-down")
    info, upd = r.get("info") or {}, r.get("update") or {}
    want = json.loads((local / "want.json").read_text(encoding="utf-8")) if (local / "want.json").exists() else {}
    ok &= check(r.get("ok") is True and info.get("version") == v1, f"5. 配る版を {v1} に戻すと、1 回の起動でその版になる", info.get("version"))
    ok &= check(want.get("version") == v1, "5. 配る版を作業場所に覚えた（画面が最新版かを出すのに使う）", want)
    ok &= check(upd.get("state") == "latest", "5. 開いたあとは配る版を使っている", json.dumps(upd, ensure_ascii=False)[:300])

    # 6. 新しい PC: 配る入口（置き場のアプリのフォルダの exe）を開くだけで、配る版を取り込んでこの PC で開く
    entry = rel_root / b["name"] / b["exe"]
    shutil.copy2(share_exe, entry)
    local2 = work / "local-new-pc"
    subprocess.run([sys.executable, str(REPO / "program" / "tests" / "selftest_config.py"), str(fixture), str(local2)], check=True, capture_output=True)
    run2 = Run(work, {**env, "DT_LOCAL_ROOT": str(local2), "DT_LINK_DIRS": os.pathsep.join(str(work / "links2" / n) for n in ("Desktop", "Programs"))})
    r = run2.open(entry, "entry")
    info = r.get("info") or {}
    ok &= check(r.get("ok") is True and info.get("version") == v1 and info.get("installed") is True,
                f"6. 配る入口を開くと、配る版 {v1} をこの PC の app に入れて開く", json.dumps(info, ensure_ascii=False)[:300])
    ok &= check(Path(info.get("program", "")).resolve() == (local2 / "app" / "program").resolve(), "6. 動くのはこの PC の app", info.get("program"))
    remembered = json.loads((local2 / "entry.json").read_text(encoding="utf-8")).get("dir") if (local2 / "entry.json").exists() else None
    ok &= check(remembered and same(remembered, rel_root / b["name"]), "6. 入口の置き場を控えた（設定の置き場が無い PC でも更新が届く）", remembered)

    ok &= check(tree_digest(share_app) == share_digest, "共有の配る形は 1 ファイルも変わらない")
    time.sleep(2)
    left = leftover_windows(work)
    ok &= check(not left, "終わったあと窓が残らない", left)
    return ok


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("update")
    s.add_argument("--exe", required=True, type=Path)
    s.add_argument("--work", type=Path, default=Path(tempfile.gettempdir()) / "dt-verify")
    s.add_argument("--keep", action="store_true")
    a = ap.parse_args(argv)
    ok = update(a.exe.resolve(), a.work.resolve())
    if not a.keep and ok:
        shutil.rmtree(a.work, ignore_errors=True)
    print("OK" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
