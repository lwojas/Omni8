# Importing Hybrid.8 projects into webseq: feasibility (no code yet)

Status: investigation only. Nothing here is implemented. Read from `Omni8` (Hybrid.8, this repo), `webseq`, `Pulse8` and `webdsp`.
Everything marked **(verified)** was read in code; **(unverified)** needs the spike in §14 before anyone relies on it.

**Answer in one line:** yes, it is a sensible architecture and it needs no change to how Hybrid.8 loads, saves or plays. The
cost is not format complexity. It is one genuine model mismatch (§5, per-pattern sound), one data gap (§8, samples), and a
small amount of shared code (§3).

---

## 1. The two formats today

### Hybrid.8 export file (verified: `src/engine/persist.ts`)

```
{ app: "hybrid8", version: 1, name, project: Saved }        file: <name>.hybrid8.json
Saved = { projectName, rig, patterns[≤64 | null], chain[], chainOn, bpm, swing, pattern, scale, arp[8], mixMode, perfLevels[8] }
```

| Concern | Representation |
|---|---|
| Machines | `rig[8][2]` = `{engine: synth\|drum\|perc\|sample\|off, variant}`. `variant` is a voice key (`acid`, `kick`…) or a sample library id. **Project-wide, not per pattern.** |
| Parameters | `Pattern.tracks[t].slots[2][7]`: **normalised 0..1, positional** (knob index, LEVEL at 6). Units, curves, fixed params and voice trim (`gainDb`) live only in `catalogue.ts`/`spec.ts`, never in the file. |
| Patterns | 64 slots, `length` 16/32/48/64 steps; 64 steps always allocated; untouched ones serialised `null`. Step = `{on, note, acc, slide, gate?, parameterLocks?}`. |
| Chain / song | `chain: number[]` (indices into the 64, ≤64 entries) + `chainOn`. This is the whole "song". |
| Mixer | **Per pattern**: `level`, `mute`, `solo` (SONG mode); `perfLevels[8]` project-wide (PERFORM mode). |
| FX | **Per pattern, per track**: `dly{send,mode,time,div,fb}`, `rev{send,size}`, `dist`, `filter{mode,cut,res}`, `lfos[3]`, `punch`, `oct`, `last`. Per pattern: `fxLanes[3]` (recorded punch FX) and `mangler`. |
| Samples | By library id string. Factory ids (`sub-thump`, …) are generated in code; imports (`user:<n>`) are bytes in the browser's IndexedDB `samples` store and **are not in the file**. |
| Versioning | `version: 1` is written and **never read** by the loader. The real mechanism is shape-based: `parseProject` normalises and defaults every field, and the doc rule is "old projects must keep loading; add a step in `normalize`/`parseProject`". Unknown keys are ignored (the loader builds its result field by field). |

### webseq (verified: `src/model/types.ts`, `docs/project-files.md`, `docs/composer-song-mode.md`)

```
file: { kind: "webseq-project", formatVersion: 1, savedAt, project, assets: {id: base64} }     <name>.webseq.json
Project = { id, name, bpm, swing, beatsPerBar(16), tracks[], patterns[], patternChain[], master, assets[], scale?, composer? }
```

| Concern | Representation |
|---|---|
| Tracks | Fixed ids `track-1..track-64`; each is **one source**: a sample (`assetId`) or one synth (`instrument{kind, params{name→engine units}, lfos}`). |
| Patterns | `{id, name, bars, notes: Record<id, Note>}`. Notes carry `trackId`, `start`/`duration` in 16ths, `velocity`, `pitch`, `chord?`, `ratchet?`, `tie?`. A pattern spans all tracks. **A pattern holds no sound state.** |
| Song | `composer.lanes[].sequences[]` (start in bars; each sequence owns a cloned `composerOwned` pattern) plus the launcher `patterns`/`patternChain`. |
| Mixer | **Per project, per track**: `volume` (linear 0..1.5), `muted`, `soloed`, `pan`, `fx[]`, `automation[]`, `send {to, amount}` (one), `outputTrack` (any track, so tracks can feed tracks). |
| Versioning | Only the envelope `formatVersion`. Rule: new `Project` fields are additive and read through defaults; bump only if an old build can't read the file. |
| Identity | Ids come from a module counter plus `Math.random()` (`nextId`), and `Project.id` likewise. Assets are numeric and remapped on load (`remapAssetIds`). |

Both apps sit on webdsp and share its instrument kinds: Hybrid.8's `InstrumentKind.{Kick,Snare,Clap,HiHat,Tom,Bass,Fm,Pad,Edge,Hypersaw,PercSynth}`
are exactly webseq's `kick…edge, percsynth`. That is what makes a *structural* import possible at all.

## 2. What maps cleanly, and what does not

| Hybrid.8 | webseq | Verdict |
|---|---|---|
| Voice (drum, ACID, FM, PAD, PLUCK, SAW, PERC) | `Track.instrument{kind, params}` with the same webdsp kind | **Direct**, after resolving normalised → engine units, plus the voice's `fixed` params |
| Steps (note, acc→velocity 0.7/1, gate, slide→`tie`, `oct`) | `Note{start, duration, velocity, pitch, tie}` | **Direct** (§7) |
| `bpm`, `swing` (0.5..0.75) | `bpm`, `swing` (0.5..0.75) | **Direct** (same scale) |
| Pattern length 16/32/48/64 steps | `bars` 1..4 at `beatsPerBar` 16 | **Direct** |
| Chain | composer lane + `patternChain` | **Direct** (§7) |
| Hat choke group | `Track.chokeGroup` | Direct |
| Mono sample slot | `voiceMode: "mono"` | Direct |
| Shared factory/user sample | `Asset` + `assetId` | Needs bytes (§8) |
| Scale, root | `Project.scale` | Direct (both have `scale.ts` ancestry; check field parity in the spike) |
| Per-pattern knobs, level, sends, insert, LFOs | **no equivalent** | **The mismatch (§5)** |
| Parameter locks | no equivalent | Unsupported (§5, §12) |
| Punch FX (fxLanes, mangler, PUNCH bus) | no equivalent | Unsupported (§12) |
| Arpeggiator | webseq has its own, different semantics | Bake instead (§7) |
| Chord voice | `Note.chord` is scale-relative; CHORD voice is root + fixed tables | Partial (§12) |
| Two delay/reverb sends per track | **one** `send` per track | Needs a decision (§6) |

## 3. Where the conversion lives (decision 10)

The pattern you describe (source importer → generic representation → webseq) fits, with one simplification: **webseq's `Project`
is already plain, deterministic JSON, so it is the intermediate representation.** A second IR would be a third schema to keep in
sync. The separation comes from an importer interface instead:

```
src/import/
  types.ts        Importer { id; detect(json): boolean; import(json, ctx): ImportResult }
                  ImportResult { project, assetRequests[], report }
  registry.ts     [hybrid8Importer, pulse8Importer, …]; detect() picks one by the file's `app` stamp. Core never names a groovebox.
  report.ts       ImportReport (§12)
  hybrid8/        everything that knows Hybrid.8
```

`app` is already stamped (`hybrid8`; Pulse8 will have its own, and its file shape differs: per-track `sound` arrays, fixed track
roles, no rig), so detection needs no change to any groovebox. webseq's own `kind: "webseq-project"` never collides.

### The catch: the importer needs Hybrid.8's engine code, not just its file

The file stores *normalised positions*. Turning `slots[0][2] = 0.4` on an ACID slot into `decay = 0.31 s`, adding the voice's
`fixed` params and `gainDb`, and deciding what a step actually plays all live in `catalogue.ts`, `spec.ts`, `stepcompile.ts`,
`slots.ts`, `arp.ts`, `trackfx.ts`. This is deliberate in Hybrid.8 (retuning a range must not invalidate projects), and it
means a vendored copy in webseq would silently drift: the file carries no catalogue revision.

Options, in order of preference:

1. **Importer in webseq, importing Hybrid.8's pure engine modules as a dependency** (webseq already depends on
   `github:lwojas/webdsp`). Zero drift, and the importer can *run* `StepCompiler` + `playSlots` offline (§7), so arp, gate, slide,
   `oct`, per-track `last` and chord expansion come out exactly as Hybrid.8 would play them. Cost: the needed modules must be
   importable without DOM. `catalogue.ts`, `spec.ts`, `slots.ts`, `stepcompile.ts`, `arp.ts`, `trackfx.ts`, `chord.ts`, `lfo.ts`,
   `plock.ts` look pure (verified by reading imports) but `state.ts` pulls `samples.ts` → `db.ts` (IndexedDB, lazy) and `persist.ts`
   pulls `webdsp` host bridges. A thin `src/engine/bridge.ts` re-export (or a package `exports` subpath) draws the line. That is a
   re-export file in Hybrid.8, not a behaviour change.
2. **Vendored snapshot in webseq** with a pinned `catalogueRevision` check. Cheapest to start; drifts; needs the stamp in §9 to detect it.
3. **Hybrid.8 writes a neutral interchange export** (resolved engine units, baked notes, embedded samples). No drift and the
   cleanest webseq side, but it is exactly the "new export format" you want to avoid, and the groovebox gains an exporter.
   Keep as the fallback if option 1's packaging proves painful.

## 4. Hybrid 8 two-slot engines (decision 2)

Hybrid.8's actual topology (verified, `docs/dev/audio-graph.md`):

```
slot A engine ─▶ SLOT_A bus (LEVEL) ─┐
                                     ├─▶ [Saturation|Filter] ─▶ track fader/mute ─▶ delay/reverb sends ─▶ …
slot B engine ─▶ SLOT_B bus (LEVEL) ─┘
```

webseq has `outputTrack`, so the same shape exists with **no routing extension**:

```
webseq   Track "3 · ACID"     (instrument bass, volume = slot A gain)  ─ outputTrack ─┐
         Track "3 · SMPL"     (asset,           volume = slot B gain)  ─ outputTrack ─┤
         Track "3"  (group, no source: fx=[saturation|filter, delay, reverb], volume = track fader, mute) ─▶ master
```

Rules (all derived from the file alone; the rig is not an "import-oriented" extra, it is already explicit, so **no new slot
description is needed in the groovebox project**):

- Slot `off` → no track. Both off → nothing.
- A **group track** is created only when it does something: two live slots, or a non-transparent insert, or a send above 0 in a
  used pattern. A one-slot track with nothing else becomes a single track carrying slot and fader gain folded together.
  (Folding is exact when no distortion follows; with distortion the group is always created, because slot LEVEL changes how hard it is driven.)
- Pattern data is **duplicated, not divided**: both slots play the same track note in Hybrid.8. `playSlots` already produces the
  per-slot event (root-relative pitch for a pitched slot, bare hit for a drum beside a synth, sample pitch relative to the default
  note). The importer emits that per slot.
- Mute/solo: in SONG mode these are per pattern, and they are **baked** (§5) by omitting that track's notes from that pattern. No
  mixer state, no webseq solo-through-a-group subtlety (a soloed *group* gates its children off, since children are upstream, so it
  would need `soloed` on both children). The one audible difference: a muted track's delay/reverb tail rings out instead of cutting.
  Documented, not worked around.
- Genuinely coupled things: the insert, fader, sends, arp, `oct`, `last`, LFOs and `punch` are per *track*, shared by both slots.
  All are either baked into notes (arp, `oct`, `last`) or live on the group track. Nothing forces the two slots to stay one track.
- Layout: webseq banks are 16 tracks, a view only. 16 slot tracks fill bank 1, groups go in bank 2. Budget: ≤24 tracks/buses and
  ≤16 instruments (+ chord pools) against webdsp's 64/64. (webseq's `buses.ts` comment still says 32; `webdsp` says 64. Worth
  correcting before relying on either.)

## 5. The real mismatch: per-pattern sound versus per-project tracks (decisions 3, 7)

Hybrid.8's design says "sound, mix and FX travel with the pattern" (knobs, level, sends, filter, distortion, LFOs all change on
the bar line). webseq keeps instrument params, volume, FX and sends on the **track**, and its automation lanes are per track with
pattern-local positions replayed identically for every sequence (webseq docs list "automation that differs per sequence
instance" as *not done*). So webseq cannot express "pattern B has a brighter ACID than pattern A" with its current model.

What can be converted without any webseq change:

| Per-pattern state | Handling |
|---|---|
| mute / solo (SONG) | bake: drop the muted notes in that pattern |
| `oct`, `last` (polymeter), arp, gate, slide | bake via `StepCompiler` into explicit notes |
| `punch` flag | irrelevant unless punch FX are present |
| knobs, slot LEVEL, track level, dly/rev, dist, filter, LFOs | **only one value per track**; see below |

The state that varies across patterns needs one of three strategies. Recommend shipping the first and building the third
only if real projects need it:

1. **Snapshot + report (small).** Each track's sound is taken from the first pattern in which it is audible in the arrangement
   (deterministic rule); every parameter that differs in any *used* pattern is listed in the report with the pattern and values.
2. **Variant tracks (medium, no webseq change).** Where a track's sound diverges, emit one extra track per distinct sound state
   and route each pattern's notes to its variant. Faithful but multiplies tracks (budget above) and clutters the mixer. Opt-in.
3. **Sequence-scoped track overrides (medium-large, a generic webseq feature).** `Pattern.trackOverrides?: Record<TrackId,
   {instrumentParams?, volume?, send?, fxParams?}>`, applied when the sequence starts through the scheduled-parameter machinery
   automation already uses. Generic, additive, useful to webseq without any groovebox, and it closes the gap properly. This is
   the only item here that is real engine work in webseq.

Parameter locks are the same class of problem at step resolution. They have no webseq equivalent and cannot be baked into
track-level automation. Report them (count per track/pattern); a per-note override would be the same §5.3 mechanism extended.

## 6. Gain, mixer and routing (decisions 5, 6)

```
Hybrid.8                                                             webseq (proposed)
voice gainDb (InstrumentCommonParam.Gain, in the instrument)  ───▶  folded into slot-track volume
SLOT bus  BusGain = levelToGain(slotLevel)   (= l²·1.1)       ───▶  slot track volume  = levelToGain(slotLevel) · 10^(gainDb/20)
[Saturation | Filter] insert, then                            ───▶  group track fx chain (same order: bus FX run before BusGain)
bus A  BusGain = levelToGain(trackLevel), 0 if muted          ───▶  group track volume = levelToGain(trackLevel)
sends (taps after the fader, wet-only returns)                ───▶  see below
punch send from bus C                                          ───▶  unsupported
master → webdsp limiter                                        ───▶  same engine limiter
```

Verified: webseq does not set `InstrumentCommonParam.Gain` anywhere and its volume range (0..1.5 linear) comfortably holds the
largest Hybrid.8 gain (1.1). So gain is *computed from the same formulas Hybrid.8 uses*, not tuned by ear, by importing
`levelToGain` and `gainDb` from the same source (§3). Because the topology is the same (slot gain before insert, fader after),
drive interaction is preserved, which the naive "one track, one volume" mapping would not.

**Sends are the one place that needs a decision.** Hybrid.8 has per-track delay *and* reverb returns (wet only, with the send as
the level). webseq has one `send` per track, and the built-in delay/reverb FX are inserts with a dry/wet `mix`. webdsp's dub delay
is `dry·(1−mix) + wet·mix` (verified, `webdsp/docs/dub-delay.md`), which is not `dry + send·wet`.

- Insert approximation (no change): `mix = s/(1+s)` reproduces the wet/dry ratio, and a utility gain of `+20·log10(1+s)` dB after it
  restores the dry level. Exact for the first echo, close for feedback. **(unverified: needs a null test.)**
- Generic extension: `Track.sends[]` (several sends) instead of one. Small, additive, benefits webseq in general.

Recommend the insert approximation first and `sends[]` only if the null test shows an audible difference.

Routing otherwise needs **no extension**: track → group → master is expressible today with `outputTrack`.

## 7. Patterns and arrangement (decision 7)

```
Hybrid.8                               webseq
patterns[n] (used ones)        ──▶    Project.patterns  "P01".."P64"  (launcher sources, deterministic ids)
chain[i]                       ──▶    composer lane 1: sequence i = clone of pattern chain[i]   (composerOwned, start = running bars)
                                      patternChain: the same indices (so Pattern mode plays the same order)
chainOn = false                ──▶    one sequence of the current pattern (+ a report line)
```

- Each Hybrid.8 pattern covers all tracks, which is exactly what a webseq `Pattern` is. The underlying patterns are retained as
  launcher patterns; the composer holds independent clones, as it does today when you add a pattern to a lane.
- **Default: one lane**, because a chain step changes every track at once and one lane is the faithful form. A "lane per
  Hybrid.8 track" option (only that track's notes in each clone) fits the sketch in the brief and is a post-processing step
  on the same data. It multiplies clones ×8, so it should be an import option, not the default.
- Run the real compile path to get the notes: `StepCompiler.step` with `stepDur = 1`, `swing = 0.5` and a seeded `rnd`, so times
  come out directly in steps (= webseq beats) with swing left to `Project.swing`. Convert `acc` → velocity 0.7/1, `slide` → `tie`,
  `gateSteps` → duration, `pitch = note − root` (matching the instrument `tune`, so `tune` must be set to the voice's fixed `Tune`).
- Polymeter (`last`): a chain step starts a fresh run, so one pass of the pattern is deterministic and can be unrolled. With
  `chainOn` off, a looping pattern with a short-`last` track drifts forever; bake one pass and report it.
- Not carried: song position, cue, `page`, `selStep`, `mixMode` (performance state).

## 8. Samples and assets (decision 8)

- Factory samples are regenerated by deterministic code (`samples.ts`), so the importer can render them with the same functions
  and encode with webseq's `audio/wav.ts`. Stable id → `Asset` mapping, no duplication.
- **User samples (`user:<n>`) are not in the file.** The project cannot be imported with sound from the file alone. This is the
  *one* place the Hybrid.8 export would have to change. Smallest fix: an optional `samples: { "<id>": {name, base64} }` next to
  `project` in the envelope, written for the slots actually used (webseq's own `assets` does this). Existing loaders ignore it
  (verified: they read only `data.project`/`data.name`). Not required for phase A.
- Until then: an unresolved sample creates the track with `assetId: null`, an `unresolved` entry in the report, and the original id
  kept in track provenance (§9) so it can be relinked.
- Mismatch to handle: webseq stores envelope/gain on the **asset**, Hybrid.8's window/decay/loop on the **slot** (and per pattern).
  Two slots that use one sample differently need two `Asset` entries sharing bytes. Start/end windows map to webseq chop/cues or are
  baked into the asset; decide in the spike.

## 9. Versioning and capability metadata (decisions 4, 9)

Put it in three places, each small, none in the core model:

1. **Hybrid.8 file:** nothing mandatory. If option §3.1 is chosen, add an optional `exporter: { app, appVersion }` stamp (generic, no
   webseq knowledge, ignored by every existing loader). Do **not** bump `version: 1`: the loader never reads it, and bumping implies
   a break that does not exist.
2. **Importer:** its own `id` + `version`; a `supportedFileVersions` and a table of engines it understands. An unknown `engine` or
   `variant` is reported, not guessed. (Hybrid.8's own `normalizeRig` falls back to a default; the importer must *not* do that
   silently, because it is the safe behaviour for playing and the wrong one for converting.)
3. **webseq project (additive, opaque to the core):**
   ```
   Project.provenance?: { source: {app, fileVersion, exporterVersion?}, importer: {id, version}, report: ImportReport }
   Track.origin?:       { ref: string, meta?: Record<string, unknown> }   // e.g. "t3/slotA"; meta holds what could not be mapped
   ```
   The core never interprets `meta`. It is round-tripped so a later webseq (or a later importer) can use data that was
   unsupported today, which is the answer to "webseq gains support for an engine later". Per the project-file doc this is additive
   and needs no `formatVersion` bump.

I would not put an `import: {engine, parameters}` block on the webseq *instrument*. The instrument stays a pure webdsp kind +
params; provenance belongs on the track.

## 10. Backward compatibility (decision 4)

Hybrid.8 behaviour is untouched: no change to `Saved`, `parseProject`, `normalize` or the autosave. The importer is read-only over
the same file Hybrid.8 already writes.

Only additive, optional changes are proposed on the Hybrid.8 side, all ignorable by older builds: the `bridge.ts` re-export (§3), an
`exporter` stamp (§9), embedded `samples` (§8). webseq's changes are additive fields read through defaults, under the existing
rule. An old webseq opening a file with `provenance`/`origin` simply ignores them.

## 11. Determinism (decision 11)

The importer is a pure function of the file text plus explicit options. It never reads UI state, current defaults or `Math.random()`.
- webseq's `nextId` (random suffix) and `createInitialProject` are **not** used; the importer constructs the structure itself.
- Ids derive from source structure: patterns `hybrid8-p{nn}`, sequences `…-s{index}`, notes `…-t{track}-{step}`, tracks fill
  `track-1..` in the fixed order of §4, assets numbered by first use (they are remapped at install anyway).
- `Project.id` = hash of the file text, so importing the same file twice yields the same project (and replaces the earlier save,
  which is the desired behaviour; confirm with the owner).
- Seed for the arp's random direction is a fixed constant. Same file in, byte-identical project out; this is directly testable.

## 12. Fully / partially / un-supported (decision 12)

| Level | What | Importer behaviour |
|---|---|---|
| **Full** | Notes, tempo, swing, chain, drums/ACID/FM/PAD/PLUCK/SAW/PERC, factory samples, mute/solo (baked), `oct`, gates, slides, polymeter (one pass), arp (baked), static level/send/insert | Imported, listed in the summary |
| **Partial** | Sound varying by pattern (§5.1), CHORD voice (imported as root notes unless its types map onto webseq `CHORD_TYPES`; spike), LFOs (slot targets map onto `TrackLfo`; insert/send targets do not), sample window/decay, delay/reverb sends (approximation), missing user samples | Imported with a per-item warning naming the track, pattern and parameter |
| **Unsupported** | Parameter locks, punch FX lanes and the PUNCH bus, mangler, sound varying by pattern beyond the snapshot (until §5.3) | Not imported; **counted in the report** (e.g. "132 locked steps, 2 recorded punch takes") so nothing is lost silently |

An unknown engine/variant or a file that fails Hybrid.8's own `valid()` is refused with a message, never partially loaded (matching
Hybrid.8's "rejected whole" rule). The report is structured data, not strings:

```
ImportReport { ok, summary:{ tracksCreated, groupsCreated, patternsImported, sequences },
               splits:[{ source:"t3", into:["track-5","track-6","track-17"] }],
               warnings:[{ code, track?, pattern?, param?, detail }], unsupported:[…], unresolvedAssets:[…] }
```
Shown after import, and kept on `Project.provenance.report`.

## 13. Recommendation

**Yes.** The groovebox stays compact and unchanged; webseq becomes the arrangement environment. There is no architectural blocker
and no need for the groovebox to know about webseq. Two risks are worth stating plainly:

- The one genuinely lossy area is **per-pattern sound and parameter locks**. webseq's track-level model can't hold them today. The
  import is still musically correct for note content, arrangement and a single sound per track, and it tells the user exactly what
  differs. If projects that lean on per-pattern sound changes matter, §5.3 is the one feature worth building, and it is a
  generic webseq feature, not groovebox coupling.
- The importer **needs Hybrid.8's engine data** to be correct. Sharing it (§3.1) is the way to avoid drift; a copy is a time bomb.

Minimal architecture: registry + `hybrid8` importer in webseq, a `bridge.ts` in Hybrid.8, additive `provenance`/`origin` in webseq,
and the report. No change to Hybrid.8's format, loader or runtime.

### Changes

| | Hybrid.8 | webseq |
|---|---|---|
| **Required** | `src/engine/bridge.ts` (pure re-exports, no behaviour change) | `src/import/*`, `src/import/hybrid8/*`, a menu entry in `projectIO`, `Project.provenance?`, `Track.origin?`, report UI |
| **Nice to have** | `exporter` stamp; embedded `samples`; a note in `state-and-persistence.md` | `Track.sends[]`; sequence-scoped overrides (§5.3); lane-per-track import option |
| **Do not do** | bump `version`; change `Saved`/`valid()`; add arrangement UI; make the loader tolerate webseq files | add `if (source === …)` in core; add a groovebox-specific instrument type; store `import.parameters` on the instrument; copy the catalogue without a revision check |

### Effort

| Piece | Size | Why |
|---|---|---|
| Registry, report, id/determinism rules, webseq provenance fields | **Small** | Plain additive TS plus tests |
| Hybrid.8 importer: rig → tracks/groups, gain, notes via `StepCompiler`/`playSlots`, chain → composer, factory samples | **Medium** | Most logic exists in Hybrid.8 already; the work is mapping and tests |
| Sharing the engine modules between repos | **Small–Medium** | Mechanically small; the cost is the dependency decision |
| Embedded user samples (both repos) | **Small–Medium** | Additive; plus asset-per-slot handling |
| Sends beyond the insert approximation | **Small** | `sends[]` is a contained model change |
| Sequence-scoped overrides / per-note locks | **Large, architectural** | New scheduling behaviour in webseq's transport; not needed for a first useful import |

Phase A (usable import, report, snapshot sound) is **medium**. Nothing in it is risky.

## 14. Spike before committing (each is a day or less)

1. Do the pure Hybrid.8 modules import in a webseq (vitest, no DOM) build without pulling IndexedDB? (decides §3.1 vs §3.2)
2. **Null test**: render a Hybrid.8 pattern and its imported webseq equivalent offline through webdsp and compare levels (peak/RMS per
   track). This is the proof for §6's gain claims and the delay-insert approximation; the repo's `vst/test` rig is a starting point.
   Specifically confirm `InstrumentCommonParam.Gain` is applied at the instrument's output (so folding it into bus volume is exact)
   and what scale webseq `Note.velocity` reaches the voice at versus `VEL_NORMAL`/`VEL_ACCENT`.
3. Do webseq `ProjectScale` and Hybrid.8's `ProjectScale` have the same fields?
4. How often do real projects diverge per pattern? Run the §5.1 divergence report over your existing saves. That number decides
   whether §5.2/§5.3 is worth building.
5. CHORD voice versus webseq `CHORD_TYPES` equivalence, and LFO target name mapping.

## Open questions for the owner

- Which repo should own the importer (webseq, per this doc), and is a git dependency on Hybrid.8's engine modules acceptable?
- Is losing per-pattern sound changes (with a report) acceptable for a first version, or is that the thing you most use?
- Lane per track or one lane by default?
- Is re-importing the same file meant to replace the previous webseq project (content-hash id) or make a copy?
- Pulse8 and the other groovebox(es): same importer interface, separate modules. Should phase A include Pulse8 to validate that the interface is really source-agnostic?
