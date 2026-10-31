// The LFO editor: three LFOs per track, each pointed at one parameter of the track (slot knobs, sends, the INSERT FX).
import { useMemo, useState } from "react";
import { slotControls, SLOT_NAMES } from "../engine/catalogue";
import { setLfo } from "../engine/actions";
import { formatLfoRate, LFO_DIVISION_NAMES, LFO_WAVES } from "../engine/lfo";
import { soundParam } from "../engine/plock";
import { useStore } from "../engine/store";
import { Knob } from "./controls";
import { Modal } from "./Modal";
import { accentOf, useProfile } from "./profile";

/** What a track's LFOs can move: [lock id, label]. A sample's window and decay are read when a note triggers, so they cannot be swept. */
function useTargets(track: number): Array<readonly [string, string]> {
  const profile = useProfile(track);
  return useMemo(() => {
    const out: Array<readonly [string, string]> = [];
    for (const slot of [0, 1] as const) {
      const v = profile.voices[slot];
      if (!v) continue;
      for (const { control, at } of slotControls(v)) {
        if (control.dest !== "sample") out.push([soundParam(track, slot, at).id, `${SLOT_NAMES[slot]} · ${control.label}`]);
      }
    }
    out.push(["fx.delaySend", "DELAY SEND"], ["fx.reverbSend", "REVERB SEND"]);
    if (profile.insert === "dist") out.push(["fx.distortion", "DISTORTION"]);
    else out.push(["fx.filterCut", "FILTER CUTOFF"], ["fx.filterRes", "FILTER RESONANCE"]);
    return out;
  }, [profile, track]);
}

function LfoRow({ track, index }: { track: number; index: number }) {
  const lfo = useStore((s) => s.patterns[s.pattern].tracks[track].lfos[index]);
  const targets = useTargets(track);
  const set = (patch: Partial<typeof lfo>) => setLfo(track, index, patch);
  const divN = LFO_DIVISION_NAMES.length;
  return (
    <section className="lfo-row" aria-label={`LFO ${index + 1}`} data-on={lfo.on}>
      <div className="lfo-head">
        <button type="button" className="btn sm" data-active={lfo.on} aria-pressed={lfo.on} onClick={() => set({ on: !lfo.on })}>LFO {index + 1}</button>
        <select className="chip variant" aria-label={`LFO ${index + 1} target`} value={lfo.target} onChange={(e) => set({ target: e.target.value, on: e.target.value ? true : lfo.on })}>
          <option value="">— TARGET —</option>
          {targets.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div className="lfo-body">
        <div className="seg" role="group" aria-label="Waveform">
          {LFO_WAVES.map((w, i) => (
            <button key={w} type="button" className="chip" data-active={lfo.wave === i} aria-pressed={lfo.wave === i} onClick={() => set({ wave: i })}>{w}</button>
          ))}
        </div>
        <button type="button" className="btn sm" data-active={lfo.sync} aria-pressed={lfo.sync} onClick={() => set({ sync: !lfo.sync })}>SYNC</button>
        <div className="knobs lfo-knobs" style={{ "--n": 2 } as React.CSSProperties}>
          {lfo.sync ? (
            <Knob key="div" label="RATE" value={lfo.div / (divN - 1)} def={0.5} steps={divN} readout={formatLfoRate(lfo)} onChange={(v) => set({ div: Math.round(v * (divN - 1)) })} />
          ) : (
            <Knob key="rate" label="RATE" value={lfo.rate} def={0.4} readout={formatLfoRate(lfo)} onChange={(v) => set({ rate: v })} />
          )}
          <Knob label="DEPTH" value={(lfo.depth + 1) / 2} def={0.75} readout={`${Math.round(lfo.depth * 100)}%`} onChange={(v) => set({ depth: Math.round((v * 2 - 1) * 100) / 100 })} />
        </div>
      </div>
    </section>
  );
}

/** The LFO button (under the INSERT FX faders of the sound panel) and the modal it opens. */
export function LfoButton({ track }: { track: number }) {
  const [open, setOpen] = useState(false);
  const profile = useProfile(track);
  const active = useStore((s) => s.patterns[s.pattern].tracks[track].lfos.some((l) => l.on && l.target));
  return (
    <>
      <button type="button" className="btn sm lfo-btn" data-active={active} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>LFO</button>
      <Modal open={open} title={`${profile.name} · LFOs`} onClose={() => setOpen(false)} className="lfo-modal">
        <div style={accentOf(profile)}>
          {[0, 1, 2].map((i) => <LfoRow key={i} track={track} index={i} />)}
        </div>
      </Modal>
    </>
  );
}
