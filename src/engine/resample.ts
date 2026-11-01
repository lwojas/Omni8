// Resample: record what the master output plays for a whole number of bars, starting on a pattern's first step, and keep it in the
// shared sample library like any import. The recording itself is webdsp's sample-accurate `armCapture`; this file is the pure parts
// around it (how long, what to call it, the WAV the library stores).
import { PAGE } from "./state";

/** Bar lengths the menu offers. A bar is one page of 16 steps. */
export const RESAMPLE_BARS = [1, 2, 4, 8, 16] as const;

/** Seconds `bars` bars last at `bpm` (steps are sixteenth notes). */
export const resampleSeconds = (bars: number, bpm: number): number => (bars * PAGE * 15) / bpm;

/** The next free "RESAMPLE nn" name for a library whose sample names are `names`. */
export function resampleName(names: readonly string[]): string {
  const used = names.filter((n) => /^RESAMPLE \d+$/.test(n)).map((n) => Number(n.slice(9)));
  return `RESAMPLE ${String(Math.max(0, ...used) + 1).padStart(2, "0")}`;
}

const clamp16 = (v: number): number => Math.round(Math.max(-1, Math.min(1, v)) * (v < 0 ? 0x8000 : 0x7fff));

/** 16-bit PCM WAV bytes from equal-length planar channels (what `armCapture` hands back). */
export function encodeWav(channels: readonly Float32Array[], rate: number): ArrayBuffer {
  const n = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const data = frames * n * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + data, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, n, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * n * 2, true); v.setUint16(32, n * 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, data, true);
  let o = 44;
  for (let f = 0; f < frames; f++) for (let c = 0; c < n; c++, o += 2) v.setInt16(o, clamp16(channels[c]?.[f] ?? 0), true);
  return buf;
}
