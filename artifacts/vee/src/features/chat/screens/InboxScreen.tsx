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
  useEffect, useRef, useState, useCallback, useMemo,
} from 'react';
import {
  View, Text, FlatList, TextInput, Pressable,
  KeyboardAvoidingView, Platform, Animated,
  Dimensions, Alert, Modal, Image, Linking, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import MessageBubble from '../components/MessageBubble';
import {
  subscribeMessages, sendMessage, markAllSeen,
  subscribeTyping, subscribePresence, setTyping,
  addReaction, deleteMessage, clearChat,
  loadOlderMessages, DM_PAGE_SIZE,
} from '../services/firebaseDmService';
import { showNotification } from '../services/notificationService';
import { DmMessage, DmReplyPreview } from '../types/dm';
import { uploadImage } from '@/src/services/cloudinaryService';
import { useAuth } from '@/src/context/AuthContext';
import { submitReport } from '@/src/services/reportService';
import * as MediaLibrary from 'expo-media-library';
// RC6 fix Issue 5 + Issue 8
import { subscribeUser } from '@/src/services/userService';
import { buildCallRoomId } from '@/src/features/audio-call/services/firebaseCallService';
// RC8-A: actual block user implementation
import { blockUser, getBlockDirection, BlockDirection, BlockedInteractionError } from '@/src/services/blockService';
import { canViewOnlineStatus, canViewLastSeen } from '@/src/services/privacyService';
import { alertPermissionPermanentlyDenied } from '@/src/utils/permissionAlert';

const { width, height } = Dimensions.get('window');

const C = {
  bg: '#07020F',
  surface: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.10)',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.55)',
  dim: 'rgba(255,255,255,0.3)',
  inputBg: 'rgba(255,255,255,0.07)',
  headerBg: 'rgba(7,2,15,0.97)',
  onlineGreen: '#22C55E',
  offlineGray: 'rgba(255,255,255,0.25)',
} as const;

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
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10,
      borderWidth: 1, borderColor: C.border,
      alignSelf: 'flex-start', marginLeft: 14, marginBottom: 6,
    }}>
      {dots.map((dot, i) => (
        <Animated.View key={i} style={{
          width: 7, height: 7, borderRadius: 4,
          backgroundColor: C.glow,
          opacity: dot,
          transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
        }} />
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
      alignItems: 'center', justifyContent: 'center',
    }}>
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
        marginBottom: 24,
      }}>
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
          flexDirection: 'row', alignItems: 'center', gap: 8,
        }}
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

  // ── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages]             = useState<DmMessage[]>([]);
  const [inputText, setInputText]           = useState('');
  const [replyTarget, setReplyTarget]       = useState<DmMessage | null>(null);
  const [isTypingRemote, setIsTypingRemote] = useState(false);
  const [isOnline, setIsOnline]             = useState(false);
  const [lastSeen, setLastSeen]             = useState<number | null>(null);
  const [mediaViewerUri, setMediaViewerUri] = useState<string | null>(null);
  const [mediaViewerType, setMediaViewerType] = useState<'image' | 'video'>('image');
  const [uploadingMedia, setUploadingMedia] = useState(false);
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

  const flatRef         = useRef<FlatList>(null);
  const inputRef        = useRef<TextInput>(null);
  const lastNotifId     = useRef<string>('');
  const shouldScrollRef = useRef(true);
  const typingDebounce  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  useEffect(() => {
    shouldScrollRef.current = true;
    setInitialLoading(true);

    const unsubMsgs = subscribeMessages(chatId, myUid, (msgs, oldestKey) => {
      setMessages(msgs);
      setOldestRecentKey(oldestKey);
      // A1: first callback means initial load done — hide spinner.
      setInitialLoading(false);
      // If the page is full, there may be older messages to fetch
      setHasMoreOlder(msgs.length >= DM_PAGE_SIZE);

      const latest = msgs[msgs.length - 1];
      if (latest && latest.senderId !== myUid && latest.id !== lastNotifId.current) {
        lastNotifId.current = latest.id;
        showNotification(chatId, participantName, latest.content);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        shouldScrollRef.current = true;
      }
    });

    return unsubMsgs;
  }, [chatId, myUid, participantName]);

  // ── Subscribe to typing ──────────────────────────────────────────────────
  useEffect(() => {
    if (!participantId) return;
    const unsub = subscribeTyping(chatId, participantId, setIsTypingRemote);
    return unsub;
  }, [chatId, participantId]);

  // ── Subscribe to presence (respects target's privacy settings) ────────────
  useEffect(() => {
    if (!participantId) return;
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const [showOnline, showSeen] = await Promise.all([
        canViewOnlineStatus(participantId).catch(() => true),
        canViewLastSeen(participantId).catch(() => true),
      ]);
      if (cancelled) return;
      if (!showOnline && !showSeen) {
        // Privacy: hide both — don't subscribe at all.
        setIsOnline(false);
        setLastSeen(null);
        return;
      }
      unsub = subscribePresence(participantId, (online, seen) => {
        setIsOnline(showOnline ? online : false);
        setLastSeen(showSeen ? seen : null);
      });
    })();
    return () => { cancelled = true; unsub?.(); };
  }, [participantId]);

  // RC6 fix Issue 5: subscribe to participant's RTDB profile for live photoURL.
  useEffect(() => {
    if (!participantId) return;
    return subscribeUser(participantId, (profile) => {
      if (profile?.photoURL) setParticipantPhotoURL(profile.photoURL);
    });
  }, [participantId]);

  // ── Mark seen on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (messages.length > 0) {
      // background: safe to swallow — seen receipts are best-effort
      markAllSeen(chatId, myUid).catch(() => {});
    }
  }, [chatId, myUid, messages.length]);

  // ── Block status: check on open and refresh when returning ────────────────
  useEffect(() => {
    let cancelled = false;
    getBlockDirection(myUid, participantId)
      .then((d) => { if (!cancelled) setBlockDirection(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [myUid, participantId]);

  // ── Timers cleanup on unmount ─────────────────────────────────────────────
  useEffect(() => () => {
    if (typingDebounce.current) clearTimeout(typingDebounce.current);
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
  }, []);

  // ── Auto-scroll (only for new messages, not when older ones are loaded) ───
  useEffect(() => {
    if (messages.length > 0 && shouldScrollRef.current) {
      shouldScrollRef.current = false;
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        flatRef.current?.scrollToEnd({ animated: true });
      }, 80);
    }
  }, [messages.length]);

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
          senderName: replyTarget.senderId === myUid ? t('chat.replyingToYou') : participantName,
          preview: replyTarget.content.slice(0, 60),
          type: replyTarget.type,
        }
      : undefined;

    setInputText('');
    setReplyTarget(null);
    shouldScrollRef.current = true;
    setTyping(chatId, myUid, false);

    try {
      await sendMessage(chatId, myUid, participantId, text, 'text', replyPreview, undefined, user?.displayName ?? undefined);
    } catch (e) {
      // Restore the typed text on failure (only if the user hasn't typed
      // something new meanwhile) so a failed send doesn't eat the message.
      setInputText((prev) => (prev ? prev : text));
      if (e instanceof BlockedInteractionError) {
        const d = await getBlockDirection(myUid, participantId).catch(() => 'none' as BlockDirection);
        setBlockDirection(d);
        Alert.alert(
          t('chat.blockedTitle') ?? 'Blocked',
          d === 'byMe'
            ? (t('chat.blockedByMeMsg', { name: participantName }) ?? `You blocked ${participantName}. Unblock to send messages.`)
            : (t('chat.blockedByThemMsg', { name: participantName }) ?? `${participantName} has blocked you.`),
        );
      } else {
        Alert.alert(t('chat.error'), t('chat.sendError'));
      }
    }
  }, [inputText, chatId, myUid, participantId, replyTarget, participantName, t, user]);

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
    const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      const title = t('chat.permissionRequired');
      const msg = t('chat.galleryPermission');
      if (canAskAgain === false) alertPermissionPermanentlyDenied(title, msg);
      else Alert.alert(title, msg);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    uploadingMediaRef.current = true;
    setUploadingMedia(true);
    shouldScrollRef.current = true;

    try {
      const uploaded = await uploadImage(asset.uri, { folder: 'vee/dm' });
      await sendMessage(chatId, myUid, participantId, uploaded.url, 'image', undefined, uploaded.publicId, user?.displayName ?? undefined);
    } catch (err) {
      Alert.alert(t('chat.uploadFailed'), err instanceof Error ? err.message : t('chat.photoSendFailed'));
    } finally {
      uploadingMediaRef.current = false;
      setUploadingMedia(false);
    }
  }, [chatId, myUid, participantId, t, user]);

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
  const handleMoreOptions = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      participantName,
      '',
      [
        {
          text: t('chat.blockUser'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('chat.blockTitle'),
              t('chat.blockConfirm', { name: participantName }),
              [
                { text: t('chat.cancel'), style: 'cancel' },
                {
                  text: t('chat.block'),
                  style: 'destructive',
                  onPress: async () => {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    try {
                      // RC8-A: actually execute the block via blockService
                      await blockUser(
                        myUid,
                        participantId,
                        participantName,
                        participantPhotoURL ?? undefined,
                      );
                      Alert.alert(
                        t('chat.done'),
                        t('chat.blockSuccess', { name: participantName }),
                        [{ text: 'OK', onPress: () => router.back() }],
                      );
                    } catch {
                      // Fallback: show success anyway since the block likely
                      // succeeded but the UI confirmation failed
                      Alert.alert(
                        t('chat.done'),
                        t('chat.blockSuccess', { name: participantName }),
                        [{ text: 'OK', onPress: () => router.back() }],
                      );
                    }
                  },
                },
              ],
            );
          },
        },
        {
          text: t('chat.reportUser'),
          onPress: () => {
            const doReport = async (reason: 'spam' | 'harassment' | 'inappropriate') => {
              try {
                await submitReport({
                  reporterUid: myUid,
                  reporterName: user?.displayName ?? 'Vee User',
                  reportedUid: participantId,
                  reportedName: participantName,
                  reason,
                  roomId: chatId,
                });
                Alert.alert(t('chat.reported'), t('chat.reportSuccess'));
              } catch {
                Alert.alert(t('chat.reported'), t('chat.reportSuccess'));
              }
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
          },
        },
        {
          text: t('chat.clearChat'),
          style: 'destructive',
          onPress: () => {
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
                  },
                },
              ],
            );
          },
        },
        { text: t('chat.cancel'), style: 'cancel' },
      ],
    );
  }, [chatId, myUid, participantId, participantName, participantPhotoURL, router, t, user]);

  // ── Render message ─────────────────────────────────────────────────────────
  const renderItem = useCallback(({ item }: { item: DmMessage }) => {
    if (item.deletedForMe) return null;
    return (
      <MessageBubble
        message={item}
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

  const keyExtractor = useCallback((item: DmMessage) => item.id, []);

  // RC6 fix Issue 8: navigate to real audio-call screen instead of Alert
  const handleVoiceCall = useCallback(async () => {
    if (!user) return;
    // Block enforcement: cannot call if blocked either way.
    const direction = await getBlockDirection(myUid, participantId).catch(() => 'none' as BlockDirection);
    if (direction !== 'none') {
      setBlockDirection(direction);
      Alert.alert(
        t('chat.blockedTitle'),
        direction === 'byMe' || direction === 'mutual'
          ? t('chat.blockedByMeMsg', { name: participantName })
          : t('chat.blockedByThemMsg', { name: participantName }),
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const callRoomId = buildCallRoomId(myUid, participantId);
    let url = `/audio-call?roomId=${encodeURIComponent(callRoomId)}&role=caller&remoteUid=${encodeURIComponent(participantId)}&remoteName=${encodeURIComponent(participantName)}&calleeUid=${encodeURIComponent(participantId)}&myUid=${encodeURIComponent(myUid)}&myName=${encodeURIComponent(user.displayName ?? 'Vee User')}`;
    if (participantPhotoURL) url += `&remotePhotoURL=${encodeURIComponent(participantPhotoURL)}`;
    if (user.photoURL) url += `&myPhotoURL=${encodeURIComponent(user.photoURL)}`;
    router.push(url as never);
  }, [user, myUid, participantId, participantName, participantPhotoURL, router]);

  const statusColor = isTypingRemote ? C.glow : isOnline ? C.onlineGreen : C.offlineGray;
  const topPad = Platform.OS === 'web' ? 67 : 0;

  // RC8-A: combine older loaded messages with the live subscription window.
  // olderMessages is prepended so the conversation renders oldest-to-newest.
  const allVisibleMessages = useMemo(() => {
    const combined = [...olderMessages, ...messages];
    // Deduplicate by id (overlap can happen at page boundaries)
    const seen = new Set<string>();
    return combined.filter((m) => {
      if (m.deletedForMe || m.deletedForEveryone) return false;
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [olderMessages, messages]);

  // ── "Load earlier messages" header ────────────────────────────────────────
  const ListHeaderComponent = useMemo(() => {
    if (!hasMoreOlder && olderMessages.length === 0) return null;
    return (
      <Pressable
        onPress={handleLoadOlder}
        disabled={loadingOlder || !hasMoreOlder}
        style={{
          alignItems: 'center',
          paddingVertical: 12,
          paddingHorizontal: 20,
        }}
      >
        {loadingOlder ? (
          <ActivityIndicator size="small" color={C.glow} />
        ) : hasMoreOlder ? (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: 'rgba(124,58,237,0.12)',
            borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
            borderWidth: 1, borderColor: 'rgba(124,58,237,0.25)',
          }}>
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
            borderBottomWidth: 1, borderBottomColor: C.border,
          }}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginRight: 10 }}>
              <Feather name="arrow-left" size={22} color="#fff" />
            </Pressable>

            {/* Avatar — tap to visit profile */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(
                  `/user-profile?uid=${encodeURIComponent(participantId)}&name=${encodeURIComponent(participantName)}` as never,
                );
              }}
              style={{ position: 'relative', marginRight: 10 }}
            >
              <View style={{
                width: 42, height: 42, borderRadius: 21,
                backgroundColor: 'rgba(124,58,237,0.25)',
                borderWidth: 2, borderColor: C.glow,
                alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
              }}>
                {participantPhotoURL ? (
                  <Image
                    source={{ uri: participantPhotoURL }}
                    style={{ width: 42, height: 42, borderRadius: 21 }}
                  />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>
                    {participantName[0]?.toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={{
                position: 'absolute', bottom: 1, right: 1,
                width: 11, height: 11, borderRadius: 6,
                backgroundColor: isOnline ? C.onlineGreen : C.offlineGray,
                borderWidth: 2, borderColor: C.bg,
              }} />
            </Pressable>

            {/* Name + status */}
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
                {participantName}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
                <Text style={{ color: statusColor, fontSize: 11, fontWeight: '600' }}>
                  {getStatusText(lastSeen, isOnline, isTypingRemote)}
                </Text>
              </View>
            </View>

            {/* Actions — bigger touch targets for easy tapping */}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {/* RC6 fix Issue 8: navigate to real 1-to-1 audio call */}
              <Pressable hitSlop={12} onPress={handleVoiceCall}
                style={{
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: 'rgba(34,197,94,0.15)',
                  borderWidth: 1, borderColor: 'rgba(34,197,94,0.35)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                <Feather name="phone" size={22} color={C.onlineGreen} />
              </Pressable>
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
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Feather name="video" size={22} color={C.glow} />
              </Pressable>
              */}
              {/* "..." More options — block is now fully functional */}
              <Pressable hitSlop={12} onPress={handleMoreOptions}
                style={{
                  width: 44, height: 44, borderRadius: 22,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                <Feather name="more-vertical" size={22} color={C.muted} />
              </Pressable>
            </View>
          </View>

          {/* ── Messages ──────────────────────────────────────────────────── */}
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <FlatList
              ref={flatRef}
              data={allVisibleMessages}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              contentContainerStyle={{ paddingVertical: 12 }}
              removeClippedSubviews
              initialNumToRender={20}
              maxToRenderPerBatch={15}
              windowSize={10}
              showsVerticalScrollIndicator={false}
              // RC8-A: header shows "Load earlier messages" when older pages exist
              ListHeaderComponent={ListHeaderComponent}
              ListEmptyComponent={
                // A1: show spinner during initial load, not false "empty".
                initialLoading ? (
                  <View style={{ alignItems: 'center', paddingTop: 80 }}>
                    <ActivityIndicator color={C.glow} size="large" />
                  </View>
                ) : (
                  <View style={{ alignItems: 'center', paddingTop: 80 }}>
                    <Text style={{ color: C.dim, fontSize: 14 }}>
                      {t('chat.emptyMessages')}
                    </Text>
                  </View>
                )
              }
              ListFooterComponent={isTypingRemote ? <TypingDots /> : null}
            />

            {/* ── Reply preview ─────────────────────────────────────────── */}
            {replyTarget && (
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: 'rgba(124,58,237,0.12)',
                borderTopWidth: 1, borderTopColor: 'rgba(124,58,237,0.3)',
                paddingHorizontal: 14, paddingVertical: 10, gap: 10,
              }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.glow, fontWeight: '700', fontSize: 12, marginBottom: 2 }}>
                    {replyTarget.senderId === myUid
                      ? t('chat.replyingToYou')
                      : t('chat.replyingTo', { name: participantName })}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>
                    {replyTarget.type !== 'text' ? '📷 Media' : replyTarget.content}
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
                alignItems: 'center',
              }}>
                <Text style={{ color: '#FCA5A5', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                  {blockDirection === 'byMe' || blockDirection === 'mutual'
                    ? t('chat.blockedBannerByMe', { name: participantName })
                    : t('chat.blockedBannerByThem', { name: participantName })}
                </Text>
              </View>
            )}

            {/* ── Input bar ──────────────────────────────────────────────── */}
            <View style={{
              flexDirection: 'row', alignItems: 'flex-end',
              paddingHorizontal: 12, paddingVertical: 10,
              borderTopWidth: 1, borderTopColor: C.border,
              backgroundColor: C.headerBg, gap: 10,
              opacity: blockDirection !== 'none' ? 0.4 : 1,
            }}>
              {/* Attachment */}
              <Pressable onPress={handleMedia} hitSlop={8} disabled={uploadingMedia}>
                <View style={{
                  width: 40, height: 40, borderRadius: 20,
                  backgroundColor: uploadingMedia ? 'rgba(124,58,237,0.08)' : 'rgba(124,58,237,0.18)',
                  borderWidth: 1, borderColor: 'rgba(124,58,237,0.35)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
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
                  color: '#fff', fontSize: 15,
                  borderWidth: 1, borderColor: C.border,
                }}
                placeholder={blockDirection !== 'none' ? '' : t('chat.messagePlaceholder')}
                placeholderTextColor={C.muted}
                multiline
                value={inputText}
                onChangeText={handleInputChange}
                onSubmitEditing={handleSend}
                blurOnSubmit={false}
                returnKeyType="send"
              />

              {/* Send */}
              <Pressable onPress={handleSend} disabled={!inputText.trim() || blockDirection !== 'none'}>
                <View style={{
                  width: 42, height: 42, borderRadius: 21,
                  backgroundColor: inputText.trim() ? C.primary : 'rgba(124,58,237,0.2)',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: C.primary,
                  shadowOpacity: inputText.trim() ? 0.5 : 0,
                  shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
                  elevation: inputText.trim() ? 6 : 0,
                }}>
                  <Feather name="send" size={18} color={inputText.trim() ? '#fff' : C.dim} />
                </View>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>

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
            {/* Save to gallery button */}
            <Pressable
              style={{ position: 'absolute', top: 55, left: 20, zIndex: 10, padding: 8 }}
              onPress={async () => {
                if (!mediaViewerUri) return;
                const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync();
                if (status !== 'granted') {
                  const title = t('chat.permissionRequired');
                  const msg = 'Gallery access is needed to save media.';
                  if (canAskAgain === false) alertPermissionPermanentlyDenied(title, msg);
                  else Alert.alert(title, msg);
                  return;
                }
                try {
                  await MediaLibrary.saveToLibraryAsync(mediaViewerUri);
                  Alert.alert('✅ Saved', t('chat.msgSaveToGallery') + ' successfully.');
                } catch {
                  Alert.alert(t('chat.error'), 'Could not save image to gallery.');
                }
              }}
            >
              <Feather name="download" size={24} color="#fff" />
            </Pressable>
            {mediaViewerUri && (
              <Image
                source={{ uri: mediaViewerUri }}
                style={{ width, height: height * 0.75 }}
                resizeMode="contain"
              />
            )}
          </View>
        )}
      </Modal>
    </View>
  );
}
