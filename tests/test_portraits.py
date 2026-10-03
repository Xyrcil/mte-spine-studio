import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import extract_portraits


class PortraitMetadataTests(unittest.TestCase):
    def test_metadata_refresh_keeps_media_paths_without_decoding_or_writing_images(self):
        sprite = SimpleNamespace(m_Rect=SimpleNamespace(x=0, y=0, width=500, height=800))
        reader = SimpleNamespace(type=SimpleNamespace(name="Sprite"), path_id=12,
                                 read=lambda: sprite, read_typetree=lambda: {})
        old = {"id": "12", "path": "portraits/12.png", "width": 300, "height": 400,
               "pixelsPerUnit": 50, "thumbnail": "portraits/12.webp"}
        content = {"x": 25, "y": 50, "width": 300, "height": 400}
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory) / "source.dat"
            bundle.write_bytes(b"UnityFS")
            output = Path(directory) / "output"
            unity = SimpleNamespace(load=lambda raw: SimpleNamespace(objects=[reader]))
            with patch.object(extract_portraits, "UnityPy", unity, create=True), patch.object(extract_portraits, "sprite_content_rect", return_value=content):
                result = extract_portraits.extract(("UI/Image/lihui/12", str(bundle), None, str(output), {"sprites": [old]}))
                self.assertFalse(output.exists())
                self.assertEqual(result["errors"], [])
                self.assertEqual(result["sprites"], [{**old, "rect": {"x": 0, "y": 0, "width": 500, "height": 800}, "contentRect": content}])
                self.assertNotIn("rect", old)
                rejected = extract_portraits.extract(("UI/Image/lihui/12", str(bundle), None, str(output), {"sprites": []}))
                self.assertEqual(rejected["sprites"], [])
                self.assertIn("existing portrait", rejected["errors"][0]["error"])


if __name__ == "__main__":
    unittest.main()
