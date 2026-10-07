/**
 * RoomListItem — IMO-style recommended room card.
 * White card with room info, member avatars, and category tag.
 */
import { View, Text, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScalePress from '@/components/ScalePress';
import { VoiceRoom } from '../types/room';
import { useTheme } from '@/src/context/ThemeContext';

type Props = { room: VoiceRoom; onPress?: () => void };

export default function RoomListItem({ room, onPress }: Props) {
  const { theme: C, darkMode } = useTheme();
  const previews = room.memberPreviews?.slice(0, 5) ?? [];
  const isPrivate = room.isPublic === false;

  // IMO cards are white even in dark mode (they use light cards)
  const cardBg = darkMode ? '#1E1830' : '#FFFFFF';
  const cardText = darkMode ? '#FFFFFF' : '#1A1030';
  const cardMuted = darkMode ? '#B8A6D9' : '#6B5B8E';

  return (
    <ScalePress onPress={onPress}>
      <View style={{
        borderRadius: 16, padding: 14, marginBottom: 12, marginHorizontal: 16,
        backgroundColor: cardBg,
        shadowColor: '#000', shadowOpacity: 0.08,
        shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3,
      }}>
        {/* Top row: avatar + name + count */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{
            width: 36, height: 36, borderRadius: 8,
            backgroundColor: room.themeColor ?? C.primary,
            alignItems: 'center', justifyContent: 'center',
            marginRight: 10, overflow: 'hidden',
          }}>
            {room.coverImageUrl ? (
              <Image source={{ uri: room.coverImageUrl }} style={{ width: 36, height: 36 }} resizeMode="cover" />
            ) : (
              <Feather name="mic" size={16} color="#fff" />
            )}
          </View>
          <Text numberOfLines={1} style={{ flex: 1, color: cardText, fontSize: 15, fontWeight: '700' }}>
            {isPrivate ? '🔒 ' : ''}{room.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Feather name="users" size={13} color={cardMuted} />
            <Text style={{ color: cardMuted, fontSize: 13 }}>{room.memberCount}</Text>
          </View>
        </View>

        {/* Category tag + description */}
        {!!room.topic && (
          <View style={{ marginTop: 10 }}>
            <View style={{
              alignSelf: 'flex-start',
              backgroundColor: '#8B5CF6', borderRadius: 12,
              paddingHorizontal: 10, paddingVertical: 4,
            }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>🎤 {room.topic}</Text>
            </View>
            <Text numberOfLines={2} style={{ color: cardText, fontSize: 14, marginTop: 8, lineHeight: 20 }}>
              {room.topic}
            </Text>
          </View>
        )}

        {/* Bottom: member avatars */}
        {previews.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
            <View style={{ flexDirection: 'row' }}>
              {previews.map((p, i) => (
                <View key={i} style={{
                  width: 28, height: 28, borderRadius: 14,
                  backgroundColor: (p as any).color ?? C.primary,
                  borderWidth: 2, borderColor: cardBg,
                  alignItems: 'center', justifyContent: 'center',
                  marginLeft: i === 0 ? 0 : -8,
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                    {((p as any).initials || '?').charAt(0)}
                  </Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8, gap: 4 }}>
              <Text style={{ fontSize: 12 }}>📍</Text>
              <Text style={{ color: cardMuted, fontSize: 12 }}>Event</Text>
            </View>
          </View>
        )}
      </View>
    </ScalePress>
  );
}
