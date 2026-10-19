/**
 * SvipBadge — SVIP membership badge (2026-10-19).
 *
 * Renders the SVIP tier badge next to a name, IMO style (crown + tier).
 * Reads `svip/{uid}` live; renders nothing when the user has no active SVIP.
 *
 * Usage (profile/room owners wire this in — file ownership):
 *   <SvipBadge uid={userId} size={14} />
 */
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { subscribeSvip, isSvipActive, SvipState } from './svipService';
import { SVIP_TIERS } from './svipConfig';

type Props = {
  uid: string;
  /** Font size of the badge text */
  size?: number;
};

export function useSvip(uid: string | null | undefined): SvipState | null {
  const [svip, setSvip] = useState<SvipState | null>(null);
  useEffect(() => {
    if (!uid) {
      setSvip(null);
      return;
    }
    const unsub = subscribeSvip(
      uid,
      (s) => setSvip(isSvipActive(s) ? s : null),
      () => setSvip(null),
    );
    return () => unsub();
  }, [uid]);
  return svip;
}

export default function SvipBadge({ uid, size = 12 }: Props) {
  const svip = useSvip(uid);
  if (!svip) return null;
  const tier = SVIP_TIERS.find((t) => t.tier === svip.tier) || SVIP_TIERS[0];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: tier.color + '1A',
        borderWidth: 1,
        borderColor: tier.color,
        borderRadius: 10,
        paddingHorizontal: 6,
        paddingVertical: 1,
        marginLeft: 4,
      }}
    >
      <Text style={{ fontSize: size - 2 }}>👑</Text>
      <Text style={{ fontSize: size, fontWeight: '800', color: tier.color, marginLeft: 2 }}>
        SVIP{svip.tier}
      </Text>
    </View>
  );
}
