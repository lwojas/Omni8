# MIDI

Hybrid.8 can be controlled from a MIDI controller or your music software (DAW). It sends the same controls back, so
motorised faders and displays follow along, and it can **follow an external clock** to stay in time with your other gear.
You can also play the selected track from a MIDI keyboard.

MIDI knobs and faders each send a numbered message called a **CC** (controller number). The tables below say which number does what, so you can set your controller or DAW to match. If your gear lets you "learn" a control, you can skip the numbers and just move the on-screen control while your hardware listens.

MIDI needs a browser that supports it (Chrome and Edge do). The first time, the browser will ask your permission.

## Switching it on

Go to **☰ → MIDI → MIDI: ON**, then choose:

| Setting | Choices |
|---|---|
| **Control input** | All inputs, or one device |
| **Keyboard** | Off, all inputs, or one device |
| **Key octave** | Moves the keyboard's notes up or down |
| **Output** | All outputs, None, or one device |
| **Follow MIDI clock** | Match tempo and start/stop to an external clock |

Your choices are remembered in the browser.

## Playing from a keyboard

Choose a **Keyboard** device and it plays the **selected track**, whichever MIDI channel it sends on. This is separate from
the **Control input**, so your keyboard and your fader controller can be different devices. It works like the on-screen
keys:

- On a drum track, any key plays that track's hit.
- On a melodic track, keys play notes; with the arpeggiator on, the keys you hold feed it.
- If a step is selected, the note you play is written into that step.
- Notes outside the track's range are ignored. Use **Key octave** (-4 to +4) to shift your keyboard into range.

Notes from the keyboard device never trigger the knob and fader mapping. Knob and fader moves, program changes and clock
come from the Control input only.

## Channels and controls

Each track has its own MIDI channel, the usual layout for multi-instrument setups: track 1 is channel 1, track 8 is
channel 8. Every track uses the same controller numbers (CCs).

| CC | What it controls | Notes |
|---|---|---|
| **7** | Level | |
| **12** | Delay send | |
| **91** | Reverb send | |
| **20** | Mute | 0–63 off, 64–127 on |
| **21** | Solo | 0–63 off, 64–127 on |
| **22** | Arpeggiator | Tracks with a melodic instrument |
| **77** | Distortion | The track's distortion (tracks with a synth) |
| **74** | Filter cutoff | The track's filter (all other tracks) |
| **71** | Filter resonance | |
| **78** | Filter mode | 0–63 low-pass, 64–127 high-pass |

### Instrument knobs

Instrument knobs are controlled by their **position**, not their name, because the instrument in a slot can change.
Positions 1 to 6 are the instrument's own knobs in the order they appear on screen, and position 7 is the slot's LEVEL.

| Slot | Knobs 1 – 6 | Level |
|---|---|---|
| **A** | CC 70, 72, 73, 75, 76, 79 | CC 14 |
| **B** | CC 102 – 107 | CC 15 |

Controls that move in steps (like the FM's COLOR, or a sample's PLAY) split the 0–127 range into equal sections. If a
slot's instrument doesn't have a knob at that position, the message is remembered but does nothing.

Level, sends and knobs change the pattern on screen, exactly as the on-screen controls do.

## Choosing patterns

Use **Bank Select (CC 0) and Program Change** on channel 1. Four banks of 16 patterns cover all 64.

| Bank (CC 0) | Program | Pattern |
|---|---|---|
| 0 | 0 – 15 | 1 – 16 |
| 1 | 0 – 15 | 17 – 32 |
| 2 | 0 – 15 | 33 – 48 |
| 3 | 0 – 15 | 49 – 64 |

While the beat is playing, a program change **cues** the pattern for the next loop, the same as tapping a slot.

## Two-way control

Move a control in Hybrid.8 and the matching MIDI message is sent out. When you switch pattern, your controller's faders
move to that pattern's levels. Hybrid.8 doesn't send back a value your controller has just sent, and doesn't resend a
value your controller already shows. When you plug a controller in, Hybrid.8 sends everything at once so the two start
in sync.

## Following a clock

Turn **Follow MIDI clock** on and Hybrid.8 follows an external source:

- **Start / Stop / Continue** control play and stop.
- **Song Position** moves the playhead. With a chain on, the position is within the chain; otherwise it loops the current
  pattern.
- **Tempo** is taken from the clock, rounded to 0.1 BPM, and kept between 60 and 200.
- If the clock stops sending for a second while it's running the beat, the beat stops.

Hybrid.8 plays about 50 milliseconds behind the clock source so the first step has time to get ready. That delay is
constant and tight enough for a groove. Hybrid.8 doesn't send out a MIDI clock of its own.

Next: [Reference](09-reference.md).
