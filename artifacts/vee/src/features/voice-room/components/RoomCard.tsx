/**
 * RoomCard — IMO-style room thumbnail.
 * Square image with member count badge (bottom-right) and
 * owner icon (bottom-left). Room name below.
 */
import { View, Text, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScalePress from '@/components/ScalePress';
import { VoiceRoom } from '../types/room';
import { useTheme } from '@/src/context/ThemeContext';

const SIZE = 110;

type Props = { room: VoiceRoom; onPress?: () => void };

export default function RoomCard({ room, onPress }: Props) {
  const { theme: C } = useTheme();
  const memberCount = room.memberCount ?? room.memberPreviews?.length ?? 0;

  return (
    <ScalePress onPress={onPress}>
      <View style={{ width: SIZE + 10, marginRight: 12 }}>
        <View style={{
          width: SIZE, height: SIZE, borderRadius: 12,
          backgroundColor: room.themeColor ?? C.primary,
          overflow: 'hidden',
        }}>
          {room.coverImageUrl ? (
            <Image
              source={{ uri: room.coverImageUrl }}
              style={{ width: SIZE, height: SIZE }}
              resizeMode="cover"
            />
          ) : (
            <View style={{
              width: SIZE, height: SIZE,
              backgroundColor: room.themeColor ?? C.primary,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Feather name="mic" size={32} color="rgba(255,255,255,0.5)" />
            </View>
          )}
          {/* Bottom-left: owner icon */}
          <View style={{
            position: 'absolute', left: 6, bottom: 6,
            width: 22, height: 22, borderRadius: 11,
            backgroundColor: 'rgba(255,255,255,0.95)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name="user" size={12} color="#3B82F6" />
          </View>
          {/* Bottom-right: member count */}
          <View style={{
            position: 'absolute', right: 6, bottom: 6,
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.65)',
            borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3,
            gap: 3,
          }}>
            <Feather name="users" size={10} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
              {memberCount}
            </Text>
          </View>
        </View>
        <Text numberOfLines={1} style={{
          color: C.text, fontSize: 12, fontWeight: '600',
          marginTop: 6, textAlign: 'center',
        }}>
          {room.isPublic === false ? '🔒 ' : ''}{room.name}
        </Text>
      </View>
    </ScalePress>
  );
}
