import { useRef, useEffect, useState } from 'react';
import { View, Animated, PanResponder, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

/* ─────────────────────── Floating Music Icon ─────────────────────── */

/**
 * FloatingMusicIcon — draggable music button, big-app style (2026-10-25).
 * Shows while room music is playing/paused. Drag it anywhere on the
 * display; the spot is remembered per device. A tap (not a drag) opens
 * the music modal (song change, on/off, volume). Position is clamped so
 * the icon can never be dragged off-screen.
 */
const SIZE = 56;
const MARGIN = 8;
const POS_KEY = 'vee_music_icon_pos_v1';

export function FloatingMusicIcon({
  paused, onPress,
}: {
  paused: boolean;
  onPress: () => void;
}) {
  const win = Dimensions.get('window');
  const [ready, setReady] = useState(false);
  const pan = useRef(new Animated.ValueXY({ x: win.width - SIZE - 16, y: win.height - 280 })).current;
  const posRef = useRef({ x: win.width - SIZE - 16, y: win.height - 280 });
  const startRef = useRef({ x: 0, y: 0 });
  const dimsRef = useRef({ w: win.width, h: win.height });

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(POS_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { x: number; y: number };
          const x = Math.min(Math.max(MARGIN, saved.x || 0), dimsRef.current.w - SIZE - MARGIN);
          const y = Math.min(Math.max(MARGIN, saved.y || 0), dimsRef.current.h - SIZE - MARGIN);
          posRef.current = { x, y };
          pan.setValue({ x, y });
        }
      } catch {
        // keep default position
      } finally {
        setReady(true);
      }
    })();
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      dimsRef.current = { w: window.width, h: window.height };
      const x = Math.min(Math.max(MARGIN, posRef.current.x), window.width - SIZE - MARGIN);
      const y = Math.min(Math.max(MARGIN, posRef.current.y), window.height - SIZE - MARGIN);
      posRef.current = { x, y };
      pan.setValue({ x, y });
    });
    return () => sub.remove();
  }, [pan]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, gs) => Math.abs(gs.dx) + Math.abs(gs.dy) > 2,
      onPanResponderGrant: () => {
        startRef.current = { ...posRef.current };
      },
      onPanResponderMove: (_e, gs) => {
        const x = Math.min(
          Math.max(MARGIN, startRef.current.x + gs.dx),
          dimsRef.current.w - SIZE - MARGIN,
        );
        const y = Math.min(
          Math.max(MARGIN, startRef.current.y + gs.dy),
          dimsRef.current.h - SIZE - MARGIN,
        );
        posRef.current = { x, y };
        pan.setValue({ x, y });
      },
      onPanResponderRelease: (_e, gs) => {
        if (Math.abs(gs.dx) + Math.abs(gs.dy) < 10) {
          onPress();
          return;
        }
        AsyncStorage.setItem(POS_KEY, JSON.stringify(posRef.current)).catch(() => {});
      },
    }),
  ).current;

  if (!ready) return null;

  return (
    <Animated.View
      {...responder.panHandlers}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: SIZE,
        height: SIZE,
        zIndex: 999,
        transform: [{ translateX: pan.x }, { translateY: pan.y }],
      }}>
      <View
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          backgroundColor: '#7C3AED',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: '#FFFFFF',
          elevation: 6,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 4,
        }}>
        <Feather name="music" size={24} color="#FFFFFF" />
        <View
          style={{
            position: 'absolute',
            right: 2,
            bottom: 2,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: paused ? '#F59E0B' : '#22C55E',
            borderWidth: 2,
            borderColor: '#FFFFFF',
          }}
        />
      </View>
    </Animated.View>
  );
}
