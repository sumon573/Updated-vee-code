/**
 * SvipMockupHost — wires VeeSvipMockupScreen (the GIVEN ChatGPT mockup:
 * selected-svip-design.png main + Details + Preview) to real Vee data.
 * Server-driven: tiers/prices/privileges from svip_config (server-
 * overridden at startup), ALL art from live svip_design (hero crop of
 * the given mockup, dragon badges, nameplate). The app only shows
 * what the server says. Static only: no animations, no entry-effect
 * preview.
 *
 * PURCHASE (2026-11-08, Full SVIP): Join buys the selected tier with
 * wallet diamonds via POST /wallet/svip/purchase (svipService).
 * On success the membership refreshes via subscribeSvip and the
 * tier's svip_page rewards auto-grant. The waitlist is ONLY a
 * fallback when the purchase endpoint is unreachable.
 */
import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { getErrorCause } from '@/src/utils/errorDisplay';
import {
  subscribeSvip, joinSvipWaitlist, isOnSvipWaitlist, isSvipActive,
  formatSvipExpiry, purchaseSvip, grantSvipTierRewards, ensureSvipRewards,
  SvipState,
} from '@/src/features/svip/svipService';
import { getSvipTiers, getSvipPrivileges } from '@/src/features/svip/svipConfig';
import VeeSvipMockupScreen, {
  MockupAssets, MockupPrivilege,
} from '@/src/features/svip/VeeSvipMockupScreen';

/** Previously live nameplate art = server svip_design.privilegeImages.nameplate. */
const NAMEPLATE_FALLBACK = 'https://vee-club.duckdns.org/m/c2ce11dc076d334108e8ae2bd33bf653';

const PRIVILEGE_KEYS = ['badge', 'nameplate', 'entryEffect', 'antiKick', 'kickOut'];

type DesignNode = {
  hero?: string;
  badges?: Record<string, string>;
  privilegeImages?: Record<string, string>;
};

function mapDesign(v: DesignNode | null): MockupAssets {
  const badgeUrls: Record<number, string> = {};
  for (let t = 1; t <= 5; t++) {
    const u = v?.badges?.[`svip${t}`];
    if (u) badgeUrls[t] = u;
  }
  return {
    hero: v?.hero,
    badgeUrls,
    nameplateUrl: v?.privilegeImages?.nameplate || NAMEPLATE_FALLBACK,
  };
}

export default function SvipMockupHost() {
  const router = useRouter();
  const { user } = useAuth();
  const [svip, setSvip] = useState<SvipState | null>(null);
  const [design, setDesign] = useState<DesignNode | null>(null);
  const [onWaitlist, setOnWaitlist] = useState(false);
  const [joining, setJoining] = useState(false);
  const [selectedTier, setSelectedTier] = useState(1);

  useEffect(() => {
    if (!user?.uid) return;
    isOnSvipWaitlist(user.uid).then(setOnWaitlist).catch(() => {});
    const unsub = subscribeSvip(
      user.uid,
      (s) => {
        setSvip(s);
        // Any membership activation (fresh purchase, admin grant, or an
        // existing membership read on open) auto-grants the tier's rewards.
        void ensureSvipRewards(user.uid, s);
      },
      () => {},
    );
    return unsub;
  }, [user?.uid]);

  useEffect(() => {
    let detach: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        if (cancelled) return;
        detach = onValue(
          ref(database, 'svip_design'),
          (snap) => { if (!cancelled) setDesign(snap.val() as DesignNode | null); },
          () => {},
        );
      } catch { /* design read failure degrades to fallbacks */ }
    })();
    return () => { cancelled = true; try { detach?.(); } catch { /* non-critical */ } };
  }, []);

  const handlePurchase = async () => {
    if (!user?.uid || joining) return;
    const tier = selectedTier;
    const tierName = getSvipTiers().find((t) => t.tier === tier)?.name ?? `SVIP ${tier}`;
    setJoining(true);
    try {
      const res = await purchaseSvip(user.uid, tier);
      if (res.ok) {
        // Membership refresh arrives via subscribeSvip; grant the tier's
        // svip_page rewards now (idempotent — skips already-granted).
        await grantSvipTierRewards(user.uid, res.tier, res.expiry).catch(() => {});
        setOnWaitlist(false);
        Alert.alert(
          `Welcome to ${tierName}`,
          res.expiry
            ? `Your ${tierName} membership is active until ${formatSvipExpiry(res.expiry)}. Your rewards have been added to your collection.`
            : `Your ${tierName} membership is active. Your rewards have been added to your collection.`,
        );
      } else if (res.unavailable) {
        // Endpoint unreachable (not deployed / down): waitlist fallback only.
        await joinSvipWaitlist(user.uid);
        setOnWaitlist(true);
        Alert.alert(
          'Purchase unavailable',
          'SVIP purchase could not be reached right now. You are on the waitlist — we will notify you the moment it opens.',
        );
      } else {
        // Server reached and rejected (e.g. insufficient diamonds): show
        // the error, change nothing, no auto-retry — tap again to retry
        // (the same persisted idempotency key is reused).
        Alert.alert('Couldn\u2019t complete purchase', res.error);
      }
    } catch (e) {
      Alert.alert('Couldn\u2019t complete purchase', getErrorCause(e));
    } finally {
      setJoining(false);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.push('/profile/settings' as never);
  };

  const tiers = getSvipTiers().map((t) => ({
    tier: t.tier,
    name: t.name,
    priceDiamonds: t.priceDiamonds,
    durationDays: t.durationDays,
  }));
  const privileges: MockupPrivilege[] = getSvipPrivileges()
    .filter((p) => PRIVILEGE_KEYS.includes(p.key))
    .map((p) => ({
      key: p.key as MockupPrivilege['key'],
      minTier: p.minTier,
      enforced: p.enforced,
    }));
  const active = isSvipActive(svip);

  return (
    <VeeSvipMockupScreen
      tiers={tiers}
      privileges={privileges}
      assets={mapDesign(design)}
      activeTier={active ? svip!.tier : undefined}
      validUntilLabel={active ? formatSvipExpiry(svip!.expiry) : undefined}
      isWaitlisted={onWaitlist}
      isJoining={joining}
      onBack={handleBack}
      onJoin={handlePurchase}
      onTierChange={setSelectedTier}
    />
  );
}
