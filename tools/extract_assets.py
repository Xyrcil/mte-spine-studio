"""Extract browser Spine resources through Unity object references."""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
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
    temporary.write_text(json.dumps(precise_references(data), ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def precise_references(value):
    if isinstance(value, float) and not math.isfinite(value):
        return "NaN" if math.isnan(value) else "Infinity" if value > 0 else "-Infinity"
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


def resource_bundle_key(value: str):
    if not value or "\\" in value or any(part in ("", ".", "..") for part in value.split("/")) or ":" in value:
        raise argparse.ArgumentTypeError("Bundle names must be relative resource keys without traversal")
    return value


def shader_render_queue(shader):
    subshaders = shader.get("m_ParsedForm", {}).get("m_SubShaders", [])
    if not subshaders:
        return None
    tags = dict(subshaders[0].get("m_Tags", {}).get("tags", []))
    tag = next((value for key, value in tags.items() if key.lower() == "queue"), None)
    match = re.fullmatch(r"(Background|Geometry|AlphaTest|Transparent|Overlay)([+-]\d+)?", tag or "")
    if not match:
        return None
    return {"Background": 1000, "Geometry": 2000, "AlphaTest": 2450, "Transparent": 3000, "Overlay": 4000}[match[1]] + int(match[2] or 0)


class BundleExtractor:
    def __init__(self, environment, output: Path):
        self.environment = environment
        self.output = output
        self.trees = {}
        self.objects = list(environment.objects)
        self.references = []
        self.effect_textures = {}
        self.effect_sprites = {}

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

    def effect_texture(self, owner, pointer):
        reader = self.resolve(owner, pointer)
        key = (id(reader.assets_file), reader.path_id)
        if key in self.effect_textures:
            return self.effect_textures[key]
        texture = reader.read()
        destination = self.output / "effects/textures" / f"{reader.path_id}.png"
        destination.parent.mkdir(parents=True, exist_ok=True)
        texture.image.save(destination)
        tree = self.tree(reader)
        result = {"id": str(reader.path_id), "path": destination.relative_to(self.output).as_posix(), "width": texture.m_Width, "height": texture.m_Height, "settings": tree.get("m_TextureSettings"), "colorSpace": tree.get("m_ColorSpace")}
        self.effect_textures[key] = result
        return result

    def effect_material(self, owner, pointer):
        reader = self.resolve(owner, pointer)
        tree = self.tree(reader)
        shader = self.tree(self.resolve(reader, tree["m_Shader"]))
        shader_name = shader.get("m_Name") or shader.get("m_ParsedForm", {}).get("m_Name") or shader.get("m_ParsedForm", {}).get("name", "")
        settings = tree.get("m_SavedProperties", {})
        envs = settings.get("m_TexEnvs", [])
        envs = dict(envs) if isinstance(envs, list) else envs
        textures = {}
        for name, value in envs.items():
            if value.get("m_Texture", {}).get("m_PathID"):
                textures[name] = {**self.effect_texture(reader, value["m_Texture"]), "scale": value.get("m_Scale"), "offset": value.get("m_Offset")}
        keywords = tree.get("m_ValidKeywords", tree.get("m_ShaderKeywords", ""))
        if isinstance(keywords, str):
            keywords = keywords.split()
        return {"id": str(reader.path_id), "name": tree.get("m_Name", ""), "shader": shader_name, "keywords": sorted(set(keywords)), "renderQueue": tree.get("m_CustomRenderQueue", -1), "disabledPasses": tree.get("disabledShaderPasses", []), "tags": precise_references(tree.get("stringTagMap", [])), "instancing": bool(tree.get("m_EnableInstancingVariants", False)), "properties": precise_references(settings), "textures": textures}

    def effect_sprite(self, owner, pointer):
        reader = self.resolve(owner, pointer)
        key = (id(reader.assets_file), reader.path_id)
        if key in self.effect_sprites:
            return self.effect_sprites[key]
        sprite = reader.read()
        destination = self.output / "effects/sprites" / f"{reader.path_id}.png"
        destination.parent.mkdir(parents=True, exist_ok=True)
        image = sprite.image
        image.save(destination)
        tree = self.tree(reader)
        result = {"id": str(reader.path_id), "path": destination.relative_to(self.output).as_posix(), "width": image.width, "height": image.height, "rect": tree.get("m_Rect"), "pivot": tree.get("m_Pivot"), "pixelsPerUnit": tree.get("m_PixelsToUnits")}
        self.effect_sprites[key] = result
        return result

    def extract_images(self):
        entries = []
        for reader in self.objects:
            if reader.type.name != "MonoBehaviour":
                continue
            try:
                tree = self.tree(reader)
            except Exception:
                continue
            if "m_Sprite" not in tree or "m_Color" not in tree:
                continue
            errors, sprite, material = [], None, None
            for kind, pointer, resolve in [("Sprite", tree["m_Sprite"], self.effect_sprite), ("Material", tree.get("m_Material", {}), self.effect_material)]:
                if not pointer.get("m_PathID"):
                    continue
                try:
                    result = resolve(reader, pointer)
                    if kind == "Sprite":
                        sprite = result
                    else:
                        material = result
                except Exception as error:
                    errors.append({"type": kind, "reference": precise_references(pointer), "error": str(error)})
            entries.append({"id": str(reader.path_id), "gameObject": str(tree["m_GameObject"]["m_PathID"]), "data": precise_references(tree), "sprite": sprite, "material": material, "status": "partial" if errors else "extracted", "errors": errors})
        return entries

    def extract_renderers(self):
        entries = []
        for reader in self.objects:
            if reader.type.name != "MeshRenderer":
                continue
            tree = self.tree(reader)
            materials, errors = [], []
            for pointer in tree.get("m_Materials", []):
                if not pointer.get("m_PathID"):
                    continue
                try:
                    material = self.resolve(reader, pointer)
                    data = self.tree(material)
                    queue = data.get("m_CustomRenderQueue", -1)
                    if queue < 0:
                        try:
                            queue = shader_render_queue(self.tree(self.resolve(material, data["m_Shader"])))
                        except Exception:
                            queue = None
                    materials.append({"id": str(material.path_id), "renderQueue": queue, "customRenderQueue": data.get("m_CustomRenderQueue", -1)})
                except Exception as error:
                    errors.append({"type": "Material", "reference": precise_references(pointer), "error": str(error)})
            entries.append({"id": str(reader.path_id), "gameObject": str(tree["m_GameObject"]["m_PathID"]), "materials": materials, "errors": errors})
        return entries

    def skeleton_materials(self, reader):
        tree = self.tree(reader)
        pages, errors = [], []
        for atlas_index, pointer in enumerate(tree.get("atlasAssets", [])):
            try:
                atlas = self.resolve(reader, pointer)
                atlas_tree = self.tree(atlas)
                text = self.resolve(atlas, atlas_tree["atlasFile"]).read().m_Script
                names = atlas_pages(text)
                for index, name in enumerate(names):
                    mappings = {"normal": (atlas, atlas_tree["materials"][index])}
                    blend = tree.get("blendModeMaterials", {})
                    for mode in ("additive", "multiply", "screen"):
                        match = next((row for row in blend.get(mode + "Materials", []) if row["pageName"] == name), None)
                        if match:
                            mappings[mode] = (reader, match["material"])
                    materials = {}
                    for mode, (owner, reference) in mappings.items():
                        material = self.resolve(owner, reference)
                        data = self.tree(material)
                        queue = data.get("m_CustomRenderQueue", -1)
                        if queue < 0:
                            queue = shader_render_queue(self.tree(self.resolve(material, data["m_Shader"])))
                        materials[mode] = {"id": str(material.path_id), "renderQueue": queue}
                    pages.append({"atlas": atlas_index, "page": f"page-{index}.png", "sourcePage": name, "materials": materials})
            except Exception as error:
                errors.append({"atlas": atlas_index, "error": str(error)})
        return {"pages": pages, "errors": errors}

    def extract_effects(self):
        entries = []
        for reader in self.objects:
            if reader.type.name != "ParticleSystem":
                continue
            errors = []
            try:
                tree = self.tree(reader)
                owner_id = tree["m_GameObject"]["m_PathID"]
                owner = self.resolve(reader, tree["m_GameObject"])
                game_object = self.tree(owner)
                renderer = next((obj for obj in self.objects if obj.type.name == "ParticleSystemRenderer" and self.tree(obj).get("m_GameObject", {}).get("m_PathID") == owner_id), None)
                renderer_tree = self.tree(renderer) if renderer else None
                materials, sprites = [], []
                for pointer in (renderer_tree or {}).get("m_Materials", []):
                    try:
                        materials.append(self.effect_material(renderer, pointer))
                    except Exception as error:
                        errors.append({"type": "Material", "reference": precise_references(pointer), "error": str(error)})
                for item in tree.get("UVModule", {}).get("sprites", []):
                    pointer = item.get("sprite", item)
                    if not pointer.get("m_PathID"):
                        continue
                    try:
                        sprites.append(self.effect_sprite(reader, pointer))
                    except Exception as error:
                        errors.append({"type": "Sprite", "reference": precise_references(pointer), "error": str(error)})
                entries.append({"id": str(reader.path_id), "gameObject": str(owner_id), "name": game_object.get("m_Name", ""), "data": precise_references(tree), "renderer": precise_references(renderer_tree), "materials": materials, "sprites": sprites, "status": "partial" if errors else "extracted", "errors": errors})
            except Exception as error:
                entries.append({"id": str(reader.path_id), "status": "failed", "errors": [{"type": "ParticleSystem", "error": str(error)}]})
        return entries

    def extract(self):
        skeletons = []
        hierarchy = []
        errors = []
        for reader in self.objects:
            if reader.type.name in ("GameObject", "Transform", "RectTransform", "MeshRenderer", "BoxCollider2D", "PolygonCollider2D", "CircleCollider2D", "MonoBehaviour", "MonoScript", "ParticleSystem", "ParticleSystemRenderer", "Animation", "AnimationClip", "Animator", "AnimatorController", "AnimatorOverrideController", "CanvasGroup", "SortingGroup"):
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
                skeletons.append({"id": str(reader.path_id), "name": tree.get("m_Name"), "skeleton": f"{reader.path_id}/{filename}", "version": version, "bounds": bounds, "scale": tree.get("scale", 1), "defaultMix": tree.get("defaultMix", 0), "atlases": atlases, "materialBindings": self.skeleton_materials(reader), "mixes": {k: tree.get(k, []) for k in ("fromAnimation", "toAnimation", "duration")}})
            except Exception as exc:
                errors.append({"id": str(reader.path_id), "type": "SkeletonDataAsset", "error": str(exc)})
        write_json(self.output / "hierarchy.json", precise_references(hierarchy))
        return {"skeletons": skeletons, "effects": self.extract_effects(), "images": self.extract_images(), "renderers": self.extract_renderers(), "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("public/assets"))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--match", default="")
    parser.add_argument("--bundle", action="append", type=resource_bundle_key, default=[], help="Extract an exact resource bundle instead of scanning Spine bundles; repeat for multiple bundles")
    parser.add_argument("--merge", action="store_true", help="Update matching bundle records without dropping other extracted bundles")
    parser.add_argument("--metadata-only", action="store_true", help="Refresh renderer material queues without rewriting existing media")
    args = parser.parse_args()
    if args.metadata_only and not args.merge:
        parser.error("--metadata-only requires --merge")
    sys.dont_write_bytecode = True
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
        paths = [root / (key + ".dat") for key in args.bundle] if args.bundle else sorted((root / "Spines").rglob("*.dat"))
        for path in paths:
            if not path.is_file():
                continue
            key = path.relative_to(root).with_suffix("").as_posix()
            if args.match in key:
                candidates[key] = path
    if args.bundle:
        missing = set(args.bundle) - set(candidates)
        if missing:
            parser.error("Requested bundles are missing: " + ", ".join(sorted(missing)))
    catalog = json.loads((args.output / "extraction.json").read_text())["bundles"] if args.merge and (args.output / "extraction.json").exists() else []
    shader_path = next((root / "Shaders.dat" for root in reversed(roots) if (root / "Shaders.dat").exists()), None)
    shader_bytes = None
    effect_texture_paths = {}
    for root in roots:
        for dependency in sorted((root / "Effects/Textures").rglob("*.dat")):
            effect_texture_paths[dependency.relative_to(root).with_suffix("").as_posix()] = dependency
    effect_texture_bytes = {}
    dependency_paths = {}
    for root in roots:
        for path in root.rglob("*.dat"):
            dependency_paths[path.relative_to(root).with_suffix("").as_posix().lower()] = path
    dependency_records = {key.lower(): record for key, record in records.items()}
    dependency_bytes = {}
    for key, path in list(candidates.items())[:args.limit]:
        destination = args.output / "spines" / key.removeprefix("Spines/")
        try:
            raw = path.read_bytes()
            if not raw.startswith(b"UnityFS"):
                record = records[key]
                raw = decoder.xor_prefix(raw, record.hash_code)
            environment = UnityPy.load(raw)
            destination.mkdir(parents=True, exist_ok=True)
            extractor = BundleExtractor(environment, destination)
            dependency_errors = []
            if args.metadata_only or any(reader.type.name in ("Animation", "AnimationClip", "Animator", "AnimatorController", "AnimatorOverrideController") for reader in extractor.objects):
                pending = list(records[key].dependencies)
                loaded = {key.lower()}
                while pending:
                    dependency_key = pending.pop().lower()
                    if dependency_key in loaded:
                        continue
                    loaded.add(dependency_key)
                    dependency_path = dependency_paths.get(dependency_key)
                    record = dependency_records.get(dependency_key)
                    if dependency_path is None or record is None:
                        dependency_errors.append({"type": "Dependency", "resource": dependency_key, "error": "Resource file or decoding record is missing"})
                        continue
                    if dependency_key not in dependency_bytes:
                        data = dependency_path.read_bytes()
                        if not data.startswith(b"UnityFS"):
                            data = decoder.xor_prefix(data, record.hash_code)
                        dependency_bytes[dependency_key] = data
                    environment.load_file(dependency_bytes[dependency_key], name=dependency_key, is_dependency=True)
                    pending.extend(record.dependencies)
            has_particles = any(reader.type.name == "ParticleSystem" for reader in extractor.objects)
            if shader_path:
                if shader_bytes is None:
                    shader_bytes = shader_path.read_bytes()
                    if not shader_bytes.startswith(b"UnityFS"):
                        shader_bytes = decoder.xor_prefix(shader_bytes, records["Shaders"].hash_code)
                environment.load_file(shader_bytes, name="Shaders.dat", is_dependency=True)
                for dependency_key, dependency_path in (effect_texture_paths.items() if has_particles else []):
                    if dependency_key not in effect_texture_bytes:
                        data = dependency_path.read_bytes()
                        if not data.startswith(b"UnityFS"):
                            data = decoder.xor_prefix(data, records[dependency_key].hash_code)
                        effect_texture_bytes[dependency_key] = data
                    environment.load_file(effect_texture_bytes[dependency_key], name=dependency_key, is_dependency=True)
            if args.metadata_only:
                previous = next((item for item in catalog if item["id"] == key), None)
                if not previous or not previous.get("path"):
                    raise ValueError("Metadata refresh requires an existing extracted bundle")
                result = {**previous, "renderers": extractor.extract_renderers()}
                readers = {str(reader.path_id): reader for reader in extractor.objects}
                result["skeletons"] = [{**item, "materialBindings": extractor.skeleton_materials(readers[item["id"]])} for item in previous["skeletons"]]
                catalog = [item for item in catalog if item["id"] != key] + [result]
                print(key, "renderers", len(result["renderers"]), "errors", sum(len(row["errors"]) for row in result["renderers"]), flush=True)
                write_json(args.output / "extraction.json", {"schema": 1, "bundles": catalog})
                continue
            result = extractor.extract()
            result["errors"].extend(dependency_errors)
            result.update(id=key, path=destination.relative_to(args.output).as_posix())
            catalog = [item for item in catalog if item["id"] != key] + [result]
            print(key, "skeletons", len(result["skeletons"]), "effects", len(result["effects"]), "images", len(result["images"]), "errors", len(result["errors"]) + sum(len(effect["errors"]) for effect in result["effects"] + result["images"]), flush=True)
        except Exception as exc:
            if not args.merge:
                catalog.append({"id": key, "skeletons": [], "errors": [{"type": "Bundle", "error": str(exc)}]})
            print(key, str(exc), flush=True)
        write_json(args.output / "extraction.json", {"schema": 1, "bundles": catalog})


if __name__ == "__main__":
    main()
