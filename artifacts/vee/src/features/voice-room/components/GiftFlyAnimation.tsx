/**
 * GiftFlyAnimation.tsx — IMO gift showpiece, exact behavior rebuild (2026-10-19).
 *
 * IMO behavior (from APK jadx — gift/giftpanel, gift/giftsshow, banner/giftbroadcast):
 * - Fullscreen SVGA-style animation plays for premium gifts (vr_full_anim)
 * - ComboState: the same gift re-sent within the combo window stacks xN on the
 *   RUNNING animation instead of starting a new one
 * - Blast gifts = multi-target: ONE animation hits all recipients
 * - Big gifts trigger the room-wide gold broadcast banner (GiftAwardsBroadcast)
 * - Fullscreen animations QUEUE — they never overlap or break each other
 *
 * Two pieces:
 *  1) <GiftFlyAnimation ref> — SENDER side. playFly() merges rapid re-sends of
 *     the same gift into a combo (xN) and queues shows one-at-a-time:
 *     3.4s fullscreen center display -> 1.5s fly to recipient seat ->
 *     banner (sender -> gift xN -> recipients). Gifts >= 2000 coins get IMO's
 *     gold room-wide broadcast banner instead of the small banner.
 *  2) <GiftReceiveBanners roomId> — RECEIVER side (unchanged): subscribes to
 *     rooms/{roomId}/giftFeed, combo-counting banners, queued.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Animated, Dimensions, Easing, Image, StyleSheet, Text, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { limitToLast, onChildAdded, query, ref } from 'firebase/database';
import { useTranslation } from 'react-i18next';
import { AnimatedGift } from './GiftAnimations';
import { GiftLuxuryEffect } from './GiftLuxuryEffects';
import { database } from '@/src/config/firebase';

/* ═══════════════════════════════════════════
   Shared types + avatar helper
═══════════════════════════════════════════ */

/** Input shape — UNCHANGED (VoiceRoomScreen.handleGiftSent calls this per recipient). */
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
  animationUrl?: string;
  animationType?: string;
  videoSize?: number;
  videoFullscreen?: boolean;
};

export type GiftFlyHandle = {
  playFly: (e: Omit<GiftFlyEvent, 'key'>) => void;
};

/** IMO big-gift broadcast threshold (server decides in IMO; Vee: blast tier). */
const BIG_GIFT_COINS = 2000;
/** IMO combo window — re-sends inside it stack xN on the running animation. */
const SHOW_COMBO_WINDOW_MS = 6000;

/** Gift tier by coin value — drives animation scale. */
export function giftTier(coins: number): 'small' | 'medium' | 'large' {
  if (coins >= 500) return 'large';
  if (coins >= 100) return 'medium';
  return 'small';
}

/** Deterministic pastel-ish color from a name (avatar fallback). */
function hashColor(name: string): string {
  let h = 0;
  const s = name || '?';
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}, 62%, 44%)`;
}

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
   1) SENDER-SIDE queued showpiece (IMO behavior)
═══════════════════════════════════════════ */

type ShowRecipient = {
  uid: string; name: string; photoURL?: string;
  target?: { x: number; y: number } | null;
};

/** One queued fullscreen show — possibly a merged combo of several sends. */
type QueuedShow = {
  giftId: string;
  emoji: string;
  coins: number;
  fromName: string;
  fromAvatar?: string;
  animationUrl?: string;
  animationType?: string;
  videoSize?: number;
  videoFullscreen?: boolean;
  recipients: ShowRecipient[];
  count: number;
  startedAt: number;
};

const DISPLAY_MS = 3400; // IMO fullscreen SVGA display
const FLY_MS = 1500;     // fly to recipient seat
const BANNER_MS = 1600;  // follow-up banner
const BIG_BANNER_MS = 4200; // IMO gold broadcast for big gifts

function GiftShowPlayer({ show, onDone }: { show: QueuedShow; onDone: () => void }) {
  const { width: W, height: H } = Dimensions.get('window');
  const { t } = useTranslation();
  const isBig = show.coins >= BIG_GIFT_COINS;
  const displaySize = Math.min(W * 0.92, H * 0.62);
  const centerX = W / 2;
  const centerY = H / 2;
  // IMO blast = multi-target: fly toward the first recipient's seat.
  const end = show.recipients[0]?.target ?? { x: W / 2, y: 110 };
  const dx = end.x - centerX;
  const dy = end.y - centerY;

  const scale = useRef(new Animated.Value(0)).current;
  const displayOp = useRef(new Animated.Value(0)).current;
  const flyP = useRef(new Animated.Value(0)).current;
  const flyScale = useRef(new Animated.Value(1)).current;
  const bannerOp = useRef(new Animated.Value(0)).current;
  const bannerY = useRef(new Animated.Value(26)).current;
  const comboPop = useRef(new Animated.Value(1)).current;

  const flyX = flyP.interpolate({ inputRange: [0, 1], outputRange: [0, dx] });
  const flyY = flyP.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, dy * 0.7, dy] });

  const bannerDuration = isBig ? BIG_BANNER_MS : BANNER_MS;
  const totalMs = DISPLAY_MS + FLY_MS + bannerDuration + 600;

  useEffect(() => {
    const entrance = Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
      Animated.timing(displayOp, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]);
    const hold = Animated.delay(DISPLAY_MS - 600);
    const fly = Animated.parallel([
      Animated.timing(flyP, { toValue: 1, duration: FLY_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(flyScale, { toValue: 0.25, duration: FLY_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(displayOp, { toValue: 0, duration: 400, delay: FLY_MS - 400, useNativeDriver: true }),
    ]);
    const banner = Animated.sequence([
      Animated.delay(DISPLAY_MS + 300),
      Animated.parallel([
        Animated.timing(bannerOp, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.timing(bannerY, { toValue: 0, duration: 320, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
      ]),
      Animated.delay(bannerDuration),
      Animated.parallel([
        Animated.timing(bannerOp, { toValue: 0, duration: 320, useNativeDriver: true }),
        Animated.timing(bannerY, { toValue: -18, duration: 320, useNativeDriver: true }),
      ]),
    ]);
    Animated.parallel([Animated.sequence([entrance, hold, fly]), banner]).start();
    const timer = setTimeout(onDone, totalMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Combo bump: pop the xN badge when the count grows mid-show.
  const prevCount = useRef(show.count);
  useEffect(() => {
    if (show.count !== prevCount.current) {
      prevCount.current = show.count;
      Animated.sequence([
        Animated.spring(comboPop, { toValue: 1.6, friction: 3.5, useNativeDriver: true }),
        Animated.spring(comboPop, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.count]);

  const combinedScale = Animated.multiply(scale, flyScale);
  const shownRecipients = show.recipients.slice(0, 3);
  const extraCount = show.recipients.length - shownRecipients.length;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* IMO fullscreen center display */}
      <Animated.View style={{
        position: 'absolute',
        left: centerX - displaySize / 2,
        top: centerY - displaySize / 2,
        width: displaySize,
        height: displaySize,
        opacity: displayOp,
        transform: [{ translateX: flyX }, { translateY: flyY }, { scale: combinedScale }],
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <GiftLuxuryEffect giftId={show.giftId} size={displaySize} />
        <AnimatedGift
          giftId={show.giftId} emoji={show.emoji} size={displaySize}
          animationUrl={show.animationUrl} animationType={show.animationType}
          videoSize={displaySize} videoFullscreen
        />
        {show.count > 1 && (
          <Animated.View style={{
            position: 'absolute', bottom: 8, transform: [{ scale: comboPop }],
            backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999,
            paddingHorizontal: 14, paddingVertical: 6,
          }}>
            <Text style={{ color: '#ffd700', fontSize: 22, fontWeight: '900' }}>×{show.count}</Text>
          </Animated.View>
        )}
      </Animated.View>

      {/* Sender pill during display */}
      <Animated.View style={{
        position: 'absolute', top: 60, alignSelf: 'center',
        opacity: displayOp, flexDirection: 'row', alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999,
        paddingHorizontal: 10, paddingVertical: 6, gap: 8,
      }}>
        <GiftAvatar photoURL={show.fromAvatar} name={show.fromName} size={26} />
        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
          {show.fromName}
        </Text>
      </Animated.View>

      {/* IMO big-gift gold broadcast (room-wide) */}
      {isBig ? (
        <Animated.View style={{
          position: 'absolute', top: 100, left: 24, right: 24,
          opacity: bannerOp, transform: [{ translateY: bannerY }],
        }}>
          <LinearGradient
            colors={['#ffe27a', '#ffb62e']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{
              borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10,
              flexDirection: 'row', alignItems: 'center',
              shadowColor: '#ffb62e', shadowOpacity: 0.5, shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 }, elevation: 8,
            }}>
            <Text style={{ fontSize: 22, marginRight: 8 }}>🎉</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#4a2f00', fontSize: 13, fontWeight: '900' }} numberOfLines={2}>
                {show.fromName} → {shownRecipients.map((r) => r.name).join(', ')}
                {extraCount > 0 ? ` +${extraCount}` : ''}
              </Text>
              <Text style={{ color: '#4a2f00', fontSize: 12, fontWeight: '700', marginTop: 2 }}>
                {t('voiceRoom.gifts.bigGiftSent', { coins: show.coins })}
                {show.count > 1 ? ` ×${show.count}` : ''}
              </Text>
            </View>
            <AnimatedGift
              giftId={show.giftId} emoji={show.emoji} size={44}
              animationUrl={show.animationUrl} animationType={show.animationType}
            />
          </LinearGradient>
        </Animated.View>
      ) : (
        /* follow-up banner: sender -> gift xN -> recipients */
        <Animated.View style={{
          position: 'absolute', top: 96, alignSelf: 'center',
          opacity: bannerOp, transform: [{ translateY: bannerY }],
        }}>
          <View style={[styles.banner, { maxWidth: W - 48 }]}>
            <GiftAvatar photoURL={show.fromAvatar} name={show.fromName} size={30} />
            <Text style={styles.bannerName} numberOfLines={1}>{show.fromName}</Text>
            <Text style={styles.bannerArrow}>→</Text>
            <AnimatedGift
              giftId={show.giftId} emoji={show.emoji} size={30}
              animationUrl={show.animationUrl} animationType={show.animationType}
            />
            {show.count > 1 && <Text style={styles.comboInline}>×{show.count}</Text>}
            <Text style={styles.bannerArrow}>→</Text>
            {shownRecipients.map((r) => (
              <View key={r.uid} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 4 }}>
                <GiftAvatar photoURL={r.photoURL} name={r.name} size={26} />
              </View>
            ))}
            {extraCount > 0 && <Text style={styles.bannerName}>+{extraCount}</Text>}
            <Text style={styles.bannerCoins}>💎{show.coins}</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

export const GiftFlyAnimation = forwardRef<GiftFlyHandle, {}>(function GiftFlyAnimation(_props, fwdRef) {
  // IMO: fullscreen shows QUEUE — one at a time, never overlapping.
  const [queue, setQueue] = useState<QueuedShow[]>([]);
  const [active, setActive] = useState<QueuedShow | null>(null);
  const queueRef = useRef<QueuedShow[]>([]);
  const activeRef = useRef<QueuedShow | null>(null);

  const setActiveBoth = useCallback((s: QueuedShow | null) => {
    activeRef.current = s;
    setActive(s);
  }, []);

  const enqueueOrMerge = useCallback((e: Omit<GiftFlyEvent, 'key'>) => {
    const now = Date.now();
    const recipient: ShowRecipient = {
      uid: e.toUid, name: e.toName, photoURL: e.toAvatar, target: e.target ?? null,
    };
    const mergeInto = (s: QueuedShow): boolean => {
      if (s.giftId === e.giftId && now - s.startedAt < SHOW_COMBO_WINDOW_MS) {
        if (!s.recipients.some((r) => r.uid === recipient.uid)) {
          s.recipients.push(recipient);
        }
        s.count += 1;
        return true;
      }
      return false;
    };
    // IMO ComboState: stack xN onto the running animation first …
    if (activeRef.current && mergeInto(activeRef.current)) {
      setActive({ ...activeRef.current });
      return;
    }
    // … then onto a queued show of the same gift …
    const queued = queueRef.current.find((s) => s.giftId === e.giftId && now - s.startedAt < SHOW_COMBO_WINDOW_MS);
    if (queued && mergeInto(queued)) {
      setQueue([...queueRef.current]);
      return;
    }
    // … otherwise enqueue a fresh fullscreen show.
    const fresh: QueuedShow = {
      giftId: e.giftId, emoji: e.emoji, coins: e.coins,
      fromName: e.fromName, fromAvatar: e.fromAvatar,
      animationUrl: e.animationUrl, animationType: e.animationType,
      videoSize: e.videoSize, videoFullscreen: e.videoFullscreen,
      recipients: [recipient], count: 1, startedAt: now,
    };
    queueRef.current = [...queueRef.current, fresh];
    setQueue(queueRef.current);
  }, []);

  useImperativeHandle(fwdRef, () => ({
    playFly: (e: Omit<GiftFlyEvent, 'key'>) => { enqueueOrMerge(e); },
  }), [enqueueOrMerge]);

  // Pump the queue: one show at a time.
  useEffect(() => {
    if (!active && queue.length > 0) {
      const [next, ...rest] = queue;
      queueRef.current = rest;
      setQueue(rest);
      next.startedAt = Date.now();
      setActiveBoth(next);
    }
  }, [active, queue, setActiveBoth]);

  const handleDone = useCallback(() => { setActiveBoth(null); }, [setActiveBoth]);

  // Re-render the active player when its combo count grows (for the xN pop).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (active) {
      const t = setInterval(() => setTick((x) => x + 1), 500);
      return () => clearInterval(t);
    }
  }, [active]);

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50 }]} pointerEvents="none">
      {active ? <GiftShowPlayer show={active} onDone={handleDone} /> : null}
    </View>
  );
});

/* ═══════════════════════════════════════════
   2) RECEIVER-SIDE banners (Firebase giftFeed)
   — combo xN, queued, unchanged IMO-matching behavior
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
  comboInline: { color: '#ffd700', fontSize: 14, fontWeight: '900', marginLeft: 2 },
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
