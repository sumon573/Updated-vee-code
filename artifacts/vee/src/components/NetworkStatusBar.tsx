/**
 * NetworkStatusBar (NOTE 5, 2026-10-11) — IMO-style connectivity indicator.
 *
 * Mounted globally (app/_layout.tsx) so it is visible on every screen.
 * - Offline:      spinner + "Waiting for network..."
 * - Reconnecting: spinner + "Reconnecting..."
 * - Just back:    check + "Connected" (flashes ~2.5s, then hides)
 * - Connected:    hidden
 *
 * Renders nothing when the connection is healthy — zero visual noise.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import {
  subscribeNetworkStatus,
  type NetworkState,
} from '@/src/services/networkService';

const CONNECTED_FLASH_MS = 2500;

export default function NetworkStatusBar() {
  const [state, setState] = useState<NetworkState>('connected');
  const [showConnectedFlash, setShowConnectedFlash] = useState(false);
  const slideAnim = useRef(new Animated.Value(80)).current;
  const insets = useSafeAreaInsets();
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let hadProblem = false;
    const unsub = subscribeNetworkStatus((s) => {
      setState(s);
      if (s === 'connected') {
        // Brief "Connected" confirmation only when recovering from a problem
        // state — not on cold start (avoids noise on every app open).
        if (hadProblem) {
          setShowConnectedFlash(true);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setShowConnectedFlash(false), CONNECTED_FLASH_MS);
        }
        hadProblem = false;
      } else {
        hadProblem = true;
        setShowConnectedFlash(false);
        if (flashTimer.current) {
          clearTimeout(flashTimer.current);
          flashTimer.current = null;
        }
      }
    });
    return () => {
      unsub();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const visible = state !== 'connected' || showConnectedFlash;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : 80,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible, slideAnim]);

  if (!visible) return null;

  const isProblem = state !== 'connected';
  const label =
    state === 'offline'
      ? 'Waiting for network...'
      : state === 'reconnecting'
        ? 'Reconnecting...'
        : 'Connected';

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        transform: [{ translateY: slideAnim }],
        zIndex: 998,
        elevation: 12,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isProblem ? '#1C1C1E' : '#1F9D55',
          paddingTop: 9,
          paddingBottom: Math.max(insets.bottom, 9),
        }}
      >
        {isProblem ? (
          <ActivityIndicator
            size="small"
            color="#FFFFFF"
            style={{ marginRight: 8, transform: [{ scale: 0.7 }] }}
          />
        ) : (
          <Feather name="check-circle" size={14} color="#FFFFFF" style={{ marginRight: 7 }} />
        )}
        <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}
