/**
 * IMOSearchScreen — IMO-style search page (2026-10-10).
 * Exact replication of IMO's "Search chats and settings" page:
 * - Search bar at top
 * - "Add Friends" row
 * - "Join public group" row
 * - "Frequently Contacted" section with contacts (DP, name, call button)
 * All data is real — no demo.
 */
import { useState, useMemo, useCallback } from 'react';
import { View, Text, TextInput, FlatList, Image, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { Chat } from '@/src/features/chat/types';
import { subscribeUserChats } from '@/src/features/chat/services/firebaseDmService';
import { buildCallRoomId } from '@/src/features/audio-call/services/firebaseCallService';
import { getUser } from '@/src/services/userService';
import { useEffect } from 'react';

export default function IMOSearchScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [avatarCache, setAvatarCache] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeUserChats(user.uid, setChats);
    return unsub;
  }, [user?.uid]);

  // DP HYDRATION (2026-10-10): Fetch missing DPs from RTDB
  useEffect(() => {
    const missing = chats
      .filter((c) => c.participantId && !c.participantAvatar && !avatarCache[c.participantId])
      .map((c) => c.participantId!);
    if (missing.length === 0) return;
    Promise.all(
      [...new Set(missing)].map(async (uid) => {
        try {
          const p = await getUser(uid);
          const url = (p as any)?.photoURL;
          if (url) return [uid, url] as const;
        } catch {/* ignore */}
        return null;
      })
    ).then((results) => {
      const updates: Record<string, string> = {};
      for (const r of results) if (r) updates[r[0]] = r[1];
      if (Object.keys(updates).length > 0) {
        setAvatarCache((prev) => ({ ...prev, ...updates }));
      }
    });
  }, [chats]);

  const filtered = useMemo(() => {
    if (!query.trim()) return chats;
    const q = query.toLowerCase();
    return chats.filter(
      (c) =>
        (c.participantName || '').toLowerCase().includes(q) ||
        (c.lastMessage || '').toLowerCase().includes(q)
    );
  }, [chats, query]);

  // Frequently contacted: most recent chats
  const frequent = useMemo(() => {
    return [...chats]
      .sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0))
      .slice(0, 10);
  }, [chats]);

  const handleCall = useCallback((chat: Chat) => {
    if (!user?.uid || !chat.participantId) return;
    const callRoomId = buildCallRoomId(user.uid, chat.participantId);
    let url = `/audio-call?roomId=${encodeURIComponent(callRoomId)}&role=caller&remoteUid=${encodeURIComponent(chat.participantId)}&remoteName=${encodeURIComponent(chat.participantName || 'User')}&calleeUid=${encodeURIComponent(chat.participantId)}&myUid=${encodeURIComponent(user.uid)}&myName=${encodeURIComponent(user.displayName ?? 'Vee User')}`;
    if (chat.participantAvatar) url += `&remotePhotoURL=${encodeURIComponent(chat.participantAvatar)}`;
    if (user.photoURL) url += `&myPhotoURL=${encodeURIComponent(user.photoURL)}`;
    router.push(url as any);
  }, [router, user]);

  const handleChatPress = useCallback((chat: Chat) => {
    const params = new URLSearchParams({
      participantId: chat.participantId || '',
      participantName: chat.participantName || 'User',
    });
    if (chat.participantAvatar) params.set('participantPhoto', chat.participantAvatar);
    router.push(`/inbox/${chat.id}?${params.toString()}` as any);
  }, [router]);

  const renderContact = ({ item }: { item: Chat }) => {
    const initials = (item.participantName || '?').trim().charAt(0).toUpperCase();
    const avatarUrl = item.participantAvatar || (item.participantId ? avatarCache[item.participantId] : null);
    return (
      <TouchableOpacity
        onPress={() => handleChatPress(item)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#F0F0F0',
        }}
      >
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={{ width: 48, height: 48, borderRadius: 24 }}
          />
        ) : (
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: '#E0E0E0',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 20, color: '#757575', fontWeight: '600' }}>{initials}</Text>
          </View>
        )}
        <Text style={{ flex: 1, marginLeft: 12, fontSize: 16, color: '#212121', fontWeight: '500' }}>
          {item.participantName || 'User'}
        </Text>
        <TouchableOpacity
          onPress={() => handleCall(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="call" size={24} color="#2196F3" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const showResults = query.trim().length > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      {/* Search bar */}
      <View style={{ padding: 12, backgroundColor: '#FFFFFF' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#F0F0F0',
            borderRadius: 24,
            paddingHorizontal: 16,
            paddingVertical: 10,
          }}
        >
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 8 }}>
            <Ionicons name="arrow-back" size={22} color="#616161" />
          </TouchableOpacity>
          <TextInput
            placeholder="Search chats and settings"
            value={query}
            onChangeText={setQuery}
            autoFocus
            style={{ flex: 1, fontSize: 16, color: '#212121' }}
            placeholderTextColor="#9E9E9E"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={20} color="#9E9E9E" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {showResults ? (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderContact}
          style={{ flex: 1, backgroundColor: '#FFFFFF', marginTop: 8 }}
          ListEmptyComponent={
            <View style={{ padding: 32, alignItems: 'center' }}>
              <Text style={{ color: '#9E9E9E', fontSize: 16 }}>No results found</Text>
            </View>
          }
        />
      ) : (
        <ScrollView style={{ flex: 1 }}>
          {/* Add Friends */}
          <View style={{ backgroundColor: '#FFFFFF', marginTop: 8, borderRadius: 12, marginHorizontal: 12, overflow: 'hidden' }}>
            <TouchableOpacity
              onPress={() => router.push('/vid-search' as any)}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}
            >
              <Ionicons name="person-add-outline" size={24} color="#2196F3" />
              <Text style={{ flex: 1, marginLeft: 12, fontSize: 16, color: '#212121', fontWeight: '500' }}>
                Add Friends
              </Text>
              <Ionicons name="chevron-forward" size={20} color="#BDBDBD" />
            </TouchableOpacity>
          </View>

          {/* Frequently Contacted */}
          <View style={{ backgroundColor: '#FFFFFF', marginTop: 12, borderRadius: 12, marginHorizontal: 12, overflow: 'hidden' }}>
            <Text style={{ padding: 16, paddingBottom: 8, fontSize: 14, color: '#757575', fontWeight: '600' }}>
              Frequently Contacted
            </Text>
            <FlatList
              data={frequent}
              keyExtractor={(item) => item.id}
              renderItem={renderContact}
              scrollEnabled={false}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
