/**
 * IMOHomeScreen — IMO-style home shell (2026-10-19).
 * 5-tab IMO layout: Chats · Contacts · Stories · Calls · Me (bottom text tabs).
 * - Chats: search bar + story strip + chat list (IMOChatListItem — owned by chat agent, not restyled here)
 * - Contacts: existing ContactsScreen
 * - Stories: StoriesTabScreen (story groups list)
 * - Calls: CallsTabScreen (call history)
 * - Me: navigates to /profile (profile screens untouched)
 * Voice rooms: voice top-bar tab renders VoiceRoomHome INLINE (tab form —
 * top bar + bottom bar stay visible). Never a separate full page/modal.
 * Planet: via story strip entry (existing '__planet__' handling).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, Alert, TouchableOpacity, Image, Platform, StatusBar, BackHandler, InteractionManager } from 'react-native';
import { FlatList } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { getMinimizedCall } from '@/src/features/audio-call/services/callMinimizeStore';
import { Chat } from '@/src/features/chat/types';
import {
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
import { buildCallRoomId } from '@/src/features/audio-call/services/firebaseCallService';
import type { CallHistoryEntry } from '@/src/features/audio-call/services/callHistoryService';
import { useStories, subscribeSharedUserChats } from '@/src/features/chat/hooks/useStories';
import { subscribeUser, type VeeUser } from '@/src/services/userService';
import { getUser } from '@/src/services/userService';
import { ref, get } from 'firebase/database';
import { database } from '@/src/config/firebase';
import IMOStoryRow, { type IMOStory } from '@/src/features/home/components/IMOStoryRow';
import { UniversalContentRenderer } from '@/src/components/UniversalContentRenderer';
import IMOChatListItem, { type IMOChat } from '@/src/features/home/components/IMOChatListItem';
import ChatLongPressMenu from '@/src/features/home/components/ChatLongPressMenu';
import IMOTopBar from '@/src/features/home/components/IMOTopBar';
import IMOBottomBar from '@/src/features/home/components/IMOBottomBar';
import { formatMsgTime } from '@/src/utils/formatMsgTime';
import { type HomeTab } from '@/src/features/home/components/IMOTabBar';
import HomePager from '@/src/features/home/components/HomePager';
import Animated, { useSharedValue, useAnimatedStyle, interpolate, withTiming } from 'react-native-reanimated';
import StoriesTabScreen from '@/src/features/home/components/StoriesTabScreen';
import CallsTabScreen from '@/src/features/home/components/CallsTabScreen';
import VoiceRoomHome from '@/src/features/voice-room/screens/VoiceRoomHome';
import ContactsScreen from '@/src/features/contacts/ContactsScreen';
import ProfileScreen from '@/app/profile/index';
import StoryViewer from '@/src/features/chat/screens/StoryViewer';
import StoryCreator from '@/src/features/chat/screens/StoryCreator';

type ContentTab = Exclude<HomeTab, 'me'> | 'voice' | 'profile';

export default function IMOHomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ContentTab>('chats');
  const [chats, setChats] = useState<Chat[]>([]);
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // 2026-10-19 polish: empty state on the chat list.
  // Fix #20 (2026-10-29, boss: no loading page on home, offline opens):
  // tracks whether the live chat subscription has fired for the current
  // effect run, so the no-cache + offline case can settle to the empty
  // state instead of staying blank forever (onValue never fires offline).
  const liveArrivedRef = useRef(false);
  // 2026-11-07 (IMO home scroll smoothness): coalesced cache-write refs.
  // The old code JSON.stringify'd the whole chat list and hit AsyncStorage
  // on EVERY live snapshot — that JS-thread work could land mid-scroll and
  // drop frames. The cache is only for offline-first load, so the write
  // waits until after interactions (scroll) settle, and a burst of
  // snapshots collapses to ONE write of the latest list. No timer /
  // interval (InteractionManager, already imported); behaviour identical,
  // just later. The cleanup below flushes a pending write on unmount.
  const pendingChatCacheRef = useRef<Chat[] | null>(null);
  const chatCacheScheduledRef = useRef(false);
  const [chatsReady, setChatsReady] = useState(false);
  const [storyViewerVisible, setStoryViewerVisible] = useState(false);
  const [storyViewerIndex, setStoryViewerIndex] = useState(0);
  const [storyCreatorVisible, setStoryCreatorVisible] = useState(false);
  const { stories, publish, react, comment, remove, getContactUids } = useStories();

  // DP HYDRATION (2026-10-10): Cache for missing profile DPs from RTDB
  const [avatarCache, setAvatarCache] = useState<Record<string, string>>({});

  // LIVE PROFILES (2026-10-11 Issue #4): real-time name + DP per chat
  // participant. When someone changes their profile, the chat list updates
  // immediately — no stale cached names/DPs.
  // 2026-11-07 (IMO home scroll smoothness): `online` now rides this
  // SAME subscribeUser stream (the user node already carries it), so the
  // separate subscribePresence effect — a second full-node onValue
  // listener per participant — is gone. Privacy masking is preserved
  // (see privacyMap below): each participant's privacy is fetched ONCE
  // and applied locally, mirroring subscribePresence exactly.
  const [liveProfiles, setLiveProfiles] = useState<Record<string, { name?: string; photoURL?: string; online?: boolean }>>({});
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
          // Only name/photoURL/online matter here — skip the state write when
          // they are unchanged so the whole home shell stops re-rendering.
          setLiveProfiles((prev) => {
            const photo = p.photoURL || undefined;
            const online = p.online === true;
            const cur = prev[uid];
            if (cur && cur.name === p.name && cur.photoURL === photo && cur.online === online) return prev;
            return { ...prev, [uid]: { name: p.name, photoURL: photo, online } };
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
  // Fix #24 follow-up (2026-10-29): the live subscription is the shared
  // hub (one underlying listener for shell + chat tab + stories
  // derivation), frame-coalesced — a reconnect burst becomes one
  // re-render, not ~10+ (see subscribeSharedUserChats in useStories).
  // Fix #20 (2026-10-29, boss: no loading page on home, offline opens):
  // the list must SETTLE in every case — cached → instant; live → on
  // arrival; neither (offline + no cache, where onValue never fires) →
  // the empty state after a short settle window, never a blank page
  // forever. There is no spinner on this screen by design.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    let cancelled = false;
    liveArrivedRef.current = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    loadChatList(uid).then((cached) => {
      if (cancelled) return;
      if (cached) {
        setChats(cached);
        setChatsReady(true);
      } else {
        // No cache: if the live snapshot hasn't arrived shortly, settle
        // anyway so the empty state shows (offline + no cache). A later
        // live snapshot replaces it with the real list.
        settleTimer = setTimeout(() => {
          if (!cancelled && !liveArrivedRef.current) setChatsReady(true);
        }, 3000);
      }
    });
    const unsub = subscribeSharedUserChats(uid, (live) => {
      if (cancelled) return;
      liveArrivedRef.current = true;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      setChats(live);
      setChatsReady(true);
      // 2026-11-07 (IMO home scroll smoothness): cache write deferred
      // past the scroll (see refs above) — never stringify + write to
      // AsyncStorage on the live-update path itself.
      pendingChatCacheRef.current = live;
      if (!chatCacheScheduledRef.current) {
        chatCacheScheduledRef.current = true;
        InteractionManager.runAfterInteractions(() => {
          chatCacheScheduledRef.current = false;
          if (cancelled) return;
          const latest = pendingChatCacheRef.current;
          pendingChatCacheRef.current = null;
          if (latest) saveChatList(uid, latest);
        });
      }
    });
    return () => {
      cancelled = true;
      if (settleTimer) clearTimeout(settleTimer);
      // Flush a pending cache write so the offline copy isn't lost on unmount.
      const pending = pendingChatCacheRef.current;
      pendingChatCacheRef.current = null;
      if (pending) saveChatList(uid, pending);
      unsub();
    };
  }, [user?.uid]);


  // 2026-10-26 (boss: chat-list online + unseen-story marks): realtime
  // presence per chat participant (privacy-masked — a contact hiding
  // online status reads offline here, same as inbox) + unseen-story set
  // from stories' unreadCount. The privacy fetch re-runs only when the
  // participant SET changes (key string), never on every incoming message.
  // 2026-11-07: the online flag rides the liveProfiles subscribeUser
  // stream (see above) — no second live listener per participant.
  const participantIdsKey = useMemo(() => [...new Set(chats.map((c) => c.participantId).filter(Boolean) as string[])].sort().join(','), [chats]);
  // 2026-11-07 (IMO home scroll smoothness): presence privacy cache.
  // The old subscribePresence effect attached a SECOND full-node onValue
  // listener per participant (the liveProfiles stream above already
  // listens to the same node). Now each participant's `users/{uid}/privacy`
  // is fetched ONCE and cached; the online mark is derived from the
  // liveProfiles stream with that privacy applied. Semantics mirror
  // subscribePresence exactly: missing node / fetch failure -> permissive
  // (show); showOnlineStatus === false -> hidden. Privacy not loaded yet
  // -> offline, same as before the old listener attached.
  const [privacyMap, setPrivacyMap] = useState<Record<string, { showOnlineStatus?: boolean }>>({});
  useEffect(() => {
    const ids = participantIdsKey ? participantIdsKey.split(',') : [];
    const missing = ids.filter((id) => !(id in privacyMap));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map(async (id) => {
      try {
        const snap = await get(ref(database, `users/${id}/privacy`));
        return [id, snap.exists() ? (snap.val() as { showOnlineStatus?: boolean }) : {}] as const;
      } catch {
        return [id, {}] as const;
      }
    })).then((results) => {
      if (cancelled) return;
      const updates: Record<string, { showOnlineStatus?: boolean }> = {};
      for (const [id, priv] of results) updates[id] = priv;
      setPrivacyMap((prev) => ({ ...prev, ...updates }));
    });
    return () => { cancelled = true; };
  }, [participantIdsKey, privacyMap]);
  // Online mark derived from the liveProfiles stream + privacy cache —
  // no second live listener per participant.
  const onlineMap = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const pid of Object.keys(liveProfiles)) {
      const priv = privacyMap[pid];
      if (!priv) { out[pid] = false; continue; }
      out[pid] = priv.showOnlineStatus !== false ? (liveProfiles[pid]?.online === true) : false;
    }
    return out;
  }, [liveProfiles, privacyMap]);
  const unseenStoryUids = useMemo(() => new Set(
    (stories || []).filter((s: any) => (s.unreadCount || 0) > 0).map((s: any) => s.userId).filter(Boolean),
  ), [stories]);

  // Stories (already loaded above via useStories)
  // Convert to IMO format — live profile name/DP wins over cached values
  // (2026-10-11 Issue #4).
  // 2026-10-19 perf: useMemo'd — the old inline map rebuilt fresh object
  // identities on EVERY parent render, defeating row memoization.
  // 2026-10-30 smoothness: reuse the previous item object when every field is
  // unchanged, so memo()'d rows skip re-render on unrelated updates (a new message
  // in one chat no longer re-renders all rows). The compare is exact: every item
  // field is a primitive, and the cache is rebuilt from current ids each run.
  const imoChatsCacheRef = useRef(new Map<string, IMOChat>());
  const imoChats: IMOChat[] = useMemo(() => {
    const imoChatsPrevCache = imoChatsCacheRef.current;
    const imoChatsNextCache = new Map<string, IMOChat>();
    const out = chats
    .filter((c) => !(c as any).isHidden) // hidden chats don't show in list
    .map((c) => {
    const live = c.participantId ? liveProfiles[c.participantId] : undefined;
    const item: IMOChat = {
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
      // 2026-10-26: chat-list avatar marks (imo) — online check + story ring.
      isOnline: c.participantId ? (onlineMap[c.participantId] ?? false) : false,
      hasUnseenStory: c.participantId ? unseenStoryUids.has(c.participantId) : false,
    };
    const hit = imoChatsPrevCache.get(item.id);
    if (hit && hit.id === item.id && hit.name === item.name && hit.photoURL === item.photoURL && hit.lastMessage === item.lastMessage && hit.lastMessageTime === item.lastMessageTime && hit.unreadCount === item.unreadCount && hit.isPinned === item.isPinned && hit.isMuted === item.isMuted && hit.participantId === item.participantId && hit.isOnline === item.isOnline && hit.hasUnseenStory === item.hasUnseenStory && hit.isVoiceClub === item.isVoiceClub) { imoChatsNextCache.set(item.id, hit); return hit; }
    imoChatsNextCache.set(item.id, item);
    return item;
    });
    imoChatsCacheRef.current = imoChatsNextCache;
    return out;
  }, [chats, liveProfiles, avatarCache, onlineMap, unseenStoryUids]);
  // 2026-10-30 smoothness: latest-list ref so row callbacks keep stable identity
  // (row memo holds across chats updates); handlers resolve fresh data at tap time.
  const imoChatsRef = useRef(imoChats);
  imoChatsRef.current = imoChats;

  // 2026-10-19 perf: fixed row heights (77px; 81px for the taller voice-club
  // ring rows) with memoized prefix-sum offsets, so FlatList can skip
  // per-row measurement. No scrollToIndex is used on this list; the layout
  // only feeds the renderer's windowing math.
  const rowOffsets = useMemo(() => {
    const offsets: number[] = new Array(imoChats.length);
    let y = 0;
    for (let i = 0; i < imoChats.length; i += 1) {
      offsets[i] = y;
      y += (imoChats[i].isVoiceClub || imoChats[i].hasUnseenStory) ? 81 : 77;
    }
    return offsets;
  }, [imoChats]);
  const getRowLayout = useCallback((_data: ArrayLike<IMOChat> | null | undefined, index: number) => {
    const h = (_data?.[index]?.isVoiceClub || _data?.[index]?.hasUnseenStory) ? 81 : 77;
    return { length: h, offset: rowOffsets[index] ?? index * 77, index };
  }, [rowOffsets]);

  // LONG-PRESS MENU (2026-10-11 Issue #6): imo-style context menu state.
  const [menuChat, setMenuChat] = useState<IMOChat | null>(null);
  const handleLongPress = useCallback((chatId: string) => {
    const chat = imoChatsRef.current.find((c) => c.id === chatId);
    if (chat) setMenuChat(chat);
  }, []);
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
  // 2026-11-02 (home swipe: super smooth, one page only): story strip
  // data memoized — it was rebuilt (new array identity) on EVERY shell
  // render, which would defeat the page memoization below. The
  // contact-set dep is a sorted-join key, not the getContactUids
  // closure itself (that closure is recreated every render; the
  // ref-backed Set it reads is what matters) — the same key pattern
  // the live-profiles effect in this file already uses.
  const contactUidsKey = [...(getContactUids?.() ?? new Set<string>())].sort().join(',');
  const imoStories: IMOStory[] = useMemo(() => (stories || [])
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
    })), [stories, user?.uid, avatarCache, contactUidsKey]);

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

  // 2026-10-30 (boss: home page-swipe, super smooth; profile as pager
  // page, 2026-10-30: profile stays LOADED, slide just opens it).
  // Page order left→right: Profile | Chat | Voice | Contacts.
  // Pager indices: profile=-1, chats=0, voice=1, contacts=2. Profile IS
  // a mounted pager page (warm-up mounted, kept forever after) — the
  // slide is the pager spring itself, so no push, no mount, no reversal
  // at release: the old drag-then-push jerk (J2+J3+J4) is gone.
  const [pagerIndex, setPagerIndex] = useState(0);
  const pagerProgress = useSharedValue(0);
  // 2026-11-02 (boss: profile entrance must be a professional horizontal
  // page slide, NOT rising up): the tab whose bar heights are currently
  // displayed. Updated ONLY when the pager settles on a page
  // (handlePagerIndexChange), never mid-drag — so the bars stay frozen
  // at the origin page's height while the page slides horizontally,
  // and only then animate to the destination page's heights. The old
  // progress-driven collapse shrank the bars DURING the swipe, which
  // grew the pager row mid-slide and shifted the profile page's
  // content upward — the "rising up" look. Settled states are
  // identical to before: profile → both bars 0; voice → bottom bar 0
  // only; chats/contacts → both bars full.
  const [barsTab, setBarsTab] = useState<ContentTab>('chats');
  // 2026-10-30 (boss: one clean switch per tap, no jitter): settled flag
  // owned by HomePager — true only when no pager spring is in flight.
  // The focus repair below reads it and never acts mid-animation.
  const pagerSettled = useSharedValue(true);
  // Latest pagerIndex for the focus repair, whose callback is intentionally
  // dependency-free (stable identity) so it never re-runs on tab changes.
  // (Assigned during render so a focus event always sees the fresh tab.)
  const pagerIndexRef = useRef(pagerIndex);
  pagerIndexRef.current = pagerIndex;
  // 2026-10-30 (boss: full-page profile, Phase 2): shell bars hide on
  // the profile page, so it is full-screen exactly like the route.
  // 2026-11-02 (boss: professional profile entrance, NOT rising up):
  // the collapse NO LONGER follows live drag progress. Shrinking the
  // bars mid-swipe grew the pager row mid-slide and shifted the page
  // content upward — the "rising up" look. Now the bars stay frozen
  // at the origin page's height while the page slides horizontally,
  // and only animate to the destination heights once the pager
  // settles (barsTab, below). Settled heights are unchanged.
  // Full heights are measured from the bars' own layout (the measured
  // View's height is its natural height, independent of the animated
  // wrapper's clipped height) over exact-style estimates (top 77 = 16
  // padding + 60 row + 1 border; bottom 57 = 24 padding + 32 icon + 1
  // border), so the first frame is right and measurement corrects any
  // drift. The shell SafeAreaView drops top/bottom edges (bars
  // self-apply their insets via wrapper padding), so at -1 the pager
  // truly fills the screen: no status-bar strip, no bottom gap. Other
  // tabs keep identical total heights (inset + bar), so their geometry
  // is unchanged. Stories/calls tabs are legacy-unreachable from this
  // shell, but the guard below restores bars instantly if the pager
  // ever unmounts (a tab switch is a hard screen change, not a slide).
  const insets = useSafeAreaInsets();
  const topBarFullH = useSharedValue(insets.top + 77);
  // 2026-10-30 (boss: bottom bar VANISHED after the 16:11 update):
  // fix FORWARD, never back to clipped. The 16:11 fix let onLayout
  // adopt EVERY measured height into the wrapper height, with no
  // floor and no recovery — a transient small layout value (a frame
  // mid profile-collapse, or a first frame before content/insets
  // settled) then stuck the bar at that height forever, because the
  // dedup guard treated the adopted value as final and the effect
  // only wrote while "not measured yet". The 14:56 one-shot guard
  // was the mirror flaw (froze the first value -> clip). Both flaws
  // share one root cause: deriving the wrapper height from
  // measurement when the content height is a KNOWN constant.
  // IMOBottomBar is fixed 57 (12 padding + 32 icon + 12 padding +
  // 1 border; the Connecting text and green dot never change it),
  // so the wrapper height is derived ONLY from insets: 57 +
  // clearance, where clearance = insets.bottom ONLY (2026-10-30
  // slim: the old max(insets.bottom, 16) + 12 slack read as a thick
  // dead band under the icons. The inset band itself is the OS
  // gesture zone and stays; nothing extra is added. Fully visible
  // at insets 0 AND at any real inset). onLayout
  // adoption is DELETED — nothing measured can shrink the bar now.
  // The worklet floor below is belt-and-braces for the same rule.
  // 2026-10-30 (boss: bar too thick, dead gap below icons):
  // clearance is the system inset ONLY. Never below insets.bottom,
  // or the 15:55 clipping returns. What remains below the icons is
  // exactly the OS gesture zone, not bar dead space.
  const bottomClearance = insets.bottom;
  const bottomBarFullH = useSharedValue(57 + bottomClearance);
  const topBarMeasured = useRef(false);
  useEffect(() => {
    bottomBarFullH.value = 57 + bottomClearance;
  }, [bottomClearance]);
  // 2026-11-02 (boss: professional profile entrance): collapse drivers.
  // withTiming here REPLACES the old progress-driven collapse — same
  // bars, same settled heights, no new animation system, no timers.
  const topBarCollapse = useSharedValue(0);
  const bottomBarCollapse = useSharedValue(0);
  useEffect(() => {
    topBarCollapse.value = withTiming(barsTab === 'profile' ? 1 : 0, { duration: 280 });
    bottomBarCollapse.value = withTiming(barsTab === 'profile' || barsTab === 'voice' ? 1 : 0, { duration: 280 });
  }, [barsTab, topBarCollapse, bottomBarCollapse]);
  const isPagerTab = activeTab === 'chats' || activeTab === 'voice' || activeTab === 'contacts' || activeTab === 'profile';
  const topBarWrapStyle = useAnimatedStyle(() => {
    if (!isPagerTab) return { height: topBarFullH.value, opacity: 1 };
    const c = topBarCollapse.value;
    return {
      height: interpolate(c, [0, 1], [topBarFullH.value, 0]),
      opacity: 1 - c,
    };
  }, [isPagerTab]);
  const bottomBarWrapStyle = useAnimatedStyle(() => {
    if (!isPagerTab) return { height: bottomBarFullH.value, opacity: 1 };
    // 2026-10-30 (boss: NO bottom bar on the voice page ONLY): settled
    // knots are unchanged — profile and voice hide the bar, chats and
    // contacts show it full. The true-height floor (belt-and-braces
    // from the 16:11/14:56 measurement flaws) is applied to `full`
    // BEFORE interpolation, so settled chats/contacts keep their
    // exact old height (57 + clearance).
    const full = Math.max(bottomBarFullH.value, 57 + bottomClearance);
    const c = bottomBarCollapse.value;
    return { height: interpolate(c, [0, 1], [full, 0]), opacity: 1 - c };
  }, [isPagerTab, bottomClearance]);
  // 2026-10-30 (boss: profile pre-loaded): deferred warm-up — the pager
  // renders a placeholder for the profile page at home mount, then
  // mounts the real ProfileScreen once after home settles
  // (post-interaction, 1500ms fallback) and keeps it mounted forever
  // after. Home opens fast; every drag after warm-up is jerk-free. A
  // drag within the first ~second of home open may still show the
  // placeholder (accepted, disclosed in the scope).
  const [profileWarmed, setProfileWarmed] = useState(false);
  useEffect(() => {
    let done = false;
    const warm = () => { if (!done) { done = true; setProfileWarmed(true); } };
    const task = InteractionManager.runAfterInteractions(warm);
    const fallback = setTimeout(warm, 1500);
    return () => { done = true; task.cancel(); clearTimeout(fallback); };
  }, []);
  const goToTab = useCallback((tab: ContentTab) => {
    setActiveTab(tab);
    if (tab === 'profile') setPagerIndex(-1);
    else if (tab === 'chats') setPagerIndex(0);
    else if (tab === 'voice') setPagerIndex(1);
    else if (tab === 'contacts') setPagerIndex(2);
  }, []);
  const handlePagerIndexChange = useCallback((i: number) => {
    const tab: ContentTab = i === -1 ? 'profile' : i === 0 ? 'chats' : i === 1 ? 'voice' : 'contacts';
    setPagerIndex(i);
    setActiveTab(tab);
    setBarsTab(tab);
  }, []);

  // 2026-10-30 (boss: underline exactly under the active tab, incl.
  // room entry/return): focus repair. If the UI-thread pager position
  // and the JS tab ever disagree on return (e.g. a settle callback
  // dropped across a room/profile push), re-align them to the visual
  // truth: a small drift snaps the indicator to the JS tab; a full-tab
  // drift adopts the visible page as the tab (the user is looking at
  // that page). No-op in the normal case (already aligned).
  // 2026-10-30 (boss: one clean switch per tap, no jitter): this repair
  // MUST run only on focus gain, never on tab changes. The previous
  // version closed over [pagerIndex], and expo-router's useFocusEffect
  // re-runs its effect whenever the callback identity changes while
  // focused (its deps are [effect, navigation, optionalNavigation], and
  // it runs the callback immediately when navigation.isFocused()) — so
  // every tap re-ran the repair mid-spring, it read mid-animation
  // progress, adopted round(progress) as the tab, and yanked JS state
  // back against the tap spring: the row slid left-right by itself.
  // Now the callback is dependency-free (stable identity, so tab changes
  // never re-run it) and reads the current tab from a ref, and it is
  // settled-gated: while any pager spring is in flight it does nothing
  // (the spring's own completion settles progress exactly, and JS state
  // already names its target tab). The return-from-room repair itself is
  // unchanged — focus gain is exactly when it is needed.
  useFocusEffect(
    useCallback(() => {
      if (!pagerSettled.value) return;
      const p = pagerProgress.value;
      const idx = pagerIndexRef.current;
      if (Math.abs(p - idx) < 0.5) {
        if (p !== idx) pagerProgress.value = idx;
      } else {
        const ni = Math.max(-1, Math.min(2, Math.round(p)));
        if (ni !== idx) {
          // 2026-11-02 (boss: shell bars stuck after a swipe): the old
          // repair adopted the visible page as the tab but NEVER synced
          // barsTab, so the bars stayed at the old tab's heights on the
          // new page (profile content under chats bars). This runs only
          // when settled, so syncing bars here keeps the settle-only
          // profile-entrance design intact.
          const tab = ni === -1 ? 'profile' : ni === 0 ? 'chats' : ni === 1 ? 'voice' : 'contacts';
          setPagerIndex(ni);
          setActiveTab(tab);
          setBarsTab(tab);
        }
      }
    }, []),
  );

  // 2026-10-30 (boss: profile as pager page): system back from the pager
  // profile goes to Chat, NOT out of the app. Focus-gated: the listener
  // lives only while the home shell is focused, so back from a profile
  // SUB-route (Edit / Visitors / ...) still pops that route natively —
  // the shell loses focus while a route sits on top (listener removed)
  // and regains it when the route pops (listener re-added). Press-time
  // ref read: a pager switch never changes focus, so a listener added
  // while on Chats still does the right thing once the user slides to
  // Profile. RN Modal dialogs (story viewer, profile dialogs) add their
  // own back listener when visible and consume the press first.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (pagerIndexRef.current === -1) {
          goToTab('chats');
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [goToTab]),
  );

  // 2026-10-26 (boss: imo top bar restored): top-bar tabs drive the home.
  // Chat → chats, Voice → rooms tab (inline, bars stay), Contacts → contacts, DP → profile
  // (same destinations the old text tab bar offered — nothing lost).
  const handleTopBarTab = useCallback((tab: 'chat' | 'voice' | 'contacts') => {
    if (tab === 'chat') goToTab('chats');
    else if (tab === 'voice') goToTab('voice');
    else goToTab('contacts');
  }, [goToTab]);

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
    const chat = imoChatsRef.current.find((c) => c.id === chatId);
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
  }, [router]);

  // Shared call starter — used by chat-row call buttons and call-history call-back.
  const startCall = useCallback((participantId: string, name: string, photoURL?: string | null) => {
    if (!user?.uid || !participantId) return;
    // P1 fix (2026-10-12): busy guard — never dial while a call is active/minimized.
    if (getMinimizedCall()) {
      Alert.alert('Already in a call', 'You are already in a call. Please end the current call before starting a new one.');
      return;
    }
    const callRoomId = buildCallRoomId(user.uid, participantId);
    let url = `/audio-call?roomId=${encodeURIComponent(callRoomId)}&role=caller&remoteUid=${encodeURIComponent(participantId)}&remoteName=${encodeURIComponent(name)}&calleeUid=${encodeURIComponent(participantId)}&myUid=${encodeURIComponent(user.uid)}&myName=${encodeURIComponent(user.displayName || 'Vee User')}`;
    if (photoURL) url += `&remotePhotoURL=${encodeURIComponent(photoURL)}`;
    if (profile?.photoURL) url += `&myPhotoURL=${encodeURIComponent(profile.photoURL)}`;
    router.push(url as any);
  }, [router, user, profile]);

  const handleCallPress = useCallback((chat: IMOChat) => {
    if (!chat.participantId) return;
    startCall(chat.participantId, chat.name, chat.photoURL);
  }, [startCall]);

  const handleCallBack = useCallback((entry: CallHistoryEntry) => {
    startCall(entry.remoteUid, entry.remoteName || 'Vee User', entry.remotePhotoURL);
  }, [startCall]);

  // 2026-10-30 (boss: profile pre-loaded): profile page node for the
  // pager — placeholder until warm-up, then the real screen, mounted
  // forever after. (If the pager unmounts for the stories/calls tabs,
  // profileWarmed stays true, so returning mounts the real screen
  // immediately — no placeholder repeat.)
  // 2026-11-02 (boss correction): Me tab keeps the OLD profile page.
  // The GPT menu opens from the Room-header person icon (/profile/menu).
  const profilePage = useMemo(() => profileWarmed ? (
    <ProfileScreen key="pager-profile" embedded />
  ) : (
    <View key="pager-profile" style={{ flex: 1, backgroundColor: '#FFFFFF' }} />
  ), [profileWarmed]);

  // 2026-10-30 (boss: home page-swipe): chat page node for the pager.
  // Content UNCHANGED — moved out of the conditional so the pager can
  // keep it mounted beside the voice/contacts pages.
  const chatsPage = useMemo(() => (
    <View key="pager-chats" style={{ flex: 1 }}>
      <FlatList
        data={imoChats}
        keyExtractor={(item) => item.id}
        getItemLayout={getRowLayout}
        // 2026-11-11 (boss: Story + Planet bar scrolls with the list):
        // the strip was a fixed sibling above the list, so it stayed
        // pinned while chats scrolled underneath. It is now the list's
        // ListHeaderComponent, so it scrolls away with the content and
        // returns on scroll-back-to-top. Top bar / bottom bar untouched.
        // getItemLayout offsets are NOT adjusted for the header: they feed
        // only the windowing math (no scrollToIndex is used on this list),
        // and windowSize 5 keeps ~2 viewports of overscan each side, which
        // dwarfs the ~110px header — the windowing is unaffected in
        // practice. (Verified in @react-native/virtualized-lists,
        // RN 0.81.5: getItemLayout offsets are used verbatim for the
        // windowing frames; the header is a separate always-mounted cell.)
        ListHeaderComponent={(
          <IMOStoryRow
            stories={imoStories}
            onAddStory={handleAddStory}
            onStoryPress={handleStoryPress}
          />
        )}
        // 2026-11-07 (IMO home scroll smoothness): windowSize 11 -> 5.
        // With removeClippedSubviews={false} (required — the pager Pan
        // gesture breaks if clipping is on), windowSize 11 kept ~5.5
        // viewports of rows mounted on each side (~90 rows), each holding
        // an image + a VerifiedName subscription. 5 keeps ~2 viewports
        // each side (~45 rows max) — still far more lookahead than a
        // fling needs, with half the mounted work. Clipping stays off.
        windowSize={5}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={false}
        nestedScrollEnabled={true}
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
  ), [imoStories, imoChats, getRowLayout, chatsReady, menuChat, user?.uid, handleAddStory, handleStoryPress, handleChatPress, handleLongPress, handleCallPress, runMenuAction, closeMenu]);

  // 2026-11-02 (home swipe: super smooth, one page only): the pager
  // pages keep STABLE element identity across shell renders. Before,
  // every shell render rebuilt all four page elements, so every swipe
  // settle (setPagerIndex + setActiveTab) and every mid-swipe data
  // arrival forced React to reconcile ProfileScreen + the chat list +
  // VoiceRoomHome + ContactsScreen on the JS thread while the settle
  // spring was animating — the slight shake. Now a settle re-render
  // reconciles nothing inside the pager (all four identities stable),
  // and a data arrival re-renders only the page whose data changed
  // (voice/contacts take no props, so their elements are constant).
  // Same elements, same order, same props — referential stability
  // only, zero behavior/layout change.
  const voicePage = useMemo(() => <VoiceRoomHome key="pager-voice" />, []);
  const contactsPage = useMemo(() => <ContactsScreen key="pager-contacts" />, []);
  const pagerPages = useMemo(() => [profilePage, chatsPage, voicePage, contactsPage], [profilePage, chatsPage, voicePage, contactsPage]);

  return (
    <SafeAreaView edges={['left', 'right']} style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      {/* 2026-10-24 (boss: no more builds): server-driven content surface.
          Renders nothing until RTDB `app_content` carries a 'home' item. */}
      <UniversalContentRenderer location="home" uid={user?.uid} />
      {/* 2026-10-26 (boss: imo top bar restored, 2026-10-10 design): DP +
          Chat / Voice / Contacts tabs + unread badge. Stories/calls tabs
          have no top-bar tab → 'none' (no wrong highlight). */}
      <Animated.View style={[{ overflow: 'hidden', backgroundColor: '#FFFFFF' }, topBarWrapStyle]}>
        <View
          style={{ paddingTop: insets.top }}
          onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0 && !topBarMeasured.current) { topBarMeasured.current = true; topBarFullH.value = h; } }}
        >
          <IMOTopBar
            profilePhotoURL={profile?.photoURL || null}
            profileInitials={(user?.displayName || '?').trim().charAt(0).toUpperCase() || '?'}
            activeTab={activeTab === 'chats' ? 'chat' : activeTab === 'voice' ? 'voice' : activeTab === 'contacts' ? 'contacts' : activeTab === 'profile' ? 'profile' : 'none'}
            chatBadgeCount={totalUnread}
            pagerProgress={pagerProgress}
            onProfilePress={() => goToTab('profile')}
            onTabPress={handleTopBarTab}
          />
        </View>
      </Animated.View>
      {/* 2026-10-30 (boss: page-swipe + profile as pager page): the four
          inline pages live in the pager. The shell bars collapse to
          zero height on the profile page (full-screen, Phase 2) and
          return on every other page.
          Voice still renders inline with no onClose → no header ✕,
          same as before; switching tabs is the navigation. DP tap from
          home is a pager switch now, not a route push; the /profile
          route stays for room entry + deep links. */}
      {(activeTab === 'chats' || activeTab === 'voice' || activeTab === 'contacts' || activeTab === 'profile') && (
        <HomePager
          index={pagerIndex}
          progress={pagerProgress}
          pagerSettled={pagerSettled}
          onIndexChange={handlePagerIndexChange}
          pages={pagerPages}
        />
      )}

      {activeTab === 'stories' && (
        <StoriesTabScreen
          stories={stories}
          myUserId={user?.uid}
          myAvatar={profile?.photoURL || null}
          onStoryPress={handleStoryPress}
          onAddStory={handleAddStory}
        />
      )}

      {activeTab === 'calls' && (
        <CallsTabScreen
          onCallBack={handleCallBack}
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

      {/* 2026-10-26 (boss: imo bottom bar restored): "+" opens Contacts
          (start a new chat via a contact's Message button); search opens
          the imo "Search chats and settings" page. The old dark network
          overlay is gone — connection status now lives IN this bar
          ("Connecting..." center + green dot on "+"). */}
      <Animated.View style={[{ overflow: 'hidden', backgroundColor: '#FFFFFF' }, bottomBarWrapStyle]}>
        {/* 2026-10-30 (boss: bottom bar VANISHED after 16:11):
            the 16:11 onLayout-adopts-everything fix regressed the
            bar to zero — a transient small layout value stuck
            forever (no floor, no recovery). Fix forward: the
            wrapper height is now purely insets-derived (57 +
            clearance, see above) and the worklet floors it at
            57 + clearance on settled tabs, so no measured value
            can ever shrink it again. The padding View below keeps
            the clearance under the bar; it no longer measures
            anything. Bar look/position/actions and the profile
            collapse (height -> 0) are unchanged. */}
        <View
          style={{ paddingBottom: bottomClearance }}
        >
          <IMOBottomBar
            onAddPress={() => goToTab('contacts')}
            onSearchPress={() => router.push('/search' as any)}
          />
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    // 2026-10-30 (boss: list times match inbox): same-day clock uses
    // the shared phone-rule formatter (was hardcoded 24h); Yesterday
    // and older-date branches below are untouched.
    return formatMsgTime(timestamp);
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}
