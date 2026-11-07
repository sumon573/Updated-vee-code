# Glass Rules — Vee Glassmorphism Foundation

> Design-system candidate generated through **ui-ux-pro-max** (candidate
> generation only). Status: **awaiting his pick**. Nothing here is applied
> to any screen yet; Phase 1 ships these tokens + `GlassView` in the test
> app only, and each screen's glassing waits for the implementation
> batches in `INVENTORY.md`.

## ui-ux-pro-max output contract

- **Pattern:** frosted-glass surfaces floating over the app's own
  background — cards, panels, modals, nav and chips, never full-screen
  washes. One translucent layer per surface; the backdrop (room theme,
  list, gradient) stays visible but quiet.
- **Style:** Vee's own Glass Pod, grown up (Seat Style A, boss pick
  2026-10-23). Frosted white disc logic extended to rectangles: soft
  gradient ring (sky→violet, gold for host/premium), white→pale-blue
  inner fill, top sheen, soft shadow. Premium, clean, not garish.
- **Colors:** see `glassTokens.ts` — three candidates. **A "Pod Glass"**
  (recommended, mid fills 0.45–0.72), **B "Frost Deep"** (heavy frost
  0.62–0.85, safest text), **C "Air Light"** (whisper glass 0.32–0.55,
  scrim mandatory). Light + dark tables per candidate. Accent ring
  always comes from the active room theme's `accent`, never a fixed hue.
- **Typography:** no font change. Display text keeps the platform serif
  face, body the system face (Cinzel/Manrope are not bundled in the
  app). Text on glass ALWAYS uses the active theme's `onBg` / `onBgSub`
  — the fill adapts, never the text colour. Bengali strings must reflow
  without clipping; chips/badges wrap or use a +n disclosure, never
  truncate meaning.
- **Effects:** static only. Top sheen (fixed highlight), 1px light
  border, soft shadow. **No new animations, timers, intervals or loops**
  (boss heat rule). No stacked blurs — one blur/fill layer per surface.
- **Anti-patterns:**
  - Never glass over a photo/avatar that must stay crisp (DP, story,
    gift art, frames).
  - Never put text directly on glass over a busy photo/scene without a
    scrim or a fill boost.
  - Never nest glass inside glass (fills stack into milk).
  - Never use glass as a full-screen background wash.
  - Never let a badge's meaning rely on colour alone.
  - Never invent a second glass style — the Pod is the only source.
  - Never ship a candidate to a screen without his pick.

## Adapted pre-delivery checklist (ui-ux-pro-max, filtered for Vee)

- [ ] Contrast: body text on every variant meets the bar on light,
      dark, midnight, and all 6 scene themes (fill boost / scrim applied).
- [ ] Text reflow: Bengali + long names wrap without clipping at narrow
      widths and at large text scaling.
- [ ] Chips/badges whole or +n-disclosed; meaning never colour-only.
- [ ] Reduced-motion respected (glass adds no motion at all — trivially true).
- [ ] Phone widths: radii and padding hold at 360dp and at large phones.
- [ ] No new animation, timer, interval, poll or loop introduced.
- [ ] `npx tsc` with the `types: []` gate: ZERO errors in new files.
- [ ] Phone verification on his device before any "done" claim.
- (Rejected from upstream checklist: "no emojis as icons" — boss-approved
  glossy 3D stickers stand; cursor/keyboard-focus items — web-only.)

## Where glass GOES

| Surface | Variant | Notes |
|---|---|---|
| Content cards (room cards, list rows, stat cards) | `card` | The workhorse. |
| Panels / sections inside a screen | `panel` | Slightly stronger fill than card. |
| Modals, bottom sheets, action sheets | `modal` | Strongest fill; sits over dimmed backdrop. |
| Bottom nav / tab bar / top bar | `nav` | Translucent so content ghosts beneath while scrolling. |
| Chips, pills, badges, counters | `chip` | Lightest fill; text must be short. |
| Seat discs / circular pods | `seat` | Style A pod verbatim — do not restyle seats. |

## Where glass does NOT go

- **Over photos/video that must stay crisp:** DP viewer, StoryViewer,
  story creator preview, gift art, noble/SVIP frames, decoration art.
  Glass may frame them (a glass card *around* the art) but never cover them.
- **Over gift/entry animations:** GiftAnimations, NobleEntryEffect,
  level-up celebrations — motion art stays clean.
- **Under small secondary text on a busy backdrop** without a scrim or
  fill boost (Candidate C especially).
- **Full-screen backgrounds:** glass is a surface treatment, not a theme.
- **Inside another glass surface:** nest plain Views, not GlassView.
- **On the incoming-call screen:** photo background + dark overlay is
  already the approved look (app/_layout.tsx); glass would fight it.
- **Modal backdrop:** every glass `modal` must sit over a dimmed backdrop
  (e.g. rgba(0,0,0,0.45)); the 0.72 light fill alone is not enough over a
  busy chat list. (Impeccable audit finding A2.)

## Performance rule

- Translucent fill only — **no expo-blur** (not installed; a native
  module would need a new build, forbidden by the no-more-builds rule).
  `blurIntensity` in the tokens is a forward target, not an active effect.
- One glass layer per surface max. No stacked GlassViews.
- No animation, no timer, no interval, no poll, no loop — glass is
  static styling. If a screen ever feels heavy, the fallback is a
  lighter fill (Candidate C values / lower alpha), never a new effect.
- Android: `elevation` from tokens only; iOS: shadow props from tokens
  only. Never hand-tune shadows per screen.

## Theme adaptation (summary — full rules in `glassTokens.ts`)

- App dark mode (`ThemeContext.darkMode`) picks the light/dark table.
- The 16 room themes feed `resolveGlassTheme()`: text always uses the
  theme's `onBg`/`onBgSub`; the fill adapts via `fillBoost`.
- Scene themes (6 animated): +0.15 fill opacity + text scrim.
- Very light backdrops (luminance > 0.85, e.g. imo-light #FFFFFF): +0.08.
- Midnight (the only dark room theme): dark table, light text.
- Server-added/recoloured themes work automatically — colours are
  resolved from the runtime theme object, never hardcoded by theme id.
- **No theme needs a solid fallback.** The only solid fallbacks in the
  program are the special-case screens in `INVENTORY.md` (full-screen
  photos, call screen, gift animations) — and there the fallback is
  "no glass at all", not a solid panel.

## Files

- `src/design/glassTokens.ts` — candidates A/B/C, light/dark tables,
  `resolveGlassTheme()`, `getThemedGlassTokens()`, luminance + alpha helpers.
- `src/design/GlassView.tsx` — reusable `GlassView` / `GlassCard`.
- `src/design/GLASS_RULES.md` — this file.
- `../glassmorphism/INVENTORY.md` — full screen + component inventory
  and implementation batches.
