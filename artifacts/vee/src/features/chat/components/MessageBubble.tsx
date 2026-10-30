import { memo, useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, Animated, Alert, Modal,
  Dimensions,
} from 'react-native';
// 2026-10-19 OOM fix: chat thumbnails use expo-image (disk cache + native
// downsampling) instead of RN core Image, which decodes full-resolution
// originals into bitmap memory (Telegram serves originals; a few 20–50MB
// photos = hundreds of MB → OOM kill). Same layout/sizes, no behavior change.
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
// NOTE 12 (2026-10-11): modern expo-file-system API (SDK 54). Remote media
// must be downloaded to a local file first — MediaLibrary.saveToLibraryAsync
// only accepts LOCAL file URIs; passing an https:// URL silently does nothing.
import { File, Paths } from 'expo-file-system';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';
// 2026-10-25 (boss order): DM long-press Copy — expo-clipboard is
// already a dependency (InviteModal, VoiceRoomScreen), so no new module.
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { DmMessage } from '../types/dm';
import { addReaction, deleteMessage } from '../services/firebaseDmService';
import { alertPermissionPermanentlyDenied } from '@/src/utils/permissionAlert';
import { getErrorCause } from '@/src/utils/errorDisplay';
import { formatMsgTime } from '@/src/utils/formatMsgTime';
import VoiceMessageBubble from './VoiceMessageBubble';

const { width, height } = Dimensions.get('window');
const BUBBLE_MAX = width * 0.72;

// IMO bubble spec (measured from IMO v2026.09.1051 layouts av7/av3):
// sent = #bbdefb light blue, received = #ffffff white, 8dp radius,
// 16sp black text, 12sp #70000000 timestamp inside bubble bottom-right.
const C = {
  myBubble: '#bbdefb',
  theirBubble: '#ffffff',
  myText: '#000000',
  theirText: '#000000',
  muted: '#8E8E93',
  dim: '#C7C7CC',
  border: '#E5E5EA',
  reactionBg: 'rgba(255,255,255,0.95)',
  seen: '#8B5CF6',
  sent: '#70000000',
} as const;

// 2026-10-30 (boss: Telegram long-press menu): the long-press quick
// set is Telegram's 7. The composer quick row (InboxScreen
// QUICK_REACTIONS) is a different set and is untouched. Stored reactions
// of any emoji still render in the pill.
const REACTIONS = ['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁'];

// Fix #31 (imo-exact call durations): "2 min 6 sec" / "44 sec".
function formatCallDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m} min ${r} sec`;
}

type Props = {
  message: DmMessage;
  chatId: string;
  myUid: string;
  onReply: (msg: DmMessage) => void;
  onRetry?: (msg: DmMessage) => void;
  onMediaPress?: (uri: string, type: 'image' | 'video') => void;
  // Fix #31 (imo-exact rows): DPs beside bubbles + tap-to-call-back.
  peerPhotoURL?: string | null;
  myPhotoURL?: string | null;
  isPeerOnline?: boolean;
  onCallBack?: () => void;
  // 2026-10-30 (boss: reply-quote tap jumps to the original): parent
  // passes the jump handler + whether this bubble is the jump target.
  onQuotePress?: (messageId: string) => void;
  isHighlighted?: boolean;
  // 2026-10-30 (boss: Telegram long-press menu): parent handles
  // forward (picker + send) and message pin toggle; isPinned tells
  // the menu to show Unpin instead of Pin.
  onForward?: (msg: DmMessage) => void;
  onTogglePin?: (msg: DmMessage) => void;
  isPinned?: boolean;
};

/**
 * NOTE 12 (2026-10-11): Save a remote (or local) media URI to the device gallery.
 *
 * Why this exists: `MediaLibrary.saveToLibraryAsync` only accepts a LOCAL file
 * URI — passing a remote https:// URL silently fails (the old "download does
 * nothing" bug). Remote URLs are first downloaded to the cache directory via
 * expo-file-system's modern File API (SDK 54), then saved. Failures surface the
 * ACTUAL error cause.
 *
 * NOTE: takes pre-resolved strings (not the i18next `t` function) — passing
 * `t` directly trips a TypeScript 5.9 overload-resolution compiler crash.
 */
export interface SaveGalleryStrings {
  permissionRequired: string;
  galleryPermission: string;
  saved: string;
  msgSaveToGallery: string;
  error: string;
  saveToGalleryFailed: string;
}

export async function saveRemoteMediaToGallery(
  uri: string,
  s: SaveGalleryStrings,
): Promise<void> {
  try {
    const { status, canAskAgain } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      if (canAskAgain === false) alertPermissionPermanentlyDenied(s.permissionRequired, s.galleryPermission);
      else Alert.alert(s.permissionRequired, s.galleryPermission);
      return;
    }
    let localUri = uri;
    let tempFile: File | null = null;
    if (/^https?:\/\//i.test(uri)) {
      // FIX (2026-10-18): robust extension detection. The old logic
      // (uri.split('.').pop()) broke on extension-less URLs like
      // https://vee-club.duckdns.org/m/<hex> — it extracted "orgm" from
      // "duckdns.org/m/..." and Android rejected the save with
      // "MIME type application/octet-stream". Now: only accept a real
      // media extension from the last path segment; otherwise default
      // to jpg for our media server (image) URLs.
      const urlPath = uri.split('?')[0];
      const lastSegment = urlPath.split('/').pop() || '';
      let ext = 'jpg';
      const dotIdx = lastSegment.lastIndexOf('.');
      if (dotIdx > 0 && dotIdx < lastSegment.length - 1) {
        const candidate = lastSegment.slice(dotIdx + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
        const valid = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'm4a', 'mp3', 'wav', 'ogg', 'webm'];
        if (valid.includes(candidate)) ext = candidate === 'jpeg' ? 'jpg' : candidate;
      }
      const dest = new File(Paths.cache, `vee_dl_${Date.now()}.${ext}`);
      tempFile = dest;
      // Rejects with UnableToDownload (incl. HTTP status) on non-2xx.
      const downloaded = await File.downloadFileAsync(uri, dest);
      if (!downloaded.exists) throw new Error('Downloaded file not found on device');
      localUri = downloaded.uri;
    }
    await MediaLibrary.saveToLibraryAsync(localUri);
    // 2026-10-19 polish: delete the temp download — vee_dl_* files were
    // accumulating in the cache directory forever after every gallery save.
    if (tempFile) {
      try { tempFile.delete(); } catch { /* best-effort cleanup */ }
    }
    Alert.alert(s.saved, s.msgSaveToGallery);
  } catch (err) {
    Alert.alert(s.error, `${s.saveToGalleryFailed}\n\nReason: ${getErrorCause(err)}`);
  }
}

// Memoized: the DM thread FlatList renders one of these per message.
function MessageBubble({ message, chatId, myUid, onReply, onRetry, onMediaPress, peerPhotoURL, myPhotoURL, isPeerOnline, onCallBack, onQuotePress, isHighlighted, onForward, onTogglePin, isPinned }: Props) {
  const { t } = useTranslation();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [showReactions, setShowReactions] = useState(false);
  // 2026-10-27 (inbox polish): anchor of the long-pressed bubble, measured
  // in window coordinates — the reaction card is positioned from this so
  // it can never merge into a neighbouring message (see Modal below).
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const bubbleRef = useRef<View>(null);

  // 2026-10-30 (boss: swipe-to-reply on incoming): hold a FRIEND's
  // message and drag it RIGHT -> reply, same onReply flow as
  // long-press (quote in composer). Pan stays undetermined for taps
  // and long-presses (no movement) and fails fast on vertical drags
  // (failOffsetY), so thread scroll + long-press menu are untouched.
  // Only right drags move the bubble (clamped 0..72); past 48 on
  // release -> reply + spring back, else spring back silently.
  // 2026-10-30 (boss: own messages swipe too): drag MY message LEFT ->
  // reply, exactly the same system mirrored (clamped -72..0, past -48
  // on release -> reply; icon at the bubble's RIGHT edge, same glyph).
  // isMe is declared ABOVE the gesture on purpose: the Pan/icon
  // worklets capture it at creation, so it must already be initialized
  // here (it used to be declared below this block). Incoming behavior
  // is byte-identical (0..72, > 48, icon left).
  const isMe = message.senderId === myUid;
  const swipeX = useSharedValue(0);
  const swipePan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      swipeX.value = isMe
        ? Math.max(-72, Math.min(e.translationX, 0))
        : Math.max(0, Math.min(e.translationX, 72));
    })
    .onEnd(() => {
      if (isMe ? swipeX.value < -48 : swipeX.value > 48) runOnJS(onReply)(message);
      swipeX.value = withSpring(0, { damping: 20, stiffness: 300 });
    })
    .onFinalize(() => { swipeX.value = withSpring(0, { damping: 20, stiffness: 300 }); });
  const swipeTranslateStyle = useAnimatedStyle(() => ({ transform: [{ translateX: swipeX.value }] }));
  const swipeIconStyle = useAnimatedStyle(() => {
    const t = Math.max(0, Math.min(Math.abs(swipeX.value) / 48, 1));
    return {
      position: 'absolute', top: '50%', marginTop: -14,
      ...(isMe ? { right: 0 } : { left: 0 }),
      opacity: t, transform: [{ scale: 0.6 + 0.4 * t }],
    };
  });

  // 2026-10-30 (boss: Telegram reaction pill): pop animation —
  // fires only when the reaction set CHANGES while this bubble is
  // mounted (first mount never pops, so scrolling never re-pops old
  // pills). The key is derived from message.reactions directly so
  // these hooks can sit here, above the deletedForMe early return.
  const pillPop = useRef(new Animated.Value(1)).current;
  const pillMounted = useRef(false);
  const reactionsKey = message.reactions
    ? Object.values(message.reactions).sort().join('|')
    : '';
  useEffect(() => {
    if (!pillMounted.current) { pillMounted.current = true; return; }
    if (!message.reactions || Object.keys(message.reactions).length === 0) return;
    pillPop.setValue(0.5);
    Animated.spring(pillPop, { toValue: 1, useNativeDriver: true, tension: 300, friction: 12 }).start();
  }, [reactionsKey]);

  // 2026-10-30 (boss: Telegram long-press menu): spring open/close.
  // The Modal uses animationType="none"; the card itself springs in
  // (scale + fade) and the reaction pill pops with staggered emoji
  // fades — no bare fade, no jank. closeMenu animates out, then hides.
  const menuScale = useRef(new Animated.Value(0.92)).current;
  const menuOpacity = useRef(new Animated.Value(0)).current;
  const menuPillScale = useRef(new Animated.Value(0.7)).current;
  const menuEmojiOpacities = useRef(REACTIONS.map(() => new Animated.Value(0))).current;
  const menuClosingRef = useRef(false);
  useEffect(() => {
    if (!showReactions) return;
    menuClosingRef.current = false;
    menuScale.setValue(0.92);
    menuOpacity.setValue(0);
    menuPillScale.setValue(0.7);
    menuEmojiOpacities.forEach((v) => v.setValue(0));
    Animated.parallel([
      Animated.spring(menuScale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 20 }),
      Animated.timing(menuOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.spring(menuPillScale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 14 }),
      Animated.stagger(25, menuEmojiOpacities.map((v) => Animated.timing(v, { toValue: 1, duration: 120, useNativeDriver: true }))),
    ]).start();
  }, [showReactions, menuScale, menuOpacity, menuPillScale, menuEmojiOpacities]);
  const closeMenu = useCallback(() => {
    if (menuClosingRef.current || !showReactions) return;
    menuClosingRef.current = true;
    Animated.parallel([
      Animated.timing(menuScale, { toValue: 0.95, duration: 130, useNativeDriver: true }),
      Animated.timing(menuOpacity, { toValue: 0, duration: 130, useNativeDriver: true }),
    ]).start(() => setShowReactions(false));
  }, [showReactions, menuScale, menuOpacity]);

  // Swipe reply: both sides now (incoming right, own left); never
  // deleted messages (nothing to quote).
  const swipeable = !message.deletedForEveryone;

  if (message.deletedForMe) return null;

  const bounce = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.93, duration: 80, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 200, friction: 8 }),
    ]).start();
  };

  const handleLongPress = () => {
    bounce();
    const node = bubbleRef.current;
    if (node && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x: number, y: number, w: number, h: number) => {
        setAnchor({ x, y, w, h });
        setShowReactions(true);
      });
    } else {
      setAnchor(null);
      setShowReactions(true);
    }
  };

  // 2026-10-25 (boss order): DM long-press Copy. TEXT messages only
  // (stickers/media/voice/call logs are not copyable text, same as room
  // chat); friend's AND own texts both get it. Reactions stay untouched
  // — Copy sits alongside the reaction picker, and confirms visibly
  // with an Alert (same confirmation pattern as the invite-link copy).
  const canCopy = message.type === 'text' && !message.deletedForEveryone && !!message.content;
  const handleCopy = async () => {
    if (!canCopy) return;
    closeMenu();
    try {
      await Clipboard.setStringAsync(message.content);
      Alert.alert(t('chat.msgCopied'));
    } catch {
      Alert.alert(t('chat.error'));
    }
  };

  const handleReaction = (emoji: string) => {
    closeMenu();
    addReaction(chatId, message.id, myUid, emoji).catch(() => {
      Alert.alert(t('chat.error'), t('chat.reactionError'));
    });
  };

  // 2026-10-30 (boss: Telegram long-press menu): the dark card rows
  // call these directly — the old two-step ActionSheet/Alert menu is
  // gone. Row visibility mirrors the old rules (Reply non-deleted,
  // Copy text-only, Save media-only, Delete-for-Everyone own-only)
  // plus the new Forward (text/media/voice/sticker, non-deleted) and
  // Pin/Unpin (any non-deleted message) rows. NO dead rows: a row
  // renders only when its action applies.
  const canForward = !message.deletedForEveryone
    && ['text', 'image', 'video', 'voice', 'sticker'].includes(message.type);
  const canPin = !message.deletedForEveryone;
  const menuReply = () => { closeMenu(); onReply(message); };
  const menuForward = () => { closeMenu(); onForward?.(message); };
  const menuTogglePin = () => { closeMenu(); onTogglePin?.(message); };
  const menuSave = async () => {
    closeMenu();
    if (message.type !== 'image' && message.type !== 'video') return;
    await saveRemoteMediaToGallery(message.content, {
      permissionRequired: t('chat.permissionRequired'),
      galleryPermission: t('chat.galleryPermission'),
      saved: t('chat.saved'),
      msgSaveToGallery: t('chat.msgSaveToGallery'),
      error: t('chat.error'),
      saveToGalleryFailed: t('chat.saveToGalleryFailed'),
    });
  };
  const menuDeleteMe = () => {
    closeMenu();
    deleteMessage(chatId, message.id, myUid, false).catch(() => { Alert.alert(t('chat.error'), t('chat.deleteError')); });
  };
  const menuDeleteEveryone = () => {
    closeMenu();
    deleteMessage(chatId, message.id, myUid, true).catch(() => { Alert.alert(t('chat.error'), t('chat.deleteError')); });
  };

  const bubbleBg  = isMe ? C.myBubble : C.theirBubble;
  const textColor = isMe ? C.myText : C.theirText;
  const align     = isMe ? 'flex-end' : 'flex-start';
  // NOTE 12 (2026-10-11): video/sticker messages render edge-to-edge with no
  // bubble chrome (no padding, no background, no border). Photos (2026-10-30
  // boss order) render inside a bubble frame below; their timestamps/ticks
  // sit on bubble bg like text bubbles.
  const isMediaMsg = message.type === 'image' || message.type === 'video';
  const isImageMsg = message.type === 'image';
  const isCallMsg = message.type === 'call';
  const isStickerMsg = message.type === 'sticker';
  const noChrome = message.type === 'video' || isStickerMsg;
  // 2026-10-27 (inbox polish): my-bubble timestamp was white-on-light-blue
  // (#bbdefb) — unreadable. Dark timestamp on both bubble colours.
  const timeColor = (isMediaMsg && !isImageMsg) ? C.muted : isMe ? 'rgba(0,0,0,0.5)' : C.muted;
  const tickColor = isMediaMsg ? C.muted : C.sent;
  // 2026-10-30 (boss: DM ticks spec, real-time): seen = blue circle,
  // delivered (peer online, live) = two blue ticks, sent (peer offline) =
  // one blue tick. Stored status is a floor (delivered never drops back
  // to sent); live presence upgrades sent -> delivered with no write.
  const tickMark = message.status === 'seen' ? (
    <Feather name="circle" size={12} color="#009DFF" />
  ) : message.status === 'sending' ? (
    <Feather name="clock" size={12} color={C.muted} />
  ) : message.status === 'delivered' || isPeerOnline ? (
    // 2026-10-30 (boss: double tick must match his pictures exactly):
    // tall steep overlapping checks, measured from his screenshots
    // (42x26 box, second check offset ~13, bold stroke) — two
    // separated Feather checks are wide/shallow/gapped and do NOT
    // match. Color #009DFF sampled from the pictures. Single tick
    // and circle below are unchanged.
    <Svg width={14} height={9} viewBox="0 0 42 26">
      <Polyline
        points="3,14 11,21 27,3"
        fill="none"
        stroke="#009DFF"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="16,14 24,21 39,3"
        fill="none"
        stroke="#009DFF"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  ) : (
    <Feather name="check" size={12} color="#009DFF" />
  );

  // 2026-10-30 (boss: Telegram corner time): the old INLINE tick
  // (tickInline) is GONE — text time+tick now live in the absolute
  // corner View inside the bubble (see text branch below), so the
  // double-tick Svg sits in a normal row View again and the old
  // inline-Svg-in-Text alignment risk is gone with it. tickMark
  // (above) serves the corner + the photo/video/voice/call/sticker
  // rows, artwork byte-identical as always.

  // Fix #31 (imo-exact call card copy): missed → "Missed Audio Call" +
  // "Tap to call back"; canceled (outgoing) → "Canceled" + "Tap to call
  // again"; completed → "Audio call" + duration ("2 min 6 sec" / "44 sec").
  const callResult = message.callInfo?.result;
  const callOutgoing = message.callInfo?.direction === 'outgoing';
  const callTitle = callResult === 'missed' ? 'Missed Audio Call'
    : callResult === 'cancelled' ? 'Canceled'
    : callResult === 'rejected' ? 'Declined Audio Call'
    : 'Audio call';
  const callSubtitle = callResult === 'completed'
    ? formatCallDuration(message.callInfo?.durationSec ?? 0)
    : callResult === 'missed'
      ? 'Tap to call back'
      : callOutgoing
        ? 'Tap to call again'
        : 'Tap to call back';
  const callIconName = callResult === 'missed' ? 'phone-missed'
    : callOutgoing ? 'phone-outgoing' : 'phone-incoming';
  const callIconColor = callResult === 'missed' ? '#FF3B30' : '#000000';

  const reactions = message.reactions
    ? Object.entries(
        Object.values(message.reactions).reduce<Record<string, number>>((acc, emoji) => {
          acc[emoji] = (acc[emoji] ?? 0) + 1;
          return acc;
        }, {}),
      )
    : [];

  // 2026-10-27 (inbox polish): anchored card geometry. The card prefers
  // above the pressed bubble, falls below it when there is no room, and
  // is always clamped inside the screen — so it can never cover a
  // neighbouring message or run off the screen edge.
  const REACTION_CARD_W = Math.min(width - 32, 360);
  const REACTION_CARD_H_EST = 400;
  let reactionCardLeft = (width - REACTION_CARD_W) / 2;
  let reactionCardTop = Math.max(80, (height - REACTION_CARD_H_EST) / 2);
  if (anchor) {
    const cx = anchor.x + anchor.w / 2;
    reactionCardLeft = Math.min(Math.max(cx - REACTION_CARD_W / 2, 16), width - REACTION_CARD_W - 16);
    let top = anchor.y - REACTION_CARD_H_EST - 12;
    if (top < 70) top = anchor.y + anchor.h + 12;
    reactionCardTop = Math.min(Math.max(top, 70), Math.max(70, height - REACTION_CARD_H_EST - 24));
  }
  const reactionPreviewLabel =
    message.type === 'voice' ? '🎤 Voice message'
    : message.type === 'call' ? '📞 Call'
    : message.type === 'sticker' ? '😊 Sticker'
    : '📷 Media';

  // Fix #31 (imo-exact thread rows): peer DP at the left of incoming
  // rows (green dot when online), own DP at the right of outgoing rows.
  const avatar = (photo: string | null | undefined, onlineDot: boolean) => (
    <View style={{
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: '#D9D9DE', overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {photo ? (
        <Image source={{ uri: photo }} style={{ width: 36, height: 36, borderRadius: 18 }} contentFit="cover" cachePolicy="disk" />
      ) : (
        <Feather name="user" size={18} color="#fff" />
      )}
      {onlineDot && (
        <View style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 11, height: 11, borderRadius: 6,
          backgroundColor: '#22C55E', borderWidth: 2, borderColor: '#fff' }} />
      )}
    </View>
  );

  // 2026-10-30 (boss: Telegram long-press menu): shared dark-row styles.
  const menuRowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 12, paddingHorizontal: 4 };
  const menuLabelStyle = { color: '#FFFFFF', fontSize: 15, fontWeight: '600' as const };

  const bubbleBody = (
      <Animated.View style={{ transform: [{ scale: scaleAnim }], maxWidth: isCallMsg ? width * 0.78 : BUBBLE_MAX }}>
        {/* Reply preview inside bubble — 2026-10-30 (boss: quote
            tap jumps to the original): tappable. This Pressable is a
            SIBLING of the main bubble Pressable, not nested inside it,
            so bubble taps/long-press are untouched. Long-press on the
            quote was already a dead zone (quote sits outside the main
            Pressable) and stays one — tap now jumps, long-press still
            does nothing there. */}
        {message.replyTo && !message.deletedForEveryone && (
          <Pressable
            onPress={() => {
              if (message.replyTo && onQuotePress) onQuotePress(message.replyTo.messageId);
            }}
            style={{
              backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 10,
            paddingHorizontal: 10, paddingVertical: 6,
            marginBottom: 4, borderLeftWidth: 3, borderLeftColor: C.seen,
          }}>
            <Text style={{ color: C.seen, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>
              {message.replyTo.senderName}
            </Text>
            <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>
              {message.replyTo.type !== 'text'
                ? (message.replyTo.type === 'voice' ? '🎤 Voice message' : '📷 Media')
                : message.replyTo.preview}
            </Text>
          </Pressable>
        )}

        {/* Main bubble — NOTE 12: video/sticker skip bubble chrome; photos get the bubble frame below */}
        <Pressable
          ref={bubbleRef}
          onPress={() => {
            if (message.sendState === 'failed' && isMe && message.type === 'text') onRetry?.(message);
            // Fix #31: missed/canceled call cards tap to call back/again.
            else if (isCallMsg && message.callInfo?.result !== 'completed') onCallBack?.();
          }}
          onLongPress={handleLongPress}
          delayLongPress={200}
          style={noChrome ? {
            backgroundColor: 'transparent',
            borderRadius: 16,
            paddingHorizontal: 0, paddingVertical: 0,
            borderWidth: 0,
            overflow: 'hidden',
          } : isImageMsg ? {
            // 2026-10-30 (boss: DM photo bubble): photo inside a bubble
            // frame — text-bubble radius (20) + light thin border, image
            // itself unchanged (220x220, radius 16, clipped by the frame).
            backgroundColor: bubbleBg,
            borderRadius: 20,
            paddingHorizontal: 0, paddingVertical: 0,
            borderWidth: 1, borderColor: C.border,
            overflow: 'hidden',
          } : isCallMsg ? {
            // Fix #31 (imo-exact call card): wide rounded card, no border,
            // soft shadow on incoming; tail notch added as first child.
            backgroundColor: bubbleBg,
            borderRadius: 20,
            paddingHorizontal: 14, paddingVertical: 12,
            borderWidth: 0,
            overflow: 'visible',
            ...(isMe ? {} : {
              shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 }, elevation: 2,
            }),
          } : {
            // Fix #31 (imo-exact text bubble): 20dp radius, no tails,
            // sent = #bbdefb, received = #ffffff with hairline border +
            // soft shadow.
            backgroundColor: bubbleBg,
            borderRadius: 20,
            paddingHorizontal: 14, paddingVertical: 11,
            borderWidth: isMe ? 0 : 1, borderColor: C.border,
            ...(isMe ? {} : {
              shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4,
              shadowOffset: { width: 0, height: 2 }, elevation: 1,
            }),
          }}
        >
          {message.deletedForEveryone ? (
            <Text style={{ color: isMe ? 'rgba(0,0,0,0.55)' : C.muted, fontSize: 13, fontStyle: 'italic' }}>
              {isMe ? '🗑 You deleted this message' : '🗑 This message was deleted'}
            </Text>
          ) : message.type === 'image' ? (
            <Pressable onPress={() => onMediaPress?.(message.content, 'image')}>
              <Image
                source={{ uri: message.content }}
                style={{ width: 220, height: 220, borderRadius: 16 }}
                contentFit="cover"
                cachePolicy="disk"
              />
            </Pressable>
          ) : message.type === 'video' ? (
            <Pressable
              onPress={() => onMediaPress?.(message.content, 'video')}
              style={{
                width: 220, height: 150, borderRadius: 16,
                backgroundColor: 'rgba(0,0,0,0.5)',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Feather name="play-circle" size={48} color="#fff" />
              <Text style={{ color: 'rgba(255,255,255,0.75)', marginTop: 6, fontSize: 12 }}>
                {t('chat.videoMessage')}
              </Text>
            </Pressable>
          ) : message.type === 'call' ? (
            // Fix #31 (imo-exact call card): tail notch + white 56dp icon
            // circle + bold title + grey action/duration subtitle. The
            // outer Pressable handles tap-to-call (see onPress above).
            <View>
              <View style={{
                position: 'absolute', top: 12,
                ...(isMe ? { right: -6 } : { left: -6 }),
                width: 14, height: 14, backgroundColor: bubbleBg,
                transform: [{ rotate: '45deg' }],
              }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{
                  width: 56, height: 56, borderRadius: 28,
                  backgroundColor: '#FFFFFF',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4,
                  shadowOffset: { width: 0, height: 2 }, elevation: 2,
                }}>
                  <Feather name={callIconName} size={26} color={callIconColor} />
                </View>
                {/* FIX #37: NO flex on this text container. flex:1 inside this
                    indefinite-width row (content-driven chain under a maxWidth-only
                    bubble) collapses the texts to ~0 width on Android -> the tall
                    narrow empty call card. A plain View sizes to content, exactly
                    like the pre-Fix #31 card (which rendered correctly). Do NOT
                    re-add flex here. Titles/subtitles are short literals, so the
                    row (56 icon + 12 gap + ~150 text) always fits maxWidth 0.78. */}
                <View>
                  <Text style={{ color: textColor, fontSize: 18, fontWeight: '700' }}>
                    {callTitle}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 16, marginTop: 2 }}>
                    {callSubtitle}
                  </Text>
                </View>
              </View>
            </View>
          ) : message.type === 'voice' ? (
            // IMO-style voice message — playable bubble (play/pause +
            // progress + duration), uploaded to Vee's Telegram storage.
            <VoiceMessageBubble
              uri={message.content}
              durationSec={message.durationSec}
              isMe={isMe}
            />
          ) : message.type === 'sticker' ? (
            // Fix #31 (imo-exact sticker): large, no bubble chrome; the
            // grey time pill below comes from the timestamp block.
            /^https?:\/\//i.test(message.content) ? (
              <Image
                source={{ uri: message.content }}
                style={{ width: 160, height: 160 }}
                contentFit="contain"
                cachePolicy="disk"
              />
            ) : (
              <Text style={{ fontSize: 72, lineHeight: 84 }}>
                {message.content}
              </Text>
            )
          ) : (
            // 2026-10-30 (boss: Telegram corner time): the time
            // (+tick for own) sits as ONE unit at the bubble's
            // BOTTOM-RIGHT corner (absolute View below) — never split,
            // never a dead band. The text carries an INVISIBLE trailing
            // spacer (transparent NBSP run, sized generously past the
            // corner unit) so the last line always reserves the corner
            // zone and no text ever runs under the time. Bubble height
            // is still text-only (absolute time adds no height);
            // padding (14/11), radius, colours and text size are
            // unchanged. Incoming text gets time only, exactly as
            // today. Edge case: if the last line is nearly full, the
            // last word + spacer wrap together to a new line — the
            // bubble gains one line, but the time never splits and
            // never covers text.
            <Text style={{ color: textColor, fontSize: 16, lineHeight: 22 }}>
              {message.content}
              <Text style={{ color: 'transparent', fontSize: 12 }}>
                {'\u00A0'.repeat(isMe ? 32 : 26)}
              </Text>
            </Text>
          )}

          {/* 2026-10-30 (boss: DM ticks spec): offline = one blue tick,
              online = two blue ticks, seen = blue circle; stickers get the
              grey pill with white time. Mapping lives in tickMark above. */}
          {/* 2026-10-30 (boss: bubble must hug the message): text
              carries its time+tick inline (see text branch above), so
              the separate row below is skipped for text — that row was
              the dead empty band under every text message. Photo, video,
              voice, call and sticker rows are untouched. */}
          {!message.deletedForEveryone && message.type !== 'text' && (isStickerMsg ? (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4,
              alignSelf: isMe ? 'flex-end' : 'flex-start',
              backgroundColor: '#9C9CA3', borderRadius: 12,
              paddingHorizontal: 8, paddingVertical: 2,
            }}>
              <Text style={{ color: '#FFFFFF', fontSize: 12 }}>
                {formatMsgTime(message.createdAt)}
              </Text>
              {isMe && tickMark}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4, ...(isImageMsg ? { paddingHorizontal: 12, paddingBottom: 8 } : {}) }}>
              <Text style={{ color: timeColor, fontSize: 12 }}>
                {formatMsgTime(message.createdAt)}
              </Text>
              {isMe && tickMark}
            </View>
          ))}
          {isMe && message.sendState === 'failed' && (
            <Text style={{ color: '#D32F2F', fontSize: 12, marginTop: 4, textAlign: 'right', paddingRight: 80 }}>
              Not sent — tap to retry
            </Text>
          )}
          {/* 2026-10-30 (boss: Telegram corner time, TEXT only): one
              non-splitting time+tick unit pinned to the bubble's
              bottom-right corner, inside the padding. Absolute, so it
              adds no height; the text's invisible NBSP spacer reserves
              this zone. The tick here is tickMark in a normal row View
              — same artwork as always, no inline-Svg-in-Text anymore. */}
          {message.type === 'text' && !message.deletedForEveryone && (
            <View style={{ position: 'absolute', right: 12, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ color: timeColor, fontSize: 12 }}>
                {formatMsgTime(message.createdAt)}
              </Text>
              {isMe && tickMark}
            </View>
          )}
        </Pressable>

        {/* 2026-10-30 (boss: quote-jump highlight): brief flash
            over the whole bubble when jumped to (cleared by the parent
            after ~1.5s). pointerEvents none — taps pass through.
            Shape/padding untouched; radius matches the bubble type. */}
        {isHighlighted && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
              backgroundColor: 'rgba(33,150,243,0.15)',
              borderRadius: noChrome ? 16 : 20,
            }}
          />
        )}
        {/* 2026-10-30 (boss: Telegram reaction pill): the old row
            BELOW the bubble is DELETED. Reactions now ride as ONE blue
            pill OVERLAPPING the bubble's bottom-LEFT edge (time is
            bottom-right, so no collision), for both sides. Pill is
            DISPLAY-only (pointerEvents none — taps/long-press pass to
            the bubble); toggling still happens via the long-press
            picker, whose handleReaction -> addReaction already toggles
            (same emoji removes it — service verified, no change). The
            pill pops (scale spring) when the set changes while
            mounted. Total count shows when >1 (per-emoji counts stay
            grouped in `reactions` above). */}
        {reactions.length > 0 && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute', left: 8, bottom: -12,
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: '#2196F3', borderRadius: 14,
              paddingHorizontal: 8, paddingVertical: 3,
              shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4,
              shadowOffset: { width: 0, height: 2 }, elevation: 3,
              transform: [{ scale: pillPop }],
            }}
          >
            <Text style={{ fontSize: 13 }}>
              {reactions.map(([emoji]) => emoji).join(' ')}
            </Text>
            {reactions.reduce((n, [, c]) => n + c, 0) > 1 && (
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>
                {reactions.reduce((n, [, c]) => n + c, 0)}
              </Text>
            )}
          </Animated.View>
        )}

      </Animated.View>
  );

  // 2026-10-30 (boss: Telegram reaction pill): the pill overlaps 12dp
  // below the bubble edge, so the row gap grows to 16dp only when a
  // pill is present — 4dp clearance to the next row.
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'flex-end',
      justifyContent: align,
      marginHorizontal: 12, marginBottom: reactions.length > 0 ? 16 : 8, gap: 8 }}>
      {!isMe && avatar(peerPhotoURL, !!isPeerOnline)}
      {swipeable ? (
        <GestureDetector gesture={swipePan}>
          <Reanimated.View style={{ position: 'relative' }}>
            <Reanimated.View style={swipeIconStyle}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#E9E9EB', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="corner-up-left" size={16} color="#2196F3" />
              </View>
            </Reanimated.View>
            <Reanimated.View style={swipeTranslateStyle}>
              {bubbleBody}
            </Reanimated.View>
          </Reanimated.View>
        </GestureDetector>
      ) : bubbleBody}
      {/* Fix #31 (imo-exact): faint heart outline at the right edge of
          incoming call cards, exactly as imo shows it. */}
      {!isMe && isCallMsg && (
        <View style={{ alignSelf: 'center' }}>
          <Feather name="heart" size={22} color="#C7C7CC" />
        </View>
      )}
      {isMe && (
        <View style={{ alignSelf: 'center' }}>
          {avatar(myPhotoURL, false)}
        </View>
      )}
      {/* 2026-10-27 (inbox polish): Telegram-style reaction card in a Modal.
          A Modal renders outside the FlatList hierarchy, so the card can
          never merge into, cover, or shift a neighbouring message — the
          old inline absolute picker (bottom: 48 inside the item) did exactly
          that on the inverted list, and its inset:-200 dismiss layer also
          swallowed taps on adjacent messages. Backdrop tap dismisses. */}
      {showReactions && (
        <Modal transparent animationType="none" onRequestClose={closeMenu}>
          <View style={{ flex: 1 }}>
            <Pressable
              style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }}
              onPress={closeMenu}
            />
            <Animated.View style={{
              position: 'absolute', left: reactionCardLeft, top: reactionCardTop, width: REACTION_CARD_W,
              backgroundColor: '#1C1C1E', borderRadius: 16, padding: 12,
              shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 }, elevation: 12,
              opacity: menuOpacity, transform: [{ scale: menuScale }],
            }}>
              <View style={{
                backgroundColor: '#2C2C2E',
                borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10,
              }}>
                {message.deletedForEveryone ? (
                  <Text style={{ color: '#AEAEB2', fontSize: 13, fontStyle: 'italic' }}>
                    {isMe ? '🗑 You deleted this message' : '🗑 This message was deleted'}
                  </Text>
                ) : message.type === 'text' ? (
                  <Text style={{ color: '#FFFFFF', fontSize: 14, lineHeight: 19 }} numberOfLines={3}>
                    {message.content}
                  </Text>
                ) : (
                  <Text style={{ color: '#AEAEB2', fontSize: 13 }}>{reactionPreviewLabel}</Text>
                )}
              </View>
              <Animated.View style={{
                backgroundColor: '#26262B', borderRadius: 24,
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                paddingHorizontal: 10, paddingVertical: 6, marginBottom: 4,
                transform: [{ scale: menuPillScale }],
              }}>
                {REACTIONS.map((emoji, i) => (
                  <Animated.View key={emoji} style={{ opacity: menuEmojiOpacities[i] }}>
                    <Pressable onPress={() => handleReaction(emoji)} hitSlop={4} style={{ padding: 4 }}>
                      <Text style={{ fontSize: 28 }}>{emoji}</Text>
                    </Pressable>
                  </Animated.View>
                ))}
              </Animated.View>
              {!message.deletedForEveryone && (
                <Pressable onPress={menuReply} style={menuRowStyle}>
                  <Feather name="corner-up-left" size={20} color="#FFFFFF" />
                  <Text style={menuLabelStyle}>{t('chat.msgReply')}</Text>
                </Pressable>
              )}
              {canCopy && (
                <Pressable onPress={handleCopy} style={menuRowStyle}>
                  <Feather name="copy" size={20} color="#FFFFFF" />
                  <Text style={menuLabelStyle}>{t('chat.msgCopy')}</Text>
                </Pressable>
              )}
              {canForward && (
                <Pressable onPress={menuForward} style={menuRowStyle}>
                  <Feather name="share" size={20} color="#FFFFFF" />
                  <Text style={menuLabelStyle}>{t('chat.msgForward')}</Text>
                </Pressable>
              )}
              {canPin && (
                <Pressable onPress={menuTogglePin} style={menuRowStyle}>
                  <Feather name="bookmark" size={20} color="#FFFFFF" />
                  <Text style={menuLabelStyle}>{isPinned ? t('chat.msgUnpin') : t('chat.msgPin')}</Text>
                </Pressable>
              )}
              {(message.type === 'image' || message.type === 'video') && !message.deletedForEveryone && (
                <Pressable onPress={menuSave} style={menuRowStyle}>
                  <Feather name="download" size={20} color="#FFFFFF" />
                  <Text style={menuLabelStyle}>{t('chat.msgSaveToGallery')}</Text>
                </Pressable>
              )}
              {!message.deletedForEveryone && (
                <Pressable onPress={menuDeleteMe} style={menuRowStyle}>
                  <Feather name="trash-2" size={20} color="#FFFFFF" />
                  <Text style={menuLabelStyle}>{t('chat.msgDeleteForMe')}</Text>
                </Pressable>
              )}
              {isMe && !message.deletedForEveryone && (
                <Pressable onPress={menuDeleteEveryone} style={menuRowStyle}>
                  <Feather name="trash-2" size={20} color="#FFFFFF" />
                  <Text style={menuLabelStyle}>{t('chat.msgDeleteForEveryone')}</Text>
                </Pressable>
              )}
            </Animated.View>
          </View>
        </Modal>
      )}
    </View>
  );
}

export default memo(MessageBubble);
