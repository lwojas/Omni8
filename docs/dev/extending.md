# Extending Hybrid.8

Recipes for the changes people actually make. Each lists every file you touch and the tests that will tell you if you
missed one. Run `npm test` and `npm run build` (which type-checks) after each.

- [Add or change a knob on an engine](#add-or-change-a-knob-on-an-engine)
- [Add a synth](#add-a-synth)
- [Add an engine](#add-an-engine)
- [Add a drum voice](#add-a-drum-voice)
- [Add a factory sample](#add-a-factory-sample)
- [Add a lockable parameter (and LFO target)](#add-a-lockable-parameter-and-lfo-target)
- [Add a Punch FX](#add-a-punch-fx)
- [Add a scale or genre preset](#add-a-scale-or-genre-preset)
- [Add an arpeggiator rate or direction](#add-an-arpeggiator-rate-or-direction)
- [Add an externally controllable parameter](#add-an-externally-controllable-parameter)
- [Change the MIDI map](#change-the-midi-map)
- [Persist a new piece of project state](#persist-a-new-piece-of-project-state)
- [Add an action and a control](#add-an-action-and-a-control)
- [Change the number of tracks](#change-the-number-of-tracks)

---

## Add or change a knob on an engine

A knob is a `ControlSpec` in the engine's `VoiceSpec.controls` (`engine/catalogue.ts`).

```ts
exp("cutoff", "FILTER", BassParam.Cutoff, 90, 1000, 250, "Hz"),   // exponential taper
pow("envmod", "ENV MOD", BassParam.EnvMod, 0, 1, 0.6, 1.7),        // power curve: more travel at the low end
lin("bite", "BITE", BassParam.Bite, 0, 1, 0.5),                    // linear, shown as %
```

1. **`catalogue.ts`**: add the `lin` / `exp` / `pow` row to the voice's `controls`. Choose a *narrow* range: the whole travel
   should be musical. A stepped control uses the object form with `steps: [...]`. An engine has at most `ENGINE_KNOBS` (6).
2. **Saved data.** Pattern slot arrays have a fixed width (`SLOT_KNOBS`), so adding a knob does **not** change their length and
   `valid()` still passes. But an existing project holds `0` at the new position, not your default. Either **append the knob
   last** and pick a default that is acceptable at 0, or add a fix-up in `persist.ts → normalize` that writes the default for
   patterns where the position is untouched. Never insert a knob in the middle: every saved value after it would shift onto a
   different control.
3. **`midi/mapping.ts` and `params.ts`**: nothing. Both address slot knobs by position (`track.N.a.K`, CC 70, 72, 73, 75, 76, 79
   for slot A), so the new position is already mapped.
4. **UI**: nothing. The sound panel renders from `slotControls(voice)`. The LFO target list and TWEAK locks come from the same
   place.
5. A control that is not an instrument parameter sets `dest`: `"level"` for a slot's own fader, `"sample"` for a playback setting
   read when a note triggers (such controls are skipped by locks and LFOs, see `slotWrites`).

Tests: `engine.test.ts` ("keeps every default inside its sweet-spot range") and `slots.test.ts` cover the catalogue, and
`midi.test.ts` checks that all seven knobs of both slots are mapped. Another test in `engine.test.ts` keeps every engine to
`ENGINE_KNOBS` knobs: that is a design guard for the macro surface, so raise it deliberately, not to make a test pass.

---

## Add a synth

SYNTH is one engine with a voice selector (the dashed chip), like DRUM. Define the `VoiceSpec` with `engine: "synth"` and a plain
`key` (`"acid"`), add it to `SYNTH_VOICES`, and add its key to `SYNTH_VOICE_KEYS` (the order the selector shows). Nothing else:
no chip is added, so the UI never runs out of room. `normalizeSlot` accepts a saved variant only if it is in `SYNTH_VOICE_KEYS`
(otherwise ACID), and a save from before SYNTH that named `acid`, `fm` or `pad` as the engine is migrated there. Add the counts to
the instrument tables in the user guide.

**A voice that plays several notes (CHORD).** Set `chord: true` on the `VoiceSpec`. The chord data and voicing rule are in `chord.ts`
(edit `CHORDS` for chord qualities and `VOICINGS` for how each role is spread across octaves; every voicing applies to every chord). `playSlots` sends one instrument play per tone (`tone` = its index),
and `Groovebox.setSlot` builds a pool of `CHORD_INSTANCES` instances (two banks of five) on the slot bus, because a webdsp instrument
is monophonic. `note()` and the host sequence (`noteEvents`) alternate banks per chord so the previous chord's release rings on; the
tones end by the note's `duration`, so there is no note-off bookkeeping. Knob writes carry `also` and reach every instance
(`writeTargets`). The pool shrinks near webdsp's 64-instrument limit. A stepped control read at trigger time (the chord TYPE) uses
`dest: "note"`.

---

## Add an engine

An engine is a `VoiceSpec` plus a name in the selector.

1. **`catalogue.ts`**: add the engine id to `EngineId`, define the `VoiceSpec` (webdsp `kind`, `controls`, `fixed` parameters pinned
   to values, `gainDb` for level balance, `pitched`, and for a pitched voice `rootMidi`, `noteLo`, `noteHi`, `defaultNote`), and add
   it to `SINGLE`. If it is another flavour of an existing family, add a voice to SYNTH or DRUM instead (below).
2. Add `{ id, name }` to **`ENGINES`**, in the order you want the chips. The selector has room for nine names including OFF; the
   catalogue currently offers five. `ENGINES` also drives `normalizeRig`, so a save naming an engine not listed there falls back
   to the starting slot.
3. A pitched engine makes its track melodic (keyboard, arpeggiator, note range) and switches its insert to distortion. A
   non-pitched one plays a fixed-pitch hit. `trackProfile` derives all of this; there is nothing else to register.
4. Audio, step compile, native sequence, locks, LFOs, MIDI positions and the UI are engine-agnostic. `Groovebox.syncRig` creates
   the instrument on the slot's bus the first time the engine is chosen.
5. Update the counts in `test/engine.test.ts` ("keeps the catalogue to a handful of names…") and `test/slots.test.ts` ("offers PLUCK and SAW"), and the instrument tables in the user guide.

---

## Add a drum voice

DRUM is one engine with a voice selector. Add a `VoiceSpec` to `DRUM_VOICES` with a `key` of `drum:<name>`, add its name to
`DRUM_VOICE_KEYS` (the order the selector shows), and give it a row in the `density` table in `randomizeTrack` (`state.ts`) so RND
knows how to place it. A voice that should cut another (the hats) shares a `chokeGroup`. `normalizeSlot` accepts a saved variant
only if it is in `DRUM_VOICE_KEYS`, so removing or renaming a voice resets those slots to a kick.

---

## Add a factory sample

Factory samples are generated in code, so the repository holds no audio and nothing needs a licence. Add a row to `FACTORY_DEFS` in
`engine/samples.ts`: a stable `id`, a `name` and a `gen()` returning mono PCM at 44.1 kHz. Use the seeded `noise()` helper so the sample
is the same every time. Ids are saved in projects, so never rename one. `FACTORY_SAMPLES` is built from the table; the starting rig
refers to its samples by `DEFAULT_SAMPLES`. The test "are all distinct, audible, finite and the same every time" covers a new row.

A user import is a different path: `importSample` stores the original bytes in IndexedDB under `user:<n>` and webdsp decodes them
when a slot first uses them.

---

## Add a lockable parameter (and LFO target)

A *lockable* parameter is one a step can override (TWEAK) and an LFO can move. The list is `LOCKS` in `engine/plock.ts`: the 14 slot
knob positions, the two sends, the distortion, and the filter cutoff and resonance.

1. **`plock.ts`**: add a `LockParam` with a **permanent** `id` (it is the key in `Step.parameterLocks` and in `Lfo.target`, so it
   is saved), a `label`, a `target` and a `base(tp)` that reads the pattern's value. Add the target kind to `LockTarget` if it is new.
2. **`audio.ts → lockWrites`**: add the branch that turns the value into engine writes. Use the **same keys** as the mixer or sound
   writes use for that parameter, so a lock, an LFO and the base share caches.
3. **`actions.ts → setLockable`** and **`params.ts`**: route the on-screen control and the parameter through `setLockable` so TWEAK mode
   edits the step's lock instead of the base.
4. **LFO list**: `useTargets` in `ui/LfoModal.tsx` decides which lock ids the menu offers for a track.
5. `sanitizeLocks` and `sanitizeLfos` keep only known ids, so an id you remove silently drops from old saves; a renamed id is lost.

Tests: `plock.test.ts`.

---

## Add a Punch FX

A Punch FX is an entry in `PUNCHES` (`engine/mangler.ts`) and, if it needs a new effect, one new audio slot.

**Using the existing chain** (filter, saturation, crush, phaser, flanger, dub echo, reverb): add one object.

```ts
{
  id: 10,                                  // next free id. Ids are stored in saved FX lanes: never reuse or renumber
  key: "gate",                             // the MIDI/host name (`punch.gate.macro1`): permanent
  macros: [{ label: "DEPTH", def: 0.5 }, { label: "TONE", def: 0.5 }],  // each moves several values; `values` gets them as `m`
  label: "GATE", hint: "STUTTER GATE",
  takeover: true,                          // cut the dry mix and send everything through the chain
  boost: 1,                                // throw level at full (non-takeover only)
  param: { label: "RATE", def: 0.5, format: (n) => `${n.toFixed(2)}` },
  values: (p, l) => ({ ...overrides }),    // p = character knob, l = sweep level 0..1
}
```

`values` returns only the keys it changes; the rest rest. A takeover must include `...OWN` so the wet-only returns step
aside. Keep `l = 0` transparent: the effect must fade in from nothing. The pads, the knob panel, the FX lane and the
written-lane scheduling are all generated from `PUNCHES`; no UI change is needed. `defaultMangler()` sizes the
per-pattern `param` array from the catalogue, and `manglerTarget` falls back to `param.def` for patterns saved before
the pad existed.

**Adding a new effect to the chain:**

1. `mangler.ts` — extend `ManglerKey`, `FxSlot`, `MANGLER_PARAMS` (key → slot + `NodeParam`) and `baseValues()` (a
   *transparent* resting value).
2. `audio.ts` — add the slot to the list in the `Groovebox` constructor (this fixes its position in the chain).
3. If it is a pad with a new `PING_PONG` behaviour, add its id to that set.

Macros: write `values(p, l, m)` so the default macros give the sound the effect would have without them (see the existing pads;
`span`/`oct` give 0.5 = unchanged). A throw can add `boostScale(m)`. `mapping.ts` takes the new pad's two CCs from the catalogue order, so
add it **last**. The LFO is `mangler.lfo[id]`, applied through `macrosAt` (`controller.ts → modulate`); nothing to add per pad.

Tests: "offers the new catalogue with one parameter each" pins the list of pad labels, so **update that list** when you add a pad; "sweeps in: level 0 is transparent" and the takeover test cover the rest.

Tip: to hear `values` without a browser, evaluate `manglerTarget(base, id, lvl)` and inspect the numbers, as the tests do.

---

## Add a scale or genre preset

`scale.ts`: a `SCALES` entry (`id`, `label`, `intervals` from the root, ascending from 0) or a `SCALE_PRESETS` entry
(`root` 0–11, `scale` id). Scale ids are saved in projects; `normalizeScale` falls back to chromatic for unknown ones,
so removing a scale is safe and renaming it is not.

---

## Add an arpeggiator rate or direction

`arp.ts` is self-contained.

- **Rate:** append to `ARP_RATES` as a length in 16th steps. **Append only**: `ArpSettings.rate` is a saved index.
- **Direction:** extend `ArpDirection` and `ARP_DIRECTIONS`, then add a case to `arpIndex`.

`normalizeArp` clamps stale values on load. The UI builds its choices from these arrays.

---

## Add an externally controllable parameter

Parameters are the contract with MIDI, plugin hosts and automation. `engine/params.ts → build()`:

```ts
defs.push({
  id: "swing", label: "Swing", kind: "norm", min: 0, max: 1, def: 0,
  get: (s) => (s.swing - 0.5) / 0.25,
  set: (v) => setState({ swing: 0.5 + v * 0.25 }),
});
```

- `kind` is `norm` (0..1), `int` (whole numbers, optional `labels`) or `bool`.
- `get` reads `AppState`. `set` **must go through the same action the UI uses**, so the UI follows by itself.
- **Ids are permanent once shipped.** They are the external contract: DAW automation lanes are bound to them.
- If `set` changes state other than `patterns`, `plock`, `selStep`, `focus`, `mutes`, `solos`, `mixMode`, `perfLevels`, `pattern` or `arp`, extend the
  early-return in `onParamChange` so the change is reported.

Then give it a CC in `midi/mapping.ts` (next recipe). `paramManifest()` lists it for a host automatically.

---

## Change the MIDI map

Edit `midi/mapping.ts`. It is data, and the engine validates it. CC numbers appear nowhere else.

```ts
parameters["track.1.volume"] = { cc: 7, channel: 1 };
parameters["track.7.a.1"] = { cc: 70, channel: 7 };   // knob 1 of slot A on track 7, whatever engine is in it
```

The map is built by a short loop (one channel per track, the same CCs on each) rather than written out; change `SLOT_CCS` to move
the slot knobs. Pattern selection is not a CC; it is the `program` entry (Bank Select + Program Change). A mapping entry is
`{ cc, channel?, invert?, label? }`. `channel` is 1–16 and defaults to `defaultChannel`. Unknown parameter ids, bad channels and
doubled CCs are reported as warnings rather than failing (`compileMapping`), and the test "compiles against the real parameters
with no warnings" keeps the shipped map clean. Parameter ids are listed in [MIDI](midi.md#parameter-ids).

---

## Persist a new piece of project state

Say you add `s.metronome`.

1. `state.ts` — add to `AppState` and `initialState()`.
2. `persist.ts` — add to `Saved` (optional, since old saves lack it), to `snapshot()`, to the `persisted` list in
   `autosave()`, and to `parseProject`, defaulting when absent and clamping when present. Per-pattern data goes in `normalize`
   instead. The host snapshot (`toHostSnapshot` / `restoreFromHost`) follows the same `Saved` shape.
3. Never make `valid()` stricter without a migration.

If it is performance state (not part of the music), do not persist it; put it in `AppState` only.

---

## Add an action and a control

1. Put the edit in `actions.ts`. It takes plain arguments, calls `editPattern` or `setState`, and may call
   `controller.audition(...)` for immediate feedback. No React.
2. In the component, call the action from the handler and read state with `useStore((s) => …)`. Pick selectors that
   return primitives so only this component re-renders.
3. Use `Knob`/`Slider` from `ui/controls.tsx` for a continuous value (they give double-tap reset and keyboard nudge), and `Stepper` (the BPM readout between − and +) for a small integer or decimal value.
4. Do not read `getState()` during render, and do not call the controller to change state.
5. If the change must reach the audio engine, you normally need nothing: the controller observes `patterns`, `mutes`,
   `solos`, `mixMode`, `perfLevels` and `pattern`, and `applySound`/`applyMix` push what changed. New *kinds* of audio parameter belong in
   `audio.ts`.

---

## Change the number of tracks

`TRACKS` in `spec.ts` has one row per track (its starting mix) and `NUM_TRACKS` is its length; the rest of the app iterates it.
This is a large change because the saved shape is indexed by track.

1. **`spec.ts`**: add the `TrackSpec` row (`id` equal to its index, and `mix`).
2. **`catalogue.ts → defaultRig`**: give the new track its two starting slots.
3. **`midi/mapping.ts`**: the loop covers `NUM_TRACKS` channels; MIDI has 16, so 16 tracks is the ceiling.
4. **Persistence**: `valid()` requires `tracks.length === NUM_TRACKS`, so every existing project would be rejected. Write a
   migration that appends a fresh track to older patterns, extend `normalizeRig`/`arp` handling, and add a test with an old-shaped
   project.
5. **Keyboard shortcuts** `1`–`9` follow `NUM_TRACKS` (`App.tsx`); there is no key for a tenth track.
6. **Audio**: `audio.ts` builds the buses and slot buses per track automatically. Check the voice limit (`maxVoices` in
   `Groovebox.create`) and webdsp's 64-bus limit: a track costs 7 buses (5 + 2 slots), and the punch bus costs 1.
7. **Layout**: the phone and desktop CSS assume 8 rows in places (the slim mixer, the track rail); check both.
