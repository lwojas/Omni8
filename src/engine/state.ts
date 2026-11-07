// The whole application state, and the pure functions that edit a pattern.
// Nothing here touches audio or React.
import { storageKey } from "../product";
import { NUM_TRACKS, TRACKS } from "./spec";
import { defaultRig, defaultSlotSound, trackProfile, type Rig } from "./catalogue";
import { DEFAULT_SAMPLES, FACTORY_SAMPLES, type SampleInfo } from "./samples";
import { defaultArp, type ArpSettings } from "./arp";
import { defaultMangler } from "./mangler";
import { defaultScale, isChromatic, notesInRange, rootAtOrAbove, type ProjectScale } from "./scale";
import { newLfos, type Lfo } from "./lfo";
import type { Sidechain } from "./sidechain";
import { newDelay, newDist, newFilter, newReverb, type DelaySend, type ReverbSend, type TrackFilter } from "./trackfx";

export const MAX_STEPS = 64;
export const PAGE = 16;
export const NUM_PATTERNS = 64;
/** The desktop pattern bar shows one bank of this many patterns at a time. */
export const BANK_SIZE = 16;
/** Entries in the chain. */
export const MAX_CHAIN = 64;
/** A chain entry plays its pattern this many times at most, and the chain's entries together this many passes (the host's sequence holds every pass). */
export const MAX_REPEATS = 99;
export const MAX_PASSES = 256;
export const MAX_LABEL = 16;

/** One instruction of the chain: play `pattern` `repeats` times, then move on. */
export interface ChainEntry {
  pattern: number;
  repeats: number;
  /** What the entry is called in the chain ("Intro"); the same pattern can carry a different one in each entry. */
  label?: string;
}
export const LENGTHS = [16, 32, 48, 64] as const;

export interface Step {
  on: boolean;
  /** MIDI note (melodic tracks only). */
  note: number;
  /** Accent: harder hit; on the bass it also opens the filter via velocity-driven bite. */
  acc: boolean;
  /** Slide: glide into this note from the previous one (melodic tracks only). */
  slide: boolean;
  /** Gate length: index into `GATES` (melodic tracks only). Absent in saves from before it existed. */
  gate?: number;
  /** Parameter locks: per-step overrides of the track's base sound, by parameter id (see plock.ts) to a normalised 0..1 value.
   * Holds only deviations; absent (the usual case, and in saves from before locks) means the step plays the base sound. */
  parameterLocks?: Record<string, number>;
}

/** Selectable note lengths in steps. Saved steps store an index, so new entries are only ever appended.
 * Index 0 is the short default (no button: it is what a step has until a length is picked). */
export const GATES = [
  { label: "DEF", name: "Default", len: 0.62 },
  { label: "1/4", name: "Quarter bar", len: 4 },
  { label: "BAR", name: "One bar", len: 16 },
  { label: "1", name: "1 step", len: 1 },
  { label: "2", name: "2 steps", len: 2 },
  { label: "3", name: "3 steps", len: 3 },
  { label: "1/2", name: "Half bar", len: 8 },
] as const;
/** Gate indexes of the buttons, in display order. */
export const GATE_BUTTONS = [3, 4, 5, 1, 6, 2] as const;
export const DEFAULT_GATE = 0;

/** The starting rig (see catalogue.ts): what a new project has in its slots. */
export const DEFAULT_RIG: Rig = defaultRig(DEFAULT_SAMPLES);

export interface TrackPattern {
  steps: Step[];
  /** Normalised 0..1 knob values of slot A and slot B (`SLOT_KNOBS` each, laid out as in catalogue.ts). Which engine they drive is the
   * project's rig, not the pattern's. */
  slots: [number[], number[]];
  level: number;
  /** Song mode: the track is muted / soloed in this pattern. Absent means off (and keeps a fresh pattern identical to a blank one). */
  mute?: boolean;
  solo?: boolean;
  /** Track sends (mixing): delay and reverb. */
  dly: DelaySend;
  rev: ReverbSend;
  /** The distortion insert, 0..1 (0 = off; lockable). Only a track with a synth shows it; on any other track it is held at 0. */
  dist: number;
  /** The LP/HP filter insert. Only a track with no synth shows it; on a synth track it is held open. */
  filter: TrackFilter;
  /** The track's LFOs (see lfo.ts). */
  lfos: Lfo[];
  /** Ducking to another track's signal (see sidechain.ts). Absent (older saves, and a track never touched) means off. */
  sc?: Sidechain;
  /** Punch FX send gate: false keeps the track out of the punch section (neither fed nor taken over). */
  punch: boolean;
  /** Octave shift for melodic tracks. */
  oct: number;
  /** Last step (1-based, absolute across the bars): the track plays steps 1..last and wraps. Absent (older saves, and whenever the
   * pattern length is set) means the whole pattern. Steps past it keep their data, they just do not play. See `trackLast`. */
  last?: number;
}

/** The track's effective last step, 1..`pat.length`: its own `last`, or the whole pattern when it has none. */
export const trackLast = (pat: Pattern, track: number): number => {
  const last = pat.tracks[track].last;
  return typeof last === "number" && last >= 1 ? Math.min(Math.floor(last), pat.length) : pat.length;
};

/**
 * The step of `track` that plays while the pattern is at `step`, `run` steps into the current run of this pattern. A run starts when the
 * pattern does and carries on through its repeats (a chain moving on, or a cue, starts a new one). A track shorter than the pattern wraps at
 * its own last step and keeps counting through the repeats, so tracks of different lengths drift against each other (polymeter); a track as
 * long as the pattern just plays `step`.
 */
export const trackStepAt = (pat: Pattern, track: number, step: number, run: number): number => {
  const last = trackLast(pat, track);
  return last >= pat.length ? step : ((run % last) + last) % last;
};

export interface ManglerBase {
  /** Index into `SWEEPS`: how long a held punch takes to reach full effect. */
  sweep: number;
  /** Character parameter per punch id (index 0 unused), normalised 0..1. */
  param: number[];
  /** The two macros per punch id (index 0 unused), normalised 0..1 (see mangler.ts). */
  macro: Array<[number, number]>;
  /** The LFO per punch id (index 0 unused): it moves one of that punch's macros, running on the beat grid and not on the steps. */
  lfo: Lfo[];
}

export interface Pattern {
  length: number;
  tracks: TrackPattern[];
  /** Written FX: up to `FX_LANES` recorded punch-ins that play back layered. */
  fxLanes: FxLane[];
  mangler: ManglerBase;
}

/** One recorded punch-in take. */
export interface FxLane {
  /** Punch id per step (0 = none). */
  fx: number[];
  /** Sweep level 0..1 of the written punch at the start of each step (the recorded automation). */
  fxLvl: number[];
}

/** How many punch-ins one pattern can hold at once. */
export const FX_LANES = 3;

export const newFxLane = (): FxLane => ({ fx: new Array(MAX_STEPS).fill(0), fxLvl: new Array(MAX_STEPS).fill(0) });
export const fxLaneEmpty = (l: FxLane): boolean => l.fx.every((id) => id === 0);

/** The lane a new punch-in should be written to: the first empty one. When all are taken they are
 * all wiped and the first is used again. Mutates `p`. */
export function pickWriteLane(p: Pattern): number {
  const free = p.fxLanes.findIndex(fxLaneEmpty);
  if (free >= 0) return free;
  p.fxLanes = Array.from({ length: FX_LANES }, newFxLane);
  return 0;
}

/** Sequencer panel: the step pads, or one FX lane (its index). */
export type SeqView = "steps" | number;

export type MixMode = "song" | "perform";

/** The fader, mute and solo a track has while `p` is the sounding pattern: its own in SONG mode, the shared performance set in PERFORM. */
type MixSource = Pick<AppState, "mixMode" | "perfLevels" | "mutes" | "solos">;
export const levelOf = (s: MixSource, p: Pattern, t: number): number => (s.mixMode === "perform" ? s.perfLevels[t] : p.tracks[t].level);
export const muteOf = (s: MixSource, p: Pattern, t: number): boolean => (s.mixMode === "perform" ? s.mutes[t] : !!p.tracks[t].mute);
export const soloOf = (s: MixSource, p: Pattern, t: number): boolean => (s.mixMode === "perform" ? s.solos[t] : !!p.tracks[t].solo);
export const anySoloOf = (s: MixSource, p: Pattern): boolean => p.tracks.some((_, t) => soloOf(s, p, t));

export type Tab = "seq" | "sound" | "mix" | "fx" | "ptn";

export interface AppState {
  // persisted
  /** Name of the loaded or last-saved project; empty for an unsaved one. */
  projectName: string;
  /** Which engine is in each slot of each track (see catalogue.ts). Project-wide, not per pattern. */
  rig: Rig;
  patterns: Pattern[];
  chain: readonly ChainEntry[];
  chainOn: boolean;
  bpm: number;
  swing: number;
  pattern: number;
  /** The project key: shapes the synth keyboards. */
  scale: ProjectScale;
  /** Arpeggiator settings per track (only the melodic tracks use theirs). */
  arp: ArpSettings[];
  /** SONG: faders, mutes and solos belong to each pattern. PERFORM: one set (`perfLevels`, `mutes`, `solos`) rides across pattern switches. */
  mixMode: MixMode;
  /** The faders in PERFORM mode. Saved with the project. */
  perfLevels: number[];
  // performance state
  /** The shared sample library: the factory set, then the user's imports. Held outside the project (IndexedDB). */
  library: readonly SampleInfo[];
  /** Which slot of the focused track the sound panel edits. */
  slot: 0 | 1;
  mutes: boolean[];
  solos: boolean[];
  focus: number;
  page: number;
  selStep: number;
  follow: boolean;
  /** Light piano keys as they are played (manually or by the sequencer). */
  keyHighlight: boolean;
  /** Browser storage is unavailable or refusing writes: nothing is being saved. */
  storageBlocked: boolean;
  tab: Tab;
  seqView: SeqView;
  // transport
  audio: "off" | "starting" | "ready" | "error";
  audioError: string;
  playing: boolean;
  /** Resample progress (menu): waiting for the next pattern start, recording, or storing the result. Not saved. */
  resample: "idle" | "armed" | "recording" | "saving" | "done" | "error";
  /** What to tell the player once a resample is done or has failed. */
  resampleMsg: string;
  /** The DAW's tempo while a plugin host plays the song (the project's own tempo is not used then); null otherwise. */
  hostBpm: number | null;
  playPattern: number;
  /** Index of the pass being played in the chain's passes (`chainPasses`): the entry and repeat are `passAt`. */
  chainPos: number;
  cue: number | null;
  // FX performance
  fxPlay: boolean;
  write: boolean;
  erase: boolean;
  /** Realtime note recording is armed: while playing, keys (on screen or MIDI) write onto the steps. Not saved. */
  rec: boolean;
  /** Punch id currently held by the player (0 = none). */
  punch: number;
  /** Punch whose character parameter is shown (the last one pressed). */
  punchSel: number;
  // pattern bank tools
  chainEdit: boolean;
  /** The chain entry being edited (-1: none): a tap on a pattern slot then changes its pattern instead of adding an entry. */
  chainSel: number;
  copyArm: boolean;
  /** P-LOCK mode: taps select steps (empty ones too) instead of editing them, and sound controls write the selected step's locks. */
  plock: boolean;
}

export const emptyStep = (note: number): Step => ({ on: false, note, acc: false, slide: false });

/** A track's slot knobs at the defaults of the engines in `rig`. */
export const defaultSlots = (rig: Rig, track: number): [number[], number[]] => {
  const { voices } = trackProfile(rig, track);
  return [defaultSlotSound(voices[0]), defaultSlotSound(voices[1])];
};

export function newTrackPattern(rig: Rig, track: number): TrackPattern {
  return {
    steps: Array.from({ length: MAX_STEPS }, () => emptyStep(trackProfile(rig, track).defaultNote)),
    slots: defaultSlots(rig, track),
    level: defaultLevel(track),
    dly: newDelay(track),
    rev: newReverb(track),
    dist: newDist(),
    filter: newFilter(),
    lfos: newLfos(),
    punch: true,
    oct: 0,
  };
}

// Starting fader level per track: `TRACKS[i].mix.level` (spec.ts).
export const defaultLevel = (track: number) => TRACKS[track].mix.level;

export function newPattern(rig: Rig = DEFAULT_RIG): Pattern {
  return {
    length: 16,
    tracks: Array.from({ length: NUM_TRACKS }, (_, i) => newTrackPattern(rig, i)),
    fxLanes: Array.from({ length: FX_LANES }, newFxLane),
    mangler: defaultMangler(),
  };
}

export const clonePattern = (p: Pattern): Pattern => structuredClone(p);

// --- a groove to start from ------------------------------------------------------------------

const hits = (p: Pattern, track: number, steps: number[], acc: number[] = []) => {
  for (const s of steps) p.tracks[track].steps[s].on = true;
  for (const s of acc) p.tracks[track].steps[s].acc = true;
};

const line = (p: Pattern, track: number, notes: Array<[step: number, note: number, flags?: string]>) => {
  for (const [s, note, flags = ""] of notes) {
    const st = p.tracks[track].steps[s];
    st.on = true;
    st.note = note;
    st.acc = flags.includes("a");
    st.slide = flags.includes("s");
  }
};

/** Set one knob of a slot by its position in the slot's sound array. */
const knob = (p: Pattern, track: number, slot: 0 | 1, at: number, value: number) => { p.tracks[track].slots[slot][at] = value; };

export function demoPattern(rig: Rig = DEFAULT_RIG): Pattern {
  const p = newPattern(rig);
  hits(p, 0, [0, 4, 8, 12], [0, 8]);        // kick + sub thump
  hits(p, 1, [4, 12], [12]);                // snare + clap
  hits(p, 2, [0, 2, 4, 6, 8, 10, 12, 14, 15], [2, 10]);
  hits(p, 3, [6, 14]);
  hits(p, 4, [3, 7, 11, 14], [7]);          // rim + shaker
  line(p, 5, [
    [0, 24, "a"], [2, 24], [3, 36, "s"], [6, 27, "a"], [8, 24], [10, 31, "s"], [11, 29], [14, 27, "a"], [15, 36, "s"],
  ]);
  // the second acid: higher, tighter, an octave up and answering the first
  line(p, 6, [[2, 36, "a"], [5, 39], [7, 43, "s"], [9, 36], [12, 41, "a"], [13, 39, "s"]]);
  knob(p, 6, 0, 0, 0.62); // FILTER: more open
  knob(p, 6, 0, 2, 0.22); // DECAY: shorter
  knob(p, 6, 0, 4, 0.7);  // BITE
  knob(p, 6, 1, 6, 0.3);  // the sample layer sits under the bass
  knob(p, 6, 1, 3, 0.1);  // ... and is a short click
  line(p, 7, [[0, 55], [3, 58], [7, 62, "a"], [10, 58], [12, 55]]);
  p.tracks[7].level = 0.55;
  knob(p, 0, 1, 6, 0.55); // the thump layer a little under the kick
  knob(p, 1, 1, 6, 0.6);  // clap under the snare
  knob(p, 4, 1, 6, 0.55); // shaker under the rim
  knob(p, 7, 1, 6, 0.6);  // pad under the pluck
  return p;
}

// --- pattern edits (pure; each returns a new pattern) -----------------------------------------

export function withPattern(p: Pattern, edit: (draft: Pattern) => void): Pattern {
  const d = clonePattern(p);
  edit(d);
  return d;
}

export function clearTrackSteps(p: Pattern, track: number, rig: Rig = DEFAULT_RIG) {
  const defaultNote = trackProfile(rig, track).defaultNote;
  for (const s of p.tracks[track].steps) {
    s.on = false;
    s.acc = false;
    s.slide = false;
    delete s.gate;
    delete s.parameterLocks;
    s.note = defaultNote;
  }
}

/** A quick, musical starting point for one track (the RND button). */
export function randomizeTrack(p: Pattern, track: number, rig: Rig = DEFAULT_RIG, rnd: () => number = Math.random, key?: ProjectScale) {
  const profile = trackProfile(rig, track);
  const len = p.length;
  clearTrackSteps(p, track, rig);
  const steps = p.tracks[track].steps;
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
  if (!profile.melodic) {
    // by what is in the track's first slot; anything else gets an even scatter
    const density: Record<string, number[]> = {
      "drum:kick": [0.9, 0.05, 0.35, 0.05],
      "drum:snare": [0, 0.8, 0.05, 0.8],
      "drum:clap": [0, 0.6, 0.05, 0.5],
      "drum:chat": [0.5, 0.9, 0.5, 0.9],
      "drum:ohat": [0.02, 0.45, 0.02, 0.2],
      "drum:tom": [0.2, 0.3, 0.3, 0.35],
    };
    const d = density[profile.voices[0]?.key ?? ""] ?? [0.3, 0.3, 0.3, 0.35];
    for (let i = 0; i < len; i++) {
      const beatPos = i % 4;
      steps[i].on = rnd() < d[beatPos];
      steps[i].acc = steps[i].on && rnd() < 0.2;
    }
    return;
  }
  const lo = profile.noteLo;
  const hi = profile.noteHi;
  let notes: number[];
  if (key && !isChromatic(key)) {
    // the project's scale over one octave from its root, with the root favoured
    const root = rootAtOrAbove(key, lo + (profile.role === "bass" ? 0 : 12));
    const inRange = notesInRange(key, root, root + 12).filter((n) => n >= lo && n <= hi);
    notes = inRange.length ? [root, root, ...inRange] : [root];
  } else {
    const base = profile.role === "bass" ? 24 : 48;
    notes = [0, 0, 3, 5, 7, 10, 12, 0, 7].map((o) => Math.min(hi, Math.max(lo, base + o)));
  }
  let prev = false;
  for (let i = 0; i < len; i++) {
    const on = rnd() < (i % 4 === 0 ? 0.85 : i % 2 === 0 ? 0.55 : 0.4);
    const s = steps[i];
    s.on = on;
    if (!on) { prev = false; continue; }
    s.note = pick(notes);
    s.acc = rnd() < 0.25;
    s.slide = prev && rnd() < 0.3;
    prev = true;
  }
}

// --- app state -------------------------------------------------------------------------------

export function initialState(): AppState {
  return {
    projectName: "",
    rig: DEFAULT_RIG,
    library: FACTORY_SAMPLES,
    patterns: Array.from({ length: NUM_PATTERNS }, (_, i) => (i === 0 ? demoPattern(DEFAULT_RIG) : newPattern(DEFAULT_RIG))),
    chain: [],
    chainOn: false,
    bpm: 128,
    swing: 0.5,
    pattern: 0,
    scale: defaultScale(),
    arp: Array.from({ length: NUM_TRACKS }, defaultArp),
    mixMode: "song",
    perfLevels: Array.from({ length: NUM_TRACKS }, (_, i) => defaultLevel(i)),
    mutes: new Array(NUM_TRACKS).fill(false),
    solos: new Array(NUM_TRACKS).fill(false),
    focus: 5,
    slot: 0,
    page: 0,
    selStep: -1,
    follow: false,
    keyHighlight: loadKeyHighlight(),
    storageBlocked: false,
    tab: "seq",
    seqView: "steps",
    audio: "off",
    audioError: "",
    playing: false,
    resample: "idle",
    resampleMsg: "",
    hostBpm: null,
    playPattern: 0,
    chainPos: 0,
    cue: null,
    fxPlay: true,
    write: false,
    erase: false,
    rec: false,
    punch: 0,
    punchSel: 1,
    chainEdit: false,
    chainSel: -1,
    copyArm: false,
    plock: false,
  };
}

const KEY_HL = storageKey("keyHighlight");

function loadKeyHighlight(): boolean {
  try {
    return localStorage.getItem(KEY_HL) !== "off";
  } catch {
    return true;
  }
}

export function saveKeyHighlight(on: boolean): void {
  try {
    localStorage.setItem(KEY_HL, on ? "on" : "off");
  } catch {
    /* storage blocked: the setting just won't persist */
  }
}
