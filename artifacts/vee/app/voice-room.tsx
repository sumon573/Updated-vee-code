import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorFallback, ErrorFallbackProps } from '@/components/ErrorFallback';
import { clearPersistedActiveRoom } from '@/src/store/activeRoom';
import VoiceRoomScreen from '@/src/features/voice-room/screens/VoiceRoomScreen';

/**
 * Route wrapper — an ErrorBoundary here keeps a voice-room render crash
 * (e.g. malformed seat/room data) from taking down the whole app shell.
 */

// ─── Crash-loop escape (2026-10-19 stability fix) ────────────────────────────
// The route fallback used to offer only "Try Again" / "Restart App":
//   - "Try Again" re-renders the same crashing screen;
//   - "Restart App" cold-starts → session restore re-opens the same persisted
//     room → crashes again.
// Two escapes: (1) an explicit "Leave room" action that clears the persisted
// room and backs out of the modal; (2) after N consecutive fallback trips the
// persisted room is auto-cleared, breaking the loop without user action.
const VOICE_CRASH_TRIP_KEY = 'vee_voice_room_crash_trips_v1';
const MAX_TRIPS_BEFORE_AUTO_CLEAR = 3;

async function recordVoiceCrashTrip(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(VOICE_CRASH_TRIP_KEY);
    const trips = (parseInt(raw || '0', 10) || 0) + 1;
    await AsyncStorage.setItem(VOICE_CRASH_TRIP_KEY, String(trips));
    if (trips >= MAX_TRIPS_BEFORE_AUTO_CLEAR) {
      await clearPersistedActiveRoom();
    }
  } catch {
    // non-critical — the manual "Leave room" path still works
  }
}

async function resetVoiceCrashTrips(): Promise<void> {
  try {
    await AsyncStorage.removeItem(VOICE_CRASH_TRIP_KEY);
  } catch {
    // non-critical
  }
}

/**
 * Rendered only when VoiceRoomScreen mounts cleanly — resets the trip
 * counter. Its effect never runs when the screen throws during render, so
 * the counter only ever counts *consecutive* fallback trips.
 */
function VoiceRoomMountTracker({ children }: { children: ReactNode }) {
  useEffect(() => {
    void resetVoiceCrashTrips();
  }, []);
  return <>{children}</>;
}

function VoiceRoomErrorFallback({ error, componentStack, resetError }: ErrorFallbackProps) {
  useEffect(() => {
    void recordVoiceCrashTrip();
  }, []);

  const handleLeaveRoom = async () => {
    try {
      await clearPersistedActiveRoom();
    } catch {
      // non-critical — still back out of the room
    }
    try {
      resetError();
    } catch {
      // non-critical
    }
    if (router.canDismiss()) {
      router.dismiss();
    } else {
      router.replace('/home');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ErrorFallback error={error} componentStack={componentStack} resetError={resetError} />
      {/* Absolute overlay — ErrorFallback owns its own button layout, so the
          escape is overlaid rather than depending on it. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 56,
          alignItems: 'center',
          paddingHorizontal: 24,
        }}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={handleLeaveRoom}
          style={({ pressed }) => ({
            paddingVertical: 14,
            paddingHorizontal: 24,
            minWidth: 200,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
            backgroundColor: pressed
              ? 'rgba(255,255,255,0.12)'
              : 'rgba(255,255,255,0.055)',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ color: '#B8A6D9', fontWeight: '600', textAlign: 'center', fontSize: 16 }}>
            Leave room
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function VoiceRoomRoute() {
  return (
    <ErrorBoundary FallbackComponent={VoiceRoomErrorFallback}>
      <VoiceRoomMountTracker>
        <VoiceRoomScreen />
      </VoiceRoomMountTracker>
    </ErrorBoundary>
  );
}
