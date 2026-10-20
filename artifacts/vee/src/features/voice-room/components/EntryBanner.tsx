/**
 * EntryBanner — "X is Coming" join animation (2026-10-10, redesigned).
 * Matches IMO's entry effect: blue gradient pill badge with small DP and
 * name only (no ID). Slides in from the right. Auto-dismisses after 3s.
 *
 * 2026-10-15 (Sumon): PER-RANK entry effects — EVERY noble rank gets its
 * OWN entry effect (rank-colored gradient + rank icon + rank name).
 * `nobleRankIndex` (0-9) is computed by the SENDER from their real noble
 * state and broadcast with the entry event; receivers render the rank's theme.
 * Absent = non-noble standard blue banner.
 *
 * 2026-10-15 (Sumon): Count+ (rankIndex >= 3) gets PREMIUM animated entry:
 * wide horizontal banner from right, DP with crown frame, name only,
 * shimmering rank-color background + sparkles.
 */
import { useEffect, useRef } from 'react';
import { View, Text, Image, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NOBLE_RANKS, nobleThemeFor } from '@/src/services/nobleService';
import { rewardsForRankKey } from '@/src/services/nobleRewardsCatalog';

/**
 * SparkleBurst — 2026-10-20 (boss's order).
 * A one-shot golden sparkle burst that erupts when a Count+ noble's
 * entry banner appears: ~12 sparkles shoot outward from the banner's
 * center and fade. Runs once on mount (no loop), all native-driven.
 */
function SparkleBurst({ width = 260, height = 80 }: { width?: number; height?: number }) {
  const animsRef = useRef<Animated.Value[] | null>(null);
  if (animsRef.current === null) {
    animsRef.current = Array.from({ length: 12 }, () => new Animated.Value(0));
  }
  const anims = animsRef.current;
  const spotsRef = useRef<{ dx: number; dy: number; size: number; delay: number; glyph: string }[] | null>(null);
  if (spotsRef.current === null) {
    spotsRef.current = Array.from({ length: 12 }, (_, i) => {
      const angle = (i / 12) * Math.PI * 2 + (i % 3) * 0.22;
      const dist = 55 + (i % 4) * 22;
      return {
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist * 0.62,
        size: 10 + (i % 3) * 5,
        delay: (i % 5) * 90,
        glyph: i % 4 === 0 ? '⭐' : '✨',
      };
    });
  }
  const spots = spotsRef.current;

  useEffect(() => {
    const seqs = anims.map((a, i) =>
      Animated.sequence([
        Animated.delay(spots[i].delay),
        Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    const all = Animated.stagger(40, seqs);
    all.start();
    return () => all.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', left: 0, top: 0, width, height,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {spots.map((s, i) => {
        const a = anims[i];
        return (
          <Animated.Text
            key={i}
            style={{
              position: 'absolute',
              fontSize: s.size,
              opacity: a.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 0] }),
              transform: [
                { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, s.dx] }) },
                { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, s.dy] }) },
                { scale: a.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.4, 1.2, 0.6] }) },
              ],
              textShadowColor: '#FFD700',
              textShadowRadius: 6,
            }}
          >
            {s.glyph}
          </Animated.Text>
        );
      })}
    </View>
  );
}

interface EntryBannerProps {
  /** The joiner's display name */
  name: string;
  /** The joiner's photo URL (optional) */
  photoURL?: string | null;
  /** Noble rank index (0-9) — per-rank entry effect. Absent = non-noble. */
  nobleRankIndex?: number;
  /** Called when the banner should be dismissed */
  onDismiss: () => void;
}

export default function EntryBanner({ name, photoURL, nobleRankIndex, onDismiss }: EntryBannerProps) {
  // 2026-10-15 (Sumon): per-rank theme. Non-nobles get the standard blue.
  const theme = nobleRankIndex != null ? nobleThemeFor(nobleRankIndex) : null;
  const rankName = nobleRankIndex != null ? NOBLE_RANKS[nobleRankIndex]?.name : null;
  const isNoble = !!theme && !!rankName;
  // 2026-10-15 (Sumon): Count+ (index >= 3) gets PREMIUM animated entry effect
  const isPremiumEntry = nobleRankIndex != null && nobleRankIndex >= 3;
  const rankKey = nobleRankIndex != null ? NOBLE_RANKS[nobleRankIndex]?.key : null;
  const catalog = rankKey ? rewardsForRankKey(rankKey) : null;
  const frameUrl = catalog?.frame?.designUrl;
  const slideAnim = useRef(new Animated.Value(400)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        speed: 14,
        bounciness: 6,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 400,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => onDismiss());
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  const initials = name.trim().charAt(0).toUpperCase() || '?';

  // 2026-10-15 (Sumon): PREMIUM entry for Count+ — wide banner from right,
  // DP with crown frame, name only, shimmering rank color + sparkles.
  if (isPremiumEntry && theme) {
    const rankColor = NOBLE_RANKS[nobleRankIndex!]?.color || '#7E57C2';
    return (
      <Animated.View
        style={{
          transform: [{ translateX: slideAnim }],
          opacity: opacityAnim,
          position: 'absolute',
          // 2026-10-16 (Sumon): premium banner slides from the right to the
          // EXACT MIDDLE of the display — not the top.
          top: '42%',
          alignSelf: 'center',
          zIndex: 100,
        }}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[rankColor + 'F2', rankColor + 'D9']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            borderTopLeftRadius: 18,
            borderBottomLeftRadius: 18,
            paddingVertical: 10,
            paddingLeft: 14,
            paddingRight: 20,
            borderWidth: 1,
            borderRightWidth: 0,
            borderColor: '#FFD70066',
            shadowColor: rankColor,
            shadowOffset: { width: -4, height: 0 },
            shadowOpacity: 0.6,
            shadowRadius: 16,
            elevation: 8,
            minWidth: 240,
          }}
        >
          {/* DP with crown frame — 2026-10-16 (Sumon): frame FITS TIGHT on the DP.
              Count frame opening = 51.2%, so 1.6x (64px for 40px DP) gives the
              snug overlap — same ratio as Avatar.tsx NobelFrame. */}
          <View style={{ width: 64, height: 64, marginRight: 12, alignItems: 'center', justifyContent: 'center' }}>
            {frameUrl && /^https?:\/\//i.test(frameUrl) ? (
              <Image
                source={{ uri: frameUrl }}
                style={{ position: 'absolute', width: 64, height: 64 }}
                resizeMode="contain"
              />
            ) : (
              <View style={{
                position: 'absolute', width: 64, height: 64, borderRadius: 32,
                borderWidth: 2.5, borderColor: rankColor,
              }} />
            )}
            {photoURL ? (
              <Image
                source={{ uri: photoURL }}
                style={{ width: 40, height: 40, borderRadius: 20 }}
              />
            ) : (
              <View style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: 'rgba(255,255,255,0.25)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
                  {initials}
                </Text>
              </View>
            )}
            <Text style={{ position: 'absolute', top: -8, fontSize: 18 }}>
              👑
            </Text>
          </View>
          {/* Name only — no extra text */}
          <Text
            style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}
            numberOfLines={1}
          >
            {name}
          </Text>
          {/* Sparkles */}
          <Text style={{ position: 'absolute', top: 4, right: 10, fontSize: 10 }}>✨</Text>
          <Text style={{ position: 'absolute', bottom: 6, right: 28, fontSize: 10 }}>✨</Text>
        </LinearGradient>
        {/* 2026-10-20 (boss's order): golden sparkle burst on entry for Count+ */}
        <SparkleBurst width={280} height={84} />
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={{
        transform: [{ translateX: slideAnim }],
        opacity: opacityAnim,
        position: 'absolute',
        top: '40%',
        alignSelf: 'center',
        zIndex: 100,
      }}
      pointerEvents="none"
    >
      <LinearGradient
        colors={isNoble ? theme!.entryGradient : ['#4DA6FF', '#1E6FCC']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 20,
          paddingVertical: 6,
          paddingLeft: 6,
          paddingRight: 16,
          borderWidth: isNoble ? 2 : 0,
          borderColor: isNoble ? '#FFF8E1' : 'transparent',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 4,
          elevation: 5,
        }}
      >
        {photoURL ? (
          <Image
            source={{ uri: photoURL }}
            style={{ width: 32, height: 32, borderRadius: 16, marginRight: 8 }}
          />
        ) : (
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: 'rgba(255,255,255,0.35)',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 8,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
              {initials}
            </Text>
          </View>
        )}
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {isNoble ? `${theme!.entryIcon} ${name} • ${rankName}` : `${name} is Coming`}
        </Text>
      </LinearGradient>
    </Animated.View>
  );
}
