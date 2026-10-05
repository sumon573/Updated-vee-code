/**
 * 1-to-1 voice call page.
 *
 * Route: /call/:roomId where :roomId is the PEER's Firebase uid
 * (`?caller=1` → this side initiates the call; otherwise it waits to answer).
 * The actual WebRTC signaling room is the deterministic
 * `ac_{smallerUid}_{largerUid}` from buildCallRoomId — identical to the
 * native app, so web ↔ native calls work.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, ref } from 'firebase/database';
import { rtdb } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthProvider';
import { WebRTCCallSession } from './webrtcCallSession';
import { cancelCallInvite, sendCallInvite, subscribeIncomingCall } from './callsService';

type Phase =
  | 'loading'
  | 'waiting-invite' // callee: no invite from this peer yet
  | 'incoming' // callee: invite arrived, awaiting accept/decline
  | 'ringing' // caller: invite sent, waiting for answer
  | 'connecting' // session up, media not yet flowing
  | 'connected'
  | 'ended'
  | 'error';

/** Caller gives up after this long with no answer. */
const NO_ANSWER_TIMEOUT_MS = 60_000;

type PeerProfile = { name: string; photoURL?: string };

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function CallPage(): React.JSX.Element {
  const { roomId: peerUidParam } = useParams<{ roomId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const peerUid = peerUidParam ?? '';
  const isCaller = searchParams.get('caller') === '1';

  const [phase, setPhase] = useState<Phase>('loading');
  const [peer, setPeer] = useState<PeerProfile>({ name: 'Unknown' });
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const sessionRef = useRef<WebRTCCallSession | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startedRef = useRef(false);
  /** Set for the callee path: starts the session as answerer on Accept. */
  const acceptStarterRef = useRef<(() => void) | null>(null);
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;

  const endCall = useCallback(
    (nextPhase: Phase = 'ended') => {
      try {
        sessionRef.current?.hangup();
      } catch {
        /* never throw to UI */
      }
      sessionRef.current = null;
      setPhase(nextPhase);
    },
    [],
  );

  // Load the peer's profile for display.
  useEffect(() => {
    if (!peerUid) return;
    let cancelled = false;
    void get(ref(rtdb, `users/${peerUid}`))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const v = snap.val() as { name?: string; photoURL?: string };
        setPeer({
          name: typeof v.name === 'string' && v.name ? v.name : 'Unknown',
          photoURL: typeof v.photoURL === 'string' ? v.photoURL : undefined,
        });
      })
      .catch(() => {
        /* non-critical — "Unknown" fallback stays */
      });
    return () => {
      cancelled = true;
    };
  }, [peerUid]);

  // Main call lifecycle. StrictMode-safe: `startedRef` prevents a second
  // start on the dev double-mount, and cleanup fully tears the session down.
  useEffect(() => {
    if (authLoading || !user || !peerUid || startedRef.current) return;
    startedRef.current = true;

    const myUid = user.uid;
    let cancelled = false;
    let noAnswerTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubInvite: (() => void) | null = null;

    const session = new WebRTCCallSession();
    sessionRef.current = session;

    const attachStream = (stream: MediaStream): void => {
      const el = audioRef.current;
      if (!el) return;
      try {
        el.srcObject = stream;
        void el.play().catch(() => {
          /* autoplay may need a user gesture — the call UI counts as one */
        });
      } catch {
        /* non-critical */
      }
    };

    const startSession = (caller: boolean): void => {
      if (cancelled) return;
      setPhase(caller ? 'ringing' : 'connecting');
      void session
        .startCall({
          myUid,
          remoteUid: peerUid,
          isCaller: caller,
          onRemoteStream: attachStream,
          onConnectionChange: (state) => {
            if (cancelled) return;
            if (state === 'connected') {
              if (noAnswerTimer) clearTimeout(noAnswerTimer);
              setPhase('connected');
            } else if (state === 'remote-ended') {
              endCall('ended');
            }
          },
          onError: (err) => {
            if (cancelled) return;
            setError(err.message);
            setPhase('error');
            if (err.fatal) {
              try {
                session.hangup();
              } catch {
                /* never throw to UI */
              }
              sessionRef.current = null;
            }
          },
        })
        .catch(() => {
          /* session reports failures via onError; never throws */
        });
    };

    if (isCaller) {
      // ── Caller: ring first, then offer ──────────────────────────────
      const callerName = user.displayName ?? user.email ?? 'Vee user';
      const callerPhoto = user.photoURL ?? undefined;
      void sendCallInvite(peerUid, myUid, callerName, callerPhoto)
        .catch(() => {
          /* invite write is best-effort; WebRTC can still rendezvous */
        })
        .finally(() => {
          if (!cancelled) startSession(true);
        });
      noAnswerTimer = setTimeout(() => {
        if (cancelled) return;
        if (phaseRef.current === 'ringing' || phaseRef.current === 'connecting') {
          void cancelCallInvite(peerUid);
          setError('No answer. The other person did not pick up.');
          setPhase('error');
          try {
            session.hangup();
          } catch {
            /* never throw to UI */
          }
          sessionRef.current = null;
        }
      }, NO_ANSWER_TIMEOUT_MS);
    } else {
      // ── Callee: wait for the invite from this peer ──────────────────
      // The session starts only when the user taps Accept (user gesture —
      // also what browsers want for mic/autoplay). Until then we only
      // watch the invite node.
      setPhase('waiting-invite');
      acceptStarterRef.current = () => startSession(false);
      unsubInvite = subscribeIncomingCall(myUid, (next) => {
        if (cancelled) return;
        if (next && next.callerId === peerUid) {
          setPhase('incoming');
        } else if (phaseRef.current === 'incoming' || phaseRef.current === 'waiting-invite') {
          // Invite withdrawn (caller cancelled) before we answered.
          if (phaseRef.current === 'incoming') endCall('ended');
        }
      });
    }

    return () => {
      cancelled = true;
      if (noAnswerTimer) clearTimeout(noAnswerTimer);
      unsubInvite?.();
      try {
        session.hangup();
      } catch {
        /* never throw to UI */
      }
      if (sessionRef.current === session) sessionRef.current = null;
      if (isCaller) void cancelCallInvite(peerUid);
      // Allow a fresh start on remount (StrictMode double-mount in dev).
      acceptStarterRef.current = null;
      startedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, peerUid]);

  const handleAccept = useCallback(() => {
    if (!user) return;
    // Consume the invite (contract: removed on accept), then start the
    // session as callee — it waits for the caller's offer and answers.
    void cancelCallInvite(user.uid).finally(() => {
      const starter = acceptStarterRef.current;
      acceptStarterRef.current = null;
      if (!starter) {
        setError('Call session is gone. Please try again.');
        setPhase('error');
        return;
      }
      starter();
    });
  }, [user]);

  const handleDecline = useCallback(() => {
    if (!user) return;
    // Contract: invite is removed on decline; the caller's no-answer timer
    // will end their side (no cross-client decline signal exists).
    void cancelCallInvite(user.uid).finally(() => {
      endCall('ended');
      setTimeout(() => navigate('/'), 1500);
    });
  }, [user, endCall, navigate]);

  const handleHangup = useCallback(() => {
    if (user && isCaller) void cancelCallInvite(peerUid);
    endCall('ended');
  }, [user, isCaller, peerUid, endCall]);

  const handleToggleMute = useCallback(() => {
    const next = sessionRef.current?.toggleMute() ?? false;
    setMuted(next);
  }, []);

  // Call timer while connected.
  useEffect(() => {
    if (phase !== 'connected') return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  if (!peerUid) {
    return (
      <div className="page">
        <div className="card">
          <p>No one to call — open a call from a user profile or chat.</p>
          <Link className="btn btn-ghost" to="/">← Back home</Link>
        </div>
      </div>
    );
  }

  const statusText: Record<Phase, string> = {
    loading: 'Preparing…',
    'waiting-invite': 'Waiting for the incoming call…',
    incoming: 'Incoming call',
    ringing: 'Ringing…',
    connecting: 'Connecting…',
    connected: formatDuration(elapsed),
    ended: 'Call ended',
    error: 'Call failed',
  };

  return (
    <div className="page call-page">
      <header className="hero">
        <h1>📞 1-to-1 call</h1>
        <p className="muted">{statusText[phase]}</p>
      </header>

      <div className="card call-card">
        {peer.photoURL ? (
          <img className="call-avatar" src={peer.photoURL} alt={peer.name} />
        ) : (
          <div className="call-avatar call-avatar-fallback">
            {(peer.name || '?').trim().charAt(0).toUpperCase()}
          </div>
        )}
        <h2>{peer.name}</h2>
        {(phase === 'connected' || phase === 'connecting' || phase === 'ringing') && (
          <div className="call-controls">
            <button
              type="button"
              className={`btn ${muted ? 'btn-ghost' : 'btn-primary'}`}
              onClick={handleToggleMute}
              disabled={phase !== 'connected'}
            >
              {muted ? '🔇 Unmute' : '🎙 Mute'}
            </button>
            <button type="button" className="btn btn-danger" onClick={handleHangup}>
              📵 Hang up
            </button>
          </div>
        )}
        {phase === 'incoming' && (
          <div className="call-controls">
            <button type="button" className="btn btn-primary" onClick={handleAccept}>
              ✅ Accept
            </button>
            <button type="button" className="btn btn-danger" onClick={handleDecline}>
              ❌ Decline
            </button>
          </div>
        )}
        {phase === 'waiting-invite' && (
          <p className="muted">
            Ask {peer.name} to call you, or{' '}
            <Link to={`/call/${peerUid}?caller=1`}>call them yourself</Link>.
          </p>
        )}
        {phase === 'ended' && (
          <Link className="btn btn-ghost" to="/">
            ← Back home
          </Link>
        )}
        {phase === 'error' && (
          <>
            <p className="error-text">{error ?? 'Something went wrong.'}</p>
            <Link className="btn btn-ghost" to="/">
              ← Back home
            </Link>
          </>
        )}
      </div>

      {/* Remote audio output — hidden element, plays the peer's voice. */}
      <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
    </div>
  );
}
