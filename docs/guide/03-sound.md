# Sound design

Every slot exposes a focused set of macro knobs: the engine's own (at most six) and **LEVEL**. Each knob covers only the musical
part of its engine's range, so the whole travel of a knob sounds good. There is no menu diving.

Select a track and open **SOUND** (on a wide screen, the instrument band at the top).

## Slots and engines

A track has two slots. The **A** and **B** tabs only choose which slot the panel below edits; **both always sound**. Under the tabs,
the engine chips pick what is in that slot: **ACID**, **FM**, **PAD**, **DRUM**, **PERC**, **SAMPLE**, or **OFF** for an empty slot.
**DRUM** adds a voice selector (kick, snare, clap, closed hat, open hat, tom); **SAMPLE** adds the sample name.

Changing a slot's engine resets that slot's knobs to the new engine's defaults, in every pattern, and drops that slot's step locks.
The other slot is never touched. **LEVEL** sets the slot's volume under the track fader, which is how you balance a layer.

## INSERT FX

Below the knobs, one insert for the whole track, ahead of the sends:

- A track with a **synth** (ACID, FM or PAD in either slot) has **DIST**, a distortion between the sounds and the fader, so the delay
  and reverb sends hear it too. It is the same saturation as the DRIVE punch, but a permanent part of the track: 0 is off and more
  drive adds grit while the output is trimmed to keep the level steady.
- Any other track (drums, PERC, samples) has a **filter**: **CUT**, **RES** and **LP / HP**. At LP with CUT fully up, or HP with CUT fully
  down, it does nothing. Switching LP/HP puts CUT at the open end.

Both can be locked per step in P-LOCK mode and are saved per pattern. If a track changes kind (say a synth is removed), the insert
that goes away is switched off.

## Per-pattern sound

Sound, level, delay and reverb settings belong to the **pattern**, not the project. Pattern 1 can be a hard kit and pattern 2 a dub
kit with a different acid patch. Switching pattern during playback changes the sound sample-accurately on the bar line. Which engine
is in each slot belongs to the **project**: it is the same in every pattern. See [Patterns & songs](06-patterns-and-songs.md).

## DRUM engine

| Drum voice | Control | Range (default) |
|---|---|---|
| **KICK** | TUNE | 35 – 80 Hz (50): the pitch the body settles on |
| | SWEEP | 0.4 – 3.6 oct: how far above TUNE the pitch sweep starts (2.5) |
| | DECAY | 120 ms – 1.1 s: body length (450 ms) |
| | PUNCH | level of the attack click |
| | DRIVE | saturation |
| **SNARE** | TUNE | 140 – 300 Hz (185): body pitch |
| | DECAY | 80 – 500 ms (220 ms) |
| | SNAP | opening crack: transient level and noise brightness |
| | RATTLE | balance of noisy rattle against the tonal body |
| **CH** (closed hat) | PITCH | ±6 semitones |
| | DECAY | 20 – 180 ms (60 ms) |
| | METAL | amount of inharmonic, metallic content |
| | BRIGHT | brightness |
| **OH** (open hat) | PITCH | ±6 semitones |
| | DECAY | 200 ms – 1.1 s (450 ms) |
| | METAL, BRIGHT | as above |
| **CLAP** | TUNE | 800 – 2400 Hz (1300) |
| | DECAY | 100 – 600 ms (250 ms) |
| | SPREAD | time between the hits of the clap's burst cluster |
| | SNAP | sharpness of the bursts |
| **TOM** | TUNE | 80 – 360 Hz (120) |
| | SWEEP | 0 – 1.6 oct pitch drop (0.6) |
| | DECAY | 120 – 900 ms (450 ms) |
| | BODY | membrane overtones and stick tick |
| | DAMP | muffling: shorter ring, darker tone |

## PERC

A small percussion synth (two oscillators, noise and a pitch sweep). Hits at a fixed pitch.

| Control | Does |
|---|---|
| **TUNE** | 60 – 800 Hz (180) |
| **SWEEP** | 0 – 4 oct pitch drop (1.5) |
| **DECAY** | 50 ms – 1 s (250 ms) |
| **NOISE** | level of the noise layer |
| **FM** | frequency modulation between the oscillators |
| **DRIVE** | saturation |

## ACID

A monophonic bass voice with a resonant low-pass filter that an envelope snaps open on every note.

| Control | Does |
|---|---|
| **FILTER** | Cutoff, 90 Hz – 1 kHz |
| **ENV MOD** | How far each note's envelope opens the filter |
| **DECAY** | How long the filter takes to close, 60 ms – 1.1 s |
| **RES** | Resonance. High values squelch and self-oscillate |
| **BITE** | Onset drive and brightness, and how much velocity (accent) changes the timbre. At 0 an accent is only louder |
| **WAVE** | Round and subby (sine plus sub) at 0, rich saw at 100% |

Under the knobs, a track with a synth has a **DIST** slider (see INSERT FX below). It is the same saturation as the DRIVE punch, but a permanent part of the voice: 0 is off (the voice is untouched), and more drive adds grit while the output is trimmed to keep the level roughly steady. Like the knobs, it can be locked per step in P-LOCK mode and saved per pattern.

The filter envelope attacks instantly and falls exponentially. Accent and slide, set per step, do the rest. **WAVE** morphs the oscillator: a sine with a sub-oscillator underneath at 0, a bright saw at 100%, so the fundamental stays present as the filter closes.

## FM

A two-operator FM voice.

| Control | Does |
|---|---|
| **COLOR** | Eight stepped operator ratios: `SUB`, `FULL`, `HOLLOW`, `THIRDS`, `THIN`, `FIFTHS`, `METAL`, `BELL` |
| **DEPTH** | Resting FM depth: from a pure sine to a rich spectrum |
| **BITE** | Extra FM depth at the start of each note that decays away: a bright attack |
| **TONE** | A static low-pass relative to the note: dark fundamental at 0, fully open at 100% |
| **DECAY** | 60 ms – 1.2 s |

COLOR is a choice, not a continuum: it sets the modulator-to-carrier ratio, which decides the harmonic character, and DEPTH, BITE and TONE shape it. Stepped ratios keep every setting musical; continuous ratios mostly sound out of tune.

## PAD

A drifting stereo ensemble pad.

| Control | Does |
|---|---|
| **TONE** | brightness |
| **MOVE** | slow drift of detune, stereo image and filter |
| **THICK** | ensemble thickness |
| **SPACE** | stereo width and diffusion |
| **ATTACK** | 10 ms – 2 s |
| **RELEASE** | 100 ms – 3 s |

## SAMPLE

Plays one sample from the **shared library**. The library is one list for the whole project: ten slots on the same kick play one
copy of it. Tap the sample name for the picker: tap a row to choose it, **▶** to preview, **IMPORT…** to add a WAV, MP3 or OGG
file (up to 12 MB), **✕** to delete an import that no slot uses. The factory samples are generated by the app.

| Control | Does |
|---|---|
| **PLAY** | **ONE-SHOT** plays the sample through; **LOOP** repeats it while the note is held (the step's gate on a melodic track) |
| **START**, **END** | the part of the sample that plays, as a share of its length |
| **DECAY** | fade-out length, 30 ms – 4 s. At the top it reads **FULL** and the sample plays out untouched |
| **LEVEL** | slot volume |

On a track with a pitched engine the sample follows the notes; on a drum track it always plays at its own pitch. These knobs are
read when a note starts, so they cannot be locked per step.

Next: [Mixing & track FX](04-mixing-and-track-fx.md).
