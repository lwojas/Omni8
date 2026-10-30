# Shelved engines: PLUCK and SAW

PLUCK (webdsp `Edge`) and SAW (webdsp `Hypersaw`) are **out of the UI for now**. They overlapped FM and PAD enough that we want user
testing, not guesswork, to decide what earns a name in the engine selector. Nothing was deleted: the wiring is intact so either can come
back in a few lines.

## What stays

- Their `VoiceSpec`s (`PLUCK`, `SAW` in `src/engine/catalogue.ts`): controls, fixed parameters, gain, note range.
- `EngineId` still includes `"pluck"` and `"saw"`, `voiceOf` still resolves them, and everything downstream (slot buses, instrument
  creation, step compile, native sequence, locks, MIDI positions) is engine-agnostic.
- `ALL_VOICES` still lists them, so the catalogue tests (ranges, defaults, knob count) keep covering them.

## What is switched off

- They are not in `ENGINES`, the list the engine chips are built from. That list also drives `normalizeRig`, so a saved project that names
  one falls back to the starting slot instead of loading it.
- The default rig uses FM + PAD where it used PLUCK + PAD.

## Bringing one back

1. Add `{ id: "pluck", name: "PLUCK" }` (or `saw`) to `ENGINES` in `catalogue.ts`, in the order you want it shown. There is room for nine names, and OFF counts as one.
2. Update the count in `test/slots.test.ts` ("offers neither PLUCK nor SAW") and the engine list in `docs/dev/hybrid8-plan.md`.
3. Listen to the controls: they were set from the parameter tables, not tuned by ear.

Saves made while an engine was offered will load again once it is back in `ENGINES`.
