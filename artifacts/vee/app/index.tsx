/**
 * Root index — shows loading while AuthGuard in _layout.tsx
 * determines where to redirect (login or home).
 */
import { View } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';

export default function RootIndex() {
  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
      <PremiumLoader size="large" />
    </View>
  );
}
