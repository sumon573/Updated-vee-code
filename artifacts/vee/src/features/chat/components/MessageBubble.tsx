import { memo, useRef, useState } from 'react';
import {
  View, Text, Pressable, Animated, Alert,
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
import { useTranslation } from 'react-i18next';
import { DmMessage } from '../types/dm';
import { addReaction, deleteMessage } from '../services/firebaseDmService';
import { alertPermissionPermanentlyDenied } from '@/src/utils/permissionAlert';
import { getErrorCause } from '@/src/utils/errorDisplay';
import VoiceMessageBubble from './VoiceMessageBubble';

const { width } = Dimensions.get('window');
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
  // 2026-10-19 polish: malformed timestamps rendered as "NaN:NaN PM".
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m} ${ampm}`;
}

type Props = {
  message: DmMessage;
  chatId: string;
  myUid: string;
  onReply: (msg: DmMessage) => void;
  onMediaPress?: (uri: string, type: 'image' | 'video') => void;
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
function MessageBubble({ message, chatId, myUid, onReply, onMediaPress }: Props) {
  const { t } = useTranslation();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [showReactions, setShowReactions] = useState(false);

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
    setShowReactions(true);
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
  const timeColor = isMediaMsg ? C.muted : isMe ? 'rgba(255,255,255,0.75)' : C.muted;
  const tickColor = isMediaMsg ? C.muted : C.sent;

  const reactions = message.reactions
    ? Object.entries(
        Object.values(message.reactions).reduce<Record<string, number>>((acc, emoji) => {
          acc[emoji] = (acc[emoji] ?? 0) + 1;
          return acc;
        }, {}),
      )
    : [];

  return (
    <View style={{ alignItems: align, marginHorizontal: 14, marginBottom: 2 }}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }], maxWidth: BUBBLE_MAX }}>
        {/* Reply preview inside bubble */}
        {message.replyTo && !message.deletedForEveryone && (
          <View style={{
            backgroundColor: isMe ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.06)', borderRadius: 10,
            paddingHorizontal: 10, paddingVertical: 6,
            marginBottom: 4, borderLeftWidth: 3, borderLeftColor: C.seen,
          }}>
            <Text style={{ color: isMe ? 'rgba(255,255,255,0.95)' : C.seen, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>
              {message.replyTo.senderName}
            </Text>
            <Text style={{ color: isMe ? 'rgba(255,255,255,0.8)' : C.muted, fontSize: 12 }} numberOfLines={1}>
              {message.replyTo.type !== 'text'
                ? (message.replyTo.type === 'voice' ? '🎤 Voice message' : '📷 Media')
                : message.replyTo.preview}
            </Text>
          </View>
        )}

        {/* Main bubble — NOTE 12: media messages skip bubble chrome for a clean, professional look */}
        <Pressable
          onLongPress={handleLongPress}
          delayLongPress={200}
          style={isMediaMsg ? {
            backgroundColor: 'transparent',
            borderRadius: 16,
            paddingHorizontal: 0, paddingVertical: 0,
            borderWidth: 0,
            overflow: 'hidden',
          } : {
            // IMO bubble chrome: 8dp radius, no tails, sent = #bbdefb,
            // received = #ffffff with a hairline border.
            backgroundColor: bubbleBg,
            borderRadius: 8,
            paddingHorizontal: 12, paddingVertical: 8,
            borderWidth: isMe ? 0 : 1, borderColor: C.border,
          }}
        >
          {message.deletedForEveryone ? (
            <Text style={{ color: isMe ? 'rgba(255,255,255,0.8)' : C.muted, fontSize: 13, fontStyle: 'italic' }}>
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
            // CALL LOG (2026-10-09): IMO-style call entry in chat
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
              <View style={{
                width: 38, height: 38, borderRadius: 19,
                backgroundColor: message.callInfo?.result === 'missed' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Feather
                  name="phone"
                  size={18}
                  color={message.callInfo?.result === 'missed' ? '#EF4444' : '#22C55E'}
                />
              </View>
              <View>
                <Text style={{ color: textColor, fontSize: 14, fontWeight: '600' }}>
                  {message.callInfo?.result === 'missed' ? 'Missed Audio Call'
                    : message.callInfo?.result === 'rejected' ? 'Declined Audio Call'
                    : message.callInfo?.result === 'cancelled' ? 'Cancelled Audio Call'
                    : `Audio Call (${Math.floor((message.callInfo?.durationSec ?? 0) / 60)}:${String((message.callInfo?.durationSec ?? 0) % 60).padStart(2, '0')})`}
                </Text>
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                  {message.callInfo?.direction === 'outgoing' ? 'Outgoing' : 'Incoming'}
                </Text>
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
          ) : (
            // IMO: 16sp message text.
            <Text style={{ color: textColor, fontSize: 16, lineHeight: 22 }}>
              {message.content}
            </Text>
          )}

          {/* Timestamp + ticks — IMO style: 12sp #70000000, inside the
              bubble at bottom-right, check marks for sent messages. */}
          {!message.deletedForEveryone && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
              <Text style={{ color: timeColor, fontSize: 12 }}>
                {formatMsgTime(message.createdAt)}
              </Text>
              {isMe && (
                message.status === 'seen' ? (
                  <Feather name="check-circle" size={12} color={C.seen} />
                ) : message.status === 'delivered' ? (
                  // Double tick: two overlapping check icons
                  <View style={{ flexDirection: 'row', marginLeft: -4 }}>
                    <Feather name="check" size={12} color={tickColor} />
                    <Feather name="check" size={12} color={tickColor} style={{ marginLeft: -8 }} />
                  </View>
                ) : (
                  <Feather name="check" size={12} color={tickColor} />
                )
              )}
            </View>
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

        {/* Quick reaction picker overlay */}
        {showReactions && (
          <View style={{
            position: 'absolute',
            bottom: 48,
            [isMe ? 'right' : 'left']: 0,
            flexDirection: 'row',
            backgroundColor: 'rgba(255,255,255,0.97)',
            borderRadius: 30, paddingVertical: 8, paddingHorizontal: 12, gap: 6,
            borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)',
            shadowColor: '#7C3AED', shadowOpacity: 0.3, shadowRadius: 12,
            shadowOffset: { width: 0, height: 2 }, elevation: 10, zIndex: 100,
          }}>
            {REACTIONS.map((emoji) => (
              <Pressable key={emoji} onPress={() => handleReaction(emoji)} style={{ padding: 4 }}>
                <Text style={{ fontSize: 24 }}>{emoji}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => { setShowReactions(false); handleOptions(); }}
              style={{ padding: 4, alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="more-horizontal" size={20} color="#8E8E93" />
            </Pressable>
          </View>
        )}

        {/* Dismiss reaction overlay if tapped outside */}
        {showReactions && (
          <Pressable
            style={{ position: 'absolute', inset: -200, zIndex: 99 }}
            onPress={() => setShowReactions(false)}
          />
        )}
      </Animated.View>
    </View>
  );
}

export default memo(MessageBubble);
