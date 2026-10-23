import { memo, useState, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { C } from '../constants/theme';
import { Participant, SeatReaction } from '../types/room';
import { Avatar } from './Avatar';
import SeatEmojiReaction from './SeatEmojiReaction';
import { getOfficialBadgeIconUrl } from '@/src/services/verifiedService';
import { useVerifiedBadge } from '@/src/hooks/useVerifiedBadge';
import { useActiveFrame } from '@/src/hooks/useActiveFrame';
import { useActiveMicSticker } from '@/src/hooks/useStoreItems';
import { seatName } from '@/src/utils/truncateName';

// 2026-10-13 (Sumon): SERVER-DRIVEN badge — admin panel থেকে change করলে সব app-এ instant update
const FALLBACK_BADGE = require('@/assets/images/vee-badge.png');
let cachedBadgeIcon: string | null | undefined = undefined;
function useServerBadgeIcon() {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    if (cachedBadgeIcon !== undefined) {
      setIcon(cachedBadgeIcon);
      return;
    }
    getOfficialBadgeIconUrl().then((url) => {
      cachedBadgeIcon = url;
      setIcon(url);
    }).catch(() => {
      cachedBadgeIcon = null;
    });
  }, []);
  return icon;
}

/* ─────────────────────────── Seat Card ───────────────────────────
   2026-10-19 (IMO port Phase 1): IMO look —
   - 53dp circles, 5-column grid, 11.5sp seat names
   - Speaking → #05b5fa halo ripple (Avatar)
   - Mic badge bottom-right: white when live, red when muted
   - Empty seat: dashed circle with +
   - HOST: gold gradient pill (#ffe27a→#ffb62e)
   - Occupied: avatar + name + verified badge (unchanged behavior)
   - Locked: lock overlay on empty seats only (unchanged behavior)
   Memoized so a single chat message doesn't re-render all 10 seats. */
// Seat avatar diameter — 2026-10-20 polish (boss): 62 → 53 so the
// 5-across grid breathes instead of seats crowding each other.
const SEAT_SIZE = 53;
export const SeatCard = memo(function SeatCard({
  seatIndex, member, onPress, reaction, isLocked, accentColor, micDecorUrl,
  nameColor, labelColor,
}: {
  seatIndex: number;
  member: Participant | null | undefined;
  onPress: () => void;
  reaction?: SeatReaction;
  isLocked?: boolean;
  accentColor: string;
  /** 2026-10-21 (boss): theme-aware label colors — seat names sit directly
      on the room background, so they follow the active theme (light text
      only on the one black theme). Defaults keep the light look. */
  nameColor?: string;
  labelColor?: string;
  myId?: string;
  /** 2026-10-16 (Sumon): Store-bought room mic decor — shown on the mic dot. */
  micDecorUrl?: string | null;
}) {
  const { t } = useTranslation();
  const seatNum = seatIndex + 1;
  const locked  = isLocked;
  const accent  = accentColor;
  // 2026-10-13 (Sumon): server-driven badge icon
  const serverBadgeIcon = useServerBadgeIcon();
  const badgeSource = serverBadgeIcon ? { uri: serverBadgeIcon } : FALLBACK_BADGE;
  const isOwner = member?.role === 'host';
  // 2026-10-14 (Sumon): LIVE verified check — seat data's verified flag goes stale
  // on revocation (written once at takeSeat, never cleared). Use real-time hook.
  const hasVerifiedBadge = useVerifiedBadge(member?.id);
  // 2026-10-14 (Sumon): BETTER ARCHITECTURE — listen DIRECTLY to users/{uid}/activeFrame
  // in real-time. No stale seat copies, no mapping bugs. Admin changes reflect LIVE.
  // Any future frame automatically works. This is the permanent fix.
  const liveFrameId = useActiveFrame(member?.id);
  // 2026-10-16 (Sumon): Store mic sticker — equipped sticker badge on the seat.
  const micSticker = useActiveMicSticker(member?.id);
  const isAdmin = member?.role === 'admin';

  return (
    <Pressable
      onPress={onPress}
      style={{ alignItems: 'center', width: '100%', paddingVertical: 4, paddingHorizontal: 2 }}
    >
      {/* ── Seat number badge — only on EMPTY seats (2026-10-11: hidden when occupied) ── */}
      {!member && (
        <View style={{
          position: 'absolute', top: 8, left: '14%', zIndex: 10,
          width: 17, height: 17, borderRadius: 8.5,
          backgroundColor: accent,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: accent,
          shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
          elevation: 3,
        }}>
          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>{seatNum}</Text>
        </View>
      )}

      {/* ── Lock badge ── */}
      {/* 2026-10-14 (Sumon): সিটে কেউ বসা থাকলে lock icon দেখাবে না —
          শুধু খালি locked সিটে দেখাবে। */}
      {locked && !member && (
        <View style={{
          position: 'absolute', top: 8, right: '14%', zIndex: 10,
          width: 17, height: 17, borderRadius: 8.5,
          backgroundColor: C.gold + 'DD',
          alignItems: 'center', justifyContent: 'center',
          shadowColor: C.gold, shadowOpacity: 0.5, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
        }}>
          <Feather name="lock" size={8} color="#fff" />
        </View>
      )}

      {member ? (
        /* ── Occupied seat ── */
        <>
          <View style={{
            marginTop: 6, position: 'relative',
            shadowColor: accent,
            shadowOpacity: member.speaking ? 0 : 0.35,
            shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
            elevation: member.speaking ? 0 : 4,
          }}>
            {/* 2026-10-23 (Sumon): the reaction emoji now performs INSIDE
                the DP — big, centered over the avatar on a soft scrim,
                each emoji with its own designed motion (SeatEmojiReaction).
                The old float-up-over-the-DP demo look is gone. */}
            {reaction && (
              <View pointerEvents="none" style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                alignItems: 'center', justifyContent: 'center', zIndex: 20,
              }}>
                <View style={{
                  position: 'absolute',
                  width: SEAT_SIZE, height: SEAT_SIZE, borderRadius: SEAT_SIZE / 2,
                  backgroundColor: 'rgba(0,0,0,0.22)',
                }} />
                <SeatEmojiReaction key={reaction.key} emoji={reaction.emoji} size={37} />
              </View>
            )}
            <Avatar
              initials={member.initials}
              color={member.color}
              size={SEAT_SIZE}
              speaking={member.speaking}
              accent={accent}
              photoURL={member.photoURL}
              frameType={liveFrameId || undefined}
              nobleRankIndex={member.nobleRankIndex}
              activeRipple={(member as any).activeRipple}
            />
            {/* 2026-10-16 (Sumon): Store mic sticker badge — top-right */}
            {micSticker && (
              <Image
                source={{ uri: micSticker.imageUrl }}
                style={{
                  position: 'absolute', top: -4, right: -4, width: 24, height: 24,
                  borderRadius: 12, borderWidth: 1.5, borderColor: '#fff',
                  zIndex: 15,
                }}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={micSticker.itemId}
              />
            )}
            {/* 2026-10-19 (IMO port Phase 1): mic badge — white when live, red
                when muted (IMO). 2026-10-20 (boss): moved bottom-RIGHT →
                bottom-LEFT, because the bottom-right badge covered the
                Official frame's official logo. */}
            <View style={{
              position: 'absolute', bottom: 0, left: 0,
              width: 18, height: 18, borderRadius: 9,
              backgroundColor: member.muted ? C.red : '#FFFFFF',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1.5, borderColor: C.bg,
              shadowColor: member.muted ? C.red : '#000',
              shadowOpacity: 0.5, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
            }}>
              <Feather name={member.muted ? 'mic-off' : 'mic'} size={9} color={member.muted ? '#fff' : '#333'} />
            </View>
            {micDecorUrl && (
              <Image
                source={{ uri: micDecorUrl }}
                style={{
                  position: 'absolute', bottom: -3, left: -3, width: 22, height: 22,
                  zIndex: 16,
                }}
                contentFit="contain"
                cachePolicy="memory-disk"
                recyclingKey={micDecorUrl}
              />
            )}
          </View>

          {/* Name — 2026-10-13 (Sumon): verified badge next to name */}
          {/* 2026-10-14: use live hasVerifiedBadge, not stale (member as any).verified */}
          {/* 2026-10-19 (IMO port Phase 1): 11.5sp seat name (IMO) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 5 }}>
            <Text style={{
              color: nameColor ?? C.text, fontSize: 11.5, fontWeight: '700',
              textAlign: 'center',
            }} numberOfLines={1}>{seatName(member.name)}</Text>
            {hasVerifiedBadge && (
              <Image
                source={badgeSource}
                style={{ width: 12, height: 12, marginLeft: 2 }}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            )}
          </View>

          {/* Role badge — 2026-10-19 (IMO port Phase 1): HOST = gold gradient pill */}
          {isOwner && (
            <LinearGradient
              colors={['#ffe27a', '#ffb62e']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={{
                borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, marginTop: 2,
                shadowColor: '#ffb62e', shadowOpacity: 0.3, shadowRadius: 4,
              }}
            >
              <Text style={{ color: '#5a3c00', fontSize: 8, fontWeight: '900' }}>
                {t('voiceRoom.seatCard.owner')}
              </Text>
            </LinearGradient>
          )}
          {isAdmin && (
            <View style={{
              backgroundColor: accent + '33', borderRadius: 8,
              paddingHorizontal: 7, paddingVertical: 2, marginTop: 2,
              borderWidth: 1, borderColor: accent + '66',
              shadowColor: accent, shadowOpacity: 0.3, shadowRadius: 4,
            }}>
              <Text style={{ color: accent, fontSize: 8, fontWeight: '800' }}>
                {t('voiceRoom.seatCard.admin')}
              </Text>
            </View>
          )}
        </>
      ) : (
        /* ── Empty / locked seat — dashed circle with user-plus
            (pre-IMO-port placeholder visual, restored 2026-10-20 per boss)
            HOST SEAT (2026-10-22, Sumon): seat 1 (index 0) shows "HOST"
            written inside the gold dashed circle while nobody sits there. */
        <>
          <View style={{
            marginTop: 6,
            width: SEAT_SIZE, height: SEAT_SIZE, borderRadius: SEAT_SIZE / 2,
            backgroundColor: locked ? C.gold + '11' : seatNum === 1 ? C.gold + '14' : accent + '0D',
            borderWidth: 1.5,
            borderColor: locked ? C.gold + '55' : seatNum === 1 ? C.gold + '88' : accent + '44',
            borderStyle: 'dashed',
            alignItems: 'center', justifyContent: 'center',
            shadowColor: locked || seatNum === 1 ? C.gold : accent,
            shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
            elevation: 2,
          }}>
            {locked ? (
              <Feather name="lock" size={16} color={C.gold} />
            ) : seatNum === 1 ? (
              <Text style={{ color: C.gold, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 }}>HOST</Text>
            ) : (
              <Feather name="user-plus" size={16} color="#94A3B8" />
            )}
          </View>
          <Text style={{
            color: locked || seatNum === 1 ? C.gold : (labelColor ?? C.muted),
            fontSize: 10, marginTop: 5, fontWeight: '600',
            textAlign: 'center',
          }} numberOfLines={1}>
            {locked
              ? t('voiceRoom.seatCard.locked')
              : seatNum === 1
                ? t('voiceRoom.seatCard.host')
                : t('voiceRoom.seatCard.empty')}
          </Text>
        </>
      )}
    </Pressable>
  );
});
