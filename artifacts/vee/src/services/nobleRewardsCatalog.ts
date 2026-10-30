/**
 * Nobel Rewards Catalog — 2026-10-15 (Sumon).
 *
 * CENTRAL REGISTRY for all Nobel rank rewards. When Sumon provides designs,
 * plug the CDN URLs into the `designUrl` slots below — the grant functions,
 * Decoration page, and display components all read from here.
 *
 * Design slots:
 * - nameplate: image URL for the nameplate design
 * - badge: image URL for the badge design (goes to Honor section)
 * - frame: image URL for the frame design
 * - ripple: config for the speaking ripple (colors + particle)
 * - entryEffect: image/config for the room-entry animation
 *
 * Until a design is provided, the `fallbackIcon` (emoji) is used.
 * NEVER ship a reward with neither designUrl nor fallbackIcon.
 */

export interface RewardDesign {
  /** CDN URL (jsDelivr) — set when Sumon provides the design */
  designUrl?: string;
  /** Emoji fallback until design arrives — NEVER remove */
  fallbackIcon: string;
  /** Extra config (e.g. ripple colors) */
  config?: Record<string, unknown>;
  /** Mist animation color — set for Viscount+ nameplates (2026-10-15 Sumon) */
  mistColor?: string;
}

export interface RankRewards {
  rankKey: string;
  rankName: string;
  rankColor: string;
  nameplate: RewardDesign;
  badge: RewardDesign | null;      // null = this rank has no badge
  frame: RewardDesign | null;      // null = this rank has no frame
  ripple: RewardDesign | null;     // null = this rank has no ripple
  entryEffect: RewardDesign | null; // null = this rank has no entry effect
}

export const NOBLE_REWARDS_CATALOG: RankRewards[] = [
  {
    rankKey: 'knight', rankName: 'Knight', rankColor: '#8BC34A',
    nameplate: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-plate-knight.png?v=2',
      fallbackIcon: '🎖️',
    },
    badge: null,
    frame: {
      // 2026-10-21 (Sumon): demo frame design removed — no frame design until a real one is provided.
      fallbackIcon: '🖼️',
    },
    ripple: null, entryEffect: null,
  },
  {
    rankKey: 'baron', rankName: 'Baron', rankColor: '#26A69A',
    nameplate: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-plate-baron.png?v=2',
      fallbackIcon: '🎖️',
    },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-baron.png?v=2',
      fallbackIcon: '👑',
    },
    frame: {
      // 2026-10-21 (Sumon): demo frame design removed — no frame design until a real one is provided.
      fallbackIcon: '🖼️',
    },
    ripple: null, entryEffect: null,
  },
  {
    rankKey: 'viscount', rankName: 'Viscount', rankColor: '#42A5F5',
    nameplate: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-plate-viscount.png?v=2',
      fallbackIcon: '🎖️',
      mistColor: '#BBDEFB', // 2026-10-15 (Sumon): mist animation starts from Viscount
    },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-viscount.png?v=2',
      fallbackIcon: '👑',
    },
    frame: {
      // 2026-10-21 (Sumon): demo frame design removed — no frame design until a real one is provided.
      fallbackIcon: '🖼️',
    },
    ripple: null, entryEffect: null,
  },
  {
    rankKey: 'count', rankName: 'Count', rankColor: '#7E57C2',
    nameplate: {
      fallbackIcon: '🎖️',
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-plate-count.png?v=2',
      mistColor: '#CE93D8',
    },
    badge: {
      fallbackIcon: '👑',
      designUrl: 'https://vee-club.duckdns.org/m/7edbae418a07678f4ad94771a47eb3ef',
    },
    frame: {
      fallbackIcon: '🖼️',
      // 2026-10-31 (boss): Count animated leaf frame (server parity).
      designUrl: 'https://vee-club.duckdns.org/m/a9c749f2d2c978b62a9faccc19d80278',
      config: { seatScale: 1.44, seatDy: 0.04 },
    },
    ripple: { fallbackIcon: '✨', config: { colors: ['#7E57C2', '#FFD700'] } }, entryEffect: null,
  },
  {
    rankKey: 'marquis', rankName: 'Marquis', rankColor: '#EC407A',
    nameplate: {
      // 2026-10-24 (Sumon): FINAL Marquis nameplate — his own supplied art
      // (dark plate, gold borders, crown with purple gem, flowing purple
      // satin ribbons, purple gems), fully animated INSIDE the plate only
      // (ribbons flow, gold sheen, gems glow; the word stays stable).
      // v2 = faster tempo (3 cycles/4s) per his note. Approved final
      // 2026-10-24 ("nameplate এটাই ফাইনাল"). Animated WebP on VPS static.
      designUrl: 'https://vee-club.duckdns.org/static/nameplates/marquis-nameplate-v2.webp',
      fallbackIcon: '🎖️',
    },
    badge: {
      // 2026-10-24 (Sumon): Marquis badge is STATIC — no animation
      // ("Badge এ কোনো অ্যানিমেশন দরকার নাই, শুধু badge"). The v1 animated
      // WebP (1600x1600, 2.96MB) also failed to load in the small badge
      // slots on his phone. v2 = the same locked design A "Heraldic" art
      // (burgundy enamel disc, rose-gold riveted rim, gold fleur-de-lis)
      // as a 512x512 lossless static WebP (256KB) on the VPS static host.
      designUrl: 'https://vee-club.duckdns.org/static/badges/marquis-badge-v2.webp',
      fallbackIcon: '👑',
    },
    frame: {
      // 2026-10-23 (Sumon): FINAL Marquis frame — his own fantasy design
      // (violet plumes + gold crest), animated slow upward sway, all vines
      // moving, gold frozen. Approved by Sumon as final ("এটাই ফাইনাল").
      // Animated WebP on the VPS static host (expo-image renders it animated).
      designUrl: 'https://vee-club.duckdns.org/static/frames/marquis-frame-v5.webp',
      config: { seatScale: 1.44, seatDy: 0 },
      fallbackIcon: '🖼️',
    },
    ripple: null,
    entryEffect: {
      // 2026-10-24 (Sumon): FINAL Marquis entry effect — his own supplied
      // banner art (purple/gold, gem shield emblem), the WHOLE box animated
      // (arrival sweep + dazzle glints + gem brilliance, ~4s loop). The
      // entrant's live DP fills the left gold-ring socket and their live
      // name fills the name slot — EntryBanner composites both over this
      // clean art. Approved final 2026-10-24 ("entry effect এটাই ফাইনাল").
      designUrl: 'https://vee-club.duckdns.org/static/entry/marquis-entry-v2.webp',
      fallbackIcon: '✨',
    },
  },
  {
    rankKey: 'duke', rankName: 'Duke', rankColor: '#FF7043',
    nameplate: { fallbackIcon: '🎖️' },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-duke.png?v=2',
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-duke.png?v=2',
      config: { seatScale: 1.44, seatDy: 0 },
      fallbackIcon: '🖼️',
    },
    ripple: null,
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'royalDuke', rankName: 'Royal Duke', rankColor: '#FFA000',
    nameplate: { fallbackIcon: '🎖️' },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-royalduke.png?v=2',
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-royalduke.png?v=2',
      config: { seatScale: 1.44, seatDy: 0 },
      fallbackIcon: '🖼️',
    },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#FFA000', '#FF8F00'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'king', rankName: 'King', rankColor: '#FBC02D',
    nameplate: { fallbackIcon: '🎖️' },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-king.png?v=2',
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-king.png?v=2',
      config: { seatScale: 1.44, seatDy: 0 },
      fallbackIcon: '🖼️',
    },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#FBC02D', '#F9A825'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
];

/**
 * Get the display icon for a reward — design URL if provided, else fallback.
 * Usage: <Image source={{uri: rewardIcon(design)}} /> or <Text>{rewardIcon(design)}</Text>
 */
export function rewardIcon(design: RewardDesign): string {
  return design.designUrl || design.fallbackIcon;
}

/**
 * 2026-10-24 (Sumon): NEVER show a demo/fallback picture for a granted item
 * whose real design exists. A grant's stored `icon` is a copy made at grant
 * time — if the design arrived later (or the granting client ran a stale
 * catalog), the stored icon stays an emoji forever and list screens showed
 * that emoji as a big "demo" picture (his Decoration screenshot, Marquis
 * Frame showing 🖼️ while the real frame art existed on the server).
 * Display surfaces resolve art HERE instead: a stored URL wins; otherwise
 * the ACTIVE (server-merged) catalog's designUrl for the item's rank slot;
 * the stored icon is used only when no design exists anywhere.
 */
/**
 * 2026-10-24 (Sumon): Nobel rewards must load FAST. Warm the image cache
 * with a rank's reward art in the background so the profile nameplate,
 * seat frames and room entry effect appear instantly — never a wait.
 * Best-effort and fire-and-forget at call sites.
 */
export async function prefetchNobleRankArt(rankKey: string): Promise<void> {
  try {
    const entry = rewardsForRankKey(rankKey);
    if (!entry) return;
    const urls = [entry.badge, entry.frame, entry.nameplate, entry.entryEffect]
      .map((d) => d?.designUrl)
      .filter((u): u is string => !!u);
    if (!urls.length) return;
    const { Image } = await import('expo-image');
    await Promise.all(urls.map((u) => Image.prefetch(u).catch(() => false)));
  } catch {
    // Warm-up is best-effort — display paths still load on demand.
  }
}

export function resolveGrantedArt(
  itemId: string | undefined,
  storedIcon: string | undefined,
): string {
  if (storedIcon && /^https?:\/\//i.test(storedIcon)) return storedIcon;
  if (itemId) {
    const m = /^noble-(badge|frame|plate|ripple|effect)-(.+)$/.exec(itemId);
    if (m) {
      const entry = rewardsForRankKey(m[2]);
      const slot =
        m[1] === 'badge' ? entry?.badge :
        m[1] === 'frame' ? entry?.frame :
        m[1] === 'plate' ? entry?.nameplate :
        m[1] === 'ripple' ? entry?.ripple :
        entry?.entryEffect;
      if (slot?.designUrl) return slot.designUrl;
    }
  }
  return storedIcon ?? '';
}

/**
 * Get rewards for a rank index (0-9). Returns null for invalid index.
 */
export function rewardsForRank(rankIndex: number): RankRewards | null {
  return getActiveCatalog()[rankIndex] ?? null;
}

/* ─────────────────────────────────────────────────────────────
 * 2026-10-17 (Sumon): SERVER-DRIVEN Nobel rewards.
 * Admin sets rewards in Firebase `nobel_rewards/{rankKey}` — designUrl,
 * fallbackIcon, etc. App fetches once at startup, caches in memory.
 * If server is unreachable, falls back to the hardcoded catalog above.
 * After this, Sumon can add/change rank rewards via Firebase — no build needed.
 *
 * 2026-10-24 (Sumon): FULL server-driven setup. The complete catalog is
 * published to RTDB `nobel_rewards` (all 10 ranks). Exact shape:
 *   nobel_rewards/{rankKey} = {
 *     rankName?, rankColor?,
 *     nameplate: RewardDesign, badge: RewardDesign|null,
 *     frame: RewardDesign|null, ripple: RewardDesign|null,
 *     entryEffect: RewardDesign|null,
 *   }
 *   RewardDesign = { designUrl?, fallbackIcon, config?, mistColor? }
 * Merge is PER-FIELD (see mergeRewardDesign): any field the server omits
 * falls back to the hardcoded slot, and `config` merges key-by-key — so a
 * server update that only swaps a designUrl can NEVER drop the fit config
 * (frame seatScale/seatDy) that makes the art sit exactly in its slot.
 * Setting a slot to explicit null removes that reward for the rank.
 * ───────────────────────────────────────────────────────────── */

let serverCatalog: RankRewards[] | null = null;
let serverLoadAttempted = false;

/**
 * Merge one reward slot: server fields win, omitted fields fall back to the
 * hardcoded slot; `config` merges key-by-key so partial server updates keep
 * the fit config. Explicit null clears the slot; undefined keeps the base.
 */
export function mergeRewardDesign(
  base: RewardDesign | null,
  override: unknown,
): RewardDesign | null {
  if (override === undefined) return base;
  if (override === null) return null;
  if (typeof override !== 'object') return base;
  const o = override as Partial<RewardDesign>;
  if (!base) {
    // New design where the hardcoded catalog has none (e.g. adding a
    // designUrl to a slot that only had a fallback icon, or a whole new
    // slot) — the server object stands on its own but must carry a
    // fallbackIcon per the catalog rule; default it if absent.
    const standalone = { ...(o as RewardDesign) };
    if (!standalone.fallbackIcon) standalone.fallbackIcon = '🎖️';
    return standalone;
  }
  const merged: RewardDesign = { ...base, ...o };
  const baseCfg = (base.config ?? {}) as Record<string, unknown>;
  const overCfg = (o.config ?? {}) as Record<string, unknown>;
  const cfg = { ...baseCfg, ...overCfg };
  if (Object.keys(cfg).length > 0) merged.config = cfg;
  else delete merged.config;
  return merged;
}

/** Get the active catalog: server (if loaded) else hardcoded fallback. */
export function getActiveCatalog(): RankRewards[] {
  return serverCatalog ?? NOBLE_REWARDS_CATALOG;
}

/** Find rewards by rank key from the active catalog. */
export function rewardsForRankKey(rankKey: string): RankRewards | null {
  const catalog = getActiveCatalog();
  // 2026-10-20 FIX (boss: noble frame missing on voice-room seats): exact
  // match first, then a case-insensitive match. Two key conventions
  // coexist — NOBLE_RANKS / catalog rankKey 'royalDuke' vs the item/asset
  // id suffix 'royalduke' (designUrls, admin-granted ids). A frame id in
  // the other convention's case resolved to NO entry, and callers fell
  // back to full-size frame art (Avatar seat ring) or lost designUrls.
  return (
    catalog.find((r) => r.rankKey === rankKey) ??
    catalog.find((r) => r.rankKey.toLowerCase() === rankKey.toLowerCase()) ??
    null
  );
}

/**
 * Load server Nobel rewards from Firebase. Call once at app startup.
 * Non-blocking — falls back to hardcoded if fetch fails.
 */
export async function loadServerNobleRewards(force = false): Promise<void> {
  if (serverLoadAttempted && !force) return;
  serverLoadAttempted = true;
  try {
    const { ref, get } = await import('firebase/database');
    const { database } = await import('../config/firebase');
    const snap = await get(ref(database, 'nobel_rewards'));
    if (!snap.exists()) return;
    const data = snap.val();
    const catalog: RankRewards[] = [];
    // Preserve rank order from hardcoded catalog
    for (const base of NOBLE_REWARDS_CATALOG) {
      const override = data[base.rankKey];
      if (override) {
        catalog.push({
          rankKey: base.rankKey,
          rankName: override.rankName || base.rankName,
          rankColor: override.rankColor || base.rankColor,
          nameplate: mergeRewardDesign(base.nameplate, override.nameplate) ?? base.nameplate,
          badge: mergeRewardDesign(base.badge, override.badge),
          frame: mergeRewardDesign(base.frame, override.frame),
          ripple: mergeRewardDesign(base.ripple, override.ripple),
          entryEffect: mergeRewardDesign(base.entryEffect, override.entryEffect),
        });
      } else {
        catalog.push(base);
      }
    }
    serverCatalog = catalog;
  } catch {
    // Fallback to hardcoded — non-critical
  }
}
