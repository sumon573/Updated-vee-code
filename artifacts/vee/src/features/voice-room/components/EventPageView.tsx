/**
 * EventPageView — demo-style FULL event page (boss 2026-10-26, tap order).
 *
 * Generic: renders ANY server event demo-style from its own data — hero,
 * milestones, rules, claimed states. No per-event code, ever.
 *
 * Opened full-screen from the Task Center (replaces the sheet details).
 * Hero video is NOT used: the production build has no video native
 * module (verified in the final-build package.json — no expo-video),
 * so video would crash via OTA. The animated frame art is the alive
 * hero instead (expo-image, already in the build).
 */
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { ref, onValue, off, set } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';
import { C } from '../constants/theme';
import { TierPreview, rewardLabel, legacyRewardText } from './EventDetailsView';
import type { TaskEvent, EventTier } from '@/src/features/tasks/services/taskEventService';

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function EventPageView({ event, onBack, onClose }: { event: TaskEvent; onBack: () => void; onClose: () => void }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [minutes, setMinutes] = useState<number>(0);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [claims, setClaims] = useState<Record<string, { status?: string }>>({});
  const [claimingTier, setClaimingTier] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const tiers = event.tiers ?? [];
  const banner = event.bannerUrl || event.imageUrl;
  const rules = event.rules ?? [];
  const nickname = profileName || (user as { displayName?: string | null } | null)?.displayName || 'Vee User';

  // Progress + claims + own profile: keep last known on error (never wipe with an error).
  useEffect(() => {
    if (!uid || !event.id) return;
    const progressRef = ref(database, `event_progress/${event.id}/${uid}`);
    const claimsRef = ref(database, `event_claims/${event.id}/${uid}`);
    const profileRef = ref(database, `users/${uid}`);
    const onProgress = (snap: { val: () => unknown }) => {
      const v = snap.val() as { minutes?: unknown } | null;
      if (v && typeof v.minutes === 'number') setMinutes(v.minutes);
    };
    const onClaims = (snap: { val: () => unknown }) => {
      const v = snap.val() as Record<string, { status?: string }> | null;
      if (v && typeof v === 'object') setClaims(v);
    };
    const onProfile = (snap: { val: () => unknown }) => {
      const v = snap.val() as { name?: unknown; photoURL?: unknown } | null;
      if (v && typeof v === 'object') {
        if (typeof v.name === 'string' && v.name) setProfileName(v.name);
        if (typeof v.photoURL === 'string' && v.photoURL) setProfilePhoto(v.photoURL);
      }
    };
    onValue(progressRef, onProgress, () => { /* keep last known */ });
    onValue(claimsRef, onClaims, () => { /* keep last known */ });
    onValue(profileRef, onProfile, () => { /* keep last known */ });
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

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
          <Feather name="chevron-left" size={18} color={C.text} />
        </Pressable>
        <Text style={{ flex: 1, color: C.text, fontSize: 17, fontWeight: '800' }} numberOfLines={1}>{event.title}</Text>
        <Pressable onPress={onClose} hitSlop={10} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="x" size={16} color={C.sub} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {!!banner && (
          <View style={{ marginHorizontal: 16, height: 240, borderRadius: 20, overflow: 'hidden' }}>
            <LinearGradient colors={['#7C3AED', '#9333EA', '#C026D3']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />
            <Image
              source={{ uri: banner }}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          </View>
        )}

        <Text style={{ color: C.text, fontSize: 22, fontWeight: '800', paddingHorizontal: 16, marginTop: 14 }}>{event.title}</Text>
        {!!event.description && (
          <Text style={{ color: C.sub, fontSize: 13, paddingHorizontal: 16, marginTop: 4 }}>{event.description}</Text>
        )}
        {!!event.endTime && (
          <Text style={{ color: C.muted, fontSize: 11, fontWeight: '600', paddingHorizontal: 16, marginTop: 6 }}>
            Ends {fmtDate(event.endTime)}
          </Text>
        )}

        <Text style={{ color: C.text, fontSize: 16, fontWeight: '800', paddingHorizontal: 16, marginTop: 20, marginBottom: 10 }}>Milestones</Text>
        {tiers.length === 0 ? (
          (() => {
            const reward = legacyRewardText(event);
            return reward ? (
              <View style={{ marginHorizontal: 16, padding: 12, borderWidth: 1, borderColor: C.border, borderRadius: 14 }}>
                <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>Reward: {reward}</Text>
              </View>
            ) : null;
          })()
        ) : (
          <View style={{ paddingHorizontal: 16 }}>
            <Text style={{ color: C.text, fontSize: 13, fontWeight: '800', marginBottom: 10 }}>
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
                    borderWidth: 1, borderColor: claimed ? '#F59E0B' : C.border, borderRadius: 16,
                    padding: 12, marginBottom: 10, backgroundColor: '#FFFFFF',
                  }}
                >
                  <TierPreview tier={tier} eventImage={banner || undefined} nickname={nickname} photoURL={profilePhoto} />
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
                      {claimed ? 'Reward Claimed!' : pending ? 'Claiming…' : claimable ? 'Ready to claim' : `${remaining} min to go`}
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
            <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
              Time is counted by the server from your voice-room presence.
            </Text>
          </View>
        )}

        {rules.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '800', paddingHorizontal: 16, marginBottom: 4 }}>Event Rules</Text>
            {rules.map((rule, i) => (
              <View key={i} style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 8 }}>
                <Text style={{ color: C.muted, fontSize: 13, width: 20 }}>{i + 1}.</Text>
                <Text style={{ flex: 1, color: C.text, fontSize: 13 }}>{rule}</Text>
              </View>
            ))}
          </View>
        )}

        {!!claimError && (
          <Text style={{ color: C.red, fontSize: 12, paddingHorizontal: 16, marginTop: 12 }}>{claimError}</Text>
        )}
      </ScrollView>
    </View>
  );
}
