/**
 * Followers / Following List Screen
 * Route params: type ('followers' | 'following'), uid (whose list to show)
 * 2026-10-19 (Sumon): restyled to IMO Me-tab design language —
 * #F4F5F5 bg, white 12dp card, 56dp title bar. SACRED: Vee ID shown with
 * NO '#' prefix. All logic untouched.
 */

import { useEffect, useState } from 'react';
import { View, Text, Pressable, Image, Platform, ScrollView } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { ref, get, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { VeeUser } from '@/src/services/userService';
import * as Haptics from 'expo-haptics';

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

// IMO card container: white, 12dp radius, 15dp side margins
const cardStyle = { backgroundColor: C.card, marginHorizontal: 15, marginTop: 12, borderRadius: 12 } as const;

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

function UserRow({ user, onPress, last }: { user: VeeUser; onPress: () => void; last?: boolean }) {
  const initials = user.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';
  return (
    <View>
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: 'row', alignItems: 'center',
          paddingVertical: 13, paddingHorizontal: 15 }}
      >
        {user.photoURL ? (
          <Image
            source={{ uri: user.photoURL }}
            style={{ width: 48, height: 48, borderRadius: 24, marginRight: 12 }}
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
}

export default function FollowersScreen() {
  const { type, uid } = useLocalSearchParams<{ type: string; uid: string }>();
  const [activeTab, setActiveTab] = useState<'followers' | 'following'>(type === 'following' ? 'following' : 'followers');
  const isFollowers = activeTab === 'followers';

  const [users, setUsers] = useState<VeeUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setLoading(false); return; }

    // Listen to the correct path
    const path = isFollowers ? `followers/${uid}` : `following/${uid}`;
    const unsub = onValue(ref(database, path), async (snap) => {
      if (!snap.exists()) {
        setUsers([]);
        setLoading(false);
        return;
      }
      const uids = Object.keys(snap.val() as Record<string, boolean>);
      const results = await Promise.all(
        uids.map((u) =>
          get(ref(database, `users/${u}`)).then((s) =>
            s.exists() ? { ...(s.val() as VeeUser), uid: u } : null,
          ),
        ),
      );
      setUsers(results.filter(Boolean) as VeeUser[]);
      setLoading(false);
    }, () => { setUsers([]); setLoading(false); });

    // Offline safety: onValue never fires on a cold start with no network
    // (the RTDB JS SDK has no disk persistence, so there is no cached data
    // to replay) — without this the spinner would run forever. Same 3s
    // timeout pattern already used in app/chat/index.tsx.
    const timeout = setTimeout(() => setLoading(false), 3000);

    return () => { clearTimeout(timeout); unsub(); };
  }, [uid, isFollowers]);

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
        count={loading ? undefined : users.length}
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
      ) : users.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 }}>
          <Feather name="users" size={40} color={C.mutedLight} />
          <Text style={{ color: C.muted, fontSize: 16, marginTop: 16 }}>
            {isFollowers ? 'No followers yet' : 'Not following anyone yet'}
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <View style={cardStyle}>
            {users.map((item, i) => (
              <UserRow key={item.uid} user={item} onPress={() => handleUserPress(item)} last={i === users.length - 1} />
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
