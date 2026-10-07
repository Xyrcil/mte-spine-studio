import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from source_archive import spine_key, decode_bundle


class SourceArchiveTests(unittest.TestCase):
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
