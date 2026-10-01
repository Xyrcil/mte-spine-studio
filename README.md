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
python3 tools/extract_portraits.py --source /path/to/archive
python3 tools/build_library.py --source /path/to/archive
```

The current implementation loads composite Spine presentations from real
resources and joins their character names and voice tables. The voice panel
plays the available source and Chinese tracks with subtitles and volume control.
The searchable story voice library exposes every indexed source line, including
missing-language and unvoiced entries. Story resources are not automatically
assigned to artwork when the source provides no explicit association.
Scene sound settings retain language, volumes, mute and per-object ambient
resources, looping and playback positions. Ambient audio waits for user
activation; hidden objects pause their sound and removed objects release it.
Available background music can be assigned independently to scene objects.
The scene editor supports object selection, transforms, image backgrounds,
layer ordering, duplication, undo/redo, local saves, autosave recovery and JSON
import/export. Scene files embed background images and retain animation times.
Animation checkpoints also retain active mix chains, queued tracks, event
cursors, rotation history, attachments, deformation, draw order and pose state.
Paused redraws do not reapply animations. Older track-only scenes remain readable.
Interaction playback uses source colliders, moving-bone bindings, coordinated
animation tracks and timeline events. Controller state is stored with scenes.
Interaction audio resolves source aliases and resource paths with the selected
language and matching subtitle row. State-dependent special click sounds are
separate from voices; hotspot effect references do not suppress character
speech or duplicate an already requested sound. Effect volume also retains
the resource's configured gain.
The Clarissa skin has browser checks for 13 reachable idle states and 38 click
regions. Its absent `caidan_jqr_02` animation is reported rather than replaced.
Standalone Spine bundles expose skeleton and animation previews, including
story portraits without prefab components. Extracted static portraits can be
viewed, played alongside voices and composed with animated artwork. Scenes
reference catalog portraits rather than embedding copies of game images.
Missing Spine bundles remain marked even when a static preview is available.
Media export renders an independent scene with fixed timestamps. It supports
MP4, WebM, transparent PNG and PNG sequences, resolution and pixel multiplier,
crop, speed, repeat/ping-pong/crossfade loops, optional voice audio, captured
ambient audio and music, cancellation
and direct file saving where the browser supports it. Crossfade overlaps the
interval; repeat alone does not guarantee a seamless join. Video codecs are
checked on the current device before encoding.
Character and story voices can be selected for export. Optional burned-in
subtitles retain the source line, wrap to fit the output and follow the selected
voice's offset, duration, speed and repeat settings. They use whole-line timing,
not inferred word timings, and can also be rendered without an audio track.
Ambient audio follows the captured scene interval, speed and loop mode,
including reversed ping-pong playback and crossfade mixing. Export respects
captured mute, visibility, gains, positions and completed one-shot sounds.
Other special controllers still need full behavioral validation. Effect
rendering, complete voice routing, exported interaction audio and its subtitles,
browser fallbacks, resource caching and public deployment remain in progress.

Audio extraction uses macOS `afconvert` for AAC output or a full FFmpeg build
for Opus output. Use `--retry-failed` to retry failed conversions without
repeating successful work. Resource indexes retain the original names and
record conversion errors rather than dropping missing files.

The Spine runtime license is retained in `public/vendor/SPINE-LICENSE`.
Media dependency licenses and source links are retained in `public/vendor/`.
