/**
 * CallMinimizeBar — IMO-style floating "Calling" badge (2026-10-10).
 * Shows when a call is minimized: green pill with phone icon, remote name,
 * and live calling duration. Tap to return to the call screen.
 */
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  subscribeMinimizedCall,
  getMinimizedCall,
  type MinimizedCall,
} from '../services/callMinimizeStore';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function CallMinimizeBar() {
  const router = useRouter();
  const [call, setCall] = useState<MinimizedCall | null>(() => getMinimizedCall());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const unsub = subscribeMinimizedCall(setCall);
    return unsub;
  }, []);

  useEffect(() => {
    if (!call) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [call]);

  if (!call) return null;

  return (
    <TouchableOpacity
      onPress={() => {
        // Return to the call — clear minimized state first
        const { setMinimizedCall } = require('../services/callMinimizeStore');
        const params = call.params;
        setMinimizedCall(null);
        router.push({
          pathname: '/audio-call',
          params: {
            roomId: params.roomId,
            role: params.role,
            ...(params.calleeUid ? { calleeUid: params.calleeUid } : {}),
            ...(params.remoteUid ? { remoteUid: params.remoteUid } : {}),
            ...(params.remoteName ? { remoteName: params.remoteName } : {}),
            returning: 'true', // flag: rejoining minimized call, don't re-init
          },
        });
      }}
      activeOpacity={0.8}
      style={{
        position: 'absolute',
        left: 0,
        top: 120,
        zIndex: 9999,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#22C55E',
        borderTopRightRadius: 20,
        borderBottomRightRadius: 20,
        paddingVertical: 10,
        paddingLeft: 12,
        paddingRight: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 8,
      }}
    >
      <Ionicons name="call" size={20} color="#fff" />
      <View style={{ marginLeft: 8 }}>
        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }} numberOfLines={1}>
          {call.remoteName}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11 }}>
          {formatDuration(now - call.startedAt)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
