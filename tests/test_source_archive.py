import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from source_archive import spine_key, decode_bundle, missing_paintings, sanitize_diagnostics, source_versions


class SourceArchiveTests(unittest.TestCase):
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
