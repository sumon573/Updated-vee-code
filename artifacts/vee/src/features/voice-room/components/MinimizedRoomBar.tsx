import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View, Platform, Image, PanResponder, Dimensions } from 'react-native';
import { router, usePathname, useGlobalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  getMinimizedRoom,
  setMinimizedRoom,
  subscribeMinimizedRoom,
  type MinimizedRoom,
} from '@/src/store/minimizedRoom';
import { destroyPersistedVoiceRoomEngine, togglePersistedVoiceRoomMic, setPersistedVoiceRoomMic, getPersistedVoiceRoomMuted } from '../useLivekitVoiceRoom';
import { removeSeat, leaveAudience, refreshSeatHeartbeat, getSeatHostMuted } from '@/src/features/voice-room/services/firebaseRoomService';
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
  const insets = useSafeAreaInsets();

  // Default: above the bottom nav. Hosts rendered inside a full-screen
  // modal (the rooms list) have no tab bar beneath them, so they pass a
  // small override — a bar mounted in the root layout is COVERED by an
  // RN Modal, which is why a second instance lives inside that modal
  // (2026-10-22, Sumon: minimize bar invisible on the My Rooms screen).
  const bottomOffset = bottomOffsetOverride ??
    (Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 0) + 80);

  useEffect(() => {
    const unsub = subscribeMinimizedRoom((r) => {
      setRoom(r);
    });
    return unsub;
  }, []);

  // 2026-10-25 (boss, imo-style minimize bubble): a free-draggable round
  // room DP with a 4-bar voice ripple below it, replacing the old bottom
  // bar. The bubble stays where dropped (no snap-back) and the position
  // is saved to the minimized-room store so the modal instance agrees.
  const BUBBLE_W = 72;
  const BUBBLE_H = 120;
  const defaultPos = () => {
    const { width: W, height: H } = Dimensions.get('window');
    const s = getMinimizedRoom();
    return {
      x: s?.bubbleX ?? (W - 16 - 64),
      y: s?.bubbleY ?? (H - bottomOffset - BUBBLE_H),
    };
  };
  const initialPosRef = useRef(defaultPos());
  const pan = useRef(new Animated.ValueXY(initialPosRef.current)).current;
  const posRef = useRef({ ...initialPosRef.current });
  // Drag: taps pass through to the buttons (threshold), drags move the
  // bubble; on release clamp on-screen + save to the store.
  const dragStart = useRef({ x: 0, y: 0 });
  const finishDrag = () => {
    const { width: W, height: H } = Dimensions.get('window');
    const cx = Math.min(Math.max(posRef.current.x, 8), W - BUBBLE_W);
    const cy = Math.min(Math.max(posRef.current.y, insets.top + 8), H - BUBBLE_H);
    posRef.current = { x: cx, y: cy };
    Animated.spring(pan, { toValue: { x: cx, y: cy }, useNativeDriver: false }).start();
    const r = getMinimizedRoom();
    if (r) setMinimizedRoom({ ...r, bubbleX: cx, bubbleY: cy });
  };
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, gs) => Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4,
      onPanResponderGrant: () => {
        dragStart.current = { ...posRef.current };
      },
      onPanResponderMove: (_e, gs) => {
        const nx = dragStart.current.x + gs.dx;
        const ny = dragStart.current.y + gs.dy;
        posRef.current = { x: nx, y: ny };
        pan.setValue({ x: nx, y: ny });
      },
      onPanResponderRelease: finishDrag,
      onPanResponderTerminate: finishDrag,
    }),
  ).current;

  // Entrance: pop in (scale spring) when a room becomes minimized.
  const enterScale = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    if (!room) return;
    enterScale.setValue(0.6);
    Animated.spring(enterScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
  }, [room?.id]);

  // Voice ripple: 4 bars looping up/down — the "voice is live" vibe
  // (boss 2026-10-25, imo reference). Runs while minimized+connected.
  const RIPPLE_MIN = [5, 7, 4, 6];
  const RIPPLE_MAX = [16, 13, 15, 12];
  const RIPPLE_DUR = [520, 680, 600, 760];
  const ripples = useRef(RIPPLE_MIN.map((m) => new Animated.Value(m))).current;
  useEffect(() => {
    if (!room) return;
    const anims = ripples.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: RIPPLE_MAX[i], duration: RIPPLE_DUR[i], useNativeDriver: false }),
          Animated.timing(v, { toValue: RIPPLE_MIN[i], duration: RIPPLE_DUR[i], useNativeDriver: false }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [room?.id]);

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
    // 2026-10-24 (boss: host-mute must stick): the minimized bar's mic
    // button must not unmute a host-muted member either — check the
    // seat's hostMuted flag first and force muted if it is set.
    const r0 = getMinimizedRoom();
    if (r0 && r0.mySeatIdx >= 0) {
      const hostMuted = await getSeatHostMuted(r0.id, r0.mySeatIdx).catch(() => false);
      if (hostMuted) {
        await setPersistedVoiceRoomMic(true);
        setMicMuted(true);
        setMinimizedRoom({ ...r0, muted: true });
        return;
      }
    }
    const newMuted = await togglePersistedVoiceRoomMic();
    setMicMuted(newMuted);
    const r = getMinimizedRoom();
    if (r) setMinimizedRoom({ ...r, muted: newMuted });
  };

  if (!room) return null;

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

  // imo-style bubble (2026-10-25): round room DP, draggable anywhere,
  // 4-bar voice ripple below, room-name pill. Tap DP or name = return to
  // the room; mic badge toggles mic; X badge exits the room entirely.
  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: enterScale }],
        alignItems: 'center',
        zIndex: 999,
      }}
    >
      {/* Room DP — tap = return to room */}
      <Pressable onPress={handleReturn}>
        <View
          style={{
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: C.primary + '33',
            borderWidth: 2,
            borderColor: C.border,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'visible',
            shadowColor: C.glow,
            shadowOpacity: 0.45,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 4 },
            elevation: 14,
          }}
        >
          {room.coverImageUrl ? (
            <Image
              source={{ uri: room.coverImageUrl }}
              style={{ width: 56, height: 56, borderRadius: 28 }}
              resizeMode="cover"
            />
          ) : (
            <Feather name="mic" size={22} color={C.muted} />
          )}
          {/* Mic badge — tap toggles mic without returning */}
          <Pressable
            onPress={handleMicToggle}
            hitSlop={8}
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: C.bg,
              borderWidth: 1.5,
              borderColor: C.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name={micMuted ? 'mic-off' : 'mic'} size={11} color={micColor} />
          </Pressable>
          {/* Close badge — fully exits the minimized room */}
          <Pressable
            onPress={handleClose}
            hitSlop={8}
            style={{
              position: 'absolute',
              right: -2,
              top: -2,
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: C.bg,
              borderWidth: 1.5,
              borderColor: C.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="x" size={11} color={C.muted} />
          </Pressable>
        </View>
      </Pressable>

      {/* Voice ripple — 4 bars looping up/down (voice-is-live vibe) */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 3,
          height: 16,
          marginTop: 6,
        }}
      >
        {ripples.map((a, i) => (
          <Animated.View
            key={i}
            style={{ width: 3, height: a, borderRadius: 2, backgroundColor: C.glow }}
          />
        ))}
      </View>

      {/* Room name pill — tap = return to room */}
      <Pressable onPress={handleReturn}>
        <View
          style={{
            marginTop: 4,
            maxWidth: 110,
            backgroundColor: 'rgba(15,10,30,0.85)',
            borderRadius: 10,
            borderWidth: 1,
            borderColor: C.border,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text
            style={{ color: C.text, fontSize: 11, fontWeight: '800', textAlign: 'center' }}
            numberOfLines={1}
          >
            {room.name}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
