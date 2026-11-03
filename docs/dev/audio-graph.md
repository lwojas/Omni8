# Audio graph

`engine/audio.ts` builds the whole signal path from webdsp primitives: instruments, buses, bus sends and effects. There
are no custom DSP nodes in Hybrid.8. The graph is built once, with a fixed shape; only the instrument inside a slot is ever
created or removed afterwards.

## Topology

A webdsp bus has **one main route and one send**. Each track therefore needs a short chain of three buses, each adding
one tap, plus one small bus per slot in front:

```
slot A engine ─▶ SLOT_A bus (LEVEL) ─┐
                                     ├─▶ [Saturation][Filter] ─▶ A ─main─▶ B ─main─▶ C ─main─▶ master ─▶ limiter
slot B engine ─▶ SLOT_B bus (LEVEL) ─┘                           │         │         │
                                                                 │         │         └─send─▶ PUNCH bus ─▶ master
                                                                 │         └─send─▶ REVERB_t  (wet only)
                                                                 └─send─▶ DELAY_t   (wet only)
```

| Bus | Holds | Sends |
|---|---|---|
| **SLOT_A / SLOT_B** | The slot's engine (an instrument, or sample voices), and the slot's LEVEL as the bus gain | main route to bus A |
| **A** | The distortion insert (Saturation), the filter insert (Filter), the sidechain Compressor, then the fader and mute (`BusGain`) | the track's delay send |
| **B** | | the track's reverb send |
| **C** | The takeover cut (`BusMainGain`) | the punch send |
| **DELAY_t** | Dub Delay (beat mode) → Delay (free mode); one is live, the other has mix 0 | |
| **REVERB_t** | Reverb at mix 1 | |
| **PUNCH** | Filter → Saturation → Bitcrusher → Phaser → Chorus/Flanger → Dub Delay → Reverb | |

That is 5 buses per track plus 2 slot buses (7 × 8) and the punch bus: 57 in all, inside webdsp's limit of 64.

### The INSERT FX

Both inserts exist on every track's bus A; the UI shows one, chosen by the track's profile (`TrackProfile.insert`):

- **Distortion** (a track with a pitched engine): a webdsp Saturation. `TrackPattern.dist` (0..1, lockable as `fx.distortion`) maps to
  three parameters at once: pre-gain 10..30 dB, output trim −3..−9 dB (the DRIVE punch's own mapping, so the same percentage
  sounds the same) and a mix that fades in over the first tenth of the travel. At 0 the mix is 0, which webdsp makes an exact
  pass-through. Because one lock moves three parameters, `lockWrites` returns a list.
- **Filter** (every other track): a webdsp Filter. `TrackPattern.filter` holds `mode` (LP/HP), `cut` and `res`. Cutoff is 40 Hz to
  18 kHz on an exponential taper, Q 0.707 to 12. It is transparent at LP with `cut` 1 and at HP with `cut` 0, which is where a
  fresh pattern and a mode switch put it. The mode is not lockable; `cut` and `res` are.

The inactive insert is held at its transparent value (`actions.ts` resets it when a track changes kind). Bus effects run before
the bus gain, so the chain is slot ▶ insert ▶ fader ▶ sends, and the delay and reverb hear the processed sound.

### The sidechain

Every track's bus A ends its effect chain with a webdsp Compressor (`scFx`) whose `CompSidechain` names another track's bus A: the
detector listens to that bus and the gain reduction is applied to this track. `sidechain.ts` fixes everything but the two knobs the
modal shows: ratio 12, attack 2 ms, knee 3 dB, AMOUNT as the threshold (−6 dB to −30 dB) and RELEASE (40–500 ms).

- **Off** is ratio 1 and key 0. Ratio 1 is webdsp's exact no-op, and the key must be cleared too, or the compressor would compress the
  track against itself.
- **The key** is the source's bus A after its chain, fader and mute (webdsp's tap for sends and meters), so mute and level matter. The
  source's bus is run before the bus that listens to it, whatever their order.
- **Loops** are refused by the engine (a key falls back to 0). The page never holds one: `setSidechain` and the source menu refuse
  them, a saved file's loops are switched off, and `trackFxWrites` sends the writes that switch a sidechain off before those that switch
  one on, so swapping two between patterns never meets the guard.
- **Needs webdsp with `CompSidechain`** (docs/compressor-node.md there; the WASM must be rebuilt). `Groovebox` adds the compressors only
  when the engine lists `CompSidechain` among the compressor's parameters (`ids.scFx` is undefined otherwise and no sidechain
  write is made), so an older build leaves SC doing nothing rather than compressing a track against itself. In a plugin it also
  needs the host built from that webdsp.
- No new buses: the 57 in use are unchanged.

### Consequences, deliberately

- The fader/mute is at A, **before** every tap, so mute and level silence the sends too.
- The slot LEVEL is *before* the insert, so it changes how hard the distortion is driven as well as the balance between layers.
- The punch send leaves from C, **after** the sends, so the punch bus hears the faded, un-delayed track.
- During a **takeover** punch, C's main gain is cut to 0 and its send raised to 1: the dry signal is removed and the
  whole mix goes through the punch chain. A **throw** leaves C's main at 1 and raises the send by `boost × level`. A track with
  `punch: false` is skipped by both (`mixWrites`).
- An unfed bus costs nothing: webdsp sleeps buses with no input, so idle sends are free.

## Engines in a slot

`Groovebox.syncRig(rig)` compares what each slot holds (`applied`, a `VoiceSpec.key` plus the sample for SAMPLE) with the rig. For a
changed slot it removes the old instrument, creates the new one on that slot's bus (`createInstrument(kind, { bus })`), applies the
voice's fixed parameters and gain trim, and releases any sample loops. Nothing else is touched.

- **Instruments** (ACID, FM, PAD, DRUM voices, PERC): one webdsp instrument per slot. Hats share a choke group.
- **Samples**: not an instrument. `ensureSample` loads the library id into webdsp once (`samples` map); each hit is a
  `runtime.trigger({ sampleId, bus: slotBus, start, end, pitch, loop, envelope })`. A sample slot is **monophonic**: a new hit
  releases the slot's previous voice (`lastSample`). A hit on a sample that is not loaded yet is lost and the next one plays.
  The one-shot DECAY becomes the trigger's envelope, never longer than the window.
- **Voice limit:** 48, shared by everything.

What a track note turns into per slot is `slots.ts` (`playSlots`): a pitched instrument gets the note transposed to its own root,
a fixed-pitch drum gets a bare hit (so an acid line beside a drum voice cannot make the drum a held note), and a sample gets a
trigger whose pitch is relative to the track's default note on a melodic track and 0 otherwise.

## Level taper

`levelToGain(level) = level² × 1.1`: fine control at the bottom, about unity at 0.95. It is used for the track fader and for the
slot LEVEL.

## What is schedulable and what is not

| Thing | Mechanism | Accuracy |
|---|---|---|
| Notes and sample triggers | `instrumentNoteOn({ time })`, `trigger({ time })` | sample-accurate |
| Instrument parameters at a pattern change or a lock | `scheduleParams` | sample-accurate |
| Punch FX chain values in a written lane | `scheduleParams` with `from`/`value`/`ramp` | sample-accurate, ramped |
| Bus gains, sends, main gain, insert effect parameters | not schedulable in webdsp | applied from the 10 ms audio-clock ticker (`TimedQueue`) |
| LFOs | written from the controller tick | control rate (every tick), not sample-accurate |

The bus row is the known compromise: punch *routing* and send/insert changes land within a few milliseconds of their step. At
sixteenth-note resolution this is inaudible. If webdsp gains schedulable bus parameters, the `TimedQueue` and `Groovebox.when`
can be deleted.

## Writes, keys and caching

Every parameter write is a `Write` (`inst`, `bus` or `fx`) with a **key** naming the parameter (`2:0:3` for track 3, slot A, knob 4;
`2:d` for its delay send). The pure functions `mixWrites`, `soundWrites`, `trackFxWrites`, `manglerWrites` and `lockWrites` build
them; the live `Groovebox` applies them, and the native sequence (`nativeseq.ts`) turns the same writes into host events. Because
a lock, an LFO and the base value share a key, they share caches.

`Groovebox` keeps `soundCache`, `busCache`, `fxCache`, `manglerCache` and `scheduled`, and sends only values that differ.
`resetManglerSchedule()` forgets them on transport start and stop so the next write sends everything. When a scheduled segment is
written, the immediate cache entry for that key is dropped: the engine value is no longer what the immediate path last wrote.

### Locks and LFOs on the same parameter

- A **step lock** wins over the base: `scheduleLocks` sends the step's locked values at its time and, one step later, the base value
  of anything the previous step locked. Keys held by a lock (`lockedKeys`) are left alone by the immediate base writes.
- An **LFO** rides on the base: `applyLfos` writes `base + lfo × depth / 2`, summing several LFOs on one parameter, and puts the
  base back when the LFO stops. Keys an LFO owns (`lfoKeys`) are likewise protected from immediate writes. While a lock holds a
  parameter, the LFO leaves it alone.
- A SAMPLE slot's window, mode and decay are read when a note triggers (`dest: "sample"`), so neither a lock nor an LFO can
  move them.

## The Punch chain

`mangler.ts` holds the data; `audio.ts` applies it.

- `MANGLER_PARAMS` maps each `ManglerKey` (`fCut`, `sDrive`, `pRate`…) to an effect slot and a webdsp `NodeParam`.
- `baseValues()` is the resting, **transparent** state: filter open at 20 kHz, every mix at 0, the dub echo return open,
  reverb out of the path.
- A `PunchDef.values(p, lvl)` returns *overrides* on top of the resting values, where `p` is the character knob and
  `lvl` the 0..1 sweep level. `manglerTarget` merges and returns `{ values, takeover, boost }`.
- Takeover punches must set `dMix: 0, rMix: 0` (`OWN`) so the wet-only returns get out of the way.

`scheduleManglerSegment(from, to, time, dur)` turns a step of the written lane into `ScheduledParam` events: a ramp from
the level at this step to the level at the next when both are the same punch, a step otherwise.

## Limiter

webdsp's master limiter protects the output. Levels are balanced by each voice's `gainDb` in the catalogue, not by compensating in
the mixer.
