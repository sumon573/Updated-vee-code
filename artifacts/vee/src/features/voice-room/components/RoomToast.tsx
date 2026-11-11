import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';

/* ── 2026-11-11 (boss, imo mirror): tiny toast for room-action feedback ──
   ("Success to invite"). Dark rounded rectangle, white text — the imo
   toast. Auto-dismiss is ONE one-shot setTimeout (2200ms, cleared on
   unmount) — the same class as the profile's copy-feedback timer, NOT a
   recurring timer/interval/poll. */

export function useRoomToast() {
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(message);
    timerRef.current = setTimeout(() => { setToast(null); timerRef.current = null; }, 2200);
  }, []);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return { toast, showToast };
}

export function RoomToast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 120, alignItems: 'center', zIndex: 60 }}>
      <View style={{ backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 }}>
        <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>{message}</Text>
      </View>
    </View>
  );
}
