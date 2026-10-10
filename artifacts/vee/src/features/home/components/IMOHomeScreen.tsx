/**
 * IMOHomeScreen — IMO-style home screen (2026-10-10).
 * Exact replication of IMO home: TopBar + StoryRow + ChatList + BottomBar.
 * Uses existing data hooks (subscribeUserChats, useStories) — UI only.
 */
import { useState, useEffect, useCallback } from 'react';
import { View, FlatList, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { Chat } from '@/src/features/chat/types';
import {
  subscribeUserChats,
} from '@/src/features/chat/services/firebaseDmService';
import { buildCallRoomId } from '@/src/features/audio-call/services/firebaseCallService';
import { useStories } from '@/src/features/chat/hooks/useStories';
import { subscribeUser, type VeeUser } from '@/src/services/userService';
import IMOTopBar from '@/src/features/home/components/IMOTopBar';
import IMOStoryRow, { type IMOStory } from '@/src/features/home/components/IMOStoryRow';
import IMOChatListItem, { type IMOChat } from '@/src/features/home/components/IMOChatListItem';
import IMOBottomBar from '@/src/features/home/components/IMOBottomBar';
import VoiceRoomHome from '@/src/features/voice-room/screens/VoiceRoomHome';
import ContactsScreen from '@/src/features/contacts/ContactsScreen';
import StoryViewer from '@/src/features/chat/screens/StoryViewer';
import StoryCreator from '@/src/features/chat/screens/StoryCreator';

type Tab = 'chat' | 'voice' | 'contacts';

export default function IMOHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [chats, setChats] = useState<Chat[]>([]);
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [storyViewerVisible, setStoryViewerVisible] = useState(false);
  const [storyViewerIndex, setStoryViewerIndex] = useState(0);
  const [storyCreatorVisible, setStoryCreatorVisible] = useState(false);
  const { stories, publish } = useStories();

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

  // Stories (already loaded above via useStories)
  // Convert to IMO format
  const imoChats: IMOChat[] = chats
    .filter((c) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (c.participantName || '').toLowerCase().includes(q) ||
             (c.lastMessage || '').toLowerCase().includes(q);
    })
    .map((c) => ({
    id: c.id,
    name: c.participantName || 'Unknown',
    photoURL: c.participantAvatar || null,
    lastMessage: c.lastMessage || '',
    lastMessageTime: formatTime(c.lastMessageTime),
    unreadCount: c.unreadCount || 0,
    isPinned: c.isPinned === true,
    isMuted: false, // TODO: add mute support to Chat type if needed
    participantId: c.participantId,
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

  const handleStoryPress = useCallback((storyId: string) => {
    // Find the user index for this story
    const idx = stories.findIndex((s) => s.stories.some((st) => st.id === storyId));
    if (idx >= 0) {
      setStoryViewerIndex(idx);
      setStoryViewerVisible(true);
    }
  }, [stories]);

  const handleAddStory = useCallback(() => {
    setStoryCreatorVisible(true);
  }, []);

  const handleChatPress = useCallback((chatId: string) => {
    // Find the chat to get participant details for the inbox header
    const chat = imoChats.find((c) => c.id === chatId);
    if (chat) {
      const params = new URLSearchParams({
        participantId: chat.participantId || '',
        participantName: chat.name || 'User',
      });
      if (chat.photoURL) params.set('participantPhoto', chat.photoURL);
      router.push(`/inbox/${chatId}?${params.toString()}` as any);
    } else {
      router.push(`/inbox/${chatId}` as any);
    }
  }, [router, imoChats]);

  const handleCallPress = useCallback((chat: IMOChat) => {
    if (!user?.uid || !chat.participantId) return;
    const callRoomId = buildCallRoomId(user.uid, chat.participantId);
    let url = `/audio-call?roomId=${encodeURIComponent(callRoomId)}&role=caller&remoteUid=${encodeURIComponent(chat.participantId)}&remoteName=${encodeURIComponent(chat.name)}&calleeUid=${encodeURIComponent(chat.participantId)}&myUid=${encodeURIComponent(user.uid)}&myName=${encodeURIComponent(user.displayName ?? 'Vee User')}`;
    if (chat.photoURL) url += `&remotePhotoURL=${encodeURIComponent(chat.photoURL)}`;
    if (user.photoURL) url += `&myPhotoURL=${encodeURIComponent(user.photoURL)}`;
    router.push(url as any);
  }, [router, user]);

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
        onAddStory={handleAddStory}
        onStoryPress={handleStoryPress}
      />
      <FlatList
        data={imoChats}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <IMOChatListItem
            chat={item}
            onPress={handleChatPress}
            onCallPress={handleCallPress}
          />
        )}
        style={{ flex: 1 }}
      />
      <IMOBottomBar
        onAddPress={() => setActiveTab('contacts')}
        onSearchPress={() => setIsSearching(!isSearching)}
      />
      {isSearching && (
        <View style={{ padding: 12, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#EEEEEE' }}>
          <TextInput
            placeholder="Search chats..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            style={{
              backgroundColor: '#F5F5F5',
              borderRadius: 20,
              paddingHorizontal: 16,
              paddingVertical: 10,
              fontSize: 16,
            }}
          />
        </View>
      )}
      <StoryViewer
        visible={storyViewerVisible}
        startUserIndex={storyViewerIndex}
        stories={stories}
        onClose={() => setStoryViewerVisible(false)}
        currentUserId={user?.uid}
      />
      <StoryCreator
        visible={storyCreatorVisible}
        onClose={() => setStoryCreatorVisible(false)}
        onPublish={async (payload) => {
          try {
            await publish(payload);
          } catch (e) {
            console.error('Story publish failed:', e);
          }
          setStoryCreatorVisible(false);
        }}
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
