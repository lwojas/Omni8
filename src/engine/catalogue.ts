// The engine catalogue and the two-slot model. Every track holds two slots; each slot holds one engine (or nothing). This is
// the only place that knows which webdsp instrument backs an engine and which of its parameters are exposed, over what
// sweet-spot range. Four engines plus OFF; SYNTH, DRUM and SAMPLE each have a second selector for the voice they play, so
// adding a voice never adds a chip (see docs/dev/hybrid8-plan.md).
//
// The rig (which engine is in which slot) is project data, not pattern data: swapping an engine creates and removes DSP nodes,
// which must not happen at a pattern boundary mid-song. A pattern stores only each slot's knob values (`TrackPattern.slots`).
import {
  BassParam, ClapParam, EdgeParam, FmParam, HiHatParam, HypersawParam, InstrumentKind, KickParam, PadParam, PercSynthParam,
  SnareParam, TomParam,
} from "webdsp";
import { exp, FM_COLORS, lin, pow, unitsToNorm, type ControlSpec, type Role } from "./spec";

export type EngineId = "off" | "synth" | "drum" | "perc" | "sample";

/** One slot of a track. `variant` is the synth voice for SYNTH, the drum voice for DRUM, the shared sample's library id for SAMPLE, otherwise "". */
export interface SlotRig {
  engine: EngineId;
  variant: string;
}
export type TrackRig = readonly [SlotRig, SlotRig];
export type Rig = readonly TrackRig[];

/** The knob values of one slot in a pattern: `ENGINE_KNOBS` engine controls (unused ones 0), then LEVEL. */
export const ENGINE_KNOBS = 6;
export const LEVEL_AT = ENGINE_KNOBS;
export const SLOT_KNOBS = ENGINE_KNOBS + 1;
export const SLOT_NAMES = ["A", "B"] as const;

/** Everything about one sound source: what a slot resolves to. */
export interface VoiceSpec {
  key: string;
  engine: Exclude<EngineId, "off">;
  name: string;
  short: string;
  /** The rail's one-line label for this voice when it differs from `name` ("SMPL" for SAMPLE). */
  tag?: string;
  /** Short description of the machine under the hood, shown in the sound panel. */
  desc: string;
  /** The webdsp instrument; absent for a sample (a shared sample voice, not an instrument). */
  kind?: InstrumentKind;
  /** Plays the step's note (piano roll, arp, note range); otherwise a fixed-pitch hit. */
  pitched: boolean;
  accent: "--drum" | "--bass" | "--tone" | "--synth";
  /** The engine's own knobs, at most `ENGINE_KNOBS`. */
  controls: readonly ControlSpec[];
  /** Engine parameters pinned to fixed values (not exposed). */
  fixed: ReadonlyArray<readonly [param: number, value: number]>;
  /** Source gain trim in dB, for level balance between machines. */
  gainDb: number;
  chokeGroup?: number;
  /** Pitched voices: MIDI note of the instrument's `tune` (note pitch = note - rootMidi), playable range and a new step's note. */
  rootMidi?: number;
  noteLo?: number;
  noteHi?: number;
  defaultNote?: number;
}

const LEVEL: ControlSpec = { key: "level", label: "LEVEL", param: -1, dest: "level", lo: 0, hi: 1, curve: "lin", unit: "%", def: 0.8 };

const voice = (v: Omit<VoiceSpec, "fixed" | "pitched"> & Partial<Pick<VoiceSpec, "fixed" | "pitched">>): VoiceSpec => ({
  fixed: [], pitched: false, ...v,
});

// --- drum voices: the six Hybrid.8 machines, unchanged controls --------------------------------------

export const DRUM_VOICES: Readonly<Record<string, VoiceSpec>> = {
  kick: voice({
    key: "drum:kick", engine: "drum", name: "KICK", short: "KCK", desc: "SWEEP KICK", kind: InstrumentKind.Kick, accent: "--drum", gainDb: 0,
    controls: [
      exp("tune", "TUNE", KickParam.Tune, 35, 80, 50, "Hz"),
      lin("sweep", "SWEEP", KickParam.PitchDrop, 0.4, 3.6, 2.5, "oct"),
      exp("decay", "DECAY", KickParam.Decay, 0.12, 1.1, 0.45, "s"),
      lin("punch", "PUNCH", KickParam.Punch, 0, 1, 0.5),
      lin("drive", "DRIVE", KickParam.Drive, 0, 1, 0.3),
    ],
  }),
  snare: voice({
    key: "drum:snare", engine: "drum", name: "SNARE", short: "SNR", desc: "TWO-MODE SNARE", kind: InstrumentKind.Snare, accent: "--drum", gainDb: -1,
    controls: [
      exp("tune", "TUNE", SnareParam.Tune, 140, 300, 185, "Hz"),
      exp("decay", "DECAY", SnareParam.Decay, 0.08, 0.5, 0.22, "s"),
      lin("snap", "SNAP", SnareParam.Snap, 0, 1, 0.5),
      lin("noise", "RATTLE", SnareParam.Noise, 0.15, 1, 0.6),
    ],
  }),
  clap: voice({
    key: "drum:clap", engine: "drum", name: "CLAP", short: "CLP", desc: "BURST CLAP", kind: InstrumentKind.Clap, accent: "--drum", gainDb: -2,
    controls: [
      exp("tune", "TUNE", ClapParam.Tune, 800, 2400, 1300, "Hz"),
      exp("decay", "DECAY", ClapParam.Decay, 0.1, 0.6, 0.25, "s"),
      lin("spread", "SPREAD", ClapParam.Spread, 0, 1, 0.5),
      lin("snap", "SNAP", ClapParam.Snap, 0, 1, 0.5),
    ],
  }),
  chat: voice({
    key: "drum:chat", engine: "drum", name: "C.HAT", tag: "CH", short: "CH", desc: "METAL HAT · CLOSED", kind: InstrumentKind.HiHat, accent: "--drum", gainDb: -5, chokeGroup: 1,
    controls: [
      lin("tune", "PITCH", HiHatParam.Tune, -6, 6, 0, "st"),
      exp("decay", "DECAY", HiHatParam.Decay, 0.02, 0.18, 0.06, "s"),
      lin("metal", "METAL", HiHatParam.Metal, 0, 1, 0.7),
      lin("tone", "BRIGHT", HiHatParam.Tone, 0, 1, 0.55),
    ],
  }),
  ohat: voice({
    key: "drum:ohat", engine: "drum", name: "O.HAT", tag: "OH", short: "OH", desc: "METAL HAT · OPEN", kind: InstrumentKind.HiHat, accent: "--drum", gainDb: -5, chokeGroup: 1,
    controls: [
      lin("tune", "PITCH", HiHatParam.Tune, -6, 6, 0, "st"),
      exp("decay", "DECAY", HiHatParam.Decay, 0.2, 1.1, 0.45, "s"),
      lin("metal", "METAL", HiHatParam.Metal, 0, 1, 0.7),
      lin("tone", "BRIGHT", HiHatParam.Tone, 0, 1, 0.5),
    ],
  }),
  tom: voice({
    key: "drum:tom", engine: "drum", name: "TOM", short: "TOM", desc: "TUNED TOM", kind: InstrumentKind.Tom, accent: "--drum", gainDb: -2,
    controls: [
      exp("tune", "TUNE", TomParam.Tune, 80, 360, 120, "Hz"),
      lin("drop", "SWEEP", TomParam.PitchDrop, 0, 1.6, 0.6, "oct"),
      exp("decay", "DECAY", TomParam.Decay, 0.12, 0.9, 0.45, "s"),
      lin("body", "BODY", TomParam.Body, 0, 1, 0.5),
      lin("damp", "DAMP", TomParam.Damp, 0, 1, 0.3),
    ],
  }),
};
/** The drum voices in selector order. */
export const DRUM_VOICE_KEYS = ["kick", "snare", "clap", "chat", "ohat", "tom"] as const;

// --- the other engines ---------------------------------------------------------------------------------

const ACID: VoiceSpec = voice({
  key: "acid", engine: "synth", name: "ACID", short: "ACD", desc: "ACID BASS", kind: InstrumentKind.Bass, accent: "--synth", pitched: true,
  controls: [
    // Ranges set from offline renders of the unchanged webdsp bass: above ~1 kHz the filter adds nothing at bass pitches, ENV MOD
    // saturates by ~0.5 on low notes, BITE past ~0.75 trades onset brightness and body level for onset loudness, DECAY below
    // 0.1 s is shorter than needed.
    exp("cutoff", "FILTER", BassParam.Cutoff, 90, 1000, 250, "Hz"),
    pow("envmod", "ENV MOD", BassParam.EnvMod, 0, 1, 0.6, 1.7),
    exp("decay", "DECAY", BassParam.Decay, 0.06, 1.1, 0.3, "s"),
    lin("reso", "RES", BassParam.Resonance, 0.1, 0.95, 0.65),
    lin("bite", "BITE", BassParam.Bite, 0, 1, 0.5),
    lin("wave", "WAVE", BassParam.Body, 0, 1, 0.55),
  ],
  // The filter envelope shape is fixed inside webdsp (instant attack, exponential fall); the amp envelope is held up so notes
  // stay full and the filter does the plucking.
  fixed: [
    [BassParam.Tune, 55], [BassParam.Attack, 0.001], [BassParam.Sustain, 0.55],
    [BassParam.Release, 0.06], [BassParam.Legato, 0], [BassParam.Slide, 0.08],
  ],
  gainDb: -3, rootMidi: 33, noteLo: 24, noteHi: 59, defaultNote: 24,
});

const FM: VoiceSpec = voice({
  key: "fm", engine: "synth", name: "FM", short: "FM", desc: "TWO-OP FM", kind: InstrumentKind.Fm, accent: "--synth", pitched: true,
  controls: [
    { key: "color", label: "COLOR", param: FmParam.Ratio, lo: 0, hi: FM_COLORS.length - 1, curve: "lin", unit: "", def: 1, steps: FM_COLORS },
    lin("depth", "DEPTH", FmParam.Timbre, 0.05, 0.9, 0.35),
    lin("bite", "BITE", FmParam.Snap, 0, 1, 0.6),
    lin("tone", "TONE", FmParam.Tone, 0.15, 1, 0.75),
    exp("decay", "DECAY", FmParam.Decay, 0.06, 1.2, 0.3, "s"),
  ],
  fixed: [
    [FmParam.Tune, 110], [FmParam.Attack, 0.004], [FmParam.Sustain, 0.5],
    [FmParam.Release, 0.12], [FmParam.Legato, 0], [FmParam.Slide, 0.06],
  ],
  gainDb: -5, rootMidi: 45, noteLo: 36, noteHi: 71, defaultNote: 48,
});

const PAD: VoiceSpec = voice({
  key: "pad", engine: "synth", name: "PAD", short: "PAD", desc: "ENSEMBLE PAD", kind: InstrumentKind.Pad, accent: "--tone", pitched: true,
  controls: [
    lin("tone", "TONE", PadParam.Tone, 0.1, 1, 0.55),
    lin("move", "MOVE", PadParam.Movement, 0, 1, 0.5),
    lin("thick", "THICK", PadParam.Detune, 0, 1, 0.5),
    lin("space", "SPACE", PadParam.Space, 0, 1, 0.6),
    exp("attack", "ATTACK", PadParam.Attack, 0.01, 2, 0.25, "s"),
    exp("release", "RELEASE", PadParam.Release, 0.1, 3, 0.9, "s"),
  ],
  fixed: [[PadParam.Tune, 110]],
  gainDb: -7, rootMidi: 45, noteLo: 36, noteHi: 71, defaultNote: 48,
});

const PLUCK: VoiceSpec = voice({
  key: "pluck", engine: "synth", name: "PLUCK", short: "PLK", desc: "EDGE PLUCK", kind: InstrumentKind.Edge, accent: "--tone", pitched: true,
  controls: [
    lin("shape", "SHAPE", EdgeParam.Shape, 0, 1, 0.3),
    lin("bright", "BRIGHT", EdgeParam.Bright, 0.2, 1, 0.7),
    exp("cutoff", "CUTOFF", EdgeParam.Cutoff, 250, 6000, 1800, "Hz"),
    lin("reso", "RES", EdgeParam.Resonance, 0.05, 0.8, 0.3),
    lin("snap", "SNAP", EdgeParam.FilterEnv, 0, 1, 0.6),
    exp("decay", "DECAY", EdgeParam.Decay, 0.08, 1, 0.25, "s"),
  ],
  fixed: [
    [EdgeParam.Tune, 110], [EdgeParam.Attack, 0.002], [EdgeParam.Sustain, 0], [EdgeParam.Release, 0.08],
    [EdgeParam.ToneDecay, 0.2], [EdgeParam.Routing, 0], [EdgeParam.FilterA, 0], [EdgeParam.Detune, 8],
  ],
  gainDb: -6, rootMidi: 45, noteLo: 36, noteHi: 71, defaultNote: 48,
});

const SAW: VoiceSpec = voice({
  key: "saw", engine: "synth", name: "SAW", short: "SAW", desc: "HYPER SAW STACK", kind: InstrumentKind.Hypersaw, accent: "--tone", pitched: true,
  controls: [
    lin("detune", "DETUNE", HypersawParam.Detune, 2, 60, 18, "%"),
    lin("spread", "SPREAD", HypersawParam.Spread, 0, 1, 0.7),
    lin("density", "DENSITY", HypersawParam.Density, 0, 1, 0.8),
    exp("cutoff", "CUTOFF", HypersawParam.Cutoff, 400, 9000, 3500, "Hz"),
    exp("decay", "DECAY", HypersawParam.Decay, 0.1, 1.5, 0.4, "s"),
  ],
  fixed: [[HypersawParam.Tune, 110], [HypersawParam.Attack, 0.005], [HypersawParam.Sustain, 0.5], [HypersawParam.Release, 0.15]],
  gainDb: -8, rootMidi: 45, noteLo: 36, noteHi: 71, defaultNote: 48,
});

const PERC: VoiceSpec = voice({
  key: "perc", engine: "perc", name: "PERC", short: "PRC", desc: "PERCUSSION SYNTH", kind: InstrumentKind.PercSynth, accent: "--drum",
  controls: [
    exp("tune", "TUNE", PercSynthParam.Tune, 60, 800, 180, "Hz"),
    lin("sweep", "SWEEP", PercSynthParam.PitchEnv, 0, 4, 1.5, "oct"),
    exp("decay", "DECAY", PercSynthParam.Decay, 0.05, 1, 0.25, "s"),
    lin("noise", "NOISE", PercSynthParam.Noise, 0, 1, 0.2),
    lin("fm", "FM", PercSynthParam.Osc2Fm, 0, 1, 0.3),
    lin("drive", "DRIVE", PercSynthParam.Drive, 0, 1, 0.2),
  ],
  fixed: [
    [PercSynthParam.Osc1Wave, 0], [PercSynthParam.Osc1Level, 0.8], [PercSynthParam.Osc2Wave, 0], [PercSynthParam.Osc2Pitch, 7],
    [PercSynthParam.Osc2Level, 0.3], [PercSynthParam.PitchDecay, 0.06], [PercSynthParam.Osc2Env, 1], [PercSynthParam.NoiseTone, 0.5],
    [PercSynthParam.NoiseDecay, 0.1], [PercSynthParam.FilterType, 0], [PercSynthParam.Cutoff, 9000], [PercSynthParam.Resonance, 0.2],
    [PercSynthParam.FilterEnv, 0], [PercSynthParam.Attack, 0.001], [PercSynthParam.Sustain, 0], [PercSynthParam.Release, 0.05],
  ],
  gainDb: -4,
});

/** The sample voice: the sample itself is the slot's `variant` (a shared library id), never a copy. Its knobs are read when a note
 * triggers (see slots.ts), so they are `dest: "sample"`. */
export const SAMPLE_CONTROLS = {
  mode: 0,
  start: 1,
  end: 2,
  decay: 3,
} as const;
export const SAMPLE_MODES = ["ONE-SHOT", "LOOP"] as const;
const SAMPLE: VoiceSpec = voice({
  key: "sample", engine: "sample", name: "SAMPLE", tag: "SMPL", short: "SMP", desc: "SHARED SAMPLE", accent: "--drum", gainDb: 0,
  controls: [
    { key: "mode", label: "PLAY", param: -1, dest: "sample", lo: 0, hi: 1, curve: "lin", unit: "", def: 0, steps: SAMPLE_MODES },
    { key: "start", label: "START", param: -1, dest: "sample", lo: 0, hi: 1, curve: "lin", unit: "%", def: 0 },
    { key: "end", label: "END", param: -1, dest: "sample", lo: 0, hi: 1, curve: "lin", unit: "%", def: 1 },
    { key: "decay", label: "DECAY", param: -1, dest: "sample", lo: 0.03, hi: 4, curve: "exp", unit: "s", def: 0.45, top: "FULL" },
  ],
});

/** The synth voices, behind the one SYNTH engine name (a new synth is a row here and a key in `SYNTH_VOICE_KEYS`). */
export const SYNTH_VOICES: Readonly<Record<string, VoiceSpec>> = { acid: ACID, fm: FM, pad: PAD, pluck: PLUCK, saw: SAW };
/** The synth voices offered, in selector order. */
export const SYNTH_VOICE_KEYS = ["acid", "fm", "pad", "pluck", "saw"] as const;

const SINGLE: Readonly<Record<string, VoiceSpec>> = { perc: PERC, sample: SAMPLE };

/** The engine names, in selector order (the chips under the slot tabs). OFF is the last: an empty slot. SYNTH, DRUM and SAMPLE each
 * have a second selector (the dashed chip) for the voice or sample they play, so a new voice never adds a chip here. */
export const ENGINES: ReadonlyArray<{ id: EngineId; name: string }> = [
  { id: "synth", name: "SYNTH" }, { id: "drum", name: "DRUM" }, { id: "perc", name: "PERC" }, { id: "sample", name: "SAMPLE" },
  { id: "off", name: "OFF" },
];

/** What a slot plays, or undefined for an empty slot. */
export function voiceOf(slot: SlotRig): VoiceSpec | undefined {
  if (slot.engine === "off") return undefined;
  if (slot.engine === "drum") return DRUM_VOICES[slot.variant] ?? DRUM_VOICES.kick;
  if (slot.engine === "synth") return SYNTH_VOICES[slot.variant] ?? SYNTH_VOICES.acid;
  return SINGLE[slot.engine];
}

/** The variant a slot gets when its engine is chosen. `sample` is the library id a new SAMPLE slot starts on. */
export const defaultVariant = (engine: EngineId, sample: string): string => (engine === "drum" ? "kick" : engine === "synth" ? "acid" : engine === "sample" ? sample : "");

/** Every control a slot shows, in knob order: the engine's own, then LEVEL. The index of a control is its index in the slot's sound
 * array, except LEVEL, which lives at `LEVEL_AT`. (The filter and distortion are track inserts, not slot knobs.) */
export function slotControls(v: VoiceSpec): Array<{ control: ControlSpec; at: number }> {
  const out = v.controls.map((control, at) => ({ control, at }));
  out.push({ control: LEVEL, at: LEVEL_AT });
  return out;
}

/** The control at sound index `at` of a slot, if the voice has one there. */
export function controlAt(v: VoiceSpec | undefined, at: number): ControlSpec | undefined {
  if (!v) return undefined;
  return at === LEVEL_AT ? LEVEL : v.controls[at];
}

/** A slot's knob values at the engine's defaults (unused positions 0). */
export function defaultSlotSound(v: VoiceSpec | undefined): number[] {
  const out = new Array<number>(SLOT_KNOBS).fill(0);
  if (!v) return out;
  v.controls.forEach((c, i) => { out[i] = unitsToNorm(c, c.def); });
  out[LEVEL_AT] = unitsToNorm(LEVEL, LEVEL.def);
  return out;
}

// --- what a track is, given what is in it ----------------------------------------------------------------

const OFF: SlotRig = { engine: "off", variant: "" };
export const emptySlot = (): SlotRig => ({ ...OFF });

/** A track's behaviour, derived from its slots (nothing is stored): a track is melodic when either slot is a pitched engine. */
export interface TrackProfile {
  role: Role;
  melodic: boolean;
  /** The track's INSERT FX: distortion when a slot is a synth (a pitched engine), otherwise the LP/HP filter. */
  insert: "dist" | "filter";
  accent: "--drum" | "--bass" | "--tone" | "--synth";
  /** "KICK + SAMPLE", or "EMPTY". */
  name: string;
  /** The first slot's short name, and both slots' names with no spaces ("KICK+SMPL"): the one-line label of the track rail. */
  short: string;
  tag: string;
  /** The machine description of the first slot (or "EMPTY"). */
  desc: string;
  voices: readonly [VoiceSpec | undefined, VoiceSpec | undefined];
  /** The pitched voice that sets the note range: the first pitched slot. */
  lead?: VoiceSpec;
  rootMidi: number;
  noteLo: number;
  noteHi: number;
  defaultNote: number;
}

const profiles = new WeakMap<TrackRig, TrackProfile>();

export function trackProfile(rig: Rig, track: number): TrackProfile {
  const tr = rig[track];
  let p = profiles.get(tr);
  if (!p) {
    const voices = [voiceOf(tr[0]), voiceOf(tr[1])] as const;
    const lead = voices.find((v) => v?.pitched);
    const first = voices.find((v) => v);
    p = {
      role: !lead ? "drum" : lead.key === "acid" ? "bass" : "tone",
      melodic: !!lead,
      insert: lead ? "dist" : "filter",
      accent: (lead ?? first)?.accent ?? "--drum",
      name: voices.filter((v): v is VoiceSpec => !!v).map((v) => v.name).join(" + ") || "EMPTY",
      short: first?.short ?? "---",
      tag: voices.filter((v): v is VoiceSpec => !!v).map((v) => v.tag ?? v.name).join("+") || "---",
      desc: first?.desc ?? "EMPTY",
      voices,
      lead,
      rootMidi: lead?.rootMidi ?? 0,
      noteLo: lead?.noteLo ?? 0,
      noteHi: lead?.noteHi ?? 0,
      defaultNote: lead?.defaultNote ?? 0,
    };
    profiles.set(tr, p);
  }
  return p;
}

/** The starting rig: two acid tracks, a layered drum kit, a sample-on-sample percussion track and a pluck-over-pad keys track. */
export function defaultRig(sample: { thump: string; snap: string; rim: string; shaker: string }): Rig {
  const s = (engine: EngineId, variant = ""): SlotRig => ({ engine, variant });
  return [
    [s("drum", "kick"), s("sample", sample.thump)],
    [s("drum", "snare"), s("drum", "clap")],
    [s("drum", "chat"), emptySlot()],
    [s("drum", "ohat"), emptySlot()],
    [s("sample", sample.rim), s("sample", sample.shaker)],
    [s("synth", "acid"), emptySlot()],
    [s("synth", "acid"), s("sample", sample.snap)],
    [s("synth", "fm"), s("synth", "pad")],
  ];
}

// --- from a save ---------------------------------------------------------------------------------------

const ENGINE_IDS = new Set<string>(ENGINES.map((e) => e.id));

/** A slot from a save, cleaned: a known engine, and a variant that means something for it (else the slot's fallback). */
function normalizeSlot(raw: unknown, fallback: SlotRig): SlotRig {
  const x = raw as Partial<SlotRig> | null | undefined;
  if (!x || typeof x.engine !== "string") return fallback;
  // saves from before SYNTH named the synth as the engine
  if ((SYNTH_VOICE_KEYS as readonly string[]).includes(x.engine)) return { engine: "synth", variant: x.engine };
  if (!ENGINE_IDS.has(x.engine)) return fallback;
  const engine = x.engine as EngineId;
  const variant = typeof x.variant === "string" ? x.variant.slice(0, 40) : "";
  if (engine === "synth") return { engine, variant: (SYNTH_VOICE_KEYS as readonly string[]).includes(variant) ? variant : "acid" };
  if (engine === "drum") return { engine, variant: (DRUM_VOICE_KEYS as readonly string[]).includes(variant) ? variant : "kick" };
  if (engine === "sample") return { engine, variant: variant || (fallback.engine === "sample" ? fallback.variant : "") };
  return { engine, variant: "" };
}

/** A rig from a save: eight tracks of two clean slots; anything unusable falls back to the starting rig for that slot. */
export function normalizeRig(raw: unknown, fallback: Rig, tracks: number): Rig {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: tracks }, (_, t) => {
    const tr = list[t] as unknown[] | undefined;
    return [normalizeSlot(tr?.[0], fallback[t][0]), normalizeSlot(tr?.[1], fallback[t][1])] as const;
  });
}

/** Every voice an engine can play (the drum voices count separately): what tests and tools iterate. */
export const ALL_VOICES: readonly VoiceSpec[] = [...Object.values(DRUM_VOICES), ...Object.values(SYNTH_VOICES), ...Object.values(SINGLE)];
