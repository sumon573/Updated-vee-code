// 2026-10-26 (boss: app must run smooth for every user, no lag): room
// covers used uncached RN Image — every voice-tab mount re-downloaded
// and re-decoded all covers. expo-image memory-disk cache fixes that;
// covers now survive restarts and re-renders without re-fetching.
import { memo, useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import ScalePress from '@/components/ScalePress';
import { LockIcon } from '@/src/components/LockIcon';
import { VoiceRoom } from '../types/room';

// 2026-10-23 (Sumon): tiles slimmed down + flat — no glow shadow, just a
// hairline border, so the My Rooms row looks clean and light.
const SIZE = 68;

type Props = { room: VoiceRoom; onPress?: () => void; liveCount?: number };

// Perf (2026-10-22 audit): memoized — VoiceRoomHome passes stable room
// objects + stable press handlers, so cards re-render only when their own
// room's visible data or live count changes.
export default memo(function RoomCard({ room, onPress, liveCount }: Props) {
  // 2026-10-26 (weak network): a failed cover load used to leave blank
  // space until remount. Fall back to the mic placeholder, and retry on
  // the next feed refresh (URL change resets the failure).
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [room.coverImageUrl]);
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

        {/* Name — private rooms carry Vee's own gold lock (LockIcon),
            never the demo emoji. Position/size/gold family unchanged. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          {room.isPublic === false && (
            <View style={{ marginRight: 3 }}>
              <LockIcon size={13} />
            </View>
          )}
          <Text numberOfLines={1} style={{
            color: '#000000', fontSize: 13, fontWeight: '800', flex: 1,
          }}>
            {room.name}
          </Text>
        </View>

      </View>
    </ScalePress>
  );
});
