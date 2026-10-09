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
    exact = next((row for row in presentations if row.get("sourceBundle", "").lower() == key.lower() and row.get("sourceVersion") == version), None)
    if exact:
        return exact
    originals = [row for row in presentations if row.get("sourceBundle", "").lower() == key.lower() and row.get("sourceVersion") == "original"] if version == 1 else []
    return originals[0] if len(originals) == 1 else None


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


def skeleton_media_changes(extractor, installed, root, load_image=None):
    from extract_assets import atlas_pages
    if load_image is None:
        from PIL import Image
        load_image = Image.open
    by_id = {entry["id"]: entry for entry in installed}
    found, changes = set(), []
    def local(entry, path):
        location = (root / entry["path"] / path).resolve()
        location.relative_to(root.resolve())
        return location
    readers = list(extractor.objects)
    for reader in readers:
        if reader.type.name != "MonoBehaviour":
            continue
        tree = extractor.tree(reader)
        pointer = tree.get("skeletonDataAsset", {})
        if pointer.get("m_FileID") and pointer.get("m_PathID"):
            target = extractor.resolve(reader, pointer)
            if target.type.name != "MonoBehaviour" or "skeletonJSON" not in extractor.tree(target):
                raise ValueError("External skeleton reference does not resolve to a SkeletonDataAsset")
            matches = [item for item in readers if item.path_id == target.path_id]
            if any(item.assets_file is not target.assets_file for item in matches):
                raise ValueError("External skeleton ID collides with a different serialized file")
            if not matches:
                readers.append(target)
        if "skeletonJSON" not in tree:
            continue
        identifier = str(reader.path_id)
        found.add(identifier)
        entry = by_id.get(identifier)
        if not entry:
            changes.append({"id": identifier, "kind": "unindexed-skeleton"})
            continue
        text = extractor.resolve(reader, tree["skeletonJSON"]).read().m_Script
        if text.encode("utf-8", errors="surrogateescape") != local(entry, entry["skeleton"]).read_bytes():
            changes.append({"id": identifier, "kind": "skeleton-bytes"})
        settings = {"scale": tree.get("scale", 1), "defaultMix": tree.get("defaultMix", 0), "mixes": {name: tree.get(name, []) for name in ("fromAnimation", "toAnimation", "duration")}}
        if any(entry.get(name) != value for name, value in settings.items()):
            changes.append({"id": identifier, "kind": "skeleton-settings"})
        pointers = tree.get("atlasAssets", [])
        if len(pointers) != len(entry["atlases"]):
            changes.append({"id": identifier, "kind": "atlas-count"})
            continue
        for index, pointer in enumerate(pointers):
            atlas = extractor.resolve(reader, pointer)
            data = extractor.tree(atlas)
            text = extractor.resolve(atlas, data["atlasFile"]).read().m_Script
            pages = atlas_pages(text)
            converted = entry["atlases"][index]
            atlas_path = PurePosixPath(entry["id"]) / converted["atlas"]
            if len(pages) != len(converted["pages"]) or len(pages) != len(data["materials"]):
                changes.append({"id": identifier, "kind": "atlas-pages", "atlas": index})
                continue
            for page, original_name in enumerate(pages):
                text = re.sub(r"(?m)^" + re.escape(original_name) + r"\r?$", converted["pages"][page], text)
                texture, _settings = extractor.texture(atlas, data["materials"][page])
                source = texture.image.convert("RGBA")
                with load_image(local(entry, str(atlas_path.parent / converted["pages"][page]))) as image:
                    target = image.convert("RGBA")
                    if source.size != target.size or source.tobytes() != target.tobytes():
                        changes.append({"id": identifier, "kind": "atlas-pixels", "atlas": index, "page": page})
            if text.encode("utf-8") != local(entry, str(atlas_path)).read_bytes():
                changes.append({"id": identifier, "kind": "atlas-layout", "atlas": index})
    changes.extend({"id": identifier, "kind": "not-in-original-bundle"} for identifier in sorted(by_id.keys() - found))
    return changes


def compare_skeleton_media(archive, entries, catalog_path, requested, python_libs, apk_path=None, additional=()):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(python_libs.resolve()))
    import UnityPy
    from extract_assets import BundleExtractor
    catalog = json.loads(catalog_path.read_text())["presentations"]
    runtime = json.loads((catalog_path.parent / "runtime-index.json").read_text())["entries"]
    wanted = {value.lower() for value in requested}
    if wanted.difference(key.lower() for key in entries):
        raise ValueError("Requested comparison bundle is absent")
    counts = collections.Counter()
    for key, versions in sorted(entries.items()):
        if wanted and key.lower() not in wanted:
            continue
        for version, member in enumerate(sorted(versions, key=lambda row: row.filename), 1):
            installed = installed_scene_version(key, version, catalog)
            if not installed:
                counts["withoutInstalledVersion"] += 1
                print(json.dumps({"bundle": key, "version": version, "status": "without-installed-version"}), flush=True)
                continue
            try:
                environment = UnityPy.load(decode_bundle(archive.read(member)))
                if apk_path:
                    with zipfile.ZipFile(apk_path) as apk:
                        load_dependencies(environment, archive, member.filename, apk, additional)
                else:
                    load_dependencies(environment, archive, member.filename, additional=additional)
                baseline = [entry for entry in runtime if entry["bundle"] == installed["id"]]
                changes = skeleton_media_changes(BundleExtractor(environment, catalog_path.parent), baseline, catalog_path.parent)
                counts["compared"] += 1
                counts["changed" if changes else "equal"] += 1
                print(json.dumps({"bundle": key, "version": version, "installed": installed["id"], "changes": changes}), flush=True)
            except Exception as error:
                counts["failed"] += 1
                print(json.dumps(sanitize_diagnostics({"bundle": key, "version": version, "error": str(error)})), flush=True)
    print(json.dumps({"scope": "skeleton-bytes-settings-atlas-layout-and-base-pixels", "summary": dict(counts)}), flush=True)
    if counts["failed"]:
        raise RuntimeError("Some original skeleton media could not be compared")


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
    parser.add_argument("--compare-media", action="store_true", help="Compare original skeleton bytes, settings, atlas layout and base texture pixels without writing resources")
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
        if args.compare_scenes or args.compare_media:
            if not args.python_libs or args.output or args.missing_paintings or args.all_versions or args.variant or args.compare_scenes and args.compare_media:
                parser.error("Choose one comparison mode with --python-libs and without conversion options")
            if args.compare_media:
                compare_skeleton_media(archive, entries, args.catalog, requested_bundles, args.python_libs, args.apk, args.dependency)
            else:
                if args.apk or args.dependency:
                    parser.error("Scene metadata comparison does not read media dependencies")
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
