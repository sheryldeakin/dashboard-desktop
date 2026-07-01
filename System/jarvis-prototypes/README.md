# Jarvis center-element prototypes

Working prototypes for the Jarvis assistant visual identity, iterated in a browser lab against a top-down moon-jellyfish reference (`ref-jelly.jpg`). Not shipped — reference material for the eventual integration into `jarvis-dark.html` (full dashboard shell).

Open any of these directly in a browser (or serve the folder with `python -m http.server`) and interact.

## Files

**`jarvis-jelly-lab.html`** — Current winner. Full-featured Three.js prototype:
- Layered top-down jellyfish shader (bell body, network of neurons + curved bezier lines, radial canals from notches, scalloped double-ring rim, atom center as SDF thick-X)
- Optional PBR glass shell (MeshPhysicalMaterial with transmission + iridescence + clearcoat + PMREM-generated envMap), scallop-deformed so highlights follow the 8 ridges
- Voice-reactive atom shader — breathes/wobbles with a fake TTS envelope; wired for real voice via `atomMat.uniforms.uAudioLevel` / `uPhoneme`
- Three voice states with distinct motion cues:
  - **Speak** — envelope-driven full-body wobble + per-arm shape morphing + phoneme pop
  - **Think** — atom spins clockwise + slow pulse; interior network activity boosted
  - **Listen** — attentive lean (atom drifts position) + inward light wave + perimeter chase around rim; exterior near-still
- Themes preserved in `THEMES` config (default = neutral cyan; chromatic = cyan/violet/white palette-per-state)
- Pixel-diff harness (three-panel view + MSE against ref)

**`jarvis-jelly-lab-v1.html`** — Frozen snapshot from before the glass shell + animations were added. Useful reference for the "flat" look if we ever want it back.

**`jarvis-quad.html`** — 6-variant comparison page (COMBO / D / E / F / G / H / I / J / K). Includes the network-graph and glass-bubble variants from the earlier design exploration. Kept as a menu of alternatives.

**`ref-jelly.jpg`** — the AI-generated moon-jellyfish reference we've been matching against.

## Next integration steps

1. Extract the reusable disc + glass + atom code from `jarvis-jelly-lab.html` into a standalone component (`web/src/components/JarvisCore.jsx` or similar).
2. Replace the WebGL orb in `scratchpad/jarvis-dark.html`'s center with it.
3. Wire the real TTS audio graph into `uAudioLevel`/`uPhoneme` (see the fake `updateVoiceSim` function inline as a reference driver).
