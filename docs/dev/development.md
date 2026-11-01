# Development

## Setup

```bash
git clone https://github.com/lwojas/Omni8.git
cd Omni8
npm install
npm run dev                                            # http://localhost:5175 (next free port if taken)
```

`package.json` depends on `"webdsp": "git+https://github.com/lwojas/webdsp.git"` (its `main`), so `npm install` fetches and builds it
(its `prepare` script runs tsup); no sibling checkout is needed. Hybrid.8 needs `TriggerParams.envelope` (per-trigger sample envelope) and the LFO helpers (`lfoValueAt`, `LFO_DIVISIONS`), which
are in webdsp `main`. To work on webdsp alongside, point the dependency at `file:../webdsp` locally and do not commit that.

Node 22 is what CI uses.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc --noEmit` then `vite build` to `dist/` |
| `npm run preview` | Serve `dist/` |
| `npm test` | Vitest, once |
| `npm run vst:build` | Build the optional `Hybrid8.vst3` (see [VST3 build](vst.md)) |
| `npm run vst:serve` | Production build served on port 5175, for a plugin pointed at local code |
| `npm run vst:e2e` | Headless end-to-end test of the plugin's host path, no DAW |

TypeScript is `strict` with `noUnusedLocals` and `noUnusedParameters`; the build fails on both.

### The Vite configuration

`vite.config.ts` excludes `webdsp`, `webdsp/worklet-url` and `webdsp/sequencing` from dependency pre-bundling. webdsp
resolves its AudioWorklet module with `new URL('./engine-processor.js', import.meta.url)`, and pre-bundling would move
the module and break that lookup. `server.fs.allow: [".."]` lets the dev server read a linked sibling checkout of webdsp, if you use one.

## Tests

Ten files under `test/`, Vitest, Node environment, no audio, no DOM (199 tests). They cover the pure logic:

| File | Covers |
|---|---|
| `engine.test.ts` | Control maths (normalised ↔ units, defaults and presets inside range), the catalogue limits, Punch FX (transparent at rest, takeover rules, sweep level), sends, the randomiser (in range, in scale), scales, the arpeggiator |
| `slots.test.ts` | The two-slot model: one note firing both slots; swapping an engine leaves the other slot, other tracks and the steps alone; knob resets and lock drops; role changes; the insert following the track kind; the shelved engines; instrument creation per slot (against a fake runtime); rig round-trip and repair; the factory samples and WAV encoding |
| `plock.test.ts` | Parameter locks: resolution over the base, sanitising, the scheduled writes, sends and MIDI-mapped knobs in TWEAK mode |
| `distortion.test.ts` | The distortion insert's mapping, locks and ids |
| `laststep.test.ts` | Per-track last step: polymeter loops, swing, arps, locks, chains |
| `record.test.ts` | Nearest-step and gate maths for note recording |
| `midi.test.ts` | Mapping validation, value conversion both ways, channels, echo suppression, banks, the clock follower, song position, all seven knobs of both slots mapped |
| `hoststate.test.ts` | Host-state save/restore and the compacted snapshot |
| `nativeseq.test.ts` | The song compiled to a native sequence |
| `product.test.ts` | The identifiers saved on users' machines stay stable |

What is **not** tested automatically: the sound itself, the scheduler against a real audio clock, LFOs against a real clock, and the
React components. Check those by ear and by eye (`npm run dev`), at phone width, tablet width and wide, and in a short window
(about 1100×700) after touching the instrument band.

When a change touches one of the invariants below, add the test that pins it.

## Invariants worth protecting

- `audio.ts` is the only importer of webdsp's runtime.
- `state.ts`, `spec.ts`, `catalogue.ts`, `slots.ts`, `plock.ts`, `lfo.ts`, `mangler.ts`, `arp.ts`, `scale.ts`, `song.ts` and `midi/clock.ts` stay free of React and the audio runtime.
- The rig (which engine is in a slot) is project data and never changes at a pattern boundary; knob values are pattern data.
- The playhead and key highlights do not go through React or the store.
- CC numbers appear only in `midi/mapping.ts`; channels are 1–16 everywhere except on the wire (`midi/control.ts`).
- Parameter ids, lock ids (`slot.a.3`, `fx.delaySend`), punch ids, engine ids, factory sample ids, gate and arp-rate indexes and saved-array positions are permanent. Append; never reorder or rename.
- Old projects load. Every change of saved shape comes with a migration.
- Every browser-storage access is wrapped in try/catch.
- An engine swap resets that slot in every pattern, and drops its locks and LFOs (`actions.ts`); nothing may keep a value written for the old engine.

## Performance

- One `data-play` attribute flip per step on the old and new cell (per track for the step pads, since a track with a last step has its own position); about 20 attribute writes, no React render.
- Animation is `transform`/`opacity` only. No blurred shadows or filters on step cells, knob arcs or sliders.
- The scheduler runs from a Web Worker timer, so UI work cannot delay it.
- `Groovebox` caches the last value it sent for every parameter; do not bypass the caches with direct runtime calls.
- Selectors return primitives or stable references.

## Deployment

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main` (or by hand):

1. Check out the repo (Node 22).
2. `npm ci`, which fetches webdsp from GitHub and builds it (its `prepare` script).
3. `npm test`, then `tsc --noEmit && vite build --base=/<repo-name>/`.
4. Upload `dist/` and deploy.

A failing test or type error stops the deploy. The `--base` is the repository name, because Pages serves the site from
`/<repo>/`.

## Known limits

- Bus gains, sends, insert-effect parameters and LFOs are not sample-accurate: bus parameters are not schedulable in webdsp, so
  punch *routing* and sends are applied from a 10 ms audio-clock ticker (a few ms of jitter, inaudible at 16th-note resolution),
  and LFOs are written once per tick. Notes, sample triggers, instrument parameters and written Punch FX ramps are sample-accurate.
  A webdsp "schedulable bus params" feature would remove the ticker.
- FX writes are one punch per step per lane (step-quantised), three lanes per pattern.
- In the VST3 build, sample slots play the **whole sample** (the native sequence has no start, end or decay for a sample event yet)
  and **LFOs do not run in the plugin's native sequence**. Both work in the browser build, which is the primary target.
- A sample slot is monophonic: a new hit cuts the slot's previous sample voice.
- Imported samples live in the browser's IndexedDB, not in the project file, so an exported project opened elsewhere keeps the slot
  but not the sample (the generated factory samples always resolve).
- Sound constants and presets are a first pass, set from the parameter tables rather than by ear. Expect them to be tuned.
- MIDI: control input is CC, program change and clock; notes from a chosen keyboard device play the selected track. The app sends
  CC feedback but not notes or clock. Web MIDI availability depends on the browser.

## Related documents

- [Architecture](architecture.md) · [Audio graph](audio-graph.md) · [Timing](timing.md) · [State](state-and-persistence.md)
  · [Extending](extending.md) · [MIDI](midi.md) · [VST3 build](vst.md) · [Shelved engines](shelved-engines.md)
  · [Design record](hybrid8-plan.md)
- `concept/DESIGN/` — the visual design tokens and reference mock-up.
- webdsp's own `ARCHITECTURE.md` and `docs/` — the engine Hybrid.8 is built on.
