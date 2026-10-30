"""Prepare a static website using the existing deduplicated media directory."""
import argparse
import json
import os
import shutil
from pathlib import Path

MIB = 1024 ** 2
ROOT_FILES = {"index.html", "app-shell.json", "sw.js"}
MEDIA_TYPES = {".json", ".skel", ".atlas", ".png", ".webp", ".jpg", ".jpeg", ".m4a", ".ogg", ".mp3", ".wav", ".otf", ".ttf"}
HEADERS = """/app/*
  Cache-Control: public, max-age=31536000, immutable
/vendor/*
  Cache-Control: public, max-age=3600
/assets/*
  Cache-Control: public, max-age=3600
/assets/*.json
  Cache-Control: no-cache
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/app-shell.json
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
"""


def app_files(app):
    files = [p for p in app.rglob("*") if p.is_file()]
    for path in files:
        relative = path.relative_to(app)
        if path.is_symlink() or path.stat().st_size > 8 * MIB:
            raise ValueError("Unexpected website build member")
        if relative.as_posix() not in ROOT_FILES and relative.parts[0] not in ("app", "vendor"):
            raise ValueError("Choose the web build without copied media")
    if not all((app / name).is_file() for name in ROOT_FILES) or not (app / "app").is_dir():
        raise ValueError("Choose a complete web build")
    return files


def prepare_web(app, resources, output, refresh=False):
    app, resources, output = app.resolve(), resources.resolve(), output.absolute()
    if output.is_symlink() or resources == output or output.resolve().is_relative_to(resources):
        raise ValueError("Choose a separate website output directory")
    files = app_files(app)
    if not (resources / "resource-map.json").is_file():
        raise ValueError("Choose the existing deduplicated assets directory")
    media = [p for p in resources.rglob("*") if p.is_file()]
    for path in media:
        if path.is_symlink() or path.suffix.lower() not in MEDIA_TYPES or path.stat().st_size > 25 * MIB:
            raise ValueError("Unsupported media file or Pages file-size limit exceeded")
    if any(p.is_symlink() for p in resources.rglob("*")) or any(p.is_symlink() for p in app.rglob("*")):
        raise ValueError("Website inputs cannot contain symbolic links")
    mapping = json.loads((resources / "resource-map.json").read_text())
    names = {p.relative_to(resources).as_posix() for p in media}
    if mapping.get("schema") != 1 or not isinstance(mapping.get("aliases"), dict) or not all(target in names for target in mapping["aliases"].values()):
        raise ValueError("Resource aliases do not resolve to available files")
    license_path = Path(__file__).resolve().parents[1] / "LICENSE"
    extra = 2 + int(license_path.is_file())
    if len(files) + len(media) + extra > 20000:
        raise ValueError("Cloudflare Pages Free file limit exceeded")
    if not output.parent.is_dir() or shutil.disk_usage(output.parent).free < 4 * 1024 ** 3 + 128 * MIB:
        raise ValueError("Keep a 4 GiB free-space reserve")
    if output.exists():
        if not refresh or not (output / "_headers").is_file() or not (output / "assets/resource-map.json").is_file():
            raise ValueError("Choose a new website directory or refresh an existing website")
        installed = {p.relative_to(output / "assets").as_posix(): p for p in (output / "assets").rglob("*") if p.is_file()}
        if installed.keys() != names or any(not os.path.samefile(installed[name], resources / name) for name in names):
            raise ValueError("The website media differs from its shared source")
    else:
        output.mkdir()
        try:
            for source in media:
                destination = output / "assets" / source.relative_to(resources)
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.link(source, destination)
        except BaseException:
            shutil.rmtree(output)
            raise
    previous = [p for p in (output / "app").rglob("*") if p.is_file()]
    installed = set()
    for source in sorted(files, key=lambda p: p.name == "index.html"):
        destination = output / source.relative_to(app)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        installed.add(destination)
    for path in previous:
        if path not in installed:
            path.unlink()
    (output / "_headers").write_text(HEADERS)
    (output / "404.html").write_text('<!doctype html><html lang="en"><meta charset="utf-8"><title>Not found</title><p>This file is unavailable.</p></html>\n')
    if license_path.is_file():
        shutil.copyfile(license_path, output / "LICENSE")
    return {"files": len(files) + len(media) + extra, "sharedMediaFiles": len(media), "sharedMediaBytes": sum(p.stat().st_size for p in media), "copiedMediaBytes": 0, "aliases": len(mapping["aliases"])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--resources", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--refresh-app", action="store_true")
    args = parser.parse_args()
    print(json.dumps(prepare_web(args.app, args.resources, args.output, args.refresh_app)))
