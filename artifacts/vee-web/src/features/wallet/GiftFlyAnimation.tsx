/**
 * GiftFlyAnimation (web port of the native `GiftFlyAnimation.tsx`).
 *
 * Two pieces, driven by CSS keyframes (transforms + opacity only, 60fps):
 *
 *  1) <GiftFlyAnimation ref> — SENDER side. A large gift emoji flies from the
 *     bottom-center of the screen on an arc up to the recipient's seat,
 *     followed by a banner (sender → gift → recipient + diamonds).
 *     Events queue internally and play ONE at a time. Triggered via
 *     ref.playFly(...). The seat target comes from `target` (screen coords);
 *     when null/unknown the gift lands at a graceful top-center point.
 *     Shows the recipient's avatar and name — like the native app.
 *
 *  2) <GiftReceiveBanners roomId> — RECEIVER side. Subscribes to
 *     rooms/{roomId}/giftFeed and sweeps a combo-counting banner across the
 *     top of the screen for every gift any member sends.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { limitToLast, onChildAdded, query, ref } from 'firebase/database';
import { rtdb } from '../../lib/firebase';

/* ═══════════════════════════════════════════
   Shared types + avatar helper
═══════════════════════════════════════════ */

export type GiftFlyEvent = {
  key: string;
  fromName: string;
  fromAvatar?: string;
  toUid: string;
  toName: string;
  toAvatar?: string;
  giftId: string;
  emoji: string;
  coins: number;
  target?: { x: number; y: number } | null;
};

export type GiftFlyHandle = {
  playFly: (e: Omit<GiftFlyEvent, 'key'>) => void;
};

/** Deterministic pastel-ish color from a name (avatar fallback). */
function hashColor(name: string): string {
  let h = 0;
  const s = name || '?';
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}, 62%, 44%)`;
}

/**
 * Small round avatar: photo when available, otherwise a colored
 * initial-letter circle. Never crashes on missing/empty values.
 */
export function GiftAvatar({
  photoURL,
  name,
  size,
}: {
  photoURL?: string | null;
  name: string;
  size: number;
}): React.JSX.Element {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#1f2430' }}
      />
    );
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: hashColor(name || '?'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: size * 0.44,
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

/* ═══════════════════════════════════════════
   1) SENDER-SIDE fly animation (ref-driven)
═══════════════════════════════════════════ */

const FLY_MS = 1300; // emoji flight duration
const TOTAL_MS = 2600; // whole showpiece (fly + overlapping banner) per event

function GiftFlyPlayer({ event, onDone }: { event: GiftFlyEvent; onDone: () => void }): React.JSX.Element {
  const W = typeof window !== 'undefined' ? window.innerWidth : 480;
  const H = typeof window !== 'undefined' ? window.innerHeight : 800;
  const start = { x: W / 2, y: H - 170 };
  const end = event.target ?? { x: W / 2, y: 110 }; // graceful top-center fallback
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  useEffect(() => {
    const timer = setTimeout(onDone, TOTAL_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="gift-fly-layer">
      {/* flying gift emoji */}
      <div
        className="gift-fly-emoji"
        style={
          {
            left: start.x - 40,
            top: start.y - 40,
            '--dx': `${dx}px`,
            '--dy': `${dy}px`,
            animationDuration: `${FLY_MS}ms`,
          } as React.CSSProperties
        }
      >
        {event.emoji}
      </div>
      {/* follow-up banner: sender → gift → recipient */}
      <div className="gift-fly-banner">
        <div className="gift-banner">
          <GiftAvatar photoURL={event.fromAvatar} name={event.fromName} size={30} />
          <span className="gift-banner-name">{event.fromName}</span>
          <span className="gift-banner-arrow">→</span>
          <span className="gift-banner-emoji">{event.emoji}</span>
          <span className="gift-banner-arrow">→</span>
          <GiftAvatar photoURL={event.toAvatar} name={event.toName} size={30} />
          <span className="gift-banner-name">@{event.toName}</span>
          <span className="gift-banner-coins">💎{event.coins}</span>
        </div>
      </div>
    </div>
  );
}

export const GiftFlyAnimation = forwardRef<GiftFlyHandle>(function GiftFlyAnimation(_, fwdRef) {
  const queueRef = useRef<GiftFlyEvent[]>([]);
  const idleRef = useRef(true);
  const [current, setCurrent] = useState<GiftFlyEvent | null>(null);

  const playNext = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    idleRef.current = next === null;
    setCurrent(next);
  }, []);

  useImperativeHandle(
    fwdRef,
    () => ({
      playFly: (e: Omit<GiftFlyEvent, 'key'>) => {
        queueRef.current.push({ ...e, key: `${Date.now()}_${Math.random().toString(36).slice(2)}` });
        if (idleRef.current) playNext();
      },
    }),
    [playNext],
  );

  const handleDone = useCallback(() => {
    playNext();
  }, [playNext]);

  if (!current) return null;
  return <GiftFlyPlayer key={current.key} event={current} onDone={handleDone} />;
});

/* ═══════════════════════════════════════════
   2) RECEIVER-SIDE banners (Firebase giftFeed)
═══════════════════════════════════════════ */

type ReceiveEntry = {
  key: string;
  fromUid: string;
  fromName: string;
  fromAvatar?: string;
  toUid: string;
  toName: string;
  toAvatar?: string;
  giftId: string;
  emoji: string;
  coins: number;
  count: number;
};

const COMBO_WINDOW_MS = 3000;
const SHOW_MS = 2500;
const MAX_QUEUED = 3;

const comboOf = (e: ReceiveEntry): string => `${e.fromUid}|${e.toUid}|${e.giftId}`;

/** Defensive parse — malformed entries (missing emoji/toName) return null. */
function parseFeedEntry(key: string, val: unknown): ReceiveEntry | null {
  if (!val || typeof val !== 'object') return null;
  const v = val as Record<string, unknown>;
  const emoji = typeof v.emoji === 'string' && v.emoji ? v.emoji : null;
  const toName = typeof v.toName === 'string' && v.toName ? v.toName : null;
  if (!emoji || !toName) return null;
  const str = (x: unknown): string => (typeof x === 'string' ? x : '');
  return {
    key,
    fromUid: str(v.fromUid),
    fromName: str(v.fromName),
    fromAvatar: typeof v.fromAvatar === 'string' ? v.fromAvatar : undefined,
    toUid: str(v.toUid),
    toName,
    toAvatar: typeof v.toAvatar === 'string' ? v.toAvatar : undefined,
    giftId: str(v.giftId),
    emoji,
    coins: typeof v.coins === 'number' ? v.coins : 0,
    count: 1,
  };
}

export function GiftReceiveBanners({ roomId }: { roomId: string }): React.JSX.Element | null {
  const [current, setCurrent] = useState<ReceiveEntry | null>(null);

  const queueRef = useRef<ReceiveEntry[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const currentRef = useRef<ReceiveEntry | null>(null);
  const lastRef = useRef<{ comboKey: string; count: number; at: number } | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedAtRef = useRef(Date.now());

  const restartDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      const next = queueRef.current.shift() ?? null;
      currentRef.current = next;
      setCurrent(next ? { ...next } : null);
      if (next) restartDismissTimer();
    }, SHOW_MS);
  }, []);

  const handleIncoming = useCallback(
    (entry: ReceiveEntry) => {
      const ck = comboOf(entry);
      const now = Date.now();
      const live = currentRef.current;
      if (live && comboOf(live) === ck) {
        // Combo against the live banner: bump ×N.
        const updated = { ...live, count: live.count + 1 };
        currentRef.current = updated;
        lastRef.current = { comboKey: ck, count: updated.count, at: now };
        setCurrent({ ...updated });
        restartDismissTimer();
        return;
      }
      const last = lastRef.current;
      if (!live && last && last.comboKey === ck && now - last.at < COMBO_WINDOW_MS) {
        const updated = { ...entry, count: last.count + 1 };
        currentRef.current = updated;
        lastRef.current = { comboKey: ck, count: updated.count, at: now };
        setCurrent({ ...updated });
        restartDismissTimer();
        return;
      }
      if (live) {
        if (queueRef.current.length >= MAX_QUEUED) queueRef.current.shift();
        queueRef.current.push(entry);
      } else {
        currentRef.current = entry;
        lastRef.current = { comboKey: ck, count: entry.count, at: now };
        setCurrent({ ...entry });
        restartDismissTimer();
      }
    },
    [restartDismissTimer],
  );

  useEffect(() => {
    if (!roomId) return;
    queueRef.current = [];
    seenRef.current.clear();
    currentRef.current = null;
    lastRef.current = null;
    mountedAtRef.current = Date.now();
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    setCurrent(null);

    const q = query(ref(rtdb, `rooms/${roomId}/giftFeed`), limitToLast(30));
    const unsub = onChildAdded(q, (snap) => {
      try {
        const key = snap.key;
        if (!key || seenRef.current.has(key)) return;
        seenRef.current.add(key);
        if (seenRef.current.size > 1000) seenRef.current.clear();
        const entry = parseFeedEntry(key, snap.val());
        if (!entry) return;
        const ts = (snap.val() as Record<string, unknown>)?.ts;
        if (typeof ts === 'number' && ts < mountedAtRef.current) return; // stale replay
        handleIncoming(entry);
      } catch {
        /* never let a feed entry crash the room */
      }
    });
    return () => {
      unsub();
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [roomId, handleIncoming]);

  if (!current) return null;
  return (
    <div className="gift-recv-layer">
      <div className="gift-recv-banner" key={current.key}>
        <GiftAvatar photoURL={current.fromAvatar} name={current.fromName} size={34} />
        <span className="gift-recv-name">{current.fromName}</span>
        <span className="gift-recv-sent">sent a gift</span>
        <span className="gift-recv-emoji" key={`e-${current.count}`}>
          {current.emoji}
        </span>
        <span className="gift-banner-arrow">→</span>
        <GiftAvatar photoURL={current.toAvatar} name={current.toName} size={34} />
        <span className="gift-recv-name">@{current.toName}</span>
        <span className="gift-combo">×{current.count}</span>
        <span className="gift-banner-coins">💎{current.coins}</span>
      </div>
    </div>
  );
}
