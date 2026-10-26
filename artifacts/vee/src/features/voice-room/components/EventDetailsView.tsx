import { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { ref, onValue, off, set } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';
import { C } from '../constants/theme';
import type { TaskEvent, EventTier } from '@/src/features/tasks/services/taskEventService';

/**
 * 2026-10-26 (Event Engine v1): generic event details, rendered ENTIRELY
 * from the server event definition — no per-event client code, ever.
 *
 * Rendered INSIDE the Task Center sheet (TaskCenterModal swaps its list for
 * this view when a card is tapped). Progress comes from the bot-written
 * event_progress node; claims are client-created `pending` intents that the
 * server bot validates + grants. Nothing here decides a winner or touches
 * a wallet — the bot owns all granting.
 *
 * SERVER-ONLY LAW (boss 2026-10-26 19:49): NO app update per event, ever —
 * every tier of every event is claimable from this generic view. The server
 * bot is the sole granting authority: it grants kinds it supports and leaves
 * any other kind's claim pending (logged) until a bot-only update enables
 * that kind — so a brand-new reward kind NEVER needs an app update either.
 */

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function rewardLabel(t: EventTier): string {
  if (t.title) return t.title;
  switch (t.rewardType) {
    case 'frame': return 'Frame';
    case 'vibe': return 'Nickname effect';
    case 'ripple': return 'Room effect';
    case 'diamond': return 'Diamonds';
    case 'coin': return 'Coins';
    case 'badge': return 'Badge';
    default: return 'Reward';
  }
}

// Gentle pulsing ring for the Ripple tier preview (self-animated, no deps).
function PulseRing({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.7)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.parallel([
      Animated.timing(scale, { toValue: 1.35, duration: 1600, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 1600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [scale, opacity]);
  return (
    <Animated.View
      style={{ position: 'absolute', width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: color, transform: [{ scale }], opacity }}
    />
  );
}

// Per-tier reward preview — REAL user data only (boss law 2026-10-26:
// sample text / placeholder avatars ARE demo, never ship them).
// vibe = the viewer's OWN nickname in the server gradient tile,
// ripple = the viewer's OWN photo with the pulsing ring,
// frame = the event art overlaid on the viewer's OWN photo
// (frame art only looks right ON an avatar, never cropped in a banner).
// No photo on file = the plain circle (their real state, not a fake face).
// Other kinds: no preview.
function RealAvatar({ photoURL }: { photoURL: string | null }) {
  if (photoURL) {
    return <Image source={{ uri: photoURL }} style={{ width: 48, height: 48, borderRadius: 24 }} contentFit="cover" cachePolicy="memory-disk" />;
  }
  return (
    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="user" size={24} color="#9CA3AF" />
    </View>
  );
}

export function TierPreview({ tier, eventImage, nickname, photoURL }: { tier: EventTier; eventImage: string | undefined; nickname: string; photoURL: string | null }) {
  if (tier.rewardType === 'vibe') {
    const colors = (tier.params && Array.isArray((tier.params as { colors?: unknown }).colors))
      ? ((tier.params as { colors: string[] }).colors.filter((c) => typeof c === 'string').slice(0, 3))
      : [];
    const gradient = colors.length >= 2 ? colors : ['#F59E0B', '#EC4899', '#8B5CF6'];
    return (
      <View style={{ alignItems: 'center', paddingVertical: 10 }}>
        <LinearGradient colors={gradient as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>{nickname}</Text>
        </LinearGradient>
        <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Nickname effect</Text>
      </View>
    );
  }
  if (tier.rewardType === 'ripple') {
    const params = tier.params as { color?: unknown } | undefined;
    const color = (params && typeof params.color === 'string') ? params.color : '#F59E0B';
    return (
      <View style={{ alignItems: 'center', paddingVertical: 10 }}>
        <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }}>
          <PulseRing color={color} />
          <RealAvatar photoURL={photoURL} />
        </View>
        <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Room effect while speaking</Text>
      </View>
    );
  }
  if (tier.rewardType === 'frame' && eventImage) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 10 }}>
        <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }}>
          <RealAvatar photoURL={photoURL} />
          <Image source={{ uri: eventImage }} style={{ position: 'absolute', width: 56, height: 56 }} contentFit="contain" cachePolicy="memory-disk" />
        </View>
        <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Avatar frame</Text>
      </View>
    );
  }
  return null;
}

export function legacyRewardText(event: TaskEvent): string | null {
  if (event.rewardType === 'diamond' && event.rewardAmount) return `${event.rewardAmount} diamonds`;
  if (event.rewardType === 'coin' && event.rewardAmount) return `${event.rewardAmount} coins`;
  if (event.rewardType === 'badge') return 'Badge';
  if (event.rewardType === 'frame') return 'Frame';
  return null;
}

export function EventDetailsView({ event }: { event: TaskEvent }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [minutes, setMinutes] = useState<number>(0);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [claims, setClaims] = useState<Record<string, { status?: string }>>({});
  const [claimingTier, setClaimingTier] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const tiers = event.tiers ?? [];

  // Progress + claims + own profile: keep last known on error (never wipe with an error).
  useEffect(() => {
    if (!uid || !event.id) return;
    const progressRef = ref(database, `event_progress/${event.id}/${uid}`);
    const claimsRef = ref(database, `event_claims/${event.id}/${uid}`);
    const profileRef = ref(database, `users/${uid}`);
    const onProfile = (snap: { val: () => unknown }) => {
      const v = snap.val() as { name?: unknown; photoURL?: unknown } | null;
      if (v && typeof v === 'object') {
        if (typeof v.name === 'string' && v.name) setProfileName(v.name);
        if (typeof v.photoURL === 'string' && v.photoURL) setProfilePhoto(v.photoURL);
      }
    };
    onValue(profileRef, onProfile, () => { /* keep last known */ });
    const onProgress = (snap: { val: () => unknown }) => {
      const v = snap.val() as { minutes?: unknown } | null;
      if (v && typeof v.minutes === 'number') setMinutes(v.minutes);
    };
    const onClaims = (snap: { val: () => unknown }) => {
      const v = snap.val() as Record<string, { status?: string }> | null;
      if (v && typeof v === 'object') setClaims(v);
    };
    onValue(progressRef, onProgress, () => { /* keep last known */ });
    onValue(claimsRef, onClaims, () => { /* keep last known */ });
    return () => {
      off(progressRef, 'value', onProgress);
      off(claimsRef, 'value', onClaims);
      off(profileRef, 'value', onProfile);
    };
  }, [uid, event.id]);

  const claimTier = async (tier: EventTier) => {
    if (!uid || claimingTier) return;
    setClaimError(null);
    setClaimingTier(tier.id);
    try {
      await set(ref(database, `event_claims/${event.id}/${uid}/${tier.id}`), {
        claimedAt: Date.now(),
        status: 'pending',
      });
      // The subscription flips the row to "Claiming…" then "Claimed".
    } catch {
      setClaimError('Could not send the claim. Check your connection and try again.');
    } finally {
      setClaimingTier(null);
    }
  };

  const banner = event.bannerUrl || event.imageUrl;

  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      {!!banner && (
        <View style={{ width: '100%', height: 170, borderRadius: 18, overflow: 'hidden' }}>
          <LinearGradient colors={['#7C3AED', '#9333EA', '#C026D3']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />
          <Image
            source={{ uri: banner }}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        </View>
      )}
      <Text style={{ color: C.text, fontSize: 17, fontWeight: '800', marginTop: 12 }}>{event.title}</Text>
      {!!event.description && (
        <Text style={{ color: C.sub, fontSize: 13, marginTop: 4 }}>{event.description}</Text>
      )}
      {!!event.endTime && (
        <Text style={{ color: C.muted, fontSize: 11, fontWeight: '600', marginTop: 6 }}>
          Ends {fmtDate(event.endTime)}
        </Text>
      )}

      {tiers.length === 0 ? (
        (() => {
          const reward = legacyRewardText(event);
          return reward ? (
            <View style={{ marginTop: 14, padding: 12, borderWidth: 1, borderColor: C.border, borderRadius: 14 }}>
              <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>Reward: {reward}</Text>
            </View>
          ) : null;
        })()
      ) : (
        <View style={{ marginTop: 14 }}>
          <Text style={{ color: C.text, fontSize: 13, fontWeight: '800', marginBottom: 8 }}>
            Your time: {minutes} min
          </Text>
          {tiers.map((tier) => {
            const status = claims[tier.id]?.status;
            const claimed = status === 'granted';
            const pending = status === 'pending' || claimingTier === tier.id;
            const claimable = !claimed && !pending && minutes >= tier.minutes;
            const pct = tier.minutes > 0 ? Math.min(100, Math.floor((minutes / tier.minutes) * 100)) : 100;
            const remaining = Math.max(0, tier.minutes - minutes);
            return (
              <View
                key={tier.id}
                style={{
                  borderWidth: 1, borderColor: C.border, borderRadius: 16,
                  padding: 12, marginBottom: 10, backgroundColor: '#FFFFFF',
                }}
              >
                <TierPreview tier={tier} eventImage={banner || undefined} nickname={profileName || (user as { displayName?: string | null } | null)?.displayName || 'Vee User'} photoURL={profilePhoto} />
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '800', flex: 1 }} numberOfLines={1}>
                    {rewardLabel(tier)}
                  </Text>
                  <Text style={{ color: C.sub, fontSize: 12, fontWeight: '700', marginLeft: 8 }}>
                    {tier.minutes} min{tier.validityDays ? ` • ${tier.validityDays} days` : ''}
                  </Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: '#F3F4F6', marginTop: 8, overflow: 'hidden' }}>
                  <View
                    style={{
                      height: 6, borderRadius: 3,
                      width: `${pct}%`,
                      backgroundColor: claimed ? '#22C55E' : '#F59E0B',
                    }}
                  />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text style={{ color: C.sub, fontSize: 12 }}>
                    {claimed ? 'Claimed' : pending ? 'Claiming…' : claimable ? 'Ready to claim' : `${remaining} min to go`}
                  </Text>
                  {claimed ? (
                    <Text style={{ color: '#16A34A', fontSize: 12, fontWeight: '800' }}>Claimed ✓</Text>
                  ) : pending ? (
                    <Text style={{ color: C.muted, fontSize: 12, fontWeight: '800' }}>Claiming…</Text>
                  ) : claimable ? (
                    <Pressable
                      onPress={() => claimTier(tier)}
                      style={{
                        backgroundColor: '#F59E0B', borderRadius: 999,
                        paddingHorizontal: 16, paddingVertical: 6,
                      }}
                    >
                      <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>Claim</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
          {!!claimError && (
            <Text style={{ color: C.red, fontSize: 12, marginTop: 2 }}>{claimError}</Text>
          )}
          <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>
            Time is counted by the server from your voice-room presence.
          </Text>
        </View>
      )}
    </View>
  );
}
