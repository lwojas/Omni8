// The audio layer: the only module that talks to webdsp's AudioRuntime.
//
// Topology (all webdsp primitives, nothing custom). A bus has one main route and one send, so each
// track is a short chain of buses, each adding one tap:
//
//   slot A engine ─▶ SLOT_A (level, low-pass) ─┐
//                                              ├─▶ [Saturation] ─▶ A (fader/mute) ─main─▶ B ─main─▶ C ─main─▶ master ─▶ limiter
//   slot B engine ─▶ SLOT_B (level, low-pass) ─┘                 └─send─▶ DELAY_t     └─send─▶ REVERB_t   └─send─▶ PUNCH bus ─▶ master
//
//   A slot's engine is a webdsp instrument on the slot's bus, or (SAMPLE) triggers of one shared loaded sample into it. Swapping an
//   engine creates and removes the instrument only; the buses never change, so the graph is the same shape every time.
//   Every track has the distortion insert on bus A, ahead of the fader and both sends (webdsp Saturation): the INSERT FX.
//   DELAY_t  (per track, wet-only): Dub Delay (Beat) ▶ Delay (Free), one of them active
//   REVERB_t (per track, wet-only): Reverb. Idle while its send is 0 (webdsp sleeps unfed buses).
//   PUNCH bus chain: Filter ▶ Saturation ▶ Bitcrusher ▶ Phaser ▶ Flanger ▶ Dub Delay ▶ Reverb
//   The punch bus is only fed while a punch is held (C's send); C's main is cut during a takeover.
import {
  AudioRuntime,
  EffectKind,
  FilterMode,
  InstrumentCommonParam,
  NodeParam,
  type BusId,
  type EffectId,
  type InstrumentId,
  type SampleId,
  type ScheduledParam,
  type VoiceHandle,
} from "webdsp";
import { defaultWorkletUrl } from "webdsp/worklet-url";
import { baseValues, MANGLER_KEYS, MANGLER_PARAMS, type FxSlot, type ManglerValues } from "./mangler";
import { lfoOffset } from "./lfo";
import { lockParam, lockParams, type LockParam } from "./plock";
import { controlAt, LEVEL_AT, trackProfile, voiceOf, type Rig, type VoiceSpec } from "./catalogue";
import { sampleBytes } from "./samples";
import { playSlots, type SlotPlay, type SlotSounds, type TrackNote } from "./slots";
import { normToUnits, NUM_TRACKS } from "./spec";
import { trackStepAt, type Pattern } from "./state";
import {
  BEAT_DIVISIONS, DELAY_FEEDBACK_BEAT, DELAY_FEEDBACK_FREE, DELAY_TONE, distDriveDb, distMix, distTrimDb, filterHz, filterQ, freeDelaySeconds, reverbDamping, reverbDecay,
} from "./trackfx";

/** Work that has to land at a point on the audio clock but is not a sample-accurate event
 * (bus levels and sends are not schedulable in webdsp). Fired from the shared ticker. */
class TimedQueue {
  private items: Array<{ time: number; fn: () => void }> = [];
  at(time: number, fn: () => void) {
    this.items.push({ time, fn });
    this.items.sort((a, b) => a.time - b.time);
  }
  flush(now: number) {
    while (this.items.length && this.items[0].time <= now + 0.004) this.items.shift()!.fn();
  }
  clear() {
    this.items = [];
  }
}

/** Level fader taper: 0..1 → linear bus gain, about unity at 0.95. */
export const levelToGain = (level: number) => level * level * 1.1;

export interface MixInput {
  pattern: Pattern;
  mutes: readonly boolean[];
  solos: readonly boolean[];
  takeover: boolean;
  boost: number;
}

/** The ids of everything the graph is made of: what the pure functions below address. */
export interface GraphIds {
  /** Per track: A (fader, delay send), B (reverb send), C (punch send, takeover cut). */
  trackBus: readonly BusId[];
  busB: readonly BusId[];
  busC: readonly BusId[];
  delayBus: readonly BusId[];
  reverbBus: readonly BusId[];
  delayFx: ReadonlyArray<{ dub: EffectId; free: EffectId }>;
  reverbFx: readonly EffectId[];
  /** Per track: the distortion insert (Saturation) on bus A, ahead of the fader and both sends. */
  distFx: readonly EffectId[];
  /** Per track: the LP/HP filter insert on bus A, next to the distortion. */
  filterFx: readonly EffectId[];
  /** Per track and slot: the slot's bus (its level). */
  slotBus: ReadonlyArray<readonly [BusId, BusId]>;
  /** Per track and slot: the engine's instrument, undefined for an empty slot or a sample. Changes when an engine is swapped. */
  inst: Array<[InstrumentId | undefined, InstrumentId | undefined]>;
  manglerBus: BusId;
  fx: Readonly<Record<FxSlot, EffectId>>;
}

/** One parameter write the graph needs. `key` names the parameter (the live engine skips a write that repeats its last). */
export type Write =
  | { kind: "bus"; key: string; bus: BusId; param: NodeParam; value: number }
  | { kind: "fx"; key: string; bus: BusId; effect: EffectId; param: NodeParam; value: number }
  | { kind: "inst"; key: string; instrument: InstrumentId; param: number; value: number };

/** The mixer's bus writes for a pattern's levels and sends, the mutes and solos, and the punch section's state
 * (`takeover`, `boost`). "pattern" is what travels with the pattern (fader/mute, delay and reverb sends); "punch" is the
 * punch send and takeover cut on bus C, which the written FX lanes drive; "all" is both. */
export function mixWrites(ids: GraphIds, mix: MixInput, group: "pattern" | "punch" | "all" = "all"): Write[] {
  const out: Write[] = [];
  const anySolo = mix.solos.some(Boolean);
  const bus = (b: BusId, key: string, param: NodeParam, value: number) => out.push({ kind: "bus", key, bus: b, param, value });
  for (let t = 0; t < NUM_TRACKS; t++) {
    const audible = anySolo ? mix.solos[t] : !mix.mutes[t];
    const tp = mix.pattern.tracks[t];
    if (group !== "punch") {
      // the fader/mute sits before every tap, so a muted track's delay and reverb go quiet too
      bus(ids.trackBus[t], `${t}:g`, NodeParam.BusGain, audible ? levelToGain(tp.level) : 0);
      bus(ids.trackBus[t], `${t}:d`, NodeParam.BusSendAmount, tp.dly.send);
      bus(ids.busB[t], `${t}:r`, NodeParam.BusSendAmount, tp.rev.send);
    }
    if (group !== "pattern") {
      // a track with its punch send off is neither fed to the punch section nor cut by a takeover
      const punched = tp.punch !== false;
      bus(ids.busC[t], `${t}:s`, NodeParam.BusSendAmount, punched ? (mix.takeover ? 1 : mix.boost) : 0);
      bus(ids.busC[t], `${t}:m`, NodeParam.BusMainGain, punched && mix.takeover ? 0 : 1);
    }
  }
  return out;
}

/** Every track's delay mode/time and reverb size for a pattern (the sends themselves are bus levels). `clamp` keeps a value inside
 * its effect parameter's range. */
export function trackFxWrites(ids: GraphIds, pattern: Pattern, clamp: (param: number, value: number) => number): Write[] {
  const out: Write[] = [];
  for (let t = 0; t < NUM_TRACKS; t++) {
    const { dly, rev } = pattern.tracks[t];
    const bus = ids.delayBus[t];
    const { dub, free } = ids.delayFx[t];
    const beat = dly.mode === 1;
    const fx = (b: BusId, effect: EffectId, key: string, param: NodeParam, value: number) =>
      out.push({ kind: "fx", key: `${t}:${key}`, bus: b, effect, param, value: clamp(param, value) });
    fx(bus, dub, "dubMix", NodeParam.DubDelayMix, beat ? 1 : 0);
    fx(bus, free, "freeMix", NodeParam.DelayMix, beat ? 0 : 1);
    if (beat) {
      const div = BEAT_DIVISIONS[Math.min(BEAT_DIVISIONS.length - 1, Math.max(0, dly.div))].value;
      fx(bus, dub, "dubDiv", NodeParam.DubDelayDivision, div);
      fx(bus, dub, "dubFb", NodeParam.DubDelayFeedback, DELAY_FEEDBACK_BEAT);
    } else {
      fx(bus, free, "freeTime", NodeParam.DelayTime, freeDelaySeconds(dly.time));
      fx(bus, free, "freeFb", NodeParam.DelayFeedback, DELAY_FEEDBACK_FREE);
    }
    fx(ids.reverbBus[t], ids.reverbFx[t], "decay", NodeParam.ReverbDecay, reverbDecay(rev.size));
    fx(ids.reverbBus[t], ids.reverbFx[t], "damp", NodeParam.ReverbDamping, reverbDamping(rev.size));
    for (const w of distWrites(ids, t, pattern.tracks[t].dist)) out.push(w);
    const { filter } = pattern.tracks[t];
    const f = (key: string, param: NodeParam, value: number) => out.push({ kind: "fx", key: `${t}:${key}`, bus: ids.trackBus[t], effect: ids.filterFx[t], param, value: clamp(param, value) });
    f("fMode", NodeParam.FilterMode, filter.mode);
    f("fCut", NodeParam.FilterCutoff, filterHz(filter.cut));
    f("fRes", NodeParam.FilterResonance, filterQ(filter.res));
  }
  return out;
}

/** A synth's distortion insert at amount `dist` (0..1): Saturation drive, output trim and mix, which move together. */
function distWrites(ids: GraphIds, track: number, dist: number): Write[] {
  const bus = ids.trackBus[track];
  const fx = (key: string, param: NodeParam, value: number): Write => ({ kind: "fx", key: `${track}:${key}`, bus, effect: ids.distFx[track], param, value });
  return [
    fx("satDrive", NodeParam.SatDrive, distDriveDb(dist)),
    fx("satOut", NodeParam.SatOutputGain, distTrimDb(dist)),
    fx("satMix", NodeParam.SatMix, distMix(dist)),
  ];
}

/** The writes that put knob `at` of `slot` on `track` at normalised `value`: an instrument parameter, the slot's level (its bus gain) or
 * its low-pass cutoff. A knob a sample has is read when a note triggers, so it writes nothing. The keys are the same for the base and a
 * lock, so they share caches. */
function slotWrites(ids: GraphIds, track: number, slot: 0 | 1, voice: VoiceSpec | undefined, at: number, value: number): Write[] {
  const c = controlAt(voice, at);
  if (!c) return [];
  const key = `${track}:${slot}:${at}`;
  if (c.dest === "level") return [{ kind: "bus", key, bus: ids.slotBus[track][slot], param: NodeParam.BusGain, value: levelToGain(value) }];
  const instrument = ids.inst[track][slot];
  if (c.dest === "sample" || instrument === undefined) return [];
  return [{ kind: "inst", key, instrument, param: c.param, value: normToUnits(c, value) }];
}

/** The engine writes that put parameter `p` of `track` at normalised `value` (one for most parameters; the distortion moves three
 * effect parameters). Their keys are the ones the mixer and sound writes use for the same parameter, so a lock and the base share caches. */
export function lockWrites(ids: GraphIds, rig: Rig, track: number, p: LockParam, value: number): Write[] {
  const t = p.target;
  if (t.kind === "sound") return slotWrites(ids, track, t.slot, trackProfile(rig, track).voices[t.slot], t.control, value);
  if (t.kind === "dist") return distWrites(ids, track, value);
  if (t.kind === "filter") {
    const cut = t.param === "cut";
    return [{ kind: "fx", key: `${track}:${cut ? "fCut" : "fRes"}`, bus: ids.trackBus[track], effect: ids.filterFx[track], param: cut ? NodeParam.FilterCutoff : NodeParam.FilterResonance, value: cut ? filterHz(value) : filterQ(value) }];
  }
  const delay = t.send === "dly";
  return [{ kind: "bus", key: `${track}:${delay ? "d" : "r"}`, bus: delay ? ids.trackBus[track] : ids.busB[track], param: NodeParam.BusSendAmount, value }];
}

/** A pattern's slot settings, in engine units: every knob of every slot's engine. */
export function soundWrites(ids: GraphIds, pattern: Pattern, rig: Rig): Write[] {
  const out: Write[] = [];
  for (let t = 0; t < NUM_TRACKS; t++) {
    const { voices } = trackProfile(rig, t);
    for (const slot of [0, 1] as const) {
      const v = voices[slot];
      if (!v) continue;
      const sound = pattern.tracks[t].slots[slot];
      for (let at = 0; at < sound.length; at++) out.push(...slotWrites(ids, t, slot, v, at, sound[at]));
    }
  }
  return out;
}

/** The mangler chain's values as effect writes (clamped to each parameter's range). */
export function manglerWrites(ids: GraphIds, values: ManglerValues, clamp: (param: number, value: number) => number): Write[] {
  return MANGLER_KEYS.map((key) => {
    const { fx, param } = MANGLER_PARAMS[key];
    return { kind: "fx", key, bus: ids.manglerBus, effect: ids.fx[fx], param, value: clamp(param, values[key]) };
  });
}

export class Groovebox {
  private readonly queue = new TimedQueue();
  /** Per track: A (fader, delay send), B (reverb send), C (punch send, takeover cut). */
  private readonly trackBus: BusId[] = [];
  private readonly busB: BusId[] = [];
  private readonly busC: BusId[] = [];
  private readonly delayBus: BusId[] = [];
  private readonly reverbBus: BusId[] = [];
  private readonly delayFx: Array<{ dub: EffectId; free: EffectId }> = [];
  private readonly reverbFx: EffectId[] = [];
  private readonly distFx: EffectId[] = [];
  private readonly slotBus: Array<[BusId, BusId]> = [];
  private readonly filterFx: EffectId[] = [];
  private readonly inst: Array<[InstrumentId | undefined, InstrumentId | undefined]> = [];
  private readonly manglerBus: BusId;
  private readonly fx = {} as Record<FxSlot, EffectId>;
  private readonly effectRange = new Map<number, { min: number; max: number }>();
  /** Last value of each mangler key as it will be once the scheduled segments have run. */
  private scheduled: Partial<ManglerValues> = {};
  private fxCache = new Map<string, number>();

  /** What each slot currently holds, as `VoiceSpec.key` (plus the sample for SAMPLE): what `syncRig` compares against. */
  private applied: string[][] = [];
  /** Slot sound writes by key, as last sent (NaN: unknown, send again). */
  private soundCache = new Map<string, number>();
  /** Per track: the write keys of each parameter a scheduled lock has put away from the base value (until a later step restores it), by lock id. */
  private lockedParams: Array<Map<string, string[]>> = Array.from({ length: NUM_TRACKS }, () => new Map());
  /** Every key in `lockedParams`: what the immediate base writes leave alone. */
  private lockedKeys = new Set<string>();
  /** Write keys an LFO is moving: the immediate base writes leave them alone, as for a lock. Per track, by lock id. */
  private lfoParams: Array<Map<string, string[]>> = Array.from({ length: NUM_TRACKS }, () => new Map());
  private lfoKeys = new Set<string>();
  /** The beat grid's anchor and tempo as last sent to the engine (what a synced LFO follows). */
  private gridAnchor = 0;
  private bpm = 120;
  private busCache = new Map<string, number>();
  private manglerCache: Partial<ManglerValues> = {};

  /** The shared samples loaded into webdsp, by library id: loaded once however many slots use one. */
  private readonly samples = new Map<string, { id: SampleId; length: number; rate: number }>();
  private readonly loading = new Map<string, Promise<void>>();
  /** Looping sample voices still sounding, by `track:slot`: released when the transport stops or the slot changes. */
  private readonly loops = new Map<string, Set<VoiceHandle>>();
  /** The last sample voice of each slot: a sample slot is monophonic, so a new hit releases it. */
  private readonly lastSample = new Map<string, VoiceHandle>();

  /** The graph's ids, for the pure write functions (and the native sequence, which writes the same parameters). */
  readonly ids: GraphIds;

  private constructor(readonly runtime: AudioRuntime, rig: Rig) {
    this.manglerBus = runtime.createBus();
    for (const [slot, kind] of [
      ["filter", EffectKind.Filter],
      ["sat", EffectKind.Saturation],
      ["crush", EffectKind.Bitcrusher],
      ["phaser", EffectKind.Phaser],
      ["flange", EffectKind.ChorusFlanger],
      ["dub", EffectKind.DubDelay],
      ["verb", EffectKind.Reverb],
    ] as const) {
      this.fx[slot] = runtime.addEffect(this.manglerBus, kind);
      for (const p of runtime.getEffectParams(kind)) this.effectRange.set(p.id, { min: p.min, max: p.max });
    }
    runtime.setEffectParameter(this.manglerBus, this.fx.filter, NodeParam.FilterMode, FilterMode.LowPass);
    runtime.setEffectParameter(this.manglerBus, this.fx.phaser, NodeParam.PhaserStages, 6);

    for (const kind of [EffectKind.Delay, EffectKind.DubDelay, EffectKind.Reverb]) {
      for (const p of runtime.getEffectParams(kind)) this.effectRange.set(p.id, { min: p.min, max: p.max });
    }
    for (let t = 0; t < NUM_TRACKS; t++) {
      const bus = runtime.createBus();
      const b = runtime.createBus();
      const c = runtime.createBus();
      const dly = runtime.createBus();
      const rev = runtime.createBus();
      this.trackBus.push(bus);
      this.busB.push(b);
      this.busC.push(c);
      this.delayBus.push(dly);
      this.reverbBus.push(rev);
      runtime.setNodeParameter(bus, NodeParam.BusOutput, b);
      runtime.setNodeParameter(b, NodeParam.BusOutput, c);
      runtime.setNodeParameter(bus, NodeParam.BusSendTarget, dly);
      runtime.setNodeParameter(bus, NodeParam.BusSendAmount, 0);
      runtime.setNodeParameter(b, NodeParam.BusSendTarget, rev);
      runtime.setNodeParameter(b, NodeParam.BusSendAmount, 0);
      runtime.setNodeParameter(c, NodeParam.BusSendTarget, this.manglerBus);
      runtime.setNodeParameter(c, NodeParam.BusSendAmount, 0);
      // wet-only returns; the inactive delay of the pair stays a pass-through (mix 0)
      const dub = runtime.addEffect(dly, EffectKind.DubDelay);
      const free = runtime.addEffect(dly, EffectKind.Delay);
      runtime.setEffectParameter(dly, dub, NodeParam.DubDelayTone, DELAY_TONE);
      runtime.setEffectParameter(dly, dub, NodeParam.DubDelayMix, 1);
      runtime.setEffectParameter(dly, free, NodeParam.DelayMix, 0);
      this.delayFx.push({ dub, free });
      const verb = runtime.addEffect(rev, EffectKind.Reverb);
      runtime.setEffectParameter(rev, verb, NodeParam.ReverbMix, 1);
      this.reverbFx.push(verb);
      // the distortion sits on bus A, so it follows both slots and comes before the fader and both sends; Saturation starts at mix 0, a pass-through
      this.distFx.push(runtime.addEffect(bus, EffectKind.Saturation));
      // ... and so does the LP/HP filter insert (a track shows one or the other, see TrackProfile.insert); at LP with the cutoff open it passes everything
      this.filterFx.push(runtime.addEffect(bus, EffectKind.Filter));
      // each slot has its own bus into bus A: its level
      const sb: BusId[] = [];
      for (let slot = 0; slot < 2; slot++) {
        const sbus = runtime.createBus();
        runtime.setNodeParameter(sbus, NodeParam.BusOutput, bus);
        sb.push(sbus);
      }
      this.slotBus.push([sb[0], sb[1]]);
      this.inst.push([undefined, undefined]);
      this.applied.push(["", ""]);
    }
    this.ids = {
      trackBus: this.trackBus, busB: this.busB, busC: this.busC, delayBus: this.delayBus, reverbBus: this.reverbBus,
      delayFx: this.delayFx, reverbFx: this.reverbFx, distFx: this.distFx, filterFx: this.filterFx, slotBus: this.slotBus,
      inst: this.inst, manglerBus: this.manglerBus, fx: this.fx,
    };
    this.applyManglerValues(baseValues());
    this.syncRig(rig);
    runtime.onVoiceEnded((voice) => { for (const set of this.loops.values()) set.delete(voice); });
  }

  /** `value` kept inside the effect parameter's range. */
  clampFx = (param: number, value: number): number => {
    const range = this.effectRange.get(param);
    return range ? Math.min(range.max, Math.max(range.min, value)) : value;
  };

  static async create(rig: Rig): Promise<Groovebox> {
    const runtime = await AudioRuntime.create({ workletModuleUrl: defaultWorkletUrl, maxVoices: 48 });
    await runtime.resume();
    const gb = new Groovebox(runtime, rig);
    // the samples the project's slots point at (the rest load when a slot first picks them)
    await gb.preloadSamples(rig);
    return gb;
  }

  get now(): number {
    return this.runtime.getCurrentTime();
  }

  /** Called by the shared ticker. */
  tick(): void {
    this.queue.flush(this.now);
  }

  /** Run `fn` at audio time `time`: now if it is due, otherwise from the ticker. */
  when(time: number | undefined, fn: () => void): void {
    if (time === undefined || time <= this.now + 0.004) fn();
    else this.queue.at(time, fn);
  }

  clearPending(): void {
    this.queue.clear();
  }

  // --- slots: which engine sounds where -------------------------------------------------------

  /** Make the engines in the slots the ones `rig` names: create or remove instruments where a slot changed, and nothing else. Both
   * slots of a track are independent: changing one never touches the other's instrument, bus or voices. */
  syncRig(rig: Rig): void {
    for (let t = 0; t < NUM_TRACKS; t++) {
      for (const slot of [0, 1] as const) {
        const v = voiceOf(rig[t][slot]);
        const want = v ? (v.engine === "sample" ? `sample:${rig[t][slot].variant}` : v.key) : "";
        if (this.applied[t][slot] === want) continue;
        this.applied[t][slot] = want;
        this.setSlot(t, slot, v);
        if (v?.engine === "sample") void this.ensureSample(rig[t][slot].variant);
      }
    }
  }

  /** Put engine `v` (or nothing) in a slot: release what the slot held, then build the new instrument on the slot's bus. */
  private setSlot(track: number, slot: 0 | 1, v: VoiceSpec | undefined): void {
    const old = this.inst[track][slot];
    if (old !== undefined) {
      this.runtime.instrumentNoteOff(old);
      this.runtime.removeInstrument(old);
      this.inst[track][slot] = undefined;
    }
    this.releaseLoops(`${track}:${slot}`);
    // what the engine held (cache, locks) is not the new engine's: send everything again
    this.forgetLocks();
    for (const k of [...this.soundCache.keys()]) if (k.startsWith(`${track}:${slot}:`)) this.soundCache.delete(k);
    if (v?.kind === undefined) return;
    const inst = this.runtime.createInstrument(v.kind, { bus: this.slotBus[track][slot] });
    this.inst[track][slot] = inst;
    this.runtime.setInstrumentParameter(inst, InstrumentCommonParam.Gain, v.gainDb);
    for (const [param, value] of v.fixed) this.runtime.setInstrumentParameter(inst, param, value);
  }

  // --- the shared sample library, in the engine ---------------------------------------------------

  /** Load library sample `id` into webdsp once (a second slot, or a second track, uses the same buffer). */
  ensureSample(id: string): Promise<void> {
    if (this.samples.has(id)) return Promise.resolve();
    let p = this.loading.get(id);
    if (!p) {
      p = (async () => {
        const bytes = await sampleBytes(id);
        if (!bytes) return;
        const meta = await this.runtime.loadSample(bytes.slice(0), { name: id });
        this.samples.set(id, { id: meta.id, length: meta.length, rate: meta.sampleRate });
      })().catch(() => undefined).finally(() => this.loading.delete(id));
      this.loading.set(id, p);
    }
    return p;
  }

  private preloadSamples(rig: Rig): Promise<unknown> {
    const ids = new Set<string>();
    for (const tr of rig) for (const sl of tr) if (sl.engine === "sample") ids.add(sl.variant);
    return Promise.all([...ids].map((id) => this.ensureSample(id)));
  }

  /** webdsp's id for library sample `id`, once it is loaded. */
  sampleRuntimeId(id: string): SampleId | undefined {
    return this.samples.get(id)?.id;
  }

  /** Drop a library sample from the engine (the user deleted it). Voices still playing it are stopped by webdsp. */
  unloadSample(id: string): void {
    const s = this.samples.get(id);
    if (!s) return;
    this.samples.delete(id);
    this.runtime.removeSample(s.id);
  }

  /** Audition a library sample (the sample modal's preview), straight to the master bus. */
  async previewSample(id: string): Promise<void> {
    await this.ensureSample(id);
    const s = this.samples.get(id);
    if (s) this.runtime.trigger({ sampleId: s.id, gain: 0.8 });
  }

  private releaseLoops(key: string): void {
    const set = this.loops.get(key);
    if (!set) return;
    for (const v of set) this.runtime.release(v);
    set.clear();
  }

  // --- notes ---------------------------------------------------------------------------------

  /** Play a track's note: each slot turns it into its own sound. `sounds` are the track's slot knobs (a sample reads its window and decay
   * from them). */
  note(track: number, rig: Rig, params: TrackNote, sounds: SlotSounds): void {
    for (const play of playSlots(rig, track, params, sounds)) {
      if (play.kind === "instrument") {
        const inst = this.inst[track][play.slot];
        if (inst !== undefined) this.runtime.instrumentNoteOn(inst, play.params);
      } else {
        this.triggerSample(track, play);
      }
    }
  }

  private triggerSample(track: number, play: Extract<SlotPlay, { kind: "sample" }>): void {
    const s = this.samples.get(play.sample);
    if (!s) {
      void this.ensureSample(play.sample);  // not loaded yet: this hit is lost, the next one plays
      return;
    }
    const start = Math.min(s.length - 1, Math.floor(play.start * s.length));
    const end = Math.max(start + 1, Math.floor(play.end * s.length));
    const seconds = (end - start) / s.rate / Math.pow(2, play.pitch / 12);
    // a one-shot fades over DECAY (never longer than the window, so it is silent before the sample ends); a loop is held, then released
    const envelope = play.loop
      ? { attack: 0, decay: 0, sustain: 1, release: 0.03 }
      : play.decay !== undefined ? { attack: 0, decay: Math.min(play.decay, seconds), sustain: 0, release: 0.01 } : undefined;
    const slotKey = `${track}:${play.slot}`;
    const prev = this.lastSample.get(slotKey);
    if (prev !== undefined) this.runtime.release(prev);
    const handle = this.runtime.trigger({
      sampleId: s.id, bus: this.slotBus[track][play.slot], time: play.time, gain: play.velocity, pitch: play.pitch, start, end,
      loop: play.loop, ...(play.duration !== undefined ? { duration: play.duration } : {}), ...(envelope ? { envelope } : {}),
    });
    this.lastSample.set(slotKey, handle);
    if (play.loop) {
      const key = slotKey;
      let set = this.loops.get(key);
      if (!set) this.loops.set(key, (set = new Set()));
      set.add(handle);
    }
  }

  /** Release held notes and drop scheduled ones (transport stop). */
  silence(): void {
    this.runtime.cancelScheduled();
    this.lastSample.clear();
    // the restores that were scheduled are gone with the rest: the engine may hold locked values, so forget what it holds
    this.forgetLocks();
    for (let t = 0; t < NUM_TRACKS; t++) {
      for (const slot of [0, 1] as const) {
        const inst = this.inst[t][slot];
        if (inst !== undefined) this.runtime.instrumentNoteOff(inst);
        this.releaseLoops(`${t}:${slot}`);
      }
    }
  }

  /** Forget what the engine holds of every lockable parameter (a lock may have left it away from the base), so the next apply sends it. */
  forgetLocks(): void {
    this.lockedParams.forEach((m) => m.clear());
    this.lockedKeys.clear();
    this.soundCache.clear();
    for (let t = 0; t < NUM_TRACKS; t++) {
      this.busCache.delete(`${t}:d`);
      this.busCache.delete(`${t}:r`);
      for (const key of ["satDrive", "satOut", "satMix", "fCut", "fRes"]) this.fxCache.delete(`${t}:${key}`);
      for (const slot of [0, 1]) {
        this.busCache.delete(`${t}:${slot}:${LEVEL_AT}`);
      }
    }
  }

  setTempo(bpm: number, anchorTime: number, time?: number): void {
    this.gridAnchor = anchorTime;
    this.bpm = bpm;
    this.runtime.setTempo(bpm, { anchorTime, time });
  }

  // --- sound ---------------------------------------------------------------------------------

  /** Push a pattern's slot settings to the engine; only changed values are sent. With a future `time` they are applied sample-accurately
   * at that instant (pattern changes). */
  applySound(pattern: Pattern, rig: Rig, time?: number): void {
    const future = time !== undefined && time > this.now + 0.004;
    const events: ScheduledParam[] = [];
    for (const w of soundWrites(this.ids, pattern, rig)) {
      if (this.soundCache.get(w.key) === w.value) continue;
      // a lock is sounding or scheduled on this control: the base comes back with the step that ends it (see scheduleLocks)
      if (!future && (this.lockedKeys.has(w.key) || this.lfoKeys.has(w.key))) continue;
      this.soundCache.set(w.key, w.value);
      if (!future) {
        if (w.kind === "inst") this.runtime.setInstrumentParameter(w.instrument, w.param, w.value);
        else if (w.kind === "bus") this.setBus(w.bus, w.key, w.param, w.value);
        else this.setFx(w.bus, w.effect, w.key, w.param, w.value);
      } else if (w.kind === "inst") {
        events.push({ time: time!, target: { instrument: w.instrument }, param: w.param, value: w.value });
      } else if (w.kind === "bus") {
        events.push({ time: time!, target: { bus: w.bus }, param: w.param, value: w.value });
        this.busCache.set(w.key, w.value);
      } else {
        events.push({ time: time!, target: { effect: { bus: w.bus, effect: w.effect } }, param: w.param, value: this.clampFx(w.param, w.value) });
        this.fxCache.set(w.key, w.value);
      }
    }
    if (events.length) this.runtime.scheduleParams(events);
  }

  /** Send one write now, if it changes what the engine holds. */
  private writeNow(w: Write): void {
    if (w.kind === "inst") {
      if (this.soundCache.get(w.key) === w.value) return;
      this.soundCache.set(w.key, w.value);
      this.runtime.setInstrumentParameter(w.instrument, w.param, w.value);
    } else if (w.kind === "bus") {
      this.setBus(w.bus, w.key, w.param, w.value);
    } else {
      this.setFx(w.bus, w.effect, w.key, w.param, w.value);
    }
  }

  /** Move the parameters the tracks' LFOs point at: each is sent its base value (or, with a lock on it, left alone) plus the LFOs' sum.
   * Called every tick. A parameter an LFO no longer moves goes back to its base value. */
  applyLfos(pattern: Pattern, rig: Rig): void {
    const time = this.now;
    for (let t = 0; t < NUM_TRACKS; t++) {
      const tp = pattern.tracks[t];
      const offsets = new Map<string, number>();
      for (const l of tp.lfos ?? []) {
        if (!l.on || !l.target || this.lockedParams[t].has(l.target)) continue;
        offsets.set(l.target, (offsets.get(l.target) ?? 0) + lfoOffset(l, time, this.gridAnchor, this.bpm));
      }
      const before = this.lfoParams[t];
      if (offsets.size === 0 && before.size === 0) continue;
      const now = new Map<string, string[]>();
      for (const [id, off] of offsets) {
        const p = lockParam(t, id);
        if (!p) continue;
        const writes = lockWrites(this.ids, rig, t, p, Math.min(1, Math.max(0, p.base(tp) + off)));
        now.set(id, writes.map((w) => w.key));
        for (const w of writes) this.lfoKeys.add(w.key);
        for (const w of writes) this.writeNow(w);
      }
      for (const [id, keys] of before) {
        if (now.has(id)) continue;
        // a step's lock took the parameter: the lock owns it until that step ends, so there is nothing to put back
        if (this.lockedParams[t].has(id)) { now.set(id, keys); continue; }
        for (const key of keys) this.lfoKeys.delete(key);
        const p = lockParam(t, id);
        if (p) for (const w of lockWrites(this.ids, rig, t, p, p.base(tp))) this.writeNow(w);
      }
      this.lfoParams[t] = now;
    }
  }

  /** Parameter locks for step `step` of `pattern`, which sounds at audio time `time`: the step's locked parameters go to the engine at
   * that time (sound controls as scheduled parameter writes, applied before that block's notes; sends from the ticker, as the mixer's
   * are), and a parameter the previous step locked that this one does not goes back to its base value. Nothing is sent for the common
   * step with no locks and none to undo. */
  scheduleLocks(pattern: Pattern, rig: Rig, step: number, time: number, run: number = step): void {
    const events: ScheduledParam[] = [];
    for (let t = 0; t < NUM_TRACKS; t++) {
      const tp = pattern.tracks[t];
      const locks = tp.steps[trackStepAt(pattern, t, step, run)].parameterLocks;
      const before = this.lockedParams[t];
      if (!locks && before.size === 0) continue;
      const now = new Map<string, string[]>();
      for (const p of lockParams(t)) {
        const locked = locks?.[p.id];
        if (locked === undefined && !before.has(p.id)) continue;
        const writes = lockWrites(this.ids, rig, t, p, locked ?? p.base(tp));
        if (locked !== undefined) now.set(p.id, writes.map((w) => w.key));
        for (const w of writes) {
          if (w.kind === "inst") {
            events.push({ time, target: { instrument: w.instrument }, param: w.param, value: w.value });
            this.soundCache.set(w.key, locked !== undefined ? NaN : w.value);
          } else if (w.kind === "bus") {
            this.when(time, () => this.setBus(w.bus, w.key, w.param, w.value));
          } else {
            events.push({ time, target: { effect: { bus: w.bus, effect: w.effect } }, param: w.param, value: this.clampFx(w.param, w.value) });
            // as for a sound control: while locked the engine's value is not the base, so the next base write must send
            if (locked !== undefined) this.fxCache.delete(w.key);
            else this.fxCache.set(w.key, w.value);
          }
        }
      }
      for (const keys of before.values()) for (const key of keys) this.lockedKeys.delete(key);
      for (const keys of now.values()) for (const key of keys) this.lockedKeys.add(key);
      this.lockedParams[t] = now;
    }
    if (events.length) this.runtime.scheduleParams(events);
  }

  // --- mixer + routing -----------------------------------------------------------------------

  /** `group` limits the bus writes: "pattern" leaves the punch section (bus C) alone. */
  applyMix(mix: MixInput, time?: number, group: "pattern" | "punch" | "all" = "all"): void {
    this.when(time, () => {
      for (const w of mixWrites(this.ids, mix, group)) if (w.kind === "bus" && !this.lockedKeys.has(w.key) && !this.lfoKeys.has(w.key)) this.setBus(w.bus, w.key, w.param, w.value);
      for (const w of trackFxWrites(this.ids, mix.pattern, this.clampFx)) if (w.kind === "fx" && !this.lockedKeys.has(w.key)) this.setFx(w.bus, w.effect, w.key, w.param, w.value);
    });
  }

  private setFx(bus: BusId, effect: EffectId, key: string, param: NodeParam, value: number): void {
    if (this.fxCache.get(key) === value) return;
    this.fxCache.set(key, value);
    const range = this.effectRange.get(param);
    this.runtime.setEffectParameter(bus, effect, param, range ? Math.min(range.max, Math.max(range.min, value)) : value);
  }

  private setBus(bus: BusId, key: string, param: NodeParam, value: number): void {
    if (this.busCache.get(key) === value) return;
    this.busCache.set(key, value);
    this.runtime.setNodeParameter(bus, param, value);
  }

  // --- mangler -------------------------------------------------------------------------------

  /** Write mangler values (only the ones that changed) to the shared effect chain. */
  applyManglerValues(values: ManglerValues): void {
    for (const key of MANGLER_KEYS) {
      if (this.manglerCache[key] === values[key]) continue;
      this.manglerCache[key] = values[key];
      // An immediate write says nothing about where the already-queued events will leave the chain, so
      // forget the scheduled value: the next scheduled step must send this key rather than assume it.
      delete this.scheduled[key];
      const { fx, param } = MANGLER_PARAMS[key];
      const range = this.effectRange.get(param);
      const v = range ? Math.min(range.max, Math.max(range.min, values[key])) : values[key];
      this.runtime.setEffectParameter(this.manglerBus, this.fx[fx], param, v);
    }
  }

  /** Written FX: from `time`, move the chain from `from` to `to` over `dur` seconds on the audio
   * clock (webdsp scheduled param ramps; the same events a sequencer automation lane would send).
   * Only keys that differ from where the previous segment left them are sent. */
  scheduleManglerSegment(from: ManglerValues, to: ManglerValues, time: number, dur: number): void {
    const events: ScheduledParam[] = [];
    for (const key of MANGLER_KEYS) {
      const { fx, param } = MANGLER_PARAMS[key];
      const range = this.effectRange.get(param);
      const clamp = (v: number) => (range ? Math.min(range.max, Math.max(range.min, v)) : v);
      const target = { effect: { bus: this.manglerBus, effect: this.fx[fx] } };
      const ramp = dur > 0 && from[key] !== to[key];
      if (!ramp && this.scheduled[key] === from[key]) continue;
      events.push(
        ramp
          ? { time, target, param, from: clamp(from[key]), value: clamp(to[key]), ramp: dur }
          : { time, target, param, value: clamp(from[key]) },
      );
      this.scheduled[key] = ramp ? to[key] : from[key];
      // the engine value is no longer the one the immediate path last wrote
      delete this.manglerCache[key];
    }
    if (events.length) this.runtime.scheduleParams(events);
  }

  /** Forget scheduled mangler state (transport start/stop): the next write sends everything. */
  resetManglerSchedule(): void {
    this.scheduled = {};
    this.manglerCache = {};
  }
}
