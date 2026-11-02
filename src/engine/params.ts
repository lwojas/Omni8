// The app's externally controllable parameters, by stable id. This is a thin view over the store, not
// a second copy of it: each parameter reads its value from AppState and writes through the same
// actions the UI uses. MIDI, a plugin host or automation all go through here; none of them knows
// where a control lives on screen, and the UI knows nothing about them.
//
//   track.<1-8>.volume | mute | solo | delaySend | reverbSend | punchSend | arp   (arp: melodic tracks)
//   track.<1-8>.distortion                                             (the INSERT FX of a track with a synth)
//   track.<1-8>.filterCut | filterRes | filterMode                     (the INSERT FX of the other tracks)
//   track.<1-8>.a.<1-7> | b.<1-7>                                      (knob K of slot A or B by position: 1-6 the engine's, 7 LEVEL)
//   pattern.select                                                     (0-based pattern slot)
//
// Slot knobs, the delay/reverb sends, the distortion and the filter cutoff/resonance are lockable (plock.ts): in TWEAK mode, with a
// step selected on the focused track, they read and write that step's lock rather than the base, exactly as the on-screen knobs do.
// Ids are 1-based for tracks (what a person calls them) and never change once shipped: they are the
// external contract (see docs/dev/midi.md). Volume, sends and sound belong to the pattern on screen, as
// they do in the UI.
//
// A parameter's value is in its own domain, `kind` says which:
//   norm  0..1 continuous      int  min..max whole numbers      bool  0 or 1
import { setArp, setFilter, setLevel, setLockable, setMute, setPunchSend, setSolo } from "./actions";
import { controller } from "./controller";
import { effectiveValue, lockParam, lockStep, soundLockId } from "./plock";
import { currentSource, withSource, type ParamSource } from "./source";
import { defaultLevel, DEFAULT_RIG, levelOf, muteOf, NUM_PATTERNS, soloOf, type AppState, type TrackPattern } from "./state";
import { defaultDelaySend, defaultReverbSend, FILTER_MODES } from "./trackfx";
import { SLOT_KNOBS, SLOT_NAMES, defaultSlotSound, trackProfile } from "./catalogue";
import { TRACKS } from "./spec";
import { getState, observe } from "./store";

export type ParamKind = "norm" | "int" | "bool";

/** What an outside controller needs to know about a parameter. Also the shape a plugin host
 * needs to declare it (see `paramManifest`). */
export interface ParamInfo {
  id: string;
  label: string;
  kind: ParamKind;
  min: number;
  max: number;
  def: number;
  /** Names of the values of an `int` parameter, when it has them. */
  labels?: readonly string[];
}

interface ParamDef extends ParamInfo {
  get(s: AppState): number;
  set(value: number): void;
}

const tp = (s: AppState, t: number): TrackPattern => s.patterns[s.pattern].tracks[t];
const idOf = (t: number, name: string) => `track.${t + 1}.${name}`;

/** A lockable parameter's value as the controls show it: in P-LOCK mode with a step selected on the track, that step's (its lock over
 * the base); otherwise the base. Writes go through `setLockable`, which edits the same thing. */
const shown = (s: AppState, t: number, lockId: string): number => {
  const p = lockParam(t, lockId)!;
  return effectiveValue(tp(s, t), lockStep(s, t), p);
};

function build(): ParamDef[] {
  const defs: ParamDef[] = [];
  for (const spec of TRACKS) {
    const t = spec.id;
    // the manifest is fixed (a DAW binds these ids), so the labels are too: what a knob does depends on the engine in the slot
    const name = `Track ${t + 1}`;
    defs.push(
      { id: idOf(t, "volume"), label: `${name} volume`, kind: "norm", min: 0, max: 1, def: defaultLevel(t), get: (s) => levelOf(s, s.patterns[s.pattern], t), set: (v) => setLevel(t, v) },
      { id: idOf(t, "mute"), label: `${name} mute`, kind: "bool", min: 0, max: 1, def: 0, get: (s) => (muteOf(s, s.patterns[s.pattern], t) ? 1 : 0), set: (v) => setMute(t, v >= 1) },
      { id: idOf(t, "solo"), label: `${name} solo`, kind: "bool", min: 0, max: 1, def: 0, get: (s) => (soloOf(s, s.patterns[s.pattern], t) ? 1 : 0), set: (v) => setSolo(t, v >= 1) },
      { id: idOf(t, "delaySend"), label: `${name} delay send`, kind: "norm", min: 0, max: 1, def: defaultDelaySend(t), get: (s) => shown(s, t, "fx.delaySend"), set: (v) => setLockable(t, "fx.delaySend", v) },
      { id: idOf(t, "reverbSend"), label: `${name} reverb send`, kind: "norm", min: 0, max: 1, def: defaultReverbSend(t), get: (s) => shown(s, t, "fx.reverbSend"), set: (v) => setLockable(t, "fx.reverbSend", v) },
      { id: idOf(t, "punchSend"), label: `${name} punch FX send`, kind: "bool", min: 0, max: 1, def: 1, get: (s) => (tp(s, t).punch ? 1 : 0), set: (v) => setPunchSend(t, v >= 1) },
    );
    defs.push(
      { id: idOf(t, "filterCut"), label: `${name} filter cutoff`, kind: "norm", min: 0, max: 1, def: 1, get: (s) => shown(s, t, "fx.filterCut"), set: (v) => setLockable(t, "fx.filterCut", v) },
      { id: idOf(t, "filterRes"), label: `${name} filter resonance`, kind: "norm", min: 0, max: 1, def: 0, get: (s) => shown(s, t, "fx.filterRes"), set: (v) => setLockable(t, "fx.filterRes", v) },
      { id: idOf(t, "filterMode"), label: `${name} filter mode`, kind: "int", min: 0, max: 1, def: 0, labels: FILTER_MODES, get: (s) => tp(s, t).filter.mode, set: (v) => setFilter(t, { mode: v >= 1 ? 1 : 0 }) },
    );
    defs.push({ id: idOf(t, "distortion"), label: `${name} distortion`, kind: "norm", min: 0, max: 1, def: 0, get: (s) => shown(s, t, "fx.distortion"), set: (v) => setLockable(t, "fx.distortion", v) });
    defs.push({ id: idOf(t, "arp"), label: `${name} arpeggiator`, kind: "bool", min: 0, max: 1, def: 0, get: (s) => (s.arp[t].on ? 1 : 0), set: (v) => setArp(t, { on: v >= 1 && trackProfile(getState().rig, t).melodic }) });
    // the knobs of the two slots, by position: `track.N.a.K` is the K-th knob of slot A whatever engine is in it (the last two are LEVEL and FILTER)
    for (const slot of [0, 1] as const) {
      for (let at = 0; at < SLOT_KNOBS; at++) {
        const lockId = soundLockId(slot, at);
        const sound = defaultSlotSound(trackProfile(DEFAULT_RIG, t).voices[slot]);
        defs.push({
          id: idOf(t, `${SLOT_NAMES[slot].toLowerCase()}.${at + 1}`), label: `${name} slot ${SLOT_NAMES[slot]} knob ${at + 1}`, kind: "norm", min: 0, max: 1, def: sound[at],
          get: (s) => shown(s, t, lockId), set: (v) => setLockable(t, lockId, v),
        });
      }
    }
  }
  defs.push({
    id: "pattern.select", label: "Pattern", kind: "int", min: 0, max: NUM_PATTERNS - 1, def: 0,
    get: (s) => s.pattern, set: (v) => controller.cuePattern(v),
  });
  return defs;
}

const defs = build();
const byId = new Map(defs.map((d) => [d.id, d]));

export const hasParam = (id: string): boolean => byId.has(id);

export function paramInfo(id: string): ParamInfo | undefined {
  const d = byId.get(id);
  if (!d) return undefined;
  const { get: _get, set: _set, ...info } = d;
  return info;
}

/** Every parameter's description, in a stable order: what a plugin host declares at build time. */
export function paramManifest(): ParamInfo[] {
  return defs.map(({ get: _get, set: _set, ...info }) => info);
}

export function getParam(id: string, state: AppState): number {
  const d = byId.get(id);
  if (!d) throw new Error(`unknown parameter ${id}`);
  return d.get(state);
}

/** Bring a value into the parameter's domain (clamped; whole numbers for int, 0 or 1 for bool). */
export function cleanValue(info: Pick<ParamInfo, "kind" | "min" | "max">, value: number): number {
  if (!Number.isFinite(value)) return info.min;
  if (info.kind === "bool") return value >= 0.5 ? 1 : 0;
  const v = Math.min(info.max, Math.max(info.min, value));
  return info.kind === "int" ? Math.round(v) : v;
}

/** Set a parameter on behalf of `source`. The write goes through the normal actions, so the UI
 * follows by itself, and everything listening hears the change with this origin. */
export function setParam(id: string, value: number, source: ParamSource): void {
  const d = byId.get(id);
  if (!d) return;
  withSource(source, () => d.set(cleanValue(d, value)));
}

// --- change notification ---------------------------------------------------------------------------

export type ParamListener = (id: string, value: number, source: ParamSource) => void;

const listeners = new Set<ParamListener>();
let stopObserving: (() => void) | null = null;

/** Hear every parameter change from whatever origin, with that origin. The store is only observed
 * while someone listens. */
export function onParamChange(fn: ParamListener): () => void {
  listeners.add(fn);
  stopObserving ??= observe((next, prev) => {
    if (next.patterns === prev.patterns && next.plock === prev.plock && next.selStep === prev.selStep && next.focus === prev.focus && next.mutes === prev.mutes && next.solos === prev.solos && next.mixMode === prev.mixMode && next.perfLevels === prev.perfLevels && next.pattern === prev.pattern && next.arp === prev.arp) return;
    const source = currentSource();
    for (const d of defs) {
      const value = d.get(next);
      if (value !== d.get(prev)) for (const l of listeners) l(d.id, value, source);
    }
  });
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      stopObserving?.();
      stopObserving = null;
    }
  };
}
