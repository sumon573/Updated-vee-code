import { memo } from 'react';
import { View, Text, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import ScalePress from '@/components/ScalePress';
import { VoiceRoom } from '../types/room';

// 2026-10-23 (Sumon): tiles slimmed down + flat — no glow shadow, just a
// hairline border, so the My Rooms row looks clean and light.
const SIZE = 68;

type Props = { room: VoiceRoom; onPress?: () => void; liveCount?: number };

// Perf (2026-10-22 audit): memoized — VoiceRoomHome passes stable room
// objects + stable press handlers, so cards re-render only when their own
// room's visible data or live count changes.
export default memo(function RoomCard({ room, onPress, liveCount }: Props) {
  const { t } = useTranslation();
  const previews = room.memberPreviews?.slice(0, 4) ?? [];

  return (
    <ScalePress onPress={onPress}>
      <View style={{ width: 82, marginRight: 8 }}>
        <View style={{
          width: SIZE, height: SIZE, borderRadius: 16,
          backgroundColor: room.themeColor,
          alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)',
        }}>
          {room.coverImageUrl ? (
            <Image
              source={{ uri: room.coverImageUrl }}
              style={{ position: 'absolute', width: SIZE, height: SIZE }}
              resizeMode="cover"
            />
          ) : (
            <>
              {/* Background circle decoration */}
              <View style={{
                position: 'absolute', width: SIZE * 1.2, height: SIZE * 1.2,
                borderRadius: SIZE, top: -SIZE * 0.45, left: -SIZE * 0.25,
                backgroundColor: 'rgba(255,255,255,0.12)',
              }} />
              <Feather name="mic" size={23} color="rgba(255,255,255,0.9)" />
            </>
          )}

          {/* Member DPs row — bottom left */}
          {previews.length > 0 && (
            <View style={{
              position: 'absolute', left: 6, bottom: 6,
              flexDirection: 'row',
            }}>
              {previews.map((p, i) => (
                <View key={i} style={{
                  width: 16, height: 16, borderRadius: 8,
                  backgroundColor: p.color,
                  borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.4)',
                  alignItems: 'center', justifyContent: 'center',
                  marginLeft: i === 0 ? 0 : -5,
                }}>
                  <Text style={{ color: '#fff', fontSize: 7, fontWeight: '900' }}>
                    {(p.initials || '?').charAt(0)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Member count — bottom right */}
          <View style={{
            position: 'absolute', right: 6, bottom: 6,
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.45)',
            borderRadius: 999, paddingHorizontal: 5, paddingVertical: 2,
          }}>
            <Feather name="volume-2" size={8} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900', marginLeft: 3 }}>
              {liveCount ?? room.liveCount ?? room.memberCount}
            </Text>
          </View>
        </View>

        {/* Name */}
        <Text numberOfLines={1} style={{
          color: '#000000', fontSize: 13, fontWeight: '800', marginTop: 6,
        }}>
          {room.isPublic === false ? '🔒 ' : ''}{room.name}
        </Text>

        {/* Topic label + text — 2026-10-22 (Sumon): small soft label;
            the topic text itself is lightly highlighted. */}
        {!!room.topic && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 4, flexWrap: 'wrap' }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 2,
              backgroundColor: 'rgba(249,115,22,0.13)', borderRadius: 999,
              paddingHorizontal: 5, paddingVertical: 2,
            }}>
              <Text style={{ fontSize: 7 }}>💬</Text>
              <Text style={{ color: '#EA580C', fontSize: 7.5, fontWeight: '800' }}>{t('voiceRoom.card.topic')}</Text>
            </View>
            <View style={{
              backgroundColor: 'rgba(249,115,22,0.10)', borderRadius: 6,
              paddingHorizontal: 6, paddingVertical: 2, flexShrink: 1,
            }}>
              <Text numberOfLines={1} style={{ color: '#9A3412', fontSize: 10, fontWeight: '600' }}>
                {room.topic}
              </Text>
            </View>
          </View>
        )}
      </View>
    </ScalePress>
  );
});
