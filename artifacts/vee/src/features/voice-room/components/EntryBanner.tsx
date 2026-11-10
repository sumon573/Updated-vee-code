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
import { View, Text, Image, Animated, Dimensions, Easing } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { NOBLE_RANKS, nobleThemeFor } from '@/src/services/nobleService';
import { KingSparkle } from './KingShimmerName';
import { rewardsForRankKey } from '@/src/services/nobleRewardsCatalog';

interface EntryBannerProps {
  /** The joiner's display name */
  name: string;
  /** The joiner's photo URL (optional) */
  photoURL?: string | null;
  /** Noble rank index (0-9) — per-rank entry effect. Absent = non-noble. */
  nobleRankIndex?: number;
  /** Equipped entry effect id (sender's activeEntryEffect). Absent = old sender. */
  activeEntryEffect?: string;
  /** SVIP entry-effect art URL (sender's grant icon), sent with the entry
      event. Only used when activeEntryEffect is an SVIP id. */
  entryEffectArtUrl?: string | null;
  /** Called when the banner should be dismissed */
  onDismiss: () => void;
}

// 2026-11-11 (boss): SVIP entry shimmer — same technique as the SVIP
// nameplate Lv Max animation (ShimmerOverlay, speed 900, opacity 0.8):
// a bright band sweeping across, transform/opacity-only with the native
// driver (no heat, no JS loop). `color` = the band colour (white over the
// gold badge, gold over the white name text); `sweepWidth` = how far right
// the band travels (tuned to the container width). The parent must have
// overflow: 'hidden' to clip the band. Boss explicitly ordered animation
// for THIS SVIP5 entry badge only (overrides the Noble-badge "never
// animated" rule for this badge only).
function EntryShimmer({ color, opacity = 0.8, speed = 900, sweepWidth = 200 }: { color: string; opacity?: number; speed?: number; sweepWidth?: number }) {
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
        position: 'absolute', top: 0, bottom: 0, left: 0, width: 40,
        backgroundColor: color, opacity,
        transform: [
          { translateX: shimmer.interpolate({ inputRange: [-1, 2], outputRange: [-60, sweepWidth] }) },
          { skewX: '-20deg' },
        ],
      }}
    />
  );
}

export default function EntryBanner({ name, photoURL, nobleRankIndex, activeEntryEffect, entryEffectArtUrl, onDismiss }: EntryBannerProps) {
  // 2026-11-11 (SVIP entry effect): an SVIP id starts with 'svip'
  // (e.g. 'svip5-entry-effect'); noble ids start with 'noble-effect-'.
  // The SVIP branch renders ONLY when the id is SVIP *and* the sender
  // supplied the art URL — otherwise the noble/standard path is untouched.
  const isSvipEntryEffect = typeof activeEntryEffect === 'string' && activeEntryEffect.startsWith('svip');
  const svipArtUrl = isSvipEntryEffect && typeof entryEffectArtUrl === 'string' && /^https?:\/\//i.test(entryEffectArtUrl)
    ? entryEffectArtUrl
    : null;
  // 2026-10-15 (Sumon): per-rank theme. Non-nobles get the standard blue.
  const theme = nobleRankIndex != null ? nobleThemeFor(nobleRankIndex) : null;
  const rankName = nobleRankIndex != null ? NOBLE_RANKS[nobleRankIndex]?.name : null;
  const isNoble = !!theme && !!rankName;
  // 2026-10-15 (Sumon): Count+ (index >= 3) gets PREMIUM animated entry effect
  const isPremiumEntry = nobleRankIndex != null && nobleRankIndex >= 3;
  // 2026-10-30 (boss): Baron grand entry REMOVED - Baron entry is the standard
  // pill again (name + is coming). Grand entry is Count+ premium only.
  const isGrandEntry = isPremiumEntry;
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
  // 2026-10-30 (boss): Viscount entry art — any rank whose catalog entryEffect
  // carries a designUrl gets the art branch (Marquis was first; Viscount's own
  // banner art is server-driven). Viscount's art is a static banner, so the app
  // animates it: slide in from the right, stop dead-center.
  const hasEntryArt = !!entryUrl;
  const isViscountArt = hasEntryArt && rankKey === 'viscount';
  const isCountArt = hasEntryArt && rankKey === 'count';
  const isDukeArt = hasEntryArt && rankKey === 'duke';
  const isKingArt = hasEntryArt && rankKey === 'king';
  const slideAnim = useRef(new Animated.Value(400)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (svipArtUrl) {
      // 2026-11-11 (SVIP entry effect): the art animates itself — fade in
      // fast, hold for the art's ~3.7s play, fade out. Same 3650ms dismiss
      // as the noble art branch; NO new timer beyond this existing pattern.
      // The banner unmounts on dismiss, so the WebP stops with it.
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
    if (hasEntryArt) {
      if (isViscountArt || isCountArt || isDukeArt || isKingArt) {
        // Viscount/Count: static banner art — slide in from the right, stop
        // dead-center, hold ~4s, fade out. Timing (no bounce): a clean stop.
        slideAnim.setValue(Dimensions.get('window').width);
        Animated.parallel([
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 550,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
        ]).start();
        const timer = setTimeout(() => {
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start(() => onDismiss());
        }, 3650);
        return () => clearTimeout(timer);
      }
      // Marquis art branch: no slide (the art sweeps in by itself) — fade in fast,
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
  // Viscount canvas 1903x826: DP center (17.6% W, 49.4% H), disc 19.2% of W;
  // Count canvas 1922x586: DP center (18.7% W, 46.1% H), disc 17.2% of W;
  // name slot starts at 33.0% W, top 32.4% H (gold name + white 'is coming...' below).
  // name slot starts at 31.5% W (gold name + white 'is coming...' below).
  // Duke canvas 2007x638: DP center (14.7% W, 44.7% H), disc 16.4% of W;
  // King canvas 1814x562 (v4 clean base): DP center (13.8% W, 43.4% H), disc 15.3% of W;
  // name slot starts at 28.8% W, top 25.6% H (gold name + white 'is coming...' below at 52.0% H).
  // name slot starts at 34.9% W, top 31% H (gold name + white 'is coming...' below at 53% H).
  // 2026-11-11 (SVIP entry effect): the equipped SVIP effect wins over the
  // noble art branch (a user can be both King and SVIP 5 — the active
  // effect is the SVIP dragon). Transparent animated WebP on top, live DP +
  // live name + "is Coming..." below it — NO solid background, pill, badge
  // or opaque container anywhere, so it blends with the room background.
  // The art is 315x311 (near-square); the whole branch dismisses on the
  // existing 3650ms timer above and unmounts with it.
  if (svipArtUrl) {
    const dragonW = Math.min(Dimensions.get('window').width * 0.86, 320);
    const dragonH = (dragonW * 311) / 315;
    return (
      <Animated.View
        style={{
          opacity: opacityAnim,
          position: 'absolute',
          top: '28%',
          alignSelf: 'center',
          zIndex: 100,
          alignItems: 'center',
        }}
        pointerEvents="none"
      >
        <ExpoImage
          source={{ uri: svipArtUrl }}
          style={{ width: dragonW, height: dragonH }}
          contentFit="contain"
        />
        {/* 2026-11-11 (boss): gold "SVIP5" badge in the empty space between
            the dragon and the name row. Solid SVIP gold #E8B84B
            (theme-agnostic — reads on light and dark themes alike) with
            dark text. The white shimmer band sweeps across the gold pill
            (under the text, so the dark text stays readable). */}
        <View
          style={{
            alignSelf: 'center',
            marginTop: 10,
            marginBottom: 2,
            borderRadius: 999,
            backgroundColor: '#E8B84B',
            borderColor: '#C9972B',
            borderWidth: 1,
            paddingHorizontal: 14,
            paddingVertical: 5,
            overflow: 'hidden',
          }}
        >
          <EntryShimmer color="#FFFFFF" opacity={0.8} speed={900} sweepWidth={120} />
          <Text style={{ color: '#1A1A1A', fontSize: 13, fontWeight: '800', letterSpacing: 1 }} allowFontScaling={false}>
            SVIP5
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 8,
          }}
        >
          {photoURL ? (
            <Image
              source={{ uri: photoURL }}
              style={{ width: 40, height: 40, borderRadius: 20, marginRight: 10 }}
            />
          ) : (
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(255,255,255,0.25)',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 10,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
                {initials}
              </Text>
            </View>
          )}
          {/* 2026-11-11 (boss): gold shimmer sweep across the "is Coming..."
              text — the text stays WHITE + dark halo (readable on any
              theme); the gold band sweeping OVER it tints it gold as it
              passes, giving the animated-colour premium look. The wrapper
              has padding 6 so the halo (radius 4) is not clipped by
              overflow: 'hidden'. Same ShimmerOverlay technique, native
              driver only (no heat). */}
          <View style={{ overflow: 'hidden', padding: 6 }}>
            <Text
              style={{
                color: '#FFFFFF',
                fontSize: 18,
                fontWeight: '800',
                textShadowColor: 'rgba(0,0,0,0.9)',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 4,
              }}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {name} is Coming...
            </Text>
            <EntryShimmer color="#FFD700" opacity={0.7} speed={900} sweepWidth={220} />
          </View>
        </View>
      </Animated.View>
    );
  }

  if (hasEntryArt && theme) {
    const bannerW = Math.min(Dimensions.get('window').width * 0.94, 470);
    // Viscount canvas is 1903x826 (own banner art); Marquis is 1600x533.
    const bannerH = isViscountArt ? (bannerW * 826) / 1903 : isCountArt ? (bannerW * 586) / 1922 : isDukeArt ? (bannerW * 638) / 2007 : isKingArt ? (bannerW * 562) / 1814 : (bannerW * 533) / 1600;
    const dpSize = isViscountArt ? bannerW * 0.1923 : isCountArt ? bannerW * 0.1717 : isDukeArt ? bannerW * 0.164 : isKingArt ? bannerW * 0.1528 : bannerW * 0.127;
    const nameFont = isViscountArt || isCountArt || isDukeArt || isKingArt ? bannerW * 0.042 : bannerW * 0.043;
    return (
      <Animated.View
        style={{
          ...((isViscountArt || isCountArt || isDukeArt || isKingArt) ? { transform: [{ translateX: slideAnim }] } : {}),
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
              left: isViscountArt ? bannerW * 0.0799 : isCountArt ? bannerW * 0.1009 : isDukeArt ? bannerW * 0.065 : isKingArt ? bannerW * 0.0611 : bannerW * 0.1788,
              top: isViscountArt ? bannerH * 0.2723 : isCountArt ? bannerH * 0.1792 : isDukeArt ? bannerH * 0.189 : isKingArt ? bannerH * 0.1927 : bannerH * 0.295,
              width: dpSize,
              height: dpSize,
              borderRadius: dpSize / 2,
            }}
          />
        ) : (
          <View
            style={{
              position: 'absolute',
              left: isViscountArt ? bannerW * 0.0799 : isCountArt ? bannerW * 0.1009 : isDukeArt ? bannerW * 0.065 : isKingArt ? bannerW * 0.0611 : bannerW * 0.1788,
              top: isViscountArt ? bannerH * 0.2723 : isCountArt ? bannerH * 0.1792 : isDukeArt ? bannerH * 0.189 : isKingArt ? bannerH * 0.1927 : bannerH * 0.295,
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
        {/* Live name in the art's name slot. Viscount/Count: gold name + white
            'is coming...' below it, serif to match the banner art. Count's slot
            sits where the supplied art's text sat (left 33.0% W, top 32.4% H). */}
        {isViscountArt ? (
          <View
            style={{
              position: 'absolute',
              left: bannerW * 0.3153,
              top: bannerH * 0.35,
              width: bannerW * 0.305,
            }}
          >
            <Text
              style={{
                color: '#FFD94D',
                fontSize: nameFont,
                lineHeight: nameFont * 1.05,
                fontWeight: '800',
                fontFamily: 'serif',
                textShadowColor: 'rgba(30,10,0,0.85)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 3,
              }}
              numberOfLines={1}
              ellipsizeMode="tail"
              allowFontScaling={false}
            >
              {name}
            </Text>
            <Text
              style={{
                color: '#FFFFFF',
                fontSize: bannerW * 0.030,
                lineHeight: bannerW * 0.030 * 1.1,
                fontWeight: '700',
                fontFamily: 'serif',
                textShadowColor: 'rgba(30,10,0,0.85)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 3,
              }}
              numberOfLines={1}
              allowFontScaling={false}
            >
              is coming...
            </Text>
          </View>
        ) : isCountArt ? (
          <View
            style={{
              position: 'absolute',
              left: bannerW * 0.330,
              top: bannerH * 0.324,
              width: bannerW * 0.305,
            }}
          >
            <Text
              style={{
                color: '#FFD94D',
                fontSize: nameFont,
                lineHeight: nameFont * 1.05,
                fontWeight: '800',
                fontFamily: 'serif',
                textShadowColor: 'rgba(30,10,0,0.85)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 3,
              }}
              numberOfLines={1}
              ellipsizeMode="tail"
              allowFontScaling={false}
            >
              {name}
            </Text>
            <Text
              style={{
                color: '#FFFFFF',
                fontSize: bannerW * 0.030,
                lineHeight: bannerW * 0.030 * 1.1,
                fontWeight: '700',
                fontFamily: 'serif',
                textShadowColor: 'rgba(30,10,0,0.85)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 3,
                marginTop: bannerH * 0.060,
              }}
              numberOfLines={1}
              allowFontScaling={false}
            >
              is coming...
            </Text>
          </View>
        ) : isDukeArt ? (
          <View
            style={{
              position: 'absolute',
              left: bannerW * 0.349,
              top: bannerH * 0.31,
              width: bannerW * 0.251,
            }}
          >
            <Text
              style={{
                color: '#FFD94D',
                fontSize: nameFont,
                lineHeight: nameFont * 1.05,
                fontWeight: '800',
                fontFamily: 'serif',
                textShadowColor: 'rgba(30,10,0,0.85)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 3,
              }}
              numberOfLines={1}
              ellipsizeMode="tail"
              allowFontScaling={false}
            >
              {name}
            </Text>
            <Text
              style={{
                color: '#FFFFFF',
                fontSize: bannerW * 0.030,
                lineHeight: bannerW * 0.030 * 1.1,
                fontWeight: '700',
                fontFamily: 'serif',
                textShadowColor: 'rgba(30,10,0,0.85)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 3,
                marginTop: bannerH * 0.081,
              }}
              numberOfLines={1}
              allowFontScaling={false}
            >
              is coming...
            </Text>
          </View>
        ) : isKingArt ? (
          <View
            style={{
              position: 'absolute',
              left: bannerW * 0.288,
              top: bannerH * 0.256,
              width: bannerW * 0.302,
            }}
          >
            {/* 2026-11-01 (batch56): King art name is already gold by art
                design; the sparkle joins it (slot width unchanged, the
                name shrinks so the star never leaves the art). */}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text
                style={{
                  color: '#FFD94D',
                  fontSize: nameFont,
                  lineHeight: nameFont * 1.05,
                  fontWeight: '800',
                  fontFamily: 'serif',
                  textShadowColor: 'rgba(30,10,0,0.85)',
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 3,
                  flexShrink: 1,
                }}
                numberOfLines={1}
                ellipsizeMode="tail"
                allowFontScaling={false}
              >
                {name}
              </Text>
              {nobleRankIndex === 6 ? <KingSparkle /> : null}
            </View>
            <Text
              style={{
                color: '#FFD94D',
                fontSize: bannerW * 0.030,
                lineHeight: bannerW * 0.030 * 1.1,
                fontWeight: '700',
                fontFamily: 'serif',
                textShadowColor: 'rgba(30,10,0,0.85)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 3,
                marginTop: bannerH * 0.125,
              }}
              numberOfLines={1}
              allowFontScaling={false}
            >
              is coming...
            </Text>
          </View>
        ) : (
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
        )}
      </Animated.View>
    );
  }

  // 2026-10-15 (Sumon): PREMIUM entry for Count+ — wide banner from right,
  // DP with crown frame, name only, shimmering rank color + sparkles.
  if (isGrandEntry && theme) {
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
