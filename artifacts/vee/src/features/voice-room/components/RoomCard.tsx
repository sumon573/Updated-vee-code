// 2026-10-26 (boss: app must run smooth for every user, no lag): room
// covers used uncached RN Image — every voice-tab mount re-downloaded
// and re-decoded all covers. expo-image memory-disk cache fixes that;
// covers now survive restarts and re-renders without re-fetching.
import { memo, useState, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { LockIcon } from '@/src/components/LockIcon';
import { VoiceRoom } from '../types/room';

// 2026-10-23 (Sumon): tiles slimmed down + flat — no glow shadow, just a
// hairline border, so the My Rooms row looks clean and light.
const SIZE = 68;

// 2026-11-11 (boss, room role badge): the role is recognised by the 👤
// ICON in the bottom-left corner of the tile — never by text ("লেখা না
// আইকন এ চেনা যাবে"). Colours are the polished members-list colours
// (RoomInfoModal roleColor / RoomMembersModal RoleIcon, boss 18:46
// reference): GOLD = room owner ONLY, BLUE = admin, GREY = regular member
// ("মেম্বার সাধারণ"). The icon is a clean vector (Feather "user"), never
// a raw 👤 emoji glyph. Do NOT name this RoleBadge — that was the deleted
// text pill (Live Audience redesign).
const ROLE_ICON_GOLD = '#FFB300';
const ROLE_ICON_BLUE = '#42A5F5';
const ROLE_ICON_GREY = '#8A8A8E';

export type StripRole = 'owner' | 'admin' | 'member';

const ROLE_ICON_COLOR: Record<StripRole, string> = {
  owner: ROLE_ICON_GOLD,
  admin: ROLE_ICON_BLUE,
  member: ROLE_ICON_GREY,
};

// The role badge: a 22px white circle (reads on ANY cover) + the 15px
// Feather "user" in the role colour, at the bottom-left corner of the
// cover (left: 6, bottom: 6 — the exact spot the boss marked, same 6px
// inset as the count pill on the opposite corner).
function TileRoleIcon({ role }: { role: StripRole }) {
  return (
    <View style={{
      position: 'absolute', left: 6, bottom: 6,
      width: 22, height: 22, borderRadius: 11,
      backgroundColor: '#FFFFFF',
      borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.30, shadowRadius: 3, elevation: 2,
    }}>
      <Feather name="user" size={15} color={ROLE_ICON_COLOR[role]} />
    </View>
  );
}

type Props = { room: VoiceRoom; onPress?: () => void; liveCount?: number; role?: StripRole };

// Perf (2026-10-22 audit): memoized — VoiceRoomHome passes stable room
// objects + stable press handlers, so cards re-render only when their own
// room's visible data or live count changes.
export default memo(function RoomCard({ room, onPress, liveCount, role }: Props) {
  // 2026-10-26 (weak network): a failed cover load used to leave blank
  // space until remount. Fall back to the mic placeholder, and retry on
  // the next feed refresh (URL change resets the failure).
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [room.coverImageUrl]);
  const previews = room.memberPreviews?.slice(0, 4) ?? [];

  return (
    <Pressable onPress={onPress}>
      <View style={{ width: 82, marginRight: 8 }}>
        <View style={{
          width: SIZE, height: SIZE, borderRadius: 16,
          backgroundColor: room.themeColor,
          alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)',
        }}>
          {room.coverImageUrl && !imgFailed ? (
            <Image
              source={{ uri: room.coverImageUrl }}
              style={{ position: 'absolute', width: SIZE, height: SIZE }}
              contentFit="cover"
              cachePolicy="memory-disk"
              onError={() => setImgFailed(true)}
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

          {/* Member DPs row — TOP left (2026-11-11: moved from bottom-left
              so the role badge owns the corner the boss marked). */}
          {previews.length > 0 && (
            <View style={{
              position: 'absolute', left: 6, top: 6,
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

          {/* Role badge — bottom left, the corner the boss marked
              (2026-11-11). Only when the role is resolved; an unknown
              role shows NO badge (never a wrong one). */}
          {role !== undefined && <TileRoleIcon role={role} />}

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

        {/* Name — private rooms carry Vee's own gold lock (LockIcon),
            never the demo emoji. Position/size/gold family unchanged. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          {room.isPublic === false && (
            <View style={{ marginRight: 3 }}>
              <LockIcon size={13} />
            </View>
          )}
          <Text numberOfLines={1} ellipsizeMode="tail" style={{
            color: '#000000', fontSize: 13, fontWeight: '800', flex: 1,
          }}>
            {room.name}
          </Text>
        </View>

      </View>
    </Pressable>
  );
});
