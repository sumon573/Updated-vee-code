/**
 * Followers / Following List Screen
 * Route params: type ('followers' | 'following'), uid (whose list to show)
 * 2026-10-19 (Sumon): restyled to IMO Me-tab design language —
 * #F4F5F5 bg, white 12dp card, 56dp title bar. SACRED: Vee ID shown with
 * NO '#' prefix. All logic untouched.
 *
 * 2026-10-22 (perf audit): SCALED. The old version fetched EVERY profile
 * with an unbounded Promise.all and mounted EVERY row in a ScrollView —
 * 1,000 followers = 1,000 reads + 1,000 mounted rows (freeze/crash).
 * Now: uid list is held cheaply, profiles load in pages of 50 as the
 * user scrolls (onEndReached), and rows render in a virtualized FlatList.
 * Same design, same card look.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Platform, FlatList } from 'react-native';
import { Image } from 'expo-image';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { ref, get, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { VeeUser } from '@/src/services/userService';
import * as Haptics from 'expo-haptics';

const PAGE_SIZE = 50;

// IMO BIUI light tokens (matches app/profile/index.tsx)
const C = {
  bg: '#F4F5F5',
  card: '#FFFFFF',
  tile: '#F4F5F5',
  text: '#25292D',
  muted: '#788187',
  mutedLight: '#C7C7CC',
  border: '#F0F1F2',
  blue: '#007AFF',
  blueLight: '#E3F2FD' } as const;

// IMO title bar: 56dp, back left, 17sp semibold title centered, NO gear on inner screens
function TitleBar({ title, count }: { title: string; count?: number }) {
  const topPad = Platform.OS === 'web' ? 67 : 0;
  return (
    <View style={{ backgroundColor: C.card, paddingTop: topPad }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 40, alignItems: 'center' }}>
          {count !== undefined && (
            <Text style={{ fontSize: 14, color: C.muted }}>{count}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const UserRow = memo(function UserRow({ user, onPress, last }: { user: VeeUser; onPress: (u: VeeUser) => void; last?: boolean }) {
  const initials = user.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';
  return (
    <View>
      <Pressable
        onPress={() => onPress(user)}
        style={{
          flexDirection: 'row', alignItems: 'center',
          paddingVertical: 13, paddingHorizontal: 15 }}
      >
        {user.photoURL ? (
          <Image
            source={{ uri: user.photoURL }}
            style={{ width: 48, height: 48, borderRadius: 24, marginRight: 12 }}
            cachePolicy="memory-disk"
            recyclingKey={user.uid}
          />
        ) : (
          <View style={{
            width: 48, height: 48, borderRadius: 24, marginRight: 12,
            backgroundColor: C.blueLight,
            alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: C.blue, fontSize: 16, fontWeight: '800' }}>{initials}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* 2026-10-12 (Sumon): display-name fallback — use ||, never ?? */}
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
            {user.name || 'User'}
          </Text>
          {/* SACRED (Sumon): Vee ID shows with NO '#' prefix anywhere */}
          {user.vId ? (
            <Text style={{ color: C.muted, fontSize: 14, marginTop: 2 }}>{user.vId}</Text>
          ) : null}
        </View>
        <Feather name="chevron-right" size={18} color={C.mutedLight} />
      </Pressable>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 75 }} />}
    </View>
  );
});

export default function FollowersScreen() {
  const { type, uid } = useLocalSearchParams<{ type: string; uid: string }>();
  const [activeTab, setActiveTab] = useState<'followers' | 'following'>(type === 'following' ? 'following' : 'followers');
  const isFollowers = activeTab === 'followers';

  const [allUids, setAllUids] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Record<string, VeeUser>>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const fetchingRef = useRef(new Set<string>());

  // Uid list — keys only, cheap even for huge lists.
  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    setProfiles({});
    setVisibleCount(PAGE_SIZE);
    fetchingRef.current = new Set();
    const path = isFollowers ? `followers/${uid}` : `following/${uid}`;
    const unsub = onValue(ref(database, path), (snap) => {
      setAllUids(snap.exists() ? Object.keys(snap.val() as Record<string, boolean>) : []);
      setLoading(false);
    }, () => { setAllUids([]); setLoading(false); });

    // Offline safety: onValue never fires on a cold start with no network
    // (the RTDB JS SDK has no disk persistence, so there is no cached data
    // to replay) — without this the spinner would run forever. Same 3s
    // timeout pattern already used in app/chat/index.tsx.
    const timeout = setTimeout(() => setLoading(false), 3000);

    return () => { clearTimeout(timeout); unsub(); };
  }, [uid, isFollowers]);

  // Profile pages — fetch only the visible window, 50 at a time.
  useEffect(() => {
    const wanted = allUids.slice(0, visibleCount).filter(
      (u) => !profiles[u] && !fetchingRef.current.has(u),
    );
    if (wanted.length === 0) return;
    let cancelled = false;
    for (const u of wanted) fetchingRef.current.add(u);
    void Promise.all(
      wanted.map((u) =>
        get(ref(database, `users/${u}`)).then((s) =>
          s.exists() ? { ...(s.val() as VeeUser), uid: u } : null,
        ).catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      setProfiles((prev) => {
        const next = { ...prev };
        for (const r of results) if (r) next[r.uid] = r;
        return next;
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUids, visibleCount]);

  const users = allUids
    .slice(0, visibleCount)
    .map((u) => profiles[u])
    .filter(Boolean) as VeeUser[];

  const handleUserPress = (u: VeeUser) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(
      `/user-profile?uid=${encodeURIComponent(u.uid)}&name=${encodeURIComponent(u.name)}` as never,
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar
        title={isFollowers ? 'Followers' : 'Following'}
        count={loading ? undefined : allUids.length}
      />

      {/* ─── Tabs ─── */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 15, backgroundColor: C.card, borderTopWidth: 0.5, borderTopColor: C.border }}>
        {(['followers', 'following'] as const).map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={{
              flex: 1, paddingVertical: 12, alignItems: 'center',
              borderBottomWidth: 2,
              borderBottomColor: activeTab === tab ? C.blue : 'transparent' }}
          >
            <Text style={{
              fontSize: 15, fontWeight: activeTab === tab ? '800' : '500',
              color: activeTab === tab ? C.text : C.muted }}>
              {tab === 'followers' ? 'Followers' : 'Following'}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <PremiumLoader size="large" />
        </View>
      ) : allUids.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 }}>
          <Feather name="users" size={40} color={C.mutedLight} />
          <Text style={{ color: C.muted, fontSize: 16, marginTop: 16 }}>
            {isFollowers ? 'No followers yet' : 'Not following anyone yet'}
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1, paddingBottom: 40 }}>
          <FlatList
            data={users}
            keyExtractor={(u) => u.uid}
            renderItem={({ item, index }) => (
              <UserRow user={item} onPress={handleUserPress} last={index === users.length - 1} />
            )}
            onEndReached={() => {
              if (visibleCount < allUids.length) {
                setVisibleCount((c) => Math.min(c + PAGE_SIZE, allUids.length));
              }
            }}
            onEndReachedThreshold={0.5}
            windowSize={9}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            showsVerticalScrollIndicator={false}
            style={{
              marginHorizontal: 15, marginTop: 12,
              backgroundColor: C.card, borderRadius: 12,
              flexGrow: 0, maxHeight: '100%', overflow: 'hidden',
            }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
