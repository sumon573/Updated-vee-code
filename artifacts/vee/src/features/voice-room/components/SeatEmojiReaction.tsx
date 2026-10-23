import { memo, useEffect, useRef } from 'react';
import { Animated, Text } from 'react-native';
import { Image } from 'expo-image';
import { stickerUrl } from '../services/stickerCatalog';

/**
 * Seat reaction performer (2026-10-23, Sumon).
 *
 * Reactions are DESIGNED animated stickers — glossy 3D characters on a
 * transparent background, NO plate/disc behind them (his explicit call;
 * font glyphs were rejected as "demo"). The artwork is an animated WebP
 * served from the VPS static host; this component pops it in with a
 * spring over the seat DP, fitted exactly to the DP so the character
 * fills the seat circle cleanly, IMO-style.
 *
 * Any non-sticker value (an emoji broadcast by an older client still in
 * the room) falls back to a simple bouncing glyph so nothing breaks.
 */
export default memo(function SeatEmojiReaction({ emoji, size = 68 }: {
  emoji: string;
  size?: number;
}) {
  const scale = useRef(new Animated.Value(0.3)).current;
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spring = Animated.spring(scale, {
      toValue: 1, friction: 5, tension: 130, useNativeDriver: true,
    });
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: -3, duration: 260, useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]),
    );
    spring.start();
    loop.start();
    return () => { spring.stop(); loop.stop(); };
  }, [scale, bounce]);

  const url = stickerUrl(emoji);

  return (
    <Animated.View
      pointerEvents="none"
      style={{ transform: [{ scale }, { translateY: bounce }] }}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          style={{ width: size, height: size }}
          contentFit="contain"
          recyclingKey={emoji}
        />
      ) : (
        <Text style={{ fontSize: size * 0.62 }}>{emoji}</Text>
      )}
    </Animated.View>
  );
});
