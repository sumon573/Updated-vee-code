/**
 * IMOHomeScreen — IMO-style home screen (2026-10-10).
 * Exact replication of IMO home: TopBar + StoryRow + ChatList + BottomBar.
 * Uses existing data hooks (subscribeUserChats, useStories) — UI only.
 */
import { useState, useEffect, useCallback } from 'react';
import { View, FlatList, Text, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { getMinimizedCall } from '@/src/features/audio-call/services/callMinimizeStore';
import { Chat } from '@/src/features/chat/types';
import {
  subscribeUserChats,
  pinChat,
  unpinChat,
  muteChat,
  unmuteChat,
  hideChat,
  unhideChat,
  clearChat,
} from '@/src/features/chat/services/firebaseDmService';
// NOTE 5 (2026-10-11): offline-first chat list — cached history renders
// instantly when offline, live subscription keeps it fresh on reconnect.
import { loadChatList, saveChatList } from '@/src/features/chat/services/chatCacheService';
// NOTE 5 (2026-10-11): IMO-style bottom network status bar.
import NetworkStatusBar from '@/src/components/NetworkStatusBar';
import { buildCallRoomId } from '@/src/features/audio-call/services/firebaseCallService';
import { useStories } from '@/src/features/chat/hooks/useStories';
import { subscribeUser, type VeeUser } from '@/src/services/userService';
import { getUser } from '@/src/services/userService';
import IMOTopBar from '@/src/features/home/components/IMOTopBar';
import IMOStoryRow, { type IMOStory } from '@/src/features/home/components/IMOStoryRow';
import IMOChatListItem, { type IMOChat } from '@/src/features/home/components/IMOChatListItem';
import ChatLongPressMenu from '@/src/features/home/components/ChatLongPressMenu';
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
  const [storyViewerVisible, setStoryViewerVisible] = useState(false);
  const [storyViewerIndex, setStoryViewerIndex] = useState(0);
  const [storyCreatorVisible, setStoryCreatorVisible] = useState(false);
  const { stories, publish, react, comment, remove, getContactUids } = useStories();

  // DP HYDRATION (2026-10-10): Cache for missing profile DPs from RTDB
  const [avatarCache, setAvatarCache] = useState<Record<string, string>>({});

  // LIVE PROFILES (2026-10-11 Issue #4): real-time name + DP per chat
  // participant. When someone changes their profile, the chat list updates
  // immediately — no stale cached names/DPs.
  const [liveProfiles, setLiveProfiles] = useState<Record<string, { name?: string; photoURL?: string }>>({});
  useEffect(() => {
    const uids = new Set<string>();
    for (const c of chats) {
      if (c.participantId) uids.add(c.participantId);
    }
    if (uids.size === 0) return;
    const unsubs: Array<() => void> = [];
    for (const uid of uids) {
      unsubs.push(
        subscribeUser(uid, (p) => {
          if (!p) return;
          setLiveProfiles((prev) => ({
            ...prev,
            [uid]: { name: p.name, photoURL: p.photoURL || undefined },
          }));
        }),
      );
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [chats.map((c) => c.participantId).join(',')]);

  // Profile
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeUser(user.uid, setProfile);
    return unsub;
  }, [user?.uid]);

  // Chats — offline-first (NOTE 5, 2026-10-11): show the cached list
  // instantly (works fully offline), then live-subscribe; every live
  // update refreshes the cache. Firebase onValue auto-syncs on reconnect.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    let cancelled = false;
    loadChatList(uid).then((cached) => {
      if (!cancelled && cached) setChats(cached);
    });
    const unsub = subscribeUserChats(uid, (live) => {
      if (cancelled) return;
      setChats(live);
      saveChatList(uid, live);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user?.uid]);

  // Stories (already loaded above via useStories)
  // Convert to IMO format — live profile name/DP wins over cached values
  // (2026-10-11 Issue #4).
  const imoChats: IMOChat[] = chats
    .filter((c) => !(c as any).isHidden) // hidden chats don't show in list
    .map((c) => {
    const live = c.participantId ? liveProfiles[c.participantId] : undefined;
    return {
      id: c.id,
      // 2026-10-13 (Sumon): NEVER show 'Unknown' — use 'Vee User' as fallback.
      // Root cause: test users with empty profiles; production users always have names.
      name: live?.name || c.participantName || 'Vee User',
      photoURL: live?.photoURL || c.participantAvatar || avatarCache[c.participantId || ''] || null,
      lastMessage: c.lastMessage || '',
      lastMessageTime: formatTime(c.lastMessageTime),
      unreadCount: c.unreadCount || 0,
      isPinned: c.isPinned === true,
      isMuted: (c as any).isMuted === true,
      participantId: c.participantId,
    };
  });

  // LONG-PRESS MENU (2026-10-11 Issue #6): imo-style context menu state.
  const [menuChat, setMenuChat] = useState<IMOChat | null>(null);
  const handleLongPress = useCallback((chatId: string) => {
    const chat = imoChats.find((c) => c.id === chatId);
    if (chat) setMenuChat(chat);
  }, [imoChats]);
  const closeMenu = useCallback(() => setMenuChat(null), []);
  const runMenuAction = useCallback(async (fn: () => Promise<void>) => {
    const uid = user?.uid;
    if (!uid || !menuChat) return;
    setMenuChat(null);
    try {
      await fn();
    } catch {
      // Non-critical — Firebase write failed; UI stays consistent via subscription
    }
  }, [user?.uid, menuChat]);

  // Per Sumon 2026-10-12: story row shows ONLY contacts' stories (not public from non-contacts).
  // Public stories go to Planet only.
  const imoStories: IMOStory[] = (stories || [])
    .filter((s: any) => {
      const uid = s.userId;
      if (uid === user?.uid) return true; // own story
      const contacts = getContactUids?.() ?? new Set();
      return contacts.has(uid);
    })
    .map((s: any) => ({
      id: s.userId,
      // Show "You" for the user's own story (like IMO)
      name: (s.userId === user?.uid) ? 'You' : (s.userName || 'Story'),
      photoURL: s.userAvatar || s.photoURL || avatarCache[s.userId] || null,
      unreadCount: s.unreadCount || 0,
    }));

  useEffect(() => {
    const missingUids = new Set<string>();
    // Collect story userIds with missing DPs
    for (const s of (stories || [])) {
      const uid = (s as any).userId;
      if (uid && !(s as any).photoURL && !avatarCache[uid]) {
        missingUids.add(uid);
      }
    }
    // Collect chat participantIds with missing DPs
    for (const c of chats) {
      const pid = c.participantId;
      if (pid && !c.participantAvatar && !avatarCache[pid]) {
        missingUids.add(pid);
      }
    }
    if (missingUids.size === 0) return;
    // Fetch all missing DPs in parallel
    Promise.all(
      [...missingUids].map(async (uid) => {
        try {
          const profile = await getUser(uid);
          const url = (profile as any)?.photoURL;
          if (url) return [uid, url] as const;
        } catch {/* ignore */}
        return null;
      })
    ).then((results) => {
      const updates: Record<string, string> = {};
      for (const r of results) {
        if (r) updates[r[0]] = r[1];
      }
      if (Object.keys(updates).length > 0) {
        setAvatarCache((prev) => ({ ...prev, ...updates }));
      }
    });
  }, [stories, chats]);

  const totalUnread = chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const handleTabPress = useCallback((tab: Tab) => {
    setActiveTab(tab);
  }, []);

  const handleStoryPress = useCallback((storyId: string) => {
    // Planet special case — TikTok-style public feed
    if (storyId === '__planet__') {
      router.push('/planet');
      return;
    }
    // storyId is the user ID (from the row's s.id || s.userId)
    // Find the user group index directly
    const idx = stories.findIndex((s) => s.userId === storyId);
    if (idx >= 0) {
      setStoryViewerIndex(idx);
      setStoryViewerVisible(true);
    }
  }, [stories, router]);

  const handleAddStory = useCallback(() => {
    router.push('/create-story');
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
    // P1 fix (2026-10-12): busy guard — never dial while a call is active/minimized.
    if (getMinimizedCall()) {
      Alert.alert('ইতিমধ্যে একটি কলে আছেন', 'আপনি ইতিমধ্যে একটি কলে আছেন। নতুন কল শুরুর আগে বর্তমান কলটি শেষ করুন।');
      return;
    }
    const callRoomId = buildCallRoomId(user.uid, chat.participantId);
    let url = `/audio-call?roomId=${encodeURIComponent(callRoomId)}&role=caller&remoteUid=${encodeURIComponent(chat.participantId)}&remoteName=${encodeURIComponent(chat.name)}&calleeUid=${encodeURIComponent(chat.participantId)}&myUid=${encodeURIComponent(user.uid)}&myName=${encodeURIComponent(user.displayName || 'Vee User')}`;
    if (chat.photoURL) url += `&remotePhotoURL=${encodeURIComponent(chat.photoURL)}`;
    if (user.photoURL) url += `&myPhotoURL=${encodeURIComponent(user.photoURL)}`;
    router.push(url as any);
  }, [router, user]);

  if (activeTab === 'voice') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <IMOTopBar
          profilePhotoURL={profile?.photoURL || user?.photoURL}
          profileInitials={(profile?.name || user?.displayName)?.charAt(0) || '?'}
          activeTab={activeTab}
          chatBadgeCount={totalUnread}
          onProfilePress={() => router.push('/profile' as any)}
          onTabPress={handleTabPress}
        />
        <VoiceRoomHome />
        {/* NOTE 5: IMO-style network status bar (home screen bottom). */}
        <NetworkStatusBar />
      </SafeAreaView>
    );
  }

  if (activeTab === 'contacts') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <IMOTopBar
          profilePhotoURL={profile?.photoURL || user?.photoURL}
          profileInitials={(profile?.name || user?.displayName)?.charAt(0) || '?'}
          activeTab={activeTab}
          chatBadgeCount={totalUnread}
          onProfilePress={() => router.push('/profile' as any)}
          onTabPress={handleTabPress}
        />
        <ContactsScreen />
        {/* NOTE 5: IMO-style network status bar (home screen bottom). */}
        <NetworkStatusBar />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <IMOTopBar
        profilePhotoURL={profile?.photoURL || user?.photoURL}
        profileInitials={(profile?.name || user?.displayName)?.charAt(0) || '?'}
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
            onLongPress={handleLongPress}
            onCallPress={handleCallPress}
          />
        )}
        style={{ flex: 1 }}
      />
      {/* Long-press context menu (2026-10-11 Issue #6) */}
      <ChatLongPressMenu
        visible={!!menuChat}
        chatName={menuChat?.name ?? ''}
        isPinned={menuChat?.isPinned ?? false}
        isMuted={menuChat?.isMuted ?? false}
        isHidden={false}
        onPin={() => runMenuAction(() =>
          (menuChat?.isPinned ? unpinChat(user!.uid, menuChat!.id) : pinChat(user!.uid, menuChat!.id))
        )}
        onMute={() => runMenuAction(() =>
          (menuChat?.isMuted ? unmuteChat(user!.uid, menuChat!.id) : muteChat(user!.uid, menuChat!.id))
        )}
        onHide={() => runMenuAction(() => hideChat(user!.uid, menuChat!.id))}
        onDeleteHistory={() => runMenuAction(() => clearChat(menuChat!.id, user!.uid))}
        onClose={closeMenu}
      />
      <IMOBottomBar
        onAddPress={() => setActiveTab('voice')}
        onSearchPress={() => router.push('/search' as any)}
      />
      <StoryViewer
        visible={storyViewerVisible}
        startUserIndex={storyViewerIndex}
        stories={stories}
        onClose={() => setStoryViewerVisible(false)}
        currentUserId={user?.uid}
        currentUserName={user?.displayName ?? undefined}
        onReact={react}
        onComment={comment}
        onDelete={(storyId) => remove(storyId)}
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
      {/* NOTE 5: IMO-style network status bar (home screen bottom). */}
      <NetworkStatusBar />
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
