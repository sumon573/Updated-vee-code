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
import { NOBLE_REWARDS_CATALOG } from '@/src/services/nobleRewardsCatalog';

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
  const catalog = rankKey ? NOBLE_REWARDS_CATALOG.find(c => c.rankKey === rankKey) : null;
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
          top: 60,
          right: 0,
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
            minWidth: 200,
          }}
        >
          {/* DP with crown frame */}
          <View style={{ width: 52, height: 52, marginRight: 12 }}>
            {frameUrl && /^https?:\/\//i.test(frameUrl) ? (
              <Image
                source={{ uri: frameUrl }}
                style={{ position: 'absolute', width: 52, height: 52 }}
                resizeMode="contain"
              />
            ) : (
              <View style={{
                position: 'absolute', width: 52, height: 52, borderRadius: 26,
                borderWidth: 2.5, borderColor: rankColor,
              }} />
            )}
            {photoURL ? (
              <Image
                source={{ uri: photoURL }}
                style={{ width: 40, height: 40, borderRadius: 20, margin: 6 }}
              />
            ) : (
              <View style={{
                width: 40, height: 40, borderRadius: 20, margin: 6,
                backgroundColor: 'rgba(255,255,255,0.25)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
                  {initials}
                </Text>
              </View>
            )}
            <Text style={{ position: 'absolute', top: -11, left: 16, fontSize: 18 }}>
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
