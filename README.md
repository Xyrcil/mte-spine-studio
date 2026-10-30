# MTE Spine Studio [WIP]

A browser artwork viewer and scene editor for Millennium Tour Elf.
An unofficial project for learning and reference, not affiliated with the game's
publisher. Game clients, game source code and game media are not included.

## Quick start

Use Node.js 22:

```sh
npm ci
npm run dev
```

Open the printed local address. Converted resources can be placed in the ignored
`public/assets/` folder, or imported through **Controls → Local resource pack**.
A raw APK or game archive is not a converted resource pack.

Choose **Artwork** for a single preview or **Scenes** to browse and edit saved
scenes. Right-click the canvas or open **Menu** for additional controls. Switch
the interface with **English / 简体中文**; voice language is independent.

Choose **Menu → Hide UI** for artwork-only viewing, without branding, controls,
notices or captions; right-click to restore the interface. The optional shortcut
defaults to **H**; choose any letter or **Off** under **Controls → Interface**.
**Esc** also restores UI. Preferences are remembered, including wallpaper host
sessions. `?ui=0` starts without UI and `?ui=1` starts with UI. Scene objects and
sound settings are unchanged.

## Browse and edit

- **Artwork:** choose characters, skins and story artwork. Click for available
  interactions. Entry, click and idle dialogue have separate switches.
- **Scenes:** create a scene or start from a template, then use **Add artwork**
  to add multiple items. Your scene library, drafts and single-artwork preview
  are stored separately in the current browser. Previous scenes remain available.
- Drag an object to move it; drag empty space or hold Control to pan. Select more
  objects with Shift, use the handles to scale or rotate, and right-click for
  layer and alignment actions. Scroll or pinch to zoom. **Use current view for
  output** sets the camera used by scene and media export.
- Save explicitly when a scene is ready. Leaving an edited scene offers to save
  it or keep a draft. Export a scene as JSON/ZIP to move it to another browser;
  custom images are included, while game media is referenced from the pack.

Templates can arrange two artworks, compare one character's available skins, or
place one indexed story portrait per character or all available story portraits. Larger arrangements use smaller textures while
editing; full-resolution export needs more device memory.

## Export

Capture the scene, choose MP4, WebM, PNG or a PNG sequence, then set a canvas
preset, pixel multiplier, crop and background. Drag the crop frame or its
corners, or edit percentages. Arrow keys adjust the focused frame or corner;
Shift makes larger adjustments. **Edit crop on canvas** hides the panel without
leaving Export; return with its button or Escape.

Keep the captured state, restart the selected artwork's idle, or include its
configured entry before idle. The chosen interval repeats in full, including
the entry when selected. **Use longest idle animation** sets its duration from
the longest active idle track; other tracks may have different periods. Recorded
sequences keep their original animation and voice timing.

**Preview loop** is silent; inspect subtitles in the first-frame preview.
Preview intervals must end within 120 seconds; media exports are not subject to
that preview limit. Choose voices, subtitles, effects, ambient sound and an
optional extra voice under **Audio and subtitles**. Repeat is not necessarily
seamless; crossfade overlaps the interval, while ping-pong reverses it.

## Local resource packs

A pack needs `presentations.json`, `runtime-index.json`, `library.json`,
`audio-index.json` and `portrait-index.json` at its root, plus their referenced
media. Import a ZIP or converted folder, then reload when prompted. Importing
does not upload files. Keep the source folder or ZIP: browser storage can be
evicted or exceed its quota. Failed or cancelled imports retain the old pack.

```sh
python3 tools/pack_assets.py --assets /path/to/assets --output /path/to/resources.zip
```

For catalogue-only changes, add `--refresh-catalogues` to update an existing
pack without replacing its media. Older entry/greeting metadata is flagged in
the import panel. Adding media requires building a new pack.

Extraction tools are included, but the original backup tables, its
`server/patch_local_data.py`, and UnityPy dependencies are not. Audio conversion
requires macOS `afconvert` or a full FFmpeg build. See each tool's `--help` for
input requirements. Original assets and decoding inputs must be supplied locally.

## Offline wallpapers

Build the app, then combine it with your private converted resource ZIP:

```sh
npm run build:wallpaper
python3 tools/pack_wallpaper.py --resources /path/to/resources.zip --app private/wallpaper-shell --output /path/to/new-wallpaper --archive /path/to/wallpaper.zip
```

Import the folder or `project.json` in Muralune, or create a Wallpaper Engine
Web project from `index.html`. The package runs locally, shares byte-identical
media and reads files on demand without importing a second browser copy.
Use Muralune's edit/interaction menu to enter the scene; Escape exits temporary
desktop interaction. Pause, master volume, speed and render quality follow the
host. Existing missing media stays marked. Do not publish the asset package.

To update an existing wallpaper without copying its media again:

```sh
npm run build:wallpaper
python3 tools/pack_wallpaper.py --refresh-app --app private/wallpaper-shell --output /path/to/wallpaper --archive /path/to/wallpaper.zip --replace-archive
```

The previous ZIP stays available until its replacement is complete. Reload the
wallpaper in its host to use the updated app.

## Hosted website

The web build loads the supplied artwork directly and keeps browser audio,
editing, export and optional scene caching. It does not require a local import.

```sh
npm run build:web
python3 tools/pack_web.py --app private/web-shell --resources /path/to/deduplicated/assets --output private/mte-web
```

The output shares local media through hard links. Add `--refresh-app` to refresh
its code later. Deploy this directory with Cloudflare Pages Direct Upload;
use Wrangler for projects with more than 1,000 files. Keep the Free plan:
at most 20,000 files, each no larger than 25 MiB. No Functions or paid storage
are required. Hosted media is accessible to visitors; keep game clients,
personal files and backup archives out of the deployment and Git repository.

## Limits and distribution

Missing media, unconfirmed bindings, source-disabled regions and unsupported
native effects remain explicit; no replacement voices or animations are guessed.
Some standalone artwork lacks source interaction regions. 3D models are not yet supported. Browser text rendering,
input ordering, material effects and complex branches do not yet have complete
original-client parity. Safari/iOS and Windows device checks remain incomplete.
Transparent output uses PNG; additive effects may need an opaque background.
Video encoding and direct file saving depend on the browser.

`npm run build` produces a code-only `dist/`. `npm run build:local` includes local
media and must not be published as a code-only site. Keep `public/assets/`,
`private/`, scene files and resource ZIPs private unless redistribution is allowed.
The existing GitHub Pages workflow is manual-only; building does not deploy.
The shared Web format is implemented; visible desktop/multi-display behavior
and Wallpaper Engine on Windows still need device checks.

Spine runtime integration/distribution and game-content permissions are separate.
See the [upstream agreement](https://esotericsoftware.com/spine-editor-license)
and keep the [runtime license](public/vendor/SPINE-LICENSE) and dependency notices
in [public/vendor/](public/vendor/). Omitting game media does not establish runtime
distribution rights.
