"""Inspect original resource archives or convert selected Spine bundles locally."""
import argparse
import collections
import json
import sys
import zipfile
from pathlib import Path, PurePosixPath


def spine_key(name):
    marker = "/vercache_demo/spines/"
    if marker not in name or not name.endswith(".data"):
        return None
    value = name.split(marker, 1)[1]
    if "\\" in value or ":" in value or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("Invalid source resource path")
    relative = PurePosixPath(value)
    stem = relative.stem.lower()
    if stem.endswith((".atlas", ".skel", "_atlas", "_material")):
        return None
    if relative.parts[0] in ("painting", "story"):
        relative = relative.parent
    else:
        relative = relative.with_suffix("")
    parts = list(relative.parts)
    parts[0] = "storyCG" if parts[0] == "storycg" else parts[0]
    return "Spines/" + "/".join(parts)


def decode_bundle(data):
    if data.startswith(b"UnityFS"):
        return data
    decoded = bytearray(data)
    for index in range(min(1000, len(decoded))):
        decoded[index] ^= 0x7B
    if not decoded.startswith(b"UnityFS"):
        raise ValueError("Original bundle encoding is unsupported")
    return bytes(decoded)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, default=Path("public/assets/presentations.json"))
    parser.add_argument("--bundle", action="append", default=[])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--python-libs", type=Path)
    args = parser.parse_args()
    known = {row["id"].lower() for row in json.loads(args.catalog.read_text())["presentations"]}
    with zipfile.ZipFile(args.archive) as archive:
        entries = collections.defaultdict(list)
        for row in archive.infolist():
            key = spine_key(row.filename)
            if key:
                entries[key].append(row)
        if not args.bundle:
            print(json.dumps({"candidateFiles": sum(map(len, entries.values())), "candidateKeys": len(entries), "categories": dict(collections.Counter(key.split("/")[1] for key in entries)), "unindexedCandidates": sorted(key for key in entries if key.lower() not in known), "ambiguous": {key: [row.filename.split("/vercache_demo/", 1)[1] for row in rows] for key, rows in entries.items() if len(rows) > 1}}, indent=2))
            return
        if not args.output or not args.python_libs:
            parser.error("Conversion requires --output and --python-libs")
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(args.python_libs.resolve()))
        import UnityPy
        from extract_assets import BundleExtractor, write_json
        catalog_path = args.output / "extraction.json"
        bundles = json.loads(catalog_path.read_text())["bundles"] if catalog_path.exists() else []
        for requested in args.bundle:
            key = next((key for key in entries if key.lower() == requested.lower()), None)
            if key is None or len(entries[key]) != 1:
                raise ValueError("Requested bundle is absent or ambiguous: " + requested)
            destination = args.output / "spines" / key.removeprefix("Spines/")
            if destination.exists():
                raise ValueError("Conversion will not overwrite an existing bundle: " + key)
            raw = decode_bundle(archive.read(entries[key][0]))
            environment = UnityPy.load(raw)
            destination.mkdir(parents=True)
            result = BundleExtractor(environment, destination).extract()
            result.update(id=key, path=destination.relative_to(args.output).as_posix(), origin="original-archive")
            bundles.append(result)
            write_json(catalog_path, {"schema": 1, "bundles": bundles})
            print(json.dumps({"bundle": key, "skeletons": len(result["skeletons"]), "errors": result["errors"]}), flush=True)


if __name__ == "__main__":
    main()
