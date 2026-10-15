/**
 * Profile — Honor Detail Screen (NOTE 8, 2026-10-11, IMO exact).
 *
 * IMO layout:
 *  - Header: back + "Honor" + ? icon
 *  - Profile row: DP + name + active nameplate
 *  - Tabs: "Nameplate N" | "Badge N" (IMO order), real counts
 *  - Badge tab: "Verification" section (officially granted) + "Achievement"
 *    section (event-claimed). Badge grid, tap → detail modal.
 *  - Nameplate tab: real granted nameplates from Firebase, tap to equip.
 *
 * Data: ONLY real granted items (officially granted by admin, claimed from
 * special events, or earned from Noble ranks) via badgeService. No demo
 * badges, no invented records, no activity auto-earn — the RTDB has no
 * mic-time/hosting-duration/in-room counters, and client-side self-granting
 * would be forgeable, so achievement badges come from real grants only.
 *
 * Badge detail visibility rules (Sumon's spec):
 *  - Validity ("Permanent" / "Valid for DD-MM-YYYY") → badge OWNER only
 *  - "First obtained on DD-MM-YYYY" → everyone (friends/public)
 *
 * Supports viewing another user's honor via ?uid= — validity is hidden then.
 * Light mode only. Errors show their actual cause.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, Image, Alert, Animated } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, updateUser, VeeUser } from '@/src/services/userService';
import {
  subscribeBadges,
  subscribeNameplates,
  formatObtainedDate,
  formatValidity,
  type GrantedNameplate } from '@/src/services/badgeService';
import type { GrantedBadge } from '@/src/data/honor';
import { getErrorCause } from '@/src/utils/errorDisplay';

const C = {
  bg: '#FFFFFF',
  card: '#F2F2F7',
  text: '#000000',
  muted: '#8E8E93',
  mutedDim: '#C7C7CC',
  border: '#E5E5EA',
  gold: '#F5A623',
  goldBg: '#FFF8E6',
  goldBorder: '#F5D67B',
  blue: '#007AFF' } as const;

export default function HonorScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ uid?: string }>();
  // Whose honor are we viewing? Defaults to own profile.
  const viewUid = typeof params.uid === 'string' && params.uid ? params.uid : user?.uid;
  const isOwn = !!user?.uid && viewUid === user.uid;

  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [badges, setBadges] = useState<GrantedBadge[]>([]);
  const [nameplates, setNameplates] = useState<GrantedNameplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'nameplate' | 'badge'>('badge');
  const [selected, setSelected] = useState<GrantedBadge | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 2026-10-13 (Sumon): spring animation for badge detail — badge "moves a bit" on open.
  const badgeScale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (selected) {
      badgeScale.setValue(0.5);
      Animated.spring(badgeScale, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true }).start();
    }
  }, [selected, badgeScale]);

  useEffect(() => {
    if (!viewUid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let profileDone = false;
    let badgesDone = false;
    let platesDone = false;
    const maybeDone = () => {
      if (profileDone && badgesDone && platesDone) setLoading(false);
    };

    const unsubProfile = subscribeUser(viewUid, (u) => {
      profileDone = true;
      setProfile(u);
      maybeDone();
    });
    let unsubBadges: () => void = () => {};
    let unsubPlates: () => void = () => {};
    try {
      unsubBadges = subscribeBadges(viewUid, (b) => {
        badgesDone = true;
        setBadges(b);
        maybeDone();
      });
    } catch (e) {
      setError(`Could not load badges: ${getErrorCause(e)}`);
      badgesDone = true;
      maybeDone();
    }
    try {
      unsubPlates = subscribeNameplates(viewUid, (p) => {
        platesDone = true;
        setNameplates(p);
        maybeDone();
      });
    } catch (e) {
      setError(`Could not load nameplates: ${getErrorCause(e)}`);
      platesDone = true;
      maybeDone();
    }
    const timeout = setTimeout(() => setLoading(false), 8000);
    return () => {
      clearTimeout(timeout);
      unsubProfile();
      unsubBadges();
      unsubPlates();
    };
  }, [viewUid]);

  const official = useMemo(
    () => badges.filter((b) => (b.source || 'official') === 'official'),
    [badges],
  );
  const eventBadges = useMemo(
    () => badges.filter((b) => b.source === 'event'),
    [badges],
  );

  const activePlate = useMemo(() => {
    const activeId = (profile as any)?.activeNameplate as string | undefined;
    return nameplates.find((n) => n.id === activeId) || null;
  }, [nameplates, profile]);

  const handleEquipNameplate = async (id: string) => {
    if (!isOwn || !user?.uid) return;
    try {
      await updateUser(user.uid, { activeNameplate: id });
    } catch (e) {
      setError(`Could not equip nameplate: ${getErrorCause(e)}`);
    }
  };

  const showAbout = () => {
    Alert.alert(
      'About Honor',
      'Badges are granted officially by the Vee team, claimed from special events, or earned from Noble ranks. Nameplates work the same way.',
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
      </SafeAreaView>
    );
  }

  // P1-7 (2026-10-12): email-prefix fallback instead of hardcoded 'Vee User'
  const displayName =
    profile?.name ||
    (profile?.email ? profile.email.split('@')[0] : null) ||
    'User';
  const photoURL = profile?.photoURL || null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 12, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={() => router.back()} style={{ padding: 8 }} hitSlop={8}>
            <Feather name="chevron-left" size={24} color={C.text} />
          </Pressable>
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.text, marginLeft: 4 }}>
            Honor
          </Text>
        </View>
        <Pressable onPress={showAbout} style={{ padding: 8 }} hitSlop={8}>
          <Feather name="help-circle" size={22} color={C.text} />
        </Pressable>
      </View>

      {error && (
        <View style={{ backgroundColor: '#FDECEA', paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ fontSize: 12, color: '#B3261E' }}>{error}</Text>
        </View>
      )}

      {/* Profile row (IMO style) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
        {photoURL ? (
          <Image source={{ uri: photoURL }} style={{ width: 52, height: 52, borderRadius: 26 }} />
        ) : (
          <View style={{
            width: 52, height: 52, borderRadius: 26, backgroundColor: C.card,
            alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: C.muted }}>
              {displayName[0]?.toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: C.text }}>{displayName}</Text>
          {activePlate ? (
            <View style={{
              marginTop: 5, alignSelf: 'flex-start',
              backgroundColor: C.goldBg, borderWidth: 1, borderColor: C.goldBorder,
              borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#8A6D00' }}>
                {activePlate.icon} {activePlate.name}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Tabs (IMO order: Nameplate N | Badge N) */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border }}>
        {(['nameplate', 'badge'] as const).map((t) => {
          const active = tab === t;
          const label = t === 'badge' ? `Badge ${badges.length}` : `Nameplate ${nameplates.length}`;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}
            >
              <Text style={{
                fontSize: 15, fontWeight: active ? '800' : '500',
                color: active ? C.blue : C.muted }}>
                {label}
              </Text>
              <View style={{
                height: 3, width: 40, borderRadius: 2, marginTop: 6,
                backgroundColor: active ? C.blue : 'transparent' }} />
            </Pressable>
          );
        })}
      </View>

      {tab === 'badge' ? (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <BadgeSection title="Verification" badges={official} onOpen={setSelected} />
          <BadgeSection title="Achievement" badges={eventBadges} onOpen={setSelected} />
          {badges.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 48, paddingHorizontal: 48 }}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>🏅</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'center' }}>
                No badges yet
              </Text>
              <Text style={{ fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                Badges are granted officially, claimed from special events, or earned from Noble ranks.
              </Text>
            </View>
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <Text style={{
            fontSize: 13, fontWeight: '700', color: C.muted,
            paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
            Nameplate
          </Text>
          {nameplates.length > 0 ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 24, gap: 10 }}>
              {nameplates.map((n) => {
                const isActive = (profile as any)?.activeNameplate === n.id;
                return (
                  <Pressable
                    key={n.id}
                    onPress={() => handleEquipNameplate(n.id)}
                    disabled={!isOwn}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      backgroundColor: C.goldBg,
                      borderWidth: 1, borderColor: isActive ? C.blue : C.goldBorder,
                      borderRadius: 14, padding: 12 }}
                  >
                    <Text style={{ fontSize: 30 }}>{n.icon}</Text>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ fontSize: 15, fontWeight: '800', color: C.text }}>
                        {n.name}
                      </Text>
                      {/* Obtained date — visible to everyone */}
                      <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        {isActive ? 'Equipped' : `First obtained on ${formatObtainedDate(n.obtainedAt)}`}
                      </Text>
                      {/* Validity — owner only */}
                      {isOwn && (
                        <Text style={{ fontSize: 11, color: '#8A6D00', marginTop: 2, fontWeight: '700' }}>
                          {formatValidity(n.validity)}
                        </Text>
                      )}
                    </View>
                    {isActive && <Feather name="check-circle" size={18} color={C.blue} />}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 48, paddingHorizontal: 48 }}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>🎖️</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'center' }}>
                No nameplates yet
              </Text>
              <Text style={{ fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                Nameplates are granted officially, claimed from special events, or earned from Noble ranks.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Badge detail modal — imo style (2026-10-13 Sumon): dark bg, large badge
          with spring animation, name, description, "First obtained on". */}
      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable
          style={{
            flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
            alignItems: 'center', justifyContent: 'center', padding: 32 }}
          onPress={() => setSelected(null)}
        >
          <Pressable
            onPress={() => setSelected(null)}
            style={{ position: 'absolute', top: 48, left: 24, padding: 6 }}
            hitSlop={8}
          >
            <Feather name="x" size={28} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ alignItems: 'center' }}>
            {/* Badge with spring "moves a bit" animation — imo-style: large, no box */}
            <Animated.View style={{ transform: [{ scale: badgeScale }] }}>
              {/^https?:\/\//i.test(selected?.icon || '') ? (
                <Image source={{ uri: selected!.icon }} style={{ width: 220, height: 220 }} resizeMode="contain" />
              ) : (
                <Text style={{ fontSize: 160 }}>{selected?.icon}</Text>
              )}
            </Animated.View>
            <Text style={{ fontSize: 26, fontWeight: '800', fontStyle: 'italic', color: '#FFFFFF', marginTop: 24, textAlign: 'center' }}>
              {selected?.name}
            </Text>
            {/* Validity — badge OWNER only */}
            {isOwn && selected?.validity && (
              <View style={{
                marginTop: 12, backgroundColor: 'rgba(255,255,255,0.12)',
                borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFD60A' }}>
                  {formatValidity(selected.validity)}
                </Text>
              </View>
            )}
            {(selected?.description || selected?.howToGet) ? (
              <Text style={{
                fontSize: 15, color: 'rgba(255,255,255,0.55)', fontStyle: 'italic', textAlign: 'center',
                marginTop: 16, lineHeight: 22, paddingHorizontal: 20 }}>
                {selected?.description || selected?.howToGet}
              </Text>
            ) : null}
            {/* Obtained date — visible to everyone */}
            <Text style={{
              fontSize: 15, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', marginTop: 20 }}>
              First obtained on {formatObtainedDate(selected?.obtainedAt || 0)}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function BadgeSection({
  title, badges, onOpen }: {
  title: string;
  badges: GrantedBadge[];
  onOpen: (b: GrantedBadge) => void;
}) {
  if (badges.length === 0) return null;
  return (
    <View>
      <Text style={{
        fontSize: 13, fontWeight: '700', color: C.muted,
        paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 8 }}>
        {badges.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => onOpen(b)}
            style={{ width: '25%', padding: 6, alignItems: 'center' }}
          >
            <View style={{
              width: '100%', aspectRatio: 1, borderRadius: 16,
              backgroundColor: C.goldBg, borderWidth: 1, borderColor: C.goldBorder,
              alignItems: 'center', justifyContent: 'center' }}>
              {/^https?:\/\//i.test(b.icon || '') ? (
                <Image source={{ uri: b.icon }} style={{ width: 48, height: 48 }} resizeMode="contain" />
              ) : (
                <Text style={{ fontSize: 34 }}>{b.icon}</Text>
              )}
            </View>
            <Text style={{
              fontSize: 11, fontWeight: '700', color: C.text,
              marginTop: 5, textAlign: 'center' }} numberOfLines={2}>
              {b.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
