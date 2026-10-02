import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from pack_assets import pack, CATALOGUES, indexed_files


class ResourceArchiveTests(unittest.TestCase):
    def test_native_and_particle_media_are_packed_with_presentation_relative_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "assets"
            self.setup_assets(root)
            presentation = {"path": "spines/ui/Onsen", "images": [{"sprite": {"path": "effects/sprites/heart.png"}}], "effects": [{"sprites": [{"path": "effects/sprites/smoke.png"}], "materials": [{"textures": {"_MainTex": {"path": "effects/textures/main.png"}, "_MaskTex": {"path": "effects/textures/mask.png"}}}]}]}
            (root / "presentations.json").write_text(json.dumps({"schema": 1, "presentations": [presentation]}))
            with self.assertRaisesRegex(ValueError, "Indexed resource missing"):
                indexed_files(root)
            paths = ["effects/sprites/heart.png", "effects/sprites/smoke.png", "effects/textures/main.png", "effects/textures/mask.png"]
            for path in paths:
                destination = root / presentation["path"] / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(b"pixels")
            output = Path(directory) / "resources.zip"
            pack(root, output)
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(set(archive.namelist()), set(CATALOGUES + [presentation["path"] + "/" + path for path in paths]))
            presentation["images"][0]["sprite"]["path"] = "../outside.png"
            (root / "presentations.json").write_text(json.dumps({"schema": 1, "presentations": [presentation]}))
            with self.assertRaisesRegex(ValueError, "Invalid indexed"):
                indexed_files(root)

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
