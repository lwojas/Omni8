// The shared sample library, as a modal: pick the sample a SAMPLE slot plays. Deliberately small: browse, tap to choose, a play button to
// preview, and import / delete for the user's own files. No waveform, no editing: the slot's own knobs window and shape the sample.
import { useRef, useState } from "react";
import { deleteSample, importSampleFile, previewSample, sampleInUse, setSlotSample } from "../engine/actions";
import { SLOT_NAMES } from "../engine/catalogue";
import { useStore } from "../engine/store";
import { Modal } from "./Modal";
import { useProfile } from "./profile";

interface Props {
  open: boolean;
  track: number;
  slot: 0 | 1;
  onClose: () => void;
}

export function SampleModal({ open, track, slot, onClose }: Props) {
  const library = useStore((s) => s.library);
  const current = useStore((s) => s.rig[track][slot].variant);
  const profile = useProfile(track);
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError("");
    try {
      // a new sample is chosen for the slot straight away: importing is how you get the one you want
      setSlotSample(track, slot, await importSampleFile(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file could not be imported.");
    }
  };

  return (
    <Modal open={open} title={`Sample · ${profile.name} · SLOT ${SLOT_NAMES[slot]}`} onClose={onClose} className="sample-modal">
      <ul className="sample-list" aria-label="Samples">
        {library.map((s) => (
          <li key={s.id} className="sample-row" data-active={s.id === current}>
            <button type="button" className="btn sm sample-play" aria-label={`Preview ${s.name}`} onClick={() => previewSample(s.id)}>▶</button>
            <button
              type="button" className="sample-pick" aria-pressed={s.id === current}
              onClick={() => { setSlotSample(track, slot, s.id); onClose(); }}
            >
              <span>{s.name}</span>
              <small className="silk">{s.factory ? "FACTORY" : "IMPORTED"}</small>
            </button>
            {!s.factory && (
              <button
                type="button" className="btn sm" aria-label={`Delete ${s.name}`} disabled={sampleInUse(s.id)}
                title={sampleInUse(s.id) ? "Used by a slot" : "Delete this sample"} onClick={() => void deleteSample(s.id)}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="sample-foot">
        <button type="button" className="btn sm" onClick={() => file.current?.click()}>IMPORT…</button>
        <input ref={file} type="file" accept="audio/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        <span className="silk">{error || "SHARED BY EVERY TRACK · WAV / MP3 / OGG"}</span>
      </div>
    </Modal>
  );
}
