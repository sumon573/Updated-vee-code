/**
 * WebRTC P2P 1-to-1 Audio Call Service
 *
 * The ONLY transport for 1-to-1 audio calls.
 * Pure peer-to-peer via `react-native-webrtc`; Firebase RTDB is used
 * solely for ephemeral call signaling (SDP + trickle ICE).
 *
 * Signaling DB structure (ephemeral — removed on hangup):
 *   webrtc/{roomId}/offer            → SDP offer, written by the CALLER
 *   webrtc/{roomId}/answer           → SDP answer, written by the CALLEE
 *   webrtc/{roomId}/ice/{pusherUid}/ → trickle ICE candidates (push() children)
 *
 *   roomId = buildCallRoomId(uidA, uidB) — deterministic, so both parties
 *   rendezvous on the same node without extra coordination.
 *
 * Role rule (no glare handling needed): the caller ALWAYS creates the offer,
 * the callee ALWAYS answers. Role comes from the AudioCallScreen route param.
 *
 * ── NAT / TURN NOTICE ──────────────────────────────────────────────────────
 * No TURN server is configured: ICE uses only the public Google STUN server
 * (stun:stun.l.google.com:19302). Host/srflx candidates succeed for the vast
 * majority of NAT pairs, but roughly 5–15% of symmetric-NAT ↔ symmetric-NAT
 * pairs cannot establish a direct path and the call will fail with
 * `connectionState === 'failed'`. The documented fallback is to deploy a
 * TURN server (coturn) on the team's LiveKit VPS and add it to ICE_SERVERS
 * below as `{ urls: 'turn:<host>:3478', username: '...', credential: '...' }`.
 *
 * Safety:
 *   • `registerGlobals()` runs once at module load, skipped in Expo Go where
 *     the native WebRTC module cannot load.
 *   • The session never throws to UI: every failure is reported through the
 *     `onError` callback so the screen can use its existing error handling.
 *   • `hangup()` is idempotent: safe to call twice, and the signaling node
 *     is removed exactly once. `onDisconnect().remove()` is attached at call
 *     start so a crash/kill still cleans up the ephemeral node.
 */

import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
  mediaDevices,
  registerGlobals,
} from '@livekit/react-native-webrtc';
import {
  ref,
  set,
  push,
  remove,
  onValue,
  onChildAdded,
  onDisconnect,
} from 'firebase/database';
import { database } from '@/src/config/firebase';
import { buildCallRoomId } from './firebaseCallService';
import { isExpoGo } from '@/src/utils/platform';

// ─── Module-level WebRTC global registration ────────────────────────────────

let webrtcGlobalsReady = false;

if (!isExpoGo()) {
  try {
    registerGlobals();
    webrtcGlobalsReady = true;
  } catch {
    // Native module missing (e.g. dev build without the native WebRTC
    // module linked). startCall() reports this via onError instead.
    webrtcGlobalsReady = false;
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SIGNAL_ROOT = 'webrtc';

/** Public STUN only — see the NAT/TURN notice in the header comment. */
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

// ─── Types ───────────────────────────────────────────────────────────────────

export type WebRTCConnectionEvent = 'connected' | 'remote-ended';

export type WebRTCError = {
  /** fatal=true → the call cannot continue; the screen should end the call. */
  fatal: boolean;
  message: string;
};

export type WebRTCCallCallbacks = {
  /**
   * Fired when the remote audio track arrives. Remote audio plays through the
   * OS audio route automatically — no view rendering is needed for audio-only.
   */
  onRemoteStream?: () => void;
  /** 'connected' → start the call timer; 'remote-ended' → remote hung up. */
  onConnectionChange?: (state: WebRTCConnectionEvent) => void;
  /** All failures surface here; the session itself never throws. */
  onError?: (err: WebRTCError) => void;
};

export type StartWebRTCCallOptions = {
  /** Firebase UID of the local user (ICE candidates are pushed under this UID). */
  myUid: string;
  /** Firebase UID of the remote user. */
  remoteUid: string;
  /** true = this side creates the SDP offer; false = waits for the offer. */
  isCaller: boolean;
} & WebRTCCallCallbacks;

type SdpPayload = { sdp: string; type: string };

type IcePayload = {
  candidate: string;
  sdpMLineIndex: number | null;
  sdpMid: string | null;
};

// ─── Session ─────────────────────────────────────────────────────────────────

/**
 * One P2P call session. Create one per call, call `startCall()`, then
 * `toggleMute()` / `setSpeakerphone()` / `hangup()` from the UI.
 */
export class WebRTCCallSession {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private roomId = '';
  private myUid = '';
  private remoteUid = '';
  private isCaller = false;
  private callbacks: WebRTCCallCallbacks = {};
  private unsubscribers: Array<() => void> = [];
  private pendingCandidates: RTCIceCandidate[] = [];
  private remoteDescSet = false;
  private connectedNotified = false;
  private started = false;
  private ended = false;
  private signalingNodeRemoved = false;
  private muted = false;

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Starts the P2P call: mic capture → peer connection → RTDB signaling.
   * Never throws — failures are delivered to `onError`.
   */
  async startCall(options: StartWebRTCCallOptions): Promise<void> {
    if (this.started || this.ended) return;
    this.started = true;
    this.callbacks = {
      onRemoteStream: options.onRemoteStream,
      onConnectionChange: options.onConnectionChange,
      onError: options.onError,
    };
    this.myUid = options.myUid;
    this.remoteUid = options.remoteUid;
    this.isCaller = options.isCaller;
    // Deterministic shared room — imported, never reimplemented.
    this.roomId = buildCallRoomId(options.myUid, options.remoteUid);

    if (isExpoGo() || !webrtcGlobalsReady) {
      this.fail(
        true,
        'WebRTC native module is unavailable in this build (Expo Go). ' +
          'Use a dev-client or production build with react-native-webrtc linked.',
      );
      return;
    }

    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.pc = pc;

      // ── Local ICE → RTDB ───────────────────────────────────────────────
      pc.onicecandidate = (event: unknown) => {
        const candidate = (event as { candidate?: RTCIceCandidate | null } | null)
          ?.candidate;
        if (!candidate || this.ended) return;
        const payload: IcePayload = {
          candidate: candidate.candidate,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          sdpMid: candidate.sdpMid ?? null,
        };
        push(
          ref(database, `${SIGNAL_ROOT}/${this.roomId}/ice/${this.myUid}`),
          payload,
        ).catch(() => {
          /* non-critical — ICE trickle is best-effort */
        });
      };

      // ── Remote audio track ─────────────────────────────────────────────
      pc.ontrack = () => {
        if (this.ended) return;
        // Remote audio renders automatically on the OS audio route.
        try {
          this.callbacks.onRemoteStream?.();
        } catch {
          /* never throw to UI */
        }
        this.notifyConnected();
      };

      // ── Connection state ───────────────────────────────────────────────
      pc.onconnectionstatechange = () => {
        if (this.ended || !this.pc) return;
        const state = this.pc.connectionState;
        if (state === 'connected') {
          this.notifyConnected();
        } else if (state === 'failed') {
          this.fail(
            true,
            // User-facing: this message is shown in an Alert by
            // AudioCallScreen — keep it free of code/file references.
            'Could not establish a direct connection to the other device ' +
              '(network blocked). Please check your connection and try again.',
          );
        }
        // 'disconnected' is transient (may recover); intentionally ignored.
      };

      // ── Mic capture ────────────────────────────────────────────────────
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (this.ended) {
        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          /* non-critical */
        }
        return;
      }
      this.localStream = stream;
      stream.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, stream);
        } catch {
          /* non-critical — continue with remaining tracks */
        }
      });

      // ── Crash safety: remove the ephemeral node if this client dies ───
      const nodeRef = ref(database, `${SIGNAL_ROOT}/${this.roomId}`);
      try {
        await onDisconnect(nodeRef).remove();
      } catch {
        /* non-critical */
      }

      // The session may have ended while the awaits above were in flight
      // (user hung up / screen unmounted). Attaching listeners now would
      // leak them — hangup() already ran and cleared `unsubscribers`.
      if (this.ended) return;

      // ── Signaling listeners ────────────────────────────────────────────
      this.watchLiveness();
      this.watchRemoteIce();

      if (this.isCaller) {
        // Caller ALWAYS creates the offer.
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.ended) return;
        await set(ref(database, `${SIGNAL_ROOT}/${this.roomId}/offer`), {
          sdp: offer.sdp,
          type: offer.type ?? 'offer',
        } satisfies SdpPayload);
        // May have ended during the offer write — don't attach a listener
        // the ended session can never clean up.
        if (this.ended) return;
        this.watchRemoteSdp('answer', (answer) => this.applyRemoteAnswer(answer));
      } else {
        // Callee ALWAYS waits for the offer, then answers.
        this.watchRemoteSdp('offer', (offer) => this.applyRemoteOffer(offer));
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // Mic-denied getUserMedia rejections surface here (notably on iOS,
      // where there is no pre-flight permission request in the screen).
      // Emit an actionable message instead of a raw native error string.
      const permissionDenied =
        /permission|notallowed|not allowed|denied/i.test(raw);
      this.fail(
        true,
        permissionDenied
          ? 'Microphone access was denied. Please allow microphone access in Settings to make voice calls.'
          : `Failed to start WebRTC call: ${raw}`,
      );
      this.hangup();
    }
  }

  /**
   * Toggles the local microphone. Returns the new muted state.
   * Mute is applied via `track.enabled = false` (keeps the peer connection
   * and ICE session alive — no renegotiation needed).
   */
  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      this.localStream
        ?.getAudioTracks()
        .forEach((track) => {
          track.enabled = !this.muted;
        });
    } catch {
      /* non-critical */
    }
    return this.muted;
  }

  /**
   * Speakerphone routing.
   *
   * LIMITATION: react-native-webrtc exposes no JS API for audio-route
   * switching without the `react-native-incall-manager` native module.
   * The toggle updates UI state; audio follows the OS default route.
   * Silent — no user-facing warning (was showing a debug alert).
   */
  setSpeakerphone(_on: boolean): void {
    // Intentionally silent: audio follows OS default route.
  }

  /**
   * Ends the call: closes the peer connection, stops local tracks, removes
   * all RTDB listeners, cancels the onDisconnect hook, and removes the
   * ephemeral signaling node exactly once. Idempotent — safe to call twice.
   */
  hangup(): void {
    if (this.ended) return;
    this.ended = true;

    // Remove RTDB listeners first so our own node removal can't retrigger them.
    this.unsubscribers.forEach((off) => {
      try {
        off();
      } catch {
        /* non-critical */
      }
    });
    this.unsubscribers = [];

    try {
      this.localStream?.getTracks().forEach((track) => track.stop());
    } catch {
      /* non-critical */
    }
    this.localStream = null;

    try {
      this.pc?.close();
    } catch {
      /* non-critical */
    }
    this.pc = null;

    const nodeRef = ref(database, `${SIGNAL_ROOT}/${this.roomId}`);
    try {
      onDisconnect(nodeRef).cancel().catch(() => {
        /* non-critical */
      });
    } catch {
      /* non-critical */
    }

    // Idempotent node removal — guarded against double-remove.
    if (!this.signalingNodeRemoved && this.roomId) {
      this.signalingNodeRemoved = true;
      remove(nodeRef).catch(() => {
        /* non-critical — node may already be gone */
      });
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private fail(fatal: boolean, message: string): void {
    try {
      this.callbacks.onError?.({ fatal, message });
    } catch {
      /* never throw to UI */
    }
  }

  private notifyConnected(): void {
    if (this.connectedNotified || this.ended) return;
    this.connectedNotified = true;
    try {
      this.callbacks.onConnectionChange?.('connected');
    } catch {
      /* never throw to UI */
    }
  }

  /**
   * Watches the signaling node itself. When the remote party hangs up (or
   * crashes — via onDisconnect), the node disappears → 'remote-ended'.
   * The initial null snapshot before the node exists is ignored.
   */
  private watchLiveness(): void {
    let seenAlive = false;
    const off = onValue(
      ref(database, `${SIGNAL_ROOT}/${this.roomId}`),
      (snap) => {
        if (this.ended) return;
        if (snap.exists()) {
          seenAlive = true;
          return;
        }
        if (seenAlive) {
          try {
            this.callbacks.onConnectionChange?.('remote-ended');
          } catch {
            /* never throw to UI */
          }
        }
      },
      () => {
        /* read errors are non-critical; connectionstate handles failure */
      },
    );
    this.unsubscribers.push(off);
  }

  /** Listens for the remote SDP (offer or answer), exactly once. */
  private watchRemoteSdp(
    kind: 'offer' | 'answer',
    onSdp: (sdp: SdpPayload) => void,
  ): void {
    const off = onValue(
      ref(database, `${SIGNAL_ROOT}/${this.roomId}/${kind}`),
      (snap) => {
        if (this.ended || this.remoteDescSet) return;
        const val = snap.val() as Partial<SdpPayload> | null;
        if (val && typeof val.sdp === 'string') {
          try {
            onSdp({
              sdp: val.sdp,
              type: typeof val.type === 'string' ? val.type : kind,
            });
          } catch {
            /* never throw to UI */
          }
        }
      },
      (err) => {
        this.fail(
          false,
          `Signaling listen failed (${kind}): ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
    this.unsubscribers.push(off);
  }

  /** Trickle ICE: remote candidates pushed under ice/{remoteUid}. */
  private watchRemoteIce(): void {
    const off = onChildAdded(
      ref(database, `${SIGNAL_ROOT}/${this.roomId}/ice/${this.remoteUid}`),
      (snap) => {
        if (this.ended) return;
        const val = snap.val() as Partial<IcePayload> | null;
        if (!val || typeof val.candidate !== 'string') return;
        const ice = new RTCIceCandidate({
          candidate: val.candidate,
          sdpMLineIndex:
            typeof val.sdpMLineIndex === 'number' ? val.sdpMLineIndex : null,
          sdpMid: typeof val.sdpMid === 'string' ? val.sdpMid : null,
        });
        void this.addRemoteCandidate(ice);
      },
      (err) => {
        this.fail(
          false,
          `ICE listen failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
    this.unsubscribers.push(off);
  }

  private async addRemoteCandidate(ice: RTCIceCandidate): Promise<void> {
    if (this.ended) return;
    if (!this.remoteDescSet || !this.pc) {
      // Remote description not set yet — queue until it is.
      this.pendingCandidates.push(ice);
      return;
    }
    try {
      await this.pc.addIceCandidate(ice);
    } catch {
      /* non-critical — a stale candidate must not kill the call */
    }
  }

  private flushPendingCandidates(): void {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    queued.forEach((ice) => {
      void this.addRemoteCandidate(ice);
    });
  }

  private async applyRemoteAnswer(answer: SdpPayload): Promise<void> {
    if (this.remoteDescSet || this.ended || !this.pc) return;
    this.remoteDescSet = true;
    try {
      await this.pc.setRemoteDescription(
        new RTCSessionDescription({ sdp: answer.sdp, type: answer.type }),
      );
      this.flushPendingCandidates();
    } catch (e) {
      this.fail(
        true,
        `Failed to apply remote answer: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async applyRemoteOffer(offer: SdpPayload): Promise<void> {
    if (this.remoteDescSet || this.ended || !this.pc) return;
    this.remoteDescSet = true;
    try {
      await this.pc.setRemoteDescription(
        new RTCSessionDescription({ sdp: offer.sdp, type: offer.type }),
      );
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      if (this.ended) return;
      await set(ref(database, `${SIGNAL_ROOT}/${this.roomId}/answer`), {
        sdp: answer.sdp,
        type: answer.type ?? 'answer',
      } satisfies SdpPayload);
      this.flushPendingCandidates();
    } catch (e) {
      this.fail(
        true,
        `Failed to answer remote offer: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
