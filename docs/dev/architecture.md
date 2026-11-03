# Architecture

Hybrid.8 is a TypeScript application: React for the interface, a plain-TypeScript engine for everything that matters
musically, and [webdsp](https://github.com/lwojas/webdsp) for sound. The one rule that shapes everything else:

> **The engine does not know the UI exists. The UI does not know the audio exists.** Both talk to a single immutable
> state object.

## The instrument model

- A project has **8 tracks**, and every track has **two slots** (A and B). A slot holds one **engine**, or nothing.
- Which engine is in which slot is the **rig** (`AppState.rig`, `catalogue.ts`). It belongs to the *project*: it is the same in
  every pattern, because swapping an engine creates and removes DSP nodes, which must never happen at a pattern boundary mid-song.
- What the engine *sounds like* belongs to the *pattern*: `TrackPattern.slots` holds each slot's knob values (`SLOT_KNOBS` = 7: up to
  6 engine knobs, then LEVEL; normalised 0..1). Switching pattern can therefore change the whole sound.
- Everything about a track's behaviour is **derived** from its slots, never stored: `trackProfile(rig, track)` says whether it is
  melodic (either slot is a pitched engine), which insert it has (distortion with a synth, an LP/HP filter otherwise), its note
  range, accent colour and display name.
- Engines: `SYNTH` (a voice selector: acid, fm, pad, pluck, saw), `DRUM` (a voice selector: kick, snare, clap, closed hat, open hat, tom), `PERC`, `SAMPLE`.
- Samples are a **shared library** (`samples.ts`): a SAMPLE slot saves a library id, and the audio is loaded into webdsp once
  per id however many slots use it.

[hybrid8-plan.md](hybrid8-plan.md) is the original audit and design record for this model. It is history; this page and the code
are current.

## Layers

```
 ┌───────────────────────────── src/ui ─────────────────────────────┐
 │  React components. Read state with useStore(selector).           │
 │  Change state by calling actions. Never touch audio.             │
 └───────────────┬───────────────────────────────────────▲──────────┘
                 │ actions.ts                            │ useStore
 ┌───────────────▼───────────────────────────────────────┴──────────┐
 │  src/engine/store.ts: one immutable AppState                     │
 │  getState · setState · observe(next, prev) · editPattern         │
 └──────┬──────────────────┬────────────────────┬───────────────────┘
        │ observe          │ observe            │ observe
 ┌──────▼─────────┐ ┌──────▼─────────┐ ┌────────▼─────────┐
 │ controller.ts  │ │ persist.ts     │ │ params.ts        │
 │ clock, steps,  │ │ autosave to    │ │ stable ids, over │
 │ chain, punch,  │ │ IndexedDB      │ │ the same state   │
 │ LFOs, recording│ │ (or the host)  │ │                  │
 └──────┬─────────┘ └────────────────┘ └────────┬─────────┘
        │ drives                                │ used by
 ┌──────▼─────────┐                    ┌────────▼─────────┐
 │ audio.ts       │                    │ src/midi         │
 │ the only user  │                    │ CC · PC · clock  │
 │ of webdsp      │                    │ notes · in & out │
 └────────────────┘                    └──────────────────┘
```

### Why it is built this way

- **One source of truth.** `AppState` is the project plus the performance state. There is no second copy in a
  component, in the audio layer, or in MIDI.
- **Pure where it can be.** `state.ts`, `spec.ts`, `catalogue.ts`, `slots.ts`, `plock.ts`, `lfo.ts`, `mangler.ts`, `arp.ts`,
  `scale.ts`, `trackfx.ts`, `record.ts`, `song.ts`, `stepcompile.ts` and `midi/clock.ts` do not use the audio runtime or React
  (`catalogue.ts` and `lfo.ts` import webdsp's *enums and constants* only). They are unit-tested directly.
- **One audio module.** `audio.ts` is the only file that calls webdsp's `AudioRuntime`. Retargeting the sound engine
  means changing that file and the parameter tables in `catalogue.ts`.
- **One MIDI contract.** CC numbers exist in `midi/mapping.ts` and nowhere else.
- **Live and native playback share their logic.** What one step plays is decided by `stepcompile.ts` and `slots.ts`; the browser
  scheduler and the plugin's native sequence (`nativeseq.ts`) both call them, so they cannot drift apart.

## Module map

### `src/engine/`

| File | Responsibility |
|---|---|
| `../product.ts` | Product identity: name, logo, and the `id` that prefixes every storage key and file stamp. Start a clone here (see [REFERENCE_RESKIN.md](../../REFERENCE_RESKIN.md)). |
| `spec.ts` | The `ControlSpec` type and its maths: normalised ↔ engine-unit conversion (linear, exponential, power and stepped curves), readout formatting, note naming. The 8 tracks' **starting mix** (`TRACKS`). |
| `catalogue.ts` | **The engines.** Each `VoiceSpec` names the webdsp instrument, its macro knobs and ranges, pinned parameters, gain trim and note range. The rig type, `trackProfile`, the default rig, and `normalizeRig` for loading. |
| `slots.ts` | What one track note becomes: per slot, an instrument note or a trigger of the shared sample. Pure. |
| `samples.ts` | The shared sample library: the generated factory set, plus imports stored in IndexedDB. |
| `state.ts` | `AppState`, `Pattern`, `TrackPattern`, `Step`; constructors; the demo groove; the pure pattern edits (`randomizeTrack`, `clearTrackSteps`); `trackLast` / `trackStepAt` (per-track loop length). |
| `store.ts` | The store. `setState`, `observe`, `editPattern`, the `useStore` hook. |
| `actions.ts` | User-level edits, including swapping a slot's engine. UI components and `params.ts` call these. They edit the store and audition. |
| `stepcompile.ts` | One step's notes, shared by the live scheduler and the native sequence. |
| `plock.ts` | Parameter locks (the TWEAK feature): per-step overrides of a track's slot knobs, sends and inserts (`Step.parameterLocks`), resolved against the pattern's base values. Pure. |
| `lfo.ts` | Per-track LFOs: three per track, each pointed at any lockable parameter. Pure; `Groovebox.applyLfos` applies them every tick. |
| `record.ts` | Realtime note recording: maps a key press to the nearest step (`recordStep`) and a held time to a gate (`gateForHeld`). Pure. |
| `controller.ts` | The groovebox controller: transport, the lookahead scheduler, pattern switching and chaining, the punch-in and write logic, note recording, the arpeggiator hosts. Owns the `Groovebox`. |
| `audio.ts` | `Groovebox`: builds and drives the webdsp graph. Slot buses, inserts, the mixer, sends, the punch bus, scheduled parameter ramps, sample voices, LFO writes. |
| `mangler.ts` | The Punch FX catalogue: what every pad does to the shared effect chain at a given amount and sweep level. Pure data and functions. |
| `trackfx.ts` | Per-track delay and reverb sends, the distortion insert and the LP/HP filter insert: models and mappings. |
| `arp.ts` | The arpeggiator. Instrument-agnostic. Notes in, timed events out. |
| `scale.ts` | Keys, scales, genre presets. |
| `persist.ts`, `db.ts` | Autosave, named saves, export/import, migrations. `db.ts` is the only IndexedDB code. |
| `nativeseq.ts`, `hostplay.ts` | The song as a webdsp `Sequence` for a plugin host; following the DAW's transport. See [VST3 build](vst.md). |
| `params.ts` | The registry of externally controllable parameters, by stable id, with change notification. |
| `source.ts` | The ambient *origin* tag for a change (`ui`, `midi`, `host`, `automation`, `internal`). |
| `song.ts` | Maps a linear song position onto the chain or the current pattern. |
| `playhead.ts`, `keyhl.ts` | Direct-to-DOM playhead (per track: a track with a last step lights its own step) and piano-key highlights, bypassing React. |
| `ticker.ts` | A Web Worker timer that drives the scheduler. |

### `src/midi/`

| File | Responsibility |
|---|---|
| `mapping.ts` | **The map.** CC → parameter id. Data only. |
| `control.ts` | Generic MIDI control engine: mapping + a `ParamBus` in, messages out and back. Knows nothing about Hybrid.8. |
| `clock.ts` | Pure MIDI clock / Start / Stop / Continue / SPP follower. |
| `ports.ts` | Web MIDI port management. |
| `setup.ts` | The only MIDI file that imports the app: connects the above to the parameters, the transport and the keyboard. |

### `src/ui/`

`Header` (transport, REC, BPM, pattern readout), `Sequencer` (step pads, keyboards, FX lanes), `Panels` (sound, mixer, track
FX, Punch FX, pattern bank), `ProjectMenu`, `ArpControl`, `LfoModal`, `SampleModal`, `Modal`, `controls` (Knob, Slider,
Stepper, press handling), `profile` (`useProfile(track)`, `accentOf`), `useMedia`, `usePlayhead`. `src/index.css` is the whole
stylesheet.

## Data flow, by example

**A tap on a drum pad.** `Sequencer.tsx` → `tapStep` (`actions.ts`) → `editPattern` clones the pattern and calls
`setState`. Observers run: the controller sees `patterns` changed and syncs the audio graph; `persist` marks the project
dirty; `params` notifies MIDI output. React re-renders only the components whose selector result changed.

**A MIDI CC.** `ports.ts` → `setup.ts` → `control.ts` converts 0–127 to the parameter's domain and calls
`setParam("track.7.a.1", v, "midi")` → `withSource("midi", …)` → the same action the knob uses (`setLockable`) → the
store. The origin tag lets MIDI output skip echoing it back.

**A step plays.** The worker tick → `controller.tick()` schedules audio ~120 ms ahead: `stepcompile.ts` makes the track's note,
`slots.ts` turns it into one play event per slot, `audio.ts` fires them → later, when that step becomes *audible*,
`publishAudible` moves the playhead (direct DOM) and updates the store only for things that change rarely.
See [Timing & scheduling](timing.md).

**Swapping an engine.** `setSlotEngine` (`actions.ts`) changes the project's `rig`, resets that slot's knobs to the new
engine's defaults in *every* pattern, and drops that slot's step locks and any LFO aimed at it. The controller sees the rig
change and calls `Groovebox.syncRig`, which removes and creates the one instrument and loads the sample if needed. Nothing else
in the graph changes.

## Design principles in the code

- **Controls are stored normalised (0..1).** Ranges are tuned in `catalogue.ts`; saved patterns survive retuning.
- **Ranges are narrower than the engine's, on purpose.** The whole knob travel should sound good.
- **Sound belongs to the pattern; the rig belongs to the project.** Pattern switching is a state change the audio layer applies at the loop boundary.
- **Performance state is not saved.** PERFORM-mode mute and solo, arming (REC, REC FX, ERASE) and the visible screen are not in `Saved`. The mix mode (`mixMode`, SONG or PERFORM), the PERFORM faders (`perfLevels`) and each pattern's `mute` / `solo` are: `levelOf`, `muteOf` and `soloOf` (state.ts) say which set applies.
- **Caches everywhere on the audio side.** `Groovebox` remembers the last value it sent for every parameter and sends
  only changes.
- **Ids and saved positions are permanent.** Parameter ids, lock ids, punch ids, gate indexes, arp rate indexes and engine ids
  are written into saves or bound by a DAW. Append; never reorder or rename.

## Interface design

The visual language lives in `concept/DESIGN/` (`DESIGN.md` tokens and a reference mock-up). `src/index.css` implements
it: dark surfaces, accent colours per part (`--drum`, `--bass`, `--tone`, `--synth`) and `--fx`, tabular mono readouts.

Layout is CSS-only, by media query, with the one JavaScript exception that components read the phone query (`PHONE` in
`useMedia.ts`) to choose shorter labels:

| Query | Layout |
|---|---|
| `max-width: 699px` | **Phone**: five tabs; short labels (CLR, ACC, SLD) |
| `700px` and up, below `1100px` | **Tablet**: the same tabs with more room |
| `min-width: 1100px` | **Desktop**: one page; transport and patterns on top, instrument band, sequencer with a slim mixer beside it. Narrower overrides below 1300 and 1500 px wide |
| `min-width: 1100px` and `max-height: 820px` | **Short window**: the band is the tallest fixed-height row, so it is compacted (sends move to a strip under the knobs) to keep the sequencer keyboard on screen. A tighter step applies at 760 and 680 px high |

A DAW's default plugin window is about 1100×700, so check that size (and 1100×640) after any change to the band panels. Heights
come from the `--cell-h`/`--keys-h` tokens at the top of the stylesheet. Under `prefers-reduced-motion` animation is switched off.
