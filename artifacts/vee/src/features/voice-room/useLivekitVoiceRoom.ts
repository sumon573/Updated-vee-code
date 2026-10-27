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
import { startVoiceForegroundService, stopVoiceForegroundService } from '@/src/services/voiceForegroundService';
import { NoiseGate, extractMediaSourceLevel } from '@/src/services/noiseGate';
import { setVoiceRoomAudioActive } from '@/src/services/audioOwner';
import { getMinimizedCall } from '@/src/features/audio-call/services/callMinimizeStore';
import { getMusicVolumeSync } from '@/src/features/voice-room/services/musicVolumeService';
import { useTranslation } from 'react-i18next';
import { getMicIntent } from '@/src/store/activeRoom';
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
  /** 2026-10-26 (weak network): engine connection state, surfaced so the
      room can show a "Reconnecting…" pill while auto-recovery runs. */
  connection: VoiceConnectionState;
  muted: boolean;
  /** 2026-10-26 (mic durability): the synchronously-current mute truth
   *  (toggleMic, setMicMuted, restore, seed all set it synchronously).
   *  The screen's first-sight heal reads this, not its lagging mirror. */
  mutedRef: { current: boolean };
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
  /** Room-music bot volume, local to this phone (2026-10-25). */
  setMusicVolume: (volume: number) => void;
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
  /** Identity for watchdog repair (leave + fresh join on the same engine). */
  userId: string;
  userName: string;
};

/** Set to true by VoiceRoomScreen.handleMinimize() before router.back(). */
let _isMinimized = false;
/** Holds the LiveKit room when the screen is minimized so it isn't disconnected. */
let _persistedRoom: PersistedRoom | null = null;

// ─── Minimized-room watchdog (2026-10-25, boss: mic/connection must NEVER
// drop until mute or exit; background must never stop talk or hear) ───────
// ROOT CAUSE of both reports: the hook's auto-retry only runs while the
// room screen is mounted — onLocalStateChange early-returns when unmounted
// and cleanup clears the retry timer. So a minimized room's LiveKit
// connection could die in the background (network blip, server restart,
// OS socket suspend) and NOBODY repaired it: the user heard nothing until
// they returned, and return then refused the restore (not 'connected')
// and did a fresh join — the mic drop + fresh entry the boss felt.
// The watchdog closes that gap: while a room is persisted (minimized), it
// checks the engine every 15 s and repairs a dead connection in the
// background (the same leave + fresh join the mounted retry uses),
// re-applying the mic's muted/published intent — so by return time the
// engine is 'connected' again and the restore path runs with NO mic drop
// and NO fresh entry. It never touches a 'reconnecting' engine: the
// LiveKit SDK heals that in place with the mic track intact. It holds one
// foreground-service ref so the leave→join dip can never drop the service
// to zero mid-repair. Repair never gives up while minimized.
let _persistedWatchdogTimer: ReturnType<typeof setInterval> | null = null;
let _persistedWatchdogRepairing = false;
let _watchdogHoldsService = false;
// 2026-10-26 (boss: long-background return = dead buttons + dead mic):
// the watchdog ticks every 15 s — the timestamp of its last tick proves
// JS was actually alive to observe the engine. A tick older than 120 s
// proves the app was frozen (Tecno/HiOS force-freeze), so any cached
// 'connected' string from before the freeze is unproven and the restore
// path must not trust it. Set on every tick + at watchdog start.
let _lastWatchdogTick = 0;

function stopPersistedWatchdog(): void {
  if (_persistedWatchdogTimer) {
    clearInterval(_persistedWatchdogTimer);
    _persistedWatchdogTimer = null;
  }
  _persistedWatchdogRepairing = false;
  if (_watchdogHoldsService) {
    _watchdogHoldsService = false;
    stopVoiceForegroundService();
  }
}

// ─── Session foreground-service hold (2026-10-25, boss: background
// connection must NEVER drop) ─────────────────────────────────────────────
// The engine starts the service on join and stops it on leave — so a
// background leave→join recovery (mounted auto-retry, watchdog repair)
// drops the service ref to zero mid-recovery. On Android 12+, a
// backgrounded app CANNOT restart a foreground service (throws unless
// battery-exempt), so the recovery silently leaves voice unprotected:
// the next stall freezes JS/network under Doze and hearing dies until
// the user foregrounds the app. The session hold keeps one ref for the
// whole room session (join → true exit), so the service NEVER stops
// mid-session and no background restart is ever needed. Idempotent:
// multiple mounts (minimize/restore cycles) share one hold; it is
// released only on true session end (normal unmount exit, persisted
// destroy, different-room switch).
let _sessionServiceHeld = false;

function acquireSessionServiceHold(): void {
  if (_sessionServiceHeld) return;
  _sessionServiceHeld = true;
  startVoiceForegroundService('Voice room active');
}

function releaseSessionServiceHold(): void {
  if (!_sessionServiceHeld) return;
  _sessionServiceHeld = false;
  stopVoiceForegroundService();
}

function startPersistedWatchdog(): void {
  stopPersistedWatchdog();
  startVoiceForegroundService('Voice room active');
  _watchdogHoldsService = true;
  _lastWatchdogTick = Date.now();
  const tick = () => {
    _lastWatchdogTick = Date.now();
    void (async () => {
      const p = _persistedRoom;
      if (!p) {
        stopPersistedWatchdog();
        return;
      }
      let conn: string;
      try {
        conn = p.engine.getLocalState().connection;
      } catch {
        conn = 'failed';
      }
      // Healthy, or the SDK is healing it in place — hands off.
      if (conn === 'connected' || conn === 'reconnecting' || conn === 'connecting') return;
      if (_persistedWatchdogRepairing) return;
      _persistedWatchdogRepairing = true;
      try {
        await p.engine.leave();
        // Consumed or destroyed while leaving — do not resurrect.
        if (_persistedRoom !== p) return;
        await p.engine.join(p.roomId, { userId: p.userId, userName: p.userName });
        if (_persistedRoom !== p) return;
        // Re-apply the user's mic intent (mute, then seat publish) on the
        // fresh room. publish() starts muted and applies this.muted, so
        // a muted mic never blasts open mid-repair.
        await p.engine.setMuted(p.muted);
        if (p.published) {
          await p.engine.publish();
        }
        try {
          await p.engine.setSpeakerOn(p.speakerOn);
        } catch {
          // non-critical — routing defaults apply
        }
        const s = p.engine.getLocalState();
        p.muted = s.muted;
        p.published = s.publishing;
        p.speakerOn = s.speakerOn;
      } catch {
        // Next tick retries — repair never gives up while minimized.
      } finally {
        _persistedWatchdogRepairing = false;
      }
    })();
  };
  tick();
  _persistedWatchdogTimer = setInterval(tick, 15_000);
}

/** Call before router.back() to keep the voice room alive on minimize. */
export function setVoiceRoomMinimized(minimized: boolean): void {
  _isMinimized = minimized;
}

/** Returns the muted state of the persisted room (for MinimizedRoomBar). */
export function getPersistedVoiceRoomMuted(): boolean {
  return _persistedRoom?.muted ?? false;
}

/**
 * Toggle the persisted (minimized) room's mic (2026-10-10).
 * Lets the user talk/mute while the voice room is minimized.
 * Returns the new muted state. Safe: no-op if no persisted room.
 */
export async function togglePersistedVoiceRoomMic(): Promise<boolean> {
  if (!_persistedRoom) return true;
  const newMuted = !_persistedRoom.muted;
  try {
    await _persistedRoom.engine.setMuted(newMuted);
  } catch {
    // non-critical — keep local state in sync anyway
  }
  _persistedRoom.muted = newMuted;
  return newMuted;
}

/** 2026-10-24 (boss: host-mute must stick): force the persisted
    (minimized) room's mic to a given state. Used by the minimized-bar
    host-mute guard — a host-muted member minimized must not be able to
    unmute from the bar either. */
export async function setPersistedVoiceRoomMic(muted: boolean): Promise<void> {
  if (!_persistedRoom) return;
  try {
    await _persistedRoom.engine.setMuted(muted);
  } catch {
    // non-critical — keep local state in sync anyway
  }
  _persistedRoom.muted = muted;
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
  stopPersistedWatchdog();
  releaseSessionServiceHold();
  engine.leave().catch(() => {
    // non-critical — teardown after navigation
  });
}

/**
 * 2026-10-19 stability fix — awaited variant of
 * destroyPersistedVoiceRoomEngine(). Resolves only after the old engine's
 * leave() (disconnect() + stopAudioSession()) has FULLY completed.
 * Use when switching to a DIFFERENT room: starting the new room's
 * AudioSession.startAudioSession() + room.connect() while the old engine is
 * still tearing down is a classic Android SIGSEGV source.
 */
export async function destroyPersistedVoiceRoomEngineAsync(): Promise<void> {
  if (!_persistedRoom) return;
  const { engine } = _persistedRoom;
  _persistedRoom = null;
  _isMinimized = false;
  stopPersistedWatchdog();
  releaseSessionServiceHold();
  try {
    await engine.leave();
  } catch {
    // non-critical — teardown must never throw to callers
  }
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

// ─── LiveKit token fetch + prefetch cache ────────────────────────────────────
// 2026-10-21 (boss: voice-room entry is slow): entering a room used to run
// STRICTLY serial — RTDB room-info first value → PIN gate → mic check →
// token POST to the VPS → audio session → WebRTC connect. The token POST
// (~0.5–1 s from BD to the EU VPS) sat fully exposed in that chain even
// though it depends on nothing but roomId + userName. The screen now calls
// prefetchLivekitToken() the moment it mounts, so the token is usually
// already in hand when the PIN gate passes; join() consumes the cached
// token when fresh (<45 s — LiveKit tokens live far longer) and only then
// fetches. A prefetched token for a room the user never actually enters
// (PIN-locked, backed out) simply expires unused — token creation is free
// and grants nothing by itself.

type LivekitTokenData = { token: string; url: string };

let tokenCache: {
  roomId: string;
  userName: string;
  at: number;
  promise: Promise<LivekitTokenData>;
} | null = null;

const TOKEN_CACHE_TTL_MS = 45000;

// 2026-10-24 (boss: no token fetch after reopen): getIdToken() below had
// NO timeout — if the Auth SDK stalls there, the join hangs silently
// forever (no fetch, no 'failed', no retry). Bound it: 10 s, then one
// forced-refresh attempt; a persistent stall still surfaces as 'failed'
// so the auto-retry + foreground recovery keep trying instead of hanging.
async function getIdTokenBounded(fbUser: {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}): Promise<string> {
  const attempt = (forceRefresh: boolean, ms: number): Promise<string> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('ID token request timed out')), ms);
    });
    return Promise.race([fbUser.getIdToken(forceRefresh), timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  };
  try {
    return await attempt(false, 10000);
  } catch {
    return await attempt(true, 10000);
  }
}

async function fetchLivekitTokenOnce(roomId: string, userName: string): Promise<LivekitTokenData> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Not signed in');
  const idToken = await getIdTokenBounded(fbUser);
  const tokenCtrl = new AbortController();
  const tokenTimeout = setTimeout(() => tokenCtrl.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/api/livekit/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        roomName: roomId,
        participantName: userName,
        canPublish: true,
      }),
      signal: tokenCtrl.signal,
    });
  } catch (e) {
    throw new Error(
      e instanceof Error && e.name === 'AbortError'
        ? 'Voice server request timed out (20s)'
        : 'Voice server request failed (network)',
    );
  } finally {
    clearTimeout(tokenTimeout);
  }
  if (!res.ok) throw new Error(`Voice server request failed (${res.status})`);
  const data = (await res.json()) as { token?: string; url?: string };
  if (!data.token || !data.url) {
    throw new Error('Voice server returned an invalid response');
  }
  return { token: data.token, url: data.url };
}

/**
 * Token fetch with automatic retries (2026-10-22, boss: "কথা হয় না").
 * A single 20 s attempt gives up forever on a transient network dip —
 * boss's phone hit exactly that: 4G throughput collapsed (~15 K/s) mid-room,
 * the LiveKit connection dropped, and the one-shot token re-fetch timed out
 * even though the server answered other users in <1 s. Retry transient
 * failures (timeout / network error / 5xx) up to 3 attempts with 1 s / 2.5 s
 * backoff so a bad patch self-heals without the user tapping Retry.
 * Non-transient errors (4xx, not signed in, invalid response) fail fast.
 */
async function fetchLivekitToken(roomId: string, userName: string): Promise<LivekitTokenData> {
  const backoffsMs = [1000, 2500];
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= backoffsMs.length; attempt++) {
    try {
      return await fetchLivekitTokenOnce(roomId, userName);
    } catch (e) {
      lastError = e;
      const message = e instanceof Error ? e.message : '';
      const transient =
        message.includes('timed out') ||
        message.includes('(network)') ||
        /\(5\d\d\)$/.test(message);
      if (!transient || attempt === backoffsMs.length) throw e;
      await new Promise((resolve) => setTimeout(resolve, backoffsMs[attempt]));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Voice server request failed (network)');
}

/** Fire-and-forget: warm the token cache for a room the user is entering. */
export function prefetchLivekitToken(roomId: string, userName: string): void {
  if (!roomId || !userName) return;
  if (
    tokenCache &&
    tokenCache.roomId === roomId &&
    tokenCache.userName === userName &&
    Date.now() - tokenCache.at < TOKEN_CACHE_TTL_MS
  ) {
    return;
  }
  const promise = fetchLivekitToken(roomId, userName);
  // Swallow here — join() re-awaits the same promise and surfaces errors.
  promise.catch(() => {});
  tokenCache = { roomId, userName, at: Date.now(), promise };
}

async function acquireLivekitToken(roomId: string, userName: string): Promise<LivekitTokenData> {
  if (
    tokenCache &&
    tokenCache.roomId === roomId &&
    tokenCache.userName === userName &&
    Date.now() - tokenCache.at < TOKEN_CACHE_TTL_MS
  ) {
    const cached = tokenCache;
    tokenCache = null; // single-use — a retry must fetch a fresh token
    return cached.promise;
  }
  return fetchLivekitToken(roomId, userName);
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

  /**
   * 2026-10-19 stability fix — native-op serialization.
   * All native WebRTC mutations (setMicrophoneEnabled / room.disconnect) are
   * funneled through this promise chain. On Android, overlapping a
   * setMicrophoneEnabled() call with room.disconnect() causes a native
   * SIGSEGV that try/catch cannot catch — the "kicked out of the room"
   * crash. The chain never breaks on rejection.
   */
  private opChain: Promise<void> = Promise.resolve();

  /**
   * 2026-10-19 stability fix — join/leave generation.
   * Incremented in leave(). join() captures it at entry and bails out (via
   * teardown) after every await if it changed — so a join in flight during
   * leave() can never resurrect a leaked, permanently-connected Room.
   */
  private opGeneration = 0;

  /**
   * 2026-10-19 stability fix — synchronous double-join guard.
   * Set at the very top of join() (before any await); the old
   * `if (this.room) return` check ran after several awaits, so two
   * overlapping join() calls could both pass and leak a Room.
   */
  private joining = false;

  /**
   * Premium Voice v2 (2026-10-22, Sumon): conservative noise gate on the
   * local mic — silences background noise between sentences. Driven by the
   * capture-side media-source level from the mic sender's stats, gated
   * through the raw MediaStreamTrack only (never the app's mute state).
   * Self-disables whenever its level signal is missing or unreliable.
   */
  private noiseGate: NoiseGate | null = null;

  private localMicHandles(): { mst: { enabled: boolean } | null; sender: unknown } {
    const room = this.room;
    if (!room) return { mst: null, sender: null };
    try {
      const pubs = Array.from(room.localParticipant.audioTrackPublications.values());
      for (const pub of pubs) {
        const track = pub.track as unknown as {
          mediaStreamTrack?: { enabled: boolean };
          sender?: unknown;
        } | null;
        if (track?.mediaStreamTrack) {
          return { mst: track.mediaStreamTrack, sender: track.sender ?? null };
        }
      }
    } catch {
      /* non-critical — gate just never engages */
    }
    return { mst: null, sender: null };
  }

  private startNoiseGate(): void {
    this.stopNoiseGate();
    const gate = new NoiseGate({
      readLevel: async () => {
        const { sender } = this.localMicHandles();
        const s = sender as { getStats?: () => Promise<unknown> } | null;
        if (!s?.getStats) return null;
        return extractMediaSourceLevel(await s.getStats());
      },
      setTrackEnabled: (enabled: boolean) => {
        const { mst } = this.localMicHandles();
        if (mst) mst.enabled = enabled;
      },
      isUserMuted: () => this.muted,
      isSpeaking: () => this.localSpeaking,
    });
    this.noiseGate = gate;
    gate.start();
  }

  private stopNoiseGate(): void {
    if (this.noiseGate) {
      try { this.noiseGate.stop(); } catch { /* non-critical */ }
      this.noiseGate = null;
    }
  }

  /** Identities currently flagged as speaking (remote only). */
  private speakingIds = new Set<string>();
  private participants: VoiceParticipant[] = [];
  private events: VoiceEngineEvents = {};

  /**
   * 2026-10-19 perf fix — throttled participant refresh. Track events and
   * ActiveSpeakersChanged fire in bursts (dozens/second); rebuilding +
   * emitting the full participant array each time re-rendered the whole seat
   * grid. Throttle: one leading emit, then a trailing flush at most every
   * 250ms, and skip the emit when the rebuilt list is identical to the last
   * emitted one. Behavior unchanged — the screen still always converges to
   * the latest room state.
   */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRefreshAt = 0;
  private lastEmittedKey = '';

  private scheduleParticipantsRefresh(): void {
    const now = Date.now();
    if (now - this.lastRefreshAt >= 250) {
      this.lastRefreshAt = now;
      this.refreshParticipants();
      return;
    }
    if (this.refreshTimer) return; // trailing flush already scheduled
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.lastRefreshAt = Date.now();
      this.refreshParticipants();
    }, 250);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

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

  /**
   * 2026-10-19 stability fix — serialize a native WebRTC mutation behind
   * every previously-enqueued one. Returns the op's own promise; the shared
   * chain is always continued (never left broken by a rejection).
   */
  private enqueueNativeOp<T>(op: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(op, op);
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * 2026-10-19 stability fix — true when the join that captured
   * `myGeneration` must abort because leave() ran meanwhile.
   */
  private joinAborted(myGeneration: number): boolean {
    return myGeneration !== this.opGeneration || this.leaveInitiated;
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
        // P1 fix (2026-10-12): || not ?? — LiveKit can carry an empty-string name.
        userName: p.name || p.identity,
        subscribed,
        speaking: this.speakingIds.has(p.identity),
        muted,
      });
    });
    this.participants = list;
    // 2026-10-19 perf fix — diff before emitting: if nothing material
    // changed (ids + speaking + mute + subscribed + name), skip the emit so
    // the seat grid does not re-render on no-op track events.
    const key = list
      .map((p) => `${p.userId}|${p.userName}|${p.speaking ? 1 : 0}|${p.muted === true ? 1 : p.muted === false ? 0 : '-'}|${p.subscribed ? 1 : 0}`)
      .join(',');
    if (key === this.lastEmittedKey) return;
    this.lastEmittedKey = key;
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
    this.scheduleParticipantsRefresh();
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
      // 2026-10-19 stability fix: unexpected disconnect releases the audio
      // pipeline too (leave() may never run for a network drop).
      if (!this.leaveInitiated) setVoiceRoomAudioActive(false);
      if (!this.leaveInitiated && !this.error) {
        this.error = 'Disconnected from the voice room';
      }
    }
    this.emitLocal();
  }

  private registerRoomListeners(room: Room): void {
    const lk = this.lk;
    if (!lk) return; // 2026-10-19 polish: guard instead of non-null assertion
    const { RoomEvent, ParticipantEvent, Track } = lk;
    room
      .on(RoomEvent.ParticipantConnected, () => this.scheduleParticipantsRefresh())
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        this.speakingIds.delete(p.identity);
        this.scheduleParticipantsRefresh();
      })
      .on(RoomEvent.TrackPublished, (pub, participant) => {
        this.scheduleParticipantsRefresh();
        // C12 FIX: Apply mute state when local audio track is published.
        // The track may not exist when setMicrophoneEnabled() is called,
        // so apply the current mute state when publication completes.
        // Uses Track.Kind.Audio enum (not magic number) for type safety.
        try {
          if (participant?.isLocal && pub?.kind === Track.Kind.Audio) {
            this.applyTrackMute(this.muted).catch(() => {});
          }
        } catch { /* non-critical: mute apply is best-effort */ }
      })
      .on(RoomEvent.TrackUnpublished, () => this.scheduleParticipantsRefresh())
      .on(RoomEvent.TrackSubscribed, (_track, _pub, participant) => {
        this.scheduleParticipantsRefresh();
        // 2026-10-25 (room music): the bot (re)publishes on resume — re-apply
        // the listener's saved music volume to the fresh participant object.
        try {
          if ((participant as unknown as { identity?: string } | undefined)?.identity === 'vee-music') {
            this.setMusicVolume();
          }
        } catch { /* non-critical */ }
      })
      .on(RoomEvent.TrackUnsubscribed, () => this.scheduleParticipantsRefresh())
      .on(RoomEvent.TrackMuted, () => this.scheduleParticipantsRefresh())
      .on(RoomEvent.TrackUnmuted, () => this.scheduleParticipantsRefresh())
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
        // 2026-10-19 stability fix: see handleConnectionState.
        if (!this.leaveInitiated) setVoiceRoomAudioActive(false);
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

  /**
   * Room-music volume, LOCAL to this phone (2026-10-25). Applies to the
   * music bot participant ('vee-music', mic source) only — never to
   * voices, never room-wide. No argument = the saved volume (used when
   * the bot (re)joins, so pause/resume keeps the user's level).
   */
  setMusicVolume(volume?: number): void {
    const lk = this.lk;
    const room = this.room;
    if (!lk || !room) return;
    try {
      const v = volume ?? getMusicVolumeSync();
      room.remoteParticipants.forEach((p) => {
        if (p.identity === 'vee-music') {
          p.setVolume(v, lk.Track.Source.Microphone);
        }
      });
    } catch {
      // non-critical — volume is best-effort, music keeps playing
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
    this.stopNoiseGate();
    // 2026-10-19 perf fix: drop any pending throttled refresh — leave paths
    // set their own final state; a trailing emit would be stale work.
    this.clearRefreshTimer();
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
    // 2026-10-19 stability fix: synchronous double-join guard. The old
    // `if (this.room) return` ran after several awaits, so two overlapping
    // join() calls (Retry double-tap, effect re-run) could both pass and
    // leak a Room.
    if (this.room || this.joining) return; // idempotent
    this.joining = true;
    // 2026-10-19 stability fix — mutual exclusion: never join a voice room
    // while a 1-to-1 call is active. Two native audio pipelines on one mic =
    // native WebRTC contention (hard crash). The minimized-call case is the
    // reachable one (an on-screen call owns the route already).
    if (getMinimizedCall()) {
      this.joining = false;
      this.connection = 'failed';
      this.error = 'Please end your current call before joining a voice room';
      this.emitLocal();
      return;
    }
    // 2026-10-19 stability fix: capture the generation. If leave() runs
    // while this join is in flight, every await below bails out instead of
    // resurrecting a leaked, permanently-connected Room.
    const myGeneration = this.opGeneration;
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
      // 2026-10-13: 20s timeout inside fetchLivekitToken — API hang করলে
      // "connecting" অবস্থায় চিরকাল আটকে থাকত, কোনো error-ও দেখাত না।
      // 2026-10-21: usually already prefetched by the screen at mount —
      // acquireLivekitToken returns the in-flight/cached token instantly.
      const data = await acquireLivekitToken(roomId, identity.userName);
      if (this.joinAborted(myGeneration)) return;
      // Crash breadcrumb: token acquired, about to touch the native audio session.
      markVoiceStage('token_ok', roomId);

      // 2. Audio session + connect. The URL comes ONLY from the server response.
      // 2026-10-24 (Sumon): BLUETOOTH — pin the routing explicitly before
      // the session starts: communication preset (Android communication
      // mode → Bluetooth SCO talk/listen engages) and a Bluetooth-first
      // output preference, speaker before earpiece (rooms are speaker-first).
      try {
        await rnSdk.AudioSession.configureAudio({
          android: {
            preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
            audioTypeOptions: rnSdk.AndroidAudioTypePresets.communication,
          },
          ios: { defaultOutput: 'speaker' },
        });
      } catch {
        // non-critical — SDK defaults are the same communication preset
      }
      // 2026-10-24 (boss: a peripheral failure must NEVER kill the whole
      // voice connection): startAudioSession is unprotected here — if it
      // throws (stale session, OS audio busy), the outer catch marks the
      // join 'failed' and every retry dies the same way. The session may
      // already be up (a previous attempt's leak) — connect anyway.
      try {
        await rnSdk.AudioSession.startAudioSession();
      } catch {
        // non-critical — connect proceeds; SDK defaults apply
      }
      if (this.joinAborted(myGeneration)) {
        try {
          await rnSdk.AudioSession.stopAudioSession();
        } catch {
          // non-critical
        }
        return;
      }
      // 2026-10-15 (Sumon): BACKGROUND AUDIO — foreground service (microphone)
      // keeps talking + hearing alive when the app is backgrounded (like IMO).
      // Without it Android suspends the app and the mic dies.
      // 2026-10-24 (boss: connection must never die on a peripheral): FGS
      // start must not throw the join into 'failed' — it only guards
      // background survival, so a failure here (notification/service
      // restriction) must not block connecting at all.
      try {
        startVoiceForegroundService('Voice room active');
      } catch {
        // non-critical — connect proceeds without the background guard
      }
      // Crash breadcrumb: native audio session started — next is WebRTC connect.
      markVoiceStage('audio_session_started', roomId);
      // 2026-10-22 (boss, heat/lag/lifetime fix): adaptiveStream + dynacast
      // make the SFU send only the quality each subscription needs and
      // pause unneeded layers — measurably less CPU, bandwidth and heat on
      // long room stays. Explicit capture defaults pin hardware AEC/NS/AGC
      // (echo/noise suppression) instead of relying on platform defaults.
      const room = new lk.Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Premium Voice v2 (2026-10-22, Sumon): pin full-band capture —
          // mono 48 kHz, so odd devices can't negotiate a thin low-rate mic.
          channelCount: 1,
          sampleRate: 48000,
        },
        // Premium Voice v2: pin publish quality instead of SDK defaults —
        // musicHighQuality = 96 kbps full-band Opus (voice sounds full,
        // never thin), RED redundancy pinned so network loss and
        // future SDK default changes can't silently degrade quality.
        // 2026-10-23 (Sumon order): DTX is OFF — with DTX on, the encoder
        // stops sending during silence and the first syllable after a
        // pause gets clipped/delayed ("কথা ধরছে না"). Instant, uncut
        // speech pickup outranks the tiny silence-bandwidth saving.
        publishDefaults: {
          audioPreset: lk.AudioPresets.musicHighQuality,
          dtx: false,
          red: true,
          forceStereo: false,
        },
      });
      this.room = room;
      markVoiceStage('room_created', roomId);
      this.registerRoomListeners(room);
      markVoiceStage('listeners_registered', roomId);
      markVoiceStage('connect_started', roomId);
      // 2026-10-24 (boss: mic never opens — Alert proved voiceJoined false):
      // room.connect() had NO timeout — a hanging websocket handshake left
      // the join stuck in 'connecting' forever: no error, no auto-retry
      // (retry runs only on 'failed'), mic button dead. Bound it at 20s
      // (same as the token timeout): a timeout throws into the catch below
      // → 'failed' → auto-retry engages, and the mic button's Retry unsticks.
      const connectPromise = room.connect(data.url, data.token);
      // A timed-out attempt may still settle later; never surface it as an
      // unhandled rejection.
      connectPromise.catch(() => {});
      let connectTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          connectPromise,
          new Promise<never>((_, reject) => {
            connectTimer = setTimeout(
              () => reject(new Error('Voice server connection timed out (20s)')),
              20000,
            );
          }),
        ]);
      } finally {
        if (connectTimer) clearTimeout(connectTimer);
      }
      if (this.joinAborted(myGeneration)) {
        // leave() ran during connect() — tear down this Room NOW so it can
        // never leak as a ghost participant with a stuck audio session.
        try {
          await this.teardownRoom();
        } catch {
          // non-critical
        }
        try {
          await rnSdk.AudioSession.stopAudioSession();
        } catch {
          // non-critical
        }
        stopVoiceForegroundService();
        return;
      }

      this.connection = 'connected';
      this.error = null;
      // 2026-10-19 stability fix: this engine now owns the native audio
      // pipeline — block 1-to-1 calls until leave()/disconnect.
      setVoiceRoomAudioActive(true);
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
      // Balance the foreground-service ref-count on failed join.
      stopVoiceForegroundService();
      this.lk = null;
      this.rnSdk = null;
    } finally {
      this.joining = false;
    }
    this.emitLocal();
  }

  async leave(): Promise<void> {
    // 2026-10-19 stability fix: invalidate any in-flight join() FIRST, so
    // its generation checks bail out instead of resurrecting a leaked Room.
    this.opGeneration++;
    this.leaveInitiated = true;
    this.joining = false;
    this.speakingIds.clear();
    this.participants = [];
    // 2026-10-19 stability fix: serialize the disconnect behind any
    // in-flight publish()/unpublish(). room.disconnect() overlapping a
    // native setMicrophoneEnabled() is an Android SIGSEGV.
    try {
      await this.enqueueNativeOp(() => this.teardownRoom());
    } catch {
      // non-critical
    }
    try {
      await this.rnSdk?.AudioSession.stopAudioSession();
    } catch {
      // non-critical
    }
    // 2026-10-15 (Sumon): voice over — drop the foreground service.
    stopVoiceForegroundService();
    // 2026-10-19 stability fix: release the audio pipeline — 1-to-1 calls
    // are allowed again.
    setVoiceRoomAudioActive(false);
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
      // 2026-10-19 stability fix: serialize behind leave()/unpublish().
      // setMicrophoneEnabled() overlapping room.disconnect() natively
      // crashes Android (SIGSEGV) — this await guarantees ordering.
      await this.enqueueNativeOp(async () => {
        // DTX OFF on the mic publish path (2026-10-23, Sumon — see
        // publishDefaults note): speech must be picked up the instant it
        // starts, never clipped after a pause.
        await room.localParticipant.setMicrophoneEnabled(true, undefined, { dtx: false });
        // Start muted — the user unmutes explicitly (mirrors previous behavior).
        await this.applyTrackMute(this.muted);
      });
      // 2026-10-23 (Sumon order): the NoiseGate is RETIRED. It closed the
      // raw mic track after ~900ms of quiet and needed up to a 250ms poll
      // tick to reopen — after any pause, the start of the next sentence
      // was lost/delayed ("চুপ থাকলে mic বন্ধ হয়ে যায়, কথা দেরিতে
      // ধরে"). The mic now stays live continuously; hardware AEC/NS/AGC
      // (pinned in audioCaptureDefaults) handles steady background noise.
      // startNoiseGate() intentionally not called anymore.
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
    this.stopNoiseGate();
    try {
      // 2026-10-19 stability fix: serialize — see publish().
      await this.enqueueNativeOp(() =>
        room.localParticipant.setMicrophoneEnabled(false),
      );
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
    if (muted) {
      // 2026-10-15 (Sumon): ROOT CAUSE — muting mid-speech never fires
      // IsSpeakingChanged(false) (muted track yields no audio frames for the
      // voice-activity detector), so localSpeaking stayed true forever and the
      // ripple kept animating while muted. Clear it authoritatively here.
      this.localSpeaking = false;
    }
    this.emitLocal();
    return this.muted;
  }

  async setSpeakerOn(enabled: boolean): Promise<void> {
    this.speakerOn = enabled;
    try {
      const AudioSession = this.rnSdk?.AudioSession;
      if (AudioSession) {
        const outputs = await AudioSession.getAudioOutputs();
        const find = (needle: string) =>
          outputs.find((o) => o.toLowerCase().includes(needle));
        // 2026-10-24 (Sumon): turning the speaker OFF must route to a
        // connected Bluetooth headset first — never yank audio to the
        // earpiece while Bluetooth is in use.
        const pick = enabled
          ? (find('speaker') ?? outputs[0])
          : (find('bluetooth') ?? find('headset') ?? find('earpiece'));
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
      dtxEnabled: false,
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
  // 2026-10-23 (boss: error banner + manual Retry is not professional):
  // silent auto-recovery bookkeeping — see onLocalStateChange below.
  const autoRetryAttemptsRef = useRef(0);
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryConnectionRef = useRef<() => void>(() => {});
  /** True while the plain-background session watchdog (below) is
   * mid-repair — the AppState return handler must not start a second
   * leave + join on top of it (double teardown = the mic dip). */
  const sessionWatchdogRepairingRef = useRef(false);
  /** Wall-clock time the app last left the foreground (in-place path). */
  const backgroundedAtRef = useRef(0);

  const [joined,        setJoined]        = useState(false);
  // 2026-10-26 (weak network): surfaced so the room can show a
  // "Reconnecting…" pill while auto-recovery runs (it used to hide the
  // error AND show nothing — silence with zero explanation).
  const [connection,    setConnection]    = useState<VoiceConnectionState>('idle');
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
          // 2026-10-23 (boss): SILENT AUTO-RECOVERY. An unexpected
          // disconnect (voice-server restart, network collapse) used to
          // surface a red error banner and wait for a manual Retry tap.
          // Now the hook rejoins by itself with backoff (1s→30s).
          // 2026-10-24 (boss: permanent fix): retries are UNBOUNDED —
          // recovery never stops while the user stays in the room.
          // Big apps never make the user fix the connection by hand.
          if (s.connection === 'connected') {
            autoRetryAttemptsRef.current = 0;
            if (autoRetryTimerRef.current) {
              clearTimeout(autoRetryTimerRef.current);
              autoRetryTimerRef.current = null;
            }
            setError(s.error);
          } else if (s.connection === 'failed' && !isCleaningUpRef.current) {
            // 2026-10-24 (boss: PERMANENT fix): recovery NEVER gives up
            // while the user stays in the room. The old 6-attempt cap left
            // a dead manual-Retry state after ~1 min of outage — server
            // restarts and dead network paths routinely last longer.
            // Backoff caps at 30s and retries forever; the error stays
            // hidden while recovery runs, exactly as before.
            setError(null);
            if (!autoRetryTimerRef.current) {
              const delays = [1000, 2000, 4000, 8000, 15000, 30000];
              const delay = delays[Math.min(autoRetryAttemptsRef.current, delays.length - 1)];
              autoRetryTimerRef.current = setTimeout(() => {
                autoRetryTimerRef.current = null;
                autoRetryAttemptsRef.current += 1;
                retryConnectionRef.current();
              }, delay);
            }
          } else {
            setError(s.error);
          }
          setConnection(s.connection);
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
      // BACKGROUND AUDIO (2026-10-09): Do NOT mute on background — Sumon
      // requires voice to continue when the app is backgrounded (like IMO).
      // The previous privacy-mute behavior is removed.
      // 2026-10-24 (boss: mic dies on reopen): the screen stays mounted
      // across minimize/foreground, so no remount and no fresh join ever
      // runs — and the old auto-retry only fires on 'failed', never on a
      // zombie 'connecting'/'disconnected' engine. When the app comes back
      // to the foreground with a voice engine that is not 'connected',
      // force a rejoin (leave + fresh join, new token fetch) so voice
      // recovers instead of staying dead with no fetch.
      // 2026-10-26 (boss: long-background return = mic drop + re-on):
      // retryConnection() does leave() + fresh join() — a FULL track
      // teardown. The old gap > 120 s clause therefore tore down a
      // HEALTHY engine on every long return: that teardown IS the dip
      // (mic drops, then publish re-opens it). A healthy engine must
      // never be torn down on return. 'connected' and 'reconnecting'
      // both stay untouched — the LiveKit SDK heals 'reconnecting'
      // in place with the mic track intact. Only a genuinely dead
      // engine (neither state) gets the leave + rejoin recovery.
      if (nextState !== 'active') {
        backgroundedAtRef.current = Date.now();
        return;
      }
      const engine = engineRef.current;
      if (!engine || !mountedRef.current) return;
      backgroundedAtRef.current = 0;
      let conn: string = '';
      try {
        conn = engine.getLocalState().connection;
      } catch {
        conn = '';
      }
      if (conn !== 'connected' && conn !== 'reconnecting' && !sessionWatchdogRepairingRef.current) {
        retryConnectionRef.current();
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
      // True session end (not a minimize persist — that path returns
      // before performCleanup): the session hold is released here.
      releaseSessionServiceHold();
    }

    // ── Restore from minimize (reuse persisted room) ──────────────────────
    // The persisted engine is only valid for the SAME room: if the user
    // minimized room A and then opened room B, reusing A's LiveKit room
    // would leak A's audio into B's screen. Tear the stale engine down and
    // fall through to a fresh join for B instead.
    // 2026-10-24 (boss: mic never opens after reopen): a restored engine
    // whose connection already died (network/session/battery while
    // minimized) must NEVER be trusted — restoring it shows the seat as
    // unmuted while the mic stays dead and the buttons do nothing, and no
    // token is ever fetched because restore never joins. Only a
    // 'connected' engine may be restored; anything else falls through to
    // the normal init below, which destroys the dead engine and joins
    // fresh (exactly what a fresh install does).
    // 2026-10-25 (boss: no mic drop, no fresh entry on return): the
    // minimized watchdog now repairs dead engines in the background, so
    // a returned engine is 'connected' again in the normal case. A
    // 'reconnecting' engine is ALSO restorable — the LiveKit SDK heals
    // that in place with the mic track intact, so destroying it for a
    // fresh join would CAUSE the very mic drop this law forbids.
    // 2026-10-26 (boss: long-background return = mic dip): a frozen
    // app stops the JS watchdog, so a stale tick no longer proves the
    // engine is dead — the native LiveKit room can stay healthy while
    // JS is frozen, and destroying it for a fresh join CAUSES the dip
    // this law forbids. A 'connected' or 'reconnecting' engine is
    // restored as-is (the SDK heals 'reconnecting' in place). A
    // genuinely degraded engine still falls through to 'failed', where
    // auto-retry engages — restore never hides a dead engine forever.
    let canRestore = false;
    if (_persistedRoom && _persistedRoom.roomId === roomID) {
      try {
        const c = _persistedRoom.engine.getLocalState().connection;
        canRestore = c === 'connected' || c === 'reconnecting';
      } catch {
        canRestore = false;
      }
    }
    if (canRestore && _persistedRoom) {
      const persisted = _persistedRoom;
      _persistedRoom = null;
      _isMinimized = false;
      stopPersistedWatchdog();
      // Session hold survives minimize (never released on persist), so
      // this is a no-op on a normal return — but it covers the case
      // where an earlier cleanup dropped it.
      acquireSessionServiceHold();

      engineRef.current = persisted.engine;
      // Re-attach handlers with fresh closures on this component instance
      attachHandlers(persisted.engine);
      const s = persisted.engine.getLocalState();
      // FIX (2026-10-10): Use the persisted muted state (user's intent at minimize
      // time), not the engine's possibly-stale s.muted. This prevents the mic
      // from appearing to "drop" for a few seconds on return from minimize.
      // The engine's audio track was never interrupted — only the UI state
      // was getting out of sync.
      mutedRef.current = persisted.muted;
      speakerOnRef.current = s.speakerOn;
      publishedRef.current = s.publishing;
      setMuted(persisted.muted);
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
        // 2026-10-25 (boss: minimize→return STILL fresh-joins + mic drops
        // on the latest bundle): the identity is NOT ready on the first
        // run — the screen passes roomID '' until room-info/PIN resolves
        // (voiceReady flips true later). The old order destroyed the
        // persisted room FIRST and only then returned on empty roomID,
        // so every return killed the minimized engine before the real
        // roomID arrived, and the re-run could only fresh-join (mic drop
        // + fresh entry for everyone). NEVER touch the persisted room
        // while the identity is unresolved — the effect re-runs when the
        // real roomID arrives and the restore branch above reuses it.
        // (Same for userID 'anonymous': AuthContext starts with null.)
        if (!roomID || userID === 'anonymous') return;

        // 2026-10-26 (mic intent seed): same-room minimize-time intent,
        // captured before the teardown below destroys it.
        let seededMuted: boolean | null = null;
        if (_persistedRoom) {
          // Stale persisted room for a DIFFERENT room (roomID is real
          // here, and restore already failed the same-room check above)
          // — destroy it so its audio can't leak into this room, then
          // join fresh below.
          // CRITICAL: await the teardown. The old fire-and-forget
          // `leave().catch()` raced the new engine's native WebRTC/audio init
          // (room.disconnect + AudioSession.stop vs start + Room.connect),
          // a classic SIGSEGV source on Android.
          const stale = _persistedRoom;
          // Same-room leftovers (stale watchdog) carry the user's live
          // intent; different-room leftovers must NOT seed (a new room's
          // seat-take still starts unmuted by design).
          if (stale.roomId === roomID) seededMuted = stale.muted;
          _persistedRoom = null;
          _isMinimized = false;
          stopPersistedWatchdog();
          // Different room: the old session ends here — its hold is
          // released; the new room acquires its own at its join below.
          releaseSessionServiceHold();
          try {
            await stale.engine.leave();
          } catch {
            // non-critical — stale room teardown
          }
          if (!mountedRef.current) return;
        }

        // 2026-10-26 (mic durability, cold-start seed): a cold start has
        // no _persistedRoom (process died with it), so the old code left
        // the fresh engine on its muted=true default and the first-sight
        // seat heal then wrote that default into the seat, cementing a
        // stuck mute. Fall back to the durable tap intent — same room
        // only. Host-mute never writes this key (see persistMicIntent).
        if (seededMuted === null) {
          try {
            const d = await getMicIntent();
            if (d && d.roomId === roomID && typeof d.muted === 'boolean') seededMuted = d.muted;
          } catch {
            // non-critical — seed is best-effort, defaults stand
          }
        }

        // Skip entirely in Expo Go — native WebRTC modules not available
        if (isExpoGo()) return;

        // Crash breadcrumb: the screen now begins the native voice init
        // sequence (SDK load → token → audio session).
        markVoiceStage('engine_init_start', roomID);

        // 2026-10-21 (boss: room entry is slow): mic permission is NO
        // LONGER requested on entry. Joining is audience-only — no mic is
        // published — so the permission round-trip (and, for a first-time
        // user, a blocking system dialog) taxed every entry for nothing.
        // The permission is now requested lazily in startPublishing(),
        // the moment the user actually takes a seat.

        if (!mountedRef.current) return;

        // Session hold starts here (join intent) and lasts until true
        // exit — background leave→join recoveries can never drop the
        // foreground service to zero mid-session (see hold comment).
        acquireSessionServiceHold();
        const engine = new LivekitVoiceRoomEngine();
        // 2026-10-26 (mic intent seed): a fresh engine defaults to
        // muted=true — on a long-background return that default dropped
        // live mics (and the seat sync then auto-on'd them). Seed the
        // same-room minimize-time intent BEFORE join, mirroring the
        // watchdog repair's setMuted(p.muted) pattern. Null = true fresh
        // entry or different room: defaults stand (seat-take unmuted).
        // setMuted pre-join is safe: applyTrackMute no-ops with no room.
        if (seededMuted !== null) {
          await engine.setMuted(seededMuted);
          mutedRef.current = seededMuted;
          setMuted(seededMuted);
        }
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
      // Silent auto-recovery must not outlive the screen.
      if (autoRetryTimerRef.current) {
        clearTimeout(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
      }
      autoRetryAttemptsRef.current = 0;

      // Crash breadcrumb: the screen unmounted without a native crash, so any
      // in-flight join breadcrumb must not survive (a real crash never runs
      // this cleanup, which is exactly how we tell the two apart).
      clearVoiceBreadcrumb();

      // Minimize path: save the room to module-level persist instead of leaving
      if (_isMinimized && engineRef.current) {
        // FIX (2026-10-10): Do NOT force-mute on minimize — Sumon requires
        // talking AND listening while minimized (like IMO). The mic stays in
        // its current state; the user toggles it from the MinimizedRoomBar.
        const eng = engineRef.current;
        _persistedRoom = {
          engine:    eng,
          roomId:    roomID,
          muted:     mutedRef.current,
          published: publishedRef.current,
          speakerOn: speakerOnRef.current,
          userId:    userID,
          userName,
        };
        engineRef.current = null;
        mountedRef.current = false;
        // 2026-10-25 (boss: connection must never drop while minimized):
        // start the watchdog so a dead engine is repaired in the
        // background instead of surfacing as a fresh entry on return.
        startPersistedWatchdog();
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
    // 2026-10-21: mic permission moved here from room entry (see the init
    // effect) — requested only when the user actually takes a seat and is
    // about to publish. Already-granted resolves in milliseconds.
    (async () => {
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
        return;
      }
      await engineRef.current?.publish();
    })().catch(() => {
      // non-critical — engine surfaces failures via state
    });
  }, [t]);

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
  // Kept fresh for the silent auto-recovery scheduler above.
  useEffect(() => { retryConnectionRef.current = retryConnection; }, [retryConnection]);

  /* ══════════════════════════════════════════════
     PLAIN-BACKGROUND SESSION WATCHDOG (2026-10-27, boss: mic must NEVER
     drop, background talk + listen UNLIMITED)
     ──────────────────────────────────────────────────────────────
     The minimized watchdog above heals ONLY _isMinimized sessions. A
     plain-background session (app left via Home/recents, NO bubble)
     had NO background repair: the socket starved, the server dropped
     the participant, and return found a dead engine — so return ran
     leave + fresh join (full track teardown) and the user felt the mic
     release and re-enable, while voice-dependent buttons sat dead
     until the fresh join (token fetch + audio session + connect, up to
     tens of seconds) finished. That return window IS the reported
     "buttons don't work until a long load finishes".
     This session-level watchdog closes it: while the screen is mounted
     and the app is NOT foreground, it checks the engine every 15 s and
     heals a dead connection in the background (leave + re-attach
     handlers + fresh join, exactly as retryConnection orders it),
     re-applying the EXISTING muted/published/speaker intent only —
     the same pattern as the minimized watchdog tick. No duration cap,
     no teardown of a healthy/reconnecting engine, no giving up while
     the session is alive — so return finds a 'connected' engine, no
     teardown, no fresh join, and buttons respond immediately.
     It is CONNECTION repair, not mic logic: muted/published/speakerOn
     refs are READ, never computed anew; the read-back after repair
     mirrors the minimized tick (onLocalStateChange also syncs React
     state). It never runs while _isMinimized (the persisted watchdog
     owns that case), never while AppState is 'active' (the return
     handler + auto-retry own the foreground), and never while an
     auto-retry timer is pending (no double repair).
     HONEST LIMIT (do not hide it): if the OS fully freezes JS (Doze /
     OEM force-freeze), no JS interval can tick until JS runs again —
     the watchdog heals the moment JS runs, and the session foreground-
     service hold + battery exemption are what keep JS running. If the
     OS kills the process outright, that is a cold start, not a
     watchdog case — return then IS a full load, and no app code
     removes that; the hold + exemption minimize how often it happens.
  ══════════════════════════════════════════════ */
  useEffect(() => {
    const tick = () => {
      void (async () => {
        if (!mountedRef.current) return;
        if (_isMinimized) return;
        if (AppState.currentState === 'active') return;
        if (autoRetryTimerRef.current) return;
        const engine = engineRef.current;
        if (!engine) return;
        let conn: string = '';
        try {
          conn = engine.getLocalState().connection;
        } catch {
          conn = '';
        }
        if (conn === 'connected' || conn === 'reconnecting' || conn === 'connecting') return;
        if (sessionWatchdogRepairingRef.current) return;
        sessionWatchdogRepairingRef.current = true;
        try {
          await engine.leave();
          if (!mountedRef.current || engineRef.current !== engine) return;
          // leave() wipes handlers — re-attach before join, or state
          // updates never reach React after the repair.
          attachRef.current(engine);
          const id = identityRef.current;
          if (!id.roomID || id.userID === 'anonymous') return;
          await engine.join(id.roomID, { userId: id.userID, userName: id.userName });
          if (!mountedRef.current || engineRef.current !== engine) return;
          // Re-apply EXISTING intent only (minimized-watchdog pattern).
          await engine.setMuted(mutedRef.current);
          if (publishedRef.current) {
            await engine.publish();
          }
          try {
            await engine.setSpeakerOn(speakerOnRef.current);
          } catch {
            // non-critical — routing defaults apply
          }
        } catch {
          // Next tick retries — repair never gives up while alive.
        } finally {
          sessionWatchdogRepairingRef.current = false;
        }
      })();
    };
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
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
    // 2026-10-11: update UI state directly for instant feedback — do not rely
    // solely on emitLocal()/onLocalStateChange round-trip.
    setSpeakerOn(newSpeaker);
    engine.setSpeakerOn(newSpeaker).catch(() => {
      // non-critical — state already updated above
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

  const setMusicVolume = useCallback((volume: number) => {
    engineRef.current?.setMusicVolume(volume);
  }, []);

  return {
    joined,
    connection,
    muted,
    // 2026-10-26 (mic durability): the synchronously-current mute truth.
    // toggleMic, setMicMuted, restore and seed all set mutedRef.current
    // synchronously; the screen's mirrored ref lags one commit, which
    // is exactly what let the first-sight heal write a default.
    mutedRef,
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
    setMusicVolume,
  };
}
