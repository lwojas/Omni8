# Network sync: investigation (no code yet)

Status: **proposal**. Nothing here is implemented. Written against the code at `5a3ba21`.

**Principle.** The network provides occasional knowledge of the shared musical timeline. The local audio engine remains responsible for actually keeping time.

## 0. What the code actually does (corrects two assumptions)

Read before the proposal, because it changes the answer.

1. **The sequencer is not in the AudioWorklet.** Scheduling is a lookahead loop in `Controller` (`src/engine/controller.ts`). A Worker `setInterval` (`ticker.ts`, 10 ms) calls `tick()`. `tick()` runs `scheduleStep()` for every step whose `gridTime` is inside `now + 120 ms`. Each step is handed to webdsp with an exact audio-clock time, and the audio thread plays it on the sample. The worklet receives timestamped events; it does not own a musical clock. The only tempo-aware thing in webdsp is the beat grid used by synced LFOs (`setTempo(bpm, {anchorTime})`).
2. **The musical clock is already a single scalar: `gridTime`.** It is the audio-clock time at which song step `stepCount` begins (swing is added per step on top). It advances by `15 / bpm` per step. A step is a 16th note. Position is `stepCount` (an integer, counted from play) plus `step`, `chainPos` and `run` for pattern state.
3. **An external-clock path already exists** for MIDI clock (`midi/clock.ts`, `midi/setup.ts`, `Controller.play({songStep,time})`, `Controller.followPhase(songStep,time)`). It does not replace the scheduler. It starts it aligned, then nudges `gridTime` by 25 % of the error per step, clamped to half a step. It plays `CLOCK_LATENCY` (50 ms) behind the sender and stops after 1 s of silence. Network sync is the same problem with a better-behaved source, so **it should be a second external-clock source on the same hooks**, not a new scheduler.
4. **There is no pause.** The transport has `play()` and `stop()` only. Stop silences and clears, and the next play starts from the top (or the chain start). Pause/continue is a groovebox feature that does not exist yet. See §7.
5. **Tempo changes are already phase-preserving locally.** `stepDur` is read from `state.bpm` at each `scheduleStep`, so a change applies from the next unscheduled step and `gridTime` stays continuous. `onState` also re-anchors the LFO beat grid at `gridTime`.

## 1. Recommended architecture

```
 master groovebox                relay (tiny, dumb)               follower groovebox
 ─────────────────             ──────────────────────           ──────────────────────
 Controller                                                       Controller
   timeline() ──► SyncSource ──ws──► room: last msg + fan-out ──ws──► SyncFollower (pure)
   (stepCount,                      only master may publish            model: bpm, n0, t0, playing
    gridTime,bpm,playing)                                              │
                                                                       ▼  every scheduleStep
                                                              gridTime += clamp(0.25·err, ±cap)
                                                                       ▼
                                                  existing lookahead scheduler → webdsp → worklet
```

Layers, each replaceable:

- **`SyncTransport`**: `send(msg)`, `onMessage(cb)`, `onState(cb)`. Implementations: WebSocket, and `BroadcastChannel` (two tabs on one machine, which is the zero-infrastructure development rig and test bench). Controller code never mentions WebSocket.
- **Timeline model** (pure, like `midi/clock.ts`): a snapshot in, `{bpm, playing, n0, t0}` out, in the receiver's own audio-clock terms, plus `timeOf(step)`. Unit-testable with synthetic jitter and drops.
- **Role** (`master` | `follower`) is a field in the hello message, **not** a property of which machine owns the socket (see §13: a browser cannot be a WebSocket server, so "A = server" cannot literally be true).

The network never sends steps. The master describes a line (`step = n0 + (t − t0)·bpm/15`); each follower extrapolates that line locally and keeps its own scheduler on it.

## 2. Recommended protocol

One state message, plus one hello. Start, stop, pause, tempo change and heartbeat are all the same message with different field values. They are all "here is the timeline now".

Rationale: separate `start`/`stop`/`tempo` messages each need their own loss handling and ordering rules. A state snapshot is idempotent. Losing one is harmless, because the next one is complete, and a late joiner needs nothing special.

| Field | Meaning |
|---|---|
| `v` | protocol version (1) |
| `p` | 1 = playing, 0 = stopped/paused |
| `bpm` | tempo |
| `n` | an **integer** song step (`stepCount`) |
| `t` | sender time, in ms, at which step `n` begins (see §5) |

Sending an integer step with its time avoids fractional positions and float rounding. "Step *n* begins at *t*" is exactly what the scheduler already holds as `(stepCount, gridTime)`.

No sequence numbers: WebSocket is TCP, so messages arrive in order per connection and a stale one cannot overtake a newer one. A stalled-then-flushed burst is handled by the min-filter in §5.

## 3. Message examples

```jsonc
// follower → relay, on connect (once)
{ "v":1, "hi":"follow", "room":"studio" }

// master → relay → followers. Heartbeat while playing (every 1000 ms), ~70 B
{ "v":1, "p":1, "bpm":128, "n":4096, "t":1789345.25 }

// master presses PLAY: step 0 will begin 100 ms from now. Sent immediately.
{ "v":1, "p":1, "bpm":128, "n":0, "t":1789350.00 }

// master changes BPM 128 → 132 while playing. Same message, sent immediately.
{ "v":1, "p":1, "bpm":132, "n":4098, "t":1789345.59 }

// master presses STOP. Sent immediately, then repeated at heartbeat rate.
{ "v":1, "p":0, "bpm":132, "n":0, "t":0 }
```

(`hi:"lead"` for the master. The relay accepts timelines from one lead per room only; a second lead is refused, and no consensus is attempted.)

## 4. Recommended sync interval

**1 message per second while playing, plus immediately on any change** (play, stop, tempo). Nothing is sent while stopped except the state change itself and a slow keep-alive (see §9).

Why 1 Hz is enough: the timeline is a *line*, not a sample. Between snapshots the follower keeps predicting on its own. The drift being corrected is the difference between two sound-card clocks (typically 20–100 ppm, so 0.02–0.1 ms of drift per second) plus constant offsets. Re-sending the same line 10×/s adds noise from network jitter and almost no information. Even 2–5 s would work; 1 s keeps join latency and failure detection short.

## 5. Recommended timestamp strategy

Terms: **musical position** (the step), **generation time** (when the master stamped it), **transit**, **receipt time** (follower `performance.now()`), **local audio time** (what the scheduler uses).

No wall clock and no NTP-style handshake. The problem is that `performance.now()` has a different origin on every page, so a bare sender timestamp is meaningless to the receiver. We need the **offset** between the two clocks, and we get it from the messages themselves:

1. **Master**: when sending, map `gridTime` (audio clock) to `performance.now()` using the *same* mapping `midi/setup.ts` already uses (`audioTime()` smooths `audio − perf/1000`). `AudioContext.getOutputTimestamp()` gives an exact pair and is better where available (check Safari support before relying on it). Send that as `t` (ms).
2. **Follower**: on each message compute `d = receiptPerfMs − t`. This is *offset + transit*. Keep `D = min(d)` over the last ~8–10 messages.
3. The master's `t` maps to the follower's perf-clock as `t + D`. Convert perf → audio with the follower's own mapping. **Anchor the model with `t + D`, never with the receipt time.**

Why min-filter: transit delay is always ≥ 0, so the *fastest* recent packet has the least delay in it. Jitter and delayed packets are ignored for free, and no separate smoothing is needed. A 10 s window also absorbs the ppm-level rate difference between the two perf clocks.

Residual error: the constant minimum one-way latency (wired LAN < 1 ms, Wi-Fi 1–5 ms) shows up as the follower playing that much late. Hardware output latency differs per machine much more than this (Bluetooth: 100+ ms).

- V1: ignore the residual, and provide a **manual SYNC OFFSET (ms)** per follower. It is a one-number trim applied to `t0`. That handles transit bias and output-latency differences in one control, and a musician will want it regardless.
- Only add ping/pong RTT/2 if measurement shows the bias matters. It adds a message type and is not needed for "perceptually tight".

Not needed: sequence numbers, per-message RTT, heartbeat timestamps beyond `t`, a clock-offset PLL.

## 6. Recommended phase correction strategy

### Comparison

| Strategy | Verdict |
|---|---|
| 1. Hard phase correction | Simple but audibly wrong for small errors: it is a flam/stutter on every correction, and one jittery packet moves the groove. Only acceptable as a rare safety valve. |
| 2. Gradual correction | Right for small errors. Notes are never retimed by more than a couple of ms; no state; converges by itself. |
| 3. Boundary correction | Adds nothing here: the scheduler's only correction opportunity *is* the step boundary, so gradual correction already happens at boundaries. Useful only for *entering* (joining at a bar line, §7). |
| 4. Hybrid | Collapses to **2 + a hard relocate for big errors**. The middle tier is unnecessary. |

**Recommendation: gradual correction every step, plus hard relocate above half a step.** It is substantially simpler than a "three-tier" system, because the correction is *stateless*: it is recomputed from the model at every step and never from "the last packet".

### The algorithm (plain language)

The follower holds one line: *step n0 begins at audio time t0, steps are `15/bpm` apart*. Packets only ever replace that line.

Every time the scheduler is about to schedule a step (every ~117 ms at 128 BPM):

```
ideal = t0 + (stepCount − n0) · 15/bpm      // where the master's grid says this step begins
err   = ideal − gridTime                     // + = we are early, − = we are late
if |err| > ½ step:   relocate (rare)         // §7
else:                gridTime += clamp(0.25·err, −CAP, +CAP)   // CAP ≈ 2 ms
```

So the follower shifts the *start of the next step* by a quarter of the error, never more than 2 ms. That is the existing `followPhase` idea, driven by the model each step instead of by each MIDI pulse. The follower plays no notes faster or slower; it just makes a step interval slightly longer or shorter than 117.2 ms for a while (115–119 ms, inaudible).

### Answer to the key question

> *Two grooveboxes at 128 BPM; one is 15 ms off the other. What does the receiving one do?*

One step is 117.2 ms; 15 ms is 0.13 of a step. Nothing is jumped, muted or retriggered. On each of the next steps it moves the next step's start towards the master's line by min(25 % of the remaining error, 2 ms): 15 → 13 → 11 → 9 → 7 → 5.3 → 3.9 → 3.0 → 2.2 → 1.7 → 1.2 → 0.9 ms. That is about **13 steps (~1.5 s) to get inside 1 ms**, under 1 s to get inside 3 ms. The only observable effect is that step lengths differ from 117.2 ms by ≤ 2 ms (1.7 %) during that second and a half. If the follower is *ahead*, the same thing happens with the sign reversed. It needs no packet at all to do this: the model is already there. A new packet just moves the line slightly.

Outputs of this design: no clicks (no note is cut), no flam (no event is duplicated), no jump (position never changes), no packet-by-packet reaction. A dropped packet just means the line keeps extrapolating; two sound cards 100 ppm apart drift 0.1 ms/s, so even 30 s of silence moves them ~3 ms.

### Noise handling
With the min-filter (§5) a single delayed packet changes nothing. A faster-than-ever packet can move `t0` earlier by the jitter amount at most once. The 25 % gain plus the 2 ms cap means that is smoothed over several steps.

## 7. Start / pause / stop semantics

**Start.** The master does not say "start now". It says "step 0 begins at time `t`", where `t` is its own `gridTime` for step 0. The master's `play()` currently starts 60 ms out (`gb.now + 0.06`). In master role raise that to **~100 ms** so a LAN message (1–5 ms) arrives with a large margin. The follower receives `p:1, n:0, t` and calls the existing `play({songStep:0, time: t→local audio})`, so it starts on the sample, at the same time as the master, not on receipt.

If the message is late (its start is already past, or within the controller's 30 ms floor), the follower does not start immediately; it joins at the model's **next bar line**. It computes the next step that is a multiple of 16 after `now + ~50 ms` and calls `play({songStep, time: timeOf(step)})`. Entering at a bar costs up to one bar of silence (1.9 s at 128 BPM) and avoids a mid-bar entry. A bar-quantised join is also what a late joiner does (relay replays the last timeline on connect).

**Stop.** `p:0`: the follower calls `controller.stop()` on receipt, with no scheduled stop time. Stopping a few ms late is inaudible (it is silence), and a scheduled stop would need a second timing path. Stop returns to the top as today: position is reset by the next play. This matches the groovebox's existing behaviour.

**Pause (needs a groovebox feature first).** Today the app has no pause. If pause/continue is added, define it as `p:0` with `n` = the paused step: *playing=false, position retained.* Continue is then a start with `n` ≠ 0. The follower treats `p:0, n>0` as pause (keep position, silence) and the next `p:1` as continue at step `n`. The protocol already carries everything. If pause is not built, V1 simply never sends `n>0` with `p:0`.

**Position mismatch.** The shared quantity is the song step counter, not the pattern. If follower and master have different pattern lengths or chains, they hold the same *grid* but loop differently. That is the user's choice and out of scope: pattern sync is a non-goal.

## 8. Tempo-change semantics

Tempo and phase are **one timeline update**, not two. When the master's BPM changes it sends `{bpm:new, n, t}`, where `(n, t)` is its next unscheduled step. This is exactly what its own `scheduleStep` is about to do. The follower:

1. replaces the model line (`bpm`, `n0`, `t0`), and sets `state.bpm` (so its UI, step length and LFO grid follow);
2. does **not** jump. Steps it already scheduled (≤ 120 ms of lookahead) keep their times; it re-evaluates `ideal` from the new line at the next step.

Because the line is re-anchored at the master's step/time, the follower's error right after a change is only the few ms of lookahead that used the old tempo: 128 → 132 BPM is 3.6 ms per already-scheduled step. The ordinary ±2 ms/step correction absorbs that within a few steps. Large jumps (e.g. 80 → 160, ~94 ms per step) exceed half a step and take the relocate path, which is correct (the follower should snap to the new grid).

Master and follower never need to agree on *when* the change happened; they only agree on the line.

## 9. Network failure behaviour

Design rule: **the follower is a complete, autonomous instrument. Lost network means a degraded sync indicator, not silence.**

| Event | Behaviour |
|---|---|
| Packet delayed | Ignored by the min-filter; nothing happens. |
| Packet dropped | Next one (≤ 1 s) replaces it. Idempotent state, so there is nothing to retransmit. |
| Brief disconnect (< ~5 s) | Keep playing on the last line. Drift ~0.1 ms/s. Indicator shows "searching". |
| Longer disconnect | Keep playing on the last line **indefinitely**; mark "detached". Do not stop the music, and do not take guesses at the master's state. |
| Master stops during the gap | Follower keeps playing (it never heard). On reconnect the next snapshot says `p:0` and it stops. Correct. |
| Master changes BPM during the gap | On reconnect the new line arrives; if the resulting error is < ½ step it slews, otherwise relocates (bar-quantised join). |
| Master disappears for good | Same as a long disconnect. The user can press STOP locally. Stop, play and tempo are local operations on the follower unless it is "locked". |
| Follower disappears | Master does not care (relay drops it). |
| Follower reconnects | Relay sends the last stored timeline immediately; the follower resumes within one packet. |
| Hidden or throttled tab | The 10 ms ticker is a Worker (unthrottled) and WebSocket messages still arrive. The existing ticker design already handles this. |

Staleness check: piggyback on the existing `tick()` (compare `performance.now()` to the last receipt). **No new timer.** The master heartbeat is sent from `tick()` too when `now ≥ nextSend`.

Contrast with MIDI clock in `setup.ts`: that source *stops* the transport after 1 s of silence, because MIDI pulses carry the whole tempo. Here the line carries it, so silence is survivable.

## 10. Estimated network traffic

Payload ~70 B JSON. WebSocket server→client frames add 2 B (unmasked) and TCP/IP/Ethernet ~66 B, so ~140 B on the wire per message.

Master fan-out is the cost that grows with clients (the master sends each message once to the relay; the relay replicates).

| Rate | Per follower | 2 followers | 4 followers | 8 followers |
|---|---|---|---|---|
| **1 Hz (recommended)** | 140 B/s | 0.3 KB/s | 0.6 KB/s | 1.1 KB/s |
| 5 Hz | 0.7 KB/s | 1.4 KB/s | 2.8 KB/s | 5.6 KB/s |
| 10 Hz | 1.4 KB/s | 2.8 KB/s | 5.6 KB/s | 11 KB/s |

Even the highest figure is negligible on any LAN. **Traffic is not a constraint; it is not a reason to choose a rate.** Accuracy and failure detection are, and they favour 1 Hz.

## 11. Performance considerations

- **Messages:** ~1/s. **Bytes:** ~70. **CPU per message:** a `JSON.parse` of 70 B, one `Math.min`, and three multiplications. Microseconds.
- **State kept:** `bpm, n0, t0, playing`, a window of ~8 offsets, a last-receipt time, and a status. Under 100 bytes.
- **Timers:** none new. Master heartbeat and follower staleness are checks inside the existing 10 ms `tick()`.
- **Audio thread:** untouched. The correction is computed in `scheduleStep` on the main side and arrives as an ordinary event time. **Zero allocation changes in the AudioWorklet.** `JSON.parse` allocates on the main thread only, at 1 Hz.
- **React:** no state updates per message. Only `syncStatus` (`off | connecting | locked | detached`) and `bpm` change the store, and rarely. No animation loop.
- **Correction cost:** one clamp-and-add per step (≈ 8/s).
- **Can correction be computed outside the worklet?** It already is. This is the central finding: no sequencer clock lives in the worklet, so there is nothing to retime there.

## 12. Required changes to the existing timing architecture

**webdsp: none.** No worklet change, no new message type, no new API. `setTempo` already re-anchors the LFO grid.

**Controller (`src/engine/controller.ts`), small:**

1. A read-only `timeline()` getter for the master: `{ playing, bpm, stepCount, gridTime }` (all already fields).
2. A way to give the controller a **phase model** (`n0, t0, bpm` or `null`). `scheduleStep` applies `gridTime += clamp(0.25·err, ±cap)` when the model is set. This is a ~6-line variant of `followPhase`; the existing `followPhase` can stay for MIDI clock, or be re-expressed as a model with a different gain.
3. A `relocate(songStep, time)` helper (= `stop()` then `play({songStep,time})`), which already exists in effect.
4. A follower-side **lock** flag so the UI disables local BPM edits while following (otherwise the user fights the master).

**New, pure modules (`src/sync/`):** `timeline.ts` (model plus min-filter, tested like `test/midi.test.ts`), `transport.ts` (interface plus `BroadcastChannel` and WebSocket implementations), `session.ts` (wiring), `relay/server.mjs` (Node `ws`, ~40 lines).

**Mutual exclusion:** MIDI clock follow and network follow both want the transport. Reuse the `ownsTransport` pattern: one external source at a time.

**UI:** a SYNC section in the menu (role, room/URL, status dot, offset trim). No effect on the sequencer view.

## 13. Risks and edge cases

1. **A browser cannot be a WebSocket server.** "Groovebox A = Server" cannot be literal. Either a small relay process runs on one LAN machine, or the transport is WebRTC. The master/follower relationship stays a protocol role, which the abstraction in §1 already allows.
2. **Secure context.** AudioWorklet requires a secure context, and `https` pages cannot open `ws://` LAN sockets (mixed content / private-network rules). Serving the groovebox from the relay over plain `http://192.168.x.x` also fails: not a secure context, so no AudioWorklet. Workable setups: (a) each machine runs the app from `localhost` (secure), connecting to `ws://<relay-LAN-ip>`; (b) the relay serves TLS with a locally trusted cert (mkcert); (c) a **WebRTC DataChannel** with copy/paste or QR signalling: no server at all and it works from the https deployment, at the cost of more code. **This is the biggest practical risk and it decides V1's deployment story, not the sync maths.** The existing deploy workflow suggests static https hosting; confirm before designing the relay.
3. **Output latency differs per machine** (USB interface vs. built-in vs. Bluetooth). The audio clock is not the speaker clock. A manual offset trim is required. Verify what `outputLatency` gives per browser before trying to automate it.
4. **Wi-Fi.** Power save and bursty retransmission add 10–100 ms to individual packets. The min-filter copes. Sustained high jitter raises the floor of the offset estimate; test on Wi-Fi early.
5. **Long-term drift** is small but real (100 ppm = 6 ms/min between two sound cards). The continuous correction keeps it in the noise. Without any packets for minutes, it is audible, which is what "detached" should signal.
6. **Perf-clock origin and the audio↔perf mapping.** Each page's `performance.now()` has its own origin. The audio↔perf mapping (`audioTime()` in `midi/setup.ts`) is a smoothed estimate with its own noise (a few ms) that is added to *every* snapshot. `getOutputTimestamp()` is preferable. Measure before settling.
7. **Different pattern lengths / chains** between boxes: grid-aligned but not bar-aligned. Documented, not solved.
8. **Synced LFOs** use the beat-grid anchor. Both boxes anchor at their own `gridTime`, so a follower's synced LFOs are in phase to within the sync error, but only if both started from step 0 together.
9. **Tempo change mid-lookahead** (§8): ≤ 4 ms transient at ordinary tempo moves; relocate on big jumps.
10. **AudioContext suspended** (no user gesture yet) on a follower: the model keeps updating but nothing plays until the user taps; then the bar-quantised join applies.
11. **Two masters / role confusion:** the relay accepts timelines from one `lead` only; no consensus.
12. **Relay is a single point of failure for new joins only.** Running followers keep playing (§9).
13. **Timestamp resolution:** `performance.now()` is coarsened to 0.1–1 ms in some browsers. Fine for ±2 ms steps.

## 14. Minimal implementation plan

Each phase ships on its own and is testable without the next.

1. **Pure model and tests (no UI, no network).** `sync/timeline.ts`: offset min-filter, `timeOf/stepAt`, the per-step correction function. Unit tests in the style of `test/midi.test.ts`: constant offset, jitter, dropped packets, 100 ppm drift, tempo change, big jump → relocate, late start.
2. **Controller hooks.** `timeline()`, phase-model correction in `scheduleStep`, relocate, BPM lock. Existing tests must stay green; `followPhase` behaviour for MIDI clock must not change.
3. **Same-machine loop.** `BroadcastChannel` transport plus a debug SYNC panel, two tabs: master and follower, log `err` per step. No infrastructure. This proves the maths and the hooks.
4. **Relay and WebSocket transport.** `relay/server.mjs` (room, one lead, last-message replay), resolve the deployment question in §13.2 first.
5. **UI.** Role, room, status, offset trim, BPM lock. Status only in the store.
6. **Measure on hardware.** Two machines on the LAN, both outputs recorded into one stereo interface (or both captured by a phone mic with a click pattern). Targets: |offset| < 5 ms steady state, convergence from a 20 ms error in ~1.5 s, no audible artifact on a 128 → 132 change, clean recovery after unplugging Ethernet / toggling Wi-Fi for 20 s.
7. **Later, only if measured need:** ping/pong RTT/2 for the transit bias; a scheduled stop time; a pause/continue transport feature; a WebRTC transport.

## Open questions for the owner

1. **Deployment of the relay / secure-context story** (§13.2): localhost on every machine, local TLS, or WebRTC?
2. **Pause:** build the groovebox feature first, or ship V1 with play/stop only?
3. **Master lead time:** is 100 ms (up from 60 ms) acceptable on the master's own PLAY while sync is on?
4. **Follower autonomy:** may a locked follower start/stop locally, or is it a pure slave to the master's transport?

## References (concepts only)

- **Ableton Link** (from memory, not re-checked): a shared *timeline* of tempo and beat/phase at a host time. Peers estimate clock offsets with ping/pong and a filter, correct phase continuously, and a quantum defines the phase that must match. Our design is the single-authority subset of this: a line (`bpm, n0, t0`), an offset estimate, continuous phase correction. We drop the peer-to-peer consensus and the ping/pong.
- **MIDI clock** (already in the app): shows the failure mode to avoid. 24 messages per beat make the *network* the clock and need jitter averaging.
- **Cristian / NTP min-delay filtering:** the "take the fastest recent packet" idea in §5.
- **Lookahead scheduling** ("A Tale of Two Clocks"): why the audio clock, not timers, is the time base. This repo already follows it.
