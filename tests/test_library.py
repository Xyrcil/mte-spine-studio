import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from build_library import join_portraits, hot_spring_roles, join_hot_springs, hot_spring_houses, skill_role_bindings, skill_stand_transforms


class PortraitLibraryTests(unittest.TestCase):
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
