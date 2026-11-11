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
import Svg, { Defs, RadialGradient, Stop, Rect, Path } from 'react-native-svg';
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

// 2026-11-11 (boss): SVIP tier colours — the SAME values as
// SVIP_ICON_COLORS in src/features/svip/SvipScreen.tsx (the source of
// truth, sampled from each tier's hero art). Duplicated here rather than
// imported: SvipScreen is a screen module and importing it into the
// voice-room banner would drag the whole screen in.
const SVIP_TIER_COLORS: Record<number, string> = {
  1: '#0E9F8A', 2: '#7E57C2', 3: '#A71C32', 4: '#1E5AA8', 5: '#E8B84B',
};

// 2026-11-11 (boss): per-tier SVIP entry accents — glow stops, sparkle
// colours, name-bar edge. SVIP 5 gold and SVIP 3 crimson are the two
// live entry effects (tuned, not just the anchor: 5 keeps its gold
// glow/sparkles, 3 gets a light-red -> crimson glow and red sparkles).
// Any OTHER tier has no entry effect yet and falls back to its own
// SVIP_TIER_COLORS colour (generic, not hardcoded to 3 and 5).
const SVIP_ENTRY_ACCENTS: Record<number, { glowLight: string; glowMid: string; sparkle: string; sparkleSoft: string; edge: string }> = {
  3: { glowLight: '#FF8A8A', glowMid: '#E5484D', sparkle: '#FF6B6B', sparkleSoft: '#A71C32', edge: '#A71C32' },
  5: { glowLight: '#FFE27A', glowMid: '#FFD700', sparkle: '#FFD700', sparkleSoft: '#FFE27A', edge: '#C9A227' },
};

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

// 2026-11-11 (boss, imo GIF reference): SVIP entry glow — a bright, soft
// tier-coloured radiant haze behind the art, pulsing gently like a
// breathing glow (opacity 0.75 -> 1.0 -> 0.75, 1800ms cycle). True smooth
// radial gradient via react-native-svg RadialGradient (already a
// dependency) — code-only, no asset, no media upload, no new dependency.
// Opacity-only, native driver (no heat). Unmounts with the banner.
// The glow is bright enough to read as a real halo of light (a clear
// tier-coloured glow, not a faint whisper) but fades to transparent at
// the edges so it blends with any theme and never washes out the art.
// `light`/`mid`/`base` are the gradient stops (0% / 35% / 65-100%);
// `base` is the tier's own SVIP_TIER_COLORS colour.
function EntryGlow({ size, light, mid, base }: { size: number; light: string; mid: string; base: string }) {
  const pulse = useRef(new Animated.Value(0.75)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.75, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={{ width: size, height: size, opacity: pulse, pointerEvents: 'none' }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="svipEntryGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={light} stopOpacity="0.95" />
            <Stop offset="35%" stopColor={mid} stopOpacity="0.55" />
            <Stop offset="65%" stopColor={base} stopOpacity="0.22" />
            <Stop offset="100%" stopColor={base} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#svipEntryGlow)" />
      </Svg>
    </Animated.View>
  );
}

// 2026-11-11 (boss): SVIP entry sparkle — a small twinkling 4-point star
// in the tier's accent colour around the art. Mirrors the KingSparkle pattern (same SVG star
// path, opacity twinkle, native driver) with a staggered `delay` so the
// sparkles don't all flash at once, plus a slight scale (0.85 -> 1.15) as
// it brightens. Opacity + scale (transform) only, native driver (no heat).
// Unmounts with the banner. `top`/`left` are the centre point in the
// dragon wrapper (the star is centred on them).
function EntrySparkle({ size = 12, color = '#FFD700', delay = 0, top, left }: { size?: number; color?: string; delay?: number; top: number; left: number }) {
  const tw = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(tw, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(tw, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [tw, delay]);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: top - size / 2,
        left: left - size / 2,
        opacity: tw.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }),
        transform: [{ scale: tw.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) }],
        pointerEvents: 'none',
      }}
    >
      <Svg width={size} height={size} viewBox="16 2.4 4.7 4.7" fill="none">
        <Path
          d="M18.4 2.4l.62 1.72 1.72.62-1.72.62-.62 1.72-.62-1.72-1.72-.62 1.72-.62.62-1.72Z"
          fill={color}
        />
      </Svg>
    </Animated.View>
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
  // 2026-11-11 (boss): SVIP tier — parsed from the equipped effect id
  // ('svip3-entry-effect' -> 3, 'svip5-entry-effect' -> 5). Unparsable
  // ids fall back to SVIP 5 gold (the current behaviour — safe fallback).
  const svipTierMatch = typeof activeEntryEffect === 'string' ? /^svip(\d+)/i.exec(activeEntryEffect) : null;
  const svipTier = svipTierMatch ? parseInt(svipTierMatch[1], 10) : 5;
  // Tier accent (glow / sparkles / bar edge). The glow's outer anchor is
  // always the tier's own SVIP_TIER_COLORS colour; tiers without a tuned
  // accent fall back to that colour throughout (generic).
  const svipTierColor = SVIP_TIER_COLORS[svipTier] ?? '#E8B84B';
  const svipAccent = SVIP_ENTRY_ACCENTS[svipTier] ?? { glowLight: '#FFFFFF', glowMid: svipTierColor, sparkle: svipTierColor, sparkleSoft: svipTierColor, edge: svipTierColor };
  // 2026-11-11 (boss): the "SVIP{N}" badge renders ONLY for SVIP 5 —
  // the dragon GIF has no text on it. SVIP 3's lion GIF already has
  // "SVIP3" on its base, so SVIP 3 (and any other tier) gets NO badge:
  // art -> DP + "is Coming..." bar, nothing else below the art.
  const showSvipBadge = activeEntryEffect === 'svip5-entry-effect';
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
  // 2026-11-11 (SVIP entry effect, tier-aware): the equipped SVIP effect
  // wins over the noble art branch (a user can be both King and SVIP 5 —
  // the active effect is the SVIP art). Transparent animated art on top,
  // then — SVIP 5 ONLY — a gold "SVIP5" badge (the dragon GIF has no text
  // on it; SVIP 3's lion GIF already has "SVIP3" on its base, so SVIP 3
  // gets no badge), then live DP + live name + "is Coming..." on a dark
  // navy bar with tier-coloured edges (like the imo reference — the bar
  // provides the contrast, readable on any theme). The glow, sparkles
  // and bar edge all wear the tier's accent (SVIP 5 gold, SVIP 3
  // crimson #A71C32, other tiers their SVIP_TIER_COLORS colour). The
  // rest of the banner stays transparent and blends with the room
  // background. The art is 315x311 (near-square); the whole branch
  // dismisses on the existing 3650ms timer above and unmounts with it.
  if (svipArtUrl) {
    const dragonW = Math.min(Dimensions.get('window').width * 0.86, 320);
    const dragonH = (dragonW * 311) / 315;
    const glowSize = dragonW * 1.4;
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
        {/* 2026-11-11 (boss, imo GIF reference): art + glow + sparkles.
            The wrapper is relative so the glow (behind) and sparkles
            (around, at the edges — never over the art's face) centre on
            the art. The glow is a bright radiant tier-coloured haze that
            breathes gently; the sparkles twinkle around it. The art
            stays the hero. */}
        <View style={{ width: dragonW, height: dragonH, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ position: 'absolute', left: (dragonW - glowSize) / 2, top: (dragonH - glowSize) / 2, width: glowSize, height: glowSize, pointerEvents: 'none' }}>
            <EntryGlow size={glowSize} light={svipAccent.glowLight} mid={svipAccent.glowMid} base={svipTierColor} />
          </View>
          <ExpoImage
            source={{ uri: svipArtUrl }}
            style={{ width: dragonW, height: dragonH }}
            contentFit="contain"
          />
          <EntrySparkle size={14} color={svipAccent.sparkle} delay={0} top={dragonH * 0.06} left={dragonW * 0.08} />
          <EntrySparkle size={11} color="#FFFFFF" delay={300} top={dragonH * 0.08} left={dragonW * 0.86} />
          <EntrySparkle size={12} color={svipAccent.sparkleSoft} delay={600} top={dragonH * 0.30} left={dragonW * 0.02} />
          <EntrySparkle size={16} color={svipAccent.sparkle} delay={900} top={dragonH * 0.28} left={dragonW * 0.92} />
          <EntrySparkle size={10} color="#FFFFFF" delay={1200} top={dragonH * 0.62} left={dragonW * 0.06} />
          <EntrySparkle size={13} color={svipAccent.sparkle} delay={1500} top={dragonH * 0.65} left={dragonW * 0.90} />
          <EntrySparkle size={11} color={svipAccent.sparkleSoft} delay={1800} top={dragonH * 0.88} left={dragonW * 0.78} />
        </View>
        {/* 2026-11-11 (boss): gold "SVIP5" badge in the empty space between
            the dragon and the name row — SVIP 5 ONLY (see showSvipBadge).
            Solid SVIP gold #E8B84B (theme-agnostic — reads on light and
            dark themes alike) with dark text. The white shimmer band
            sweeps across the gold pill (under the text, so the dark text
            stays readable). SVIP 3 renders NO badge here: its lion GIF
            already has "SVIP3" on its base, and the name row below sits
            close under the lion instead (marginTop 3 — the lion carries
            only 7-9px transparent padding at its bottom, PIL-measured
            over all 14 frames, so the visual gap is ~10-12dp with no
            overlap of the lion's opaque pixels on any frame).
            2026-11-11 (gap fix): the dragon art carries 24-40px transparent
            padding at its bottom (avg ~34px, measured with PIL over all 16
            frames), so the badge sat ~44dp below the dragon's real base.
            marginTop -22 pulls the badge (and the name bar below it) up
            into that transparent area: visual gap is now ~2dp on the
            tightest frame (f2, 24px pad) and ~12dp on average — tight,
            with NO overlap of the dragon's opaque pixels on any frame. */}
        {showSvipBadge ? (
        <View
          style={{
            alignSelf: 'center',
            marginTop: -22,
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
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            // SVIP 5 keeps 8 below the badge; without a badge (SVIP 3)
            // the name row sits close under the lion — marginTop 3 plus
            // the lion's ~7dp bottom transparent padding = ~10dp visual
            // gap below the lion's real base.
            marginTop: showSvipBadge ? 8 : 3,
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
          {/* 2026-11-11 (boss): name on a BANNER BAR like the imo reference —
              dark navy bar with tier-coloured edges, plain white bold text centred.
              The bar provides the contrast (readable on any theme), so the
              text halo is removed. The gold shimmer on the name text was
              caught mid-sweep as a solid yellow block (ugly) — it is gone
              entirely; the bar is static, no shimmer on it. */}
          <View
            style={{
              backgroundColor: 'rgba(10,20,45,0.88)',
              borderWidth: 1.5,
              borderColor: svipAccent.edge,
              borderRadius: 10,
              paddingHorizontal: 22,
              paddingVertical: 8,
            }}
          >
            <Text
              style={{
                color: '#FFFFFF',
                fontSize: 18,
                fontWeight: '800',
                textAlign: 'center',
              }}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {name} is Coming...
            </Text>
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
