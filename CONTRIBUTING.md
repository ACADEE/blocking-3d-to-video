# Contributing

Thanks for taking a look. This project has a small, opinionated core — please read this before
opening a pull request.

## Getting set up

```bash
npm install
npm run dev
npm test
```

No API key is needed to develop: the three bundled fixtures exercise every code path except the
live model calls.

## The one rule that is not negotiable

> **The scene is a pure function of time.**

Actor and camera positions are read from pre-sampled curves. Nothing accumulates between frames.
This is what guarantees no teleporting, exact scrubbing, and collision detection computed ahead of
playback. A change that introduces frame-to-frame state breaks all three at once, so it will be
sent back regardless of how well it works in a demo.

Related invariants:

- **What you see is what blocks.** Collision volumes and rendered set geometry come from the same
  source. If you add a blocking element, render it from its collider.
- **Never trust model output.** Everything from the API goes through `normalize.js` before it
  reaches the renderer.
- **Verify in the final representation.** The auto-correct loop refits the spline and re-sweeps
  before claiming success; a fix validated on an intermediate polyline is not a fix.

## Tests

Add a test when you change the engine. The suite runs serially on purpose — parallel workers were
silently dropping whole files and reporting a green run over a partial scope.

```bash
npm test
```

## Style

- Comments explain *why*, not *what*. If a line needs a comment to say what it does, rename things
  instead.
- Source stays ASCII. UI strings live in `src/i18n/`, never inline.
- Prompts sent to the model stay in English.

## Reporting a bug

Include the SceneGraph. **Export → SceneGraph .json** gives a complete, reproducible case in one
file — it carries the scene, your edits, and any reference images.
