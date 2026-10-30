// Hybrid.8's external control contract: which MIDI controller moves which parameter. This is the only
// file that contains CC numbers. Edit it freely; nothing else needs to change. Parameter ids come from
// engine/params.ts, and the engine that applies this (midi/control.ts) is generic.
//
// Channels are 1-16. A parameter without `channel` uses `defaultChannel`.
//
// Layout: one channel per track (the usual multitimbral hardware layout), the same CC numbers on
// every channel. Pattern selection is Bank Select + Program Change on the default channel.
//
// A track has two slots and the engine in a slot can change, so a knob is addressed by its position
// (`track.N.a.K`, `track.N.b.K`), not by what it does: K 1-6 are the engine's own knobs in the order
// the app shows them, 7 is the slot's LEVEL and 8 its FILTER.
//
//   CC   7  volume                 CC  91  reverb send        slot A: CC 70-75 knobs 1-6, 14 level, 76 filter
//   CC  12  delay send             CC  20  mute (64+ = on)    slot B: CC 102-107 knobs 1-6, 15 level, 78 filter
//   CC  21  solo                   CC  22  arpeggiator on
//   CC  77  distortion (the INSERT FX, every track)
//
// There is no pan: the app has none. CC 10 is left free for it.
import { NUM_TRACKS } from "../engine/spec";
import type { MidiMapping } from "./control";

const TRACK_COUNT = NUM_TRACKS;
/** CC of each of a slot's 8 knobs, by position: six engine knobs, LEVEL, FILTER. */
const SLOT_CCS = [
  [70, 71, 72, 73, 74, 75, 14, 76],
  [102, 103, 104, 105, 106, 107, 15, 78],
] as const;

function build(): MidiMapping["parameters"] {
  const parameters: MidiMapping["parameters"] = {};
  for (let t = 0; t < TRACK_COUNT; t++) {
    const channel = t + 1;
    const id = (name: string) => `track.${t + 1}.${name}`;
    parameters[id("volume")] = { cc: 7, channel };
    parameters[id("mute")] = { cc: 20, channel };
    parameters[id("solo")] = { cc: 21, channel };
    parameters[id("delaySend")] = { cc: 12, channel };
    parameters[id("reverbSend")] = { cc: 91, channel };
    parameters[id("arp")] = { cc: 22, channel };
    parameters[id("distortion")] = { cc: 77, channel };
    (["a", "b"] as const).forEach((slot, s) => {
      SLOT_CCS[s].forEach((cc, k) => { parameters[id(`${slot}.${k + 1}`)] = { cc, channel }; });
    });
  }
  return parameters;
}

export const midiMapping: MidiMapping = {
  defaultChannel: 1,
  parameters: build(),
  // 64 patterns = 4 banks of 16. Bank Select (CC 0) picks the bank, Program Change 0-15 the pattern.
  program: { param: "pattern.select", bankSize: 16, bankCc: 0 },
};
