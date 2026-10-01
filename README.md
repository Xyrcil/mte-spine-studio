# MTE Spine Studio

Browser tools for animated character artwork, scene composition, and export.

## Development

```sh
npm install
npm run dev
npm test
python3 -m unittest discover -s tests
```

Converted assets are read from `public/assets/` and kept outside Git.
The extractor accepts a local archive with the resource tables and decoding
utilities. It preserves Unity references, scene hierarchy, and atlas materials.

```sh
python3 tools/extract_assets.py --source /path/to/archive
npm run assets:index
python3 tools/extract_audio.py --source /path/to/archive
python3 tools/build_library.py --source /path/to/archive
```

The current implementation loads composite Spine presentations from real
resources and joins their character names and voice tables. The voice panel
plays the available source and Chinese tracks with subtitles and volume control.
The scene editor supports object selection, transforms, image backgrounds,
layer ordering, duplication, undo/redo, local saves, autosave recovery and JSON
import/export. Scene files embed background images and retain animation times.
Interaction state machines, event-driven audio, static portraits and media
export are still being implemented.

Audio extraction uses macOS `afconvert` for AAC output or a full FFmpeg build
for Opus output. Use `--retry-failed` to retry failed conversions without
repeating successful work. Resource indexes retain the original names and
record conversion errors rather than dropping missing files.

The Spine runtime license is retained in `public/vendor/SPINE-LICENSE`.
