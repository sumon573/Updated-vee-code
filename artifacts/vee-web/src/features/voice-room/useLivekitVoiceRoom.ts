/**
 * useLivekitVoiceRoom — web port of the native voice-room hook.
 *
 * Faithful port of the native `useLivekitVoiceRoom.ts` behavior:
 *   • join(): fetch a LiveKit token from POST /api/livekit/token
 *     ({ roomName, participantName, canPublish: true }) and connect with
 *     `new Room()` + `room.connect(url, token)`. The connect URL comes ONLY
 *     from the server response — never hardcoded.
 *   • Join as AUDIENCE: the mic track is NOT published until startPublishing().
 *   • startPublishing() enables the local mic (DTX on), starting muted — the
 *     user unmutes explicitly (mirrors native).
 *   • toggleMic / setMicMuted toggle the local mic track.
 *   • Host-driven mute: the seat `muted` field in RTDB is the authority; the
 *     target client calls setMicMuted() to match. Host-side "mute remote"
 *     (muteRemoteUser) = unsubscribe from that participant's audio locally.
 *   • Reconnect: RoomEvent.Reconnecting → 'reconnecting'. An unexpected
 *     RoomEvent.Disconnected triggers an automatic rejoin with a FRESH
 *     token (tokens have a 6h TTL), restoring mic/publish state. After the
 *     auto-retry budget is spent the hook surfaces `error` and
 *     retryConnection() performs a manual teardown + fresh-token rejoin.
 *   • Errors never throw to the UI — they surface via `error`.
 *   • Unmount cleanup: unpublish, room.disconnect(), removeAllListeners().
 *
 * Web differences (deliberate):
 *   • No Expo/minimize persist — page navigation performs full cleanup.
 *   • No AppState background mute: background audio is a feature on web
 *     (Media Session handlers keep it controllable from the OS UI).
 *   • toggleSpeaker is a UI state only — browsers always route to the
 *     default output device (no earpiece concept).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  ParticipantEvent,
  ConnectionState,
} from 'livekit-client';
import type {
  LocalAudioTrack,
  Participant,
  RemoteParticipant,
  RemoteTrackPublication,
} from 'livekit-client';
import { apiFetch } from '../../lib/api';

/** Max automatic rejoin attempts after an unexpected disconnect. */
const MAX_AUTO_REJOIN = 3;
/** Base delay (ms) between auto-rejoin attempts; doubles each attempt. */
const REJOIN_BASE_DELAY_MS = 1500;

export type VoiceRoomConnection =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'ended';

export interface LivekitRoomOptions {
  roomId: string;
  userId: string;
  userName: string;
}

export interface LivekitRoomState {
  joined: boolean;
  muted: boolean;
  speakerOn: boolean;
  isPublishing: boolean;
  localSpeaking: boolean;
  /** identity (Firebase uid) → speaking. */
  speakingUsers: Record<string, boolean>;
  connection: VoiceRoomConnection;
  error: string | null;
  startPublishing: () => void;
  stopPublishing: () => void;
  toggleMic: () => void;
  toggleSpeaker: () => void;
  /** Directly set the mic muted state (host-driven remote mute). */
  setMicMuted: (muted: boolean) => void;
  /** Host-side mute: stop receiving this user's audio locally. */
  muteRemoteUser: (userId: string) => void;
  /** Host-side unmute of a remote user (resubscribe locally). */
  playUserStream: (userId: string) => void;
  stopUserStream: (userId: string) => void;
  /** Manual retry after a failure surfaced via `error`. */
  retryConnection: () => void;
}

interface TokenResponse {
  token?: string;
  url?: string;
}

export function useLivekitVoiceRoom(options: LivekitRoomOptions): LivekitRoomState {
  const { roomId, userId, userName } = options;

  const roomRef = useRef<Room | null>(null);
  const mountedRef = useRef(true);
  const leaveInitiatedRef = useRef(false);
  const mutedRef = useRef(true);
  const publishingRef = useRef(false);
  const rejoinAttemptsRef = useRef(0);
  const rejoinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityRef = useRef({ roomId, userId, userName });
  identityRef.current = { roomId, userId, userName };

  const [joined, setJoined] = useState(false);
  const [muted, setMutedState] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [speakingUsers, setSpeakingUsers] = useState<Record<string, boolean>>({});
  const [connection, setConnection] = useState<VoiceRoomConnection>('idle');
  const [error, setError] = useState<string | null>(null);

  /* ── helpers ─────────────────────────────────────────────────────────── */

  const applyTrackMute = useCallback(async (shouldMute: boolean): Promise<void> => {
    const room = roomRef.current;
    if (!room) return;
    try {
      const pubs = Array.from(room.localParticipant.audioTrackPublications.values());
      for (const pub of pubs) {
        const track = pub.track as LocalAudioTrack | undefined;
        if (!track) continue;
        if (shouldMute) {
          await track.mute();
        } else {
          await track.unmute();
        }
      }
    } catch {
      // non-critical — mute intent is recorded in state regardless
    }
  }, []);

  const setRemoteSubscribed = useCallback((targetUserId: string, subscribed: boolean): void => {
    const room = roomRef.current;
    if (!room) return;
    try {
      room.remoteParticipants.forEach((p: RemoteParticipant) => {
        if (p.identity !== targetUserId) return;
        p.audioTrackPublications.forEach((pub) => {
          (pub as RemoteTrackPublication).setSubscribed(subscribed);
        });
      });
    } catch {
      // non-critical
    }
  }, []);

  const teardownRoom = useCallback(async (): Promise<void> => {
    if (rejoinTimerRef.current) {
      clearTimeout(rejoinTimerRef.current);
      rejoinTimerRef.current = null;
    }
    const room = roomRef.current;
    roomRef.current = null;
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
  }, []);

  /** Fetch a fresh token and connect a new Room. Throws on failure. */
  const connectWithFreshToken = useCallback(async (): Promise<void> => {
    const { roomId: rid, userId: uid, userName: uname } = identityRef.current;
    const data = await apiFetch<TokenResponse>('/api/livekit/token', {
      method: 'POST',
      body: { roomName: rid, participantName: uname, canPublish: true },
    });
    if (!data.token || !data.url) {
      throw new Error('Voice server returned an invalid response');
    }
    const room = new Room();
    roomRef.current = room;
    attachRoomListeners(room, uid);
    // The connect URL comes ONLY from the server response — never hardcoded.
    await room.connect(data.url, data.token);
    try {
      // Satisfy browser autoplay policies so remote audio actually plays.
      await room.startAudio();
    } catch {
      // non-critical — audio may still start on the first user gesture
    }
  }, []);

  const attachRoomListeners = useCallback(
    (room: Room, localIdentity: string): void => {
      room
        .on(RoomEvent.ParticipantConnected, () => {
          // participant list derived on demand by the UI
        })
        .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
          setSpeakingUsers((prev) => {
            if (!(p.identity in prev)) return prev;
            const next = { ...prev };
            delete next[p.identity];
            return next;
          });
        })
        .on(RoomEvent.ActiveSpeakersChanged, (speakers: Array<Participant>) => {
          setSpeakingUsers((prev) => {
            const next: Record<string, boolean> = {};
            for (const p of speakers) {
              if (p.identity !== localIdentity) next[p.identity] = true;
            }
            // shallow-compare to avoid useless re-renders
            const prevKeys = Object.keys(prev);
            const nextKeys = Object.keys(next);
            if (
              prevKeys.length === nextKeys.length &&
              nextKeys.every((k) => prev[k])
            ) {
              return prev;
            }
            return next;
          });
        })
        .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (!mountedRef.current) return;
          if (state === ConnectionState.Connected) {
            setConnection('connected');
            setJoined(true);
            setError(null);
            rejoinAttemptsRef.current = 0;
          } else if (
            state === ConnectionState.Reconnecting ||
            state === ConnectionState.SignalReconnecting
          ) {
            setConnection('reconnecting');
          } else if (state === ConnectionState.Disconnected) {
            if (leaveInitiatedRef.current) {
              setConnection('ended');
              setJoined(false);
            }
          }
        })
        .on(RoomEvent.Reconnecting, () => {
          if (!mountedRef.current) return;
          setConnection('reconnecting');
        })
        .on(RoomEvent.Reconnected, () => {
          if (!mountedRef.current) return;
          setConnection('connected');
          setJoined(true);
          setError(null);
          rejoinAttemptsRef.current = 0;
        })
        .on(RoomEvent.Disconnected, () => {
          if (!mountedRef.current) return;
          if (leaveInitiatedRef.current) {
            setConnection('ended');
            setJoined(false);
            return;
          }
          // Unexpected disconnect (SDK auto-reconnect already failed):
          // rejoin with a FRESH token, restoring mic/publish state.
          void attemptAutoRejoin();
        });

      room.localParticipant.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
        if (!mountedRef.current) return;
        setLocalSpeaking(speaking === true);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Rejoin after an unexpected disconnect with a fresh token, restoring the
   * mic/publish state. Attempts are budgeted; when exhausted the hook
   * surfaces `error` and waits for a manual retryConnection().
   */
  const attemptAutoRejoin = useCallback(async (): Promise<void> => {
    if (leaveInitiatedRef.current || !mountedRef.current) return;
    const attempt = rejoinAttemptsRef.current;
    if (attempt >= MAX_AUTO_REJOIN) {
      setConnection('failed');
      setJoined(false);
      setError('Disconnected from the voice room. Tap retry to rejoin.');
      return;
    }
    rejoinAttemptsRef.current = attempt + 1;
    setConnection('reconnecting');
    setError(null);
    await teardownRoom();
    const delay = REJOIN_BASE_DELAY_MS * 2 ** attempt;
    rejoinTimerRef.current = setTimeout(() => {
      rejoinTimerRef.current = null;
      if (leaveInitiatedRef.current || !mountedRef.current) return;
      void (async () => {
        try {
          await connectWithFreshToken();
          if (!mountedRef.current || leaveInitiatedRef.current) return;
          // Restore mic state: re-publish if we were publishing, then apply
          // the last known mute state.
          if (publishingRef.current) {
            const room = roomRef.current;
            if (room) {
              try {
                await room.localParticipant.setMicrophoneEnabled(true, undefined, {
                  dtx: true,
                });
              } catch {
                // non-critical — publish state surfaces via isPublishing
              }
            }
          }
          await applyTrackMute(mutedRef.current);
          setConnection('connected');
          setJoined(true);
          setError(null);
          rejoinAttemptsRef.current = 0;
        } catch {
          // Schedule the next attempt (or surface the error if budget spent).
          void attemptAutoRejoin();
        }
      })();
    }, delay);
  }, [applyTrackMute, connectWithFreshToken, teardownRoom]);

  /* ── join / leave lifecycle ──────────────────────────────────────────── */

  useEffect(() => {
    mountedRef.current = true;
    leaveInitiatedRef.current = false;
    rejoinAttemptsRef.current = 0;
    let cancelled = false;

    (async () => {
      if (!roomId || !userId) return;
      if (!mountedRef.current || cancelled) return;
      setConnection('connecting');
      setError(null);
      try {
        await connectWithFreshToken();
        if (cancelled || !mountedRef.current) return;
        setConnection('connected');
        setJoined(true);
        setError(null);
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        await teardownRoom();
        setConnection('failed');
        setJoined(false);
        setError(err instanceof Error ? err.message : 'Voice room connection failed');
      }
    })().catch(() => {
      // non-critical — failures surface via state
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      leaveInitiatedRef.current = true;
      void (async () => {
        try {
          await roomRef.current?.localParticipant.setMicrophoneEnabled(false);
        } catch {
          // non-critical
        }
        await teardownRoom();
        publishingRef.current = false;
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId]);

  /* ── actions ─────────────────────────────────────────────────────────── */

  const startPublishing = useCallback((): void => {
    const room = roomRef.current;
    if (!room || publishingRef.current) return;
    void (async () => {
      try {
        await room.localParticipant.setMicrophoneEnabled(true, undefined, { dtx: true });
        if (!mountedRef.current) return;
        publishingRef.current = true;
        setIsPublishing(true);
        // Start muted — the user unmutes explicitly (mirrors native).
        await applyTrackMute(mutedRef.current);
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to enable microphone');
        }
      }
    })();
  }, [applyTrackMute]);

  const stopPublishing = useCallback((): void => {
    const room = roomRef.current;
    if (!room || !publishingRef.current) return;
    publishingRef.current = false;
    setIsPublishing(false);
    setLocalSpeaking(false);
    void (async () => {
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch {
        // non-critical
      }
    })();
  }, []);

  const setMicMuted = useCallback(
    (shouldMute: boolean): void => {
      mutedRef.current = shouldMute;
      setMutedState(shouldMute);
      void applyTrackMute(shouldMute);
    },
    [applyTrackMute],
  );

  const toggleMic = useCallback((): void => {
    const newMuted = !mutedRef.current;
    setMicMuted(newMuted);
  }, [setMicMuted]);

  const toggleSpeaker = useCallback((): void => {
    // Web has no earpiece routing — browsers always use the default output.
    // Kept as UI state for parity with the native hook's return shape.
    setSpeakerOn((prev) => !prev);
  }, []);

  const muteRemoteUser = useCallback(
    (targetUserId: string): void => {
      // Host-side "mute": stop receiving this user's audio locally.
      setRemoteSubscribed(targetUserId, false);
    },
    [setRemoteSubscribed],
  );

  const playUserStream = useCallback(
    (targetUserId: string): void => {
      setRemoteSubscribed(targetUserId, true);
    },
    [setRemoteSubscribed],
  );

  const stopUserStream = useCallback(
    (targetUserId: string): void => {
      setRemoteSubscribed(targetUserId, false);
    },
    [setRemoteSubscribed],
  );

  /** Manual retry: full teardown, then rejoin with a fresh token. */
  const retryConnection = useCallback((): void => {
    if (!mountedRef.current) return;
    leaveInitiatedRef.current = false;
    rejoinAttemptsRef.current = 0;
    setError(null);
    setConnection('connecting');
    void (async () => {
      await teardownRoom();
      if (!mountedRef.current) return;
      try {
        await connectWithFreshToken();
        if (!mountedRef.current || leaveInitiatedRef.current) return;
        if (publishingRef.current) {
          const room = roomRef.current;
          if (room) {
            try {
              await room.localParticipant.setMicrophoneEnabled(true, undefined, {
                dtx: true,
              });
            } catch {
              // non-critical
            }
          }
        }
        await applyTrackMute(mutedRef.current);
        setConnection('connected');
        setJoined(true);
        setError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        setConnection('failed');
        setJoined(false);
        setError(err instanceof Error ? err.message : 'Voice room connection failed');
      }
    })();
  }, [applyTrackMute, connectWithFreshToken, teardownRoom]);

  return {
    joined,
    muted,
    speakerOn,
    isPublishing,
    localSpeaking,
    speakingUsers,
    connection,
    error,
    startPublishing,
    stopPublishing,
    toggleMic,
    toggleSpeaker,
    setMicMuted,
    muteRemoteUser,
    playUserStream,
    stopUserStream,
    retryConnection,
  };
}
