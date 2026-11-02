# Sound design

Each slot has a small set of knobs: up to six that belong to its instrument, plus **LEVEL**. Every knob only covers the
range that sounds good, so wherever you turn it, it sounds musical. There are no menus to dig through.

Select a track and open **SOUND** (on a larger screen, it's the instrument band along the top).

## Slots and instruments

A track has two slots. The **A** and **B** tabs only choose which slot you're editing; **both always play**. Under the
tabs, the instrument buttons choose what's in that slot: **SYNTH**, **DRUM**, **PERC**, **SAMPLE**, or
**OFF** for an empty slot. **SYNTH** adds a dashed selector for the synth (ACID, FM, PAD, PLUCK, SAW or CHORD), **DRUM** one for the drum (kick,
snare, clap, closed hat, open hat, tom), and **SAMPLE** shows the name of the sample.

Changing a slot's instrument puts that slot's knobs back to the new instrument's starting values, in every pattern, and
removes any per-step tweaks for that slot. The other slot is left alone. **LEVEL** sets the slot's volume below the
track fader, so use it to balance two layers against each other.

## INSERT FX

Below the knobs is one effect that belongs to the whole track. It comes before the delay and reverb:

- A track with a **synth** (ACID, FM, PAD, PLUCK, SAW or CHORD in either slot) has **DIST**, a distortion that sits between the sound and
  the fader, so the delay and reverb hear the distorted sound too. It's the same effect as the DRIVE punch, but built into
  the track. At 0 it's off, and turning it up adds grit while the volume is kept steady.
- Any other track (drums, PERC or samples) has a **filter** with **CUT**, **RES** and an **LP / HP** switch. With LP and CUT
  turned all the way up, or HP and CUT all the way down, the filter does nothing. Switching between LP and HP sets CUT to
  its fully open position.

Both can be changed per step in TWEAK mode, and are saved with each pattern. If a track changes type (for example, you
remove its synth), the effect that no longer fits is switched off.

## LFOs

An LFO is a slow wobble that moves a knob for you. Each track has three. Press **LFO** under the INSERT FX controls to open
them. For each one, choose:

- **Target**: what it moves. Any knob in either slot (except a sample's start, end and decay), the delay or reverb send, and
  the track's distortion or filter.
- **Wave**: sine, triangle, square or saw.
- **Rate**: how fast it moves, from very slow to quick. With **SYNC** on, the rate is a note length at your tempo instead,
  so the wobble stays in time.
- **Depth**: how far it moves the knob. The wobble swings around where the knob is set, so at 100% it sweeps half the knob's
  range either side. A negative depth flips it upside down.

If a step has a TWEAK on the same knob, the tweak wins for that step. LFO settings are saved with each pattern. LFOs work in
the browser version; they don't play inside the VST3 plugin yet.

## Sound belongs to the pattern

Sound, level, delay and reverb settings are saved **with each pattern**, not with the project as a whole. Pattern 1 can
be a hard-hitting kit and pattern 2 a dubby one with a different acid sound. If you switch pattern while the beat plays,
the sound changes exactly on the bar line. Which instrument is in each slot is the one thing that stays the same across
the whole project. See [Patterns & songs](06-patterns-and-songs.md).

## DRUM

| Drum | Knob | Range (starting value) |
|---|---|---|
| **KICK** | TUNE | 35 – 80 Hz (50): the pitch the kick settles on |
| | SWEEP | 0.4 – 3.6 octaves (2.5): how far above that pitch the kick starts before dropping |
| | DECAY | 120 ms – 1.1 s (450 ms): how long the kick rings |
| | PUNCH | how loud the click at the start is |
| | DRIVE | distortion |
| **SNARE** | TUNE | 140 – 300 Hz (185): the pitch of the body |
| | DECAY | 80 – 500 ms (220 ms) |
| | SNAP | the crack at the start: how loud and how bright |
| | RATTLE | the mix of snare rattle against the tonal body |
| **CH** (closed hat) | PITCH | ±6 semitones |
| | DECAY | 20 – 180 ms (60 ms) |
| | METAL | how metallic and clangy it sounds |
| | BRIGHT | brightness |
| **OH** (open hat) | PITCH | ±6 semitones |
| | DECAY | 200 ms – 1.1 s (450 ms) |
| | METAL, BRIGHT | as above |
| **CLAP** | TUNE | 800 – 2400 Hz (1300) |
| | DECAY | 100 – 600 ms (250 ms) |
| | SPREAD | the gap between the little claps that make up the burst |
| | SNAP | how sharp the claps are |
| **TOM** | TUNE | 80 – 360 Hz (120) |
| | SWEEP | 0 – 1.6 octaves (0.6): how far the pitch drops |
| | DECAY | 120 – 900 ms (450 ms) |
| | BODY | the drum-skin ring and the stick click |
| | DAMP | muffling: a shorter, darker sound |

## PERC

A small percussion synth. Every hit plays at the same pitch.

| Knob | What it does |
|---|---|
| **TUNE** | 60 – 800 Hz (180) |
| **SWEEP** | 0 – 4 octaves (1.5): how far the pitch drops |
| **DECAY** | 50 ms – 1 s (250 ms) |
| **NOISE** | how much noise is mixed in |
| **FM** | how much the two tones twist each other's sound |
| **DRIVE** | distortion |

## ACID

A single-note bass synth with a resonant filter that snaps open on every note.

| Knob | What it does |
|---|---|
| **FILTER** | How open the filter is, from dark to bright (90 Hz – 1 kHz) |
| **ENV MOD** | How far each note flings the filter open |
| **DECAY** | How long the filter takes to close again, 60 ms – 1.1 s |
| **RES** | Resonance. High settings squelch and even whistle |
| **BITE** | How much bite and brightness a note starts with, and how much an accent changes the tone. At 0, an accent is only louder |
| **WAVE** | Round and subby at 0, rich and buzzy at 100% |

A track with a synth also has a **DIST** slider (see INSERT FX above). At 0 it's off, and turning it up adds grit.
Like the knobs, it can be changed per step in TWEAK mode and is saved with each pattern.

The filter opens the instant a note starts and then closes smoothly. Accent and slide, set per step, do the rest. **WAVE**
blends between a soft sine with a deep sub-bass underneath and a bright, buzzy saw, so the low end is still there as the
filter closes.

## FM

A two-part FM synth, good for bells, plucks and glassy tones.

| Knob | What it does |
|---|---|
| **COLOR** | Eight steps that change the character of the sound: `SUB`, `FULL`, `HOLLOW`, `THIRDS`, `THIN`, `FIFTHS`, `METAL`, `BELL` |
| **DEPTH** | How rich the sound is, from a pure tone to a bright, harmonic one |
| **BITE** | An extra burst of brightness at the start of each note that fades away |
| **TONE** | How dark or bright the sound is: dark at 0, fully open at 100% |
| **DECAY** | 60 ms – 1.2 s |

COLOR moves in steps rather than smoothly. That's deliberate: each step keeps the sound in tune with itself, whereas
smooth changes would mostly sound out of tune. DEPTH, BITE and TONE then shape the sound within each color.

## PAD

A warm, drifting stereo pad.

| Knob | What it does |
|---|---|
| **TONE** | Brightness |
| **MOVE** | How much the sound slowly drifts and shimmers |
| **THICK** | How thick and chorus-like it is |
| **SPACE** | How wide and spacious it sounds |
| **ATTACK** | How slowly it fades in, 10 ms – 2 s |
| **RELEASE** | How slowly it fades out, 100 ms – 3 s |

## PLUCK

A short, bright plucked tone with a filter that snaps shut after each note.

| Knob | What it does |
|---|---|
| **SHAPE** | The basic character of the tone |
| **BRIGHT** | How bright the pluck is |
| **CUTOFF** | The filter's opening, 250 Hz – 6 kHz |
| **RES** | How much the filter rings |
| **SNAP** | How far the filter flicks open at the start of each note |
| **DECAY** | 80 ms – 1 s |

## SAW

A thick stack of detuned saw waves, for big leads and chords.

| Knob | What it does |
|---|---|
| **DETUNE** | How far apart the saws are tuned |
| **SPREAD** | How wide the stack sits in the stereo field |
| **DENSITY** | How many saws are layered |
| **CUTOFF** | The filter's opening, 400 Hz – 9 kHz |
| **DECAY** | 100 ms – 1.5 s |

## CHORD

A chord instrument for dub techno stabs and pads. Each step plays **one note**; CHORD turns it into a whole chord, so you
sequence the root movement (say C, Ab, Eb, Bb) and the harmony follows. The chords are open voicings with the root lowest and
the colour notes (7ths, 9ths) above, so they stay clear instead of muddy.

| Knob | What it does |
|---|---|
| **TYPE** | The chord: m7, m9, m11, m(add9), minor, maj7, maj9, dom7, major, 7sus4, sus2, dim7, 7#9 |
| **VOICE** | How it is spread, for any chord: **OPEN** (root, 5th and 7th low, the third above), **CLOSE**, **WIDE**, **SHELL** (no root: third, 7th and colour, to sit over a bass), **HIGH** (an octave up) or **INVERT** (third in the bass) |
| **CUTOFF** | The filter's opening, 180 Hz – 5 kHz. Each note opens it briefly, then it settles |
| **RES** | How much the filter rings |
| **ATTACK** | 2 ms – 250 ms: a stab at the short end, a swell at the long end |
| **RELEASE** | 50 ms – 2 s: how long the chord rings after the step's gate ends |

Short gate and short release is a stab; long gate, slow attack and long release is a pad. TYPE and VOICE are read when the note plays, so it
has no step lock or LFO. A chord uses up to five voices, and two chords can ring over each other.

## SAMPLE

Plays one sound from the **shared sample library**. The library is shared by the whole project, so using the same kick in
ten slots only stores it once. Tap the sample's name to open the picker: tap a row to choose it, **▶** to listen,
**IMPORT…** to add your own WAV, MP3 or OGG file (up to 12 MB), or **✕** to delete an imported sample that no slot is
using. The built-in samples are made by the app itself.

| Knob | What it does |
|---|---|
| **PLAY** | **ONE-SHOT** plays the sample once, all the way through. **LOOP** repeats it for as long as the note is held (as long as the step's gate on a melodic track) |
| **START**, **END** | Which part of the sample plays, as a share of its full length |
| **DECAY** | How long the fade-out is, 30 ms – 4 s. At the top it reads **FULL** and the sample plays out untouched |
| **LEVEL** | The slot's volume |

On a melodic track, the sample plays at the pitch of the notes. On a drum track, it always plays at its own pitch. These
knobs are read when a note starts, so they can't be changed per step.

Next: [Mixing & track FX](04-mixing-and-track-fx.md).
