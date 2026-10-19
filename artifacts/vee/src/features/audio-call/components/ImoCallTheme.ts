/**
 * ImoCallTheme — IMO call-screen design tokens.
 *
 * Extracted from IMO v2026.09.1051 APK (apktool-decoded resources):
 * - Answer button:  green circle #04be5a, 65dp  (drawable/a3r.xml, dimen/h5)
 * - Decline button: red circle   #fa5353, 65dp  (drawable/a7m.xml)
 * - In-call controls: CallOptView pattern — 48dp icon circle + label below
 *   (86x105dp cells)  (layout/aly.xml)
 * - Incoming/busy: full-screen blurred caller avatar bg, avatar 72dp,
 *   name 18sp white, status 14sp  (layout/alr.xml)
 * - In-call header: avatar 60dp circle + name (headline) + status (body)
 *   (layout/aly.xml)
 *
 * Vee keeps its dark theme (IMO's extracted day-theme grays don't suit Vee's
 * brand); layout structure, button colors/sizes, and control patterns are
 * IMO's. Behavior-level reference only — no IMO code reproduced.
 */

export const IMO_CALL = {
  /** Answer green (IMO a3r) */
  answerGreen: '#04be5a',
  /** Decline / end-call red (IMO a7m) */
  declineRed: '#fa5353',
  /** Primary action button diameter — IMO h5 (65dp) */
  actionSize: 65,
  /** Secondary control icon diameter — IMO CallOptView (48dp) */
  controlSize: 48,
  /** Incoming-call avatar diameter */
  incomingAvatar: 96,
  /** In-call header avatar diameter (IMO aly: 60dp; busy: 72dp) */
  inCallAvatar: 72,
  /** Dark gradient background (Vee dark theme; IMO uses a gradient bg too) */
  bgGradient: ['#1B1030', '#07020F'] as const,
  /** Muted control background */
  controlBg: 'rgba(255,255,255,0.10)',
  controlBorder: 'rgba(255,255,255,0.20)',
  text: '#FFFFFF',
  mutedText: 'rgba(255,255,255,0.55)',
  labelText: 'rgba(255,255,255,0.75)',
} as const;
