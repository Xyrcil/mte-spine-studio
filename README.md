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
`npm run build` produces a code-only `dist/`; game resources are not copied into
the deployable output. `npm run build:local` creates a separate `dist-local/`
with local assets for offline-cache testing. Do not publish that local build.
Development still reads the local assets folder.

The production app can import a converted assets folder or a resource ZIP
without uploading files. For large libraries, create a local archive with
`python3 tools/pack_assets.py --assets /path/to/assets --output /path/to/resources.zip`,
then choose **Import resource ZIP** under **Local resource pack** and reload.
The archive contains the five catalogues and their indexed resources, not the
game client. Native UI sprites and particle textures are resolved relative to
their presentation and included in the archive. Older incomplete archives must
be rebuilt before import. Do not publish game-resource archives without appropriate permission.
Imported files use separate browser storage; ordinary cache clearing does not
remove them. Cancellation, invalid catalogues, missing indexed
files and storage failures retain the previous pack. Replacement pauses open
scenes and asks each app tab to reload rather than mixing resource versions.
Keep the original folder or ZIP: browser storage may still be evicted.

The extractor accepts a local archive with the resource tables and decoding
utilities. It preserves Unity references, scene hierarchy, and atlas materials.

```sh
python3 tools/extract_assets.py --source /path/to/archive
npm run assets:index
python3 tools/extract_audio.py --source /path/to/archive
python3 tools/build_library.py --source /path/to/archive
python3 tools/extract_portraits.py --source /path/to/archive
python3 tools/extract_fonts.py --source /path/to/archive
npm run assets:index
python3 tools/build_library.py --source /path/to/archive
```

Use `--match <bundle-name> --merge` to refresh selected Spine bundles without
dropping other catalogue entries.
For interface resources outside the Spine directory, use repeated
`--bundle UI/Prefab/Onsen` arguments with a separate local output folder.
Explicit bundle selection does not scan the rest of the library. The extractor
retains Animator controllers, overrides, clip bindings and packed curve data
alongside Legacy animations. Packed clips also retain decoded polynomial,
dense and constant channels with their original binding order and component
indices. Object-reference channels remain unsupported. Extracted channels are
sampled without resampling their polynomial segments. The native scene renderer
supports packed image color, anchored position, scale, planar rotation and
object visibility channels, including saved playback positions. Hot spring
dialogue selects the original level-specific decoration variant and retains
its name, start time and duration. Early Continue clicks advance the source
dialogue cursor without interrupting the currently playing voice or decoration
timer; Close remains immediate. The recovered decoration hierarchy and heart
sprites render above the scene using the source 1920 × 1080 Expand canvas
scaling. Export crops preserve that captured viewport. Decoration poses derive
from the dialogue checkpoint and reset source defaults before sampling.
Decoration state names resolve through the original Animator controller's clip
references, speed and loop settings. These ten selected states have no outgoing
transitions; their source default-value resets are retained. Unsupported blend
trees, parameter-driven playback or transitions remain marked unavailable.
The original dialogue body and name-plate graphics use their authored bottom
anchors, parent pivots and nested positions. The account nickname-edit icon is
not rendered. Text settings and the 50-character-per-second typewriter remain
in the local catalogue. Dialogue text uses the recovered original font files,
face metrics, nested anchors and source line-spacing settings. Glyph rasterization
uses browser text rather than the game's SDF shader. Wrapping reads the original
leading/following-character rule assets and retains word-break positions instead
of wrapping every glyph independently. Original-client layout comparison remains
pending. General Animator transitions remain pending.
The font extractor reads the original SOURCE and NOTO_light font files and
binds their exact names to the recovered TMP assets. Font paths, face metrics,
character coverage and fallback references are retained in presentations.
Unity Text font references resolve through their original dependency files,
not by matching path IDs across unrelated bundles. Skill text binds the
original SOURCE and PERTIBD files, including their size, ascent, descent,
line spacing and advance-rounding settings. Native font references and files
are retained in presentations without adding another required pack catalogue.
These files are local resources, not part of the public code build. OTF and
TTF files are included in resource packs and scene cache preparation.
Hot spring checkpoints retain the displayed voice ID and text start separately
from the conversation cursor. Early Continue clicks do not clear the current
line; restoration resolves its original text and role name from the catalogue.
The typewriter retains its visible-character count and next update time. It
advances toward elapsed-time character goals with the configured inter-update
delay; paused redraws and hidden objects do not advance it. Font faces and
generated text textures are released with their scene objects. Unsupported
markup and text layouts remain explicit rather than falling back to a system font.

Particle extraction retains source modules, render settings, material
parameters, shared shader/texture dependencies and
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
extraction. UI sprites retain their original canvas rectangle and trimmed
content bounds, including atlas offsets and unpacked rotation. The native image
renderer preserves those transparent margins rather than stretching trimmed
images to fill their original rectangles. Older resources without content
bounds retain their previous drawing behavior and need extraction refresh.
UI image components retain their original color, sprite and material
references; CanvasGroup opacity and RectTransform data stay in the presentation.
The recovered smoke images and skill-animation graphics are local resources,
not generated replacements. The smoke clip plays its original looping color
and anchored-position curves, inherits CanvasGroup opacity and pauses under
inactive hierarchy nodes. Native clocks survive scene restore, duplication,
context recovery and independent export, including backward export seeking.
Legacy scenes without native checkpoints start at the clip's initial time.
Legacy vector scale and position curves, planar Euler rotation, CanvasGroup
opacity and GameObject visibility use the same independent native animation
clock. CanvasGroup values are scene-local and restore from the captured clip
time without changing catalogue defaults. Transform-only animations load their
descendant images. Native clips with unresolved events, text or unsupported
image layouts remain explicitly unavailable; the skill-animation clip is not
yet played. Its original Unity Text, text-spacing, layout, item-generation and
event-receiver references are retained for the dynamic role/skill display.
The local library also retains the legacy skill names, explicit role/skin skill
references and combined main/management stand transforms used by that receiver.
These records remain version-specific rather than taking names from newer
tables. Missing portraits and stand configuration remain explicit; this data
binding does not yet enable the skill display's events or dynamic text rendering.
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
resources and joins their character names and voice tables. The artwork library
groups characters and offers skin, story and
portrait filters, source-name search, favorites and recently opened entries.
All indexed display entries remain reachable through 24-item pages, including
missing artwork and static previews. Favorites and recent entries stay on the
device; unavailable browser storage does not prevent browsing. On small screens,
the library opens as a bottom panel and closes after loading artwork.
The voice panel plays the available source and Chinese tracks with subtitles
and volume control.
Hot spring artwork exposes the source conversation pools for six roles and
five levels, including their alternate voice resources. Conversation level is
an object-level preview setting retained by scenes, undo and duplication; no
account progress is read. The source sound can also be previewed manually.
These standalone bundles do not contain extracted click regions, so their
original hot spring click behavior remains marked unavailable rather than
being replaced with arbitrary canvas clicks.
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
Gallery clicks fire on release; dragging pans without triggering character
interactions. Studio drags objects or pans from empty space. Space-drag, Alt-drag
and middle-button drag pan over objects too. Wheel and two-finger zoom preserve
their screen anchor. With the canvas focused, arrow keys pan, plus/minus zoom
and Home fits the scene. Camera edits participate in undo and scene persistence;
recording, replay and export lock camera editing.
Animation checkpoints also retain active mix chains, queued tracks, event
cursors, rotation history, attachments, deformation, draw order and pose state.
Paused redraws do not reapply animations. Older track-only scenes remain readable.
Interaction playback uses source colliders, moving-bone bindings, coordinated
animation tracks and timeline events. Controller state is stored with scenes.
The card game preserves its held card overlays after a terminal win or loss;
the next accepted click dismisses them before another action can begin. Both
clothing variants retain their matching idle and score-reset behavior. Saved
mid-reveal scenes and recorded card sequences retain the random state and tasks.
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
The export panel also checks video support when settings change. WebM prefers
VP9 and uses VP8 when only that encoder is available. Unsupported video or
audio configurations explain the alternatives; image sequences do not require
video encoders. A failed initial WebGL setup leaves a visible graphics error
instead of an indefinitely loading canvas.
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
AAC calibration unwraps a complete ES descriptor when WebKit returns one in
place of the required AudioSpecificConfig; valid configurations are preserved.
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
Offline preparation can include the recorded sequence even when its initial
characters differ from the current scene. An independent replay collects its
actual voices and effects in the recorded language, along with initial textures,
captured sound and ambient resources. It does not play sound or change the
editing scene. Missing sounds and unreproducible actions are reported; resources
for additional unrecorded interactions are not guaranteed. Preparation remains
available when automatic caching is disabled, and catalogues are prepared before
media resources. Cancellation applies to sequence analysis and downloading.

For a project URL such as `/mte-studio/`, build with
`MTE_BASE_PATH=/mte-studio/ npm run build`. Test offline behavior with a local
preview of the production build, not the development server.
`MTE_BASE_PATH=/pack-check/ npm run build` followed by
`node tools/check_resource_pack.mjs` tests import against a code-only host.
Add `--full` after creating `private/mte-resources.zip` to test the entire local
library in an isolated browser profile. The isolated test profile is removed after the
test; original game files and the resource archive are retained.
Interactive rendering preserves a CPU scene checkpoint when WebGL is lost,
pauses sound and rebuilds textures and draw resources after the browser restores
the context. Failed recovery keeps the checkpoint available for scene export
and manual retry. Animation mixes, poses and playback settings are retained;
previously playing scenes resume without advancing through the interruption.
Independent media exports stop on context loss instead of recording blank frames.
Other special controllers still need full behavioral validation. Effect
rendering for custom materials and remaining native clips, complete voice routing,
browser fallbacks and public deployment remain in progress.
Browser-engine checks can be run with
`node tools/check_browser_compatibility.mjs chromium` or `webkit` after installing
the corresponding Playwright browser. They exercise real assets, special
interactions, scene undo, video/audio decoding and audio alignment, PNG and ZIP.
WebKit automation is not a substitute for testing released Safari and iOS.
Firefox and Windows verification remain outstanding. Simulated encoder and
graphics failures are checked separately by `node tools/check_export_fallback.mjs`.

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
once. Streamed replay and independent export use canonical simulation steps.
Near-boundary floating-point differences do not introduce sub-frame updates
or leave the final action pending.
The sequence panel records Gallery clicks, pauses/resumes playback and replays
the captured starting scene. Editing is locked during recording and
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
