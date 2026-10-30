import { useEffect, useRef } from 'react';
import { Text, Animated, Easing, View } from 'react-native';
import { Image } from 'expo-image';
import AnimatedFrame from '../../../components/AnimatedFrame';
import { rewardsForRankKey, rewardsForRank } from '@/src/services/nobleRewardsCatalog';
import { C } from '../constants/theme';
import { nobleThemeFor } from '@/src/services/nobleService';

/* ─────────────────────────── MsgText ─────────────────────────── */
export function MsgText({ text, accent }: { text: string; accent: string }) {
  const parts = text.split(/(@\S+)/g);
  return (
    <Text style={{ color: C.text, fontSize: 13 }}>
      {parts.map((part, i) =>
        /^@\S+/.test(part)
          ? <Text key={i} style={{ color: accent, fontWeight: '800' }}>{part}</Text>
          : part
      )}
    </Text>
  );
}

/* ─────────────────────────── Premium Speaking Ripple ─────────────────────────── */
// 2026-10-15 (Sumon): premium ripple — ONLY while actually speaking (voice detected).
// - DP stays 100% STABLE: no zoom, no pulse, no movement — the ripple never touches the DP.
// - Circular waves spread on ALL sides, starting OUTSIDE the frame (frame is 1.15x;
//   waves start at 1.28x and expand outward) — never inside the profile/frame.
// - Tiny mist dots + tiny flowers in various colors float outward and fade.
// - Pure RN Animated, native driver (transform/opacity only), pointerEvents none.
const MIST_COLORS = ['#FF6B9D', '#A78BFA', '#60A5FA', '#FBBF24', '#34D399', '#FB923C', '#F472B6', '#93C5FD'];
const FLOWER_CHARS = ['🌸', '🌼', '🌷', '💮', '🏵️', '🌺'];

type MistParticle = {
  anim: Animated.Value; angle: number; dist: number; dur: number; delay: number;
  dotSize: number; color: string;
};
type FlowerParticle = {
  anim: Animated.Value; angle: number; dist: number; dur: number; delay: number;
  fSize: number; char: string; spin: number;
};

function SpeakingRipple({ size, visible, nobleRankIndex, activeRipple, rippleColors }: { size: number; visible: boolean; nobleRankIndex?: number; activeRipple?: string; rippleColors?: string[] }) {
  // 2026-10-15 (Sumon): equipped ripple takes priority — if user equipped a
  // ripple from Decoration, use its design. Else fallback to per-rank theme.
  // Non-nobles get the default premium theme.
  const theme = nobleRankIndex != null ? nobleThemeFor(nobleRankIndex) : null;
  // 2026-10-27 (boss: Use must visibly work): the equipped ripple's own
  // colors (resolved live by useActiveRipple in SeatCard) override the
  // theme — previously the design was never looked up (TODO), so Use
  // changed nothing for nobles and only toggled particles for others.
  const equippedColors = (rippleColors ?? []).filter((c): c is string => typeof c === 'string' && !!c);
  const mistColors = equippedColors.length > 0 ? equippedColors : (theme ? theme.rippleMist : MIST_COLORS);
  const particleChars = theme ? theme.rippleParticles : FLOWER_CHARS;
  // 2026-10-19 (IMO port Phase 1): IMO brand blue #05b5fa for the default
  // speaking halo — matches IMO's VrCircledRippleImageView ripple color.
  // Noble/equipped themes keep their own wave colors (sacred).
  const waveColor = equippedColors.length > 0 ? equippedColors[0] : (theme ? theme.rippleWave : '#05b5fa');
  const w1 = useRef(new Animated.Value(0)).current;
  const w2 = useRef(new Animated.Value(0)).current;
  const w3 = useRef(new Animated.Value(0)).current;
  const w4 = useRef(new Animated.Value(0)).current;
  const w5 = useRef(new Animated.Value(0)).current;
  // 2026-10-16 (Sumon): Per-rank wave count — higher rank = more waves
  const themeWaveCount = theme?.rippleWaveCount ?? 2;
  // 2026-10-16 (Sumon): SIMPLE ripple for normal users — waves only.
  // Fancy particles/flowers ONLY for Nobel/equipped ripple users.
  const isFancy = !!(theme || activeRipple || equippedColors.length > 0);
  // 2026-10-16 (Sumon): Per-rank progression — higher rank = more beautiful, more shimmery.
  const rankIdx = nobleRankIndex ?? 0;
  // 2026-10-16 (Sumon): DISTINCT effect behavior per rank — each type moves differently.
  const effectType = theme?.rippleEffect ?? null;
  const getEffectConfig = () => {
    switch (effectType) {
      case 'leaves': return { angleBase: 0, angleVar: Math.PI * 2, distMul: 1.0, durMul: 1.2 }; // drift outward
      case 'droplets': return { angleBase: -Math.PI / 2, angleVar: 0.6, distMul: 0.9, durMul: 0.9 }; // rise up
      case 'snow': return { angleBase: Math.PI / 2, angleVar: 0.4, distMul: 0.7, durMul: 1.4 }; // fall down gently
      case 'stars': return { angleBase: 0, angleVar: Math.PI * 2, distMul: 0.3, durMul: 0.7 }; // twinkle in place
      case 'petals': return { angleBase: 0, angleVar: Math.PI * 2, distMul: 0.8, durMul: 1.1 }; // float
      case 'flames': return { angleBase: -Math.PI / 2, angleVar: 0.5, distMul: 1.1, durMul: 0.7 }; // rise fast
      case 'coins': return { angleBase: -Math.PI / 2, angleVar: 0.8, distMul: 1.0, durMul: 1.0 }; // spin up
      case 'crowns': return { angleBase: 0, angleVar: Math.PI * 2, distMul: 0.4, durMul: 0.8 }; // glow pulse
      case 'sparks': return { angleBase: 0, angleVar: Math.PI * 2, distMul: 1.3, durMul: 0.5 }; // explode fast
      case 'diamonds': return { angleBase: 0, angleVar: Math.PI * 2, distMul: 0.5, durMul: 0.6 }; // shine
      default: return { angleBase: 0, angleVar: Math.PI * 2, distMul: 1.0, durMul: 1.0 };
    }
  };
  const effectCfg = getEffectConfig();
  const particleCount = isFancy ? 10 + rankIdx : 0;  // Knight=10, SSKing=19
  const flowerCount = isFancy ? 5 + Math.floor(rankIdx / 2) : 0;  // Knight=5, SSKing=9
  const waveCount = isFancy ? 2 + Math.floor(rankIdx / 3) : 2;  // Knight=2, King+=4
  const speedBoost = isFancy ? 1 + (rankIdx * 0.08) : 1;  // SSKing=1.72x faster
  // 14 tiny mist dots — random outward trajectories, fixed per mount (lazy init:
  // useRef's argument would otherwise re-run Array.from + 14 Animated.Value allocs
  // on every render)
  const particlesRef = useRef<MistParticle[] | null>(null);
  const flowersRef = useRef<FlowerParticle[] | null>(null);
  const effectKeyRef = useRef<string | null>(null);
  // 2026-10-16: Reset particles when rank/effect changes (rank-up updates effect)
  const effectKey = `${effectType}-${particleCount}`;
  if (effectKeyRef.current !== effectKey) {
    effectKeyRef.current = effectKey;
    particlesRef.current = null;
    flowersRef.current = null;
  }
  if (particlesRef.current === null && isFancy) {
    particlesRef.current = Array.from({ length: particleCount }, (_, i) => ({
      anim: new Animated.Value(0),
      angle: effectCfg.angleBase + (i / particleCount) * effectCfg.angleVar + Math.random() * 0.3,
      dist: size * (0.62 + Math.random() * 0.72) * effectCfg.distMul,
      dur: ((650 + Math.random() * 450) / speedBoost) * effectCfg.durMul,
      delay: (i / 14) * 700,
      dotSize: 4 + Math.random() * 5,
      color: mistColors[i % mistColors.length],
    }));
  }
  const particles = particlesRef.current;
  // 7 tiny flowers mixed in (same lazy init)
  if (flowersRef.current === null && isFancy) {
    flowersRef.current = Array.from({ length: flowerCount }, (_, i) => ({
      anim: new Animated.Value(0),
      angle: (i / 7) * Math.PI * 2 + Math.random() * 0.6,
      dist: size * (0.66 + Math.random() * 0.78),
      dur: 750 + Math.random() * 500,
      delay: (i / 7) * 800,
      fSize: 10 + Math.random() * 5,
      char: particleChars[i % particleChars.length],
      spin: Math.random() > 0.5 ? 1 : -1,
    }));
  }
  const flowers = flowersRef.current;

  useEffect(() => {
    const all: Animated.Value[] = [w1, w2, w3, w4, w5,
      ...(particles ? particles.map((p) => p.anim) : []),
      ...(flowers ? flowers.map((f) => f.anim) : [])];
    if (!visible) { all.forEach((a) => a.setValue(0)); return; }
    const wave = (anim: Animated.Value, delay: number, dur: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, {
          toValue: 1, duration: dur, easing: Easing.out(Easing.ease), useNativeDriver: true,
        }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]));
    const loops: Animated.CompositeAnimation[] = [
      wave(w1, 0, 900 / speedBoost), wave(w2, 300 / speedBoost, 900 / speedBoost), wave(w3, 600 / speedBoost, 900 / speedBoost),
      ...(themeWaveCount >= 4 ? [wave(w4, 900 / speedBoost, 900 / speedBoost)] : []),
      ...(themeWaveCount >= 5 ? [wave(w5, 1200 / speedBoost, 900 / speedBoost)] : []),
      ...(particles ? particles.map((p) => wave(p.anim, p.delay, p.dur)) : []),
      ...(flowers ? flowers.map((f) => wave(f.anim, f.delay, f.dur)) : []),
    ];
    loops.forEach((l) => l.start());
    return () => { loops.forEach((l) => l.stop()); };
  }, [visible]);

  if (!visible) return null;

  const area = size * 2.7;    // ripple playground — covers the max expansion
  const waveD = size * 1.28;  // wave ring diameter — starts OUTSIDE the 1.15x frame
  const edgeR = size * 0.62; // particles spawn just outside the DP edge

  const renderWave = (anim: Animated.Value, key: string) => {
    const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.85] });
    const opacity = anim.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] });
    return (
      <Animated.View
        key={key}
        style={{
          position: 'absolute',
          width: waveD, height: waveD, borderRadius: waveD / 2,
          borderWidth: 2, borderColor: waveColor,
          transform: [{ scale }], opacity,
        }}
      />
    );
  };

  const renderMist = (p: MistParticle, key: string) => {
    const translateX = p.anim.interpolate({
      inputRange: [0, 1], outputRange: [Math.cos(p.angle) * edgeR, Math.cos(p.angle) * p.dist],
    });
    const translateY = p.anim.interpolate({
      inputRange: [0, 1], outputRange: [Math.sin(p.angle) * edgeR, Math.sin(p.angle) * p.dist],
    });
    const opacity = p.anim.interpolate({
      inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 0.85, 0.5, 0],
    });
    const pscale = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.15] });
    return (
      <Animated.View
        key={key}
        style={{
          position: 'absolute',
          width: p.dotSize, height: p.dotSize, borderRadius: p.dotSize / 2,
          backgroundColor: p.color, opacity,
          transform: [{ translateX }, { translateY }, { scale: pscale }],
        }}
      />
    );
  };

  const renderFlower = (f: FlowerParticle, key: string) => {
    const translateX = f.anim.interpolate({
      inputRange: [0, 1], outputRange: [Math.cos(f.angle) * edgeR, Math.cos(f.angle) * f.dist],
    });
    const translateY = f.anim.interpolate({
      inputRange: [0, 1], outputRange: [Math.sin(f.angle) * edgeR, Math.sin(f.angle) * f.dist],
    });
    const opacity = f.anim.interpolate({
      inputRange: [0, 0.2, 0.7, 1], outputRange: [0, 1, 0.7, 0],
    });
    const rotate = f.anim.interpolate({
      inputRange: [0, 1], outputRange: ['0deg', `${f.spin * 70}deg`],
    });
    return (
      <Animated.Text
        key={key}
        style={{
          position: 'absolute', fontSize: f.fSize, opacity,
          transform: [{ translateX }, { translateY }, { rotate }],
        }}
      >
        {f.char}
      </Animated.Text>
    );
  };

  return (
    <View
      style={{
        position: 'absolute',
        width: area, height: area,
        alignItems: 'center', justifyContent: 'center',
      }}
      pointerEvents="none"
    >
      {renderWave(w1, 'w1')}
      {renderWave(w2, 'w2')}
      {renderWave(w3, 'w3')}
      {themeWaveCount >= 4 && renderWave(w4, 'w4')}
      {themeWaveCount >= 5 && renderWave(w5, 'w5')}
      {particles && particles.map((p, i) => renderMist(p, `m${i}`))}
      {flowers && flowers.map((f, i) => renderFlower(f, `f${i}`))}
    </View>
  );
}

/* ─────────────────────────── Avatar ─────────────────────────── */
// 2026-10-15 (Sumon): NO fake zoom/pulse. DP is 100% stable.
// Speaking indicator = premium ripple (waves + mist + flowers) OUTSIDE the frame,
// ONLY while actually speaking (voice detected).
export function Avatar({ initials, color, size, speaking, accent, photoURL, frameType, nobleRankIndex, activeRipple, rippleColors, frameScale }: {
  initials: string; color: string; size: number; speaking: boolean; accent: string;
  photoURL?: string; frameType?: string; nobleRankIndex?: number; activeRipple?: string; rippleColors?: string[];
  /** 2026-10-29 (Fix #36): seat-only frame scale override, forwarded to
      AnimatedFrame. Undefined everywhere else -> official 1.15x unchanged. */
  frameScale?: number;
}) {
  // 2026-10-19 (IMO port Phase 1): IMO-style speaking halo — normal users get
  // the #05b5fa blue halo ring; noble/equipped-ripple users keep their theme.
  const isFancy = nobleRankIndex != null || !!activeRipple || (rippleColors?.length ?? 0) > 0;
  const haloColor = isFancy ? C.gold : '#05b5fa';
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Ripple BEHIND the avatar — expands outward */}
      <SpeakingRipple size={size} visible={speaking} nobleRankIndex={nobleRankIndex} activeRipple={activeRipple} rippleColors={rippleColors} />
      {/* 2026-10-19 (IMO port Phase 1): IMO halo ring — static #05b5fa glow
          ring hugging the avatar while speaking (normal users only; noble
          themes have their own). Placed behind the DP so overflow stays clean. */}
      {speaking && !isFancy && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: size + 10, height: size + 10, borderRadius: (size + 10) / 2,
            borderWidth: 2, borderColor: '#05b5fa',
            shadowColor: '#05b5fa', shadowOpacity: 0.8, shadowRadius: 10,
            shadowOffset: { width: 0, height: 0 }, elevation: 5,
          }}
        />
      )}
      {/* DP — completely stable, no animation */}
      <View style={{
        width: size, height: size, borderRadius: size / 2,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: color + '2A',
        borderWidth: speaking ? 2.5 : 1.5,
        borderColor: speaking ? haloColor : (accent + '55'),
        overflow: 'hidden',
      }}>
        {photoURL ? (
          <Image
            source={{ uri: photoURL }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
          />
        ) : (
          <Text style={{ color, fontSize: size * 0.34, fontWeight: '800' }}>{initials}</Text>
        )}
      </View>
      {/* 2026-10-13 (Sumon): Animated frame overlay — pure RN, no native modules */}
      {frameType && frameType !== 'none' && (
        <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
          {/* 2026-10-15 (Sumon): Nobel crown frames use RN animation (gentle float + glow).
              Regular frames use server APNG. */}
          {frameType.startsWith('noble-frame-') ? (
            (() => {
              const rankKey = frameType.replace('noble-frame-', '');
              // 2026-10-20 FIX (boss: count frame not showing on seats): a
              // noble-frame-* id must ALWAYS resolve to the snug seat ring.
              // Resolution order: catalog by frame-id key (now case-tolerant
              // in rewardsForRankKey) → catalog by the occupant's rank index
              // (seat data carries it; position-based, immune to id format)
              // → generic noble-gold ring. NEVER the full-size AnimatedFrame:
              // ornate art on a seat covers the name/DP (boss's standing rule).
              const catalog =
                rewardsForRankKey(rankKey) ??
                (nobleRankIndex != null ? rewardsForRank(nobleRankIndex) : null);
              const ringColor = catalog?.rankColor || C.gold;
              // 2026-10-21 (boss: "count er frame voice room e dekhay na —
              // professional koro, boro app gulo jevabe kaj kore"): draw the
              // frame's REAL artwork over the DP, big-app style. Calibration
              // comes from the catalog (frame.config.seatScale / seatDy) so
              // geometry is data, not code. The plain ring shows ONLY when
              // there is no art (boss 2026-10-30: only the frame itself, no
              // round frame underneath). Frames without calibration (e.g. Viscount's
              // opaque-centre shield) keep the ring only — an opaque image
              // must never cover a DP.
              const frameCfg = catalog?.frame?.config as { seatScale?: unknown; seatDy?: unknown } | undefined;
              const seatScale = typeof frameCfg?.seatScale === 'number' ? frameCfg.seatScale : null;
              const seatDy = typeof frameCfg?.seatDy === 'number' ? frameCfg.seatDy : 0;
              const frameUrl = seatScale != null ? catalog?.frame?.designUrl : undefined;
              const artSize = seatScale != null ? Math.round(size * seatScale) : 0;
              return (
                <>
                  {frameUrl ? null : (
                    <View style={{
                      width: size + 10, height: size + 10, borderRadius: (size + 10) / 2,
                      borderWidth: 3, borderColor: ringColor, backgroundColor: 'transparent',
                      shadowColor: ringColor, shadowOpacity: 0.35, shadowRadius: 6,
                      shadowOffset: { width: 0, height: 0 },
                    }} />
                  )}
                  {frameUrl ? (
                    <Image
                      source={{ uri: frameUrl }}
                      style={{
                        position: 'absolute',
                        width: artSize, height: artSize,
                        transform: [{ translateY: -seatDy * artSize }],
                      }}
                      resizeMode="contain"
                    />
                  ) : null}
                </>
              );
            })()
          ) : (
            /* 2026-10-13 (Sumon): server-hosted APNG; frameId resolves the admin-controlled URL.
                compact: voice room-এ নাম ঢেকে না যায় */
            <AnimatedFrame size={size} frameId={frameType} compact scale={frameScale} />
          )}
        </View>
      )}
    </View>
  );
}
