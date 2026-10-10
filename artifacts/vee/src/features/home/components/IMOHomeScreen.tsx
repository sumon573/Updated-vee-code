/**
 * IMOHomeScreen — IMO-style home screen (2026-10-10).
 * Exact replication of IMO home: TopBar + StoryRow + ChatList + BottomBar.
 * Uses existing data hooks (subscribeUserChats, useStories) — UI only.
 */
import { useState, useEffect, useCallback } from 'react';
import { View, FlatList, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { Chat } from '@/src/features/chat/types';
import {
  subscribeUserChats,
} from '@/src/features/chat/services/firebaseDmService';
import { useStories } from '@/src/features/chat/hooks/useStories';
import { subscribeUser, type VeeUser } from '@/src/services/userService';
import IMOTopBar from '@/src/features/home/components/IMOTopBar';
import IMOStoryRow, { type IMOStory } from '@/src/features/home/components/IMOStoryRow';
import IMOChatListItem, { type IMOChat } from '@/src/features/home/components/IMOChatListItem';
import IMOBottomBar from '@/src/features/home/components/IMOBottomBar';
import VoiceRoomHome from '@/src/features/voice-room/screens/VoiceRoomHome';
import ContactsScreen from '@/src/features/contacts/ContactsScreen';

type Tab = 'chat' | 'voice' | 'contacts';

export default function IMOHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [chats, setChats] = useState<Chat[]>([]);
  const [profile, setProfile] = useState<VeeUser | null>(null);

  // Profile
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeUser(user.uid, setProfile);
    return unsub;
  }, [user?.uid]);

  // Chats
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeUserChats(user.uid, setChats);
    return unsub;
  }, [user?.uid]);

  // Stories
  const { stories } = useStories();

  // Convert to IMO format
  const imoChats: IMOChat[] = chats.map((c) => ({
    id: c.id,
    name: c.participantName || 'Unknown',
    photoURL: c.participantAvatar || null,
    lastMessage: c.lastMessage || '',
    lastMessageTime: formatTime(c.lastMessageTime),
    unreadCount: c.unreadCount || 0,
    isPinned: c.isPinned === true,
    isMuted: false, // TODO: add mute support to Chat type if needed
  }));

  const imoStories: IMOStory[] = (stories || []).map((s: any) => ({
    id: s.id || s.userId,
    name: s.userName || 'Story',
    photoURL: s.photoURL || null,
    unreadCount: s.unreadCount || 0,
  }));

  const totalUnread = chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const handleTabPress = useCallback((tab: Tab) => {
    setActiveTab(tab);
  }, []);

  const handleChatPress = useCallback((chatId: string) => {
    router.push(`/chat/${chatId}` as any);
  }, [router]);

  if (activeTab === 'voice') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <IMOTopBar
          profilePhotoURL={profile?.photoURL}
          profileInitials={profile?.name?.charAt(0) || '?'}
          activeTab={activeTab}
          chatBadgeCount={totalUnread}
          onProfilePress={() => router.push('/profile' as any)}
          onTabPress={handleTabPress}
        />
        <VoiceRoomHome />
      </SafeAreaView>
    );
  }

  if (activeTab === 'contacts') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <IMOTopBar
          profilePhotoURL={profile?.photoURL}
          profileInitials={profile?.name?.charAt(0) || '?'}
          activeTab={activeTab}
          chatBadgeCount={totalUnread}
          onProfilePress={() => router.push('/profile' as any)}
          onTabPress={handleTabPress}
        />
        <ContactsScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <IMOTopBar
        profilePhotoURL={profile?.photoURL}
        profileInitials={profile?.name?.charAt(0) || '?'}
        activeTab={activeTab}
        chatBadgeCount={totalUnread}
        onProfilePress={() => router.push('/profile' as any)}
        onTabPress={handleTabPress}
      />
      <IMOStoryRow
        stories={imoStories}
        onAddStory={() => {}}
        onStoryPress={() => {}}
      />
      <FlatList
        data={imoChats}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <IMOChatListItem
            chat={item}
            onPress={handleChatPress}
          />
        )}
        style={{ flex: 1 }}
      />
      <IMOBottomBar
        onAddPress={() => {}}
        onSearchPress={() => {}}
      />
    </SafeAreaView>
  );
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}
