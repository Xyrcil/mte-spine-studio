import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from pack_assets import pack, refresh_catalogues, CATALOGUES, indexed_files


class ResourceArchiveTests(unittest.TestCase):
    def test_original_texture_mips_are_required_by_the_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "assets"
            self.setup_assets(root)
            texture = {"path": "base.png", "mips": [{"path": "base.mip-1.png"}]}
            presentation = {"path": "spines/role", "effects": [{"materials": [{"textures": {"_NoiseTex": texture}}]}]}
            (root / "presentations.json").write_text(json.dumps({"schema": 1, "presentations": [presentation]}))
            (root / "spines/role").mkdir(parents=True)
            (root / "spines/role/base.png").write_bytes(b"base")
            with self.assertRaisesRegex(ValueError, "base.mip-1"):
                indexed_files(root)
            (root / "spines/role/base.mip-1.png").write_bytes(b"source mip")
            self.assertIn("spines/role/base.mip-1.png", indexed_files(root))

    def test_skeleton_material_dependencies_are_required_and_packed_relative_to_the_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "assets"
            self.setup_assets(root)
            entry = {"status": "parsed", "path": "spines/painting/role", "skeleton": "id/skeleton.skel", "atlases": [], "materialBindings": {"pages": [{"materials": {"normal": {"textures": {"_NoiseTex": {"path": "materials/noise.png"}, "_MaskTex": {"default": "white"}}}}}]}}
            (root / "runtime-index.json").write_text(json.dumps({"schema": 1, "entries": [entry]}))
            for path in ["id/skeleton.skel", "materials/noise.png"]:
                destination = root / entry["path"] / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(b"resource")
            self.assertEqual(set(indexed_files(root)), set(CATALOGUES + [entry["path"] + "/id/skeleton.skel", entry["path"] + "/materials/noise.png"]))
            entry["materialBindings"]["pages"][0]["materials"]["normal"]["textures"]["_NoiseTex"]["path"] = "materials/missing.png"
            (root / "runtime-index.json").write_text(json.dumps({"schema": 1, "entries": [entry]}))
            with self.assertRaisesRegex(ValueError, "Indexed resource missing"):
                indexed_files(root)
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

    def test_catalogue_refresh_preserves_media_has_no_duplicate_entries_and_rejects_new_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "assets"
            self.setup_assets(root)
            (root / "audio").mkdir()
            (root / "audio/voice.wav").write_bytes(b"source voice")
            (root / "audio-index.json").write_text(json.dumps({"schema": 1, "entries": [{"errors": [], "clips": [{"path": "audio/voice.wav"}]}]}))
            output = Path(directory) / "resources.zip"
            pack(root, output)
            library = json.loads((root / "library.json").read_text())
            library["mainViewVoices"] = {"entryVoices": [{"resourceName": "source"}]}
            (root / "library.json").write_text(json.dumps(library))
            result = refresh_catalogues(root, output)
            self.assertEqual(result["updated"], ["library.json"])
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(len(archive.namelist()), len(set(archive.namelist())))
                self.assertEqual(archive.read("audio/voice.wav"), b"source voice")
                self.assertEqual(json.loads(archive.read("library.json")), library)
            before = output.read_bytes()
            self.assertEqual(refresh_catalogues(root, output)["updated"], [])
            library["extra"] = "audio/new.wav"
            (root / "library.json").write_text(json.dumps(library))
            (root / "audio/new.wav").write_bytes(b"new")
            with self.assertRaisesRegex(ValueError, "Resource files changed"):
                refresh_catalogues(root, output)
            self.assertEqual(output.read_bytes(), before)
            self.assertEqual(list(output.parent.glob("mte-pack-*.partial")), [])
