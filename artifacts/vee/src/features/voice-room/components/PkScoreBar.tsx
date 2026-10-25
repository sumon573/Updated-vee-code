import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';

/**
 * PkScoreBar — animated proportional PK score bar (boss 2026-10-25:
 * "animation ভাবে বাড়া কমা দেখতে পাবে" — the whole room must SEE the
 * bar grow/shrink live as diamonds land on either side).
 *
 * The challenger share animates (~500ms) on every score change instead
 * of jumping; 0–0 shows an even bar. Width animation needs the JS
 * driver (width is not native-drivable) — a tiny bar, so that is fine.
 */
export function PkScoreBar({
  challengerScore,
  opponentScore,
  height = 10,
  challengerColor = '#7C3AED',
  opponentColor = '#05B5FA',
}: {
  challengerScore: number;
  opponentScore: number;
  height?: number;
  challengerColor?: string;
  opponentColor?: string;
}) {
  const total = challengerScore + opponentScore;
  const share = total > 0 ? challengerScore / total : 0.5;
  const shareAnim = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.timing(shareAnim, {
      toValue: share,
      duration: 500,
      useNativeDriver: false,
    }).start();
  }, [share]);

  const challengerWidth = shareAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View
      style={{
        flexDirection: 'row',
        height,
        borderRadius: height / 2,
        overflow: 'hidden',
      }}
    >
      <Animated.View style={{ width: challengerWidth, backgroundColor: challengerColor }} />
      <View style={{ flex: 1, backgroundColor: opponentColor }} />
    </View>
  );
}
