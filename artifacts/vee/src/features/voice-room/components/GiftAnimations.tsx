/**
 * 2026-10-16 (Sumon): Animated gifts — each gift has a UNIQUE animation.
 * Classic = light/subtle, Premium = elaborate, Luxury = full display.
 * Pure code animations — no designer needed, zero cost.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, Image, Dimensions } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

// ── Classic: Light animations ──

function HeartBeat({ emoji }: { emoji: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.2, duration: 400, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);
  return (
    <Animated.Text style={{ fontSize: 26, transform: [{ scale }] }}>{emoji}</Animated.Text>
  );
}

function RoseSway({ emoji }: { emoji: string }) {
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(rotate, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(rotate, { toValue: -1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [rotate]);
  return (
    <Animated.Text style={{
      fontSize: 26,
      transform: [{ rotate: rotate.interpolate({ inputRange: [-1, 1], outputRange: ['-10deg', '10deg'] }) }],
    }}>{emoji}</Animated.Text>
  );
}

function GiftBounce({ emoji }: { emoji: string }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: -6, duration: 500, easing: Easing.bounce, useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [y]);
  return (
    <Animated.Text style={{ fontSize: 26, transform: [{ translateY: y }] }}>{emoji}</Animated.Text>
  );
}

function DiamondShine({ emoji }: { emoji: string }) {
  const opacity = useRef(new Animated.Value(0.7)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.7, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.Text style={{ fontSize: 26, opacity }}>{emoji}</Animated.Text>
  );
}

function TrophyGlow({ emoji }: { emoji: string }) {
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(glow, { toValue: 1, duration: 1500, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);
  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.View style={{
        position: 'absolute', width: 40, height: 40, borderRadius: 20,
        backgroundColor: '#FFD700',
        opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] }),
        transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.3] }) }],
      }} />
      <Text style={{ fontSize: 26 }}>{emoji}</Text>
    </View>
  );
}

function RocketFly({ emoji }: { emoji: string }) {
  const y = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loopY = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: -8, duration: 700, useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    const loopR = Animated.loop(
      Animated.sequence([
        Animated.timing(rotate, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(rotate, { toValue: -1, duration: 350, useNativeDriver: true }),
      ])
    );
    loopY.start(); loopR.start();
    return () => { loopY.stop(); loopR.stop(); };
  }, [y, rotate]);
  return (
    <Animated.Text style={{
      fontSize: 26,
      transform: [
        { translateY: y },
        { rotate: rotate.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] }) },
      ],
    }}>{emoji}</Animated.Text>
  );
}

function CrownSparkle({ emoji }: { emoji: string }) {
  const spark = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spark, { toValue: 1, duration: 1200, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [spark]);
  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.Text style={{
        fontSize: 10, position: 'absolute', top: -8,
        opacity: spark.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] }),
      }}>✨</Animated.Text>
      <Text style={{ fontSize: 26 }}>{emoji}</Text>
    </View>
  );
}

function FireworkPop({ emoji }: { emoji: string }) {
  const scale = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 300, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.9, duration: 300, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);
  return (
    <Animated.Text style={{ fontSize: 26, transform: [{ scale }] }}>{emoji}</Animated.Text>
  );
}

// ── Premium: Elaborate animations ──

function RingShine({ emoji }: { emoji: string }) {
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotate, { toValue: 1, duration: 2000, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [rotate]);
  return (
    <Animated.Text style={{
      fontSize: 28,
      transform: [{ rotate: rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
    }}>{emoji}</Animated.Text>
  );
}

function CarDrive({ emoji }: { emoji: string }) {
  const x = useRef(new Animated.Value(-4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(x, { toValue: 4, duration: 800, useNativeDriver: true }),
        Animated.timing(x, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [x]);
  return (
    <Animated.Text style={{ fontSize: 28, transform: [{ translateX: x }] }}>{emoji}</Animated.Text>
  );
}

function JetFly({ emoji }: { emoji: string }) {
  const y = useRef(new Animated.Value(0)).current;
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(y, { toValue: -6, duration: 600, useNativeDriver: true }),
          Animated.timing(x, { toValue: 6, duration: 600, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(y, { toValue: 0, duration: 600, useNativeDriver: true }),
          Animated.timing(x, { toValue: 0, duration: 600, useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [y, x]);
  return (
    <Animated.Text style={{ fontSize: 28, transform: [{ translateX: x }, { translateY: y }] }}>{emoji}</Animated.Text>
  );
}

function YachtFloat({ emoji }: { emoji: string }) {
  const y = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(y, { toValue: -4, duration: 1200, easing: Easing.inOut(Easing.sine), useNativeDriver: true }),
          Animated.timing(rotate, { toValue: 1, duration: 1200, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(y, { toValue: 4, duration: 1200, easing: Easing.inOut(Easing.sine), useNativeDriver: true }),
          Animated.timing(rotate, { toValue: -1, duration: 1200, useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [y, rotate]);
  return (
    <Animated.Text style={{
      fontSize: 28,
      transform: [
        { translateY: y },
        { rotate: rotate.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] }) },
      ],
    }}>{emoji}</Animated.Text>
  );
}

function StarTwinkle({ emoji }: { emoji: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.3, duration: 500, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 500, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale, opacity]);
  return (
    <Animated.Text style={{ fontSize: 28, transform: [{ scale }], opacity }}>{emoji}</Animated.Text>
  );
}

function GalaxySpin({ emoji }: { emoji: string }) {
  const rotate = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loopR = Animated.loop(Animated.timing(rotate, { toValue: 1, duration: 3000, useNativeDriver: true }));
    const loopS = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    loopR.start(); loopS.start();
    return () => { loopR.stop(); loopS.stop(); };
  }, [rotate, scale]);
  return (
    <Animated.Text style={{
      fontSize: 28,
      transform: [
        { rotate: rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
        { scale },
      ],
    }}>{emoji}</Animated.Text>
  );
}

// ── Luxury: Full display animations ──

function CastleGlow({ emoji }: { emoji: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.View style={{
        position: 'absolute', width: 50, height: 50, borderRadius: 25,
        backgroundColor: '#FFD700',
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.5] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) }],
      }} />
      <Text style={{ fontSize: 30 }}>{emoji}</Text>
    </View>
  );
}

function RoyalCrownFloat({ emoji }: { emoji: string }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: -8, duration: 900, easing: Easing.inOut(Easing.sine), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sine), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [y]);
  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.Text style={{ fontSize: 12, transform: [{ translateY: y }] }}>✨</Animated.Text>
      <Text style={{ fontSize: 30 }}>{emoji}</Text>
    </View>
  );
}

function EternalDiamondRotate({ emoji }: { emoji: string }) {
  const rotateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotateY, { toValue: 1, duration: 2500, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [rotateY]);
  return (
    <Animated.Text style={{
      fontSize: 30,
      transform: [{ rotateY: rotateY.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
    }}>{emoji}</Animated.Text>
  );
}

function UniverseExplode({ emoji }: { emoji: string }) {
  const scale = useRef(new Animated.Value(0.8)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.4, duration: 700, easing: Easing.out(Easing.exp), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.8, duration: 700, easing: Easing.in(Easing.exp), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scale]);
  return (
    <Animated.Text style={{ fontSize: 32, transform: [{ scale }] }}>{emoji}</Animated.Text>
  );
}

// ── Main component ──

const ANIMATIONS: Record<string, React.FC<{ emoji: string }>> = {
  '1': HeartBeat, '2': RoseSway, '3': GiftBounce, '4': DiamondShine,
  '5': TrophyGlow, '6': RocketFly, '7': CrownSparkle, '8': FireworkPop,
  '9': RingShine, '10': CarDrive, '11': JetFly, '12': YachtFloat,
  '13': StarTwinkle, '14': GalaxySpin,
  '15': CastleGlow, '16': RoyalCrownFloat, '17': EternalDiamondRotate, '18': UniverseExplode,
};

// 2026-10-16 (Sumon): PERMANENT — Video/GIF support for server-driven gifts.
// Plays the gift's video exactly as-is (no changes, no substitutes).
// Falls back gracefully if video fails to load — never crashes.
function VideoGift({ animationUrl, size = 120, fullscreen = false }: {
  animationUrl: string;
  size?: number;
  fullscreen?: boolean;
}) {
  const [hasError, setHasError] = useState(false);

  let player;
  try {
    player = useVideoPlayer(animationUrl, (p) => {
      p.loop = false;
      p.play();
    });
  } catch {
    setHasError(true);
  }

  if (hasError || !player) {
    // Fallback: show nothing instead of crashing
    return null;
  }

  // 2026-10-17 (Sumon): Fullscreen mode — video fills 90% of screen, stable, no movement.
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const videoSize = fullscreen ? Math.min(screenW * 0.9, screenH * 0.6) : size;

  return (
    <VideoView
      player={player}
      style={{ width: videoSize, height: videoSize }}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

export function AnimatedGift({ giftId, emoji, size = 26, animationUrl, animationType, videoSize, videoFullscreen }: {
  giftId: string;
  emoji: string;
  size?: number;
  animationUrl?: string;
  animationType?: string;
  videoSize?: number;
  videoFullscreen?: boolean;
}) {
  // 2026-10-16 (Sumon): PERMANENT — server-driven gifts with video play the video as-is
  // 2026-10-17 (Sumon): videoSize/videoFullscreen are server-driven via Firebase gift_catalog — no build needed to adjust. Video plays stable, no rotation/movement.
  if (animationType === 'video' && animationUrl) {
    return <VideoGift animationUrl={animationUrl} size={videoSize || Math.min(size * 2.5, 280)} fullscreen={videoFullscreen} />;
  }
  // 2026-10-17 (Sumon): CRITICAL FIX — server gifts with animationType='image'
  // must render the CDN image, not fall through to emoji!
  if (animationType === 'image' && animationUrl) {
    return (
      <Image
        source={{ uri: animationUrl }}
        style={{ width: size, height: size, borderRadius: size / 8 }}
        resizeMode="contain"
      />
    );
  }
  // GIFs play automatically via Image component (native support)
  // For server gifts with thumbnailUrl, the thumbnail shows (GIF animates natively)
  const Animation = ANIMATIONS[giftId];
  if (!Animation) {
    return <Text style={{ fontSize: size }}>{emoji}</Text>;
  }
  return <Animation emoji={emoji} />;
}
