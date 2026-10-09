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


def output_destination(root, identifier):
    destination = Path(root)
    for part in ("spines", *PurePosixPath(identifier.removeprefix("Spines/")).parts):
        matches = [child.name for child in destination.iterdir() if child.name.casefold() == part.casefold()] if destination.is_dir() else []
        if len(matches) > 1:
            raise ValueError("Ambiguous output directory casing")
        destination /= matches[0] if matches else part
    return destination


def missing_paintings(entries, known):
    known = {key.lower() for key in known}
    candidates = sorted(key for key in entries if key.startswith("Spines/painting/") and key.lower() not in known)
    return [key for key in candidates if len(entries[key]) == 1], [key for key in candidates if len(entries[key]) != 1]


def sanitize_diagnostics(value):
    if isinstance(value, list):
        return [sanitize_diagnostics(item) for item in value]
    if isinstance(value, dict):
        def clean(item):
            if isinstance(item, str):
                return re.sub(r"(?:/Users/|/home/|/private/|/tmp/|/var/|[A-Za-z]:\\)[^\n]*", "<local path>", item)
            if isinstance(item, list):
                return [clean(child) for child in item]
            return sanitize_diagnostics(item)
        return {key: clean(item) if key in ("error", "errors", "warnings") else sanitize_diagnostics(item) for key, item in value.items()}
    return value


def source_versions(key, rows, include_all=False, variant=None):
    if variant is not None:
        if include_all or len(rows) != 1 or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", variant):
            raise ValueError("A named variant requires one unambiguous bundle and a lowercase name")
        return [(key + "/" + variant, rows[0], variant)]
    if len(rows) != 1 and not include_all:
        raise ValueError("Requested bundle is ambiguous: " + key)
    if len(rows) == 1:
        return [(key, rows[0], None)]
    ordered = sorted(rows, key=lambda row: row.filename)
    return [(f"{key}/archive-{index}", row, index) for index, row in enumerate(ordered, 1)]


def scene_metadata_changes(original, installed):
    def normalized(nodes):
        scripts = {node["id"]: {key: node["data"].get(key) for key in ("m_ClassName", "m_Namespace", "m_AssemblyName")} for node in nodes if node["type"] == "MonoScript"}
        result = {}
        for node in nodes:
            if node["type"] == "MonoScript":
                continue
            data = dict(node["data"])
            if node["type"] == "AnimationClip":
                data.pop("packedCurves", None)
            pointer = data.get("m_Script")
            if pointer and pointer.get("m_FileID") == 0 and str(pointer.get("m_PathID")) in scripts:
                data["m_Script"] = scripts[str(pointer["m_PathID"])]
            result[(node["id"], node["type"])] = data
        return result
    left, right = normalized(original), normalized(installed)
    changes = []
    for key in sorted(left.keys() | right.keys()):
        if key not in left or key not in right:
            changes.append({"id": key[0], "type": key[1], "status": "removed" if key not in left else "added"})
        elif left[key] != right[key]:
            fields = sorted(name for name in left[key].keys() | right[key].keys() if name not in left[key] or name not in right[key] or left[key][name] != right[key][name])
            changes.append({"id": key[0], "type": key[1], "status": "changed", "fields": fields})
    return changes


def installed_scene_version(key, version, presentations):
    primary = next((row for row in presentations if row["id"].lower() == key.lower()), None)
    if primary:
        return primary
    return next((row for row in presentations if row.get("sourceBundle", "").lower() == key.lower() and row.get("sourceVersion") == version), None)


def compare_scene_metadata(archive, entries, catalog_path, requested, python_libs):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(python_libs.resolve()))
    import UnityPy
    from extract_assets import precise_references
    catalog = json.loads(catalog_path.read_text())["presentations"]
    wanted = {value.lower() for value in requested}
    if wanted.difference(key.lower() for key in entries):
        raise ValueError("Requested comparison bundle is absent")
    types = {"GameObject", "Transform", "RectTransform", "MeshRenderer", "BoxCollider2D", "PolygonCollider2D", "CircleCollider2D", "MonoBehaviour", "MonoScript", "ParticleSystem", "ParticleSystemRenderer", "Animation", "AnimationClip", "Animator", "AnimatorController", "AnimatorOverrideController", "CanvasGroup", "SortingGroup"}
    counts = collections.Counter()
    for key, versions in sorted(entries.items()):
        if wanted and key.lower() not in wanted:
            continue
        for version, member in enumerate(sorted(versions, key=lambda row: row.filename), 1):
            installed = installed_scene_version(key, version, catalog)
            if not installed or not installed.get("path"):
                counts["withoutInstalledVersion"] += 1
                print(json.dumps({"bundle": key, "version": version, "status": "without-installed-version"}), flush=True)
                continue
            try:
                location = (catalog_path.parent / installed["path"] / "hierarchy.json").resolve()
                location.relative_to(catalog_path.parent.resolve())
                baseline = json.loads(location.read_text())
                environment = UnityPy.load(decode_bundle(archive.read(member)))
                nodes = [{"id": str(reader.path_id), "type": reader.type.name, "data": precise_references(reader.read_typetree())} for reader in environment.objects if reader.type.name in types]
                changes = scene_metadata_changes(nodes, baseline)
                counts["compared"] += 1
                counts["changed" if changes else "equal"] += 1
                print(json.dumps({"bundle": key, "version": version, "installed": installed["id"], "changes": changes}), flush=True)
            except Exception as error:
                counts["failed"] += 1
                print(json.dumps(sanitize_diagnostics({"bundle": key, "version": version, "error": str(error)})), flush=True)
    print(json.dumps({"scope": "scene-metadata-only", "summary": dict(counts)}), flush=True)
    if counts["failed"]:
        raise RuntimeError("Some original scene metadata could not be compared")


def manifest_dependencies(text):
    result, active = [], False
    for line in text.splitlines():
        if line.strip() == "Dependencies:":
            active = True
            continue
        if not active or not line.startswith("-"):
            continue
        value = line[1:].strip().replace("\\", "/")
        parts = re.split(r"/StreamingAssets/", value, maxsplit=1, flags=re.IGNORECASE)
        relative = parts[-1]
        if ":" in relative or "\\" in relative or any(part in ("", ".", "..") for part in relative.split("/")):
            raise ValueError("Invalid manifest dependency")
        if not relative.endswith(".data"):
            raise ValueError("Unsupported manifest dependency")
        result.append(relative.lower())
    return result


def load_dependencies(environment, archive, member, apk=None, additional=()):
    prefix = member.split("/vercache_demo/", 1)[0] + "/vercache_demo/"
    source_names = {name.lower(): name for name in archive.namelist()}
    apk_names = {name.lower(): name for name in apk.namelist()} if apk else {}
    pending, loaded = [(archive, member)], set()
    while pending:
        container, name = pending.pop()
        manifest = name + ".manifest"
        dependencies = manifest_dependencies(container.read(manifest).decode("utf-8")) if manifest in container.namelist() else []
        if container is archive and name == member:
            dependencies.extend(manifest_dependencies("Dependencies:\n" + "\n".join("- " + value for value in additional)))
        for relative in dependencies:
            if relative in loaded:
                continue
            loaded.add(relative)
            source_name, apk_name = source_names.get((prefix + relative).lower()), apk_names.get("assets/" + relative)
            dependency, dependency_name = (archive, source_name) if source_name else (apk, apk_name)
            if not dependency or not dependency_name:
                raise ValueError("Original dependency is absent: " + relative)
            environment.load_file(decode_bundle(dependency.read(dependency_name)), name=relative, is_dependency=True)
            pending.append((dependency, dependency_name))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, default=Path("public/assets/presentations.json"))
    parser.add_argument("--bundle", action="append", default=[])
    parser.add_argument("--missing-paintings", action="store_true", help="Convert all unindexed painting bundles with unambiguous source entries")
    parser.add_argument("--all-versions", action="store_true", help="Preserve every source entry of an explicitly selected ambiguous bundle")
    parser.add_argument("--variant", help="Keep an explicitly selected original bundle under a separate named variant")
    parser.add_argument("--compare-scenes", action="store_true", help="Compare original scene metadata without exporting textures or replacing resources")
    parser.add_argument("--dependency", action="append", default=[], help="Add a verified relative resource dependency when the original manifest is absent")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--python-libs", type=Path)
    parser.add_argument("--apk", type=Path, help="Read original shared shaders from the client archive without extracting client code")
    args = parser.parse_args()
    known = {(row.get("sourceBundle") or row["id"]).lower() for row in json.loads(args.catalog.read_text())["presentations"]}
    if args.all_versions and (len(args.bundle) != 1 or args.missing_paintings):
        parser.error("--all-versions requires one explicit --bundle")
    if args.variant is not None and (len(args.bundle) != 1 or args.missing_paintings or args.all_versions):
        parser.error("--variant requires one explicit --bundle without --all-versions")
    with zipfile.ZipFile(args.archive) as archive:
        entries = collections.defaultdict(list)
        for row in archive.infolist():
            key = spine_key(row.filename)
            if key:
                entries[key].append(row)
        requested_bundles = args.bundle
        if args.compare_scenes:
            if not args.python_libs or args.output or args.missing_paintings or args.all_versions or args.variant:
                parser.error("--compare-scenes requires --python-libs and does not accept conversion options")
            compare_scene_metadata(archive, entries, args.catalog, requested_bundles, args.python_libs)
            return
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
            selected.extend((identifier, row, version, key) for identifier, row, version in source_versions(key, entries[key], args.all_versions, args.variant))
        for identifier, row, version, key in selected:
            destination = output_destination(args.output, identifier)
            if destination.exists():
                raise ValueError("Conversion will not overwrite an existing bundle: " + key)
            raw = decode_bundle(archive.read(row))
            environment = UnityPy.load(raw)
            extractor = BundleExtractor(environment, destination)
            if shader_bytes:
                environment.load_file(shader_bytes, name="shared-shaders", is_dependency=True)
            if args.apk:
                with zipfile.ZipFile(args.apk) as apk:
                    load_dependencies(environment, archive, row.filename, apk, args.dependency)
            else:
                load_dependencies(environment, archive, row.filename, additional=args.dependency)
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
