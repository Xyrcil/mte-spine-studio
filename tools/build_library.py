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
    for row in records(raw_tables / "RoleRes.json"):
        resource = row.get("Spine", "")
        character_id = row.get("RoleId")
        if character_id and row.get("__unnamed_2"):
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
        appearances.append({"id": presentation["id"], "characterId": character_id if character_id in names else None, "characterName": names.get(character_id), "name": name, "bundle": presentation["id"], "kind": presentation["category"], "status": "available"})
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
    write_json(output / "library.json", {"schema": 1, "characters": characters, "appearances": appearances, "voices": voice_rows, "storyVoices": story_rows, "soundResources": sounds, "unresolvedV2VoiceRows": unresolved})
    print({"characters": len(characters), "appearances": len(appearances), "missingSpines": sum(row["status"] != "available" for row in appearances), "voices": len(voice_rows), "storyVoices": len(story_rows), "unresolvedV2Voices": len(unresolved)})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/assets"))
    args = parser.parse_args()
    build(args.source, args.output)
