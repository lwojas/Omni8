// Control maths shared by every engine (catalogue.ts defines the engines themselves), and the per-track starting mix.
//
// Every control is stored as a normalised 0..1 value (so retuning a range never breaks saved
// patterns) and mapped to engine units here. Ranges are narrower than the engine's on purpose:
// the whole knob travel should be musical.
export type Role = "drum" | "bass" | "tone";
export type Unit = "Hz" | "s" | "%" | "st" | "oct" | "";

export interface ControlSpec {
  key: string;
  label: string;
  /** webdsp parameter id (per-kind enum). */
  param: number;
  /** Sweet-spot range in engine units. */
  lo: number;
  hi: number;
  curve: "lin" | "exp" | "pow";
  /** `pow` only: value = lo + (hi - lo) * n^gamma. gamma > 1 spends more travel on low values. */
  gamma?: number;
  unit: Unit;
  /** Default in engine units. */
  def: number;
  /** Stepped control: detent names, `lo..hi` is `0..names.length-1`. */
  steps?: readonly string[];
  /** Where the control lands. Absent: a webdsp instrument parameter (`param`). The others are handled by the audio layer:
   * the slot's own fader (on its bus), and a sample's playback settings (read when a note triggers). */
  dest?: "level" | "sample";
  /** Readout shown at the top of the travel instead of the number (a sample's DECAY reads FULL: no fade, the sample plays out). */
  top?: string;
}

/** What a track is fixed to: its starting mix. Everything about the sound (engines, controls, role, note range) comes from the
 * track's slots (catalogue.ts), which the project can change. */
export interface TrackSpec {
  id: number;
  /** Starting mix for a fresh pattern: fader level and delay / reverb sends (all 0..1). */
  mix: { level: number; delay: number; reverb: number };
}

export const lin = (key: string, label: string, param: number, lo: number, hi: number, def: number, unit: Unit = "%"): ControlSpec => ({
  key, label, param, lo, hi, curve: "lin", unit, def,
});
export const exp = (key: string, label: string, param: number, lo: number, hi: number, def: number, unit: Unit): ControlSpec => ({
  key, label, param, lo, hi, curve: "exp", unit, def,
});

export const pow = (key: string, label: string, param: number, lo: number, hi: number, def: number, gamma: number, unit: Unit = "%"): ControlSpec => ({
  key, label, param, lo, hi, curve: "pow", gamma, unit, def,
});

export const FM_COLORS = ["SUB", "FULL", "HOLLOW", "THIRDS", "THIN", "FIFTHS", "METAL", "BELL"] as const;

export const TRACKS: readonly TrackSpec[] = [
  { id: 0, mix: { level: 0.85, delay: 0, reverb: 0 } },
  { id: 1, mix: { level: 0.75, delay: 0.15, reverb: 0.12 } },
  { id: 2, mix: { level: 0.55, delay: 0.12, reverb: 0 } },
  { id: 3, mix: { level: 0.55, delay: 0.25, reverb: 0 } },
  { id: 4, mix: { level: 0.6, delay: 0.3, reverb: 0.1 } },
  { id: 5, mix: { level: 0.78, delay: 0.1, reverb: 0 } },
  { id: 6, mix: { level: 0.72, delay: 0.2, reverb: 0.05 } },
  { id: 7, mix: { level: 0.62, delay: 0.3, reverb: 0.2 } },
];

export const NUM_TRACKS = TRACKS.length;

// --- normalised <-> engine units -------------------------------------------------------------

/** From this normalised value a control with a `top` readout is at the top of its travel. */
export const TOP_AT = 0.98;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export function normToUnits(c: ControlSpec, n: number): number {
  n = clamp01(n);
  if (c.steps) return Math.round(n * (c.steps.length - 1));
  if (c.curve === "exp") return c.lo * Math.pow(c.hi / c.lo, n);
  if (c.curve === "pow") return c.lo + (c.hi - c.lo) * Math.pow(n, c.gamma ?? 1);
  return c.lo + n * (c.hi - c.lo);
}

export function unitsToNorm(c: ControlSpec, v: number): number {
  if (c.steps) return c.steps.length > 1 ? clamp01(v / (c.steps.length - 1)) : 0;
  if (c.curve === "exp") return clamp01(Math.log(v / c.lo) / Math.log(c.hi / c.lo));
  const lin = clamp01((v - c.lo) / (c.hi - c.lo));
  return c.curve === "pow" ? Math.pow(lin, 1 / (c.gamma ?? 1)) : lin;
}

/** Readout for a control at a normalised value, e.g. "52 Hz", "380 ms", "78%". */
export function formatControl(c: ControlSpec, n: number): string {
  if (c.top && n >= TOP_AT) return c.top;
  const v = normToUnits(c, n);
  if (c.steps) return c.steps[Math.round(v)] ?? "";
  switch (c.unit) {
    case "Hz": return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 2)} kHz` : `${Math.round(v)} Hz`;
    case "s": return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
    case "st": return `${v >= 0 ? "+" : ""}${v.toFixed(1)} st`;
    case "oct": return `${v.toFixed(1)} oct`;
    case "%": return `${Math.round(clamp01(unitsToNorm(c, v)) * 100)}%`;
    default: return v.toFixed(2);
  }
}

// --- notes -----------------------------------------------------------------------------------

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** MIDI 24 is C1 (the convention used in the design mock-up). */
export function noteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
