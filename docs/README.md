# Hybrid.8 documentation

## Using Hybrid.8

The **[User Guide](guide/01-getting-started.md)** walks through the instrument in the order you will meet it.

| | |
|---|---|
| [1 · Getting started](guide/01-getting-started.md) | The machine, the screen, your first five minutes |
| [2 · Sequencing](guide/02-sequencing.md) | Steps, notes, accent, slide, scales, the arpeggiator |
| [3 · Sound design](guide/03-sound.md) | Every instrument and every knob |
| [4 · Mixing & track FX](guide/04-mixing-and-track-fx.md) | Levels, delay and reverb sends |
| [5 · Punch FX](guide/05-punch-fx.md) | Performing and recording effects |
| [6 · Patterns & songs](guide/06-patterns-and-songs.md) | 64 patterns, cueing, chains |
| [7 · Projects & storage](guide/07-projects.md) | Autosave, saves, export and import |
| [8 · MIDI](guide/08-midi.md) | Controllers, DAWs, clock sync |
| [9 · Reference](guide/09-reference.md) | Limits, tables, shortcuts, troubleshooting |

## Building on Hybrid.8

The **developer documentation** explains how it works and how to change it.

| | |
|---|---|
| [Architecture](dev/architecture.md) | The two-slot instrument model, layers, modules, data flow, layout |
| [Audio graph](dev/audio-graph.md) | The webdsp topology: slot buses, inserts, sends and the punch chain |
| [Timing & scheduling](dev/timing.md) | Lookahead, swing, chaining, per-track loops, LFOs, note recording, external clock |
| [State & persistence](dev/state-and-persistence.md) | The data model (rig vs. pattern), storage, migrations |
| [Extending](dev/extending.md) | Recipes: knobs, engines, drum voices, samples, locks and LFO targets, punch FX, scales, parameters, MIDI |
| [VST3 build](dev/vst.md) | The optional, local-only plugin build; how the project survives closing the window; what it does not carry yet |
| [MIDI design](dev/midi.md) | Parameter ids, origins, echo, the keyboard, the clock follower, plugin plans |
| [Shelved engines](dev/shelved-engines.md) | PLUCK and SAW: out of the selector, still wired |
| [Design record](dev/hybrid8-plan.md) | The original audit and plan for the two-slot model (historical) |
| [Development](dev/development.md) | Setup, tests, invariants, deployment, known limits |
