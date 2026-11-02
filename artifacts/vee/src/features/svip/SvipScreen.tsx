/**
 * SvipScreen — Vee SVIP membership, VIP Center structure (2026-11-02).
 *
 * Dark premium look: top SVIP 1-5 tabs, big tier emblem center,
 * privilege grid below, price + Join CTA at bottom. Each level's page
 * has a DIFFERENT design, progressively more premium (SVIP 1 simplest,
 * SVIP 5 most ornate) — same structure, distinct theme per level.
 * Emblems + privilege images are Vee-original art (2026-11-02); the page
 * background is dark navy sampled from the art, so the art blends in.
 * No reference-app assets. Rules fix 2026-11-02: svip + svipWaitlist
 * nodes now exist in live rules (the page previously PERMISSION_DENIED).
 *
 * Purchase status: prices are set (boss 2026-11-02) and payment is
 * wallet diamonds, but no staging-verified SVIP purchase endpoint
 * exists yet — so Join still joins the waitlist, honestly labeled.
 * Never a fake purchase, never a direct balance write.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import PremiumLoader from '@/src/components/PremiumLoader';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/src/context/AuthContext';
import { getErrorCause } from '@/src/utils/errorDisplay';
import {
  subscribeSvip, joinSvipWaitlist, isOnSvipWaitlist,
  SvipState } from '@/src/features/svip/svipService';
import { getSvipTiers, getSvipPrivileges } from '@/src/features/svip/svipConfig';
import {
  subscribeSvipPoints, getSvipPointsHistory, formatPointsExpiry,
  SvipPointsState, SvipPointsHistoryEntry,
} from '@/src/features/svip/svipPointsService';

/** Real emblem art per tier (Vee-original, uploaded 2026-11-02, original=1). */
const SVIP_EMBLEMS: Record<number, { uri: string }> = {
  1: { uri: 'https://vee-club.duckdns.org/m/8548210f9c98881c7f0d3b7637510985' },
  2: { uri: 'https://vee-club.duckdns.org/m/26685caf5e67ec37594177371ebb0a2b' },
  3: { uri: 'https://vee-club.duckdns.org/m/948ced7d08f92b678737c698b14b0d82' },
  4: { uri: 'https://vee-club.duckdns.org/m/82ad4cf07bed1854197f1aafff96037e' },
  5: { uri: 'https://vee-club.duckdns.org/m/d90334ef6342798b9dd0c53e25f803ad' },
};
/** Honest privilege images: badge + nameplate only (other privileges are abstract). */
const PRIV_IMAGES: Record<string, { uri: string }> = {
  badge: { uri: 'https://vee-club.duckdns.org/m/25d71f45cbab97628deab84c0d4d694c' },
  nameplate: { uri: 'https://vee-club.duckdns.org/m/c2ce11dc076d334108e8ae2bd33bf653' },
};
/** Dark navy sampled from the emblem art background, so the art blends in. */
const PAGE_BG = '#130D31';
const GOLD = '#E8B84B';

function formatExpiry(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => `${x}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatPrice(n: number): string {
  return n.toLocaleString('en-US');
}

type Theme = {
  rings: number;
  dashed: boolean;
  sparkles: number;
  crown: number;
  ornaments: 'none' | 'sides' | 'divider' | 'corners' | 'full';
  max: boolean;
};

/** Per-level design — progressively more premium. Keyed by tier number. */
const TIER_THEME: Record<number, Theme> = {
  1: { rings: 1, dashed: false, sparkles: 0, crown: 110, ornaments: 'none', max: false },
  2: { rings: 2, dashed: false, sparkles: 4, crown: 120, ornaments: 'sides', max: false },
  3: { rings: 2, dashed: true, sparkles: 8, crown: 130, ornaments: 'divider', max: false },
  4: { rings: 3, dashed: false, sparkles: 12, crown: 140, ornaments: 'corners', max: false },
  5: { rings: 3, dashed: true, sparkles: 16, crown: 150, ornaments: 'full', max: true },
};

export default function SvipScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [svip, setSvip] = useState<SvipState | null>(null);
  const [loading, setLoading] = useState(true);
  const [onWaitlist, setOnWaitlist] = useState(false);
  const [joining, setJoining] = useState(false);
  const [points, setPoints] = useState<SvipPointsState | null>(null);
  const [pointsHistory, setPointsHistory] = useState<SvipPointsHistoryEntry[]>([]);
  const [selectedTier, setSelectedTier] = useState(1);

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    setLoading(true);
    isOnSvipWaitlist(user.uid).then(setOnWaitlist).catch(() => {});
    // Graceful degradation: a membership read error (e.g. stale rules) must
    // never blank the page or show raw error text — degrade to non-member
    // and still render tiers, prices, and Join.
    const unsub = subscribeSvip(
      user.uid,
      (s) => { setSvip(s); setLoading(false); },
      () => { setLoading(false); },
    );
    const unsubPoints = subscribeSvipPoints(user.uid, setPoints, () => {});
    getSvipPointsHistory(user.uid).then(setPointsHistory).catch(() => {});
    const timeout = setTimeout(() => setLoading(false), 8000);
    return () => { clearTimeout(timeout); unsub(); unsubPoints(); };
  }, [user?.uid]);

  const active = svip && svip.expiry > Date.now();
  const activeTier = active ? getSvipTiers().find((t) => t.tier === svip!.tier) : null;

  useEffect(() => {
    if (activeTier) setSelectedTier(activeTier.tier);
  }, [activeTier?.tier]);

  const handleJoin = async () => {
    if (!user?.uid || joining || onWaitlist) return;
    setJoining(true);
    try {
      await joinSvipWaitlist(user.uid);
      setOnWaitlist(true);
      Alert.alert(
        'You\u2019re on the list',
        'SVIP diamond purchase opens soon. We\u2019ll notify you the moment it\u2019s live.',
      );
    } catch (e) {
      Alert.alert('Couldn\u2019t join', getErrorCause(e));
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: PAGE_BG, alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
      </View>
    );
  }

  const tiers = getSvipTiers();
  const tier = tiers.find((t) => t.tier === selectedTier) || tiers[0];
  const theme = TIER_THEME[tier.tier] || TIER_THEME[1];
  const privs = getSvipPrivileges();
  const unlockedCount = privs.filter((p) => tier.tier >= p.minTier).length;
  const isMyTier = activeTier?.tier === tier.tier;

  return (
    <View style={{ flex: 1, backgroundColor: PAGE_BG }}>
      {/* Solid dark navy (identical stops) so the emblem art blends seamlessly. */}
      <LinearGradient
        colors={[PAGE_BG, PAGE_BG]}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingTop: 50, paddingHorizontal: 16, paddingBottom: 4 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={28} color="#FFF" />
          </Pressable>
          <Text style={{ fontSize: 26, fontWeight: '800', color: '#FFF', marginLeft: 16 }}>
            SVIP Center
          </Text>
          {activeTier ? (
            <View style={{
              marginLeft: 'auto', backgroundColor: GOLD, borderRadius: 12,
              paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#212121' }}>
                {activeTier.name} Active
              </Text>
            </View>
          ) : null}
        </View>

        {/* Tier tabs */}
        <View style={{
          flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12,
          borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' }}>
          {tiers.map((t) => {
            const sel = t.tier === selectedTier;
            return (
              <Pressable
                key={t.tier}
                onPress={() => setSelectedTier(t.tier)}
                style={{ flex: 1, alignItems: 'center', paddingBottom: 10 }}>
                <Text style={{
                  fontSize: 15, fontWeight: sel ? '800' : '600',
                  color: sel ? GOLD : 'rgba(255,255,255,0.55)' }}>
                  SVIP {t.tier}
                </Text>
                {sel ? (
                  <View style={{
                    marginTop: 8, height: 3, width: 28, borderRadius: 2,
                    backgroundColor: GOLD }} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
              {/* Emblem — real art per tier (wings/gems baked in, no drawn shapes) */}
              <View style={{ alignItems: 'center', marginTop: 26 }}>
                <ExpoImage
                  source={SVIP_EMBLEMS[tier.tier] || SVIP_EMBLEMS[1]}
                  style={{ width: 280, height: 280 }}
                  contentFit="contain"
                />
                <Text style={{ fontSize: 26, fontWeight: '800', color: '#FFF', marginTop: 10 }}>
                  {tier.name}
                  {theme.max ? (
                    <Text style={{ fontSize: 14, fontWeight: '800', color: GOLD }}>  MAX</Text>
                  ) : null}
                </Text>
                {isMyTier && active && svip ? (
                  <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4 }}>
                    Your current tier • Valid until {formatExpiry(svip.expiry)}
                  </Text>
                ) : (
                  <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4 }}>
                    {tier.durationDays}-day membership
                  </Text>
                )}
              </View>

              {/* Identification divider — privilege count for this tier */}
              <View style={{ alignItems: 'center', marginTop: 24, paddingHorizontal: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {theme.ornaments !== 'none' ? (
                    <Text style={{ color: GOLD, fontSize: 14 }}>✦</Text>
                  ) : null}
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFF' }}>
                    Privileges ({unlockedCount}/{privs.length})
                  </Text>
                  {theme.ornaments !== 'none' ? (
                    <Text style={{ color: GOLD, fontSize: 14 }}>✦</Text>
                  ) : null}
                </View>
                {theme.ornaments === 'divider' || theme.ornaments === 'corners' || theme.ornaments === 'full' ? (
                  <View style={{
                    marginTop: 10, height: 1, width: '70%',
                    backgroundColor: 'rgba(232,184,75,0.5)' }} />
                ) : null}
              </View>

              {/* Privilege grid */}
              <View style={{
                flexDirection: 'row', flexWrap: 'wrap',
                paddingHorizontal: 16, marginTop: 16 }}>
                {privs.map((priv) => {
                  const unlocked = tier.tier >= priv.minTier;
                  return (
                    <View
                      key={priv.key}
                      style={{
                        width: '30.5%', marginHorizontal: '1%', marginBottom: 12,
                        borderRadius: 14, paddingVertical: 14, paddingHorizontal: 6,
                        alignItems: 'center',
                        backgroundColor: unlocked ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                        borderWidth: 1,
                        borderColor: unlocked ? 'rgba(232,184,75,0.45)' : 'rgba(255,255,255,0.10)',
                        opacity: unlocked ? 1 : 0.55 }}>
                      {PRIV_IMAGES[priv.key] ? (
                        <ExpoImage
                          source={PRIV_IMAGES[priv.key]}
                          style={{ width: 72, height: 108 }}
                          contentFit="contain"
                        />
                      ) : (
                        <Text style={{ fontSize: 28 }}>{priv.icon}</Text>
                      )}
                      <Text style={{
                        fontSize: 12, fontWeight: '700', color: '#FFF',
                        marginTop: 8, textAlign: 'center' }}>
                        {priv.name}
                      </Text>
                      <Text style={{
                        fontSize: 11, color: unlocked ? GOLD : 'rgba(255,255,255,0.5)',
                        marginTop: 4, textAlign: 'center' }}>
                        {unlocked ? 'Unlocked' : `SVIP ${priv.minTier}+`}
                      </Text>
                      {!unlocked ? (
                        <Feather name="lock" size={13} color="rgba(255,255,255,0.5)" style={{ marginTop: 6 }} />
                      ) : null}
                    </View>
                  );
                })}
              </View>

              {/* SVIP Points — active members only (existing functionality) */}
              {active ? (
                <View style={{
                  marginHorizontal: 20, marginTop: 4, marginBottom: 6, borderRadius: 14,
                  backgroundColor: 'rgba(255,248,225,0.08)', borderWidth: 1, borderColor: 'rgba(255,224,130,0.4)',
                  padding: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontSize: 26 }}>⭐</Text>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFF' }}>
                        {points?.balance || 0} SVIP Points
                      </Text>
                      <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
                        {formatPointsExpiry(points?.expiresAt || 0)} • Points expire after 30 days
                      </Text>
                    </View>
                  </View>
                  {pointsHistory.length > 0 ? (
                    <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,224,130,0.3)', paddingTop: 8 }}>
                      {pointsHistory.slice(0, 5).map((h, i) => (
                        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }} numberOfLines={1}>
                            {h.reason}
                          </Text>
                          <Text style={{
                            fontSize: 13, fontWeight: '600',
                            color: h.amount >= 0 ? '#81C784' : '#EF9A9A' }}>
                            {h.amount >= 0 ? '+' : ''}{h.amount}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Price + Join CTA */}
              <View style={{
                paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28,
                borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', marginTop: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <DiamondIcon size={20} />
                    <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFF' }}>
                      {formatPrice(tier.priceDiamonds)}
                    </Text>
                    <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                      / {tier.durationDays} DAYS
                    </Text>
                  </View>
                </View>
                {active ? (
                  <View style={{
                    marginTop: 14, backgroundColor: 'rgba(232,245,233,0.10)', borderRadius: 14,
                    padding: 16, alignItems: 'center',
                    borderWidth: 1, borderColor: 'rgba(129,199,132,0.4)' }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#81C784' }}>
                      You are {activeTier?.name} 🎉
                    </Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={handleJoin}
                    disabled={joining || onWaitlist}
                    style={{
                      marginTop: 14, backgroundColor: GOLD, borderRadius: 24,
                      paddingVertical: 15, alignItems: 'center',
                      opacity: onWaitlist ? 0.7 : 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: '#212121' }}>
                      {joining ? 'Joining…' : onWaitlist ? 'You\u2019re on the waitlist ✓' : 'Join SVIP'}
                    </Text>
                  </Pressable>
                )}
                {!active && !onWaitlist ? (
                  <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 8, textAlign: 'center' }}>
                    Diamond purchase opens soon — join the waitlist
                  </Text>
                ) : null}
              </View>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}
