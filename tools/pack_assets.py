"""Create a local ZIP of indexed converted resources; do not distribute game assets."""
import argparse
import json
import os
import re
import tempfile
import zipfile
from pathlib import Path

CATALOGUES = ["presentations.json", "runtime-index.json", "library.json", "audio-index.json", "portrait-index.json"]


def indexed_files(root):
    root = root.resolve()
    data = {name: json.loads((root / name).read_text(encoding="utf-8")) for name in CATALOGUES}
    paths = set(CATALOGUES)
    for entry in data["runtime-index.json"]["entries"]:
        if entry.get("status") != "parsed":
            continue
        paths.add(entry["path"] + "/" + entry["skeleton"])
        for page in entry.get("materialBindings", {}).get("pages", []):
            for material in page["materials"].values():
                for texture in material.get("textures", {}).values():
                    if texture.get("path"):
                        paths.add(entry["path"] + "/" + texture["path"])
        for atlas in entry["atlases"]:
            path = entry["path"] + "/" + entry["id"] + "/" + atlas["atlas"]
            paths.add(path)
            paths.update(path.rsplit("/", 1)[0] + "/" + page for page in atlas["pages"])
    for entry in data["audio-index.json"]["entries"]:
        if not entry.get("errors"):
            paths.update(clip["path"] for clip in entry.get("clips", []))

    for presentation in data["presentations.json"]["presentations"]:
        def local(resource):
            if resource and resource.get("path"):
                paths.add(presentation["path"] + "/" + resource["path"])
        for image in presentation.get("images", []):
            if image.get("assetPath"):
                paths.add(image["assetPath"])
            else:
                local(image.get("sprite"))
        for effect in presentation.get("effects", []):
            for sprite in effect.get("sprites", []):
                local(sprite)
            for material in effect.get("materials", []):
                for texture in material.get("textures", {}).values():
                    local(texture)

    def visit(value):
        if isinstance(value, dict):
            for item in value.values():
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, str) and re.match(r"^(spines|portraits|audio)/", value) and re.search(r"\.(json|skel|atlas|png|webp|jpg|jpeg|m4a|ogg|mp3|wav|otf|ttf)$", value, re.I):
            paths.add(value)

    for name in ["presentations.json", "library.json", "portrait-index.json"]:
        visit(data[name])
    for path in paths:
        candidate = (root / path).resolve()
        if path.startswith("/") or any(part in ("", ".", "..") or ":" in part for part in path.split("/")) or any(char in path for char in "\\%?#"):
            raise ValueError("Invalid indexed resource path")
        candidate.relative_to(root)
        if not candidate.is_file():
            raise ValueError("Indexed resource missing: " + path)
    return CATALOGUES + sorted(paths.difference(CATALOGUES))


def pack(root, output):
    root = root.resolve()
    output = output.resolve()
    if output.exists():
        raise ValueError("Output already exists; choose a new archive name")
    try:
        output.relative_to(root)
    except ValueError:
        pass
    else:
        raise ValueError("Archive output must be outside the assets folder")
    paths = indexed_files(root)
    with tempfile.NamedTemporaryFile(dir=output.parent, prefix="mte-pack-", suffix=".partial", delete=False) as temporary:
        staging = Path(temporary.name)
    try:
        with zipfile.ZipFile(staging, "w", compression=zipfile.ZIP_STORED) as archive:
            for index, path in enumerate(paths):
                archive.write(root / path, path)
                if (index + 1) % 1000 == 0:
                    print(f"Packed {index + 1} / {len(paths)} files", flush=True)
        os.link(staging, output)
        print(f"Created local archive: {len(paths)} files, {output.stat().st_size} bytes", flush=True)
    finally:
        staging.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    pack(args.assets, args.output)
