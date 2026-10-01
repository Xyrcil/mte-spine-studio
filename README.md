# MTE Spine Studio

Browser tools for animated character artwork, scene composition, and export.
An unofficial Millennium Tour Elf project for learning and reference, not
affiliated with the game's publisher. Game assets are not distributed here.

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

Use `--match <bundle-name> --merge` to refresh selected Spine bundles without
dropping other catalogue entries. Particle extraction retains source modules,
render settings, material parameters, shared shader/texture dependencies and
sprite frames. Native animation components and sorting groups are also kept.
Material metadata includes active shader keywords, custom render queues,
disabled passes, tags and instancing settings; shader implementation code is
not included in converted resources. The masked particle material uses an
additive blend and its own render queue, not the Legacy alpha-blended path.
Mesh renderer queues retain explicit material values or their shader queue tags.
For matching sorting orders, draw calls use those queues before hierarchy ties.
Refresh this metadata without rewriting media with
`python3 tools/extract_assets.py --source /path/to/archive --merge --metadata-only`.
Mixed material queues use source atlas-page and blend-material references.
Their current attachments and draw order are regrouped into material segments
each frame. Slot filtering traverses the original clipping attachments even
when they sit outside the selected segment. Unresolved mappings remain marked;
resolved segments still carry an original-client visual-verification notice.
Native animation bundles load their declared shared dependencies before image
extraction. UI image components retain their original color, sprite and material
references; CanvasGroup opacity and RectTransform data stay in the presentation.
The recovered smoke images and skill-animation graphics are local resources,
not generated replacements. The smoke clip plays its original looping color
and anchored-position curves, inherits CanvasGroup opacity and pauses under
inactive hierarchy nodes. Native clocks survive scene restore, duplication,
context recovery and independent export, including backward export seeking.
Legacy scenes without native checkpoints start at the clip's initial time.
Native clips with events, text, vector channels or unsupported image layouts
remain explicitly unavailable; the skill-animation clip is not yet played.
Infinite curve tangents are encoded as explicit strings in valid JSON.
The renderer plays the recovered Legacy alpha-blended sprite particles.
The recovered screen-mask additive particle variant has an independent browser
renderer with stretched quads and grid-sheet frames. Its mask stays anchored
to the source viewport during cropped exports. Geometry and material draw
order still need original-client visual verification; the UI and exported
results retain that warning. Transparent images cannot preserve additive
composition on every background, so matching exports should use an opaque
background. Other custom material variants and unsupported native clips are not yet rendered;
affected presentations say so in their details. Inspect original component coverage with
`python3 tools/inspect_effects.py --source /path/to/archive`.

Particle value sampling supports cubic and weighted tangents, held segments,
constant/curve ranges and independent gradient color/opacity keys. It preserves
authored HDR values and caller-supplied random factors. The independent particle
model simulates the recovered edge/box emitters, one-loop prewarming, forces,
lifetimes, capacity, size/color/rotation changes and texture frame selection.
It retains a random stream and validated checkpoints; partial-frame sampling
does not consume randomness. Scene files, context recovery and independent
media export retain particle positions and future emission. Legacy scenes
without particle checkpoints start with the source prewarm. Additional unsupported enabled modules fail
explicitly instead of producing placeholder effects.

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
Active effects retain resource, object and playback position in saved scenes.
Hidden or removed objects release their effects; duplicated objects inherit
their captured sound positions.
Active speech also retains its resource, language, object and playback
position. Scene files reference the voice ID rather than copying subtitles;
restoration reads the source line from the local catalog. Story playback can
remain independent of artwork. Completed speech does not restart on resume.
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
Interaction effects are collected from an independent scene replay and mixed
with any effects still active at capture. Event timestamps account for track
speed and loop boundaries. Forward effects keep their pitch; ping-pong reverses
the sampled interval. Missing sounds are returned as export warnings.
AAC export measures this device's encoder delay and offsets the audio track
to avoid silent leading padding, including for very short clips.
Captured speech and its subtitles can be included independently of additional
selected voices. They retain the captured language and position, follow scene
loops and keep their pitch during forward playback. Captions expire with the
source clip, work in PNG output and remain available when the video is muted.
Simultaneous captured and additional subtitles use separate stacked rows.
Production builds cache the application shell and valid same-origin resources.
The cache panel can prepare the current scene and optional character voices,
set a resource budget, cancel preparation, clear cached files and request
persistent browser storage. Resource eviction uses least-recently-used order
while retaining catalogues. Cached audio supports byte-range playback.
Clearing resource files does not delete saved scenes or unrelated app caches.
Catalogue changes invalidate older resource copies; invalid catalogues,
unexpected HTML and partial audio responses are not stored as complete files.
Preparation reports when the selected resources do not all fit. Browser permission
or quota failures leave online playback available. Development mode disables
service-worker caching to avoid stale source files.

For a project URL such as `/mte-studio/`, build with
`MTE_BASE_PATH=/mte-studio/ npm run build`. Test offline behavior with a local
preview of the production build, not the development server.
Interactive rendering preserves a CPU scene checkpoint when WebGL is lost,
pauses sound and rebuilds textures and draw resources after the browser restores
the context. Failed recovery keeps the checkpoint available for scene export
and manual retry. Animation mixes, poses and playback settings are retained;
previously playing scenes resume without advancing through the interruption.
Independent media exports stop on context loss instead of recording blank frames.
Other special controllers still need full behavioral validation. Effect
rendering for custom materials and remaining native clips, complete voice routing,
browser fallbacks and public deployment remain in progress.

Interactive presentations with `start` and `animation` play the entrance once
and queue the available idle after its full duration; raw standalone previews
keep their configured loop. Zero-scaled bones remain collapsed without producing
non-finite IK or applied-transform values. Expanding them resumes normal solving.
Interaction details list missing initial animation references as well as absent
alternate variants. `tools/check_controllers.mjs` explores loaded controller
states and reports inactive regions, source gaps and its bounded-search limit;
a limited search is not evidence of complete behavioral coverage.

The interaction sequence engine records accepted clicks against a captured
initial scene using simulation time. Replay targets the original object,
controller and region, splits evaluation at action timestamps and reports
state divergence rather than skipping a failed action. Time-zero actions run
once. The sequence panel records Gallery clicks, pauses/resumes playback and
replays the captured starting scene. Editing is locked during recording and
replay. Sequences round-trip through their own JSON files and saved scenes,
including autosave recovery. Recursive sequence checkpoints are rejected.
The export panel can replay a saved sequence from its recorded starting scene,
including its click sounds and automatic animation sound events. Seeking back
rebuilds the sequence, and all loop modes use the same source interval. Failed
actions stop export instead of silently skipping state transitions. Current
scene edits do not replace the recorded transforms or sound settings.
Scheduled interactions also resolve skin voices and subtitles in the recorded
scene language. A new voice cuts the previous captured or interaction speech
at its source timestamp. Muting leaves optional subtitles available, including
in PNG output. Explicit effect references remain separate from voice routing.
Click timestamps can be edited or removed; time changes retain stable order
for simultaneous actions and extend duration when necessary. Duration edits
cannot discard later clicks. The click list is paged rather than rendering
every action at once. Replay reports state divergence after timing edits.
Silent preview rebuilds the recorded initial scene at a selected time and
leaves it paused and muted, with captured speech and click sounds cleared.
It does not change the sequence's original audio settings. Cancelling a
preview or encountering an unreproducible action restores the previous scene;
preview loading is cancellable too. Rendering loss during preview retains the
previous scene for recovery. Full replay and export start from the
recorded initial scene and retain their normal audio event processing.

Audio extraction uses macOS `afconvert` for AAC output or a full FFmpeg build
for Opus output. Use `--retry-failed` to retry failed conversions without
repeating successful work. Resource indexes retain the original names and
record conversion errors rather than dropping missing files.

The Spine runtime license is retained in `public/vendor/SPINE-LICENSE`.
Media dependency licenses and source links are retained in `public/vendor/`.
