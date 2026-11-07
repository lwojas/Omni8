// The LFO editor: three LFOs per track, each pointed at one parameter of the track (slot knobs, sends, the INSERT FX).
import { useMemo, useState, type CSSProperties } from "react";
import { slotControls, SLOT_NAMES } from "../engine/catalogue";
import { setLfo, setPunchLfo } from "../engine/actions";
import { formatLfoRate, LFO_DIVISION_NAMES, LFO_WAVES, type Lfo } from "../engine/lfo";
import { FX_LFO_TARGETS, fxLfoActive, punchById } from "../engine/mangler";
import { soundParam } from "../engine/plock";
import { readAtTrigger } from "../engine/spec";
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
        if (!readAtTrigger(control)) out.push([soundParam(track, slot, at).id, `${SLOT_NAMES[slot]} · ${control.label}`]);
      }
    }
    out.push(["fx.delaySend", "DELAY SEND"], ["fx.reverbSend", "REVERB SEND"]);
    if (profile.insert === "dist") out.push(["fx.distortion", "DISTORTION"]);
    else out.push(["fx.filterCut", "FILTER CUTOFF"], ["fx.filterRes", "FILTER RESONANCE"]);
    return out;
  }, [profile, track]);
}

interface LfoEditorProps {
  lfo: Lfo;
  label: string;
  /** What it can point at: the value stored in `Lfo.target` and the name shown. */
  targets: ReadonlyArray<{ id: string; label: string }>;
  onChange(patch: Partial<Lfo>): void;
}

/** One LFO: on/off and target, then wave, SYNC, rate and depth. Shared by the tracks' LFOs and the Punch FX LFOs. */
function LfoEditor({ lfo, label, targets, onChange: set }: LfoEditorProps) {
  const divN = LFO_DIVISION_NAMES.length;
  return (
    <section className="lfo-row" aria-label={label} data-on={lfo.on}>
      <div className="lfo-head">
        <button type="button" className="btn sm" data-active={lfo.on} aria-pressed={lfo.on} onClick={() => set({ on: !lfo.on })}>{label}</button>
        <select className="chip variant" aria-label={`${label} target`} value={lfo.target} onChange={(e) => set({ target: e.target.value, on: e.target.value ? true : lfo.on })}>
          <option value="">— TARGET —</option>
          {targets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div className="lfo-body">
        <div className="seg" role="group" aria-label="Waveform">
          {LFO_WAVES.map((w, i) => (
            <button key={w} type="button" className="chip" data-active={lfo.wave === i} aria-pressed={lfo.wave === i} onClick={() => set({ wave: i })}>{w}</button>
          ))}
        </div>
        <button type="button" className="btn sm" data-active={lfo.sync} aria-pressed={lfo.sync} onClick={() => set({ sync: !lfo.sync })}>SYNC</button>
        <div className="knobs lfo-knobs" style={{ "--n": 2 } as CSSProperties}>
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

function LfoRow({ track, index }: { track: number; index: number }) {
  const lfo = useStore((s) => s.patterns[s.pattern].tracks[track].lfos[index]);
  const targets = useTargets(track).map(([id, label]) => ({ id, label }));
  return <LfoEditor lfo={lfo} label={`LFO ${index + 1}`} targets={targets} onChange={(patch) => setLfo(track, index, patch)} />;
}

/** The LFO button (under the INSERT FX faders of the sound panel) and the modal it opens. */
export function LfoButton({ track }: { track: number }) {
  const [open, setOpen] = useState(false);
  const profile = useProfile(track);
  const active = useStore((s) => s.patterns[s.pattern].tracks[track].lfos.some((l) => l.on && l.target));
  return (
    <>
      <button type="button" className="btn sm" data-active={active} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>LFO</button>
      <Modal open={open} title={`${profile.name} · LFOs`} onClose={() => setOpen(false)} className="lfo-modal">
        <div style={accentOf(profile)}>
          {[0, 1, 2].map((i) => <LfoRow key={i} track={track} index={i} />)}
        </div>
      </Modal>
    </>
  );
}

/** The Punch FX LFO of one pad: it moves that pad's macro 1 or 2 across the bars, whatever the steps do. */
export function PunchLfoButton({ punchId }: { punchId: number }) {
  const [open, setOpen] = useState(false);
  const punch = punchById(punchId)!;
  const lfo = useStore((s) => s.patterns[s.pattern].mangler.lfo[punchId]);
  const active = useStore((s) => fxLfoActive(s.patterns[s.pattern].mangler, punchId));
  const targets = FX_LFO_TARGETS.map((t, i) => ({ id: t.id, label: `${t.label} · ${punch.macros[i].label}` }));
  return (
    <>
      <button type="button" className="btn sm" data-active={active} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>LFO</button>
      <Modal open={open} title={`${punch.label} · LFO`} onClose={() => setOpen(false)} className="lfo-modal">
        <div style={{ "--acc": "var(--fx)" } as CSSProperties}>
          <LfoEditor lfo={lfo} label="LFO" targets={targets} onChange={(patch) => setPunchLfo(punchId, patch)} />
        </div>
      </Modal>
    </>
  );
}
