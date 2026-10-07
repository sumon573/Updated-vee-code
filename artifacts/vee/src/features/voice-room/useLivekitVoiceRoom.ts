/**
 * useLivekitVoiceRoom — LiveKit group voice room hook (sole voice-room transport).
 *
 * Implements the provider-neutral `VoiceEngine` interface (./voiceEngine) on top
 * of livekit-client v2 + @livekit/react-native, and exposes the same UI-facing
 * return shape the voice-room screen consumes (joined / muted / speakerOn /
 * isPublishing / localSpeaking / speakingUsers / error / wasRestored plus the
 * publish / mic / speaker / remote-stream controls).
 *
 * Lifecycle discipline (mirrors the previous engine):
 *   • Module-level persist keeps the LiveKit Room alive when the user minimizes
 *     the room; on remount the hook reuses it and reports `wasRestored`.
 *   • `leave()`/unmount performs full cleanup: room.disconnect(),
 *     removeAllListeners(), AudioSession.stopAudioSession().
 *   • isExpoGo() guard: native WebRTC modules need a dev-client/EAS build, so
 *     in Expo Go the hook stays idle (Firebase chat/seats still work, no audio).
 *   • AppState background/inactive temporarily mutes the mic track and restores
 *     the previous mute state when the app becomes active again.
 *   • Errors never throw to UI — they surface via VoiceLocalState.error.
 *
 * Seat mapping (seat UI + Firebase signaling untouched):
 *   • join() connects as audience — the mic track is NOT published.
 *   • publish()   enables the local mic track (called when the user takes a seat).
 *   • unpublish() disables the local mic track (called when leaving a seat).
 *   • setMuted(m) toggles the local mic track; host-mute keeps flowing through
 *     the existing Firebase seat.muted signaling (screen calls setMuted(true)).
 *
 * Token: POST {getApiBase()}/api/livekit/token with
 *   { roomName, participantName, canPublish: true } and Firebase ID-token Bearer
 *   auth. The connection URL comes ONLY from the server response — never
 *   hardcoded.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, PermissionsAndroid, AppState, AppStateStatus } from 'react-native';
import { auth } from '@/src/config/firebase';
import { isExpoGo, getApiBase } from '@/src/utils/platform';
import {
  markVoiceStage,
  clearVoiceBreadcrumb,
} from './utils/voiceCrashBreadcrumb';
import type {
  VoiceEngine,
  VoiceParticipant,
  VoiceLocalState,
  VoiceEngineEvents,
  VoiceEngineCapabilities,
  VoiceSubscriptionMode,
  VoiceConnectionState,
} from './voiceEngine';
import type {
  Room,
  Participant,
  RemoteParticipant,
  RemoteTrackPublication,
  ConnectionState,
} from 'livekit-client';

/** Runtime handles for the LiveKit SDKs — loaded lazily via require() so the
 *  module stays import-safe in Expo Go (native modules absent there). */
type LivekitClientModule = typeof import('livekit-client');
type LivekitRnModule = typeof import('@livekit/react-native');

let _globalsRegistered = false;

// ─── Public Types ────────────────────────────────────────────────────────────

export type LivekitRoomOptions = {
  roomID: string;
  userID: string;
  userName: string;
};

export type LivekitRoomReturn = {
  joined: boolean;
  muted: boolean;
  speakerOn: boolean;
  isPublishing: boolean;
  localSpeaking: boolean;
  speakingUsers: Record<string, boolean>;
  error: string | null;
  /**
   * True when this hook session was restored from a minimized room rather than
   * created fresh. VoiceRoomScreen uses this flag to re-subscribe remote
   * speaker tracks that were already active before minimize.
   */
  wasRestored: boolean;
  startPublishing: () => void;
  stopPublishing: () => void;
  /** Toggles mic and RETURNS the new muted state (single source of truth).
   *  Callers must use the return value — never compute `!muted` from React
   *  state, which can be stale in the closure and cause double-toggle bugs. */
  toggleMic: () => boolean;
  toggleSpeaker: () => void;
  /** Directly set the mic muted state (used for host-driven remote mute). */
  setMicMuted: (muted: boolean) => void;
  muteRemoteUser: (userID: string) => void;
  playUserStream: (userID: string) => void;
  stopUserStream: (userID: string) => void;
  /**
   * Re-run join() after a failure (token/connect error surfaced via `error`).
   * Tears the engine down first so a half-connected room can't block the
   * retry — engine.join() early-returns when `room` is still set.
   */
  retryConnection: () => void;
};

// ─── Module-level persist (for minimize) ─────────────────────────────────────

type PersistedRoom = {
  engine: LivekitVoiceRoomEngine;
  /** LiveKit room this engine is connected to — restore only reuses the
   *  engine when the screen is opened for the SAME room. */
  roomId: string;
  muted: boolean;
  published: boolean;
  speakerOn: boolean;
};

/** Set to true by VoiceRoomScreen.handleMinimize() before router.back(). */
let _isMinimized = false;
/** Holds the LiveKit room when the screen is minimized so it isn't disconnected. */
let _persistedRoom: PersistedRoom | null = null;

/** Call before router.back() to keep the voice room alive on minimize. */
export function setVoiceRoomMinimized(minimized: boolean): void {
  _isMinimized = minimized;
}

/** Returns the muted state of the persisted room (for MinimizedRoomBar). */
export function getPersistedVoiceRoomMuted(): boolean {
  return _persistedRoom?.muted ?? false;
}

/**
 * Fully tear down the persisted room.
 * Call from MinimizedRoomBar's close (X) button so audio stops
 * when the user discards the minimized room.
 */
export function destroyPersistedVoiceRoomEngine(): void {
  if (!_persistedRoom) return;
  const { engine } = _persistedRoom;
  _persistedRoom = null;
  _isMinimized = false;
  engine.leave().catch(() => {
    // non-critical — teardown after navigation
  });
}

// ─── Mic Permission Helper ───────────────────────────────────────────────────

async function requestMicPermission(strings: {
  title: string; message: string; allow: string; deny: string; askLater: string;
}): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  try {
    const already = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (already) return true;

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: strings.title,
        message: strings.message,
        buttonPositive: strings.allow,
        buttonNegative: strings.deny,
        buttonNeutral: strings.askLater,
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/**
 * LiveKit implementation of the VoiceEngine interface.
 *
 * All native SDK access (livekit-client Room, @livekit/react-native
 * AudioSession/registerGlobals) happens lazily inside join() via require(),
 * guarded by try/catch — the module itself never touches native code at
 * import time.
 */
class LivekitVoiceRoomEngine implements VoiceEngine {
  readonly providerName = 'livekit' as const;

  private lk: LivekitClientModule | null = null;
  private rnSdk: LivekitRnModule | null = null;
  private room: Room | null = null;

  private localIdentity = '';
  private connection: VoiceConnectionState = 'idle';
  private muted = true;
  private speakerOn = true;
  private publishing = false;
  private localSpeaking = false;
  private error: string | null = null;
  private leaveInitiated = false;

  /** Identities currently flagged as speaking (remote only). */
  private speakingIds = new Set<string>();
  private participants: VoiceParticipant[] = [];
  private events: VoiceEngineEvents = {};

  /* ── internal emit helpers ── */

  private snapshot(): VoiceLocalState {
    return {
      connection: this.connection,
      muted: this.muted,
      speakerOn: this.speakerOn,
      publishing: this.publishing,
      localSpeaking: this.localSpeaking,
      error: this.error,
    };
  }

  private emitLocal(): void {
    try {
      this.events.onLocalStateChange?.(this.snapshot());
    } catch {
      // handler errors must not break the engine
    }
  }

  private emitSpeaking(userId: string, speaking: boolean): void {
    try {
      this.events.onSpeakingChange?.(userId, speaking);
    } catch {
      // non-critical
    }
  }

  private refreshParticipants(): void {
    const room = this.room;
    if (!room) {
      this.participants = [];
      return;
    }
    const list: VoiceParticipant[] = [];
    room.remoteParticipants.forEach((p: RemoteParticipant) => {
      let subscribed = false;
      let muted: boolean | undefined;
      p.audioTrackPublications.forEach((pub) => {
        const rp = pub as RemoteTrackPublication;
        if (rp.isSubscribed) subscribed = true;
        if (typeof rp.isMuted === 'boolean') muted = rp.isMuted;
      });
      list.push({
        userId: p.identity,
        userName: p.name ?? p.identity,
        subscribed,
        speaking: this.speakingIds.has(p.identity),
        muted,
      });
    });
    this.participants = list;
    try {
      this.events.onParticipantsChange?.(list);
    } catch {
      // non-critical
    }
  }

  private handleActiveSpeakers(speakers: Array<Participant>): void {
    const next = new Set<string>();
    speakers.forEach((p) => {
      if (p.identity !== this.localIdentity) next.add(p.identity);
    });
    // Removals first, then additions — screens get clean onSpeakingChange deltas.
    this.speakingIds.forEach((id) => {
      if (!next.has(id)) {
        this.speakingIds.delete(id);
        this.emitSpeaking(id, false);
      }
    });
    next.forEach((id) => {
      if (!this.speakingIds.has(id)) {
        this.speakingIds.add(id);
        this.emitSpeaking(id, true);
      }
    });
    this.refreshParticipants();
  }

  private handleConnectionState(state: ConnectionState): void {
    if (!this.lk) return;
    const cs = this.lk.ConnectionState;
    if (state === cs.Connected) {
      this.connection = 'connected';
      this.error = null;
    } else if (state === cs.Reconnecting || state === cs.SignalReconnecting) {
      this.connection = 'reconnecting';
    } else if (state === cs.Disconnected) {
      this.connection = this.leaveInitiated ? 'ended' : 'failed';
      if (!this.leaveInitiated && !this.error) {
        this.error = 'Disconnected from the voice room';
      }
    }
    this.emitLocal();
  }

  private registerRoomListeners(room: Room): void {
    const { RoomEvent, ParticipantEvent } = this.lk!;
    room
      .on(RoomEvent.ParticipantConnected, () => this.refreshParticipants())
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        this.speakingIds.delete(p.identity);
        this.refreshParticipants();
      })
      .on(RoomEvent.TrackPublished, () => this.refreshParticipants())
      .on(RoomEvent.TrackUnpublished, () => this.refreshParticipants())
      .on(RoomEvent.TrackSubscribed, () => this.refreshParticipants())
      .on(RoomEvent.TrackUnsubscribed, () => this.refreshParticipants())
      .on(RoomEvent.TrackMuted, () => this.refreshParticipants())
      .on(RoomEvent.TrackUnmuted, () => this.refreshParticipants())
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Array<Participant>) =>
        this.handleActiveSpeakers(speakers),
      )
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) =>
        this.handleConnectionState(state),
      )
      .on(RoomEvent.Reconnecting, () => {
        this.connection = 'reconnecting';
        this.emitLocal();
      })
      .on(RoomEvent.Reconnected, () => {
        this.connection = 'connected';
        this.error = null;
        this.emitLocal();
      })
      .on(RoomEvent.Disconnected, () => {
        this.connection = this.leaveInitiated ? 'ended' : 'failed';
        if (!this.leaveInitiated && !this.error) {
          this.error = 'Disconnected from the voice room';
        }
        this.emitLocal();
      });
    // Local speaking detection (mirrors the old localSoundLevelUpdate path).
    room.localParticipant.on(ParticipantEvent.IsSpeakingChanged, (speaking: unknown) => {
      const s = speaking === true;
      if (s !== this.localSpeaking) {
        this.localSpeaking = s;
        this.emitLocal();
      }
    });
  }

  /** Apply mute/unmute to the local mic track publications (if any). */
  private async applyTrackMute(muted: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      const pubs = Array.from(room.localParticipant.audioTrackPublications.values());
      for (const pub of pubs) {
        const track = pub.track;
        if (!track) continue;
        if (muted) {
          await track.mute();
        } else {
          await track.unmute();
        }
      }
    } catch {
      // non-critical — mute intent is recorded in state regardless
    }
  }

  private setRemoteSubscribed(userId: string, subscribed: boolean): void {
    const room = this.room;
    if (!room) return;
    try {
      room.remoteParticipants.forEach((p: RemoteParticipant) => {
        if (p.identity !== userId) return;
        p.audioTrackPublications.forEach((pub) => {
          (pub as RemoteTrackPublication).setSubscribed(subscribed);
        });
      });
      this.refreshParticipants();
    } catch {
      // non-critical
    }
  }

  private async teardownRoom(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (!room) return;
    try {
      room.removeAllListeners();
    } catch {
      // non-critical
    }
    try {
      room.localParticipant.removeAllListeners();
    } catch {
      // non-critical
    }
    try {
      await room.disconnect();
    } catch {
      // non-critical
    }
  }

  /* ── VoiceEngine interface ── */

  async join(roomId: string, identity: { userId: string; userName: string }): Promise<void> {
    if (this.room) return; // idempotent
    this.leaveInitiated = false;
    this.localIdentity = identity.userId;
    this.connection = 'connecting';
    this.error = null;
    this.emitLocal();

    try {
      // Lazy SDK load — keeps this module import-safe in Expo Go.
      // CRITICAL: registerGlobals() MUST run before livekit-client is loaded.
      // LiveKit's own docs warn that importing livekit-client before
      // registerGlobals() "breaks apps at runtime on Hermes" (native crash).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const rnSdk = require('@livekit/react-native') as LivekitRnModule;
      this.rnSdk = rnSdk;
      if (!_globalsRegistered) {
        rnSdk.registerGlobals();
        _globalsRegistered = true;
      }
      // Now safe to load livekit-client (WebRTC globals are registered).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const lk = require('livekit-client') as LivekitClientModule;
      this.lk = lk;
      // Crash breadcrumb: native WebRTC globals are now loaded.
      markVoiceStage('sdk_loaded', roomId);

      // 1. Token from the LiveKit token endpoint (Bearer Firebase ID token).
      const fbUser = auth.currentUser;
      if (!fbUser) throw new Error('Not signed in');
      const idToken = await fbUser.getIdToken();
      const res = await fetch(`${getApiBase()}/api/livekit/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          roomName: roomId,
          participantName: identity.userName,
          canPublish: true,
        }),
      });
      if (!res.ok) throw new Error(`Voice server request failed (${res.status})`);
      const data = (await res.json()) as { token?: string; url?: string };
      if (!data.token || !data.url) {
        throw new Error('Voice server returned an invalid response');
      }
      // Crash breadcrumb: token acquired, about to touch the native audio session.
      markVoiceStage('token_ok', roomId);

      // 2. Audio session + connect. The URL comes ONLY from the server response.
      await rnSdk.AudioSession.startAudioSession();
      // Background audio: use expo-audio for background-capable audio mode.
      // Audio session is already started via rnSdk.AudioSession above.
      try {
        const { setAudioModeAsync } = await import('expo-audio');
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'duckOthers',
          allowsRecording: true,
        });
      } catch { /* non-critical */ }
      // Crash breadcrumb: native audio session started — next is WebRTC connect.
      markVoiceStage('audio_session_started', roomId);
      const room = new lk.Room();
      this.room = room;
      this.registerRoomListeners(room);
      await room.connect(data.url, data.token);

      this.connection = 'connected';
      this.error = null;
      // Voice is up — the join survived every native stage; clear the breadcrumb
      // so a later unrelated crash is not misattributed to voice-room entry.
      markVoiceStage('room_connected', roomId);
      clearVoiceBreadcrumb();
      this.refreshParticipants();
    } catch (err) {
      this.connection = 'failed';
      this.error = err instanceof Error ? err.message : 'Voice room connection failed';
      try {
        await this.teardownRoom();
      } catch {
        // non-critical
      }
      // The audio session was started before connect — release it so a
      // failed join doesn't leave the OS audio session held.
      try {
        await this.rnSdk?.AudioSession.stopAudioSession();
      } catch {
        // non-critical
      }
      this.lk = null;
      this.rnSdk = null;
    }
    this.emitLocal();
  }

  async leave(): Promise<void> {
    this.leaveInitiated = true;
    this.speakingIds.clear();
    this.participants = [];
    try {
      await this.teardownRoom();
    } catch {
      // non-critical
    }
    try {
      await this.rnSdk?.AudioSession.stopAudioSession();
    } catch {
      // non-critical
    }
    this.lk = null;
    this.rnSdk = null;
    this.connection = 'ended';
    this.publishing = false;
    this.localSpeaking = false;
    this.events = {};
  }

  async publish(): Promise<void> {
    const room = this.room;
    if (!room || !this.lk) return;
    if (this.publishing) return; // idempotent
    // C1 fix: claim publishing SYNCHRONOUSLY before the await. Otherwise,
    // if unpublish() runs while setMicrophoneEnabled is in flight, it
    // early-returns (publishing still false), then publish completes leaving
    // the mic live with nothing tracking it.
    this.publishing = true;
    try {
      // DTX enabled on the mic publish path (matches getCapabilities()).
      await room.localParticipant.setMicrophoneEnabled(true, undefined, { dtx: true });
      // Start muted — the user unmutes explicitly (mirrors previous behavior).
      await this.applyTrackMute(this.muted);
    } catch (err) {
      this.publishing = false;
      this.error = err instanceof Error ? err.message : 'Failed to enable microphone';
    }
    this.emitLocal();
  }

  async unpublish(): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (!this.publishing) return; // idempotent
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch {
      // non-critical
    }
    this.publishing = false;
    this.localSpeaking = false;
    this.emitLocal();
  }

  async setMuted(muted: boolean): Promise<boolean> {
    this.muted = muted;
    await this.applyTrackMute(muted);
    this.emitLocal();
    return this.muted;
  }

  async setSpeakerOn(enabled: boolean): Promise<void> {
    this.speakerOn = enabled;
    try {
      const AudioSession = this.rnSdk?.AudioSession;
      if (AudioSession) {
        const outputs = await AudioSession.getAudioOutputs();
        const want = enabled ? 'speaker' : 'earpiece';
        const pick =
          outputs.find((o) => o.toLowerCase().includes(want)) ??
          (enabled ? outputs[0] : undefined);
        if (pick) {
          await AudioSession.selectAudioOutput(pick);
        }
      }
    } catch {
      // non-critical — speaker intent is recorded in state regardless
    }
    this.emitLocal();
  }

  async subscribe(userId: string): Promise<void> {
    this.setRemoteSubscribed(userId, true);
  }

  async unsubscribe(userId: string): Promise<void> {
    this.setRemoteSubscribed(userId, false);
  }

  getCapabilities(): VoiceEngineCapabilities {
    return {
      maxStageSpeakers: 20,
      maxListenersPerRoom: 10000,
      supportsSelectiveSubscription: true,
      dtxEnabled: true,
    };
  }

  async setSubscriptionMode(mode: VoiceSubscriptionMode, topN: number = 8): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      if (mode === 'active-speakers-only') {
        const top = new Set(room.activeSpeakers.slice(0, topN).map((p) => p.identity));
        room.remoteParticipants.forEach((p: RemoteParticipant) => {
          this.setRemoteSubscribed(p.identity, top.has(p.identity));
        });
      } else {
        room.remoteParticipants.forEach((p: RemoteParticipant) => {
          this.setRemoteSubscribed(p.identity, true);
        });
      }
    } catch {
      // non-critical
    }
  }

  getLocalState(): VoiceLocalState {
    return this.snapshot();
  }

  getParticipants(): VoiceParticipant[] {
    return [...this.participants];
  }

  setEventHandlers(events: VoiceEngineEvents): void {
    this.events = events ?? {};
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useLivekitVoiceRoom(options: LivekitRoomOptions): LivekitRoomReturn {
  const { t } = useTranslation();
  const engineRef       = useRef<LivekitVoiceRoomEngine | null>(null);
  const mountedRef      = useRef(true);
  const publishedRef    = useRef(false);
  const isCleaningUpRef = useRef(false);
  /** Mute state captured before an AppState background mute, for restore. */
  const preBackgroundMutedRef = useRef<boolean | null>(null);
  /** Identity captured by the init effect — used by retryConnection. */
  const identityRef = useRef({ roomID: '', userID: '', userName: '' });
  /** Latest attachHandlers closure — re-attached after a retry's leave(). */
  const attachRef = useRef<(engine: LivekitVoiceRoomEngine) => void>(() => {});

  const [joined,        setJoined]        = useState(false);
  const [muted,         setMuted]         = useState(true);
  const [speakerOn,     setSpeakerOn]     = useState(true);
  /** True when the hook was initialized from a persisted (minimized) room. */
  const [wasRestored,   setWasRestored]   = useState(false);

  const mutedRef     = useRef(true);
  const speakerOnRef = useRef(true);
  const [isPublishing,  setIsPublishing]  = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [speakingUsers, setSpeakingUsers] = useState<Record<string, boolean>>({});
  const [error,         setError]         = useState<string | null>(null);

  /* ══════════════════════════════════════════════
     ROOM INIT + JOIN
  ══════════════════════════════════════════════ */
  useEffect(() => {
    mountedRef.current = true;
    isCleaningUpRef.current = false;

    const roomID   = options.roomID;
    const userID   = options.userID;
    const userName = options.userName;

    // Captured for retryConnection (leave + re-join after a failure).
    identityRef.current = { roomID, userID, userName };

    // ── Event wiring (shared by restore and normal init paths) ────────────
    function attachHandlers(engine: LivekitVoiceRoomEngine) {
      engine.setEventHandlers({
        onLocalStateChange: (s: VoiceLocalState) => {
          if (!mountedRef.current) return;
          mutedRef.current = s.muted;
          speakerOnRef.current = s.speakerOn;
          publishedRef.current = s.publishing;
          setMuted(s.muted);
          setSpeakerOn(s.speakerOn);
          setIsPublishing(s.publishing);
          setLocalSpeaking(s.localSpeaking);
          setError(s.error);
          setJoined(s.connection === 'connected');
        },
        onSpeakingChange: (speakingUserId: string, speaking: boolean) => {
          if (!mountedRef.current) return;
          setSpeakingUsers((prev) => {
            if (prev[speakingUserId] === speaking) return prev;
            const next = { ...prev };
            if (speaking) {
              next[speakingUserId] = true;
            } else {
              delete next[speakingUserId];
            }
            return next;
          });
        },
        onParticipantsChange: (parts: VoiceParticipant[]) => {
          if (!mountedRef.current) return;
          const map: Record<string, boolean> = {};
          parts.forEach((p) => {
            if (p.speaking) map[p.userId] = true;
          });
          setSpeakingUsers(map);
        },
      });
    }
    // Keep the latest closure so retryConnection can re-attach handlers
    // after its leave() wipes them (engine.leave() sets events = {}).
    attachRef.current = attachHandlers;

    // ── AppState handler (shared by both paths) ───────────────────────────
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const engine = engineRef.current;
      if (!engine) return;
      try {
        if (nextState === 'background' || nextState === 'inactive') {
          // Privacy: mute the mic track while backgrounded, restore on return.
          if (publishedRef.current && !mutedRef.current) {
            preBackgroundMutedRef.current = false;
            engine.setMuted(true).catch(() => {
              // non-critical
            });
          }
        } else if (nextState === 'active') {
          if (preBackgroundMutedRef.current !== null) {
            const restore = preBackgroundMutedRef.current;
            preBackgroundMutedRef.current = null;
            engine.setMuted(restore).catch(() => {
              // non-critical
            });
          }
        }
      } catch {
        // non-critical
      }
    };

    // ── Normal cleanup helper ─────────────────────────────────────────────
    function performCleanup() {
      if (isCleaningUpRef.current) return;
      isCleaningUpRef.current = true;
      mountedRef.current = false;

      const engine = engineRef.current;
      engineRef.current = null;

      if (engine) {
        engine.leave().catch(() => {
          // non-critical — teardown after unmount
        });
      }
    }

    // ── Restore from minimize (reuse persisted room) ──────────────────────
    // The persisted engine is only valid for the SAME room: if the user
    // minimized room A and then opened room B, reusing A's LiveKit room
    // would leak A's audio into B's screen. Tear the stale engine down and
    // fall through to a fresh join for B instead.
    if (_persistedRoom && _persistedRoom.roomId === roomID) {
      const persisted = _persistedRoom;
      _persistedRoom = null;
      _isMinimized = false;

      engineRef.current = persisted.engine;
      // Re-attach handlers with fresh closures on this component instance
      attachHandlers(persisted.engine);
      const s = persisted.engine.getLocalState();
      mutedRef.current = s.muted;
      speakerOnRef.current = s.speakerOn;
      publishedRef.current = s.publishing;
      setMuted(s.muted);
      setSpeakerOn(s.speakerOn);
      setIsPublishing(s.publishing);
      setLocalSpeaking(s.localSpeaking);
      setError(s.error);
      setJoined(s.connection === 'connected');
      const map: Record<string, boolean> = {};
      persisted.engine.getParticipants().forEach((p) => {
        if (p.speaking) map[p.userId] = true;
      });
      setSpeakingUsers(map);
      // Signal to VoiceRoomScreen that it must re-subscribe existing remote
      // speaker tracks, because already-subscribed tracks do not re-emit
      // subscription events after a restore — only new tracks trigger them.
      setWasRestored(true);
    } else {
      // ── Normal init (async IIFE so we can await the stale teardown) ──────
      (async () => {
        if (_persistedRoom) {
          // Stale persisted room for a different room — destroy it so its
          // audio can't leak into this room, then join fresh below.
          // CRITICAL: await the teardown. The old fire-and-forget
          // `leave().catch()` raced the new engine's native WebRTC/audio init
          // (room.disconnect + AudioSession.stop vs start + Room.connect),
          // a classic SIGSEGV source on Android.
          const stale = _persistedRoom;
          _persistedRoom = null;
          _isMinimized = false;
          try {
            await stale.engine.leave();
          } catch {
            // non-critical — stale room teardown
          }
          if (!mountedRef.current) return;
        }

        // Skip entirely in Expo Go — native WebRTC modules not available
        if (isExpoGo()) return;

        // Don't burn a mic-permission prompt (or a doomed token fetch) when
        // the identity isn't real yet — AuthContext starts with user: null
        // and VoiceRoomScreen passes userID 'anonymous' / empty roomID.
        // The effect re-runs when the real userID/roomID arrive.
        if (!roomID || userID === 'anonymous') return;

        // Crash breadcrumb: the screen now begins the native voice init
        // sequence (mic permission → SDK load → token → audio session).
        markVoiceStage('engine_init_start', roomID);

        const hasMic = await requestMicPermission({
          title: t('voiceRoom.screen.micPermissionTitle'),
          message: t('voiceRoom.screen.micPermissionMessage'),
          allow: t('voiceRoom.screen.allow'),
          deny: t('voiceRoom.screen.deny'),
          askLater: t('voiceRoom.screen.askLater'),
        });
        if (!hasMic) {
          if (mountedRef.current) {
            setError(t('voiceRoom.screen.micPermissionDenied'));
          }
        }

        if (!mountedRef.current) return;

        const engine = new LivekitVoiceRoomEngine();
        attachHandlers(engine);
        engineRef.current = engine;
        await engine.join(roomID, { userId: userID, userName });
        // engine.join() never throws — failures surface via onLocalStateChange
      })().catch(() => {
        // non-critical — engine surfaces failures via state
      });
    }

    // ── AppState subscription (shared by both paths) ──────────────────────
    const appStateSub = AppState.addEventListener('change', handleAppStateChange);

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      appStateSub.remove();

      // Crash breadcrumb: the screen unmounted without a native crash, so any
      // in-flight join breadcrumb must not survive (a real crash never runs
      // this cleanup, which is exactly how we tell the two apart).
      clearVoiceBreadcrumb();

      // Minimize path: save the room to module-level persist instead of leaving
      if (_isMinimized && engineRef.current) {
        // C8 fix: mute before persisting — otherwise the mic stays hot in
        // background indefinitely with no AppState listener to mute it.
        const eng = engineRef.current;
        if (eng && typeof eng.setMuted === 'function') {
          eng.setMuted(true).catch(() => {});
        }
        _persistedRoom = {
          engine:    eng,
          roomId:    roomID,
          muted:     true, // reflect the forced mute above
          published: publishedRef.current,
          speakerOn: speakerOnRef.current,
        };
        engineRef.current = null;
        mountedRef.current = false;
        return;
      }

      // Normal leave path: full teardown
      performCleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.roomID, options.userID, options.userName]);

  /* ══════════════════════════════════════════════
     PUBLISHING CONTROL
  ══════════════════════════════════════════════ */

  const startPublishing = useCallback(() => {
    engineRef.current?.publish().catch(() => {
      // non-critical — engine surfaces failures via state
    });
  }, []);

  const stopPublishing = useCallback(() => {
    engineRef.current?.unpublish().catch(() => {
      // non-critical
    });
  }, []);

  /**
   * Retry the LiveKit connection after a failure surfaced via `error`
   * (token fetch failure, connect failure, unexpected disconnect).
   * leave() first: a half-connected Room would make join() early-return.
   * Handlers are re-attached because leave() wipes them.
   */
  const retryConnection = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { roomID, userID, userName } = identityRef.current;
    if (!roomID || !userID) return;
    (async () => {
      try {
        await engine.leave();
      } catch {
        // non-critical — proceed to re-join regardless
      }
      // Unmounted or replaced while leaving — don't resurrect a dead engine.
      if (!mountedRef.current || engineRef.current !== engine) return;
      attachRef.current(engine);
      await engine.join(roomID, { userId: userID, userName });
    })().catch(() => {
      // non-critical — engine.join() never throws; failures surface via state
    });
  }, []);

  /* ══════════════════════════════════════════════
     MIC / SPEAKER
  ══════════════════════════════════════════════ */

  const toggleMic = useCallback((): boolean => {
    const engine = engineRef.current;
    if (!engine) return mutedRef.current;
    // Call the engine OUTSIDE the state setter: if the native call throws,
    // the exception must not propagate through React's reconciler.
    // Use the ref for synchronous current-value tracking.
    // RETURNS the new muted value so callers use a single source of truth
    // (fixes stale-closure double-toggle where screen computed `!muted`
    // from outdated React state while the engine toggled its own ref).
    const newMuted = !mutedRef.current;
    mutedRef.current = newMuted;
    engine.setMuted(newMuted).catch(() => {
      // non-critical — authoritative state arrives via onLocalStateChange
    });
    return newMuted;
  }, []);

  const toggleSpeaker = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const newSpeaker = !speakerOnRef.current;
    speakerOnRef.current = newSpeaker;
    engine.setSpeakerOn(newSpeaker).catch(() => {
      // non-critical — authoritative state arrives via onLocalStateChange
    });
  }, []);

  /* ══════════════════════════════════════════════
     REMOTE STREAM CONTROL (host/admin use)
  ══════════════════════════════════════════════ */

  const setMicMuted = useCallback((shouldMute: boolean) => {
    const engine = engineRef.current;
    if (!engine) return;
    mutedRef.current = shouldMute;
    engine.setMuted(shouldMute).catch(() => {
      // non-critical
    });
  }, []);

  const muteRemoteUser = useCallback((userID: string) => {
    // Host-side "mute": stop receiving this user's audio locally.
    engineRef.current?.unsubscribe(userID).catch(() => {
      // non-critical
    });
  }, []);

  const playUserStream = useCallback((userID: string) => {
    engineRef.current?.subscribe(userID).catch(() => {
      // non-critical
    });
  }, []);

  const stopUserStream = useCallback((userID: string) => {
    engineRef.current?.unsubscribe(userID).catch(() => {
      // non-critical
    });
  }, []);

  return {
    joined,
    muted,
    speakerOn,
    isPublishing,
    localSpeaking,
    speakingUsers,
    error,
    wasRestored,
    startPublishing,
    stopPublishing,
    retryConnection,
    toggleMic,
    toggleSpeaker,
    setMicMuted,
    muteRemoteUser,
    playUserStream,
    stopUserStream,
  };
}
