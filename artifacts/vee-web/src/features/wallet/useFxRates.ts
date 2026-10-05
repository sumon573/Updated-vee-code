import { useEffect, useState } from 'react';

/**
 * USD-based FX rates for the top-up currency selector.
 *
 * Source: https://open.er-api.com/v6/latest/USD (free, no key, CORS-enabled).
 * Rates are cached in localStorage for 12 hours so the selector works
 * instantly on repeat visits and we don't hammer the free API.
 *
 * Returns null when rates are unavailable (fetch failed / still loading) —
 * callers must hide the currency selector and keep showing USDT prices.
 * Conversions are INDICATIVE only: payment is always in USDT (TRC20) at the
 * server's rate, or BDT via bKash.
 */

const FX_API_URL = 'https://open.er-api.com/v6/latest/USD';
const FX_CACHE_KEY = 'vee-fx-cache';
const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

type FxCache = { fetchedAt: number; rates: Record<string, number> };

function readCache(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FxCache>;
    if (
      !parsed ||
      typeof parsed.fetchedAt !== 'number' ||
      !parsed.rates ||
      typeof parsed.rates !== 'object'
    ) {
      return null;
    }
    if (Date.now() - parsed.fetchedAt > FX_CACHE_TTL_MS) return null;
    return parsed.rates;
  } catch {
    return null;
  }
}

function writeCache(rates: Record<string, number>): void {
  try {
    const payload: FxCache = { fetchedAt: Date.now(), rates };
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable — non-critical */
  }
}

function sanitizeRates(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, number> = { USD: 1 };
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      typeof code === 'string' &&
      /^[A-Z]{3}$/.test(code) &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0
    ) {
      out[code] = value;
    }
  }
  return Object.keys(out).length > 1 ? out : null;
}

/** USD→target FX rates, or null when unavailable. Never throws. */
export function useFxRates(): Record<string, number> | null {
  const [rates, setRates] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache();
    if (cached) {
      setRates(cached);
      return;
    }
    void fetch(FX_API_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (cancelled) return;
        const body = data as { result?: unknown; rates?: unknown } | null;
        if (!body || body.result !== 'success') return;
        const clean = sanitizeRates(body.rates);
        if (!clean) return;
        writeCache(clean);
        setRates(clean);
      })
      .catch(() => {
        /* FX unavailable — caller hides the selector, USDT prices stay */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return rates;
}

/**
 * Format a fiat amount in the given ISO currency code.
 * Falls back to a plain "amount CODE" string for unknown codes.
 */
export function formatFiat(
  amount: number,
  currency: string,
  maxDecimals = 2,
): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: maxDecimals,
    }).format(amount);
  } catch {
    return `${amount.toFixed(Math.min(maxDecimals, 2))} ${currency}`;
  }
}

/** Popular currencies pinned to the top of the selector, then alphabetical. */
const PINNED_CURRENCIES = [
  'USD',
  'BDT',
  'EUR',
  'GBP',
  'INR',
  'PKR',
  'SAR',
  'AED',
  'MYR',
  'SGD',
  'CAD',
  'AUD',
];

/** Full sorted currency list for the dropdown, popular ones first. */
export function sortedCurrencyCodes(
  rates: Record<string, number>,
): string[] {
  const codes = Object.keys(rates);
  const pinned = PINNED_CURRENCIES.filter((c) => codes.includes(c));
  const rest = codes.filter((c) => !pinned.includes(c)).sort();
  return [...pinned, ...rest];
}
