# MTE Spine Studio [WIP]

A browser viewer and scene editor for Millennium Tour Elf character artwork.
This unofficial project is for learning and reference and is not affiliated
with the game's publisher. The repository does not include game assets or the
game client.

Development and original-client validation are still in progress.

## Workspaces

- Gallery: browse indexed characters, skins and story artwork, play available
  interactions, and preview voices with subtitles.
- Studio: combine characters and custom backgrounds, adjust placement and
  layers, and save or import scenes.
- Export: create MP4, WebM, PNG or PNG sequences with crop, resolution, pixel
  multiplier, speed and repeat, ping-pong or crossfade settings.

Gallery clicks trigger interactions on release; dragging pans the view.
Studio drags objects. Use the wheel or a pinch gesture to zoom. With the canvas
focused, arrow keys pan, plus/minus zoom, and Home fits the scene.

Scenes support undo/redo, autosave recovery and JSON or ZIP files. Custom
backgrounds can follow a character's position, visibility and opacity. Scene
files include custom images but reference game media from the resource pack.
Recorded interactions can be replayed and included in exports.

## Run locally

Use Node.js 22 and Python 3 for development.

```sh
npm ci
npm run dev
```

Open the address printed by the development server. Local converted resources
go in `public/assets/`, which Git ignores.

## Import resources

On a code-only build, open **Local resource pack**, choose **Import resource
ZIP** or **Import assets folder**, and reload when prompted. Files stay in the
browser; the importer does not upload them.

A pack needs `presentations.json`, `runtime-index.json`, `library.json`,
`audio-index.json` and `portrait-index.json` at its root, plus every media file
referenced by those catalogues. A raw APK or game-resource archive is not a
converted pack.

To package an existing converted folder:

```sh
python3 tools/pack_assets.py --assets /path/to/assets --output /path/to/resources.zip
```

Keep the source folder or ZIP. Browser storage can be evicted, and a large
library may exceed the available quota. A failed or cancelled import keeps the
previous pack. Successful replacement asks open tabs to reload. Clearing the
ordinary resource cache does not remove the imported pack or saved scenes.

Preparing one scene for offline use includes its selected resources and recorded
interactions, but does not guarantee files for every later unrecorded action.

## Extract from a local backup

The extraction tools expect the original backup layout, including resource
tables, `server/patch_local_data.py` and `tools/python-libs/` with UnityPy and its
dependencies. These inputs, decoding utilities and original game files are not
supplied by this repository. Audio conversion also needs macOS `afconvert` or
a full FFmpeg build.

With those local inputs available, run the pipeline in this order:

```sh
python3 tools/extract_assets.py --source /path/to/archive
npm run assets:index
python3 tools/extract_audio.py --source /path/to/archive
python3 tools/build_library.py --source /path/to/archive
python3 tools/extract_portraits.py --source /path/to/archive
python3 tools/extract_portraits.py --emblems --source /path/to/archive
python3 tools/extract_fonts.py --source /path/to/archive
npm run assets:index
python3 tools/build_library.py --source /path/to/archive
```

The intermediate library supplies portrait references; the final pass binds
the extracted portraits and fonts. Use `--help` on individual tools for bundle
selection and refresh options. Rebuild the indexes and resource ZIP after
changing converted resources.

Metadata-only material refresh uses `extract_assets.py --merge --metadata-only`.
Add `--material-textures` to recover active auxiliary textures and original mip
levels. `--source-archive /path/to/original-resources.zip` can resolve missing
shared textures without replacing dependencies already loaded from the backup.

## Current limitations

- Missing artwork, animations, textures and voices stay marked unavailable.
  Static previews do not mean the corresponding Spine files were recovered.
  Source-disabled click regions stay disabled.
- Complex interaction coverage and version-specific voice routing are still
  being checked. Some standalone hot spring artwork lacks source click regions;
  its conversation and voice previews do not restore those missing interactions.
- Unsupported native animation channels, Animator transitions, blend trees and
  custom particle materials remain unavailable. Affected artwork lists these
  limits, and exports include warnings.
- Text uses recovered fonts with browser glyph rendering rather than the game's
  SDF renderer. Complete client parity for text, input ordering, overlapping
  colliders, material sampling and particle composition remains unverified.
- Transparent output is available as PNG or a PNG sequence. Additive effects
  may need an opaque background to preserve their appearance. A repeated clip
  is not necessarily seamless; crossfade overlaps the chosen interval.
- Video encoders and direct file saving depend on the browser and device.
  PNG sequences remain an alternative when video encoding is unavailable.
- Automated checks cover Chromium, Firefox and WebKit engines. Released
  Safari/iOS and Windows verification is still outstanding.

Wallpaper Engine and MacVideoWallpaper integration are deferred.

## Development checks

```sh
npm test
python3 -B -m unittest discover -s tests
npm run build
```

Browser checks require local resources and the corresponding Playwright browser.
Start the development server on port 4173, then run, for example,
`node tools/check_browser_compatibility.mjs chromium`. The test browser helper
mutes media playback. Tests without local game resources skip resource-specific
checks.

Controller audits can resume with `--checkpoint private/controller-audit.jsonl`
and `--steps 64`. Use one writer per checkpoint and a new file after runtime or
resource changes. A bounded search or complete click-command coverage does not
prove that every interaction state was checked.

`npm run build` produces a code-only `dist/`. `npm run build:local` creates
`dist-local/` with local assets for offline testing. Do not publish that local
build, `public/assets/`, `private/`, or resource ZIPs without the required rights.

## Publication and licenses

Confirm the applicable Spine runtime integration and distribution rights before
developing or publishing a product that contains the runtime. The
[official agreement, Section 2](https://esotericsoftware.com/spine-editor-license)
sets licensing conditions, including at the time of integration. Keeping notices
or omitting game assets does not by itself establish those rights. Permission
to distribute game artwork, audio and fonts is a separate question.

After resolving those permissions, enable GitHub Pages with GitHub Actions as
the build source and manually run **Deploy website**. The
[workflow](.github/workflows/pages.yml) tests the code and publishes `dist/`
without local game resources. Commits do not trigger deployment.

For a project-path build, use `MTE_BASE_PATH=/mte-spine-studio/ npm run build`.
Visitors supply their own converted resource packs.

The [Spine runtime license](public/vendor/SPINE-LICENSE) and other dependency
notices remain in [public/vendor/](public/vendor/).

## Future desktop hosts

`window.mteHost` (version 1) exposes `getState()`, `getScene()`, `pause()`,
`resume()`, `setMuted(boolean)`, `setVolume(value, channel)`, `resize()` and
`loadScene(scene, {signal})`. Volume channels are `voice`, `effects`, `ambient`
or `all`, with values from 0 to 1. These JavaScript hooks do not install a desktop
host or accept cross-origin messages.
