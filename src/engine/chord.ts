// The chord generator of the CHORD synth voice: pure data and functions, no audio and no UI. The sequencer plays one note; `chordTones`
// turns it into the notes of a chord, and `playSlots` (slots.ts) sends one instrument note per tone. webdsp instruments are monophonic,
// so the polyphony is a small fixed pool of instances of one instrument per slot (see `Groovebox.setSlot`): the same "a chord = several
// instances" the instruments themselves document.

/** A chord quality: its tones as semitones above the root (0..11), in the order of their role: root, third (or the sus note), fifth,
 * seventh (or sixth), then an extension. A voicing decides which octave each role sounds in. */
export interface ChordDef {
  key: string;
  /** Readout on the knob (short). */
  label: string;
  tones: readonly number[];
}

/** A voicing: for each role of a chord, how many octaves above its place in 0..11 it sounds (null: left out). Roles a chord does not
 * have are ignored. The same voicings apply to every chord, so a new chord is one row and a new voicing is one row. */
export interface VoicingDef {
  key: string;
  label: string;
  octaves: readonly (number | null)[];
}

/** The most notes a chord plays, and so the instances one bank needs. */
export const CHORD_MAX_TONES = 5;
/** Banks of instances a chord slot alternates between: a new chord starts on the other bank, so the previous chord's release tail
 * rings on instead of being retriggered. A third overlapping chord reuses the oldest bank (webdsp then carries it on continuously). */
export const CHORD_BANKS = 2;
/** Instances a chord slot creates: bounded, whatever the chord. */
export const CHORD_INSTANCES = CHORD_MAX_TONES * CHORD_BANKS;

/** Other tones are never left below this MIDI note (C3): close intervals in the low register turn to mud, so they move up an octave and
 * the root alone sits low. Tones above `CEILING` move down an octave. */
export const CHORD_FLOOR = 48;
export const CHORD_CEILING = 88;

/** The chord qualities, in the order the TYPE knob steps through them: the dub techno staples first. */
export const CHORDS: readonly ChordDef[] = [
  { key: "min7", label: "m7", tones: [0, 3, 7, 10] },
  { key: "min9", label: "m9", tones: [0, 3, 7, 10, 2] },
  { key: "min11", label: "m11", tones: [0, 3, 7, 10, 5] },
  { key: "minadd9", label: "m(add9)", tones: [0, 3, 7, 2] },
  { key: "min", label: "MINOR", tones: [0, 3, 7] },
  { key: "maj7", label: "MAJ7", tones: [0, 4, 7, 11] },
  { key: "maj9", label: "MAJ9", tones: [0, 4, 7, 11, 2] },
  { key: "dom7", label: "DOM7", tones: [0, 4, 7, 10] },
  { key: "maj", label: "MAJOR", tones: [0, 4, 7] },
  { key: "sus4", label: "7SUS4", tones: [0, 5, 7, 10] },
  { key: "sus2", label: "SUS2", tones: [0, 2, 7] },
  { key: "dim7", label: "DIM7", tones: [0, 3, 6, 9] },
  { key: "alt", label: "7#9", tones: [0, 4, 7, 10, 3] },
];

/** The voicings, in the order the VOICE knob steps through them. OPEN is the default: root, fifth and seventh low, the third up, the
 * extension on top, which keeps neighbouring tones a third or more apart. */
export const VOICINGS: readonly VoicingDef[] = [
  { key: "open", label: "OPEN", octaves: [0, 1, 0, 0, 2] },
  { key: "close", label: "CLOSE", octaves: [0, 0, 0, 0, 1] },
  { key: "wide", label: "WIDE", octaves: [0, 1, 1, 1, 2] },
  { key: "shell", label: "SHELL", octaves: [null, 0, 1, 0, 1] },  // no root: third, seventh and colour, for a bass to sit under
  { key: "high", label: "HIGH", octaves: [1, 2, 1, 1, 3] },
  { key: "inv", label: "INVERT", octaves: [1, 0, 0, 0, 2] },       // the third in the bass
];

/** The labels, in order: the TYPE and VOICE knobs' detents. */
export const CHORD_LABELS: readonly string[] = CHORDS.map((c) => c.label);
export const VOICING_LABELS: readonly string[] = VOICINGS.map((v) => v.label);

const pick = <T,>(list: readonly T[], index: number): T => list[Math.min(list.length - 1, Math.max(0, Math.round(index) || 0))];
/** The chord a TYPE knob step selects (a stale or out-of-range index lands on the nearest chord). */
export const chordAt = (index: number): ChordDef => pick(CHORDS, index);
/** The voicing a VOICE knob step selects. */
export const voicingAt = (index: number): VoicingDef => pick(VOICINGS, index);

/** The notes (MIDI, ascending, no duplicates, at most `CHORD_MAX_TONES`) of chord `def` voiced as `voicing` on root note `root`.
 * Nothing for a root outside MIDI 0..127; tones that would leave it are dropped. Only the root itself may sit below `CHORD_FLOOR`. */
export function chordTones(root: number, def: ChordDef, voicing: VoicingDef = VOICINGS[0]): number[] {
  const r = Math.round(root);
  if (!(r >= 0 && r <= 127)) return [];
  const out = new Set<number>();
  def.tones.forEach((pc, role) => {
    const oct = voicing.octaves[role];
    if (oct === null || oct === undefined) return;
    let n = r + pc + 12 * oct;
    const isRoot = pc === 0 && role === 0;
    while (!isRoot && n < CHORD_FLOOR && n < r + 48) n += 12;
    while (n > CHORD_CEILING && n - 12 >= r) n -= 12;
    if (n >= 0 && n <= 127) out.add(n);
  });
  return [...out].sort((a, b) => a - b).slice(0, CHORD_MAX_TONES);
}

/** Which instance of a chord slot's pool plays tone `tone` of bank `bank`; `pool` is how many instances the slot actually has (fewer
 * than `CHORD_INSTANCES` when the engine's instrument limit is near), so a small pool wraps instead of failing. */
export const chordInstance = (bank: number, tone: number, pool: number): number => (bank * CHORD_MAX_TONES + tone) % Math.max(1, pool);

/** Hands out the bank for each new chord of a slot, alternating (the state lives with the caller, never in a pure function). */
export class ChordBanks {
  private next = new Map<string, number>();
  take(slotKey: string): number {
    const bank = this.next.get(slotKey) ?? 0;
    this.next.set(slotKey, (bank + 1) % CHORD_BANKS);
    return bank;
  }
  reset(): void {
    this.next.clear();
  }
}
