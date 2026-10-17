/**
 * GiftLuxuryEffects.tsx — Per-gift DISTINCT luxury animations (Sumon 2026-10-17).
 *
 * Each gift gets its OWN luxury effect: different particles, colors, and motion.
 * 6s total: 4s centered fullscreen display with effects, then 2s fly to seat.
 * Vee Brand has a completely different majestic effect.
 *
 * All effects use react-native Animated with useNativeDriver for 60fps.
 */
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, Text, View } from 'react-native';

/* ═══════════════════════════════════════════
   Effect configuration per gift
═══════════════════════════════════════════ */

export type LuxuryEffectType =
  | 'pink-hearts'      // pink-love: pink hearts + love sparkles
  | 'snow-ice'         // winter-dream: falling snowflakes + icy shimmer
  | 'petal-glow'       // blossom-dream: falling petals + pink glow
  | 'crystal-prism'    // crystal-palace: crystalline sparkles + prismatic shimmer
  | 'golden-clouds'    // cloud-temple: floating clouds + golden light rays
  | 'sakura-aura'      // sakura-falls: sakura petals + soft pink aura
  | 'emerald-leaf'     // emerald-garden: green sparkles + leaf particles
  | 'fairy-dust'       // fairy-princess: fairy dust + magical glow + twinkles
  | 'speed-glow'       // dream-rider: speed lines + dynamic glow
  | 'romantic-hearts'  // wedding-kiss: hearts floating + romantic glow
  | 'musical-sparkle'  // first-dance: musical notes + elegant sparkles
  | 'mystery-glow'     // blind-love: mysterious dark sparkles + glow
  | 'vee-majestic'     // vee-brand-castle: COMPLETELY DIFFERENT majestic brand effect
  | 'golden-sparkle'   // golden-crown: golden sparkles + royal shimmer
  | 'minimal';         // kiss: MINIMAL effect — very subtle, few particles (Sumon 2026-10-17)

const GIFT_EFFECT_MAP: Record<string, LuxuryEffectType> = {
  'pink-love': 'pink-hearts',
  'winter-dream': 'snow-ice',
  'blossom-dream': 'petal-glow',
  'crystal-palace': 'crystal-prism',
  'cloud-temple': 'golden-clouds',
  'sakura-falls': 'sakura-aura',
  'emerald-garden': 'emerald-leaf',
  'fairy-princess': 'fairy-dust',
  'dream-rider': 'speed-glow',
  'wedding-kiss': 'romantic-hearts',
  'first-dance': 'musical-sparkle',
  'blind-love': 'mystery-glow',
  'vee-brand-castle': 'vee-majestic',
  // 2026-10-17 (Sumon): New gifts
  'vee-dream-castle': 'vee-majestic',
  'rose-heart': 'petal-glow',
  'pink-rose': 'petal-glow',
  'golden-crown': 'golden-sparkle',
  'heart': 'pink-hearts',
  'kiss': 'minimal',
};

export function getLuxuryEffect(giftId: string): LuxuryEffectType {
  return GIFT_EFFECT_MAP[giftId] ?? 'pink-hearts';
}

/* ═══════════════════════════════════════════
   Particle component (individual floating element)
═══════════════════════════════════════════ */

function Particle({
  emoji, startX, startY, endX, endY, duration, delay, size,
}: {
  emoji: string;
  startX: number; startY: number;
  endX: number; endY: number;
  duration: number; delay: number; size: number;
}) {
  const posX = useRef(new Animated.Value(startX)).current;
  const posY = useRef(new Animated.Value(startY)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(posX, { toValue: endX, duration, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(posY, { toValue: endY, duration, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.delay(duration - 600),
          Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]),
        Animated.timing(rotation, { toValue: 360, duration, easing: Easing.linear, useNativeDriver: true }),
      ]),
    ]);
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotate = rotation.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={{
      position: 'absolute',
      left: 0, top: 0,
      opacity,
      transform: [{ translateX: posX }, { translateY: posY }, { rotate }],
    }}>
      <Text style={{ fontSize: size }}>{emoji}</Text>
    </Animated.View>
  );
}

/* ═══════════════════════════════════════════
   Glow/Shimmer overlay component
═══════════════════════════════════════════ */

function GlowPulse({ color, size }: { color: string; size: number }) {
  const scale = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.2, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.8, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.6, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.3, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={{
      position: 'absolute',
      width: size, height: size,
      borderRadius: size / 2,
      backgroundColor: color,
      opacity,
      transform: [{ scale }],
    }} />
  );
}

/* ═══════════════════════════════════════════
   Main luxury effect component
═══════════════════════════════════════════ */

export function GiftLuxuryEffect({ giftId, size }: { giftId: string; size: number }) {
  const { width: W, height: H } = Dimensions.get('window');
  const effect = getLuxuryEffect(giftId);
  const centerX = W / 2;
  const centerY = H / 2;

  // Generate particles based on effect type
  const renderParticles = () => {
    const particles = [];
    // 2026-10-17 (Sumon): minimal effect uses only 4 particles
    const count = effect === 'minimal' ? 4 : 12;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = size * 0.6;
      const startX = centerX + Math.cos(angle) * radius * 0.3;
      const startY = centerY + Math.sin(angle) * radius * 0.3;
      const endX = centerX + Math.cos(angle) * radius * 1.5;
      const endY = centerY + Math.sin(angle) * radius * 1.5 - 50;

      let emoji = '✨';
      let pSize = 20;

      switch (effect) {
        case 'pink-hearts':
          emoji = ['💖', '💕', '✨', '💗'][i % 4];
          pSize = 18 + (i % 3) * 4;
          break;
        case 'snow-ice':
          emoji = ['❄️', '✨', '💎', '❅'][i % 4];
          pSize = 16 + (i % 3) * 4;
          break;
        case 'petal-glow':
          emoji = ['🌸', '✨', '💮', '🌺'][i % 4];
          pSize = 18 + (i % 3) * 4;
          break;
        case 'crystal-prism':
          emoji = ['💎', '✨', '🔮', '💠'][i % 4];
          pSize = 16 + (i % 3) * 5;
          break;
        case 'golden-clouds':
          emoji = ['☁️', '✨', '🌟', '💛'][i % 4];
          pSize = 20 + (i % 3) * 4;
          break;
        case 'sakura-aura':
          emoji = ['🌸', '✨', '💮', '🎀'][i % 4];
          pSize = 18 + (i % 3) * 4;
          break;
        case 'emerald-leaf':
          emoji = ['🍃', '✨', '💚', '🌿'][i % 4];
          pSize = 18 + (i % 3) * 4;
          break;
        case 'fairy-dust':
          emoji = ['🧚', '✨', '⭐', '💫'][i % 4];
          pSize = 16 + (i % 3) * 5;
          break;
        case 'speed-glow':
          emoji = ['⚡', '✨', '💨', '🔥'][i % 4];
          pSize = 18 + (i % 3) * 4;
          break;
        case 'romantic-hearts':
          emoji = ['💒', '💕', '✨', '💖'][i % 4];
          pSize = 20 + (i % 3) * 4;
          break;
        case 'musical-sparkle':
          emoji = ['🎵', '✨', '🎶', '🎼'][i % 4];
          pSize = 18 + (i % 3) * 4;
          break;
        case 'mystery-glow':
          emoji = ['🌙', '✨', '🔮', '💜'][i % 4];
          pSize = 18 + (i % 3) * 4;
          break;
        case 'vee-majestic':
          // Vee Brand: completely different - golden crowns and Vee sparkles
          emoji = ['👑', '✨', '💎', '🌟'][i % 4];
          pSize = 22 + (i % 3) * 6;
          break;
        case 'golden-sparkle':
          // Golden Crown: royal golden sparkles
          emoji = ['✨', '👑', '💛', '⭐'][i % 4];
          pSize = 20 + (i % 3) * 5;
          break;
        case 'minimal':
          // Kiss: MINIMAL — very few, subtle sparkles only (Sumon 2026-10-17)
          emoji = ['✨', '💋'][i % 2];
          pSize = 14 + (i % 2) * 3;
          break;
      }

      particles.push(
        <Particle
          key={`${effect}-${i}`}
          emoji={emoji}
          startX={startX}
          startY={startY}
          endX={endX}
          endY={endY}
          duration={2500}
          delay={i * 150}
          size={pSize}
        />
      );
    }
    return particles;
  };

  // Glow color per effect
  const getGlowColor = (): string => {
    switch (effect) {
      case 'pink-hearts': return 'rgba(255, 105, 180, 0.3)';
      case 'snow-ice': return 'rgba(173, 216, 230, 0.3)';
      case 'petal-glow': return 'rgba(255, 182, 193, 0.3)';
      case 'crystal-prism': return 'rgba(147, 112, 219, 0.3)';
      case 'golden-clouds': return 'rgba(255, 215, 0, 0.3)';
      case 'sakura-aura': return 'rgba(255, 183, 197, 0.3)';
      case 'emerald-leaf': return 'rgba(50, 205, 50, 0.3)';
      case 'fairy-dust': return 'rgba(218, 112, 214, 0.3)';
      case 'speed-glow': return 'rgba(255, 69, 0, 0.3)';
      case 'romantic-hearts': return 'rgba(255, 105, 180, 0.35)';
      case 'musical-sparkle': return 'rgba(135, 206, 250, 0.3)';
      case 'mystery-glow': return 'rgba(75, 0, 130, 0.35)';
      case 'vee-majestic': return 'rgba(255, 215, 0, 0.4)'; // Gold for Vee Brand
      case 'golden-sparkle': return 'rgba(255, 215, 0, 0.35)'; // Royal gold
      case 'minimal': return 'rgba(255, 182, 193, 0.15)'; // Very subtle pink
      default: return 'rgba(255, 215, 0, 0.3)';
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
      {/* Pulsing glow behind the gift */}
      <GlowPulse color={getGlowColor()} size={size * 1.3} />
      {/* Floating particles */}
      {renderParticles()}
    </View>
  );
}
