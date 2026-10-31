// User-level edits. UI components call these; they edit the store and (for immediate feedback)
// audition sounds. No React here.
import { normalizeArp, type ArpSettings } from "./arp";
import { controller } from "./controller";
import { defaultSlotSound, DRUM_VOICE_KEYS, SAMPLE_CONTROLS, trackProfile, voiceOf, type EngineId, type Rig, type SlotRig } from "./catalogue";
import { clearLocks, lockParam, setLock, soundParam } from "./plock";
import { importSample, loadUserSamples, removeUserSample, FACTORY_SAMPLES } from "./samples";
import { clearTrackSteps, GATES, newPattern, PAGE, randomizeTrack, type Pattern } from "./state";
import { BEAT_DIVISIONS, filterOpen, newFilter, type DelaySend, type ReverbSend, type TrackFilter } from "./trackfx";
import { editPattern, getState, setState } from "./store";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// --- steps -------------------------------------------------------------------------------------

/** Tap a step. Drums toggle. Melodic steps: tap an empty step to place a note and select it, tap an
 * unselected note to select it for editing, tap the selected note to remove it. */
export function tapStep(track: number, step: number): void {
  const st = getState();
  if (st.plock) return selectLockStep(track, step);
  const cur = st.patterns[st.pattern].tracks[track].steps[step];
  if (!trackProfile(st.rig, track).melodic) {
    editPattern((p) => {
      const s = p.tracks[track].steps[step];
      s.on = !s.on;
      s.acc = false;
    });
    setState({ focus: track });
    if (!cur.on) controller.audition(track);
    return;
  }
  const selected = st.focus === track && st.selStep === step;
  if (cur.on && selected) {
    editPattern((p) => { p.tracks[track].steps[step].on = false; });
    setState({ selStep: -1 });
    return;
  }
  if (!cur.on) editPattern((p) => { p.tracks[track].steps[step].on = true; });
  setState({ focus: track, selStep: step });
  controller.audition(track, cur.note);
}

/** Select a step (Shift+click) without changing it: drums get the ACCENT button for it, melodic steps their editor. */
export function selectStep(track: number, step: number): void {
  setState({ focus: track, selStep: step });
}

/** Long-press a step: select it (for a drum step, only select; a melodic step is also placed). */
export function holdStep(track: number, step: number): void {
  if (getState().plock) return selectLockStep(track, step);
  if (!trackProfile(getState().rig, track).melodic) return selectStep(track, step);
  editPattern((p) => { p.tracks[track].steps[step].on = true; });
  setState({ focus: track, selStep: step });
}

export function setStepNote(track: number, step: number, note: number): void {
  editPattern((p) => {
    const s = p.tracks[track].steps[step];
    s.note = note;
    s.on = true;
  });
  controller.audition(track, note);
}

export function toggleStepFlag(track: number, step: number, flag: "acc" | "slide"): void {
  editPattern((p) => {
    const s = p.tracks[track].steps[step];
    s[flag] = !s[flag];
    s.on = true;
  });
}

/** Set a step's gate length (index into `GATES`). */
export function setStepGate(track: number, step: number, gate: number): void {
  editPattern((p) => { p.tracks[track].steps[step].gate = Math.max(0, Math.min(GATES.length - 1, Math.round(gate))); });
}

// --- parameter locks (see plock.ts) -------------------------------------------------------------

/** P-LOCK mode on or off. Locks are never touched by this; leaving the mode just returns the pads to normal editing. */
export function setPlockMode(on: boolean): void {
  const st = getState();
  if (st.plock === on) return;
  // a drum step is only ever selected for locking: do not leave it looking selected in normal mode
  setState({ plock: on, ...(!on && !trackProfile(st.rig, st.focus).melodic ? { selStep: -1 } : {}) });
}

/** In P-LOCK mode a tap only selects the step (empty or not): nothing is added, removed or sounded differently. */
function selectLockStep(track: number, step: number): void {
  setState({ focus: track, selStep: step });
  if (!getState().playing) controller.audition(track, getState().patterns[getState().pattern].tracks[track].steps[step].note);
}

/** A lockable control moved (a sound knob, a send: `id` is its lock id). In normal mode it edits the base. In P-LOCK mode on the
 * focused track it writes only that parameter's lock on the selected step, and nothing when no step is selected (the base is not
 * for P-LOCK mode to change). A control of another track is not what P-LOCK mode is editing: it edits its base. */
export function setLockable(track: number, id: string, value: number): void {
  const st = getState();
  const p = lockParam(track, id);
  if (!p) return;
  if (st.plock && st.focus === track) {
    if (st.selStep < 0) return;
    editPattern((pat) => setLock(pat.tracks[track].steps[st.selStep], id, clamp01(value)));
    return;
  }
  if (p.target.kind === "sound") setSound(track, p.target.slot, p.target.control, value);
  else if (p.target.kind === "dist") setDistortion(track, value);
  else if (p.target.kind === "filter") setFilter(track, { [p.target.param]: value });
  else if (p.target.send === "dly") setDelay(track, { send: value });
  else setReverb(track, { send: value });
}

/** A sound knob of a slot moved: see `setLockable`. */
export const setSoundControl = (track: number, slot: 0 | 1, at: number, value: number): void => setLockable(track, soundParam(track, slot, at).id, value);

/** Remove every lock from a step; the step and the base sound stay as they are. */
export function clearStepLocks(track: number, step: number): void {
  editPattern((p) => clearLocks(p.tracks[track].steps[step]));
}

// --- sound / mix ---------------------------------------------------------------------------------

export function setSound(track: number, slot: 0 | 1, at: number, value: number): void {
  editPattern((p) => { p.tracks[track].slots[slot][at] = clamp01(value); });
}

// --- slots: which engine is where ------------------------------------------------------------------

/** Which slot of the focused track the sound panel edits. */
export function setSlotTab(slot: 0 | 1): void {
  setState({ slot });
}

/** Put `next` in a slot. Everything that belonged to what was there goes with it, in every pattern: the slot's knobs go back to the new
 * engine's defaults, steps lose their locks on that slot, and if the track stops or starts being melodic its steps and arp follow. The
 * other slot is not touched. */
function replaceSlot(track: number, slot: 0 | 1, next: SlotRig, keep?: (at: number) => boolean): void {
  const st = getState();
  const before = trackProfile(st.rig, track);
  const rig: Rig = st.rig.map((tr, t) => (t !== track ? tr : slot === 0 ? [next, tr[1]] : [tr[0], next] as const));
  const after = trackProfile(rig, track);
  const fresh = defaultSlotSound(after.voices[slot]);
  const lockPrefix = `slot.${slot === 0 ? "a" : "b"}.`;
  const notesMove = before.melodic !== after.melodic || before.lead !== after.lead;
  // the INSERT FX is distortion with a synth and the filter without: the one that goes away is switched off, with its locks
  const insertMoves = before.insert !== after.insert;
  const patterns = st.patterns.map((p): Pattern => ({
    ...p,
    tracks: p.tracks.map((tp, t) => {
      if (t !== track) return tp;
      const sound = tp.slots[slot].map((v, at) => (keep?.(at) ? v : fresh[at]));
      const slots: [number[], number[]] = slot === 0 ? [sound, tp.slots[1]] : [tp.slots[0], sound];
      const steps = tp.steps.map((s) => {
        const locks = s.parameterLocks && Object.fromEntries(Object.entries(s.parameterLocks).filter(([id]) => !id.startsWith(lockPrefix) && !(insertMoves && (id === "fx.distortion" || id.startsWith("fx.filter")))));
        const hasLocks = !!locks && Object.keys(locks).length > 0;
        const note = !notesMove ? s.note : !after.melodic ? after.defaultNote : Math.min(after.noteHi, Math.max(after.noteLo, before.melodic ? s.note : after.defaultNote));
        if (note === s.note && hasLocks === !!s.parameterLocks && (!locks || Object.keys(locks).length === Object.keys(s.parameterLocks!).length)) return s;
        const { parameterLocks: _drop, ...rest } = s;
        return { ...rest, note, ...(after.melodic ? {} : { slide: false }), ...(hasLocks ? { parameterLocks: locks } : {}) };
      });
      return { ...tp, slots, steps, ...(insertMoves ? { dist: 0, filter: newFilter() } : {}) };
    }),
  }));
  setState({
    rig, patterns, selStep: -1,
    ...(after.melodic ? {} : { arp: st.arp.map((a, t) => (t === track && a.on ? { ...a, on: false } : a)) }),
  });
}

/** Choose a slot's engine (OFF empties it). `sample` is the library sample a new SAMPLE slot starts on. */
export function setSlotEngine(track: number, slot: 0 | 1, engine: EngineId, sample = getState().library[0]?.id ?? ""): void {
  const cur = getState().rig[track][slot];
  if (cur.engine === engine) return;
  replaceSlot(track, slot, { engine, variant: engine === "drum" ? "kick" : engine === "sample" ? sample : "" });
  controller.audition(track);
}

/** Choose the drum voice of a DRUM slot (its knobs are those of the new voice). */
export function setDrumVoice(track: number, slot: 0 | 1, variant: string): void {
  const cur = getState().rig[track][slot];
  if (cur.engine !== "drum" || cur.variant === variant || !(DRUM_VOICE_KEYS as readonly string[]).includes(variant)) return;
  replaceSlot(track, slot, { engine: "drum", variant });
  controller.audition(track);
}

/** Choose the shared sample of a SAMPLE slot. The slot's mode, level and filter stay; its window goes back to the whole sample (the new one
 * is a different length, so the old START/END mean nothing to it). */
export function setSlotSample(track: number, slot: 0 | 1, id: string): void {
  const cur = getState().rig[track][slot];
  if (cur.engine !== "sample" || cur.variant === id) return;
  replaceSlot(track, slot, { engine: "sample", variant: id }, (at) => at !== SAMPLE_CONTROLS.start && at !== SAMPLE_CONTROLS.end);
  controller.audition(track);
}

/** True when `voiceOf` knows the slot (used by the UI to tell an empty slot from a filled one). */
export const slotFilled = (slot: SlotRig): boolean => voiceOf(slot) !== undefined;

export function setLevel(track: number, value: number): void {
  editPattern((p) => { p.tracks[track].level = clamp01(value); });
}

export function setDelay(track: number, patch: Partial<DelaySend>): void {
  editPattern((p) => {
    const d = p.tracks[track].dly;
    Object.assign(d, patch);
    d.send = clamp01(d.send);
    d.time = clamp01(d.time);
    d.div = Math.max(0, Math.min(BEAT_DIVISIONS.length - 1, Math.round(d.div)));
  });
}

export function setReverb(track: number, patch: Partial<ReverbSend>): void {
  editPattern((p) => {
    const r = p.tracks[track].rev;
    Object.assign(r, patch);
    r.send = clamp01(r.send);
    r.size = clamp01(r.size);
  });
}

/** Edit a track's filter insert. Changing the mode puts the cutoff at the new mode's open end, so switching never leaves the track closed. */
export function setFilter(track: number, patch: Partial<TrackFilter>): void {
  editPattern((p) => {
    const f = p.tracks[track].filter;
    if (patch.mode !== undefined && patch.mode !== f.mode) {
      f.mode = patch.mode === 1 ? 1 : 0;
      f.cut = filterOpen(f.mode);
    }
    if (patch.cut !== undefined) f.cut = clamp01(patch.cut);
    if (patch.res !== undefined) f.res = clamp01(patch.res);
  });
}

/** A track's distortion amount (0..1): the INSERT FX of a track with a synth. */
export function setDistortion(track: number, value: number): void {
  editPattern((p) => { p.tracks[track].dist = clamp01(value); });
}

export function setPunchSend(track: number, on: boolean): void {
  editPattern((p) => { p.tracks[track].punch = on; });
}

export function setOctave(track: number, oct: number): void {
  editPattern((p) => { p.tracks[track].oct = Math.max(-2, Math.min(2, oct)); });
}

/** Edit one track's arpeggiator settings (kept per track, saved with the project). */
export function setArp(track: number, patch: Partial<ArpSettings>): void {
  setState((s) => ({ arp: s.arp.map((a, i) => (i === track ? normalizeArp({ ...a, ...patch }) : a)) }));
}

export function toggleMute(track: number): void {
  setState((s) => ({ mutes: s.mutes.map((m, i) => (i === track ? !m : m)) }));
}

/** Set (not toggle) mute and solo: what an external control sends. */
export function setMute(track: number, on: boolean): void {
  setState((s) => (s.mutes[track] === on ? {} : { mutes: s.mutes.map((m, i) => (i === track ? on : m)) }));
}

export function setSolo(track: number, on: boolean): void {
  setState((s) => (s.solos[track] === on ? {} : { solos: s.solos.map((m, i) => (i === track ? on : m)) }));
}

export function toggleSolo(track: number): void {
  setState((s) => ({ solos: s.solos.map((m, i) => (i === track ? !m : m)) }));
}

/** Set one punch's character parameter. */
export function setPunchParam(id: number, value: number): void {
  editPattern((p) => { p.mangler.param[id] = clamp01(value); });
}

export function setSweep(index: number): void {
  editPattern((p) => { p.mangler.sweep = index; });
}

// --- pattern -------------------------------------------------------------------------------------

/** Set the pattern length. With `copyPage`, newly added bars are filled with a copy of that page. */
export function setLength(length: number, copyPage?: number): void {
  editPattern((p) => {
    if (copyPage !== undefined && length > p.length) {
      const from = copyPage * PAGE;
      for (let i = p.length; i < length; i++) {
        const src = from + (i % PAGE);
        for (const t of p.tracks) t.steps[i] = structuredClone(t.steps[src]);
        for (const lane of p.fxLanes) {
          lane.fx[i] = lane.fx[src];
          lane.fxLvl[i] = lane.fxLvl[src];
        }
      }
    }
    p.length = length;
    // a new length is the new last step of every track
    for (const t of p.tracks) delete t.last;
  });
  setState((s) => ({ page: Math.min(s.page, length / PAGE - 1), selStep: -1 }));
}

/** Set a track's last step (1-based, absolute across the bars). The pattern's full length is stored as "no last step". Steps past it keep their data. */
export function setLastStep(track: number, last: number): void {
  editPattern((p) => {
    const v = Math.min(p.length, Math.max(1, Math.round(last)));
    if (v >= p.length) delete p.tracks[track].last;
    else p.tracks[track].last = v;
  });
}

export function clearTrack(track: number): void {
  editPattern((p) => clearTrackSteps(p, track, getState().rig));
  setState({ selStep: -1 });
}

export function randomize(track: number): void {
  editPattern((p) => randomizeTrack(p, track, getState().rig, Math.random, getState().scale));
  setState({ selStep: -1 });
}

export function clearPattern(): void {
  const st = getState();
  const patterns = st.patterns.slice();
  patterns[st.pattern] = newPattern(st.rig);
  setState({ patterns, selStep: -1 });
}

// --- chain ---------------------------------------------------------------------------------------

export function removeChainEntry(index: number): void {
  setState((s) => ({ chain: s.chain.filter((_, i) => i !== index) }));
}

export function clearChain(): void {
  setState({ chain: [], chainOn: false });
}

// --- the shared sample library ---------------------------------------------------------------------

/** Read the user's imported samples from storage into the library (the factory set is always there). */
export async function refreshLibrary(): Promise<void> {
  setState({ library: [...FACTORY_SAMPLES, ...(await loadUserSamples())] });
}

/** Add an audio file to the library. Resolves to its id, or rejects with a message for the user. */
export async function importSampleFile(file: File): Promise<string> {
  if (file.size > 12 * 1024 * 1024) throw new Error("That file is too large (12 MB at most).");
  const bytes = await file.arrayBuffer();
  try {
    // decoded once here so a file the browser cannot read is refused now, not at the first note
    await new AudioContext().decodeAudioData(bytes.slice(0));
  } catch {
    throw new Error("That file could not be read as audio.");
  }
  const info = await importSample(file.name, bytes, getState().library);
  setState((s) => ({ library: [...s.library, info] }));
  void controller.engine?.ensureSample(info.id);
  return info.id;
}

/** Whether any slot of the project plays library sample `id`. */
export const sampleInUse = (id: string): boolean => getState().rig.some((tr) => tr.some((sl) => sl.engine === "sample" && sl.variant === id));

/** Remove an imported sample. Refused (false) while a slot uses it or for a factory sample. */
export async function deleteSample(id: string): Promise<boolean> {
  const info = getState().library.find((x) => x.id === id);
  if (!info || info.factory || sampleInUse(id)) return false;
  await removeUserSample(id);
  setState((s) => ({ library: s.library.filter((x) => x.id !== id) }));
  controller.engine?.unloadSample(id);
  return true;
}

/** Audition a library sample (the sample modal's play button). */
export function previewSample(id: string): void {
  void controller.engine?.previewSample(id);
}
