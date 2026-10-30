# Hybrid.8: architecture audit and implementation plan

Status: Stages 1 to 5 implemented; Stage 6 partly done. 194 tests and the production build pass; phone (360 px) and desktop
were driven in a real browser (slot tabs, engine swap during playback, sample modal) with no console errors and no horizontal scroll.

Decisions taken: per-trigger envelope added to webdsp (merged to webdsp `main`; this repo depends on it from GitHub);
factory samples are generated in code; native `Sequence` sample events still lack start/end/decay (web build is the target).

Not done yet: audible check by ear, the plugin build (`vst/`, CMake names, deploy workflow) and the `docs/guide` pages still say Pulse.8.

This document was the Stage 2 audit and the plan for Stages 3 to 6.

> **Update:** PLUCK and SAW are shelved ([shelved-engines.md](shelved-engines.md)). The per-slot FILTER knob is gone: INSERT FX is
> distortion on a track with a synth and efem's LP/HP filter (CUT, RES, LP/HP) on any other track. The rail labels are one line (CH, OH, SMPL).

## 1. Where Pulse.8 hard-codes "one instrument per track"

Everything is driven by one static table, `TRACKS` in `engine/spec.ts`, whose rows carry `kind` (webdsp instrument),
`role` (drum | bass | tone), `controls` (macro knobs) and `fixed` (pinned engine params). Consumers:

| Area | Assumption | Files |
|---|---|---|
| Audio graph | one `createInstrument(spec.kind)` per track at construction; one `inst[track]`; per-track buses A/B/C + delay + reverb | `audio.ts` |
| Sound state | `TrackPattern.sound: number[]` is sized by `spec.controls.length`; validated on load | `state.ts`, `persist.ts` |
| Parameter locks | lock target `{kind:"sound", control}`, id `instrument.<key>` | `plock.ts`, `audio.ts`, `actions.ts` |
| Parameter registry | ids `track.N.sound.<key>` built from the spec (DAW/MIDI contract) | `params.ts`, `midi/mapping.ts` (`SOUND_KEYS`) |
| Role-driven behaviour | `role` picks pads vs piano roll, arp, note range, choke group, drum note fixed pitch | `stepcompile.ts`, `controller.ts`, `actions.ts`, `Sequencer.tsx`, `midi/setup.ts`, `params.ts` |
| Distortion insert | only on `DIST_TRACKS` (the two synths) | `spec.ts`, `audio.ts`, `state.ts`, `persist.ts`, `Panels.tsx` |
| Presets | `KITS` indexed by drum track id; `presetsFor(track)` by track id | `presets.ts`, `Panels.tsx` |
| Native sequence (VST) | events target `ids.inst[track]`; graph must be built identically every time | `nativeseq.ts`, `hostplay.ts`, `main.tsx` |
| Demo groove | tuned to the fixed lineup | `state.ts` |

Not affected (kept as is): transport, ticker, scheduler, step compile timing, PFX/mangler, mixer buses A/B/C and their
sends, mute/solo logic, patterns/song chain, MIDI engine, project menu.

## 2. webdsp findings (sibling checkout `../webdsp`)

* 18 instrument kinds. No "sample instrument": samples are first-class but separate (`loadSample`, `trigger`/`schedule`).
* Samples are **already shared by id**: `trigger({sampleId, ...})` points a voice at one `Sample*`; any number of tracks can trigger the same id. Removing a sample is safe while sounding.
* One-shot is the default; `loop` exists per trigger. **`start` / `end` (frames) exist per trigger**, so no DSP work is needed for sample start/end. `region` (cue chops) exists but is out of scope.
* Per-voice filter exists (`VoiceParam.FilterCutoff/Resonance/Mode/Slope`) but only via `setVoiceParameter(handle)` after the trigger, not as a trigger field and not sample-accurate. No per-sample default filter.
* Envelope is **per sample** (`SampleParam.Env*`, captured at note-on). With a shared sample, two tracks cannot have different decay. This is the one real conflict with "samples are shared assets".
* `createInstrument` / `removeInstrument` work at runtime (limit 64 instruments, 64 track buses). 16 slot instruments and 8×7 + 1 = 57 buses fit.
* Native `Sequence` sample events (VST path) carry gain/pan/pitch/loop/duration but **no start/end, filter or envelope**.
* No emscripten in this environment, so any native webdsp change needs emsdk installed and the WASM rebuilt.

## 3. Engine catalogue recommendation (8 of the 9 available names)

Chosen for musical difference, reusing existing kinds only:

| # | Engine | webdsp kind | Why it earns a name |
|---|---|---|---|
| 1 | ACID | Bass | the Pulse.8 acid voice, unchanged controls |
| 2 | FM | Fm | two-op FM bass/bell/lead (the Pulse.8 FM) |
| 3 | PAD | Pad | drifting stereo ensemble: the only sustained/ambient voice |
| 4 | PLUCK | Edge | sharp transient plucks, stabs, short leads |
| 5 | SAW | Hypersaw | detuned 7-saw stack: chords/leads/rave stabs |
| 6 | DRUM | Kick / Snare / Clap / HiHat / Tom | one engine name with a voice selector: KICK, SNARE, CLAP, C-HAT, O-HAT, PERC. Exactly the six Pulse.8 drums with their existing controls, hats keep their choke group |
| 7 | PERC | PercSynth | tonal percussion, zaps, toms: different from DRUM's fixed machines |
| 8 | SAMPLE | trigger() on a shared sample | the new dimension |

Left out on purpose: Pulse (tempo-locked pump, needs transport UI), PwmBeast (fills the 9th name if wanted; overlaps SAW/PLUCK),
Digital Machines (five FM drum voices that overlap DRUM). One name stays free.

Role becomes **derived**, not fixed: a track is *melodic* (piano roll, arp, note range) if either slot is a pitched engine
(ACID, FM, PAD, PLUCK, SAW, PERC, or SAMPLE loaded in a melodic track), otherwise *drum* (pads). A SAMPLE slot plays chromatically
relative to a root note in a melodic track and at original pitch in a drum track.

## 4. Two-slot model

```
Rig (project level, persisted once, not per pattern)
  tracks[8].slots[2] = { engine, variant }      variant = drum voice | sample id | ""

Pattern (per pattern, as today)
  tracks[t].slots[2] = { sound: number[] }      normalised knobs for that slot's engine, fixed width
  tracks[t].level / dly / rev / dist / punch    unchanged, track level
```

Rationale: engine identity is not pattern data. Swapping instruments mid-song at pattern boundaries would mean creating/removing
DSP nodes during playback and would break the native-sequence recognition. Knob values stay per pattern so locks, copy/paste and
song chain behave exactly as now.

Audio graph (static topology, built once):

```
slot instrument or sample voices ─▶ SLOT bus (Filter effect, level) ─▶ track bus A [Saturation insert] ─▶ B ─▶ C ─▶ master
```

* 16 slot buses created up front. Changing an engine only does `removeInstrument` + `createInstrument` on that slot's bus; the graph never changes shape.
* A slot filter is the existing webdsp Filter effect on the slot bus (schedulable, so locks work). ACID keeps its own filter and skips the extra one.
* A slot LEVEL knob is required for layering to be usable (two sources, one fader). It is part of each slot's control row, not new navigation.
* The distortion insert moves to every track (it is already the "INSERT FX" row). Mute/solo/level/sends/PFX work on bus A/B/C, so they affect both slots together with no change.
* Step compile fires every active slot of the track from the same step; sample slots go through `trigger`/`schedule` with `start`/`end`/`loop`/`duration`.

Fixed-width sound arrays and ids: each slot stores `SLOT_KNOBS = 6` normalised values (engine controls first, then LEVEL, then FILTER if
applicable). Parameter ids become `track.N.a.<n>` / `track.N.b.<n>` (stable for DAW automation, labels come from the engine).
Changing a slot's engine resets that slot's values in **all** patterns to the new engine's defaults, so no invalid values survive.

## 5. UI plan (no new navigation)

Inside the existing sound panel only:

```
TRACK 4 · name                   (existing title)
[SLOT A] [SLOT B]                (two tabs, one row)
ACID FM PAD PLUCK SAW DRUM PERC SAMPLE     (engine chips: replaces the PRESET/KIT chip row)
[ KICK ▾ ] or [ 909_Kick ▾ ]     (variant: drum voice or sample; opens the sample modal)
knobs row (≤6 incl. LEVEL, FILTER)   [ SAMPLE: ONE-SHOT/LOOP toggle, START, END, DECAY, FILTER, LEVEL ]
DIST bar (insert FX) · P-LOCK · SENDS · PUNCH FX    (unchanged)
```

The sample modal reuses `Modal.tsx`: list of the shared library, tap to assign, preview button, import (file picker) and delete for user samples.
Engine presets (synth preset chips) move into the engine's defaults; kits are dropped. If the phone layout is tight, the first thing removed is the preset chips, not a knob.

## 6. Stages

* **Stage 3: two-slot core.** `rig` state + persistence, `SlotSpec`, slot buses, `setSlotEngine`, role derivation, step compile/controller/actions/params/plock/midi mapping moved from `TRACKS[t].controls` to the slot of the focused/addressed engine. Keep `TRACKS` only for per-track mix defaults and names. Tests updated.
* **Stage 4: catalogue.** `engine/catalogue.ts`: one table of 8 engines with controls/fixed/gain/role for each. Drum voices reuse the Pulse.8 `ControlSpec`s verbatim.
* **Stage 5: samples.** `engine/samples.ts` shared library (IndexedDB for imports, factory set), load once per id into webdsp, sample engine controls, sample modal.
* **Stage 6: validation.** Playwright at 360px and desktop; unit tests for state leakage (engine swap leaves the other slot untouched, stale instruments removed, both slots stop, mute/solo cover both).

## 7. Risks and open decisions

1. **Per-slot sample decay vs shared samples** (needs a decision, see below).
2. **Factory sample content**: the repo has no audio assets.
3. **VST native sequence** cannot carry sample start/end/filter today. Web build is the target; the plugin path keeps compiling and plays instrument slots, sample slots degrade to whole-sample one-shots until webdsp's `Sequence` event grows those fields.
4. The FM8 reference was not found in the local workspace, so the filter control convention comes from Pulse.8 (single LP cutoff knob, fixed resonance). Tell me if FM8's differs.
