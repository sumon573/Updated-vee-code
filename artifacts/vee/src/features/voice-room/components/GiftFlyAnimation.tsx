/**
 * GiftFlyAnimation.tsx — Track 3: Bigo/TikTok-style gift showpiece.
 *
 * Two pieces, both driven ONLY by the react-native Animated API
 * (timing/spring/parallel/sequence) with useNativeDriver: true so the
 * whole showpiece stays at 60fps (transforms + opacity only).
 *
 *  1) <GiftFlyAnimation ref> — SENDER side. The sender's own client plays a
 *     large gift emoji flying from the bottom-center of the screen on an
 *     arc up to the recipient's seat, followed by a banner
 *     (sender → gift → recipient + diamonds).
 *     Events queue internally and play ONE at a time. Triggered via
 *     ref.playFly(...). The seat target comes from `target` (screen coords);
 *     when null/unknown the gift lands at a graceful top-center point.
 *
 *  2) <GiftReceiveBanners roomId> — RECEIVER side. Subscribes to
 *     rooms/{roomId}/giftFeed and sweeps a combo-counting banner across the
 *     top of the screen for every gift any member sends.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Animated, Dimensions, Easing, Image, StyleSheet, Text, View,
} from 'react-native';
import { limitToLast, onChildAdded, query, ref } from 'firebase/database';
import { useTranslation } from 'react-i18next';
import { database } from '@/src/config/firebase';

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

/** Gift tier by coin value — drives animation scale (small gift = small
 *  animation, big gift = big dramatic animation). */
export function giftTier(coins: number): 'small' | 'medium' | 'large' {
  if (coins >= 500) return 'large';
  if (coins >= 100) return 'medium';
  return 'small';
}

const TIER_STYLE = {
  small:  { emojiSize: 52, flyMs: 900,  bannerScale: 0.85 },
  medium: { emojiSize: 80, flyMs: 1200, bannerScale: 1 },
  large:  { emojiSize: 112, flyMs: 1600, bannerScale: 1.15 },
} as const;

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
  photoURL, name, size,
}: {
  photoURL?: string | null; name: string; size: number;
}) {
  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#1f2430' }}
      />
    );
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: hashColor(name || '?'),
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: '#fff', fontSize: size * 0.44, fontWeight: '800' }}>{initial}</Text>
    </View>
  );
}

/* ═══════════════════════════════════════════
   1) SENDER-SIDE fly animation (ref-driven)
═══════════════════════════════════════════ */

const FLY_MS_DEFAULT = 1300;   // fallback emoji flight duration
const TOTAL_MS_DEFAULT = 2600; // fallback whole showpiece per event

function GiftFlyPlayer({ event, onDone }: { event: GiftFlyEvent; onDone: () => void }) {
  const { width: W, height: H } = Dimensions.get('window');
  // Tier-based animation: small gifts fly fast & small, large gifts fly
  // slow & big with a grander banner.
  const tier = giftTier(event.coins);
  const tierStyle = TIER_STYLE[tier];
  const FLY_MS = tierStyle.flyMs;
  const TOTAL_MS = tierStyle.flyMs + 1300;
  const start = { x: W / 2, y: H - 170 };
  const end = event.target ?? { x: W / 2, y: 110 }; // graceful top-center fallback
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // One progress value drives the whole flight; intermediate keyframe
  // overshoots upward so the path arcs instead of going straight.
  const p = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.3)).current;
  const emojiOp = useRef(new Animated.Value(1)).current;
  const bannerOp = useRef(new Animated.Value(0)).current;
  const bannerY = useRef(new Animated.Value(26)).current;

  const translateX = p.interpolate({ inputRange: [0, 1], outputRange: [0, dx] });
  const translateY = p.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, dy * 1.22, dy] });
  const rotate = p.interpolate({ inputRange: [0, 1], outputRange: ['-18deg', '26deg'] });

  useEffect(() => {
    const fly = Animated.timing(p, {
      toValue: 1, duration: FLY_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
    });
    const pop = Animated.sequence([ // scale pop at launch
      Animated.timing(scale, { toValue: 1.3, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]);
    const land = Animated.sequence([ // shrink + fade as it lands on the seat
      Animated.delay(FLY_MS - 220),
      Animated.parallel([
        Animated.timing(scale, { toValue: 0.35, duration: 220, useNativeDriver: true }),
        Animated.timing(emojiOp, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]),
    ]);
    const banner = Animated.sequence([ // banner overlaps the flight
      Animated.delay(650),
      Animated.parallel([
        Animated.timing(bannerOp, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.timing(bannerY, { toValue: 0, duration: 320, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
      ]),
      Animated.delay(1150),
      Animated.parallel([
        Animated.timing(bannerOp, { toValue: 0, duration: 320, useNativeDriver: true }),
        Animated.timing(bannerY, { toValue: -18, duration: 320, useNativeDriver: true }),
      ]),
    ]);
    const anim = Animated.parallel([fly, pop, land, banner]);
    anim.start();
    const timer = setTimeout(onDone, TOTAL_MS);
    return () => {
      clearTimeout(timer);
      anim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* flying gift emoji */}
      <Animated.View style={{
        position: 'absolute',
        left: start.x - 40, top: start.y - 40,
        opacity: emojiOp,
        transform: [{ translateX }, { translateY }, { rotate }, { scale }],
      }}>
        <Text style={{ fontSize: tierStyle.emojiSize }}>{event.emoji}</Text>
      </Animated.View>
      {/* follow-up banner: sender → gift → recipient */}
      <Animated.View style={{
        position: 'absolute', top: 96, alignSelf: 'center',
        opacity: bannerOp, transform: [{ translateY: bannerY }],
      }}>
        <View style={[styles.banner, { maxWidth: W - 48 }]}>
          <GiftAvatar photoURL={event.fromAvatar} name={event.fromName} size={30} />
          <Text style={styles.bannerName} numberOfLines={1}>{event.fromName}</Text>
          <Text style={styles.bannerArrow}>→</Text>
          <Text style={{ fontSize: 30 }}>{event.emoji}</Text>
          <Text style={styles.bannerArrow}>→</Text>
          <GiftAvatar photoURL={event.toAvatar} name={event.toName} size={30} />
          <Text style={styles.bannerName} numberOfLines={1}>@{event.toName}</Text>
          <Text style={styles.bannerCoins}>💎{event.coins}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

export const GiftFlyAnimation = forwardRef<GiftFlyHandle, {}>(function GiftFlyAnimation(_props, fwdRef) {
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

  useImperativeHandle(fwdRef, () => ({
    playFly: (e: Omit<GiftFlyEvent, 'key'>) => {
      queueRef.current.push({ ...e, key: `${Date.now()}_${Math.random().toString(36).slice(2)}` });
      if (idleRef.current) playNext();
    },
  }), [playNext]);

  const handleDone = useCallback(() => { playNext(); }, [playNext]);

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50 }]} pointerEvents="none">
      {current ? <GiftFlyPlayer key={current.key} event={current} onDone={handleDone} /> : null}
    </View>
  );
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

const comboOf = (e: ReceiveEntry) => `${e.fromUid}|${e.toUid}|${e.giftId}`;

/** Defensive parse — malformed entries (missing emoji/toName) return null and are skipped. */
function parseFeedEntry(key: string, val: unknown): ReceiveEntry | null {
  if (!val || typeof val !== 'object') return null;
  const v = val as Record<string, unknown>;
  const emoji = typeof v.emoji === 'string' && v.emoji ? v.emoji : null;
  const toName = typeof v.toName === 'string' && v.toName ? v.toName : null;
  if (!emoji || !toName) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
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
  entry, dismissSignal, onDismissed,
}: {
  entry: ReceiveEntry; dismissSignal: number; onDismissed: () => void;
}) {
  const { t } = useTranslation();
  const { width: W } = Dimensions.get('window');
  const y = useRef(new Animated.Value(-90)).current;
  const op = useRef(new Animated.Value(0)).current;
  const sparkle = useRef(new Animated.Value(0.5)).current;

  // Sweep in + sparkle bounce on the gift emoji
  useEffect(() => {
    Animated.parallel([
      Animated.timing(y, { toValue: 0, duration: 360, easing: Easing.out(Easing.back(1.25)), useNativeDriver: true }),
      Animated.timing(op, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.sequence([
        Animated.spring(sparkle, { toValue: 1.45, friction: 4, useNativeDriver: true }),
        Animated.spring(sparkle, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.key]);

  // Combo bump: bounce the emoji again when ×N grows (no remount)
  const prevCount = useRef(entry.count);
  useEffect(() => {
    if (entry.count !== prevCount.current) {
      prevCount.current = entry.count;
      Animated.sequence([
        Animated.spring(sparkle, { toValue: 1.5, friction: 3.5, useNativeDriver: true }),
        Animated.spring(sparkle, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.count]);

  // Slide-up fade-out when the container raises the dismiss signal
  useEffect(() => {
    if (dismissSignal === 0) return;
    const anim = Animated.parallel([
      Animated.timing(y, { toValue: -70, duration: 300, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(op, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => { if (finished) onDismissed(); });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissSignal]);

  return (
    <Animated.View style={{
      position: 'absolute', top: 84, alignSelf: 'center',
      opacity: op, transform: [{ translateY: y }],
    }}>
      <View style={[styles.recvBanner, { maxWidth: W - 40 }]}>
        <GiftAvatar photoURL={entry.fromAvatar} name={entry.fromName} size={34} />
        <Text style={styles.recvName} numberOfLines={1}>{entry.fromName}</Text>
        <Text style={styles.recvSent}>{t('voiceRoom.screen.sentAGift')}</Text>
        <Animated.View style={{ transform: [{ scale: sparkle }] }}>
          <Text style={{ fontSize: 40 }}>{entry.emoji}</Text>
        </Animated.View>
        <Text style={{ fontSize: 16 }}>✨</Text>
        <Text style={styles.bannerArrow}>→</Text>
        <GiftAvatar photoURL={entry.toAvatar} name={entry.toName} size={34} />
        <Text style={styles.recvName} numberOfLines={1}>@{entry.toName}</Text>
        <Text style={styles.combo}>×{entry.count}</Text>
        <Text style={styles.bannerCoins}>💎{entry.coins}</Text>
      </View>
    </Animated.View>
  );
}

export function GiftReceiveBanners({ roomId }: { roomId: string }) {
  const [current, setCurrent] = useState<ReceiveEntry | null>(null);
  const [dismissSignal, setDismissSignal] = useState(0);

  const queueRef = useRef<ReceiveEntry[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const currentRef = useRef<ReceiveEntry | null>(null);
  const lastRef = useRef<{ comboKey: string; count: number; at: number } | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedAtRef = useRef(Date.now());

  const restartDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => setDismissSignal((s) => s + 1), SHOW_MS);
  }, []);

  const showEntry = useCallback((entry: ReceiveEntry) => {
    currentRef.current = entry;
    lastRef.current = { comboKey: comboOf(entry), count: entry.count, at: Date.now() };
    setCurrent({ ...entry });
    restartDismissTimer();
  }, [restartDismissTimer]);

  const advance = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    if (next) {
      showEntry(next);
    } else {
      currentRef.current = null;
      setCurrent(null);
    }
  }, [showEntry]);

  const bumpCombo = useCallback((entry: ReceiveEntry) => {
    // Merge into the live banner: increment ×N and restart the dismiss timer.
    const live = currentRef.current ?? { ...entry, count: (lastRef.current?.count ?? 0) };
    const updated: ReceiveEntry = { ...live, count: live.count + 1 };
    currentRef.current = updated;
    lastRef.current = { comboKey: comboOf(updated), count: updated.count, at: Date.now() };
    setCurrent({ ...updated });
    restartDismissTimer();
  }, [restartDismissTimer]);

  const handleIncoming = useCallback((entry: ReceiveEntry) => {
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
  }, [bumpCombo, showEntry]);

  useEffect(() => {
    if (!roomId) return;
    // Fresh room → reset all banner state (no cross-room bleed).
    queueRef.current = [];
    seenRef.current.clear();
    currentRef.current = null;
    lastRef.current = null;
    mountedAtRef.current = Date.now();
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    setDismissSignal(0);
    setCurrent(null);
    const q = query(ref(database, `rooms/${roomId}/giftFeed`), limitToLast(30));
    const unsub = onChildAdded(q, (snap) => {
      try {
        const key = snap.key;
        if (!key || seenRef.current.has(key)) return;
        seenRef.current.add(key);
        if (seenRef.current.size > 1000) seenRef.current.clear(); // bound memory
        const entry = parseFeedEntry(key, snap.val());
        if (!entry) return; // malformed → skip silently
        const ts = (snap.val() as Record<string, unknown>)?.ts;
        if (typeof ts === 'number' && ts < mountedAtRef.current) return; // stale replay
        handleIncoming(entry);
      } catch { /* never let a feed entry crash the room */ }
    });
    return () => {
      unsub();
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [roomId, handleIncoming]);

  const handleDismissed = useCallback(() => { advance(); }, [advance]);

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 60 }]} pointerEvents="none">
      {current ? (
        <ReceiveBannerCard
          key={current.key}
          entry={current}
          dismissSignal={dismissSignal}
          onDismissed={handleDismissed}
        />
      ) : null}
    </View>
  );
}

/* ═══════════════════════════════════════════
   Styles
═══════════════════════════════════════════ */

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(12,14,20,0.92)',
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.45)',
  },
  bannerName: {
    color: '#fff', fontSize: 13, fontWeight: '800',
    marginHorizontal: 6, flexShrink: 1,
  },
  bannerArrow: { color: '#ffd700', fontSize: 16, fontWeight: '800', marginHorizontal: 4 },
  bannerCoins: { color: '#ffd700', fontSize: 13, fontWeight: '800', marginLeft: 6 },
  recvBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(12,14,20,0.94)',
    borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.55)',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  recvName: {
    color: '#fff', fontSize: 13, fontWeight: '800',
    marginHorizontal: 6, flexShrink: 1,
  },
  recvSent: { color: '#9aa3b2', fontSize: 12, fontWeight: '600', marginRight: 6 },
  combo: { color: '#ffd700', fontSize: 15, fontWeight: '900', marginLeft: 6 },
});
