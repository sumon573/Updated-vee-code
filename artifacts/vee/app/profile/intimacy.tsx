/**
 * Profile — Intimacy Detail Screen (rewritten 2026-11-01, boss Couple spec).
 *
 * Tabs: Couple (default) | Friend | Intimacy.
 *
 * CACHED-FIRST: the page renders immediately with defaults — NO loading
 * gate, NO blocking spinner, NO timers. Live subscriptions update the
 * content in place when data arrives; missing data renders as the
 * unpaired / empty state, never as a spinner. All subscriptions are
 * event-driven (no polling), and the art is static premium image art
 * (no animation loops) — the page stays smooth and heat-safe.
 *
 * COUPLE MODEL (boss spec 2026-11-01 — replaces the old 5000-diamond /
 * 10-hearts-level model):
 *   - Couple tab: trio header (self + crystal motif + partner slot),
 *     Overall Intimacy Level + roadmap progress, Level-Up Costs
 *     (Lv2 2000, Lv3 3500, Lv4 5000, Lv5 7000 Max), Level-Up Progress &
 *     Reward Roadmap (one house image per level + Claim buttons),
 *     Privilege Showcase (Lv.1-2) + High Level Privileges (Lv.3-5) with
 *     one frame + one entry-effect preview per level, the detailed
 *     reward list in Bengali (verbatim), and a Buy Diamonds pill.
 *   - A couple request costs 1200 diamonds; on accept the couple starts
 *     at Level 1; upgrades are diamond purchases per level.
 *   - Intimacy tab: trio header (self + ring motif + partner slot),
 *     Love House (locked until a couple is formed), the hearts meter
 *     (Lv.1 0 ~ 4,000 for a fresh couple), privileges + Grab the Top.
 *   - Friend tab: unchanged — explicit friends ranked by intimacy value.
 *
 * MONEY: upgrade charges go through chargeCoupleDiamonds() (the ONE
 * money entry point, currently awaiting a wallet-service endpoint — see
 * couplePayment.ts). Nothing here writes wallet balances. The request
 * charge keeps the pre-existing inviteService path (price default now
 * 1200); see the report for the unification open item.
 *
 * Other users' pages are view-only: no + button, no invite/upgrade/claim
 * actions. All user-visible strings go through t() with an English
 * defaultValue, EXCEPT the boss-supplied Bengali reward list, which is
 * kept verbatim (English UI law + boss's own words).
 */

import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, type VeeUser } from '@/src/services/userService';
import {
  subscribeMyIntimacies,
  fetchPeerProfile,
  type IntimacyEntry } from '@/src/features/voice-room/services/intimacyService';
import {
  subscribeCoupleState,
  subscribeCoupleLevels,
  coupleLevelFor,
  coupleLevelProgress,
  coupleLevelRangeText,
  formatCoupleLevel,
  formatHearts,
  DEFAULT_COUPLE_LEVELS,
  type CoupleLevel,
  type CoupleState } from '@/src/features/intimacy/coupleLevels';
import {
  subscribeUserFriends, MAX_FRIENDS,
  type FriendEntry } from '@/src/features/intimacy/friendService';
import { subscribeLevel } from '@/src/services/levelService';
import { getErrorCause } from '@/src/utils/errorDisplay';
import {
  FriendRow,
  RowPhoto } from '@/src/features/intimacy/IntimacyTiles';
import {
  subscribeCouplePaidLevel,
  subscribeCoupleClaims,
  setCouplePaidLevel,
  claimCoupleLevelReward,
  COUPLE_UPGRADE_COSTS,
  COUPLE_PAID_LEVELS,
  COUPLE_PAID_REWARDS_BN,
  COUPLE_REQUEST_PRICE,
  formatPaidLevel,
  paidLevelProgress } from '@/src/features/intimacy/couplePaidLevels';
import {
  chargeCoupleDiamonds,
  CouplePaymentUnavailable } from '@/src/features/intimacy/couplePayment';
import {
  CoupleFrameArt,
  CoupleEntryEffectPreview,
  CoupleHouseArt,
  CrystalMotif,
  RingMotif,
  LoveHouseArt } from '@/src/features/intimacy/CoupleLevelArt';
import { DiamondIcon } from '@/src/components/DiamondIcon';

const C = {
  bg: '#F4F5F5',
  card: '#FFFFFF',
  tile: '#F4F5F5',
  text: '#25292D',
  muted: '#788187',
  mutedLight: '#C7C7CC',
  border: '#F0F1F2',
  blue: '#007AFF',
  blueLight: '#E3F2FD',
  pink: '#EC4899',
  pinkDark: '#BE185D',
  pinkTile: '#FFF5F7',
  pinkBorder: '#F472B6',
  pinkBar: '#FBCFE8',
  goldBg: '#FFF8E6',
  goldBorder: '#F5D67B',
  goldText: '#B8860B' } as const;

const cardStyle = { backgroundColor: C.card, marginHorizontal: 15, marginTop: 12, borderRadius: 12 } as const;

function TitleBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={{ height: 56, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
      <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
        <Feather name="chevron-left" size={24} color={C.text} />
      </Pressable>
      <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>
        {title}
      </Text>
      {right ?? <View style={{ width: 40 }} />}
    </View>
  );
}

type Tab = 'couple' | 'friend' | 'intimacy';

function TabsRow({ tab, setTab, friendCount, variant }: {
  tab: Tab;
  setTab: (t: Tab) => void;
  friendCount: number;
  variant: 'plain' | 'onPink';
}) {
  const { t } = useTranslation();
  const tabs: { key: Tab; label: string }[] = [
    { key: 'couple', label: t('profile.intimacyTabCouple', { defaultValue: 'Couple' }) },
    { key: 'friend', label: `${t('profile.intimacyTabFriend', { defaultValue: 'Friend' })} ${friendCount}` },
    { key: 'intimacy', label: t('profile.intimacyTabIntimacy', { defaultValue: 'Intimacy' }) },
  ];
  const onPink = variant === 'onPink';
  return (
    <View style={{ flexDirection: 'row', backgroundColor: onPink ? 'transparent' : C.card, marginTop: onPink ? 4 : 12 }}>
      {tabs.map((tb) => {
        const active = tab === tb.key;
        return (
          <Pressable
            key={tb.key}
            onPress={() => setTab(tb.key)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}
          >
            <Text style={{
              fontSize: 15, fontWeight: active ? '700' : '500',
              color: active ? (onPink ? '#FFFFFF' : C.blue) : (onPink ? 'rgba(255,255,255,0.75)' : C.muted) }}>
              {tb.label}
            </Text>
            <View style={{
              height: 3, width: 40, borderRadius: 2, marginTop: 6,
              backgroundColor: active ? (onPink ? '#FFFFFF' : C.blue) : 'transparent' }} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Friend row with the friend's own user total level as the blue pill. */
function FriendRowWithLevel({ friendUid, pairValue, peer, onPress }: {
  friendUid: string;
  pairValue?: number;
  peer: { name: string; photoURL: string | null } | undefined;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const [totalLevel, setTotalLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!friendUid) return;
    return subscribeLevel(friendUid, (l) => setTotalLevel(l.totalLevel));
  }, [friendUid]);
  const value = pairValue ?? 0;
  const name = peer?.name || t('profile.intimacyUser', { defaultValue: 'User' });
  const redLabel = formatCoupleLevel(coupleLevelFor(value));
  const blueLabel = totalLevel === null
    ? null
    : totalLevel >= 49
      ? t('profile.intimacyLevelMax', { defaultValue: 'Lv Max' })
      : `${t('profile.intimacyLevelShort', { defaultValue: 'Lv.' })}${totalLevel}`;
  return (
    <FriendRow
      photoURL={peer?.photoURL ?? null}
      name={name}
      redLabel={redLabel}
      blueLabel={blueLabel}
      pointsText={`${formatHearts(value)} ${t('profile.intimacyHearts', { defaultValue: 'hearts' })}`}
      onPress={onPress}
    />
  );
}

/**
 * Trio header row: self (left), center motif, partner slot (right).
 * Partner slot rules: coupled → partner photo + name + level pill;
 * unpaired + own page → + button + "Empty" + Lv.0 pill; unpaired +
 * other page → state only, no action.
 */
function TrioRow({ ownPhotoURL, displayName, partner, isOwn, onInvite, onPartnerPress, center, levelPill }: {
  ownPhotoURL: string | null;
  displayName: string;
  partner: { photoURL: string | null; name: string } | null;
  isOwn: boolean;
  onInvite: () => void;
  onPartnerPress: () => void;
  center: React.ReactNode;
  levelPill: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18 }}>
      <View style={{ width: 88, alignItems: 'center' }}>
        <RowPhoto photoURL={ownPhotoURL} name={displayName} size={56} />
        <Text style={{ fontSize: 14, fontWeight: '700', color: C.text, marginTop: 8, textAlign: 'center' }} numberOfLines={1}>
          {displayName}
        </Text>
      </View>
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 2 }}>
        {center}
      </View>
      <View style={{ width: 88, alignItems: 'center' }}>
        {partner ? (
          <Pressable onPress={onPartnerPress} style={{ alignItems: 'center' }}>
            <RowPhoto photoURL={partner.photoURL} name={partner.name} size={56} />
            <Text style={{ fontSize: 14, fontWeight: '700', color: C.text, marginTop: 8, textAlign: 'center' }} numberOfLines={1}>
              {partner.name || t('profile.intimacyPartner', { defaultValue: 'Partner' })}
            </Text>
            <View style={{ backgroundColor: C.pink, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>{levelPill}</Text>
            </View>
          </Pressable>
        ) : isOwn ? (
          <Pressable onPress={onInvite} style={{ alignItems: 'center' }} hitSlop={8}>
            <View
              style={{
                width: 56, height: 56, borderRadius: 28, borderWidth: 2,
                borderColor: C.pinkBorder, backgroundColor: C.pinkTile,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 30, fontWeight: '300', color: C.pink, lineHeight: 34 }}>+</Text>
            </View>
            <View style={{ backgroundColor: C.pink, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 8 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>Lv.0</Text>
            </View>
            <Text style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
              {t('profile.intimacyEmpty', { defaultValue: 'Empty' })}
            </Text>
          </Pressable>
        ) : (
          <View style={{ alignItems: 'center' }}>
            <View
              style={{
                width: 56, height: 56, borderRadius: 28, borderWidth: 2,
                borderColor: C.pinkBorder, backgroundColor: C.pinkTile,
                alignItems: 'center', justifyContent: 'center',
              }}
            />
            <Text style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>
              {t('profile.intimacyEmpty', { defaultValue: 'Empty' })}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** Small silhouette disc used inside frame previews. */
function Silhouette({ size }: { size: number }) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Feather name="user" size={size * 0.5} color="#9CA3AF" />
    </View>
  );
}

export default function IntimacyScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ uid?: string; tab?: string }>();
  const viewUid = typeof params.uid === 'string' && params.uid ? params.uid : user?.uid;
  const isOwn = !!user?.uid && viewUid === user.uid;
  const initialTab: Tab =
    params.tab === 'friend' || params.tab === 'intimacy' ? params.tab : 'couple';

  // Defaults render immediately; subscriptions update in place (no spinner).
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [entries, setEntries] = useState<IntimacyEntry[]>([]);
  const [couple, setCouple] = useState<CoupleState | null>(null);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [coupleLevels, setCoupleLevels] = useState<CoupleLevel[]>(DEFAULT_COUPLE_LEVELS);
  const [peers, setPeers] = useState<Record<string, { name: string; photoURL: string | null }>>({});
  const [tab, setTab] = useState<Tab>(initialTab);
  const [error, setError] = useState<string | null>(null);
  const [paidLevel, setPaidLevel] = useState(1);
  const [claims, setClaims] = useState<Set<number>>(new Set());
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    if (!viewUid) return;
    setError(null);
    const loadError = t('profile.intimacyLoadError', { defaultValue: 'Could not load intimacy.' });
    let unsubIntimacy: () => void = () => {};
    let unsubCouple: () => void = () => {};
    let unsubFriends: () => void = () => {};
    let unsubLevels: () => void = () => {};
    const unsubProfile = subscribeUser(viewUid, (u) => setProfile(u));
    try { unsubIntimacy = subscribeMyIntimacies(viewUid, (e) => setEntries(e)); } catch (e) { setError(`${loadError} ${getErrorCause(e)}`); }
    try { unsubCouple = subscribeCoupleState(viewUid, (s) => setCouple(s)); } catch (e) { setError(`${loadError} ${getErrorCause(e)}`); }
    try { unsubFriends = subscribeUserFriends(viewUid, (f) => setFriends(f)); } catch (e) { setError(`${loadError} ${getErrorCause(e)}`); }
    try { unsubLevels = subscribeCoupleLevels((l) => setCoupleLevels(l)); } catch { /* defaults stay */ }
    return () => {
      unsubProfile();
      unsubIntimacy();
      unsubCouple();
      unsubFriends();
      unsubLevels();
    };
  }, [viewUid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Paid level + roadmap claims follow the couple pointer.
  useEffect(() => {
    const pairKey = couple?.pairKey ?? null;
    if (!pairKey) {
      setPaidLevel(1);
      setClaims(new Set());
      return;
    }
    const u1 = subscribeCouplePaidLevel(pairKey, (l) => setPaidLevel(l));
    const u2 = subscribeCoupleClaims(pairKey, (c) => setClaims(c));
    return () => { u1(); u2(); };
  }, [couple?.pairKey]);

  // Peer names/photos for friends + partner (best-effort, cached in state).
  useEffect(() => {
    const uids = new Set<string>();
    for (const e of entries) uids.add(e.otherUid);
    for (const f of friends) uids.add(f.uid);
    if (couple?.partnerUid) uids.add(couple.partnerUid);
    const missing = [...uids].filter((u) => u && !peers[u]);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, { name: string; photoURL: string | null }> = {};
      for (const uid of missing) {
        try {
          next[uid] = await fetchPeerProfile(uid);
        } catch {
          next[uid] = { name: '', photoURL: null };
        }
      }
      if (!cancelled) setPeers((prev) => ({ ...prev, ...next }));
    })();
    return () => { cancelled = true; };
  }, [entries, friends, couple?.partnerUid]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayName =
    profile?.name ||
    (profile?.email ? profile.email.split('@')[0] : null) ||
    t('profile.intimacyUser', { defaultValue: 'User' });
  const ownPhotoURL = profile?.photoURL || null;

  const isCoupled = !!couple;
  const partnerPeer = couple?.partnerUid ? peers[couple.partnerUid] : undefined;
  const partnerName = partnerPeer?.name || '';
  const partnerPhotoURL = partnerPeer?.photoURL ?? null;
  const partner = couple?.partnerUid
    ? { photoURL: partnerPhotoURL, name: partnerName }
    : null;

  // Hearts meter (Intimacy tab): the hearts curve, NOT the paid levels.
  const hearts = couple?.hearts ?? 0;
  const heartsLevel = useMemo(
    () => coupleLevelFor(hearts, coupleLevels),
    [hearts, coupleLevels],
  );
  const heartsProgress = useMemo(
    () => coupleLevelProgress(hearts, coupleLevels),
    [hearts, coupleLevels],
  );
  const nextHeartsLevel = useMemo(() => {
    const sorted = [...coupleLevels].sort((a, b) => a.min - b.min);
    const idx = sorted.findIndex((l) => l.id === heartsLevel.id);
    return idx >= 0 && idx + 1 < sorted.length ? sorted[idx + 1] : null;
  }, [coupleLevels, heartsLevel]);

  // Paid roadmap (Couple tab).
  const roadmapProgress = paidLevelProgress(paidLevel);
  const nextPaidLevel = paidLevel < 5 ? paidLevel + 1 : null;
  const nextCost = nextPaidLevel ? COUPLE_UPGRADE_COSTS[nextPaidLevel] : null;

  const showAbout = () => {
    Alert.alert(
      t('profile.intimacyAboutTitle', { defaultValue: 'About Intimacy' }),
      t('profile.intimacyAboutBody', {
        defaultValue: `Intimacy grows when you send gifts to a friend — higher intimacy means a higher level. A couple is one partner: form a couple to unlock the Love House. A couple invitation costs ${COUPLE_REQUEST_PRICE} diamonds, is never refunded, and expires 5 hours after sending. On accept, the couple starts at Level 1; higher levels are diamond upgrades (Lv.2 2000, Lv.3 3500, Lv.4 5000, Lv.5 7000). Each level grants its own profile frame and entry effect. Friends are people you explicitly add (up to 5); a friend invitation is free and never expires.`,
      }),
    );
  };

  const goFriendProfile = (uid: string, name: string) => {
    router.push({ pathname: '/user-profile', params: { uid, name } } as Parameters<typeof router.push>[0]);
  };

  const goCoupleInvite = () => {
    router.push('/profile/couple-invite' as never);
  };

  const goFriendInvite = () => {
    router.push('/profile/friend-invite' as never);
  };

  const goTopup = () => {
    router.push('/profile/topup' as never);
  };

  const onUpgrade = () => {
    if (!user?.uid || !couple?.pairKey || !nextPaidLevel || nextCost === undefined || nextCost === null) return;
    setUpgrading(true);
    void (async () => {
      try {
        await chargeCoupleDiamonds({
          uid: user.uid,
          pairKey: couple.pairKey,
          level: nextPaidLevel,
          amount: nextCost,
          idempotencyKey: `${couple.pairKey}:${nextPaidLevel}`,
        });
        // Only reached once the wallet endpoint exists: record the level.
        await setCouplePaidLevel(couple.pairKey, nextPaidLevel);
      } catch (e) {
        if (e instanceof CouplePaymentUnavailable) {
          Alert.alert(
            t('couple.upgradeUnavailableTitle', { defaultValue: 'Upgrade not available yet' }),
            t('couple.upgradeUnavailableBody', { defaultValue: 'Couple upgrades need a wallet update first. Please try again later.' }),
          );
        } else {
          Alert.alert(
            t('couple.upgradeFailedTitle', { defaultValue: 'Upgrade failed' }),
            getErrorCause(e),
          );
        }
      } finally {
        setUpgrading(false);
      }
    })();
  };

  const onClaim = (level: number) => {
    if (!couple?.pairKey) return;
    void claimCoupleLevelReward(couple.pairKey, level).catch((e) => {
      setError(`${t('profile.intimacyClaimError', { defaultValue: 'Could not claim the reward.' })} ${getErrorCause(e)}`);
    });
  };

  const noFriends = friends.length === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar
        title={t('profile.intimacy', { defaultValue: 'Intimacy' })}
        right={
          <Pressable onPress={showAbout} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
            <Feather name="more-horizontal" size={22} color={C.text} />
          </Pressable>
        }
      />

      {error && (
        <View style={{ backgroundColor: '#FDECEA', paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ fontSize: 12, color: '#B3261E' }}>{error}</Text>
        </View>
      )}

      {tab === 'couple' ? (
        <>
          {/* Pink gradient header (Couple tab only): trio + tabs on the header */}
          <LinearGradient
            colors={['#FCE7F3', '#F9A8D4']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <TrioRow
              ownPhotoURL={ownPhotoURL}
              displayName={displayName}
              partner={partner}
              isOwn={isOwn}
              onInvite={goCoupleInvite}
              onPartnerPress={() => couple?.partnerUid && goFriendProfile(couple.partnerUid, partnerName)}
              center={<CrystalMotif size={110} />}
              levelPill={formatPaidLevel(paidLevel)}
            />
            <TabsRow tab={tab} setTab={setTab} friendCount={friends.length} variant="onPink" />
          </LinearGradient>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {/* Overall Intimacy Level */}
            <View style={[cardStyle, { padding: 16 }]}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>
                {t('profile.intimacyOverallLevel', { defaultValue: 'Overall Intimacy Level' })}
              </Text>
              {isCoupled ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                    <View style={{ backgroundColor: C.pink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: '#FFFFFF' }}>{formatPaidLevel(paidLevel)}</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: C.muted, marginLeft: 10 }}>
                      {`${t('profile.intimacyProgress', { defaultValue: 'Progress' })}: ${Math.round(roadmapProgress * 100)}%`}
                    </Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: C.pinkBar, marginTop: 10, overflow: 'hidden' }}>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: C.pink, width: `${Math.round(roadmapProgress * 100)}%` }} />
                  </View>
                </>
              ) : (
                <Text style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 19 }}>
                  {isOwn
                    ? t('profile.intimacyNoCoupleYet', { defaultValue: 'No couple yet — form a couple to start at Level 1.' })
                    : t('profile.intimacyNoCouple', { defaultValue: 'No couple yet.' })}
                </Text>
              )}
              {/* Level badges 1–5 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: 4 }}>
                {COUPLE_PAID_LEVELS.map((l) => {
                  const reached = isCoupled && l.id <= paidLevel;
                  const current = isCoupled && l.id === paidLevel;
                  return (
                    <View
                      key={l.id}
                      style={{
                        width: 30, height: 30, borderRadius: 15,
                        backgroundColor: reached ? C.pink : '#FFFFFF',
                        borderWidth: current ? 2 : 1,
                        borderColor: current ? C.goldBorder : C.pinkBorder,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '800', color: reached ? '#FFFFFF' : C.muted }}>
                        {l.id}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Level-Up Cost */}
            <View style={[cardStyle, { padding: 16 }]}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>
                {t('profile.intimacyLevelUpCost', { defaultValue: 'Level-Up Cost' })}
              </Text>
              <View style={{ flexDirection: 'row', marginTop: 12, gap: 8 }}>
                {COUPLE_PAID_LEVELS.filter((l) => l.id > 1).map((l) => {
                  const cost = COUPLE_UPGRADE_COSTS[l.id];
                  const isNext = l.id === nextPaidLevel;
                  return (
                    <View
                      key={l.id}
                      style={{
                        flex: 1, alignItems: 'center', backgroundColor: isNext ? C.goldBg : C.pinkTile,
                        borderWidth: isNext ? 1 : 0, borderColor: C.goldBorder,
                        borderRadius: 10, paddingVertical: 8,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: C.text }}>
                        {`Lv.${l.id}${l.id === 5 ? ` (${t('profile.intimacyMax', { defaultValue: 'Max' })})` : ''}`}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 3 }}>
                        <DiamondIcon size={12} />
                        <Text style={{ fontSize: 13, fontWeight: '800', color: C.text }}>{cost}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Upgrade action (own page only) */}
            {isOwn && (
              <View style={[cardStyle, { padding: 16 }]}>
                {!isCoupled ? (
                  <Pressable
                    onPress={goCoupleInvite}
                    style={{ backgroundColor: C.pink, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#FFFFFF' }}>
                      {t('profile.intimacyFormCouple', { defaultValue: 'Form a couple' })}
                    </Text>
                  </Pressable>
                ) : nextPaidLevel && nextCost !== null ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>
                        {`${t('profile.intimacyUpgradeTo', { defaultValue: 'Upgrade to' })} ${formatPaidLevel(nextPaidLevel)}`}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
                        <DiamondIcon size={14} />
                        <Text style={{ fontSize: 14, fontWeight: '800', color: C.text }}>{nextCost}</Text>
                      </View>
                    </View>
                    <Pressable
                      onPress={onUpgrade}
                      disabled={upgrading}
                      style={{ backgroundColor: upgrading ? C.pinkBorder : C.pink, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '800', color: '#FFFFFF' }}>
                        {upgrading
                          ? t('profile.intimacyUpgrading', { defaultValue: 'Upgrading…' })
                          : t('profile.intimacyUpgrade', { defaultValue: 'Upgrade' })}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <View>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>
                      {t('profile.intimacyTopLevel', { defaultValue: 'You reached the top level' })}
                    </Text>
                    <Text style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 19 }}>
                      {t('profile.intimacyTopLevelBody', { defaultValue: 'The highest couple level — every privilege is yours.' })}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Level-Up Progress & Reward Roadmap */}
            <View style={[cardStyle, { padding: 16 }]}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>
                {t('profile.intimacyRoadmap', { defaultValue: 'Level-Up Progress & Reward Roadmap' })}
              </Text>
              <Text style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
                {t('profile.intimacyRoadmapBar', { defaultValue: 'Level-Up Progress Bar' })}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 }}>
                {COUPLE_PAID_LEVELS.map((l) => {
                  const reached = isCoupled && l.id <= paidLevel;
                  const current = isCoupled && l.id === paidLevel;
                  return (
                    <View
                      key={l.id}
                      style={{
                        alignItems: 'center', opacity: reached ? 1 : 0.55,
                        borderWidth: current ? 2 : 0, borderColor: C.goldBorder,
                        borderRadius: 10, padding: 3,
                      }}
                    >
                      <CoupleHouseArt level={l.id} width={56} />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: C.text, marginTop: 4 }}>
                        {`Level ${l.id}`}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: C.pinkBar, marginTop: 12, overflow: 'hidden' }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: C.pink, width: `${isCoupled ? Math.round(roadmapProgress * 100) : 0}%` }} />
              </View>
              {/* Claim buttons, one per level */}
              <View style={{ flexDirection: 'row', marginTop: 12, gap: 6 }}>
                {COUPLE_PAID_LEVELS.map((l) => {
                  const reached = isCoupled && l.id <= paidLevel;
                  const claimed = claims.has(l.id);
                  return (
                    <Pressable
                      key={l.id}
                      onPress={() => (reached && !claimed ? onClaim(l.id) : undefined)}
                      disabled={!reached || claimed || !isOwn}
                      style={{
                        flex: 1, alignItems: 'center', justifyContent: 'center',
                        height: 30, borderRadius: 999,
                        backgroundColor: claimed ? C.goldBg : reached ? C.pink : C.tile,
                        borderWidth: claimed ? 1 : 0, borderColor: C.goldBorder,
                      }}
                    >
                      {claimed ? (
                        <Text style={{ fontSize: 11, fontWeight: '800', color: C.goldText }}>
                          {t('profile.intimacyClaimed', { defaultValue: 'Claimed' })}
                        </Text>
                      ) : reached ? (
                        <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>
                          {t('profile.intimacyClaim', { defaultValue: 'Claim' })}
                        </Text>
                      ) : (
                        <Feather name="lock" size={12} color={C.muted} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
              {!isCoupled && (
                <Text style={{ fontSize: 12, color: C.muted, marginTop: 10, textAlign: 'center' }}>
                  {t('profile.intimacyRoadmapLocked', { defaultValue: 'Rewards unlock once a couple is formed.' })}
                </Text>
              )}
            </View>

            {/* Privilege Showcase (Lv.1–2) */}
            <View style={{ paddingHorizontal: 15, paddingTop: 16 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>
                {t('profile.intimacyShowcase12', { defaultValue: 'Privilege Showcase (Lv. 1-2)' })}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15, paddingTop: 10, gap: 10 }}>
              {[1, 2].map((lv) => (
                <View key={`f${lv}`} style={{ width: '48%', backgroundColor: C.card, borderRadius: 12, padding: 10, alignItems: 'center' }}>
                  <CoupleFrameArt level={lv} size={76}>
                    <Silhouette size={56} />
                  </CoupleFrameArt>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.text, marginTop: 8 }}>
                    {`Lv.${lv} ${t('profile.intimacyFrame', { defaultValue: 'Frame' })}`}
                  </Text>
                </View>
              ))}
              {[1, 2].map((lv) => (
                <View key={`e${lv}`} style={{ width: '48%', backgroundColor: C.card, borderRadius: 12, padding: 10, alignItems: 'center' }}>
                  <CoupleEntryEffectPreview level={lv} width={140} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.text, marginTop: 8 }}>
                    {`Lv.${lv} ${t('profile.intimacyEntryEffect', { defaultValue: 'Entry Effect' })}`}
                  </Text>
                </View>
              ))}
            </View>

            {/* High Level Privileges (Lv.3–5) */}
            <View style={{ paddingHorizontal: 15, paddingTop: 16 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>
                {t('profile.intimacyShowcase35', { defaultValue: 'High Level Privileges (Lv. 3-5)' })}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15, paddingTop: 10, gap: 10 }}>
              {[3, 4, 5].map((lv) => (
                <View key={`f${lv}`} style={{ width: '48%', backgroundColor: C.card, borderRadius: 12, padding: 10, alignItems: 'center' }}>
                  <CoupleFrameArt level={lv} size={76}>
                    <Silhouette size={56} />
                  </CoupleFrameArt>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.text, marginTop: 8 }}>
                    {`Lv.${lv} ${t('profile.intimacyFrame', { defaultValue: 'Frame' })}${lv === 5 ? ` (${t('profile.intimacyMax', { defaultValue: 'Max' })})` : ''}`}
                  </Text>
                </View>
              ))}
              {[3, 4, 5].map((lv) => (
                <View key={`e${lv}`} style={{ width: '48%', backgroundColor: C.card, borderRadius: 12, padding: 10, alignItems: 'center' }}>
                  <CoupleEntryEffectPreview level={lv} width={140} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.text, marginTop: 8 }}>
                    {`Lv.${lv} ${t('profile.intimacyEntryEffect', { defaultValue: 'Entry Effect' })}${lv === 5 ? ` (${t('profile.intimacyMax', { defaultValue: 'Max' })})` : ''}`}
                  </Text>
                </View>
              ))}
            </View>

            {/* Detailed Reward & Privilege List (Bengali, verbatim) */}
            <View style={[cardStyle, { padding: 16 }]}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>
                {t('profile.intimacyRewardList', { defaultValue: 'Detailed Reward & Privilege List' })}
              </Text>
              {[2, 3, 4, 5].map((lv) => (
                <Text key={lv} style={{ fontSize: 14, color: C.text, marginTop: 10, lineHeight: 21 }}>
                  {`Lv.${lv}: ${COUPLE_PAID_REWARDS_BN[lv]}`}
                </Text>
              ))}
            </View>

            {/* Buy Diamonds pill */}
            <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <Pressable
                onPress={goTopup}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: C.card, borderWidth: 1, borderColor: C.goldBorder,
                  borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10,
                }}
              >
                <DiamondIcon size={16} />
                <Text style={{ fontSize: 14, fontWeight: '800', color: C.goldText }}>
                  {t('profile.intimacyBuyDiamonds', { defaultValue: 'Buy Diamonds' })}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </>
      ) : tab === 'intimacy' ? (
        <>
          {/* Profile row card (Intimacy tab) */}
          <View style={[cardStyle, { flexDirection: 'row', alignItems: 'center', padding: 15 }]}>
            <RowPhoto photoURL={ownPhotoURL} name={displayName} size={52} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>{displayName}</Text>
              <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                {`${friends.length} ${t('profile.intimacyTabFriend', { defaultValue: 'Friend' })}${friends.length === 1 ? '' : 's'}`}
              </Text>
            </View>
          </View>
          <TabsRow tab={tab} setTab={setTab} friendCount={friends.length} variant="plain" />

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {/* Trio: self + ring motif + partner slot */}
            <View style={[cardStyle, { paddingBottom: 6 }]}>
              <TrioRow
                ownPhotoURL={ownPhotoURL}
                displayName={displayName}
                partner={partner}
                isOwn={isOwn}
                onInvite={goCoupleInvite}
                onPartnerPress={() => couple?.partnerUid && goFriendProfile(couple.partnerUid, partnerName)}
                center={<RingMotif size={110} />}
                levelPill={formatPaidLevel(paidLevel)}
              />
            </View>

            {/* Love House */}
            <View style={[cardStyle, { padding: 16 }]}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>
                {t('profile.intimacyLoveHouse', { defaultValue: 'Love House' })}
              </Text>
              <Text style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 19 }}>
                {isCoupled
                  ? `${t('profile.intimacyYourLoveHouse', { defaultValue: 'Your Love House' })} · ${coupleLevelRangeText(heartsLevel)}`
                  : t('profile.intimacyLoveHouseLocked', { defaultValue: 'Form a couple to unlock the Love House' })}
              </Text>
              <View style={{ alignItems: 'center', marginTop: 16 }}>
                <LoveHouseArt width={260} locked={!isCoupled} />
              </View>
            </View>

            {/* Hearts meter */}
            <View style={[cardStyle, { padding: 16 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ backgroundColor: C.pink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: '#FFFFFF' }}>{formatCoupleLevel(heartsLevel)}</Text>
                </View>
                <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, marginLeft: 12 }}>
                  {formatHearts(hearts)} {t('profile.intimacyHearts', { defaultValue: 'hearts' })}
                </Text>
              </View>
              <Text style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
                {coupleLevelRangeText(heartsLevel)}
              </Text>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: C.pinkBar, marginTop: 8, overflow: 'hidden' }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: C.pink, width: `${Math.round(heartsProgress * 100)}%` }} />
              </View>
              {nextHeartsLevel && (
                <Text style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
                  {`${formatHearts(nextHeartsLevel.min - hearts)} ${t('profile.intimacyHearts', { defaultValue: 'hearts' })} ${t('profile.intimacyToNext', { defaultValue: 'to next level' })}`}
                </Text>
              )}
            </View>

            {/* Privileges + Grab the Top */}
            <View style={{ paddingHorizontal: 15, paddingTop: 14, paddingBottom: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>
                {`${formatCoupleLevel(heartsLevel)} ${t('profile.intimacyPrivileges', { defaultValue: 'Privileges' })}`}
              </Text>
            </View>
            <View style={{ paddingHorizontal: 15, paddingBottom: 32 }}>
              <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>
                    {t('profile.intimacyPrivilegeGrow', { defaultValue: 'Grow together, unlock more' })}
                  </Text>
                  <Text style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 19 }}>
                    {t('profile.intimacyPrivilegeGrowBody', { defaultValue: 'Couple privileges grow with your couple level. Send gifts, spend time together in voice rooms, and win PK battles to climb higher.' })}
                  </Text>
                </View>
                <View style={{ backgroundColor: C.goldBg, borderWidth: 1, borderColor: C.goldBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: C.goldText }}>
                    {t('profile.intimacyGrabTop', { defaultValue: 'Grab the Top' })}
                  </Text>
                </View>
              </View>
            </View>
          </ScrollView>
        </>
      ) : (
        <>
          {/* Profile row card (Friend tab) */}
          <View style={[cardStyle, { flexDirection: 'row', alignItems: 'center', padding: 15 }]}>
            <RowPhoto photoURL={ownPhotoURL} name={displayName} size={52} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>{displayName}</Text>
              <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                {`${friends.length} ${t('profile.intimacyTabFriend', { defaultValue: 'Friend' })}${friends.length === 1 ? '' : 's'}`}
              </Text>
            </View>
          </View>
          <TabsRow tab={tab} setTab={setTab} friendCount={friends.length} variant="plain" />

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {isOwn && friends.length < MAX_FRIENDS && (
              <Pressable
                onPress={goFriendInvite}
                style={{
                  marginHorizontal: 15, marginTop: 12, backgroundColor: C.blue,
                  borderRadius: 12, paddingVertical: 12, alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#FFFFFF' }}>
                  {t('profile.intimacySendFriendInvite', { defaultValue: 'Send Friend Invitation' })}
                </Text>
              </Pressable>
            )}
            {isOwn && friends.length >= MAX_FRIENDS && (
              <Text style={{ fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 12, paddingHorizontal: 15 }}>
                {t('profile.intimacyMaxFriends', { defaultValue: 'You already have 5 friends — the maximum.' })}
              </Text>
            )}
            {noFriends ? (
              <View style={[cardStyle, { alignItems: 'center', paddingTop: 40, paddingBottom: 44, paddingHorizontal: 48 }]}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'center' }}>
                  {t('profile.intimacyNoFriends', { defaultValue: 'No friends yet' })}
                </Text>
                <Text style={{ fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                  {t('profile.intimacyNoFriendsBody', { defaultValue: 'Send gifts to friends to grow intimacy together.' })}
                </Text>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 15, paddingTop: 12, paddingBottom: 32, gap: 10 }}>
                {friends.map((f) => (
                  <FriendRowWithLevel
                    key={f.uid}
                    friendUid={f.uid}
                    pairValue={entries.find((e) => e.otherUid === f.uid)?.value}
                    peer={peers[f.uid]}
                    onPress={() => goFriendProfile(f.uid, peers[f.uid]?.name || '')}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}
