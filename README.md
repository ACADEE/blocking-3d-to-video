<div align="center">

# BLOCKING.3D

**Turn a written scene into a 3D blocking, then into a photoreal shot.**

Describe a scene in plain language. Get a playable 3D previz with continuous character paths,
a solved camera rig and real collision detection — then send it to a video model that *follows
your staging* instead of inventing its own.

[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![three.js](https://img.shields.io/badge/three.js-r170-000000?logo=threedotjs&logoColor=white)](https://threejs.org)
[![Tests](https://img.shields.io/badge/tests-87%20passing-38d17a)](#testing)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Quick start](#quick-start) · [How it works](#how-it-works) · [The three steps](#the-three-steps) · [Editing](#editing-the-blocking) · [Exports](#exports) · [Architecture](#architecture)

</div>

---

## The problem

Text-to-video models are extraordinary and uncontrollable. You write "the camera follows her into
the kitchen", and you get *a* camera and *a* kitchen — rarely yours. Reroll, rewrite, reroll. It is
a slot machine with a credit card attached.

**BLOCKING.3D makes the staging an input instead of a hope.** You block the shot in 3D — rooms,
character paths, camera trajectory, lens, timing — then hand that blocking to the video model as
reference footage. It follows the geometry you built and spends its intelligence on photography:
faces, materials, light.

> The blocking is the skeleton. The model adds the photography.

---

## Quick start

```bash
git clone https://github.com/ACADEE/blocking-3d-to-video.git
cd blocking-3d-to-video
npm install
npm run dev        # http://localhost:5173
```

**No API key needed to try it.** Three sample scenes are bundled and load instantly — zero API
calls, zero credits. Open the app and click **L-shaped apartment** to see collision detection,
auto-correction and the full editing toolset immediately.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with the kie.ai proxy (avoids CORS) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | 87 tests on the geometry engine, exports and i18n |
| `npm run test:watch` | Same, in watch mode |

**Requirements:** Node 18+, and a Chromium-based browser for the video capture step
(`MediaRecorder` with mp4 support — Chrome or Edge).

---

## You need a kie.ai API key

Scene generation runs on **GPT-6 Astra**, available **only through kie.ai**. An OpenAI or Anthropic
key will not work here.

<div align="center">

### → [**Create your API key on kie.ai**](https://kie.ai?ref=3b936d7970ee7afd4833f087a6c6b2bb) ←

</div>

1. Create an account at [kie.ai](https://kie.ai?ref=3b936d7970ee7afd4833f087a6c6b2bb)
2. Open **API Key** in the dashboard and generate a key
3. Paste it on the app's home screen and press **Test**

Credit is prepaid. Generating a scene costs about **0.9 credit**. A path correction or an AI
modelling call runs at `medium` reasoning effort and costs a little more. A Seedance render is
billed per generation.

The key lives in your browser's `localStorage` and is only ever sent to `api.kie.ai`. There is no
backend, no telemetry, no account.

---

## How it works

```
   your words              GPT-6 Astra                 solved in-browser
┌────────────────┐      ┌──────────────┐      ┌──────────────────────────────┐
│ "a woman walks │─────▶│  SceneGraph  │─────▶│  zones · doorway graph       │
│  into the      │      │  zones       │      │  continuous character paths  │
│  kitchen…"     │      │  actors      │      │  camera rig · collisions     │
└────────────────┘      │  props       │      └───────────────┬──────────────┘
                        │  camera      │                      │
                        └──────────────┘                      ▼
                                              ┌──────────────────────────────┐
   photoreal shot         Seedance 2.5        │  2 video passes + a prompt   │
◀─────────────────────────────────────────────│  written from the solve      │
                                              └──────────────────────────────┘
```

### The one design decision that matters

> **The scene is a pure function of time.**

Every actor position and every camera position is read from a pre-sampled curve, re-parameterised
by arc length. No state accumulates between frames. That single choice buys three things at once:

- **No teleporting.** You interpolate a continuous curve; there is nowhere for a jump to come from.
- **Exact scrubbing.** Landing on the same timecode twice gives the same frame, always.
- **Collisions known in advance.** The whole take is swept before you press play.

The 3D render loop advances `time` in the store; the timeline *reads* it. One clock, so the playhead
and the viewport cannot drift apart.

---

## The three steps

The header carries a three-step rail. Each step is a real screen you navigate to, and each reports
its own derived state — done, ready, running, or blocked **with the reason spelled out**. Nothing is
greyed out in silence.

### 1 · Blocking

Rooms become zones. Adjacent zones get a **doorway**, which serves three purposes at once: a passage
characters must walk through, an opening cut into the wall, and a named collision volume. That is
why an alert can say `Kitchen Doorframe` — the name is generated, not written by hand.

Characters route between rooms with a breadth-first search, approach every opening square-on, and
move along a centripetal Catmull-Rom curve re-sampled by arc length. Constant walking speed, no
corner-cutting through walls.

The camera is **not** a fixed point on the subject's curve. A steadicam operator tracks their
subject but takes their own line, and that line cuts corners — which is exactly what clips
doorframes in previz. The rig is modelled as a damped follow, integrated once, deterministically.

### 2 · Prompt

The prompt is written **from the solve**, not from an estimate: crossing timecodes, focal length,
vertical field of view, rig behaviour, walking speeds in m/s, beat breakdown, continuity locks and
negative constraints. Editable, with one-click regeneration.

### 3 · Render

Two blocking passes are recorded to mp4 straight from the viewport — an isometric overview and the
camera POV — and sent to **Seedance 2.5** as reference video alongside the prompt.

The prompt gains a section that draws the line explicitly:

- **Follow** the camera trajectory, the character paths, the set layout, the transition timings.
- **Do not reproduce** the grey proxy look, the coloured cylinders, the wireframes, the labels.

Without that section a video model happily imitates the previz aesthetic and returns grey cylinders.

---

## Collision detection

Set volumes are built from the scene — walls pierced at the openings, lintels, door jambs, props —
and the camera track is swept frame by frame with a 0.35 m sphere.

```
SYSTEM ALERT
Camera trajectory collision detected at 00:09 with Kitchen Doorframe.
[ AUTO-CORRECT PATH ]
```

That message is **computed, not scripted**. The walls you see on screen are rendered *from the
collision volumes themselves*, so what you look at is exactly what blocks the camera.

### Auto-correct

Clicking **AUTO-CORRECT PATH** runs an escalating search:

1. **Path relaxation** — push offending points out, re-centre passages on openings, smooth, refit
   the spline and re-sweep. Verification happens in the representation the engine actually uses.
2. **Rig variants** — if the set is genuinely too tight, five bounded variants are tried (follow
   distance shorter/longer, take lengthened) and the first that clears is kept.
3. **With an API key**, GPT-6 Astra proposes a trajectory first — and **the proposal is re-swept
   before it is applied**. If it still collides, the local solver takes over.

Nothing is applied that is not strictly better than the current state, and any rig setting the
solver changed is named back to you and undoable.

> Why a search rather than advice? Because the outcome is not predictable. On one test scene,
> lengthening the take to 18 s does not clear it but 24 s does; shortening *and* lengthening the
> follow distance both clear it; and the initial contact count *rises* in cases that end up solved.
> Each trial is ~115 ms of deterministic computation. The tool tries; it does not guess.

---

## Editing the blocking

Everything the model produced is editable. You edit the *definition* of the scene, and it is
re-solved — the scene stays a pure function of time, so playback and scrubbing remain exact.

| What | How |
|---|---|
| **Objects & zones** | Select, then drag the gizmo. Moving a zone rebuilds the doorway graph and every route. |
| **Character paths** | **Edit path** freezes the computed route into handles. Drag one to move it, click the line to insert a point, `Delete` to remove one. |
| **Camera** | Place the camera in Top or Orbit view and **Key the camera here** records position and orientation at the current timecode. |
| **Add elements** | Type `add a red car near the entrance`. The model returns a **patch**, never a full graph — so your hand-tuned paths and positions survive. |
| **Reference images** | Attach an image to any actor, prop or zone. It is sent to Seedance *and named in the prompt* (`reference image 2 shows the KITCHEN`), which is the only way to bind an image to an element with this API. |
| **AI geometry** | Let GPT-6 Astra write the actual mesh — three.js for the browser, Python for the Blender export. The bounding box is imposed and re-verified, so a detailed model never moves your framing or your collision volumes. |

Three viewports: **Camera** (through the lens, with an aspect matte), **Top** (orthographic floor
plan) and **Orbit** (free inspection, with trajectory ribbons and the camera frustum).

---

## Exports

### Blender (`.py`)

A standalone script — paste it into Blender's Scripting tab and run. Everything lands in a
`BLOCKING_3D` collection, so your existing scene is untouched.

- Floors, walls, lintels and door jambs (the actual collision volumes)
- Props as blocking volumes, with vehicles assembled from primitives
- Actors and camera baked **one keyframe per frame**
- Correct focal length (vertical sensor fit, 24 mm), aimed by a `TRACK_TO` constraint
- Scene fps, frame range and render resolution set from the project

Axis conversion (three.js Y-up → Blender Z-up) is applied at export. The motion matches the browser
preview exactly.

### Seedance 2.5 prompt (`.txt`) · SceneGraph (`.json`)

The prompt in full, and the raw graph — re-importable, and carrying your edits, AI models and
reference images with it.

---

## Video constraints

Seedance's limits are enforced locally **before** anything is sent, because discovering them at the
API costs a round trip and sometimes a credit:

| Constraint | Value |
|---|---|
| Container | mp4 or mov |
| Pixels (w × h) | **409,600 – 927,408** |
| Aspect ratio | 0.4 – 2.5 |
| Duration | 4 – 30 s |
| Size | ≤ 200 MB |

`1280×720 = 921,600` fits. `854×480 = 409,920` fits. **`1920×1080 = 2,073,600` does not** — which is
why 1080p is not offered as a capture size.

Capture happens in a dedicated viewport sized to the exact target definition. React Three Fiber
sizes its canvas from the *measured* container, so scaling the preview with a CSS transform would
shrink the buffer with it; the preview is shown at its real reduced size and `devicePixelRatio`
compensates, landing the buffer on 1280×720 exactly.

**On hosting the clips.** Seedance downloads its references from its own servers, so a `blob:` URL
from your browser is useless to it. The app tries kie.ai's file service, but that service is
separate from the generation API and may not be reachable from a browser (CORS). If the upload
fails you get a clear message: download the clip, host it anywhere public, and paste the URL.
**That manual path always works.**

---

## Architecture

```
src/
  api/         kie.js · seedance.js · upload.js · prompts.js
  scene/       geometry · normalize · graph · paths · camera
               collision · autocorrect · build
  export/      blender.js · seedance.js · recorder.js
  proxies/     registry.js (types, bounds) · Proxies.jsx · AIModel.jsx
  components/  IntroScreen · Header · PipelineRail · Viewport · Timeline
               Inspector · SystemAlert · EditToolbar · SceneEditing
               ScenePrompt · RefImage · PromptScreen · RenderScreen · CaptureStage
  i18n/        index.js · en.js · fr.js
  fixtures/    restaurant · apartment · street
```

**Stack:** Vite · React 18 · react-three-fiber + drei · three.js · zustand · Tailwind · vitest.

`normalize.js` is the guard rail between the model and the renderer: unique ids, broken references
re-pointed, overlapping rooms pushed apart, props pulled inside their zone — and doors magnetised
onto their opening, because a door lives *between* two rooms and clamping it into one drops it in
the middle of the passage. Every fix is surfaced as a warning.

### Testing

87 tests, run serially so the suite never lies about its own scope:

```bash
npm test
```

They cover the things that would silently rot: per-frame displacement stays bounded by walking speed
(the no-teleport guarantee), doorways stay passable, camera keys are hit exactly, auto-correction is
verified in the final representation, Blender export axis conversion, Seedance payload rules, and
dictionary parity between English and French.

---

## Internationalisation

English by default, French one click away, browser language respected on first visit. Prompts sent
to the model always stay in English — they address a machine, not a reader.

---

## Keyboard

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `←` `→` | Previous / next frame (`Shift` = 10 frames) |
| `Home` | Back to start |
| `L` | Loop |
| `V` | Cycle Camera / Top / Orbit |
| `Delete` | Remove the selected path point |

---

## Roadmap

- [ ] Resume a render from its `taskId` after a timeout
- [ ] Session persistence — a refresh currently loses the scene, clips and render
- [ ] Bézier handles on path points, on top of the current draggable waypoints
- [ ] Multi-shot sequences

---

## License

MIT — see [LICENSE](LICENSE).

<div align="center">
<sub>Built by <a href="https://github.com/ACADEE">ACADEE</a> · Powered by <a href="https://kie.ai?ref=3b936d7970ee7afd4833f087a6c6b2bb">kie.ai</a></sub>
</div>
