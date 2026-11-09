/**
 * SvipScreen — Vee SVIP membership, FULLY SERVER-DRIVEN slot renderer
 * (F8, 2026-11-05, boss: "Svip পুরোটা সার্ভার এর হবে").
 *
 * The screen renders ONLY slots the server defines — it holds NO SVIP
 * content values: no tier names, prices, art URLs, reward labels or
 * preview copy. Everything comes from staging RTDB:
 *   svip_config — tiers[] (tier, name, priceDiamonds, durationDays,
 *     privileges, pointsGranted) + privileges[]
 *   svip_page   — theme, layout, topBar, buyBar, preview, and per-tier
 *     slots: heroArt, flowerArt, bannerArt, rewards[]
 * Membership state (svip/{uid}), waitlist (svipWaitlist/{uid}) and
 * SVIP points (svipPoints/{uid}) stay on their existing services.
 *
 * Design (inspection-confirmed showcase, artifact svip-page — the
 * authoritative spec): 430px-style page, no vertical scroll, top bar +
 * level tabs + swipe pager (N tiers from the server, not hardcoded
 * to 5), hero crest per tier, SVIP 5 only adds the flower flourish,
 * full-bleed banner and the 6-slot rewards grid (slots 3-6 empty
 * outlined boxes), buy bar pinned at bottom, reward preview popup.
 * SVIP 1-4 are hero-crest + blank space + buy bar ONLY — no banner,
 * no flower, no nameplate, no frame, no rewards grid.
 * A slot whose server value is missing is HIDDEN, never a broken image.
 * Server config absent/malformed = honest empty state, never demo values.
 *
 * Known visual deltas vs the web showcase (phone to confirm):
 * - Fonts: Cinzel/Manrope are not bundled in the app — display text
 *   uses the platform serif face, body text the system face.
 * - The hero feather mask (outer 8%) and the radial gold glow have no
 *   RN equivalent in the tree — the crest art backgrounds blend into
 *   the page bg (same as the previous emblem screen).
 * - The preview name's "animated gold gradient" is a static gold —
 *   the tree has no gradient-text component.
 * - Preview DP/name use the LOGGED-IN user's VEE profile (RTDB
 *   users/{uid}: name + photoURL) — NEVER Firebase Auth: auth
 *   displayName/photoURL are the Google provider values ("Md Sumon
 *   Islam" + penguin) and showed in the popup before this fix. The
 *   showcase's "M"/"Mh" was demo data; the live "Mh" is the Vee name.
 *
 * Purchase status (2026-11-09, boss order): the purchase endpoint is
 * CLOSED (403 "purchase is closed") by design — the Join/Recharge CTA
 * NEVER calls purchaseSvip. Tapping it navigates to the top-up page
 * (/profile/topup), the recharge path. The waitlist survives only as
 * the (now unreachable) fallback record; it is never written from here.
 *
 * Recharge progress (2026-11-09, boss order; redesigned the same day,
 * boss: "digital আর unique হতে হবে"): a pinned digital LED-meter bar
 * above the buy bar shows lifetime recharge progress toward the NEXT
 * tier — wallets/{uid}/totalRecharged (live subscription via
 * walletService.subscribeTotalRecharged, tx-history fallback) against
 * the server svip_config priceDiamonds thresholds. TIER-CORRECT: the
 * fill counts a granted membership (effective = max(live total, own
 * tier's threshold)), so a max-tier member always sees a FULL bar with
 * a gold MAX header — never an empty bar under "MAX" text.
 */
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, Modal, useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import PremiumLoader from '@/src/components/PremiumLoader';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { useAuth } from '@/src/context/AuthContext';
import {
  subscribeSvip, isOnSvipWaitlist, isSvipActive,
  SvipState,
} from '@/src/features/svip/svipService';
import { subscribeTotalRecharged } from '@/src/features/wallet/walletService';
import { subscribeUser, type VeeUser } from '@/src/services/userService';
import {
  subscribeSvipConfig, SvipTier,
} from '@/src/features/svip/svipConfig';
import {
  subscribeSvipPageConfig, SvipPageConfig, SvipPageTheme, SvipRewardSlot,
} from '@/src/features/svip/svipPageConfig';
import { SvipSpriteFrame } from '@/src/features/svip/SvipSpriteFrame';
import {
  subscribeSvipPoints, getSvipPointsHistory, formatPointsExpiry,
  SvipPointsState, SvipPointsHistoryEntry,
} from '@/src/features/svip/svipPointsService';

/** Loading/empty-state backdrop. Chrome only (pre-server paint), not an
 * SVIP content value — the live page background comes from the server. */
const LOADING_BG = '#130D31';
/** Showcase page padding — the banner/buy-bar -20px bleed is measured
 * against it. Geometry, not SVIP content. */
const PAGE_PAD = 20;
/** Popup gradient top stop (chrome); the bottom stop is the server theme. */
const POPUP_BG_TOP = '#1e1547';
/** SVIP 5 frame hole calibration (measured from the art, 384px cell).
 * Boss order 2026-11-08 (23:37): the frame must ALWAYS sit FITTED on top
 * of the avatar, exactly like King/Count — never a black round inside
 * the frame. FRAME_AVATAR_FRAC = avatar diameter as a fraction of the
 * frame size; FRAME_HOLE_CY = hole centre as a fraction of the frame
 * height. Hole (transparent flood fill): current art 249x202, big-hole
 * art 263x246, SAME centre (193, 181.5) in both — so this geometry is
 * safe for the art live today and the big-hole art being staged now. */
const FRAME_AVATAR_FRAC = 0.68;
const FRAME_HOLE_CY = 181.5 / 384;

/** Milestone-circle colours — one per tier, sampled from that tier's
 * own live hero art (2026-11-09): 1 teal shield/ribbon, 2 purple
 * ribbon + crown velvet (= the tier's server `color`), 3 crimson
 * ribbon + crown velvet, 4 royal-blue peacock/banner, 5 gold dragon.
 * Gold is deliberately NOT used for 3 (it appears in every tier's
 * hero) and red is NOT used for 5 (it would near-collide with 3's
 * crimson). Each circle wears its OWN tier's colour on every page. */
const SVIP_ICON_COLORS: Record<number, string> = {
  1: '#0E9F8A', 2: '#7E57C2', 3: '#A71C32', 4: '#1E5AA8', 5: '#E8B84B',
};

function formatPrice(n: number): string {
  return n.toLocaleString('en-US');
}

/** Relative luminance (0–1) of a #RRGGBB colour — picks the readable
 * number colour on a tier-coloured milestone circle (dark number on a
 * light tier colour, white on a dark one). */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Segments in the LED-meter fill (mockups: mockup-a-max / mockup-b-mid).
 * The fill is a banded gradient with hard stops — each segment wears
 * the colour of the tier whose range it sits in — over a row of dim
 * unlit segments, so the bar reads as a digital meter, never a plain
 * rounded bar. */
const BAR_SEGMENTS = 30;

type SvipJourneyBarProps = {
  totalRecharged: number;
  activeTierNum: number;
  pricedTiers: SvipTier[];
  theme: SvipPageTheme;
  contentW: number;
};

/** ── Digital LED-meter journey bar (redesign 2026-11-09, boss: "digital
 * আর unique হতে হবে"; refined 2026-11-09 — readout removed, 105dp) ──
 * TIER-CORRECT FILL (the fix for "I'm SVIP 5 but the bar doesn't show
 * it"): a granted membership counts. effectiveRecharged =
 * max(live totalRecharged, the membership tier's own threshold), and
 * the fill, the milestone circles and the remaining caption ALL read
 * from that ONE value — they can never disagree again.
 * Mh (tier 5, totalRecharged 0): max(0, 60,000) = 60,000 → 100% full,
 * all 5 nodes lit, header "SVIP 5 — MAX". A member whose live
 * recharge already passes their tier is unaffected (max is a no-op).
 * No wallet/SVIP data is written anywhere — this is display logic only.
 *
 * SLIM REFINED BAR (105dp both states, was ~148dp at MAX / ~135dp
 * non-max): the digital readout is GONE — no ghost unlit digits, no
 * live digits, no MAX badge — and MAX appears exactly ONCE, in the
 * centred header label ("SVIP 5 — MAX"; non-max "RECHARGE TO SVIP N").
 * The header label is centred on the same axis as the centred caption
 * and the symmetric track/nodes. The MAX caption is one plain line
 * ("You hold the highest SVIP tier", no "— MAX" suffix); the non-max
 * caption ("5,000 more diamonds to SVIP 4") is the only numeric
 * progress text in the bar.
 *
 * DIGITAL character: segmented banded fill + tick scale (10K/20K/30K/
 * 40K/60K) + HUD corner brackets + gold MAX treatment (gold border +
 * gold shadow at MAX). No new emoji — the old 💎/👑 caption glyphs are
 * dropped for a clean mono caption. SVIP_ICON_COLORS and the ①–⑤ nodes
 * are unchanged; each node still wears its OWN tier's colour on every
 * page.
 *
 * SMOOTH + ISOLATED: the bar is a memo'd component — it re-renders
 * only when its own props change (totalRecharged / tier / tiers /
 * theme / width), never when the rest of the page re-renders. The fill
 * itself never re-renders at all: a Reanimated shared value glides it
 * (withTiming, 650ms) on the UI thread via an overflow-hidden clip
 * whose width animates — the full-width banded gradient inside never
 * resizes, so its segment stripes stay aligned with the dim unlit
 * segments beneath. The caption text shows the new reading at once
 * while the fill glides to match; at rest they always agree. No
 * polling, no intervals, no timers, no scroll listener — the only
 * inputs are the existing live subscriptions passed in as props. */
const SvipJourneyBar = memo(function SvipJourneyBar({
  totalRecharged, activeTierNum, pricedTiers, theme, contentW,
}: SvipJourneyBarProps) {
  const topTier = pricedTiers[pricedTiers.length - 1] || null;
  const topPrice = topTier ? topTier.priceDiamonds : 0;

  // Tier-correct effective total — see the header comment above.
  const tierThreshold = pricedTiers.find((t) => t.tier === activeTierNum)?.priceDiamonds ?? 0;
  const effectiveRecharged = Math.max(totalRecharged, tierThreshold);
  const derivedLevel = pricedTiers.reduce(
    (m, t) => (effectiveRecharged >= t.priceDiamonds ? Math.max(m, t.tier) : m),
    0,
  );
  const progressLevel = Math.max(activeTierNum, derivedLevel);
  const nextTier = pricedTiers.find((t) => t.tier > progressLevel) || null;
  const isMax = nextTier === null;
  const fillPct = topPrice > 0 ? Math.min(1, Math.max(0, effectiveRecharged / topPrice)) : 0;
  const remainingToNext = nextTier ? Math.max(0, nextTier.priceDiamonds - effectiveRecharged) : 0;

  // Track geometry (dp): panel padding 11 + track inset 11, each side.
  const trackW = Math.max(0, contentW - 44);

  // Banded segmented gradient: hard stops per segment, 2dp gaps that
  // stay transparent so the dim unlit segments show through. Locations
  // are computed from the same cell/gap geometry as the unlit row, so
  // lit stripes and dim segments always line up. Falls back to a plain
  // gold gradient on absurdly narrow widths.
  const { fillColors, fillLocations } = useMemo<{
    fillColors: [string, string, ...string[]];
    fillLocations: [number, number, ...number[]];
  }>(() => {
    if (trackW < 80 || topPrice <= 0) {
      return { fillColors: [theme.goldBright, theme.goldDeep], fillLocations: [0, 1] };
    }
    const gapPx = 2;
    const cellW = (trackW - (BAR_SEGMENTS - 1) * gapPx) / BAR_SEGMENTS;
    const colors: string[] = [];
    const locations: number[] = [];
    for (let i = 0; i < BAR_SEGMENTS; i++) {
      const startPx = i * (cellW + gapPx);
      const endPx = startPx + cellW;
      const centre = ((i + 0.5) / BAR_SEGMENTS) * topPrice;
      const band = pricedTiers.find((t) => centre <= t.priceDiamonds)
        || pricedTiers[pricedTiers.length - 1];
      const c = SVIP_ICON_COLORS[band.tier] || theme.gold;
      if (i === BAR_SEGMENTS - 1) {
        colors.push(c, c);
        locations.push(startPx / trackW, 1);
      } else {
        // 0.5px epsilon keeps locations strictly increasing (a hard
        // stop with duplicate locations is undefined behaviour in some
        // gradient implementations).
        colors.push(c, c, 'transparent', 'transparent');
        locations.push(
          startPx / trackW,
          endPx / trackW,
          (endPx + 0.5) / trackW,
          (endPx + gapPx) / trackW,
        );
      }
    }
    // Both arrays always hold >= 2 entries (the fallback has 2; the
    // loop pushes >= 2 per segment) — the casts satisfy the gradient's
    // non-empty-tuple prop types.
    return {
      fillColors: colors as [string, string, ...string[]],
      fillLocations: locations as [number, number, ...number[]],
    };
  }, [pricedTiers, topPrice, trackW, theme.gold, theme.goldBright, theme.goldDeep]);

  // UI-thread glide: 0 on mount (glides up to the live value on first
  // paint), then glides to every new target. No re-render per frame.
  const fillSV = useSharedValue(0);
  const trackWSV = useSharedValue(trackW);
  useEffect(() => { trackWSV.value = trackW; }, [trackW, trackWSV]);
  useEffect(() => {
    fillSV.value = withTiming(fillPct, { duration: 650, easing: Easing.inOut(Easing.ease) });
  }, [fillPct, fillSV]);
  const clipStyle = useAnimatedStyle(() => ({ width: fillSV.value * trackWSV.value }));

  return (
    <View style={{ paddingTop: 6, paddingBottom: 6 }}>
      <View style={{
        position: 'relative',
        backgroundColor: 'rgba(8, 5, 20, 0.72)',
        borderWidth: 1,
        borderColor: isMax ? theme.goldBright : 'rgba(232, 184, 75, 0.45)',
        borderRadius: 8,
        paddingHorizontal: 11,
        paddingTop: 8,
        paddingBottom: 8,
        ...(isMax ? {
          shadowColor: '#E8B84B', shadowOpacity: 0.35, shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 }, elevation: 4,
        } : null),
      }}
      >
        {/* HUD corner brackets. */}
        <View style={{ position: 'absolute', top: -1, left: -1, width: 12, height: 12, borderTopWidth: 2, borderLeftWidth: 2, borderColor: theme.goldBright }} />
        <View style={{ position: 'absolute', top: -1, right: -1, width: 12, height: 12, borderTopWidth: 2, borderRightWidth: 2, borderColor: theme.goldBright }} />
        <View style={{ position: 'absolute', bottom: -1, left: -1, width: 12, height: 12, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: theme.goldBright }} />
        <View style={{ position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderBottomWidth: 2, borderRightWidth: 2, borderColor: theme.goldBright }} />

        {/* Header row: label alone, centred — the digital readout is gone
            (refined bar, 2026-11-09); MAX appears exactly once, here. */}
        <Text style={{
          fontFamily: 'monospace', fontSize: 10, fontWeight: '800',
          letterSpacing: 1.6, color: theme.goldBright, textAlign: 'center',
        }}
        >
          {nextTier
            ? `RECHARGE TO ${nextTier.name.toUpperCase()}`
            : `${(topTier?.name || 'SVIP 5').toUpperCase()} — MAX`}
        </Text>

        {/* Track + circled milestones — one per tier, at its threshold's
            share of the top tier's price. */}
        <View style={{ marginHorizontal: 11, height: 28, marginTop: 4, position: 'relative' }}>
          {/* Dim unlit segments (static). */}
          <View style={{
            position: 'absolute', left: 0, right: 0, top: 12, height: 6,
            flexDirection: 'row', gap: 2,
          }}
          >
            {Array.from({ length: BAR_SEGMENTS }, (_, i) => (
              <View
                key={i}
                style={{
                  flex: 1, borderRadius: 2,
                  backgroundColor: 'rgba(232, 184, 75, 0.10)',
                  borderWidth: 0.5, borderColor: 'rgba(232, 184, 75, 0.14)',
                }}
              />
            ))}
          </View>
          {/* Lit banded fill — full-width gradient inside an animated
              clip, so it glides without ever resizing (stripes stay
              aligned with the dim segments beneath). */}
          <Animated.View style={[{
            position: 'absolute', left: 0, top: 12, height: 6, overflow: 'hidden',
          }, clipStyle]}
          >
            <LinearGradient
              colors={fillColors}
              locations={fillLocations}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ width: trackW, height: 6 }}
            />
            {/* Bright leading-edge scan head. */}
            <View style={{
              position: 'absolute', right: 0, top: 0,
              width: 3, height: 6, backgroundColor: '#FFF3C4',
            }}
            />
          </Animated.View>
          {pricedTiers.map((t) => {
            const pct = topPrice > 0 ? (t.priceDiamonds / topPrice) * 100 : 0;
            const reached = effectiveRecharged >= t.priceDiamonds;
            // This circle's OWN tier colour (not the viewed page's) +
            // its readable number colour.
            const circleColor = SVIP_ICON_COLORS[t.tier] || theme.gold;
            const circleNumColor = luminance(circleColor) > 0.25 ? '#241a04' : '#FFFFFF';
            return (
              <React.Fragment key={t.tier}>
                {reached ? (
                  <View style={{
                    position: 'absolute', left: `${pct}%`, top: -1,
                    width: 30, height: 30, borderRadius: 15,
                    transform: [{ translateX: -15 }],
                    borderWidth: 1, borderColor: circleColor, opacity: 0.35,
                  }}
                  />
                ) : null}
                <View
                  style={{
                    position: 'absolute', left: `${pct}%`, top: 3,
                    width: 22, height: 22, borderRadius: 11,
                    transform: [{ translateX: -11 }],
                    backgroundColor: reached ? circleColor : 'transparent',
                    borderWidth: reached ? 1 : 1.5,
                    borderColor: circleColor,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{
                    fontSize: 12, fontWeight: '800',
                    color: reached ? circleNumColor : theme.ink,
                  }}
                  >
                    {t.tier}
                  </Text>
                </View>
              </React.Fragment>
            );
          })}
        </View>

        {/* Tick scale — threshold labels in mono. */}
        <View style={{ marginHorizontal: 11, height: 16, marginTop: 1, position: 'relative' }}>
          {pricedTiers.map((t) => {
            const pct = topPrice > 0 ? (t.priceDiamonds / topPrice) * 100 : 0;
            return (
              <React.Fragment key={t.tier}>
                <View style={{
                  position: 'absolute', left: `${pct}%`, top: 0,
                  width: 1, height: 5, marginLeft: -0.5,
                  backgroundColor: 'rgba(232, 184, 75, 0.5)',
                }}
                />
                <Text style={{
                  position: 'absolute', left: `${pct}%`, top: 6,
                  width: 40, marginLeft: -20, textAlign: 'center',
                  fontFamily: 'monospace', fontSize: 8, letterSpacing: 0.5,
                  color: theme.inkSoft,
                }}
                >
                  {`${Math.round(t.priceDiamonds / 1000)}K`}
                </Text>
              </React.Fragment>
            );
          })}
        </View>

        <Text style={{
          fontFamily: 'monospace', fontSize: 10, letterSpacing: 0.5,
          color: theme.inkSoft, textAlign: 'center', marginTop: 4,
        }}
        >
          {nextTier ? (
            <>
              <Text style={{ fontWeight: '700', color: '#FFD76A' }}>
                {formatPrice(remainingToNext)}
              </Text>
              {` more diamonds to ${nextTier.name}`}
            </>
          ) : (
            'You hold the highest SVIP tier'
          )}
        </Text>
      </View>
    </View>
  );
});

export default function SvipScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { width: winW, height: winH } = useWindowDimensions();
  const [svip, setSvip] = useState<SvipState | null>(null);
  const [page, setPage] = useState<SvipPageConfig | null>(null);
  const [tiers, setTiers] = useState<SvipTier[]>([]);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [tiersLoaded, setTiersLoaded] = useState(false);
  const [onWaitlist, setOnWaitlist] = useState(false);
  const [totalRecharged, setTotalRecharged] = useState<number | null>(null);
  const [points, setPoints] = useState<SvipPointsState | null>(null);
  const [pointsHistory, setPointsHistory] = useState<SvipPointsHistoryEntry[]>([]);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [selectedTier, setSelectedTier] = useState(0);
  const [preview, setPreview] = useState<SvipRewardSlot | null>(null);
  // Vee profile (RTDB users/{uid}) — the popup name + DP source.
  // subscribeUser also serves the cached profile instantly, then live.
  const [veeProfile, setVeeProfile] = useState<VeeUser | null>(null);
  const pagerRef = useRef<ScrollView | null>(null);

  const contentW = Math.max(0, winW - PAGE_PAD * 2);
  // Pager pages are full screen width (the showcase track is 500% of the
  // page); inner content is padded by PAGE_PAD.
  const pageW = winW;

  // Frame-preview popup geometry — King/Count standard (boss order
  // 2026-11-08, 23:37): the frame sits FITTED on top of the avatar.
  // The old geometry did the OPPOSITE: a 35%-of-frame avatar (53px on
  // a 150px frame) painted ON TOP of the frame, leaving the frame's
  // 97x79px transparent hole showing the dark popup background around
  // it — the black round in the boss's 23:36 popup / 23:35 grid shots.
  // The old 35% came from the 2026-11-06 centre-column measurement
  // (~35% H) — but the hole is an ellipse (flood fill 249x202, i.e.
  // 97x79px at 150px), so the avatar was a dot inside a much wider
  // dark disc. New geometry: avatar 68% of the frame (102px on
  // 150px) = the hole width, centred on the hole centre (2.7% of the
  // frame above the frame centre), and the frame renders AFTER the
  // avatar (on top) — the ring tucks ~3px over the avatar's edge,
  // like King (DP 80 vs 75.1px hole). Verified by simulation on both
  // the live art and the big-hole art (hole 263x246): no dark gap
  // inside the hole, dragon head + surge fully visible.
  const previewFrameSize = Math.min(150, Math.min(winW * 0.66, 235) - 40);
  const previewAvatarSize = Math.round(previewFrameSize * FRAME_AVATAR_FRAC);
  const previewAvatarDy = (0.5 - FRAME_HOLE_CY) * previewFrameSize;

  // Live server config (both nodes) — a server edit reflects without restart.
  useEffect(() => {
    const unsubPage = subscribeSvipPageConfig(
      (c) => { setPage(c); setPageLoaded(true); },
      () => setPageLoaded(true),
    );
    const unsubCfg = subscribeSvipConfig(
      ({ tiers: t }) => { setTiers(t); setTiersLoaded(true); },
      () => setTiersLoaded(true),
    );
    // Pre-existing safety net (same 8s one-shot the old screen used):
    // a hung subscription must never leave a permanent spinner.
    const timeout = setTimeout(() => { setPageLoaded(true); setTiersLoaded(true); }, 8000);
    return () => { clearTimeout(timeout); unsubPage(); unsubCfg(); };
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    isOnSvipWaitlist(user.uid).then(setOnWaitlist).catch(() => {});
    // Vee profile (RTDB users/{uid}: name + photoURL) — the SAME
    // source the home screen uses for its top-left DP. The popup name
    // + avatar MUST come from here, never from Firebase Auth: auth
    // displayName/photoURL are the Google provider values ("Md Sumon
    // Islam" + penguin) and leaked into the popup before this fix.
    const unsubProfile = subscribeUser(user.uid, setVeeProfile);
    const unsub = subscribeSvip(
      user.uid,
      (s) => { setSvip(s); },
      () => {},
    );
    const unsubPoints = subscribeSvipPoints(user.uid, setPoints, () => {});
    getSvipPointsHistory(user.uid).then(setPointsHistory).catch(() => {});
    const unsubRecharge = subscribeTotalRecharged(user.uid, setTotalRecharged);
    return () => { unsub(); unsubPoints(); unsubRecharge(); unsubProfile(); };
  }, [user?.uid]);

  const active = isSvipActive(svip);
  const activeTierNum = active && svip ? svip.tier : 0;

  // Default to the member's own tier; otherwise the first server tier.
  // The selection moves the pager too (selectTier scrolls) — the tab
  // highlight alone is not the page: without the scroll the pager
  // stays on tier 1's page while the tab says the member's tier.
  // Runs again when svip arrives after tiers (async), so the pager
  // follows the 1 → own-tier flip too.
  useEffect(() => {
    if (tiers.length === 0) return;
    if (activeTierNum && tiers.some((t) => t.tier === activeTierNum)) {
      selectTier(activeTierNum, false);
    } else if (!selectedTier) {
      selectTier(tiers[0].tier, false);
    }
  }, [tiers, activeTierNum]);

  const configReady = pageLoaded && tiersLoaded;

  // Priced tiers, memoised so the memo'd journey bar below keeps its
  // props stable — a fresh array identity every parent render would
  // defeat the memo and re-render the bar on every page tick.
  // HOOK ORDER: this useMemo MUST stay above the early returns below
  // (a hook after a conditional return changes the hook count between
  // the loading and loaded renders and crashes React).
  const pricedTiers = useMemo(() => tiers
    .filter((t) => t.priceDiamonds > 0)
    .sort((a, b) => a.tier - b.tier), [tiers]);

  const selectTier = (tierNum: number, animated: boolean) => {
    setSelectedTier(tierNum);
    const idx = tiers.findIndex((t) => t.tier === tierNum);
    if (idx >= 0) pagerRef.current?.scrollTo({ x: idx * pageW, animated });
  };

  const handleJoin = () => {
    // Boss order 2026-11-09: Recharge goes to the top-up page — the
    // recharge path. The purchase endpoint is CLOSED by design (403
    // "purchase is closed"), so purchaseSvip is NEVER called from here.
    // Button label stays server-driven (svip_page.buyBar.ctaLabel).
    router.push('/profile/topup');
  };

  if (!configReady) {
    return (
      <View style={{ flex: 1, backgroundColor: LOADING_BG, alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
      </View>
    );
  }

  // Honest empty state: no demo tiers, no demo prices, no crash.
  if (!page || tiers.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: LOADING_BG }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 50, paddingHorizontal: 16 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="chevron-left" size={28} color="#FFF" />
          </Pressable>
          <Text style={{ fontSize: 19, fontWeight: '700', color: '#FFF', marginLeft: 8 }}>
            SVIP
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#FFF', textAlign: 'center' }}>
            SVIP unavailable right now
          </Text>
          <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 8, textAlign: 'center' }}>
            Please try again later.
          </Text>
        </View>
      </View>
    );
  }

  const theme = page.theme;
  const layout = page.layout;
  const tier = tiers.find((t) => t.tier === selectedTier) || tiers[0];
  const tierPage = page.tiers[tier.tier] || {};
  const isMyTier = activeTierNum === tier.tier;
  const forSale = tier.priceDiamonds > 0;
  const heroSize = Math.min(
    layout.heroMaxPx,
    (contentW * layout.heroWidthPct) / 100,
    winH * ((winW <= 640 ? layout.heroMaxHeightSmallDvh : layout.heroMaxHeightDvh) / 100),
  );
  const flowerW = contentW * 1.08;
  const flowerH = (flowerW * 650) / 1945;
  const bannerH = (winW * 528) / 2015;
  const slotW = (contentW - layout.rewardsGapPx * (layout.rewardsCols - 1)) / layout.rewardsCols;
  const labelH = layout.rewardLabelSizePx + 6;
  const slotH = slotW + 6 + labelH;
  // Popup identity — VEE profile first (RTDB users/{uid}: name +
  // photoURL), Firebase Auth only as a last resort when NO Vee profile
  // exists at all. Auth displayName/photoURL are the Google account
  // values ("Md Sumon Islam" + penguin) and must never win over the
  // Vee profile. This also feeds the frame avatar (popup + grid),
  // which had the same Google leak.
  const displayName = veeProfile?.name
    || user?.displayName
    || (user?.email ? user.email.split('@')[0] : '');
  const initial = displayName ? displayName.charAt(0).toUpperCase() : '?';
  const photoUrl = veeProfile?.photoURL || user?.photoURL || '';
  const activeLabel = (page.buyBar.activeLabel || 'You are {tierName}').replace('{tierName}', tier.name);

  // pricedTiers lives above the early returns (see above) — a hook
  // must never sit after a conditional return.
  // Live recharge progress (fill / circles / caption) is owned
  // entirely by <SvipJourneyBar> below — it derives everything from
  // totalRecharged + the membership tier, so the four can never
  // disagree. Milestone circles each wear their OWN tier's icon colour
  // (SVIP_ICON_COLORS, sampled from that tier's hero art) on EVERY
  // page — so ①②③④⑤ are teal, purple, crimson, royal blue, gold
  // wherever the bar is shown. The per-circle colour is computed
  // inside the pricedTiers.map loop in the bar; the number inside
  // picks the readable side of that circle's own colour via luminance().

  /** Avatar disc shown UNDER a frame reward (popup + grid): the user's
   * photo, or the gold initial disc. The frame renders AFTER this (on
   * top), so the ring paints over the avatar's edge — King/Count. */
  const renderFrameAvatar = (avatarSize: number) => {
    if (photoUrl) {
      return (
        <ExpoImage
          source={{ uri: photoUrl }}
          style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      );
    }
    return (
      <View style={{
        width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2,
        backgroundColor: theme.gold, alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontSize: Math.round(avatarSize * 0.42), fontWeight: '800', color: theme.onGold }}>{initial}</Text>
      </View>
    );
  };

  const renderRewardArt = (reward: SvipRewardSlot, size: number) => {
    if (reward.kind === 'frame' && reward.art) {
      // Frame on the avatar (boss order 2026-11-08): avatar FIRST
      // (under), frame AFTER (on top). Avatar fills the hole (68% of
      // the frame, centred on the hole centre); the ring covers its
      // edge. A bare frame on the dark page shows its transparent hole
      // as a black round — that is what the grid showed before this fix.
      const avatarSize = Math.round(size * FRAME_AVATAR_FRAC);
      const avatarDy = (0.5 - FRAME_HOLE_CY) * size;
      const frameArt = reward.sprite ? (
        <SvipSpriteFrame
          artUrl={reward.art}
          size={size}
          cols={reward.sprite.cols}
          rows={reward.sprite.rows}
          frames={reward.sprite.frames}
          stepMs={reward.sprite.stepMs}
        />
      ) : (
        <ExpoImage
          source={{ uri: reward.art }}
          style={{ width: size, height: size }}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      );
      return (
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ transform: [{ translateY: -avatarDy }] }}>
            {renderFrameAvatar(avatarSize)}
          </View>
          <View style={{ position: 'absolute', left: 0, top: 0 }}>
            {frameArt}
          </View>
        </View>
      );
    }
    if (reward.kind === 'nameplate' && reward.art) {
      return (
        <ExpoImage
          source={{ uri: reward.art }}
          style={{ width: size, height: size }}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      );
    }
    if (reward.kind === 'badge' && reward.art) {
      // Badge art renders exactly like a nameplate (plain contain image).
      // Stars are NOT rendered on the SVIP page (no reward shows stars
      // there); stars show in Decoration/Honor via the grant's stars field.
      return (
        <ExpoImage
          source={{ uri: reward.art }}
          style={{ width: size, height: size }}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      );
    }
    return null;
  };

  const renderTierPage = (t: SvipTier) => {
    const tp = page.tiers[t.tier] || {};
    const rewards = tp.rewards || [];
    const slots: (SvipRewardSlot | null)[] = [];
    for (let i = 1; i <= layout.rewardsSlots; i++) {
      slots.push(rewards.find((r) => r.slot === i) || null);
    }
    // Vertical scroll per tier page (boss 2026-11-09: the tall pages —
    // hero + banner + rewards on every tier now — clipped the bottom
    // of the page behind the buy bar). The pager stays horizontal;
    // the inner scroll only moves vertically (nestedScrollEnabled).
    return (
      <ScrollView
        style={{ flex: 1 }}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: PAGE_PAD, paddingBottom: 16, flexGrow: 1 }}
      >
        {/* Hero — hidden entirely when the server supplies no hero art. */}
        {tp.heroArt ? (
          <View
            style={{
              position: 'relative',
              alignItems: 'center',
              // Negative top margin would pull the hero above the page
              // top and clip it — the SVIP 5 crown tip was cut by the
              // server's heroMarginTopPx -30 (quality gate 2026-11-09).
              // The hero is the page's first child, so only >= 0 can
              // ever render; positive margins still work as before.
              marginTop: Math.max(0, tp.heroMarginTopPx || 0),
              height: heroSize,
            }}
          >
            {tp.flowerArt ? (
              <ExpoImage
                source={{ uri: tp.flowerArt }}
                style={{
                  position: 'absolute',
                  width: flowerW,
                  height: flowerH,
                  left: (contentW - flowerW) / 2,
                  top: (heroSize - flowerH) / 2,
                  zIndex: 0,
                }}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            ) : null}
            <ExpoImage
              source={{ uri: tp.heroArt }}
              style={{ width: heroSize, height: heroSize, zIndex: 1 }}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          </View>
        ) : null}

        {/* Banner — SVIP 5 slot only (server supplies it for no other tier). */}
        {tp.bannerArt ? (
          <ExpoImage
            source={{ uri: tp.bannerArt }}
            style={{
              width: winW,
              height: bannerH,
              marginTop: 4,
              marginHorizontal: -PAGE_PAD,
            }}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : null}

        {/* Rewards grid — rendered only when the server defines rewards. */}
        {tp.rewards && tp.rewards.length > 0 ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: layout.rewardsGapPx,
              marginTop: 16,
            }}
          >
            {slots.map((reward, i) => {
              const filled = !!reward && reward.kind !== 'empty';
              const key = `slot-${i + 1}`;
              const inner = filled && reward ? (
                <Pressable onPress={() => setPreview(reward)} style={{ width: slotW, height: slotH }}>
                  {renderRewardArt(reward, slotW)}
                  {reward.label ? (
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: layout.rewardLabelSizePx,
                        fontWeight: '600',
                        color: theme.labelGold,
                        textAlign: 'center',
                        marginTop: 6,
                      }}
                    >
                      {reward.label}
                    </Text>
                  ) : null}
                </Pressable>
              ) : (
                <View
                  style={{
                    width: slotW,
                    height: slotH,
                    borderWidth: 1,
                    borderColor: theme.line,
                    borderRadius: layout.radiusSlot,
                  }}
                />
              );
              return <View key={key}>{inner}</View>;
            })}
          </View>
        ) : null}

        {/* SVIP Points — active members only (existing functionality,
            kept in the blank middle space; collapsed to one line, tap
            to expand the recent history). */}
        {active && points ? (
          <Pressable
            onPress={() => setPointsOpen(!pointsOpen)}
            style={{ marginTop: 12, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 13, color: theme.inkSoft }}>
              {'⭐ '}{points.balance} SVIP Points • {formatPointsExpiry(points.expiresAt)}
            </Text>
            {pointsOpen && pointsHistory.length > 0 ? (
              <View style={{ marginTop: 8, width: '100%' }}>
                {pointsHistory.slice(0, 5).map((h, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                    <Text style={{ fontSize: 13, color: theme.inkSoft }} numberOfLines={1}>
                      {h.reason}
                    </Text>
                    <Text style={{
                      fontSize: 13,
                      fontWeight: '600',
                      color: h.amount >= 0 ? '#81C784' : '#EF9A9A',
                    }}
                    >
                      {h.amount >= 0 ? '+' : ''}{h.amount}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Pressable>
        ) : null}

        {/* The live recharge journey bar moved out of the tier page —
            it is pinned above the buy bar (see the main return), so it
            is visible on EVERY tier page and its caption can never be
            clipped behind the buy bar. */}

        <View style={{ flex: 1 }} />
      </ScrollView>
    );
  };

  const previewTitle = preview
    ? (preview.kind === 'frame'
      ? (page.preview?.frameTitle || preview.label || '')
      : (page.preview?.nameplateTitle || preview.label || ''))
    : '';
  const previewDesc = preview
    ? (preview.kind === 'frame'
      ? (page.preview?.frameDescription || '')
      : (page.preview?.nameplateDescription || ''))
    : '';

  return (
    <View style={{ flex: 1, backgroundColor: theme.pageBg }}>
      <LinearGradient
        colors={[theme.pageBg, theme.pageBgDeep]}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, paddingHorizontal: PAGE_PAD }}>
          {/* Top bar */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            height: layout.topBarHeight, paddingTop: 12,
          }}
          >
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Feather name="chevron-left" size={28} color={theme.ink} />
            </Pressable>
            <Text style={{
              flex: 1, textAlign: 'center', fontFamily: 'serif',
              fontSize: layout.titleSize, fontWeight: '700',
              color: theme.ink, letterSpacing: 2.7,
            }}
            >
              {page.topBar.title}
            </Text>
            <View style={{ width: 28 }} />
          </View>

          {/* Level tabs — one per server tier (N tiers, not hardcoded to 5). */}
          <View style={{ flexDirection: 'row', paddingTop: 4, borderBottomWidth: 1, borderBottomColor: theme.line }}>
            {tiers.map((t) => {
              const sel = t.tier === tier.tier;
              return (
                <Pressable
                  key={t.tier}
                  onPress={() => selectTier(t.tier, true)}
                  style={{ flex: 1, alignItems: 'center', paddingBottom: 10 }}
                >
                  <Text style={{
                    fontSize: layout.tabSize, fontWeight: '800',
                    color: sel ? theme.goldBright : theme.inkSoft,
                  }}
                  >
                    {t.name}
                  </Text>
                  {sel ? (
                    <View style={{
                      marginTop: 8, height: layout.tabUnderlineH, width: layout.tabUnderlineW,
                      borderRadius: 2, backgroundColor: theme.gold,
                    }}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {/* Pager — swipe left/right; each page is one server tier. */}
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            bounces={false}
            style={{ flex: 1, marginHorizontal: -PAGE_PAD }}
            onLayout={() => {
              // Mount/rotation fallback for the default selection: the
              // effect scrolls the pager, but if the pager mounted
              // AFTER the selection was already made (page config
              // arriving after tiers), the effect never re-runs — the
              // layout pass re-asserts the selected page. Same target,
              // same non-animated scroll; never fires on swipe/scroll.
              const idx = tiers.findIndex((t) => t.tier === selectedTier);
              if (idx >= 0) pagerRef.current?.scrollTo({ x: idx * pageW, animated: false });
            }}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / pageW);
              const t = tiers[idx];
              if (t && t.tier !== selectedTier) setSelectedTier(t.tier);
            }}
          >
            {tiers.map((t) => (
              <View key={t.tier} style={{ width: pageW }}>
                {renderTierPage(t)}
              </View>
            ))}
          </ScrollView>

          {/* ── Live recharge journey — pinned above the buy bar ──
              Boss 2026-11-09: visible on EVERY tier page. Digital
              LED-meter redesign (same date, boss: "digital আর unique
              হতে হবে"): segmented banded fill, tick scale,
              HUD brackets, gold MAX treatment — see <SvipJourneyBar>
              above for the tier-correct fill rule, the glide and the
              isolation. Shown once the live total has arrived (null =
              still loading, never a misleading 0). */}
          {totalRecharged !== null && pricedTiers.length > 0 ? (
            <SvipJourneyBar
              totalRecharged={totalRecharged}
              activeTierNum={activeTierNum}
              pricedTiers={pricedTiers}
              theme={theme}
              contentW={contentW}
            />
          ) : null}

          {/* Buy bar — identical on every page, pinned at the bottom.
              Full-bleed border via the -20px margins (showcase CSS);
              content stays inset by the page padding (the quoted
              "padding 14px 0 2px" would put the price/pill on the raw
              screen edge — the previous boss-approved screen inset it
              by 20px, kept here; phone check item). */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            marginHorizontal: -PAGE_PAD, paddingHorizontal: PAGE_PAD,
            paddingTop: layout.buyBarPadTopPx, paddingBottom: 2,
            borderTopWidth: 1, borderTopColor: theme.line,
          }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {forSale ? (
                <>
                  <DiamondIcon size={26} />
                  <Text style={{ fontFamily: 'serif', fontSize: 23, fontWeight: '800', color: theme.goldBright }}>
                    {formatPrice(tier.priceDiamonds)}
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: theme.inkFaint }}>
                    {page.buyBar.priceSuffix}
                  </Text>
                </>
              ) : null}
            </View>
            {isMyTier ? (
              <Text style={{ fontSize: 15, fontWeight: '700', color: theme.goldBright }}>
                {activeLabel}
              </Text>
            ) : (
              <Pressable
                onPress={handleJoin}
                style={{ borderRadius: 24, overflow: 'hidden' }}
              >
                <LinearGradient
                  colors={[theme.goldBright, theme.gold, theme.goldDeep]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ paddingVertical: 12, paddingHorizontal: 22, alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '800', color: theme.onGold }}>
                    {page.buyBar.ctaLabel}
                  </Text>
                </LinearGradient>
              </Pressable>
            )}
          </View>
        </View>
      </LinearGradient>

      {/* Reward preview popup */}
      <Modal
        transparent
        visible={preview !== null}
        animationType="fade"
        onRequestClose={() => setPreview(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}
          onPress={() => setPreview(null)}
        >
          <Pressable onPress={() => {}} style={{ width: Math.min(winW * 0.66, 235) }}>
            <LinearGradient
              colors={[POPUP_BG_TOP, theme.pageBgDeep]}
              start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
              style={{
                borderWidth: 1, borderColor: theme.line,
                borderRadius: layout.radiusTile, padding: 16,
              }}
            >
              <View style={{ alignItems: 'flex-end' }}>
                <Pressable onPress={() => setPreview(null)} hitSlop={10}>
                  <Feather name="x" size={20} color={theme.inkSoft} />
                </Pressable>
              </View>

              {preview?.kind === 'frame' ? (
                <View style={{ alignItems: 'center', marginTop: 4 }}>
                  <View style={{ width: previewFrameSize, height: previewFrameSize, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ transform: [{ translateY: -previewAvatarDy }] }}>
                      {renderFrameAvatar(previewAvatarSize)}
                    </View>
                    {preview.art && preview.sprite ? (
                      <View style={{ position: 'absolute', left: 0, top: 0 }}>
                        <SvipSpriteFrame
                          artUrl={preview.art}
                          size={previewFrameSize}
                          cols={preview.sprite.cols}
                          rows={preview.sprite.rows}
                          frames={preview.sprite.frames}
                          stepMs={preview.sprite.stepMs}
                        />
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : (
                <View style={{ alignItems: 'center', marginTop: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {photoUrl ? (
                      <ExpoImage
                        source={{ uri: photoUrl }}
                        style={{ width: 40, height: 40, borderRadius: 20 }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <LinearGradient
                        colors={[theme.goldBright, theme.goldDeep]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text style={{ fontSize: 18, fontWeight: '800', color: theme.onGold }}>{initial}</Text>
                      </LinearGradient>
                    )}
                    <Text style={{ fontSize: 14, fontWeight: '700', color: theme.goldBright }}>
                      {displayName}
                    </Text>
                  </View>
                  {preview?.art ? (
                    <View style={{
                      marginTop: 12, width: '100%', backgroundColor: '#FFFFFF',
                      borderRadius: layout.radiusSlot, padding: 8,
                    }}
                    >
                      <ExpoImage
                        source={{ uri: preview.art }}
                        style={{
                          width: '100%',
                          height: preview.artW && preview.artH
                            ? ((Math.min(winW * 0.66, 235) - 32 - 16) * preview.artH) / preview.artW
                            : 60,
                        }}
                        contentFit="contain"
                        cachePolicy="memory-disk"
                      />
                    </View>
                  ) : null}
                </View>
              )}

              <Text style={{ fontSize: 16, fontWeight: '800', color: theme.ink, marginTop: 14, textAlign: 'center' }}>
                {previewTitle}
              </Text>
              {previewDesc ? (
                <Text style={{ fontSize: 13, color: theme.inkSoft, marginTop: 8, textAlign: 'center', lineHeight: 19 }}>
                  {previewDesc}
                </Text>
              ) : null}
            </LinearGradient>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
