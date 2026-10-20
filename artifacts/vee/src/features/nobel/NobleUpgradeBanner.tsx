/**
 * NobleUpgradeBanner — 2026-10-20 (boss's order).
 * IMO's Upgrade Banner privilege (SKing+): a golden scrolling banner —
 * "Congratulations to [name] for upgrading to [RankName] 🎉" —
 * shown room-wide when a user upgrades to a rank holding the
 * upgradeBanner privilege. Auto-dismisses after ~5 seconds.
 *
 * Rendered in the voice room from RoomNobleUpgradeEvent broadcasts
 * (rooms/{roomId}/nobleUpgrades). Text uses `||` fallbacks, never demo.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NOBLE_RANKS, propLevelFor } from '@/src/services/nobleService';

export default function NobleUpgradeBanner({
  name,
  rankIndex,
  onDismiss,
}: {
  /** The upgraded user's display name */
  name: string;
  /** The new rank index (SKing+ = 8..9) */
  rankIndex: number;
  /** Called when the banner should be dismissed */
  onDismiss: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  // Scrolling text: translate the inner row leftward across the banner.
  const scrollAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        speed: 12,
        bounciness: 6,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();

    // Text scrolls left once across the banner
    const scroll = Animated.timing(scrollAnim, {
      toValue: 1,
      duration: 3800,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    scroll.start();

    // Auto-dismiss after 5s
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -120,
          duration: 320,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 320,
          useNativeDriver: true,
        }),
      ]).start(() => onDismiss());
    }, 5000);

    return () => {
      clearTimeout(timer);
      scroll.stop();
    };
  }, [slideAnim, opacityAnim, scrollAnim, onDismiss]);

  const rank = NOBLE_RANKS[rankIndex];
  const rankName = rank ? rank.name : 'Noble';
  const bannerLevel = propLevelFor(rankIndex, 'upgradeBanner');
  const displayName = (name || '').trim() || 'A user';

  const scrollX = scrollAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [60, -160],
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: '2%',
        left: 16,
        right: 16,
        zIndex: 100,
        transform: [{ translateY: slideAnim }],
        opacity: opacityAnim,
      }}
      pointerEvents="none"
    >
      <LinearGradient
        colors={['#FFD54F', '#FFC107', '#FF9800']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          borderRadius: 24,
          paddingVertical: 10,
          paddingHorizontal: 16,
          borderWidth: 2,
          borderColor: '#FFF8E1',
          shadowColor: '#FF9800',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.5,
          shadowRadius: 12,
          elevation: 9,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            transform: [{ translateX: scrollX }],
          }}
        >
          <Text style={{ fontSize: 16, marginRight: 6 }}>🎉</Text>
          <Text
            style={{ color: '#fff', fontSize: 14, fontWeight: '800', flexShrink: 0 }}
            numberOfLines={1}
          >
            Congratulations to {displayName} for upgrading to {rankName}
            {bannerLevel > 0 ? ` ★${bannerLevel}` : ''} 🎉
          </Text>
        </Animated.View>
      </LinearGradient>
    </Animated.View>
  );
}
