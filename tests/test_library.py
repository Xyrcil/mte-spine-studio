import sys
import unittest
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from build_library import join_portraits, hot_spring_roles, join_hot_springs, hot_spring_houses, skill_role_bindings, skill_stand_transforms, preview_stands, station_drawing_catalogue, main_view_voice_catalogue, hot_spring_speech_catalogue, chinese_caption_policy
from build_library import join_artwork_variants, join_cg_variants, story_roles_by_resource


class PortraitLibraryTests(unittest.TestCase):
    def test_plot_roles_match_original_mixed_case_resource_directories(self):
        row = {"Id": "skin", "RoleId": "actor", "PlotPic": "example_ZDYS/ui_example_SkeletonData"}
        self.assertEqual(story_roles_by_resource([row, {"PlotPic": "0"}, {}]), {"example_zdys": row})
    def test_cg_variants_use_declared_resource_pairs_without_guessing_paths(self):
        parent = {"id": "cg", "bundle": "Spines/storyCG/FAMILY/asset", "kind": "storyCG", "name": "Original CG"}
        variant = {"id": "hx", "bundle": "Spines/storyCG/family_hx/asset_hx"}
        unknown = {"id": "unknown", "bundle": "Spines/storyCG/other_hx/asset"}
        join_cg_variants([parent, variant, unknown], [{"Resources": parent["bundle"], "Resources_Hx": "Spines/storyCG/FAMILY_hx/asset_hx"}])
        self.assertEqual(variant["variantOf"], "cg")
        self.assertEqual(variant["name"], "Original CG · HX variant")
        self.assertNotIn("variantOf", unknown)
    def test_hx_variants_join_only_an_existing_character_binding(self):
        parent = {"id": "skin", "characterId": "actor", "characterName": "Alice", "name": "Summer", "kind": "skin", "bundle": "Spines/painting/skin_spine", "portraitResource": "portrait"}
        before = deepcopy(parent)
        variant = {"id": "hx", "bundle": "Spines/painting/skin_spine_hx", "status": "available"}
        unknown = {"id": "unknown", "bundle": "Spines/painting/missing_spine_hx"}
        archived = {"id": "archive", "bundle": "Spines/painting/skin_spine_hx/archive-1", "sourceBundle": "Spines/painting/skin_spine_hx", "sourceVersion": 1}
        join_artwork_variants([parent, variant, unknown, archived])
        self.assertEqual(parent, before)
        self.assertEqual(variant["variantOf"], "skin")
        self.assertEqual(variant["characterId"], "actor")
        self.assertEqual(variant["kind"], "skin")
        self.assertEqual(variant["portraitResource"], "portrait")
        self.assertNotIn("variantOf", unknown)
        self.assertEqual(archived["variantOf"], "skin")
        self.assertEqual(archived["name"], "Summer · HX variant · Archive variant 1")
    def test_chinese_caption_policy_exposes_only_required_configuration(self):
        result = chinese_caption_policy([{"id": 9991139, "int_value": 3, "string_value": "[3016119,3016049,3014019]", "private": "Excluded"}])
        self.assertEqual(result, {"schema": 1, "players": [3016119, 3016049, 3014019], "duration": 3})
        self.assertEqual(chinese_caption_policy([])["players"], [])
        with self.assertRaises(ValueError):
            chinese_caption_policy([{"id": 9991139, "int_value": -1, "string_value": "[3016119]"}])
    def test_source_hot_spring_speech_requires_membership_and_preserves_tiers_and_first_visible_subtitle(self):
        result = hot_spring_speech_catalogue([{"id": 12, "gospel_id": 2}, {"id": 14, "gospel_id": 4}], [{"id": 12, "hs_phonetics_unlock": "a,b;c"}, {"id": 13, "hs_phonetics_unlock": "excluded"}], [{"file_name": "a", "show_type": 0, "voice_text": "Hidden"}, {"file_name": "a", "show_type": 1, "voice_text": "First"}, {"file_name": "a", "show_type": 1, "voice_text": "Second"}])
        self.assertEqual(result["profiles"], [{"id": "12", "roleId": "2", "tiers": [["a", "b"], ["c"]]}, {"id": "14", "roleId": "4", "tiers": []}])
        self.assertEqual([row["resourceName"] for row in result["voices"]], ["a", "b", "c"])
        self.assertEqual(result["voices"][0]["text"], "First")
        self.assertEqual(result["voices"][1]["subtitleStatus"], "missing")
        self.assertTrue(all(row["exactResource"] for row in result["voices"]))

    def test_main_view_voice_catalogue_retains_original_type_and_exact_source_without_private_fields(self):
        def row(identifier, resource, kind):
            return {"id": identifier, "target_id": 7, "file_name": resource, "type": kind,
                    "voice_title": "Original title", "voice_text": "Original subtitle", "source": "/private/archive", "hash": "private"}
        result = main_view_voice_catalogue([row(1, "Voice_7_Touch_Head", 3), row(2, "Voice_7_Greetings_Idel_01", 0), row(3, "Voice_7_Login", 0)])
        self.assertEqual(result["touchType"], 3)
        self.assertEqual([voice["id"] for voice in result["voices"]], ["1", "2"])
        self.assertEqual(result["voices"][0]["type"], 3)
        self.assertTrue(all(voice["exactResource"] for voice in result["voices"]))
        self.assertTrue(all("source" not in voice and "hash" not in voice for voice in result["voices"]))

    def test_main_view_caption_visibility_and_touch_rules_follow_source_fields(self):
        rows = [{"id": 1, "target_id": 7, "file_name": "line", "type": 3, "voice_title": "Title", "voice_text": "Hidden", "show_type": 0},
                {"id": 2, "target_id": 7, "file_name": "line", "type": 4, "voice_title": "Title", "voice_text": "First visible", "show_type": 1},
                {"id": 3, "target_id": 7, "file_name": "line", "type": 0, "voice_title": "Title", "voice_text": "Later", "show_type": 1}]
        result = main_view_voice_catalogue(rows, [{"id": 7, "spine_touch": 1}], {"2", "3"})
        self.assertEqual(result["captions"], {"line": "First visible"})
        self.assertEqual(result["touchRules"], [{"id": "7", "spineTouch": 1}])
        self.assertEqual([voice["id"] for voice in result["stationVoices"]], ["2"])

    def test_station_drawings_merge_by_id_and_keep_exact_pairs_without_private_metadata(self):
        old = {"id": 1, "drawing": "old", "action_list": "old"}
        row = {"id": 1, "drawing": "new", "people_id": 3, "expression": "smile", "action_list": "touch;sigh", "expression_list": "happy;sad", "voice_list": "12;13", "source": "/private/account", "hash": "private"}
        entry = {"id": "asset", "name": "new_SkeletonData", "bundle": "Spines/story/new", "status": "parsed", "animations": [{"name": name} for name in ("stand", "smile", "touch", "sigh", "happy", "sad")]}
        result = station_drawing_catalogue([("legacy", [old]), ("archive", [row])], [entry])
        self.assertEqual(len(result["drawings"]), 1)
        drawing = result["drawings"][0]
        self.assertEqual(drawing["origin"], "archive")
        self.assertEqual(drawing["peopleId"], "3")
        self.assertEqual(drawing["pairs"], [{"action": "touch", "expression": "happy"}, {"action": "sigh", "expression": "sad"}])
        self.assertEqual(drawing["voiceIds"], ["12", "13"])
        self.assertEqual(drawing["skeleton"], {"bundle": "Spines/story/new", "id": "asset"})
        self.assertEqual(drawing["interactionStatus"], "configured")
        self.assertEqual(drawing["missingAnimations"], [])
        self.assertNotIn("source", drawing)
        self.assertNotIn("hash", drawing)
        self.assertEqual(row["source"], "/private/account")

    def test_station_drawings_do_not_guess_resources_pairs_or_missing_animations(self):
        row = {"id": 1, "drawing": "original", "expression": "smile", "action_list": "touch;sigh", "expression_list": "happy"}
        entry = {"id": "asset", "name": "original_SkeletonData", "bundle": "Spines/story/original", "status": "parsed", "animations": [{"name": "touch"}]}
        drawing = station_drawing_catalogue([("legacy", [row])], [entry])["drawings"][0]
        self.assertEqual(drawing["pairs"][1]["expression"], None)
        self.assertEqual(drawing["missingAnimations"], ["stand", "happy", "sigh", "smile"])
        self.assertEqual(drawing["interactionStatus"], "unavailable")
        for entries in ([{**entry, "name": "original_extra_SkeletonData"}], [entry, {**entry, "id": "other"}]):
            unavailable = station_drawing_catalogue([("legacy", [row])], entries)["drawings"][0]
            self.assertIsNone(unavailable["skeleton"])
            self.assertEqual(unavailable["interactionStatus"], "unavailable")

    def test_station_drawings_without_actions_stay_noninteractive_and_validate_idle(self):
        row = {"id": 1, "drawing": "original", "expression": "smile"}
        entry = {"id": "asset", "name": "original_SkeletonData", "bundle": "Spines/story/original", "status": "parsed", "animations": [{"name": "stand"}, {"name": "smile"}]}
        drawing = station_drawing_catalogue([("legacy", [row])], [entry])["drawings"][0]
        self.assertEqual(drawing["interactionStatus"], "not-configured")
        self.assertEqual(drawing["pairs"], [])
        broken = station_drawing_catalogue([("legacy", [row])], [{**entry, "animations": []}])["drawings"][0]
        self.assertEqual(broken["missingAnimations"], ["stand", "smile"])
        self.assertEqual(broken["interactionStatus"], "unavailable")

    def test_preview_stands_keep_authored_placement_separate_from_portrait_offsets(self):
        configs={"GospelCultivateStandConfig":{"skin":{"posSpine":{"x":.177,"y":.005,"z":-25},"scaleSpine":{"x":.185,"y":.185,"z":.185},"pos2D":{"x":99,"y":99},"Offset":1.1},"empty":{},"zero":{"posSpine":{"x":0,"y":0},"scaleSpine":{"x":0,"y":0}}}}
        rows=preview_stands(configs,"archive")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["id"],"skin")
        self.assertEqual(rows[0]["origin"],"archive")
        self.assertEqual(rows[0]["position"]["x"],.177)
        self.assertEqual(rows[0]["scale"]["x"],.185)
        self.assertEqual(rows[0]["offset"],1.1)

    def test_skill_emblems_use_original_id_boundary_custom_badge_and_parent_fallback(self):
        rows = skill_role_bindings([{"id": 1}, {"id": 6}], [{"id": 10}, {"id": 11}], {},
                                   [{"id": 100, "gospel_id": 10, "badge": "custom"}, {"id": 101, "gospel_id": 11, "badge": ""}], [])
        by_id = {row["id"]: row for row in rows}
        self.assertEqual(by_id["1"]["emblemResource"], "UI/Image/Icon/Badge/1_huizhang-bai")
        self.assertEqual(by_id["6"]["emblemScale"], .7)
        self.assertEqual(by_id["10"]["emblemResource"], "UI/Image/wenzhang/wenzhang_10_icon")
        self.assertEqual(by_id["100"]["emblemResource"], "UI/Image/wenzhang/custom")
        self.assertEqual(by_id["101"]["emblemResource"], "UI/Image/wenzhang/wenzhang_11_icon")
        self.assertEqual(by_id["101"]["emblemScale"], 1)

    def test_skill_emblem_sprites_do_not_become_gallery_portraits(self):
        rows = []
        join_portraits(rows, [{"resource": "UI/Image/Icon/Badge", "usage": "skill-emblem", "sprites": [{"id": "1", "name": "badge"}]}], set(), {})
        self.assertEqual(rows, [])

    def test_skills_use_explicit_role_and_skin_references_and_retain_missing_ids(self):
        rows = skill_role_bindings([{"id": 1, "skill": "[11,12]", "skill_normal": 11, "skill_qte": 13, "skill_ub": "14,12"}], [{"id": 2, "skill": "[21]"}], {"11": {}, "12": {}, "14": {}, "21": {}}, [{"id": 99, "gospel_id": 2}], [{"id": 100, "people_id": 1}, {"id": 101, "gospel_id": 999}])
        self.assertEqual(rows[0]["skillIds"], ["11", "12", "13", "14"])
        self.assertEqual(rows[0]["missingSkillIds"], ["13"])
        self.assertEqual(rows[2]["parentId"], "2")
        self.assertEqual(rows[3]["skillIds"], rows[0]["skillIds"])
        self.assertNotIn("101", [row["id"] for row in rows])

    def test_main_stands_combine_authored_management_offsets_and_preserve_source_gaps(self):
        main = {"1": {"pos2D": {"x": .8}, "scale2D": {"x": 2}}, "2": {}, "3": {}, "4": {}}
        witch = {"1": {"pos2D": {"x": -.7, "y": .09}, "scale2D": {"x": .2}}, "3000001": {"scale2D": {"x": .1}}}
        gospel = {"2": {"pos2D": {"y": .3}}}
        rows = skill_stand_transforms(main, witch, gospel, [{"id": 1}], [{"id": 3, "people_id": 1}])
        self.assertAlmostEqual(rows[0]["position"]["x"], .1)
        self.assertEqual(rows[0]["scale"]["x"], .4)
        self.assertEqual(rows[1]["position"]["y"], .3)
        self.assertEqual(rows[2]["scale"]["x"], .1)
        self.assertEqual(rows[3]["status"], "missing-management-config")
        with self.assertRaisesRegex(ValueError, "transform"):
            skill_stand_transforms({"1": {"scale2D": {"x": float("nan")}}}, witch, gospel, [{"id": 1}], [])

    def test_hot_spring_focus_retains_source_coordinates_and_zoom(self):
        role = hot_spring_roles([{"Id": "1", "Skin": "skin", "Spine": "onsen", "ConversationPos": "-56,-163", "ConversationZoom": "162"}], [])[0]
        self.assertEqual(role["focus"], {"position": [-56, -163], "zoom": 1.62})
    def test_hot_spring_house_uses_source_roles_and_percentage_zoom(self):
        house = hot_spring_houses([{"Id": "house", "Gospels": "1, 2", "BgOffset": "16,197", "BgDefaulltZoom": "50", "BgZoomRange": "50,150", "Bgm": "music"}])[0]
        self.assertEqual(house["roleIds"], ["1", "2"])
        self.assertEqual(house["defaultZoom"], .5)
        self.assertEqual(house["zoomRange"], [.5, 1.5])
        self.assertEqual(house["backgroundOffset"], [16, 197])
    def test_hot_spring_pools_preserve_order_missing_references_and_source_levels(self):
        roles = hot_spring_roles([{"Id": "1", "Skin": "skin", "Spine": "onsen_spine", "SpineSound": "water"}], [{"id": "1", "level": "2", "Conversation": "12, 11,missing"}, {"id": "1", "level": "1", "Conversation": "11"}, {"id": "other", "level": "1", "Conversation": "99"}])
        self.assertEqual([pool["level"] for pool in roles[0]["levels"]], [1, 2])
        self.assertEqual(roles[0]["levels"][1]["voiceIds"], ["12", "11", "missing"])
        rows = [{"bundle": "Spines/painting/onsen_spine"}, {"bundle": "Spines/painting/onsen_spine_hx"}, {"bundle": "Spines/painting/unknown"}]
        join_hot_springs(rows, roles, {"1": "Character"})
        self.assertEqual(rows[0]["hotSpringRoleId"], "1")
        self.assertEqual(rows[1]["characterName"], "Character")
        self.assertNotIn("characterId", rows[2])
        self.assertNotIn("ambientSound", rows[0])

    def test_static_preview_preserves_missing_spine_status(self):
        rows = [{"id": "role", "bundle": "Spines/painting/role", "status": "not-extracted", "portraitResource": "UI/Image/lihui/role"}]
        sprite = {"id": "1", "name": "role", "path": "portraits/role/1.png"}
        join_portraits(rows, [{"resource": "UI/Image/lihui/role", "sprites": [sprite]}], set(), {})
        self.assertEqual(rows[0]["displayKind"], "static-preview")
        self.assertEqual(rows[0]["spineStatus"], "missing-source")
        self.assertEqual(rows[0]["portrait"], sprite)

    def test_unassigned_source_templates_remain_visible_without_claiming_available_artwork(self):
        rows=[{"id":"template","bundle":"Spines/drawing","status":"unassigned"}]
        join_portraits(rows,[],{"Spines/drawing"},{})
        self.assertEqual(rows[0]["spineStatus"],"unassigned")
        self.assertEqual(rows[0]["displayKind"],"missing")

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
