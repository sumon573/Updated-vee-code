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
import { View, Text, Image, Animated, Dimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { NOBLE_RANKS, nobleThemeFor } from '@/src/services/nobleService';
import { rewardsForRankKey } from '@/src/services/nobleRewardsCatalog';

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
  // 2026-10-24 (Sumon): FULL entry art — when the rank's catalog entryEffect
  // carries a designUrl (server-driven via RTDB nobel_rewards), the banner
  // IS that animated art (arrival + dazzle are baked into the art itself):
  // the entrant's live DP fills the art's left socket and their live name
  // fills the name slot next to the crown. Marquis is the first rank with
  // entry art (his own supplied design, approved final 2026-10-24).
  const entryUrl = catalog?.entryEffect?.designUrl;
  const hasEntryArt = isPremiumEntry && !!entryUrl;
  const slideAnim = useRef(new Animated.Value(400)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (hasEntryArt) {
      // Art branch: no slide (the art sweeps in by itself) — fade in fast,
      // hold for the art's ~4s loop, fade out at its own fade tail.
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      const timer = setTimeout(() => {
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => onDismiss());
      }, 3650);
      return () => clearTimeout(timer);
    }
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

  const initials = (name || '?').trim().charAt(0).toUpperCase() || '?';
  // 2026-10-30 (boss): entry banner shows name only, never the rank.
  // Long names truncate to first 7 chars + '..' ('Muhammad' -> 'Muhamma..').
  const rawName = name || '';
  const displayName = rawName.length > 7 ? rawName.slice(0, 7) + '..' : rawName;

  // 2026-10-24 (Sumon): ENTRY ART branch — full animated banner art with
  // live DP + name composited into the art's own slots. Geometry is the
  // art's native 1600x533 canvas, verified against the approved design:
  // DP socket center (24.3% W, 48.7% H), disc 12.7% of W; name slot starts
  // at 37.2% W with its baseline at 48.7% H, emblem begins at ~62.5% W.
  if (hasEntryArt && theme) {
    const bannerW = Math.min(Dimensions.get('window').width * 0.94, 470);
    const bannerH = (bannerW * 533) / 1600;
    const dpSize = bannerW * 0.127;
    const nameFont = bannerW * 0.043;
    return (
      <Animated.View
        style={{
          opacity: opacityAnim,
          position: 'absolute',
          top: '42%',
          alignSelf: 'center',
          zIndex: 100,
          width: bannerW,
          height: bannerH,
        }}
        pointerEvents="none"
      >
        <ExpoImage
          source={{ uri: entryUrl }}
          style={{ position: 'absolute', width: bannerW, height: bannerH }}
          contentFit="contain"
        />
        {/* Live DP inside the art's gold-ring socket */}
        {photoURL ? (
          <Image
            source={{ uri: photoURL }}
            style={{
              position: 'absolute',
              left: bannerW * 0.1788,
              top: bannerH * 0.295,
              width: dpSize,
              height: dpSize,
              borderRadius: dpSize / 2,
            }}
          />
        ) : (
          <View
            style={{
              position: 'absolute',
              left: bannerW * 0.1788,
              top: bannerH * 0.295,
              width: dpSize,
              height: dpSize,
              borderRadius: dpSize / 2,
              backgroundColor: '#3B1470',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: dpSize * 0.42, fontWeight: '800' }}>
              {initials}
            </Text>
          </View>
        )}
        {/* Live name in the art's name slot (gold, beside the crown) */}
        <Text
          style={{
            position: 'absolute',
            left: bannerW * 0.3719,
            top: bannerH * 0.372,
            width: bannerW * 0.245,
            color: '#FFD94D',
            fontSize: nameFont,
            lineHeight: nameFont * 1.1,
            fontWeight: '800',
            textShadowColor: 'rgba(30,10,0,0.85)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 3,
          }}
          numberOfLines={1}
        >
          {name}
        </Text>
      </Animated.View>
    );
  }

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
          {displayName} is coming
        </Text>
      </LinearGradient>
    </Animated.View>
  );
}
