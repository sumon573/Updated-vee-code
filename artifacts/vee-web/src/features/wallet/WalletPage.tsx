/**
 * Wallet page: live diamond balance, transaction history,
 * and a link to the top-up page.
 *
 * Balance comes from the RTDB subscription `wallets/{uid}/balance` (live);
 * the wallet is created (500 diamonds) via POST /api/wallet/init on first
 * view when the node is absent — handled inside subscribeBalance.
 *
 * 2026-10-19 (Sumon): gift sending was REMOVED from this page. HARD RULE —
 * gifts may be sent ONLY inside voice rooms; the public /wallet page must
 * never offer out-of-room gifting. GiftPanel now requires a roomId and is
 * only embedded in room/admin contexts.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { getTransactions, subscribeBalance, type WalletTransaction } from './walletService';

export default function WalletPage(): React.JSX.Element {
  const { user, loading } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);

  useEffect(() => {
    if (loading || !user) return;
    return subscribeBalance(user.uid, setBalance);
  }, [loading, user]);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    void getTransactions(user.uid)
      .then((txs) => {
        if (!cancelled) setTransactions(txs);
      })
      .catch(() => {
        /* non-critical — history stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user, balance]);

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <div className="card">
          <p>
            Sign in to see your wallet. <Link to="/">Go to sign-in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>💎 Wallet</h1>
        <p className="muted">Your diamonds and gift balance.</p>
      </header>

      <div className="card wallet-balance-card">
        <span className="muted">Diamond balance</span>
        <strong className="wallet-balance">💎 {balance === null ? '…' : balance.toLocaleString()}</strong>
        <Link className="btn btn-primary" to="/topup">
          ➕ Top up diamonds
        </Link>
      </div>

      <div className="card">
        <h2>Recent activity</h2>
        {transactions.length === 0 ? (
          <p className="muted">No transactions yet.</p>
        ) : (
          <ul className="tx-list">
            {transactions.map((tx) => (
              <li key={tx.id} className="tx-row">
                <span className="tx-emoji">{tx.emoji}</span>
                <span className="tx-desc">
                  {tx.type === 'gift_sent' ? 'Sent' : 'Received'} {tx.giftName}
                  {tx.counterpartName ? ` ${tx.type === 'gift_sent' ? 'to' : 'from'} ${tx.counterpartName}` : ''}
                </span>
                <span className={`tx-amount ${tx.diamonds < 0 ? 'tx-negative' : 'tx-positive'}`}>
                  {tx.diamonds < 0 ? '' : '+'}
                  {tx.diamonds}💎
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
