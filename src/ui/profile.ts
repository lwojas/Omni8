// What a track is, for the components: its profile follows the rig, so a component that reads it re-renders when an engine changes.
import type { CSSProperties } from "react";
import { trackProfile, type TrackProfile } from "../engine/catalogue";
import { useStore } from "../engine/store";

export const useProfile = (track: number): TrackProfile => useStore((s) => trackProfile(s.rig, track));

/** The track's accent colour as the `--acc` custom property its panel is styled with. */
export const accentOf = (profile: TrackProfile): CSSProperties => ({ "--acc": `var(${profile.accent})` }) as CSSProperties;
