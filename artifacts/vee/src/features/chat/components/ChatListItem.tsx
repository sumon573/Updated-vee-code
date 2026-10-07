import { memo, useCallback } from 'react';
import { View, Text, Image } from 'react-native';
import ScalePress from '@/components/ScalePress';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/context/ThemeContext';
import { Chat } from '../types';
import { formatTime } from '../data/mockChats';

const AVATAR_SIZE = 52;

const AVATAR_COLORS = [
  '#7C3AED', '#0EA5E9', '#EC4899', '#F97316',
  '#22C55E', '#EAB308', '#8B5CF6', '#06B6D4', '#EF4444', '#10B981',
];
function colorFor(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i++) n += id.charCodeAt(i);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}
function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

type Props = {
  chat: Chat;
  onPress: (chatId: string) => void;
  onLongPress?: (chatId: string) => void;
};

function ChatListItem({ chat, onPress, onLongPress }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  // IMO-style: flat list, theme-aware
  const C = {
    ...theme,
    dim: theme.mutedDim,
    accent: theme.primary,
    online: '#22C55E',
  };
  const hasUnread = chat.unreadCount > 0;
  // H4: stable callbacks so memo() isn't defeated by fresh closures.
  const handlePress = useCallback(() => onPress(chat.id), [onPress, chat.id]);
  const handleLongPress = useCallback(() => onLongPress?.(chat.id), [onLongPress, chat.id]);
  const isPinned  = chat.isPinned === true;

  // Performance: use stored avatar directly. The per-item Firebase get() was
  // causing N+1 queries on list mount (50 chats = 50 queries = slow loading).
  // Avatar updates propagate via the chat list subscription anyway.
  const avatarUri = chat.participantAvatar ?? null;

  /** Label for the last message type */
  function messagePreview(c: Chat): { icon: React.ComponentProps<typeof Feather>['name'] | null; text: string } {
    switch (c.lastMessageType) {
      case 'image':        return { icon: 'image',    text: t('chat.mediaPhoto') };
      case 'video':        return { icon: 'video',     text: t('chat.mediaVideo') };
      case 'voice':        return { icon: 'mic',       text: t('chat.mediaVoice') };
      case 'story_share':  return { icon: 'share-2',  text: t('chat.mediaStoryShare') };
      case 'sticker':      return { icon: 'smile',     text: t('chat.mediaSticker') };
      default:             return { icon: null,         text: c.lastMessage };
    }
  }

  const preview = messagePreview(chat);

  return (
    <ScalePress onPress={handlePress} onLongPress={handleLongPress} scaleTo={0.98}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 10, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: C.border,
        backgroundColor: 'transparent',
      }}>

        {/* Avatar */}
        <View style={{ position: 'relative', marginRight: 12 }}>
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
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>
                {initials(chat.participantName)}
              </Text>
            </View>
          )}

          {/* Online dot */}
          {chat.isOnline && (
            <View style={{
              position: 'absolute', bottom: 1, right: 1,
              width: 12, height: 12, borderRadius: 6,
              backgroundColor: C.online,
              borderWidth: 2, borderColor: '#fff',
            }} />
          )}
        </View>

        {/* Text content */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text numberOfLines={1} style={{
              flex: 1, color: C.text,
              fontSize: 16, fontWeight: hasUnread ? '700' : '500',
            }}>
              {chat.participantName}
            </Text>
            <Text style={{ color: C.dim, fontSize: 12, marginLeft: 8 }}>
              {formatTime(chat.lastMessageTime)}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            {chat.isTyping
              ? (
                <Text style={{ color: C.accent, fontSize: 14, fontStyle: 'italic', flex: 1 }}>
                  {t('chat.typingIndicator')}
                </Text>
              )
              : (
                <>
                  {preview.icon && (
                    <Feather name={preview.icon} size={13} color={C.dim} style={{ marginRight: 4 }} />
                  )}
                  <Text numberOfLines={1} style={{
                    flex: 1, color: C.dim, fontSize: 14,
                  }}>
                    {preview.text}
                  </Text>
                </>
              )}

            {/* Unread badge — IMO style green circle */}
            {hasUnread ? (
              <View style={{
                minWidth: 20, height: 20, borderRadius: 10,
                backgroundColor: '#22C55E',
                alignItems: 'center', justifyContent: 'center',
                paddingHorizontal: 5, marginLeft: 8,
              }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                  {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                </Text>
              </View>
            ) : (
              <Feather name="chevron-right" size={16} color={C.dim} style={{ marginLeft: 8 }} />
            )}
          </View>
        </View>
      </View>
    </ScalePress>
  );
}

export default memo(ChatListItem);
