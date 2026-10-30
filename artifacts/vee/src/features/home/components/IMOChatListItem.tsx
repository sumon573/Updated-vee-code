/**
 * IMOChatListItem — IMO-style chat row (2026-10-10).
 * DP, name, preview, time, with pin/mute/unread/call/online indicators.
 * Matches IMO home screenshot exactly.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { VerifiedName } from '@/src/components/VerifiedName';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser } from '@/src/services/userService';

export interface IMOChat {
  id: string;
  name: string;
  photoURL?: string | null;
  lastMessage: string;
  lastMessageTime: string; // formatted, e.g., "13:52", "Yesterday"
  unreadCount?: number;
  isPinned?: boolean;
  isMuted?: boolean;
  isOnline?: boolean;
  hasUnseenStory?: boolean; // green ring — contact shared a story I haven't seen
  hasCallIcon?: boolean; // blue phone icon (voice call chats)
  isVoiceClub?: boolean; // special blue ring + audio badge
  isNew?: boolean; // "[New]" prefix in green
  participantId?: string; // for initiating calls
}

interface IMOChatListItemProps {
  chat: IMOChat;
  onPress: (chatId: string) => void;
  onLongPress?: (chatId: string) => void;
  onCallPress?: (chat: IMOChat) => void;
}

// 2026-10-19 perf: memo()'d — parent re-renders on every incoming message;
// unchanged rows keep their `chat` identity (imoChats is useMemo'd below)
// and stable handler props, so they skip re-render entirely.
export default memo(function IMOChatListItem({ chat, onPress, onLongPress, onCallPress }: IMOChatListItemProps) {
  const handlePress = useCallback(() => onPress(chat.id), [onPress, chat.id]);
  const handleLongPress = useCallback(() => onLongPress?.(chat.id), [onLongPress, chat.id]);
  const handleCallPress = useCallback(() => onCallPress?.(chat), [onCallPress, chat]);

  // Fix #34 (2026-10-29, boss: chat-list row showed grey "V" + "Vee User"
  // for a new user whose profile HAS a real name + photo): that chat's
  // userChats entry was written by sendMessage with ONLY
  // id/lastMessage/lastMessageTime/unreadCount — no participantId, no
  // participantName, no participantAvatar (firebaseDmService sendMessage
  // never writes participant fields, so a first message without a prior
  // createOrGetChat entry creates a participant-less row). Every
  // resolution layer in the home shell gates on a truthy participantId
  // — liveProfiles (IMOHomeScreen), the subscribeUserChats repair worker,
  // and the avatarCache effect — so such a row can NEVER self-heal and
  // shows the fallback forever. This row resolves its own peer, chat-list
  // rows only: when the row arrives without a real photo, derive the peer
  // uid from the chat id (buildChatId = sorted uids joined by '_') and
  // subscribe to that profile; the real name/photo win, the incoming
  // props stay the fallback. Healthy rows (photo present) add no listener
  // and render exactly as today. (Data-level follow-up, NOT done here:
  // sendMessage should also write participantId so future entries
  // self-heal via the existing repair worker.)
  const { user } = useAuth();
  const peerUid = useMemo(() => {
    if (chat.participantId) return chat.participantId;
    if (chat.photoURL || !user?.uid || !chat.id) return null;
    const me = user.uid;
    if (chat.id.startsWith(me + '_')) return chat.id.slice(me.length + 1);
    if (chat.id.endsWith('_' + me)) return chat.id.slice(0, chat.id.length - me.length - 1);
    return null;
  }, [chat.participantId, chat.photoURL, chat.id, user?.uid]);
  const [resolvedProfile, setResolvedProfile] = useState<{ name?: string; photoURL?: string } | null>(null);
  useEffect(() => {
    if (!peerUid || chat.photoURL) return;
    return subscribeUser(peerUid, (p) => {
      if (!p) return;
      setResolvedProfile((prev) => {
        const photo = p.photoURL || undefined;
        if (prev && prev.name === p.name && prev.photoURL === photo) return prev;
        return { name: p.name, photoURL: photo };
      });
    });
  }, [peerUid, chat.photoURL]);
  // sanitizeVeeUser falls back to 'User' for nameless profiles, but the
  // chat list's own fallback is 'Vee User' — never let the sanitize
  // fallback overwrite the list's fallback for genuinely nameless users.
  const displayName = (resolvedProfile?.name && resolvedProfile.name !== 'User') ? resolvedProfile.name : chat.name;
  const displayPhotoURL = chat.photoURL || resolvedProfile?.photoURL || null;

  const initials = displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
      }}
    >
      {/* DP */}
      <View>
        <View
          style={
            chat.isVoiceClub || chat.hasUnseenStory
              ? {
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  borderWidth: 2,
                  // Voice club keeps its blue ring; unseen story gets imo's
                  // green ring. Same geometry, so row height stays 81.
                  borderColor: chat.isVoiceClub ? '#2196F3' : '#4CAF50',
                  padding: 2,
                }
              : undefined
          }
        >
          {displayPhotoURL ? (
            <Image
              source={{ uri: displayPhotoURL }}
              cachePolicy="memory-disk"
              style={{ width: chat.isVoiceClub || chat.hasUnseenStory ? 48 : 52, height: chat.isVoiceClub || chat.hasUnseenStory ? 48 : 52, borderRadius: chat.isVoiceClub || chat.hasUnseenStory ? 24 : 26 }}
            />
          ) : (
            <View
              style={{
                width: chat.isVoiceClub || chat.hasUnseenStory ? 48 : 52,
                height: chat.isVoiceClub || chat.hasUnseenStory ? 48 : 52,
                borderRadius: chat.isVoiceClub || chat.hasUnseenStory ? 24 : 26,
                backgroundColor: '#E0E0E0',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: '700', color: '#757575' }}>
                {initials}
              </Text>
            </View>
          )}
        </View>
        {/* 2026-10-26 (boss: imo avatar marks): voice club keeps its audio
            badge; otherwise an online contact gets imo's green check badge
            (bottom-right). The badge IS the online mark — the old tiny dot
            near the time is gone. Check badge 16px (boss 10:51: the 20px
            one looked a bit big); voice badge stays 20px. */}
        {chat.isVoiceClub ? (
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: '#2196F3',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: '#FFFFFF',
            }}
          >
            <Ionicons name="volume-high" size={10} color="#fff" />
          </View>
        ) : chat.isOnline ? (
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: '#4CAF50',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: '#FFFFFF',
            }}
          >
            <Ionicons name="checkmark" size={10} color="#fff" />
          </View>
        ) : null}
      </View>

      {/* Name + Preview */}
      <View style={{ flex: 1, marginLeft: 12, justifyContent: 'center' }}>
        <VerifiedName
          name={displayName}
          uid={chat.participantId || peerUid || undefined}
          nameStyle={{ fontSize: 16, fontWeight: '700', color: '#212121' }}
          logoSize={16}
        />
        <Text style={{ fontSize: 14, color: '#757575', marginTop: 2 }} numberOfLines={1}>
          {chat.isNew && <Text style={{ color: '#4CAF50', fontWeight: '600' }}>[New] </Text>}
          {chat.lastMessage}
        </Text>
      </View>

      {/* Time + Icons */}
      <View style={{ alignItems: 'flex-end', justifyContent: 'center', marginLeft: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {chat.isPinned && (
            <Ionicons name="pin" size={14} color="#9E9E9E" style={{ marginRight: 4 }} />
          )}
          <Text style={{ fontSize: 12, color: '#9E9E9E' }}>{chat.lastMessageTime}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          {chat.isMuted && (
            <Ionicons name="notifications-off" size={16} color="#9E9E9E" style={{ marginRight: 6 }} />
          )}
          {(chat.unreadCount ?? 0) > 0 && !chat.isMuted && (
            <View
              style={{
                backgroundColor: '#4CAF50',
                borderRadius: 10,
                minWidth: 20,
                height: 20,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 6,
                marginRight: 6,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                {chat.unreadCount! > 99 ? '99+' : chat.unreadCount}
              </Text>
            </View>
          )}
          {/* 2026-10-13 (Sumon): muted chat-এ count নয়, শুধু "new" লেখা */}
          {(chat.unreadCount ?? 0) > 0 && chat.isMuted && (
            <View
              style={{
                backgroundColor: '#E8F5E9',
                borderRadius: 10,
                height: 20,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 10,
                marginRight: 6,
              }}
            >
              <Text style={{ color: '#4CAF50', fontSize: 11, fontWeight: '700' }}>
                new
              </Text>
            </View>
          )}
          {chat.hasCallIcon ? (
            <TouchableOpacity onPress={handleCallPress} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="call" size={22} color="#2196F3" />
            </TouchableOpacity>
          ) : (
            <Ionicons name="chevron-forward" size={20} color="#BDBDBD" />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
})
