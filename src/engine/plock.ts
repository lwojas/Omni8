// Parameter locks ("p-locks"): a step may override parameters of its track for that step only.
//
// The track's pattern owns the base value of every parameter (the knobs); a step stores just the
// deviations, in `Step.parameterLocks`, keyed by parameter id. The effective value on a step is
//
//     step.parameterLocks?.[id] ?? base
//
// so changing the base moves every step without a lock, and clearing a lock puts the step back on
// the base. Pure: no store, no audio.
//
// A lockable parameter is a `LockParam`: a position in one of the track's two slot sounds (`slot.a.3`, normalised 0..1), a send, or
// the distortion. The ids are positions, not engine control names, so they are the same whatever engine is in the slot (a lock on a
// slot whose engine changes is dropped with the change, see actions.ts). Others opt in by being returned from `lockParams`, which the
// sequencer, the UI and playback all go through.
import { SLOT_KNOBS, SLOT_NAMES } from "./catalogue";
import type { AppState, Step, TrackPattern } from "./state";

/** What a lock drives: a knob of one slot (`control` is its position in the slot's sound array), one of the track's FX sends, or its distortion insert. */
export type LockTarget = { kind: "sound"; slot: 0 | 1; control: number } | { kind: "send"; send: "dly" | "rev" } | { kind: "dist" } | { kind: "filter"; param: "cut" | "res" };

export interface LockParam {
  /** Stable id: the key in `Step.parameterLocks` (saved with the project, so never renamed). */
  id: string;
  label: string;
  target: LockTarget;
  /** The base value, normalised 0..1. */
  base(tp: TrackPattern): number;
}

/** The lock id of knob `at` of slot `slot`. */
export function soundLockId(slot: 0 | 1, at: number): string {
  return `slot.${SLOT_NAMES[slot].toLowerCase()}.${at}`;
}

/** Every parameter a step can lock on a track: the knobs of slot A then slot B, then the delay and reverb sends, then the distortion. The
 * same list for every track; a position the slot's engine has no knob at simply never gets written. */
const LOCKS: readonly LockParam[] = [
  ...([0, 1] as const).flatMap((slot) =>
    Array.from({ length: SLOT_KNOBS }, (_, i): LockParam => ({
      id: soundLockId(slot, i), label: `${SLOT_NAMES[slot]}${i + 1}`, target: { kind: "sound", slot, control: i }, base: (tp) => tp.slots[slot][i],
    })),
  ),
  { id: "fx.delaySend", label: "DLY", target: { kind: "send", send: "dly" }, base: (tp) => tp.dly.send },
  { id: "fx.reverbSend", label: "REV", target: { kind: "send", send: "rev" }, base: (tp) => tp.rev.send },
  { id: "fx.distortion", label: "DIST", target: { kind: "dist" }, base: (tp) => tp.dist },
  { id: "fx.filterCut", label: "CUT", target: { kind: "filter", param: "cut" }, base: (tp) => tp.filter.cut },
  { id: "fx.filterRes", label: "RES", target: { kind: "filter", param: "res" }, base: (tp) => tp.filter.res },
];
const BY_ID = new Map(LOCKS.map((p) => [p.id, p]));

export function lockParams(_track?: number): readonly LockParam[] {
  return LOCKS;
}

/** The lock parameter behind knob `at` of slot `slot`. */
export const soundParam = (_track: number, slot: 0 | 1, at: number): LockParam => LOCKS[slot * SLOT_KNOBS + at];

/** The lock parameter with this id. */
export const lockParam = (_track: number, id: string): LockParam | undefined => BY_ID.get(id);

/** The step P-LOCK mode is editing on `track`, if any: the selected step of the focused track while the mode is on. */
export function lockStep(s: Pick<AppState, "plock" | "focus" | "selStep" | "patterns" | "pattern">, track: number): Step | undefined {
  return s.plock && s.focus === track && s.selStep >= 0 ? s.patterns[s.pattern].tracks[track].steps[s.selStep] : undefined;
}

/** The value of `param` on `step`: its lock when it has one, else the base. */
export const effectiveValue = (tp: TrackPattern, step: Step | undefined, param: LockParam): number => step?.parameterLocks?.[param.id] ?? param.base(tp);

/** The track's two slot sounds as they are on `step` (new arrays; the base `tp.slots` when the step has no locks). */
export function effectiveSound(tp: TrackPattern, track: number, step: Step | undefined): [number[], number[]] {
  if (!hasLocks(step)) return tp.slots;
  return [0, 1].map((slot) => tp.slots[slot].map((_, i) => effectiveValue(tp, step, soundParam(track, slot as 0 | 1, i)))) as [number[], number[]];
}

export const hasLocks = (step: Step | undefined): boolean => !!step?.parameterLocks && Object.keys(step.parameterLocks).length > 0;

/** Set one lock, leaving the step's other locks alone. Mutates `step`. */
export function setLock(step: Step, id: string, value: number): void {
  (step.parameterLocks ??= {})[id] = Math.min(1, Math.max(0, value));
}

/** Drop all of a step's locks (the step stays). Mutates `step`. */
export function clearLocks(step: Step): void {
  delete step.parameterLocks;
}

/** Locks from a save, cleaned: known parameters only, finite values clamped to 0..1. */
export function sanitizeLocks(track: number, locks: unknown): Record<string, number> | undefined {
  if (!locks || typeof locks !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const p of lockParams(track)) {
    const v = (locks as Record<string, unknown>)[p.id];
    if (typeof v === "number" && Number.isFinite(v)) out[p.id] = Math.min(1, Math.max(0, v));
  }
  return Object.keys(out).length ? out : undefined;
}
