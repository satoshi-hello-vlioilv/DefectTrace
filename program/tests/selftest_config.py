# -*- coding: utf-8 -*-
"""自己診断・更新の通しで使う設定（作業場所の config.json）を書く。試験のロット（fixture_lot.py）を設備にする。

    python program/tests/selftest_config.py <試験のロットの場所> <作業場所> [<更新の置き場>]
"""
import json
import sys
from pathlib import Path

root, home = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
cfg = {"equipments": [{"name": "LS3", "path": str(root / "LS3")}, {"name": "DL2", "path": str(root / "DL2")}],
       "update_source": sys.argv[3] if len(sys.argv) > 3 else ""}
home.mkdir(parents=True, exist_ok=True)
(home / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
print(home / "config.json")
