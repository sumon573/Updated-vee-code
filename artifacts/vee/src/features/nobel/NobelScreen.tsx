/**
 * NobelScreen — "My Noble" (IMO-exact, 2026-10-19).
 *
 * Replicates IMO's My Noble screen pixel-structure from the reference
 * (noble-rewards-ref.jpg):
 * - Title bar: back arrow + "My Noble" + ? + trophy
 * - Name, rank badge art, I/II/III progress with 👑 XP markers
 * - "Need 👑X to secure your current noble level {Rank} {I/II/III} (Deadline: …)"
 * - Rank tabs with crown icons, orange selected underline
 * - "— Noble Privileges —" + "Experience: {min}K~{max}K"
 * - 9 privileges, 3-col grid, IMO reward artwork (assets/nobel/)
 *
 * Vee's Nobel ECONOMY is unchanged (10 ranks Knight…SSKing, XP = lifetime
 * diamonds sent, 30-day validity, miss maintenance → drop one rank).
 * Only the UI/UX is IMO's.
 *
 * Privilege honesty: locked (0.3 alpha, IMO) when the user's rank is below
 * the viewing rank; 🔒 badge when earned but not yet enforced in code.
 * Never unlocked-but-dead.
 *
 * Light mode only. Errors show their actual cause.
 */
import React, { useEffect, useState, useRef } from 'react';
import { View, Text, Pressable, Image, ScrollView, Alert, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import PremiumLoader from '@/src/components/PremiumLoader';
import { useRouter } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '@/src/context/AuthContext';
import { getErrorCause } from '@/src/utils/errorDisplay';
import {
  NOBLE_RANKS, PRIVILEGES, NobleState, PrivilegeDef,
  subscribeNoble, formatXP, formatDeadline, refreshNobleState } from '@/src/services/nobleService';
import NobleRankPreview from './NobleRankPreview';
import { rewardsForRankKey } from '@/src/services/nobleRewardsCatalog';

const { width } = Dimensions.get('window');
const ROMAN = ['I', 'II', 'III'];

// IMO reward artwork — hosted on Vee's VPS (same pattern as IMO gifts):
// https://vee-club.duckdns.org/nobel-art/<file>  (files: C:\nobel-art\ on VPS)
// Extracted from IMO's APK CDN (ImageUrlConst) + boss's reference screenshot.
const NOBEL_ART_BASE = 'https://vee-club.duckdns.org/nobel-art';
const artUri = (f: string) => ({ uri: `${NOBEL_ART_BASE}/${f}` });

const PRIV_ART: Record<string, any> = {
  nameplate: artUri('priv-nameplate.png'),
  badge: artUri('priv-badge.png'),
  gift: artUri('priv-gift.png'),
  avatarFrame: artUri('priv-frame.png'),
  entryEffects: artUri('priv-entry.png'),
  seatPriority: artUri('priv-seat.png'),
  upgradeBanner: artUri('priv-banner.png'),
  micRipple: artUri('priv-ripple.png'),
  homepageSkin: artUri('priv-skin.png'),
};

// Rank tab crown art (IMO). Ranks without a dedicated crown reuse the badge art.
const RANK_CROWN: Record<string, any> = {
  king: artUri('crown-king.png'),
  sking: artUri('crown-sking.png'),
  ssking: artUri('crown-ssking.png'),
};
const RANK_CROWN_FALLBACK = artUri('priv-badge.png');
// IMO's own "Baron I" badge art (reference screenshot)
const RANK_BADGE_BARON = artUri('rank-badge-baron.png');

const IMO_TEAL = '#1FB5A6';
const IMO_ORANGE = '#FF9800';
const IMO_GRAY = '#9E9E9E';

function subLevelFor(xp: number, rankIdx: number): number {
  const r = NOBLE_RANKS[rankIdx];
  const span = r.maxXP - r.minXP;
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.min(3, Math.floor(((xp - r.minXP) / span) * 3) + 1);
}

/** IMO experience format: "42000K~1000000000000K" */
function formatExpK(xp: number): string {
  if (!Number.isFinite(xp)) return 'MAX';
  return `${Math.round(xp / 1000)}K`;
}

export default function NobelScreen({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const { user } = useAuth();
  const [noble, setNoble] = useState<NobleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRankIdx, setSelectedRankIdx] = useState(0);
  const userPickedTabRef = useRef(false);
  const tabInitializedRef = useRef(false);
  const [previewRankIdx, setPreviewRankIdx] = useState<number | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    refreshNobleState(user.uid).catch(() => {});
    let unsubProfile: (() => void) | null = null;
    (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        unsubProfile = onValue(ref(database, `users/${user.uid}`), (snap) => {
          const v = snap.val();
          if (v) {
            if (typeof v.name === 'string' && v.name.trim()) setProfileName(v.name.trim());
            if (typeof v.photoURL === 'string' && v.photoURL) setProfilePhoto(v.photoURL);
          }
        });
      } catch { /* fall back to auth displayName/photoURL */ }
    })();
    const unsub = subscribeNoble(
      user.uid,
      (s) => {
        setNoble(s);
        if (s && !tabInitializedRef.current && !userPickedTabRef.current) {
          tabInitializedRef.current = true;
          setSelectedRankIdx(s.rankIndex);
        }
        setLoading(false);
      },
      (e) => {
        setError(getErrorCause(e));
        setLoading(false);
      },
    );
    const timeout = setTimeout(() => setLoading(false), 8000);
    return () => {
      clearTimeout(timeout);
      unsub();
      try { unsubProfile?.(); } catch { /* non-critical */ }
    };
  }, [user?.uid]);

  const showAbout = () => {
    Alert.alert(
      'About Noble',
      'Noble ranks grow when you send diamonds as gifts in voice rooms.\n\n' +
      'Each rank unlocks privileges. Send the maintenance amount before the ' +
      'deadline to keep your rank secured — otherwise privileges are suspended ' +
      'until you catch up.',
    );
  };

  const showRanking = () => {
    // Noble leaderboard lives in the Leaderboard screen.
    router.push('/leaderboard' as any);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
      </View>
    );
  }

  const xp = noble?.xp ?? 0;
  const rankIdx = noble?.rankIndex ?? 0;
  const rank = NOBLE_RANKS[rankIdx];
  const selectedRank = NOBLE_RANKS[selectedRankIdx];
  const sub = subLevelFor(xp, rankIdx);
  const isTop = rankIdx === NOBLE_RANKS.length - 1;
  const span = rank.maxXP - rank.minXP;
  const progress = !Number.isFinite(span) || span <= 0
    ? 1
    : Math.min(1, Math.max(0, (xp - rank.minXP) / span));

  const remaining = noble ? Math.max(0, noble.maintenanceRequired - noble.maintenanceXP) : 0;
  // IMO-exact maintenance line
  const maintenanceLine = !noble
    ? 'Send diamonds as gifts in voice rooms to earn Noble XP.'
    : `Need 👑${formatXP(remaining)} to secure your current noble level ${rank.name} ${ROMAN[sub - 1]} (Deadline: ${formatDeadline(noble.maintenanceDeadline)})`;

  const renderPrivilege = (key: string) => {
    const def = PRIVILEGES.find((p) => p.key === key) as PrivilegeDef;
    // IMO: viewing a rank tab shows that rank's privileges; locked (0.3 alpha)
    // when the user's own rank is below the viewed rank.
    const rankLocked = rankIdx < selectedRankIdx;
    const earned = rankIdx >= def.minRankIndex;
    const enforcedLocked = earned && !def.enforced;
    // 2026-10-20 (boss): nameplate/badge/frame show the SELECTED rank's own
    // design from the rewards catalog — not one generic icon for every rank.
    const rankCat = rewardsForRankKey(selectedRank.key);
    const perRankUrl = def.key === 'nameplate' ? rankCat?.nameplate?.designUrl
      : def.key === 'badge' ? rankCat?.badge?.designUrl
      : def.key === 'avatarFrame' ? rankCat?.frame?.designUrl
      : undefined;
    const art = perRankUrl ? { uri: perRankUrl } : PRIV_ART[def.key];
    return (
      <View key={def.key} style={{ width: (width - 48) / 3, alignItems: 'center', marginBottom: 24 }}>
        <View style={{ opacity: rankLocked ? 0.3 : 1, alignItems: 'center' }}>
          {art ? (
            <Image source={art} style={{ width: 84, height: 84 }} resizeMode="contain" />
          ) : (
            <View style={{
              width: 84, height: 84, borderRadius: 42,
              backgroundColor: '#FFF8E1', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 36 }}>{def.icon}</Text>
            </View>
          )}
          {enforcedLocked && !rankLocked && (
            <View style={{
              position: 'absolute', bottom: 2, right: 8,
              backgroundColor: '#fff', borderRadius: 10, padding: 3,
              borderWidth: 1, borderColor: '#E0E0E0' }}>
              <Feather name="lock" size={12} color="#8E8E93" />
            </View>
          )}
        </View>
        <Text style={{
          fontSize: 14, color: rankLocked ? IMO_GRAY : '#212121',
          textAlign: 'center', fontWeight: '500', marginTop: 8, lineHeight: 18 }}>
          {def.name}
        </Text>
      </View>
    );
  };

  const anyEnforcedLocked = selectedRank.privileges.some((k) => {
    const def = PRIVILEGES.find((p) => p.key === k) as PrivilegeDef;
    return rankIdx >= def.minRankIndex && !def.enforced && rankIdx >= selectedRankIdx;
  });

  const renderRankBadge = () => {
    // IMO shows per-rank badge art; we have Baron's actual art.
    if (rank.key === 'baron') {
      return (
        <Image source={RANK_BADGE_BARON} style={{ width: 150, height: 52 }} resizeMode="contain" />
      );
    }
    const crown = RANK_CROWN[rank.key] || RANK_CROWN_FALLBACK;
    return (
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#2AA198', borderWidth: 2, borderColor: '#C9A227',
        borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 }}>
        <Image source={crown} style={{ width: 26, height: 26 }} resizeMode="contain" />
        <Text style={{ fontSize: 17, fontWeight: '800', fontStyle: 'italic', color: '#fff', marginLeft: 8 }}>
          {rank.name} {ROMAN[sub - 1]}
        </Text>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Title bar — IMO: back + "My Noble" + ? + trophy */}
      {!embedded && (
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12,
          borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={28} color="#000" />
          </Pressable>
          <Text style={{ fontSize: 28, fontWeight: '700', color: '#000', marginLeft: 16, flex: 1 }}>
            My Noble
          </Text>
          <Pressable hitSlop={12} style={{ marginRight: 20 }} onPress={showAbout}>
            <Feather name="help-circle" size={26} color="#000" />
          </Pressable>
          <Pressable hitSlop={12} onPress={showRanking}>
            <MaterialIcons name="emoji-events" size={26} color="#000" />
          </Pressable>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false}>
        {error ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Text style={{ color: '#D32F2F', fontSize: 14 }}>{error}</Text>
          </View>
        ) : (
          <>
            {/* User section — IMO: name + rank badge art */}
            <View style={{ alignItems: 'center', paddingTop: 20 }}>
              <Text style={{ fontSize: 28, fontWeight: '700', color: '#000' }}>
                {profileName || user?.displayName || 'Vee User'}
              </Text>
              <View style={{ marginTop: 10 }}>
                {renderRankBadge()}
              </View>
            </View>

            {/* Progress — IMO: I/II markers, 👑XP bar with knob */}
            <View style={{ paddingHorizontal: 24, marginTop: 20 }}>
              <View style={{ flexDirection: 'row', paddingLeft: 52 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', fontStyle: 'italic', color: IMO_TEAL }}>
                  {ROMAN[sub - 1]}
                </Text>
                {!isTop && (
                  <Text style={{ fontSize: 15, fontWeight: '800', fontStyle: 'italic', color: '#D5DBDB', marginLeft: width * 0.32 }}>
                    {ROMAN[Math.min(2, sub)]}
                  </Text>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <Text style={{ fontSize: 17, fontWeight: '800', color: IMO_TEAL, marginRight: 6 }}>
                  👑{formatXP(rank.minXP)}
                </Text>
                <View style={{ flex: 1, height: 10, backgroundColor: '#ECEFF1', borderRadius: 5 }}>
                  <View style={{
                    width: `${progress * 100}%`, height: 10,
                    backgroundColor: IMO_TEAL, borderRadius: 5 }} />
                  <View style={{
                    position: 'absolute',
                    left: `${progress * 100}%`, top: 1,
                    width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff',
                    marginLeft: -4,
                    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, elevation: 2,
                  }} />
                </View>
                <Text style={{ fontSize: 17, fontWeight: '800', color: IMO_TEAL, marginLeft: 6 }}>
                  👑{isTop ? 'MAX' : formatXP(rank.maxXP)}
                </Text>
              </View>
              <Text style={{ fontSize: 14, color: '#9E9E9E', textAlign: 'center', marginTop: 10, lineHeight: 20 }}>
                {maintenanceLine}
              </Text>
            </View>

            {/* Rank tabs — IMO: crown icon + name, orange selected */}
            <View style={{ borderTopWidth: 8, borderTopColor: '#F7F7F7', marginTop: 16 }} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 8, alignItems: 'center' }}
              style={{ borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}
            >
              {NOBLE_RANKS.map((r, idx) => {
                const activeTab = idx === selectedRankIdx;
                const crown = RANK_CROWN[r.key] || RANK_CROWN_FALLBACK;
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => {
                      userPickedTabRef.current = true;
                      setSelectedRankIdx(idx);
                    }}
                    hitSlop={{ top: 8, bottom: 8 }}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingHorizontal: 14, paddingVertical: 12, marginRight: 2,
                      borderBottomWidth: activeTab ? 3 : 0,
                      borderBottomColor: IMO_ORANGE }}
                  >
                    <Image source={crown} style={{ width: 30, height: 30, marginRight: 6 }} resizeMode="contain" />
                    <Text style={{
                      fontSize: 17,
                      fontWeight: activeTab ? '700' : '400',
                      color: activeTab ? IMO_ORANGE : '#7F8C8D' }}>
                      {r.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Privileges header — IMO: — Noble Privileges — */}
            <View style={{ alignItems: 'center', marginTop: 20, marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <LinearGradient
                  colors={['transparent', IMO_ORANGE]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ width: 70, height: 2.5, borderRadius: 1.5 }} />
                <Text style={{ fontSize: 21, fontWeight: '700', color: IMO_ORANGE, marginHorizontal: 14 }}>
                  Noble Privileges
                </Text>
                <LinearGradient
                  colors={[IMO_ORANGE, 'transparent']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ width: 70, height: 2.5, borderRadius: 1.5 }} />
              </View>
              <Text style={{ fontSize: 15, color: '#7F8C8D', marginTop: 8 }}>
                Experience: {formatExpK(selectedRank.minXP)}~{formatExpK(selectedRank.maxXP)}
              </Text>
              <Pressable
                onPress={() => setPreviewRankIdx(selectedRankIdx)}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: '#E3F2FD', borderRadius: 20,
                  paddingHorizontal: 18, paddingVertical: 9, marginTop: 10,
                }}
              >
                <Feather name="eye" size={16} color="#007AFF" />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#007AFF', marginLeft: 6 }}>
                  Preview {selectedRank.name} on my profile
                </Text>
              </Pressable>
            </View>

            {/* 9 privileges, 3-col grid — IMO reward artwork */}
            <View style={{
              flexDirection: 'row', flexWrap: 'wrap',
              paddingHorizontal: 24, paddingTop: 16, justifyContent: 'flex-start' }}>
              {selectedRank.privileges.map(renderPrivilege)}
            </View>
            {anyEnforcedLocked && (
              <Text style={{ fontSize: 11, color: '#8E8E93', textAlign: 'center', paddingHorizontal: 40, paddingBottom: 8 }}>
                🔒 = privilege not available yet — it will activate here when it ships.
              </Text>
            )}
            <View style={{ height: 32 }} />
          </>
        )}
      </ScrollView>

      {previewRankIdx !== null && (
        <NobleRankPreview
          visible={previewRankIdx !== null}
          onClose={() => setPreviewRankIdx(null)}
          rankIndex={previewRankIdx}
          userName={profileName || user?.displayName || 'Vee User'}
          userPhotoURL={profilePhoto || user?.photoURL}
          userXP={xp}
        />
      )}
    </View>
  );
}
