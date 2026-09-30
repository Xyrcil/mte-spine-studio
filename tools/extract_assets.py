"""Extract browser Spine resources through Unity object references."""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import struct
import sys
from pathlib import Path


def load_decoder(source: Path):
    path = source / "server/patch_local_data.py"
    spec = importlib.util.spec_from_file_location("mte_archive_decoder", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def precise_references(value):
    if isinstance(value, dict):
        return {key: str(item) if key == "m_PathID" else precise_references(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [precise_references(item) for item in value]
    return value


def binary_strings(data: bytes):
    offset = 0
    result = []
    for _ in range(2):
        length = 0
        shift = 0
        while True:
            byte = data[offset]
            offset += 1
            length |= (byte & 127) << shift
            if byte < 128:
                break
            shift += 7
            if shift > 28:
                raise ValueError("invalid skeleton header")
        result.append(data[offset:offset + max(0, length - 1)].decode("utf-8"))
        offset += max(0, length - 1)
    bounds = struct.unpack_from(">ffff", data, offset)
    return result[1], list(bounds)


def atlas_pages(text: str):
    pages = []
    previous_blank = True
    for line in text.splitlines():
        if line.strip() and previous_blank and not line[0].isspace() and ":" not in line:
            pages.append(line.strip())
        previous_blank = not line.strip()
    return pages


def safe_name(value: str):
    return re.sub(r"[^\w.-]+", "_", value)


class BundleExtractor:
    def __init__(self, environment, output: Path):
        self.environment = environment
        self.output = output
        self.trees = {}
        self.objects = list(environment.objects)
        self.references = []

    def tree(self, reader):
        key = (id(reader.assets_file), reader.path_id)
        if key not in self.trees:
            self.trees[key] = reader.read_typetree()
        return self.trees[key]

    def resolve(self, owner, pointer):
        from UnityPy.classes.PPtr import PPtr
        if not pointer or not pointer.get("m_PathID"):
            raise ValueError("null Unity reference")
        return PPtr(m_FileID=pointer["m_FileID"], m_PathID=pointer["m_PathID"], assetsfile=owner.assets_file).deref()

    def texture(self, owner, material_pointer):
        material = self.resolve(owner, material_pointer)
        tree = self.tree(material)
        envs = tree["m_SavedProperties"]["m_TexEnvs"]
        envs = dict(envs) if isinstance(envs, list) else envs
        texture = self.resolve(material, envs["_MainTex"]["m_Texture"])
        return texture.read(), tree

    def extract(self):
        skeletons = []
        hierarchy = []
        errors = []
        for reader in self.objects:
            if reader.type.name in ("GameObject", "Transform", "RectTransform", "MeshRenderer", "BoxCollider2D", "PolygonCollider2D", "CircleCollider2D", "MonoBehaviour", "MonoScript"):
                try:
                    hierarchy.append({"id": str(reader.path_id), "type": reader.type.name, "data": self.tree(reader)})
                except Exception as exc:
                    errors.append({"id": str(reader.path_id), "type": reader.type.name, "error": str(exc)})
            if reader.type.name != "MonoBehaviour":
                continue
            try:
                tree = self.tree(reader)
            except Exception:
                continue
            if "skeletonJSON" not in tree:
                continue
            folder = self.output / str(reader.path_id)
            folder.mkdir(parents=True, exist_ok=True)
            try:
                text_reader = self.resolve(reader, tree["skeletonJSON"])
                skeleton = text_reader.read()
                raw = skeleton.m_Script.encode("utf-8", errors="surrogateescape")
                is_json = raw.lstrip().startswith(b"{")
                filename = "skeleton.json" if is_json else "skeleton.skel"
                (folder / filename).write_bytes(raw)
                if is_json:
                    header = json.loads(raw).get("skeleton", {})
                    version = header.get("spine", "unknown")
                    bounds = [header.get(k, 0) for k in ("x", "y", "width", "height")]
                else:
                    version, bounds = binary_strings(raw)
                atlases = []
                for index, atlas_pointer in enumerate(tree["atlasAssets"]):
                    atlas_reader = self.resolve(reader, atlas_pointer)
                    atlas_tree = self.tree(atlas_reader)
                    atlas_text = self.resolve(atlas_reader, atlas_tree["atlasFile"]).read().m_Script
                    pages = atlas_pages(atlas_text)
                    materials = atlas_tree["materials"]
                    if len(pages) != len(materials):
                        raise ValueError(f"atlas has {len(pages)} pages but {len(materials)} materials")
                    atlas_folder = folder / f"atlas-{index}"
                    atlas_folder.mkdir(exist_ok=True)
                    names = []
                    material_settings = []
                    for page_index, (page, material) in enumerate(zip(pages, materials)):
                        texture, settings = self.texture(atlas_reader, material)
                        name = f"page-{page_index}.png"
                        texture.image.save(atlas_folder / name)
                        atlas_text = re.sub(r"(?m)^" + re.escape(page) + r"\r?$", name, atlas_text)
                        names.append(name)
                        material_settings.append(settings)
                    (atlas_folder / "texture.atlas").write_text(atlas_text, encoding="utf-8")
                    write_json(atlas_folder / "materials.json", material_settings)
                    atlases.append({"atlas": f"atlas-{index}/texture.atlas", "pages": names})
                skeletons.append({"id": str(reader.path_id), "name": tree.get("m_Name"), "skeleton": f"{reader.path_id}/{filename}", "version": version, "bounds": bounds, "scale": tree.get("scale", 1), "defaultMix": tree.get("defaultMix", 0), "atlases": atlases, "mixes": {k: tree.get(k, []) for k in ("fromAnimation", "toAnimation", "duration")}})
            except Exception as exc:
                errors.append({"id": str(reader.path_id), "type": "SkeletonDataAsset", "error": str(exc)})
        write_json(self.output / "hierarchy.json", precise_references(hierarchy))
        return {"skeletons": skeletons, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/assets"))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--match", default="")
    args = parser.parse_args()
    source = args.source.resolve()
    sys.path.insert(0, str(source / "tools/python-libs"))
    import UnityPy
    decoder = load_decoder(source)
    roots = [source / "full-files/files", source / "qnzl-2.0-poc/overlay"]
    records = {}
    for root in roots:
        framework = root / "FrameworkList.dat"
        if framework.exists():
            for record in decoder.iter_local_records(framework.read_bytes()):
                records[record.resource_name] = record
    candidates = {}
    for root in roots:
        for path in sorted((root / "Spines").rglob("*.dat")):
            key = path.relative_to(root).with_suffix("").as_posix()
            if args.match in key:
                candidates[key] = path
    catalog = []
    for key, path in list(candidates.items())[:args.limit]:
        destination = args.output / "spines" / key.removeprefix("Spines/")
        try:
            raw = path.read_bytes()
            if not raw.startswith(b"UnityFS"):
                record = records[key]
                raw = decoder.xor_prefix(raw, record.hash_code)
            environment = UnityPy.load(raw)
            destination.mkdir(parents=True, exist_ok=True)
            result = BundleExtractor(environment, destination).extract()
            result.update(id=key, path=destination.relative_to(args.output).as_posix())
            catalog.append(result)
            print(key, "skeletons", len(result["skeletons"]), "errors", len(result["errors"]), flush=True)
        except Exception as exc:
            catalog.append({"id": key, "skeletons": [], "errors": [{"type": "Bundle", "error": str(exc)}]})
            print(key, str(exc), flush=True)
        write_json(args.output / "extraction.json", {"schema": 1, "bundles": catalog})


if __name__ == "__main__":
    main()
