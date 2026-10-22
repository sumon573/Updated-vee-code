import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View, Platform, Image } from 'react-native';
import { router, usePathname, useGlobalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  getMinimizedRoom,
  setMinimizedRoom,
  subscribeMinimizedRoom,
  type MinimizedRoom,
} from '@/src/store/minimizedRoom';
import { destroyPersistedVoiceRoomEngine, togglePersistedVoiceRoomMic, getPersistedVoiceRoomMuted } from '../useLivekitVoiceRoom';
import { removeSeat, leaveAudience, refreshSeatHeartbeat } from '@/src/features/voice-room/services/firebaseRoomService';
import { clearPersistedActiveRoom } from '@/src/store/activeRoom';

const C = {
  bg: '#0F0A1E',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  text: '#FFFFFF',
  muted: '#B8A6D9',
  border: 'rgba(139,92,246,0.35)',
  micOn: '#22C55E',
  micOff: '#EF4444',
} as const;

export default function MinimizedRoomBar({ bottomOffsetOverride }: { bottomOffsetOverride?: number } = {}) {
  const [room, setRoom] = useState<MinimizedRoom>(getMinimizedRoom());
  // 2026-10-16 (Sumon): detect the stuck case — bar floating over the
  // exited room screen after a cold-start auto-return (no back stack).
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const slideAnim = useRef(new Animated.Value(100)).current;
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  useEffect(() => {
    const unsub = subscribeMinimizedRoom((r) => {
      setRoom(r);
      if (r) {
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          speed: 14,
          bounciness: 6,
        }).start();
      } else {
        Animated.timing(slideAnim, {
          toValue: 100,
          duration: 200,
          useNativeDriver: true,
        }).start();
      }
    });
    return unsub;
  }, []);

  // 2026-10-12: room-block while minimized — tear down the minimized
  // session. Without this a blocked-while-minimized user would keep the
  // mini-player and a live mic after being removed from the room.
  useEffect(() => {
    if (!room?.id || !room?.myUid) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        if (cancelled) return;
        unsub = onValue(
          ref(database, `roomBlocks/${room.id}/${room.myUid}`),
          (snap) => {
            const v = snap.val() as { action?: string } | null;
            if (v && v.action === 'room-block') {
              try { destroyPersistedVoiceRoomEngine(); } catch { /* non-critical */ }
              setMinimizedRoom(null);
            }
          },
        );
      } catch { /* non-critical */ }
    })();
    return () => {
      cancelled = true;
      try { unsub?.(); } catch { /* non-critical */ }
    };
  }, [room?.id, room?.myUid]);

  // P1 fix (2026-10-12): disband while minimized — tear down. Without this,
  // if the owner closes the room while we're minimized, the bar lingers and
  // the persisted LiveKit engine keeps audio alive in a dead room.
  useEffect(() => {
    if (!room?.id) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        if (cancelled) return;
        unsub = onValue(
          ref(database, `rooms/${room.id}/info`),
          (snap) => {
            const v = snap.val() as { active?: boolean } | null;
            if (!v || v.active === false) {
              try { destroyPersistedVoiceRoomEngine(); } catch { /* non-critical */ }
              setMinimizedRoom(null);
            }
          },
        );
      } catch { /* non-critical */ }
    })();
    return () => {
      cancelled = true;
      try { unsub?.(); } catch { /* non-critical */ }
    };
  }, [room?.id]);

  // 2026-10-13 (HIGH fix): মিনিমাইজ অবস্থায়ও সিট heartbeat চালু রাখো।
  // VoiceRoomScreen unmount হলে heartbeat বন্ধ হয়ে যেত — ৫ মিনিট পর অন্যের
  // sweepStaleSeats সিট মুছে দিত, অথচ LiveKit অডিও চালু থাকত (ghost mic +
  // হারানো সিট)। এখন mini-player নিজেই প্রতি ৬০ সেকেন্ডে beat পাঠায়।
  useEffect(() => {
    if (!room?.id || !room?.myUid || room.mySeatIdx < 0) return;
    const rid = room.id;
    const uid = room.myUid;
    const idx = room.mySeatIdx;
    const beat = () => refreshSeatHeartbeat(rid, idx, uid).catch(() => {});
    beat();
    const timer = setInterval(beat, 60_000);
    return () => clearInterval(timer);
  }, [room?.id, room?.myUid, room?.mySeatIdx]);

  // 2026-10-14 (Sumon): Ghost mic fix — seat Firebase থেকে মুছে গেলে
  // (sweep/kick/disconnect) engine destroy করো। না হলে mic background-এ চলতে থাকে।
  useEffect(() => {
    if (!room?.id || !room?.myUid || room.mySeatIdx < 0) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        if (cancelled) return;
        unsub = onValue(
          ref(database, `rooms/${room.id}/seats/${room.mySeatIdx}`),
          (snap) => {
            const seat = snap.val();
            // Seat gone or taken by someone else → destroy engine
            if (!seat || (seat.id && seat.id !== room.myUid && seat.uid !== room.myUid)) {
              try { destroyPersistedVoiceRoomEngine(); } catch { /* non-critical */ }
              setMinimizedRoom(null);
            }
          },
        );
      } catch { /* non-critical */ }
    })();
    return () => {
      cancelled = true;
      try { unsub?.(); } catch { /* non-critical */ }
    };
  }, [room?.id, room?.myUid, room?.mySeatIdx]);

  // Mic toggle for minimized room (2026-10-10): talk/mute while minimized.
  // NOTE: Hooks MUST stay before the `if (!room) return null` below (React Rules).
  const [micMuted, setMicMuted] = useState<boolean>(() => getMinimizedRoom()?.muted ?? true);
  useEffect(() => {
    setMicMuted(room?.muted ?? getPersistedVoiceRoomMuted());
  }, [room?.muted]);
  const handleMicToggle = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newMuted = await togglePersistedVoiceRoomMic();
    setMicMuted(newMuted);
    const r = getMinimizedRoom();
    if (r) setMinimizedRoom({ ...r, muted: newMuted });
  };

  if (!room) return null;

  // Default: above the bottom nav. Hosts rendered inside a full-screen
  // modal (the rooms list) have no tab bar beneath them, so they pass a
  // small override — a bar mounted in the root layout is COVERED by an
  // RN Modal, which is why a second instance lives inside that modal
  // (2026-10-22, Sumon: minimize bar invisible on the My Rooms screen).
  const bottomOffset = bottomOffsetOverride ??
    (Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 0) + 80);

  const handleReturn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMinimizedRoom(null);
    router.push({ pathname: '/voice-room', params: { roomId: room.id } } as any);
  };

  /**
   * Close (X) button — user is discarding the minimized room entirely.
   * We must:
   *   1. Destroy the persisted LiveKit room so audio actually stops.
   *   2. Remove the user from Firebase (seat or audience) so they don't
   *      appear as a ghost member in the room.
   *   3. Clear the minimized room store.
   */
  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // 1. Tear down LiveKit audio
    destroyPersistedVoiceRoomEngine();
    // 2. Firebase cleanup — remove the user from the room
    // background: safe to swallow — teardown after navigation; server-side presence expires via onDisconnect
    if (room.mySeatIdx >= 0) {
      removeSeat(room.id, room.mySeatIdx).catch(() => {});
      // 2026-10-12 audit fix (HIGH): seated users keep audience record —
      // clean it on discard or it ghosts forever.
      leaveAudience(room.id, room.myUid).catch(() => {});
    } else {
      leaveAudience(room.id, room.myUid).catch(() => {});
    }
    // 2026-10-16 (Sumon): explicit close — clear the persisted active room
    // so a later cold start does NOT auto-return to a room the user exited.
    clearPersistedActiveRoom().catch(() => {});
    // 3. Clear store
    setMinimizedRoom(null);
    // 2026-10-16 (Sumon): cold-start auto-return leaves no back stack, so the
    // bar can end up floating OVER the exited room screen — X then hides the
    // bar but strands the user staring at a dead room ("exit হয় না").
    // In that stuck case, navigate home.
    if (pathname === '/voice-room' && (params as any)?.roomId === room.id) {
      router.replace('/home');
    }
  };

  // Mic indicator color reflects the LIVE muted state (toggleable while minimized)
  const micColor = micMuted ? C.micOff : C.micOn;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        bottom: bottomOffset,
        left: 16,
        right: 16,
        transform: [{ translateY: slideAnim }],
        backgroundColor: C.bg,
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: C.border,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 10,
        shadowColor: C.glow,
        shadowOpacity: 0.45,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 4 },
        elevation: 14,
        zIndex: 999,
      }}
    >
      {/* Room DP (2026-10-11 Issue #3): show the minimized room's profile
          DP where the mute icon was — Sumon's order. */}
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: C.primary + '33',
          borderWidth: 1.5,
          borderColor: C.border,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 10,
          overflow: 'hidden',
        }}
      >
        {room.coverImageUrl ? (
          <Image
            source={{ uri: room.coverImageUrl }}
            style={{ width: 36, height: 36 }}
            resizeMode="cover"
          />
        ) : (
          <Feather name="mic" size={16} color={C.muted} />
        )}
      </View>

      {/* Room info — name with mute/unmute status beside it (2026-10-11) */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            style={{ color: C.text, fontSize: 13, fontWeight: '800', flexShrink: 1 }}
            numberOfLines={1}
          >
            {room.name}
          </Text>
          {/* Mute/unmute status — tap to toggle while minimized */}
          <Pressable onPress={handleMicToggle} hitSlop={10}>
            <Feather
              name={micMuted ? 'mic-off' : 'mic'}
              size={13}
              color={micColor}
            />
          </Pressable>
        </View>
        <Text
          style={{ color: C.muted, fontSize: 11, marginTop: 1 }}
          numberOfLines={1}
        >
          {room.topic}
        </Text>
      </View>

      {/* Return button */}
      <Pressable
        onPress={handleReturn}
        style={{
          backgroundColor: C.primary,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 7,
          marginRight: 8,
        }}
      >
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{t('voiceRoom.minimizedBar.return')}</Text>
      </Pressable>

      {/* Close — fully exits the minimized room */}
      <Pressable onPress={handleClose} hitSlop={12}>
        <Feather name="x" size={18} color={C.muted} />
      </Pressable>
    </Animated.View>
  );
}
