/**
 * SVIP Profile Screen background (2026-11-12, boss order).
 *
 * The "Profile Screen" reward (slot 5, all tiers 1–5) IS the tier's
 * Entry Effect art — a single animated WebP — shown as an animated
 * BACKGROUND in exactly two places:
 *   (1) full profile page (`app/profile/index.tsx`): cover bottom →
 *       VoiceClub Room section;
 *   (2) profile popup (`UserProfilePopup.tsx`): cover bottom → Privilege.
 *
 * Display rule — TIER-KEYED, profile OWNER's tier (not the viewer's):
 * read the owner's current SVIP tier (already subscribed on both
 * surfaces) + one-shot get of their `profileScreens/svip{tier}-
 * profile-screen` grant. Show iff the grant is held, still valid, and
 * its icon is a URL. No `activeProfileScreen` marker is kept: the
 * screen is strictly tier-bound, so a marker would go stale on a tier
 * downgrade (unlike entry effects, there is no manual choice here).
 * No SVIP tier → no effect (plain background as today).
 *
 * 2026-11-12 20:56 (boss clarification): NO "X is Coming" name/DP
 * banner — only WHICH SVIP tier it is (the gold "SVIP N" pill) + the
 * effect art itself. No name, no "is Coming" text, no DP.
 *
 * 2026-11-12 20:57 (boss quality standard — "সব কিছু স্পষ্ট"): the
 * text must stay CLEAR. The art is a background; the content sits on
 * top. The full profile's GlassView panel fill (62% white) mutes the
 * art behind the text, so the profile passes scrimOpacity 0. The
 * popup's identity block has no glass, so it passes a 0.6 white scrim
 * (the same 0.62 balance). The DP area (no text) shows the art at
 * full strength. Verified in the mockups at 45% art opacity (stronger
 * than the real 38–40%) — name, plates, chips, info, bio all legible.
 *
 * Animation: the WebP plays as encoded (T1–T4 loop=1 play-once then
 * hold the last frame; T5 dragon loop=0 infinite). ExpoImage animates
 * WebP natively. NO JS timer / interval / poll / subscription here —
 * one-shot grant read only (heat gate). If the art fails to load the
 * background stays plain (expo-image, never an emoji fallback).
 *
 * pointerEvents="none" — the background never intercepts a tap; all
 * touches pass through to the content / ScrollView below it.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { get, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { isStillValid } from '@/src/services/badgeService';

export type ProfileScreenArt = {
  artUrl: string;
  tier: number;
};

/** Grant id for a tier's Profile Screen (mirrors the entry-effect id shape). */
export function profileScreenIdForTier(tier: number): string {
  return `svip${tier}-profile-screen`;
}

/**
 * One-shot read of the profile owner's Profile Screen for their
 * CURRENT tier. Returns null when there is no SVIP tier, no grant,
 * an expired grant, or a non-URL icon. Called unconditionally at the
 * top of the profile page / popup (never below an early return).
 */
export function useProfileScreenArt(
  uid: string | null | undefined,
  tier: number | null | undefined,
  isActive: boolean,
): ProfileScreenArt | null {
  const [art, setArt] = useState<ProfileScreenArt | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!uid || !tier || tier < 1 || tier > 5 || !isActive) {
      setArt(null);
      return;
    }
    const grantId = profileScreenIdForTier(tier);
    get(ref(database, `users/${uid}/profileScreens/${grantId}`))
      .then((snap) => {
        if (cancelled) return;
        const grant = snap.val() as { icon?: unknown; validity?: unknown } | null;
        if (!grant || typeof grant.icon !== 'string' || !grant.icon.startsWith('https://')) {
          setArt(null);
          return;
        }
        if (!isStillValid(grant.validity as 'permanent' | number | undefined)) {
          setArt(null);
          return;
        }
        setArt({ artUrl: grant.icon, tier });
      })
      .catch(() => {
        if (!cancelled) setArt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, tier, isActive]);

  return art;
}

export type ProfileScreenBackgroundProps = {
  /** The tier's Profile Screen art URL (single animated WebP). */
  artUrl: string;
  /** The owner's SVIP tier (1–5) — shown in the gold pill. */
  tier: number;
  /**
   * White scrim opacity between the art and the content (0 = none).
   * Full profile passes 0 (the GlassView panel fill already mutes the
   * art behind the text); the popup passes 0.6 (no glass there).
   */
  scrimOpacity?: number;
};

/**
 * Absolute-fill background: the tier's creature art (cover) + an
 * optional white scrim + the gold "SVIP N" tier pill at the top-right
 * (8dp below the cover — the parent wrapper's top IS the cover bottom).
 * Render as the FIRST child of the region wrapper so the content sits
 * on top of it. The parent must be position:relative (the RN default).
 */
export function ProfileScreenBackground({
  artUrl,
  tier,
  scrimOpacity = 0,
}: ProfileScreenBackgroundProps): React.JSX.Element {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <ExpoImage
        source={{ uri: artUrl }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
      {scrimOpacity > 0 ? (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', opacity: scrimOpacity }]}
        />
      ) : null}
      <View
        style={{
          position: 'absolute',
          top: 8,
          right: 12,
          backgroundColor: '#E8B84B',
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 4,
        }}
      >
        <Text style={{ color: '#231A00', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 }}>
          SVIP {tier}
        </Text>
      </View>
    </View>
  );
}
