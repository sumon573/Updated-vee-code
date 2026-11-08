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
 * - Preview DP/name use the LOGGED-IN user (the showcase's "M"/"Mh"
 *   was demo data).
 *
 * Purchase status (PRODUCTION, 2026-11-08 transfer): Join buys the
 * selected tier with wallet diamonds via POST /wallet/svip/purchase
 * (purchaseSvip in svipService) and grants the tier's svip_page
 * rewards on success. The waitlist is ONLY a fallback when the
 * purchase endpoint is unreachable. Never a fake purchase, never a
 * direct balance write. A tier with priceDiamonds 0 (Baron/Duke: not
 * for sale) shows no price; the waitlist CTA stays. The Join button
 * stays enabled and tappable for a waitlisted non-member (2026-11-08
 * production Join-button fix) — waitlist never disables purchase.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, Alert, Modal, useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import PremiumLoader from '@/src/components/PremiumLoader';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { useAuth } from '@/src/context/AuthContext';
import { getErrorCause } from '@/src/utils/errorDisplay';
import {
  subscribeSvip, joinSvipWaitlist, isOnSvipWaitlist, isSvipActive,
  purchaseSvip, grantSvipTierRewards, formatSvipExpiry,
  SvipState,
} from '@/src/features/svip/svipService';
import {
  subscribeSvipConfig, SvipTier,
} from '@/src/features/svip/svipConfig';
import {
  subscribeSvipPageConfig, SvipPageConfig, SvipRewardSlot,
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

function formatPrice(n: number): string {
  return n.toLocaleString('en-US');
}

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
  const [joining, setJoining] = useState(false);
  const [points, setPoints] = useState<SvipPointsState | null>(null);
  const [pointsHistory, setPointsHistory] = useState<SvipPointsHistoryEntry[]>([]);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [selectedTier, setSelectedTier] = useState(0);
  const [preview, setPreview] = useState<SvipRewardSlot | null>(null);
  const pagerRef = useRef<ScrollView | null>(null);

  const contentW = Math.max(0, winW - PAGE_PAD * 2);
  // Pager pages are full screen width (the showcase track is 500% of the
  // page); inner content is padded by PAGE_PAD.
  const pageW = winW;

  // Frame-preview popup geometry — measured from the SVIP 5 frame art.
  // The avatar must FILL the frame's inner dark disc (the visual DP
  // opening), not sit as a dot inside it. Measured 2026-11-06 (dragon
  // surge, replaces the tiger): the calm-frame opening is a wide
  // ellipse — centre-row run ~57.8-58.6% W, centre-col run only
  // ~34.6-34.9% H (hole bbox 58.6% W x 45.6-47.1% H; the dragons
  // intrude at top/bottom centre, so the hole is taller off-centre).
  // A circular avatar is limited by the vertical centre run (~35%),
  // so the avatar is 35% of the frame size (53px on a 150px frame).
  // That fills the height exactly and leaves ~12% frame-width dark
  // disc each side at mid-height (down from ~14% at 30%) — the popup
  // background is dark, so the remainder reads as the dark opening,
  // not a hole. An ellipse matching the opening (~59% W x ~35% H)
  // was REJECTED: this popup is shared by every tier's frame (the
  // slot carries no tier), so it would cover the ring art on SVIP 1
  // (~29% vertical opening) and the old tiger disc (41% W x 30% H),
  // and cover-fit in a 1.69:1 box would crop a square DP photo
  // (forehead/chin cut). The old 30% was calibrated for the tiger
  // disc (~41% W x ~30% H) — "কই ফিট হয়েছে" no longer applies.
  const previewFrameSize = Math.min(150, Math.min(winW * 0.66, 235) - 40);
  const previewAvatarSize = Math.round(previewFrameSize * 0.35);
  const previewAvatarFont = Math.round(previewAvatarSize * 0.42);

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
    const unsub = subscribeSvip(
      user.uid,
      (s) => { setSvip(s); },
      () => {},
    );
    const unsubPoints = subscribeSvipPoints(user.uid, setPoints, () => {});
    getSvipPointsHistory(user.uid).then(setPointsHistory).catch(() => {});
    return () => { unsub(); unsubPoints(); };
  }, [user?.uid]);

  const active = isSvipActive(svip);
  const activeTierNum = active && svip ? svip.tier : 0;

  // Default to the member's own tier; otherwise the first server tier.
  useEffect(() => {
    if (tiers.length === 0) return;
    if (activeTierNum && tiers.some((t) => t.tier === activeTierNum)) {
      setSelectedTier(activeTierNum);
    } else if (!selectedTier) {
      setSelectedTier(tiers[0].tier);
    }
  }, [tiers, activeTierNum]);

  const configReady = pageLoaded && tiersLoaded;

  const selectTier = (tierNum: number, animated: boolean) => {
    setSelectedTier(tierNum);
    const idx = tiers.findIndex((t) => t.tier === tierNum);
    if (idx >= 0) pagerRef.current?.scrollTo({ x: idx * pageW, animated });
  };

  const handleJoin = async () => {
    // PRODUCTION purchase (mirrors SvipMockupHost.handlePurchase):
    // purchaseSvip -> grant rewards + clear waitlist + success alert;
    // endpoint unreachable -> waitlist fallback; server rejection ->
    // error alert, no auto-retry. Waitlisted non-members can still tap
    // Join (2026-11-08 production Join-button fix).
    if (!user?.uid || joining) return;
    const buyTier = tiers.find((t) => t.tier === selectedTier) || tiers[0];
    if (!buyTier) return;
    setJoining(true);
    try {
      const res = await purchaseSvip(user.uid, buyTier.tier);
      if (res.ok) {
        // Membership refresh arrives via subscribeSvip; grant the tier's
        // svip_page rewards now (idempotent — skips already-granted).
        await grantSvipTierRewards(user.uid, res.tier, res.expiry).catch(() => {});
        setOnWaitlist(false);
        Alert.alert(
          `Welcome to ${buyTier.name}`,
          res.expiry
            ? `Your ${buyTier.name} membership is active until ${formatSvipExpiry(res.expiry)}. Your rewards have been added to your collection.`
            : `Your ${buyTier.name} membership is active. Your rewards have been added to your collection.`,
        );
      } else if (res.unavailable) {
        // Endpoint unreachable (not deployed / down): waitlist fallback only.
        await joinSvipWaitlist(user.uid);
        setOnWaitlist(true);
        Alert.alert(
          'Purchase unavailable',
          'SVIP purchase could not be reached right now. You are on the waitlist — we will notify you the moment it opens.',
        );
      } else {
        // Server reached and rejected (e.g. insufficient diamonds): show
        // the error, change nothing, no auto-retry — tap again to retry
        // (the same persisted idempotency key is reused).
        Alert.alert('Couldn\u2019t complete purchase', res.error);
      }
    } catch (e) {
      Alert.alert('Couldn\u2019t complete purchase', getErrorCause(e));
    } finally {
      setJoining(false);
    }
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
  const displayName = user?.displayName || (user?.email ? user.email.split('@')[0] : '');
  const initial = displayName ? displayName.charAt(0).toUpperCase() : '?';
  const photoUrl = user?.photoURL || '';
  const activeLabel = (page.buyBar.activeLabel || 'You are {tierName}').replace('{tierName}', tier.name);

  const renderRewardArt = (reward: SvipRewardSlot, size: number) => {
    if (reward.kind === 'frame' && reward.sprite && reward.art) {
      return (
        <SvipSpriteFrame
          artUrl={reward.art}
          size={size}
          cols={reward.sprite.cols}
          rows={reward.sprite.rows}
          frames={reward.sprite.frames}
          stepMs={reward.sprite.stepMs}
        />
      );
    }
    if ((reward.kind === 'nameplate' || reward.kind === 'frame') && reward.art) {
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
    return (
      <View style={{ flex: 1, paddingHorizontal: PAGE_PAD }}>
        {/* Hero — hidden entirely when the server supplies no hero art. */}
        {tp.heroArt ? (
          <View
            style={{
              position: 'relative',
              alignItems: 'center',
              marginTop: tp.heroMarginTopPx || 0,
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

        <View style={{ flex: 1 }} />
      </View>
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
                disabled={joining}
                style={{ borderRadius: 24, overflow: 'hidden' }}
              >
                <LinearGradient
                  colors={[theme.goldBright, theme.gold, theme.goldDeep]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ paddingVertical: 12, paddingHorizontal: 22, alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '800', color: theme.onGold }}>
                    {joining
                      ? (page.buyBar.joiningLabel || page.buyBar.ctaLabel)
                      : page.buyBar.ctaLabel}
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
                    {photoUrl ? (
                      <ExpoImage
                        source={{ uri: photoUrl }}
                        style={{ width: previewAvatarSize, height: previewAvatarSize, borderRadius: previewAvatarSize / 2 }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <View style={{
                        width: previewAvatarSize, height: previewAvatarSize, borderRadius: previewAvatarSize / 2,
                        backgroundColor: theme.gold, alignItems: 'center', justifyContent: 'center',
                      }}
                      >
                        <Text style={{ fontSize: previewAvatarFont, fontWeight: '800', color: theme.onGold }}>{initial}</Text>
                      </View>
                    )}
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
