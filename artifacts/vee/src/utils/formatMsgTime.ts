/**
 * Shared DM clock formatter (2026-10-30, boss: chat-list times match
 * inbox). Moved VERBATIM from MessageBubble's local formatMsgTime so
 * thread times and list-row clocks can never drift apart again.
 *
 * Rule (boss order): use the device's own hour-cycle when it can be
 * read (Intl hour12) - 24h phone -> "15:07", 12h phone -> "3:07 PM".
 * If the device cannot report it (hour12 undefined, or Intl
 * unavailable), fall back to 12-hour, per his order. The 12h parts are
 * joined with a NON-BREAKING space so "3:26 PM" can never split
 * across lines. 24h output has no space.
 */
export function formatMsgTime(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const m = d.getMinutes().toString().padStart(2, '0');
  let hour12: boolean | undefined;
  try {
    hour12 = new Intl.DateTimeFormat().resolvedOptions().hour12;
  } catch {
    hour12 = undefined;
  }
  if (hour12 === false) {
    const h = String(d.getHours()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const h12 = d.getHours() % 12 || 12;
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  return `${h12}:${m}\u00A0${ampm}`;
}
