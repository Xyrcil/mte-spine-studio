import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from build_library import join_portraits


class PortraitLibraryTests(unittest.TestCase):
    def test_static_preview_preserves_missing_spine_status(self):
        rows = [{"id": "role", "bundle": "Spines/painting/role", "status": "not-extracted", "portraitResource": "UI/Image/lihui/role"}]
        sprite = {"id": "1", "name": "role", "path": "portraits/role/1.png"}
        join_portraits(rows, [{"resource": "UI/Image/lihui/role", "sprites": [sprite]}], set(), {})
        self.assertEqual(rows[0]["displayKind"], "static-preview")
        self.assertEqual(rows[0]["spineStatus"], "missing-source")
        self.assertEqual(rows[0]["portrait"], sprite)

    def test_orphan_images_remain_available_without_inventing_spine(self):
        rows = []
        join_portraits(rows, [{"resource": "UI/Image/lihui/npc", "sprites": [{"id": "1", "name": "npc"}]}], set(), {})
        self.assertEqual(rows[0]["displayKind"], "static")
        self.assertEqual(rows[0]["spineStatus"], "not-configured")
        self.assertIsNone(rows[0]["characterId"])

    def test_ambiguous_sprite_bundle_is_not_resolved_by_arbitrary_first_image(self):
        rows = [{"bundle": "Spines/story/role", "status": "available", "portraitResource": "UI/Image/lihui/role"}]
        join_portraits(rows, [{"resource": "UI/Image/lihui/role", "sprites": [{"id": "1", "name": "a"}, {"id": "2", "name": "b"}]}], set(), {})
        self.assertNotIn("portrait", rows[0])
        self.assertEqual(rows[0]["spineStatus"], "available")


if __name__ == "__main__":
    unittest.main()
