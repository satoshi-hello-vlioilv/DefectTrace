# -*- coding: utf-8 -*-
"""試験のロット（fixture_lot.py）が毎回同じ物を作り、検査計の形（.dat の頭・CAB）になっているか。"""
import hashlib
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from tests import fixture_lot


def digest(root: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(x for x in root.rglob("*") if x.is_file()):
        h.update(p.relative_to(root).as_posix().encode() + p.read_bytes())
    return h.hexdigest()


class Fixture(unittest.TestCase):
    def test_same_every_time_and_well_formed(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            lots = fixture_lot.golden_tree(Path(a))
            fixture_lot.golden_tree(Path(b))
            self.assertEqual(digest(Path(a)), digest(Path(b)), "毎回同じ物（正解データと突き合わせるため）")
            ls3 = lots[0]
            head = (ls3 / "DETECT_INFO.dat").read_bytes()
            hl, ver, rs = struct.unpack_from("<iii", head)
            self.assertEqual((hl, ver), (13 + len("DETECT_INFO"), 100))
            self.assertEqual((len(head) - hl) % (rs + 1), 0, "頭のあとは 1 バイトの印 + 1 件分の繰り返し")
            cab = (ls3 / "img" / "0000.cab").read_bytes()
            self.assertEqual(cab[:4], b"MSCF")
            # 1 つめの CFDATA は MSZIP（CK + deflate）
            data_off = struct.unpack_from("<I", cab, 36)[0]
            cb, ucb = struct.unpack_from("<HH", cab, data_off + 4)
            block = cab[data_off + 8:data_off + 8 + cb]
            self.assertEqual(block[:2], b"CK")
            self.assertEqual(len(zlib.decompress(block[2:], -15)), ucb)


if __name__ == "__main__":
    unittest.main()
