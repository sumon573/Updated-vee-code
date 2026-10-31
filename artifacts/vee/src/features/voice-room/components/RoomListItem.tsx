/**
 * RoomListItem — recommended/trending room card (LIGHT MODE).
 *
 * 2026-10-09 fix: this component still used dark-theme colors while
 * VoiceRoomHome is light — room name and topic were invisible (white on
 * white). All colors below are verified visible on light backgrounds.
 *
 * Shows: cover tile, room name (readable), topic, live member
 * count, and up to 6 real member DPs (photoURL, falling back to initials).
 */

// 2026-10-26 (boss: app must run smooth for every user, no lag): room
// covers + member DPs used uncached RN Image — every voice-tab mount
// re-downloaded and re-decoded them. expo-image memory-disk cache
// fixes that; art now survives restarts without re-fetching.
import { memo, useState, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
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

type Props = { room: VoiceRoom; onPress?: () => void; distanceKm?: number; liveCount?: number; hideLiveBadge?: boolean };

/** Format distance: < 1km shows meters, else km with 1 decimal. */
function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}

// Perf (2026-10-22 audit): memoized — see RoomCard note.
// Fix #30 effect (boss 2026-10-30 01:16): LIVE badge removed —
// hideLiveBadge stays in Props so existing call sites type-check,
// but it is now a no-op (badge JSX deleted below).
export default memo(function RoomListItem({ room, onPress, distanceKm, liveCount }: Props) {
  // 2026-10-26 (weak network): same failed-cover fallback as RoomCard.
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [room.coverImageUrl]);
  const { t } = useTranslation();
  const previews = room.memberPreviews?.slice(0, MAX_DP) ?? [];
  const isPrivate = room.isPublic === false;
  // 2026-10-11 Issue #1: show the TRUE live audience (everyone who entered,
  // seat not required) — never the stale cached seat-only count.

  // 2026-10-31 (boss: room page EXACTLY like imo): completely flat —
  // no scale press, no shadow, no float. The card sits on the
  // background with only a hairline border, like imo.
  return (
    <Pressable onPress={onPress}>
      <View style={{
        borderRadius: 14, padding: 12, marginBottom: 10,
        backgroundColor: C.surface,
        borderWidth: 1, borderColor: C.border,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* Room cover tile */}
          <View style={{
            width: 44, height: 44, borderRadius: 12,
            backgroundColor: room.themeColor,
            alignItems: 'center', justifyContent: 'center',
            marginRight: 12, overflow: 'hidden',
          }}>
            {room.coverImageUrl && !imgFailed ? (
              <Image
                source={{ uri: room.coverImageUrl }}
                style={{ width: 44, height: 44 }}
                contentFit="cover"
                cachePolicy="memory-disk"
                onError={() => setImgFailed(true)}
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
              <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: C.text, fontSize: 16, fontWeight: '800', flex: 1 }}>
                {room.name}
              </Text>
              {/* imo-style member count pill, top-right (replaces the
                  members line under the name). */}
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                backgroundColor: '#F2F2F7', borderRadius: 999,
                paddingHorizontal: 8, paddingVertical: 3,
              }}>
                <Feather name="users" size={11} color={C.muted} />
                <Text style={{ color: C.text, fontSize: 12, fontWeight: '700' }}>
                  {liveCount ?? room.liveCount ?? room.memberCount}
                </Text>
              </View>
              {/* Nearby distance (2026-10-11): REAL owner distance from viewer */}
              {distanceKm !== undefined && (
                <Text style={{ color: '#7C3AED', fontSize: 11, fontWeight: '700', marginLeft: 6 }}>
                  {formatDistance(distanceKm)}
                </Text>
              )}
            </View>
          </View>

          {/* Fix #30 effect (boss 2026-10-30 01:16): LIVE badge REMOVED
              from Recommended cards. The held VoiceRoomHome call site already
              passes hideLiveBadge, but the phone never received it — deleting
              the pill here delivers the removal now. NOTE: RoomListItem's only
              other usage is the room-ID search list, which also loses the badge
              (no per-site signal exists without the held file); restore via
              the prop if the boss wants search badges back. Members count,
              topic, avatars untouched. */}
        </View>

        {/* Topic as plain text (imo): no banner chip, just the line. */}
        {!!room.topic && (
          <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: C.sub, fontSize: 14, fontWeight: '600', marginTop: 8 }}>
            {room.topic}
          </Text>
        )}

        {/* Bottom row: real member DPs (up to 6) + private badge */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          {previews.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {previews.map((p, i) =>
                p.photoURL ? (
                  <Image
                    key={i}
                    source={{ uri: p.photoURL }}
                    cachePolicy="memory-disk"
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
                    +{(liveCount ?? room.memberCount) - previews.length}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <Text style={{ color: C.muted, fontSize: 12 }}>
              {t('voiceRoom.listItem.members', { count: liveCount ?? room.liveCount ?? room.memberCount })}
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
    </Pressable>
  );
});
