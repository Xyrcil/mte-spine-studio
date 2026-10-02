import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from tools.extract_fonts import font_format, font_asset_entries, line_breaking_rules, native_font_entry


class OriginalFontTests(unittest.TestCase):
    def test_native_fonts_retain_resolved_serialized_file_identity_and_original_metrics(self):
        reader = SimpleNamespace(path_id=-6600258720009304763, assets_file=SimpleNamespace(name="original-font-file"))
        values = {"m_Name": "PERTIBD", "m_FontSize": 16, "m_Ascent": 12, "m_Descent": -4, "m_LineSpacing": 19.25, "m_Tracking": 1, "m_CharacterSpacing": 0, "m_DefaultStyle": 0, "m_ShouldRoundAdvanceValue": True, "m_FontNames": ["PERTIBD", "Perpetua Titling MT"]}
        row = native_font_entry(reader, SimpleNamespace(**values), {"path": "spines/interfaces/fonts/PERTIBD.ttf", "format": "ttf", "bytes": 39344})
        self.assertEqual(row["assetId"], "-6600258720009304763")
        self.assertEqual(row["serializedFile"], "original-font-file")
        self.assertEqual(row["metrics"]["m_LineSpacing"], 19.25)
        self.assertTrue(row["metrics"]["m_ShouldRoundAdvanceValue"])
        self.assertEqual(row["path"], "spines/interfaces/fonts/PERTIBD.ttf")

    def test_original_font_headers_do_not_accept_arbitrary_resource_files(self):
        self.assertEqual(font_format(b"OTTO" + bytes(8)), "otf")
        self.assertEqual(font_format(b"\x00\x01\x00\x00" + bytes(8)), "ttf")
        for data in [b"OTTO", b"UnityFS" + bytes(8), b"ttcf" + bytes(8)]:
            with self.assertRaises(ValueError):
                font_format(data)

    def test_tmp_assets_bind_exact_font_names_and_retain_metrics_and_fallback_references(self):
        assets = [(9223372036854775807, {"m_Name": "SOURCE", "m_FaceInfo": {"m_PointSize": 80}, "m_CharacterTable": [{"m_Unicode": 33}], "m_FallbackFontAssetTable": [{"m_PathID": -123}, {"m_PathID": 0}]}), (2, {"m_Name": "not-extracted"})]
        files = {"SOURCE": {"path": "spines/interfaces/fonts/SOURCE.otf", "format": "otf", "bytes": 14}}
        rows = font_asset_entries(assets, files)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["assetId"], "9223372036854775807")
        self.assertEqual(rows[0]["characters"], [33])
        self.assertEqual(rows[0]["fallbacks"], ["-123"])
        self.assertEqual(rows[0]["face"]["m_PointSize"], 80)

    def test_line_rules_are_read_from_named_original_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / "apk-data-full/assets/bin/Data"
            data.mkdir(parents=True)
            readers = []
            for name, text in [("LineBreaking Leading Characters", "（「\\"), ("LineBreaking Following Characters", "，。）」")]:
                asset = SimpleNamespace(m_Name=name, m_Script=text)
                readers.append(SimpleNamespace(type=SimpleNamespace(name="TextAsset"), peek_name=lambda asset=asset: asset.m_Name, read=lambda asset=asset: asset))
            (data / "original-bundle").touch()
            unity = SimpleNamespace(load=lambda path: SimpleNamespace(objects=readers))
            self.assertEqual(line_breaking_rules(root, unity), {"leading": "（「\\", "following": "，。）」"})
            readers.pop()
            with self.assertRaisesRegex(ValueError, "unavailable"):
                line_breaking_rules(root, unity)
