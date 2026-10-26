import { useState, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
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
 * v1 claim gating (locked in DESIGN.md): only frame/vibe/ripple tiers are
 * claimable. Any other reward type renders as "Soon" — the bot never grants
 * money from this path.
 */

const CLAIMABLE_TYPES = new Set(['frame', 'vibe', 'ripple']);

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function rewardLabel(t: EventTier): string {
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

function legacyRewardText(event: TaskEvent): string | null {
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
  const [claims, setClaims] = useState<Record<string, { status?: string }>>({});
  const [claimingTier, setClaimingTier] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const tiers = event.tiers ?? [];

  // Progress + claims: keep last known on error (never wipe with an error).
  useEffect(() => {
    if (!uid || !event.id) return;
    const progressRef = ref(database, `event_progress/${event.id}/${uid}`);
    const claimsRef = ref(database, `event_claims/${event.id}/${uid}`);
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
        <Image
          source={{ uri: banner }}
          style={{ width: '100%', height: 140, borderRadius: 18, backgroundColor: C.card }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
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
        <View style={{ marginTop: 14, padding: 12, borderWidth: 1, borderColor: C.border, borderRadius: 14 }}>
          {(() => {
            const reward = legacyRewardText(event);
            return reward ? (
              <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>Reward: {reward}</Text>
            ) : (
              <Text style={{ color: C.sub, fontSize: 13 }}>Details for this event will appear here.</Text>
            );
          })()}
        </View>
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
            const supported = CLAIMABLE_TYPES.has(tier.rewardType);
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
                  ) : !supported ? (
                    <Text style={{ color: C.muted, fontSize: 12, fontWeight: '800' }}>Soon</Text>
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
