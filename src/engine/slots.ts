// What one track note plays. The step compiler emits one note per track (pitch relative to the track's lead voice); a track has two
// slots, and each slot turns that note into its own play event: an instrument note for an engine, a trigger of the shared sample for
// SAMPLE. Pure, so the live audio layer and the native sequence play exactly the same thing.
import type { InstrumentNoteParams } from "webdsp";
import { SAMPLE_CONTROLS, trackProfile, type Rig } from "./catalogue";
import { chordAt, chordTones, voicingAt } from "./chord";
import { normToUnits, TOP_AT } from "./spec";

/** A note for a whole track. `pitch` is semitones from the track's root (`TrackProfile.rootMidi`). */
export type TrackNote = InstrumentNoteParams;

export type SlotPlay =
  | {
    slot: 0 | 1;
    kind: "instrument";
    params: InstrumentNoteParams;
    /** A chord slot: which tone of the chord this note is (0 = lowest). The consumer maps it onto the slot's pool of instances. */
    tone?: number;
  }
  | {
    slot: 0 | 1;
    kind: "sample";
    /** Library id of the shared sample. */
    sample: string;
    time?: number;
    velocity: number;
    /** Semitones from the sample's own pitch (0 on a track that is not melodic). */
    pitch: number;
    loop: boolean;
    /** Playback window as fractions of the sample (start < end). */
    start: number;
    end: number;
    /** Fade-out length in seconds, or undefined to play the sample out (DECAY at FULL). */
    decay?: number;
    /** Looped voices are released this long after they start (the step's gate when the track is melodic, else DECAY). */
    duration?: number;
  };

/** The slot values the play events read: a pattern track's `slots`. */
export type SlotSounds = readonly [readonly number[], readonly number[]];

/** The smallest window a sample plays, as a fraction of its length. */
export const MIN_WINDOW = 0.01;

export function playSlots(rig: Rig, track: number, note: TrackNote, sounds: SlotSounds): SlotPlay[] {
  const profile = trackProfile(rig, track);
  const out: SlotPlay[] = [];
  for (const slot of [0, 1] as const) {
    const v = profile.voices[slot];
    if (!v) continue;
    if (v.engine === "sample") {
      const knob = (k: number) => sounds[slot][k] ?? 0;
      const decayNorm = knob(SAMPLE_CONTROLS.decay);
      const decay = normToUnits(v.controls[SAMPLE_CONTROLS.decay], decayNorm);
      const loop = Math.round(knob(SAMPLE_CONTROLS.mode)) === 1;
      const start = Math.min(1 - MIN_WINDOW, Math.max(0, knob(SAMPLE_CONTROLS.start)));
      const end = Math.min(1, Math.max(start + MIN_WINDOW, knob(SAMPLE_CONTROLS.end)));
      // the sample plays at its own pitch at the track's default note, and follows the notes of a melodic track from there
      const pitch = profile.melodic ? (note.pitch ?? 0) + profile.rootMidi - profile.defaultNote : 0;
      out.push({
        slot, kind: "sample", sample: slotSample(rig, track, slot), time: note.time, velocity: note.velocity ?? 1, pitch, loop, start, end,
        ...(decayNorm >= TOP_AT && !loop ? {} : { decay }),
        ...(loop ? { duration: profile.melodic && note.duration !== undefined ? note.duration : decay } : {}),
      });
    } else if (v.pitched && v.chord) {
      // one sequencer note is the chord's root: every tone starts together and ends with the note's duration, so a note-off needs no
      // bookkeeping. Each tone is pitched relative to the instrument's own root, as a single note would be.
      const knob = (key: string) => {
        const at = v.controls.findIndex((c) => c.key === key);
        return normToUnits(v.controls[at], sounds[slot][at] ?? 0);
      };
      const def = chordAt(knob("type"));
      const voicing = voicingAt(knob("voicing"));
      const root = profile.rootMidi + (note.pitch ?? 0);
      chordTones(root, def, voicing).forEach((midi, tone) => {
        out.push({ slot, kind: "instrument", tone, params: { ...note, pitch: midi - (v.rootMidi ?? profile.rootMidi) } });
      });
    } else if (v.pitched) {
      out.push({
        slot, kind: "instrument",
        params: { ...note, pitch: (note.pitch ?? 0) + profile.rootMidi - (v.rootMidi ?? profile.rootMidi) },
      });
    } else {
      // a fixed-pitch hit: no pitch, no held note (an acid line beside a drum voice must not turn the drum into a sustained note)
      const { time, velocity, pan } = note;
      out.push({ slot, kind: "instrument", params: { time, velocity, pan, ...(v.chokeGroup !== undefined ? { chokeGroup: v.chokeGroup } : {}) } });
    }
  }
  return out;
}

const slotSample = (rig: Rig, track: number, slot: 0 | 1): string => rig[track][slot].variant;
