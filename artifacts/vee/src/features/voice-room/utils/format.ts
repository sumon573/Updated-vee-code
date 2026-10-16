export function fmt(ts: number) {
  const d = new Date(ts);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
}

/* 2026-10-16 (Sumon): compact lowercase k/m/b — 2000000.0M bug fixed
   (billions case was missing). Matches his 1k/10k/100k/1m/1b standard. */
export function fmtDiamonds(n: number): string {
  if (n >= 1_000_000_000) return `${parseFloat((n / 1_000_000_000).toFixed(1))}b`;
  if (n >= 1_000_000)     return `${parseFloat((n / 1_000_000).toFixed(1))}m`;
  if (n >= 1000)          return `${parseFloat((n / 1000).toFixed(1))}k`;
  return `${n}`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() >= 12 ? 'PM' : 'AM'} · ${d.getDate()}/${d.getMonth() + 1}`;
}

export function getWeekStart(): number {
  const now = new Date();
  const d   = new Date(now);
  d.setDate(now.getDate() - now.getDay()); // Sunday = start
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
