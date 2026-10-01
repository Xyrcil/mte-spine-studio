"""Join character, appearance, and voice tables to extracted presentations."""
import argparse
import json
from pathlib import Path
from extract_assets import write_json


def records(path):
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("records", data.get("rows", []))


def hot_spring_roles(resources, levels):
    result = []
    for row in resources:
        role_id = str(row["Id"])
        spine = row.get("Spine", "")
        bundle = spine if spine.startswith("Spines/") else "Spines/painting/" + spine
        pools = [{"level": int(level["level"]), "voiceIds": [value.strip() for value in level.get("Conversation", "").split(",") if value.strip()]} for level in levels if str(level["id"]) == role_id]
        result.append({"id": role_id, "skinId": str(row["Skin"]), "bundle": bundle, "ambientSound": row.get("SpineSound", ""), "levels": sorted(pools, key=lambda pool: pool["level"])})
    return result


def join_hot_springs(appearances, roles, names):
    for appearance in appearances:
        role = next((row for row in roles if appearance.get("bundle") in (row["bundle"], row["bundle"] + "_hx")), None)
        if role:
            appearance.update(hotSpringRoleId=role["id"], characterId=role["id"], characterName=names.get(role["id"], role["id"]))


def join_portraits(appearances, portrait_entries, source_spines, names):
    portraits = {entry["resource"]: entry for entry in portrait_entries}
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
        row["spineStatus"] = "available" if row["status"] == "available" else "not-extracted" if row.get("bundle") in source_spines else "missing-source"
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
    people, skins, voices, stories = {}, {}, {}, {}
    for root in roots:
        for table, destination in (("a_people", people), ("a_gospel", people), ("a_gospel_skin", skins), ("a_sound_voice", voices), ("a_sound_voice_story", stories)):
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
    story_roles = {}
    for row in records(raw_tables / "RoleRes.json"):
        resource = row.get("Spine", "")
        character_id = row.get("RoleId")
        plot = row.get("PlotPic", "")
        if plot and plot != "0":
            story_roles[plot.split("/")[0]] = row
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
        appearances.append({"id": "v2-" + row["Id"], "characterId": row.get("RoleResId"), "name": row.get("__unnamed_3") or row.get("Name"), "bundle": bundle, "kind": "storyCG", "status": "available" if presentation and presentation["instances"] else "missing-spine"})
        used.add(bundle)
    for presentation in presentations:
        if presentation["id"] in used or not presentation["instances"]:
            continue
        filename = presentation["id"].split("/")[-1]
        character_id = filename.removesuffix("_spine").removesuffix("_spine_hx")
        name = names.get(character_id, filename)
        story_role = (story_roles.get(filename) or story_roles.get(filename.removesuffix("_hx"))) if presentation["category"] == "story" else None
        appearances.append({"id": presentation["id"], "characterId": story_role.get("RoleId") if story_role else character_id if character_id in names else None, "characterName": story_role.get("__unnamed_2") if story_role else names.get(character_id), "name": filename if story_role else name, "bundle": presentation["id"], "kind": presentation["category"], "status": "available"})
    portrait_path = output / "portrait-index.json"
    if portrait_path.is_file():
        portrait_entries = json.loads(portrait_path.read_text())["entries"]
        source_spines = {"Spines/" + path.relative_to(folder).with_suffix("").as_posix() for folder in source.rglob("Spines") if folder.is_dir() for path in folder.rglob("*.dat")}
        join_portraits(appearances, portrait_entries, source_spines, names)
    hot_springs = hot_spring_roles(records(raw_tables / "HotSpringRoleRes.json"), records(raw_tables / "HotSpringRoleLevel.json"))
    join_hot_springs(appearances, hot_springs, names)
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
    write_json(output / "library.json", {"schema": 1, "characters": characters, "appearances": appearances, "voices": voice_rows, "storyVoices": story_rows, "soundResources": sounds, "hotSpringRoles": hot_springs, "unresolvedV2VoiceRows": unresolved})
    print({"characters": len(characters), "appearances": len(appearances), "missingSpines": sum(row.get("spineStatus") == "missing-source" for row in appearances), "staticPreviews": sum(row.get("displayKind") == "static-preview" for row in appearances), "portraitOnly": sum(row.get("displayKind") == "static" for row in appearances), "voices": len(voice_rows), "storyVoices": len(story_rows), "unresolvedV2Voices": len(unresolved)})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/assets"))
    args = parser.parse_args()
    build(args.source, args.output)
