# Changelog

Notable changes to BLOCKING.3D. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- **Orbit view crashed on entry.** `SceneEditing` assigned to
  `TransformControls.prototype.__orbit`, but drei's `TransformControls` is a `forwardRef` object
  whose `prototype` is `undefined` — the assignment threw a `TypeError` and took down the render
  tree. The guard around it only ran when default controls existed, so Plan view survived and Orbit
  did not. The workaround was also unnecessary: drei already disables the default controls on
  `dragging-changed`, so the fix was a deletion. The browser suite now enters Orbit view, selects an
  element, mounts a gizmo and rotates the camera — it never did, which is why this shipped.

### Added

- **Editable camera trajectory.** Camera keys are no longer static markers: click one to select
  it, drag it in 3D (including height) and the curved trajectory — the same centripetal
  Catmull-Rom curve the solver actually produces, not a straight-line stand-in — reshapes live,
  before you release. Click the ribbon between two keys to insert a new one at their midpoint in
  time; `Delete` removes the selected key. Collision colouring returns the instant you let go and
  the scene re-solves; while dragging, the ribbon shows a plain preview because collision against
  the set isn't recomputed on every frame — recomputing the whole scene per pointer-move would
  cost far more than a drag should.
- **Per-element reference images, visible at a glance.** Every actor, prop and zone row now
  carries its own thumbnail/upload slot in the inspector, instead of only the currently selected
  element. With four actors, four independent images are visible without clicking through them
  one at a time — the data was already per-element (`scene.refs[entityId]`); only the affordance
  to see it was missing.
- **Loading feedback.** A shared spinner on every wait whose duration cannot be known: scene
  generation, key test, auto-correct, AI modelling, scene edits, reference upload, render submit.
  The capture step keeps its progress bar, because there the duration genuinely is known.
- **Task tracking.** `getTaskDetail` now reads the whole `recordInfo` payload — `progress`,
  `creditsConsumed`, `costTime`, model and timestamps — and names the five documented states instead
  of guessing the phase from message substrings. A first call right after submission confirms kie.ai
  accepted the task. A `taskId` field queries any task and picks its result back up, so a closed tab
  or an expired wait no longer strands a paid render.

### Changed

- **English is the default language, always.** Following `navigator.language` opened the app in
  French for half its visitors while the repository and its documentation are in English. Only an
  explicit, persisted choice overrides the default.
- **Polling follows the documented practice:** 3 s to start, easing out to 15 s, giving up at
  15 minutes, instead of a flat 6 s interval.

---

## [1.0.0] — Initial release

### The pipeline

- Three navigable screens — blocking, prompt, render — with a rail that reports each step's derived
  state: done, ready, running, or blocked with the reason spelled out.
- Scene generation from a written description through GPT-6 Astra on kie.ai.
- Prompt written from the solve: crossing timecodes, focal length, rig behaviour, walking speeds,
  beat breakdown, continuity locks and negative constraints.
- Two blocking passes recorded to mp4 and sent to Seedance 2.5 as reference video, with the
  instruction that stops the model reproducing the proxy aesthetic.

### The engine

- **The scene is a pure function of time.** Positions are read from curves re-parameterised by arc
  length, with no state accumulating between frames — which is what guarantees no teleporting, exact
  scrubbing, and collision detection computed ahead of playback.
- Zone adjacency graph with generated, named doorways serving three roles at once: a passage, an
  opening cut in the wall, and a named collision volume.
- Breadth-first routing with square-on approaches and centripetal Catmull-Rom paths.
- Five camera rigs modelled as damped follows, so they cut corners the way an operator does — which
  is precisely what makes doorframe collisions real rather than decorative.
- Frame-by-frame sphere sweep against walls, lintels, jambs and props.
- Escalating auto-correct: path relaxation, then bounded rig variants, never applying a result worse
  than the current state.

### Editing

- Gizmos for props and zones; moving a zone rebuilds the doorway graph and every route.
- Character paths frozen into draggable waypoints, with insertion on the line and deletion by key.
- Camera keyframes placed at the playhead, unified with the auto-correct output so a corrected
  trajectory became editable by hand.
- Scene edits by prompt returning a **patch**, never a full graph, so hand-tuned work survives.
- Per-element reference images, numbered and described in the generated prompt — the only way to
  bind an image to an element with a flat-list API.
- Optional AI-written geometry for three.js and Blender, inside an imposed and re-verified bounding
  box.

### Exports

- Blender script with per-frame baked animation and axis conversion applied.
- Seedance prompt and a re-importable SceneGraph carrying edits, AI models and reference images.

### Notable fixes during development

- **A door was a solid block.** Every prop got a single axis-aligned volume, so a `door` sealed the
  opening it represented. The camera could not pass, and no path correction could help. Doors now
  produce two jambs and a lintel, matching their proxy.
- **Doors were ejected from their opening.** Normalisation clamped every prop into a zone footprint,
  but a door lives between two zones — it landed in the middle of the corridor, across the camera
  path. Doors are now magnetised onto the nearest opening.
- **Auto-correct could apply a worse result** and had no `finally`, so an exception left the button
  disabled for good — the reported symptom was "clicking does nothing".
- **Prop rotation was ignored in collision**, so a truck turned a quarter turn presented a crossed
  footprint.
- **The header clipped its own controls** below 1136 px, making the export and render buttons
  unreachable in a narrow window.
