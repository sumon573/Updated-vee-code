/**
 * Diamond top-up page — TWO payment rails (parent-authorized spec).
 *
 *  bKash tab (manual):
 *   - Shows our bKash number (VITE_BKASH_NUMBER), 4 diamond packages with BDT
 *     prices (display only), and a TrxID input.
 *   - MVP has NO backend verification (bKash exposes no public TrxID API) and
 *     the client CANNOT store the claim in RTDB: database.rules.json sets
 *     root `.read: false, .write: false` and defines NO `topups` node, so any
 *     client write is denied. The page therefore stores NOTHING and says so
 *     honestly — the user is told to send the TrxID to our bKash number via
 *     WhatsApp/SMS so an admin can verify and credit manually.
 *
 *  USDT tab (TRC20, automated):
 *   - Deposit address + EXACT USDT amounts come from the server-owned
 *     GET /api/wallet/topup-config (never hardcoded, never client-computed).
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
  topupCrypto,
  type TopupConfig,
} from '../features/wallet/walletService';

const BKASH_NUMBER: string = (import.meta.env.VITE_BKASH_NUMBER as string | undefined)?.trim() ?? '';

/** Display-only bKash packages (BDT prices are indicative; admin confirms). */
const BKASH_PACKAGES = [
  { diamonds: 100, bdt: 120 },
  { diamonds: 500, bdt: 550 },
  { diamonds: 1000, bdt: 1050 },
  { diamonds: 5000, bdt: 5000 },
];

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
  const [pkgIdx, setPkgIdx] = useState(1);
  const [trxId, setTrxId] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pkg = BKASH_PACKAGES[pkgIdx] as { diamonds: number; bdt: number };

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!trxId.trim()) {
      setError('Please paste the bKash TrxID from your payment SMS.');
      return;
    }
    setError(null);
    // Nothing is written anywhere: RTDB rules deny client writes to any
    // top-up path, and there is no bKash verification API. The confirmation
    // below tells the user exactly what to do next.
    setSubmitted(true);
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
        <h2>📝 Next step — manual verification</h2>
        <p>
          <strong>Your claim was NOT recorded automatically.</strong> The server
          does not accept top-up claims from the app yet, so nothing was sent
          anywhere.
        </p>
        <p>
          To complete your top-up of <strong>💎{pkg.diamonds}</strong>, send
          your TrxID to our bKash number on <strong>WhatsApp/SMS</strong> — an
          admin will verify the payment and credit your diamonds.
        </p>
        <label className="field">
          <span>bKash number</span>
          <div className="copy-row">
            <code>{BKASH_NUMBER}</code>
            <CopyButton text={BKASH_NUMBER} label="Copy" />
          </div>
        </label>
        <label className="field">
          <span>Your TrxID</span>
          <div className="copy-row">
            <code>{trxId.trim()}</code>
            <CopyButton text={trxId.trim()} label="Copy" />
          </div>
        </label>
        <button type="button" className="btn btn-ghost" onClick={() => setSubmitted(false)}>
          ← Submit a different TrxID
        </button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>1️⃣ Send BDT to our bKash</h2>
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
        />
      </label>
      <button type="submit" className="btn btn-primary">
        Submit TrxID
      </button>
      {error && <p className="error-text">{error}</p>}
      <p className="muted small">
        bKash has no public TrxID verification API, so an admin verifies each
        payment manually before crediting. Prices shown are indicative.
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
  const [tab, setTab] = useState<'bkash' | 'usdt'>('bkash');

  return (
    <div className="page">
      <header className="hero">
        <h1>➕ Top up</h1>
        <p className="muted">Add diamonds to your wallet.</p>
      </header>

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

      {tab === 'bkash' ? <BkashTab /> : <UsdtTab />}

      <Link className="btn btn-ghost" to="/wallet">
        ← Back to wallet
      </Link>
    </div>
  );
}
