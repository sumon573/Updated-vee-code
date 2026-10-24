/**
 * IMOHomeScreen — IMO-style home shell (2026-10-19).
 * 5-tab IMO layout: Chats · Contacts · Stories · Calls · Me (bottom text tabs).
 * - Chats: search bar + story strip + chat list (IMOChatListItem — owned by chat agent, not restyled here)
 * - Contacts: existing ContactsScreen
 * - Stories: StoriesTabScreen (story groups list)
 * - Calls: CallsTabScreen (call history)
 * - Me: navigates to /profile (profile screens untouched)
 * Voice rooms: floating action button on Chats tab → full-screen VoiceRoomHome modal.
 * Planet: via story strip entry (existing '__planet__' handling).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, FlatList, Text, Alert, RefreshControl, TouchableOpacity, Modal, Image, Platform, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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
import type { CallHistoryEntry } from '@/src/features/audio-call/services/callHistoryService';
import { useStories } from '@/src/features/chat/hooks/useStories';
import { subscribeUser, type VeeUser } from '@/src/services/userService';
import { getUser } from '@/src/services/userService';
import IMOStoryRow, { type IMOStory } from '@/src/features/home/components/IMOStoryRow';
import { UniversalContentRenderer } from '@/src/components/UniversalContentRenderer';
import IMOChatListItem, { type IMOChat } from '@/src/features/home/components/IMOChatListItem';
import ChatLongPressMenu from '@/src/features/home/components/ChatLongPressMenu';
import IMOTabBar, { type HomeTab } from '@/src/features/home/components/IMOTabBar';
import StoriesTabScreen from '@/src/features/home/components/StoriesTabScreen';
import CallsTabScreen from '@/src/features/home/components/CallsTabScreen';
import VoiceRoomHome from '@/src/features/voice-room/screens/VoiceRoomHome';
import MinimizedRoomBar from '@/src/features/voice-room/components/MinimizedRoomBar';
import ContactsScreen from '@/src/features/contacts/ContactsScreen';
import StoryViewer from '@/src/features/chat/screens/StoryViewer';
import StoryCreator from '@/src/features/chat/screens/StoryCreator';

type ContentTab = Exclude<HomeTab, 'me'>;

export default function IMOHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ContentTab>('chats');
  const [chats, setChats] = useState<Chat[]>([]);
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // 2026-10-19 polish: pull-to-refresh + empty state on the chat list.
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [chatsReady, setChatsReady] = useState(false);
  const [storyViewerVisible, setStoryViewerVisible] = useState(false);
  const [storyViewerIndex, setStoryViewerIndex] = useState(0);
  const [storyCreatorVisible, setStoryCreatorVisible] = useState(false);
  // Voice rooms entry (FAB → full-screen modal)
  const [voiceRoomsVisible, setVoiceRoomsVisible] = useState(false);
  // Missed-call badge for the Calls tab
  const [missedCalls, setMissedCalls] = useState(0);
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
          // Perf guard (2026-10-22 audit): subscribeUser fires on ANY field
          // change of the full user node (presence/lastSeen churn included).
          // Only name/photoURL matter here — skip the state write when they
          // are unchanged so the whole home shell stops re-rendering.
          setLiveProfiles((prev) => {
            const photo = p.photoURL || undefined;
            const cur = prev[uid];
            if (cur && cur.name === p.name && cur.photoURL === photo) return prev;
            return { ...prev, [uid]: { name: p.name, photoURL: photo } };
          });
        }),
      );
    }
    return () => {
      for (const u of unsubs) u();
    };
    // FIX (2026-10-19): order-insensitive dep key. The old key
    // (chats.map(...).join(',')) changed on every reorder — i.e. every
    // incoming message — tearing down and recreating ALL per-participant
    // listeners. Now the effect only re-runs when the UID *set* changes.
  }, [Array.from(new Set(chats.map((c) => c.participantId))).sort().join(',')]);

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
      if (!cancelled && cached) {
        setChats(cached);
        setChatsReady(true);
      }
    });
    const unsub = subscribeUserChats(uid, (live) => {
      if (cancelled) return;
      setChats(live);
      setChatsReady(true);
      // 2026-10-19 polish: pull-to-refresh re-subscribes, which fires this
      // callback immediately with fresh data — end the spinner here.
      if (refreshingRef.current) {
        refreshingRef.current = false;
        setRefreshing(false);
      }
      saveChatList(uid, live);
    });
    return () => {
      cancelled = true;
      unsub();
    };
    // refreshTick forces a fresh subscription = a real re-pull on refresh.
  }, [user?.uid, refreshTick]);

  // 2026-10-19 polish: pull-to-refresh. Re-subscribing re-reads userChats
  // immediately (onValue fires on subscribe); the spinner ends in the
  // callback above. Backstop clears it if the callback never fires.
  const handleRefresh = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
    setTimeout(() => {
      if (refreshingRef.current) {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    }, 8000);
  }, []);

  // Stories (already loaded above via useStories)
  // Convert to IMO format — live profile name/DP wins over cached values
  // (2026-10-11 Issue #4).
  // 2026-10-19 perf: useMemo'd — the old inline map rebuilt fresh object
  // identities on EVERY parent render, defeating row memoization.
  const imoChats: IMOChat[] = useMemo(() => chats
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
  }), [chats, liveProfiles, avatarCache]);

  // 2026-10-19 perf: fixed row heights (76px; 84px for the taller voice-club
  // ring rows) with memoized prefix-sum offsets, so FlatList can skip
  // per-row measurement. No scrollToIndex is used on this list; the layout
  // only feeds the renderer's windowing math.
  const rowOffsets = useMemo(() => {
    const offsets: number[] = new Array(imoChats.length);
    let y = 0;
    for (let i = 0; i < imoChats.length; i += 1) {
      offsets[i] = y;
      y += imoChats[i].isVoiceClub ? 84 : 76;
    }
    return offsets;
  }, [imoChats]);
  const getRowLayout = useCallback((_data: ArrayLike<IMOChat> | null | undefined, index: number) => {
    const h = _data?.[index]?.isVoiceClub ? 84 : 76;
    return { length: h, offset: rowOffsets[index] ?? index * 76, index };
  }, [rowOffsets]);

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

  const handleTabPress = useCallback((tab: HomeTab) => {
    if (tab === 'me') {
      // Me → Vee profile (profile screens owned elsewhere; navigate only)
      router.push('/profile' as any);
      return;
    }
    setActiveTab(tab);
  }, [router]);

  const handleMissedCountChange = useCallback((n: number) => {
    setMissedCalls(n);
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
  }, [router]);

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

  // Shared call starter — used by chat-row call buttons and call-history call-back.
  const startCall = useCallback((participantId: string, name: string, photoURL?: string | null) => {
    if (!user?.uid || !participantId) return;
    // P1 fix (2026-10-12): busy guard — never dial while a call is active/minimized.
    if (getMinimizedCall()) {
      Alert.alert('ইতিমধ্যে একটি কলে আছেন', 'আপনি ইতিমধ্যে একটি কলে আছেন। নতুন কল শুরুর আগে বর্তমান কলটি শেষ করুন।');
      return;
    }
    const callRoomId = buildCallRoomId(user.uid, participantId);
    let url = `/audio-call?roomId=${encodeURIComponent(callRoomId)}&role=caller&remoteUid=${encodeURIComponent(participantId)}&remoteName=${encodeURIComponent(name)}&calleeUid=${encodeURIComponent(participantId)}&myUid=${encodeURIComponent(user.uid)}&myName=${encodeURIComponent(user.displayName || 'Vee User')}`;
    if (photoURL) url += `&remotePhotoURL=${encodeURIComponent(photoURL)}`;
    if (user.photoURL) url += `&myPhotoURL=${encodeURIComponent(user.photoURL)}`;
    router.push(url as any);
  }, [router, user]);

  const handleCallPress = useCallback((chat: IMOChat) => {
    if (!chat.participantId) return;
    startCall(chat.participantId, chat.name, chat.photoURL);
  }, [startCall]);

  const handleCallBack = useCallback((entry: CallHistoryEntry) => {
    startCall(entry.remoteUid, entry.remoteName || 'Vee User', entry.remotePhotoURL);
  }, [startCall]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      {/* 2026-10-24 (boss: no more builds): server-driven content surface.
          Renders nothing until RTDB `app_content` carries a 'home' item. */}
      <UniversalContentRenderer location="home" uid={user?.uid} />
      {activeTab === 'chats' && (
        <View style={{ flex: 1 }}>
          {/* IMO search bar — rounded #f4f5f5, magnifier + "Search" hint */}
          <TouchableOpacity
            onPress={() => router.push('/search' as any)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#F4F5F5',
              borderRadius: 18,
              marginHorizontal: 15,
              marginTop: 10,
              marginBottom: 4,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Ionicons name="search" size={18} color="#788187" />
            <Text style={{ marginLeft: 8, fontSize: 14, color: '#788187' }}>Search</Text>
          </TouchableOpacity>
          <IMOStoryRow
            stories={imoStories}
            onAddStory={handleAddStory}
            onStoryPress={handleStoryPress}
          />
          <FlatList
            data={imoChats}
            keyExtractor={(item) => item.id}
            getItemLayout={getRowLayout}
            windowSize={11}
            initialNumToRender={15}
            maxToRenderPerBatch={10}
            removeClippedSubviews={Platform.OS === 'android'}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
            // 2026-10-19 polish: empty state — only after the first load so the
            // cached/live fetch doesn't flash "no chats" while loading.
            ListEmptyComponent={chatsReady ? (
              <View style={{ alignItems: 'center', paddingTop: 90, paddingHorizontal: 32 }}>
                <Text style={{ fontSize: 52, marginBottom: 14 }}>💬</Text>
                <Text style={{ fontSize: 17, fontWeight: '700', color: '#111111' }}>
                  No chats yet
                </Text>
                <Text style={{ fontSize: 13, color: '#666666', marginTop: 6, textAlign: 'center' }}>
                  Start a conversation from the Contacts tab
                </Text>
              </View>
            ) : null}
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
          {/* 2026-10-20 (boss): voice FAB removed — Rooms now lives in the
              bottom tab bar (Chats · Rooms · Contacts · DP). */}
        </View>
      )}

      {activeTab === 'contacts' && <ContactsScreen />}

      {activeTab === 'stories' && (
        <StoriesTabScreen
          stories={stories}
          myUserId={user?.uid}
          myAvatar={profile?.photoURL || user?.photoURL || null}
          onStoryPress={handleStoryPress}
          onAddStory={handleAddStory}
        />
      )}

      {activeTab === 'calls' && (
        <CallsTabScreen
          onCallBack={handleCallBack}
          onMissedCountChange={handleMissedCountChange}
        />
      )}

      {/* Shared story viewer/creator (chats-tab strip + stories tab) */}
      <StoryViewer
        visible={storyViewerVisible}
        startUserIndex={storyViewerIndex}
        stories={stories}
        onClose={() => setStoryViewerVisible(false)}
        currentUserId={user?.uid}
        currentUserName={user?.displayName ?? undefined}
        onReact={react}
        onComment={comment}
        // 2026-10-19 polish: await the delete — StoryViewer awaits this and
        // surfaces a failure alert; a rejection must not be swallowed here.
        onDelete={async (storyId) => { await remove(storyId); }}
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

      {/* Voice rooms full-screen modal */}
      <Modal
        visible={voiceRoomsVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setVoiceRoomsVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          {/* 2026-10-23 (Sumon): the close (✕) button now lives inside
              VoiceRoomHome's own header row, right of the search icon —
              the old floating corner button is gone. */}
          <VoiceRoomHome onClose={() => setVoiceRoomsVisible(false)} />
          {/* 2026-10-22 (Sumon): the minimized-room bar is mounted in the
              root layout, but an RN Modal renders ABOVE it — so the bar
              never showed on this screen. A second, store-driven instance
              lives inside the modal (no tab bar here → small offset). */}
          <MinimizedRoomBar bottomOffsetOverride={20} />
        </SafeAreaView>
      </Modal>

      {/* NOTE 5: IMO-style network status bar (home screen bottom). */}
      <NetworkStatusBar />
      <IMOTabBar
        activeTab={activeTab}
        chatsBadgeCount={totalUnread}
        callsBadgeCount={missedCalls}
        myAvatar={profile?.photoURL || user?.photoURL || null}
        onTabPress={handleTabPress}
        onRoomsPress={() => setVoiceRoomsVisible(true)}
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
