import { Text } from 'react-native';
import { formatPkScore } from '../services/roomPkService';

/* ── PkScore — clean, clearly-readable PK score ───────────────────────
 * 2026-11-11 (boss 23:00): the seven-segment LED digits are NOT clearly
 * readable — "808.6k" / "55.1k" blur together on the dark chip. Replace
 * them with plain bold text, compacted with formatPkScore (the same
 * compaction the gift cards use: "808.6k", "55.1k"). The caller picks the
 * colour (leader gold, trailer readable white/slate). No chip, no LED,
 * no animation, no timer, no hook — a pure render of the value.
 * SUPERSEDES the 2026-11-11 seven-segment LED (PkDigitalScore, deleted):
 * the boss ordered it at 21:03 ("unique + DIGITAL type", OTA 01a1cb3f)
 * and reversed it at 23:00 because the digits are hard to read. */
export function PkScore({
  value,
  size = 18,
  color = '#FFFFFF',
}: {
  /** Raw score — compacted with formatPkScore ("500", "1.2k", "808.6k"). */
  value: number;
  /** Font size in dp (banner 16, modal 24, result 22). */
  size?: number;
  /** Text colour (leader gold, trailer readable white/slate). */
  color?: string;
}) {
  return (
    <Text style={{ color, fontSize: size, fontWeight: '900', letterSpacing: 0.2 }}>
      {formatPkScore(value)}
    </Text>
  );
}
