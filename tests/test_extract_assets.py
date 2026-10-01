import struct
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import unittest
from tools.extract_assets import BundleExtractor, atlas_pages, binary_strings, precise_references, write_json
from tools.inspect_effects import inspect


class ExtractionTests(unittest.TestCase):
    def test_binary_header_uses_spine_strings_and_big_endian_bounds(self):
        data = bytes([5]) + b"hash" + bytes([7]) + b"3.8.99" + struct.pack(">ffff", -12, -25, 300, 600)
        self.assertEqual(binary_strings(data), ("3.8.99", [-12, -25, 300, 600]))

    def test_pages_are_distinct_from_regions(self):
        text = "\nfirst.png\nsize: 100,200\nregion\n  xy: 0,0\n\nsecond.png\nsize: 10,20\nregion-2\n  xy: 0,0\n"
        self.assertEqual(atlas_pages(text), ["first.png", "second.png"])

    def test_unity_reference_ids_preserve_integer_precision(self):
        self.assertEqual(precise_references({"m_PathID": 9223372036854775807, "x": 1}), {"m_PathID": "9223372036854775807", "x": 1})

    def test_curve_infinities_are_explicit_strings_in_strict_json(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "curve.json"
            write_json(path, {"inSlope": float("inf"), "outSlope": -float("inf"), "unknown": float("nan")})
            result = json.loads(path.read_text(), parse_constant=lambda value: self.fail(value))
            self.assertEqual(result, {"inSlope": "Infinity", "outSlope": "-Infinity", "unknown": "NaN"})

    def test_particle_extraction_retains_sprite_wrappers_null_slots_and_material_textures(self):
        pointer = lambda number: {"m_FileID": 0, "m_PathID": number}
        image = SimpleNamespace(width=12, height=18, save=Mock())
        rows = {}
        def reader(number, kind, tree, value=None):
            result = SimpleNamespace(path_id=number, assets_file="bundle", type=SimpleNamespace(name=kind), read_typetree=lambda: tree, read=lambda: value)
            rows[number] = result
            return result
        objects = [reader(1, "GameObject", {"m_Name": "Test particles"}), reader(2, "ParticleSystem", {"m_GameObject": pointer(1), "InitialModule": {"enabled": True}, "UVModule": {"sprites": [{"sprite": pointer(6)}, {"sprite": pointer(0)}]}}), reader(3, "ParticleSystemRenderer", {"m_GameObject": pointer(1), "m_Enabled": True, "m_Materials": [pointer(4)]}), reader(4, "Material", {"m_Shader": pointer(5), "m_SavedProperties": {"m_TexEnvs": [("_MainTex", {"m_Texture": pointer(7)})]}}), reader(5, "Shader", {"m_Name": "Test/Particle"}), reader(6, "Sprite", {"m_Pivot": {"x": .5, "y": .5}, "m_Rect": {"width": 12, "height": 18}, "m_PixelsToUnits": 100}, SimpleNamespace(image=image)), reader(7, "Texture2D", {}, SimpleNamespace(m_Width=12, m_Height=18, image=image))]
        with tempfile.TemporaryDirectory() as folder:
            extractor = BundleExtractor(SimpleNamespace(objects=objects), Path(folder))
            extractor.resolve = lambda owner, reference: rows[reference["m_PathID"]]
            effect = extractor.extract_effects()[0]
            self.assertEqual(effect["status"], "extracted")
            self.assertEqual(effect["data"]["m_GameObject"]["m_PathID"], "1")
            self.assertEqual(effect["materials"][0]["shader"], "Test/Particle")
            self.assertEqual(effect["materials"][0]["textures"]["_MainTex"]["path"], "effects/textures/7.png")
            self.assertEqual(len(effect["sprites"]), 1)
            self.assertEqual(effect["sprites"][0]["pixelsPerUnit"], 100)
            self.assertEqual(image.save.call_count, 2)
        audit = inspect(SimpleNamespace(objects=objects))
        self.assertEqual(audit["types"]["ParticleSystem"], 1)
        self.assertEqual(len(audit["components"]), 2)
        self.assertEqual(audit["errors"], [])


if __name__ == "__main__":
    unittest.main()
