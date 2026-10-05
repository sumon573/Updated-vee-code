/**
 * RoomPage — the voice room screen (web port of the native VoiceRoomScreen).
 *
 * Wires together:
 *  - useLivekitVoiceRoom (LiveKit audio: join as audience, publish on seat
 *    take, mic toggle, host mute, reconnect with fresh tokens)
 *  - RTDB seat/audience state (10 seats, transaction-safe take, onDisconnect
 *    ghost cleanup, host mute authority via seat `muted`)
 *  - Gift showpiece: GiftReceiveBanners (combo-counting banners from the
 *    giftFeed) + GiftFlyAnimation (flying arc to the recipient's seat)
 *  - Media Session handlers so background audio stays controllable from OS UI
 *
 * Gift SENDING lives on the wallet page — this screen only renders incoming
 * gifts from `rooms/{roomId}/giftFeed`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { clearMediaSession, setMediaSessionHandlers } from '../../lib/mediaSession';
import {
  GiftFlyAnimation,
  GiftReceiveBanners,
  parseFeedEntry,
  type GiftFlyHandle,
} from './GiftFlyAnimation';
import {
  isBlockedFromRoom,
  joinRoomAsAudience,
  leaveAudience,
  leaveSeat,
  lockSeat,
  removeSeat,
  sendSeatRequest,
  setSeatMute,
  subscribeAudience,
  subscribeGiftFeed,
  subscribeLockedSeats,
  subscribeRoomInfo,
  subscribeSeats,
  takeSeat,
  unlockSeat,
} from './roomService';
import { useLivekitVoiceRoom } from './useLivekitVoiceRoom';
import { SEAT_COUNT, hashAvatarColor, initialsOf } from './types';
import type {
  RoomAudienceMember,
  RoomInfoShape,
  RoomSeat,
  SeatRole,
} from './types';
import './room.css';

interface RoomUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

/* ═══════════════════════════════════════════
   Seat card
═══════════════════════════════════════════ */

function SeatAvatar({
  photoURL,
  name,
  size,
}: {
  photoURL?: string;
  name: string;
  size: number;
}): React.JSX.Element {
  if (photoURL) {
    return (
      <span className="seat-avatar" style={{ width: size, height: size }}>
        <img src={photoURL} alt={name} />
      </span>
    );
  }
  return (
    <span
      className="seat-avatar"
      style={{ width: size, height: size, backgroundColor: hashAvatarColor(name) }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

function SeatCard({
  seat,
  idx,
  locked,
  speaking,
  isMe,
  onPress,
  buttonRef,
}: {
  seat: RoomSeat | null;
  idx: number;
  locked: boolean;
  speaking: boolean;
  isMe: boolean;
  onPress: (idx: number) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}): React.JSX.Element {
  const isHostSeat = idx === 0 || seat?.role === 'host';
  const className = [
    'seat',
    !seat ? 'seat-empty' : '',
    locked && !seat ? 'seat-locked' : '',
    speaking ? 'seat-speaking' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      ref={buttonRef}
      className={className}
      onClick={() => onPress(idx)}
      aria-label={seat ? `${seat.userName}${seat.muted ? ' (muted)' : ''}` : `Empty seat ${idx + 1}`}
    >
      {isHostSeat && seat ? <span className="seat-host-badge">👑</span> : null}
      {seat ? (
        <>
          {seat.muted ? (
            <span className="seat-mic muted">🔇</span>
          ) : (
            <span className="seat-mic live">🎙</span>
          )}
          <SeatAvatar photoURL={seat.photoURL} name={seat.userName} size={52} />
          <span className="seat-name">
            {seat.userName}
            {isMe ? ' (you)' : ''}
          </span>
          <span className="seat-sub">{seat.role === 'host' ? 'Host' : seat.role}</span>
        </>
      ) : (
        <>
          <span className="seat-plus">{locked ? '🔒' : '+'}</span>
          <span className="seat-sub">{locked ? 'Locked' : `Seat ${idx + 1}`}</span>
        </>
      )}
    </button>
  );
}

/* ═══════════════════════════════════════════
   Live room (voice + seats + gifts)
═══════════════════════════════════════════ */

function RoomLive({
  roomId,
  info,
  user,
}: {
  roomId: string;
  info: RoomInfoShape;
  user: RoomUser;
}): React.JSX.Element {
  const navigate = useNavigate();
  const myUid = user.uid;
  const myName = user.displayName?.trim() || user.email?.split('@')[0] || 'Guest';
  const myPhoto: string | undefined = user.photoURL ?? undefined;
  const myInitials = initialsOf(myName);
  const myColor = hashAvatarColor(myName);

  const [seats, setSeats] = useState<Array<RoomSeat | null>>(() =>
    Array<RoomSeat | null>(SEAT_COUNT).fill(null),
  );
  const [audience, setAudience] = useState<RoomAudienceMember[]>([]);
  const [lockedSeats, setLockedSeats] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<number | null>(null);

  const seatsRef = useRef(seats);
  const lockedSeatsRef = useRef(lockedSeats);
  const mySeatIdxRef = useRef(-1);
  const leavingRef = useRef(false);
  const hadAudienceRef = useRef(false);
  /** Seat index we're moving to ('gone' = leaving to audience); cleared once the seats snapshot confirms. */
  const pendingSeatRef = useRef<number | 'gone' | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const seatElRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const flyRef = useRef<GiftFlyHandle>(null);

  const mySeatIdx = seats.findIndex((s) => s?.userId === myUid);
  mySeatIdxRef.current = mySeatIdx;

  const myRole: SeatRole =
    info.ownerId === myUid
      ? 'host'
      : mySeatIdx >= 0 && seats[mySeatIdx]?.role === 'admin'
        ? 'admin'
        : 'member';
  const isOwnerOrAdmin = info.ownerId === myUid || myRole === 'admin';

  const {
    joined,
    muted,
    isPublishing,
    localSpeaking,
    speakingUsers,
    connection,
    error,
    startPublishing,
    stopPublishing,
    toggleMic: engineToggleMic,
    setMicMuted,
    muteRemoteUser,
    playUserStream,
    stopUserStream,
    retryConnection,
  } = useLivekitVoiceRoom({ roomId, userId: myUid, userName: myName });

  /* ── helpers ── */

  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 6000);
  }, []);

  const audienceMemberForMe = useCallback((): RoomAudienceMember => {
    return {
      userId: myUid,
      userName: myName,
      initials: myInitials,
      color: myColor,
      ...(myPhoto ? { photoURL: myPhoto } : {}),
    };
  }, [myUid, myName, myInitials, myColor, myPhoto]);

  const leave = useCallback(async (): Promise<void> => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    try {
      const idx = mySeatIdxRef.current;
      if (idx >= 0) {
        await leaveSeat(roomId, idx, myUid);
      } else {
        await leaveAudience(roomId, myUid);
      }
    } catch {
      // non-critical — onDisconnect handlers clean up ghosts
    }
    clearMediaSession();
    navigate('/');
  }, [roomId, myUid, navigate]);

  /* ── subscriptions ── */

  useEffect(() => {
    const unsubs = [
      subscribeSeats(roomId, (next) => {
        seatsRef.current = next;
        setSeats(next);
      }),
      subscribeAudience(roomId, setAudience),
      subscribeLockedSeats(roomId, (next) => {
        lockedSeatsRef.current = next;
        setLockedSeats(next);
      }),
    ];
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [roomId]);

  /* ── join as audience + full cleanup on unmount ── */

  useEffect(() => {
    const member = audienceMemberForMe();
    joinRoomAsAudience(roomId, member).catch(() => {
      // non-critical — presence is best-effort
    });
    return () => {
      leavingRef.current = true;
      void (async () => {
        try {
          const idx = mySeatIdxRef.current;
          if (idx >= 0) {
            await leaveSeat(roomId, idx, myUid);
          } else {
            await leaveAudience(roomId, myUid);
          }
        } catch {
          // non-critical — onDisconnect handlers clean up ghosts
        }
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  /* ── host-driven mute sync: seat `muted` is the authority ── */

  const prevFbMutedRef = useRef<boolean | null>(null);
  const prevSeatIdxRef = useRef(-1);
  useEffect(() => {
    if (mySeatIdx < 0) {
      prevFbMutedRef.current = null;
      prevSeatIdxRef.current = -1;
      return;
    }
    if (prevSeatIdxRef.current !== mySeatIdx) {
      prevFbMutedRef.current = null;
      prevSeatIdxRef.current = mySeatIdx;
    }
    const mySeat = seats[mySeatIdx];
    if (!mySeat) return;
    const fbMuted = mySeat.muted;
    if (prevFbMutedRef.current === fbMuted) return;
    prevFbMutedRef.current = fbMuted;
    if (isPublishing) {
      setMicMuted(fbMuted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats, mySeatIdx, isPublishing]);

  /* ── kicked-from-seat detection ── */

  const prevMySeatIdxRef = useRef(-1);
  useEffect(() => {
    const prev = prevMySeatIdxRef.current;
    prevMySeatIdxRef.current = mySeatIdx;
    const pending = pendingSeatRef.current;
    if (pending !== null) {
      const resolved = pending === 'gone' ? mySeatIdx < 0 : mySeatIdx === pending;
      if (resolved) pendingSeatRef.current = null;
      return;
    }
    if (prev >= 0 && mySeatIdx < 0 && !leavingRef.current) {
      // Seat disappeared without our own action → removed by host.
      stopPublishing();
      flashNotice('You were removed from the seat by the host');
    }
  }, [mySeatIdx, stopPublishing, flashNotice]);

  /* ── kicked-from-room detection ── */

  useEffect(() => {
    if (leavingRef.current || pendingSeatRef.current !== null) return;
    const present = audience.some((m) => m.userId === myUid);
    if (present) {
      hadAudienceRef.current = true;
      return;
    }
    if (hadAudienceRef.current && mySeatIdx < 0) {
      hadAudienceRef.current = false;
      flashNotice('You were removed from the room');
      void leave();
    }
  }, [audience, mySeatIdx, myUid, leave, flashNotice]);

  /* ── gift feed → fly animation (recipient seat target) ── */

  useEffect(() => {
    const sinceTs = Date.now();
    const seen = new Set<string>();
    const unsub = subscribeGiftFeed(roomId, sinceTs, (key, val) => {
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 1000) seen.clear();
      const entry = parseFeedEntry(key, val);
      if (!entry) return;
      const idx = seatsRef.current.findIndex((s) => s?.userId === entry.toUid);
      let target: { x: number; y: number } | null = null;
      const el = idx >= 0 ? seatElRefs.current[idx] : null;
      if (el) {
        const rect = el.getBoundingClientRect();
        target = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      flyRef.current?.playFly({
        fromName: entry.fromName,
        fromAvatar: entry.fromAvatar,
        toUid: entry.toUid,
        toName: entry.toName,
        toAvatar: entry.toAvatar,
        giftId: entry.giftId,
        emoji: entry.emoji,
        coins: entry.coins,
        target,
      });
    });
    return unsub;
  }, [roomId]);

  /* ── Media Session (background audio controls) ── */

  useEffect(() => {
    if (!joined) return undefined;
    setMediaSessionHandlers(
      { title: info.name || `Room ${roomId}`, artist: info.topic || 'Vee voice room' },
      {
        onPause: () => setMicMuted(true),
        onResume: () => setMicMuted(false),
        onHangUp: () => {
          void leave();
        },
        onToggleMute: () => toggleMic(),
      },
    );
    return () => {
      clearMediaSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, info.name, info.topic, roomId]);

  /* ── actions ── */

  const joinSeat = useCallback(
    async (idx: number): Promise<void> => {
      if (mySeatIdxRef.current === idx) return;
      const target = seatsRef.current[idx];
      if (target && target.userId !== myUid) {
        flashNotice('That seat was just taken');
        return;
      }
      if (lockedSeatsRef.current.has(idx)) {
        flashNotice('That seat is locked');
        return;
      }
      const seatData: RoomSeat = {
        userId: myUid,
        userName: myName,
        initials: myInitials,
        color: myColor,
        ...(myPhoto ? { photoURL: myPhoto } : {}),
        // Preserve current mute state when moving between seats; start muted
        // only on first join from the audience.
        muted: mySeatIdxRef.current >= 0 ? muted : true,
        role: myRole,
      };
      // RACE FIX (mirrors native): await the takeSeat transaction BEFORE
      // vacating the old seat — losing the race must not leave the user
      // seatless with publishing out of sync.
      pendingSeatRef.current = idx;
      let won = false;
      try {
        won = (await takeSeat(roomId, idx, seatData)).success;
      } catch {
        won = false;
      }
      if (!won) {
        pendingSeatRef.current = null;
        flashNotice('That seat was just taken');
        return;
      }
      const prevIdx = mySeatIdxRef.current;
      if (prevIdx >= 0 && prevIdx !== idx) {
        removeSeat(roomId, prevIdx).catch(() => {
          // non-critical
        });
      } else if (prevIdx < 0) {
        startPublishing();
      }
      // pendingSeatRef is cleared by the seats effect once mySeatIdx === idx.
    },
    [roomId, myUid, myName, myInitials, myColor, myPhoto, myRole, muted, startPublishing, flashNotice],
  );

  const leaveMySeat = useCallback((): void => {
    const idx = mySeatIdxRef.current;
    if (idx < 0) return;
    pendingSeatRef.current = 'gone';
    stopPublishing();
    setSheetFor(null);
    leaveSeat(roomId, idx, myUid, audienceMemberForMe()).catch(() => {
      pendingSeatRef.current = null;
    });
  }, [roomId, myUid, audienceMemberForMe, stopPublishing]);

  const toggleMic = useCallback((): void => {
    // Must be in a seat to toggle the mic.
    if (mySeatIdxRef.current < 0) {
      flashNotice('Take a seat to speak');
      return;
    }
    if (!isPublishing) {
      // Voice engine still initialising — start publishing; mic starts
      // muted and the user taps again to unmute (mirrors native).
      startPublishing();
      return;
    }
    const newMuted = !muted;
    engineToggleMic();
    // Persist mute state so other clients see the mic indicator change.
    const idx = mySeatIdxRef.current;
    if (idx >= 0) {
      setSeatMute(roomId, idx, newMuted).catch(() => {
        // non-critical
      });
    }
  }, [isPublishing, muted, engineToggleMic, startPublishing, roomId, flashNotice]);

  const handleSeatPress = useCallback(
    (idx: number): void => {
      const seat = seatsRef.current[idx];
      if (seat && seat.userId === myUid) {
        setSheetFor(idx); // own seat → leave-seat sheet
        return;
      }
      if (!seat) {
        if (lockedSeatsRef.current.has(idx)) {
          if (isOwnerOrAdmin) {
            setSheetFor(idx); // host can unlock
            return;
          }
          if (window.confirm('This seat is locked. Request it from the host?')) {
            void sendSeatRequest(roomId, {
              userId: myUid,
              userName: myName,
              initials: myInitials,
              color: myColor,
              seatIdx: idx,
              ts: Date.now(),
              hostId: info.ownerId || myUid,
            })
              .then(() => flashNotice('Seat request sent to the host'))
              .catch(() => flashNotice('Could not send the seat request'));
          }
          return;
        }
        void joinSeat(idx);
        return;
      }
      // Occupied by someone else.
      if (isOwnerOrAdmin) {
        setSheetFor(idx); // host moderation sheet
        return;
      }
      flashNotice(`${seat.userName} is on this seat`);
    },
    [myUid, isOwnerOrAdmin, roomId, myName, myInitials, myColor, info.ownerId, joinSeat, flashNotice],
  );

  /** Host: toggle mute for a seated member. */
  const muteToggleMember = useCallback(
    (memberUid: string): void => {
      const idx = seatsRef.current.findIndex((s) => s?.userId === memberUid);
      if (idx < 0) return;
      const seat = seatsRef.current[idx];
      if (!seat) return;
      const newMuted = !seat.muted;
      // Host-side mute = unsubscribe from their audio locally; the seat
      // `muted` write is what mutes the target's mic on their own client.
      if (newMuted) {
        muteRemoteUser(memberUid);
      } else {
        playUserStream(memberUid);
      }
      setSeatMute(roomId, idx, newMuted).catch(() => {
        // non-critical
      });
    },
    [roomId, muteRemoteUser, playUserStream],
  );

  /** Host: remove a member from their seat (they return to the audience). */
  const kickFromSeat = useCallback(
    (idx: number): void => {
      const seat = seatsRef.current[idx];
      if (!seat) return;
      if (seat.userId === myUid) {
        leaveMySeat();
        return;
      }
      stopUserStream(seat.userId);
      setSheetFor(null);
      leaveSeat(roomId, idx, seat.userId, {
        userId: seat.userId,
        userName: seat.userName,
        initials: seat.initials,
        color: seat.color,
        ...(seat.photoURL ? { photoURL: seat.photoURL } : {}),
      }).catch(() => {
        // non-critical
      });
    },
    [roomId, myUid, leaveMySeat, stopUserStream],
  );

  const toggleLockSeat = useCallback(
    (idx: number): void => {
      const locked = lockedSeatsRef.current.has(idx);
      setSheetFor(null);
      if (locked) {
        unlockSeat(roomId, idx).catch(() => flashNotice('Could not unlock the seat'));
      } else {
        lockSeat(roomId, idx).catch(() => flashNotice('Could not lock the seat'));
      }
    },
    [roomId, flashNotice],
  );

  /* ── render ── */

  const listenerCount = seats.filter(Boolean).length + audience.length;
  const sheetSeat = sheetFor !== null ? seats[sheetFor] : null;

  return (
    <div className="page">
      <div className="room-wrap">
        <header className="room-header">
          <h1 className="room-title">🎙 {info.name}</h1>
          {info.topic ? <p className="room-topic">{info.topic}</p> : null}
          <div className="room-meta">
            <span>👥 {listenerCount} listening</span>
            {isOwnerOrAdmin ? <span>· you are {myRole}</span> : null}
          </div>
        </header>

        {connection === 'connecting' ? (
          <div className="conn-banner conn-connecting" role="status">
            Connecting to voice…
          </div>
        ) : null}
        {connection === 'reconnecting' ? (
          <div className="conn-banner conn-reconnecting" role="status">
            Reconnecting to voice…
          </div>
        ) : null}
        {connection === 'failed' || error ? (
          <div className="conn-banner conn-failed" role="alert">
            <span>{error ?? 'Voice connection failed'}</span>
            <button type="button" className="btn btn-ghost" onClick={retryConnection}>
              Retry
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="room-notice" role="status">
            {notice}
          </div>
        ) : null}

        <div className="seat-grid">
          {seats.map((seat, idx) => (
            <SeatCard
              key={idx}
              seat={seat}
              idx={idx}
              locked={lockedSeats.has(idx)}
              speaking={
                seat ? speakingUsers[seat.userId] === true || (seat.userId === myUid && localSpeaking) : false
              }
              isMe={seat?.userId === myUid}
              onPress={handleSeatPress}
              buttonRef={(el) => {
                seatElRefs.current[idx] = el;
              }}
            />
          ))}
        </div>

        <div className="audience-card">
          <h3>Audience · {audience.length}</h3>
          {audience.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              No listeners yet.
            </p>
          ) : (
            <div className="audience-list">
              {audience.slice(0, 30).map((m) => (
                <span className="audience-chip" key={m.userId}>
                  <span
                    className="audience-avatar"
                    style={{ backgroundColor: hashAvatarColor(m.userName) }}
                  >
                    {m.photoURL ? <img src={m.photoURL} alt={m.userName} /> : initialsOf(m.userName)}
                  </span>
                  <span>{m.userName}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="controls-bar">
          <button
            type="button"
            className={`ctrl-btn ${mySeatIdx < 0 ? '' : muted ? 'mic-muted' : 'mic-live'}`}
            onClick={toggleMic}
            disabled={mySeatIdx < 0}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            title={mySeatIdx < 0 ? 'Take a seat to speak' : muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇' : '🎙'}
          </button>
          <button
            type="button"
            className="ctrl-btn leave"
            onClick={() => {
              void leave();
            }}
            aria-label="Leave room"
            title="Leave room"
          >
            ✕
          </button>
        </div>

        {sheetFor !== null ? (
          <div className="sheet-overlay" onClick={() => setSheetFor(null)} role="dialog" aria-modal="true">
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              {sheetSeat && sheetSeat.userId === myUid ? (
                <>
                  <h3>Your seat</h3>
                  <button type="button" className="btn btn-danger" onClick={leaveMySeat}>
                    Leave seat
                  </button>
                </>
              ) : sheetSeat ? (
                <>
                  <h3>{sheetSeat.userName}</h3>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      muteToggleMember(sheetSeat.userId);
                      setSheetFor(null);
                    }}
                  >
                    {sheetSeat.muted ? '🔊 Unmute' : '🔇 Mute'}
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => kickFromSeat(sheetFor)}>
                    Remove from seat
                  </button>
                </>
              ) : (
                <>
                  <h3>Seat {sheetFor + 1}</h3>
                  <button type="button" className="btn btn-ghost" onClick={() => toggleLockSeat(sheetFor)}>
                    {lockedSeats.has(sheetFor) ? '🔓 Unlock seat' : '🔒 Lock seat'}
                  </button>
                </>
              )}
              <button type="button" className="btn sheet-close" onClick={() => setSheetFor(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <GiftReceiveBanners roomId={roomId} />
      <GiftFlyAnimation ref={flyRef} />
    </div>
  );
}

/* ═══════════════════════════════════════════
   Gate: auth + block check + room info
═══════════════════════════════════════════ */

function RoomGate({ roomId }: { roomId: string }): React.JSX.Element {
  const { user, loading } = useAuth();
  const [info, setInfo] = useState<RoomInfoShape | null>(null);
  const [infoReady, setInfoReady] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const unsub = subscribeRoomInfo(roomId, (next) => {
      setInfo(next);
      setInfoReady(true);
    });
    return unsub;
  }, [roomId]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    isBlockedFromRoom(roomId, user.uid)
      .then((b) => {
        if (!cancelled) setBlocked(b);
      })
      .catch(() => {
        // non-critical — fail open
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, user]);

  if (loading || !infoReady) {
    return (
      <div className="page">
        <p className="muted">Loading room…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <div className="card">
          <h2>Sign in required</h2>
          <p className="muted">Sign in to join this voice room.</p>
          <Link className="btn btn-primary" to="/">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="page room-blocked">
        <div className="card">
          <h2>🚫 You are blocked from this room</h2>
          <p className="muted">The host has blocked you from joining this room.</p>
          <Link className="btn btn-ghost" to="/">
            ← Back home
          </Link>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="page">
        <div className="card">
          <h2>Room not found</h2>
          <p className="muted">This room does not exist or has been removed.</p>
          <Link className="btn btn-ghost" to="/">
            ← Back home
          </Link>
        </div>
      </div>
    );
  }

  if (!info.active) {
    return (
      <div className="page">
        <div className="card">
          <h2>Room closed</h2>
          <p className="muted">This room has been closed by the host.</p>
          <Link className="btn btn-ghost" to="/">
            ← Back home
          </Link>
        </div>
      </div>
    );
  }

  return <RoomLive roomId={roomId} info={info} user={user} />;
}

export default function RoomPage(): React.JSX.Element {
  const { roomId } = useParams<{ roomId: string }>();
  if (!roomId) {
    return (
      <div className="page">
        <div className="card">
          <p className="muted">Missing room id.</p>
          <Link className="btn btn-ghost" to="/">
            ← Back home
          </Link>
        </div>
      </div>
    );
  }
  return <RoomGate roomId={roomId} />;
}
