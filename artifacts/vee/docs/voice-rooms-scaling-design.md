# Vee Voice Rooms — Scaling Design: Thousands of Concurrent Listeners

**Status:** DESIGN ONLY. No implementation. No Zego code touched.
**Scope:** extension of the zero-cost migration plan (Track 3) for group voice rooms → self-hosted LiveKit SFU on Sumon's Windows VPS.
**Date:** 2026-10-05

---

## 1. The honest physics statement

**Thousands of simultaneous PUBLISHERS in one room on one server is not physically feasible** — and nobody in the industry does it. SFU fan-out is N×M: 1,000 publishers × 1,000 subscribers = **1,000,000** forwarded streams. The server would need to encrypt and push a million SRTP packet streams; the CPU and bandwidth math breaks on any affordable hardware.

The realistic architecture — and exactly what Clubhouse, Discord Stage Channels, and X Spaces do:

- **Thousands of LISTENERS (subscribers)** — cheap: each listener only *receives*.
- **Tens of speakers on STAGE (publishers)** — the only participants who *publish* audio.

Vee's existing **STAGE/AUDIENCE model is already this architecture**. Nothing about the product concept changes; scaling work is about enforcing the cap and squeezing the per-stream cost. The design target below is:

> **Up to 10,000 passive listeners + 10–20 simultaneous stage speakers per room on self-hosted LiveKit.**

If a requirement ever truly means "thousands of people talking at once," the correct answer is: not an SFU problem — that's either many parallel rooms (LiveKit handles unlimited rooms across nodes, each room independent) or a broadcast pipeline (LiveKit Egress to HLS/YouTube, with chat as the participation channel). That is out of scope for this design.

---

## 2. Capacity math (single LiveKit node, audio-only)

### 2.1 The formulas

All planning reduces to two formulas plus one CPU rule of thumb:

```
Per-listener downlink  =  N_active_speakers × stream_bitrate
Server egress          =  N_listeners × N_active_speakers × stream_bitrate × 1.2 (RTP/SRTP overhead)
Server ingress         =  N_publishers × stream_bitrate                        (negligible)
CPU rule of thumb      ≈  outbound_packets_per_second ÷ 75,000 per CPU core
```

The CPU rule comes from LiveKit's own published benchmark (docs.livekit.io/transport/self-hosting/benchmark.md): on a 16-core `c2-standard-16`, **10 audio publishers → 3,000 subscribers used 80% CPU**, driven almost entirely by packet rate (~959,000 packets/s outbound). LiveKit is a Go SFU: it never decodes/re-encodes audio, so **CPU per publisher is tiny; what burns CPU is SRTP-encrypting and forwarding each packet to each subscriber**. Each Opus stream at default 20 ms frames = 50 packets/s, so:

```
outbound_pps = N_listeners × N_speakers × 50
```

RAM is not the constraint (the Go process sits in the low hundreds of MB for thousands of participants).

### 2.2 Worst-case planning table

Assumes Opus at **24 kbps** (LiveKit speech preset) + 20% packet overhead ≈ **28.8 kbps per stream**, every speaker talking continuously (no DTX). This is the conservative ceiling — real traffic is much lower (see §3.1).

| Listeners | Speakers (seats) | Server egress | Listener downlink | Outbound pps | CPU cores needed |
|----------:|-----------------:|--------------:|------------------:|-------------:|-----------------:|
| 1,000 | 10 | **288 Mbps** | 288 kbps | 500k | ~7 |
| 1,000 | 20 | **576 Mbps** | 576 kbps | 1.0M | ~13 |
| 5,000 | 10 | **1.44 Gbps** | 288 kbps | 2.5M | ~33 |
| 5,000 | 20 | **2.88 Gbps** | 576 kbps | 5.0M | ~67 |
| 10,000 | 10 | **2.88 Gbps** | 288 kbps | 5.0M | ~67 |
| 10,000 | 20 | **5.76 Gbps** | 576 kbps | 10.0M | ~133 |
| 10,000 | 50 | 14.4 Gbps | 1.44 Mbps | 25.0M | ~330 |

Two conclusions jump out:

1. **Bandwidth, not CPU per publisher, is the real single-server ceiling.** At 10k listeners with 20 active speakers you need ~5.8 Gbps sustained egress — no cheap VPS has that.
2. **The speaker cap is the single most powerful lever.** Halving the speaker count halves egress, halves CPU, halves per-listener downlink. This is why the stage-seat cap (§3.3) is load-bearing for the whole design.

### 2.3 Realistic traffic (with the optimizations in §3)

In practice speakers are not all talking continuously. With **Opus DTX** (§3.1), silent speakers send almost nothing (a few comfort-noise frames). Conversation dynamics: at any moment only 2–4 of 10 seated speakers are actually speaking, and voice activity within speech is ~30–50%. The LiveKit benchmark itself averaged only ~3 kbps per publisher because most participants were muted. Realistic planning figures:

- Effective per-speaker average with DTX: **~8–12 kbps** (10 seated, conversational).
- Per-listener downlink with 10 speakers: **~100 kbps** — trivial for any mobile network.
- Server egress, 10k listeners × 10 speakers (DTX): **~1.0 Gbps** — fits a good 1 Gbps unmetered VPS, borderline on metered/shared 1 Gbps.

> Design rule: **plan VPS capacity on the worst-case table, expect DTX-realistic traffic in production, and verify with a real load test (§6).**

### 2.4 VPS spec recommendations

Windows VPS running `livekit-server.exe`. Key question for the provider is always the **sustained, unshared uplink speed** — many VPS plans advertise "1 Gbps" that is shared or burstable.

| Target | vCPU | RAM | Network | Notes |
|--------|------|-----|---------|-------|
| 1k listeners, 10–20 speakers | 8 | 8–16 GB | 1 Gbps unmetered (or ≥ 2 TB/mo metered) | Comfortable single box. Worst-case egress 576 Mbps < 1 Gbps. |
| 5k listeners, 10–20 speakers | 16 | 16 GB | ≥ 2–3 Gbps sustained egress, unmetered preferred | Bandwidth is binding. Confirm the provider's *actual* sustained uplink; many 1 Gbps plans saturate well below this. |
| 10k listeners, 10 speakers | 16–24 | 16–32 GB | 3–5 Gbps sustained egress, unmetered | Realistic only with DTX + 10-seat cap enforced. A single oversubscribed VPS will fail here. |
| 10k listeners, 20+ speakers | — | — | — | **Not recommended on one node.** See §4 (multi-node) or reduce the seat cap. |

Additional spec items to confirm on the VPS (regardless of tier):

- **Windows Firewall / provider firewall:** open signaling port `7880` (TCP), media UDP port range (default `7882`, or a range if configured), media TCP fallback `7881`, and TURN ports if using the embedded TURN server (`3478` UDP/TCP, `5349` TLS). UDP must be *actually* open — blocked UDP forces all media over TCP/TURN, which multiplies CPU cost.
- **Dedicated (not shared/burstable) CPU** for the SFU process at the 5k+ tiers. Burstable-credit CPUs collapse under sustained packet-forwarding load.
- **No bandwidth overage surprises:** get the metered cap in TB/month and the per-TB overage price in writing.

---

## 3. Audio optimizations for scale

### 3.1 Opus DTX (discontinuous transmission) — biggest single win
**Applies to: client (publish path).**

DTX tells the Opus encoder to stop sending packets when there's no speech (sending only occasional comfort-noise frames). With DTX, a muted-but-publishing or silent speaker costs essentially **zero** bandwidth and near-zero CPU instead of a full 24–32 kbps stream to every listener.

- In `livekit-client` this is the `dtx` flag on the audio publish options — it **defaults to `true`** in the LiveKit client SDKs, but the migration must explicitly confirm it is left on (and not silently disabled by a custom `AudioPublishOptions` construction) in the future `LiveKitRoomEngine` mic-publish code. Exact field names (`dtx`, audio bitrate/preset) must be verified against the installed `livekit-client` version at implementation time.
- Publish at the **speech preset** (~24 kbps max) rather than the music preset (~48 kbps). Voice rooms are speech; the music preset doubles every number in the §2.2 table for no audible benefit.
- Caveat (honest): DTX can clip the first ~20–40 ms of very soft speech onsets on some devices. Keep it on — the bandwidth saving (2–4× in conversational use) outweighs this — but don't set the noise gate / VAD threshold aggressively.

### 3.2 Subscriber-side: only subscribe to active speakers (top-N loudest)
**Applies to: client (subscribe path).**

Today's model subscribes each listener to every seated speaker. With a 10-seat cap this is fine, but the scaling design adds an explicit top-N mechanism for larger stages or belt-and-braces:

- Listen to LiveKit's `RoomEvent.ActiveSpeakersChanged` (SFU-computed, no extra cost).
- Keep the top-N loudest speaker tracks subscribed; call `setSubscribed(false)` on the rest, re-subscribing when they re-enter the active-speaker set.
- This is what the new optional `VoiceEngine.setSubscriptionMode('active-speakers-only', topN)` surface in `voiceEngine.ts` is for (additive, behavior-neutral — Zego adapter simply doesn't implement it).

Priority note: **the seat cap (§3.3) achieves 90% of this benefit with zero client complexity.** Active-speaker subscription is a secondary lever, most valuable if the seat cap is ever raised above ~20.

### 3.3 Stage seat cap enforcement — the load-bearing control
**Applies to: client + Firebase (existing seat system) + server config.**

The codebase already has everything needed:

- Seats array is fixed at **10** (`VoiceRoomScreen.tsx:176`, `seatsRef` at `:197`).
- Audience members **never publish**: join adds them to the Firebase audience list only (`VoiceRoomScreen.tsx:638–652`), and the auto-publish guard (`:531–563`) calls `startPublishing()` **only** when the user takes a seat. `leave`/`stopPublishing` on unseat is wired at `:1034–1045`.
- Host mute flows through `seat.muted` in Firebase (`firebaseRoomService.ts:538–544`, toggleSeatMute) — server-authoritative, no client trust issues.
- `joinSeat` (`VoiceRoomScreen.tsx:855–887`) + `handleMicBarPress` (`:895–912`) are the only publish entry points — so the cap is enforced by the data model itself: no seat, no publish.

Design decision: **keep the seat array fixed-size and treat its length as the publisher cap.** If a room type later needs more stage speakers (e.g., 20 for events), make it a per-room-type constant configured at room creation (stored in the room's Firebase doc), not a user choice — because every added seat multiplies server egress by `N_listeners × 28.8 kbps`.

Belt-and-braces (server side): set `room.max_participants` in `livekit.yaml` (or per-room via `RoomServiceClient.createRoom`) as a hard ceiling on total room occupancy, so a runaway client can never exceed planned capacity. And in the future token endpoint (`POST /api/livekit/token`), issue audience tokens with `canPublish: false` and seat-holder tokens with `canPublish: true` — defense in depth on top of the Firebase seat model.

### 3.4 `livekit.yaml` server knobs that matter for scale

Honest framing first: **there is no server-side "Opus bitrate cap" knob in livekit.yaml — audio bitrate is negotiated client-side at publish time** (§3.1). The server-side knobs that actually matter for a high-listener deployment:

| Knob | Why it matters at scale |
|------|------------------------|
| `rtc.udp_port` / `rtc.tcp_port` | Media ports; must be open and reachable. A single UDP mux port is fine (multiplexed, not per-participant). |
| `rtc.use_external_ip` | Correct public IP advertisement; without it, media fails behind NAT and everything falls back to TURN (expensive). |
| Embedded TURN (`turn.enabled`, `turn.tls_port`, `turn.udp_port`) | Required for strict-NAT/corporate listeners. TURN relay multiplies server bandwidth+CPU per relayed user — monitor the relayed fraction; >10–15% relayed warrants attention. |
| `room.max_participants` | Hard per-room ceiling (defense in depth for the seat/audience model). |
| `room.empty_timeout` / `room.departure_timeout` | Reclaim resources from dead rooms; matters when running many rooms on one box. |
| `redis` block | Only for multi-node mode (§4). Leave absent for single-node. |
| `keys` (API key/secret) | Keep the secret on the api-server only — the token endpoint signs tokens server-side after Firebase ID-token verification (pattern already exists at `api-server/src/routes/notifications.ts:108–133`). |

### 3.5 What NOT to add

- No server-side audio mixing (MCU-style) — destroys the zero-cost premise (decoding/encoding thousands of streams needs serious CPU/GPU).
- No recording/transcription on the media box — each steals CPU and bandwidth from live forwarding; LiveKit Egress, if ever needed, runs on a separate machine.
- No video/screenshare in voice rooms — one video track re-introduces video-bitrate fan-out and invalidates every table in §2.

---

## 4. Horizontal scaling path — FUTURE WORK, not now

### When to consider it (signals)

- Sustained LiveKit CPU **> 70%** during peak rooms, or
- Egress bandwidth saturating the VPS uplink (packet loss / jitter rising with listener count), or
- A single room's worst-case egress (per §2.2) exceeds what one VPS tier can provide at acceptable cost.

Do **not** pre-build this. Single-node LiveKit with the seat cap + DTX covers the 1k–5k listener range comfortably, and LiveKit's official benchmark shows 10 publishers → 3,000 subscribers at 80% CPU on 16 cores — the headroom is real.

### The design (no implementation)

1. **Deploy N `livekit-server` nodes + one Redis.** In `livekit.yaml` on each node, add the `redis` block (shared room registry + message bus). Nodes auto-discover; the token endpoint needs **no change** — it keeps signing tokens; clients connect to a load-balanced URL and the cluster routes the room to the least-loaded node (nodes above `sysload_limit` are excluded).
2. **Hard constraint to design around: one room lives on exactly one node.** Redis clustering scales *across rooms*, not *within* a room. A single 10k-listener mega-room still needs one node big enough for it. If the product ever needs >10k listeners in *one* room, the answer is broadcast egress (HLS), not more SFU nodes.
3. **What changes:** infrastructure only — N Windows/Linux boxes (Linux is fine for nodes; cheaper), Redis, a TCP/UDP-capable load balancer (note: WebRTC media is UDP — use DNS-based or L4 routing, not an HTTP-only LB), `livekit.yaml` on each node.
4. **What does NOT change:** client code, the `VoiceEngine` interface, the stage/audience model, the token endpoint contract, Firebase seat signaling. This is the payoff of the Track 3 abstraction.

### Cost note

Redis + extra nodes = extra VPS tiers. Still self-hosted and zero per-minute fees, but it is no longer "one box." The cost-adjacent caveat in §5 applies doubly here.

---

## 5. Zero-cost posture + honest caveats

- **Software cost stays $0:** LiveKit server is open-source (Apache 2.0 for the SFU), `livekit-client` is free, Firebase RTDB signaling for 1-to-1 was already the plan, and no per-participant-minute fees exist when self-hosting.
- **The one cost-adjacent caveat:** bandwidth. At 10k listeners the binding resource is VPS egress (2.9–5.8 Gbps worst-case, ~1 Gbps DTX-realistic). If Sumon's current VPS tier is a small shared-1-Gbps box, reaching 10k listeners may require a **VPS tier upgrade for network throughput** — that is an infrastructure cost, not a software license cost. Get the unmetered-vs-metered answer and overage pricing before promising 10k.
- **TURN relay** on strict networks also consumes server bandwidth; it is included in the self-hosted box, not a third-party bill, but it counts against the same uplink.

---

## 6. Mapping to the existing code (what carries over, what's new)

### Carries over unchanged
| Existing piece | File:line | Role in scaled design |
|---|---|---|
| Fixed 10-seat array | `VoiceRoomScreen.tsx:176`, `:197` | The publisher cap. Its length *is* the max simultaneous publishers. |
| Audience join (never publishes) | `VoiceRoomScreen.tsx:638–652` | Listeners stay pure subscribers — the scaling model's foundation. |
| Audience subscription | `VoiceRoomScreen.tsx:491` | Listener roster; unchanged. |
| Auto-publish guard (publish only on seat) | `VoiceRoomScreen.tsx:531–563` | Guarantees audience can't accidentally become publishers. |
| `joinSeat` / `handleMicBarPress` | `VoiceRoomScreen.tsx:855–887`, `:895–912` | Sole publish entry points — cap enforcement lives here. |
| `stopPublishing` on leave/unseat | `VoiceRoomScreen.tsx:1034–1045` | Frees publisher slots; unchanged. |
| Host mute via `seat.muted` | `firebaseRoomService.ts:538–544` | Server-authoritative mute signaling; unchanged. |
| Firebase ID-token verification pattern | `api-server/src/routes/notifications.ts:108–133` | Reused by `POST /api/livekit/token`. |
| `VoiceEngine` interface (core) | `voice-room/voiceEngine.ts` | Unchanged; new scaling surface is optional/additive. |

### New client logic needed (at implementation time, not now)
1. **`LiveKitRoomEngine` publish path:** publish mic with speech preset + DTX explicitly enabled; `canPublish` derived from seat state (publish on `joinSeat`, unpublish on unseat — mirroring the existing guard).
2. **Seat-cap config:** per-room-type seat count at room creation (Firebase room doc), consumed by the screen instead of the hardcoded `Array(10)` when room types diverge. Default stays 10.
3. **Active-speaker-only subscription** (optional, secondary): `RoomEvent.ActiveSpeakersChanged` → `setSubscribed(false)` on inactive speaker tracks; exposed via the new optional `VoiceEngine.setSubscriptionMode()`.
4. **Listener-count UI honesty:** the audience list already renders a listener count (`VoiceRoomScreen.tsx:1399–1408`); keep it — it's the operator's at-a-glance load signal.
5. **Token endpoint:** `POST /api/livekit/token` verifies the Firebase ID token, then grants `canPublish: true` only to seat holders, `false` to audience. (From Track 3; restated here because it's the server-side half of the publisher cap.)

### `voiceEngine.ts` extension (done, additive, behavior-neutral)
Added two optional, types-only members — nothing imports them yet, no behavior changes:
- `VoiceEngineCapabilities` type (`maxStageSpeakers?`, `maxListenersPerRoom?`, `supportsSelectiveSubscription?`, `dtxEnabled?`).
- `VoiceEngine.getCapabilities?()` and `VoiceEngine.setSubscriptionMode?(mode: 'all-speakers' | 'active-speakers-only', topN?)`.
- Optional (`?`) so the future `ZegoVoiceEngineAdapter` is unaffected. Verified the file still parses as pure types (no runtime imports added).

---

## 7. What Sumon must confirm / provide

1. **VPS network reality:** sustained (not burstable) uplink speed in Mbps/Gbps, and whether bandwidth is **unmetered or metered** — if metered, the monthly TB cap and per-TB overage price.
2. **VPS compute:** vCPU count (dedicated vs shared/burstable), RAM. Target per §2.4 for the chosen listener tier.
3. **Target numbers:** max listeners per room (1k / 5k / 10k?) and max simultaneous rooms — the whole capacity plan keys off these two numbers.
4. **Seat cap decision:** confirm 10 stage seats (current) vs a larger event-room type. Every seat multiplies worst-case egress by `N_listeners × ~29 kbps`.
5. **Firewall/ports:** confirm UDP reachability for the media ports on the Windows VPS (blocked UDP → everything over TURN → CPU/bandwidth penalty).
6. **Room-type policy:** which room types get which seat cap, stored where (recommend: Firebase room doc at creation).

## 8. Blocked / needs real load testing

- **Nothing in §2 is confirmed until `lk load-test` runs against the actual VPS.** LiveKit ships `lk load-test --audio-publishers 10 --subscribers 1000` — run it from a second machine against the Windows VPS and watch CPU, egress Mbps, and packet loss. Simulate the §2.2 rows for the chosen tier.
- **DTX real-world average bitrate** for Vee's actual usage (depends on how talkative rooms are) — measure in the load test with DTX on/off to size the DTX-realistic row.
- **TURN relay fraction** for Vee's user base (mostly mobile networks in Sumon's market?) — if high, budget extra uplink headroom.
- **Multi-node/Redis design (§4)** is deliberately not built now; revisit only when the §4 signals fire.
- **Client SDK verification:** exact `livekit-client` (React Native) publish-option field names for DTX + audio preset/bitrate, and `RemoteTrackPublication.setSubscribed` behavior on the RN SDK, must be checked against the installed version at implementation time — the design assumes the documented JS/Dart surfaces (`dtx` defaulting to `true`; `setSubscribed` per track).
