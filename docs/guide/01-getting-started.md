# Getting started

Hybrid.8 runs in the browser. Open it, tap **START**, and a groove is already playing. Everything below is a way of
changing that groove into yours.

## The machine

Eight tracks. **Every track has two slots, A and B, and each slot holds a sound engine (or nothing).** Both slots play at once, so a
track can be a kick under a sample, two samples layered, an acid bass with a sample under it, or an FM and a pad together. One
shared effects section.

The engines are **ACID**, **FM**, **PAD**, **DRUM** (kick, snare, clap, closed hat, open hat, tom), **PERC** (a percussion synth)
and **SAMPLE**. The tracks start like this:

| # | Track | Slot A | Slot B |
|---|---|---|---|
| 1 | **KICK+SMPL** | Kick | Sample (sub thump) |
| 2 | **SNARE+CLAP** | Snare | Clap |
| 3 | **CH** | Closed hat | empty |
| 4 | **OH** | Open hat | empty |
| 5 | **SMPL+SMPL** | Sample (rim) | Sample (shaker) |
| 6 | **ACID** | Acid bass | empty |
| 7 | **ACID+SMPL** | Acid bass | Sample (snap) |
| 8 | **FM+PAD** | FM | Pad |

Change any of it from **SOUND**: pick the slot tab (**A** or **B**), then an engine. A track with a pitched engine (ACID, FM,
PAD) gets the keyboard and arpeggiator; any other track gets drum pads. A sample on a melodic track follows its notes.

The two hats choke each other: an open hat is cut by the next closed hat, as it would be on a real kit.

## The screen

Hybrid.8 adapts to the device. The pieces are the same everywhere; only their arrangement changes.

**Phone** — five tabs along the bottom:

| Tab | What is on it |
|---|---|
| **SEQ** | Track strip, step pads, keyboard, written-FX lane, punch pads |
| **SOUND** | Slot tabs and engine chips, the slot's knobs, the INSERT FX, the track's delay and reverb sends |
| **MIX** | Level, mute and solo for all eight tracks |
| **FX** | Track FX (delay and reverb per track) and the Punch FX panel |
| **PTN** | Pattern slots, copy, clear, chain |

**Wide screens (1100 px and up)** — everything is on one page. Transport and pattern navigation run across the top.
Below them a band holds the instrument knobs, the track FX and the Punch FX. The sequencer takes the rest of the
width, with a slim mixer beside it. Tracks with only drums and samples get a block of large pads; tracks with a pitched engine get a two-octave keyboard.
In a short window (820 px high or less, such as a DAW's default plugin window) the band is compacted: the delay and reverb
sends move to a strip under the knobs, so the keyboard stays on screen.

## The transport bar

| Control | Does |
|---|---|
| **PLAY / STOP** | Starts and stops the groove. `Space` does the same on a keyboard. |
| **BPM** | `−` and `+` move the tempo in 1 BPM steps, from 60 to 200. |
| **PTN / STEP** | The current pattern and the step being played. Tap to open the pattern list. |
| **SWING** | Delays every second 16th note. 50% is straight; the knob goes to 75%. Double-tap to reset. |
| **SAVE / LOAD / ☰** | Projects, key and scale, display options, MIDI. See [Projects](07-projects.md). |

## Controls you will use everywhere

- **Knobs** turn by dragging up/down or left/right. **Double-tap** returns a knob to its default. The arrow keys nudge
  a focused knob.
- **Sliders** work the same way; double-tap resets.
- **Destructive buttons** (CLR, CLEAR) ask you to tap twice. A stray tap never wipes a pattern.

## Keyboard shortcuts

| Key | Does |
|---|---|
| `Space` | Play / stop |
| `1` – `8` | Select a track and hear it |
| `[` `]` | Previous / next page of steps |

## Your first five minutes

1. **Tap START.** The demo groove plays.
2. **Mute and solo.** Press **M** on the kick, then bring it back. Press **S** on the bass to hear it alone.
3. **Change a sound.** Select a track, open **SOUND** (or look at the band on a wide screen), tap slot **B** and pick another
   engine. Choose **SAMPLE** and tap the sample name to pick from the shared library.
4. **Move a knob.** Select **ACID**, turn **FILTER** and **RES** while it plays.
5. **Punch something in.** Hold **FILTER** or **SWEEP** in the punch pads. Let go. Now arm **WRITE**, hold a pad
   during the loop, and the move is recorded and replays every time round.
6. **Save.** Name it with **SAVE**. Hybrid.8 also autosaves, so a reload picks up where you stopped.

Next: [Sequencing](02-sequencing.md).
