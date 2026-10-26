/* ─────────────────────── Music sheet theme ─────────────────────── */

import { getActiveThemes, type RoomTheme } from '../../constants/theme';

/**
 * Music sheet theme (2026-10-27, boss rule): room theme black -> sheet
 * content WHITE; room theme white -> sheet content BLACK. The sheet
 * background follows the room theme's dark/light so contrast stays
 * correct. Exactly one built-in theme is black (Midnight); every other
 * built-in theme is light — but the decision is luminance-based, so a
 * server-added dark theme also gets the dark sheet.
 */

export function resolveMusicTheme(activeThemeId: string): RoomTheme | null {
  return getActiveThemes().find((t) => t.id === activeThemeId) ?? null;
}

/** Relative luminance of a #rrggbb hex color (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function isDarkThemeBg(bg: string): boolean {
  return luminance(bg) < 0.5;
}

export interface MusicPalette {
  dark: boolean;
  bg: string;
  surface: string;
  text: string;
  sub: string;
  faint: string;
  border: string;
  blue: string;
  playBtn: string;
}

export function musicPalette(dark: boolean): MusicPalette {
  if (dark) {
    return {
      dark: true,
      bg: '#17181C',
      surface: '#23242A',
      text: '#FFFFFF',
      sub: 'rgba(255,255,255,0.62)',
      faint: 'rgba(255,255,255,0.14)',
      border: 'rgba(255,255,255,0.12)',
      blue: '#05B5FA',
      playBtn: '#26272B',
    };
  }
  return {
    dark: false,
    bg: '#FFFFFF',
    surface: '#F1F5F9',
    text: '#111827',
    sub: '#64748B',
    faint: '#EDF2F7',
    border: '#E2E8F0',
    blue: '#05B5FA',
    playBtn: '#26272B',
  };
}
