/**
 * NobleEntryEffect — 2026-10-20 (boss's order).
 * IMO's Fancy Entry Effect for Nobel ranks Count and above.
 *
 * Design taken from the boss's IMO screen recording (My Noble →
 * Fancy Entry Effects preview): a GOLDEN gradient banner —
 * left side = the user's circular DP + their name + "is coming..."
 * in white, right side = the rank's badge image, golden sparkle
 * accents around the banner. Slides in, sparkle burst on entry,
 * auto-dismisses after ~4 seconds.
 *
 * Only rendered for Count+ (nobleRankIndex >= 3) — matches IMO's
 * privilege order (entry effects unlock at Count).
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  NOBLE_RANKS, nobleEntryBadgeUrl, propLevelFor,
} from '@/src/services/nobleService';

/**
 * Golden sparkle burst that erupts once on mount. Shared pattern with
 * the SparkleBurst inside EntryBanner (standalone copy — this file is
 * self-contained so both code paths render identically).
 */
function SparkleBurst({ width = 280, height = 100 }: { width?: number; height?: number }) {
  const animsRef = useRef<Animated.Value[] | null>(null);
  if (animsRef.current === null) {
    animsRef.current = Array.from({ length: 14 }, () => new Animated.Value(0));
  }
  const anims = animsRef.current;
  const spotsRef = useRef<{ dx: number; dy: number; size: number; delay: number; glyph: string }[] | null>(null);
  if (spotsRef.current === null) {
    spotsRef.current = Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * Math.PI * 2 + (i % 3) * 0.22;
      const dist = 60 + (i % 4) * 24;
      return {
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist * 0.6,
        size: 10 + (i % 3) * 5,
        delay: (i % 5) * 80,
        glyph: i % 4 === 0 ? '⭐' : '✨',
      };
    });
  }
  const spots = spotsRef.current;

  useEffect(() => {
    const seqs = anims.map((a, i) =>
      Animated.sequence([
        Animated.delay(spots[i].delay),
        Animated.timing(a, { toValue: 1, duration: 750, useNativeDriver: true }),
      ]),
    );
    const all = Animated.stagger(40, seqs);
    all.start();
    return () => all.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', left: 0, top: 0, width, height,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {spots.map((s, i) => {
        const a = anims[i];
        return (
          <Animated.Text
            key={i}
            style={{
              position: 'absolute',
              fontSize: s.size,
              opacity: a.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 0] }),
              transform: [
                { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, s.dx] }) },
                { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, s.dy] }) },
                { scale: a.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.4, 1.2, 0.6] }) },
              ],
              textShadowColor: '#FFD700',
              textShadowRadius: 6,
            }}
          >
            {s.glyph}
          </Animated.Text>
        );
      })}
    </View>
  );
}

export default function NobleEntryEffect({
  name,
  photoURL,
  nobleRankIndex,
  onDismiss,
}: {
  /** The joiner's display name */
  name: string;
  /** The joiner's photo URL (optional) */
  photoURL?: string | null;
  /** Noble rank index (3-9 = Count..SSKing). Only Count+ shows this effect. */
  nobleRankIndex: number;
  /** Called when the banner should be dismissed */
  onDismiss: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(-160)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Slide in from the top
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        speed: 12,
        bounciness: 6,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-dismiss after 4s (IMO shows the effect ~4 seconds)
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -160,
          duration: 320,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 320,
          useNativeDriver: true,
        }),
      ]).start(() => onDismiss());
    }, 4000);

    return () => clearTimeout(timer);
  }, [slideAnim, opacityAnim, onDismiss]);

  // Safety: never render this premium effect below Count.
  if (nobleRankIndex < 3) return null;

  const rank = NOBLE_RANKS[nobleRankIndex];
  const badgeUrl = nobleEntryBadgeUrl(nobleRankIndex);
  const propLevel = propLevelFor(nobleRankIndex, 'entryEffects');
  const rankName = rank ? rank.name : '';
  const initials = (name || '?').trim().charAt(0).toUpperCase();

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: '8%',
        alignSelf: 'center',
        zIndex: 100,
        transform: [{ translateY: slideAnim }],
        opacity: opacityAnim,
      }}
      pointerEvents="none"
    >
      {/* Golden banner — IMO's entry design */}
      <LinearGradient
        colors={['#FFD54F', '#FFB300', '#FF8F00']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 36,
          paddingVertical: 10,
          paddingLeft: 12,
          paddingRight: 16,
          borderWidth: 2,
          borderColor: '#FFF8E1',
          shadowColor: '#FFB300',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.55,
          shadowRadius: 16,
          elevation: 10,
          minWidth: 250,
        }}
      >
        {/* DP */}
        {photoURL ? (
          <Image
            source={{ uri: photoURL }}
            style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: '#FFF8E1' }}
          />
        ) : (
          <View
            style={{
              width: 52, height: 52, borderRadius: 26,
              backgroundColor: 'rgba(255,255,255,0.4)',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 2, borderColor: '#FFF8E1',
            }}
          >
            <Text style={{ color: '#7B4E00', fontSize: 20, fontWeight: '800' }}>
              {initials}
            </Text>
          </View>
        )}
        {/* Name + "is coming..." */}
        <View style={{ marginLeft: 12, marginRight: 10 }}>
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '900' }} numberOfLines={1}>
            {name}
          </Text>
          <Text style={{ color: '#FFF8E1', fontSize: 13, fontWeight: '600' }}>
            is coming...
          </Text>
          {propLevel > 0 && (
            <Text style={{ color: '#7B4E00', fontSize: 11, fontWeight: '800', marginTop: 2 }}>
              {rankName} ★{propLevel}
            </Text>
          )}
        </View>
        {/* Rank badge image on the right */}
        {badgeUrl && /^https?:\/\//i.test(badgeUrl) ? (
          <Image
            source={{ uri: badgeUrl }}
            style={{ width: 64, height: 64 }}
            resizeMode="contain"
          />
        ) : (
          <View
            style={{
              width: 56, height: 56, borderRadius: 28,
              backgroundColor: 'rgba(255,255,255,0.35)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 28 }}>👑</Text>
          </View>
        )}
      </LinearGradient>
      {/* Sparkle burst on entry */}
      <SparkleBurst width={300} height={110} />
    </Animated.View>
  );
}
