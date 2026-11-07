/**
 * GlassView — the single reusable glass surface for Vee.
 *
 * Applies glassTokens (translucent fill + light border + top sheen +
 * soft shadow) around `children`. Works on iOS and Android: iOS shadow
 * props + Android `elevation` both come from the tokens.
 *
 * BLUR: this component deliberately does NOT use expo-blur — it is not
 * installed, and adding it would need a native rebuild (forbidden by the
 * boss's no-more-builds rule). The frosted look comes from the
 * translucent fill over whatever sits behind the surface. If a future
 * build ever allows real blur, add it behind this same API (a `blur`
 * prop) — callers must not change.
 *
 * PERFORMANCE (boss standing order): static styling only. No timers,
 * no intervals, no animations, no per-frame JS. One translucent layer
 * per surface max — never nest GlassView inside GlassView (the fills
 * stack into milk). The sheen is a plain absolutely-positioned View.
 *
 * USAGE:
 *   <GlassView variant="card" mode="light">
 *     <Text>...</Text>
 *   </GlassView>
 *   // Room screen, scene theme: pass the resolved theme so fills boost.
 *   <GlassView variant="modal" resolved={resolveGlassTheme(theme, darkMode)}>
 *     ...
 *   </GlassView>
 */

import React from 'react';
import { View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import {
  getGlassTokens,
  getThemedGlassTokens,
  type GlassCandidateId,
  type GlassMode,
  type GlassVariant,
  type ResolvedGlass,
} from './glassTokens';

export type GlassViewProps = {
  variant?: GlassVariant;
  /** 'light' | 'dark'. Defaults to 'light' (app default is light mode). */
  mode?: GlassMode;
  /** Token candidate A (default) | B | C — switch only on his pick. */
  candidate?: GlassCandidateId;
  /**
   * Pre-resolved theme (from resolveGlassTheme). When given, it wins
   * over `mode`/`candidate` and its fillBoost is applied.
   */
  resolved?: ResolvedGlass;
  /**
   * Accent ring tint for the border (e.g. the room theme accent).
   * Off by default — most glass uses the plain light border.
   */
  accentBorder?: string | null;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  testID?: string;
};

export function GlassView({
  variant = 'card',
  mode = 'light',
  candidate = 'A',
  resolved,
  accentBorder = null,
  style,
  children,
  testID,
}: GlassViewProps): React.JSX.Element {
  const tokens = resolved
    ? getThemedGlassTokens(resolved, variant)
    : getGlassTokens(variant, mode, candidate);

  /* Two-layer structure (audit catch — see GLASS_REVIEW.md finding A1):
     iOS clips a view's own shadow when overflow is 'hidden', so the
     OUTER view carries ONLY the shadow + radius (no overflow clipping)
     and the INNER view carries the fill / border / sheen with
     overflow 'hidden'. Android elevation lives on the outer view too. */
  return (
    <View
      testID={testID}
      style={[
        {
          borderRadius: tokens.borderRadius,
          shadowColor: tokens.shadowColor,
          shadowOpacity: tokens.shadowOpacity,
          shadowRadius: tokens.shadowRadius,
          shadowOffset: { width: 0, height: tokens.shadowOffsetY },
          elevation: tokens.elevation,
        },
        style,
      ]}
    >
      <View
        style={{
          /* flexGrow (not flex:1) so the inner layer fills an explicit
             outer height yet still sizes to content when height is auto. */
          flexGrow: 1,
          backgroundColor: tokens.fill,
          borderColor: accentBorder ?? tokens.border,
          borderWidth: tokens.borderWidth,
          borderRadius: tokens.borderRadius,
          overflow: 'hidden',
        }}
      >
        {/* Top-edge inner highlight — the Glass Pod "sheen", static. */}
        <View
          pointerEvents="none"
          style={[
            styles.sheen,
            {
              backgroundColor: tokens.sheen,
              borderRadius: tokens.borderRadius >= 999 ? 999 : 8,
            },
          ]}
        />
        {children}
      </View>
    </View>
  );
}

/** Convenience alias — same component, card-first naming for callers. */
export const GlassCard = GlassView;

const styles = StyleSheet.create({
  sheen: {
    position: 'absolute',
    top: 3,
    left: 9,
    right: 9,
    height: 13,
  },
});
