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
// the app shows them, 7 is the slot's LEVEL.
//
//   CC   7  volume                 CC  91  reverb send        slot A: CC 70 72 73 75 76 79 knobs 1-6, 14 level
//   CC  12  delay send             CC  20  mute (64+ = on)    slot B: CC 102-107 knobs 1-6, 15 level
//   CC  21  solo                   CC  22  arpeggiator on
//   CC  77  distortion (INSERT FX of a track with a synth)
//   CC  74  filter cutoff, 71 resonance, 78 mode (64+ = high-pass): INSERT FX of the other tracks, as in efem
//
// Punch FX macros: channel 9 (the one after the tracks), CC 102-119 in catalogue order, macro 1 then macro 2 of each pad
// (FILTER 102/103, DRIVE 104/105 ... VERB 118/119). 102-119 are undefined in the MIDI spec.
//
// There is no pan: the app has none. CC 10 is left free for it.
import { PUNCHES } from "../engine/mangler";
import { NUM_TRACKS } from "../engine/spec";
import type { MidiMapping } from "./control";

const TRACK_COUNT = NUM_TRACKS;
/** First CC of the Punch FX macros. */
const PUNCH_CC = 102;
/** CC of each of a slot's 7 knobs, by position: six engine knobs, LEVEL. (71, 74 and 78 are the filter's, as in efem.) */
const SLOT_CCS = [
  [70, 72, 73, 75, 76, 79, 14],
  [102, 103, 104, 105, 106, 107, 15],
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
    parameters[id("filterCut")] = { cc: 74, channel };
    parameters[id("filterRes")] = { cc: 71, channel };
    parameters[id("filterMode")] = { cc: 78, channel };
    (["a", "b"] as const).forEach((slot, s) => {
      SLOT_CCS[s].forEach((cc, k) => { parameters[id(`${slot}.${k + 1}`)] = { cc, channel }; });
    });
  }
  // the Punch FX macros live on their own channel, after the tracks
  PUNCHES.forEach((punch, i) => {
    parameters[`punch.${punch.key}.macro1`] = { cc: PUNCH_CC + i * 2, channel: TRACK_COUNT + 1 };
    parameters[`punch.${punch.key}.macro2`] = { cc: PUNCH_CC + i * 2 + 1, channel: TRACK_COUNT + 1 };
  });
  return parameters;
}

export const midiMapping: MidiMapping = {
  defaultChannel: 1,
  parameters: build(),
  // 64 patterns = 4 banks of 16. Bank Select (CC 0) picks the bank, Program Change 0-15 the pattern.
  program: { param: "pattern.select", bankSize: 16, bankCc: 0 },
};
