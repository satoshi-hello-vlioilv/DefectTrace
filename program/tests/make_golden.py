"""正解データ（desktop/tests/golden.json）を作る: 版 3.8 の Python 版（Flask）を git の履歴から取り出し、試験のロットに問い合わせた答えを残す。

    pip install flask pillow          # 版 3.8 が使う部品（正解データを作るときだけ）
    python program/tests/make_golden.py desktop/tests/golden.json

Rust の答えとの突き合わせは desktop/tests/golden.rs。版 3.8 と違ってよいと決めたことは、ここ（下の「直したこと」）と golden.rs に書く。
版 4.8.0 で足した物（既定の表示項目の一覧の 材質・欠陥数、ロット一覧の印 no_image〈画像なし〉）は版 3.8 に無い機能なので、
正解データは版 3.8 の答えのまま作り、golden.rs が比べる前に除く（golden.rs の V48_ADDED と no_image）。
"""
import hashlib
import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import unquote_plus, urlencode

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OLD_COMMIT = "a7acfcd"          # 版 3.8 の最後（Flask 版）
OLD_FILES = ("app.py", "dat.py", "xmlutil.py", "config.json", "templates/index.html", "static/app.js", "static/style.css")


def q(**k):
    return urlencode(k)


def old_app(work: Path, root: Path):
    """版 3.8 を取り出し、試験のロットを設備にした設定で読み込む。→ (Flask の試しの相手, 置き場)"""
    old = work / "old"
    for f in OLD_FILES:
        (old / f).parent.mkdir(parents=True, exist_ok=True)
        (old / f).write_bytes(subprocess.run(["git", "show", f"{OLD_COMMIT}:{f}"], cwd=REPO, check=True, capture_output=True).stdout)
    cfg = json.loads((old / "config.json").read_text(encoding="utf-8"))
    cfg["equipments"] = [{"name": n, "path": str(root / n)} for n in ("LS3", "DL2", "NS1")]
    cfg["cache_dir"] = str(work / "cache")
    (old / "config.json").write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
    sys.path.insert(0, str(old))
    os.chdir(old)
    app = importlib.import_module("app")
    # 直したこと（版 4.0.0）: COND*.xml が wavedata/cond の下だけにあるロット（DL2）でも分類名を読む
    # （README v3.6 の約束。版 3.8 は walk が wavedata を飛ばしていた）
    init = app.LotRes.__init__

    def init_with_wavedata(self, lot):
        init(self, lot)
        wc = Path(lot) / "wavedata" / "cond"
        if wc.is_dir():
            for p in sorted(wc.iterdir()):
                if p.is_file():
                    self.files.setdefault(p.name.lower(), p)

    app.LotRes.__init__ = init_with_wavedata
    return app.app.test_client(), cfg


class Recorder:
    """問い合わせと答えを残す（試験のロットの場所は <ROOT> に置き換える）。"""

    def __init__(self, client, root: Path, cache: Path):
        self.c, self.root, self.cache, self.answers = client, str(root), str(cache), []

    def norm(self, v):
        if isinstance(v, str):
            return v.replace(self.root, "<ROOT>").replace(self.cache, "<CACHE>")
        if isinstance(v, list):
            return [self.norm(x) for x in v]
        if isinstance(v, dict):
            return {self.norm(k): self.norm(x) for k, x in v.items()}
        return v

    def url(self, u):
        return self.norm(unquote_plus(u))

    def get(self, url):
        r = self.c.get(url)
        self.answers.append({"method": "GET", "url": self.url(url), "status": r.status_code, "body": self.norm(r.get_json())})
        return r.get_json()

    def send(self, url, body, method="POST"):
        r = self.c.open(url, method=method, json=body)
        self.answers.append({"method": method, "url": self.url(url), "req": self.norm(body), "status": r.status_code, "body": self.norm(r.get_json())})
        return r.get_json()

    def image(self, url):
        r = self.c.get(url)
        self.answers.append({"method": "GET", "url": self.url(url), "status": r.status_code, "sha256": hashlib.sha256(r.data).hexdigest()})


def ask_lot(rec: Recorder, lot: str):
    rec.send("/api/open", {"lot": lot})
    for _ in range(200):
        if rec.c.get("/api/status?" + q(lot=lot)).get_json()["finished"]:
            break
        time.sleep(0.05)
    rec.get("/api/status?" + q(lot=lot))
    rec.answers[-1]["body"].pop("elapsed", None)
    info = rec.get("/api/info?" + q(lot=lot))
    for d in info["dat"]:
        rec.get("/api/dat?" + q(lot=lot, name=d["name"], n=400))
    for g in ["img", "fm_img"]:
        m = rec.get("/api/imgmap?" + q(lot=lot, g=g))
        rec.get("/api/map?" + q(lot=lot, g=g))
        for k in list(m["map"])[:4]:
            cab, name = k.split("/")
            rec.get("/api/imginfo?" + q(lot=lot, g=g, cab=cab, name=name))
            rec.image("/img?" + q(lot=lot, g=g, cab=cab, name=name))
    for args in [{}, {"tol": 2}, {"tol": 3, "mirror": 1}, {"tol": 5, "maxdy": 0.01}, {"tol": "x"}]:
        rec.get("/api/pairs?" + q(lot=lot, g="img", **args))
    for args in [{}, {"skip": 1}, {"n": 2, "skip": 2}, {"pmin": 1, "pmax": 2, "skip": 1}, {"tol": 1, "ytol": 0.005, "skip": 1}]:
        rec.get("/api/pitch?" + q(lot=lot, g="img", **args))


def ask_pins(rec: Recorder, lots):
    """表示項目を足す・直す・消す（新しい項目の id は作るたびに違うので NEW に置き換える）。"""
    def renamed(pins, pid):
        return [dict(p, id="NEW" if p["id"] == pid else p["id"]) for p in pins]

    rec.get("/api/pins")
    pins = rec.send("/api/pins", {"scope": "lot", "place": "summary", "file": "dat:INSP_INFO", "key": "product", "label": "品名", "before": "d_s_mat"})
    pid = [p for p in pins if p["key"] == "product"][0]["id"]
    rec.answers[-1]["body"] = renamed(rec.answers[-1]["body"], pid)
    rec.send("/api/pins", {"scope": "image", "place": "list", "file": "dat:DETECT_INFO", "key": "x"})
    rec.send("/api/pins", {"scope": "image", "place": "mapx", "file": "dat:DETECT_INFO", "key": "x_mm", "label": "X"})
    rec.send("/api/lotsum", {"paths": lots})
    rec.get("/api/map?" + q(lot=lots[0], g="img"))
    for b in [{"label": "品名2"}, {"place": "lot"}, {"before": "d_l_ord"}, {"place": "card"}, {"fmt": "hhmmss"}]:
        r = rec.send("/api/pins/" + pid, b, "PATCH")
        rec.answers[-1]["url"] = "/api/pins/NEW"
        if isinstance(r, list):
            rec.answers[-1]["body"] = renamed(r, pid)
    rec.send("/api/pins/d_list_time", {"fmt": "hhmmss"}, "PATCH")
    rec.send("/api/lotsum", {"paths": lots[:1]})
    r = rec.c.delete("/api/pins/" + pid)
    rec.answers.append({"method": "DELETE", "url": "/api/pins/NEW", "status": r.status_code, "body": r.get_json()})
    rec.send("/api/pins/reset", {})


def main(out: Path):
    work = Path(tempfile.mkdtemp(prefix="dt-golden-"))
    try:
        root = work / "fx"
        subprocess.run([sys.executable, str(HERE / "fixture_lot.py"), str(root)], check=True, capture_output=True)
        client, cfg = old_app(work, root)
        rec = Recorder(client, root, work / "cache")
        rec.get("/api/equipments")
        lots = []

        def walk(p):
            ch = rec.get("/api/children?" + q(path=p))
            if isinstance(ch, dict):
                return
            for x in ch:
                if x["kind"] == "lot":
                    lots.append(x["path"])
                else:
                    walk(x["path"])

        for e in cfg["equipments"]:
            walk(e["path"])
        rec.send("/api/lotsum", {"paths": lots})
        for lot in lots:
            ask_lot(rec, lot)
        ask_pins(rec, lots)
        out.write_text(json.dumps(rec.answers, ensure_ascii=False, indent=0), encoding="utf-8")
        print(len(rec.answers), "answers")
    finally:
        os.chdir(REPO)
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
