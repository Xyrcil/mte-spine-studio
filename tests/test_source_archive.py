import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
import io
import zipfile
import tempfile
from contextlib import nullcontext

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from source_archive import spine_key, decode_bundle, missing_paintings, sanitize_diagnostics, source_versions, manifest_dependencies, load_dependencies, output_destination, scene_metadata_changes, installed_scene_version, skeleton_media_changes


class SourceArchiveTests(unittest.TestCase):
    def test_media_comparison_checks_bytes_settings_layout_and_pixels_without_writing(self):
        reader = SimpleNamespace(path_id=99, type=SimpleNamespace(name="MonoBehaviour"))
        atlas = SimpleNamespace(path_id=100)
        skeleton_text = '{"skeleton":{"spine":"3.8.99"}}'
        source_text = '\nsource.png\nsize: 1,1\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n'
        converted_text = source_text.replace('source.png', 'page-0.png')
        tree = {"skeletonJSON": {"m_PathID": 60}, "atlasAssets": [{"m_PathID": 100}]}
        refs = {60: SimpleNamespace(read=lambda: SimpleNamespace(m_Script=skeleton_text)), 100: atlas, 200: SimpleNamespace(read=lambda: SimpleNamespace(m_Script=source_text))}
        source = SimpleNamespace(size=(1, 1), tobytes=lambda: b'RGBA')
        source.convert = lambda mode: source
        target = SimpleNamespace(size=(1, 1), tobytes=lambda: b'RGBA')
        target.convert = lambda mode: target
        extractor = SimpleNamespace(objects=[reader], tree=lambda item: tree if item is reader else {"atlasFile": {"m_PathID": 200}, "materials": [1]}, resolve=lambda owner, pointer: refs[pointer["m_PathID"]], texture=lambda owner, pointer: (SimpleNamespace(image=source), {}))
        entry = {"id": "99", "path": "fixture", "skeleton": "skeleton.json", "scale": 1, "defaultMix": 0, "mixes": {name: [] for name in ("fromAnimation", "toAnimation", "duration")}, "atlases": [{"atlas": "texture.atlas", "pages": ["page-0.png"]}]}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'fixture/99').mkdir(parents=True)
            skeleton = root / 'fixture/skeleton.json'
            layout = root / 'fixture/99/texture.atlas'
            skeleton.write_bytes(skeleton_text.encode())
            layout.write_bytes(converted_text.encode())
            compare = lambda entries: skeleton_media_changes(extractor, entries, root, lambda path: nullcontext(target))
            self.assertEqual(compare([entry]), [])
            skeleton.write_bytes(b'changed')
            self.assertEqual(compare([entry])[0]["kind"], 'skeleton-bytes')
            skeleton.write_bytes(skeleton_text.encode())
            self.assertEqual(compare([{**entry, "scale": 2}])[0]["kind"], 'skeleton-settings')
            target.tobytes = lambda: b'other'
            self.assertEqual(compare([entry])[0]["kind"], 'atlas-pixels')
            target.tobytes = lambda: b'RGBA'
            layout.write_bytes(b'changed')
            self.assertEqual(compare([entry])[0]["kind"], 'atlas-layout')
            self.assertEqual(layout.read_bytes(), b'changed')
            self.assertEqual(compare([])[0]["kind"], 'unindexed-skeleton')
            with self.assertRaises(ValueError):
                compare([{**entry, "path": '../escape'}])
            layout.write_bytes(converted_text.encode())
            owner = SimpleNamespace(path_id=1, assets_file=SimpleNamespace(name='scene'), type=SimpleNamespace(name='MonoBehaviour'))
            reader.assets_file = SimpleNamespace(name='role')
            refs[99] = reader
            old_tree = extractor.tree
            extractor.tree = lambda item: {"skeletonDataAsset": {"m_FileID": 1, "m_PathID": 99}} if item is owner else old_tree(item)
            extractor.objects = [owner]
            self.assertEqual(compare([entry]), [])
            self.assertEqual(extractor.objects, [owner])

    def test_comparison_uses_exact_archive_version_when_no_primary_is_installed(self):
        key = "Spines/painting/model"
        first = {"id": key + "/archive-1", "sourceBundle": key, "sourceVersion": 1}
        second = {"id": key + "/archive-2", "sourceBundle": key, "sourceVersion": 2}
        self.assertEqual(installed_scene_version(key, 2, [first, second]), second)
        self.assertIsNone(installed_scene_version(key, 3, [first, second]))
        primary = {"id": key}
        self.assertEqual(installed_scene_version(key, 2, [first, second, primary]), primary)
        original = {"id": key + "/original", "sourceBundle": key, "sourceVersion": "original"}
        self.assertEqual(installed_scene_version(key, 1, [original]), original)
        self.assertIsNone(installed_scene_version(key, 2, [original]))
        self.assertEqual(installed_scene_version(key, 1, [original, first]), first)

    def test_scene_comparison_ignores_script_addresses_but_retains_authored_changes(self):
        def scene(script, assembly="client.dll", enabled=1):
            return [{"id": script, "type": "MonoScript", "data": {"m_ClassName": "ClickRoot", "m_Namespace": "", "m_AssemblyName": assembly}}, {"id": "root", "type": "MonoBehaviour", "data": {"m_Script": {"m_FileID": 0, "m_PathID": script}, "m_Enabled": enabled}}]
        self.assertEqual(scene_metadata_changes(scene("new"), scene("old")), [])
        self.assertEqual(scene_metadata_changes(scene("new", enabled=0), scene("old"))[0]["fields"], ["m_Enabled"])
        self.assertEqual(scene_metadata_changes(scene("new", "other.dll"), scene("old"))[0]["fields"], ["m_Script"])
        added = scene("new") + [{"id": "area", "type": "BoxCollider2D", "data": {}}]
        self.assertEqual(scene_metadata_changes(added, scene("old"))[0]["status"], "added")
        self.assertEqual(scene_metadata_changes(scene("old"), added)[0]["status"], "removed")

    def test_named_original_variant_preserves_its_resource_identity(self):
        row = SimpleNamespace(filename="source.data")
        self.assertEqual(source_versions("Spines/painting/model", [row], variant="original"), [("Spines/painting/model/original", row, "original")])
        for name in ["../escape", "Original", "", "a/b", "a" * 65]:
            with self.assertRaises(ValueError):
                source_versions("Spines/painting/model", [row], variant=name)
        with self.assertRaises(ValueError):
            source_versions("Spines/painting/model", [row, row], variant="original")
        with self.assertRaises(ValueError):
            source_versions("Spines/painting/model", [row], True, "original")

    def test_output_paths_preserve_existing_directory_casing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "spines/ui/Onsen").mkdir(parents=True)
            self.assertEqual(output_destination(root, "Spines/ui/onsen/199970301"), root / "spines/ui/Onsen/199970301")
            self.assertEqual(output_destination(root, "Spines/ui/mailspine/new"), root / "spines/ui/mailspine/new")

    def test_dependency_closure_loads_shared_files_once_and_falls_back_to_apk(self):
        source_buffer, apk_buffer = io.BytesIO(), io.BytesIO()
        member = "package/files/vercache_demo/spines/painting/model/spineaniprefab.data"
        prefix = "package/files/vercache_demo/"
        with zipfile.ZipFile(source_buffer, "w") as archive:
            archive.writestr(member + ".manifest", "Dependencies:\n- D:/build/StreamingAssets/share/shared.data")
            archive.writestr(prefix + "share/shared.data", b"UnityFS-shared")
            archive.writestr(prefix + "share/shared.data.manifest", "Dependencies:\n- D:/build/StreamingAssets/common/shader.data\n- D:/build/StreamingAssets/share/shared.data")
        with zipfile.ZipFile(apk_buffer, "w") as archive:
            archive.writestr("assets/common/shader.data", b"UnityFS-shader")
        calls = []
        environment = SimpleNamespace(load_file=lambda data, **options: calls.append((data, options)))
        with zipfile.ZipFile(source_buffer) as archive, zipfile.ZipFile(apk_buffer) as apk:
            load_dependencies(environment, archive, member, apk)
            self.assertEqual([options["name"] for data, options in calls], ["share/shared.data", "common/shader.data"])
            self.assertTrue(all(options["is_dependency"] for data, options in calls))
            with self.assertRaises(ValueError):
                load_dependencies(environment, archive, member)
            calls.clear()
            load_dependencies(environment, archive, "package/files/vercache_demo/no-manifest.data", apk, ["share/shared.data"])
            self.assertEqual(len(calls), 2)
    def test_dependencies_keep_resource_paths_without_builder_machine_paths(self):
        text = "ManifestFileVersion: 0\nDependencies:\n- D:/build/private/StreamingAssets/common/shader.data\n- D:\\build\\StreamingAssets\\share\\share.data\n"
        self.assertEqual(manifest_dependencies(text), ["common/shader.data", "share/share.data"])
        self.assertEqual(manifest_dependencies("Dependencies: []"), [])
        with self.assertRaises(ValueError):
            manifest_dependencies("Dependencies:\n- D:/build/StreamingAssets/../private.data")
    def test_explicit_versions_preserve_both_entries_with_stable_distinct_keys(self):
        rows = [SimpleNamespace(filename="folder/spineaniprefab.data"), SimpleNamespace(filename="folder/spineaniprefab .data")]
        with self.assertRaises(ValueError):
            source_versions("Spines/painting/model_hx", rows)
        selected = source_versions("Spines/painting/model_hx", rows, True)
        self.assertEqual([row[0] for row in selected], ["Spines/painting/model_hx/archive-1", "Spines/painting/model_hx/archive-2"])
        self.assertIs(selected[0][1], rows[1])
        self.assertIs(selected[1][1], rows[0])
        self.assertEqual(source_versions("single", [rows[0]]), [("single", rows[0], None)])
    def test_diagnostic_paths_are_removed_without_rewriting_resource_content(self):
        original = {"text": "/Users/example/original dialogue", "nested": [{"error": "File cab-example not found in /Users/example/project"}]}
        result = sanitize_diagnostics(original)
        self.assertEqual(result["text"], original["text"])
        self.assertEqual(result["nested"][0]["error"], "File cab-example not found in <local path>")
        self.assertIn("/Users/example/project", original["nested"][0]["error"])
    def test_missing_batch_excludes_existing_and_ambiguous_bundles(self):
        entries = {"Spines/painting/one": [1], "Spines/painting/two": [1], "Spines/painting/two_hx": [1, 2], "Spines/story/three": [1]}
        self.assertEqual(missing_paintings(entries, {"spines/painting/one"}), (["Spines/painting/two"], ["Spines/painting/two_hx"]))
    def test_prefabs_and_story_cg_keep_catalogue_resource_keys(self):
        prefix = "package/files/vercache_demo/spines/"
        self.assertEqual(spine_key(prefix + "painting/301619402_spine_hx/spineaniprefab.data"), "Spines/painting/301619402_spine_hx")
        self.assertEqual(spine_key(prefix + "story/example/ui_example_skeletondata.data"), "Spines/story/example")
        self.assertEqual(spine_key(prefix + "storycg/2_8_l_hx/2_8_l.data"), "Spines/storyCG/2_8_l_hx/2_8_l")

    def test_obvious_dependencies_are_not_standalone_presentations(self):
        prefix = "package/files/vercache_demo/spines/story/example/"
        for name in ["example.atlas", "example.skel", "example_atlas", "example_material"]:
            self.assertIsNone(spine_key(prefix + name + ".data"))
        self.assertIsNone(spine_key("package/files/vercache_demo/sound/example.data"))

    def test_resource_paths_reject_traversal_and_platform_escapes(self):
        prefix = "package/files/vercache_demo/spines/"
        for path in ["../example.data", "painting/../example.data", "painting//example.data", "painting/./example.data", "painting\\example.data", "C:/example.data"]:
            with self.assertRaises(ValueError):
                spine_key(prefix + path)

    def test_original_decoder_only_changes_the_known_prefix(self):
        plain = b"UnityFS" + bytes(range(256)) * 5
        encoded = bytes(value ^ 0x7B if index < 1000 else value for index, value in enumerate(plain))
        self.assertEqual(decode_bundle(encoded), plain)
        self.assertEqual(decode_bundle(plain), plain)
        with self.assertRaises(ValueError):
            decode_bundle(b"unsupported")


if __name__ == "__main__":
    unittest.main()
