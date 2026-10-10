/**
 * EntryBanner — "X is Coming" join animation (2026-10-10).
 * When a user joins a voice room, show an animated banner sliding in from
 * the right with their DP, name, and ID — like IMO's "Rio is Coming".
 * Auto-dismisses after 3 seconds. Safe: pure UI, no side effects.
 */
import { useEffect, useRef } from 'react';
import { View, Text, Image, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface EntryBannerProps {
  /** The joiner's display name */
  name: string;
  /** The joiner's user ID (short ID if available) */
  userId: string;
  /** The joiner's photo URL (optional) */
  photoURL?: string | null;
  /** Called when the banner should be dismissed */
  onDismiss: () => void;
}

export default function EntryBanner({ name, userId, photoURL, onDismiss }: EntryBannerProps) {
  const slideAnim = useRef(new Animated.Value(400)).current; // start off-screen right
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Slide in from right
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        speed: 12,
        bounciness: 8,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-dismiss after 3 seconds
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 400,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => onDismiss());
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  const initials = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <Animated.View
      style={{
        transform: [{ translateX: slideAnim }],
        opacity: opacityAnim,
        position: 'absolute',
        top: 100,
        left: 16,
        right: 16,
        zIndex: 100,
      }}
      pointerEvents="none"
    >
      <LinearGradient
        colors={['#1E90FF', '#0066CC']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 24,
          paddingVertical: 8,
          paddingHorizontal: 12,
        }}
      >
        {photoURL ? (
          <Image
            source={{ uri: photoURL }}
            style={{ width: 36, height: 36, borderRadius: 18, marginRight: 10 }}
          />
        ) : (
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.3)',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 10,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
              {initials}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
            {name} is Coming
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }} numberOfLines={1}>
            ID: {userId}
          </Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}
