/**
 * Chat Screen — ধাপ ৪ + ৫
 * Chat list: Firebase Realtime DB।
 * Story bar: Firebase real-time stories (ধাপ ৫)।
 * New Chat: UserSearchModal দিয়ে user খুঁজে DM শুরু।
 * Pin/Unpin: Long-press on chat item।
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, FlatList, Platform, Alert } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import StoryBar from '@/src/features/chat/components/StoryBar';
import ChatListItem from '@/src/features/chat/components/ChatListItem';
import StoryViewer from '@/src/features/chat/screens/StoryViewer';
import StoryCreator from '@/src/features/chat/screens/StoryCreator';
import UserSearchModal from '@/src/features/user-search/UserSearchModal';
import { Chat } from '@/src/features/chat/types';
import {
  subscribeUserChats, pinChat, unpinChat, clearChat } from '@/src/features/chat/services/firebaseDmService';
import { CoupleInviteCard, type CoupleInviteSenderProfile } from '@/src/features/intimacy/CoupleInviteCard';
import {
  subscribeIncomingCoupleInvites, acceptCoupleInvite, rejectCoupleInvite,
  type CoupleInvite,
} from '@/src/features/intimacy/coupleService';
import { FriendInviteCard, type FriendInviteSenderProfile } from '@/src/features/intimacy/FriendInviteCard';
import {
  subscribeIncomingFriendInvites, acceptFriendInvitation, rejectFriendInvitation,
  type FriendInvite,
} from '@/src/features/intimacy/friendService';
import { fetchPeerProfile } from '@/src/features/voice-room/services/intimacyService';
import { deleteStory } from '@/src/features/chat/services/firebaseStoryService';
import { useStories } from '@/src/features/chat/hooks/useStories';
import { useAuth } from '@/src/context/AuthContext';
import { VeeUser } from '@/src/services/userService';

const C = {
  bg: '#FFFFFF',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  text: '#000000',
  muted: '#8E8E93',
  dim: '#C7C7CC',
  border: '#E5E5EA',
  inputBg: '#F2F2F7',
  glass: '#F2F2F7' } as const;

type ChatScreenProps = {
  /** Called when the user taps the Planet bubble in the story bar. */
  onOpenPlanet?: () => void;
};

export default function ChatScreen({ onOpenPlanet }: ChatScreenProps = {}) {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();

  // ── Chat list (Firebase) ──────────────────────────────────────────────────
  const [chats, setChats]               = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeUserChats(user.uid, (firebaseChats) => {
      setChats(firebaseChats);
      setLoadingChats(false);
    });
    const timeout = setTimeout(() => setLoadingChats(false), 3000);
    return () => { unsub(); clearTimeout(timeout); };
  }, [user?.uid]);

  // ── Couple invitations (Builder D 2026-10-26) ─────────────────────────────
  // Rendered ONLY in ListHeaderComponent below — never injected into the
  // FlatList data (typed Chat list, fixed 73px getItemLayout). Own
  // subscription on couple_invites by recipientUid; keys are
  // `couple-invite:{inviteId}` so they can never collide with a chatId.
  const [coupleInvites, setCoupleInvites] = useState<CoupleInvite[]>([]);
  const [coupleSenderProfiles, setCoupleSenderProfiles] = useState<Record<string, CoupleInviteSenderProfile>>({});
  // Invites acted on this session stay visible with their terminal text
  // ("Accepted" / "Declined") instead of vanishing mid-tap; on a fresh
  // mount only pending invites show.
  const [actedCoupleInviteIds, setActedCoupleInviteIds] = useState<string[]>([]);

  useEffect(() => {
    if (!user?.uid) return;
    return subscribeIncomingCoupleInvites(user.uid, setCoupleInvites);
  }, [user?.uid]);

  useEffect(() => {
    const missing = coupleInvites
      .map((i) => i.senderUid)
      .filter((uid) => uid && !coupleSenderProfiles[uid]);
    if (missing.length === 0) return;
    let live = true;
    Promise.all(missing.map(async (uid) => {
      const p = await fetchPeerProfile(uid).catch(() => ({ name: '', photoURL: null }));
      return [uid, { name: p.name || '', photoURL: p.photoURL ?? null }] as const;
    })).then((pairs) => {
      if (!live) return;
      setCoupleSenderProfiles((prev) => {
        const next = { ...prev };
        for (const [uid, profile] of pairs) next[uid] = profile;
        return next;
      });
    });
    return () => { live = false; };
  }, [coupleInvites, coupleSenderProfiles]);

  const visibleCoupleInvites = coupleInvites.filter(
    (i) => i.status === 'pending' || actedCoupleInviteIds.includes(i.id),
  );

  // ── Friend invitations (2026-10-27, friendship correction) ───────────
  // Same ListHeader-only pattern as couple invites: own subscription on
  // friend_invites by recipientUid; keys are `friend-invite:{inviteId}`.
  const [friendInvites, setFriendInvites] = useState<FriendInvite[]>([]);
  const [friendSenderProfiles, setFriendSenderProfiles] = useState<Record<string, FriendInviteSenderProfile>>({});
  const [actedFriendInviteIds, setActedFriendInviteIds] = useState<string[]>([]);

  useEffect(() => {
    if (!user?.uid) return;
    return subscribeIncomingFriendInvites(user.uid, setFriendInvites);
  }, [user?.uid]);

  useEffect(() => {
    const missing = friendInvites
      .map((i) => i.senderUid)
      .filter((uid) => uid && !friendSenderProfiles[uid]);
    if (missing.length === 0) return;
    let live = true;
    Promise.all(missing.map(async (uid) => {
      const p = await fetchPeerProfile(uid).catch(() => ({ name: '', photoURL: null }));
      return [uid, { name: p.name || '', photoURL: p.photoURL ?? null }] as const;
    })).then((pairs) => {
      if (!live) return;
      setFriendSenderProfiles((prev) => {
        const next = { ...prev };
        for (const [uid, profile] of pairs) next[uid] = profile;
        return next;
      });
    });
    return () => { live = false; };
  }, [friendInvites, friendSenderProfiles]);

  const visibleFriendInvites = friendInvites.filter(
    (i) => i.status === 'pending' || actedFriendInviteIds.includes(i.id),
  );

  const handleAcceptCoupleInvite = useCallback(async (invite: CoupleInvite) => {
    if (!user?.uid) return;
    try {
      await acceptCoupleInvite(invite.id, user.uid);
      setActedCoupleInviteIds((prev) => (prev.includes(invite.id) ? prev : [...prev, invite.id]));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      // Expired accepts throw 'This invitation has expired' — the card
      // already renders Expired for a past-deadline pending invite.
      Alert.alert(t('chat.error'), e instanceof Error ? e.message : t('chat.error'));
      throw e;
    }
  }, [user?.uid, t]);

  const handleRejectCoupleInvite = useCallback(async (invite: CoupleInvite) => {
    if (!user?.uid) return;
    try {
      await rejectCoupleInvite(invite.id, user.uid);
      setActedCoupleInviteIds((prev) => (prev.includes(invite.id) ? prev : [...prev, invite.id]));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t('chat.error'), e instanceof Error ? e.message : t('chat.error'));
      throw e;
    }
  }, [user?.uid, t]);

  const handleAcceptFriendInvite = useCallback(async (invite: FriendInvite) => {
    if (!user?.uid) return;
    try {
      await acceptFriendInvitation(invite.id, user.uid);
      setActedFriendInviteIds((prev) => (prev.includes(invite.id) ? prev : [...prev, invite.id]));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t('chat.error'), e instanceof Error ? e.message : t('chat.error'));
      throw e;
    }
  }, [user?.uid, t]);

  const handleRejectFriendInvite = useCallback(async (invite: FriendInvite) => {
    if (!user?.uid) return;
    try {
      await rejectFriendInvitation(invite.id, user.uid);
      setActedFriendInviteIds((prev) => (prev.includes(invite.id) ? prev : [...prev, invite.id]));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(t('chat.error'), e instanceof Error ? e.message : t('chat.error'));
      throw e;
    }
  }, [user?.uid, t]);

  // 2026-10-19 stability fix (batch 2D): clear the app icon badge whenever
  // the chat list gains focus — the user has seen the conversations.
  useFocusEffect(useCallback(() => {
    import('@/src/services/fcmPushService').then(({ clearAppBadge }) => {
      clearAppBadge().catch(() => {});
    }).catch(() => {});
  }, []));

  // ── Stories (Firebase, ধাপ ৫) ─────────────────────────────────────────────
  const {
    stories, loading: storiesLoading,
    publish, recordView, react: reactStory, markGroupSeen } = useStories();

  const [search, setSearch]             = useState('');
  const [searchActive, setSearchActive] = useState(false);

  // Story viewer
  const [viewerOpen, setViewerOpen]         = useState(false);
  const [viewerStartIdx, setViewerStartIdx] = useState(0);

  // Story creator
  const [creatorOpen, setCreatorOpen] = useState(false);

  // New chat (user search)
  const [searchModalOpen, setSearchModalOpen] = useState(false);

  const openStory = useCallback((idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setViewerStartIdx(idx);
    setViewerOpen(true);
    if (stories[idx]) markGroupSeen(stories[idx].userId);
  }, [stories, markGroupSeen]);

  const openCreator = useCallback(() => setCreatorOpen(true), []);

  /** Called by StoryCreator after Cloudinary upload (for images) or text entry */
  const handlePublishStory = useCallback(async (story: {
    type: 'text' | 'image';
    content: string;
    bgGradient: [string, string];
    mentions: string[];
    privacy: 'public' | 'contacts';
  }) => {
    try {
      await publish({
        type: story.type,
        content: story.content,
        bgGradient: story.bgGradient,
        mentions: story.mentions,
        privacy: story.privacy });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [publish]);

  const handleDeleteStory = useCallback((storyId: string, userId: string) => {
    deleteStory(userId, storyId).catch(() => {
      Alert.alert(t('chat.error'), t('chat.storyDeleteError'));
    });
  }, [t]);

  const handleChatPress = useCallback((chat: Chat) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(
      `/inbox/${chat.id}?participantId=${encodeURIComponent(chat.participantId)}&participantName=${encodeURIComponent(chat.participantName)}` as never,
    );
  }, [router]);

  /** Pin/Unpin / View Profile / Delete Chat History — long press on a chat item */
  const handleChatLongPress = useCallback((chat: Chat) => {
    if (!user?.uid) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const isPinned = chat.isPinned === true;
    Alert.alert(
      chat.participantName,
      '',
      [
        {
          text: isPinned ? t('chat.unpinChat') : t('chat.pinChat'),
          onPress: async () => {
            try {
              if (isPinned) {
                await unpinChat(user.uid, chat.id);
              } else {
                await pinChat(user.uid, chat.id);
              }
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {
              Alert.alert(t('chat.error'), t('chat.pinError'));
            }
          } },
        {
          text: 'View Profile',
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(
              `/user-profile?uid=${encodeURIComponent(chat.participantId)}&name=${encodeURIComponent(chat.participantName)}` as never,
            );
          } },
        {
          text: 'Delete Chat History',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete Chat History',
              `Clear all messages with ${chat.participantName}? This only removes them for you.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await clearChat(chat.id, user.uid);
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    } catch {
                      Alert.alert(t('chat.error'), 'Could not delete chat history.');
                    }
                  } },
              ],
            );
          } },
        { text: t('chat.cancel'), style: 'cancel' },
      ],
    );
  }, [user?.uid, t, router]);

  // H4 fix: stable id-based handlers so renderItem doesn't create fresh
  // closures per row (which defeats ChatListItem's memo).
  const handleChatPressById = useCallback((chatId: string) => {
    const chat = regularChatsRef.current.find((c: Chat) => c.id === chatId)
      ?? pinnedChatsRef.current.find((c: Chat) => c.id === chatId);
    if (chat) handleChatPress(chat);
  }, [handleChatPress]);

  const handleChatLongPressById = useCallback((chatId: string) => {
    const chat = regularChatsRef.current.find((c: Chat) => c.id === chatId)
      ?? pinnedChatsRef.current.find((c: Chat) => c.id === chatId);
    if (chat) handleChatLongPress(chat);
  }, [handleChatLongPress]);

  const renderChatItem = useCallback(({ item }: { item: Chat }) => (
    <ChatListItem
      chat={item}
      onPress={handleChatPressById}
      onLongPress={handleChatLongPressById}
    />
  ), [handleChatPressById, handleChatLongPressById]);

  /** Called when user selects someone from UserSearchModal */
  const handleUserSelected = useCallback((selectedUser: VeeUser, chatId: string) => {
    setSearchModalOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(
      `/inbox/${chatId}?participantId=${encodeURIComponent(selectedUser.uid)}&participantName=${encodeURIComponent(selectedUser.name)}` as never,
    );
  }, [router]);

  const filteredChats = search.trim()
    ? chats.filter((c) =>
        (c.participantName || '').toLowerCase().includes(search.toLowerCase()),
      )
    : chats;

  // Per Sumon 2026-10-12: pinned chats MUST appear at top.
  // Sort as safety net in case section rendering has issues.
  const sortedByPin = [...filteredChats].sort((a, b) => {
    const aPinned = a.isPinned === true ? 1 : 0;
    const bPinned = b.isPinned === true ? 1 : 0;
    return bPinned - aPinned;
  });
  const pinnedChats  = sortedByPin.filter(c => c.isPinned);
  const regularChats = sortedByPin.filter(c => !c.isPinned);

  // H4: refs so stable id-based handlers can find the chat object.
  const pinnedChatsRef = useRef(pinnedChats);
  const regularChatsRef = useRef(regularChats);
  pinnedChatsRef.current = pinnedChats;
  regularChatsRef.current = regularChats;

  // ── Empty state ─────────────────────────────────────────────────────────────
  function EmptyState() {
    return (
      <View style={{ alignItems: 'center', paddingTop: 60 }}>
        <View style={{
          width: 80, height: 80, borderRadius: 40,
          backgroundColor: 'rgba(139,92,246,0.12)',
          borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)',
          alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="message-circle" size={36} color={C.glow} />
        </View>
        <Text style={{ color: C.text, fontSize: 20, fontWeight: '900', marginTop: 18 }}>
          {t('chat.noChats')}
        </Text>
        <Text style={{ color: C.muted, fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 40 }}>
          {t('chat.noChatsSubtitle')}
        </Text>
        <Pressable
          onPress={() => setSearchModalOpen(true)}
          style={{
            marginTop: 22, backgroundColor: C.primary,
            borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 }}
        >
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
            {t('chat.newChat')}
          </Text>
        </Pressable>
      </View>
    );
  }

  // ── List header ──────────────────────────────────────────────────────────────
  function ListHeader() {
    return (
      <View>
        {/* Story bar */}
        <StoryBar
          stories={stories}
          loading={storiesLoading}
          onOpenStory={openStory}
          onOpenCreator={openCreator}
          onOpenPlanet={onOpenPlanet}
        />

        {/* Pending couple invitations — buttons only, no thread navigation */}
        {visibleCoupleInvites.length > 0 && (
          <>
            <Text style={{
              color: C.muted, fontSize: 11, fontWeight: '700',
              letterSpacing: 0.8, marginBottom: 8, marginTop: 4,
              paddingHorizontal: 2 }}>
              {t('coupleInvite.sectionTitle', { defaultValue: 'Couple invitations' })}
            </Text>
            {visibleCoupleInvites.map((invite) => (
              <CoupleInviteCard
                key={`couple-invite:${invite.id}`}
                invite={invite}
                sender={coupleSenderProfiles[invite.senderUid] ?? { name: '', photoURL: null }}
                onAccept={() => handleAcceptCoupleInvite(invite)}
                onReject={() => handleRejectCoupleInvite(invite)}
              />
            ))}
          </>
        )}

        {/* Pending friend invitations — buttons only, no thread navigation */}
        {visibleFriendInvites.length > 0 && (
          <>
            <Text style={{
              color: C.muted, fontSize: 11, fontWeight: '700',
              letterSpacing: 0.8, marginBottom: 8, marginTop: 4,
              paddingHorizontal: 2 }}>
              {t('friendInvite.sectionTitle', { defaultValue: 'Friend invitations' })}
            </Text>
            {visibleFriendInvites.map((invite) => (
              <FriendInviteCard
                key={`friend-invite:${invite.id}`}
                invite={invite}
                sender={friendSenderProfiles[invite.senderUid] ?? { name: '', photoURL: null }}
                onAccept={() => handleAcceptFriendInvite(invite)}
                onReject={() => handleRejectFriendInvite(invite)}
              />
            ))}
          </>
        )}

        {/* Pinned chats */}
        {pinnedChats.length > 0 && (
          <>
            <Text style={{
              color: C.muted, fontSize: 11, fontWeight: '700',
              letterSpacing: 0.8, marginBottom: 8, marginTop: 4,
              paddingHorizontal: 2 }}>
              {t('chat.pinned')}
            </Text>
            {pinnedChats.map(item => (
              <ChatListItem
                key={item.id}
                chat={item}
                onPress={handleChatPressById}
                onLongPress={handleChatLongPressById}
              />
            ))}
            {regularChats.length > 0 && (
              <Text style={{
                color: C.muted, fontSize: 11, fontWeight: '700',
                letterSpacing: 0.8, marginBottom: 8, marginTop: 12,
                paddingHorizontal: 2 }}>
                {t('chat.allMessages')}
              </Text>
            )}
          </>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          {/* ── Top bar ── */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingTop: Platform.OS === 'web' ? 67 : 0,
            paddingBottom: 14 }}>
            <Text style={{ flex: 1, color: C.text, fontSize: 26, fontWeight: '900' }}>
              {t('chat.title')}
            </Text>

            {/* New Chat button */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSearchModalOpen(true);
              }}
              style={{
                width: 42, height: 42, borderRadius: 21,
                backgroundColor: C.glass,
                borderWidth: 1, borderColor: C.border,
                alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="edit" size={18} color={C.muted} />
            </Pressable>
          </View>

          {/* ── Search bar ── */}
          {searchActive || search.length > 0 ? (
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: C.inputBg, borderRadius: 14,
              paddingHorizontal: 12, paddingVertical: 10,
              marginBottom: 12, gap: 8,
              borderWidth: 1, borderColor: C.border }}>
              <Feather name="search" size={16} color={C.muted} />
              <TextInput
                autoFocus
                style={{ flex: 1, color: C.text, fontSize: 15 }}
                placeholder={t('chat.searchActive')}
                placeholderTextColor={C.dim}
                value={search}
                onChangeText={setSearch}
              />
              <Pressable onPress={() => { setSearch(''); setSearchActive(false); }}>
                <Feather name="x" size={16} color={C.muted} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setSearchActive(true)}
              style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: C.inputBg, borderRadius: 14,
                paddingHorizontal: 12, paddingVertical: 10,
                marginBottom: 12, gap: 8,
                borderWidth: 1, borderColor: C.border }}
            >
              <Feather name="search" size={16} color={C.dim} />
              <Text style={{ color: C.dim, fontSize: 15 }}>{t('chat.searchPlaceholder')}</Text>
            </Pressable>
          )}

          {/* ── Loading ── */}
          {loadingChats ? (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <PremiumLoader size="medium" />
            </View>
          ) : (
            /* ── List ── */
            <FlatList
              data={regularChats}
              keyExtractor={(item) => item.id}
              renderItem={renderChatItem}
              // H4: fixed row height (73 = 52 avatar + 20 vertical padding +
              // 1 divider) enables getItemLayout for smooth scroll.
              getItemLayout={(_, index) => ({ length: 73, offset: 73 * index, index })}
              ListHeaderComponent={ListHeader}
              ListEmptyComponent={pinnedChats.length === 0 ? <EmptyState /> : null}
              contentContainerStyle={{ paddingBottom: 120 }}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews
              initialNumToRender={12}
              maxToRenderPerBatch={8}
              windowSize={10}
            />
          )}
        </View>
      </SafeAreaView>

      {/* Story Viewer */}
      <StoryViewer
        visible={viewerOpen}
        startUserIndex={viewerStartIdx}
        stories={stories}
        onClose={() => setViewerOpen(false)}
        currentUserId={user?.uid}
        onDelete={handleDeleteStory}
      />

      {/* Story Creator */}
      <StoryCreator
        visible={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        onPublish={handlePublishStory}
      />

      {/* User Search Modal — New Chat */}
      <UserSearchModal
        visible={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onSelectUser={handleUserSelected}
      />
    </View>
  );
}
