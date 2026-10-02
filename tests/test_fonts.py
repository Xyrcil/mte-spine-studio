import unittest
from tools.extract_fonts import font_format, font_asset_entries


class OriginalFontTests(unittest.TestCase):
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
