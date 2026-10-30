"""Build a private, self-contained Web wallpaper from converted resources."""
import argparse
import json
import os
import shutil
import stat
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path

GIB = 1024 ** 3
CHUNK = 1024 ** 2
CATALOGUES = {"presentations.json", "runtime-index.json", "library.json", "audio-index.json", "portrait-index.json"}


def safe_path(name):
    if not isinstance(name, str) or not name or name.startswith("/") or any(c in name for c in "\\%?#:\x00"):
        raise ValueError("Invalid resource path")
    if any(part in ("", ".", "..") for part in name.split("/")):
        raise ValueError("Invalid resource path")
    return name


def equal_members(archive, left, right):
    with archive.open(left) as a, archive.open(right) as b:
        while True:
            first, second = a.read(CHUNK), b.read(CHUNK)
            if first != second:
                return False
            if not first:
                return True


def resource_plan(archive):
    infos = sorted(archive.infolist(), key=lambda row: row.filename)
    if len(infos) > 30000 or sum(row.file_size for row in infos) > 6 * GIB:
        raise ValueError("Resource archive exceeds the package budget")
    names, groups, aliases, unique = set(), defaultdict(list), {}, []
    for index, info in enumerate(infos):
        name = safe_path(info.filename)
        if name in names or info.is_dir() or info.flag_bits & 1 or stat.S_ISLNK(info.external_attr >> 16):
            raise ValueError("Unsupported or duplicate resource member")
        names.add(name)
        candidates = groups[(info.file_size, info.CRC, Path(name).suffix.lower())] if name not in CATALOGUES else []
        target = next((candidate for candidate in candidates if equal_members(archive, info, candidate)), None)
        if target is not None:
            aliases[name] = target.filename
        else:
            unique.append(info)
            candidates.append(info)
        if (index + 1) % 2000 == 0:
            print(f"Compared {index + 1} / {len(infos)} resource names", flush=True)
    if not CATALOGUES.issubset(names):
        raise ValueError("Converted resource catalogues are missing")
    return infos, unique, aliases


def disk_budget(directory, required, budget, reserve):
    if required > budget or shutil.disk_usage(directory).free < required + reserve:
        raise ValueError("Not enough free space within the output and reserve budgets")


def copy_app(app, output, refresh=False):
    app = app.resolve()
    files = [path for path in app.rglob("*") if path.is_file()]
    for path in files:
        relative = path.relative_to(app)
        if path.is_symlink() or path.stat().st_size > 8 * CHUNK:
            raise ValueError("Unexpected app build member")
        if str(relative) != "index.html" and relative.parts[0] not in ("app", "vendor") and str(relative) != "sw.js":
            raise ValueError("Use the wallpaper build, without copied game resources")
    if not (app / "index.html").is_file() or not (app / "app").is_dir():
        raise ValueError("Choose the relative-path wallpaper build")
    previous = [path for path in (output / "app").rglob("*") if path.is_file()] if refresh else []
    installed = set()
    for source in files:
        relative = source.relative_to(app)
        if str(relative) == "sw.js":
            continue
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        installed.add(destination)
    for path in previous:
        if path not in installed:
            path.unlink()
    license_path = Path(__file__).resolve().parents[1] / "LICENSE"
    if license_path.is_file():
        shutil.copyfile(license_path, output / "LICENSE")


def descriptor(preview):
    return {
        "type": "web", "file": "index.html", "title": "[WIP] MTE Spine Studio", "preview": preview,
        "description": "Unofficial Millennium Tour Elf artwork viewer. Local learning and reference use.",
        "general": {"properties": {
            "muted": {"order": 0, "text": "ui_mute", "type": "bool", "value": True},
            "volume": {"order": 1, "text": "ui_volume", "type": "slider", "value": 70, "min": 0, "max": 100},
            "speed": {"order": 2, "text": "ui_speed", "type": "slider", "value": 100, "min": 10, "max": 200},
            "renderscale": {"order": 3, "text": "ui_scale", "type": "slider", "value": 100, "min": 25, "max": 200},
        }, "localization": {
            "en-us": {"ui_mute": "Mute sound", "ui_volume": "Master volume", "ui_speed": "Playback speed (%)", "ui_scale": "Render resolution (%)"},
            "zh-chs": {"ui_mute": "静音", "ui_volume": "总音量", "ui_speed": "播放速度（%）", "ui_scale": "渲染分辨率（%）"},
        }},
    }


def build_package(resources, app, output, budget=8 * GIB, reserve=4 * GIB):
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError("Choose a new package directory with an existing parent")
    if resources.is_symlink() or not resources.is_file():
        raise ValueError("Choose an existing converted resource ZIP")
    before = resources.stat()
    temporary = None
    try:
        with zipfile.ZipFile(resources) as archive:
            infos, unique, aliases = resource_plan(archive)
            logical_bytes, unique_bytes = sum(row.file_size for row in infos), sum(row.file_size for row in unique)
            disk_budget(output.parent, unique_bytes * 2 + 32 * CHUNK, budget, reserve)
            temporary = Path(tempfile.mkdtemp(prefix=".mte-wallpaper-", dir=output.parent))
            copy_app(app, temporary)
            for index, info in enumerate(unique):
                destination = temporary / "assets" / info.filename
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, destination.open("xb") as target:
                    shutil.copyfileobj(source, target, CHUNK)
                if (index + 1) % 2000 == 0:
                    if shutil.disk_usage(output.parent).free < reserve:
                        raise ValueError("Free-space reserve reached while building")
                    print(f"Installed {index + 1} / {len(unique)} unique resources", flush=True)
            (temporary / "assets" / "resource-map.json").write_text(json.dumps({"schema": 1, "aliases": aliases}, separators=(",", ":")), encoding="utf-8")
            library = json.loads(archive.read("library.json"))
            appearance = next((row for row in library.get("appearances", []) if row.get("bundle") == "Spines/painting/3014027_spine"), {})
            preview = appearance.get("portrait", {}).get("path")
            if preview not in {row.filename for row in infos}:
                preview = next((row.filename for row in unique if row.filename.endswith(".png")), "")
            (temporary / "project.json").write_text(json.dumps(descriptor("assets/" + aliases.get(preview, preview)), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        current = resources.stat()
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (current.st_size, current.st_mtime_ns, current.st_ino):
            raise ValueError("The source resource archive changed while building")
        temporary.rename(output)
        temporary = None
        return {"logicalFiles": len(infos), "physicalResourceFiles": len(unique), "aliases": len(aliases), "logicalBytes": logical_bytes, "resourceBytes": unique_bytes, "deduplicatedBytes": logical_bytes - unique_bytes}
    finally:
        if temporary is not None:
            shutil.rmtree(temporary)


def require_package(output):
    if output.is_symlink() or not (output / "assets" / "resource-map.json").is_file():
        raise ValueError("Choose an existing MTE wallpaper directory")
    value = json.loads((output / "project.json").read_text(encoding="utf-8"))
    if value.get("type") != "web" or value.get("file") != "index.html" or "MTE Spine Studio" not in value.get("title", ""):
        raise ValueError("This is not an MTE wallpaper directory")


def pack_archive(output, destination, budget=8 * GIB, reserve=4 * GIB, replace=False):
    require_package(output)
    if destination.is_symlink() or destination.exists() and (not replace or not destination.is_file()):
        raise ValueError("Archive output already exists")
    if destination.resolve().is_relative_to(output.resolve()):
        raise ValueError("Keep the transport archive outside the wallpaper directory")
    previous = destination.stat() if destination.exists() else None
    files = sorted(path for path in output.rglob("*") if path.is_file())
    if any(path.is_symlink() for path in files):
        raise ValueError("Wallpaper projects cannot include symbolic links")
    total = sum(path.stat().st_size for path in files)
    if total * 2 + len(files) * 512 > budget:
        raise ValueError("Expanded project and archive exceed the combined output budget")
    disk_budget(destination.parent, total + len(files) * 512, budget, reserve)
    with tempfile.NamedTemporaryFile(prefix=".mte-wallpaper-", suffix=".partial", dir=destination.parent, delete=False) as file:
        staging = Path(file.name)
    try:
        with zipfile.ZipFile(staging, "w", compresslevel=6) as archive:
            for path in files:
                compression = zipfile.ZIP_STORED if path.suffix.lower() in (".png", ".webp", ".m4a", ".jpg", ".jpeg", ".ogg", ".mp3") else zipfile.ZIP_DEFLATED
                archive.write(path, "mte-wallpaper/" + path.relative_to(output).as_posix(), compress_type=compression)
        current = destination.stat() if destination.exists() else None
        if previous is not None and (current is None or (previous.st_ino, previous.st_size, previous.st_mtime_ns) != (current.st_ino, current.st_size, current.st_mtime_ns)):
            raise ValueError("The previous archive changed while building")
        if replace and previous is not None:
            os.replace(staging, destination)
        else:
            os.link(staging, destination)
        return {"files": len(files), "expandedBytes": total, "archiveBytes": destination.stat().st_size}
    finally:
        staging.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resources", type=Path)
    parser.add_argument("--app", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--refresh-app", action="store_true")
    parser.add_argument("--archive-only", action="store_true")
    parser.add_argument("--replace-archive", action="store_true", help="Replace an existing transport ZIP after the new archive is complete")
    args = parser.parse_args()
    if args.replace_archive and not args.archive:
        parser.error("--replace-archive requires --archive")
    if args.refresh_app:
        require_package(args.output)
        if not args.app:
            parser.error("--refresh-app requires --app")
        copy_app(args.app, args.output, refresh=True)
    elif not args.archive_only:
        if not args.app or not args.resources:
            parser.error("A new package requires --app and --resources")
        print(json.dumps(build_package(args.resources, args.app, args.output)), flush=True)
    if args.archive:
        print(json.dumps(pack_archive(args.output, args.archive, replace=args.replace_archive)), flush=True)
    elif args.archive_only:
        parser.error("--archive-only requires --archive")
