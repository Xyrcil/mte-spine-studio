"""Inspect original Unity bundles for artwork effect components and references."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

if __package__:
    from .extract_assets import load_decoder
else:
    from extract_assets import load_decoder

EFFECT_COMPONENTS = {"ParticleSystem", "ParticleSystemRenderer", "Animator", "Animation", "AnimationClip", "SpriteRenderer", "SkinnedMeshRenderer", "TrailRenderer", "LineRenderer"}


def inspect(environment, details=False):
    counts = Counter(reader.type.name for reader in environment.objects)
    references, components, errors = [], [], []
    for reader in environment.objects:
        kind = reader.type.name
        if kind not in EFFECT_COMPONENTS and kind != "MonoBehaviour":
            continue
        try:
            tree = reader.read_typetree()
            if kind in EFFECT_COMPONENTS:
                row = {"id": str(reader.path_id), "type": kind, "name": tree.get("m_Name", ""), "owner": str(tree.get("m_GameObject", {}).get("m_PathID", "0"))}
                if details:
                    row["keys"] = list(tree)
                    row["modules"] = {key: {"enabled": value.get("enabled"), "keys": list(value)} for key, value in tree.items() if isinstance(value, dict) and "Module" in key}
                    row["settings"] = {key: value for key, value in tree.items() if not isinstance(value, (dict, list, bytes))}
                components.append(row)
            for row in tree.get("OtherEffectList", []):
                pointer = row.get("Obj", {})
                references.append({"controller": str(reader.path_id), "event": row.get("Key"), "duration": row.get("Time"), "file": pointer.get("m_FileID"), "object": str(pointer.get("m_PathID", "0"))})
        except Exception as error:
            errors.append({"id": str(reader.path_id), "type": kind, "error": str(error)})
    return {"types": dict(counts), "components": components, "references": references, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--category", choices=["Spines", "Effects", "UI"], default="Spines")
    parser.add_argument("--match", default="")
    parser.add_argument("--details", action="store_true")
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    source = args.source.resolve()
    sys.path.insert(0, str(source / "tools/python-libs"))
    import UnityPy
    decoder = load_decoder(source)
    roots = [source / "full-files/files", source / "qnzl-2.0-poc/overlay"]
    records, candidates = {}, {}
    for root in roots:
        framework = root / "FrameworkList.dat"
        if framework.exists():
            records.update((record.resource_name, record) for record in decoder.iter_local_records(framework.read_bytes()))
        for path in sorted((root / args.category).rglob("*.dat")):
            key = path.relative_to(root).with_suffix("").as_posix()
            if args.match in key:
                candidates[key] = path
    total = Counter()
    component_bundles, reference_count, failures = 0, 0, []
    for index, (key, path) in enumerate(candidates.items(), 1):
        try:
            raw = path.read_bytes()
            if not raw.startswith(b"UnityFS"):
                raw = decoder.xor_prefix(raw, records[key].hash_code)
            result = inspect(UnityPy.load(raw), args.details)
            total.update(result["types"])
            reference_count += len(result["references"])
            component_bundles += bool(result["components"])
            if result["components"] or result["references"] or result["errors"]:
                print(json.dumps({"bundle": key, **result}, ensure_ascii=False), flush=True)
            if result["errors"]:
                failures.append(key)
        except Exception as error:
            failures.append(key)
            print(json.dumps({"bundle": key, "error": str(error)}), flush=True)
        if index % 25 == 0:
            print(json.dumps({"checked": index, "total": len(candidates)}), flush=True)
    print(json.dumps({"bundles": len(candidates), "types": dict(total), "effectComponentBundles": component_bundles, "effectReferences": reference_count, "failed": failures}), flush=True)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
