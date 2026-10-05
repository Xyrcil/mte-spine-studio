# MTE Spine Studio

Browser tools for animated character artwork, scene composition, and export.
An unofficial Millennium Tour Elf project for learning and reference, not
affiliated with the game's publisher. Game assets are not distributed here.

The browser exposes `window.mteHost` (version 1) with `getState()`, `getScene()`,
`pause()`, `resume()`, `setMuted(boolean)`, `setVolume(value, channel)`, `resize()`
and `loadScene(scene, {signal})`. Volume channels are `voice`, `effects`, `ambient`
or `all`, with values from 0 to 1. Resize remeasures the canvas after host layout
changes. These local JavaScript hooks do not install a desktop host or accept
cross-origin messages. Wallpaper Engine and MacVideoWallpaper integration remains deferred.

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

## Website deployment

Confirm the applicable Spine runtime integration and distribution rights before
publishing. The [official agreement, Section 2](https://esotericsoftware.com/spine-editor-license)
sets conditions for integrating, modifying and distributing the runtime,
including licensing at the time of integration. Keeping the notices or omitting
game assets does not by itself establish those rights.
In the repository's **Settings → Pages**, choose **GitHub Actions** as the build
source, then run **Deploy website** from the **Actions** tab. Deployment is manual;
commits do not publish automatically. The workflow tests the code, builds `dist/`
without game assets, and uses the site's configured path for project sites,
account sites and custom domains. It does not upload local resource packs.
Visitors import their own converted resources in the browser.

For a local project-path build, use `MTE_BASE_PATH=/mte-spine-studio/ npm run build`.
Never deploy `dist-local/` or `public/assets/`.

## Local resources

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
python3 tools/extract_portraits.py --emblems --source /path/to/archive
python3 tools/extract_fonts.py --source /path/to/archive
npm run assets:index
python3 tools/build_library.py --source /path/to/archive
```

Use `--match <bundle-name> --merge` to refresh selected Spine bundles without
dropping other catalogue entries.
Unassigned source skeleton components are listed but do not prevent available
layers from loading. Templates with no assigned artwork remain unavailable.
Additional extracted skeletons without a source component appear as optional
layers, disabled by default when the original composition has assigned layers.
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
Supported PMA blend-material colors retain their original HDR RGB and alpha
instead of assuming a white material. Draw-time tinting restores slot colors
after each segment; unsupported tint settings are reported. Older converted
resources need a metadata refresh and rebuilt resource ZIP to include these settings.
The source vertex-color power keyword applies its saved exponent to combined
RGB while retaining alpha, including clipped geometry. Slot and attachment
colors stay unchanged between draws.
Spine/Skeleton flow-map and noise-texture variants use their source coordinate
transforms, two-phase flow blending and signed noise offsets. Both can run
together on clipped geometry and share the saved material clock. The renderer
loads exported PNG base textures and complete original mip chains with their
point/bilinear and repeat/clamp settings. Mip images are decoded from the source
ASTC blocks, not generated by resizing the base image. Legacy profiles without
mip metadata remain base-only. Original-client filtering, color-space and
vertex-color parity remain unverified; artwork details and exports retain that notice. Missing
texture dependencies leave the affected distortion unavailable while the
underlying Spine animation remains available.
Their source flow, noise and mask textures can be recovered with
`python3 tools/extract_assets.py --source /path/to/archive --merge --metadata-only --material-textures`.
Rebuild the indexes and resource ZIP afterward. Texture filtering, wrap modes,
scale and offset remain in the material profile and offline preparation includes
every declared mip image. Imports reject packs missing a declared level.
Filtering modes follow the [Unity reference](https://docs.unity3d.com/es/2019.3/ScriptReference/FilterMode.html).
Authored anisotropy uses the [WebGL extension](https://registry.khronos.org/webgl/extensions/EXT_texture_filter_anisotropic/) within device limits; unavailable precision is listed in artwork details and export warnings.
Ordinary metadata refresh retains existing texture records only
when their material and texture references still match.
Scenes retain a separate material clock for distortion playback, independent
of Spine tracks. Restoring a legacy scene without this clock starts it at zero.
Native animation bundles load their declared shared dependencies before image
extraction. UI sprites retain their original canvas rectangle and trimmed
content bounds, including atlas offsets and unpacked rotation. The native image
renderer preserves those transparent margins rather than stretching trimmed
images to fill their original rectangles. Older resources without content
bounds retain their previous drawing behavior and need extraction refresh.
UI image components retain their original color, sprite and material
references; CanvasGroup opacity and RectTransform data stay in the presentation.
Stretched UI images require an explicit viewport root and supported CanvasScaler;
missing layout context remains unavailable. The original Onsen background matches
direct texture rendering at four landscape and portrait sizes in Chrome, Firefox
and WebKit. This verifies the bound image layout, not the complete client UI.
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
image layouts remain explicitly unavailable. The unassigned skill template
does not play with unrelated default artwork.
The local library also retains the legacy skill names, explicit role/skin skill
references and combined main/management stand transforms used by that receiver.
These records remain version-specific rather than taking names from newer
tables. Missing portraits, emblems and stand configuration remain explicit.
Unity Text now has a scene-local browser renderer using its resolved original
font, authored face metrics, rounded glyph advances and alignment. Legacy color
and text-spacing curves can drive those fields and restore their clip times.
Unsupported markup, sizing and layout remain explicit. Text fields stay disabled
when their complete native clip cannot play. Browser glyph rasterization
still needs comparison with the original client. The English
template's vertex-gradient renderer applies the original Color32 colors to
each glyph independently, including horizontal/vertical direction and the
source override of the graphic tint. Glyph textures are isolated so overlapping
letters do not duplicate their neighbours. Browser glyph bounds and sampling
still require original-client comparison.
Paired English letter rows now resolve the original ItemGen templates, horizontal
layout, preferred-width fitter and ignored foreground row. They reuse the first
template, create scene-local copies, and keep the gradient row above the dark row.
The word coroutine preserves UTF-16 character positions, half/full-opacity steps
and the source 0.33-second divided wait, advancing once per eligible frame rather
than catching up multiple letters. Checkpoints retain count, progress and the next
wait; scene restore and independent export rebuild their derived letters without
copying game text into scene files.
Dynamic role artwork can now bind both original Image components using the
sprite's logical rectangle, trimmed content bounds and explicit canvas pixel
ratio. The upper layer retains its authored opacity and local transform.
Badges and skin-configured emblems bind both logo layers with their original
native size, tint and badge-only 0.7 scale. They stay outside the artwork gallery.
Assigned skill presentations now connect the original PlaySpine, PlayWord and End
events. End emits a host notification; scene restore does not invoke it again.
Restart resets the word reveal and event cursor. The word coroutine keeps its
own clock after the single-play native clip stops. Explicit Legacy Default/Default
settings resolve to Once unless a playback context supplies another default,
following [Unity's playback rules](https://docs.unity3d.com/ScriptReference/WrapMode.Default.html).
The Skill display panel lists configured roles, appearances and skills, including
missing-resource reasons. Assigned displays can be opened, replayed, composed and
saved; their identifiers rebuild from the resource catalogue after reload.
Scenes retain the actual artwork catalogue reference for voice selection.
Offline preparation includes native text fonts alongside the skill graphics.
Original-client visual comparison remains pending.
Native Legacy event timelines now dispatch only through explicit, scene-local
receiver maps. They retain source parameters, same-time ordering and loop-boundary
events. Checkpoints keep the next event cursor; restoring a pose or drawing a
paused frame does not replay consumed callbacks. Unresolved functions and external
object parameters keep the clip unavailable. Explicit Once clips now stop, reset their
time and restore their bound defaults; ClampForever retains the final sample.
Checkpoints distinguish an enabled paused pose from a stopped clip. Restarting
clears the old event cursor, including restarts requested inside a callback.
Missing playback settings remain unavailable rather than being treated as a loop.
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
Gallery uses the archived management-view placement and camera when a matching
configuration exists. **Source preview** restores that framing for the selected
artwork at the current viewport ratio; **Fit scene** includes every active layer,
including offstage variants. The source framing does not remove those layers.
Details distinguish legacy-client settings from modified archive-client settings.
Resources without a matching configuration keep the general scene fit.
Source preview follows viewport changes in Gallery and keeps its parameters in
scene files. Panning, zooming, changing object placement or entering Studio leaves
that mode. Export retains the captured viewport, even after a host layout change.
Artwork loads without replacing the current scene until its resources are ready.
Use **Cancel loading** to keep the current scene. Choosing another entry replaces
the pending request; switching workspaces cancels it. Scene edits and imports
wait until loading finishes or is cancelled.
The voice panel plays the available source and Chinese tracks with subtitles
and volume control.
Choose **All character voices** to browse lines without a linked artwork entry.
This scope searches original target IDs and resource names, keeps missing tracks
visible, and is also available when choosing an export voice. Manual playback
in this scope does not attach an unrelated line to the selected scene object.
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
Playback refreshes retain field focus, text selection and uncommitted object,
scene-name and numeric drafts. Leaving a field commits its draft; object switches
and scene restores do not transfer a draft to another object.
Focused text, numeric and checkbox controls stay attached during ordinary refreshes;
Tab navigation and one-step undo are retained while toolbar status stays current.
Input-method composition keeps the same field attached until composition ends,
so playback refreshes do not duplicate partially composed text.
Characters and static portraits can own multiple custom background layers.
Use **Add character background**, or assign an existing image with **Background
for**. Linked backgrounds follow the owner's transform, visibility and opacity;
their offsets and sibling order remain editable. Duplication copies these layers
and their sound settings, while removal releases them with the character.
Detaching preserves the current image geometry, opacity, visibility and draw order.
Scene restore, undo, offline saves and independent exports retain these links.
Scene file export supports JSON and ZIP. Automatic mode uses ZIP when embedded
images would exceed the JSON import limit. ZIP stores each distinct custom image
once, including images in the recorded initial scene; game assets remain catalogue
references. Both formats can be imported without uploading files. ZIP preparation
and reading show progress and can be cancelled without replacing the current scene.
Source-hidden skeleton layers are loaded but remain hidden until explicitly
enabled in the object controls. Switching active layers rebuilds this object's
interaction bindings and restarts its playback. Older scenes that omit those
hidden layers remain readable; missing originally visible layers are rejected.
Skeletons with multiple source skins expose **Artwork variants** in the object
controls. These are internal skeleton variants, not additional character costumes.
Changing one keeps track times, interaction state and pending notifications, without
replaying animation sounds. Pose checkpoints retain the chosen skin for scene
restore, undo, duplication and independent export.
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
story portraits without prefab components. Selecting an animation while paused
resets the preview to its initial pose without retaining a frozen mix chain.
Selections during playback keep the source mixing settings. Extracted static portraits can be
viewed, played alongside voices and composed with animated artwork. Scenes
reference catalog portraits rather than embedding copies of game images.
Story CG playback follows the source entrance-to-idle events and temporary
per-skeleton speed changes. Available **Next story state** and **Shake scene**
commands use the source transitions; they are not invented canvas hit regions.
The commands have their own Controls section and remain available during
recording, while object edits stay locked. Replay disables the commands.
WQ previews retain their separate animation-loop path. Story callback state is
saved with scenes. Browser checks cover source callbacks, recorded commands,
scene recovery and export. Original-client visual comparison remains pending.
Some source entrances have an event named `stand` but no matching event string.
The archived receiver compares that string; these layers retain the final
`start` pose. Artwork details and exports identify the unavailable transition
cue separately from missing animation files.
Station views use the original drawing template and exact story skeleton
references. They initialize the source idle and expression tracks. Configured
touch regions select paired actions and expressions, reject repeated clicks
until the action completes, then restore both idle tracks. Drawings without
action lists remain noninteractive. Scenes and recordings retain the choice
stream so exports reproduce the same actions. These views appear separately
from the raw story animation previews; actions do not imply voice playback.
Station voice selection follows the skin's own-voice setting and the drawing's
explicit voice IDs. Configured pools have a separate **Station voice pool**
filter. These are manual previews; loading a drawing does not synthesize a login
or account-specific greeting. Speech remains attached to the selected scene
object when saved or exported.
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
Rendering uses WebGL 1 when available and falls back to WebGL 2 on browsers
that expose only that context. This keeps the same artwork renderer and export
features; it does not substitute a static preview.
Character and story voices can be selected for export. Optional burned-in
subtitles retain the source line, wrap to fit the output and follow the selected
voice's offset, duration, speed and repeat settings. They use whole-line timing,
not inferred word timings, and can also be rendered without an audio track.
AAC files use their gapless playback tags to trim retained encoder padding.
Audio already aligned by the browser is left unchanged. Export mixing uses
48 kHz audio for consistent voice, effect and subtitle timing.
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
Use `--engine chromium`, `--engine firefox` or `--engine webkit` to select the
browser engine. The 235-file real-resource fixture passes folder import,
replacement, cancellation, cross-tab notifications, offline reload, byte ranges,
original fonts, skill events and offline PNG export in all three engines.
WebKit's offline-emulation failure is [tracked upstream](https://github.com/microsoft/playwright/issues/42775);
its test stops the origin server instead and confirms uncached requests fail.
Add `--full` after creating `private/mte-resources.zip` to test the entire local
library in an isolated browser profile. The isolated test profile is removed after the
test; original game files and the resource archive are retained.
The full 17,822-file pack also passes indexed-file and catalogue matching,
offline library reload and offline skill PNG export in Chrome, Firefox and
WebKit with sufficient storage. This does not establish released Safari/iOS compatibility.
Use `--archive /path/to/resources.zip` with `--full` for a different local ZIP.
Storage quota varies by browser and profile. A low-quota or private session may
reject the full library even when a smaller pack works. Use a regular browser
profile with sufficient storage; a rejected import retains the previous pack.
Pack activation checks the imported manifest in bounded batches, including file
sizes and media types, without enumerating a multi-gigabyte cache in one request.
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
`node tools/check_browser_compatibility.mjs chromium`, `firefox` or `webkit` after installing
the corresponding Playwright browser. They exercise real assets, special
interactions, scene undo, video/audio decoding and audio alignment, PNG and ZIP.
WebKit automation is not a substitute for testing released Safari and iOS.
The tested Firefox 155 build supports WebM export but not MP4 encoding on this
Mac. Artwork variants, character backgrounds, scene ZIP round-trips and cancellation
also have Firefox checks. This does not establish released Firefox or Windows compatibility.
On macOS with a shared Firefox application-data startup failure, an independently
named test application configuration can be supplied with `MTE_FIREFOX_TEST_APP`;
the harness creates and removes its own temporary profile without using a personal
profile. See the [upstream launch issue](https://github.com/microsoft/playwright/issues/42768).
Windows and released Safari/iOS verification remain outstanding. Simulated encoder and
graphics failures are checked separately by `node tools/check_export_fallback.mjs`.

Interactive presentations with `start` and `animation` play the entrance once
and queue the available idle after its full duration; raw standalone previews
keep their configured loop. Zero-scaled bones remain collapsed without producing
non-finite IK or applied-transform values. Expanding them resumes normal solving.
Interaction details list missing initial animation references as well as absent
alternate variants. `tools/check_controllers.mjs` explores loaded controller
states and reports inactive regions, source gaps and its bounded-search limit;
a limited search is not evidence of complete behavioral coverage.
Long checks can use `--checkpoint private/controller-audit.jsonl --steps 64`.
Repeating the command resumes the pending queue; omit `--steps` to run until
the queue is exhausted or the state limit is reached. Increasing
`MTE_CONTROLLER_STATE_LIMIT` resumes the unfinished boundary state rather than
dropping its remaining transitions. Run only one process per checkpoint and
use a new file after changing the runtime or converted resources.
`node tools/check_interaction_regions.mjs` separately samples the source collider
interiors after entrance playback and checks object-transform invariance across
all interactive presentations. Regions not hit by its samples may overlap other
regions or require a different animation state; this is not an exhaustive
raycast or original-client priority comparison.
Card exploration uses valid random checkpoints for each of the three possible
reveals. Checks run in an independent scene and do not change the editing scene.
Drag-bone receiver data and non-click bone-bound range markers are retained.
The scene-local receiver retains target colliders, shared bone writes and the
default OutQuad return. Strict source-space bounds follow editor rotation,
scaling and mirroring. Its motion and pointer state
survive scene restore; disabled source components stay disabled. Check the real
six-skeleton receiver with `node tools/check_bone_drag.mjs`. Gallery pointer input
prioritizes the source drag collider over camera panning, with cancellation on
pinch, pause or rendering interruption. Recording stores world-space pointer
positions, including ignored out-of-range input, and closes held drags when
recording stops. Replay and independent export use the same receiver; original-client
input ordering and visual comparison remain pending.

The interaction sequence engine records accepted clicks and requests for missing
clips against a captured initial scene using simulation
time. Missing-animation notices include controller defaults and current state
overrides, not just names declared on click regions. Notices update with scene
and interaction changes; an unavailable clip is not replaced with another animation.
Original click sound and voice requests run before animation lookup, so an
available recording can still play when its animation is missing. These requests
retain their timestamps in replay, offline preparation, subtitles and video export.
Clear-and-toggle interactions clear the nonzero target track even when the next
clip is missing; ordinary toggles do not clear that track.
Missing-variant transitions remain labelled unavailable and preserve the
source toggle; replay requires the same availability outcome. Replay targets the original object,
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
