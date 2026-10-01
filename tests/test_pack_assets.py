import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from pack_assets import pack, CATALOGUES, indexed_files


class ResourceArchiveTests(unittest.TestCase):
    def setup_assets(self, root):
        root.mkdir()
        for name in CATALOGUES:
            data = {"schema": 1, "entries": []}
            if name == "presentations.json":
                data = {"schema": 1, "presentations": []}
            if name == "library.json":
                data = {"schema": 1, "characters": [], "appearances": [], "voices": [], "storyVoices": [], "soundResources": []}
            (root / name).write_text(json.dumps(data), encoding="utf-8")

    def test_archive_contains_indexed_resources_and_never_overwrites_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "assets"
            self.setup_assets(root)
            (root / "client.apk").write_bytes(b"excluded")
            output = Path(directory) / "resources.zip"
            pack(root, output)
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(archive.namelist(), CATALOGUES)
            with self.assertRaisesRegex(ValueError, "already exists"):
                pack(root, output)
            with self.assertRaisesRegex(ValueError, "outside"):
                pack(root, root / "output.zip")

    def test_missing_and_escaping_indexed_audio_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "assets"
            self.setup_assets(root)
            for path in ["audio/missing.m4a", "../outside.m4a"]:
                (root / "audio-index.json").write_text(json.dumps({"schema": 1, "entries": [{"errors": [], "clips": [{"path": path}]}]}), encoding="utf-8")
                with self.assertRaises(ValueError):
                    indexed_files(root)
