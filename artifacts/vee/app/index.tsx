/**
 * Root index — shows loading while AuthGuard in _layout.tsx
 * determines where to redirect (login or home).
 *
 * 2026-10-26 (boss: no loading screens): DELAYED spinner — a cached user
 * resolves before 800ms, so this route unmounts (redirected) before any
 * spinner ever appears. Only a genuinely slow first-run/network wait shows
 * one, after 800ms, so the screen never looks frozen either.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';

export default function RootIndex() {
  const [showSpinner, setShowSpinner] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowSpinner(true), 800);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
      {showSpinner ? <PremiumLoader size="large" /> : null}
    </View>
  );
}
