import { memo, useEffect, useState, useCallback } from 'react';
import { View, Text, Image } from 'react-native';
import ScalePress from '@/components/ScalePress';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ref, get } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { Chat } from '../types';
import { formatTime } from '../data/chatUtils';

const C = {
  text: '#000000',
  muted: '#8E8E93',
  dim: '#C7C7CC',
  bg: '#FFFFFF',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  card: '#F2F2F7',
  cardUnread: 'rgba(124,58,237,0.09)',
  cardPinned: 'rgba(245,158,11,0.06)',
  border: '#E5E5EA',
  borderUnread: 'rgba(139,92,246,0.25)',
  borderPinned: 'rgba(245,158,11,0.18)',
  accent: '#8B5CF6',
  online: '#22C55E',
  gold: '#F59E0B',
} as const;

const AVATAR_SIZE = 52;

const AVATAR_COLORS = [
  '#7C3AED', '#0EA5E9', '#EC4899', '#F97316',
  '#22C55E', '#EAB308', '#8B5CF6', '#06B6D4', '#EF4444', '#10B981',
];
function colorFor(id: string | undefined | null): string {
  if (!id) return AVATAR_COLORS[0];
  let n = 0;
  for (let i = 0; i < id.length; i++) n += id.charCodeAt(i);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}
function initials(name: string | undefined | null): string {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

type Props = {
  chat: Chat;
  onPress: (chatId: string) => void;
  onLongPress?: (chatId: string) => void;
};

function ChatListItem({ chat, onPress, onLongPress }: Props) {
  const { t } = useTranslation();
  const hasUnread = chat.unreadCount > 0;
  // H4: stable callbacks so memo() isn't defeated by fresh closures.
  const handlePress = useCallback(() => onPress(chat.id), [onPress, chat.id]);
  const handleLongPress = useCallback(() => onLongPress?.(chat.id), [onLongPress, chat.id]);
  const isPinned  = chat.isPinned === true;

  // RC6 fix Issue 5: fetch the participant's live photoURL from RTDB so the
  // avatar stays current even after the other user changes their profile photo.
  // The stored chat.participantAvatar may be stale (it is only written once when
  // the chat is first created). We do a one-time get() per chat item — cheap and
  // doesn't leave a permanent listener for every chat in the list.
  const [livePhotoURL, setLivePhotoURL] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!chat.participantId) return;
    get(ref(database, `users/${chat.participantId}/photoURL`))
      .then(snap => {
        if (!cancelled && snap.exists() && snap.val()) {
          setLivePhotoURL(snap.val() as string);
        }
      })
      .catch(() => {/* non-critical — fall back to stored avatar or initials */});
    return () => { cancelled = true; };
  }, [chat.participantId]);

  const avatarUri = livePhotoURL ?? chat.participantAvatar ?? null;

  /** Label for the last message type */
  function messagePreview(c: Chat): { icon: React.ComponentProps<typeof Feather>['name'] | null; text: string } {
    switch (c.lastMessageType) {
      case 'image':        return { icon: 'image',    text: t('chat.mediaPhoto') };
      case 'video':        return { icon: 'video',     text: t('chat.mediaVideo') };
      case 'voice':        return { icon: 'mic',       text: t('chat.mediaVoice') };
      case 'story_share':  return { icon: 'share-2',  text: t('chat.mediaStoryShare') };
      case 'sticker':      return { icon: 'smile',     text: t('chat.mediaSticker') };
      case 'call': {
        // Call log preview — the lastMessage already contains the formatted
        // text (e.g. "Missed Audio Call"), show it with a phone icon.
        const isMissed = c.lastMessage.includes('Missed');
        return { icon: 'phone', text: c.lastMessage || t('chat.mediaCall') };
      }
      default:             return { icon: null,         text: c.lastMessage };
    }
  }

  const preview = messagePreview(chat);

  // IMO-STYLE FLAT DESIGN (2026-10-09): no cards, no shadows, no rounded
  // containers — just clean rows with thin dividers, exactly like IMO.
  return (
    <ScalePress onPress={handlePress} onLongPress={handleLongPress} scaleTo={0.98}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: C.bg,
        paddingVertical: 10, paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F2F2F7',
      }}>

        {/* Avatar */}
        <View style={{ position: 'relative', marginRight: 12 }}>
          {/* Story ring — IMO green for unseen */}
          {chat.hasStory && (
            <View style={{
              position: 'absolute', top: -3, left: -3,
              width: AVATAR_SIZE + 6, height: AVATAR_SIZE + 6,
              borderRadius: (AVATAR_SIZE + 6) / 2,
              borderWidth: 2,
              borderColor: chat.storySeen ? C.dim : '#22C55E',
            }} />
          )}

          {avatarUri ? (
            <Image
              source={{ uri: avatarUri }}
              style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 }}
            />
          ) : (
            <View style={{
              width: AVATAR_SIZE, height: AVATAR_SIZE,
              borderRadius: AVATAR_SIZE / 2,
              backgroundColor: colorFor(chat.participantId),
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>
                {initials(chat.participantName)}
              </Text>
            </View>
          )}

          {/* Online dot */}
          {chat.isOnline && (
            <View style={{
              position: 'absolute', bottom: 1, right: 1,
              width: 12, height: 12, borderRadius: 6,
              backgroundColor: '#22C55E',
              borderWidth: 2, borderColor: C.bg,
            }} />
          )}
        </View>

        {/* Text content */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
            {isPinned && (
              <Feather name="bookmark" size={12} color="#F59E0B" style={{ marginRight: 4 }} />
            )}
            <Text numberOfLines={1} style={{
              flex: 1, color: C.text,
              fontSize: 16, fontWeight: hasUnread ? '700' : '600',
            }}>
              {chat.participantName}
            </Text>

            <Text style={{
              color: hasUnread ? '#22C55E' : C.dim,
              fontSize: 12, fontWeight: '400', marginLeft: 8,
            }}>
              {formatTime(chat.lastMessageTime)}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {chat.isTyping
              ? (
                <Text style={{ color: '#22C55E', fontSize: 14, fontStyle: 'italic' }}>
                  {t('chat.typingIndicator')}
                </Text>
              )
              : (
                <>
                  {preview.icon && (
                    <Feather name={preview.icon} size={14} color={C.muted} />
                  )}
                  <Text numberOfLines={1} style={{
                    flex: 1,
                    color: hasUnread ? C.text : C.muted,
                    fontSize: 14, fontWeight: hasUnread ? '600' : '400',
                  }}>
                    {preview.text}
                  </Text>
                </>
              )}

            {/* Unread badge — IMO green */}
            {hasUnread && (
              <View style={{
                minWidth: 20, height: 20, borderRadius: 10,
                backgroundColor: '#22C55E',
                alignItems: 'center', justifyContent: 'center',
                paddingHorizontal: 6,
              }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                  {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </ScalePress>
  );
}

export default memo(ChatListItem);
