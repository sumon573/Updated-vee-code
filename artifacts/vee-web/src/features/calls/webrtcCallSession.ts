/**
 * WebRTC P2P 1-to-1 audio call session (web port).
 *
 * Mirrors `WebRTCCallSession` from the native app
 * (`vee/src/features/audio-call/services/webrtcCallService.ts`) so web and
 * native clients interoperate on the SAME RTDB signaling paths:
 *
 *   webrtc/{roomId}/offer              → { sdp, type: 'offer' }   (CALLER writes)
 *   webrtc/{roomId}/answer             → { sdp, type: 'answer' }   (CALLEE writes)
 *   webrtc/{roomId}/ice/{pusherUid}/   → { candidate, sdpMLineIndex, sdpMid }
 *   webrtc/{roomId}/hangup             → { byUid, ts }             (hangup signal)
 *
 * roomId = buildCallRoomId(uidA, uidB) — deterministic.
 *
 * Role rule (no glare handling): the caller ALWAYS creates the offer, the
 * callee ALWAYS answers.
 *
 * ICE: STUN only (`stun:stun.l.google.com:19302`) — same as native, no TURN.
 *
 * Differences from the native class:
 * - Remote audio is delivered to the UI via `onRemoteStream(stream)` so it
 *   can be attached to an <audio> element (browsers don't auto-play it).
 * - `hangup()` writes a `hangup` child as an explicit signal AND removes the
 *   signaling node (the native client detects hangup via node removal; the
 *   web side also watches the `hangup` child for a faster UI update).
 *
 * The session never throws to the UI: failures surface via `onError`.
 */

import {
  ref,
  set,
  push,
  remove,
  onValue,
  onChildAdded,
  onDisconnect,
} from 'firebase/database';
import { rtdb } from '../../lib/firebase';
import { buildCallRoomId } from './callRoom';

const SIGNAL_ROOT = 'webrtc';

/** Public STUN only — same as the native app (no TURN configured). */
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export type WebRTCConnectionEvent = 'connected' | 'remote-ended';

export type WebRTCError = {
  /** fatal=true → the call cannot continue; the UI should end the call. */
  fatal: boolean;
  message: string;
};

export type WebRTCCallCallbacks = {
  /** Fired when the remote audio track arrives — attach the stream to <audio>. */
  onRemoteStream?: (stream: MediaStream) => void;
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

/**
 * One P2P call session. Create one per call, call `startCall()`, then
 * `toggleMute()` / `hangup()` from the UI.
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
    this.roomId = buildCallRoomId(options.myUid, options.remoteUid);

    try {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      this.pc = pc;

      // ── Local ICE → RTDB ───────────────────────────────────────────────
      pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        const candidate = event.candidate;
        if (!candidate || this.ended) return;
        const payload: IcePayload = {
          candidate: candidate.candidate,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          sdpMid: candidate.sdpMid ?? null,
        };
        push(ref(rtdb, `${SIGNAL_ROOT}/${this.roomId}/ice/${this.myUid}`), payload).catch(() => {
          /* non-critical — ICE trickle is best-effort */
        });
      };

      // ── Remote audio track ─────────────────────────────────────────────
      pc.ontrack = (event: RTCTrackEvent) => {
        if (this.ended) return;
        const stream = event.streams[0];
        if (stream) {
          try {
            this.callbacks.onRemoteStream?.(stream);
          } catch {
            /* never throw to UI */
          }
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
            'Could not establish a direct connection to the other device ' +
              '(network blocked). Please check your connection and try again.',
          );
        }
        // 'disconnected' is transient (may recover); intentionally ignored.
      };

      // ── Mic capture ────────────────────────────────────────────────────
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (this.ended) {
        stream.getTracks().forEach((t) => t.stop());
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
      const nodeRef = ref(rtdb, `${SIGNAL_ROOT}/${this.roomId}`);
      try {
        await onDisconnect(nodeRef).remove();
      } catch {
        /* non-critical */
      }

      // The session may have ended while the awaits above were in flight.
      if (this.ended) return;

      // ── Signaling listeners ────────────────────────────────────────────
      this.watchLiveness();
      this.watchRemoteIce();

      if (this.isCaller) {
        // Caller ALWAYS creates the offer.
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.ended) return;
        await set(ref(rtdb, `${SIGNAL_ROOT}/${this.roomId}/offer`), {
          sdp: offer.sdp ?? '',
          type: offer.type ?? 'offer',
        } satisfies SdpPayload);
        if (this.ended) return;
        this.watchRemoteSdp('answer', (answer) => void this.applyRemoteAnswer(answer));
      } else {
        // Callee ALWAYS waits for the offer, then answers.
        this.watchRemoteSdp('offer', (offer) => void this.applyRemoteOffer(offer));
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const permissionDenied = /permission|notallowed|not allowed|denied/i.test(raw);
      this.fail(
        true,
        permissionDenied
          ? 'Microphone access was denied. Please allow microphone access in the browser to make voice calls.'
          : `Failed to start WebRTC call: ${raw}`,
      );
      this.hangup();
    }
  }

  /**
   * Toggles the local microphone. Returns the new muted state.
   * Applied via `track.enabled = false` (keeps the peer connection alive —
   * no renegotiation needed).
   */
  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      this.localStream?.getAudioTracks().forEach((track) => {
        track.enabled = !this.muted;
      });
    } catch {
      /* non-critical */
    }
    return this.muted;
  }

  /**
   * Ends the call: closes the peer connection, stops local tracks, removes
   * all RTDB listeners, cancels the onDisconnect hook, writes an explicit
   * hangup signal, and removes the ephemeral signaling node exactly once.
   * Idempotent — safe to call twice.
   */
  hangup(): void {
    if (this.ended) return;
    this.ended = true;

    // Remove RTDB listeners first so our own writes can't retrigger them.
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

    const nodeRef = ref(rtdb, `${SIGNAL_ROOT}/${this.roomId}`);
    try {
      onDisconnect(nodeRef).cancel().catch(() => {
        /* non-critical */
      });
    } catch {
      /* non-critical */
    }

    // Idempotent teardown — guarded against double-remove.
    if (!this.signalingNodeRemoved && this.roomId) {
      this.signalingNodeRemoved = true;
      // Explicit hangup signal first (lets the remote side update its UI
      // even if the node removal races), then remove the ephemeral node —
      // node removal is what the native client watches for.
      set(ref(rtdb, `${SIGNAL_ROOT}/${this.roomId}/hangup`), {
        byUid: this.myUid,
        ts: Date.now(),
      })
        .catch(() => {
          /* non-critical */
        })
        .finally(() => {
          remove(nodeRef).catch(() => {
            /* non-critical — node may already be gone */
          });
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

  private notifyRemoteEnded(): void {
    if (this.ended) return;
    try {
      this.callbacks.onConnectionChange?.('remote-ended');
    } catch {
      /* never throw to UI */
    }
  }

  /**
   * Watches the signaling node itself. When the remote party hangs up (or
   * crashes — via onDisconnect), the node disappears → 'remote-ended'. The
   * initial null snapshot before the node exists is ignored. The explicit
   * `hangup` child is also watched for a faster signal.
   */
  private watchLiveness(): void {
    let seenAlive = false;
    const offNode = onValue(
      ref(rtdb, `${SIGNAL_ROOT}/${this.roomId}`),
      (snap) => {
        if (this.ended) return;
        if (snap.exists()) {
          seenAlive = true;
          return;
        }
        if (seenAlive) this.notifyRemoteEnded();
      },
      () => {
        /* read errors are non-critical; connectionstate handles failure */
      },
    );
    const offHangup = onValue(
      ref(rtdb, `${SIGNAL_ROOT}/${this.roomId}/hangup`),
      (snap) => {
        if (this.ended) return;
        if (snap.exists()) this.notifyRemoteEnded();
      },
      () => {
        /* non-critical */
      },
    );
    this.unsubscribers.push(offNode, offHangup);
  }

  /** Listens for the remote SDP (offer or answer), exactly once. */
  private watchRemoteSdp(kind: 'offer' | 'answer', onSdp: (sdp: SdpPayload) => void): void {
    const off = onValue(
      ref(rtdb, `${SIGNAL_ROOT}/${this.roomId}/${kind}`),
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
        this.fail(false, `Signaling listen failed (${kind}): ${err.message}`);
      },
    );
    this.unsubscribers.push(off);
  }

  /** Trickle ICE: remote candidates pushed under ice/{remoteUid}. */
  private watchRemoteIce(): void {
    const off = onChildAdded(
      ref(rtdb, `${SIGNAL_ROOT}/${this.roomId}/ice/${this.remoteUid}`),
      (snap) => {
        if (this.ended) return;
        const val = snap.val() as Partial<IcePayload> | null;
        if (!val || typeof val.candidate !== 'string') return;
        const ice = new RTCIceCandidate({
          candidate: val.candidate,
          sdpMLineIndex: typeof val.sdpMLineIndex === 'number' ? val.sdpMLineIndex : null,
          sdpMid: typeof val.sdpMid === 'string' ? val.sdpMid : null,
        });
        void this.addRemoteCandidate(ice);
      },
      (err) => {
        this.fail(false, `ICE listen failed: ${err.message}`);
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
        new RTCSessionDescription({ sdp: answer.sdp, type: answer.type as RTCSdpType }),
      );
      this.flushPendingCandidates();
    } catch (e) {
      this.fail(true, `Failed to apply remote answer: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async applyRemoteOffer(offer: SdpPayload): Promise<void> {
    if (this.remoteDescSet || this.ended || !this.pc) return;
    this.remoteDescSet = true;
    try {
      await this.pc.setRemoteDescription(
        new RTCSessionDescription({ sdp: offer.sdp, type: offer.type as RTCSdpType }),
      );
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      if (this.ended) return;
      await set(ref(rtdb, `${SIGNAL_ROOT}/${this.roomId}/answer`), {
        sdp: answer.sdp ?? '',
        type: answer.type ?? 'answer',
      } satisfies SdpPayload);
      this.flushPendingCandidates();
    } catch (e) {
      this.fail(true, `Failed to answer remote offer: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
