// Sound, mixer, FX mangler and pattern panels.
import { useRef, useState, type CSSProperties } from "react";
import { DRUM_VOICE_KEYS, DRUM_VOICES, ENGINES, defaultSlotSound, slotControls, SLOT_NAMES, type EngineId } from "../engine/catalogue";
import {
  clearChain, clearPattern, clearStepLocks, removeChainEntry, setDelay, setDrumVoice, setFilter, setLevel, setLockable, setPlockMode, setPunchParam,
  setPunchSend, setReverb, setSlotEngine, setSlotTab, setSound, setSoundControl, setSweep, toggleMute, toggleSolo,
} from "../engine/actions";
import { controller } from "../engine/controller";
import { PING_PONG, PING_PONG_NOW_STEPS, punchById, PUNCHES, SWEEPS } from "../engine/mangler";
import { hasLocks, lockStep, soundParam } from "../engine/plock";
import { formatControl, TRACKS } from "../engine/spec";
import { BANK_SIZE, defaultLevel, MAX_CHAIN, NUM_PATTERNS } from "../engine/state";
import { BEAT_DIVISIONS, defaultDelaySend, defaultReverbSend, DELAY_MODES, filterOpen, FILTER_MODES, formatDist, formatFilterHz, formatFreeDelay } from "../engine/trackfx";
import { getState, setState, useStore } from "../engine/store";
import { Knob, Slider } from "./controls";
import { Modal } from "./Modal";
import { ConfirmButton } from "./Sequencer";
import { accentOf, useProfile } from "./profile";
import { SampleModal } from "./SampleModal";


// --- sound -------------------------------------------------------------------------------------

function StripButton({ track }: { track: number }) {
  const focus = useStore((s) => s.focus === track);
  const profile = useProfile(track);
  return (
    <button
      type="button" role="tab" aria-selected={focus} className="strip-btn" data-active={focus}
      style={accentOf(profile)} onClick={() => setState({ focus: track, selStep: -1 })}
    >
      {profile.short}
    </button>
  );
}

function TrackStrip() {
  return (
    <div className="track-strip phone-only" role="tablist" aria-label="Track">
      {TRACKS.map((t) => <StripButton key={t.id} track={t.id} />)}
    </div>
  );
}

/** The two slot tabs of a track: which engine the panel below edits. They only choose; both slots always sound. */
function SlotTabs({ track }: { track: number }) {
  const slot = useStore((s) => s.slot);
  const profile = useProfile(track);
  return (
    <div className="slot-tabs seg" role="tablist" aria-label="Slot">
      {([0, 1] as const).map((i) => (
        <button
          key={i} type="button" role="tab" aria-selected={slot === i} className="chip" data-active={slot === i}
          aria-label={`Slot ${SLOT_NAMES[i]}: ${profile.voices[i]?.name ?? "empty"}`} onClick={() => setSlotTab(i)}
        >
          {SLOT_NAMES[i]} <span className="slot-name">{profile.voices[i]?.short ?? "—"}</span>
        </button>
      ))}
    </div>
  );
}

/** The engine names (nine at most) and, for DRUM and SAMPLE, what it plays: a drum voice or a shared sample. */
function EngineChips({ track, slot }: { track: number; slot: 0 | 1 }) {
  const rig = useStore((s) => s.rig[track][slot]);
  const library = useStore((s) => s.library);
  const [picking, setPicking] = useState(false);
  const sampleName = library.find((x) => x.id === rig.variant)?.name ?? "MISSING";
  return (
    <div className="chips" role="group" aria-label={`Slot ${SLOT_NAMES[slot]} engine`}>
      {ENGINES.map((e) => (
        <button key={e.id} type="button" className="chip" data-active={rig.engine === e.id} aria-pressed={rig.engine === e.id} onClick={() => setSlotEngine(track, slot, e.id as EngineId)}>
          {e.name}
        </button>
      ))}
      {rig.engine === "drum" && (
        <select className="chip variant" aria-label="Drum voice" value={rig.variant} onChange={(e) => setDrumVoice(track, slot, e.target.value)}>
          {DRUM_VOICE_KEYS.map((k) => <option key={k} value={k}>{DRUM_VOICES[k].name}</option>)}
        </select>
      )}
      {rig.engine === "sample" && (
        <>
          <button type="button" className="chip variant" aria-haspopup="dialog" aria-label={`Sample: ${sampleName}. Change`} onClick={() => setPicking(true)}>{sampleName} ▾</button>
          <SampleModal open={picking} track={track} slot={slot} onClose={() => setPicking(false)} />
        </>
      )}
    </div>
  );
}

/** The INSERT FX of a track with a synth: distortion (both slots ▶ distortion ▶ fader): one amount, lockable like the knobs. Under the knobs, on every layout. */
function DistortionBar({ track, locks }: { track: number; locks: Record<string, number> | undefined }) {
  const base = useStore((s) => s.patterns[s.pattern].tracks[track].dist ?? 0);
  const dist = locks?.["fx.distortion"] ?? base;
  return (
    <div className="dist-bar" role="group" aria-label="Distortion">
      <Slider label="DIST" value={dist} def={0} readout={formatDist(dist)} locked={locks?.["fx.distortion"] !== undefined} onChange={(v) => setLockable(track, "fx.distortion", v)} />
    </div>
  );
}

/** The INSERT FX of a track with no synth: efem's resonant filter, cutoff and resonance (lockable, like the knobs) and LP/HP. */
function FilterBar({ track, locks }: { track: number; locks: Record<string, number> | undefined }) {
  const filter = useStore((s) => s.patterns[s.pattern].tracks[track].filter);
  const cut = locks?.["fx.filterCut"] ?? filter.cut;
  const res = locks?.["fx.filterRes"] ?? filter.res;
  return (
    <div className="filter-bar" role="group" aria-label="Track filter">
      <Slider label="CUT" value={cut} def={filterOpen(filter.mode)} readout={formatFilterHz(cut)} locked={locks?.["fx.filterCut"] !== undefined} onChange={(v) => setLockable(track, "fx.filterCut", v)} />
      <Slider label="RES" value={res} def={0} locked={locks?.["fx.filterRes"] !== undefined} onChange={(v) => setLockable(track, "fx.filterRes", v)} />
      <div className="seg" role="group" aria-label="Filter type">
        {FILTER_MODES.map((m, i) => (
          <button key={m} type="button" className="chip" data-active={filter.mode === i} aria-pressed={filter.mode === i} onClick={() => setFilter(track, { mode: i as 0 | 1 })}>
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}

/** P-LOCK mode toggle and CLEAR (the selected step's locks), under the instrument knobs. */
function PlockBar({ track }: { track: number }) {
  const on = useStore((s) => s.plock);
  const selStep = useStore((s) => s.selStep);
  const locked = useStore((s) => s.plock && s.selStep >= 0 && hasLocks(s.patterns[s.pattern].tracks[track].steps[s.selStep]));
  return (
    <div className="plock-bar" role="group" aria-label="Parameter locks">
      <button type="button" className="btn sm" data-active={on} aria-pressed={on} onClick={() => setPlockMode(!on)}>P-LOCK</button>
      <button type="button" className="btn sm" disabled={!locked} aria-label="Clear the selected step's parameter locks" onClick={() => clearStepLocks(track, selStep)}>CLEAR</button>
      {on && <span className="silk">{selStep < 0 ? "SELECT A STEP, THEN TURN A KNOB" : `STEP ${selStep + 1} · KNOBS LOCK THIS STEP ONLY`}</span>}
    </div>
  );
}

export function SoundPanel() {
  const track = useStore((s) => s.focus);
  const slot = useStore((s) => s.slot);
  const profile = useProfile(track);
  const voice = profile.voices[slot];
  const baseSound = useStore((s) => s.patterns[s.pattern].tracks[track].slots[slot]);
  // In P-LOCK mode the knobs show the selected step: its locks over the base. Neither is changed by looking.
  const locks = useStore((s) => lockStep(s, track)?.parameterLocks);
  const plock = useStore((s) => s.plock);
  const playing = useStore((s) => s.playing);
  const baseDly = useStore((s) => s.patterns[s.pattern].tracks[track].dly.send);
  const baseRev = useStore((s) => s.patterns[s.pattern].tracks[track].rev.send);
  const dlySend = locks?.["fx.delaySend"] ?? baseDly;
  const revSend = locks?.["fx.reverbSend"] ?? baseRev;
  const punchSend = useStore((s) => s.patterns[s.pattern].tracks[track].punch !== false);
  const defaults = defaultSlotSound(voice);
  const controls = voice ? slotControls(voice) : [];
  return (
    <div className="sound" style={accentOf(profile)} data-plock={plock}>
      <TrackStrip />
      <header className="panel-title">
        <span className="dot" />
        <h2>{profile.name}</h2>
        <span className="silk">{voice?.desc ?? "EMPTY SLOT"}</span>
        <SlotTabs track={track} />
      </header>
      <EngineChips track={track} slot={slot} />
      <div className="sound-main">
      <div className="knobs" style={{ "--n": Math.max(1, controls.length) } as CSSProperties}>
        {controls.map(({ control: c, at }) => {
          // a sample's window and decay are read when a note triggers: they have a base value only, no step locks
          const lockable = c.dest !== "sample";
          const lockId = soundParam(track, slot, at).id;
          const value = (lockable ? locks?.[lockId] : undefined) ?? baseSound[at];
          return (
            <Knob
              key={`${track}-${slot}-${voice!.key}-${c.key}`}
              label={c.label}
              value={value}
              def={defaults[at]}
              steps={c.steps?.length}
              readout={formatControl(c, value)}
              locked={lockable && locks?.[lockId] !== undefined}
              onChange={(v) => (lockable ? setSoundControl(track, slot, at, v) : setSound(track, slot, at, v))}
              onTouch={() => { if (!playing && !plock) controller.audition(track); }}
            />
          );
        })}
        {!voice && <span className="silk empty-slot">PICK AN ENGINE FOR SLOT {SLOT_NAMES[slot]}</span>}
      </div>
      {profile.insert === "dist" ? <DistortionBar track={track} locks={locks} /> : <FilterBar track={track} locks={locks} />}
      </div>
      <PlockBar track={track} />
      <div className="sends" role="group" aria-label="FX sends">
        <span className="silk">SENDS</span>
        <div className="knobs sends-knobs">
          <Knob
            label="DLY" value={dlySend} def={defaultDelaySend(track)} accent="var(--fx)" locked={locks?.["fx.delaySend"] !== undefined}
            readout={`${Math.round(dlySend * 100)}%`} onChange={(v) => setLockable(track, "fx.delaySend", v)}
          />
          <Knob
            label="REV" value={revSend} def={defaultReverbSend(track)} accent="var(--fx)" locked={locks?.["fx.reverbSend"] !== undefined}
            readout={`${Math.round(revSend * 100)}%`} onChange={(v) => setLockable(track, "fx.reverbSend", v)}
          />
        </div>
        <button
          type="button" className="btn sm punch-send" data-active={punchSend} aria-pressed={punchSend}
          aria-label={`Send ${profile.name} to Punch FX`} onClick={() => setPunchSend(track, !punchSend)}
        >
          PUNCH FX
        </button>
      </div>
    </div>
  );
}

// --- mixer ---------------------------------------------------------------------------------------

function MixRow({ track }: { track: number }) {
  const spec = useProfile(track);
  const level = useStore((s) => s.patterns[s.pattern].tracks[track].level);
  const mute = useStore((s) => s.mutes[track]);
  const solo = useStore((s) => s.solos[track]);
  return (
    <div className="mix-row" style={accentOf(spec)} data-dim={mute}>
      <button type="button" className="mix-name" onClick={() => setState({ focus: track, selStep: -1 })}>{spec.tag}</button>
      <Slider label="LVL" value={level} def={defaultLevel(track)} onChange={(v) => setLevel(track, v)} />
      <span className="mix-ms">
        <button type="button" className="btn sm" data-active={mute} aria-pressed={mute} aria-label={`Mute ${spec.name}`} onClick={() => toggleMute(track)}>M</button>
        <button type="button" className="btn sm solo" data-active={solo} aria-pressed={solo} aria-label={`Solo ${spec.name}`} onClick={() => toggleSolo(track)}>S</button>
      </span>
    </div>
  );
}

export function MixerPanel() {
  return (
    <div className="mixer">
      <header className="panel-title">
        <span className="dot" />
        <h2>MIXER</h2>
        <span className="silk">LEVEL · MUTE · SOLO</span>
      </header>
      {TRACKS.map((t) => <MixRow key={t.id} track={t.id} />)}
    </div>
  );
}

// --- track FX: delay time/mode + reverb size (the sends live in the sound panel) ------------------------------------------------------

export function TrackFxPanel() {
  const track = useStore((s) => s.focus);
  const dly = useStore((s) => s.patterns[s.pattern].tracks[track].dly);
  const rev = useStore((s) => s.patterns[s.pattern].tracks[track].rev);
  const spec = useProfile(track);
  const beat = dly.mode === 1;
  const divN = BEAT_DIVISIONS.length;
  return (
    <div className="trackfx" style={accentOf(spec)}>
      <header className="panel-title">
        <span className="dot" />
        <h2>TRACK FX</h2>
        <span className="silk">{spec.name} · DELAY / REVERB</span>
      </header>
      <div className="tfx-groups">
        <section className="tfx-group" aria-label="Delay send">
          <div className="tfx-head">
            <span className="silk">DELAY</span>
            <div className="seg" role="group" aria-label="Delay timing mode">
              {DELAY_MODES.map((m, i) => (
                <button key={m} type="button" className="chip" data-active={dly.mode === i} aria-pressed={dly.mode === i} onClick={() => setDelay(track, { mode: i as 0 | 1 })}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="knobs tfx-knobs" style={{ "--n": 1 } as CSSProperties}>
            {beat ? (
              <Knob
                key="beat" label="TIME" value={dly.div / (divN - 1)} def={1 / (divN - 1)} steps={divN} accent="var(--fx)"
                readout={BEAT_DIVISIONS[dly.div].label} onChange={(v) => setDelay(track, { div: Math.round(v * (divN - 1)) })}
              />
            ) : (
              <Knob
                key="free" label="TIME" value={dly.time} def={0.5} accent="var(--fx)"
                readout={formatFreeDelay(dly.time)} onChange={(v) => setDelay(track, { time: v })}
              />
            )}
          </div>
        </section>
        <section className="tfx-group" aria-label="Reverb send">
          <div className="tfx-head"><span className="silk">REVERB</span></div>
          <div className="knobs tfx-knobs" style={{ "--n": 1 } as CSSProperties}>
            <Knob
              label="SIZE" value={rev.size} def={0.5} accent="var(--fx)"
              readout={`${Math.round(rev.size * 100)}%`} onChange={(v) => setReverb(track, { size: v })}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

// --- punch FX: performed, not mixed --------------------------------------------------------------

export function PunchPad({ id, compact }: { id: number; compact?: boolean }) {
  const def = PUNCHES.find((p) => p.id === id)!;
  const held = useStore((s) => s.punch === id);
  const pingPong = PING_PONG.has(id);
  const sweepSec = useStore(
    (s) => ((SWEEPS[s.patterns[s.pattern].mangler.sweep]?.steps ?? 0) || (pingPong ? PING_PONG_NOW_STEPS : 0)) * (15 / s.bpm),
  );
  const sel = useStore((s) => s.punchSel === id);
  return (
    <button
      type="button"
      className="punch"
      data-compact={compact}
      data-held={held}
      data-pingpong={pingPong || undefined}
      data-sel={sel}
      style={{ "--sweep": `${sweepSec.toFixed(3)}s` } as CSSProperties}
      aria-pressed={held}
      aria-label={`${def.label}: ${def.hint}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        controller.punchDown(id);
      }}
      onPointerUp={() => { if (getState().punch === id) controller.punchUp(); }}
      onPointerCancel={() => { if (getState().punch === id) controller.punchUp(); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <b>{def.label}</b>
      {!compact && <small>{def.hint}</small>}
    </button>
  );
}

export function WriteControls() {
  const write = useStore((s) => s.write);
  const fxPlay = useStore((s) => s.fxPlay);
  const erase = useStore((s) => s.erase);
  return (
    <div className="write-controls">
      <button type="button" className="btn write" data-active={write} aria-pressed={write} onClick={() => setState({ write: !write })}>
        <span className="rec-dot" /> WRITE
      </button>
      <button
        type="button" className="btn erase" data-active={erase} aria-pressed={erase}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setState({ erase: true }); }}
        onPointerUp={() => setState({ erase: false })}
        onPointerCancel={() => setState({ erase: false })}
      >
        ERASE
      </button>
      <button type="button" className="btn" data-active={fxPlay} aria-pressed={fxPlay} onClick={() => setState({ fxPlay: !fxPlay })}>
        FX ON
      </button>
      <ConfirmButton label="CLR" className="btn" onConfirm={() => controller.clearFxAll()} />
    </div>
  );
}

/** A compact punch row for the sequencer screen on small displays. */
export function PunchBar() {
  return (
    <div className="punchbar">
      <WriteControls />
      <div className="punch-row">{PUNCHES.map((p) => <PunchPad key={p.id} id={p.id} compact />)}</div>
    </div>
  );
}

export function ManglerPanel() {
  const m = useStore((s) => s.patterns[s.pattern].mangler);
  const sel = useStore((s) => s.punchSel);
  const write = useStore((s) => s.write);
  const def = punchById(sel) ?? PUNCHES[0];
  const value = m.param[def.id] ?? def.param.def;
  return (
    <div className="mangler" style={{ "--acc": "var(--fx)" } as CSSProperties}>
      <header className="panel-title">
        <span className="dot" />
        <h2>PUNCH FX</h2>
        <span className="silk">PERFORM · {def.label} · {def.hint}</span>
      </header>
      <div className="knobs mangler-knobs">
        <Knob
          key={def.id} label={def.param.label} value={value} def={def.param.def} steps={def.param.steps?.length} accent="var(--fx)"
          readout={def.param.format(value)} onChange={(v) => setPunchParam(def.id, v)}
        />
      </div>
      <div className="mangler-mid">
        <div className="chips" role="group" aria-label="Sweep time">
          <span className="silk">SWEEP IN</span>
          {SWEEPS.map((w, i) => (
            <button key={w.label} type="button" className="chip" data-active={m.sweep === i} aria-pressed={m.sweep === i} onClick={() => setSweep(i)}>{w.label}</button>
          ))}
        </div>
        <WriteControls />
      </div>
      <div className="punch-grid" data-write={write}>
        {PUNCHES.map((p) => <PunchPad key={p.id} id={p.id} />)}
      </div>
      <p className="hint silk">{write ? "WRITE ARMED · PLAY, THEN HOLD A PAD · THE SWEEP IS RECORDED" : "HOLD A PAD TO PERFORM · ARM WRITE TO RECORD THE SWEEP"}</p>
    </div>
  );
}

// --- patterns ------------------------------------------------------------------------------------

function Slot({ index }: { index: number }) {
  const active = useStore((s) => s.pattern === index);
  const playing = useStore((s) => s.playing && s.playPattern === index);
  const cued = useStore((s) => s.cue === index);
  const filled = useStore((s) => s.patterns[index].tracks.some((t) => t.steps.some((st) => st.on)));
  const chainIdx = useStore((s) => s.chain.indexOf(index));
  return (
    <button
      type="button" className="slot" data-active={active} data-playing={playing} data-cue={cued} data-filled={filled}
      aria-label={`Pattern ${index + 1}${filled ? "" : " (empty)"}`} aria-pressed={active}
      onClick={() => controller.selectPattern(index)}
    >
      {String(index + 1).padStart(2, "0")}
      {chainIdx >= 0 && <i className="slot-chain">{chainIdx + 1}</i>}
    </button>
  );
}

function PatternTools({ chainControls = true }: { chainControls?: boolean }) {
  const chain = useStore((s) => s.chain);
  const chainOn = useStore((s) => s.chainOn);
  const chainEdit = useStore((s) => s.chainEdit);
  const copyArm = useStore((s) => s.copyArm);
  return (
    <div className="ptn-tools">
      <button type="button" className="btn sm" data-active={copyArm} aria-pressed={copyArm} onClick={() => setState({ copyArm: !copyArm, chainEdit: false })}>
        {copyArm ? "TAP SLOT" : "COPY"}
      </button>
      <ConfirmButton label="CLEAR" onConfirm={clearPattern} />
      {chainControls && (
        <>
          <span className="silk tools-label">CHAIN</span>
          <button type="button" className="btn sm" data-active={chainEdit} aria-pressed={chainEdit} onClick={() => setState({ chainEdit: !chainEdit, copyArm: false })}>
            {chainEdit ? "DONE" : "EDIT"}
          </button>
          <button type="button" className="btn sm" data-active={chainOn} aria-pressed={chainOn} disabled={chain.length === 0} onClick={() => setState({ chainOn: !chainOn })}>
            {chainOn ? "ON" : "OFF"}
          </button>
          <button type="button" className="btn sm" onClick={clearChain} disabled={chain.length === 0} aria-label="Clear chain">CLR</button>
        </>
      )}
    </div>
  );
}

function ChainChips() {
  const chain = useStore((s) => s.chain);
  const chainOn = useStore((s) => s.chainOn);
  const chainEdit = useStore((s) => s.chainEdit);
  const chainPos = useStore((s) => s.chainPos);
  const playing = useStore((s) => s.playing);
  return (
    <div className="chain" aria-label={`Chain, ${chain.length} of ${MAX_CHAIN}`}>
      {chain.length === 0 && <span className="silk">{chainEdit ? "TAP SLOTS TO ADD" : "EDIT, THEN TAP SLOTS"}</span>}
      {chain.map((p, i) => (
        <button
          key={i} type="button" className="chain-chip" data-now={chainOn && playing && chainPos === i}
          aria-label={`Chain position ${i + 1}: pattern ${p + 1}, tap to remove`} onClick={() => removeChainEntry(i)}
        >
          {String(p + 1).padStart(2, "0")}
        </button>
      ))}
    </div>
  );
}

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** Pattern tab on phones: all 64 patterns, the tools and the chain. */
export function PatternsPanel() {
  const playing = useStore((s) => s.playing);
  return (
    <div className="patterns" style={{ "--acc": "var(--bass)" } as CSSProperties}>
      <header className="panel-title">
        <span className="dot" />
        <h2>PATTERNS</h2>
        <span className="silk">{playing ? "TAP TO CUE" : "TAP TO SELECT"}</span>
      </header>
      <div className="slots">{range(0, NUM_PATTERNS).map((i) => <Slot key={i} index={i} />)}</div>
      <PatternTools />
      <ChainChips />
    </div>
  );
}

const CHEVRON = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
);

/** Pattern navigation on wide screens: one bank of 16 under the transport (the bank holding the
 * current pattern), and MORE for the full 64 and the chain. */
export function PatternBar() {
  const playing = useStore((s) => s.playing);
  const bank = useStore((s) => Math.floor(s.pattern / BANK_SIZE));
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setState({ chainEdit: false, copyArm: false });
  };
  return (
    <div className="patternbar" role="group" aria-label="Patterns" style={{ "--acc": "var(--bass)" } as CSSProperties}>
      <span className="silk bar-label">{playing ? "PTN · CUE" : "PTN"}</span>
      <div className="slots">{range(bank * BANK_SIZE, BANK_SIZE).map((i) => <Slot key={i} index={i} />)}</div>
      <PatternTools chainControls={false} />
      <button ref={more} type="button" className="btn sm more" aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        MORE {CHEVRON}
      </button>
      <Modal open={open} title="Patterns & chain" onClose={close} className="ptn-modal" anchor={{ to: more, placement: "bottom", offset: 6 }}>
        <div className="patterns" style={{ "--acc": "var(--bass)" } as CSSProperties}>
          <div className="slots">{range(0, NUM_PATTERNS).map((i) => <Slot key={i} index={i} />)}</div>
          <PatternTools />
          <ChainChips />
        </div>
      </Modal>
    </div>
  );
}
