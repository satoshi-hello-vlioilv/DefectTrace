"""実データの解析結果（scan_*.txt）から、ロットの .dat をバイトのまま作り直す（データの読み方を実データで確かめるため）。

    python program/tools/scan_rebuild.py <出力フォルダ> scan_A.txt [scan_B.txt ...]

解析結果は、設備ごとに 1 ロットを無作為に選んで、フォルダの形・ファイルの一覧・.dat の全バイト（[8] DAT FILES : FULL DUMP）・
.dat 以外の頭（[6-1]。XML は先頭 20 行）を書いた物。ここでは次を作る:
  <出力>/<設備>/<ロットのフォルダ名>/<相対パス>.dat … 全バイト（SHA256 を解析結果と突き合わせる）
  <出力>/<設備>/<ロットのフォルダ名>/_xml_head/<相対パス>.txt … XML の先頭（全文ではないので、ロットの中には置かない）
.dat の全バイトが揃わないとき（SHA256 が合わないとき）は、そのファイルを書かずに知らせる。
"""

import hashlib
import re
import sys
from pathlib import Path, PureWindowsPath

# 1 行: 「位置（8 桁）  16 バイト（8 バイトごとに空白 2 つで区切る）  ASCII」
HEX = re.compile(r"^([0-9A-F]{8})  ((?:[0-9A-F]{2} {1,2}){0,15}[0-9A-F]{2})")


def parse(text: str):
    target = PureWindowsPath(re.search(r"^ Target\s*: (.+)$", text, re.M).group(1).strip())
    dats = []
    for block in re.split(r"^#{20,}\n# DAT No\.\d+ +\S+ +", text, flags=re.M)[1:]:
        rel = block.split("\n", 1)[0].strip().lstrip("\\")
        size = int(re.search(r"^Bytes\s*: (\d+)", block, re.M).group(1))
        sha = re.search(r"^SHA256\s*: ([0-9A-F]+)", block, re.M).group(1)
        data = bytearray()
        dump = block.split("[HEX DUMP]", 1)[1] if "[HEX DUMP]" in block else ""
        for line in dump.splitlines():
            m = HEX.match(line)
            if m and int(m.group(1), 16) == len(data):
                data += bytes.fromhex(m.group(2).replace(" ", ""))
        dats.append((rel, bytes(data[:size]), size, sha))
    heads = {}
    sec = text.split("==== [6-1]", 1)[1].split("==== [6-2]", 1)[0] if "==== [6-1]" in text else ""
    for part in re.split(r"^----- ", sec, flags=re.M)[1:]:
        name = part.split("  [", 1)[0].strip().lstrip("\\")
        if "[text preview" in part:
            heads[name] = "\n".join(ln[2:] for ln in part.split("[text preview", 1)[1].splitlines()[1:] if ln.startswith("  "))
    return target, dats, heads


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    out = Path(argv[0])
    bad = 0
    for scan in argv[1:]:
        ng = 0
        target, dats, heads = parse(Path(scan).read_text(encoding="utf-8-sig"))
        lot = out / target.parent.name / target.name
        for rel, data, size, sha in dats:
            ok = len(data) == size and hashlib.sha256(data).hexdigest().upper() == sha
            if not ok:
                ng += 1
                print(f"NG  {target.parent.name}/{rel}: {len(data)} / {size} バイト（SHA256 が合わない）")
                continue
            p = lot / PureWindowsPath(rel).as_posix()
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        for rel, text in heads.items():
            if rel.lower().endswith(".xml"):
                p = lot / "_xml_head" / (PureWindowsPath(rel).as_posix() + ".txt")
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text, encoding="utf-8")
        bad += ng
        print(f"{target.parent.name}/{target.name}: .dat {len(dats) - ng} / {len(dats)} 件（XML の先頭 {sum(r.lower().endswith('.xml') for r in heads)} 件）")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
