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
export const ROOM_THEMES: { id: string; name: string; accent: string; bg: string; surface: string; onBg: string; onBgSub: string }[] = [
  { id: 'imo-light', name: '💙 IMO Light', accent: '#05b5fa', bg: '#FFFFFF', surface: '#F1F5F9', onBg: '#111827', onBgSub: '#64748B' },
  { id: 'ocean',    name: '🌊 Ocean',       accent: '#0284C7', bg: '#E0F2FE', surface: '#F0F9FF', onBg: '#0C4A6E', onBgSub: '#0369A1' },
  { id: 'forest',   name: '🌿 Forest',      accent: '#16A34A', bg: '#DCFCE7', surface: '#F0FDF4', onBg: '#14532D', onBgSub: '#15803D' },
  { id: 'cherry',   name: '🌸 Cherry',      accent: '#DB2777', bg: '#FCE7F3', surface: '#FDF2F8', onBg: '#500724', onBgSub: '#9D174D' },
  { id: 'sunset',   name: '🌅 Sunset',      accent: '#EA580C', bg: '#FFEDD5', surface: '#FFF7ED', onBg: '#431407', onBgSub: '#9A3412' },
  { id: 'galaxy',   name: '💜 Lavender',    accent: '#7C3AED', bg: '#EDE9FE', surface: '#F5F3FF', onBg: '#2E1065', onBgSub: '#5B21B6' },
  { id: 'desert',   name: '🏜️ Desert',     accent: '#D97706', bg: '#FEF3C7', surface: '#FFFBEB', onBg: '#451A03', onBgSub: '#92400E' },
  { id: 'rose',     name: '🌹 Rose',        accent: '#E11D48', bg: '#FFE4E6', surface: '#FFF1F2', onBg: '#4C0519', onBgSub: '#9F1239' },
  { id: 'aurora',   name: '🍃 Mint',        accent: '#059669', bg: '#D1FAE5', surface: '#ECFDF5', onBg: '#022C22', onBgSub: '#065F46' },
  { id: 'midnight', name: '🖤 Midnight',   accent: '#3B82F6', bg: '#050506', surface: '#101114', onBg: '#F8FAFC', onBgSub: '#94A3B8' },
];
