import struct
import unittest
from tools.extract_assets import atlas_pages, binary_strings, precise_references


class ExtractionTests(unittest.TestCase):
    def test_binary_header_uses_spine_strings_and_big_endian_bounds(self):
        data = bytes([5]) + b"hash" + bytes([7]) + b"3.8.99" + struct.pack(">ffff", -12, -25, 300, 600)
        self.assertEqual(binary_strings(data), ("3.8.99", [-12, -25, 300, 600]))

    def test_pages_are_distinct_from_regions(self):
        text = "\nfirst.png\nsize: 100,200\nregion\n  xy: 0,0\n\nsecond.png\nsize: 10,20\nregion-2\n  xy: 0,0\n"
        self.assertEqual(atlas_pages(text), ["first.png", "second.png"])

    def test_unity_reference_ids_preserve_integer_precision(self):
        self.assertEqual(precise_references({"m_PathID": 9223372036854775807, "x": 1}), {"m_PathID": "9223372036854775807", "x": 1})


if __name__ == "__main__":
    unittest.main()
