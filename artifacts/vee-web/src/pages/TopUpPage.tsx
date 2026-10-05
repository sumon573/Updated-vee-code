/**
 * Diamond top-up page — TWO payment rails (parent-authorized spec).
 *
 *  bKash tab (manual):
 *   - Shows our bKash number (VITE_BKASH_NUMBER), 4 diamond packages with BDT
 *     prices at 1 BDT = 2 diamonds, and a TrxID input.
 *   - Claims go to POST /api/wallet/topup-bkash, which validates the TrxID
 *     format and package, dedupes by TrxID (409 on resubmission), and stores
 *     a pending claim. An admin verifies each payment in the bKash app and
 *     approves/rejects it (POST /api/wallet/topup-bkash/approve|reject);
 *     approval credits through the server's existing wallet credit path.
 *   - bKash exposes no public TrxID verification API, so the credit step
 *     stays manual by design.
 *
 *  USDT tab (TRC20, automated):
 *   - Deposit address + EXACT USDT amounts come from the server-owned
 *     GET /api/wallet/topup-config (never hardcoded, never client-computed).
 *   - A currency selector (free FX API, 12h localStorage cache) shows each
 *     package's price converted into any world currency — INDICATIVE only;
 *     payment is always in USDT (TRC20) at the server's rate. On FX failure
 *     the selector hides and USDT prices remain.
 *   - The tx hash is submitted to POST /api/wallet/topup-crypto, which
 *     verifies everything on-chain via the Tronscan public API (confirmed,
 *     ≥19 confirmations, recipient === our address, amount ≥ package) and
 *     rejects reuse of a txHash. All amounts are server-owned.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import {
  getTopupConfig,
  submitBkashClaim,
  topupCrypto,
  type TopupConfig,
} from '../features/wallet/walletService';
import {
  formatFiat,
  sortedCurrencyCodes,
  useFxRates,
} from '../features/wallet/useFxRates';

const BKASH_NUMBER: string = (import.meta.env.VITE_BKASH_NUMBER as string | undefined)?.trim() ?? '';

/**
 * bKash packages at the business rate 1 BDT = 2 diamonds.
 * Display only — the server re-validates the diamond amount.
 */
const BKASH_PACKAGES = [
  { diamonds: 100, bdt: 50 },
  { diamonds: 500, bdt: 250 },
  { diamonds: 1000, bdt: 500 },
  { diamonds: 5000, bdt: 2500 },
];

/** bKash TrxID: 10 uppercase alphanumerics (mirrors the server check). */
const BKASH_TRXID_RE = /^[0-9A-Z]{10}$/;

const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;

function CopyButton({ text, label }: { text: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {
            /* clipboard may be unavailable */
          });
      }}
    >
      {copied ? '✅ Copied' : label}
    </button>
  );
}

function BkashTab(): React.JSX.Element {
  const { user } = useAuth();
  const [pkgIdx, setPkgIdx] = useState(1);
  const [trxId, setTrxId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ trxId: string; diamonds: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pkg = BKASH_PACKAGES[pkgIdx] as { diamonds: number; bdt: number };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalized = trxId.trim().toUpperCase();
    if (!BKASH_TRXID_RE.test(normalized)) {
      setError('Enter the 10-character TrxID from your bKash payment SMS (e.g. 9HXK2L8M1Q).');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await submitBkashClaim(normalized, pkg.diamonds);
      setSubmitted({ trxId: normalized, diamonds: pkg.diamonds });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('This TrxID has already been submitted. Each payment can be claimed only once.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not submit the claim. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) {
    return (
      <div className="card">
        <p>
          Sign in to top up with bKash. <Link to="/">Go to sign-in</Link>
        </p>
      </div>
    );
  }

  if (!BKASH_NUMBER) {
    return (
      <div className="card">
        <p className="error-text">
          bKash top-up is not configured yet — our bKash number has not been set
          up. Please check back later.
        </p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="card">
        <h2>✅ Claim received!</h2>
        <p>
          An admin will verify your bKash payment and credit{' '}
          <strong>💎{submitted.diamonds.toLocaleString()}</strong>. This usually
          takes a few minutes.
        </p>
        <p className="muted small">
          Your TrxID: <code>{submitted.trxId}</code> — keep your bKash payment
          SMS until the diamonds arrive.
        </p>
        <button type="button" className="btn btn-ghost" onClick={() => { setSubmitted(null); setTrxId(''); }}>
          ← Submit a different TrxID
        </button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={(e) => void handleSubmit(e)}>
      <h2>1️⃣ Send ৳{pkg.bdt.toLocaleString()} to our bKash</h2>
      <div className="copy-row">
        <code className="big-code">{BKASH_NUMBER}</code>
        <CopyButton text={BKASH_NUMBER} label="Copy number" />
      </div>

      <h2>2️⃣ Choose a package</h2>
      <div className="pkg-grid">
        {BKASH_PACKAGES.map((p, i) => (
          <button
            key={p.diamonds}
            type="button"
            className={`pkg-cell ${i === pkgIdx ? 'pkg-cell-selected' : ''}`}
            onClick={() => setPkgIdx(i)}
          >
            <span className="pkg-diamonds">💎{p.diamonds.toLocaleString()}</span>
            <span className="pkg-price">৳{p.bdt.toLocaleString()}</span>
          </button>
        ))}
      </div>

      <h2>3️⃣ Paste the TrxID</h2>
      <label className="field">
        <span>bKash TrxID (from your payment SMS)</span>
        <input
          value={trxId}
          onChange={(e) => setTrxId(e.target.value)}
          placeholder="e.g. 9HXK2L8M1Q"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? 'Submitting…' : `Submit for 💎${pkg.diamonds.toLocaleString()}`}
      </button>
      {error && <p className="error-text">{error}</p>}
      <p className="muted small">
        Send exactly ৳{pkg.bdt.toLocaleString()} for 💎{pkg.diamonds.toLocaleString()} (1 BDT
        = 2 diamonds). bKash has no public TrxID verification API, so an admin
        verifies each payment manually before crediting.
      </p>
    </form>
  );
}

function UsdtTab(): React.JSX.Element {
  const { user } = useAuth();
  const [config, setConfig] = useState<TopupConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pkgId, setPkgId] = useState<string>('');
  const [txHash, setTxHash] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  // Indicative FX conversion for the currency selector (null = hide selector).
  const fxRates = useFxRates();
  const [currency, setCurrency] = useState('USD');

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void getTopupConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        setPkgId(cfg.packages[1]?.id ?? cfg.packages[0]?.id ?? '');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setConfigError(
          e instanceof ApiError ? e.message : 'Could not load top-up config.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const hash = txHash.trim();
    if (!TX_HASH_RE.test(hash)) {
      setResult({ ok: false, message: 'Enter a valid 64-character transaction hash.' });
      return;
    }
    if (!pkgId) {
      setResult({ ok: false, message: 'Choose a package first.' });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await topupCrypto(hash, pkgId);
      setResult({
        ok: true,
        message: `✅ Verified on-chain! 💎${res.diamonds.toLocaleString()} diamonds credited. New balance: 💎${res.newBalance.toLocaleString()}.`,
      });
      setTxHash('');
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof ApiError ? e.message : 'Top-up failed. Try again.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) {
    return (
      <div className="card">
        <p>
          Sign in to top up with USDT. <Link to="/">Go to sign-in</Link>
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <p className="muted">Loading top-up config…</p>
      </div>
    );
  }

  if (configError || !config) {
    return (
      <div className="card">
        <p className="error-text">{configError ?? 'Crypto top-up is unavailable.'}</p>
      </div>
    );
  }

  const pkg = config.packages.find((p) => p.id === pkgId);
  const currencyCodes = fxRates ? sortedCurrencyCodes(fxRates) : [];
  // Per-diamond price in the selected currency, derived from the
  // server-owned package amounts (1 USDT ≈ 1 USD for conversion).
  const perDiamondLocal =
    fxRates && pkg && pkg.diamonds > 0
      ? (pkg.usdt / pkg.diamonds) * (fxRates[currency] ?? 1)
      : null;

  return (
    <div className="card">
      <h2>1️⃣ Send USDT (TRC20) to our address</h2>
      <p className="muted small">
        TRC20 network only — low fees. Send the <strong>exact</strong> amount
        for your package.
      </p>
      <div className="copy-row">
        <code className="addr-code">{config.usdtTrc20Address}</code>
      </div>
      <CopyButton text={config.usdtTrc20Address} label="Copy address" />

      {fxRates && (
        <label className="field">
          <span>💱 Show prices in your currency</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            aria-label="Display currency"
          >
            {currencyCodes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}
      {perDiamondLocal !== null && (
        <p className="muted small">
          💎1 ≈ {formatFiat(perDiamondLocal, currency, 4)} — indicative rate.
          You always pay in <strong>USDT (TRC20)</strong> at the server&apos;s
          rate, or BDT via bKash.
        </p>
      )}

      <h2>2️⃣ Choose a package</h2>
      <div className="pkg-grid">
        {config.packages.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`pkg-cell ${p.id === pkgId ? 'pkg-cell-selected' : ''}`}
            onClick={() => setPkgId(p.id)}
          >
            <span className="pkg-diamonds">💎{p.diamonds.toLocaleString()}</span>
            <span className="pkg-price">${p.usdt} USDT</span>
            {fxRates && currency !== 'USD' && (
              <span className="muted small">
                ≈ {formatFiat(p.usdt * (fxRates[currency] ?? 1), currency)}
              </span>
            )}
          </button>
        ))}
      </div>

      <h2>3️⃣ Paste the transaction hash</h2>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <label className="field">
          <span>TRC20 transaction hash</span>
          <input
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            placeholder="64-character hex hash from your wallet"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Verifying on-chain…' : `Verify & credit 💎${pkg?.diamonds.toLocaleString() ?? ''}`}
        </button>
      </form>

      {result && <p className={result.ok ? 'success-text' : 'error-text'}>{result.message}</p>}

      <p className="muted small">
        The server verifies your transaction on the Tron blockchain (confirmed,
        ~19 confirmations, sent to our address, amount ≥ package). Underpaid or
        unconfirmed transactions are rejected — never credited partially. Each
        transaction hash can be used only once. Verification can take a minute
        after you send.
      </p>
    </div>
  );
}

export default function TopUpPage(): React.JSX.Element {
  // bKash rail is hidden for now (user request 2026-10-05). The BkashTab
  // code above is kept intact — flip this flag to re-enable the tab.
  const SHOW_BKASH_TAB = false;
  const [tab, setTab] = useState<'bkash' | 'usdt'>('usdt');

  return (
    <div className="page">
      <header className="hero">
        <h1>➕ Top up</h1>
        <p className="muted">Add diamonds to your wallet.</p>
      </header>

      {SHOW_BKASH_TAB && (
        <div className="tab-switch">
          <button
            type="button"
            className={`tab-switch-btn ${tab === 'bkash' ? 'tab-switch-active' : ''}`}
            onClick={() => setTab('bkash')}
          >
            📱 bKash
          </button>
          <button
            type="button"
            className={`tab-switch-btn ${tab === 'usdt' ? 'tab-switch-active' : ''}`}
            onClick={() => setTab('usdt')}
          >
            🪙 USDT (TRC20)
          </button>
        </div>
      )}

      {SHOW_BKASH_TAB && tab === 'bkash' ? <BkashTab /> : <UsdtTab />}

      <Link className="btn btn-ghost" to="/wallet">
        ← Back to wallet
      </Link>
    </div>
  );
}
