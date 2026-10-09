"""Join character, appearance, and voice tables to extracted presentations."""
import argparse
import json
import math
from pathlib import Path
import sys
from extract_assets import write_json, load_decoder


def records(path):
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("records", data.get("rows", []))


def chinese_caption_policy(rows):
    row = next((row for row in rows if str(row["id"]) == "9991139"), None)
    if row is None:
        return {"schema": 1, "players": [], "duration": 0}
    players = json.loads(row["string_value"])
    duration = row["int_value"]
    if not isinstance(players, list) or any(type(value) is not int or value < -2147483648 or value > 2147483647 for value in players) or type(duration) is not int or not 0 <= duration <= 86400:
        raise ValueError("Invalid source Chinese caption policy")
    return {"schema": 1, "players": list(dict.fromkeys(players)), "duration": duration}


def main_view_voice_catalogue(rows, skins=(), station_ids=()):
    rows = list(rows)
    captions = {}
    for row in rows:
        if row.get("show_type") == 1:
            captions.setdefault(row["file_name"], row["voice_text"])
    result = []
    for row in rows:
        resource = row["file_name"]
        if row["type"] != 3 and not resource.endswith(("_Greetings_Idel_01", "_Greetings_Idel_02")):
            continue
        result.append({"id": str(row["id"]), "targetId": str(row["target_id"]),
                       "type": row["type"], "resourceName": resource,
                       "title": row["voice_title"], "text": row["voice_text"],
                       "exactResource": True})
    station = [{"id": str(row["id"]), "targetId": str(row["target_id"]), "type": row["type"],
                "resourceName": row["file_name"], "title": row["voice_title"], "text": row["voice_text"],
                "exactResource": True} for row in rows if str(row["id"]) in station_ids and row["type"] != 0]
    return {"schema": 1, "touchType": 3, "voices": result, "stationVoices": station,
            "captions": captions,
            "touchRules": [{"id": str(row["id"]), "spineTouch": int(row.get("spine_touch") or 0)} for row in skins]}


def hot_spring_speech_catalogue(houses, skins, voices):
    by_skin = {str(row["id"]): row for row in skins}
    subtitles = {}
    for row in voices:
        if row.get("show_type") == 1:
            subtitles.setdefault(row["file_name"], row["voice_text"])
    profiles, resources = [], {}
    for house in houses:
        identifier = str(house["id"])
        skin = by_skin.get(identifier)
        groups = (skin.get("hs_phonetics_unlock") or "").split(";") if skin else []
        tiers = [group.split(",") if group else [] for group in groups]
        profiles.append({"id": identifier, "roleId": str(house["gospel_id"]), "tiers": tiers})
        for group in tiers:
            for resource in group:
                resources.setdefault(resource, {"id": "favor:" + resource, "resourceName": resource,
                                               "title": resource, "text": subtitles.get(resource, ""),
                                               "exactResource": True, "subtitleStatus": "available" if resource in subtitles else "missing"})
    return {"profiles": profiles, "voices": list(resources.values())}


def station_drawing_catalogue(sources, entries):
    """Retain exact station drawing references without synthesizing interactions."""
    merged = {}
    for origin, rows in sources:
        for row in rows:
            merged[str(row["id"])] = (origin, row)
    by_name = {}
    for entry in entries:
        by_name.setdefault(entry.get("name"), []).append(entry)
    drawings = []
    for identifier, (origin, row) in merged.items():
        resource = row.get("drawing") or ""
        matches = by_name.get(resource + "_SkeletonData", []) if resource else []
        entry = matches[0] if len(matches) == 1 else None
        actions = (row.get("action_list") or "").split(";") if row.get("action_list") else []
        expressions = (row.get("expression_list") or "").split(";") if row.get("expression_list") else []
        pairs = [{"action": action, "expression": expressions[index] if index < len(expressions) else None} for index, action in enumerate(actions)]
        warnings = []
        if entry is None:
            warnings.append("Ambiguous skeleton reference" if matches else "Missing skeleton reference")
        elif entry.get("status") != "parsed":
            warnings.append("Skeleton could not be decoded")
        if len(actions) != len(expressions) or any(not pair["action"] or not pair["expression"] for pair in pairs):
            warnings.append("Incomplete action and expression pairs")
        required = ["stand"] + [value for pair in pairs for value in pair.values() if value]
        if row.get("expression"):
            required.append(row["expression"])
        if actions:
            if not row.get("expression"):
                warnings.append("Missing default expression")
        available = {animation["name"] for animation in entry.get("animations", [])} if entry else set()
        missing = list(dict.fromkeys(name for name in required if name and name not in available)) if entry else []
        if missing:
            warnings.append("Missing configured animations")
        drawings.append({"id": identifier, "origin": origin, "resource": resource,
                         "type": row.get("type"), "peopleId": str(row.get("people_id") or ""),
                         "gospelId": str(row.get("gospel_id") or ""), "skinId": str(row.get("skin_id") or ""),
                         "defaultExpression": row.get("expression") or "", "pairs": pairs,
                         "voiceIds": (row.get("voice_list") or "").split(";") if row.get("voice_list") else [],
                         "skeleton": {"bundle": entry["bundle"], "id": entry["id"]} if entry else None,
                         "missingAnimations": missing, "warnings": warnings,
                         "interactionStatus": "unavailable" if warnings else "configured" if actions else "not-configured"})
    return {"schema": 1, "template": "Spines/drawing", "drawings": drawings}


def preview_stands(configs, origin):
    result = []
    for name in ("WitchCultivateStandConfig", "GospelCultivateStandConfig"):
        for identifier, row in configs.get(name, {}).items():
            position, scale = row.get("posSpine"), row.get("scaleSpine")
            offset = row.get("Offset", 1.1)
            values = [position.get(axis) if position else None for axis in "xy"] + [scale.get(axis) if scale else None for axis in "xy"] + [offset]
            if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in values) or scale["x"] <= 0 or scale["y"] <= 0:
                continue
            result.append({"id": identifier, "origin": origin, "context": name, "position": position, "scale": scale, "offset": offset})
    return result


def artwork_view_catalogue(source):
    sys.path.insert(0, str(source / "tools/python-libs"))
    import UnityPy
    level = source / "android-embed/base-decoded/assets/bin/Data/level0"
    if not level.is_file():
        return {"views": [], "reason": "Preview camera is absent from archive"}
    environment = UnityPy.load(level.read_bytes())
    cameras = [reader for reader in environment.objects if reader.type.name == "Camera" and reader.read().m_GameObject.deref().peek_name() == "Main Camera"]
    if len(cameras) != 1:
        raise ValueError("Original preview camera is ambiguous")
    camera = cameras[0].read_typetree()
    if not camera["orthographic"] or camera["m_NormalizedViewPortRect"] != {"x": 0, "y": 0, "width": 1, "height": 1}:
        raise ValueError("Unsupported original preview camera")
    go = cameras[0].read().m_GameObject.deref().read()
    transform = next(component.component.deref().read_typetree() for component in go.m_Component if component.component.deref().type.name == "Transform")
    if transform["m_Father"]["m_PathID"] or any(abs(transform["m_LocalRotation"][axis]) > 1e-6 for axis in "xyz"):
        raise ValueError("Unsupported original preview camera transform")
    position = transform["m_LocalPosition"]
    result = {"camera": {"x": position["x"], "y": position["y"], "halfHeight": camera["orthographic size"], "referenceAspect": 16/9}, "views": []}
    decoder = load_decoder(source)
    merged = {}
    for suffix, origin in (("full-files/files", "legacy"), ("qnzl-2.0-poc/overlay", "archive")):
        files = source / suffix
        if not (files / "Configs/StandConfigs.dat").is_file():
            continue
        record = next(row for row in decoder.iter_local_records((files / "FrameworkList.dat").read_bytes()) if row.resource_name == "Configs/StandConfigs")
        raw = (files / "Configs/StandConfigs.dat").read_bytes()
        configs = {}
        for reader in UnityPy.load(raw if raw.startswith(b"UnityFS") else decoder.xor_prefix(raw, record.hash_code)).objects:
            if reader.type.name == "TextAsset" and reader.peek_name() in ("WitchCultivateStandConfig", "GospelCultivateStandConfig"):
                asset = reader.read()
                configs[asset.m_Name] = json.loads(asset.m_Script)
        for view in preview_stands(configs, origin):
            previous = merged.get(view["id"])
            if previous and all(previous[key] == view[key] for key in ("position", "scale", "offset", "context")):
                continue
            merged[view["id"]] = view
    result["views"] = list(merged.values())
    return result


def skill_role_bindings(people, gospels, skills, skins=(), drawings=()):
    result = []
    for row in people + gospels:
        values = json.loads(row.get("skill") or "[]")
        for key in ("skill_normal", "skill_qte"):
            if row.get(key, 0) > 0:
                values.append(row[key])
        values.extend(int(value) for value in (row.get("skill_ub") or "").split(",") if value)
        ids = list(dict.fromkeys(str(value) for value in values))
        result.append({"id": str(row["id"]), "skillIds": ids, "missingSkillIds": [value for value in ids if value not in skills]})
    by_id = {row["id"]: row for row in result}
    for row in list(skins) + list(drawings):
        identifier = str(row["id"])
        parent_id = str(row.get("people_id") or row.get("gospel_id") or "")
        parent = by_id.get(parent_id)
        if identifier not in by_id and parent:
            child = {"id": identifier, "parentId": parent_id, "skillIds": list(parent["skillIds"]), "missingSkillIds": list(parent["missingSkillIds"])}
            by_id[identifier] = child
            result.append(child)
    skin_by_id = {str(row["id"]): row for row in skins}
    maximum = max((row["id"] for row in people), default=-1)
    for row in result:
        identifier = row["id"]
        if int(identifier) <= maximum:
            row.update(emblemResource=f"UI/Image/Icon/Badge/{identifier}_huizhang-bai", emblemScale=0.7)
        else:
            skin = skin_by_id.get(identifier)
            name = skin.get("badge") if skin else None
            if not name:
                name = "wenzhang_" + str(skin["gospel_id"] if skin else identifier) + "_icon"
            row.update(emblemResource="UI/Image/wenzhang/" + name, emblemScale=1)
    return result


def skill_stand_transforms(main, witch, gospel, people, drawings):
    people = {str(row["id"]) for row in people}
    drawings = {str(row["id"]): row for row in drawings}
    result = []
    for identifier, row in main.items():
        drawing = drawings.get(identifier)
        management = witch if identifier in people or drawing and drawing.get("people_id", 0) > 0 else gospel
        base = management.get(identifier) or management.get("3000001")
        if base is None:
            result.append({"id": identifier, "status": "missing-management-config"})
            continue
        position, scale = {}, {}
        for axis in "xyz":
            a, b = base.get("pos2D", {}).get(axis, 0), row.get("pos2D", {}).get(axis, 0)
            c, d = base.get("scale2D", {}).get(axis, 1), row.get("scale2D", {}).get(axis, 1)
            if any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in (a, b, c, d)):
                raise ValueError("Invalid original skill stand transform")
            position[axis], scale[axis] = a + b, c * d
        result.append({"id": identifier, "status": "available", "position": position, "scale": scale})
    return result


def skill_display_catalogue(source, portrait_entries=()):
    root = source / "generated/content"
    skills = {str(row["id"]): row for row in records(root / "a_skill.json")}
    people, gospels = records(root / "a_people.json"), records(root / "a_gospel.json")
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(source / "tools/python-libs"))
    import UnityPy
    decoder = load_decoder(source)
    files = source / "full-files/files"
    record = next((row for row in decoder.iter_local_records((files / "FrameworkList.dat").read_bytes()) if row.resource_name == "Configs/StandConfigs"), None)
    if record is None:
        raise ValueError("Original skill stand configuration is unavailable")
    raw = (files / "Configs/StandConfigs.dat").read_bytes()
    environment = UnityPy.load(raw if raw.startswith(b"UnityFS") else decoder.xor_prefix(raw, record.hash_code))
    configs = {}
    for reader in environment.objects:
        if reader.type.name == "TextAsset" and reader.peek_name() in ("MainStandConfig", "WitchCultivateStandConfig", "GospelCultivateStandConfig"):
            asset = reader.read()
            configs[asset.m_Name] = json.loads(asset.m_Script)
    if len(configs) != 3:
        raise ValueError("Original skill stand configuration is incomplete")
    drawings = records(root / "a_station_drawing.json")
    emblems = [{"resource": row["resource"] + "/" + sprite["name"], "sprite": sprite} for row in portrait_entries if row.get("usage") == "skill-emblem" for sprite in row["sprites"]]
    return {"sourceVersion": "legacy", "skills": [{"id": key, "name": row["skill_name"], "englishName": row["skill_name_e"]} for key, row in skills.items()], "roles": skill_role_bindings(people, gospels, skills, records(root / "a_gospel_skin.json"), drawings), "stands": skill_stand_transforms(configs["MainStandConfig"], configs["WitchCultivateStandConfig"], configs["GospelCultivateStandConfig"], people, drawings), "emblems": emblems}


def hot_spring_roles(resources, levels):
    result = []
    for row in resources:
        role_id = str(row["Id"])
        spine = row.get("Spine", "")
        bundle = spine if spine.startswith("Spines/") else "Spines/painting/" + spine
        pools = [{"level": int(level["level"]), "voiceIds": [value.strip() for value in level.get("Conversation", "").split(",") if value.strip()]} for level in levels if str(level["id"]) == role_id]
        result.append({"id": role_id, "skinId": str(row["Skin"]), "bundle": bundle, "ambientSound": row.get("SpineSound", ""), "levels": sorted(pools, key=lambda pool: pool["level"])})
        if row.get("ConversationPos") and row.get("ConversationZoom"):
            result[-1]["focus"] = {"position": [float(value) for value in row["ConversationPos"].split(",")], "zoom": float(row["ConversationZoom"]) / 100}
    return result


def hot_spring_houses(rows):
    return [{"id": str(row["Id"]), "bundle": "Spines/ui/Onsen", "roleIds": [value.strip() for value in row["Gospels"].split(",") if value.strip()], "backgroundOffset": [float(value) for value in row["BgOffset"].split(",")], "defaultZoom": float(row["BgDefaulltZoom"]) / 100, "zoomRange": [float(value) / 100 for value in row["BgZoomRange"].split(",")], "music": row.get("Bgm", "")} for row in rows]


def join_hot_springs(appearances, roles, names):
    for appearance in appearances:
        role = next((row for row in roles if appearance.get("bundle") in (row["bundle"], row["bundle"] + "_hx") or appearance.get("bundle", "").lower() == "spines/ui/onsen/" + row["skinId"]), None)
        if role:
            appearance.update(hotSpringRoleId=role["id"], characterId=role["id"], characterName=names.get(role["id"], role["id"]))


def join_artwork_variants(appearances):
    by_bundle = {row.get("bundle"): row for row in appearances if row.get("characterId")}
    for row in appearances:
        bundle = row.get("sourceBundle") or row.get("bundle", "")
        if not bundle.startswith("Spines/painting/"):
            continue
        hx = bundle.endswith("_hx")
        if not hx and (not row.get("sourceBundle") or row.get("bundle") == bundle):
            continue
        parent = by_bundle.get(bundle.removesuffix("_hx") if hx else bundle)
        if not parent:
            continue
        label = "HX variant" if hx else "Original archive" if row.get("sourceVersion") == "original" else "Archive variant " + str(row.get("sourceVersion"))
        row.update(variantOf=parent["id"], characterId=parent["characterId"], characterName=parent.get("characterName"), kind=parent["kind"], name=parent["name"] + " · " + label)
        if hx and row.get("sourceVersion"):
            row["name"] += " · Archive variant " + str(row["sourceVersion"])
        if parent.get("portraitResource"):
            row.setdefault("portraitResource", parent["portraitResource"])


def join_cg_variants(appearances, skins):
    by_bundle = {row.get("bundle", "").lower(): row for row in appearances}
    for skin in skins:
        normal, alternate = skin.get("Resources", ""), skin.get("Resources_Hx", "")
        if not normal.startswith("Spines/storyCG/") or not alternate.startswith("Spines/storyCG/"):
            continue
        parent, variant = by_bundle.get(normal.lower()), by_bundle.get(alternate.lower())
        if not parent or not variant or parent is variant:
            continue
        variant.update(variantOf=parent["id"], characterId=parent.get("characterId"), characterName=parent.get("characterName"), kind=parent["kind"], name=parent["name"] + " · HX variant")
    for variant in appearances:
        source = variant.get("sourceBundle", "")
        if not source.startswith("Spines/storyCG/") or source.lower() == variant.get("bundle", "").lower():
            continue
        parent = by_bundle.get(source.lower())
        if parent:
            label = "Original archive" if variant.get("sourceVersion") == "original" else "Archive variant " + str(variant.get("sourceVersion"))
            variant.update(variantOf=parent["id"], characterId=parent.get("characterId"), characterName=parent.get("characterName"), kind=parent["kind"], name=parent["name"] + " · " + label)


def story_roles_by_resource(rows):
    return {row["PlotPic"].split("/")[0].lower(): row for row in rows if row.get("PlotPic") and row["PlotPic"] != "0"}


def join_portraits(appearances, portrait_entries, source_spines, names):
    portraits = {entry["resource"]: entry for entry in portrait_entries if entry.get("usage") != "skill-emblem"}
    used = set()
    for row in appearances:
        resource = row.get("portraitResource")
        if resource:
            used.add(resource)
        entry = portraits.get(resource)
        candidates = entry.get("sprites", []) if entry else []
        sprite = next((item for item in candidates if item["name"] == resource.split("/")[-1]), None) if resource else None
        if sprite is None and len(candidates) == 1:
            sprite = candidates[0]
        row["spineStatus"] = "unassigned" if row["status"] == "unassigned" else "available" if row["status"] == "available" else "not-extracted" if row.get("bundle") in source_spines else "missing-source"
        row["portraitStatus"] = "available" if sprite else "unavailable" if entry else "not-extracted"
        if sprite:
            row["portrait"] = sprite
        row["displayKind"] = "spine" if row["spineStatus"] == "available" else "static-preview" if sprite else "missing"
        if row["spineStatus"] == "missing-source":
            row["status"] = "missing-spine"
    for resource, entry in portraits.items():
        if resource in used:
            continue
        for sprite in entry.get("sprites", []):
            identifier = sprite["name"].removesuffix("_lihui").removesuffix("_lihui_hx")
            character_id = identifier if identifier in names else None
            appearances.append({"id": resource + "/" + sprite["id"], "characterId": character_id, "characterName": names.get(character_id), "name": sprite["name"], "kind": "portrait", "portraitResource": resource, "portrait": sprite, "portraitStatus": "available", "spineStatus": "not-configured", "displayKind": "static", "status": "static-only"})


def build(source, output):
    presentations = json.loads((output / "presentations.json").read_text())["presentations"]
    by_bundle = {entry["id"]: entry for entry in presentations}
    roots = [source / "generated/content", source / "qnzl-2.0-poc/generated/content"]
    people, skins, voices, stories, source_hot_springs = {}, {}, {}, {}, {}
    for root in roots:
        for table, destination in (("a_people", people), ("a_gospel", people), ("a_gospel_skin", skins), ("a_sound_voice", voices), ("a_sound_voice_story", stories), ("a_hs_gospel", source_hot_springs)):
            destination.update({str(row["id"]): row for row in records(root / f"{table}.json")})
    characters = [{"id": key, "name": row.get("people_name") or row.get("gospel_name") or key} for key, row in people.items()]
    names = {row["id"]: row["name"] for row in characters}
    appearances = []
    used = set()
    for key, row in skins.items():
        bundle = "Spines/painting/" + row["spine_id"]
        presentation = by_bundle.get(bundle)
        entry = {"id": key, "characterId": str(row["gospel_id"]), "characterName": names.get(str(row["gospel_id"]), str(row["gospel_id"])), "name": row["skin_name"], "bundle": bundle, "portraitResource": "UI/Image/lihui/" + row["tachie_id"], "kind": "skin", "storyPack": row.get("storypack_id"), "ownVoice": bool(row.get("use_skinvoice")), "ambientSound": row.get("spine_ambient_sound") or "", "idle": row.get("idle_act") or "", "touchType": row.get("touch_act"), "status": "available" if presentation and presentation["instances"] else "not-extracted"}
        appearances.append(entry)
        used.add(bundle)
    raw_tables = source / "research/qnzl-2.0-diff-20260828/parsed/tables"
    story_roles = story_roles_by_resource(records(raw_tables / "RoleRes.json"))
    for row in records(raw_tables / "RoleRes.json"):
        resource = row.get("Spine", "")
        character_id = row.get("RoleId")
        if character_id and row.get("__unnamed_2") and (character_id not in names or row["Id"] == character_id):
            names[character_id] = row["__unnamed_2"]
        if resource in ("", "0"):
            continue
        bundle = resource if resource.startswith("Spines/") else "Spines/painting/" + resource
        if bundle in used:
            existing = next(entry for entry in appearances if entry["bundle"] == bundle)
            existing.update(characterId=character_id, characterName=row.get("__unnamed_2"))
            continue
        presentation = by_bundle.get(bundle)
        appearances.append({"id": row["Id"], "characterId": character_id, "characterName": row.get("__unnamed_2"), "name": row.get("__unnamed_3") or resource, "bundle": bundle, "portraitResource": "UI/Image/lihui/" + row.get("Pic", ""), "kind": "painting", "status": "available" if presentation and presentation["instances"] else "not-extracted"})
        used.add(bundle)
    for row in records(raw_tables / "Skin.json"):
        bundle = row.get("Resources", "")
        if not bundle.startswith("Spines/") or bundle in used:
            continue
        presentation = by_bundle.get(bundle)
        appearances.append({"id": "v2-" + row["Id"], "characterId": row.get("RoleResId") if row.get("RoleResId") not in (None, "", "0") else None, "name": row.get("__unnamed_3") or row.get("Name"), "bundle": bundle, "kind": "storyCG", "status": "available" if presentation and presentation["instances"] else "missing-spine"})
        used.add(bundle)
    for presentation in presentations:
        if presentation["id"] in used or not (presentation["instances"] or presentation.get("unassignedInstances")):
            continue
        filename = presentation["id"].split("/")[-1]
        character_id = filename.removesuffix("_spine").removesuffix("_spine_hx")
        name = names.get(character_id, filename)
        story_role = (story_roles.get(filename.lower()) or story_roles.get(filename.lower().removesuffix("_hx"))) if presentation["category"] == "story" else None
        appearances.append({"id": presentation["id"], "characterId": story_role.get("RoleId") if story_role else character_id if character_id in names else None, "characterName": story_role.get("__unnamed_2") if story_role else names.get(character_id), "name": filename if story_role else name, "bundle": presentation["id"], "kind": presentation["category"], "status": "available" if presentation["instances"] else "unassigned"})
    for row in appearances:
        presentation = by_bundle.get(row.get("bundle"), {})
        for field in ("sourceBundle", "sourceVersion"):
            if field in presentation:
                row[field] = presentation[field]
    join_artwork_variants(appearances)
    join_cg_variants(appearances, records(raw_tables / "Skin.json"))
    portrait_path = output / "portrait-index.json"
    portrait_entries = []
    if portrait_path.is_file():
        portrait_entries = json.loads(portrait_path.read_text())["entries"]
        source_spines = {"Spines/" + path.relative_to(folder).with_suffix("").as_posix() for folder in source.rglob("Spines") if folder.is_dir() for path in folder.rglob("*.dat")}
        join_portraits(appearances, portrait_entries, source_spines, names)
    hot_springs = hot_spring_roles(records(raw_tables / "HotSpringRoleRes.json"), records(raw_tables / "HotSpringRoleLevel.json"))
    join_hot_springs(appearances, hot_springs, names)
    houses = hot_spring_houses(records(raw_tables / "HotSpringHouse.json"))
    for house in houses:
        sources = [row for row in presentations if row["id"] == house["bundle"] or row.get("origin") == "original-archive" and row["id"].lower() == "spines/ui/onsen/" + house["id"]]
        for presentation in sources:
            if any(node["type"] == "GameObject" and node["data"].get("m_Name") == house["id"] for node in presentation.get("hierarchy", [])):
                original = presentation.get("origin") == "original-archive"
                appearances.append({"id": "onsen-house-" + house["id"] + ("-original" if original else ""), "bundle": presentation["id"] + "/" + house["id"], "name": "Hot spring house " + house["id"] + (" · Original archive" if original else ""), "kind": "ui", "status": "available", "displayKind": "spine", "spineStatus": "available", "hotSpringRoleIds": house["roleIds"], "ambientSound": "UI_Onsen_amb"})
    voice_rows = [{"id": key, "targetId": str(row["target_id"]), "title": row["voice_title"], "text": row["voice_text"], "resourceName": row["file_name"], "type": row["type"], "groupId": row.get("group_id"), "targetType": row.get("target_type")} for key, row in voices.items()]
    story_rows = [{"id": key, "text": row["voice_text"], "resourceName": row["file_name"]} for key, row in stories.items()]
    raw_voice_rows = records(raw_tables / "VoiceRole.json")
    raw_sound_rows = records(raw_tables / "Sound.json")
    sound_by_id = {row["Id"]: row for row in raw_sound_rows}
    voice_by_id = {row["id"]: row for row in voice_rows}
    unresolved = []
    for row in raw_voice_rows:
        sound = sound_by_id.get(row["Id"])
        if not sound or not sound.get("FullPathName"):
            unresolved.append({"id": row["Id"], "targetId": row["TargetId"], "title": row.get("__unnamed_7"), "text": row.get("__unnamed_9")})
            continue
        voice_by_id[row["Id"]] = {"id": row["Id"], "targetId": row["TargetId"], "title": row.get("__unnamed_7") or row["VoiceTitle"], "text": row.get("__unnamed_9") or "", "resourceName": sound["FullPathName"].split('/')[-1], "resourcePath": sound["FullPathName"], "alias": sound["SuchName"], "type": row.get("Application"), "groupId": row.get("Group"), "targetType": row["TargetType"], "skinClickVoice": row.get("SkinClickVoice")}
    voice_rows = list(voice_by_id.values())
    sounds = [{"id": row["Id"], "resource": "SoundRes/" + row["FullPathName"], "name": row["SuchName"], "volume": row["Volume"], "loop": row["IsLoop"], "delay": row["Delay"]} for row in raw_sound_rows if row.get("FullPathName")]
    characters = [{"id": key, "name": name} for key, name in names.items()]
    runtime_entries = json.loads((output / "runtime-index.json").read_text())["entries"]
    station_drawings = station_drawing_catalogue([(origin, records(root / "a_station_drawing.json")) for origin, root in zip(("legacy", "archive"), roots)], runtime_entries)
    main_voices = main_view_voice_catalogue(voices.values(), skins.values(),
                                          {identifier for drawing in station_drawings["drawings"] for identifier in drawing["voiceIds"]})
    favor_speech = hot_spring_speech_catalogue(source_hot_springs.values(), skins.values(), voices.values())
    main_voices.update(hotSpringProfiles=favor_speech["profiles"], favorVoices=favor_speech["voices"])
    globals_by_id = {}
    for root in roots:
        globals_by_id.update({str(row["id"]): row for row in records(root / "a_global.json") if str(row["id"]) == "9991139"})
    main_voices["chineseCaptions"] = chinese_caption_policy(globals_by_id.values())
    write_json(output / "library.json", {"schema": 1, "characters": characters, "appearances": appearances, "voices": voice_rows, "storyVoices": story_rows, "mainViewVoices": main_voices, "soundResources": sounds, "hotSpringRoles": hot_springs, "hotSpringHouses": houses, "skillDisplay": skill_display_catalogue(source, portrait_entries), "artworkViews": artwork_view_catalogue(source), "stationDrawings": station_drawings, "unresolvedV2VoiceRows": unresolved})
    print({"characters": len(characters), "appearances": len(appearances), "missingSpines": sum(row.get("spineStatus") == "missing-source" for row in appearances), "staticPreviews": sum(row.get("displayKind") == "static-preview" for row in appearances), "portraitOnly": sum(row.get("displayKind") == "static" for row in appearances), "voices": len(voice_rows), "storyVoices": len(story_rows), "unresolvedV2Voices": len(unresolved)})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/assets"))
    args = parser.parse_args()
    build(args.source, args.output)
