import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * 2026-11-01 (batch55, boss: King names gold + "chik chik" in voice rooms).
 *
 * King gold for names. The sparkle is TEXT shimmer only — a small twinkling
 * star beside the name. Noble BADGES are never animated (standing law) and
 * are untouched here; this file renders no badge anywhere.
 *
 * The twinkle mirrors the VibeHandFx dots in SeatCard.tsx: one Animated
 * value looping opacity, JS driver, opacity only, ~1200ms per leg. No
 * layout animation, so a room full of King names costs almost nothing.
 */

/** King rank color (matches NOBLE_RANKS king #FBC02D). */
export const KING_GOLD = '#FBC02D';
/** Brighter gold for the sparkle itself (same gold as the King entry name). */
const KING_SPARKLE = '#FFD94D';

/** Small twinkling 4-point star, rendered beside a King name. */
export function KingSparkle({ size = 11 }: { size?: number } = {}) {
  const tw = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(tw, { toValue: 1, duration: 1200, useNativeDriver: false }),
      Animated.timing(tw, { toValue: 0, duration: 1200, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [tw]);
  return (
    <Animated.View
      style={{
        marginLeft: 3,
        opacity: tw.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
      }}
    >
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {/* viewBox crops to the sparkle's own bounds (x 16.06-20.74, y 2.4-7.08) so it fills the box instead of sitting tiny in a corner. */}
        <Svg width={size} height={size} viewBox="16 2.4 4.7 4.7" fill="none">
          <Path
            d="M18.4 2.4l.62 1.72 1.72.62-1.72.62-.62 1.72-.62-1.72-1.72-.62 1.72-.62.62-1.72Z"
            fill={KING_SPARKLE}
          />
        </Svg>
      </View>
    </Animated.View>
  );
}
