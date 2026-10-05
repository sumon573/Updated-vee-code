import { ErrorBoundary } from '@/components/ErrorBoundary';
import VoiceRoomScreen from '@/src/features/voice-room/screens/VoiceRoomScreen';

/**
 * Route wrapper — an ErrorBoundary here keeps a voice-room render crash
 * (e.g. malformed seat/room data) from taking down the whole app shell.
 */
export default function VoiceRoomRoute() {
  return (
    <ErrorBoundary>
      <VoiceRoomScreen />
    </ErrorBoundary>
  );
}
