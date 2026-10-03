import struct
import argparse
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import unittest
from tools.extract_assets import BundleExtractor, atlas_pages, binary_strings, precise_references, write_json, shader_render_queue, resource_bundle_key, sprite_content_rect
from tools.inspect_effects import inspect


class ExtractionTests(unittest.TestCase):
    def test_unity_text_fonts_resolve_external_pointers_before_export(self):
        assets_file = SimpleNamespace(name="text-file")
        reader = SimpleNamespace(path_id=1, assets_file=assets_file, type=SimpleNamespace(name="MonoBehaviour"), read_typetree=lambda: {"m_FontData": {"m_Font": {"m_FileID": 2, "m_PathID": -99}}})
        font = SimpleNamespace(path_id=-99, assets_file=SimpleNamespace(name="font-file"), type=SimpleNamespace(name="Font"))
        with tempfile.TemporaryDirectory() as directory:
            extractor = BundleExtractor(SimpleNamespace(objects=[reader]), Path(directory))
            extractor.resolve = lambda owner, pointer: font
            result = extractor.extract()
            rows = json.loads((Path(directory) / "hierarchy.json").read_text())
            self.assertEqual(rows[0]["fontReference"], {"assetId": "-99", "serializedFile": "font-file"})
            self.assertEqual(result["errors"], [])
            font.type.name = "Texture2D"
            result = extractor.extract()
            self.assertEqual(result["errors"][0]["type"], "FontReference")
            self.assertNotIn("fontReference", json.loads((Path(directory) / "hierarchy.json").read_text())[0])

    def test_sprite_bounds_use_atlas_offsets_and_unrotate_packed_dimensions(self):
        render = {"textureRect": {"width": 205, "height": 243}, "textureRectOffset": {"x": 4, "y": 24}, "settingsRaw": 17}
        atlas = SimpleNamespace(m_RenderDataMap=[("key", render)])
        sprite = SimpleNamespace(m_RD={}, m_RenderDataKey="key", m_SpriteAtlas=SimpleNamespace(deref_parse_as_object=lambda: atlas))
        self.assertEqual(sprite_content_rect(sprite, {}), {"x": 4, "y": 24, "width": 243, "height": 205})
        sprite.m_SpriteAtlas = None
        sprite.m_AtlasTags = ["Onsen"]
        sprite.assets_file = SimpleNamespace(objects={1: SimpleNamespace(type=SimpleNamespace(name="SpriteAtlas"), peek_name=lambda: "Onsen", read=lambda: atlas)})
        self.assertEqual(sprite_content_rect(sprite, {}), {"x": 4, "y": 24, "width": 243, "height": 205})
        sprite.assets_file.objects = {}
        with self.assertRaisesRegex(ValueError, "atlas bounds"):
            sprite_content_rect(sprite, {})
        self.assertIsNone(sprite_content_rect(SimpleNamespace(), {}))

    def test_explicit_bundle_names_cannot_escape_resource_roots(self):
        self.assertEqual(resource_bundle_key("UI/Prefab/Onsen"), "UI/Prefab/Onsen")
        for key in ("", "/tmp/bundle", "../bundle", "UI/../bundle", "UI//bundle", "UI/./bundle", "UI\\bundle", "C:/bundle"):
            with self.assertRaises(argparse.ArgumentTypeError):
                resource_bundle_key(key)

    def test_animator_controllers_and_overrides_are_retained_with_clip_references(self):
        kinds = ("Animator", "AnimatorController", "AnimatorOverrideController", "AnimationClip")
        rows = [SimpleNamespace(path_id=i, assets_file="bundle", type=SimpleNamespace(name=kind), read_typetree=lambda i=i: {"m_Name": kinds[i], "m_Controller": {"m_FileID": 0, "m_PathID": 9223372036854775807}}) for i, kind in enumerate(kinds)]
        with tempfile.TemporaryDirectory() as folder:
            extractor = BundleExtractor(SimpleNamespace(objects=rows), Path(folder))
            extractor.extract()
            hierarchy = json.loads((Path(folder) / "hierarchy.json").read_text())
            self.assertEqual([row["type"] for row in hierarchy], list(kinds))
            self.assertTrue(all(row["data"]["m_Controller"]["m_PathID"] == "9223372036854775807" for row in hierarchy))

    def test_shader_queue_tags_preserve_offsets_and_unknown_defaults(self):
        shader = lambda tag: {"m_ParsedForm": {"m_SubShaders": [{"m_Tags": {"tags": [("QUEUE", tag)]}}]}}
        self.assertEqual(shader_render_queue(shader("Transparent")), 3000)
        self.assertEqual(shader_render_queue(shader("Transparent+4")), 3004)
        self.assertEqual(shader_render_queue(shader("AlphaTest-1")), 2449)
        self.assertIsNone(shader_render_queue(shader("Unknown")))
        self.assertIsNone(shader_render_queue({}))

    def test_skeleton_material_bindings_match_original_page_names_after_browser_renaming(self):
        pointer = lambda value: {"m_FileID": 0, "m_PathID": value}
        rows = {}
        def reader(number, tree, value=None):
            item = SimpleNamespace(path_id=number, assets_file="bundle", read_typetree=lambda: tree, read=lambda: value)
            rows[number] = item
            return item
        owner = reader(1, {"atlasAssets": [pointer(2)], "blendModeMaterials": {"additiveMaterials": [{"pageName": "original.png", "material": pointer(5)}]}})
        reader(2, {"atlasFile": pointer(3), "materials": [pointer(4)]})
        reader(3, {}, SimpleNamespace(m_Script="original.png\nsize: 20,20\nregion\n  xy: 0,0\n"))
        reader(4, {"m_CustomRenderQueue": 3005, "m_Shader": pointer(6), "m_ShaderKeywords": "_STRAIGHT_ALPHA_INPUT"})
        reader(5, {"m_CustomRenderQueue": 3000, "m_Shader": pointer(7), "m_ValidKeywords": ["_STRAIGHT_ALPHA_INPUT"], "m_SavedProperties": {"m_Colors": [("_Color", {"r": 4, "g": 4, "b": 4, "a": 1})], "m_Floats": [("_BloomFacter", 0)]}})
        reader(6, {"m_ParsedForm": {"m_Name": "Spine/Skeleton"}})
        reader(7, {"m_ParsedForm": {"m_Name": "Spine/Blend Modes/Skeleton PMA Additive"}})
        with tempfile.TemporaryDirectory() as folder:
            extractor = BundleExtractor(SimpleNamespace(objects=[]), Path(folder))
            extractor.resolve = lambda owner, reference: rows[reference["m_PathID"]]
            result = extractor.skeleton_materials(owner)
            self.assertEqual(result["errors"], [])
            page = result["pages"][0]
            self.assertEqual((page["atlas"], page["page"], page["sourcePage"]), (0, "page-0.png", "original.png"))
            self.assertEqual(page["materials"]["normal"], {"id": "4", "renderQueue": 3005, "shader": "Spine/Skeleton", "keywords": ["_STRAIGHT_ALPHA_INPUT"], "properties": {}})
            self.assertEqual(page["materials"]["additive"], {"id": "5", "renderQueue": 3000, "shader": "Spine/Blend Modes/Skeleton PMA Additive", "keywords": ["_STRAIGHT_ALPHA_INPUT"], "properties": {"m_Colors": [["_Color", {"r": 4, "g": 4, "b": 4, "a": 1}]], "m_Floats": [["_BloomFacter", 0]]}})
            tree = rows[4].read_typetree()
            tree["m_ShaderKeywords"] = "_FLOW_MAP_ON _NOISE_TEX_ON"
            env = lambda number: {"m_Texture": pointer(number), "m_Scale": {"x": 9, "y": 7}, "m_Offset": {"x": .1, "y": .2}}
            tree["m_SavedProperties"] = {"m_TexEnvs": [("_FlowMap", env(8)), ("_NoiseTex", env(9)), ("_MaskTex", env(0))]}
            extractor.skeleton_texture = Mock(side_effect=lambda owner, reference, location, name: {"id": str(reference["m_PathID"]), "path": "materials/" + name + ".png"})
            result = extractor.skeleton_materials(owner, export_textures=True)
            profile = result["pages"][0]["materials"]["normal"]
            self.assertEqual(profile["textures"]["_NoiseTex"]["scale"], {"x": 9, "y": 7})
            self.assertEqual(profile["textures"]["_NoiseTex"]["offset"], {"x": .1, "y": .2})
            self.assertEqual(profile["textures"]["_MaskTex"], {"default": "white"})
            self.assertEqual(extractor.skeleton_texture.call_count, 2)
            self.assertEqual(extractor.skeleton_texture.call_args_list[0].args[:3], (rows[4], pointer(8), "1/atlas-0/page-0/normal"))
            extractor.skeleton_texture.reset_mock()
            retained = extractor.skeleton_materials(owner, previous=result)
            self.assertEqual(retained["pages"][0]["materials"]["normal"]["textures"], profile["textures"])
            extractor.skeleton_texture.assert_not_called()
            tree["m_ShaderKeywords"] = ""
            self.assertNotIn("textures", extractor.skeleton_materials(owner, previous=result)["pages"][0]["materials"]["normal"])
            tree["m_ShaderKeywords"] = "_FLOW_MAP_ON"
            extractor.skeleton_texture.side_effect = ValueError("Dependency unavailable")
            failed = extractor.skeleton_materials(owner, export_textures=True)
            self.assertEqual(failed["errors"], [])
            self.assertEqual(failed["pages"][0]["materials"]["normal"]["textureErrors"][0]["error"], "Texture dependency unavailable or could not be decoded")
            self.assertEqual(failed["pages"][0]["materials"]["normal"]["textureErrors"][0]["type"], "ValueError")

    def test_skeleton_textures_deduplicate_resolved_references_without_cross_file_path_collisions(self):
        images = [Mock(), Mock()]
        files = [SimpleNamespace(name="first"), SimpleNamespace(name="second")]
        readers = [SimpleNamespace(path_id=7, assets_file=file, read=lambda image=image: SimpleNamespace(image=image, m_Width=64, m_Height=32), read_typetree=lambda: {"m_TextureSettings": {"m_WrapU": 1}, "m_ColorSpace": 0}) for file, image in zip(files, images)]
        with tempfile.TemporaryDirectory() as folder:
            extractor = BundleExtractor(SimpleNamespace(objects=[]), Path(folder))
            extractor.resolve = lambda owner, pointer: readers[owner]
            first = extractor.skeleton_texture(0, {}, "first/normal", "_NoiseTex")
            self.assertEqual(extractor.skeleton_texture(0, {}, "duplicate/normal", "_NoiseTex"), first)
            second = extractor.skeleton_texture(1, {}, "second/normal", "_NoiseTex")
            self.assertNotEqual(first["path"], second["path"])
            self.assertEqual(first["settings"], {"m_WrapU": 1})
            self.assertEqual((first["width"], first["height"], first["colorSpace"]), (64, 32, 0))
            for image in images:
                image.save.assert_called_once()

    def test_renderer_queues_resolve_custom_values_and_shader_defaults_without_textures(self):
        pointer = lambda value: {"m_FileID": 0, "m_PathID": value}
        rows = {}
        def reader(number, kind, tree):
            value = SimpleNamespace(path_id=number, assets_file="bundle", type=SimpleNamespace(name=kind), read_typetree=lambda: tree)
            rows[number] = value
            return value
        renderer = reader(1, "MeshRenderer", {"m_GameObject": pointer(10), "m_Materials": [pointer(2), pointer(3)]})
        reader(2, "Material", {"m_CustomRenderQueue": 3004, "m_Shader": pointer(99)})
        reader(3, "Material", {"m_CustomRenderQueue": -1, "m_Shader": pointer(4)})
        reader(4, "Shader", {"m_ParsedForm": {"m_SubShaders": [{"m_Tags": {"tags": [("QUEUE", "Transparent")]}}]}})
        with tempfile.TemporaryDirectory() as folder:
            extractor = BundleExtractor(SimpleNamespace(objects=[renderer]), Path(folder))
            extractor.resolve = lambda owner, reference: rows[reference["m_PathID"]]
            record = extractor.extract_renderers()[0]
            self.assertEqual([material["renderQueue"] for material in record["materials"]], [3004, 3000])
            self.assertEqual(record["errors"], [])
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

    def test_ui_images_share_decoded_sprites_and_preserve_null_and_missing_resources(self):
        pointer = lambda number: {"m_FileID": 0, "m_PathID": number}
        image = SimpleNamespace(width=20, height=12, save=Mock())
        sprite = SimpleNamespace(path_id=6, assets_file="shared", read=lambda: SimpleNamespace(image=image), read_typetree=lambda: {"m_Pivot": {"x": .5, "y": .5}, "m_PixelsToUnits": 100})
        def component(number, resource):
            data = {"m_GameObject": pointer(number + 100), "m_Color": {"r": 1, "g": 1, "b": 1, "a": .5}, "m_Sprite": pointer(resource), "m_Material": pointer(0), "m_Type": 0}
            return SimpleNamespace(path_id=number, assets_file="bundle", type=SimpleNamespace(name="MonoBehaviour"), read_typetree=lambda: data)
        with tempfile.TemporaryDirectory() as folder:
            extractor = BundleExtractor(SimpleNamespace(objects=[component(1, 6), component(2, 6), component(3, 0), component(4, 99)]), Path(folder))
            def resolve(owner, reference):
                if reference["m_PathID"] != 6:
                    raise ValueError("Missing sprite")
                return sprite
            extractor.resolve = resolve
            rows = extractor.extract_images()
            self.assertEqual(image.save.call_count, 1)
            self.assertEqual(rows[0]["sprite"], rows[1]["sprite"])
            self.assertEqual(rows[0]["data"]["m_Color"]["a"], .5)
            self.assertEqual(rows[0]["gameObject"], "101")
            self.assertEqual(rows[2]["status"], "extracted")
            self.assertIsNone(rows[2]["sprite"])
            self.assertEqual(rows[3]["status"], "partial")
            self.assertEqual(rows[3]["errors"][0]["type"], "Sprite")

    def test_material_extraction_retains_variant_keywords_queue_and_disabled_passes(self):
        shader = SimpleNamespace(path_id=2, assets_file="shared", read_typetree=lambda: {"m_ParsedForm": {"m_Name": "Test/Masked"}})
        for extra, expected in [({"m_ShaderKeywords": "_MASK_ON _MASK_ON _OTHER"}, ["_MASK_ON", "_OTHER"]), ({"m_ValidKeywords": ["_MASK_ON"]}, ["_MASK_ON"])]:
            tree = {"m_Name": "Masked particles", "m_Shader": {"m_FileID": 0, "m_PathID": 2}, "m_CustomRenderQueue": 3001, "disabledShaderPasses": ["SHADOWCASTER"], "m_EnableInstancingVariants": True, "stringTagMap": [("RenderType", "Transparent")], "m_SavedProperties": {"m_TexEnvs": [], "m_Floats": [("_SrcBlend", 1), ("_DstBlend", 1)]}, **extra}
            material = SimpleNamespace(path_id=1, assets_file="bundle", read_typetree=lambda: tree)
            with tempfile.TemporaryDirectory() as folder:
                extractor = BundleExtractor(SimpleNamespace(objects=[]), Path(folder))
                extractor.resolve = lambda owner, reference: material if reference["m_PathID"] == 1 else shader
                result = extractor.effect_material(None, {"m_FileID": 0, "m_PathID": 1})
                self.assertEqual(result["keywords"], expected)
                self.assertEqual(result["renderQueue"], 3001)
                self.assertEqual(result["disabledPasses"], ["SHADOWCASTER"])
                self.assertEqual(result["tags"], [["RenderType", "Transparent"]])
                self.assertEqual(result["instancing"], True)
                self.assertNotIn("m_ParsedForm", result)


if __name__ == "__main__":
    unittest.main()
