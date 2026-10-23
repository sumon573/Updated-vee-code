import { useEffect, useRef } from 'react';
import { Animated, Text } from 'react-native';

/**
 * SeatEmojiReaction — 2026-10-23 (Sumon): seat emoji, redesigned.
 *
 * The old reaction floated up over the DP like a demo. Now the emoji sits
 * INSIDE the seat DP, big and alive: every emoji has its OWN designed
 * motion (laugh-shake, heartbeat, wave, cry-hop, flame flicker…) that
 * loops for the reaction's lifetime, after a springy pop-in.
 *
 * All motion is transform/opacity on the native driver — no assets,
 * no native modules. Unknown emojis fall back to a joyful bounce.
 */

type Vals = {
  scale: Animated.Value;
  rot: Animated.Value;
  tx: Animated.Value;
  ty: Animated.Value;
};

const T = (v: Animated.Value, to: number, d: number) =>
  Animated.timing(v, { toValue: to, duration: d, useNativeDriver: true });

/** Build a looping animation for one emoji from its design steps.
    Each step list is [value, target, durationMs]; tracks run in parallel
    and are designed to share the same total loop length per emoji. */
function loopFor(emoji: string, v: Vals): Animated.CompositeAnimation {
  const par = (tracks: [Animated.Value, number, number][][]) =>
    Animated.loop(
      Animated.parallel(
        tracks.map((steps) =>
          Animated.sequence(steps.map(([val, to, d]) => T(val, to, d))),
        ),
      ),
    );
  const S = v.scale, R = v.rot, X = v.tx, Y = v.ty;

  switch (emoji) {
    case '😂': // laugh-shake
      return par([
        [[R, -10, 90], [R, 10, 90], [R, -8, 90], [R, 8, 90], [R, 0, 90]],
        [[S, 1.12, 110], [S, 1, 110], [S, 1.12, 110], [S, 1, 120]],
      ]);
    case '🤣': // rolling laugh — big rock + hop
      return par([
        [[R, -17, 170], [R, 17, 170], [R, -17, 170], [R, 0, 170]],
        [[Y, -4, 170], [Y, 0, 170], [Y, -4, 170], [Y, 0, 170]],
      ]);
    case '👍': // thumbs-up bounce
      return par([
        [[Y, -7, 150], [Y, 0, 150], [Y, -7, 150], [Y, 0, 150]],
        [[S, 1.14, 150], [S, 1, 150], [S, 1.14, 150], [S, 1, 150]],
      ]);
    case '👏': // clap-clap pulse
      return par([
        [[S, 1.22, 110], [S, 1, 110], [S, 1.22, 110], [S, 1, 110]],
        [[X, -1.5, 110], [X, 1.5, 110], [X, -1.5, 110], [X, 0, 110]],
      ]);
    case '🥰':
    case '😍':
    case '❤️': // heartbeat — lub-dub, then rest
      return par([
        [[S, 1.26, 110], [S, 1, 110], [S, 1.18, 100], [S, 1, 280]],
      ]);
    case '😘': // kiss — tilt + lean in
      return par([
        [[R, -9, 200], [R, 0, 200], [R, -9, 200], [R, 0, 200]],
        [[S, 1.16, 200], [S, 1, 200], [S, 1.16, 200], [S, 1, 200]],
        [[X, 2, 200], [X, 0, 200], [X, 2, 200], [X, 0, 200]],
      ]);
    case '😭': // cry — sobbing hops + shiver
      return par([
        [[Y, -4, 120], [Y, 0, 120], [Y, -4, 120], [Y, 0, 120]],
        [[X, -1.5, 60], [X, 1.5, 60], [X, -1.5, 60], [X, 1.5, 60], [X, -1.5, 60], [X, 0, 60]],
      ]);
    case '👋': // wave
      return par([
        [[R, 0, 60], [R, 22, 130], [R, -10, 130], [R, 22, 130], [R, 0, 130]],
      ]);
    case '😯': // wow — surprised pulse
      return par([
        [[S, 1.14, 220], [S, 1, 220], [S, 1.14, 220], [S, 1, 220]],
        [[Y, -2, 220], [Y, 0, 220], [Y, -2, 220], [Y, 0, 220]],
      ]);
    case '🙂': // gentle smile bob
      return par([
        [[Y, -3, 420], [Y, 0, 420]],
        [[R, -4, 420], [R, 4, 420]],
      ]);
    case '🫣': // peek-a-boo dip
      return par([
        [[Y, 5, 300], [Y, 0, 300], [Y, 5, 300], [Y, 0, 300]],
        [[S, 0.88, 300], [S, 1, 300], [S, 0.88, 300], [S, 1, 300]],
      ]);
    case '🔥': // flame flicker
      return par([
        [[S, 1.13, 90], [S, 0.97, 90], [S, 1.1, 90], [S, 1, 90]],
        [[R, -3, 90], [R, 3, 90], [R, -2, 90], [R, 0, 90]],
      ]);
    case '😎': // cool — slow confident sway
      return par([
        [[Y, -2, 450], [Y, 0, 450]],
        [[R, -3, 450], [R, 3, 450]],
      ]);
    case '🥳': // party — rocking hops
      return par([
        [[R, -14, 150], [R, 14, 150], [R, -14, 150], [R, 0, 150]],
        [[Y, -6, 150], [Y, 0, 150], [Y, -6, 150], [Y, 0, 150]],
      ]);
    case '😴': // sleepy sway + breathe
      return par([
        [[R, -6, 800], [R, 6, 800]],
        [[S, 0.94, 800], [S, 1, 800]],
      ]);
    case '🙏': // grateful bow
      return par([
        [[Y, 3, 300], [Y, 0, 300]],
        [[R, 4, 300], [R, 0, 300]],
      ]);
    default: // joyful bounce
      return par([
        [[Y, -5, 220], [Y, 0, 220]],
        [[S, 1.1, 220], [S, 1, 220]],
      ]);
  }
}

export default function SeatEmojiReaction({ emoji, size }: { emoji: string; size: number }) {
  const pop = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const v = useRef<Vals>({
    scale: new Animated.Value(1),
    rot: new Animated.Value(0),
    tx: new Animated.Value(0),
    ty: new Animated.Value(0),
  }).current;

  useEffect(() => {
    const entry = Animated.spring(pop, {
      toValue: 1, friction: 5, tension: 130, useNativeDriver: true,
    });
    const loop = loopFor(emoji, v);
    const fadeOut = Animated.sequence([
      Animated.delay(2950),
      Animated.timing(fade, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]);
    entry.start();
    loop.start();
    fadeOut.start();
    return () => { entry.stop(); loop.stop(); fadeOut.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emoji]);

  return (
    <Animated.View style={{ opacity: fade, transform: [{ scale: pop }] }}>
      <Animated.View style={{
        transform: [
          { scale: v.scale },
          { translateX: v.tx },
          { translateY: v.ty },
          { rotate: v.rot.interpolate({ inputRange: [-20, 20], outputRange: ['-20deg', '20deg'] }) },
        ],
      }}>
        <Text style={{ fontSize: size, lineHeight: size * 1.18, textAlign: 'center' }}>
          {emoji}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
