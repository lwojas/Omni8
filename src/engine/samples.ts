// The shared sample library. One list of samples for the whole project: a SAMPLE slot on any track points at a library id, and
// the audio is loaded into webdsp once per id (audio.ts), so ten slots on one kick play one buffer.
//
// Two kinds: the factory set, generated here from a few lines of DSP (no audio assets in the repo, nothing to license), and the
// user's imports, kept as the original file bytes in IndexedDB and decoded by webdsp like any other sample.
import { openDb, idbRequest, SAMPLES_STORE, txDone } from "./db";

export interface SampleInfo {
  /** Stable id: what a slot saves. Factory ids are fixed strings; imports are `user:<n>`. */
  id: string;
  name: string;
  factory: boolean;
}

const RATE = 44100;

/** Small deterministic noise source, so a factory sample is the same every time it is generated. */
function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

const frames = (seconds: number) => Math.floor(seconds * RATE);
const TAU = Math.PI * 2;

/** One-pole low-pass in place. */
function lowpass(x: Float32Array, hz: number): void {
  const a = 1 - Math.exp((-TAU * hz) / RATE);
  let y = 0;
  for (let i = 0; i < x.length; i++) x[i] = y += a * (x[i] - y);
}
/** First difference: a cheap high-pass that leaves noise bright. */
function brighten(x: Float32Array): void {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    x[i] = v - p;
    p = v;
  }
}
function normalise(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

const FACTORY_DEFS: ReadonlyArray<{ id: string; name: string; gen: () => Float32Array }> = [
  {
    id: "sub-thump", name: "SUB THUMP", gen: () => {
      const out = new Float32Array(frames(0.5));
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        ph += (TAU * (46 + 90 * Math.exp(-t * 30))) / RATE;
        out[i] = Math.sin(ph) * Math.exp(-t * 7) * Math.min(1, t * 800);
      }
      return normalise(out);
    },
  },
  {
    id: "snap", name: "SNAP", gen: () => {
      const n = noise(11), out = new Float32Array(frames(0.22));
      for (let i = 0; i < out.length; i++) out[i] = n() * Math.exp((-i / RATE) * 26);
      brighten(out);
      return normalise(out);
    },
  },
  {
    id: "rim", name: "RIM", gen: () => {
      const out = new Float32Array(frames(0.12)), n = noise(5);
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        out[i] = (Math.sin(TAU * 520 * t) * 0.7 + Math.sin(TAU * 1730 * t) * 0.5 + n() * (t < 0.002 ? 0.8 : 0)) * Math.exp(-t * 55);
      }
      return normalise(out);
    },
  },
  {
    id: "shaker", name: "SHAKER", gen: () => {
      const n = noise(23), out = new Float32Array(frames(0.28));
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        out[i] = n() * Math.min(1, t * 90) * Math.exp(-t * 14);
      }
      brighten(out);
      brighten(out);
      return normalise(out);
    },
  },
  {
    id: "tick", name: "TICK", gen: () => {
      const n = noise(3), out = new Float32Array(frames(0.05));
      for (let i = 0; i < out.length; i++) out[i] = n() * Math.exp((-i / RATE) * 110);
      brighten(out);
      return normalise(out);
    },
  },
  {
    id: "stab", name: "MIN7 STAB", gen: () => {
      const out = new Float32Array(frames(0.7));
      const notes = [220, 261.63, 329.63, 392];  // A minor 7, so it also sounds right transposed
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        let v = 0;
        for (const f of notes) for (const d of [0.997, 1.003]) v += 2 * (((f * d * t) % 1) - 0.5);
        out[i] = (v / 8) * Math.exp(-t * 6) * Math.min(1, t * 400);
      }
      lowpass(out, 3200);
      return normalise(out);
    },
  },
  {
    id: "noise-burst", name: "NOISE", gen: () => {
      const n = noise(101), out = new Float32Array(frames(0.9));
      for (let i = 0; i < out.length; i++) out[i] = n() * Math.exp((-i / RATE) * 4.5);
      lowpass(out, 9000);
      return normalise(out);
    },
  },
  {
    id: "zap", name: "ZAP", gen: () => {
      const out = new Float32Array(frames(0.3));
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        ph += (TAU * (90 + 3600 * Math.exp(-t * 22))) / RATE;
        out[i] = Math.sin(ph) * Math.exp(-t * 9);
      }
      return normalise(out);
    },
  },
];

export const FACTORY_SAMPLES: readonly SampleInfo[] = FACTORY_DEFS.map(({ id, name }) => ({ id, name, factory: true }));
/** The ids the default rig uses. */
export const DEFAULT_SAMPLES = { thump: "sub-thump", snap: "snap", rim: "rim", shaker: "shaker" } as const;

/** The factory sample's mono PCM (44.1 kHz), or undefined for an unknown id. */
export function factoryPcm(id: string): Float32Array | undefined {
  return FACTORY_DEFS.find((d) => d.id === id)?.gen();
}

/** 16-bit mono WAV bytes: what webdsp's `loadSample` decodes. */
export function wavBytes(pcm: Float32Array, rate = RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), true);
  return buf;
}

// --- the user's imports -------------------------------------------------------------------------------

interface StoredSample { id: string; name: string; bytes: ArrayBuffer }

/** The imported samples, newest last. Empty when storage is unavailable. */
export async function loadUserSamples(): Promise<SampleInfo[]> {
  try {
    const db = await openDb();
    const rows = await idbRequest(db.transaction(SAMPLES_STORE).objectStore(SAMPLES_STORE).getAll() as IDBRequest<StoredSample[]>);
    return rows
      .sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5)))
      .map((r) => ({ id: r.id, name: r.name, factory: false }));
  } catch {
    return [];
  }
}

/** Add an audio file to the library. Throws when storage refuses it. */
export async function importSample(name: string, bytes: ArrayBuffer, existing: readonly SampleInfo[]): Promise<SampleInfo> {
  const next = existing.reduce((m, s) => (s.factory ? m : Math.max(m, Number(s.id.slice(5)))), 0) + 1;
  const info: SampleInfo = { id: `user:${next}`, name: name.replace(/\.[^.]+$/, "").slice(0, 14).toUpperCase() || "IMPORT", factory: false };
  const db = await openDb();
  const tx = db.transaction(SAMPLES_STORE, "readwrite");
  tx.objectStore(SAMPLES_STORE).put({ id: info.id, name: info.name, bytes } satisfies StoredSample);
  await txDone(tx);
  return info;
}

export async function removeUserSample(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SAMPLES_STORE, "readwrite");
  tx.objectStore(SAMPLES_STORE).delete(id);
  await txDone(tx);
}

/** The bytes webdsp decodes for library sample `id`, or undefined when it is not there (a project saved with a sample that was removed). */
export async function sampleBytes(id: string): Promise<ArrayBuffer | undefined> {
  const pcm = factoryPcm(id);
  if (pcm) return wavBytes(pcm);
  try {
    const db = await openDb();
    const row = await idbRequest(db.transaction(SAMPLES_STORE).objectStore(SAMPLES_STORE).get(id) as IDBRequest<StoredSample | undefined>);
    return row?.bytes;
  } catch {
    return undefined;
  }
}
