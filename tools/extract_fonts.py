"""Extract original font files and bind them to recovered TMP font assets."""
import argparse
from pathlib import Path
import sys
if __package__:
    from .extract_assets import load_decoder, safe_name, write_json
else:
    from extract_assets import load_decoder, safe_name, write_json


def font_format(data):
    if len(data) < 12:
        raise ValueError("Font file is truncated")
    if data[:4] == b"OTTO":
        return "otf"
    if data[:4] == b"\x00\x01\x00\x00":
        return "ttf"
    raise ValueError("Unsupported original font format")


def font_asset_entries(assets, files):
    entries = []
    for asset_id, data in assets:
        primary = files.get(data.get("m_Name"))
        if primary is None:
            continue
        entries.append({"assetId": str(asset_id), "name": data["m_Name"], "path": primary["path"], "format": primary["format"], "bytes": primary["bytes"], "face": data["m_FaceInfo"], "characters": [row["m_Unicode"] for row in data.get("m_CharacterTable", [])], "fallbacks": [str(pointer["m_PathID"]) for pointer in data.get("m_FallbackFontAssetTable", []) if pointer.get("m_PathID")]})
    return entries


def extract(source, output, names):
    source, output = source.resolve(), output.resolve()
    if output.is_relative_to(source):
        raise ValueError("Font output must be outside the source archive")
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(source / "tools/python-libs"))
    import UnityPy
    decoder = load_decoder(source)
    roots = [source / "full-files/files", source / "qnzl-2.0-poc/overlay"]
    records, paths = {}, {}
    for root in roots:
        framework = root / "FrameworkList.dat"
        if framework.is_file():
            records.update({row.resource_name.lower(): row for row in decoder.iter_local_records(framework.read_bytes())})
        for path in (root / "Fonts").glob("*.dat"):
            paths[path.relative_to(root).with_suffix("").as_posix().lower()] = path

    def load(key):
        key = key.lower()
        path, record = paths.get(key), records.get(key)
        if path is None or record is None:
            raise ValueError("Original font bundle is unavailable: " + key)
        raw = path.read_bytes()
        return UnityPy.load(raw if raw.startswith(b"UnityFS") else decoder.xor_prefix(raw, record.hash_code))

    files = {}
    for name in names:
        environment = load("Fonts/" + name)
        fonts = [reader.read() for reader in environment.objects if reader.type.name == "Font"]
        font = next((font for font in fonts if font.m_Name == name), None)
        if font is None:
            raise ValueError("Original font name does not match the requested asset: " + name)
        raw = bytes(font.m_FontData)
        extension = font_format(raw)
        relative = Path("spines/interfaces/fonts") / (safe_name(name) + "." + extension)
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".partial")
        temporary.write_bytes(raw)
        temporary.replace(destination)
        files[name] = {"path": relative.as_posix(), "format": extension, "bytes": len(raw)}
    assets = []
    for reader in load("Fonts/TMP").objects:
        if reader.type.name == "MonoBehaviour":
            data = reader.read_typetree()
            if "m_FaceInfo" in data:
                assets.append((reader.path_id, data))
    entries = font_asset_entries(assets, files)
    if set(names) != {row["name"] for row in entries}:
        raise ValueError("Original font files could not be bound to their TMP assets")
    write_json(output / "font-index.json", {"schema": 1, "entries": entries})
    print({"fonts": len(entries), "bytes": sum(file["bytes"] for file in files.values())})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/assets"))
    parser.add_argument("--name", action="append")
    args = parser.parse_args()
    extract(args.source, args.output, args.name or ["SOURCE", "NOTO_light"])
