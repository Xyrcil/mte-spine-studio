"""Convert unindexed original game audio locally without playing it."""
import argparse
from concurrent.futures import ProcessPoolExecutor
import json
import io
from pathlib import Path
import sys
import zipfile
import wave

from extract_assets import write_json
from extract_audio import audio_entry, extract_environment
from source_archive import decode_bundle, sanitize_diagnostics


def audio_source(name):
    marker = "/vercache_demo/sound/"
    if marker not in name or not name.endswith(".data"):
        return None
    parts = name.split(marker, 1)[1].split("/")
    if len(parts) != 2 or any(part in ("", ".", "..") or "\\" in part or ":" in part for part in parts):
        raise ValueError("Invalid original audio resource path")
    return parts[0], parts[1].removesuffix(".data")


def canonical_names(rows):
    result = {}
    for row in rows:
        name = row["resource"].split("/")[-1]
        result.setdefault(name.lower(), name)
    return result


def canonical_audio_name(source, native, declared=None):
    if declared is not None:
        return declared
    return native if native.lower() == source.lower() else source


def short_voice_signature(environment, category):
    if category not in ("a_sound_voiceeff", "a_sound_voiceeff_ch"):
        return None
    clips = [reader.read() for reader in environment.objects if reader.type.name == "AudioClip"]
    if len(clips) != 1 or not 0 < clips[0].m_Length < .2:
        return None
    samples = list(clips[0].samples.values())
    if len(samples) != 1:
        return None
    with wave.open(io.BytesIO(samples[0])) as audio:
        return category, audio.getframerate(), audio.getnchannels(), audio.getsampwidth(), audio.readframes(audio.getnframes())


def mark_shared_cues(groups):
    for rows in groups.values():
        if len(rows) > 1:
            for row in rows:
                for clip in row["clips"]:
                    clip["sharedShortCue"] = True


def initialize(archive, libraries, output):
    global source_zip, output_root
    sys.dont_write_bytecode = True
    sys.path.insert(0, libraries)
    source_zip = zipfile.ZipFile(archive)
    output_root = output


def convert(task):
    member, category, source_name, declared = task
    name = declared or source_name
    resource = f"SoundRes/{category}/{name}"
    try:
        import UnityPy
        environment = UnityPy.load(decode_bundle(source_zip.read(member)))
        native = next((reader.read().m_Name for reader in environment.objects if reader.type.name == "AudioClip"), source_name)
        name = canonical_audio_name(source_name, native, declared)
        resource = f"SoundRes/{category}/{name}"
        result = extract_environment(environment, resource, output_root, "afconvert", "/usr/bin/afconvert", "audio/original-archive")
        if not result["errors"]:
            signature = short_voice_signature(environment, category)
            if signature is not None:
                result["_shortVoiceSignature"] = signature
    except Exception as error:
        result = audio_entry(resource)
        result["errors"].append(str(error))
    result["origin"] = "original-archive"
    return sanitize_diagnostics(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--assets", type=Path, default=Path("public/assets"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--python-libs", type=Path, required=True)
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if not 1 <= args.jobs <= 8 or args.limit is not None and args.limit < 1:
        parser.error("Use 1–8 workers and a positive optional limit")
    index = json.loads((args.assets / "audio-index.json").read_text())
    library = json.loads((args.assets / "library.json").read_text())
    names = canonical_names(library["soundResources"])
    known = {(row["category"].lower(), row["name"].lower()) for row in index["entries"] if not row["errors"] and row["clips"]}
    tasks = []
    with zipfile.ZipFile(args.archive) as archive:
        for row in archive.infolist():
            source = audio_source(row.filename)
            if source and (source[0].lower(), source[1].lower()) not in known:
                tasks.append((row.filename, source[0], source[1], names.get(source[1].lower())))
    if args.limit:
        tasks = tasks[:args.limit]
    destination = args.output / "audio-index.json"
    if destination.exists() or (args.output / "audio/original-archive").exists():
        parser.error("The output already contains converted audio")
    args.output.mkdir(parents=True, exist_ok=True)
    print(json.dumps({"selected": len(tasks), "workers": args.jobs}), flush=True)
    entries, groups = [], {}
    with ProcessPoolExecutor(max_workers=args.jobs, initializer=initialize, initargs=(str(args.archive.resolve()), str(args.python_libs.resolve()), str(args.output.resolve()))) as pool:
        for row in pool.map(convert, tasks):
            signature = row.pop("_shortVoiceSignature", None)
            if signature is not None:
                groups.setdefault(signature, []).append(row)
            entries.append(row)
            if len(entries) % 50 == 0:
                write_json(destination, {"schema": 1, "complete": False, "expected": len(tasks), "entries": entries})
                print(json.dumps({"converted": len(entries), "failed": sum(bool(row["errors"]) for row in entries)}), flush=True)
    mark_shared_cues(groups)
    write_json(destination, {"schema": 1, "complete": True, "expected": len(tasks), "entries": entries})
    print(json.dumps({"resources": len(entries), "clips": sum(len(row["clips"]) for row in entries), "failed": sum(bool(row["errors"]) for row in entries)}), flush=True)


if __name__ == "__main__":
    main()
