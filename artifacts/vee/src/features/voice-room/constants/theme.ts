/* ─────────────────────────── Design tokens ─────────────────────────── */
/* 2026-10-20 (boss): IMO-LIGHT palette — "Imo মতো সাদা হবে". The whole
   voice-room feature renders on white; every consumer of C in this
   feature (room screen, seats, chat, sheets) follows these tokens. */
export const C = {
  bg:          '#FFFFFF',
  card:        '#F1F5F9',
  border:      '#E2E8F0',
  borderFaint: '#EDF2F7',
  primary:     '#05b5fa',
  gold:        '#F59E0B',
  text:        '#111827',
  sub:         '#64748B',
  muted:       '#94A3B8',
  mic:         '#22C55E',
  red:         '#EF4444',
  pink:        '#EC4899',
  inputBg:     '#F1F5F9',
} as const;

/* ─────────────────────────── Room metadata ─────────────────────────── */
export const ROOM_META = { id: '123456', name: 'Royal Lounge', type: 'Public' };
export const MAX_SEATS = 10;

/* ─────────────────────────── Themes ─────────────────────────────────
   2026-10-21 (boss): "একটা theme শুধু রাখো যেনো black হয়, তাছাড়া বাকি
   গুলো change করলে seat এর কালার, বাটন গুলোর কালার, মেসেজ — সব change
   হবে।" Exactly ONE black theme (Midnight); every other theme is a real
   LIGHT color scheme. (The old list was 16 near-black clones — changing
   theme just repainted the room black with a different accent tint.)
   Each theme exposes:
   - accent : primary glow / border / button color (seats, buttons, chat)
   - bg     : screen background
   - surface: card / panel background (a step lighter than bg)
   - onBg   : text color for elements sitting directly on bg
   - onBgSub: secondary text color on bg
   These are applied throughout the room screen so changing themes feels
   like a full premium repaint, not just a border-color swap.
─────────────────────────────────────────────────────────────────────── */
/* 2026-10-23 (boss): SCENE themes — an animated scene lives in the room
   BACKGROUND only (AnimatedThemeBackground, zIndex 0). Seats, DPs, chat,
   buttons and every text render on top of it and are never covered. */
export type SceneKind = 'ocean' | 'cherry' | 'sunset' | 'rain' | 'snow' | 'valley';

export type RoomTheme = {
  id: string; name: string; accent: string; bg: string; surface: string;
  onBg: string; onBgSub: string; scene?: SceneKind;
};

export const ROOM_THEMES: RoomTheme[] = [
  { id: 'imo-light', name: '💙 Light', accent: '#05b5fa', bg: '#FFFFFF', surface: '#F1F5F9', onBg: '#111827', onBgSub: '#64748B' },
  { id: 'ocean',    name: '🌊 Ocean',       accent: '#0284C7', bg: '#E0F2FE', surface: '#F0F9FF', onBg: '#0C4A6E', onBgSub: '#0369A1' },
  { id: 'forest',   name: '🌿 Forest',      accent: '#16A34A', bg: '#DCFCE7', surface: '#F0FDF4', onBg: '#14532D', onBgSub: '#15803D' },
  { id: 'cherry',   name: '🌸 Cherry',      accent: '#DB2777', bg: '#FCE7F3', surface: '#FDF2F8', onBg: '#500724', onBgSub: '#9D174D' },
  { id: 'sunset',   name: '🌅 Sunset',      accent: '#EA580C', bg: '#FFEDD5', surface: '#FFF7ED', onBg: '#431407', onBgSub: '#9A3412' },
  { id: 'galaxy',   name: '💜 Lavender',    accent: '#7C3AED', bg: '#EDE9FE', surface: '#F5F3FF', onBg: '#2E1065', onBgSub: '#5B21B6' },
  { id: 'desert',   name: '🏜️ Desert',     accent: '#D97706', bg: '#FEF3C7', surface: '#FFFBEB', onBg: '#451A03', onBgSub: '#92400E' },
  { id: 'rose',     name: '🌹 Rose',        accent: '#E11D48', bg: '#FFE4E6', surface: '#FFF1F2', onBg: '#4C0519', onBgSub: '#9F1239' },
  { id: 'aurora',   name: '🍃 Mint',        accent: '#059669', bg: '#D1FAE5', surface: '#ECFDF5', onBg: '#022C22', onBgSub: '#065F46' },
  { id: 'midnight', name: '🖤 Midnight',   accent: '#3B82F6', bg: '#050506', surface: '#101114', onBg: '#F8FAFC', onBgSub: '#94A3B8' },
  /* Scene themes (boss picked all 6, 2026-10-23 — previews v3):
     Ocean Waves, Cherry Blossom, Golden Sunset, Rainy Day, Snowfall,
     Rainbow Valley. Palettes stay light enough that onBg text keeps full
     contrast over the scene's sky area. */
  { id: 'scene-ocean',  name: '🌊 Ocean Waves',    accent: '#0284C7', bg: '#7DD3FC', surface: '#F0F9FF', onBg: '#082F49', onBgSub: '#075985', scene: 'ocean' },
  { id: 'scene-cherry', name: '🌸 Cherry Blossom', accent: '#DB2777', bg: '#FCE7F3', surface: '#FDF2F8', onBg: '#500724', onBgSub: '#9D174D', scene: 'cherry' },
  { id: 'scene-sunset', name: '🌇 Golden Sunset',   accent: '#EA580C', bg: '#FDBA74', surface: '#FFF7ED', onBg: '#431407', onBgSub: '#7C2D12', scene: 'sunset' },
  { id: 'scene-rain',   name: '🌧️ Rainy Day',      accent: '#0369A1', bg: '#94A3B8', surface: '#F1F5F9', onBg: '#0F172A', onBgSub: '#1E293B', scene: 'rain' },
  { id: 'scene-snow',   name: '❄️ Snowfall',       accent: '#7C6FB8', bg: '#A8BCE0', surface: '#EFF6FF', onBg: '#1E2A4A', onBgSub: '#3B4A7A', scene: 'snow' },
  { id: 'scene-valley', name: '🌈 Rainbow Valley', accent: '#16A34A', bg: '#BAE6FD', surface: '#F0FDF4', onBg: '#052E16', onBgSub: '#166534', scene: 'valley' },
];
