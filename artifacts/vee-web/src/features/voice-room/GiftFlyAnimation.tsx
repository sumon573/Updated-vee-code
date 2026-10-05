/**
 * GiftFlyAnimation.tsx — web port of the native gift showpiece.
 *
 * Two pieces, both driven by the Web Animations API (transforms + opacity
 * only, 60fps) instead of react-native's Animated API:
 *
 *  1) <GiftFlyAnimation ref> — the sender-side showpiece. A large gift emoji
 *     flies from the bottom-center of the screen on an arc up to the
 *     recipient's seat, followed by a banner (sender → gift → recipient +
 *     diamonds). Events queue internally and play ONE at a time.
 *     Triggered via ref.playFly(...). The seat target comes from `target`
 *     (viewport coords); when null/unknown the gift lands at a graceful
 *     top-center point.
 *
 *  2) <GiftReceiveBanners roomId> — subscribes to rooms/{roomId}/giftFeed and
 *     sweeps a combo-counting banner across the top of the screen for every
 *     gift any member sends. Combo window: 3s (same as native).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { subscribeGiftFeed } from './roomService';
import { hashAvatarColor, initialsOf } from './types';

/* ═══════════════════════════════════════════
   Shared types + avatar helper
═══════════════════════════════════════════ */

export interface GiftFlyEvent {
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
}

export interface GiftFlyHandle {
  playFly: (e: Omit<GiftFlyEvent, 'key'>) => void;
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
  const dimension = `${size}px`;
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt={name}
        width={size}
        height={size}
        style={{
          width: dimension,
          height: dimension,
          borderRadius: '50%',
          backgroundColor: '#1f2430',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: dimension,
        height: dimension,
        borderRadius: '50%',
        backgroundColor: hashAvatarColor(name || '?'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: size * 0.44,
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

/* ═══════════════════════════════════════════
   1) SENDER-SIDE fly animation (ref-driven)
═══════════════════════════════════════════ */

const FLY_MS = 1300; // emoji flight duration
const TOTAL_MS = 2600; // whole showpiece (fly + overlapping banner) per event

function GiftFlyPlayer({
  event,
  onDone,
}: {
  event: GiftFlyEvent;
  onDone: () => void;
}): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null); // arc translation
  const emojiRef = useRef<HTMLDivElement>(null); // scale / rotate / opacity
  const bannerRef = useRef<HTMLDivElement>(null); // follow-up banner

  useEffect(() => {
    const track = trackRef.current;
    const emoji = emojiRef.current;
    const banner = bannerRef.current;
    if (!track || !emoji || !banner) {
      onDone();
      return undefined;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const startX = W / 2;
    const startY = H - 170;
    const end = event.target ?? { x: W / 2, y: 110 }; // graceful top-center fallback
    const dx = end.x - startX;
    const dy = end.y - startY;
    const animations: Array<Animation> = [];

    // Arc flight: intermediate keyframe overshoots upward so the path arcs.
    animations.push(
      track.animate(
        [
          { transform: 'translate(0px, 0px)', offset: 0 },
          {
            transform: `translate(${(dx * 0.55).toFixed(1)}px, ${(dy * 1.22).toFixed(1)}px)`,
            offset: 0.55,
          },
          { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`, offset: 1 },
        ],
        { duration: FLY_MS, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'forwards' },
      ),
    );
    // Scale pop at launch + rotate across the flight.
    animations.push(
      emoji.animate(
        [
          { transform: 'scale(0.3) rotate(-18deg)', offset: 0 },
          { transform: 'scale(1.3) rotate(0deg)', offset: 0.17 },
          { transform: 'scale(1) rotate(12deg)', offset: 0.4 },
          { transform: 'scale(1) rotate(26deg)', offset: 1 },
        ],
        { duration: FLY_MS, easing: 'ease-out', fill: 'forwards' },
      ),
    );
    // Shrink + fade as it lands on the seat.
    animations.push(
      emoji.animate(
        [
          { opacity: 1, offset: 0 },
          { opacity: 1, offset: (FLY_MS - 220) / FLY_MS },
          { opacity: 0, offset: 1 },
        ],
        { duration: FLY_MS, easing: 'linear', fill: 'forwards' },
      ),
    );
    animations.push(
      emoji.animate(
        [
          { scale: '1', offset: 0 },
          { scale: '1', offset: (FLY_MS - 220) / FLY_MS },
          { scale: '0.35', offset: 1 },
        ],
        { duration: FLY_MS, easing: 'ease-in', fill: 'forwards' },
      ),
    );
    // Follow-up banner overlaps the flight: in at 650ms, out after a hold.
    const inStart = 650 / TOTAL_MS;
    const inEnd = (650 + 260) / TOTAL_MS;
    const outStart = (650 + 260 + 1150) / TOTAL_MS;
    animations.push(
      banner.animate(
        [
          { opacity: 0, transform: 'translateY(26px)', offset: 0 },
          { opacity: 0, transform: 'translateY(26px)', offset: inStart },
          { opacity: 1, transform: 'translateY(0px)', offset: inEnd },
          { opacity: 1, transform: 'translateY(0px)', offset: outStart },
          { opacity: 0, transform: 'translateY(-18px)', offset: 1 },
        ],
        { duration: TOTAL_MS, easing: 'ease-out', fill: 'forwards' },
      ),
    );

    const timer = window.setTimeout(onDone, TOTAL_MS);
    return () => {
      window.clearTimeout(timer);
      animations.forEach((a) => {
        try {
          a.cancel();
        } catch {
          // non-critical
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.key]);

  const startX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
  const startY = typeof window !== 'undefined' ? window.innerHeight - 170 : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 50,
      }}
      aria-hidden
    >
      {/* flying gift emoji */}
      <div
        ref={trackRef}
        style={{ position: 'absolute', left: startX - 40, top: startY - 40 }}
      >
        <div ref={emojiRef} style={{ fontSize: 80, lineHeight: 1 }}>
          {event.emoji}
        </div>
      </div>
      {/* follow-up banner: sender → gift → recipient */}
      <div
        ref={bannerRef}
        style={{
          position: 'absolute',
          top: 96,
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: 0,
        }}
      >
        <div style={styles.banner}>
          <GiftAvatar photoURL={event.fromAvatar} name={event.fromName} size={30} />
          <span style={styles.bannerName}>{event.fromName}</span>
          <span style={styles.bannerArrow}>→</span>
          <span style={{ fontSize: 30 }}>{event.emoji}</span>
          <span style={styles.bannerArrow}>→</span>
          <GiftAvatar photoURL={event.toAvatar} name={event.toName} size={30} />
          <span style={styles.bannerName}>@{event.toName}</span>
          <span style={styles.bannerCoins}>💎{event.coins}</span>
        </div>
      </div>
    </div>
  );
}

export const GiftFlyAnimation = forwardRef<GiftFlyHandle>(function GiftFlyAnimation(
  _props: Record<string, never>,
  fwdRef: React.ForwardedRef<GiftFlyHandle>,
): React.JSX.Element | null {
  const queueRef = useRef<GiftFlyEvent[]>([]);
  const idleRef = useRef(true);
  const [current, setCurrent] = useState<GiftFlyEvent | null>(null);

  // Shifts are done OUTSIDE setState updaters (StrictMode-safe — an updater
  // may run twice, which would otherwise drop queued events).
  const playNext = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    idleRef.current = next === null;
    setCurrent(next);
  }, []);

  useImperativeHandle(
    fwdRef,
    () => ({
      playFly: (e: Omit<GiftFlyEvent, 'key'>) => {
        queueRef.current.push({
          ...e,
          key: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        });
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

export interface ReceiveEntry {
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
}

const COMBO_WINDOW_MS = 3000;
const SHOW_MS = 2500;
const MAX_QUEUED = 3;

const comboOf = (e: ReceiveEntry): string => `${e.fromUid}|${e.toUid}|${e.giftId}`;

/** Defensive parse — malformed entries (missing emoji/toName) return null and are skipped. */
export function parseFeedEntry(key: string, val: unknown): ReceiveEntry | null {
  if (!val || typeof val !== 'object') return null;
  const v = val as Record<string, unknown>;
  const emoji = typeof v.emoji === 'string' && v.emoji ? v.emoji : null;
  const toName = typeof v.toName === 'string' && v.toName ? v.toName : null;
  if (!emoji || !toName) return null;
  const str = (x: unknown): string => (typeof x === 'string' ? x : '');
  return {
    key,
    fromUid: str(v.senderUid ?? v.fromUid),
    fromName: str(v.senderName ?? v.fromName),
    fromAvatar: typeof v.senderAvatar === 'string' ? v.senderAvatar : undefined,
    toUid: str(v.toUid),
    toName,
    toAvatar: typeof v.toAvatar === 'string' ? v.toAvatar : undefined,
    giftId: str(v.giftId),
    emoji,
    coins: typeof v.coins === 'number' ? v.coins : 0,
    count: 1,
  };
}

function ReceiveBannerCard({
  entry,
  dismissSignal,
  onDismissed,
}: {
  entry: ReceiveEntry;
  dismissSignal: number;
  onDismissed: () => void;
}): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null);
  const sparkleRef = useRef<HTMLSpanElement>(null);
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;

  // Sweep in + sparkle bounce on the gift emoji (runs once per entry key).
  useEffect(() => {
    const card = cardRef.current;
    const sparkle = sparkleRef.current;
    const animations: Array<Animation> = [];
    if (card) {
      animations.push(
        card.animate(
          [
            { opacity: 0, transform: 'translateY(-90px)' },
            { opacity: 1, transform: 'translateY(0px)' },
          ],
          {
            duration: 360,
            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            fill: 'forwards',
          },
        ),
      );
    }
    if (sparkle) {
      animations.push(
        sparkle.animate(
          [{ transform: 'scale(0.5)' }, { transform: 'scale(1.45)' }, { transform: 'scale(1)' }],
          { duration: 600, easing: 'ease-out' },
        ),
      );
    }
    return () => {
      animations.forEach((a) => {
        try {
          a.cancel();
        } catch {
          // non-critical
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.key]);

  // Combo bump: bounce the emoji again when ×N grows (no remount).
  const prevCount = useRef(entry.count);
  useEffect(() => {
    if (entry.count === prevCount.current) return;
    prevCount.current = entry.count;
    const sparkle = sparkleRef.current;
    if (!sparkle) return;
    const anim = sparkle.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'ease-out' },
    );
    return () => {
      try {
        anim.cancel();
      } catch {
        // non-critical
      }
    };
  }, [entry.count]);

  // Slide-up fade-out when the container raises the dismiss signal.
  useEffect(() => {
    if (dismissSignal === 0) return;
    const card = cardRef.current;
    if (!card) {
      onDismissedRef.current();
      return undefined;
    }
    const anim = card.animate(
      [
        { opacity: 1, transform: 'translateY(0px)' },
        { opacity: 0, transform: 'translateY(-70px)' },
      ],
      { duration: 300, easing: 'ease-in', fill: 'forwards' },
    );
    const handleFinish = (): void => {
      onDismissedRef.current();
    };
    anim.addEventListener('finish', handleFinish);
    return () => {
      anim.removeEventListener('finish', handleFinish);
      try {
        anim.cancel();
      } catch {
        // non-critical
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissSignal]);

  return (
    <div
      ref={cardRef}
      style={{
        position: 'fixed',
        top: 84,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        pointerEvents: 'none',
        opacity: 0,
      }}
      aria-live="polite"
    >
      <div style={styles.recvBanner}>
        <GiftAvatar photoURL={entry.fromAvatar} name={entry.fromName} size={34} />
        <span style={styles.recvName}>{entry.fromName}</span>
        <span style={styles.recvSent}>sent a gift</span>
        <span ref={sparkleRef} style={{ fontSize: 40, lineHeight: 1, display: 'inline-block' }}>
          {entry.emoji}
        </span>
        <span style={{ fontSize: 16 }}>✨</span>
        <span style={styles.bannerArrow}>→</span>
        <GiftAvatar photoURL={entry.toAvatar} name={entry.toName} size={34} />
        <span style={styles.recvName}>@{entry.toName}</span>
        <span style={styles.combo}>×{entry.count}</span>
        <span style={styles.bannerCoins}>💎{entry.coins}</span>
      </div>
    </div>
  );
}

export function GiftReceiveBanners({ roomId }: { roomId: string }): React.JSX.Element | null {
  const [current, setCurrent] = useState<ReceiveEntry | null>(null);
  const [dismissSignal, setDismissSignal] = useState(0);

  const queueRef = useRef<ReceiveEntry[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const currentRef = useRef<ReceiveEntry | null>(null);
  const lastRef = useRef<{ comboKey: string; count: number; at: number } | null>(null);
  const dismissTimerRef = useRef<number | null>(null);

  const restartDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => setDismissSignal((s) => s + 1), SHOW_MS);
  }, []);

  const showEntry = useCallback(
    (entry: ReceiveEntry) => {
      currentRef.current = entry;
      lastRef.current = { comboKey: comboOf(entry), count: entry.count, at: Date.now() };
      setCurrent({ ...entry });
      restartDismissTimer();
    },
    [restartDismissTimer],
  );

  const advance = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    if (next) {
      showEntry(next);
    } else {
      currentRef.current = null;
      setCurrent(null);
    }
  }, [showEntry]);

  const bumpCombo = useCallback(
    (entry: ReceiveEntry) => {
      // Merge into the live banner: increment ×N and restart the dismiss timer.
      const live = currentRef.current ?? { ...entry, count: lastRef.current?.count ?? 0 };
      const updated: ReceiveEntry = { ...live, count: live.count + 1 };
      currentRef.current = updated;
      lastRef.current = { comboKey: comboOf(updated), count: updated.count, at: Date.now() };
      setCurrent({ ...updated });
      restartDismissTimer();
    },
    [restartDismissTimer],
  );

  const handleIncoming = useCallback(
    (entry: ReceiveEntry) => {
      const ck = comboOf(entry);
      const now = Date.now();
      const live = currentRef.current;
      if (live && comboOf(live) === ck) {
        bumpCombo(entry);
        return;
      }
      const last = lastRef.current;
      if (!live && last && last.comboKey === ck && now - last.at < COMBO_WINDOW_MS) {
        // Combo against the just-dismissed banner: re-show with incremented count.
        showEntry({ ...entry, count: last.count + 1 });
        return;
      }
      if (live) {
        if (queueRef.current.length >= MAX_QUEUED) queueRef.current.shift(); // drop oldest
        queueRef.current.push(entry);
      } else {
        showEntry(entry);
      }
    },
    [bumpCombo, showEntry],
  );

  const handleIncomingRef = useRef(handleIncoming);
  handleIncomingRef.current = handleIncoming;

  useEffect(() => {
    if (!roomId) return undefined;
    // Fresh room → reset all banner state (no cross-room bleed).
    queueRef.current = [];
    seenRef.current.clear();
    currentRef.current = null;
    lastRef.current = null;
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    setDismissSignal(0);
    setCurrent(null);
    const sinceTs = Date.now();
    const unsub = subscribeGiftFeed(roomId, sinceTs, (key, val) => {
      try {
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);
        if (seenRef.current.size > 1000) seenRef.current.clear(); // bound memory
        const entry = parseFeedEntry(key, val);
        if (!entry) return; // malformed → skip silently
        handleIncomingRef.current(entry);
      } catch {
        // never let a feed entry crash the room
      }
    });
    return () => {
      unsub();
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    };
  }, [roomId]);

  const handleDismissed = useCallback(() => {
    advance();
  }, [advance]);

  if (!current) return null;
  return (
    <ReceiveBannerCard
      key={current.key}
      entry={current}
      dismissSignal={dismissSignal}
      onDismissed={handleDismissed}
    />
  );
}

/* ═══════════════════════════════════════════
   Styles
═══════════════════════════════════════════ */

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(12,14,20,0.92)',
    borderRadius: 999,
    padding: '8px 12px',
    border: '1px solid rgba(255,215,0,0.45)',
    maxWidth: 'calc(100vw - 48px)',
    whiteSpace: 'nowrap',
  },
  bannerName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 800,
    margin: '0 6px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 90,
  },
  bannerArrow: { color: '#ffd700', fontSize: 16, fontWeight: 800, margin: '0 4px' },
  bannerCoins: { color: '#ffd700', fontSize: 13, fontWeight: 800, marginLeft: 6 },
  recvBanner: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(12,14,20,0.94)',
    borderRadius: 18,
    padding: '8px 12px',
    border: '1px solid rgba(255,215,0,0.55)',
    boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
    maxWidth: 'calc(100vw - 40px)',
    whiteSpace: 'nowrap',
  },
  recvName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 800,
    margin: '0 6px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 80,
  },
  recvSent: { color: '#9aa3b2', fontSize: 12, fontWeight: 600, marginRight: 6 },
  combo: { color: '#ffd700', fontSize: 15, fontWeight: 900, marginLeft: 6 },
};
