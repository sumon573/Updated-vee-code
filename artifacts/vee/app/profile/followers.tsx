/**
 * Followers / Following List Screen
 * Route params: type ('followers' | 'following'), uid (whose list to show)
 */

import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator,
  Pressable, Image, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { ref, get, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { VeeUser } from '@/src/services/userService';
import * as Haptics from 'expo-haptics';

const C = {
  bg: '#FFFFFF',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  text: '#000000',
  muted: '#8E8E93',
  dim: '#C7C7CC',
  border: '#E5E5EA',
  surface: '#F2F2F7',
} as const;

function UserRow({ user, onPress }: { user: VeeUser; onPress: () => void }) {
  const initials = user.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: C.surface, borderRadius: 16,
        padding: 12, marginBottom: 10,
        borderWidth: 1, borderColor: C.border,
      }}
    >
      {user.photoURL ? (
        <Image
          source={{ uri: user.photoURL }}
          style={{ width: 48, height: 48, borderRadius: 24, marginRight: 14 }}
        />
      ) : (
        <View style={{
          width: 48, height: 48, borderRadius: 24, marginRight: 14,
          backgroundColor: 'rgba(139,92,246,0.25)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900' }}>{initials}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>{user.name}</Text>
        {user.vId ? (
          <Text style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>#{user.vId}</Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={16} color={C.dim} />
    </Pressable>
  );
}

export default function FollowersScreen() {
  const { type, uid } = useLocalSearchParams<{ type: string; uid: string }>();
  const [activeTab, setActiveTab] = useState<'followers' | 'following'>(type === 'following' ? 'following' : 'followers');
  const isFollowers = activeTab === 'followers';
  const topPad = Platform.OS === 'web' ? 67 : 0;

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
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: topPad + 10, paddingBottom: 16,
        }}>
          <Pressable onPress={() => router.back()} hitSlop={14} style={{ marginRight: 12 }}>
            <Feather name="arrow-left" size={24} color={C.text} />
          </Pressable>
          <Text style={{ color: C.text, fontSize: 20, fontWeight: '900', flex: 1 }}>
            {isFollowers ? 'Followers' : 'Following'}
          </Text>
          <Text style={{ color: C.muted, fontSize: 14 }}>{users.length}</Text>
        </View>

        {/* ─── Tabs ─── */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8 }}>
          {(['followers', 'following'] as const).map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={{
                flex: 1, paddingVertical: 10, alignItems: 'center',
                borderBottomWidth: 2,
                borderBottomColor: activeTab === tab ? C.text : 'transparent',
              }}
            >
              <Text style={{
                fontSize: 15, fontWeight: activeTab === tab ? '800' : '500',
                color: activeTab === tab ? C.text : C.muted,
              }}>
                {tab === 'followers' ? 'Followers' : 'Following'}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={C.glow} size="large" />
          </View>
        ) : users.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 }}>
            <Feather name="users" size={40} color={C.dim} />
            <Text style={{ color: C.muted, fontSize: 16, marginTop: 16 }}>
              {isFollowers ? 'No followers yet' : 'Not following anyone yet'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={users}
            keyExtractor={(item) => item.uid}
            renderItem={({ item }) => (
              <UserRow user={item} onPress={() => handleUserPress(item)} />
            )}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    </View>
  );
}
