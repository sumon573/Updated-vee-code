import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import MistNameplate from '@/src/components/MistNameplate';
import { NOBLE_RANKS, nobleThemeFor } from '@/src/services/nobleService';
import { getActiveCatalog } from '@/src/services/nobleRewardsCatalog';
import type { GrantedNameplate } from '@/src/services/badgeService';

/* ── 2026-11-11 (boss, imo mirror): shared nameplate row ────────────────
   Extracted VERBATIM from app/profile/index.tsx (the profile's plate row,
   lines ~1643–1758) so the popup and the profile render the SAME plates.
   Sizes: 'large' = the profile's 74x20 (own profile); 'small' = 68x18
   (boss 13:53: "size a little smaller so they fit" — other-user profile +
   popup). Art is NEVER cut/cropped/squashed — only uniformly scaled.
   The SVIP shimmer + 5 sparkles are the Lv Max badge effect, copied
   exactly (speed 900, opacity 0.8); the small sparkle positions are the
   large ones × 0.92. The four helpers below (ShimmerOverlay, Sparkle,
   lightenHex, PremiumPill) are copies of the profile's locals — keep them
   in sync with app/profile/index.tsx (LevelBadge still uses the profile's
   own ShimmerOverlay/Sparkle). */

const PLATE_LARGE = { w: 74, h: 20, r: 10 };
const PLATE_SMALL = { w: 68, h: 18, r: 9 };

const SPARKLES_LARGE = [
  { delay: 0, left: 15, top: 3, size: 5, color: '#FFD700' },
  { delay: 300, left: 55, top: 12, size: 4, color: '#FFFFFF' },
  { delay: 600, left: 80, top: 5, size: 5, color: '#FFD700' },
  { delay: 200, left: 35, top: 10, size: 3, color: '#FFE873' },
  { delay: 700, left: 65, top: 4, size: 4, color: '#FFD700' },
];
const SPARKLES_SMALL = [
  { delay: 0, left: 14, top: 3, size: 5, color: '#FFD700' },
  { delay: 300, left: 51, top: 11, size: 4, color: '#FFFFFF' },
  { delay: 600, left: 74, top: 5, size: 5, color: '#FFD700' },
  { delay: 200, left: 32, top: 9, size: 3, color: '#FFE873' },
  { delay: 700, left: 60, top: 4, size: 4, color: '#FFD700' },
];

function ShimmerOverlay({ speed = 2500, opacity = 0.6 }: { speed?: number; opacity?: number }) {
  const shimmer = useRef(new Animated.Value(-1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmer, { toValue: 2, duration: speed, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [speed, shimmer]);
  return (
    <Animated.View
      style={{
        position: 'absolute', top: 0, bottom: 0, width: 40,
        backgroundColor: '#FFFFFF', opacity,
        transform: [{ translateX: shimmer.interpolate({ inputRange: [-1, 2], outputRange: [-60, 140] }) },
          { skewX: '-20deg' }],
      }}
    />
  );
}

function Sparkle({ delay, left, top, size = 4, color = '#FFFFFF' }:
  { delay: number; left: number; top: number; size?: number; color?: string }) {
  const twinkle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(twinkle, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(twinkle, { toValue: 0, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay, twinkle]);
  return (
    <Animated.View
      style={{
        position: 'absolute', left, top, width: size, height: size,
        borderRadius: size / 2, backgroundColor: color,
        opacity: twinkle.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
        transform: [{ scale: twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.3] }) }],
        shadowColor: color, shadowOpacity: 0.8, shadowRadius: 4,
      }}
    />
  );
}

function lightenHex(hex: string, amt: number): string {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const num = parseInt(full, 16);
  if (!Number.isFinite(num)) return hex;
  const r = Math.min(255, ((num >> 16) & 0xff) + amt);
  const g = Math.min(255, ((num >> 8) & 0xff) + amt);
  const b = Math.min(255, (num & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function PremiumPill({ label, icon, colors, padH = 8, fontSize = 11, height = 20, radius = 10, iconSize = 12 }:
  { label: string; icon?: string; colors: [string, string]; padH?: number; fontSize?: number; height?: number; radius?: number; iconSize?: number }) {
  return (
    <View style={{ marginRight: 6 }}>
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          height, borderRadius: radius, paddingHorizontal: padH,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
      >
        {icon && <Text style={{ fontSize: iconSize, marginRight: 3 }}>{icon}</Text>}
        <Text style={{ fontSize, fontWeight: '700', color: '#FFFFFF' }} numberOfLines={1}>{label}</Text>
      </LinearGradient>
    </View>
  );
}

/** Dual nameplate row: SVIP plate first, Noble plate second (boss rule).
 * `plates` must already be derived (SVIP auto + current noble rank) — the
 * same derivation the profile uses. Only the CURRENT rank's noble plate
 * renders; a stale old-rank plate stays hidden. */
export function NameplateRow({ plates, size, nobleRankKey }: {
  plates: GrantedNameplate[];
  /** 'large' 74x20 (own profile) · 'small' 68x18 (other-user profile + popup). */
  size: 'large' | 'small';
  nobleRankKey: string | null;
}) {
  const P = size === 'small' ? PLATE_SMALL : PLATE_LARGE;
  const sparkles = size === 'small' ? SPARKLES_SMALL : SPARKLES_LARGE;
  const mistFor = (plateId: string): string | null => {
    const entry = getActiveCatalog().find((r) => `noble-plate-${r.rankKey}` === plateId);
    return entry?.nameplate.mistColor || null;
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {plates.map((plate) => {
        const isNoblePlate = plate.id.startsWith('noble-plate-');
        const mist = mistFor(plate.id);
        const iconUrl = /^https?:\/\//i.test(plate.icon || '');
        // SVIP / other URL plates render the banner art whole (never cut);
        // SVIP animates EXACTLY like the Lv Max badge — same ShimmerOverlay
        // (speed 900, opacity 0.8) + same 5 Sparkles. Noble plates static.
        if (!isNoblePlate) {
          if (!iconUrl) return null;
          const isSvipPlate = plate.id.startsWith('svip');
          const plateView = (
            <View key={plate.id} style={{ marginRight: 6, width: P.w, height: P.h, borderRadius: P.r, overflow: 'hidden' }}>
              {mist ? (
                <MistNameplate imageUrl={plate.icon} mistColor={mist} width={P.w} height={P.h} fit="cover" />
              ) : (
                <Image source={{ uri: plate.icon }} style={{ width: P.w, height: P.h }} contentFit="cover" />
              )}
              {isSvipPlate && (
                <>
                  <ShimmerOverlay speed={900} opacity={0.8} />
                  {sparkles.map((s) => (
                    <Sparkle key={`${s.delay}-${s.left}`} delay={s.delay} left={s.left} top={s.top} size={s.size} color={s.color} />
                  ))}
                </>
              )}
            </View>
          );
          if (isSvipPlate) {
            return (
              <Pressable key={plate.id} onPress={() => router.push('/svip')} hitSlop={4}>
                {plateView}
              </Pressable>
            );
          }
          return plateView;
        }
        // Noble plate — only the CURRENT rank's plate renders. Tapping it
        // opens the Nobel page (2026-10-31, boss).
        const rankKey = plate.id.slice('noble-plate-'.length);
        if (rankKey !== nobleRankKey) return null;
        const rankIndex = NOBLE_RANKS.findIndex((r) => r.key === rankKey);
        if (iconUrl && rankKey === 'count') {
          return (
            <Pressable key={plate.id} onPress={() => router.push('/profile/nobel')} hitSlop={4}>
              <View style={{ marginRight: 6 }}>
                <Image source={{ uri: plate.icon }} style={{ width: P.w, height: P.h }} contentFit="contain" />
              </View>
            </Pressable>
          );
        }
        if (iconUrl && rankKey === 'marquis') {
          return (
            <Pressable key={plate.id} onPress={() => router.push('/profile/nobel')} hitSlop={4}>
              <View style={{ marginRight: 6, width: P.w, height: P.h, borderRadius: P.r, overflow: 'hidden' }}>
                <MistNameplate imageUrl={plate.icon} mistColor={mist || '#EC407A'} width={P.w} height={P.h} fit="cover" />
              </View>
            </Pressable>
          );
        }
        if (iconUrl && rankKey === 'duke') {
          return (
            <Pressable key={plate.id} onPress={() => router.push('/profile/nobel')} hitSlop={4}>
              <View style={{ marginRight: 6, width: P.w, height: P.h, borderRadius: P.r, overflow: 'hidden' }}>
                <MistNameplate imageUrl={plate.icon} mistColor={mist || '#FF7043'} width={P.w} height={P.h} fit="cover" />
              </View>
            </Pressable>
          );
        }
        if (iconUrl && rankKey === 'king') {
          return (
            <Pressable key={plate.id} onPress={() => router.push('/profile/nobel')} hitSlop={4}>
              <View style={{ marginRight: 6, width: P.w, height: P.h, borderRadius: P.r, overflow: 'hidden' }}>
                <MistNameplate imageUrl={plate.icon} mistColor={mist || '#FBC02D'} width={P.w} height={P.h} fit="cover" />
              </View>
            </Pressable>
          );
        }
        if (rankIndex >= 0) {
          const rank = NOBLE_RANKS[rankIndex];
          const small = size === 'small';
          return (
            <Pressable key={plate.id} onPress={() => router.push('/profile/nobel')} hitSlop={4}>
              <PremiumPill
                padH={rank.key === 'viscount' ? 5 : rank.key === 'knight' ? (small ? 6 : 7) : (small ? 7 : 8)}
                fontSize={rank.key === 'viscount' ? 9 : (small ? 10 : 11)}
                height={P.h}
                radius={P.r}
                iconSize={small ? 11 : 12}
                label={rank.name.toUpperCase()}
                icon={nobleThemeFor(rankIndex)?.entryIcon}
                colors={[rank.color, lightenHex(rank.color, 60)]}
              />
            </Pressable>
          );
        }
        return null;
      })}
    </View>
  );
}
