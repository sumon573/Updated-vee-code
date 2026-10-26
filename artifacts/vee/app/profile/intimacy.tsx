/**
 * Profile — Intimacy Detail Screen (2026-10-26).
 *
 * Honor-shell copy: 56dp TitleBar with bare router.back(), params
 * useLocalSearchParams<{ uid?: string }> with viewUid falling back to the
 * viewer's own uid, SafeAreaView edges={['top']}, the same light tokens,
 * and a three-flag loading gate with an 8-second timeout.
 *
 * Tabs: Couple (default) | Friend | Intimacy.
 *  - Couple: pink gradient header (tabs bar sits on it) with own photo +
 *    name (left), pink heart ring-box art (center), partner slot (right);
 *    Love House sheet + level card + Love House art + privileges below.
 *    Other users' pages are view-only: no + button, no invite action.
 *  - Friend: full friends list for the viewed uid, ranked by intimacy
 *    value desc. Rows navigate to the friend's profile; NO send buttons.
 *  - Intimacy: the viewed uid's pairs ranked, each with its intimacy
 *    level progress bar, plus the 10 intimacy-level thresholds listed
 *    (coordinator decision: the reference did not establish this tab).
 *
 * Data: ONLY real data — subscribeMyIntimacies(viewUid) + a read-only
 * userCouples/couples subscription (null = no couple). No demo names or
 * photos anywhere. All user-visible strings go through t() with an
 * English defaultValue (English UI law; locale files untouched).
 *
 * Art: INTIMACY_ART comes from src/features/intimacy/intimacyArt (owned
 * by the art child — it may not exist yet when this file lands). An empty
 * URL, or a failed image load, renders a pink placeholder box instead of
 * crashing or showing demo art. expo-image for all remote art.
 *
 * Privilege cards are INFO-ONLY (non-pressable Views): the boss has not
 * defined couple privilege mechanics, so no actions are invented.
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, type VeeUser } from '@/src/services/userService';
import {
  subscribeMyIntimacies,
  fetchPeerProfile,
  intimacyLevelFor,
  intimacyProgress,
  INTIMACY_LEVELS,
  type IntimacyEntry } from '@/src/features/voice-room/services/intimacyService';
import {
  subscribeCoupleState,
  subscribeCoupleLevels,
  coupleLevelFor,
  coupleLevelProgress,
  formatCoupleLevel,
  coupleLevelRangeText,
  coupleLevelRangeLine,
  formatHearts,
  DEFAULT_COUPLE_LEVELS,
  type CoupleLevel,
  type CoupleState } from '@/src/features/intimacy/coupleLevels';
import { INTIMACY_ART } from '@/src/features/intimacy/intimacyArt';
import { subscribeLevel } from '@/src/services/levelService';
import { getErrorCause } from '@/src/utils/errorDisplay';
import {
  FriendRow,
  RowPhoto } from '@/src/features/intimacy/IntimacyTiles';

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
function FriendRowWithLevel({ entry, peer, onPress }: {
  entry: IntimacyEntry;
  peer: { name: string; photoURL: string | null } | undefined;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const [totalLevel, setTotalLevel] = useState<number | null>(null);
  useEffect(() => {
    if (!entry.otherUid) return;
    return subscribeLevel(entry.otherUid, (l) => setTotalLevel(l.totalLevel));
  }, [entry.otherUid]);
  const name = peer?.name || t('profile.intimacyUser', { defaultValue: 'User' });
  const redLabel = formatCoupleLevel(coupleLevelFor(entry.value));
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
      pointsText={`${formatHearts(entry.value)} ${t('profile.intimacyHearts', { defaultValue: 'hearts' })}`}
      onPress={onPress}
    />
  );
}

export default function IntimacyScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ uid?: string }>();
  const viewUid = typeof params.uid === 'string' && params.uid ? params.uid : user?.uid;
  const isOwn = !!user?.uid && viewUid === user.uid;

  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [entries, setEntries] = useState<IntimacyEntry[]>([]);
  const [couple, setCouple] = useState<CoupleState | null>(null);
  const [coupleLevels, setCoupleLevels] = useState<CoupleLevel[]>(DEFAULT_COUPLE_LEVELS);
  const [peers, setPeers] = useState<Record<string, { name: string; photoURL: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('couple');
  const [error, setError] = useState<string | null>(null);
  const [ringBoxFailed, setRingBoxFailed] = useState(false);
  const [loveHouseFailed, setLoveHouseFailed] = useState(false);

  useEffect(() => {
    if (!viewUid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let profileDone = false;
    let intimacyDone = false;
    let coupleDone = false;
    const maybeDone = () => {
      if (profileDone && intimacyDone && coupleDone) setLoading(false);
    };
    const unsubProfile = subscribeUser(viewUid, (u) => {
      profileDone = true;
      setProfile(u);
      maybeDone();
    });
    let unsubIntimacy: () => void = () => {};
    let unsubCouple: () => void = () => {};
    try {
      unsubIntimacy = subscribeMyIntimacies(viewUid, (e) => {
        intimacyDone = true;
        setEntries(e);
        maybeDone();
      });
    } catch (e) {
      setError(t('profile.intimacyLoadError', { defaultValue: 'Could not load intimacy.' }) + ` ${getErrorCause(e)}`);
      intimacyDone = true;
      maybeDone();
    }
    try {
      unsubCouple = subscribeCoupleState(viewUid, (s) => {
        coupleDone = true;
        setCouple(s);
        maybeDone();
      });
    } catch (e) {
      setError(t('profile.intimacyLoadError', { defaultValue: 'Could not load intimacy.' }) + ` ${getErrorCause(e)}`);
      coupleDone = true;
      maybeDone();
    }
    const timeout = setTimeout(() => setLoading(false), 8000);
    return () => {
      clearTimeout(timeout);
      unsubProfile();
      unsubIntimacy();
      unsubCouple();
    };
  }, [viewUid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Server-driven couple curve override (defaults render immediately).
  useEffect(() => subscribeCoupleLevels(setCoupleLevels), []);

  // Peer names/photos for friends + partner (best-effort, cached in state).
  useEffect(() => {
    const uids = new Set<string>();
    for (const e of entries) uids.add(e.otherUid);
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
  }, [entries, couple?.partnerUid]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayName =
    profile?.name ||
    (profile?.email ? profile.email.split('@')[0] : null) ||
    t('profile.intimacyUser', { defaultValue: 'User' });
  const ownPhotoURL = profile?.photoURL || null;

  const partnerPeer = couple?.partnerUid ? peers[couple.partnerUid] : undefined;
  const partnerName = partnerPeer?.name || '';
  const partnerPhotoURL = partnerPeer?.photoURL ?? null;

  // Art URLs (empty = placeholder box; see art-emptiness note in report).
  const art = INTIMACY_ART as { ringBox?: string; loveHouse?: string } | undefined;
  const ringBoxUrl = !ringBoxFailed && typeof art?.ringBox === 'string' ? art.ringBox : '';
  const loveHouseUrl = !loveHouseFailed && typeof art?.loveHouse === 'string' ? art.loveHouse : '';

  const coupleLevel = useMemo(
    () => coupleLevelFor(couple?.hearts ?? 0, coupleLevels),
    [couple?.hearts, coupleLevels],
  );
  const nextCoupleLevel = useMemo(() => {
    const idx = coupleLevels.findIndex((l) => l.id === coupleLevel.id);
    return idx >= 0 && idx + 1 < coupleLevels.length ? coupleLevels[idx + 1] : null;
  }, [coupleLevels, coupleLevel]);

  const showAbout = () => {
    Alert.alert(
      t('profile.intimacyAboutTitle', { defaultValue: 'About Intimacy' }),
      t('profile.intimacyAboutBody', {
        defaultValue: 'Intimacy grows when you send gifts to a friend — higher intimacy means a higher level. A couple is one partner: form a couple to unlock the Love House, and your couple level grows from gifts, time spent together in voice rooms, and PK battles. A couple invitation costs 5000 diamonds, is never refunded, and expires 5 hours after sending.',
      }),
    );
  };

  const goFriendProfile = (uid: string, name: string) => {
    router.push({ pathname: '/user-profile', params: { uid, name } } as Parameters<typeof router.push>[0]);
  };

  const goCoupleInvite = () => {
    router.push('/profile/couple-invite' as never);
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
      </SafeAreaView>
    );
  }

  const noFriends = entries.length === 0;

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
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18 }}>
              {/* Own photo + name (left) */}
              <View style={{ width: 88, alignItems: 'center' }}>
                <RowPhoto photoURL={ownPhotoURL} name={displayName} size={56} />
                <Text style={{ fontSize: 14, fontWeight: '700', color: C.text, marginTop: 8, textAlign: 'center' }} numberOfLines={1}>
                  {displayName}
                </Text>
              </View>
              {/* Pink heart ring-box art (center) */}
              <View style={{ flex: 1, alignItems: 'center', paddingTop: 2 }}>
                {ringBoxUrl ? (
                  <Image
                    source={{ uri: ringBoxUrl }}
                    style={{ width: 120, height: 110 }}
                    contentFit="contain"
                    onError={() => setRingBoxFailed(true)}
                  />
                ) : (
                  <View
                    style={{
                      width: 120, height: 110, borderRadius: 16, backgroundColor: C.pinkTile,
                      borderWidth: 1, borderColor: C.pinkBorder, alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 44, color: C.pink }}>♥</Text>
                  </View>
                )}
              </View>
              {/* Partner slot (right) */}
              <View style={{ width: 88, alignItems: 'center' }}>
                {couple ? (
                  <Pressable
                    onPress={() => couple.partnerUid && goFriendProfile(couple.partnerUid, partnerName)}
                    style={{ alignItems: 'center' }}
                  >
                    <RowPhoto photoURL={partnerPhotoURL} name={partnerName} size={56} />
                    <Text style={{ fontSize: 14, fontWeight: '700', color: C.text, marginTop: 8, textAlign: 'center' }} numberOfLines={1}>
                      {partnerName || t('profile.intimacyPartner', { defaultValue: 'Partner' })}
                    </Text>
                  </Pressable>
                ) : isOwn ? (
                  <Pressable onPress={goCoupleInvite} style={{ alignItems: 'center' }} hitSlop={8}>
                    <View
                      style={{
                        width: 56, height: 56, borderRadius: 28, borderWidth: 2,
                        borderColor: C.pinkBorder, backgroundColor: C.pinkTile,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 30, fontWeight: '300', color: C.pink, lineHeight: 34 }}>+</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>
                      {t('profile.intimacyEmpty', { defaultValue: 'Empty' })}
                    </Text>
                  </Pressable>
                ) : (
                  // Other users: partner slot state only — NO + button, no invite action.
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
            <TabsRow tab={tab} setTab={setTab} friendCount={entries.length} variant="onPink" />
          </LinearGradient>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            <View style={{ position: 'relative' }}>
              {/* Floating-hearts background decoration (text only, not images) */}
              <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                <Text style={{ position: 'absolute', top: 18, right: 24, fontSize: 22, color: '#F9A8D4', opacity: 0.5 }}>♥</Text>
                <Text style={{ position: 'absolute', top: 120, left: 18, fontSize: 16, color: '#F9A8D4', opacity: 0.4 }}>♡</Text>
                <Text style={{ position: 'absolute', top: 260, right: 14, fontSize: 18, color: '#F9A8D4', opacity: 0.4 }}>♡</Text>
                <Text style={{ position: 'absolute', top: 420, left: 26, fontSize: 20, color: '#F9A8D4', opacity: 0.35 }}>♥</Text>
              </View>

              {/* Love House sheet */}
              <View style={[cardStyle, { padding: 16 }]}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>
                  {t('profile.intimacyLoveHouse', { defaultValue: 'Love House' })}
                </Text>
                <Text style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 19 }}>
                  {couple
                    ? `${t('profile.intimacyYourLoveHouse', { defaultValue: 'Your Love House' })} · ${coupleLevelRangeLine(coupleLevel)}`
                    : t('profile.intimacyLoveHouseLocked', { defaultValue: 'Form a couple to unlock the Love House' })}
                </Text>

                {/* Level card */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, backgroundColor: C.pinkTile, borderRadius: 12, padding: 12 }}>
                  <View style={{ backgroundColor: C.pink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: '#FFFFFF' }}>{formatCoupleLevel(coupleLevel)}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: C.text }}>
                      {formatHearts(couple?.hearts ?? 0)} {t('profile.intimacyHearts', { defaultValue: 'hearts' })}
                    </Text>
                    <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {coupleLevelRangeText(coupleLevel)}
                    </Text>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: '#FBCFE8', marginTop: 8, overflow: 'hidden' }}>
                      <View style={{ height: 6, borderRadius: 3, backgroundColor: C.pink, width: `${Math.round(coupleLevelProgress(couple?.hearts ?? 0, coupleLevels) * 100)}%` }} />
                    </View>
                  </View>
                </View>

                {/* Love House art (lock overlay ONLY while no couple) */}
                <View style={{ alignItems: 'center', marginTop: 16 }}>
                  <View style={{ position: 'relative' }}>
                    {loveHouseUrl ? (
                      <Image
                        source={{ uri: loveHouseUrl }}
                        style={{ width: 260, height: 160, borderRadius: 16 }}
                        contentFit="contain"
                        onError={() => setLoveHouseFailed(true)}
                      />
                    ) : (
                      <View
                        style={{
                          width: 260, height: 160, borderRadius: 16, backgroundColor: C.pinkTile,
                          borderWidth: 1, borderColor: C.pinkBorder, alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 52, color: C.pink }}>♥</Text>
                        <Text style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>
                          {t('profile.intimacyLoveHouse', { defaultValue: 'Love House' })}
                        </Text>
                      </View>
                    )}
                    {!couple && (
                      <View
                        style={{
                          position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
                          alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <View style={{ backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 24, padding: 10 }}>
                          <Feather name="lock" size={24} color="#FFFFFF" />
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              {/* Privileges — INFO-ONLY (non-pressable Views; mechanics not defined) */}
              <View style={{ paddingHorizontal: 15, paddingTop: 14, paddingBottom: 8 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>
                  {`${formatCoupleLevel(coupleLevel)} ${t('profile.intimacyPrivileges', { defaultValue: 'Privileges' })}`}
                </Text>
              </View>
              <View style={{ paddingHorizontal: 15, paddingBottom: 32, gap: 10 }}>
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
                {nextCoupleLevel ? (
                  <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>
                        {`${t('profile.intimacyNextLevel', { defaultValue: 'Next' })}: ${formatCoupleLevel(nextCoupleLevel)}`}
                      </Text>
                      <Text style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 19 }}>
                        {`${t('profile.intimacyReachHearts', { defaultValue: 'Reach' })} ${formatHearts(nextCoupleLevel.min)} ${t('profile.intimacyHearts', { defaultValue: 'hearts' })}`}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: C.goldBg, borderWidth: 1, borderColor: C.goldBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: C.goldText }}>
                        {t('profile.intimacyGrabTop', { defaultValue: 'Grab the Top' })}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View style={{ backgroundColor: C.card, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>
                        {t('profile.intimacyTopLevel', { defaultValue: 'You reached the top level' })}
                      </Text>
                      <Text style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 19 }}>
                        {t('profile.intimacyTopLevelBody', { defaultValue: 'The highest couple level — every privilege is yours.' })}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: C.goldBg, borderWidth: 1, borderColor: C.goldBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: C.goldText }}>
                        {t('profile.intimacyGrabTop', { defaultValue: 'Grab the Top' })}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>
        </>
      ) : (
        <>
          {/* Profile row card (Friend / Intimacy tabs) */}
          <View style={[cardStyle, { flexDirection: 'row', alignItems: 'center', padding: 15 }]}>
            <RowPhoto photoURL={ownPhotoURL} name={displayName} size={52} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>{displayName}</Text>
              <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                {`${entries.length} ${t('profile.intimacyTabFriend', { defaultValue: 'Friend' })}${entries.length === 1 ? '' : 's'}`}
              </Text>
            </View>
          </View>
          <TabsRow tab={tab} setTab={setTab} friendCount={entries.length} variant="plain" />

          {tab === 'friend' ? (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
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
                  {entries.map((e) => (
                    <FriendRowWithLevel
                      key={e.pairKey}
                      entry={e}
                      peer={peers[e.otherUid]}
                      onPress={() => goFriendProfile(e.otherUid, peers[e.otherUid]?.name || '')}
                    />
                  ))}
                </View>
              )}
            </ScrollView>
          ) : (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {/* Pairs ranked, with per-pair level progress */}
              <Text style={{
                fontSize: 13, fontWeight: '700', color: C.muted,
                paddingHorizontal: 15, paddingTop: 14, paddingBottom: 8 }}>
                {t('profile.intimacyPairsTitle', { defaultValue: 'Your intimacy levels' })}
              </Text>
              {noFriends ? (
                <View style={[cardStyle, { marginTop: 0, alignItems: 'center', paddingTop: 40, paddingBottom: 44, paddingHorizontal: 48 }]}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'center' }}>
                    {t('profile.intimacyNoFriends', { defaultValue: 'No friends yet' })}
                  </Text>
                  <Text style={{ fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                    {t('profile.intimacyNoFriendsBody', { defaultValue: 'Send gifts to friends to grow intimacy together.' })}
                  </Text>
                </View>
              ) : (
                <View style={{ paddingHorizontal: 15, paddingBottom: 8, gap: 10 }}>
                  {entries.map((e) => {
                    const lvl = intimacyLevelFor(e.value);
                    const progress = intimacyProgress(e.value);
                    const peer = peers[e.otherUid];
                    const name = peer?.name || t('profile.intimacyUser', { defaultValue: 'User' });
                    return (
                      <Pressable
                        key={e.pairKey}
                        onPress={() => goFriendProfile(e.otherUid, peer?.name || '')}
                        style={{ backgroundColor: C.card, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center' }}
                      >
                        <RowPhoto photoURL={peer?.photoURL ?? null} name={name} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={{ fontSize: 15, fontWeight: '600', color: C.text, flex: 1 }} numberOfLines={1}>{name}</Text>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: C.blue, marginLeft: 8 }}>
                              {`${t('profile.intimacyLevelShort', { defaultValue: 'Lv.' })}${lvl.id}`}
                            </Text>
                          </View>
                          <View style={{ height: 6, borderRadius: 3, backgroundColor: C.blueLight, marginTop: 8, overflow: 'hidden' }}>
                            <View style={{ height: 6, borderRadius: 3, backgroundColor: C.blue, width: `${Math.round(progress * 100)}%` }} />
                          </View>
                          <Text style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                            {lvl.max === null
                              ? `${formatHearts(e.value)} ${t('profile.intimacyHearts', { defaultValue: 'hearts' })}`
                              : `${formatHearts(e.value)} ${t('profile.intimacyHearts', { defaultValue: 'hearts' })} · ${formatHearts(lvl.max - e.value + 1)} ${t('profile.intimacyToNext', { defaultValue: 'to next level' })}`}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {/* All 10 intimacy-level thresholds */}
              <Text style={{
                fontSize: 13, fontWeight: '700', color: C.muted,
                paddingHorizontal: 15, paddingTop: 14, paddingBottom: 8 }}>
                {t('profile.intimacyThresholdsTitle', { defaultValue: 'Intimacy levels' })}
              </Text>
              <View style={{ marginHorizontal: 15, marginBottom: 32, backgroundColor: C.card, borderRadius: 12, overflow: 'hidden' }}>
                {INTIMACY_LEVELS.map((l, i) => (
                  <View
                    key={l.id}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      paddingHorizontal: 14, paddingVertical: 11,
                      borderBottomWidth: i === INTIMACY_LEVELS.length - 1 ? 0 : 0.5, borderBottomColor: C.border,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: C.text }}>
                      {`${t('profile.intimacyLevelShort', { defaultValue: 'Lv.' })}${l.id}`}
                    </Text>
                    <Text style={{ fontSize: 13, color: C.muted }}>
                      {l.max === null ? `${formatHearts(l.min)}+` : `${formatHearts(l.min)} ~ ${formatHearts(l.max)}`}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}
