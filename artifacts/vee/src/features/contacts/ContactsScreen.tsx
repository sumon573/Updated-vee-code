/**
 * ContactsScreen — Friends + Friend Requests
 * Following/Followers tabs removed — those live in Profile only.
 * Requests tab split into: People → Me (received) | Me → People (sent).
 */

import { memo, useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, Alert, TextInput, Platform } from 'react-native';
import { Image } from 'expo-image';
import PremiumLoader from '@/src/components/PremiumLoader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { ref, get, remove } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';
import { VeeUser, sanitizeVeeUser } from '@/src/services/userService';
import { buildChatId } from '@/src/features/chat/services/firebaseDmService';
import { update } from 'firebase/database';
import { VerifiedName } from '@/src/components/VerifiedName';
import UserSearchModal from '@/src/features/user-search/UserSearchModal';
import { getBlockDirection, BlockDirection, blockUser, unblockUser, subscribeBlockedUsers } from '@/src/services/blockService';
import { getMinimizedCall } from '@/src/features/audio-call/services/callMinimizeStore';
// 2026-10-13: call room ID always via buildCallRoomId (ac_ prefix) —
// every other entry point uses it; a hand-rolled join here would diverge.
import { buildCallRoomId } from '@/src/features/audio-call/services/firebaseCallService';
import {
  FriendRequest, subscribeIncomingRequests, subscribeFriendUids,
  acceptFriendRequest, rejectFriendRequest, removeFriend,
  cancelFriendRequest, subscribeSentRequestUids } from '@/src/services/friendRequestService';
import { truncateTo12 } from '@/src/utils/truncateName';
import { useTranslation } from 'react-i18next';
import ContactLongPressMenu from './components/ContactLongPressMenu';

const C = {
  bg: '#FFFFFF',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  text: '#000000',
  muted: '#8E8E93',
  dim: '#C7C7CC',
  border: '#E5E5EA',
  surface: '#F2F2F7',
  inputBg: '#F2F2F7',
  online: '#22C55E',
  red: '#EF4444',
  subTabBg: '#F2F2F7' } as const;

function UserAvatar({ user }: { user: VeeUser }) {
  const initials = user.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';
  if (user.photoURL) {
    return (
      <Image
        source={{ uri: user.photoURL }}
        style={{ width: 52, height: 52, borderRadius: 26 }}
      />
    );
  }
  return (
    <View style={{
      width: 52, height: 52, borderRadius: 26,
      backgroundColor: 'rgba(139,92,246,0.3)',
      alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>{initials}</Text>
    </View>
  );
}


/* ── Memoized list rows (2026-10-22 perf audit) ──────────────────────────
   Previously all three FlatLists used inline renderItem JSX, so every
   search keystroke re-rendered every visible row. Rows are memo() now and
   receive only stable useCallback handlers + their own item/busy flag. */
function ContactSeparator() {
  return <View style={{ height: 1, backgroundColor: C.border, marginLeft: 76 }} />;
}

const IncomingRequestRow = memo(function IncomingRequestRow({
  item, busy, onView, onAccept, onReject,
}: {
  item: FriendRequest;
  busy: boolean;
  onView: (u: VeeUser) => void;
  onAccept: (r: FriendRequest) => void;
  onReject: (r: FriendRequest) => void;
}) {
  const user = { uid: item.fromUid, name: item.fromName, vId: item.fromVId, photoURL: item.fromPhoto } as VeeUser;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: C.surface,
      borderRadius: 16, padding: 12, marginBottom: 10,
      borderWidth: 1, borderColor: C.border }}>
      <Pressable onPress={() => onView(user)} style={{ marginRight: 12 }}>
        <UserAvatar user={user} />
      </Pressable>
      <Pressable onPress={() => onView(user)} style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>
          {truncateTo12(item.fromName)}
        </Text>
        <Text style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>
          #{item.fromVId}
        </Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={() => onAccept(item)}
          disabled={busy}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: 'rgba(34,197,94,0.18)',
            borderWidth: 1, borderColor: 'rgba(34,197,94,0.35)',
            alignItems: 'center', justifyContent: 'center' }}
        >
          {busy ? (
            <PremiumLoader size="small" />
          ) : (
            <Feather name="check" size={16} color={C.online} />
          )}
        </Pressable>
        <Pressable
          onPress={() => onReject(item)}
          disabled={busy}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: 'rgba(239,68,68,0.1)',
            borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
            alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name="x" size={16} color={C.red} />
        </Pressable>
      </View>
    </View>
  );
});

const SentRequestRow = memo(function SentRequestRow({
  item, busy, pendingLabel, cancelLabel, onView, onCancel,
}: {
  item: VeeUser;
  busy: boolean;
  pendingLabel: string;
  cancelLabel: string;
  onView: (u: VeeUser) => void;
  onCancel: (uid: string) => void;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: C.surface,
      borderRadius: 16, padding: 12, marginBottom: 10,
      borderWidth: 1, borderColor: C.border }}>
      <Pressable onPress={() => onView(item)} style={{ marginRight: 12 }}>
        <UserAvatar user={item} />
      </Pressable>
      <Pressable onPress={() => onView(item)} style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>
          {truncateTo12(item.name)}
        </Text>
        <Text style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>
          {item.vId}
        </Text>
        <Text style={{ color: 'rgba(124,58,237,0.7)', fontSize: 11, marginTop: 3, fontWeight: '600' }}>
          {pendingLabel}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onCancel(item.uid)}
        disabled={busy}
        style={{
          paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
          backgroundColor: 'rgba(239,68,68,0.1)',
          borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
          alignItems: 'center', justifyContent: 'center' }}
      >
        {busy ? (
          <PremiumLoader size="small" />
        ) : (
          <Text style={{ color: C.red, fontSize: 12, fontWeight: '700' }}>
            {cancelLabel}
          </Text>
        )}
      </Pressable>
    </View>
  );
});

const ContactRow = memo(function ContactRow({
  item, onView, onMessage, onLongPress,
}: {
  item: VeeUser;
  onView: (u: VeeUser) => void;
  onMessage: (u: VeeUser) => void;
  onLongPress: (u: VeeUser) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: C.bg,
        paddingVertical: 12, paddingHorizontal: 16 }}
    >
      {/* DP — tap → profile screen (2026-10-15, Sumon) */}
      <Pressable onPress={() => onView(item)}>
        <View style={{ position: 'relative', marginRight: 12 }}>
          <UserAvatar user={item} />
          {item.online && (
            <View style={{
              position: 'absolute', bottom: 1, right: 1,
              width: 12, height: 12, borderRadius: 6,
              backgroundColor: C.online, borderWidth: 2, borderColor: C.bg }} />
          )}
        </View>
      </Pressable>
      {/* Name / Vee ID — tap → chat directly; long-press → contact menu.
          2026-10-14 (Sumon): IMO-র মতো flat, কোনো call/chat button নেই */}
      <Pressable
        onPress={() => onMessage(item)}
        onLongPress={() => onLongPress(item)}
        delayLongPress={350}
        style={{ flex: 1 }}
      >
        <VerifiedName
          name={truncateTo12(item.name)}
          uid={item.uid}
          nameStyle={{ color: C.text, fontSize: 15, fontWeight: '700' }}
          logoSize={16}
        />
        <Text style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>
          {item.vId}
        </Text>
      </Pressable>
    </View>
  );
});

type Tab = 'friends' | 'requests';
type RequestSubTab = 'received' | 'sent';

export default function ContactsScreen() {
  const { user: me } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('friends');
  const [requestSubTab, setRequestSubTab] = useState<RequestSubTab>('received');

  // Friends list
  const [contacts, setContacts] = useState<VeeUser[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Incoming (received) requests
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [requestActionUid, setRequestActionUid] = useState<string | null>(null);

  // Sent requests
  const [sentRequestUids, setSentRequestUids] = useState<string[]>([]);
  const [sentRequestUsers, setSentRequestUsers] = useState<VeeUser[]>([]);
  const [sentLoading, setSentLoading] = useState(false);
  const [cancellingUid, setCancellingUid] = useState<string | null>(null);

  const [searchModalOpen, setSearchModalOpen] = useState(false);

  // LONG-PRESS MENU (2026-10-11 fix): imo-style context menu for contacts.
  const [menuContact, setMenuContact] = useState<VeeUser | null>(null);
  const [menuBlocked, setMenuBlocked] = useState(false);

  // 2026-10-13 (Sumon): আমার ব্লক-লিস্ট — ব্লকড ইউজার ফ্রেন্ড/রিকোয়েস্ট
  // লিস্টে দেখা যাবে না (Privacy → Blocked Users থেকে আনব্লক করা যায়)।
  const [blockedUids, setBlockedUids] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!me?.uid) return;
    return subscribeBlockedUsers(me.uid, (blocks) =>
      setBlockedUids(new Set(blocks.map((b) => b.targetUid))),
    );
  }, [me?.uid]);

  const handleContactLongPress = useCallback(async (targetUser: VeeUser) => {
    if (!me?.uid) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Check block status so the menu shows Block vs Unblock correctly.
    const direction = await getBlockDirection(me.uid, targetUser.uid).catch(() => 'none' as BlockDirection);
    setMenuBlocked(direction === 'byMe' || direction === 'mutual');
    setMenuContact(targetUser);
  }, [me?.uid]);

  const closeContactMenu = useCallback(() => setMenuContact(null), []);

  const handleMenuBlockToggle = useCallback(async () => {
    if (!me?.uid || !menuContact) return;
    const target = menuContact;
    setMenuContact(null);
    try {
      if (menuBlocked) {
        await unblockUser(me.uid, target.uid);
      } else {
        await blockUser(me.uid, target.uid, target.name, target.photoURL || undefined);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert(t('contacts.error'), t('contacts.blockError'));
    }
  }, [me?.uid, menuContact, menuBlocked, t]);

  // ─── Fetch helpers ──────────────────────────────────────────────────────────

  const fetchUsers = useCallback(async (uids: string[]): Promise<VeeUser[]> => {
    if (uids.length === 0) return [];
    const results = await Promise.all(
      uids.map((uid) =>
        get(ref(database, `users/${uid}`)).then((snap) =>
          snap.exists() ? sanitizeVeeUser(uid, snap.val()) : null,
        ),
      ),
    );
    return results.filter(Boolean) as VeeUser[];
  }, []);

  // ─── Friends subscription ────────────────────────────────────────────────

  useEffect(() => {
    if (!me?.uid || tab !== 'friends') return;
    setContactsLoading(true);
    let stale = false;
    const unsub = subscribeFriendUids(me.uid, async (uids) => {
      // FIX: fetchUsers is a network read — a rejection here previously
      // escaped as an unhandled promise rejection (async onValue callback).
      // Keep the previous list on transient failure; the next snapshot
      // re-triggers this callback and retries.
      try {
        const users = await fetchUsers(uids);
        if (stale) return;
        setContacts(users);
      } catch {
        /* transient load failure — list stays as-is until next snapshot */
      } finally {
        if (!stale) setContactsLoading(false);
      }
    });
    return () => { stale = true; unsub(); };
  }, [me?.uid, tab, fetchUsers]);

  // ─── Incoming requests subscription ─────────────────────────────────────

  useEffect(() => {
    if (!me?.uid) return;
    const unsub = subscribeIncomingRequests(me.uid, setIncomingRequests);
    return unsub;
  }, [me?.uid]);

  // ─── Sent requests subscription ──────────────────────────────────────────

  useEffect(() => {
    if (!me?.uid) return;
    const unsub = subscribeSentRequestUids(me.uid, setSentRequestUids);
    return unsub;
  }, [me?.uid]);

  // When sentRequestUids change, fetch full user objects
  useEffect(() => {
    if (sentRequestUids.length === 0) { setSentRequestUsers([]); return; }
    setSentLoading(true);
    let stale = false;
    // FIX: fetchUsers can reject (offline / permission) — this promise
    // previously had no .catch, producing an unhandled rejection. The stale
    // flag also guards setState after unmount.
    fetchUsers(sentRequestUids)
      .then((users) => {
        if (stale) return;
        setSentRequestUsers(users);
      })
      .catch(() => {
        /* transient load failure — list stays as-is; spinner stops below */
      })
      .finally(() => {
        if (!stale) setSentLoading(false);
      });
    return () => { stale = true; };
  }, [sentRequestUids, fetchUsers]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleAcceptRequest = useCallback(async (req: FriendRequest) => {
    if (!me?.uid) return;
    setRequestActionUid(req.fromUid);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await acceptFriendRequest(me.uid, req.fromUid);
      // Accepted → now a friend; switch to friends tab
      setTab('friends');
    } catch {
      Alert.alert(t('contacts.error'), t('contacts.acceptError'));
    } finally {
      setRequestActionUid(null);
    }
  }, [me?.uid, t]);

  const handleRejectRequest = useCallback(async (req: FriendRequest) => {
    if (!me?.uid) return;
    setRequestActionUid(req.fromUid);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await rejectFriendRequest(me.uid, req.fromUid);
    } catch {
      Alert.alert(t('contacts.error'), t('contacts.rejectError'));
    } finally {
      setRequestActionUid(null);
    }
  }, [me?.uid, t]);

  const handleCancelSentRequest = useCallback(async (targetUid: string) => {
    if (!me?.uid) return;
    Alert.alert(
      t('contacts.cancelRequestTitle'),
      t('contacts.cancelRequestMsg'),
      [
        { text: t('contacts.cancel'), style: 'cancel' },
        {
          text: t('contacts.cancelRequest'),
          style: 'destructive',
          onPress: async () => {
            setCancellingUid(targetUid);
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await cancelFriendRequest(me.uid, targetUid);
            } catch {
              Alert.alert(t('contacts.error'), t('contacts.cancelError'));
            } finally {
              setCancellingUid(null);
            }
          } },
      ],
    );
  }, [me?.uid, t]);

  const handleRemoveFriend = useCallback(async (targetUser: VeeUser) => {
    if (!me?.uid) return;
    Alert.alert(
      t('contacts.removeFriendTitle'),
      t('contacts.removeFriendMsg', { name: targetUser.name }),
      [
        { text: t('contacts.cancel'), style: 'cancel' },
        {
          text: t('contacts.remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await removeFriend(me.uid, targetUser.uid);
              // Also remove the DM chat list entry for both users so it
              // no longer appears in either person's chat list.
              const chatId = buildChatId(me.uid, targetUser.uid);
              // background: safe to swallow — secondary cleanup; friendship removal above is authoritative
              remove(ref(database, `userChats/${me.uid}/${chatId}`)).catch(() => {});
              remove(ref(database, `userChats/${targetUser.uid}/${chatId}`)).catch(() => {});
            } catch {
              Alert.alert(t('contacts.error'), t('contacts.removeError'));
            }
          } },
      ],
    );
  }, [me?.uid, t]);

  const handleMessage = useCallback(async (targetUser: VeeUser) => {
    if (!me?.uid) return;
    // 2026-10-13 (Sumon): handleCall-এর মতো এখানেও ব্লক চেক — আগে চেক
    // ছিল না, ব্লকড কন্টাক্টের চ্যাট-আইকনে ট্যাপ করলে চ্যাট খুলে যেত।
    const direction = await getBlockDirection(me.uid, targetUser.uid).catch(() => 'none' as BlockDirection);
    if (direction !== 'none') {
      Alert.alert(
        'Blocked',
        direction === 'byMe' || direction === 'mutual'
          ? `You blocked ${targetUser.name}. Unblock them to chat.`
          : `${targetUser.name} has blocked you.`,
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const chatId = buildChatId(me.uid, targetUser.uid);

    // Use RTDB as the authoritative name source — Auth displayName can be null
    // for social-login or legacy accounts even when RTDB has the correct name.
    const meSnap = await get(ref(database, `users/${me.uid}`));
    const meProfile = meSnap.exists() ? sanitizeVeeUser(me.uid, meSnap.val()) : null;
    const myName = meProfile?.name || me.displayName || 'Vee User';
    const myAvatar = meProfile?.photoURL || me.photoURL || '';

    await Promise.all([
      update(ref(database, `userChats/${me.uid}/${chatId}`), {
        id: chatId,
        participantId: targetUser.uid,
        participantName: targetUser.name,
        participantAvatar: targetUser.photoURL || '',
        lastMessage: '',
        lastMessageType: 'text',
        lastMessageTime: Date.now(),
        unreadCount: 0,
        isOnline: targetUser.online ?? false,
        hasStory: false,
        storySeen: false,
        isPinned: false }),
      update(ref(database, `userChats/${targetUser.uid}/${chatId}`), {
        id: chatId,
        participantId: me.uid,
        participantName: myName,
        participantAvatar: myAvatar,
        lastMessage: '',
        lastMessageType: 'text',
        lastMessageTime: Date.now(),
        unreadCount: 0,
        isOnline: true,
        hasStory: false,
        storySeen: false,
        isPinned: false }),
    ]);
    router.push(
      `/inbox/${chatId}?participantId=${encodeURIComponent(targetUser.uid)}&participantName=${encodeURIComponent(targetUser.name)}` as never,
    );
  }, [me, router]);

  /** Audio call — navigate to the 1-to-1 audio call screen as caller. */
  const handleCall = useCallback(async (targetUser: VeeUser) => {
    if (!me?.uid) return;
    // P1 fix (2026-10-12): busy guard — never dial while a call is active/minimized.
    if (getMinimizedCall()) {
      Alert.alert(t('audioCall.alreadyInCallTitle'), t('audioCall.alreadyInCallMsg'));
      return;
    }
    // Block enforcement: cannot call if blocked either way.
    const direction = await getBlockDirection(me.uid, targetUser.uid).catch(() => 'none' as BlockDirection);
    if (direction !== 'none') {
      Alert.alert(
        'Blocked',
        direction === 'byMe' || direction === 'mutual'
          ? `You blocked ${targetUser.name}. Unblock them to call.`
          : `${targetUser.name} has blocked you.`,
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const callRoomId = buildCallRoomId(me.uid, targetUser.uid);
    let url = `/audio-call?roomId=${encodeURIComponent(callRoomId)}&role=caller&remoteUid=${encodeURIComponent(targetUser.uid)}&remoteName=${encodeURIComponent(targetUser.name)}&calleeUid=${encodeURIComponent(targetUser.uid)}&myUid=${encodeURIComponent(me.uid)}&myName=${encodeURIComponent(me.displayName || 'Vee User')}`;
    if (targetUser.photoURL) url += `&remotePhotoURL=${encodeURIComponent(targetUser.photoURL)}`;
    if (me.photoURL) url += `&myPhotoURL=${encodeURIComponent(me.photoURL)}`;
    router.push(url as never);
  }, [me, router]);

  const handleViewProfile = useCallback((targetUser: VeeUser) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(
      `/user-profile?uid=${encodeURIComponent(targetUser.uid)}&name=${encodeURIComponent(targetUser.name)}` as never,
    );
  }, [router]);

  const handleUserFound = useCallback(async (selectedUser: VeeUser, _chatId: string) => {
    setSearchModalOpen(false);
    router.push(
      `/user-profile?uid=${encodeURIComponent(selectedUser.uid)}&name=${encodeURIComponent(selectedUser.name)}` as never,
    );
  }, [router]);

  // ─── Derived data ────────────────────────────────────────────────────────────

  // 2026-10-13 (Sumon): ব্লকড ইউজার কোনো লিস্টে দেখা যাবে না
  // (আনব্লক: Privacy → Blocked Users)।
  const visibleContacts = contacts.filter((u) => !blockedUids.has(u.uid));
  const filtered = search.trim()
    ? visibleContacts.filter((u) =>
        u.name?.toLowerCase().includes(search.toLowerCase()) ||
        u.vId?.toLowerCase().includes(search.toLowerCase()),
      )
    : visibleContacts;

  const visibleIncoming = incomingRequests.filter((r) => !blockedUids.has(r.fromUid));
  const visibleSent = sentRequestUsers.filter((u) => !blockedUids.has(u.uid));

  const totalRequestsBadge = visibleIncoming.length;
  const topPad = Platform.OS === 'web' ? 67 : 0;

  // Stable render callbacks for the memoized rows (2026-10-22 audit).
  const renderIncoming = useCallback(({ item }: { item: FriendRequest }) => (
    <IncomingRequestRow
      item={item}
      busy={requestActionUid === item.fromUid}
      onView={handleViewProfile}
      onAccept={handleAcceptRequest}
      onReject={handleRejectRequest}
    />
  ), [requestActionUid, handleViewProfile, handleAcceptRequest, handleRejectRequest]);

  const renderSent = useCallback(({ item }: { item: VeeUser }) => (
    <SentRequestRow
      item={item}
      busy={cancellingUid === item.uid}
      pendingLabel={t('contacts.pendingLabel')}
      cancelLabel={t('contacts.cancelRequest')}
      onView={handleViewProfile}
      onCancel={handleCancelSentRequest}
    />
  ), [cancellingUid, t, handleViewProfile, handleCancelSentRequest]);

  const renderContact = useCallback(({ item }: { item: VeeUser }) => (
    <ContactRow
      item={item}
      onView={handleViewProfile}
      onMessage={handleMessage}
      onLongPress={handleContactLongPress}
    />
  ), [handleViewProfile, handleMessage, handleContactLongPress]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={{ width: '100%', flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: topPad + 14,
        paddingHorizontal: 20,
        paddingBottom: 12 }}>
        <Text style={{ flex: 1, color: C.text, fontSize: 26, fontWeight: '900' }}>
          {t('contacts.title')}
        </Text>
        <Pressable
          onPress={() => setSearchModalOpen(true)}
          style={{
            width: 42, height: 42, borderRadius: 21,
            backgroundColor: C.surface,
            borderWidth: 1, borderColor: C.border,
            alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name="user-plus" size={18} color={C.muted} />
        </Pressable>
      </View>

      {/* Main Tab selector — Friends | Requests */}
      <View style={{
        flexDirection: 'row',
        marginHorizontal: 20, marginBottom: 14,
        backgroundColor: C.surface,
        borderRadius: 14, padding: 4,
        borderWidth: 1, borderColor: C.border }}>
        {(['friends', 'requests'] as Tab[]).map((t_) => (
          <Pressable
            key={t_}
            onPress={() => { setTab(t_); setSearch(''); }}
            style={{
              flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
              backgroundColor: tab === t_ ? C.primary : 'transparent' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{
                color: tab === t_ ? '#fff' : C.muted,
                fontWeight: tab === t_ ? '800' : '500',
                fontSize: 13 }}>
                {t_ === 'friends' ? t('contacts.tabFriends') : t('contacts.tabRequests')}
              </Text>
              {t_ === 'requests' && totalRequestsBadge > 0 && (
                <View style={{
                  minWidth: 16, height: 16, borderRadius: 8,
                  backgroundColor: C.red, alignItems: 'center', justifyContent: 'center',
                  paddingHorizontal: 3 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>
                    {totalRequestsBadge}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        ))}
      </View>

      {/* ── REQUESTS TAB ── */}
      {tab === 'requests' ? (
        <View style={{ flex: 1 }}>
          {/* Sub-tab: received | sent */}
          <View style={{
            flexDirection: 'row',
            marginHorizontal: 20, marginBottom: 12,
            backgroundColor: C.subTabBg,
            borderRadius: 12, padding: 3,
            borderWidth: 1, borderColor: C.border }}>
            <Pressable
              onPress={() => setRequestSubTab('received')}
              style={{
                flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                backgroundColor: requestSubTab === 'received' ? 'rgba(124,58,237,0.6)' : 'transparent' }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={{
                  color: requestSubTab === 'received' ? '#fff' : C.muted,
                  fontWeight: requestSubTab === 'received' ? '700' : '500',
                  fontSize: 12 }}>
                  {t('contacts.requestsReceived')}
                </Text>
                {visibleIncoming.length > 0 && (
                  <View style={{
                    minWidth: 14, height: 14, borderRadius: 7,
                    backgroundColor: C.red, alignItems: 'center', justifyContent: 'center',
                    paddingHorizontal: 2 }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>
                      {visibleIncoming.length}
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>
            <Pressable
              onPress={() => setRequestSubTab('sent')}
              style={{
                flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center',
                backgroundColor: requestSubTab === 'sent' ? 'rgba(124,58,237,0.6)' : 'transparent' }}
            >
              <Text style={{
                color: requestSubTab === 'sent' ? '#fff' : C.muted,
                fontWeight: requestSubTab === 'sent' ? '700' : '500',
                fontSize: 12 }}>
                {t('contacts.requestsSent')}
              </Text>
            </Pressable>
          </View>

          {/* Received requests list */}
          {requestSubTab === 'received' ? (
            visibleIncoming.length === 0 ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 }}>
                <View style={{
                  width: 72, height: 72, borderRadius: 36,
                  backgroundColor: 'rgba(139,92,246,0.12)',
                  borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)',
                  alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <Feather name="user-plus" size={32} color={C.glow} />
                </View>
                <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>
                  {t('contacts.noFriendRequests')}
                </Text>
              </View>
            ) : (
              <FlatList
                data={visibleIncoming}
                keyExtractor={(item) => item.fromUid}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
                showsVerticalScrollIndicator={false}
                renderItem={renderIncoming}
              />
            )
          ) : (
            /* Sent requests list */
            sentLoading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <PremiumLoader size="large" />
              </View>
            ) : visibleSent.length === 0 ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 }}>
                <View style={{
                  width: 72, height: 72, borderRadius: 36,
                  backgroundColor: 'rgba(139,92,246,0.12)',
                  borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)',
                  alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                  <Feather name="send" size={32} color={C.glow} />
                </View>
                <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>
                  {t('contacts.noSentRequests')}
                </Text>
              </View>
            ) : (
              <FlatList
                data={visibleSent}
                keyExtractor={(item) => item.uid}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
                showsVerticalScrollIndicator={false}
                renderItem={renderSent}
              />
            )
          )}
        </View>
      ) : (
        /* ── FRIENDS TAB ── */
        <>
          {/* Search bar */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            marginHorizontal: 20, marginBottom: 12,
            backgroundColor: C.inputBg, borderRadius: 12,
            paddingHorizontal: 12, paddingVertical: 10,
            borderWidth: 1, borderColor: C.border, gap: 8 }}>
            <Feather name="search" size={16} color={C.dim} />
            <TextInput
              style={{ flex: 1, color: C.text, fontSize: 14 }}
              placeholder={t('contacts.searchPlaceholder')}
              placeholderTextColor={C.dim}
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}>
                <Feather name="x-circle" size={15} color={C.muted} />
              </Pressable>
            )}
          </View>

          {contactsLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <PremiumLoader size="large" />
            </View>
          ) : filtered.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 }}>
              <View style={{
                width: 72, height: 72, borderRadius: 36,
                backgroundColor: 'rgba(139,92,246,0.12)',
                borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)',
                alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Feather name="users" size={32} color={C.glow} />
              </View>
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>
                {search ? t('contacts.noResults') : t('contacts.noFriends')}
              </Text>
              <Text style={{ color: C.muted, fontSize: 13, marginTop: 8, textAlign: 'center', paddingHorizontal: 40 }}>
                {t('contacts.findPeopleCta')}
              </Text>
              {!search && (
                <Pressable
                  onPress={() => setSearchModalOpen(true)}
                  style={{
                    // 2026-10-13 (Sumon): বাটন স্ট্যান্ডার্ড #E3F2FD bg + #007AFF text
                    marginTop: 20, backgroundColor: '#E3F2FD',
                    borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 }}
                >
                  <Text style={{ color: '#007AFF', fontWeight: '800', fontSize: 14 }}>
                    {t('contacts.findPeopleBtn')}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.uid}
              contentContainerStyle={{ paddingBottom: 120 }}
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={ContactSeparator}
              renderItem={renderContact}
              />
          )}
        </>
      )}

      {/* Find People Modal */}
      <UserSearchModal
        visible={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onSelectUser={handleUserFound}
      />

      {/* Long-press context menu (2026-10-11 fix) — imo style */}
      <ContactLongPressMenu
        visible={!!menuContact}
        contactName={menuContact?.name ?? ''}
        isBlocked={menuBlocked}
        onChat={() => {
          const c = menuContact;
          setMenuContact(null);
          if (c) handleMessage(c);
        }}
        onCall={() => {
          const c = menuContact;
          setMenuContact(null);
          if (c) handleCall(c);
        }}
        onViewProfile={() => {
          const c = menuContact;
          setMenuContact(null);
          if (c) handleViewProfile(c);
        }}
        onBlockToggle={handleMenuBlockToggle}
        onUnfriend={() => {
          const c = menuContact;
          setMenuContact(null);
          if (c) handleRemoveFriend(c);
        }}
        onClose={closeContactMenu}
      />
    </View>
  );
}
