import { memo, useRef, useState } from 'react';
import {
  View, Text, Pressable, Animated, Alert, Modal,
  ActionSheetIOS, Platform, Dimensions,
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
// 2026-10-25 (boss order): DM long-press Copy — expo-clipboard is
// already a dependency (InviteModal, VoiceRoomScreen), so no new module.
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { DmMessage } from '../types/dm';
import { addReaction, deleteMessage } from '../services/firebaseDmService';
import { alertPermissionPermanentlyDenied } from '@/src/utils/permissionAlert';
import { getErrorCause } from '@/src/utils/errorDisplay';
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

const REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👏'];

function formatMsgTime(ts: number): string {
  // Fix #31 (imo-exact, 2026-10-29): imo shows 24-hour times ("18:17",
  // "13:19") — the old 12-hour "2:30 PM" format is gone.
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

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
function MessageBubble({ message, chatId, myUid, onReply, onRetry, onMediaPress, peerPhotoURL, myPhotoURL, isPeerOnline, onCallBack }: Props) {
  const { t } = useTranslation();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [showReactions, setShowReactions] = useState(false);
  // 2026-10-27 (inbox polish): anchor of the long-pressed bubble, measured
  // in window coordinates — the reaction card is positioned from this so
  // it can never merge into a neighbouring message (see Modal below).
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const bubbleRef = useRef<View>(null);

  const isMe = message.senderId === myUid;

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
    setShowReactions(false);
    try {
      await Clipboard.setStringAsync(message.content);
      Alert.alert(t('chat.msgCopied'));
    } catch {
      Alert.alert(t('chat.error'));
    }
  };

  const handleReaction = (emoji: string) => {
    setShowReactions(false);
    addReaction(chatId, message.id, myUid, emoji).catch(() => {
      Alert.alert(t('chat.error'), t('chat.reactionError'));
    });
  };

  const handleOptions = () => {
    const options: string[] = message.deletedForEveryone
      ? [t('chat.cancel')]
      : isMe
        ? [t('chat.msgReply'), t('chat.msgDeleteForMe'), t('chat.msgDeleteForEveryone'), t('chat.cancel')]
        : [t('chat.msgReply'), t('chat.msgSaveToGallery'), t('chat.msgDeleteForMe'), t('chat.cancel')];

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: options.includes(t('chat.msgDeleteForEveryone'))
            ? options.indexOf(t('chat.msgDeleteForEveryone'))
            : undefined,
        },
        (idx) => handleOptionSelect(options[idx]),
      );
    } else {
      // Android — Alert.alert with typed buttons
      type BtnStyle = 'cancel' | 'destructive' | 'default';
      const buttons: Array<{ text: string; style: BtnStyle; onPress: () => void }> = options
        .filter((o) => o !== t('chat.cancel'))
        .map((label) => ({
          text: label,
          style: (label === t('chat.msgDeleteForMe') || label === t('chat.msgDeleteForEveryone') ? 'destructive' : 'default') as BtnStyle,
          onPress: () => handleOptionSelect(label),
        }));
      buttons.push({ text: t('chat.cancel'), style: 'cancel' as BtnStyle, onPress: () => {} });
      Alert.alert(t('chat.messageOptions'), '', buttons);
    }
  };

  const handleOptionSelect = async (action: string) => {
    if (action === t('chat.msgReply')) { onReply(message); return; }
    if (action === t('chat.msgDeleteForMe')) { deleteMessage(chatId, message.id, myUid, false).catch(() => { Alert.alert(t('chat.error'), t('chat.deleteError')); }); return; }
    if (action === t('chat.msgDeleteForEveryone')) { deleteMessage(chatId, message.id, myUid, true).catch(() => { Alert.alert(t('chat.error'), t('chat.deleteError')); }); return; }
    if (action === t('chat.msgSaveToGallery')) {
      if (message.type !== 'image' && message.type !== 'video') return;
      // NOTE 12 (2026-10-11): fixed — downloads remote URL to a local file
      // first. Strings are resolved here rather than passing `t` itself, which
      // trips a TypeScript 5.9 overload-resolution compiler crash.
      await saveRemoteMediaToGallery(message.content, {
        permissionRequired: t('chat.permissionRequired'),
        galleryPermission: t('chat.galleryPermission'),
        saved: t('chat.saved'),
        msgSaveToGallery: t('chat.msgSaveToGallery'),
        error: t('chat.error'),
        saveToGalleryFailed: t('chat.saveToGalleryFailed'),
      });
      return;
    }
  };

  const bubbleBg  = isMe ? C.myBubble : C.theirBubble;
  const textColor = isMe ? C.myText : C.theirText;
  const align     = isMe ? 'flex-end' : 'flex-start';
  // NOTE 12 (2026-10-11): media messages render edge-to-edge with no bubble
  // chrome (no padding, no background, no border) — clean professional look.
  // Timestamps/ticks below media use muted colors (no bubble bg to sit on).
  const isMediaMsg = message.type === 'image' || message.type === 'video';
  const isCallMsg = message.type === 'call';
  const isStickerMsg = message.type === 'sticker';
  const noChrome = isMediaMsg || isStickerMsg;
  // 2026-10-27 (inbox polish): my-bubble timestamp was white-on-light-blue
  // (#bbdefb) — unreadable. Dark timestamp on both bubble colours.
  const timeColor = isMediaMsg ? C.muted : isMe ? 'rgba(0,0,0,0.5)' : C.muted;
  const tickColor = isMediaMsg ? C.muted : C.sent;

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
  const REACTION_CARD_H_EST = 212;
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

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'flex-end',
      justifyContent: align,
      marginHorizontal: 12, marginBottom: 8, gap: 8 }}>
      {!isMe && avatar(peerPhotoURL, !!isPeerOnline)}
      <Animated.View style={{ transform: [{ scale: scaleAnim }], maxWidth: isCallMsg ? width * 0.78 : BUBBLE_MAX }}>
        {/* Reply preview inside bubble */}
        {message.replyTo && !message.deletedForEveryone && (
          <View style={{
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
          </View>
        )}

        {/* Main bubble — NOTE 12: media messages skip bubble chrome for a clean, professional look */}
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
                <View style={{ flex: 1 }}>
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
            // IMO: 16sp message text.
            <Text style={{ color: textColor, fontSize: 16, lineHeight: 22 }}>
              {message.content}
            </Text>
          )}

          {/* Fix #31 (imo-exact ticks + sticker pill): sent/delivered =
              blue hollow circle, seen = blue check; stickers get the grey
              pill with white time, exactly as imo shows it. */}
          {!message.deletedForEveryone && (isStickerMsg ? (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4,
              alignSelf: isMe ? 'flex-end' : 'flex-start',
              backgroundColor: '#9C9CA3', borderRadius: 12,
              paddingHorizontal: 8, paddingVertical: 2,
            }}>
              <Text style={{ color: '#FFFFFF', fontSize: 12 }}>
                {formatMsgTime(message.createdAt)}
              </Text>
              {isMe && (message.status === 'seen' ? (
                <Feather name="check" size={12} color="#009DFF" />
              ) : (
                <Feather name="circle" size={12} color="#009DFF" />
              ))}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
              <Text style={{ color: timeColor, fontSize: 12 }}>
                {formatMsgTime(message.createdAt)}
              </Text>
              {isMe && (message.status === 'seen' ? (
                <Feather name="check" size={12} color="#009DFF" />
              ) : message.status === 'sending' ? (
                <Feather name="clock" size={12} color={C.muted} />
              ) : (
                <Feather name="circle" size={12} color="#009DFF" />
              ))}
            </View>
          ))}
          {isMe && message.sendState === 'failed' && (
            <Text style={{ color: '#D32F2F', fontSize: 12, marginTop: 4, textAlign: 'right' }}>
              Not sent — tap to retry
            </Text>
          )}
        </Pressable>

        {/* Reactions display */}
        {reactions.length > 0 && (
          <View style={{
            flexDirection: 'row', flexWrap: 'wrap', gap: 4,
            marginTop: 4, justifyContent: isMe ? 'flex-end' : 'flex-start',
          }}>
            {reactions.map(([emoji, count]) => (
              <Pressable
                key={emoji}
                onPress={() => handleReaction(emoji)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 3,
                  backgroundColor: C.reactionBg, borderRadius: 14,
                  paddingHorizontal: 8, paddingVertical: 4,
                  borderWidth: 1,
                  borderColor: message.reactions?.[myUid] === emoji
                    ? 'rgba(124,58,237,0.6)'
                    : '#E5E5EA',
                }}
              >
                <Text style={{ fontSize: 13 }}>{emoji}</Text>
                {count > 1 && (
                  <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700' }}>{count}</Text>
                )}
              </Pressable>
            ))}
          </View>
        )}

      </Animated.View>
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
        <Modal transparent animationType="fade" onRequestClose={() => setShowReactions(false)}>
          <View style={{ flex: 1 }}>
            <Pressable
              style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }}
              onPress={() => setShowReactions(false)}
            />
            <View style={{
              position: 'absolute', left: reactionCardLeft, top: reactionCardTop, width: REACTION_CARD_W,
              backgroundColor: '#ffffff', borderRadius: 20, padding: 12,
              borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
              shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 }, elevation: 12,
            }}>
              <View style={{
                backgroundColor: isMe ? '#bbdefb' : '#F2F2F7',
                borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10,
              }}>
                {message.deletedForEveryone ? (
                  <Text style={{ color: C.muted, fontSize: 13, fontStyle: 'italic' }}>
                    {isMe ? '🗑 You deleted this message' : '🗑 This message was deleted'}
                  </Text>
                ) : message.type === 'text' ? (
                  <Text style={{ color: '#000000', fontSize: 14, lineHeight: 19 }} numberOfLines={3}>
                    {message.content}
                  </Text>
                ) : (
                  <Text style={{ color: C.muted, fontSize: 13 }}>{reactionPreviewLabel}</Text>
                )}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 }}>
                {REACTIONS.map((emoji) => (
                  <Pressable key={emoji} onPress={() => handleReaction(emoji)} hitSlop={4} style={{ padding: 6 }}>
                    <Text style={{ fontSize: 28 }}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ height: 1, backgroundColor: '#E5E5EA', marginVertical: 10 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                {canCopy && (
                  <Pressable onPress={handleCopy} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
                    <Feather name="copy" size={18} color="#8E8E93" />
                    <Text style={{ color: '#8E8E93', fontSize: 13, fontWeight: '700' }}>{t('chat.msgCopy')}</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => { setShowReactions(false); handleOptions(); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}
                >
                  <Feather name="more-horizontal" size={20} color="#8E8E93" />
                  <Text style={{ color: '#8E8E93', fontSize: 13, fontWeight: '700' }}>{t('chat.messageOptions')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

export default memo(MessageBubble);
