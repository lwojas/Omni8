# State & persistence

## The model

```
AppState
├─ project (persisted)
│  ├─ projectName, bpm, swing, pattern (current), chain[] ({pattern, repeats, label?}), chainOn
│  ├─ rig[8][2]: { engine, variant } per slot       which engine is in each slot (project-wide, not per pattern)
│  ├─ scale: { root, scale, preset }
│  ├─ mixMode: "song" | "perform"        where faders, mutes and solos live
│  ├─ perfLevels[8]                      the faders in PERFORM mode
│  ├─ arp[8]: ArpSettings per track
│  └─ patterns[64]: Pattern
│       ├─ length (16 | 32 | 48 | 64)
│       ├─ tracks[8]: TrackPattern
│       │    ├─ steps[64]: { on, note, acc, slide, gate?, parameterLocks? }
│       │    ├─ slots[2][SLOT_KNOBS]   normalised 0..1: engine knobs 0-5, LEVEL at index 6 (catalogue.ts)
│       │    ├─ level, oct, mute?, solo?      mixer state in SONG mode (absent = off)
│       │    ├─ dly: { send, mode, time, div, fb? }     rev: { send, size }
│       │    ├─ dist        distortion insert (a track with a synth), 0 = off
│       │    ├─ filter: { mode, cut, res }         LP/HP insert (every other track)
│       │    ├─ lfos[3]: { on, target, wave, sync, rate, div, depth }
│       │    ├─ punch: boolean                     does this track take part in the Punch FX
│       │    └─ last?: 1-based last step (absent = pattern length); the track loops there, see timing
│       ├─ fxLanes[3]  one recorded punch-in take each (FX_LANES):
│       │    ├─ fx[64]     punch id per step (0 = none)
│       │    └─ fxLvl[64]  sweep level 0..1 at the start of each step
│       └─ mangler: { sweep, param[] }   sweep-in time and character knob per punch
└─ performance (not persisted)
   library, slot, mutes, solos (PERFORM mode's), focus, page, selStep, follow, tab, seqView, write, erase, rec, plock, punch, punchSel,
   chainEdit, chainSel, copyArm, audio, audioError, playing, hostBpm, playPattern, chainPos, cue, fxPlay, keyHighlight, storageBlocked
```

All 64 patterns always exist in memory (`NUM_PATTERNS`). Every pattern holds 64 steps for every track regardless of
`length`: lengthening a pattern reveals data rather than allocating it.

### Rig versus pattern

The split is the central design decision:

| | Lives in | Why |
|---|---|---|
| Which engine is in a slot, which drum voice, which sample | `AppState.rig` (project) | Changing it creates and removes DSP nodes. That must not happen at a pattern boundary mid-song, and the plugin's native sequence needs the graph to be the same shape every time. |
| What the engine's knobs are set to | `TrackPattern.slots` (pattern) | Locks, copy and the chain then behave as for any other pattern data, and switching pattern can change the sound on the bar line. |

**Swapping an engine** (`setSlotEngine`, `setDrumVoice`, `setSlotSample` in `actions.ts`) resets that slot's knobs to the new
engine's defaults in *every* pattern, so no value written for the old engine survives. It also removes that slot's step locks and
any LFO aimed at the slot. Choosing a new sample for a SAMPLE slot keeps its mode, level and decay but resets START/END, which
mean nothing to a sample of a different length. A change that moves the track's insert (a synth appears or goes) resets the
insert to its off state and switches off LFOs aimed at the old one.

### Immutability

State is never mutated. `setState` shallow-merges a patch; `editPattern(edit, index?)` clones one pattern with
`structuredClone`, applies the edit and replaces it in a copied `patterns` array. Reference equality is the change
signal: `next.patterns !== prev.patterns` is how the controller, persistence and params know to react. Selectors in
`useStore` should return primitives or stable references. `trackProfile` is cached per `TrackRig` object (a `WeakMap`), so
`useProfile(track)` is a stable reference until that track's slots change.

### Observers

`observe((next, prev) => …)` is the non-React subscription. It runs synchronously inside `setState`, before React
listeners. Three subsystems use it: the controller (to sync audio), persistence (to autosave), and params (to report
changes with their origin). Keep observer work cheap and idempotent: it runs on every change.

### Origins

`source.ts` keeps an ambient tag for the duration of one synchronous write. Anything not wrapped in
`withSource(...)` is `ui`. The scheduler's own pattern, chain and page moves are `internal`. See [MIDI](midi.md#echo).

## Normalised controls

`TrackPattern.slots[slot][i]` is 0..1. `spec.ts` converts it to engine units through `normToUnits`, which handles linear,
exponential and power (`gamma`) curves and stepped controls (`steps`). Saving normalised values means a range can be retuned
without invalidating any project.

A control's `dest` says where it lands: absent means a webdsp instrument parameter, `"level"` is the slot's own bus gain, and
`"sample"` means a playback setting read when a note triggers (so it cannot be locked per step or driven by an LFO). A
control with a `top` label reads that label from `TOP_AT` (0.98) upwards (a sample's DECAY reads FULL).

Slot positions are fixed-width: a position the slot's engine has no knob at is stored as 0 and never written. That is why the
lock ids (`slot.a.3`), the MIDI knob positions and the parameter ids (`track.1.a.3`) are all *positions*, not control names.

## Persistence

`persist.ts` (policy) over `db.ts` (IndexedDB mechanism). Three object stores (database name = `PRODUCT.id`, version 2):

| Store | Holds |
|---|---|
| `current` | A single autosave slot |
| `saves` | Named projects, keyed by id, with `savedAt` |
| `samples` | Imported samples: `{ id, name, bytes }`, the original file bytes. The factory set is generated, never stored |

IndexedDB rather than `localStorage`: 64 patterns are ~1.7 MB, and `localStorage` is string-only and capped around 5 MB
for the whole origin.

### What is saved

`Saved` = `projectName, rig, patterns, chain, chainOn, bpm, swing, pattern, scale, arp`. `snapshot()` builds it; the autosave
observer compares the same list (`persisted`) by reference to decide whether anything changed. **If you add a persisted
field, add it to all three** (see the recipe in [Extending](extending.md#persist-a-new-piece-of-project-state)).

Imported samples are *not* part of the project file: a project names a sample by library id, and the bytes stay in the browser's
`samples` store. A project moved to another browser keeps the slot but the sample is missing there (the factory samples, which
are generated, always resolve).

### Autosave

500 ms debounce after a change, flushed immediately on `visibilitychange → hidden` and `pagehide`. A failed write sets
`storageBlocked`, which the UI surfaces. The initial restore (`loadProject`) runs before the first render and before
autosave starts, so it cannot be overwritten by defaults.

### In a plugin host

Inside the VST3 build the autosave slot is replaced by the DAW session (`restoreFromHost`, `toHostSnapshot`, publishing from
`autosave`). The snapshot compacts each pattern (trailing blank steps dropped, untouched LFOs left out) and `expandPattern`
restores it. The rules, and why, are in [VST3 build](vst.md#project-recovery-closing-and-reopening-the-window).

### Export and import

A JSON file `{ app, version: 1, name, project }` named `<name>.hybrid8.json`. Untouched patterns serialise as `null`
(`sparse`) because 64 full patterns are large; import fills them with fresh ones built for the project's rig.

### Validation and migration

Every load path (autosave, named save, import) goes through `parseProject`:

1. Bounds-check the container (1–64 patterns), build the `rig` with `normalizeRig` (an unknown engine, an unusable drum voice or
   a missing sample falls back to that slot's starting value, and an unknown synth voice becomes ACID), and pad short arrays with
   fresh patterns.
2. `normalize` each pattern: fill missing `dly`/`rev`, clean `lfos` (`sanitizeLfos`), default `punch` to true, clamp `filter`,
   `dist` and every slot value to 0..1, drop an out-of-range `last`, and rebuild `mangler` if its `param` array is missing.
3. `valid()`: structural checks: every track present, 64 steps, two slots of exactly `SLOT_KNOBS` finite numbers, lane lengths.
   A project failing validation is rejected whole; it is never partially loaded.
4. Clean each step's `parameterLocks` (`sanitizeLocks`: known ids only, finite values clamped).
5. Scalars are clamped or defaulted; `scale` and `arp` pass through their own `normalize*`.

**The rule for changing the shape of saved data:** old projects must keep loading. Add a step in `normalize` /
`parseProject`, never raise `valid()` without a migration that satisfies it, and add a test.

### Blocked storage

Private windows and blocked site data make IndexedDB throw. The app stays fully usable; `storageBlocked` drives the SAVE
warning, and export remains the way out.

### Other storage

`localStorage` holds two per-browser conveniences, keyed by `PRODUCT.id`: `hybrid8.keyHighlight` and `hybrid8.midi` (enabled,
ports, follow clock, keyboard device and octave). Every access is wrapped in try/catch.
