import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';

/**
 * Marquee room name (boss 2026-10-27, confirmed 20:14): when the room name is
 * too long to fit its header area, it scrolls in ONE direction only —
 * right to left — and when one pass ends the next pass starts again, forever
 * (continuous loop; never reverses, never ping-pong). Short names that fit
 * stay STATIC, rendered exactly as before (numberOfLines=1 + tail ellipsis).
 *
 * Overflow is MEASURED, never guessed: the container width comes from
 * onLayout and the full single-line text width from onTextLayout of the
 * first copy. The animated row holds the text TWICE with a gap, so the loop
 * reset (translateX back to 0) lands on an identical frame — seamless.
 * Everything stays inside this View (overflow hidden, flex:1, minWidth:0),
 * so the scroll can never push the trio buttons or overlap share/X/dots,
 * and taps still land on the surrounding Pressable (panel opener).
 */

const FONT_SIZE = 16;
const GAP = 48;
const SPEED_PX_PER_SEC = 45;
const PAUSE_MS = 1400;

type Props = {
  text: string;
  color: string;
  fontWeight: '700' | '900';
};

export function MarqueeRoomName({ text, color, fontWeight }: Props) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;

  // Re-measure whenever the name changes.
  useEffect(() => {
    setTextWidth(0);
    translateX.setValue(0);
  }, [text, translateX]);

  const overflow = containerWidth > 0 && textWidth > 0 && textWidth > containerWidth;

  useEffect(() => {
    if (!overflow) {
      return undefined;
    }
    const distance = textWidth + GAP;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(PAUSE_MS),
        Animated.timing(translateX, {
          toValue: -distance,
          duration: (distance / SPEED_PX_PER_SEC) * 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => {
      anim.stop();
      translateX.setValue(0);
    };
  }, [overflow, textWidth, translateX]);

  const textStyle = { color, fontSize: FONT_SIZE, fontWeight, flexShrink: 0 as const };

  return (
    <View
      style={{ flex: 1, minWidth: 0, overflow: 'hidden', justifyContent: 'center' }}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {!overflow ? (
        <Text numberOfLines={1} ellipsizeMode="tail" style={{ color, fontSize: FONT_SIZE, fontWeight, flex: 1 }}>
          {text}
        </Text>
      ) : (
        <Animated.View
          style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', transform: [{ translateX }] }}
        >
          <Text style={textStyle} onTextLayout={(e) => setTextWidth(e.nativeEvent.lines[0]?.width ?? 0)}>
            {text}
          </Text>
          <View style={{ width: GAP }} />
          <Text style={textStyle} aria-hidden>
            {text}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}
