"""Extract real portrait sprites without substituting missing Spine resources."""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import json
from pathlib import Path
import sys
from extract_assets import load_decoder, safe_name, write_json


def worker_init(source):
    global UnityPy, decoder
    source = Path(source)
    sys.path.insert(0, str(source / "tools/python-libs"))
    import UnityPy as unity
    UnityPy = unity
    decoder = load_decoder(source)


def extract(task):
    resource, filename, hash_code, output = task
    result = {"resource": resource, "sprites": [], "errors": []}
    try:
        if filename is None:
            raise FileNotFoundError("Portrait bundle is absent from the source archive")
        raw = Path(filename).read_bytes()
        if not raw.startswith(b"UnityFS"):
            if hash_code is None:
                raise ValueError("Portrait decoding metadata is unavailable")
            raw = decoder.xor_prefix(raw, hash_code)
        environment = UnityPy.load(raw)
        sprites = [obj for obj in environment.objects if obj.type.name == "Sprite"]
        if not sprites:
            raise ValueError("Portrait bundle contains no Sprite objects")
        for reader in sprites:
            try:
                sprite = reader.read()
                image = sprite.image.convert("RGBA")
                relative = Path("portraits") / safe_name(resource.split("/")[-1]) / (str(reader.path_id) + ".png")
                destination = Path(output) / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                temporary = destination.with_suffix(".tmp")
                image.save(temporary, format="PNG")
                temporary.replace(destination)
                thumb = image.copy()
                thumb.thumbnail((240, 320))
                thumbnail = relative.with_suffix(".webp")
                thumb.save(Path(output) / thumbnail, format="WEBP", quality=85)
                result["sprites"].append({"id": str(reader.path_id), "name": sprite.m_Name, "path": relative.as_posix(), "thumbnail": thumbnail.as_posix(), "width": image.width, "height": image.height, "pixelsPerUnit": sprite.m_PixelsToUnits, "pivot": {"x": sprite.m_Pivot.x, "y": sprite.m_Pivot.y}})
            except Exception as exc:
                result["errors"].append({"id": str(reader.path_id), "error": str(exc)})
    except Exception as exc:
        result["errors"].append({"error": str(exc)})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/assets"))
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    decoder = load_decoder(source)
    roots = [source / "full-files/files", source / "qnzl-2.0-poc/overlay"]
    metadata, candidates = {}, {}
    for root in roots:
        framework = root / "FrameworkList.dat"
        if framework.is_file():
            metadata.update({record.resource_name: record.hash_code for record in decoder.iter_local_records(framework.read_bytes())})
        for filename in sorted((root / "UI/Image/lihui").rglob("*.dat")):
            candidates[filename.relative_to(root).with_suffix("").as_posix()] = str(filename)
    library = json.loads((output / "library.json").read_text())
    for row in library["appearances"]:
        resource = row.get("portraitResource")
        if resource and not resource.endswith("/"):
            candidates.setdefault(resource, None)
    tasks = [(resource, filename, metadata.get(resource), str(output)) for resource, filename in sorted(candidates.items())]
    entries = []
    with ProcessPoolExecutor(max_workers=args.workers, initializer=worker_init, initargs=(str(source),)) as pool:
        futures = [pool.submit(extract, task) for task in tasks]
        for future in as_completed(futures):
            entry = future.result()
            entries.append(entry)
            print(entry["resource"], "sprites", len(entry["sprites"]), "errors", len(entry["errors"]), flush=True)
    entries.sort(key=lambda row: row["resource"])
    summary = {"bundles": len(entries), "sprites": sum(len(row["sprites"]) for row in entries), "failedBundles": sum(not row["sprites"] for row in entries), "errors": sum(len(row["errors"]) for row in entries)}
    write_json(output / "portrait-index.json", {"schema": 1, "complete": True, "entries": entries, "summary": summary})
    print(summary)


if __name__ == "__main__":
    main()
