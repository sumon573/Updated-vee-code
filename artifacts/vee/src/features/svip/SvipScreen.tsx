/**
 * SvipScreen — Vee SVIP membership (IMO SVIP style, 2026-10-19).
 *
 * IMO's SVIP = paid premium membership with svip_level, badge icon,
 * nameplate icon, entry effects, kick-out/anti-kick privileges, SVIP points.
 * Vee SVIP: 3 tiers, RTDB-backed (admin-granted until payment is decided).
 *
 * Privilege honesty: enforced privileges show active; stubbed ones show
 * locked with their TODO — nothing is displayed that neither works nor is
 * explained.
 *
 * ⚠️ BOSS DECISIONS PENDING: pricing per tier + payment method.
 * Until decided, "Become SVIP" joins a waitlist (real RTDB write).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Image } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/src/context/AuthContext';
import { getErrorCause } from '@/src/utils/errorDisplay';
import {
  subscribeSvip, joinSvipWaitlist, isOnSvipWaitlist,
  SvipState, hasSvipPrivilege } from '@/src/features/svip/svipService';
import { SVIP_TIERS, SVIP_PRIVILEGES } from '@/src/features/svip/svipConfig';
import {
  subscribeSvipPoints, getSvipPointsHistory, formatPointsExpiry,
  SvipPointsState, SvipPointsHistoryEntry,
} from '@/src/features/svip/svipPointsService';

const SVIP_CROWN = { uri: 'https://vee-club.duckdns.org/nobel-art/crown-ssking.png' };

function formatExpiry(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => `${x}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SvipScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [svip, setSvip] = useState<SvipState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onWaitlist, setOnWaitlist] = useState(false);
  const [joining, setJoining] = useState(false);
  const [points, setPoints] = useState<SvipPointsState | null>(null);
  const [pointsHistory, setPointsHistory] = useState<SvipPointsHistoryEntry[]>([]);

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    isOnSvipWaitlist(user.uid).then(setOnWaitlist).catch(() => {});
    const unsub = subscribeSvip(
      user.uid,
      (s) => { setSvip(s); setLoading(false); },
      (e) => { setError(getErrorCause(e)); setLoading(false); },
    );
    const unsubPoints = subscribeSvipPoints(user.uid, setPoints, () => {});
    getSvipPointsHistory(user.uid).then(setPointsHistory).catch(() => {});
    const timeout = setTimeout(() => setLoading(false), 8000);
    return () => { clearTimeout(timeout); unsub(); unsubPoints(); };
  }, [user?.uid]);

  const handleBecomeSvip = async () => {
    if (!user?.uid || joining || onWaitlist) return;
    setJoining(true);
    try {
      await joinSvipWaitlist(user.uid);
      setOnWaitlist(true);
      Alert.alert(
        'You\u2019re on the list',
        'SVIP membership opens soon. We\u2019ll notify you the moment pricing and payment are live.',
      );
    } catch (e) {
      Alert.alert('Couldn\u2019t join', getErrorCause(e));
    } finally {
      setJoining(false);
    }
  };

  const active = svip && svip.expiry > Date.now();
  const activeTier = active ? SVIP_TIERS.find((t) => t.tier === svip!.tier) : null;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12,
        borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={28} color="#000" />
        </Pressable>
        <Text style={{ fontSize: 28, fontWeight: '700', color: '#000', marginLeft: 16 }}>
          SVIP
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {error ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Text style={{ color: '#D32F2F', fontSize: 14 }}>{error}</Text>
          </View>
        ) : (
          <>
            {/* Hero — IMO SVIP header style */}
            <LinearGradient
              colors={activeTier ? [activeTier.color, '#212121'] : ['#B0BEC5', '#607D8B']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ margin: 20, borderRadius: 20, padding: 22, alignItems: 'center' }}
            >
              <Image source={SVIP_CROWN} style={{ width: 64, height: 64 }} resizeMode="contain" />
              <Text style={{ fontSize: 26, fontWeight: '800', color: '#fff', marginTop: 8 }}>
                {activeTier ? activeTier.name : 'Vee SVIP'}
              </Text>
              {active && svip ? (
                <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 6 }}>
                  Valid until {formatExpiry(svip.expiry)}
                </Text>
              ) : (
                <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 6, textAlign: 'center' }}>
                  The premium club for Vee\u2019s most dedicated members.
                </Text>
              )}
            </LinearGradient>

            {/* SVIP Points — IMO integral model: points expire, spent on kick-outs */}
            {active && (
              <View style={{
                marginHorizontal: 20, marginBottom: 10, borderRadius: 14,
                backgroundColor: '#FFF8E1', borderWidth: 1, borderColor: '#FFE082',
                padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 26 }}>⭐</Text>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#212121' }}>
                      {points?.balance || 0} SVIP Points
                    </Text>
                    <Text style={{ fontSize: 12, color: '#8E8E93', marginTop: 2 }}>
                      {formatPointsExpiry(points?.expiresAt || 0)} • Points expire after 30 days
                    </Text>
                  </View>
                </View>
                {pointsHistory.length > 0 && (
                  <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#FFE082', paddingTop: 8 }}>
                    {pointsHistory.slice(0, 5).map((h, i) => (
                      <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                        <Text style={{ fontSize: 13, color: '#616161' }} numberOfLines={1}>
                          {h.reason}
                        </Text>
                        <Text style={{
                          fontSize: 13, fontWeight: '600',
                          color: h.amount >= 0 ? '#2E7D32' : '#D32F2F' }}>
                          {h.amount >= 0 ? '+' : ''}{h.amount}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Tier selector */}
            <Text style={{
              fontSize: 17, fontWeight: '700', color: '#212121',
              paddingHorizontal: 20, marginBottom: 10 }}>
              Membership tiers
            </Text>
            {SVIP_TIERS.map((tier) => {
              const isMine = activeTier?.tier === tier.tier;
              return (
                <View key={tier.tier} style={{
                  marginHorizontal: 20, marginBottom: 10, borderRadius: 14,
                  borderWidth: isMine ? 2 : 1,
                  borderColor: isMine ? tier.color : '#E0E0E0',
                  padding: 14, flexDirection: 'row', alignItems: 'center',
                  backgroundColor: isMine ? '#FFF8E1' : '#fff' }}>
                  <Image source={SVIP_CROWN} style={{ width: 40, height: 40 }} resizeMode="contain" />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#212121' }}>
                      {tier.name}{isMine ? '  •  Active' : ''}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#8E8E93', marginTop: 2 }}>
                      {tier.durationDays}-day membership
                    </Text>
                  </View>
                  {tier.priceDiamonds > 0 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <DiamondIcon size={15} />
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#007AFF' }}>
                        {tier.priceDiamonds}
                      </Text>
                    </View>
                  ) : (
                    <Text style={{ fontSize: 12, color: '#BDBDBD' }}>Price soon</Text>
                  )}
                </View>
              );
            })}

            {/* Privileges */}
            <Text style={{
              fontSize: 17, fontWeight: '700', color: '#212121',
              paddingHorizontal: 20, marginTop: 10, marginBottom: 10 }}>
              SVIP privileges
            </Text>
            {SVIP_PRIVILEGES.map((priv) => {
              const unlocked = hasSvipPrivilege(svip, priv.key);
              const reachable = activeTier != null && activeTier.tier >= priv.minTier;
              const locked = !unlocked;
              return (
                <View key={priv.key} style={{
                  marginHorizontal: 20, marginBottom: 8, borderRadius: 12,
                  backgroundColor: locked ? '#FAFAFA' : '#fff',
                  borderWidth: 1, borderColor: '#E0E0E0',
                  padding: 12, flexDirection: 'row', alignItems: 'center',
                  opacity: locked ? 0.55 : 1 }}>
                  <Text style={{ fontSize: 26 }}>{priv.icon}</Text>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#212121' }}>
                      {priv.name}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#8E8E93', marginTop: 2 }}>
                      {locked
                        ? `Requires ${SVIP_TIERS.find((t) => t.tier === priv.minTier)?.name || 'higher tier'}`
                        : reachable && !priv.enforced
                          ? 'Coming soon — activates here when it ships.'
                          : 'Active'}
                    </Text>
                  </View>
                  {locked ? (
                    <Feather name="lock" size={16} color="#BDBDBD" />
                  ) : (
                    <Feather name="check-circle" size={18} color="#4CAF50" />
                  )}
                </View>
              );
            })}

            {/* CTA */}
            <View style={{ padding: 20 }}>
              {active ? (
                <View style={{
                  backgroundColor: '#E8F5E9', borderRadius: 14, padding: 16, alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#2E7D32' }}>
                    You are {activeTier?.name} 🎉
                  </Text>
                </View>
              ) : (
                <Pressable
                  onPress={handleBecomeSvip}
                  disabled={joining || onWaitlist}
                  style={{
                    backgroundColor: '#E3F2FD', borderRadius: 14, padding: 16, alignItems: 'center',
                    opacity: onWaitlist ? 0.7 : 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#007AFF' }}>
                    {joining ? 'Joining…' : onWaitlist ? 'You\u2019re on the waitlist ✓' : 'Become SVIP'}
                  </Text>
                  {!onWaitlist && (
                    <Text style={{ fontSize: 12, color: '#007AFF', marginTop: 4, opacity: 0.8 }}>
                      Pricing opens soon — join the waitlist
                    </Text>
                  )}
                </Pressable>
              )}
            </View>
            <View style={{ height: 24 }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
