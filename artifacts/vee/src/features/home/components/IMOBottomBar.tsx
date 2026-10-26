/**
 * IMOBottomBar — IMO-style bottom bar (2026-10-10, restored 2026-10-26).
 * "+" (left, blue) and search icon (right, blue).
 *
 * 2026-10-26 (boss: imo "Connecting..." exactly): the CENTER shows the
 * connection status, imo-exact — when the device is offline, or the
 * Firebase socket is down after a working connection, the bar shows
 * "Connecting..." in the middle and a green dot on the "+" (exactly as in
 * his 10:19 screenshot). When connected, the center is empty and there is
 * no dot (his 10:10 screenshot). Cold-start socket handshake never
 * flashes: 'reconnecting' counts only after a real connection existed;
 * 'offline' (no internet at all) always counts. Same networkService signal
 * the old NetworkStatusBar overlay used — the overlay itself is gone from
 * home, the bottom bar IS the status surface now.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  subscribeNetworkStatus } from '@/src/services/networkService';

interface IMOBottomBarProps {
  onAddPress: () => void;
  onSearchPress: () => void;
}

export default function IMOBottomBar({ onAddPress, onSearchPress }: IMOBottomBarProps) {
  const [connecting, setConnecting] = useState(false);
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    const unsub = subscribeNetworkStatus((s) => {
      if (s === 'connected') {
        wasConnectedRef.current = true;
        setConnecting(false);
      } else if (s === 'offline' || wasConnectedRef.current) {
        // 'offline' = no internet at all (counts even on cold start);
        // 'reconnecting' counts only after a working connection, so the
        // normal cold-start handshake never flashes "Connecting...".
        setConnecting(true);
      }
    });
    return unsub;
  }, []);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: '#E0E0E0',
      }}
    >
      <TouchableOpacity onPress={onAddPress} activeOpacity={0.7}>
        <View>
          <Ionicons name="add" size={32} color="#2196F3" />
          {connecting && (
            <View
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: '#4CAF50',
              }}
            />
          )}
        </View>
      </TouchableOpacity>
      <View style={{ flex: 1, alignItems: 'center' }}>
        {connecting && (
          <Text style={{ fontSize: 17, color: '#000000' }}>Connecting...</Text>
        )}
      </View>
      <TouchableOpacity onPress={onSearchPress} activeOpacity={0.7}>
        <Ionicons name="search" size={26} color="#2196F3" />
      </TouchableOpacity>
    </View>
  );
}
