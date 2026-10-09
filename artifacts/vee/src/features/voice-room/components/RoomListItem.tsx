/**
 * RoomListItem — recommended/trending room card (LIGHT MODE).
 *
 * 2026-10-09 fix: this component still used dark-theme colors while
 * VoiceRoomHome is light — room name and topic were invisible (white on
 * white). All colors below are verified visible on light backgrounds.
 *
 * Shows: cover tile, room name (readable), LIVE badge, topic, live member
 * count, and up to 6 real member DPs (photoURL, falling back to initials).
 */

import { View, Text, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import ScalePress from '@/components/ScalePress';
import { VoiceRoom } from '../types/room';

const C = {
  bg: '#FFFFFF',
  text: '#000000',
  muted: '#8E8E93',
  sub: '#3A3A3C',
  surface: '#FFFFFF',
  border: '#E5E5EA',
} as const;

const MAX_DP = 6;
const DP = 24;

type Props = { room: VoiceRoom; onPress?: () => void };

export default function RoomListItem({ room, onPress }: Props) {
  const { t } = useTranslation();
  const previews = room.memberPreviews?.slice(0, MAX_DP) ?? [];
  const isPrivate = room.isPublic === false;

  return (
    <ScalePress onPress={onPress}>
      <View style={{
        borderRadius: 18, padding: 14, marginBottom: 12,
        backgroundColor: C.surface,
        borderWidth: 1, borderColor: C.border,
        shadowColor: '#8B5CF6', shadowOpacity: 0.12,
        shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* Room cover tile */}
          <View style={{
            width: 50, height: 50, borderRadius: 14,
            backgroundColor: room.themeColor,
            alignItems: 'center', justifyContent: 'center',
            marginRight: 12, overflow: 'hidden',
            shadowColor: room.themeColor, shadowOpacity: 0.4,
            shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
          }}>
            {room.coverImageUrl ? (
              <Image
                source={{ uri: room.coverImageUrl }}
                style={{ width: 50, height: 50 }}
                resizeMode="cover"
              />
            ) : (
              <Feather name="mic" size={20} color="rgba(255,255,255,0.9)" />
            )}
          </View>

          <View style={{ flex: 1 }}>
            {/* Room name with public/private icon — must be readable */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {isPrivate ? (
                <Feather name="lock" size={13} color="#F59E0B" />
              ) : (
                <Feather name="globe" size={13} color="#10B981" />
              )}
              <Text numberOfLines={1} style={{ color: C.text, fontSize: 16, fontWeight: '800', flex: 1 }}>
                {room.name}
              </Text>
            </View>
            {/* Live member count under the name */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 5 }}>
              <Feather name="users" size={12} color={C.muted} />
              <Text style={{ color: C.muted, fontSize: 12, fontWeight: '600' }}>
                {t('voiceRoom.listItem.members', { count: room.memberCount })}
              </Text>
            </View>
          </View>

          {room.isLive && (
            <View style={{
              backgroundColor: 'rgba(239,68,68,0.12)',
              borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
              borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)',
            }}>
              <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: '900' }}>
                ● {t('voiceRoom.listItem.live')}
              </Text>
            </View>
          )}
        </View>

        {/* Topic pill + topic text (readable) */}
        {!!room.topic && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: '#F97316', borderRadius: 999,
              paddingHorizontal: 10, paddingVertical: 4,
            }}>
              <Text style={{ fontSize: 11 }}>💬</Text>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>{t('voiceRoom.card.topic')}</Text>
            </View>
            <Text numberOfLines={1} style={{ color: C.sub, fontSize: 13, flex: 1 }}>
              {room.topic}
            </Text>
          </View>
        )}

        {/* Bottom row: real member DPs (up to 6) + private badge */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
          {previews.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {previews.map((p, i) =>
                p.photoURL ? (
                  <Image
                    key={i}
                    source={{ uri: p.photoURL }}
                    style={{
                      width: DP, height: DP, borderRadius: DP / 2,
                      borderWidth: 1.5, borderColor: '#FFFFFF',
                      marginLeft: i === 0 ? 0 : -8,
                    }}
                  />
                ) : (
                  <View key={i} style={{
                    width: DP, height: DP, borderRadius: DP / 2,
                    backgroundColor: p.color,
                    borderWidth: 1.5, borderColor: '#FFFFFF',
                    alignItems: 'center', justifyContent: 'center',
                    marginLeft: i === 0 ? 0 : -8,
                  }}>
                    <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900' }}>
                      {(p.initials || '?').charAt(0)}
                    </Text>
                  </View>
                ),
              )}
              {room.memberCount > previews.length && (
                <View style={{
                  width: DP, height: DP, borderRadius: DP / 2,
                  backgroundColor: '#EDE9FE',
                  borderWidth: 1.5, borderColor: '#FFFFFF',
                  alignItems: 'center', justifyContent: 'center',
                  marginLeft: -8,
                }}>
                  <Text style={{ color: '#7C3AED', fontSize: 7, fontWeight: '900' }}>
                    +{room.memberCount - previews.length}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <Text style={{ color: C.muted, fontSize: 12 }}>
              {t('voiceRoom.listItem.members', { count: room.memberCount })}
            </Text>
          )}

          {/* Private room badge */}
          {isPrivate && (
            <View style={{
              marginLeft: 'auto',
              backgroundColor: 'rgba(245,158,11,0.12)',
              borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
              borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)',
              flexDirection: 'row', alignItems: 'center', gap: 4,
            }}>
              <Feather name="lock" size={9} color="#F59E0B" />
              <Text style={{ color: '#B45309', fontSize: 10, fontWeight: '800' }}>Private</Text>
            </View>
          )}
        </View>
      </View>
    </ScalePress>
  );
}
