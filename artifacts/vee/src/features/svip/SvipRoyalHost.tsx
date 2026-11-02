/**
 * SvipRoyalHost — wires ChatGPT's VeeRoyalSvipScreen (draft, exact) to
 * real Vee data. Server-driven per boss order 2026-11-02: tiers/prices/
 * privileges come from svip_config (server-overridden at startup) and
 * ALL art URLs come from the live svip_design node; the app only shows
 * what the server says. Fallbacks are the previously live values only —
 * never invented URLs. Static only: no animations (boss: animations
 * come later), no entry-effect preview (no approved one-shot effect),
 * no purchase (Join stays on the waitlist, honestly labeled).
 */
import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { getErrorCause } from '@/src/utils/errorDisplay';
import {
  subscribeSvip, joinSvipWaitlist, isOnSvipWaitlist, isSvipActive,
  formatSvipExpiry, SvipState,
} from '@/src/features/svip/svipService';
import { getSvipTiers, getSvipPrivileges } from '@/src/features/svip/svipConfig';
import VeeRoyalSvipScreen, {
  VeeSvipDesignAssets, VeeSvipPrivilege,
} from '@/src/features/svip/VeeRoyalSvipScreen';

/** Previously live emblem art = server svip_design.emblems (verified equal). */
const EMBLEM_FALLBACK: Record<number, string> = {
  1: 'https://vee-club.duckdns.org/m/8548210f9c98881c7f0d3b7637510985',
  2: 'https://vee-club.duckdns.org/m/26685caf5e67ec37594177371ebb0a2b',
  3: 'https://vee-club.duckdns.org/m/948ced7d08f92b678737c698b14b0d82',
  4: 'https://vee-club.duckdns.org/m/82ad4cf07bed1854197f1aafff96037e',
  5: 'https://vee-club.duckdns.org/m/d90334ef6342798b9dd0c53e25f803ad',
};
const PRIVILEGE_FALLBACK: Partial<Record<string, string>> = {
  badge: 'https://vee-club.duckdns.org/m/25d71f45cbab97628deab84c0d4d694c',
  nameplate: 'https://vee-club.duckdns.org/m/c2ce11dc076d334108e8ae2bd33bf653',
};

const PRIVILEGE_KEYS = ['badge', 'nameplate', 'entryEffect', 'antiKick', 'kickOut'];

type DesignNode = {
  emblems?: Record<string, string>;
  badges?: Record<string, string>;
  frames?: Record<string, string>;
  privilegeImages?: Record<string, string>;
};

function mapDesign(v: DesignNode | null): VeeSvipDesignAssets {
  const byTier = (src: Record<string, string> | undefined, fb: Record<number, string> | undefined) => {
    const out: Record<number, string> = {};
    for (let t = 1; t <= 5; t++) {
      const u = src?.[`svip${t}`] || fb?.[t];
      if (u) out[t] = u;
    }
    return out;
  };
  const priv = v?.privilegeImages || {};
  const badgeImg = priv.badge || PRIVILEGE_FALLBACK.badge;
  const nameplateImg = priv.nameplate || PRIVILEGE_FALLBACK.nameplate;
  const nameplateUrls: Record<number, string> = {};
  if (nameplateImg) for (let t = 1; t <= 5; t++) nameplateUrls[t] = nameplateImg;
  const privilegeUrls: Partial<Record<string, string>> = {};
  if (badgeImg) privilegeUrls.badge = badgeImg;
  if (nameplateImg) privilegeUrls.nameplate = nameplateImg;
  return {
    emblemUrls: byTier(v?.emblems, EMBLEM_FALLBACK),
    badgeUrls: byTier(v?.badges, undefined),
    frameUrls: byTier(v?.frames, undefined),
    nameplateUrls,
    privilegeUrls: privilegeUrls as VeeSvipDesignAssets['privilegeUrls'],
  };
}

export default function SvipRoyalHost() {
  const router = useRouter();
  const { user } = useAuth();
  const [svip, setSvip] = useState<SvipState | null>(null);
  const [design, setDesign] = useState<DesignNode | null>(null);
  const [onWaitlist, setOnWaitlist] = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    isOnSvipWaitlist(user.uid).then(setOnWaitlist).catch(() => {});
    const unsub = subscribeSvip(user.uid, setSvip, () => {});
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

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.push('/profile/settings' as never);
  };

  const tiers = getSvipTiers().map((t) => ({
    tier: t.tier,
    name: t.name,
    color: t.color,
    priceDiamonds: t.priceDiamonds,
    durationDays: t.durationDays,
  }));
  const privileges: VeeSvipPrivilege[] = getSvipPrivileges()
    .filter((p) => PRIVILEGE_KEYS.includes(p.key))
    .map((p) => ({
      key: p.key as VeeSvipPrivilege['key'],
      name: p.name,
      minTier: p.minTier,
      enforced: p.enforced,
    }));
  const active = isSvipActive(svip);

  return (
    <VeeRoyalSvipScreen
      tiers={tiers}
      privileges={privileges}
      assets={mapDesign(design)}
      activeTier={active ? svip!.tier : undefined}
      validUntilLabel={active ? formatSvipExpiry(svip!.expiry) : undefined}
      isWaitlisted={onWaitlist}
      isJoining={joining}
      onBack={handleBack}
      onJoinWaitlist={handleJoin}
    />
  );
}
