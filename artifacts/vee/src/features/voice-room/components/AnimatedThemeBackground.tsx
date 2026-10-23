/**
 * AnimatedThemeBackground — light, beautiful animated room background.
 *
 * Layers (all pointer-events-none, GPU-friendly):
 *  1. Pulsing top glow in the theme accent color (slow breathe, 4s loop).
 *  2. Soft bottom glow for depth.
 *  3. Floating particles — small accent-tinted dots drifting upward on
 *     staggered loops, like embers / bubbles / snow depending on theme.
 *
 * Kept deliberately light: opacity-only + translateY animations driven by
 * the native driver, a fixed small particle count, no blur filters.
 *
 * 2026-10-23 (boss): SCENE themes — when the active theme carries a
 * `scene`, this component renders that animated scene INSTEAD of the
 * glow/particles. HARD RULE (boss, repeated twice): the scene is the
 * background layer ONLY — this whole component is absolute-fill at
 * zIndex 0 and every room element (seats, DPs, chat, buttons, texts)
 * renders after it in the tree, so the scene can never cover anything.
 * Scene motion stays soft and mostly at the sky/bottom edges so text
 * sitting directly on the background keeps full contrast.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Easing, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { SceneKind } from '../constants/theme';

const { width: W, height: H } = Dimensions.get('window');
const PARTICLE_COUNT = 10;

type Props = {
  accentColor: string;
  scene?: SceneKind;
};

function Particle({ accent, index }: { accent: string; index: number }) {
  const y = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const cfg = useMemo(() => {
    // Deterministic pseudo-random per index so particles don't jump on re-render.
    const seed = (index * 7919) % 100 / 100;
    return {
      left: seed * W,
      size: 3 + ((index * 13) % 5),
      duration: 6000 + ((index * 1700) % 5000),
      delay: (index * 900) % 4000,
      drift: ((index * 37) % 60) - 30,
      maxOpacity: 0.25 + ((index * 7) % 20) / 100,
    };
  }, [index]);

  useEffect(() => {
    let alive = true;
    y.setValue(0);
    opacity.setValue(0);
    const rise = Animated.loop(
      Animated.sequence([
        Animated.delay(cfg.delay),
        Animated.parallel([
          Animated.timing(y, {
            toValue: -(H * 0.55),
            duration: cfg.duration,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: cfg.maxOpacity,
              duration: cfg.duration * 0.25,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: cfg.duration * 0.75,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),
    );
    rise.start();
    return () => {
      alive = false;
      rise.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: cfg.left,
        bottom: H * 0.25,
        width: cfg.size,
        height: cfg.size,
        borderRadius: cfg.size / 2,
        backgroundColor: accent,
        opacity,
        transform: [{ translateY: y }, { translateX: cfg.drift }],
      }}
    />
  );
}

/* ═══════════════════════ Scene building blocks ═══════════════════════
   Every primitive loops on the native driver and cleans up on unmount.
   Deterministic per-index configs keep particles stable across renders. */

/** Generic 0→1 loop progress value. */
function useLoop(duration: number, delay = 0) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    p.setValue(0);
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(p, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, delay]);
  return p;
}

/** Gentle back-and-forth (yoyo) value 0→1→0. */
function useSway(duration: number, delay = 0) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    p.setValue(0);
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(p, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(p, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, delay]);
  return p;
}

/** A particle falling the full height of the screen, looping. The child
 *  decides its own look via `style`; sway + spin are optional. */
function FallingParticle({ left, size, duration, delay, sway = 14, spin = false, style }: {
  left: number; size: number; duration: number; delay: number;
  sway?: number; spin?: boolean; style: object;
}) {
  const p = useLoop(duration, delay);
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [-40, H + 40] });
  const translateX = p.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, sway, 0, -sway, 0],
  });
  const opacity = p.interpolate({ inputRange: [0, 0.08, 0.9, 1], outputRange: [0, 1, 1, 0] });
  const rotate = p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '330deg'] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{
        position: 'absolute', left, top: 0, width: size, height: size, opacity,
        transform: [{ translateY }, { translateX }, ...(spin ? [{ rotate }] : [])],
      }, style]}
    />
  );
}

/** A bubble rising from the bottom band (ocean). */
function RisingBubble({ left, size, duration, delay }: { left: number; size: number; duration: number; delay: number }) {
  const p = useLoop(duration, delay);
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [0, -(H * 0.45)] });
  const opacity = p.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 0.85, 0.85, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', left, bottom: 6, width: size, height: size,
        borderRadius: size / 2, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.75)',
        opacity, transform: [{ translateY }],
      }}
    />
  );
}

/** Soft ellipse band (wave / hill / dune) swaying sideways. */
function SwayBand({ bottom, height, color, duration, range = 16, radius = 90 }: {
  bottom: number; height: number; color: string; duration: number; range?: number; radius?: number;
}) {
  const s = useSway(duration);
  const translateX = s.interpolate({ inputRange: [0, 1], outputRange: [-range, range] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', bottom, left: -W * 0.25, width: W * 1.5, height,
        borderRadius: radius, backgroundColor: color, transform: [{ translateX }],
      }}
    />
  );
}

/** A cloud: one rounded bar drifting sideways. */
function DriftingCloud({ top, left, width, color, duration, delay = 0 }: {
  top: number; left: number; width: number; color: string; duration: number; delay?: number;
}) {
  const s = useSway(duration, delay);
  const translateX = s.interpolate({ inputRange: [0, 1], outputRange: [-12, 20] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', top, left, width, height: width * 0.26,
        borderRadius: width * 0.13, backgroundColor: color, transform: [{ translateX }],
      }}
    />
  );
}

/** Twinkling dot (snow glints). */
function Twinkle({ left, bottom, size, delay }: { left: number; bottom: number; size: number; delay: number }) {
  const s = useSway(1100, delay);
  const opacity = s.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] });
  const scale = s.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.25] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', left, bottom, width: size, height: size, borderRadius: size / 2,
        backgroundColor: '#FFFFFF', opacity, transform: [{ scale }],
      }}
    />
  );
}

/** Pine tree silhouette (border trick) for the snow scene. */
function Pine({ left, bottom, h, color }: { left: number; bottom: number; h: number; color: string }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left, bottom, alignItems: 'center' }}>
      <View style={{
        width: 0, height: 0, borderLeftWidth: h * 0.3, borderRightWidth: h * 0.3,
        borderBottomWidth: h, borderLeftColor: 'transparent', borderRightColor: 'transparent',
        borderBottomColor: color,
      }} />
      <View style={{ width: 5, height: 9, backgroundColor: '#4A3220', marginTop: -2 }} />
    </View>
  );
}

/** A tiny bird (two rotated bars) gliding across the sky. */
function Bird({ top, duration, delay, scale = 1 }: { top: number; duration: number; delay: number; scale?: number }) {
  const p = useLoop(duration, delay);
  const translateX = p.interpolate({ inputRange: [0, 1], outputRange: [-50, W + 50] });
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [0, -18] });
  const opacity = p.interpolate({ inputRange: [0, 0.06, 0.94, 1], outputRange: [0, 1, 1, 0] });
  const bar = { width: 11 * scale, height: 2.4 * scale, borderRadius: 2, backgroundColor: 'rgba(67,20,7,0.8)' } as const;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top, left: 0, opacity, transform: [{ translateX }, { translateY }] }}>
      <View style={{ flexDirection: 'row' }}>
        <View style={[bar, { transform: [{ rotate: '-28deg' }] }]} />
        <View style={[bar, { transform: [{ rotate: '28deg' }], marginLeft: -2 }]} />
      </View>
    </Animated.View>
  );
}

/* ═══════════════════════ The six scenes ═══════════════════════ */

function OceanScene() {
  const bubbles = useMemo(() => Array.from({ length: 9 }, (_, i) => ({
    left: ((i * 41 + 13) % 92) / 100 * W,
    size: 4 + ((i * 7) % 6),
    duration: 4200 + ((i * 613) % 2600),
    delay: (i * 700) % 3000,
  })), []);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <LinearGradient colors={['#E0F2FE', '#7DD3FC', '#38BDF8']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {bubbles.map((b, i) => <RisingBubble key={i} {...b} />)}
      <SwayBand bottom={-18} height={54} color="rgba(2,132,199,0.35)" duration={2600} />
      <SwayBand bottom={-26} height={52} color="rgba(255,255,255,0.30)" duration={3400} range={22} />
    </View>
  );
}

function CherryScene() {
  const petals = useMemo(() => Array.from({ length: 11 }, (_, i) => ({
    left: ((i * 31 + 7) % 94) / 100 * W,
    size: 8 + ((i * 5) % 6),
    duration: 6800 + ((i * 977) % 3400),
    delay: (i * 1150) % 5200,
  })), []);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <LinearGradient colors={['#FDF2F8', '#FCE7F3', '#FBCFE8']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {petals.map((p, i) => (
        <FallingParticle key={i} {...p} spin sway={18} style={{
          backgroundColor: '#FFF1F2', borderWidth: 1, borderColor: 'rgba(244,114,182,0.5)',
          borderTopLeftRadius: p.size, borderTopRightRadius: 2, borderBottomRightRadius: p.size, borderBottomLeftRadius: 2,
        }} />
      ))}
    </View>
  );
}

function SunsetScene() {
  const sunSway = useSway(3400);
  const sunY = sunSway.interpolate({ inputRange: [0, 1], outputRange: [0, 7] });
  const sunScale = sunSway.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  const shimmers = useMemo(() => [0, 1, 2].map((i) => ({ left: W * (0.36 + i * 0.09), bottom: 12 + i * 13, width: 34 - i * 6, delay: i * 550 })), []);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <LinearGradient colors={['#FDE68A', '#FDBA74', '#FB923C', '#F472B6']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {/* Sun with halo — upper sky, above the seat grid's horizon line */}
      <Animated.View pointerEvents="none" style={{
        position: 'absolute', top: H * 0.10, left: W / 2 - 46, width: 92, height: 92, borderRadius: 46,
        backgroundColor: 'rgba(253,224,71,0.35)', alignItems: 'center', justifyContent: 'center',
        transform: [{ translateY: sunY }, { scale: sunScale }],
      }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#FDE047', borderWidth: 3, borderColor: '#FFF7CC' }} />
      </Animated.View>
      <DriftingCloud top={H * 0.06} left={W * 0.06} width={72} color="rgba(255,255,255,0.55)" duration={4200} />
      <DriftingCloud top={H * 0.16} left={W * 0.66} width={56} color="rgba(255,255,255,0.45)" duration={5200} delay={600} />
      <Bird top={H * 0.07} duration={15000} delay={0} />
      <Bird top={H * 0.12} duration={18000} delay={5000} scale={0.8} />
      {/* Sea band + shimmer at the very bottom edge */}
      <LinearGradient colors={['rgba(251,146,60,0.55)', 'rgba(190,80,160,0.65)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 46 }} />
      {shimmers.map((s, i) => <Twinkle key={i} left={s.left} bottom={s.bottom} size={s.width / 8} delay={s.delay} />)}
    </View>
  );
}

function RainScene() {
  const drops = useMemo(() => Array.from({ length: 15 }, (_, i) => ({
    left: ((i * 23 + 5) % 96) / 100 * W,
    size: 11,
    duration: 820 + ((i * 131) % 420),
    delay: (i * 260) % 1100,
  })), []);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <LinearGradient colors={['#CBD5E1', '#94A3B8', '#64748B']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <DriftingCloud top={10} left={W * 0.05} width={86} color="rgba(241,245,249,0.55)" duration={4600} />
      <DriftingCloud top={26} left={W * 0.58} width={64} color="rgba(241,245,249,0.42)" duration={5600} delay={800} />
      {drops.map((d, i) => (
        <FallingParticle key={i} {...d} sway={2} style={{ width: 2, backgroundColor: 'rgba(219,234,254,0.85)', borderRadius: 2 }} />
      ))}
    </View>
  );
}

function SnowScene() {
  const flakes = useMemo(() => Array.from({ length: 15 }, (_, i) => {
    const tier = i % 3; // 0 big / 1 mid / 2 far — depth
    return {
      left: ((i * 27 + 9) % 95) / 100 * W,
      size: tier === 0 ? 8 : tier === 1 ? 5 : 3,
      duration: (tier === 0 ? 6200 : tier === 1 ? 7800 : 9800) + ((i * 449) % 1600),
      delay: (i * 890) % 4600,
      opacityTier: tier === 2 ? 0.55 : 0.95,
    };
  }), []);
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <LinearGradient colors={['#8B7FC0', '#A8BCE0', '#D8EBFA', '#F4FAFF']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {/* Moon */}
      <View pointerEvents="none" style={{
        position: 'absolute', top: H * 0.045, left: 20, width: 26, height: 26, borderRadius: 13,
        backgroundColor: '#FFF7D6', shadowColor: '#FFF7D6', shadowOpacity: 0.8, shadowRadius: 10,
        shadowOffset: { width: 0, height: 0 }, elevation: 4,
      }} />
      <Pine left={W * 0.05} bottom={26} h={52} color="#2C4A6E" />
      <Pine left={W * 0.80} bottom={30} h={64} color="#243D5C" />
      <Pine left={W * 0.63} bottom={22} h={36} color="#3A5F8A" />
      {/* Snow hills along the bottom edge */}
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -30, left: -W * 0.12, width: W * 1.3, height: 62, borderRadius: 90, backgroundColor: '#FFFFFF' }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -38, left: W * 0.3, width: W * 1.1, height: 58, borderRadius: 90, backgroundColor: '#F4FAFF' }} />
      {flakes.map((f, i) => (
        <FallingParticle key={i} left={f.left} size={f.size} duration={f.duration} delay={f.delay} sway={10}
          style={{ borderRadius: f.size / 2, backgroundColor: '#FFFFFF', opacity: f.opacityTier }} />
      ))}
      <Twinkle left={W * 0.26} bottom={14} size={4} delay={0} />
      <Twinkle left={W * 0.58} bottom={9} size={3} delay={700} />
      <Twinkle left={W * 0.84} bottom={18} size={4} delay={1300} />
    </View>
  );
}

function ValleyScene() {
  const breathe = useSway(3000);
  const rainbowOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });
  const flow = useLoop(1500);
  const fallY = flow.interpolate({ inputRange: [0, 1], outputRange: [-16, 16] });
  const flowers = useMemo(() => [
    { left: 0.13, c: '#F472B6' }, { left: 0.23, c: '#FDE047' }, { left: 0.37, c: '#FFFFFF' },
    { left: 0.51, c: '#F472B6' }, { left: 0.65, c: '#FDE047' }, { left: 0.88, c: '#FFFFFF' },
  ], []);
  const ring = (size: number, color: string) => ({
    position: 'absolute' as const, left: W / 2 - size / 2, bottom: -size / 2,
    width: size, height: size, borderRadius: size / 2, borderWidth: 9, borderColor: color,
  });
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <LinearGradient colors={['#BAE6FD', '#E0F2FE', '#DCFCE7']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {/* Rainbow — clipped to a top band so only the arc shows */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 118, overflow: 'hidden' }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: rainbowOpacity }}>
          <View style={ring(196, 'rgba(239,68,68,0.50)')} />
          <View style={ring(168, 'rgba(249,115,22,0.48)')} />
          <View style={ring(140, 'rgba(234,179,8,0.48)')} />
          <View style={ring(112, 'rgba(34,197,94,0.42)')} />
        </Animated.View>
      </View>
      <DriftingCloud top={14} left={W * 0.05} width={62} color="rgba(255,255,255,0.9)" duration={5000} />
      <DriftingCloud top={34} left={W * 0.72} width={46} color="rgba(255,255,255,0.85)" duration={6000} delay={900} />
      {/* Green hills along the bottom edge */}
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -34, left: -W * 0.16, width: W * 0.95, height: 80, borderRadius: 100, backgroundColor: '#4ADE80' }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -38, right: -W * 0.18, width: W * 1.0, height: 92, borderRadius: 100, backgroundColor: '#22C55E' }} />
      {/* Waterfall ribbon on the right hill */}
      <View pointerEvents="none" style={{
        position: 'absolute', right: W * 0.16, bottom: 24, width: 13, height: 62,
        borderRadius: 7, overflow: 'hidden', backgroundColor: 'rgba(186,230,253,0.85)',
      }}>
        <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: [{ translateY: fallY }] }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ height: 8, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.95)' }} />
          ))}
        </Animated.View>
      </View>
      {flowers.map((f, i) => (
        <View key={i} pointerEvents="none" style={{
          position: 'absolute', left: W * f.left, bottom: 10 + (i % 3) * 8,
          width: 5, height: 5, borderRadius: 3, backgroundColor: f.c,
        }} />
      ))}
    </View>
  );
}

const SCENES: Record<SceneKind, () => React.JSX.Element> = {
  ocean: OceanScene,
  cherry: CherryScene,
  sunset: SunsetScene,
  rain: RainScene,
  snow: SnowScene,
  valley: ValleyScene,
};

/* ═══════════════════════ Main component ═══════════════════════ */

export function AnimatedThemeBackground({ accentColor, scene }: Props) {
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accentColor]);

  const glowOpacity = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });
  const glowScale = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });

  const particles = useMemo(
    () => Array.from({ length: PARTICLE_COUNT }, (_, i) => i),
    [],
  );

  // Scene themes: the animated scene IS the background (still zIndex 0,
  // absolute fill, pointer-events none — room UI always renders on top).
  if (scene) {
    const Scene = SCENES[scene];
    return (
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}
      >
        <Scene />
      </View>
    );
  }

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}
    >
      {/* Breathing top glow in the theme accent */}
      <Animated.View
        style={{
          position: 'absolute',
          top: -60,
          left: -40,
          right: -40,
          height: 300,
          opacity: glowOpacity,
          transform: [{ scale: glowScale }],
        }}
      >
        <LinearGradient
          colors={[accentColor + '38', accentColor + '00']}
          style={{ flex: 1 }}
        />
      </Animated.View>

      {/* Soft bottom glow for depth */}
      <LinearGradient
        colors={[accentColor + '00', accentColor + '14']}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 180 }}
      />

      {/* Floating particles */}
      {particles.map((i) => (
        <Particle key={`${accentColor}-${i}`} accent={accentColor} index={i} />
      ))}
    </View>
  );
}
