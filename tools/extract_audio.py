"""Decode local Unity AudioClips into browser audio files."""
from __future__ import annotations
import argparse
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import io
import wave

from extract_assets import load_decoder, write_json


def extract_one(task):
    source_text, resource, filename, output_text, record_hash, encoder, executable = task
    source = Path(source_text)
    sys.path.insert(0, str(source / "tools/python-libs"))
    import UnityPy
    result = {"id": resource, "category": resource.split('/')[1], "name": Path(resource).name, "clips": [], "errors": [], "warnings": []}
    try:
        raw = Path(filename).read_bytes()
        if not raw.startswith(b"UnityFS"):
            if record_hash is None:
                raise ValueError("No decoding metadata for audio resource")
            raw = load_decoder(source).xor_prefix(raw, record_hash)
        environment = UnityPy.load(raw)
        folder = Path(output_text) / "audio" / resource.removeprefix("SoundRes/")
        for reader in environment.objects:
            if reader.type.name != "AudioClip":
                continue
            clip = reader.read()
            samples = clip.samples
            if not samples:
                raise ValueError(f"No decoded samples for {clip.m_Name}")
            folder.mkdir(parents=True, exist_ok=True)
            for number, (sample_name, wav) in enumerate(samples.items()):
                suffix = ".m4a" if encoder == "afconvert" else ".ogg"
                destination = folder / f"{reader.path_id}-{number}{suffix}"
                with tempfile.NamedTemporaryFile(dir=folder, suffix=suffix, delete=False) as temporary:
                    temporary_path = Path(temporary.name)
                try:
                    if encoder == "afconvert":
                        with tempfile.NamedTemporaryFile(dir=folder, suffix=".wav") as input_file:
                            input_file.write(wav)
                            input_file.flush()
                            process = subprocess.run([executable, "-f", "m4af", "-d", "aac@48000", "-b", "96000", input_file.name, str(temporary_path)], capture_output=True, timeout=180)
                    else:
                        process = subprocess.run([executable, "-hide_banner", "-loglevel", "error", "-y", "-i", "pipe:0", "-map", "0:a:0", "-c:a", "libopus", "-b:a", "96k", str(temporary_path)], input=wav, capture_output=True, timeout=180)
                    if process.returncode:
                        with wave.open(io.BytesIO(wav)) as checked:
                            if checked.getnframes() <= 0:
                                raise ValueError("Decoded WAV contains no samples")
                        destination = destination.with_suffix(".wav")
                        destination.write_bytes(wav)
                        result["warnings"].append("Compressed encoding failed; preserved decoded PCM WAV: " + process.stderr.decode("utf-8", errors="replace")[:300])
                    else:
                        temporary_path.replace(destination)
                finally:
                    temporary_path.unlink(missing_ok=True)
                result["clips"].append({"name": clip.m_Name, "sample": sample_name, "duration": clip.m_Length, "channels": clip.m_Channels, "sourceRate": clip.m_Frequency, "path": destination.relative_to(output_text).as_posix()})
        if not result["clips"]:
            raise ValueError("Resource contains no AudioClip")
    except Exception as error:
        result["errors"].append(str(error))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/assets"))
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--encoder", choices=("afconvert", "ffmpeg"), default="afconvert" if sys.platform == "darwin" else "ffmpeg")
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--match", default="")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args()
    source = args.source.resolve()
    roots = [source / "full-files/files", source / "qnzl-2.0-poc/overlay"]
    decoder = load_decoder(source)
    records, candidates = {}, {}
    for root in roots:
        metadata = root / "FrameworkList.dat"
        if metadata.is_file():
            records.update({record.resource_name: record for record in decoder.iter_local_records(metadata.read_bytes())})
        for path in sorted((root / "SoundRes").rglob("*.dat")):
            resource = path.relative_to(root).with_suffix("").as_posix()
            if args.match in resource:
                candidates[resource] = path
    executable = "/usr/bin/afconvert" if args.encoder == "afconvert" else args.ffmpeg
    if args.encoder == "ffmpeg":
        formats = subprocess.run([executable, "-hide_banner", "-formats"], capture_output=True, check=True, text=True).stdout
        encoders = subprocess.run([executable, "-hide_banner", "-encoders"], capture_output=True, check=True, text=True).stdout
        if "wav" not in formats or "libopus" not in encoders:
            parser.error("The supplied FFmpeg must support WAV decoding and libopus encoding")
    tasks = [(str(source), resource, str(filename), str(args.output), records[resource].hash_code if resource in records else None, args.encoder, executable) for resource, filename in list(candidates.items())[:args.limit]]
    index_path = args.output / "audio-index.json"
    existing = json.loads(index_path.read_text())["entries"] if args.retry_failed and index_path.exists() else []
    entries = [entry for entry in existing if not entry["errors"]]
    done = {entry["id"] for entry in entries}
    tasks = [task for task in tasks if task[1] not in done]
    expected = len(entries) + len(tasks)
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        for entry in pool.map(extract_one, tasks):
            entries.append(entry)
            if len(entries) % 100 == 0 or (entry["errors"] and sum(bool(x["errors"]) for x in entries) <= 10):
                print(len(entries), "/", len(tasks), entry["id"], entry["errors"], flush=True)
            if len(entries) % 100 == 0:
                write_json(args.output / "audio-index.json", {"schema": 1, "complete": False, "expected": expected, "entries": entries})
    write_json(args.output / "audio-index.json", {"schema": 1, "complete": True, "expected": expected, "entries": entries})
    print({"resources": len(entries), "clips": sum(len(x["clips"]) for x in entries), "failed": sum(bool(x["errors"]) for x in entries)}, flush=True)


if __name__ == "__main__":
    main()
