/**
 * EventPageView v2 — demo-DOM-faithful full event page (boss 2026-10-26).
 *
 * Mirrors the proposal demo's own structure (verified against the Drive
 * copy in "A Vee app file", byte-identical to the uploaded v2_2 HTML):
 * hero overlay + mini reward strip + "Part 1" horizontal milestone cards
 * (DiamondIcon progress row, Claim / Go / Claimed) + tap-to-preview modal
 * + "Reward Claimed!" celebration + 01-style rules.
 *
 * Generic: renders ANY server event from its own data. No per-event code.
 * Hero video is NOT used: the production build has no video native
 * module (verified in the final-build package.json), so video would
 * crash via OTA — the animated frame art is the alive hero instead.
 * Demo's "Go" = the way to progress: here it returns to the room, where
 * voice time is earned (server-counted).
 */
import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { ref, onValue, off, set } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';
import { C } from '../constants/theme';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { TierPreview, PulseRing, RealAvatar, rewardLabel, legacyRewardText } from './EventDetailsView';
import type { TaskEvent, EventTier } from '@/src/features/tasks/services/taskEventService';

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function vibeColors(tier: EventTier): [string, string, ...string[]] {
  const params = tier.params as { colors?: unknown } | undefined;
  const colors = params && Array.isArray(params.colors)
    ? (params.colors as unknown[]).filter((c): c is string => typeof c === 'string').slice(0, 3)
    : [];
  return (colors.length >= 2 ? colors : ['#F59E0B', '#EC4899', '#8B5CF6']) as [string, string, ...string[]];
}

function rippleColor(tier: EventTier): string {
  const params = tier.params as { color?: unknown } | undefined;
  return params && typeof params.color === 'string' ? params.color : '#F59E0B';
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
  const [previewTier, setPreviewTier] = useState<EventTier | null>(null);

  const tiers = event.tiers ?? [];
  const banner = event.bannerUrl || event.imageUrl;
  const hero = event.heroImageUrl || banner;
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

  const statusOf = (tier: EventTier) => {
    const status = claims[tier.id]?.status;
    if (status === 'granted') return 'claimed';
    if (status === 'pending' || claimingTier === tier.id) return 'pending';
    if (minutes >= tier.minutes) return 'claimable';
    return 'locked';
  };

  const miniArt = (tier: EventTier) => {
    if (tier.rewardType === 'vibe') {
      return (
        <LinearGradient colors={vibeColors(tier)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }} numberOfLines={1}>{nickname}</Text>
        </LinearGradient>
      );
    }
    if (tier.rewardType === 'ripple') {
      return (
        <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
          <PulseRing color={rippleColor(tier)} />
          <RealAvatar photoURL={profilePhoto} />
        </View>
      );
    }
    if (tier.rewardType === 'frame' && banner) {
      return <Image source={{ uri: banner }} style={{ width: 48, height: 48 }} contentFit="contain" cachePolicy="memory-disk" />;
    }
    return null;
  };

  const previewClaimed = previewTier ? statusOf(previewTier) === 'claimed' : false;

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
        {!!hero && (
          <View style={{ marginHorizontal: 16, height: 240, borderRadius: 20, overflow: 'hidden' }}>
            <LinearGradient colors={['#7C3AED', '#9333EA', '#C026D3']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />
            <Image
              source={{ uri: hero }}
              style={{ width: '100%', height: '100%' }}
              contentFit={event.heroImageUrl ? 'cover' : 'contain'}
              cachePolicy="memory-disk"
            />
            <View style={{ position: 'absolute', left: 14, right: 14, bottom: 12 }}>
              <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>Voice Time Event</Text>
              </View>
              <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '800', marginTop: 6 }}>{event.title}</Text>
              {!!event.description && (
                <Text style={{ color: '#FFFFFF', fontSize: 12, marginTop: 2, opacity: 0.92 }} numberOfLines={3}>{event.description}</Text>
              )}
            </View>
          </View>
        )}

        {tiers.length > 0 && (
          <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 12 }}>
            {tiers.map((tier) => (
              <Pressable
                key={tier.id}
                onPress={() => setPreviewTier(tier)}
                style={{ flex: 1, marginHorizontal: 4, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', backgroundColor: '#FFFFFF' }}
              >
                <View style={{ height: 52, alignItems: 'center', justifyContent: 'center' }}>{miniArt(tier)}</View>
                <Text style={{ color: C.text, fontSize: 12, fontWeight: '800', marginTop: 6, textAlign: 'center' }} numberOfLines={1}>{tier.title || rewardLabel(tier)}</Text>
                <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700', marginTop: 2 }}>{tier.minutes} min</Text>
              </Pressable>
            ))}
          </View>
        )}

        {!!event.endTime && (
          <Text style={{ color: C.muted, fontSize: 11, fontWeight: '600', paddingHorizontal: 16, marginTop: 12 }}>
            Ends {fmtDate(event.endTime)}
          </Text>
        )}

        <Text style={{ color: C.text, fontSize: 16, fontWeight: '800', paddingHorizontal: 16, marginTop: 20 }}>Part 1</Text>
        <Text style={{ color: C.sub, fontSize: 13, paddingHorizontal: 16, marginTop: 2, marginBottom: 10 }}>
          Reach time milestones and claim each limited-time reward.
        </Text>
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
            {tiers.map((tier) => {
              const st = statusOf(tier);
              const pct = tier.minutes > 0 ? Math.min(100, Math.floor((minutes / tier.minutes) * 100)) : 100;
              return (
                <Pressable
                  key={tier.id}
                  onPress={() => setPreviewTier(tier)}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    borderWidth: 1, borderColor: st === 'claimed' ? '#F59E0B' : C.border, borderRadius: 16,
                    padding: 12, marginBottom: 10, backgroundColor: '#FFFFFF',
                  }}
                >
                  <View style={{ width: 88, alignItems: 'center', justifyContent: 'center' }}>
                    <TierPreview tier={tier} eventImage={banner || undefined} nickname={nickname} photoURL={profilePhoto} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={{ color: C.text, fontSize: 14, fontWeight: '800' }} numberOfLines={1}>
                      {tier.title || rewardLabel(tier)}
                    </Text>
                    <Text style={{ color: C.sub, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {rewardLabel(tier)}{tier.validityDays ? ` · Valid for ${tier.validityDays} days` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                      <DiamondIcon size={12} />
                      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: '#F3F4F6', marginHorizontal: 6, overflow: 'hidden' }}>
                        <View style={{ height: 6, borderRadius: 3, width: `${pct}%`, backgroundColor: st === 'claimed' ? '#22C55E' : '#F59E0B' }} />
                      </View>
                      <Text style={{ color: C.sub, fontSize: 11, fontWeight: '700' }}>{Math.min(minutes, tier.minutes)} / {tier.minutes} min</Text>
                    </View>
                  </View>
                  <View style={{ marginLeft: 8, alignItems: 'center' }}>
                    {st === 'claimed' ? (
                      <Text style={{ color: '#16A34A', fontSize: 12, fontWeight: '800' }}>Claimed ✓</Text>
                    ) : st === 'pending' ? (
                      <Text style={{ color: C.muted, fontSize: 12, fontWeight: '800' }}>Claiming…</Text>
                    ) : st === 'claimable' ? (
                      <Pressable
                        onPress={() => claimTier(tier)}
                        style={{ backgroundColor: '#F59E0B', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 }}
                      >
                        <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>Claim</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={onClose}
                        style={{ borderWidth: 1, borderColor: '#F59E0B', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 6 }}
                      >
                        <Text style={{ color: '#B45309', fontSize: 12, fontWeight: '800' }}>Go</Text>
                      </Pressable>
                    )}
                  </View>
                </Pressable>
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
                <Text style={{ color: C.muted, fontSize: 13, width: 26 }}>{String(i + 1).padStart(2, '0')}</Text>
                <Text style={{ flex: 1, color: C.text, fontSize: 13 }}>{rule}</Text>
              </View>
            ))}
          </View>
        )}

        {!!claimError && (
          <Text style={{ color: C.red, fontSize: 12, paddingHorizontal: 16, marginTop: 12 }}>{claimError}</Text>
        )}
      </ScrollView>

      <Modal visible={!!previewTier} animationType="fade" transparent onRequestClose={() => setPreviewTier(null)}>
        <Pressable onPress={() => setPreviewTier(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Pressable onPress={() => { /* keep modal open on card tap */ }} style={{ width: '100%', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 4 }}>
              <Text style={{ flex: 1, color: C.text, fontSize: 16, fontWeight: '800' }} numberOfLines={1}>Reward Preview</Text>
              <Pressable onPress={() => setPreviewTier(null)} hitSlop={10} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="x" size={15} color={C.sub} />
              </Pressable>
            </View>
            {previewTier && (
              <>
                <TierPreview tier={previewTier} eventImage={banner || undefined} nickname={nickname} photoURL={profilePhoto} />
                <Text style={{ color: C.text, fontSize: 15, fontWeight: '800', marginTop: 2 }}>
                  {previewTier.title || rewardLabel(previewTier)}
                </Text>
                <Text style={{ color: C.sub, fontSize: 12, marginTop: 2 }}>
                  {rewardLabel(previewTier)}{previewTier.validityDays ? ` · Valid for ${previewTier.validityDays} days` : ''}
                </Text>
                {previewClaimed ? (
                  <View style={{ marginTop: 12, backgroundColor: '#FEF3C7', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, width: '100%', alignItems: 'center' }}>
                    <Text style={{ color: '#92400E', fontSize: 14, fontWeight: '800' }}>Reward Claimed!</Text>
                    <Text style={{ color: '#92400E', fontSize: 12, marginTop: 2 }}>Your reward has been unlocked.</Text>
                  </View>
                ) : statusOf(previewTier) === 'claimable' ? (
                  <Pressable
                    onPress={() => { claimTier(previewTier); }}
                    style={{ marginTop: 12, backgroundColor: '#F59E0B', borderRadius: 999, paddingHorizontal: 24, paddingVertical: 8 }}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>Claim</Text>
                  </Pressable>
                ) : statusOf(previewTier) === 'pending' ? (
                  <Text style={{ color: C.muted, fontSize: 12, fontWeight: '800', marginTop: 12 }}>Claiming…</Text>
                ) : (
                  <Text style={{ color: C.sub, fontSize: 12, marginTop: 12 }}>
                    {Math.max(0, previewTier.minutes - minutes)} min to go
                  </Text>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
