/**
 * Seat stickers (2026-10-23, Sumon's own list: 👍 😂 😍 😡 😯 👋 🫣 🤔).
 *
 * DESIGNED animated artwork — glossy 3D characters on a TRANSPARENT
 * background (no plate/disc, his explicit call), rendered as animated
 * WebP and served from the VPS static host exactly like gift/frame art:
 *   https://vee-club.duckdns.org/static/stickers/<id>.webp
 *
 * The reaction broadcast and the chat echo both carry the sticker id
 * (e.g. 'stk_laugh'); every client resolves id → artwork here.
 */
export type StickerDef = { id: string; emoji: string };

const STICKER_BASE = 'https://vee-club.duckdns.org/static/stickers';

/** Order = Sumon's message order (2026-10-23). */
export const STICKERS: StickerDef[] = [
  { id: 'stk_thumb', emoji: '👍' },
  { id: 'stk_laugh', emoji: '😂' },
  { id: 'stk_love', emoji: '😍' },
  { id: 'stk_angry', emoji: '😡' },
  { id: 'stk_wow', emoji: '😯' },
  { id: 'stk_wave', emoji: '👋' },
  { id: 'stk_peek', emoji: '🫣' },
  { id: 'stk_think', emoji: '🤔' },
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

export function stickerUrl(id: string): string | null {
  return BY_ID.has(id) ? `${STICKER_BASE}/${id}.webp` : null;
}

export function isStickerText(text: string): boolean {
  return BY_ID.has(text);
}

/** Human label for reply previews etc. — never show the raw id. */
export function stickerLabel(id: string): string {
  return BY_ID.get(id)?.emoji ?? id;
}
