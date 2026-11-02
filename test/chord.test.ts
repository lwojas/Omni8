// The CHORD synth voice: the chord set and its voicing, how one note becomes several, and how the pool of instances plays and releases them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Groovebox, lockWrites, soundWrites, type GraphIds } from "../src/engine/audio";
import { defaultSlotSound, emptySlot, SYNTH_VOICES, voiceOf, type Rig } from "../src/engine/catalogue";
import {
  CHORD_BANKS, CHORD_CEILING, CHORD_FLOOR, CHORD_INSTANCES, CHORD_MAX_TONES, CHORDS, ChordBanks, chordAt, chordInstance, chordTones, VOICINGS, voicingAt,
} from "../src/engine/chord";
import { noteEvents } from "../src/engine/nativeseq";
import { playSlots } from "../src/engine/slots";
import { normToUnits, NUM_TRACKS, readAtTrigger, unitsToNorm } from "../src/engine/spec";
import { DEFAULT_RIG, newPattern } from "../src/engine/state";

const chord = { engine: "synth", variant: "chord" } as const;
const TRACK = 7;
/** The starting rig with a CHORD in slot A of track 7 (slot B empty). */
const RIG: Rig = DEFAULT_RIG.map((tr, t) => (t === TRACK ? ([chord, emptySlot()] as const) : tr));
const voice = voiceOf(chord)!;
const typeControl = voice.controls[0];
const sounds = () => newPattern(RIG).tracks[TRACK].slots;
const typed = (key: string, voicing = "open") => {
  const s = sounds();
  s[0][0] = unitsToNorm(typeControl, CHORDS.findIndex((c) => c.key === key));
  s[0][5] = unitsToNorm(voice.controls[5], VOICINGS.findIndex((v) => v.key === voicing));
  return s;
};
const def = (key: string) => CHORDS.find((c) => c.key === key)!;

/** Graph ids for track 7 slot A holding `instances` (the first is the slot's `inst`). */
function idsWith(instances: number[]): GraphIds {
  const ids = {
    inst: Array.from({ length: NUM_TRACKS }, () => [undefined, undefined]),
    pool: Array.from({ length: NUM_TRACKS }, () => [[], []]),
    slotBus: Array.from({ length: NUM_TRACKS }, (_, t) => [1000 + t * 2, 1001 + t * 2]),
  } as any;
  ids.inst[TRACK] = [instances[0], undefined];
  ids.pool[TRACK] = [instances, []];
  return ids as GraphIds;
}

describe("the chord set", () => {
  it("has the dub techno staples first and every chord within the pool", () => {
    expect(CHORDS.slice(0, 3).map((c) => c.key)).toEqual(["min7", "min9", "min11"]);
    const keys = CHORDS.map((c) => c.key);
    for (const k of ["min", "maj", "maj7", "min7", "dom7", "min9", "maj9", "sus4", "sus2", "dim7", "alt"]) expect(keys).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of CHORDS) {
      expect(c.tones[0]).toBe(0);
      expect(c.tones.length).toBeLessThanOrEqual(CHORD_MAX_TONES);
      for (const pc of c.tones) { expect(pc).toBeGreaterThanOrEqual(0); expect(pc).toBeLessThan(12); }
    }
  });

  it("falls back to the nearest chord for a stale knob position", () => {
    expect(chordAt(-3)).toBe(CHORDS[0]);
    expect(chordAt(999)).toBe(CHORDS[CHORDS.length - 1]);
    expect(chordAt(NaN)).toBe(CHORDS[0]);
  });
});

describe("chord generation", () => {
  it("builds each chord from its root as an open voicing", () => {
    expect(chordTones(48, def("min7"))).toEqual([48, 55, 58, 63]); // C3 Eb G Bb: C G Bb Eb
    expect(chordTones(48, def("min9"))).toEqual([48, 55, 58, 63, 74]);
    expect(chordTones(48, def("maj9"))).toEqual([48, 55, 59, 64, 74]);
    expect(chordTones(48, def("dom7"))).toEqual([48, 55, 58, 64]);
    expect(chordTones(48, def("sus2"))).toEqual([48, 55, 62]);
  });

  it("voices every chord every way: OPEN by default, with CLOSE, WIDE, SHELL, HIGH and INVERT as variations", () => {
    expect(VOICINGS.map((v) => v.key)).toEqual(["open", "close", "wide", "shell", "high", "inv"]);
    expect(chordTones(48, def("min7"))).toEqual(chordTones(48, def("min7"), VOICINGS[0]));
    expect(chordTones(48, def("min7"), voicingAt(1))).toEqual([48, 51, 55, 58]);   // close: C Eb G Bb
    expect(chordTones(48, def("min7"), voicingAt(2))).toEqual([48, 63, 67, 70]);   // wide: the rest an octave up
    expect(chordTones(48, def("min7"), voicingAt(3))).toEqual([51, 58, 67]);       // shell: no root
    expect(chordTones(48, def("min7"), voicingAt(4))).toEqual([60, 67, 70, 75]);   // high: an octave up
    expect(chordTones(48, def("min7"), voicingAt(5))).toEqual([51, 55, 58, 60]);   // invert: Eb G Bb C
    expect(chordTones(48, def("maj9"), voicingAt(1))).toEqual([48, 52, 55, 59, 62]);
    // the voicings differ for every chord that has more than a triad's worth of tones
    for (const c of CHORDS) expect(new Set(VOICINGS.map((v) => chordTones(48, c, v).join())).size).toBeGreaterThanOrEqual(5);
  });

  it("keeps the invariants for every chord in every voicing at every root", () => {
    for (const c of CHORDS) for (const v of VOICINGS) for (let root = 0; root <= 127; root++) {
      const t = chordTones(root, c, v);
      expect(t.length).toBeLessThanOrEqual(CHORD_MAX_TONES);
      expect(new Set(t).size).toBe(t.length);
      expect(t).toEqual([...t].sort((a, b) => a - b));
      for (const n of t) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(127); }
      if (root <= 100) expect(t.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("always keeps the root as the lowest note, and keeps every tone in range and distinct", () => {
    for (const c of CHORDS) {
      for (let root = 0; root <= 127; root++) {
        const t = chordTones(root, c, VOICINGS[1]);
        expect(t[0]).toBe(root);
        expect(t.length).toBeLessThanOrEqual(CHORD_MAX_TONES);
        expect(new Set(t).size).toBe(t.length);
        for (const n of t) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(127); }
        expect(t).toEqual([...t].sort((a, b) => a - b));
      }
    }
  });

  it("moves low tones up an octave so only the root sits below C3", () => {
    expect(chordTones(36, def("min7"))).toEqual([36, 51, 55, 58]);
    for (const c of CHORDS) for (const v of VOICINGS) for (let root = 24; root <= 47; root++) {
      for (const n of chordTones(root, c, v)) if ((n - root) % 12 !== 0) expect(n).toBeGreaterThanOrEqual(CHORD_FLOOR); // only a root (in any octave) may sit lower
    }
  });

  it("keeps tones under the ceiling while a high root leaves room, and drops what cannot fit instead of leaving MIDI range", () => {
    for (const c of CHORDS) for (const n of chordTones(60, c)) expect(n).toBeLessThanOrEqual(CHORD_CEILING);
    for (const c of CHORDS) for (const v of VOICINGS) for (const n of chordTones(60, c, v)) expect(n).toBeLessThanOrEqual(CHORD_CEILING + 12);
    expect(chordTones(127, def("min7"))).toEqual([127]);
    expect(chordTones(-5, def("min7"))).toEqual([]);
    expect(chordTones(200, def("min7"))).toEqual([]);
  });

  it("makes a different chord for each note of a C - Ab - Eb - Bb line, each topped by its own colour tones", () => {
    const line = [48, 44, 51, 46].map((r) => chordTones(r, def("min9")));
    expect(new Set(line.map((c) => c.join())).size).toBe(4);
    for (const [i, r] of [48, 44, 51, 46].entries()) expect(line[i][0]).toBe(r);
  });
});

describe("one sequencer note plays the chord", () => {
  it("sends one instrument note per tone, together, each as long as the sequencer note", () => {
    const plays = playSlots(RIG, TRACK, { time: 2, velocity: 0.8, pitch: 3, duration: 0.4 }, typed("min7"));
    // track 7's root is MIDI 45 (the FM): pitch 3 is C3 (48), so the chord is C3 G3 Bb3 Eb4
    expect(plays.map((p) => p.kind === "instrument" && p.tone)).toEqual([0, 1, 2, 3]);
    expect(plays.map((p) => (p as { params: { pitch: number } }).params.pitch)).toEqual([48, 55, 58, 63].map((m) => m - 45));
    for (const p of plays) expect(p).toMatchObject({ slot: 0, params: { time: 2, velocity: 0.8, duration: 0.4 } });
  });

  it("follows the TYPE and VOICE knobs, and a longer chord plays more instances", () => {
    expect(playSlots(RIG, TRACK, { time: 0 }, typed("min9"))).toHaveLength(5);
    expect(playSlots(RIG, TRACK, { time: 0 }, typed("maj"))).toHaveLength(3);
    const pitches = (v: string) => playSlots(RIG, TRACK, { time: 0, pitch: 3 }, typed("min7", v)).map((p) => (p as { params: { pitch: number } }).params.pitch + 45);
    expect(pitches("close")).toEqual([48, 51, 55, 58]);
    expect(pitches("shell")).toEqual([51, 58, 67]);
    expect(pitches("open")).not.toEqual(pitches("wide"));
  });

  it("is a different set of notes in an octave-shifted track, with the same shape", () => {
    const a = playSlots(RIG, TRACK, { time: 0, pitch: 3 }, typed("maj7")).map((p) => (p as { params: { pitch: number } }).params.pitch);
    const b = playSlots(RIG, TRACK, { time: 0, pitch: 15 }, typed("maj7")).map((p) => (p as { params: { pitch: number } }).params.pitch);
    expect(b).toEqual(a.map((x) => x + 12));
  });

  it("leaves a single note on every other synth", () => {
    for (const [i, key] of ["acid", "fm", "pad", "pluck", "saw"].entries()) {
      const rig: Rig = DEFAULT_RIG.map((tr, t) => (t === TRACK ? ([{ engine: "synth", variant: key }, emptySlot()] as const) : tr));
      const plays = playSlots(rig, TRACK, { time: 0, pitch: i }, newPattern(rig).tracks[TRACK].slots);
      expect(plays).toHaveLength(1);
      expect(plays[0]).not.toHaveProperty("tone");
    }
  });
});

describe("the voice", () => {
  it("is a SYNTH voice with a small macro surface: TYPE, CUTOFF, RES, ATTACK, RELEASE, VOICE", () => {
    expect(SYNTH_VOICES.chord).toBe(voice);
    expect(voice.controls.map((c) => c.label)).toEqual(["TYPE", "CUTOFF", "RES", "ATTACK", "RELEASE", "VOICE"]);
    expect(voice.chord).toBe(true);
    expect(voice.pitched).toBe(true);
  });

  it("reads TYPE when a note triggers, so it has no step lock, LFO or engine write", () => {
    expect(readAtTrigger(typeControl)).toBe(true);
    expect(readAtTrigger(voice.controls[5])).toBe(true);
    const ids = idsWith([100, 101, 102]);
    const writes = soundWrites(ids, newPattern(RIG), RIG).filter((w) => w.kind === "inst" && w.instrument === 100);
    expect(writes).toHaveLength(4); // the four engine knobs; TYPE and VOICE write nothing
    expect(lockWrites(ids, RIG, TRACK, { ...({} as object), target: { kind: "sound", slot: 0, control: 0 } } as never, 0.5)).toEqual([]);
  });

  it("sends each engine knob to every instance of the pool", () => {
    const ids = idsWith([100, 101, 102]);
    const cutoff = soundWrites(ids, newPattern(RIG), RIG).find((w) => w.kind === "inst" && w.key === `${TRACK}:0:1`)!;
    expect(cutoff).toMatchObject({ kind: "inst", instrument: 100, also: [101, 102] });
  });

  it("has defaults inside its ranges, with a sweet-spot cutoff, moderate resonance and a stab-length release", () => {
    const d = defaultSlotSound(voice);
    for (const [i, c] of voice.controls.entries()) expect(d[i]).toBeGreaterThanOrEqual(0), expect(d[i]).toBeLessThanOrEqual(1), expect(c.def).toBeDefined();
    expect(normToUnits(voice.controls[1], d[1])).toBeCloseTo(900, 0);
    expect(normToUnits(voice.controls[4], d[4])).toBeCloseTo(0.5, 2);
  });
});

describe("the instance pool", () => {
  it("alternates banks per chord, so a chord's release rings while the next one starts", () => {
    const b = new ChordBanks();
    expect([b.take("7:0"), b.take("7:0"), b.take("7:0"), b.take("2:1")]).toEqual([0, 1, 0, 0]);
    expect(CHORD_BANKS).toBe(2);
    // the two banks never share an instance
    const used = (bank: number) => new Set(Array.from({ length: CHORD_MAX_TONES }, (_, t) => chordInstance(bank, t, CHORD_INSTANCES)));
    for (const i of used(0)) expect(used(1).has(i)).toBe(false);
  });

  it("wraps into a smaller pool instead of failing", () => {
    for (let bank = 0; bank < CHORD_BANKS; bank++) for (let t = 0; t < CHORD_MAX_TONES; t++) {
      const i = chordInstance(bank, t, 3);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(3);
    }
    expect(chordInstance(1, 4, 0)).toBe(0);
  });
});

describe("a chord slot in the graph", () => {
  function fake() {
    const created: Array<{ id: number; bus: number }> = [];
    const removed: number[] = [];
    const offs: number[] = [];
    const ons: Array<{ id: number; params: { pitch?: number; duration?: number } }> = [];
    const params: Array<[number, number, number]> = [];
    let next = 1;
    const gb = Object.create(Groovebox.prototype) as any;
    gb.runtime = {
      createInstrument: vi.fn((_k: number, o: { bus: number }) => { const id = next++; created.push({ id, bus: o.bus }); return id; }),
      removeInstrument: vi.fn((id: number) => removed.push(id)),
      instrumentNoteOff: vi.fn((id: number) => offs.push(id)),
      instrumentNoteOn: vi.fn((id: number, p: object) => ons.push({ id, params: p })),
      setInstrumentParameter: vi.fn((id: number, p: number, v: number) => params.push([id, p, v])),
      release: vi.fn(), cancelScheduled: vi.fn(), setNodeParameter: vi.fn(),
    };
    gb.inst = Array.from({ length: NUM_TRACKS }, () => [undefined, undefined]);
    gb.pool = Array.from({ length: NUM_TRACKS }, () => [[], []]);
    gb.chordBanks = new ChordBanks();
    gb.slotBus = Array.from({ length: NUM_TRACKS }, (_, t) => [1000 + t * 2, 1001 + t * 2]);
    gb.applied = Array.from({ length: NUM_TRACKS }, () => ["", ""]);
    for (const k of ["soundCache", "busCache", "fxCache", "samples", "loading", "loops", "lastSample"]) gb[k] = new Map();
    gb.lockedParams = Array.from({ length: NUM_TRACKS }, () => new Map());
    gb.lfoParams = Array.from({ length: NUM_TRACKS }, () => new Map());
    gb.lockedKeys = new Set();
    gb.lfoKeys = new Set();
    gb.ensureSample = vi.fn(() => Promise.resolve());
    gb.ids = { inst: gb.inst, pool: gb.pool, slotBus: gb.slotBus };
    return { gb: gb as Groovebox, created, removed, offs, ons, params };
  }
  const play = (gb: Groovebox, pitch: number, duration = 0.5) => gb.note(TRACK, RIG, { velocity: 1, pitch, duration }, typed("min7"));
  const pool = (gb: Groovebox) => (gb as any).pool[TRACK][0] as number[];

  let f: ReturnType<typeof fake>;
  beforeEach(() => { f = fake(); f.gb.syncRig(RIG); });

  it("creates a bounded pool of instances on the slot's bus and gives them all the voice's fixed settings", () => {
    const mine = f.created.filter((c) => c.bus === 1000 + TRACK * 2);
    expect(mine).toHaveLength(CHORD_INSTANCES);
    expect(pool(f.gb)).toEqual(mine.map((c) => c.id));
    expect((f.gb as any).inst[TRACK][0]).toBe(pool(f.gb)[0]);
    // every instance has the same fixed parameters
    const fixedSets = new Set(pool(f.gb).map((id) => f.params.filter(([i]) => i === id).length));
    expect(fixedSets.size).toBe(1);
  });

  it("plays one instance per tone, all at once, and releases them by the note's duration", () => {
    play(f.gb, 3, 0.4);
    expect(f.ons).toHaveLength(4);
    expect(new Set(f.ons.map((o) => o.id)).size).toBe(4);
    expect(f.ons.every((o) => o.params.duration === 0.4)).toBe(true);
    expect(f.ons.every((o) => pool(f.gb).includes(o.id))).toBe(true);
  });

  it("starts a repeated note on the other bank, then the first again, and never reuses an instance within a chord", () => {
    play(f.gb, 3);
    play(f.gb, 3);
    play(f.gb, 3);
    const [a, b, c] = [f.ons.slice(0, 4), f.ons.slice(4, 8), f.ons.slice(8, 12)].map((g) => g.map((o) => o.id));
    for (const id of a) expect(b).not.toContain(id); // overlapping chords share no voice: the first one's tail is not cut
    expect(c).toEqual(a); // the third reuses the oldest bank (webdsp retriggers it continuously)
  });

  it("keeps a different chord's tones on distinct instances for overlapping notes of different pitch", () => {
    play(f.gb, 3, 4);
    play(f.gb, -1, 4);
    const ids = f.ons.map((o) => o.id);
    expect(new Set(ids).size).toBe(8);
  });

  it("moves every instance with a knob and silences every instance on stop", () => {
    f.gb.applySound(newPattern(RIG), RIG);
    const cut = pool(f.gb).map((id) => f.params.filter(([i, , ]) => i === id).length);
    expect(new Set(cut).size).toBe(1); // every instance got the same writes
    f.gb.silence();
    for (const id of pool(f.gb)) expect(f.offs).toContain(id);
  });

  it("removes the whole pool when the slot changes engine", () => {
    const ids = [...pool(f.gb)];
    f.gb.syncRig(DEFAULT_RIG);
    for (const id of ids) expect(f.removed).toContain(id);
    expect(pool(f.gb)).toEqual([]);
  });

  it("degrades to a smaller pool near webdsp's instrument limit instead of failing", () => {
    const g = fake();
    const all: Rig = RIG.map(() => [chord, chord] as const);
    g.gb.syncRig(all);
    expect(g.created.length).toBeLessThanOrEqual(64);
    for (let t = 0; t < NUM_TRACKS; t++) for (const s of [0, 1] as const) expect((g.gb as any).pool[t][s].length).toBeGreaterThanOrEqual(1);
    expect((g.gb as any).pool[0][0]).toHaveLength(CHORD_INSTANCES); // the first slots still get the full pool
  });
});

describe("a chord in a host sequence", () => {
  it("is laid out with the same banks as the live engine", () => {
    const ids = idsWith(Array.from({ length: CHORD_INSTANCES }, (_, i) => 200 + i));
    const banks = new ChordBanks();
    const ctx = { ids, clamp: (_p: number, v: number) => v, sampleOf: () => undefined };
    const at = (time: number) => noteEvents({ track: TRACK, params: { time, pitch: 3, duration: 0.5 } }, RIG, typed("min7"), ctx, banks) as Array<{ instrument: number; durationBeats: number }>;
    const first = at(0);
    const second = at(1);
    expect(first.map((e) => e.instrument)).toEqual([200, 201, 202, 203]);
    expect(second.map((e) => e.instrument)).toEqual([205, 206, 207, 208]);
    expect(first.every((e) => e.durationBeats === 1)).toBe(true);
  });
});
