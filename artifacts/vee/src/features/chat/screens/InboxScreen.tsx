/**
 * InboxScreen — ধাপ ৪ — Firebase Real-time DM
 * - Messages: Firebase Realtime DB (real-time)
 * - Typing: Firebase with 4s auto-clear
 * - Presence: Firebase users/{uid}/online
 * - Media: Cloudinary upload → URL stored in Firebase
 * - Video: inline expo-video viewer (autoplay, native controls, download)
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
 *
 * Fix #16/#17 (2026-10-29):
 *   - Thread open: cached-first + paginated (limitToLast 50) load verified
 *     intact; the large centered spinner on a cache-miss first load is now
 *     a small inline indicator (header + composer always visible) — no
 *     blank blocking spinner, matching the app-wide no-loading rule.
 *   - Back button: duplicate thread pushes (second tap while the thread
 *     was still opening) self-pop on mount via liveThreadMounts, so one
 *     back press always returns to the chat list.
 *   - Voice send: optimistic bubble with the LOCAL uri renders instantly
 *     (before upload), plus the speech-optimized recording preset in
 *     useVoiceRecorder for ~2.7x smaller files.
 *   - Voice playback (VoiceMessageBubble): loop OFF (pause-then-rewind on
 *     finish + explicit loop=false) and single active playback via a
 *     DM-only player registry.
 */

import {
  useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TextInput, Pressable, KeyboardAvoidingView, Platform, Animated, Dimensions, Alert, Modal, Image, ActivityIndicator, InteractionManager } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import MessageBubble, { saveRemoteMediaToGallery } from '../components/MessageBubble';
// 2026-10-19 (IMO port): animated waves for the voice recording bar.
import VoiceWaves from '../components/VoiceWaves';
import {
  subscribeMessages, sendMessage, markAllSeen, newMessageKey,
  subscribeTyping, subscribePresence, setTyping,
  addReaction, deleteMessage, clearChat,
  subscribeUserChats, subscribePinnedMessage, setPinnedMessage,
  loadOlderMessages, DM_PAGE_SIZE } from '../services/firebaseDmService';
// Pass2 DM (Part 2b, staging build): REST thread/inbox/presence/ops. Every
// use below is gated on pass2DmActive, so with flags off this import is inert.
import {
  fetchPass2Flags, type Pass2Flags,
  subscribePass2Inbox, subscribePass2DmMessages,
  sendPass2DmMessage, sendPass2DmOp, fetchPass2Online,
  type Pass2DmMessage, type Pass2InboxChat,
} from '@/src/features/voice-room/services/pass2RestService';
import { enterPass2Mode, exitPass2Mode } from '@/src/features/voice-room/services/pass2SessionMode';
import type { Chat } from '../types/index';
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
import { VideoView, useVideoPlayer } from 'expo-video';
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
import { dismissChatNotifications } from '@/src/services/fcmPushService';
import { alertPermissionPermanentlyDenied } from '@/src/utils/permissionAlert';

// 2026-10-19 polish: FlatList row union — day separators interleaved with messages.
type ChatRow =
  | { kind: 'sep'; dayKey: string; label: string }
  | { kind: 'msg'; message: DmMessage };

const { width, height } = Dimensions.get('window');

// Fix #16 (back-button bug): live mount counts per chatId for the thread
// screen. If the same thread is pushed twice (e.g. a second tap while it
// was still opening), two identical thread screens stack up and one back
// press only reveals the other copy — the "back re-opens the same thread,
// needs 2-3 backs" bug. The duplicate instance pops itself on mount
// (see the effect near userScrolledRef), leaving exactly one thread, so
// one back always returns to the chat list. Per-chatId counts, so
// different threads never interfere, and sequential open → back →
// reopen counts cleanly (1 → 0 → 1).
const liveThreadMounts = new Map<string, number>();

// Pass2 DM (Part 2b): chatIds opened this session, for the session-local
// unread overlay in the pass2 list callback (markAllSeen has no REST
// equivalent, so the server badge only catches up when the queued SDK mark
// applies on mode exit; locally opened chats read 0 meanwhile).
const pass2DmOpenedChats = new Set<string>();

// Tier DM message -> screen DmMessage. The tier window is text-shaped
// (id/senderId/text/ts/type); anything outside the known types renders as
// text, exactly like the Firebase snapToMessage default.
function pass2DmToDmMessage(m: Pass2DmMessage, chatId: string): DmMessage {
  const known: Array<DmMessage['type']> = ['text', 'image', 'video', 'voice', 'call', 'sticker', 'story_share'];
  return {
    id: m.id,
    chatId,
    senderId: m.senderId,
    type: known.includes(m.type as DmMessage['type']) ? (m.type as DmMessage['type']) : 'text',
    content: typeof m.text === 'string' ? m.text : '',
    createdAt: typeof m.ts === 'number' ? m.ts : Date.now(),
    status: 'sent',
    reactions: m.reactions ?? {},
    ...(typeof m.replyTo === 'object' && m.replyTo !== null ? { replyTo: m.replyTo as DmReplyPreview } : {}),
    ...(typeof m.cloudinaryId === 'string' ? { cloudinaryId: m.cloudinaryId } : {}),
    ...(typeof m.durationSec === 'number' ? { durationSec: m.durationSec } : {}),
    ...(m.deletedForMe === true ? { deletedForMe: true } : {}),
    ...(m.deletedForEveryone === true ? { deletedForEveryone: true } : {}),
  };
}

// Tier inbox row -> screen Chat. The tier returns userChat fields plus
// peerProfile; the Firebase sanitizeChat defaults are mirrored (name
// 'Vee User', no story, not pinned/muted/hidden unless flagged).
function pass2InboxToChat(c: Pass2InboxChat, myUid: string): Chat {
  const prof = (c.peerProfile ?? {}) as Record<string, unknown>;
  const profUid = typeof prof.uid === 'string' ? prof.uid : undefined;
  const profName = typeof prof.name === 'string' ? prof.name : undefined;
  const profAvatar = typeof prof.photoURL === 'string' ? prof.photoURL
    : (typeof prof.avatar === 'string' ? prof.avatar : undefined);
  let participantId = typeof c.peerUid === 'string' ? c.peerUid : (profUid ?? '');
  if (!participantId && typeof c.chatId === 'string') {
    participantId = c.chatId.split('_').find((p) => p !== myUid && p.length > 0) ?? '';
  }
  const lastTime = typeof c.lastMessageAt === 'number' ? c.lastMessageAt
    : (typeof c.lastMessageTime === 'number' ? c.lastMessageTime : 0);
  return {
    id: c.chatId,
    participantId,
    participantName: profName ?? (typeof c.participantName === 'string' ? c.participantName : 'Vee User'),
    participantAvatar: profAvatar ?? (typeof c.participantAvatar === 'string' ? c.participantAvatar : undefined),
    lastMessage: typeof c.lastMessage === 'string' ? c.lastMessage : '',
    lastMessageType: (typeof c.lastMessageType === 'string' ? c.lastMessageType : 'text') as Chat['lastMessageType'],
    lastMessageTime: lastTime,
    unreadCount: typeof c.unreadCount === 'number' ? c.unreadCount : 0,
    isOnline: c.isOnline === true,
    hasStory: c.hasStory === true,
    storySeen: c.storySeen === true,
    isPinned: c.isPinned === true,
    isMuted: c.muted === true || c.isMuted === true,
    isHidden: c.hidden === true || c.isHidden === true,
    isTyping: false,
  };
}

const C = {
  bg: '#ECECF0',
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

// Fix #31/#32 (imo-exact last seen, 2026-10-29): today → "Last seen HH:MM"
// (24-hour); a day or more ago → "Last seen Oct 28, 16:42". The header
// itself stays LIVE: the presence subscription below re-fires on every
// online/offline change, so this text re-renders the moment presence
// changes — never a one-time fetch.
function formatLastSeen(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return `Last seen ${hh}:${mm}`;
  const mon = d.toLocaleDateString('en-US', { month: 'short' });
  return `Last seen ${mon} ${d.getDate()}, ${hh}:${mm}`;
}

// Fix #31 (imo-exact quick reactions, বন্ধু order): tapping one sends it
// instantly as a message (see handleQuickReaction).
const QUICK_REACTIONS = ['😂', '😘', '💋', '🌹', '❤️', '😭', '💕'];

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
// 2026-10-30 (boss: professional superfast media viewer): INLINE
// expo-video playback — autoplay on open, progressive streaming (never
// waits for a full download), native controls, fullscreen + PiP. A small
// buffering indicator shows only while status is loading (never a
// full-screen loader); a failed load shows an error + tap-to-retry
// (player.replay, play fallback). Pause on unmount so audio never leaks
// after close (mirror StoryViewer cleanup). Download reuses the photo
// viewer's save-to-gallery path + strings. The old placeholder + "Open
// in device" browser hop is DELETED.
function VideoViewer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const { t } = useTranslation();
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  const [status, setStatus] = useState<string>('loading');
  useEffect(() => {
    try { setStatus(player.status); } catch { /* ignore */ }
    const sub = player.addListener('statusChange', (e) => {
      setStatus(e.status);
    });
    return () => { sub.remove(); };
  }, [player]);
  useEffect(() => {
    return () => { try { player.pause(); } catch { /* ignore */ } };
  }, [player]);

  const handleRetry = useCallback(() => {
    try { player.replay(); } catch { try { player.play(); } catch { /* ignore */ } }
  }, [player]);

  // 2026-10-30 (boss: download must feel instant): the download
  // itself starts on tap with no confirm step; this spinner only makes
  // its speed visible, and the guard stops double-tap double downloads.
  const [downloading, setDownloading] = useState(false);
  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await saveRemoteMediaToGallery(uri, {
        permissionRequired: t('chat.permissionRequired'),
        galleryPermission: 'Gallery access is needed to save media.',
        saved: t('chat.saved'),
        msgSaveToGallery: t('chat.msgSaveToGallery') + ' successfully.',
        error: t('chat.error'),
        saveToGalleryFailed: t('chat.saveToGalleryFailed') });
    } finally {
      setDownloading(false);
    }
  }, [uri, t, downloading]);

  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <VideoView
        player={player}
        style={{ flex: 1, width: '100%' }}
        contentFit="contain"
        nativeControls
        allowsFullscreen
        allowsPictureInPicture
      />
      {status === 'loading' && (
        <View pointerEvents="none" style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
      {status === 'error' && (
        <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>
            {t('chat.sendError')}
          </Text>
          <Pressable
            onPress={handleRetry}
            style={{ backgroundColor: C.primary, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 }}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Retry</Text>
          </Pressable>
        </View>
      )}
      {/* Close button (kept) */}
      <Pressable
        style={{ position: 'absolute', top: 55, right: 20, zIndex: 10, padding: 8 }}
        onPress={onClose}
      >
        <Feather name="x" size={28} color="#fff" />
      </Pressable>
      {/* Download button (same as the photo viewer) */}
      <Pressable
        style={{ position: 'absolute', top: 55, left: 20, zIndex: 10, padding: 8 }}
        onPress={handleDownload}
      >
        {downloading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Feather name="download" size={24} color="#fff" />
        )}
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

  // ── Pass2 DM mode (Part 2b, staging build) ──────────────────────────────
  // Same pattern as VoiceRoomScreen: local flags state + ref mirror (so
  // callbacks defined once stay current). Every pass2 branch below is
  // gated on pass2DmActive, so with flags off the screen runs today's
  // Firebase path byte-identically. NOTE: this file is the THREAD screen
  // only (there is no main inbox list in it) — the single thread mount
  // owns the 'dm' mode entry; if a future inbox-list screen also enters
  // 'dm', an inbox<->thread switch would exit + re-enter the mode (a
  // brief online flap on switch; steady-state is unaffected).
  const [pass2Flags, setPass2Flags] = useState<Pass2Flags | null>(null);
  const pass2DmActive = pass2Flags?.enabled === true && pass2Flags?.dm === true && myUid !== 'unknown';
  const pass2DmActiveRef = useRef(pass2DmActive);
  useEffect(() => { pass2DmActiveRef.current = pass2DmActive; }, [pass2DmActive]);
  const pass2DmFallback = useCallback(() => {
    setPass2Flags((f) => (f ? { ...f, dm: false } : f));
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetchPass2Flags().then((f) => { if (!cancelled) setPass2Flags(f); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!pass2DmActive) return;
    pass2DmOpenedChats.add(chatId);
    enterPass2Mode('dm', { offline: true });
    return () => { exitPass2Mode('dm'); };
  }, [pass2DmActive, chatId]);

  // ── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages]             = useState<DmMessage[]>([]);
  // 2026-10-19 perf: optimistic sends — bubbles with status:'sending' shown
  // instantly while the real write is in flight. Same id as the final message
  // (client-generated push key), so the live subscription dedupes them.
  const [pendingMsgs, setPendingMsgs]       = useState<DmMessage[]>([]);

  // ── DM text outbox (weak-network Phase 2, mirrors room outbox) ──
  // Failed text sends stay as bubbles with tap-to-retry instead of vanishing;
  // pendings persist per chat so a killed app re-sends them on reopen.
  const DM_OUTBOX_KEY = 'vee_dm_outbox';
  type DmOutboxEntry = { id: string; text: string; replyTo?: DmReplyPreview; createdAt: number };
  const dmOutboxRestoredRef = useRef<string | null>(null);
  const loadDmOutbox = useCallback(async (): Promise<Record<string, DmOutboxEntry[]>> => {
    try {
      const raw = await AsyncStorage.getItem(DM_OUTBOX_KEY);
      return raw ? (JSON.parse(raw) as Record<string, DmOutboxEntry[]>) : {};
    } catch { return {}; }
  }, []);
  const saveDmOutboxEntry = useCallback(async (chat: string, entry: DmOutboxEntry) => {
    try {
      const all = await loadDmOutbox();
      const list = (all[chat] ?? []).filter((e) => e.id !== entry.id);
      list.push(entry);
      all[chat] = list;
      await AsyncStorage.setItem(DM_OUTBOX_KEY, JSON.stringify(all));
    } catch { /* outbox persistence is best-effort; the bubble still retries */ }
  }, [loadDmOutbox]);
  const clearDmOutboxEntry = useCallback(async (chat: string, id: string) => {
    try {
      const all = await loadDmOutbox();
      const list = (all[chat] ?? []).filter((e) => e.id !== id);
      if (list.length > 0) all[chat] = list; else delete all[chat];
      await AsyncStorage.setItem(DM_OUTBOX_KEY, JSON.stringify(all));
    } catch { /* best-effort */ }
  }, [loadDmOutbox]);
  const [inputText, setInputText]           = useState('');
  const [replyTarget, setReplyTarget]       = useState<DmMessage | null>(null);
  const [isTypingRemote, setIsTypingRemote] = useState(false);
  const [isOnline, setIsOnline]             = useState(false);
  const [lastSeen, setLastSeen]             = useState<number | null>(null);
  const [mediaViewerUri, setMediaViewerUri] = useState<string | null>(null);
  const [mediaViewerType, setMediaViewerType] = useState<'image' | 'video'>('image');
  // 2026-10-30 (boss: download must feel instant): spinner state for
  // the photo viewer download button — same rule as video: download
  // starts on tap with no confirm step; the spinner only makes its
  // speed visible.
  const [photoDownloading, setPhotoDownloading] = useState(false);
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
  // Fix #31 (imo-exact quick reactions): emoji row above the composer.
  const [showQuickReactions, setShowQuickReactions] = useState(true);

  const flatRef         = useRef<FlatList>(null);
  // 2026-10-30 (boss: reply-quote tap jumps to the original):
  // id of the bubble currently flashing after a quote jump (cleared
  // after ~1.5s); retry flag for scrollToIndex windowing failures.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpRetryRef = useRef(false);
  // 2026-10-30 (boss: quote-jump must load the window): pending jump
  // target while older pages load, + guard against concurrent jumps.
  const pendingJumpRef = useRef<string | null>(null);
  const jumpLoadingRef = useRef(false);
  // 2026-10-30 (boss: inbox open must be fully smooth): the slide
  // animation shares its window with every mount subscription, and
  // each first callback re-renders the list — that pile-up is the
  // hitch. Non-content subscriptions (typing, presence, peer
  // profile below) wait for this flag, so the animation window
  // only renders content. The 1200ms fallback bounds the wait even
  // if the interaction queue stalls; content + markSeen are never
  // gated (see the message subscription + markSeen effects).
  const [transitionDone, setTransitionDone] = useState(false);
  useEffect(() => {
    let done = false;
    const finish = () => { if (!done) { done = true; setTransitionDone(true); } };
    const task = InteractionManager.runAfterInteractions(finish);
    const timer = setTimeout(finish, 1200);
    return () => { task.cancel(); clearTimeout(timer); };
  }, []);
  const inputRef        = useRef<TextInput>(null);
  const lastNotifId     = useRef<string>('');
  const shouldScrollRef = useRef(true);
  const typingDebounce  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 2026-10-19 (stability): seen-receipt gating — mark seen ONLY while the
  // user is actually viewing the bottom of the chat (atBottomRef), and
  // remember the newest key already marked (lastMarkedKeyRef) so each
  // mark reads only the newer-than-last-seen delta instead of the last
  // 100 messages every time.
  // 2026-10-30 (boss: seen must be INSTANT): NO throttle — the old 5s
  // throttle deferred a mark up to 5s in rapid back-and-forth, so the
  // sender's circle appeared seconds late. Every trigger below writes
  // immediately when at bottom.
  const atBottomRef       = useRef(true);
  const lastMarkedKeyRef  = useRef<string | null>(null);
  const markedChatRef     = useRef<string | null>(null);
  // 2026-10-13 (Sumon): inbox খুললে সর্বশেষ message-এ থাকতে হবে। image/media
  // async load হয়ে content height বদলালে scroll position নষ্ট হয় — তাই
  // initial load phase-এ onContentSizeChange-এও scroll to end করি।
  const userScrolledRef    = useRef(false);

  // Fix #16 (back-button bug): duplicate-thread self-pop — see
  // liveThreadMounts above. Runs once per mount; the duplicate instance
  // (count > 1) pops itself immediately, the original underneath stays.
  // The original instance never pops: its effect ran when count was 1,
  // and its deps do not change when the duplicate mounts.
  const dupPopDoneRef = useRef(false);
  useEffect(() => {
    const count = (liveThreadMounts.get(chatId) ?? 0) + 1;
    liveThreadMounts.set(chatId, count);
    if (count > 1 && !dupPopDoneRef.current) {
      dupPopDoneRef.current = true;
      router.back();
    }
    return () => {
      liveThreadMounts.set(chatId, Math.max(0, (liveThreadMounts.get(chatId) ?? 1) - 1));
    };
  }, [chatId, router]);


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

    // Pass2 DM: 5s REST window instead of subscribeMessages. Same callback
    // shape (msgs + oldestKey), same cache write, same new-message scroll
    // logic. Pagination is NOT available here: the REST window is the last
    // 50 only, so hasMoreOlder stays false and handleLoadOlder / the
    // quote-jump pager are backstopped to no-op in pass2 mode (their
    // Firebase path only runs when the flag is off).
    if (pass2DmActive) {
      const unsubPass2 = subscribePass2DmMessages(chatId, (restMsgs) => {
        if (cancelled) return;
        const mapped = restMsgs
          .map((m) => pass2DmToDmMessage(m, chatId))
          .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        setMessages(mapped);
        setOldestRecentKey(mapped.length > 0 ? mapped[0].id : null);
        saveChatMessages(chatId, mapped);
        setInitialLoading(false);
        setHasMoreOlder(false);
        const latest = mapped[mapped.length - 1];
        if (latest && latest.senderId !== myUid && latest.id !== lastNotifId.current) {
          lastNotifId.current = latest.id;
          if (atBottomRef.current) shouldScrollRef.current = true;
        }
      }, pass2DmFallback);
      return () => {
        cancelled = true;
        unsubPass2();
      };
    }

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
    }, () => {
      // 2026-10-26 (weak network): a failed/denied read must clear the
      // spinner instead of spinning forever; cached messages stay put
      // and the SDK keeps retrying in the background.
      if (!cancelled) setInitialLoading(false);
    });

    return () => {
      cancelled = true;
      unsubMsgs();
    };
  }, [chatId, myUid, pass2DmActive, pass2DmFallback]);


  // ── Subscribe to typing ──────────────────────────────────────────────────
  useEffect(() => {
    // Pass2 DM: typing is DROPPED by design (no tier endpoint) — neither
    // subscribe nor write; the indicator simply does not appear.
    if (pass2DmActive) return;
    if (!transitionDone) return;
    if (!effectiveParticipantId) return;
    const unsub = subscribeTyping(chatId, effectiveParticipantId, setIsTypingRemote);
    return unsub;
  }, [chatId, effectiveParticipantId, transitionDone, pass2DmActive]);

  // ── Subscribe to presence (respects target's privacy settings) ────────────
  // 2026-10-30 (boss: smooth open): gated on transitionDone — its
  // first callback flips extraData and re-renders every row, which
  // must not land inside the slide animation.
  useEffect(() => {
    if (!transitionDone) return;
    if (!effectiveParticipantId) return;
    // Pass2 DM: 30s fetchPass2Online poll instead of subscribePresence.
    // The SDK privacy read is skipped too (it would reopen the socket).
    // Mapped to the same (online, seen) shape; privacy masking is NOT
    // applied in pass2 mode (the tier has no privacy input for it).
    if (pass2DmActive) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const poll = async () => {
        if (stopped) return;
        const res = await fetchPass2Online([effectiveParticipantId]);
        if (stopped) return;
        if (res) {
          const p = res[effectiveParticipantId];
          if (p) {
            setIsOnline(p.online === true);
            setLastSeen(typeof p.lastSeen === 'number' ? p.lastSeen : null);
          }
        }
        if (!stopped) timer = setTimeout(poll, 30000);
      };
      void poll();
      return () => { stopped = true; if (timer !== null) clearTimeout(timer); };
    }
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
  }, [effectiveParticipantId, transitionDone, pass2DmActive]);

  // RC6 fix Issue 5: subscribe to participant's RTDB profile for live photoURL.
  // 2026-10-13 (Sumon): live নামও নিই — header/push/alert-এ stale নাম দেখাতো।
  const [participantLiveName, setParticipantLiveName] = useState<string>('');
  // 2026-10-30 (boss: smooth open): gated on transitionDone — its
  // first callback flips avatar/name props and re-renders every row,
  // which must not land inside the slide animation. The header shows
  // the param name meanwhile.
  useEffect(() => {
    if (!transitionDone) return;
    if (!effectiveParticipantId) return;
    return subscribeUser(effectiveParticipantId, (profile) => {
      if (profile?.photoURL) setParticipantPhotoURL(profile.photoURL);
      // || ব্যবহার (?? নয়) — Google user-এর নাম empty string হতে পারে
      if (profile?.name) setParticipantLiveName(profile.name);
    });
  }, [effectiveParticipantId, transitionDone]);

  // 2026-10-15 (Sumon): NEVER show "Unknown" — live নাম থাকলে সেটাই,
  // নইলে prop-এর নাম ("Unknown" হলে বাদ), সবশেষে "Vee User" fallback.
  const _rawInboxName = participantLiveName || participantName;
  const displayName = _rawInboxName && _rawInboxName.trim().length > 0 && _rawInboxName !== 'Unknown'
    ? _rawInboxName.trim()
    : 'Vee User';

  // 2026-10-17 (Sumon): Vee Team system account — no replies, verified badge.
  const isSystemChat = isVeeTeam(effectiveParticipantId);

  // ── Mark seen on open ──────────────────────────────────────────────────
  // 2026-10-19 (stability): instant + gated — only when the user is
  // actually at the bottom (visible); never while scrolled up reading
  // history (that wrongly cleared the unread badge). Each invocation reads
  // only messages newer than the last marked key.
  // 2026-10-30 (boss: seen must be INSTANT): writes immediately, no
  // throttle, no deferred timer. The at-bottom gate stays (never mark
  // while scrolled up reading history); markAllSeen itself writes only
  // unmarked peer messages, so a trigger with nothing new writes nothing
  // new apart from the unread-count reset.
  const markSeen = useCallback(() => {
    if (!atBottomRef.current) return;
    // Fix #35: the user is viewing this chat right now — dismiss its
    // system-bar notification(s) at once. Best-effort, never fatal.
    void dismissChatNotifications(chatId);
    const afterKey = markedChatRef.current === chatId ? lastMarkedKeyRef.current : null;
    markedChatRef.current = chatId;
    // background: safe to swallow — seen receipts are best-effort
    markAllSeen(chatId, myUid, afterKey)
      .then((newestKey) => {
        if (newestKey) lastMarkedKeyRef.current = newestKey;
      })
      .catch(() => {});
  }, [chatId, myUid]);

  // 2026-10-30 (boss: seen must be INSTANT): trigger on the NEWEST
  // message key, not just length — subscribeMessages caps at 50, so in
  // a thread longer than 50 a new message keeps length at 50 and a
  // length-only effect would never fire (the mark would never be written
  // while sitting at the bottom). messages are ascending, so the last
  // element is the newest.
  const newestMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (messages.length > 0) {
      markSeen();
    }
  }, [chatId, myUid, messages.length, newestMessageId, markSeen]);

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
    if (isAtBottom && !wasAtBottom) markSeen();
  }, [markSeen, setShowScrollBtnGuarded]);

  const scrollToBottom = useCallback(() => {
    flatRef.current?.scrollToOffset({ offset: 0, animated: true });
    setShowScrollBtnGuarded(false);
    userScrolledRef.current = false;
  }, [setShowScrollBtnGuarded]);

  // ── Load older messages (pagination) ─────────────────────────────────────
  // RC8-A: cursor-based "load more" using the oldest key in the current window.
  const handleLoadOlder = useCallback(async () => {
    // Pass2 DM backstop: the REST window cannot serve older-than-50
    // pagination, and the button is hidden in pass2 mode (hasMoreOlder
    // false) — never let a stale call hit the SDK mid-mode.
    if (pass2DmActiveRef.current) return;
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

  // ── DM text outbox: retry + mount-restore + ack cleanup ──
  const retryDmText = useCallback(async (msg: DmMessage) => {
    if (msg.type !== 'text' || msg.sendState !== 'failed' || msg.senderId !== myUid) return;
    setPendingMsgs((prev) => prev.map((m) => (m.id === msg.id ? { ...m, sendState: 'sending' as const } : m)));
    try {
      // Pass2 DM: plain-text retry via REST (reply retries stay on the SDK
      // — the tier send takes text only, no replyTo; the queued SDK write
      // applies on mode exit). Same success/failure handling either way.
      if (pass2DmActiveRef.current && !msg.replyTo) {
        await sendPass2DmMessage(chatId, msg.content);
      } else {
        await sendMessage(chatId, myUid, effectiveParticipantId, msg.content, 'text', msg.replyTo, undefined, myRealName || user?.displayName || undefined, msg.id);
      }
      setPendingMsgs((prev) => prev.filter((m) => m.id !== msg.id));
      void clearDmOutboxEntry(chatId, msg.id);
    } catch (e) {
      if (e instanceof BlockedInteractionError) {
        setPendingMsgs((prev) => prev.filter((m) => m.id !== msg.id));
        void clearDmOutboxEntry(chatId, msg.id);
        const d = await getBlockDirection(myUid, effectiveParticipantId).catch(() => 'none' as BlockDirection);
        setBlockDirection(d);
        Alert.alert(
          t('chat.blockedTitle') ?? 'Blocked',
          d === 'byMe'
            ? (t('chat.blockedByMeMsg', { name: displayName }) ?? `You blocked ${displayName}. Unblock to send messages.`)
            : (t('chat.blockedByThemMsg', { name: displayName }) ?? `${displayName} has blocked you.`),
        );
      } else {
        setPendingMsgs((prev) => prev.map((m) => (m.id === msg.id ? { ...m, sendState: 'failed' as const } : m)));
      }
    }
  }, [chatId, myUid, effectiveParticipantId, myRealName, user, displayName, t, clearDmOutboxEntry]);

  // Mount-restore: re-send persisted text pendings for this chat verbatim.
  // Runs once per chat open; the ack-cleanup effect below drops any echo
  // whose real message has already landed.
  useEffect(() => {
    if (dmOutboxRestoredRef.current === chatId) return;
    dmOutboxRestoredRef.current = chatId;
    void loadDmOutbox().then(async (all) => {
      const entries = all[chatId] ?? [];
      if (entries.length === 0) return;
      const echoes: DmMessage[] = entries.map((e) => ({
        id: e.id, chatId, senderId: myUid, type: 'text', content: e.text,
        createdAt: e.createdAt, status: 'sending', sendState: 'sending',
        reactions: {}, ...(e.replyTo ? { replyTo: e.replyTo } : {}),
      }));
      setPendingMsgs((prev) => {
        const have = new Set(prev.map((m) => m.id));
        return [...prev, ...echoes.filter((m) => !have.has(m.id))];
      });
      for (const e of entries) {
        try {
          if (pass2DmActiveRef.current && !e.replyTo) {
            await sendPass2DmMessage(chatId, e.text);
          } else {
            await sendMessage(chatId, myUid, effectiveParticipantId, e.text, 'text', e.replyTo, undefined, myRealName || user?.displayName || undefined, e.id);
          }
          setPendingMsgs((prev) => prev.filter((m) => m.id !== e.id));
          void clearDmOutboxEntry(chatId, e.id);
        } catch (err) {
          if (err instanceof BlockedInteractionError) {
            setPendingMsgs((prev) => prev.filter((m) => m.id !== e.id));
            void clearDmOutboxEntry(chatId, e.id);
          } else {
            setPendingMsgs((prev) => prev.map((m) => (m.id === e.id ? { ...m, sendState: 'failed' as const } : m)));
          }
        }
      }
    });
  }, [chatId, myUid, effectiveParticipantId, myRealName, user, loadDmOutbox, clearDmOutboxEntry]);

  // Ack cleanup: a 'sending' optimistic whose real message arrived (same id
  // in the live window) is dropped. Failed bubbles are never auto-cleaned —
  // only a retry or a block clears them.
  useEffect(() => {
    if (messages.length === 0) return;
    const liveIds = new Set(messages.map((m) => m.id));
    setPendingMsgs((prev) => {
      const kept = prev.filter((m) => !(m.sendState === 'sending' && liveIds.has(m.id)));
      return kept.length === prev.length ? prev : kept;
    });
    void loadDmOutbox().then((all) => {
      const list = all[chatId] ?? [];
      const stale = list.filter((e) => liveIds.has(e.id));
      stale.forEach((e) => void clearDmOutboxEntry(chatId, e.id));
    });
  }, [messages, chatId, loadDmOutbox, clearDmOutboxEntry]);

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
    // the real message arrives. 2026-10-26 (weak-network Phase 2, DM outbox):
    // on failure the bubble STAYS with sendState 'failed' + tap-to-retry
    // (same pattern as the room outbox) — the text lives in the bubble,
    // long-press Copy recovers it for editing, so nothing typed is lost.
    const messageKey = newMessageKey(chatId);
    const optimistic: DmMessage = {
      id: messageKey,
      chatId,
      senderId: myUid,
      type: 'text',
      content: text,
      createdAt: now,
      status: 'sending',
      sendState: 'sending',
      reactions: {},
      ...(replyPreview ? { replyTo: replyPreview } : {}),
    };
    setPendingMsgs((prev) => [...prev, optimistic]);
    void saveDmOutboxEntry(chatId, { id: messageKey, text, replyTo: replyPreview, createdAt: now });
    setInputText('');
    setReplyTarget(null);
    shouldScrollRef.current = true;
    if (!pass2DmActiveRef.current) setTyping(chatId, myUid, false);

    try {
      // Pass2 DM: plain text with no replyTo goes via REST. The tier
      // assigns the server id, so the optimistic bubble (client key) is
      // dropped on success and the 5s poll delivers the real message.
      // Media / voice / reply sends stay on the SDK: while offline they
      // QUEUE and apply on mode exit — they do not fail, they land late.
      // REST sends also skip the SDK sendMessage block check (the tier
      // is the enforcement point for pass2 sends).
      if (pass2DmActiveRef.current && !replyPreview) {
        await sendPass2DmMessage(chatId, text);
      } else {
        await sendMessage(chatId, myUid, effectiveParticipantId, text, 'text', replyPreview, undefined, myRealName || user?.displayName || undefined, messageKey);
      }
      // Success — the live subscription delivers the real message under the
      // same id; drop the optimistic copy (the id-dedupe is the backstop).
      setPendingMsgs((prev) => prev.filter((m) => m.id !== messageKey));
      void clearDmOutboxEntry(chatId, messageKey);
    } catch (e) {
      // DM outbox: blocked stays final (drop + alert below); any other
      // failure keeps the bubble with sendState 'failed' for tap-to-retry.
      // The text lives in the bubble (long-press Copy recovers it) — the
      // input is NOT restored, so a retry never duplicates the text.
      if (e instanceof BlockedInteractionError) {
        setPendingMsgs((prev) => prev.filter((m) => m.id !== messageKey));
        void clearDmOutboxEntry(chatId, messageKey);
      } else {
        setPendingMsgs((prev) => prev.map((m) => (m.id === messageKey ? { ...m, sendState: 'failed' as const } : m)));
      }
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
        // DM outbox: no alert — the kept 'failed' bubble IS the signal
        // ("Not sent — tap to retry"). Alerting on every weak-network
        // failure would double-notify; the cause surfaces on retry.
      }
    }
  }, [inputText, chatId, myUid, effectiveParticipantId, replyTarget, displayName, t, user, saveDmOutboxEntry, clearDmOutboxEntry]);

  // Fix #31 (imo-exact quick reactions): tapping an emoji sends it as a
  // message instantly, reusing the exact optimistic + sendMessage path of
  // handleSend (no change to sending logic itself; sent as a text message
  // so failed-send retry and the outbox work exactly as for typed text).
  const handleQuickReaction = useCallback(async (emoji: string) => {
    if (!user?.uid) return;
    if (isVeeTeam(effectiveParticipantId)) return;
    if (blockDirection !== 'none') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const messageKey = newMessageKey(chatId);
    const optimistic: DmMessage = {
      id: messageKey,
      chatId,
      senderId: myUid,
      type: 'text',
      content: emoji,
      createdAt: Date.now(),
      status: 'sending',
      sendState: 'sending',
      reactions: {},
    };
    setPendingMsgs((prev) => [...prev, optimistic]);
    void saveDmOutboxEntry(chatId, { id: messageKey, text: emoji, createdAt: Date.now() });
    if (!pass2DmActiveRef.current) setTyping(chatId, myUid, false);
    shouldScrollRef.current = true;
    try {
      if (pass2DmActiveRef.current) {
        await sendPass2DmMessage(chatId, emoji);
      } else {
        await sendMessage(chatId, myUid, effectiveParticipantId, emoji, 'text', undefined, undefined, myRealName || user?.displayName || undefined, messageKey);
      }
      setPendingMsgs((prev) => prev.filter((m) => m.id !== messageKey));
      void clearDmOutboxEntry(chatId, messageKey);
    } catch (e) {
      if (e instanceof BlockedInteractionError) {
        setPendingMsgs((prev) => prev.filter((m) => m.id !== messageKey));
        void clearDmOutboxEntry(chatId, messageKey);
        const d = await getBlockDirection(myUid, effectiveParticipantId).catch(() => 'none' as BlockDirection);
        setBlockDirection(d);
      } else {
        setPendingMsgs((prev) => prev.map((m) => (m.id === messageKey ? { ...m, sendState: 'failed' as const } : m)));
      }
    }
  }, [user, effectiveParticipantId, blockDirection, chatId, myUid, myRealName, saveDmOutboxEntry, clearDmOutboxEntry]);

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
    // Fix #17 (slow voice send): optimistic bubble FIRST, with the LOCAL
    // uri and the final push key — the sender sees the note instantly
    // (and can even play it) instead of staring at a loader for the whole
    // upload. The live subscription's real message shares this id, so it
    // dedupes the optimistic copy on arrival; the explicit filter below
    // is cleanup for the same reason.
    const messageKey = newMessageKey(chatId);
    const optimistic: DmMessage = {
      id: messageKey,
      chatId,
      senderId: myUid,
      type: 'voice',
      content: rec.uri,
      durationSec: rec.durationSec,
      createdAt: Date.now(),
      status: 'sending',
      reactions: {},
    };
    setPendingMsgs((prev) => [...prev, optimistic]);
    shouldScrollRef.current = true;
    try {
      // Telegram-backed storage, type='chat' (folder 'vee/dm' maps to chat).
      const uploaded = await uploadImage(rec.uri, {
        folder: 'vee/dm',
        mimeHint: 'audio/mp4',
        // 2026-10-26 (weak network): a stalled upload must fail, not hang
        // forever with no error and no retry.
        timeoutMs: 30000,
      });
      await sendMessage(
        chatId, myUid, effectiveParticipantId, uploaded.url, 'voice',
        undefined, uploaded.publicId,
        myRealName || user?.displayName || undefined,
        messageKey, rec.durationSec,
      );
      setPendingMsgs((prev) => prev.filter((m) => m.id !== messageKey));
    } catch (e) {
      // Upload/send failed — drop the optimistic bubble and surface the
      // ACTUAL cause, nothing half-sent.
      setPendingMsgs((prev) => prev.filter((m) => m.id !== messageKey));
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
    // Pass2 DM: typing writes dropped by design (no tier endpoint).
    if (pass2DmActiveRef.current) return;
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
            // 2026-10-26 (weak network): stalled media upload must time out.
            timeoutMs: 60000,
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

  // ── Pinned message + forward picker (2026-10-30, boss: Telegram
  // long-press menu) ──────────────────────────────────────────────────
  // Pin state lives per-user at userChats/{myUid}/{chatId}/pinnedMessageId
  // (see firebaseDmService.setPinnedMessage for why the chats/{chatId}
  // node cannot hold it); this screen reads only its own entry. The
  // setter dual-writes the peer's entry too, so both sides see the bar.
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);
  useEffect(() => {
    if (!myUid || myUid === 'unknown') return;
    return subscribePinnedMessage(chatId, myUid, (id) => setPinnedMessageId(id));
  }, [chatId, myUid]);
  // Pass2 DM: pinning STAYS on the SDK — shape mismatch. The screen's pin
  // is per-user userChats/{uid}/{chatId}/pinnedMessageId (string|null),
  // while the tier pin writes a shared chats/{id}/pinned/{messageId} map;
  // routing it would change what the other side sees. Reported as a gap.
  const handleTogglePin = useCallback((msg: DmMessage) => {
    const next = pinnedMessageId === msg.id ? null : msg.id;
    void setPinnedMessage(chatId, myUid, effectiveParticipantId, next).catch(() => {
      Alert.alert(t('chat.error'));
    });
  }, [chatId, myUid, effectiveParticipantId, pinnedMessageId, t]);

  // Forward picker: MessageBubble's Forward row opens it via
  // handleForwardOpen; the picker subscribes the DM chat list only
  // while open, sends a COPY (same content/type/media ids, no replyTo),
  // then confirms briefly. Blocked targets surface sendMessage's error
  // as the forward error alert.
  const [forwardTarget, setForwardTarget] = useState<DmMessage | null>(null);
  const [forwardChats, setForwardChats] = useState<Chat[]>([]);
  const [forwardSending, setForwardSending] = useState(false);
  const handleForwardOpen = useCallback((msg: DmMessage) => {
    setForwardTarget(msg);
  }, []);
  useEffect(() => {
    if (!forwardTarget) return;
    // NOTE: this file is the thread screen — this forward-picker list is
    // its ONLY inbox-list subscription (there is no main inbox list here).
    // Pass2 DM: REST inbox poll instead of subscribeUserChats; the
    // session-local unread overlay zeroes badges for chats opened this
    // session (markAllSeen has no REST equivalent; the server badge
    // catches up when the queued SDK mark applies on mode exit).
    if (pass2DmActive) {
      return subscribePass2Inbox((rows) => {
        const mapped = rows
          .map((c) => pass2InboxToChat(c, myUid))
          .filter((c) => !c.isHidden)
          .map((c) => (pass2DmOpenedChats.has(c.id) ? { ...c, unreadCount: 0 } : c));
        setForwardChats(mapped);
      }, pass2DmFallback);
    }
    return subscribeUserChats(myUid, (chats) => {
      setForwardChats(chats.filter((c) => !c.isHidden));
    });
  }, [forwardTarget, myUid, pass2DmActive, pass2DmFallback]);
  const handleForwardSend = useCallback(async (targetChat: Chat) => {
    const src = forwardTarget;
    if (!src || forwardSending) return;
    setForwardSending(true);
    try {
      await sendMessage(targetChat.id, myUid, targetChat.participantId, src.content, src.type, undefined, src.cloudinaryId, myRealName || user?.displayName || undefined, undefined, src.durationSec);
      setForwardTarget(null);
      Alert.alert(t('chat.forwarded'));
    } catch {
      Alert.alert(t('chat.error'), t('chat.forwardError'));
    } finally {
      setForwardSending(false);
    }
  }, [forwardTarget, forwardSending, myUid, myRealName, user?.displayName, t]);

  // ── Reply ──────────────────────────────────────────────────────────────────
  const handleReply = useCallback((msg: DmMessage) => {
    setReplyTarget(msg);
    inputRef.current?.focus();
  }, []);

  // 2026-10-30 (boss: reply-quote tap jumps to the original): find the
  // quoted message in the currently rendered rows (chatRows is the
  // reversed, separator-interleaved array the inverted FlatList
  // renders, so its index IS the scrollToIndex index). Found -> scroll
  // to the middle + flash the target ~1.5s.
  // 2026-10-30 (boss: quote-jump MUST load the window — phone failure):
  // DIAGNOSED CAUSE: the live subscription caps at 50 (DM_PAGE_SIZE),
  // so a quoted message older than the window was idx===-1 -> a WRONG
  // Alert even though the record exists in RTDB. (Id mismatch ruled
  // out: replyTo.messageId is the original id; separators are skipped
  // by the kind==='msg' check.) Now: not found -> page backward (same
  // cursor + dedupe rules as handleLoadOlder) until the target appears
  // or history is exhausted; only then is the Alert shown, and only
  // for genuinely-missing messages. Found-but-deleted also Alerts
  // (there is nothing to show). scrollToIndex can fail while the
  // target row is not laid out yet (windowing) -> onScrollToIndexFailed
  // retries once, then Alerts. (chatRows is declared below; these
  // closures only run on tap, long after it is initialized.)
  const scrollAndFlash = useCallback((messageId: string) => {
    const idx = chatRows.findIndex((r) => r.kind === 'msg' && r.message.id === messageId);
    if (idx === -1) return false;
    jumpRetryRef.current = false;
    flatRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    setHighlightedId(messageId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedId(null), 1500);
    return true;
  }, [chatRows]);
  // After a jump-load merge re-renders the rows, complete the pending jump.
  useEffect(() => {
    const target = pendingJumpRef.current;
    if (!target) return;
    const row = chatRows.find((r) => r.kind === 'msg' && r.message.id === target);
    if (row && row.kind === 'msg') {
      pendingJumpRef.current = null;
      if (row.message.deletedForEveryone || row.message.deletedForMe) {
        Alert.alert('Original message not available');
        return;
      }
      scrollAndFlash(target);
      return;
    }
    // Merge landed but the target is still absent — it was not in the
    // loaded pages after all (the loop already Alerted in that case, so
    // this only fires if state raced); clear to never scroll later.
    if (!jumpLoadingRef.current) pendingJumpRef.current = null;
  }, [chatRows, scrollAndFlash]);
  const jumpToMessage = useCallback(async (messageId: string) => {
    jumpRetryRef.current = false;
    const found = chatRows.find((r) => r.kind === 'msg' && r.message.id === messageId);
    if (found && found.kind === 'msg') {
      if (found.message.deletedForEveryone || found.message.deletedForMe) {
        Alert.alert('Original message not available');
        return;
      }
      scrollAndFlash(messageId);
      return;
    }
    // Not in the loaded window: page backward until found or exhausted.
    // Same cursor + dedupe rules as handleLoadOlder; loadingOlder also
    // blocks a concurrent manual load (its button disables on the flag).
    // markSeen is untouched: it is at-bottom gated and keyed on the
    // NEWEST message, so older pages never trigger a mark.
    if (jumpLoadingRef.current || loadingOlder) return;
    // Pass2 DM: no older-than-50 pagination over REST — a quoted message
    // outside the window cannot be paged to without the SDK, so report it
    // missing rather than reopening the socket mid-mode.
    if (pass2DmActiveRef.current) { Alert.alert('Original message not available'); return; }
    jumpLoadingRef.current = true;
    setLoadingOlder(true);
    try {
      const seen = new Set([...olderMessages.map((m) => m.id), ...messages.map((m) => m.id)]);
      let cursor = olderMessages.length > 0
        ? olderMessages[0].id
        : (oldestRecentKey ?? messages[0]?.id ?? null);
      let acc: DmMessage[] = [];
      let lastHasMore = true;
      let exhausted = false;
      for (let i = 0; i < 100 && cursor && lastHasMore; i++) {
        const { messages: fetched, hasMore } = await loadOlderMessages(chatId, myUid, cursor);
        lastHasMore = hasMore;
        if (fetched.length === 0) { exhausted = true; break; }
        const newOnes = fetched.filter((m) => !seen.has(m.id));
        newOnes.forEach((m) => seen.add(m.id));
        if (newOnes.length === 0) break; // no progress — never spin forever
        acc = [...newOnes, ...acc];
        cursor = fetched[0].id;
        const hit = acc.find((m) => m.id === messageId);
        if (hit) {
          if (hit.deletedForEveryone || hit.deletedForMe) {
            Alert.alert('Original message not available');
            return;
          }
          break;
        }
      }
      if (acc.length > 0) {
        // acc is oldest-first and entirely older than the existing prefix,
        // so prepending preserves chronological order (same merge as
        // handleLoadOlder, just batched). The pending-jump effect above
        // scrolls + flashes once the rows re-render.
        setOlderMessages((prev) => [...acc, ...prev]);
        setHasMoreOlder(lastHasMore);
        const hit = acc.find((m) => m.id === messageId);
        if (hit) pendingJumpRef.current = messageId;
        else if (exhausted || !lastHasMore) Alert.alert('Original message not available');
        // else: loop ended on no-progress/bound with history possibly
        // remaining — do NOT Alert for a maybe-existing message; the
        // merge already advanced the cursor, so a retry re-pages onward.
      } else if (exhausted || !lastHasMore) {
        setHasMoreOlder(false);
        Alert.alert('Original message not available');
      } else {
        Alert.alert('Original message not available');
      }
    } catch {
      Alert.alert('Original message not available');
    } finally {
      setLoadingOlder(false);
      jumpLoadingRef.current = false;
    }
  }, [chatRows, olderMessages, messages, oldestRecentKey, chatId, myUid, loadingOlder, scrollAndFlash]);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    pendingJumpRef.current = null;
  }, []);

  const handleScrollToIndexFailed = useCallback((info: { index: number }) => {
    if (jumpRetryRef.current) {
      jumpRetryRef.current = false;
      Alert.alert('Original message not available');
      return;
    }
    jumpRetryRef.current = true;
    setTimeout(() => {
      flatRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
    }, 500);
  }, []);

  // ── Reaction ──────────────────────────────────────────────────────────────
  const handleReaction = useCallback((messageId: string, emoji: string) => {
    // Pass2 DM: tier react op (same toggle surface as addReaction).
    if (pass2DmActiveRef.current) {
      sendPass2DmOp(chatId, 'react', { messageId, emoji }).catch(() => {
        Alert.alert(t('chat.error'), t('chat.reactionError'));
      });
      return;
    }
    addReaction(chatId, messageId, myUid, emoji).catch(() => {
      Alert.alert(t('chat.error'), t('chat.reactionError'));
    });
  }, [chatId, myUid, t]);

  // ── Delete ────────────────────────────────────────────────────────────────
  // Pass2 DM: message deletes STAY on the SDK — the tier delete is
  // CHAT-level (removes the caller's userChat entry), not single-message.
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
  // Fix #31 (zero lag): stable media-press callback — the old inline
  // closure was a NEW function on every parent render, which defeated
  // MessageBubble's memo and re-rendered every row on every keystroke.
  const handleMediaPress = useCallback((uri: string, type: 'image' | 'video') => {
    setMediaViewerUri(uri);
    setMediaViewerType(type);
  }, []);
  // Fix #31: call-back indirection — handleVoiceCall is defined below the
  // render section, so rows call through this stable ref callback instead
  // of capturing the function before its declaration (TDZ).
  const callBackRef = useRef<(() => void) | undefined>(undefined);
  const stableCallBack = useCallback(() => { callBackRef.current?.(); }, []);
  const renderItem = useCallback(({ item }: { item: ChatRow }) => {
    if (item.kind === 'sep') {
      return (
        <View style={{ alignItems: 'center', marginVertical: 10 }}>
          <View style={{
            backgroundColor: '#C6C6CC',
            borderRadius: 14, paddingHorizontal: 14, paddingVertical: 5,
          }}>
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>
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
        onRetry={retryDmText}
        onMediaPress={handleMediaPress}
        peerPhotoURL={participantPhotoURL}
        myPhotoURL={user?.photoURL ?? null}
        isPeerOnline={isOnline}
        onCallBack={stableCallBack}
        onQuotePress={jumpToMessage}
        isHighlighted={highlightedId === msg.id}
        onForward={handleForwardOpen}
        onTogglePin={handleTogglePin}
        isPinned={pinnedMessageId === msg.id}
      />
    );
  }, [chatId, myUid, handleReply, retryDmText, handleMediaPress, participantPhotoURL, user?.photoURL, isOnline, stableCallBack, jumpToMessage, highlightedId, handleForwardOpen, handleTogglePin, pinnedMessageId]);

  const keyExtractor = useCallback((item: ChatRow) => (
    item.kind === 'sep' ? `sep-${item.dayKey}` : item.message.id
  ), []);

  // Fix #38 (2026-10-29): header name tap opens the PEER's profile via the
  // existing /user-profile route (same as ContactsScreen handleViewProfile).
  // effectiveParticipantId is always the peer (myUid excluded at derivation),
  // so this can never open the boss's own profile. Vee Team needs no
  // carve-out: 'vee_team' is a real users/ record with an official badge.
  const handleTitlePress = useCallback(() => {
    if (!effectiveParticipantId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(
      `/user-profile?uid=${encodeURIComponent(effectiveParticipantId)}&name=${encodeURIComponent(displayName)}` as never,
    );
  }, [effectiveParticipantId, displayName, router]);

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

  // Fix #31: call-back ref assignment (see stableCallBack above renderItem).
  useEffect(() => { callBackRef.current = handleVoiceCall; }, [handleVoiceCall]);

  // Fix #31/#32 (imo-exact header subtitle): typing → "typing…",
  // online → "Online", else the live last-seen text (or nothing when
  // presence is hidden by privacy). Derived from live subscription state,
  // so it updates the moment presence changes.
  const headerSubtitle = isTypingRemote
    ? 'typing…'
    : isOnline
      ? 'Online'
      : lastSeen
        ? formatLastSeen(lastSeen)
        : '';
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

  // Fix #31 (imo-exact date pills): always "Oct 5" style (month first),
  // with the year only for other years — exactly as imo shows it.
  function dayLabel(ts: number): string {
    if (!Number.isFinite(ts)) return '';
    const d = new Date(ts);
    const now = new Date();
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
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
            backgroundColor: '#FFFFFF',
            borderRadius: 20, paddingHorizontal: 28, paddingVertical: 12,
            shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 }, elevation: 3 }}>
            <Text style={{ color: '#000000', fontSize: 16 }}>
              Tap to load history
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

  // Pinned-bar preview: the pinned message's own preview when it is in
  // the loaded rows, else a generic label (tap still attempts the jump,
  // which Alerts when the message is genuinely unavailable).
  const pinnedPreview = (() => {
    if (!pinnedMessageId) return '';
    const row = chatRows.find((r) => r.kind === 'msg' && r.message.id === pinnedMessageId);
    if (!row || row.kind !== 'msg') return t('chat.pinnedMessage');
    const m = row.message;
    if (m.deletedForEveryone || m.deletedForMe) return t('chat.pinnedMessage');
    return m.type === 'text' ? m.content.slice(0, 60)
      : m.type === 'image' ? '📷 Photo'
      : m.type === 'video' ? '🎥 Video'
      : m.type === 'voice' ? '🎤 Voice message'
      : m.type === 'call' ? '📞 Call'
      : m.type === 'sticker' ? '😊 Sticker'
      : '📎 Attachment';
  })();

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
              <Feather name="arrow-left" size={24} color="#000000" />
            </Pressable>

            {/* Fix #31 (imo-exact header): no avatar — back + name +
                grey last-seen subtitle, exactly as imo shows it. */}
            {/* Name + last seen — Fix #38: tappable, opens peer profile */}
            <Pressable onPress={handleTitlePress}
              style={({ pressed }) => [{ flex: 1, opacity: pressed ? 0.7 : 1 }]}>
              {/* 2026-10-17 (Sumon): Vee Team — official verified badge via standard component */}
              {isSystemChat ? (
                <VerifiedName
                  name={displayName}
                  uid={effectiveParticipantId}
                  nameStyle={{ color: '#000000', fontWeight: '800', fontSize: 18 }}
                />
              ) : (
                <Text style={{ color: '#000000', fontWeight: '800', fontSize: 18 }} numberOfLines={1}>
                  {displayName}
                </Text>
              )}
              {headerSubtitle ? (
                <Text style={{ color: '#8E8E93', fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                  {headerSubtitle}
                </Text>
              ) : null}
            </Pressable>

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
                <Ionicons name="call" size={24} color="#009DFF" />
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
                <Feather name="more-vertical" size={22} color="#000000" />
              </Pressable>
            </View>
          </View>

          {/* ── Pinned message bar (2026-10-30) ── */}
          {pinnedMessageId ? (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: C.border,
              paddingHorizontal: 14, paddingVertical: 10,
            }}>
              <Pressable
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}
                onPress={() => jumpToMessage(pinnedMessageId)}
              >
                <Ionicons name="pin" size={18} color={C.glow} />
                <Text style={{ color: '#000000', fontSize: 14, flex: 1 }} numberOfLines={1}>
                  {pinnedPreview}
                </Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={() => { void setPinnedMessage(chatId, myUid, effectiveParticipantId, null).catch(() => {}); }}>
                <Feather name="x" size={18} color={C.muted} />
              </Pressable>
            </View>
          ) : null}

          {/* ── Forward picker (2026-10-30) ── */}
          <Modal visible={forwardTarget !== null} animationType="slide" onRequestClose={() => setForwardTarget(null)}>
            <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }} edges={['top', 'bottom']}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Pressable hitSlop={8} onPress={() => setForwardTarget(null)} style={{ padding: 6 }}>
                  <Feather name="x" size={24} color="#000000" />
                </Pressable>
                <Text style={{ color: '#000000', fontSize: 18, fontWeight: '800' }}>{t('chat.forwardTo')}</Text>
              </View>
              {forwardChats.length === 0 ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: C.muted, fontSize: 14 }}>{t('chat.noChats')}</Text>
                </View>
              ) : (
                <FlatList
                  data={forwardChats}
                  keyExtractor={(c) => c.id}
                  renderItem={({ item }) => (
                    <Pressable
                      disabled={forwardSending}
                      onPress={() => { void handleForwardSend(item); }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
                    >
                      {item.participantAvatar ? (
                        <Image source={{ uri: item.participantAvatar }} style={{ width: 44, height: 44, borderRadius: 22 }} />
                      ) : (
                        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#D9D9DE', alignItems: 'center', justifyContent: 'center' }}>
                          <Feather name="user" size={20} color="#fff" />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#000000', fontSize: 16, fontWeight: '600' }} numberOfLines={1}>{item.participantName}</Text>
                        <Text style={{ color: C.muted, fontSize: 13 }} numberOfLines={1}>{item.lastMessage}</Text>
                      </View>
                    </Pressable>
                  )}
                />
              )}
            </SafeAreaView>
          </Modal>

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
              // 2026-10-30 (boss: ticks real-time): rows depend on isOnline
              // via MessageBubble's isPeerOnline — re-render on presence change.
              // 2026-10-30 (boss: quote-jump highlight): rows also depend
              // on highlightedId — encoded as a string so it stays
              // referentially stable when neither value changes (a fresh
              // object literal here would re-render every row on every
              // parent render).
              extraData={isOnline ? `on-${highlightedId ?? ''}` : `off-${highlightedId ?? ''}`}
              onScrollToIndexFailed={handleScrollToIndexFailed}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              contentContainerStyle={{ paddingVertical: 12 }}
              removeClippedSubviews
              // 2026-10-30 (boss: smooth open): 10 initial rows instead
              // of 20 — the viewport shows ~10 bubbles, so the slide
              // window lays out half the work; windowing renders the
              // rest right after. Batching/window/clipping untouched.
              initialNumToRender={10}
              maxToRenderPerBatch={20}
              windowSize={15}
              showsVerticalScrollIndicator={false}
              // Fix #31 (imo-like smooth keyboard + zero lag): taps on
              // messages work without dismissing the keyboard first, and
              // dragging the list dismisses it smoothly.
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              // 2026-10-13 (Sumon): inbox খুললে সর্বশেষ message-এ scroll —
              // image load-এ height বদলালেও নিচেই থাকবে।
              onScrollBeginDrag={handleScrollBeginDrag}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              // RC8-A: footer shows "Load earlier messages" when older pages exist
              // (inverted list: the footer renders at the visual top)
              ListFooterComponent={ListHeaderComponent}
              ListEmptyComponent={
                // Fix #16 (no blank blocking spinner): during initial
                // load show only a small inline indicator — header +
                // composer stay visible, and cached messages (when present)
                // render instead of this empty state. Never a full-screen
                // spinner, matching the app-wide no-loading rule.
                initialLoading ? (
                  <View style={{ alignItems: 'center', paddingTop: 24 }}>
                    <PremiumLoader size="small" />
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
                  // Fix #31 (imo-exact): white circle above the composer
                  // (higher when the quick-reaction row is visible).
                  bottom: showQuickReactions && !isSystemChat && !voice.isRecording ? 150 : 90,
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: '#FFFFFF',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#000', shadowOpacity: 0.2,
                  shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
                  elevation: 6,
                  zIndex: 100 }}
              >
                <Feather name="chevron-down" size={22} color="#000000" />
              </Pressable>
            )}

            {/* Fix #31 (imo-exact quick reactions): emoji row above the
                composer — tap sends the emoji instantly. The smiley in
                the composer toggles this row. */}
            {!isSystemChat && !voice.isRecording && showQuickReactions && (
              <View style={{
                flexDirection: 'row', justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: 12, paddingVertical: 8,
                backgroundColor: C.bg,
                opacity: blockDirection !== 'none' ? 0.4 : 1 }}>
                {QUICK_REACTIONS.map((emoji) => (
                  <Pressable
                    key={emoji}
                    hitSlop={6}
                    disabled={blockDirection !== 'none'}
                    onPress={() => { void handleQuickReaction(emoji); }}
                    style={{
                      width: 48, height: 48, borderRadius: 24,
                      backgroundColor: '#FFFFFF',
                      alignItems: 'center', justifyContent: 'center',
                      shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4,
                      shadowOffset: { width: 0, height: 2 }, elevation: 2,
                    }}
                  >
                    <Text style={{ fontSize: 26 }}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
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
                  width: 48, height: 48, borderRadius: 24,
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
              backgroundColor: '#FFFFFF', gap: 10,
              opacity: blockDirection !== 'none' ? 0.4 : 1 }}>
              {/* Fix #31 (imo-exact composer): white pill — smiley (toggles
                  the quick-reaction row) + input + image + plus. */}
              <View style={{
                flex: 1, flexDirection: 'row', alignItems: 'center',
                backgroundColor: '#FFFFFF', borderRadius: 28,
                borderWidth: 1, borderColor: '#E5E5EA',
                paddingHorizontal: 6, minHeight: 48 }}>
                <Pressable onPress={() => setShowQuickReactions((v) => !v)} hitSlop={8} style={{ padding: 6 }}>
                  <Ionicons name="happy-outline" size={26} color="#000000" />
                </Pressable>
                <TextInput
                  ref={inputRef}
                  editable={blockDirection === 'none'}
                  style={{
                    flex: 1, minHeight: 48, maxHeight: 110,
                    paddingHorizontal: 6, paddingVertical: 10,
                    color: '#000000', fontSize: 16 }}
                  // imo-exact placeholder (boss's hubhu order): "Message".
                  placeholder={blockDirection !== 'none' ? '' : 'Message'}
                placeholderTextColor={C.muted}
                multiline
                value={inputText}
                onChangeText={handleInputChange}
                onSubmitEditing={handleSend}
                blurOnSubmit={false}
                  returnKeyType="send"
                />
                <Pressable onPress={handleMedia} hitSlop={8} disabled={uploadingMedia} style={{ padding: 6 }}>
                  <Feather name={uploadingMedia ? 'loader' : 'image'} size={24} color="#000000" />
                </Pressable>
                <Pressable onPress={handleMedia} hitSlop={8} disabled={uploadingMedia} style={{ padding: 6 }}>
                  <View style={{
                    width: 26, height: 26, borderRadius: 13,
                    borderWidth: 1.5, borderColor: '#000000',
                    alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="plus" size={18} color="#000000" />
                  </View>
                </Pressable>
              </View>

              {/* IMO send/mic circle: 52dp #009dff — mic when the input is
                  empty, send arrow when there is text. */}
              {inputText.trim() ? (
                <Pressable onPress={handleSend} disabled={blockDirection !== 'none' || !user?.uid} hitSlop={8}>
                  <View style={{
                    width: 52, height: 52, borderRadius: 26,
                    backgroundColor: '#009dff',
                    alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="send" size={22} color="#fff" />
                  </View>
                </Pressable>
              ) : (
                <Pressable onPress={handleMicPress} disabled={blockDirection !== 'none' || !user?.uid || uploadingVoice} hitSlop={8}>
                  <View style={{
                    width: 52, height: 52, borderRadius: 26,
                    backgroundColor: '#009dff',
                    alignItems: 'center', justifyContent: 'center',
                    opacity: uploadingVoice ? 0.6 : 1 }}>
                    <Feather name={uploadingVoice ? 'loader' : 'mic'} size={22} color="#fff" />
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
                if (!mediaViewerUri || photoDownloading) return;
                setPhotoDownloading(true);
                try {
                  await saveRemoteMediaToGallery(mediaViewerUri, {
                    permissionRequired: t('chat.permissionRequired'),
                    galleryPermission: 'Gallery access is needed to save media.',
                    saved: t('chat.saved'),
                    msgSaveToGallery: t('chat.msgSaveToGallery') + ' successfully.',
                    error: t('chat.error'),
                    saveToGalleryFailed: t('chat.saveToGalleryFailed') });
                } finally {
                  setPhotoDownloading(false);
                }
              }}
            >
              {photoDownloading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="download" size={24} color="#fff" />
              )}
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
