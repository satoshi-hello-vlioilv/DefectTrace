# -*- coding: utf-8 -*-
"""配る ZIP の組み立て（bundle.py）。release.json の形（desktop/src/release.rs が読む）・名前の断り方・ZIP の中の並び・配る物の選び方。"""
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

import bundle


class Bundle(unittest.TestCase):
    def test_release_json_matches_what_the_window_reads(self):
        b = bundle.brand()
        r = bundle.release_json(b, "3.9.0", f"{b['name']}-3.9.0-windows.zip", "a" * 64)
        self.assertEqual(set(r), {"schema", "app_id", "name", "version", "zip", "sha256", "exe"})
        self.assertEqual((r["schema"], r["app_id"], r["exe"]), (1, b["app_id"], b["exe"]))
        for bad in ("../x.zip", "a/b.zip", "a\\b.zip", "C:x.zip", " x.zip", ".."):
            with self.assertRaises(SystemExit, msg=bad):
                bundle.release_json(b, "3.9.0", bad, "a" * 64)

    def test_legacy_exe_names(self):
        """名前の歴史: 前の名前の exe は、いまの exe と別の 1 つの名前。使えない名前は断る。"""
        b = bundle.brand()
        self.assertNotIn(b["exe"], bundle.legacy_exe(b))
        self.assertEqual(bundle.legacy_exe({**b, "legacy_exe": [b["exe"], "Old.exe"]}), ["Old.exe"], "いまの名前は除く")
        for bad in ("../Old.exe", "a\\b.exe", "Old.txt"):
            with self.assertRaises(SystemExit, msg=bad):
                bundle.legacy_exe({**b, "legacy_exe": [bad]})

    def test_zip_has_one_top_folder_in_name_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "stage"
            (root / "program" / "app").mkdir(parents=True)
            (root / "program" / "index.html").write_text("x", encoding="utf-8")
            (root / "program" / "app" / "日本.txt").write_text("y", encoding="utf-8")
            (root / "A.exe").write_bytes(b"MZ")
            out = Path(tmp) / "a.zip"
            self.assertEqual(bundle.zip_dir(root, "App", out), 3)
            names = zipfile.ZipFile(out).namelist()
            self.assertEqual(names, sorted(names))
            self.assertTrue(all(n.startswith("App/") for n in names), names)
            self.assertIn("App/program/app/日本.txt", names)

    def test_release_notes_carry_this_versions_changelog_and_fingerprint(self):
        b = bundle.brand()
        version = bundle.app_version()
        rel = bundle.release_json(b, version, f"{b['name']}-{version}-windows.zip", "a" * 64)
        history = bundle.changelog()
        notes = bundle.release_notes(rel, history)
        self.assertTrue(notes.startswith(f"## 版 {version}（"), notes[:40])
        for n in history[0]["notes"]:
            self.assertIn(f"- {n}", notes)
        self.assertIn(rel["zip"], notes)
        self.assertIn("a" * 64, notes)
        with self.assertRaisesRegex(SystemExit, "更新履歴"):
            bundle.release_notes({**rel, "version": "0.0.1"}, history)

    def test_program_files_are_tracked_files_without_local_state(self):
        files = bundle.program_files()
        self.assertIn("program/app/static/index.html", files)
        self.assertIn("program/app/brand.json", files)
        self.assertIn("program/app/version.py", files, "窓が版を読む")
        self.assertIn("program/config/config.json", files)
        self.assertFalse([f for f in files if "__pycache__" in f or f.endswith(".pyc")])
        self.assertFalse([f for f in files if f.startswith(("program/tests/", "program/tools/", "program/docs/"))], "試験・道具・説明は配らない")
        self.assertNotIn("program/app/app_icon.py", files, "アイコンは作るときに exe へ入れる")
        self.assertEqual(bundle.app_version(), json.loads(json.dumps(bundle.app_version())))


if __name__ == "__main__":
    unittest.main()
