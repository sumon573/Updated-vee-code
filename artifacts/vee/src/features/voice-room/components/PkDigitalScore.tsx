import { View, Text } from 'react-native';
import { formatPkScore } from '../services/roomPkService';

/* ─────────────────────── Digital PK score ─────────────────────── */

/**
 * PkDigitalScore — a seven-segment LED score counter (2026-11-11, boss:
 * polish the PK counter, unique + DIGITAL type). The score is drawn as
 * seven-segment digits on a dark LCD chip — no new font, no new native
 * module, no new asset. (The app loads fonts via @expo-google-fonts/inter
 * in app/_layout.tsx, so a digital font would need an npm install + a
 * root-layout change + bundle weight; the drawn style is self-contained
 * and the most literal "digital".) Unlit segments stay faintly visible
 * (real LED ghost). The compacted score is rendered char by char:
 * digits -> segments, '.' -> dot, 'k'/'m' -> small text suffix.
 *   0=abcdef 1=bc 2=abdeg 3=abcdg 4=bcfg 5=acdfg 6=acdefg 7=abc
 *   8=abcdefg 9=abcdfg
 * Leader = gold segments, trailer = cool white/cyan (the caller picks
 * the color). No animation, no timer, no hook — a pure render of the
 * value. (RN has no box-shadow, so the per-segment LED glow in the
 * mockup is not reproduced — the segment shapes + dark chip carry the
 * digital look, and skipping shadows keeps a gift storm cheap.)
 */
const SEG_MAP: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

// Segment geometry as fractions of the digit box (W x H).
const SEG_GEO: Record<string, { l: number; t: number; w: number; h: number }> = {
  a: { l: 0.15, t: 0, w: 0.7, h: 0.11 },
  g: { l: 0.15, t: 0.445, w: 0.7, h: 0.11 },
  d: { l: 0.15, t: 0.89, w: 0.7, h: 0.11 },
  f: { l: 0, t: 0.06, w: 0.12, h: 0.38 },
  b: { l: 0.88, t: 0.06, w: 0.12, h: 0.38 },
  e: { l: 0, t: 0.56, w: 0.12, h: 0.38 },
  c: { l: 0.88, t: 0.56, w: 0.12, h: 0.38 },
};

const SEG_ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

export function PkDigitalScore({
  value,
  digitHeight = 18,
  color = '#FFFFFF',
  dimColor = 'rgba(255,255,255,0.05)',
}: {
  /** Raw score — compacted with formatPkScore ("500", "1.2k", "1.5m"). */
  value: number;
  /** Digit height in dp (banner 18, modal 24, result 20). */
  digitHeight?: number;
  /** Lit-segment colour (leader gold, trailer cool white/cyan). */
  color?: string;
  /** Unlit-segment colour (faint LED ghost). */
  dimColor?: string;
}) {
  const text = formatPkScore(value);
  const w = Math.round(digitHeight * 0.58);
  const t = Math.max(2, Math.round(digitHeight * 0.13));
  const dotSize = Math.max(3, Math.round(t * 1.2));
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0B0B14',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.14)',
        borderRadius: 7,
        paddingHorizontal: 7,
        paddingVertical: 3,
      }}>
      {text.split('').map((ch, i) => {
        if (ch === '.') {
          return (
            <View
              key={`dot-${i}`}
              style={{
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                backgroundColor: color,
                alignSelf: 'flex-end',
                marginBottom: 1,
              }}
            />
          );
        }
        if (ch === 'k' || ch === 'm') {
          return (
            <Text
              key={`suf-${i}`}
              style={{ color, fontSize: Math.round(digitHeight * 0.62), fontWeight: '900', marginLeft: 2 }}>
              {ch}
            </Text>
          );
        }
        const lit = SEG_MAP[ch] ?? '';
        return (
          <View key={`d-${i}`} style={{ width: w, height: digitHeight, position: 'relative' }}>
            {SEG_ORDER.map((s) => {
              const g = SEG_GEO[s];
              const on = lit.includes(s);
              return (
                <View
                  key={s}
                  style={{
                    position: 'absolute',
                    left: g.l * w,
                    top: g.t * digitHeight,
                    width: g.w * w,
                    height: g.h * digitHeight,
                    borderRadius: t / 2,
                    backgroundColor: on ? color : dimColor,
                  }}
                />
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
