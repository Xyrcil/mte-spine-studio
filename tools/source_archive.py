"""Inspect original resource archives or convert selected Spine bundles locally."""
import argparse
import collections
import json
import re
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


def missing_paintings(entries, known):
    known = {key.lower() for key in known}
    candidates = sorted(key for key in entries if key.startswith("Spines/painting/") and key.lower() not in known)
    return [key for key in candidates if len(entries[key]) == 1], [key for key in candidates if len(entries[key]) != 1]


def sanitize_diagnostics(value):
    if isinstance(value, list):
        return [sanitize_diagnostics(item) for item in value]
    if isinstance(value, dict):
        return {key: re.sub(r"(?:/Users/|/home/|/private/|/tmp/|[A-Za-z]:\\)[^\n]*", "<local path>", item) if key == "error" and isinstance(item, str) else sanitize_diagnostics(item) for key, item in value.items()}
    return value


def source_versions(key, rows, include_all=False):
    if len(rows) != 1 and not include_all:
        raise ValueError("Requested bundle is ambiguous: " + key)
    if len(rows) == 1:
        return [(key, rows[0], None)]
    ordered = sorted(rows, key=lambda row: row.filename)
    return [(f"{key}/archive-{index}", row, index) for index, row in enumerate(ordered, 1)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, default=Path("public/assets/presentations.json"))
    parser.add_argument("--bundle", action="append", default=[])
    parser.add_argument("--missing-paintings", action="store_true", help="Convert all unindexed painting bundles with unambiguous source entries")
    parser.add_argument("--all-versions", action="store_true", help="Preserve every source entry of an explicitly selected ambiguous bundle")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--python-libs", type=Path)
    parser.add_argument("--apk", type=Path, help="Read original shared shaders from the client archive without extracting client code")
    args = parser.parse_args()
    known = {(row.get("sourceBundle") or row["id"]).lower() for row in json.loads(args.catalog.read_text())["presentations"]}
    if args.all_versions and (len(args.bundle) != 1 or args.missing_paintings):
        parser.error("--all-versions requires one explicit --bundle")
    with zipfile.ZipFile(args.archive) as archive:
        entries = collections.defaultdict(list)
        for row in archive.infolist():
            key = spine_key(row.filename)
            if key:
                entries[key].append(row)
        requested_bundles = args.bundle
        if args.missing_paintings:
            if args.bundle:
                parser.error("Use --bundle or --missing-paintings, not both")
            requested_bundles, ambiguous = missing_paintings(entries, known)
            print(json.dumps({"selected": len(requested_bundles), "ambiguous": ambiguous}), flush=True)
        if not requested_bundles and not args.missing_paintings:
            print(json.dumps({"candidateFiles": sum(map(len, entries.values())), "candidateKeys": len(entries), "categories": dict(collections.Counter(key.split("/")[1] for key in entries)), "unindexedCandidates": sorted(key for key in entries if key.lower() not in known), "ambiguous": {key: [row.filename.split("/vercache_demo/", 1)[1] for row in rows] for key, rows in entries.items() if len(rows) > 1}}, indent=2))
            return
        if not args.output or not args.python_libs:
            parser.error("Conversion requires --output and --python-libs")
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(args.python_libs.resolve()))
        import UnityPy
        from extract_assets import BundleExtractor, write_json
        shader_bytes = None
        if args.apk:
            with zipfile.ZipFile(args.apk) as apk:
                shader_bytes = decode_bundle(apk.read("assets/common/shader.data"))
        catalog_path = args.output / "extraction.json"
        bundles = json.loads(catalog_path.read_text())["bundles"] if catalog_path.exists() else []
        selected = []
        for requested in requested_bundles:
            key = next((key for key in entries if key.lower() == requested.lower()), None)
            if key is None:
                raise ValueError("Requested bundle is absent: " + requested)
            selected.extend((identifier, row, version, key) for identifier, row, version in source_versions(key, entries[key], args.all_versions))
        for identifier, row, version, key in selected:
            destination = args.output / "spines" / identifier.removeprefix("Spines/")
            if destination.exists():
                raise ValueError("Conversion will not overwrite an existing bundle: " + key)
            raw = decode_bundle(archive.read(row))
            environment = UnityPy.load(raw)
            extractor = BundleExtractor(environment, destination)
            if shader_bytes:
                environment.load_file(shader_bytes, name="shared-shaders", is_dependency=True)
            destination.mkdir(parents=True)
            result = sanitize_diagnostics(extractor.extract())
            result.update(id=identifier, path=destination.relative_to(args.output).as_posix(), origin="original-archive")
            if version is not None:
                result.update(sourceBundle=key, sourceVersion=version)
            bundles.append(result)
            write_json(catalog_path, {"schema": 1, "bundles": bundles})
            print(json.dumps({"bundle": identifier, "skeletons": len(result["skeletons"]), "errors": result["errors"]}), flush=True)


if __name__ == "__main__":
    main()
