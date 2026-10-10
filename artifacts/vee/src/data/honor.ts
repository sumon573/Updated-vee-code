/**
 * Honor — shared badge/nameplate types.
 *
 * NOTE 7 (2026-10-11): ALL demo/placeholder badges removed per Sumon's order.
 * Badges are granted ONLY officially (by admin) or claimed from special
 * events — they live in users/{uid}/badges in Firebase. There is no local
 * achievement catalog anymore. The Honor section shows an empty state until
 * real badges exist.
 *
 * NOTE 8/9 (2026-10-11): the demo NAMEPLATES catalog was removed per Sumon's
 * order — nameplates are granted ONLY officially or claimed from special
 * events and live in users/{uid}/nameplates in Firebase (see badgeService).
 * This module now only carries shared types.
 *
 * Used by:
 *  - app/profile/index.tsx (Honor section preview)
 *  - app/profile/honor.tsx (Honor detail screen: Badge / Nameplate tabs)
 *  - app/profile/decoration.tsx (nameplate catalog)
 *  - src/services/badgeService.ts (official grant / event claim)
 */

export interface HonorStats {
  roomsHosted: number;
  totalGifts: number;
  followers: number;
  following: number;
  level: number;
}

export interface Achievement {
  id: string;
  icon: string;
  label: string;
  /** Human-readable unlock condition, e.g. "Host 5 rooms" */
  requirement: string;
  isUnlocked: (s: HonorStats) => boolean;
}

/**
 * Real badge granted officially or claimed from a special event.
 * Stored at users/{uid}/badges/{badgeId} in Firebase.
 */
export interface GrantedBadge {
  id: string;
  name: string;
  icon: string;
  /** Epoch ms when the badge was granted/claimed */
  obtainedAt: number;
  /** 'permanent' or epoch ms expiry — visible to the badge owner only */
  validity: 'permanent' | number;
  /** 'official' → Verification section, 'event' → Achievement section */
  source?: 'official' | 'event';
  /** "How to get this badge" text shown in the detail view */
  description?: string;
  grantedBy?: string;
  howToGet?: string;
}

export interface NameplateDef {
  id: string;
  name: string;
  icon: string;
  requirement: string;
}
