// Mapping a linear song position (16th-note steps from the start, as MIDI Song Position Pointer counts)
// onto this app's playback: the chain when it is on, otherwise the current pattern looping.
import type { AppState } from "./state";

export interface SongPosition {
  pattern: number;
  chainPos: number;
  step: number;
  /** Steps into the run of this pattern (see `trackStepAt`). */
  run: number;
}

/** Whether a chain is one pattern over and over, which is just that pattern looping: its run never restarts. */
export const isOnePattern = (chain: readonly number[]): boolean => chain.length > 0 && chain.every((p) => p === chain[0]);

/**
 * For each chain entry, the steps between the start of its run and its own start. A run starts when the pattern changes (and when the chain
 * wraps round, unless it is one pattern: `isOnePattern`) and carries on through repeats of the same pattern, so tracks shorter than their
 * pattern keep their own loop across them.
 */
export function runStarts(chain: readonly number[], lengthOf: (pattern: number) => number): number[] {
  const out: number[] = [];
  let run = 0;
  chain.forEach((p, i) => {
    if (i === 0 || p !== chain[i - 1]) run = 0;
    out.push(run);
    run += lengthOf(p);
  });
  return out;
}

export function locateSong(
  s: Pick<AppState, "patterns" | "chain" | "chainOn" | "pattern">,
  songStep: number,
): SongPosition {
  const pos = Math.max(0, Math.floor(songStep));
  if (s.chainOn && s.chain.length) {
    const lengths = s.chain.map((p) => s.patterns[p].length);
    const starts = runStarts(s.chain, (p) => s.patterns[p].length);
    const one = isOnePattern(s.chain);
    let rest = pos % lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
      if (rest < lengths[i]) return { pattern: s.chain[i], chainPos: i, step: rest, run: one ? pos : starts[i] + rest };
      rest -= lengths[i];
    }
  }
  return { pattern: s.pattern, chainPos: 0, step: pos % s.patterns[s.pattern].length, run: pos };
}
