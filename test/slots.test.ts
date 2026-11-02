// The two-slot model: what a track note plays, what swapping an engine changes, and what survives a save.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setDistortion, setDrumVoice, setFilter, setSlotEngine, setSlotSample, setSlotTab, setSound, setSynthVoice } from "../src/engine/actions";
import { Groovebox } from "../src/engine/audio";
import { ChordBanks } from "../src/engine/chord";
import { defaultSlotSound, LEVEL_AT, normalizeRig, SAMPLE_CONTROLS, SLOT_KNOBS, SYNTH_VOICE_KEYS, trackProfile, voiceOf, type Rig } from "../src/engine/catalogue";
import { fromHostSnapshot, toHostSnapshot } from "../src/engine/persist";
import { FACTORY_SAMPLES, factoryPcm, wavBytes } from "../src/engine/samples";
import { playSlots } from "../src/engine/slots";
import { NUM_TRACKS } from "../src/engine/spec";
import { DEFAULT_RIG, initialState, newPattern } from "../src/engine/state";
import { getState, replaceState } from "../src/engine/store";

const sounds = (rig: Rig, t: number) => newPattern(rig).tracks[t].slots;
const tp = (t: number) => getState().patterns[getState().pattern].tracks[t];

beforeEach(() => replaceState(initialState()));

describe("what a track note plays", () => {
  it("fires both slots from one note: a drum voice and a sample", () => {
    const plays = playSlots(DEFAULT_RIG, 0, { time: 1, velocity: 0.7 }, sounds(DEFAULT_RIG, 0));
    expect(plays.map((p) => [p.slot, p.kind])).toEqual([[0, "instrument"], [1, "sample"]]);
    expect(plays[1]).toMatchObject({ sample: "sub-thump", time: 1, velocity: 0.7, pitch: 0, loop: false, start: 0, end: 1 });
  });

  it("layers two samples, and two instruments", () => {
    expect(playSlots(DEFAULT_RIG, 4, { time: 0, velocity: 1 }, sounds(DEFAULT_RIG, 4)).map((p) => p.kind === "sample" && p.sample)).toEqual(["rim", "shaker"]);
    expect(playSlots(DEFAULT_RIG, 7, { time: 0, velocity: 1, pitch: 3 }, sounds(DEFAULT_RIG, 7)).map((p) => p.kind)).toEqual(["instrument", "instrument"]);
  });

  it("gives a drum hit no pitch or held note, but a pitched engine the track's note", () => {
    const [drum] = playSlots(DEFAULT_RIG, 1, { time: 0, velocity: 1, pitch: 7, duration: 0.5 }, sounds(DEFAULT_RIG, 1));
    expect(drum).toMatchObject({ kind: "instrument", params: { velocity: 1 } });
    expect((drum as { params: object }).params).not.toHaveProperty("pitch");
    expect((drum as { params: object }).params).not.toHaveProperty("duration");
    const [acid] = playSlots(DEFAULT_RIG, 5, { time: 0, velocity: 1, pitch: 7, duration: 0.5, tie: true }, sounds(DEFAULT_RIG, 5));
    expect(acid).toMatchObject({ kind: "instrument", params: { pitch: 7, duration: 0.5, tie: true } });
  });

  it("keeps each engine on its own root: a note is the same note on an acid and an FM layered in one track", () => {
    const rig: Rig = DEFAULT_RIG.map((tr, t) => (t === 5 ? [{ engine: "synth", variant: "acid" }, { engine: "synth", variant: "fm" }] as const : tr));
    const [a, b] = playSlots(rig, 5, { time: 0, velocity: 1, pitch: 0 }, sounds(rig, 5));
    // acid's root is MIDI 33 (the track's), FM's is 45: the FM sounds the same MIDI note 12 semitones lower in its own terms
    expect((a as { params: { pitch: number } }).params.pitch).toBe(0);
    expect((b as { params: { pitch: number } }).params.pitch).toBe(-12);
  });

  it("transposes a sample with the notes of a melodic track, and leaves it alone on a drum track", () => {
    const melodic = playSlots(DEFAULT_RIG, 6, { time: 0, velocity: 1, pitch: 5 }, sounds(DEFAULT_RIG, 6))[1];
    expect(melodic).toMatchObject({ kind: "sample", pitch: 5 + 33 - 24 });
    const drum = playSlots(DEFAULT_RIG, 0, { time: 0, velocity: 1, pitch: 5 }, sounds(DEFAULT_RIG, 0))[1];
    expect(drum).toMatchObject({ kind: "sample", pitch: 0 });
  });

  it("reads the sample's window, loop and decay from the slot's knobs, and keeps the window ordered", () => {
    const s = sounds(DEFAULT_RIG, 0);
    s[1][SAMPLE_CONTROLS.mode] = 1;
    s[1][SAMPLE_CONTROLS.start] = 0.6;
    s[1][SAMPLE_CONTROLS.end] = 0.2; // behind the start: the window is never empty or reversed
    const p = playSlots(DEFAULT_RIG, 0, { time: 0, velocity: 1 }, s)[1];
    expect(p).toMatchObject({ kind: "sample", loop: true, start: 0.6 });
    expect((p as { end: number }).end).toBeGreaterThan(0.6);
    expect((p as { duration?: number }).duration).toBeGreaterThan(0); // a loop is released, never held for good
  });

  it("plays a one-shot out when DECAY is at FULL, and fades it otherwise", () => {
    const s = sounds(DEFAULT_RIG, 0);
    s[1][SAMPLE_CONTROLS.decay] = 1;
    expect(playSlots(DEFAULT_RIG, 0, { time: 0, velocity: 1 }, s)[1]).not.toHaveProperty("decay");
    s[1][SAMPLE_CONTROLS.decay] = 0.3;
    expect(playSlots(DEFAULT_RIG, 0, { time: 0, velocity: 1 }, s)[1]).toHaveProperty("decay");
  });

  it("plays nothing from an empty slot", () => {
    const rig: Rig = DEFAULT_RIG.map((tr, t) => (t === 2 ? [tr[0], { engine: "off", variant: "" }] as const : tr));
    expect(playSlots(rig, 2, { time: 0, velocity: 1 }, sounds(rig, 2))).toHaveLength(1);
  });
});

describe("changing an engine", () => {
  it("never touches the other slot, the other tracks, or the project's steps", () => {
    const before = structuredClone(getState().patterns[0]);
    setSlotEngine(5, 1, "synth");
    setSynthVoice(5, 1, "pad");
    const after = getState().patterns[0];
    expect(getState().rig[5][1]).toEqual({ engine: "synth", variant: "pad" });
    expect(getState().rig[5][0]).toEqual(DEFAULT_RIG[5][0]);
    expect(after.tracks[5].slots[0]).toEqual(before.tracks[5].slots[0]);
    expect(after.tracks[5].steps).toEqual(before.tracks[5].steps);
    for (let t = 0; t < NUM_TRACKS; t++) if (t !== 5) expect(after.tracks[t]).toEqual(before.tracks[t]);
    expect(getState().rig.filter((_, t) => t !== 5)).toEqual(DEFAULT_RIG.filter((_, t) => t !== 5));
  });

  it("resets that slot's knobs to the new engine's defaults in every pattern, and nowhere else", () => {
    setSound(5, 1, 0, 0.9);
    getState().patterns[3].tracks[5].slots[1][0] = 0.9; // a pattern that is not on screen
    setSlotEngine(5, 1, "synth");
    setSynthVoice(5, 1, "fm");
    const fm = defaultSlotSound(voiceOf({ engine: "synth", variant: "fm" }));
    for (const p of [0, 3, 10]) expect(getState().patterns[p].tracks[5].slots[1]).toEqual(fm);
  });

  it("drops the step locks of that slot only", () => {
    const steps = tp(5).steps;
    steps[2].parameterLocks = { "slot.a.0": 0.3, "slot.b.1": 0.4, "fx.delaySend": 0.5 };
    getState().patterns[0].tracks[5].steps = steps;
    setSlotEngine(5, 1, "perc");
    expect(tp(5).steps[2].parameterLocks).toEqual({ "slot.a.0": 0.3, "fx.delaySend": 0.5 });
  });

  it("follows the role: a drum track that gets a pitched engine becomes melodic and its steps take the engine's note", () => {
    expect(trackProfile(getState().rig, 2).melodic).toBe(false);
    setSlotEngine(2, 1, "synth");
    const profile = trackProfile(getState().rig, 2);
    expect(profile.melodic).toBe(true);
    expect(tp(2).steps.every((s) => s.note === profile.defaultNote)).toBe(true);
    setSlotEngine(2, 1, "off");
    expect(trackProfile(getState().rig, 2).melodic).toBe(false);
    expect(tp(2).steps.every((s) => s.note === 0)).toBe(true);
  });

  it("switches the arp off when the track stops being melodic", () => {
    getState().arp[5] = { ...getState().arp[5], on: true };
    setSlotEngine(5, 0, "drum");
    setSlotEngine(5, 1, "off");
    expect(trackProfile(getState().rig, 5).melodic).toBe(false);
    expect(getState().arp[5].on).toBe(false);
  });

  it("keeps a sample slot's mode, level and filter when its sample changes, but rewinds the window", () => {
    const s = tp(0).slots[1];
    s[SAMPLE_CONTROLS.mode] = 1;
    s[SAMPLE_CONTROLS.start] = 0.4;
    s[SAMPLE_CONTROLS.end] = 0.7;
    s[LEVEL_AT] = 0.33;
    setSlotSample(0, 1, "zap");
    expect(getState().rig[0][1]).toEqual({ engine: "sample", variant: "zap" });
    const after = tp(0).slots[1];
    expect([after[SAMPLE_CONTROLS.mode], after[SAMPLE_CONTROLS.start], after[SAMPLE_CONTROLS.end], after[LEVEL_AT]]).toEqual([1, 0, 1, 0.33]);
  });

  it("changes a drum voice with that voice's knobs, and ignores a voice that does not exist", () => {
    setDrumVoice(0, 0, "tom");
    expect(getState().rig[0][0]).toEqual({ engine: "drum", variant: "tom" });
    expect(tp(0).slots[0]).toEqual(defaultSlotSound(voiceOf({ engine: "drum", variant: "tom" })));
    setDrumVoice(0, 0, "banjo");
    expect(getState().rig[0][0].variant).toBe("tom");
  });

  it("allows two acid tracks, and the same sample on any number of tracks", () => {
    setSynthVoice(7, 0, "acid");
    expect(getState().rig.filter((tr) => tr.some((s) => s.variant === "acid")).length).toBe(3);
    setSlotSample(0, 1, "tick"); // already a SAMPLE slot: a new sample, not a new engine
    for (const t of [1, 2, 3]) setSlotEngine(t, 1, "sample", "tick");
    expect(getState().rig.filter((tr) => tr[1].engine === "sample" && tr[1].variant === "tick")).toHaveLength(4);
  });

  it("only ever changes the slot tab through setSlotTab", () => {
    setSlotTab(1);
    expect(getState().slot).toBe(1);
  });
});

describe("the INSERT FX follows the slots", () => {
  it("is distortion when a slot is a synth, and the LP/HP filter otherwise", () => {
    expect(DEFAULT_RIG.map((_, t) => trackProfile(DEFAULT_RIG, t).insert)).toEqual(["filter", "filter", "filter", "filter", "filter", "dist", "dist", "dist"]);
  });

  it("switches the insert off and its locks away when the track changes kind", () => {
    setFilter(0, { mode: 1, cut: 0.4, res: 0.5 });
    tp(0).steps[1].parameterLocks = { "fx.filterCut": 0.2, "fx.delaySend": 0.3 };
    setSlotEngine(0, 0, "synth");
    expect(trackProfile(getState().rig, 0).insert).toBe("dist");
    expect(tp(0).filter).toEqual({ mode: 0, cut: 1, res: 0 });
    expect(tp(0).steps[1].parameterLocks).toEqual({ "fx.delaySend": 0.3 });
    setDistortion(0, 0.7);
    tp(0).steps[2].parameterLocks = { "fx.distortion": 0.9 };
    setSlotEngine(0, 0, "drum");
    setSlotEngine(0, 1, "off");
    expect(tp(0).dist).toBe(0);
    expect(tp(0).steps[2].parameterLocks).toBeUndefined();
  });

  it("changing a filter mode puts the cutoff at that mode's open end", () => {
    setFilter(2, { mode: 1 });
    expect(tp(2).filter).toMatchObject({ mode: 1, cut: 0 });
    setFilter(2, { mode: 0 });
    expect(tp(2).filter.cut).toBe(1);
  });
});

describe("one-line names and the synth voices", () => {
  it("labels the rail with short names: CH and OH for the hats, SMPL for a sample", () => {
    expect(trackProfile(DEFAULT_RIG, 2).tag).toBe("CH");
    expect(trackProfile(DEFAULT_RIG, 3).tag).toBe("OH");
    expect(trackProfile(DEFAULT_RIG, 0).tag).toBe("KICK+SMPL");
    expect(trackProfile(DEFAULT_RIG, 4).tag).toBe("SMPL+SMPL");
    for (let t = 0; t < NUM_TRACKS; t++) expect(trackProfile(DEFAULT_RIG, t).tag).not.toMatch(/\s|SAMPLE|HAT/);
  });

  it("offers PLUCK and SAW as synth voices, and refuses an unknown voice from a save", () => {
    expect(SYNTH_VOICE_KEYS).toContain("pluck");
    expect(SYNTH_VOICE_KEYS).toContain("saw");
    expect(voiceOf({ engine: "synth", variant: "pluck" })?.kind).toBeDefined();
    expect(voiceOf({ engine: "synth", variant: "saw" })?.kind).toBeDefined();
    expect(normalizeRig([[{ engine: "pluck", variant: "" }, { engine: "synth", variant: "saw" }]], DEFAULT_RIG, NUM_TRACKS)[0]).toEqual([{ engine: "synth", variant: "pluck" }, { engine: "synth", variant: "saw" }]);
    expect(normalizeRig([[{ engine: "synth", variant: "x" }, { engine: "synth", variant: "" }]], DEFAULT_RIG, NUM_TRACKS)[0]).toEqual([{ engine: "synth", variant: "acid" }, { engine: "synth", variant: "acid" }]);
  });

  it("loads a save from before SYNTH, where the synth was the engine", () => {
    const old = [[{ engine: "acid", variant: "" }, { engine: "fm", variant: "" }]];
    expect(normalizeRig(old, DEFAULT_RIG, NUM_TRACKS)[0]).toEqual([{ engine: "synth", variant: "acid" }, { engine: "synth", variant: "fm" }]);
  });
});

describe("the graph follows the rig", () => {
  /** A Groovebox with a fake runtime that records instrument creation and removal. */
  function fake() {
    const created: Array<{ id: number; kind: number; bus: number }> = [];
    const removed: number[] = [];
    const offs: number[] = [];
    const released: number[] = [];
    let next = 1;
    const gb = Object.create(Groovebox.prototype) as any;
    gb.runtime = {
      createInstrument: vi.fn((kind: number, o: { bus: number }) => { const id = next++; created.push({ id, kind, bus: o.bus }); return id; }),
      removeInstrument: vi.fn((id: number) => removed.push(id)),
      instrumentNoteOff: vi.fn((id: number) => offs.push(id)),
      setInstrumentParameter: vi.fn(),
      release: vi.fn((v: number) => released.push(v)),
      cancelScheduled: vi.fn(),
    };
    gb.inst = Array.from({ length: NUM_TRACKS }, () => [undefined, undefined]);
    gb.pool = Array.from({ length: NUM_TRACKS }, () => [[], []]);
    gb.chordBanks = new ChordBanks();
    gb.slotBus = Array.from({ length: NUM_TRACKS }, (_, t) => [1000 + t * 2, 1001 + t * 2]);
    gb.applied = Array.from({ length: NUM_TRACKS }, () => ["", ""]);
    gb.soundCache = new Map();
    gb.lockedParams = Array.from({ length: NUM_TRACKS }, () => new Map());
    gb.lockedKeys = new Set();
    gb.busCache = new Map();
    gb.fxCache = new Map();
    gb.samples = new Map();
    gb.loading = new Map();
    gb.loops = new Map();
    gb.lastSample = new Map();
    gb.lfoParams = Array.from({ length: NUM_TRACKS }, () => new Map());
    gb.lfoKeys = new Set();
    gb.ensureSample = vi.fn(() => Promise.resolve());
    return { gb: gb as Groovebox, created, removed, offs, released };
  }

  it("builds one instrument per instrument slot, on that slot's bus, and none for samples or empty slots", () => {
    const { gb, created } = fake();
    gb.syncRig(DEFAULT_RIG);
    // kick+sample, snare+clap, chat, ohat, sample+sample, acid, acid+sample, pluck+pad
    expect(created).toHaveLength(1 + 2 + 1 + 1 + 0 + 1 + 1 + 2);
    expect(new Set(created.map((c) => c.bus)).size).toBe(created.length); // every instrument on its own slot bus
  });

  it("swapping one slot removes exactly that instrument and builds the new one, leaving every other alone", () => {
    const { gb, created, removed } = fake();
    gb.syncRig(DEFAULT_RIG);
    const all = (gb as any).inst.map((p: unknown[]) => [...p]);
    created.length = 0;
    const rig: Rig = DEFAULT_RIG.map((tr, t) => (t === 7 ? [tr[0], { engine: "synth", variant: "saw" }] as const : tr));
    gb.syncRig(rig);
    expect(removed).toEqual([all[7][1]]);
    expect(created).toHaveLength(1);
    expect(created[0].bus).toBe(1000 + 7 * 2 + 1);
    expect((gb as any).inst[7][0]).toBe(all[7][0]); // slot A of the same track: the same instrument
    for (let t = 0; t < NUM_TRACKS; t++) if (t !== 7) expect((gb as any).inst[t]).toEqual(all[t]);
  });

  it("does nothing when the rig has not changed, and builds nothing for a sample", () => {
    const { gb, created, removed } = fake();
    gb.syncRig(DEFAULT_RIG);
    created.length = 0;
    gb.syncRig(DEFAULT_RIG);
    const sampleOnly: Rig = DEFAULT_RIG.map((tr, t) => (t === 0 ? [tr[0], { engine: "sample", variant: "zap" }] as const : tr));
    gb.syncRig(sampleOnly); // slot B of track 1 was a sample and is another sample: nothing to build or remove
    expect(created).toHaveLength(0);
    expect(removed).toHaveLength(0);
    expect((gb as any).ensureSample).toHaveBeenCalledWith("zap");
  });

  it("emptying a slot removes its instrument and releases its looping sample voices", () => {
    const { gb, removed } = fake();
    gb.syncRig(DEFAULT_RIG);
    const id = (gb as any).inst[7][1];
    (gb as any).loops.set("7:1", new Set([41, 42]));
    gb.syncRig(DEFAULT_RIG.map((tr, t) => (t === 7 ? [tr[0], { engine: "off", variant: "" }] as const : tr)));
    expect(removed).toEqual([id]);
    expect((gb as any).inst[7][1]).toBeUndefined();
    expect(((gb as any).runtime.release as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).sort()).toEqual([41, 42]);
  });

  it("silence() releases both slots of every track and every looping voice", () => {
    const { gb, offs, released } = fake();
    gb.syncRig(DEFAULT_RIG);
    (gb as any).loops.set("0:1", new Set([7]));
    (gb as any).loops.set("4:0", new Set([8]));
    gb.silence();
    const inst = (gb as any).inst.flat().filter((x: unknown) => x !== undefined);
    expect(offs.sort()).toEqual([...inst].sort());
    expect(released.sort()).toEqual([7, 8]);
  });
});

describe("saving", () => {
  it("round-trips the rig and the slot knobs", () => {
    setSlotEngine(2, 1, "sample", "noise-burst");
    setSound(2, 1, 1, 0.42);
    const back = fromHostSnapshot(toHostSnapshot())!;
    expect(back.rig[2][1]).toEqual({ engine: "sample", variant: "noise-burst" });
    expect(back.patterns[0].tracks[2].slots[1][1]).toBe(0.42);
  });

  it("repairs a hand-edited rig slot by slot instead of rejecting the project", () => {
    const rig = normalizeRig([[{ engine: "banjo", variant: "x" }, { engine: "drum", variant: "kazoo" }], null], DEFAULT_RIG, NUM_TRACKS);
    expect(rig).toHaveLength(NUM_TRACKS);
    expect(rig[0][0]).toEqual(DEFAULT_RIG[0][0]); // unknown engine: the starting slot
    expect(rig[0][1]).toEqual({ engine: "drum", variant: "kick" }); // unknown drum voice: the first
    expect(rig[1]).toEqual(DEFAULT_RIG[1]);
  });

  it("rejects a pattern whose slot arrays are the wrong shape", () => {
    const bad = JSON.parse(toHostSnapshot().data);
    bad.project.patterns[0].tracks[0].slots[0] = [0.5];
    expect(fromHostSnapshot({ ...toHostSnapshot(), data: JSON.stringify(bad) })).toBeNull();
    const ok = JSON.parse(toHostSnapshot().data);
    expect(ok.project.patterns[0].tracks[0].slots[0]).toHaveLength(SLOT_KNOBS);
  });
});

describe("the factory samples", () => {
  it("are all distinct, audible, finite and the same every time", () => {
    for (const s of FACTORY_SAMPLES) {
      const a = factoryPcm(s.id)!;
      expect(a.length).toBeGreaterThan(1000);
      expect(a.every(Number.isFinite)).toBe(true);
      expect(Math.max(...a.map(Math.abs))).toBeGreaterThan(0.5);
      expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(1);
      expect(factoryPcm(s.id)).toEqual(a);
    }
    expect(new Set(FACTORY_SAMPLES.map((s) => s.id)).size).toBe(FACTORY_SAMPLES.length);
  });

  it("encode as a valid 16-bit mono WAV", () => {
    const pcm = factoryPcm("rim")!;
    const wav = new DataView(wavBytes(pcm));
    expect(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3))).toBe("RIFF");
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(pcm.length * 2);
    expect(wav.byteLength).toBe(44 + pcm.length * 2);
  });

  it("are what the starting rig points at", () => {
    const ids = new Set(FACTORY_SAMPLES.map((s) => s.id));
    for (const tr of DEFAULT_RIG) for (const sl of tr) if (sl.engine === "sample") expect(ids.has(sl.variant)).toBe(true);
  });
});
