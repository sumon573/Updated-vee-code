/**
 * NobleLevelUpCelebration — 2026-10-15 (Sumon).
 * Premium luxury rank-up celebration: when the user's noble rank INCREASES,
 * a full-screen overlay plays — mist particles in the new rank's color,
 * the rank icon, and "RANK UP" text. Auto-dismisses after 4s.
 *
 * Mounted once at the app root so it fires no matter where the rank-up
 * happens (gift sent from voice room, etc.). Only triggers on an actual
 * rank INCREASE, never on initial load or demotion.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, Dimensions, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/src/context/AuthContext';
import {
  NOBLE_RANKS, nobleThemeFor, subscribeNoble,
} from '@/src/services/nobleService';

const { width: W, height: H } = Dimensions.get('window');

type MistP = {
  anim: Animated.Value;
  x0: number; y0: number;
  dx: number; dy: number;
  size: number; color: string;
  dur: number; delay: number;
};

function buildMist(count: number, colors: string[]): MistP[] {
  return Array.from({ length: count }, () => ({
    anim: new Animated.Value(0),
    x0: Math.random() * W,
    y0: H * 0.3 + Math.random() * H * 0.5,
    dx: (Math.random() - 0.5) * 160,
    dy: -(120 + Math.random() * 220),
    size: 6 + Math.random() * 14,
    color: colors[Math.floor(Math.random() * colors.length)],
    dur: 2200 + Math.random() * 1800,
    delay: Math.random() * 1200,
  }));
}

function MistLayer({ colors, runId }: { colors: string[]; runId: number }) {
  const mistRef = useRef<MistP[] | null>(null);
  if (mistRef.current === null) {
    mistRef.current = buildMist(40, colors);
  }
  const mist = mistRef.current;

  useEffect(() => {
    mistRef.current = buildMist(40, colors);
    const cur = mistRef.current;
    const loops = cur.map((p) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(p.delay),
          Animated.timing(p.anim, {
            toValue: 1, duration: p.dur, easing: Easing.out(Easing.ease), useNativeDriver: true,
          }),
          Animated.timing(p.anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => { loops.forEach((l) => l.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return (
    <View style={{ ...{ position: 'absolute' }, left: 0, top: 0, right: 0, bottom: 0 }} pointerEvents="none">
      {mist.map((p, i) => {
        const tx = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] });
        const ty = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, p.dy] });
        const op = p.anim.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.9, 0.6, 0] });
        const sc = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.4] });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute', left: p.x0, top: p.y0,
              width: p.size, height: p.size, borderRadius: p.size / 2,
              backgroundColor: p.color, opacity: op,
              transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }],
            }}
          />
        );
      })}
    </View>
  );
}

export default function NobleLevelUpCelebration() {
  const { user } = useAuth();
  const [celebration, setCelebration] = useState<{ rankIndex: number; runId: number } | null>(null);
  const prevRankRef = useRef<number | null>(null);
  const runIdRef = useRef(0);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!user?.uid) return;
    return subscribeNoble(
      user.uid,
      (s) => {
        const rank = s ? s.rankIndex : 0;
        const prev = prevRankRef.current;
        prevRankRef.current = rank;
        // Celebrate ONLY on rank increase (not initial load, not demotion).
        if (prev != null && rank > prev) {
          runIdRef.current += 1;
          setCelebration({ rankIndex: rank, runId: runIdRef.current });
        }
      },
      () => {},
    );
  }, [user?.uid]);

  useEffect(() => {
    if (!celebration) return;
    scaleAnim.setValue(0);
    fadeAnim.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 8, bounciness: 8 }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 0, duration: 500, useNativeDriver: true })
        .start(() => setCelebration(null));
    }, 4000);
    return () => clearTimeout(t);
  }, [celebration, scaleAnim, fadeAnim]);

  if (!celebration) return null;

  const theme = nobleThemeFor(celebration.rankIndex);
  const rank = NOBLE_RANKS[celebration.rankIndex];
  if (!theme || !rank) return null;

  return (
    <Modal transparent visible animationType="none">
      <Animated.View
        style={{
          flex: 1, opacity: fadeAnim,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.55)',
        }}
        pointerEvents="none"
      >
        <MistLayer colors={theme.rippleMist} runId={celebration.runId} />
        <Animated.View style={{ transform: [{ scale: scaleAnim }], alignItems: 'center' }}>
          <LinearGradient
            colors={theme.entryGradient}
            style={{
              borderRadius: 24, paddingVertical: 28, paddingHorizontal: 40,
              alignItems: 'center', borderWidth: 3, borderColor: '#FFF8E1',
              shadowColor: theme.rippleWave, shadowOpacity: 0.6, shadowRadius: 20,
              elevation: 10,
            }}
          >
            <Text style={{ fontSize: 64 }}>{theme.entryIcon}</Text>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 8 }}>
              NOBLE RANK UP!
            </Text>
            <Text style={{ color: '#fff', fontSize: 30, fontWeight: '900', marginTop: 4 }}>
              {rank.name}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '600', marginTop: 6 }}>
              Your entry effect & ripple are now {rank.name}-themed
            </Text>
          </LinearGradient>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
