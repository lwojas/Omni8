import { describe, expect, it } from "vitest";
import { encodeWav, resampleName, resampleSeconds } from "../src/engine/resample";

describe("resample", () => {
  it("measures a bar as 16 sixteenth-note steps", () => {
    expect(resampleSeconds(1, 120)).toBeCloseTo(2);
    expect(resampleSeconds(4, 120)).toBeCloseTo(8);
    expect(resampleSeconds(2, 60)).toBeCloseTo(8);
  });

  it("names the next free RESAMPLE number", () => {
    expect(resampleName(["SNAP"])).toBe("RESAMPLE 01");
    expect(resampleName(["RESAMPLE 01", "RESAMPLE 03", "KICK"])).toBe("RESAMPLE 04");
  });

  it("encodes interleaved 16-bit stereo WAV", () => {
    const wav = encodeWav([Float32Array.of(0, 1, -1), Float32Array.of(0.5, 0, 0)], 48000);
    const v = new DataView(wav);
    expect(wav.byteLength).toBe(44 + 3 * 2 * 2);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getInt16(44 + 4, true)).toBe(32767); // frame 1, left
    expect(v.getInt16(44 + 8, true)).toBe(-32768); // frame 2, left
    expect(v.getInt16(44 + 2, true)).toBe(Math.round(0.5 * 32767));
  });
});
