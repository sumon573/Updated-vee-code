/**
 * IMOChatListItem — IMO-style chat row (2026-10-10).
 * DP, name, preview, time, with pin/mute/unread/call/online indicators.
 * Matches IMO home screenshot exactly.
 */
import { useCallback } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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

export default function IMOChatListItem({ chat, onPress, onLongPress, onCallPress }: IMOChatListItemProps) {
  const handlePress = useCallback(() => onPress(chat.id), [onPress, chat.id]);
  const handleLongPress = useCallback(() => onLongPress?.(chat.id), [onLongPress, chat.id]);
  const handleCallPress = useCallback(() => onCallPress?.(chat), [onCallPress, chat]);

  const initials = chat.name.trim().charAt(0).toUpperCase() || '?';

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
            chat.isVoiceClub
              ? {
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  borderWidth: 2,
                  borderColor: '#2196F3',
                  padding: 2,
                }
              : undefined
          }
        >
          {chat.photoURL ? (
            <Image
              source={{ uri: chat.photoURL }}
              style={{ width: chat.isVoiceClub ? 48 : 52, height: chat.isVoiceClub ? 48 : 52, borderRadius: chat.isVoiceClub ? 24 : 26 }}
            />
          ) : (
            <View
              style={{
                width: chat.isVoiceClub ? 48 : 52,
                height: chat.isVoiceClub ? 48 : 52,
                borderRadius: chat.isVoiceClub ? 24 : 26,
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
        {chat.isVoiceClub && (
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
        )}
      </View>

      {/* Name + Preview */}
      <View style={{ flex: 1, marginLeft: 12, justifyContent: 'center' }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#212121' }} numberOfLines={1}>
          {chat.name}
        </Text>
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
          {(chat.unreadCount ?? 0) > 0 && (
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
          {chat.isOnline && (
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: '#4CAF50',
                marginRight: 6,
              }}
            />
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
}
