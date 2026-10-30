import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("pack_wallpaper", Path(__file__).resolve().parents[1] / "tools" / "pack_wallpaper.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WallpaperPackageTests(unittest.TestCase):
    def fixture(self, root):
        resources, app = root / "resources.zip", root / "shell"
        (app / "app").mkdir(parents=True)
        (app / "index.html").write_text('<script src="./app/main.js"></script>')
        (app / "app" / "main.js").write_text('console.log("Local");')
        with zipfile.ZipFile(resources, "w") as archive:
            for name in module.CATALOGUES:
                archive.writestr(name, json.dumps({"appearances": []} if name == "library.json" else {"kind": name}))
            for name in ["spines/a/image.png", "spines/b/image.png"]:
                archive.writestr(name, b"identical PNG payload")
            archive.writestr("spines/a/source.skel", b"first variant")
            archive.writestr("spines/b/source.skel", b"other variant")
        return resources, app

    def test_complete_directory_uses_exact_byte_aliases_and_keeps_distinct_variants(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            resources, app = self.fixture(root)
            output = root / "wallpaper"
            result = module.build_package(resources, app, output, reserve=0)
            mapping = json.loads((output / "assets" / "resource-map.json").read_text())
            self.assertEqual(mapping["aliases"], {"spines/b/image.png": "spines/a/image.png"})
            self.assertEqual(result["deduplicatedBytes"], len(b"identical PNG payload"))
            self.assertEqual((output / "assets" / "spines/b/source.skel").read_bytes(), b"other variant")
            self.assertFalse((output / "assets" / "spines/b/image.png").exists())
            self.assertEqual(json.loads((output / "project.json").read_text())["type"], "web")
            archive = root / "wallpaper.zip"
            module.pack_archive(output, archive, reserve=0)
            with zipfile.ZipFile(archive) as packed:
                self.assertIn("mte-wallpaper/project.json", packed.namelist())
                self.assertEqual(packed.read("mte-wallpaper/assets/spines/a/image.png"), b"identical PNG payload")

    def test_refresh_changes_only_code_and_removes_superseded_chunks(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            resources, app = self.fixture(root)
            output = root / "wallpaper"
            module.build_package(resources, app, output, reserve=0)
            (app / "app" / "main.js").rename(app / "app" / "next.js")
            module.copy_app(app, output, refresh=True)
            self.assertFalse((output / "app" / "main.js").exists())
            self.assertTrue((output / "app" / "next.js").is_file())
            self.assertEqual((output / "assets/spines/a/image.png").read_bytes(), b"identical PNG payload")

    def test_crc_candidates_must_also_match_bytes(self):
        payloads = {name: b"{}" for name in module.CATALOGUES}
        payloads.update({"a.skel": b"ab", "b.skel": b"cd"})

        class Archive:
            def infolist(self):
                result = []
                for name, data in payloads.items():
                    info = zipfile.ZipInfo(name)
                    info.file_size, info.CRC = len(data), 0
                    result.append(info)
                return result

            def open(self, info):
                return io.BytesIO(payloads[info.filename])

        _, unique, aliases = module.resource_plan(Archive())
        self.assertFalse(aliases)
        self.assertEqual(len(unique), len(payloads))

    def test_archive_refresh_replaces_only_after_success_and_keeps_one_zip(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            resources, app = self.fixture(root)
            output, destination = root / "wallpaper", root / "wallpaper.zip"
            module.build_package(resources, app, output, reserve=0)
            module.pack_archive(output, destination, reserve=0)
            previous = destination.read_bytes()
            (output / "app" / "main.js").write_text('console.log("Updated");')
            with patch.object(module.zipfile.ZipFile, "write", side_effect=OSError("Interrupted")):
                with self.assertRaises(OSError):
                    module.pack_archive(output, destination, reserve=0, replace=True)
            self.assertEqual(destination.read_bytes(), previous)
            self.assertFalse(list(root.glob("*.partial")))
            module.pack_archive(output, destination, reserve=0, replace=True)
            with zipfile.ZipFile(destination) as archive:
                self.assertEqual(archive.read("mte-wallpaper/app/main.js"), b'console.log("Updated");')
            self.assertEqual(list(root.glob("wallpaper*.zip")), [destination])
            self.assertFalse(list(root.glob("*.partial")))

    def test_traversal_and_insufficient_space_leave_no_output(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            resources, app = self.fixture(root)
            output = root / "wallpaper"
            with self.assertRaises(ValueError):
                module.build_package(resources, app, output, budget=1, reserve=0)
            self.assertFalse(output.exists())
            with zipfile.ZipFile(resources, "a") as archive:
                archive.writestr("../outside.png", b"x")
            with self.assertRaises(ValueError):
                module.build_package(resources, app, output, reserve=0)
            self.assertFalse(output.exists())
            self.assertFalse(list(root.glob(".mte-wallpaper-*")))


if __name__ == "__main__":
    unittest.main()
