/**
 * InboxScreen — ধাপ ৪ — Firebase Real-time DM
 * - Messages: Firebase Realtime DB (real-time)
 * - Typing: Firebase with 4s auto-clear
 * - Presence: Firebase users/{uid}/online
 * - Media: Cloudinary upload → URL stored in Firebase
 * - Video: type-detected viewer with native open
 * - "..." More options: Block (working), Report, Clear Chat
 *
 * RC8-A changes:
 *   - SECURITY: Block user now actually calls blockService.blockUser() and
 *     navigates back. Previously the onPress handler showed a success Alert but
 *     never called the service — the block was silently discarded.
 *   - PAGINATION: subscribeMessages now returns the 50 most recent messages.
 *     A "Load earlier messages" header allows loading older pages via
 *     loadOlderMessages() (cursor-based, DM_PAGE_SIZE=50 per page).
 *     The list never auto-scrolls when older messages are prepended, so the
 *     user's reading position is preserved.
 */

import {
  useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TextInput, Pressable, KeyboardAvoidingView, Platform, Animated, Dimensions, Alert, Modal, Image, Linking } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import MessageBubble, { saveRemoteMediaToGallery } from '../components/MessageBubble';
// 2026-10-19 (IMO port): animated waves for the voice recording bar.
import VoiceWaves from '../components/VoiceWaves';
import {
  subscribeMessages, sendMessage, markAllSeen, newMessageKey,
  subscribeTyping, subscribePresence, setTyping,
  addReaction, deleteMessage, clearChat,
  loadOlderMessages, DM_PAGE_SIZE } from '../services/firebaseDmService';
// 2026-10-13 (Sumon): showNotification সরানো হলো — InAppNotification কোথাও
// mount করা নেই (dead code), আর খোলা chat-এ banner+haptic শুধু বিরক্তি; নতুন
// message এমনিতেই list-এ scroll হয়ে দেখা যায়।
// NOTE 5 (2026-10-11): offline-first message history cache.
import { loadChatMessages, saveChatMessages } from '../services/chatCacheService';
import { DmMessage, DmReplyPreview } from '../types/dm';
// NOTE 5 (2026-10-11): every error must show its actual cause.
import { getErrorCause } from '@/src/utils/errorDisplay';
import { uploadImage } from '@/src/services/cloudinaryService';
// 2026-10-19 (IMO port): IMO-style voice messages — record in chat,
// upload to Vee's Telegram storage, playable bubble.
import { useVoiceRecorder, formatVoiceDuration, MAX_VOICE_SEC } from '../hooks/useVoiceRecorder';
// 2026-10-19 OOM fix: fullscreen chat image viewer uses expo-image
// (disk cache + native downsampling). RN core Image decodes full-resolution
// originals (Telegram serves originals; 20–50MB photos → OOM). Same size.
import { Image as ExpoImage } from 'expo-image';
import { useAuth } from '@/src/context/AuthContext';
import { submitReport } from '@/src/services/reportService';
// RC6 fix Issue 5 + Issue 8
import { subscribeUser } from '@/src/services/userService';
import { buildCallRoomId } from '@/src/features/audio-call/services/firebaseCallService';
import { getMinimizedCall } from '@/src/features/audio-call/services/callMinimizeStore';
import { isVoiceRoomAudioActive } from '@/src/services/audioOwner';
// RC8-A: actual block user implementation
import { blockUser, getBlockDirection, BlockDirection, BlockedInteractionError } from '@/src/services/blockService';
import { isVeeTeam } from '../services/veeTeamService';
import { VerifiedName } from '@/src/components/VerifiedName';
import { getUserPrivacy } from '@/src/services/privacyService';
import { alertPermissionPermanentlyDenied } from '@/src/utils/permissionAlert';

// 2026-10-19 polish: FlatList row union — day separators interleaved with messages.
type ChatRow =
  | { kind: 'sep'; dayKey: string; label: string }
  | { kind: 'msg'; message: DmMessage };

const { width, height } = Dimensions.get('window');

const C = {
  bg: '#FFFFFF',
  surface: '#F2F2F7',
  border: '#E5E5EA',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  text: '#000000',
  muted: '#8E8E93',
  dim: '#C7C7CC',
  inputBg: '#F2F2F7',
  headerBg: 'rgba(255,255,255,0.97)',
  onlineGreen: '#22C55E',
  offlineGray: '#C7C7CC' } as const;

// ── Typing dots ────────────────────────────────────────────────────────────────
function TypingDots() {
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 350, useNativeDriver: true }),
          Animated.delay((2 - i) * 150),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: '#E9E9EB',
      borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10,
      borderWidth: 1, borderColor: C.border,
      alignSelf: 'flex-start', marginLeft: 14, marginBottom: 6 }}>
      {dots.map((dot, i) => (
        <Animated.View key={i} style={{
          width: 7, height: 7, borderRadius: 4,
          backgroundColor: C.glow,
          opacity: dot,
          transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }} />
      ))}
    </View>
  );
}

// ── Video viewer overlay ────────────────────────────────────────────────────────
function VideoViewer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const { t } = useTranslation();

  const handleOpen = useCallback(() => {
    Linking.openURL(uri).catch(() => {
      Alert.alert(t('chat.error'), t('chat.videoOpenError'));
    });
  }, [uri, t]);

  return (
    <View style={{
      flex: 1, backgroundColor: '#000',
      alignItems: 'center', justifyContent: 'center' }}>
      <Pressable
        style={{ position: 'absolute', top: 55, right: 20, zIndex: 10, padding: 8 }}
        onPress={onClose}
      >
        <Feather name="x" size={28} color="#fff" />
      </Pressable>

      {/* Video icon */}
      <View style={{
        width: 120, height: 120, borderRadius: 60,
        backgroundColor: 'rgba(255,255,255,0.12)',
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
        marginBottom: 24 }}>
        <Feather name="play-circle" size={56} color="#fff" />
      </View>

      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginBottom: 24 }}>
        {t('chat.videoMessage')}
      </Text>

      <Pressable
        onPress={handleOpen}
        style={{
          backgroundColor: C.primary, borderRadius: 14,
          paddingHorizontal: 28, paddingVertical: 14,
          flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Feather name="external-link" size={18} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>
          {t('chat.openInDevice')}
        </Text>
      </Pressable>
    </View>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
type Props = {
  chatId: string;
  participantId: string;
  participantName: string;
};

export default function InboxScreen({ chatId, participantId, participantName }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();
  const myUid = user?.uid ?? 'unknown';

  // 2026-10-12 (Sumon): notification title must show the account's REAL name.
  // user.displayName (Firebase Auth) can be empty/stale (Google-login bug
  // class) — the source of truth is the RTDB profile `name`.
  const [myRealName, setMyRealName] = useState<string>('');
  useEffect(() => {
    if (!user?.uid) return;
    return subscribeUser(user.uid, (profile) => {
      if (profile?.name) setMyRealName(profile.name);
    });
  }, [user?.uid]);

  // FIX (2026-10-09): Derive participantId from chatId when not provided.
  // Notification deep-links only pass chatId (format: sortedUids joined by '_').
  // Without this, the header shows "User" and profile shows "User not found".
  const effectiveParticipantId = useMemo(() => {
    if (participantId && participantId.length > 0) return participantId;
    const parts = chatId.split('_');
    const other = parts.find(p => p !== myUid && p.length > 0);
    return other ?? '';
  }, [participantId, chatId, myUid]);

  // ── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages]             = useState<DmMessage[]>([]);
  // 2026-10-19 perf: optimistic sends — bubbles with status:'sending' shown
  // instantly while the real write is in flight. Same id as the final message
  // (client-generated push key), so the live subscription dedupes them.
  const [pendingMsgs, setPendingMsgs]       = useState<DmMessage[]>([]);
  const [inputText, setInputText]           = useState('');
  const [replyTarget, setReplyTarget]       = useState<DmMessage | null>(null);
  const [isTypingRemote, setIsTypingRemote] = useState(false);
  const [isOnline, setIsOnline]             = useState(false);
  const [lastSeen, setLastSeen]             = useState<number | null>(null);
  const [mediaViewerUri, setMediaViewerUri] = useState<string | null>(null);
  const [mediaViewerType, setMediaViewerType] = useState<'image' | 'video'>('image');
  const [uploadingMedia, setUploadingMedia] = useState(false);
  // 2026-10-18 (Sumon): media send confirmation — select → preview + OK → send.
  // Multi-select supported. Pending assets shown in confirmation modal.
  const [pendingMedia, setPendingMedia] = useState<ImagePicker.ImagePickerAsset[]>([]);
  // RC6 fix Issue 5: live participant photo from RTDB (stale auth photo replaced)
  const [participantPhotoURL, setParticipantPhotoURL] = useState<string | null>(null);

  // RC8-A: pagination state
  const [olderMessages, setOlderMessages]     = useState<DmMessage[]>([]);
  const [oldestRecentKey, setOldestRecentKey] = useState<string | null>(null);
  const [hasMoreOlder, setHasMoreOlder]       = useState(false);
  const [loadingOlder, setLoadingOlder]       = useState(false);
  const [blockDirection, setBlockDirection]   = useState<BlockDirection>('none');
  // A1 fix: track initial load so empty-state doesn't flash before Firebase returns.
  const [initialLoading, setInitialLoading]   = useState(true);
  // 2026-10-13 (Sumon): three-dot menu — custom polished modal (Cancel button সহ)।
  const [moreOptionsVisible, setMoreOptionsVisible] = useState(false);
  // 2026-10-14 (Sumon): scroll-to-bottom floating button — উপরে scroll করলে দেখাবে।
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  // 2026-10-19 (IMO port): voice message recording state.
  const voice = useVoiceRecorder();
  const [uploadingVoice, setUploadingVoice] = useState(false);

  const flatRef         = useRef<FlatList>(null);
  const inputRef        = useRef<TextInput>(null);
  const lastNotifId     = useRef<string>('');
  const shouldScrollRef = useRef(true);
  const typingDebounce  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 2026-10-19 (stability): seen-receipt gating — mark seen ONLY while the
  // user is actually viewing the bottom of the chat (atBottomRef), throttle
  // marks to one per 5s, and remember the newest key already marked
  // (lastMarkedKeyRef) so each mark reads only the newer-than-last-seen
  // delta instead of the last 100 messages every time.
  const atBottomRef       = useRef(true);
  const lastMarkSeenAtRef = useRef(0);
  const lastMarkedKeyRef  = useRef<string | null>(null);
  const markedChatRef     = useRef<string | null>(null);
  // 2026-10-13 (Sumon): inbox খুললে সর্বশেষ message-এ থাকতে হবে। image/media
  // async load হয়ে content height বদলালে scroll position নষ্ট হয় — তাই
  // initial load phase-এ onContentSizeChange-এও scroll to end করি।
  const userScrolledRef    = useRef(false);

  // ── Status text helper ────────────────────────────────────────────────────
  const getStatusText = useCallback((
    ls: number | null,
    online: boolean,
    typing: boolean,
  ): string => {
    if (typing) return t('chat.statusTyping');
    if (online) return t('chat.statusOnline');
    if (!ls) return t('chat.statusOffline');
    const diff = Date.now() - ls;
    const min = 60_000;
    const h = 3_600_000;
    if (diff < min) return t('chat.statusJustNow');
    if (diff < h) return t('chat.statusMinutesAgo', { count: Math.floor(diff / min) });
    if (diff < 2 * h) return t('chat.statusOneHourAgo');
    if (diff < 24 * h) return t('chat.statusHoursAgo', { count: Math.floor(diff / h) });
    return t('chat.statusYesterday');
  }, [t]);

  // ── Subscribe to Firebase messages ─────────────────────────────────────────
  // RC8-A: subscribeMessages now returns limitToLast(50). The callback
  // receives an oldestKey so we know where to start the "load older" cursor.
  // NOTE 5 (2026-10-11): offline-first — render the cached page instantly,
  // then live-subscribe; every live update refreshes the cache. Firebase
  // onValue auto-syncs on reconnect.
  useEffect(() => {
    shouldScrollRef.current = true;
    setInitialLoading(true);
    let cancelled = false;

    loadChatMessages(chatId).then((cached) => {
      if (!cancelled && cached && cached.length > 0) {
        setMessages(cached);
        setInitialLoading(false);
      }
    });

    const unsubMsgs = subscribeMessages(chatId, myUid, (msgs, oldestKey) => {
      if (cancelled) return;
      setMessages(msgs);
      setOldestRecentKey(oldestKey);
      saveChatMessages(chatId, msgs);
      // A1: first callback means initial load done — hide spinner.
      setInitialLoading(false);
      // If the page is full, there may be older messages to fetch
      setHasMoreOlder(msgs.length >= DM_PAGE_SIZE);

      const latest = msgs[msgs.length - 1];
      if (latest && latest.senderId !== myUid && latest.id !== lastNotifId.current) {
        lastNotifId.current = latest.id;
        // 2026-10-13 (Sumon): খোলা chat-এ নতুন message এলে শুধু scroll — কোনো
        // banner বা haptic নয় (message এমনিতেই চোখের সামনে, buzz বিরক্তিকর)।
        if (atBottomRef.current) shouldScrollRef.current = true;  // 2026-10-26: no yank while reading history
      }
    });

    return () => {
      cancelled = true;
      unsubMsgs();
    };
  }, [chatId, myUid]);

  // ── Subscribe to typing ──────────────────────────────────────────────────
  useEffect(() => {
    if (!effectiveParticipantId) return;
    const unsub = subscribeTyping(chatId, effectiveParticipantId, setIsTypingRemote);
    return unsub;
  }, [chatId, effectiveParticipantId]);

  // ── Subscribe to presence (respects target's privacy settings) ────────────
  useEffect(() => {
    if (!effectiveParticipantId) return;
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      // 2026-10-19 perf: ONE privacy read per chat open, passed into
      // subscribePresence below — previously this did two reads here plus a
      // third re-fetch inside subscribePresence. getUserPrivacy never rejects
      // (fail-closed on error), so semantics match the old canView* calls.
      const privacy = await getUserPrivacy(effectiveParticipantId);
      if (cancelled) return;
      const showOnline = privacy.showOnlineStatus;
      const showSeen = privacy.showLastSeen;
      if (!showOnline && !showSeen) {
        // Privacy: hide both — don't subscribe at all.
        setIsOnline(false);
        setLastSeen(null);
        return;
      }
      unsub = subscribePresence(effectiveParticipantId, (online, seen) => {
        setIsOnline(showOnline ? online : false);
        setLastSeen(showSeen ? seen : null);
      }, privacy);
    })();
    return () => { cancelled = true; unsub?.(); };
  }, [effectiveParticipantId]);

  // RC6 fix Issue 5: subscribe to participant's RTDB profile for live photoURL.
  // 2026-10-13 (Sumon): live নামও নিই — header/push/alert-এ stale নাম দেখাতো।
  const [participantLiveName, setParticipantLiveName] = useState<string>('');
  useEffect(() => {
    if (!effectiveParticipantId) return;
    return subscribeUser(effectiveParticipantId, (profile) => {
      if (profile?.photoURL) setParticipantPhotoURL(profile.photoURL);
      // || ব্যবহার (?? নয়) — Google user-এর নাম empty string হতে পারে
      if (profile?.name) setParticipantLiveName(profile.name);
    });
  }, [effectiveParticipantId]);

  // 2026-10-15 (Sumon): NEVER show "Unknown" — live নাম থাকলে সেটাই,
  // নইলে prop-এর নাম ("Unknown" হলে বাদ), সবশেষে "Vee User" fallback.
  const _rawInboxName = participantLiveName || participantName;
  const displayName = _rawInboxName && _rawInboxName.trim().length > 0 && _rawInboxName !== 'Unknown'
    ? _rawInboxName.trim()
    : 'Vee User';

  // 2026-10-17 (Sumon): Vee Team system account — no replies, verified badge.
  const isSystemChat = isVeeTeam(effectiveParticipantId);

  // ── Mark seen on open ──────────────────────────────────────────────────
  // 2026-10-19 (stability): throttled + gated — only when the user is
  // actually at the bottom (visible); never while scrolled up reading
  // history (that wrongly cleared the unread badge). Each invocation reads
  // only messages newer than the last marked key.
  const markSeenThrottled = useCallback(() => {
    if (!atBottomRef.current) return;
    const now = Date.now();
    if (now - lastMarkSeenAtRef.current < 5000) return;
    lastMarkSeenAtRef.current = now;
    const afterKey = markedChatRef.current === chatId ? lastMarkedKeyRef.current : null;
    markedChatRef.current = chatId;
    // background: safe to swallow — seen receipts are best-effort
    markAllSeen(chatId, myUid, afterKey)
      .then((newestKey) => {
        if (newestKey) lastMarkedKeyRef.current = newestKey;
      })
      .catch(() => {});
  }, [chatId, myUid]);

  useEffect(() => {
    if (messages.length > 0) {
      markSeenThrottled();
    }
  }, [chatId, myUid, messages.length, markSeenThrottled]);

  // ── Block status: check on open and refresh when returning ────────────────
  useEffect(() => {
    let cancelled = false;
    getBlockDirection(myUid, effectiveParticipantId)
      .then((d) => { if (!cancelled) setBlockDirection(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [myUid, effectiveParticipantId]);

  // ── Timers cleanup on unmount ─────────────────────────────────────────────
  useEffect(() => () => {
    if (typingDebounce.current) clearTimeout(typingDebounce.current);
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
  }, []);

  // ── Auto-scroll (only for new messages, not when older ones are loaded) ───
  // 2026-10-19 perf: pendingMsgs.length in deps — an optimistic bubble must
  // scroll into view the instant it renders, not when the server echo lands.
  // 2026-10-26 (typing-jitter fix): the list is inverted, so the bottom is
  // pinned natively — no scroll choreography needed. This effect only
  // returns the user to the bottom after their OWN send / initial load /
  // an incoming message while already at bottom (shouldScrollRef is set
  // only in those cases — incoming while scrolled up no longer yanks).
  useEffect(() => {
    if (messages.length > 0 && shouldScrollRef.current) {
      shouldScrollRef.current = false;
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        flatRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 80);
    }
  }, [messages.length, pendingMsgs.length]);

  // ── 2026-10-13 (Sumon): content height বদলালে (image/media async load)
  // initial 3s-এ scroll to end — user manually scroll করলে বন্ধ।
  // 2026-10-26 (typing-jitter fix): content-size scroll DELETED — the inverted
  // list pins the bottom natively, so image loads no longer yank the view.

  const handleScrollBeginDrag = useCallback(() => {
    userScrolledRef.current = true;
  }, []);

  // 2026-10-14 (Sumon): scroll position track — নিচে না থাকলে floating button দেখাও।
  // 2026-10-19 perf: ref-guard — scrollEventThrottle={16} fires ~60×/s; only
  // setState when the boolean actually flips (was: setState on every event).
  const showScrollBtnRef = useRef(false);
  const setShowScrollBtnGuarded = useCallback((v: boolean) => {
    if (showScrollBtnRef.current !== v) {
      showScrollBtnRef.current = v;
      setShowScrollBtn(v);
    }
  }, []);
  const handleScroll = useCallback((e: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    // 2026-10-26 (typing-jitter fix): inverted list — offset 0 IS the bottom.
    const isAtBottom = contentOffset.y <= 100;
    const wasAtBottom = atBottomRef.current;
    atBottomRef.current = isAtBottom;
    setShowScrollBtnGuarded(!isAtBottom);
    // 2026-10-19: user scrolled back to the bottom after reading history —
    // messages that arrived meanwhile are now visible; mark them seen.
    if (isAtBottom && !wasAtBottom) markSeenThrottled();
  }, [markSeenThrottled, setShowScrollBtnGuarded]);

  const scrollToBottom = useCallback(() => {
    flatRef.current?.scrollToOffset({ offset: 0, animated: true });
    setShowScrollBtnGuarded(false);
    userScrolledRef.current = false;
  }, [setShowScrollBtnGuarded]);

  // ── Load older messages (pagination) ─────────────────────────────────────
  // RC8-A: cursor-based "load more" using the oldest key in the current window.
  const handleLoadOlder = useCallback(async () => {
    // Determine cursor: if we already have older messages loaded, use the
    // oldest of those; otherwise use the oldest key from the live subscription.
    const cursor = olderMessages.length > 0
      ? olderMessages[0].id
      : oldestRecentKey;

    if (!cursor || loadingOlder) return;

    setLoadingOlder(true);
    try {
      const { messages: fetched, hasMore } = await loadOlderMessages(chatId, myUid, cursor);
      if (fetched.length > 0) {
        // Deduplicate: keep only messages not already in olderMessages or recent messages
        const existingIds = new Set([
          ...olderMessages.map((m) => m.id),
          ...messages.map((m) => m.id),
        ]);
        const newOnes = fetched.filter((m) => !existingIds.has(m.id));
        setOlderMessages((prev) => [...newOnes, ...prev]);
        setHasMoreOlder(hasMore);
      } else {
        setHasMoreOlder(false);
      }
    } catch {
      // Non-critical; silently fail and let user retry
    } finally {
      setLoadingOlder(false);
    }
  }, [chatId, myUid, olderMessages, oldestRecentKey, messages, loadingOlder]);

  // ── Send text ─────────────────────────────────────────────────────────────
  // RACE FIX (double-tap): two rapid invocations of handleSend read the same
  // stale `inputText` closure — setInputText('') doesn't propagate in time —
  // and would each send the same message. A ref (not state) dedupes
  // exact-duplicate sends within a short window without blocking rapid sends
  // of genuinely new text.
  const lastSendRef = useRef<{ text: string; at: number } | null>(null);

  const handleSend = useCallback(async () => {
    // 2026-10-13 (Sumon): auth ছাড়া পাঠানো যাবে না — myUid 'unknown' হলে
    // Firebase rules reject করতো (senderId অবশ্যই auth.uid হতে হবে)।
    if (!user?.uid) return;
    // 2026-10-17 (Sumon): Vee Team system account — replies disabled.
    if (isVeeTeam(effectiveParticipantId)) return;
    const text = inputText.trim();
    if (!text) return;
    const now = Date.now();
    const last = lastSendRef.current;
    if (last && last.text === text && now - last.at < 2000) return; // duplicate tap — drop
    lastSendRef.current = { text, at: now };
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const replyPreview: DmReplyPreview | undefined = replyTarget
      ? {
          messageId: replyTarget.id,
          senderName: replyTarget.senderId === myUid ? t('chat.replyingToYou') : displayName,
          preview: replyTarget.content.slice(0, 60),
          type: replyTarget.type }
      : undefined;

    // 2026-10-19 perf (SUPERFAST bar): optimistic send. The bubble renders
    // instantly with status:'sending' and the input clears immediately — the
    // user never waits on the network. The optimistic id IS the final push
    // key (newMessageKey), so the live subscription dedupes it by id when
    // the real message arrives. On failure the input text is restored, so a
    // failed send never loses what was typed.
    const savedReplyTarget = replyTarget;
    const messageKey = newMessageKey(chatId);
    const optimistic: DmMessage = {
      id: messageKey,
      chatId,
      senderId: myUid,
      type: 'text',
      content: text,
      createdAt: Date.now(),
      status: 'sending',
      reactions: {},
      ...(replyPreview ? { replyTo: replyPreview } : {}),
    };
    setPendingMsgs((prev) => [...prev, optimistic]);
    setInputText('');
    setReplyTarget(null);
    shouldScrollRef.current = true;
    setTyping(chatId, myUid, false);

    try {
      await sendMessage(chatId, myUid, effectiveParticipantId, text, 'text', replyPreview, undefined, myRealName || user?.displayName || undefined, messageKey);
      // Success — the live subscription delivers the real message under the
      // same id; drop the optimistic copy (the id-dedupe is the backstop).
      setPendingMsgs((prev) => prev.filter((m) => m.id !== messageKey));
    } catch (e) {
      // Failed — remove the optimistic bubble and restore the input text.
      setPendingMsgs((prev) => prev.filter((m) => m.id !== messageKey));
      setInputText(text);
      // Restore the reply target too (was previously dropped silently).
      if (savedReplyTarget) setReplyTarget(savedReplyTarget);
      if (e instanceof BlockedInteractionError) {
        const d = await getBlockDirection(myUid, effectiveParticipantId).catch(() => 'none' as BlockDirection);
        setBlockDirection(d);
        Alert.alert(
          t('chat.blockedTitle') ?? 'Blocked',
          d === 'byMe'
            ? (t('chat.blockedByMeMsg', { name: displayName }) ?? `You blocked ${displayName}. Unblock to send messages.`)
            : (t('chat.blockedByThemMsg', { name: displayName }) ?? `${displayName} has blocked you.`),
        );
      } else {
        // NOTE 5 (2026-10-11): show the ACTUAL cause, not a generic message.
        Alert.alert(t('chat.error'), `${t('chat.sendError')}\n\nReason: ${getErrorCause(e)}`);
      }
    }
  }, [inputText, chatId, myUid, effectiveParticipantId, replyTarget, displayName, t, user]);

  // ── IMO-style voice messages ─────────────────────────────────────────────
  // Mic button (in the send circle, IMO beb.xml) → recording bar with timer +
  // waves → send uploads to Telegram storage and sends a 'voice' message.
  const handleMicPress = useCallback(async () => {
    if (!user?.uid) return;
    if (isVeeTeam(effectiveParticipantId)) return;
    if (blockDirection !== 'none') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const started = await voice.startRecording();
    if (!started) {
      // Permission denied or recorder failed — ensurePermission already alerted.
    }
  }, [user?.uid, effectiveParticipantId, blockDirection, voice]);

  const handleVoiceCancel = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await voice.cancelRecording();
  }, [voice]);

  const handleVoiceSend = useCallback(async () => {
    if (!user?.uid || uploadingVoice) return;
    if (isVeeTeam(effectiveParticipantId)) return;
    const rec = await voice.stopRecording();
    if (!rec) return; // nothing recorded (or stop failed)
    setUploadingVoice(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      // Telegram-backed storage, type='chat' (folder 'vee/dm' maps to chat).
      const uploaded = await uploadImage(rec.uri, {
        folder: 'vee/dm',
        mimeHint: 'audio/mp4',
      });
      const messageKey = newMessageKey(chatId);
      const optimistic: DmMessage = {
        id: messageKey,
        chatId,
        senderId: myUid,
        type: 'voice',
        content: uploaded.url,
        durationSec: rec.durationSec,
        createdAt: Date.now(),
        status: 'sending',
        reactions: {},
      };
      setPendingMsgs((prev) => [...prev, optimistic]);
      shouldScrollRef.current = true;
      await sendMessage(
        chatId, myUid, effectiveParticipantId, uploaded.url, 'voice',
        undefined, uploaded.publicId,
        myRealName || user?.displayName || undefined,
        messageKey, rec.durationSec,
      );
      setPendingMsgs((prev) => prev.filter((m) => m.id !== messageKey));
    } catch (e) {
      // Upload/send failed — surface the ACTUAL cause, nothing half-sent.
      Alert.alert(t('chat.error'), `${t('chat.sendError')}\n\nReason: ${getErrorCause(e)}`);
    } finally {
      setUploadingVoice(false);
    }
  }, [user?.uid, uploadingVoice, effectiveParticipantId, voice, chatId, myUid, t, myRealName, user?.displayName]);

  // 2026-10-20 (boss): 2-minute cap — when the timer hits the limit the
  // recording auto-sends, exactly as if the user tapped send.
  useEffect(() => {
    if (voice.isRecording && voice.elapsedSec >= MAX_VOICE_SEC) {
      handleVoiceSend();
    }
  }, [voice.isRecording, voice.elapsedSec, handleVoiceSend]);

  // ── Typing detection ──────────────────────────────────────────────────────
  const handleInputChange = useCallback((text: string) => {
    setInputText(text);
    if (typingDebounce.current) clearTimeout(typingDebounce.current);
    if (text.length > 0) {
      setTyping(chatId, myUid, true);
      typingDebounce.current = setTimeout(() => {
        setTyping(chatId, myUid, false);
      }, 3000);
    } else {
      setTyping(chatId, myUid, false);
    }
  }, [chatId, myUid]);

  // ── Send media (Cloudinary upload) ────────────────────────────────────────
  // RACE FIX (double-tap): the media button's disabled={uploadingMedia} prop is
  // state-driven — two taps within the same frame both read the stale `false`
  // value and each open the image picker, producing duplicate uploads/sends.
  // The ref closes that window.
  const uploadingMediaRef = useRef(false);

  const handleMedia = useCallback(async () => {
    if (uploadingMediaRef.current) return;
    if (!user?.uid) return; // 2026-10-13 (Sumon): auth ছাড়া media পাঠানো যাবে না
    if (isVeeTeam(effectiveParticipantId)) return; // 2026-10-17 (Sumon): Vee Team — no replies
    const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      const title = t('chat.permissionRequired');
      const msg = t('chat.galleryPermission');
      if (canAskAgain === false) alertPermissionPermanentlyDenied(title, msg);
      else Alert.alert(title, msg);
      return;
    }
    // 2026-10-18 (Sumon): multi-select images+videos; confirmation modal
    // (preview + OK) before send — no immediate send on select.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.8,
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: 10 });
    if (result.canceled || !result.assets?.length) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingMedia(result.assets);
  }, [effectiveParticipantId, t, user]);

  // 2026-10-18 (Sumon): confirmed send — uploads each selected asset then
  // sends as individual messages, in order. Superfast: uploads run sequentially
  // but the modal closes immediately for instant feel.
  // 2026-10-19 (stability): per-asset try/catch — one failed upload/send no
  // longer drops the remaining assets. Failed ones are reported with a Retry.
  const sendMediaAssets = useCallback(async (assets: ImagePicker.ImagePickerAsset[]) => {
    if (!assets.length || uploadingMediaRef.current) {
      return { failed: [] as ImagePicker.ImagePickerAsset[], firstCause: null as string | null };
    }
    uploadingMediaRef.current = true;
    setUploadingMedia(true);
    shouldScrollRef.current = true;
    const failed: ImagePicker.ImagePickerAsset[] = [];
    let firstCause: string | null = null;
    try {
      for (const asset of assets) {
        try {
          const isVideo = asset.type === 'video';
          const uploaded = await uploadImage(asset.uri, {
            folder: 'vee/dm',
            mimeHint: isVideo ? 'video/mp4' : undefined,
          });
          await sendMessage(
            chatId, myUid, effectiveParticipantId, uploaded.url,
            isVideo ? 'video' : 'image', undefined, uploaded.publicId,
            myRealName || user?.displayName || undefined);
        } catch (err) {
          failed.push(asset);
          if (!firstCause) firstCause = getErrorCause(err);
        }
      }
    } finally {
      uploadingMediaRef.current = false;
      setUploadingMedia(false);
    }
    return { failed, firstCause };
  }, [chatId, myUid, effectiveParticipantId, user, myRealName]);

  const confirmAndSendMedia = useCallback(async () => {
    const assets = pendingMedia;
    if (!assets.length || uploadingMediaRef.current) return;
    setPendingMedia([]);
    const { failed, firstCause } = await sendMediaAssets(assets);
    if (failed.length > 0) {
      const summary = failed.length === 1
        ? t('chat.mediaOneFailed', { defaultValue: '1 item failed to send.' })
        : t('chat.mediaSomeFailed', { count: failed.length, defaultValue: '{{count}} items failed to send.' });
      Alert.alert(
        t('chat.uploadFailed'),
        firstCause ? `${summary}\n${firstCause}` : summary,
        [
          { text: t('chat.cancel'), style: 'cancel' },
          {
            text: t('chat.retry', { defaultValue: 'Retry' }),
            onPress: () => { void sendMediaAssets(failed); },
          },
        ],
      );
    }
  }, [pendingMedia, sendMediaAssets, t]);

  // ── Reply ──────────────────────────────────────────────────────────────────
  const handleReply = useCallback((msg: DmMessage) => {
    setReplyTarget(msg);
    inputRef.current?.focus();
  }, []);

  // ── Reaction ──────────────────────────────────────────────────────────────
  const handleReaction = useCallback((messageId: string, emoji: string) => {
    addReaction(chatId, messageId, myUid, emoji).catch(() => {
      Alert.alert(t('chat.error'), t('chat.reactionError'));
    });
  }, [chatId, myUid, t]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = useCallback((messageId: string, forEveryone: boolean) => {
    deleteMessage(chatId, messageId, myUid, forEveryone).catch(() => {
      Alert.alert(t('chat.error'), t('chat.deleteError'));
    });
  }, [chatId, myUid, t]);

  // ── "..." More options ─────────────────────────────────────────────────────
  // RC8-A security fix: the block action now actually calls blockUser().
  // Previously this handler showed a success Alert but silently discarded the
  // block — blockService.blockUser() was never invoked.
  // 2026-10-13 (Sumon): three-dot menu — custom polished modal, Cancel button সহ।
  // আগের Alert.alert-এ Cancel দেখা যেত না / back করা যেত না।
  const handleMoreOptions = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMoreOptionsVisible(true);
  }, []);

  const handleBlockFromMenu = useCallback(() => {
    setMoreOptionsVisible(false);
    Alert.alert(
      t('chat.blockTitle'),
      t('chat.blockConfirm', { name: displayName }),
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: t('chat.block'),
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            // FIX (2026-10-19): a failed block must NEVER report success.
            // On failure show the real cause and STAY in the chat (no
            // router.back()) so the user can retry; success UI only runs
            // after blockUser actually succeeds.
            try {
              await blockUser(
                myUid,
                effectiveParticipantId,
                displayName,
                participantPhotoURL ?? undefined,
              );
            } catch (err) {
              Alert.alert(t('chat.error'), getErrorCause(err));
              return;
            }
            Alert.alert(
              t('chat.done'),
              t('chat.blockSuccess', { name: displayName }),
              [{ text: 'OK', onPress: () => router.back() }],
            );
          } },
      ],
    );
  }, [chatId, myUid, effectiveParticipantId, displayName, participantPhotoURL, router, t]);

  const handleReportFromMenu = useCallback(() => {
    setMoreOptionsVisible(false);
    const doReport = async (reason: 'spam' | 'harassment' | 'inappropriate') => {
      try {
        await submitReport({
          reporterUid: myUid,
          reporterName: user?.displayName || 'Vee User',
          reportedUid: effectiveParticipantId,
          reportedName: displayName,
          reason,
          roomId: chatId });
      } catch { /* নিচে success দেখাই */ }
      Alert.alert(t('chat.reported'), t('chat.reportSuccess'));
    };
    Alert.alert(
      t('chat.reportTitle'),
      t('chat.reportReason'),
      [
        { text: t('chat.reportSpam'), onPress: () => doReport('spam') },
        { text: t('chat.reportHarassment'), onPress: () => doReport('harassment') },
        { text: t('chat.reportInappropriate'), onPress: () => doReport('inappropriate') },
        { text: t('chat.cancel'), style: 'cancel' },
      ],
    );
  }, [chatId, myUid, effectiveParticipantId, displayName, t, user]);

  const handleClearFromMenu = useCallback(() => {
    setMoreOptionsVisible(false);
    Alert.alert(
      t('chat.clearChatTitle'),
      t('chat.clearChatConfirm'),
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: t('chat.clearChatTitle'),
          style: 'destructive',
          onPress: async () => {
            try {
              await clearChat(chatId, myUid);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert(t('chat.done'), t('chat.clearChatSuccess'));
            } catch {
              Alert.alert(t('chat.error'), t('chat.clearChatError'));
            }
          } },
      ],
    );
  }, [chatId, myUid, t]);

  // ── Render message ─────────────────────────────────────────────────────────
  // 2026-10-19 polish: day-grouped date separators — chatRows (computed
  // below, after allVisibleMessages) interleaves {kind:'sep'} divider rows
  // with {kind:'msg'} message rows.
  const renderItem = useCallback(({ item }: { item: ChatRow }) => {
    if (item.kind === 'sep') {
      return (
        <View style={{ alignItems: 'center', marginVertical: 10 }}>
          <View style={{
            backgroundColor: 'rgba(0,0,0,0.06)',
            borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4,
          }}>
            <Text style={{ color: C.muted, fontSize: 11, fontWeight: '600' }}>
              {item.label}
            </Text>
          </View>
        </View>
      );
    }
    const msg = item.message;
    if (msg.deletedForMe) return null;
    return (
      <MessageBubble
        message={msg}
        chatId={chatId}
        myUid={myUid}
        onReply={handleReply}
        onMediaPress={(uri, type) => {
          setMediaViewerUri(uri);
          setMediaViewerType(type as 'image' | 'video');
        }}
      />
    );
  }, [chatId, myUid, handleReply]);

  const keyExtractor = useCallback((item: ChatRow) => (
    item.kind === 'sep' ? `sep-${item.dayKey}` : item.message.id
  ), []);

  // RC6 fix Issue 8: navigate to real audio-call screen instead of Alert
  const handleVoiceCall = useCallback(async () => {
    if (!user) return;
    // P1 fix (2026-10-12): busy guard — dialing while a call is minimized
    // would create a second WebRTC session and orphan the first (leaked mic).
    if (getMinimizedCall()) {
      Alert.alert(t('audioCall.alreadyInCallTitle'), t('audioCall.alreadyInCallMsg'));
      return;
    }
    // 2026-10-19 stability fix: mutual exclusion — never start a 1-to-1 call
    // while a voice room holds the native audio pipeline. Two mic captures
    // on one audio session = native contention (hard crash).
    if (isVoiceRoomAudioActive()) {
      Alert.alert(t('audioCall.alreadyInCallTitle'), t('audioCall.alreadyInCallMsg'));
      return;
    }
    // Block enforcement: cannot call if blocked either way.
    const direction = await getBlockDirection(myUid, effectiveParticipantId).catch(() => 'none' as BlockDirection);
    if (direction !== 'none') {
      setBlockDirection(direction);
      Alert.alert(
        t('chat.blockedTitle'),
        direction === 'byMe' || direction === 'mutual'
          ? t('chat.blockedByMeMsg', { name: displayName })
          : t('chat.blockedByThemMsg', { name: displayName }),
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const callRoomId = buildCallRoomId(myUid, effectiveParticipantId);
    let url = `/audio-call?roomId=${encodeURIComponent(callRoomId)}&role=caller&remoteUid=${encodeURIComponent(effectiveParticipantId)}&remoteName=${encodeURIComponent(displayName)}&calleeUid=${encodeURIComponent(effectiveParticipantId)}&myUid=${encodeURIComponent(myUid)}&myName=${encodeURIComponent(myRealName || user.displayName || 'Vee User')}`;
    if (participantPhotoURL) url += `&remotePhotoURL=${encodeURIComponent(participantPhotoURL)}`;
    if (user.photoURL) url += `&myPhotoURL=${encodeURIComponent(user.photoURL)}`;
    router.push(url as never);
  }, [user, myUid, effectiveParticipantId, displayName, participantPhotoURL, router]);

  const statusColor = isTypingRemote ? C.glow : isOnline ? C.onlineGreen : C.offlineGray;
  const topPad = Platform.OS === 'web' ? 67 : 0;

  // RC8-A: combine older loaded messages with the live subscription window.
  // olderMessages is prepended so the conversation renders oldest-to-newest.
  // 2026-10-19 perf: optimistic (still-sending) messages are appended last.
  // They share the final push-key id with the real message (see newMessageKey),
  // so the id-dedupe below drops the optimistic copy the moment the live
  // subscription delivers the real one — no flicker, no content matching.
  const allVisibleMessages = useMemo(() => {
    const combined = [...olderMessages, ...messages, ...pendingMsgs];
    // Deduplicate by id (overlap can happen at page boundaries)
    const seen = new Set<string>();
    return combined.filter((m) => {
      if (m.deletedForMe || m.deletedForEveryone) return false;
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [olderMessages, messages, pendingMsgs]);

  // 2026-10-19 polish: day-grouped date separators — interleave {kind:'sep'}
  // divider rows with {kind:'msg'} message rows for the FlatList.
  const chatRows = useMemo<ChatRow[]>(() => {
    const rows: ChatRow[] = [];
    let lastDayKey = '';
    for (const m of allVisibleMessages) {
      const ts = m.createdAt;
      const dayKey = Number.isFinite(ts)
        ? (() => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; })()
        : 'unknown';
      if (dayKey !== lastDayKey) {
        lastDayKey = dayKey;
        const label = dayLabel(ts);
        if (label) rows.push({ kind: 'sep', dayKey, label });
      }
      rows.push({ kind: 'msg', message: m });
    }
    // 2026-10-26 (typing-jitter fix): inverted list renders data[0] at the
    // bottom, so rows run newest-first; separators land correctly because
    // the whole row array (separators included) is reversed.
    return rows.reverse();
  }, [allVisibleMessages]);

  function dayLabel(ts: number): string {
    if (!Number.isFinite(ts)) return '';
    const d = new Date(ts);
    const now = new Date();
    const startOfDay = (x: Date) => {
      const c = new Date(x);
      c.setHours(0, 0, 0, 0);
      return c.getTime();
    };
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
    if (diffDays <= 0) return t('chat.today', { defaultValue: 'Today' });
    if (diffDays === 1) return t('chat.yesterday', { defaultValue: 'Yesterday' });
    return d.toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
      ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
    });
  }

  // ── "Load earlier messages" footer (visual top in the inverted list) ────────────────────────────────────────
  const ListHeaderComponent = useMemo(() => {
    if (!hasMoreOlder && olderMessages.length === 0) return null;
    return (
      <Pressable
        onPress={handleLoadOlder}
        disabled={loadingOlder || !hasMoreOlder}
        style={{
          alignItems: 'center',
          paddingVertical: 12,
          paddingHorizontal: 20 }}
      >
        {loadingOlder ? (
          <PremiumLoader size="small" />
        ) : hasMoreOlder ? (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: 'rgba(124,58,237,0.12)',
            borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
            borderWidth: 1, borderColor: 'rgba(124,58,237,0.25)' }}>
            <Feather name="chevrons-up" size={14} color={C.glow} />
            <Text style={{ color: C.glow, fontSize: 13, fontWeight: '600' }}>
              Load earlier messages
            </Text>
          </View>
        ) : (
          <Text style={{ color: C.dim, fontSize: 12 }}>
            Beginning of conversation
          </Text>
        )}
      </Pressable>
    );
  }, [hasMoreOlder, loadingOlder, olderMessages.length, handleLoadOlder]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, paddingTop: topPad }}>

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: C.headerBg,
            paddingHorizontal: 14, paddingVertical: 10,
            borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginRight: 10 }}>
              <Feather name="arrow-left" size={22} color="#000000" />
            </Pressable>

            {/* Avatar — tap to visit profile */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(
                  `/user-profile?uid=${encodeURIComponent(effectiveParticipantId)}&name=${encodeURIComponent(displayName)}` as never,
                );
              }}
              style={{ position: 'relative', marginRight: 10 }}
            >
              <View style={{
                width: 42, height: 42, borderRadius: 21,
                backgroundColor: 'rgba(124,58,237,0.25)',
                borderWidth: 2, borderColor: C.glow,
                alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden' }}>
                {participantPhotoURL ? (
                  <Image
                    source={{ uri: participantPhotoURL }}
                    style={{ width: 42, height: 42, borderRadius: 21 }}
                  />
                ) : (
                  <Text style={{ color: '#7C3AED', fontWeight: '900', fontSize: 16 }}>
                    {displayName[0]?.toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={{
                position: 'absolute', bottom: 1, right: 1,
                width: 11, height: 11, borderRadius: 6,
                backgroundColor: isOnline ? C.onlineGreen : C.offlineGray,
                borderWidth: 2, borderColor: C.bg }} />
            </Pressable>

            {/* Name + status */}
            <View style={{ flex: 1 }}>
              {/* 2026-10-17 (Sumon): Vee Team — official verified badge via standard component */}
              {isSystemChat ? (
                <VerifiedName
                  name={displayName}
                  uid={effectiveParticipantId}
                  nameStyle={{ color: '#000000', fontWeight: '800', fontSize: 15 }}
                />
              ) : (
                <Text style={{ color: '#000000', fontWeight: '800', fontSize: 15 }}>
                  {displayName}
                </Text>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
                <Text style={{ color: statusColor, fontSize: 11, fontWeight: '600' }}>
                  {getStatusText(lastSeen, isOnline, isTypingRemote)}
                </Text>
              </View>
            </View>

            {/* Actions — bigger touch targets for easy tapping */}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {/* 2026-10-17 (Sumon): Vee Team system account — no calls. */}
              {/* RC6 fix Issue 8: navigate to real 1-to-1 audio call */}
              {!isSystemChat && (
              <Pressable hitSlop={12} onPress={handleVoiceCall}
                style={{
                  width: 44, height: 44, borderRadius: 22,
                  alignItems: 'center', justifyContent: 'center' }}>
                {/* 2026-10-26 (boss: imo call icon): plain blue handset,
                    exactly like the search-page rows — the old green
                    circle button is gone. */}
                <Ionicons name="call" size={24} color="#2196F3" />
              </Pressable>
              )}
              {/* Video call hidden until implemented — the "coming soon" alert
                  failed the flawless bar. Re-enable when video calling ships. */}
              {/*
              <Pressable
                hitSlop={12}
                onPress={() => Alert.alert(t('chat.videoCallTitle'), t('chat.videoCallMsg'))}
                style={{
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: 'rgba(139,92,246,0.12)',
                  borderWidth: 1, borderColor: 'rgba(139,92,246,0.3)',
                  alignItems: 'center', justifyContent: 'center' }}
              >
                <Feather name="video" size={22} color={C.glow} />
              </Pressable>
              */}
              {/* "..." More options — block is now fully functional */}
              <Pressable hitSlop={12} onPress={handleMoreOptions}
                style={{
                  width: 44, height: 44, borderRadius: 22,
                  alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="more-vertical" size={22} color={C.muted} />
              </Pressable>
            </View>
          </View>

          {/* ── Messages ──────────────────────────────────────────────────── */}
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            // 2026-10-26 (typing-jitter fix): Android is adjustPan — the OS
            // already keeps the input visible, so KAV must stay OFF there
            // (KAV + pan double-shifted the layout on every keyboard cycle).
            // iOS keeps 'padding' as before.
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
            enabled={Platform.OS !== 'android'}
          >
            <FlatList
              ref={flatRef}
              inverted
              data={chatRows}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              contentContainerStyle={{ paddingVertical: 12 }}
              removeClippedSubviews
              initialNumToRender={20}
              maxToRenderPerBatch={15}
              windowSize={10}
              showsVerticalScrollIndicator={false}
              // 2026-10-13 (Sumon): inbox খুললে সর্বশেষ message-এ scroll —
              // image load-এ height বদলালেও নিচেই থাকবে।
              onScrollBeginDrag={handleScrollBeginDrag}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              // RC8-A: footer shows "Load earlier messages" when older pages exist
              // (inverted list: the footer renders at the visual top)
              ListFooterComponent={ListHeaderComponent}
              ListEmptyComponent={
                // A1: show spinner during initial load, not false "empty".
                initialLoading ? (
                  <View style={{ alignItems: 'center', paddingTop: 80 }}>
                    <PremiumLoader size="large" />
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', paddingTop: 80 }}>
                    <Text style={{ color: C.dim, fontSize: 14 }}>
                      {t('chat.emptyMessages')}
                    </Text>
                  </View>
                )
              }
              // 2026-10-26 (typing-jitter fix): inverted list — the header
              // renders at the visual bottom, so typing dots stay under
              // the newest message exactly as before.
              ListHeaderComponent={isTypingRemote ? <TypingDots /> : null}
            />

            {/* ── Reply preview ─────────────────────────────────────────── */}
            {replyTarget && (
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: 'rgba(124,58,237,0.12)',
                borderTopWidth: 1, borderTopColor: 'rgba(124,58,237,0.3)',
                paddingHorizontal: 14, paddingVertical: 10, gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.glow, fontWeight: '700', fontSize: 12, marginBottom: 2 }}>
                    {replyTarget.senderId === myUid
                      ? t('chat.replyingToYou')
                      : t('chat.replyingTo', { name: displayName })}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>
                    {replyTarget.type !== 'text'
                      ? (replyTarget.type === 'voice' ? '🎤 Voice message' : '📷 Media')
                      : replyTarget.content}
                  </Text>
                </View>
                <Pressable onPress={() => setReplyTarget(null)} hitSlop={10}>
                  <Feather name="x" size={18} color={C.muted} />
                </Pressable>
              </View>
            )}

            {/* ── Blocked banner ───────────────────────────────────────────── */}
            {blockDirection !== 'none' && (
              <View style={{
                paddingHorizontal: 16, paddingVertical: 10,
                backgroundColor: 'rgba(239,68,68,0.12)',
                borderTopWidth: 1, borderTopColor: 'rgba(239,68,68,0.3)',
                alignItems: 'center' }}>
                <Text style={{ color: '#DC2626', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                  {blockDirection === 'byMe' || blockDirection === 'mutual'
                    ? t('chat.blockedBannerByMe', { name: displayName })
                    : t('chat.blockedBannerByThem', { name: displayName })}
                </Text>
              </View>
            )}

            {/* 2026-10-14 (Sumon): Scroll-to-bottom floating button —
                উপরে scroll করলে দেখাবে, tap করলে latest message-এ যাবে। */}
            {showScrollBtn && (
              <Pressable
                onPress={scrollToBottom}
                style={{
                  position: 'absolute',
                  right: 16,
                  bottom: 90,
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: C.glow,
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#000', shadowOpacity: 0.3,
                  shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
                  elevation: 6,
                  zIndex: 100 }}
              >
                <Feather name="chevron-down" size={22} color="#fff" />
              </Pressable>
            )}

            {/* ── Input bar (IMO style) ──────────────────────────────────── */}
            {/* 2026-10-17 (Sumon): Vee Team system account — no reply input. */}
            {isSystemChat ? (
              <View style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                paddingHorizontal: 16, paddingVertical: 14,
                borderTopWidth: 1, borderTopColor: C.border,
                backgroundColor: C.headerBg, gap: 8 }}>
                <Feather name="shield" size={15} color={C.muted} />
                <Text style={{ color: C.muted, fontSize: 12, fontWeight: '600', textAlign: 'center' }}>
                  {t('chat.veeTeamNoReply', { defaultValue: 'This is an official Vee Team account. Replies are disabled.' })}
                </Text>
              </View>
            ) : voice.isRecording ? (
            /* ── IMO recording bar (bci.xml): waves + timer + cancel + send ── */
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 12, paddingVertical: 10,
              borderTopWidth: 1, borderTopColor: C.border,
              backgroundColor: C.headerBg, gap: 10 }}>
              {/* Cancel */}
              <Pressable onPress={handleVoiceCancel} hitSlop={10}>
                <View style={{
                  width: 42, height: 42, borderRadius: 21,
                  backgroundColor: 'rgba(239,68,68,0.12)',
                  alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="x" size={20} color="#EF4444" />
                </View>
              </Pressable>
              {/* Waves + timer */}
              <View style={{
                flex: 1, flexDirection: 'row', alignItems: 'center',
                backgroundColor: C.inputBg, borderRadius: 22,
                paddingHorizontal: 14, paddingVertical: 10,
                borderWidth: 1, borderColor: C.border, gap: 10 }}>
                <View style={{
                  width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' }} />
                <Text style={{ color: '#000000', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {formatVoiceDuration(voice.elapsedSec)} / 2:00
                </Text>
                <VoiceWaves />
                <Text style={{ color: C.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>
                  {t('chat.recording', { defaultValue: 'Recording…' })}
                </Text>
              </View>
              {/* Send recording */}
              <Pressable onPress={handleVoiceSend} disabled={uploadingVoice} hitSlop={8}>
                <View style={{
                  width: 50, height: 50, borderRadius: 25,
                  backgroundColor: '#009dff',
                  alignItems: 'center', justifyContent: 'center',
                  opacity: uploadingVoice ? 0.6 : 1 }}>
                  <Feather name="send" size={20} color="#fff" />
                </View>
              </Pressable>
            </View>
            ) : (
            <View style={{
              flexDirection: 'row', alignItems: 'flex-end',
              paddingHorizontal: 12, paddingVertical: 10,
              borderTopWidth: 1, borderTopColor: C.border,
              backgroundColor: C.headerBg, gap: 10,
              opacity: blockDirection !== 'none' ? 0.4 : 1 }}>
              {/* Attachment */}
              <Pressable onPress={handleMedia} hitSlop={8} disabled={uploadingMedia}>
                <View style={{
                  width: 40, height: 40, borderRadius: 20,
                  backgroundColor: uploadingMedia ? 'rgba(124,58,237,0.08)' : 'rgba(124,58,237,0.18)',
                  borderWidth: 1, borderColor: 'rgba(124,58,237,0.35)',
                  alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name={uploadingMedia ? 'loader' : 'image'} size={18} color={C.glow} />
                </View>
              </Pressable>

              {/* Text input */}
              <TextInput
                ref={inputRef}
                editable={blockDirection === 'none'}
                style={{
                  flex: 1, minHeight: 40, maxHeight: 110,
                  backgroundColor: C.inputBg,
                  borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
                  color: '#000000', fontSize: 16,
                  borderWidth: 1, borderColor: C.border }}
                placeholder={blockDirection !== 'none' ? '' : t('chat.messagePlaceholder')}
                placeholderTextColor={C.muted}
                multiline
                value={inputText}
                onChangeText={handleInputChange}
                onSubmitEditing={handleSend}
                blurOnSubmit={false}
                returnKeyType="send"
              />

              {/* IMO send/mic circle (beb.xml): 50dp #009dff — mic when the
                  input is empty, send arrow when there is text. */}
              {inputText.trim() ? (
                <Pressable onPress={handleSend} disabled={blockDirection !== 'none' || !user?.uid} hitSlop={8}>
                  <View style={{
                    width: 50, height: 50, borderRadius: 25,
                    backgroundColor: '#009dff',
                    alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="send" size={20} color="#fff" />
                  </View>
                </Pressable>
              ) : (
                <Pressable onPress={handleMicPress} disabled={blockDirection !== 'none' || !user?.uid || uploadingVoice} hitSlop={8}>
                  <View style={{
                    width: 50, height: 50, borderRadius: 25,
                    backgroundColor: '#009dff',
                    alignItems: 'center', justifyContent: 'center',
                    opacity: uploadingVoice ? 0.6 : 1 }}>
                    <Feather name={uploadingVoice ? 'loader' : 'mic'} size={20} color="#fff" />
                  </View>
                </Pressable>
              )}
            </View>
            )}
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>

      {/* ── 2026-10-13 (Sumon): three-dot options — polished modal, Cancel সহ ── */}
      <Modal
        visible={moreOptionsVisible}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setMoreOptionsVisible(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}
          onPress={() => setMoreOptionsVisible(false)}
        >
          <Pressable
            style={{
              width: '100%',
              backgroundColor: '#fff',
              borderRadius: 20,
              paddingVertical: 8,
              paddingHorizontal: 6,
              elevation: 8,
              shadowColor: '#000',
              shadowOpacity: 0.2,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 4 } }}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Title */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', flex: 1 }} numberOfLines={1}>
                {displayName}
              </Text>
              <Pressable
                hitSlop={12}
                onPress={() => setMoreOptionsVisible(false)}
                style={{ padding: 4 }}
              >
                <Feather name="x" size={22} color="#666" />
              </Pressable>
            </View>

            {/* চ্যাট মুছুন */}
            <Pressable
              onPress={handleClearFromMenu}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 14,
                paddingHorizontal: 18, paddingVertical: 15,
                backgroundColor: pressed ? '#F5F5F5' : 'transparent',
                borderRadius: 12 })}
            >
              <Text style={{ fontSize: 22 }}>🗑️</Text>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#007AFF' }}>
                {t('chat.clearChat')}
              </Text>
            </Pressable>

            {/* রিপোর্ট করুন */}
            <Pressable
              onPress={handleReportFromMenu}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 14,
                paddingHorizontal: 18, paddingVertical: 15,
                backgroundColor: pressed ? '#F5F5F5' : 'transparent',
                borderRadius: 12 })}
            >
              <Text style={{ fontSize: 22 }}>⚠️</Text>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#007AFF' }}>
                {t('chat.reportUser')}
              </Text>
            </Pressable>

            {/* ব্লক করুন */}
            <Pressable
              onPress={handleBlockFromMenu}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 14,
                paddingHorizontal: 18, paddingVertical: 15,
                backgroundColor: pressed ? '#F5F5F5' : 'transparent',
                borderRadius: 12 })}
            >
              <Text style={{ fontSize: 22 }}>🚫</Text>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#FF3B30' }}>
                {t('chat.blockUser')}
              </Text>
            </Pressable>

            {/* বাতিল — 2026-10-13 (Sumon): Cancel button বাধ্যতামূলক */}
            <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10 }}>
              <Pressable
                onPress={() => setMoreOptionsVisible(false)}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? '#D6EBFF' : '#E3F2FD',
                  borderRadius: 14,
                  paddingVertical: 13,
                  alignItems: 'center' })}
              >
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#007AFF' }}>
                  {t('chat.cancel')}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Media viewer ────────────────────────────────────────────────────── */}
      <Modal
        visible={!!mediaViewerUri}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setMediaViewerUri(null)}
      >
        {mediaViewerType === 'video' ? (
          <VideoViewer
            uri={mediaViewerUri ?? ''}
            onClose={() => setMediaViewerUri(null)}
          />
        ) : (
          <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
            {/* Close button */}
            <Pressable
              style={{ position: 'absolute', top: 55, right: 20, zIndex: 10, padding: 8 }}
              onPress={() => setMediaViewerUri(null)}
            >
              <Feather name="x" size={28} color="#fff" />
            </Pressable>
            {/* Save to gallery button — NOTE 12 (2026-10-11): shared helper
                downloads remote URLs to a local file first, real error cause */}
            <Pressable
              style={{ position: 'absolute', top: 55, left: 20, zIndex: 10, padding: 8 }}
              onPress={async () => {
                if (!mediaViewerUri) return;
                await saveRemoteMediaToGallery(mediaViewerUri, {
                  permissionRequired: t('chat.permissionRequired'),
                  galleryPermission: 'Gallery access is needed to save media.',
                  saved: t('chat.saved'),
                  msgSaveToGallery: t('chat.msgSaveToGallery') + ' successfully.',
                  error: t('chat.error'),
                  saveToGalleryFailed: t('chat.saveToGalleryFailed') });
              }}
            >
              <Feather name="download" size={24} color="#fff" />
            </Pressable>
            {mediaViewerUri && (
              <ExpoImage
                source={{ uri: mediaViewerUri }}
                style={{ width, height: height * 0.75 }}
                contentFit="contain"
                cachePolicy="disk"
              />
            )}
          </View>
        )}
      </Modal>

      {/* ── Media send confirmation (2026-10-18 Sumon) ───────────────────────
          Select → preview + OK → send. Multi-select supported (max 10).
          Nothing sends before OK. */}
      <Modal
        visible={pendingMedia.length > 0}
        animationType="slide"
        transparent
        onRequestClose={() => setPendingMedia([])}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
          onPress={() => setPendingMedia([])}
        >
          <Pressable
            style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingBottom: 28, maxHeight: height * 0.7 }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 12, color: '#000' }}>
              {pendingMedia.length} selected
            </Text>
            <FlatList
              data={pendingMedia}
              horizontal
              keyExtractor={(item) => item.assetId || item.uri}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              renderItem={({ item }) => (
                <View style={{ position: 'relative' }}>
                  <Image
                    source={{ uri: item.uri }}
                    style={{ width: 100, height: 100, borderRadius: 12, backgroundColor: '#F0F0F0' }}
                    resizeMode="cover"
                  />
                  {item.type === 'video' && (
                    <View style={{ position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, padding: 4 }}>
                      <Feather name="play" size={14} color="#fff" />
                    </View>
                  )}
                  <Pressable
                    style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#FF3B30', borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => setPendingMedia((prev) => prev.filter((p) => p.uri !== item.uri))}
                  >
                    <Feather name="x" size={14} color="#fff" />
                  </Pressable>
                </View>
              )}
            />
            <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 16, gap: 12 }}>
              <Pressable
                onPress={() => setPendingMedia([])}
                style={{ flex: 1, backgroundColor: '#F0F0F0', borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#000' }}>{t('chat.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={confirmAndSendMedia}
                style={{ flex: 1, backgroundColor: '#E3F2FD', borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#007AFF' }}>OK</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
