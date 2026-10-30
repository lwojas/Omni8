# MIDI

Hybrid.8 takes MIDI **control** from a controller or a DAW, sends the same controls back so motorised faders and
displays follow, and can **follow an external clock**. Notes can also play the selected track in **Keyboard mode**.

MIDI needs a browser with Web MIDI (Chrome and Edge have it). The browser asks permission the first time.

## Switching it on

**☰ → MIDI → MIDI: ON.** Then choose:

| Setting | Options |
|---|---|
| **Control input** | All inputs, or one device |
| **Keyboard** | Off, all inputs, or one device |
| **Key octave** | Shift for keyboard notes |
| **Output** | All outputs, None, or one device |
| **Follow MIDI clock** | Sync tempo and transport to an external clock |

The settings are remembered in the browser.

## Keyboard

Choose a **Keyboard** device and it plays the **selected track**, whatever channel it sends on. It is separate from the
**Control input**, so a keyboard and a fader controller can be different devices. It behaves like the on-screen keys:

- a drum track plays its hit on any key
- a melodic track plays the note; with the arpeggiator on, held keys feed the arp
- with a step selected, the note is written into that step
- notes outside the track's range are ignored; use **Key octave** (-4 to +4) to move the keybed into range

Notes from the keyboard device never reach the CC map. Controllers, program changes and clock come from the Control input only.

## Channels and controllers

One MIDI channel per track, the usual multitimbral layout. Track 1 is channel 1, track 8 is channel 8. Every track uses
the same controller numbers.

| CC | Does | Notes |
|---|---|---|
| **7** | Level | |
| **12** | Delay send | |
| **91** | Reverb send | |
| **20** | Mute | 0–63 off, 64–127 on |
| **21** | Solo | 0–63 off, 64–127 on |
| **22** | Arpeggiator | tracks with a pitched engine |
| **77** | Distortion | the INSERT FX of a track with a synth |
| **74** | Filter cutoff | the INSERT FX of the other tracks |
| **71** | Filter resonance | |
| **78** | Filter mode | 0–63 low-pass, 64–127 high-pass |

### Slot knobs

A slot's knob is addressed by its **position**, not its name, because the engine in a slot can change. Positions 1 to 6 are the
engine's own knobs in the order the app shows them; position 7 is the slot's LEVEL.

| Slot | Knob 1 – 6 | Level |
|---|---|---|
| **A** | CC 70, 72, 73, 75, 76, 79 | CC 14 |
| **B** | CC 102 – 107 | CC 15 |

Stepped controls (the FM's COLOR, a sample's PLAY) take the 0–127 range split into equal bands. A knob a slot's engine does not have
is stored but does nothing.

Volume, sends and knobs edit the pattern on screen, exactly as the controls on screen do.

## Choosing patterns

**Bank Select (CC 0) + Program Change**, on channel 1. 4 banks of 16 patterns give all 64.

| Bank (CC 0) | Program | Pattern |
|---|---|---|
| 0 | 0 – 15 | 1 – 16 |
| 1 | 0 – 15 | 17 – 32 |
| 2 | 0 – 15 | 33 – 48 |
| 3 | 0 – 15 | 49 – 64 |

While the transport is running, a program change **cues** the pattern for the next loop, the same as tapping a slot.

## Two-way control

Move a control in Hybrid.8, and the matching CC goes out. Switch pattern, and the controller's faders move to that
pattern's levels. Hybrid.8 never echoes back a value your controller just sent, and does not resend a value your
controller already shows. When a controller is plugged in, Hybrid.8 sends the whole state at once so it starts in sync.

## Following a clock

Turn **Follow MIDI clock** on and Hybrid.8 slaves to an external source:

- **Start / Stop / Continue** drive the transport.
- **Song Position Pointer** moves the playhead. With a chain on, the position is in the chain; otherwise it loops the
  current pattern.
- **Tempo** is read from the clock, rounded to 0.1 BPM, and limited to 60 – 200.
- If clock pulses stop for a second while the clock is running the transport, the transport stops.

Hybrid.8 plays about 50 ms behind the sender so the first step has time to be scheduled; this is constant, and tight
enough for a groove. Hybrid.8 does not send MIDI clock.

## Changing the map

The mapping is a single, readable file. CC numbers live in [`src/midi/mapping.ts`](../../src/midi/mapping.ts) and nowhere
else. See [Extending → MIDI](../dev/extending.md#change-the-midi-map).

Next: [Reference](09-reference.md).
