import { Router, type IRouter, type Request, type Response } from "express";
import {
  adminDatabase,
  getAdminInitError,
  isAdminReady,
  ServerValue,
  verifyIdToken,
} from "../lib/firebaseAdmin";
import { logger } from "../lib/logger";

/**
 * Wallet + gift routes for the Vee app.
 *
 * Server-side gift catalog (mirror of the client's display catalog). Coin
 * costs ALWAYS come from this catalog — the client is never trusted with
 * coin amounts.
 *
 * The sender's identity always comes from the verified Firebase ID token
 * (`decoded.uid`) — a client-supplied uid is never trusted.
 *
 * Required env (server env, NOT EAS):
 *   FIREBASE_SERVICE_ACCOUNT_JSON  Firebase service-account JSON string,
 *                                  OR GOOGLE_APPLICATION_CREDENTIALS file path
 *   USDT_TRC20_DEPOSIT_ADDRESS     Our USDT (TRC20) deposit address — the ONLY
 *                                  address topup-crypto will credit for.
 *                                  Required for /topup-config and /topup-crypto.
 * Optional:
 *   FIREBASE_DATABASE_URL          RTDB instance URL
 *                                  (defaults to the vee RTDB instance)
 *   USDT_DIAMOND_RATE              Diamonds credited per 1 USDT (default "200").
 *                                  Server-owned: clients never send amounts.
 *                                  1 USDT = 200 diamonds (business rate).
 *   ADMIN_UIDS                     Comma-separated Firebase uids allowed to
 *                                  approve/reject bKash claims and list pending
 *                                  claims. Empty = no admin access.
 *   TRONSCAN_API_BASE              Tronscan public API base URL
 *                                  (default "https://api.tronscan.org"). No API
 *                                  key is needed for transaction-info lookups.
 *   TRONSCAN_API_BASE_FALLBACK     Fallback Tronscan base tried once when the
 *                                  primary base is unreachable
 *                                  (default "https://apilist.tronscan.org").
 *
 * Business rule (both rails): 1 BDT = 2 diamonds. bKash packages are
 *   server-validated against [100, 500, 1000, 5000] diamonds; the BDT amount
 *   is derived as diamonds / 2 and never trusted from the client. USDT
 *   packages use USDT_DIAMOND_RATE so the same rule holds:
 *   1 USDT = 200 diamonds (business rate; VPS env overrides).
 *
 * Response contract:
 *   POST /init
 *     200 { ok: true, balance, created }    wallet initialized idempotently
 *                                           (balance 500 on first creation)
 *     401                                    missing or invalid Firebase ID token
 *     500                                    server misconfigured / unhandled error
 *   POST /send-gift
 *     200 { ok: true, newBalance, receipt: { fromUid, toUid, giftId, coins } }
 *                                          gift charged atomically, recipient
 *                                          credited, receipt persisted
 *     200 { ok: true, replayed: true, newBalance, receipt }
 *                                          idempotencyKey already seen — the
 *                                          stored receipt is returned and the
 *                                          sender is NOT charged again
 *     400                                    unknown giftId / invalid toUid /
 *                                          invalid idempotencyKey / self-gift /
 *                                          insufficient balance
 *     401                                    missing or invalid Firebase ID token
 *     500                                    server misconfigured / unhandled error
 *   GET /balance
 *     200 { balance }                      0 when the wallet node is absent
 *                                          (never auto-creates on read)
 *     401                                    missing or invalid Firebase ID token
 *     500                                    server misconfigured / unhandled error
 *   GET /topup-config
 *     200 { usdtTrc20Address, packages: [{ id, diamonds, usdt }] }
 *                                          server-owned deposit address + exact
 *                                          USDT amounts per diamond package
 *     401                                    missing or invalid Firebase ID token
 *     503                                    USDT_TRC20_DEPOSIT_ADDRESS unset
 *     500                                    server misconfigured / unhandled error
 *   POST /topup-crypto
 *     200 { ok: true, diamonds, newBalance }  tx verified on-chain and credited
 *     400                                    invalid txHash / unsupported network /
 *                                          unknown package / tx not found /
 *                                          not confirmed / underpaid / wrong
 *                                          recipient / txHash already used
 *     401                                    missing or invalid Firebase ID token
 *     429                                    too many attempts (rate limited)
 *     503                                    USDT_TRC20_DEPOSIT_ADDRESS unset
 *     500                                    server misconfigured / unhandled error
 *   POST /topup-bkash
 *     200 { ok: true, status: 'pending' }    claim recorded for manual admin
 *                                          verification (bKash exposes no
 *                                          public TrxID API)
 *     400                                    invalid trxId / unknown package
 *     401                                    missing or invalid Firebase ID token
 *     409                                    this TrxID was already submitted
 *     429                                    too many attempts (rate limited)
 *     500                                    server misconfigured / unhandled error
 *   POST /topup-bkash/approve  (admin only)
 *     200 { ok: true, diamonds, newBalance }  claim credited via the existing
 *                                          creditWalletDiamonds() path
 *     401 / 403                              not signed in / not an admin
 *     404                                    unknown TrxID
 *     409                                    claim is not pending
 *     500                                    server misconfigured / unhandled error
 *   POST /topup-bkash/reject  (admin only)
 *     200 { ok: true }                       claim marked rejected
 *     401 / 403                              not signed in / not an admin
 *     404                                    unknown TrxID
 *     409                                    claim is not pending
 *     500                                    server misconfigured / unhandled error
 *   GET /topup-bkash/pending  (admin only)
 *     200 { claims: [{ trxId, uid, diamonds, bdt, createdAt }] }
 *                                          newest first, max 100
 *     401 / 403                              not signed in / not an admin
 *     500                                    server misconfigured / unhandled error
 */

const router: IRouter = Router();

/** Server-authoritative gift catalog: giftId → emoji/name/coin cost. */
const GIFT_CATALOG: Record<
  string,
  { emoji: string; name: string; coins: number }
> = {
  "1": { emoji: "💝", name: "Heart", coins: 10 },
  "2": { emoji: "🌹", name: "Rose", coins: 25 },
  "3": { emoji: "🎁", name: "Gift", coins: 50 },
  "4": { emoji: "💎", name: "Diamond", coins: 100 },
  "5": { emoji: "🏆", name: "Trophy", coins: 200 },
  "6": { emoji: "🚀", name: "Rocket", coins: 500 },
  "7": { emoji: "👑", name: "Crown", coins: 1000 },
  "8": { emoji: "🎆", name: "Fireworks", coins: 2000 },
};

/** Hard caps on client-controlled fields (abuse friction). */
const MAX_UID_LENGTH = 128;
const MIN_IDEMPOTENCY_KEY_LENGTH = 8;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

/**
 * Characters rejected in client-supplied uid / idempotency-key values. The
 * RTDB-invalid set (`. $ # [ ]`) plus `/` blocks path traversal into other
 * nodes (e.g. toUid "a/b"), plus ASCII control characters.
 */
const INVALID_PATH_CHARS = /[/.$#[\]\u0000-\u001f\u007f]/;

// Firebase Admin SDK is initialized once in ../lib/firebaseAdmin (fail-closed).

/**
 * Fail-closed gate shared by every wallet route: returns the verified uid,
 * or null after having sent the appropriate 5xx/401 response.
 */
async function verifyCaller(
  req: Request,
  res: Response,
): Promise<string | null> {
  // Fail closed: no Admin SDK → we cannot verify tokens.
  if (!isAdminReady()) {
    logger.error(
      { err: getAdminInitError() },
      "wallet: Firebase Admin SDK not initialized",
    );
    res.status(500).json({ ok: false, error: "Wallet service not configured" });
    return null;
  }
  const authHeader = req.headers.authorization;
  const bearerMatch = /^Bearer (.+)$/.exec(authHeader ?? "");
  if (!bearerMatch) {
    res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    return null;
  }
  try {
    const decoded = await verifyIdToken(bearerMatch[1]);
    return decoded.uid;
  } catch (err) {
    logger.warn({ err }, "wallet: invalid Firebase ID token");
    res.status(401).json({ ok: false, error: "Invalid ID token" });
    return null;
  }
}

/**
 * Credit diamonds to a wallet, creating the wallet node when it is absent.
 *
 * This is the EXISTING wallet credit path — shared by the gift flow
 * (recipient credit in /send-gift) and crypto top-up (/topup-crypto).
 * Do not duplicate this logic elsewhere: call this helper.
 */
async function creditWalletDiamonds(
  db: ReturnType<typeof adminDatabase>,
  uid: string,
  coins: number,
): Promise<void> {
  const walletRef = db.ref(`wallets/${uid}`);
  const snap = await walletRef.get();
  if (!snap.exists()) {
    await walletRef.set({
      balance: 0,
      createdAt: ServerValue.TIMESTAMP,
    });
  }
  await db.ref(`wallets/${uid}/balance`).set(ServerValue.increment(coins));

  // Best-effort weekly earnings counter — must never fail the credit.
  try {
    await db.ref(`wallets/${uid}/weeklyEarned`).set(ServerValue.increment(coins));
  } catch (weeklyErr) {
    logger.warn(
      { err: weeklyErr, uid, coins },
      "creditWalletDiamonds: failed to increment weeklyEarned (best-effort)",
    );
  }
}

/**
 * POST /api/wallet/init — idempotently create the caller's wallet.
 *
 * If `wallets/{uid}` is absent it is created with `{ balance: 500,
 * createdAt }` (500 matches what the UI previously displayed to new users);
 * an existing wallet is left untouched. Safe to retry.
 */
router.post("/init", async (req: Request, res: Response) => {
  try {
    const uid = await verifyCaller(req, res);
    if (!uid) return;

    const walletRef = adminDatabase().ref(`wallets/${uid}`);
    const snap = await walletRef.get();
    if (snap.exists()) {
      const stored = (snap.val() ?? {}) as { balance?: unknown };
      const balance = typeof stored.balance === "number" ? stored.balance : 0;
      return res.status(200).json({ ok: true, balance, created: false });
    }

    await walletRef.set({
      balance: 500,
      createdAt: ServerValue.TIMESTAMP,
    });
    logger.info({ uid }, "Wallet created with opening balance 500");
    return res.status(200).json({ ok: true, balance: 500, created: true });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /api/wallet/init");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/wallet/send-gift — charge the sender and credit the recipient.
 *
 * Body: `{ toUid, giftId, idempotencyKey }`. Coin cost comes from the
 * server catalog only. The sender's balance is debited atomically via an
 * RTDB transaction (missing wallet counts as 0 and fails with insufficient
 * balance); the transaction aborts when the balance is below the gift cost.
 * A durable receipt is stored at `walletTransactions/{idempotencyKey}` so a
 * retried request returns the original receipt without re-charging.
 */
router.post("/send-gift", async (req: Request, res: Response) => {
  try {
    const fromUid = await verifyCaller(req, res);
    if (!fromUid) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const toUid = body["toUid"];
    const giftId = body["giftId"];
    const idempotencyKey = body["idempotencyKey"];

    const gift =
      typeof giftId === "string" ? GIFT_CATALOG[giftId] : undefined;
    if (!gift) {
      return res.status(400).json({ ok: false, error: "Unknown gift" });
    }

    if (
      typeof toUid !== "string" ||
      toUid.length === 0 ||
      toUid.length > MAX_UID_LENGTH ||
      INVALID_PATH_CHARS.test(toUid)
    ) {
      return res.status(400).json({ ok: false, error: "Invalid request" });
    }
    // Self-gifting is allowed: debit + credit the same account (net-zero).
    // C1 fix: self-gifts must DEDUCT (not net-zero). When toUid === fromUid,
    // debit only — skip the credit so diamonds actually decrease.
    const isSelfGift = toUid === fromUid;

    if (
      typeof idempotencyKey !== "string" ||
      idempotencyKey.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
      idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
      INVALID_PATH_CHARS.test(idempotencyKey)
    ) {
      return res.status(400).json({ ok: false, error: "Invalid request" });
    }

    const coins = gift.coins;
    const db = adminDatabase();
    const receiptRef = db.ref(`walletTransactions/${idempotencyKey}`);

    // ATOMIC IDEMPOTENCY (2026-10-06 fix):
    // Claim the idempotency key via transaction BEFORE debiting.
    // Previously: check-then-act race allowed double-debit on concurrent requests.
    // Now: only the request that successfully claims the key proceeds to debit.
    const claimResult = await receiptRef.transaction((current: unknown) => {
      if (current !== null) return undefined; // abort: already claimed
      return {
        fromUid,
        toUid,
        giftId,
        coins,
        ts: ServerValue.TIMESTAMP,
        status: "processing",
      };
    });

    if (!claimResult.committed) {
      // Another request already claimed this key — return the stored receipt
      // without re-charging. If the prior request is still processing, wait
      // briefly and re-check (simple spin with timeout).
      let stored = (claimResult.snapshot.val() ?? {}) as Record<string, unknown>;
      if (stored["status"] === "processing") {
        // Wait up to 5 seconds for the processing request to complete
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const recheck = await receiptRef.get();
          stored = (recheck.val() ?? {}) as Record<string, unknown>;
          if (stored["status"] !== "processing") break;
        }
      }
      const balanceSnap = await db.ref(`wallets/${fromUid}/balance`).get();
      const newBalance =
        typeof balanceSnap.val() === "number" ? balanceSnap.val() : null;
      logger.info(
        { fromUid, idempotencyKey },
        "send-gift replayed: returning stored receipt without re-charging",
      );
      return res.status(200).json({
        ok: true,
        replayed: true,
        newBalance,
        receipt: stored,
      });
    }

    // We claimed the key — now atomically debit the sender.
    // Missing wallet counts as balance 0, so uninitialized senders fail here
    // with insufficient balance instead of being charged.
    const txResult = await db
      .ref(`wallets/${fromUid}/balance`)
      .transaction((current: number | null) => {
        const balance = typeof current === "number" ? current : 0;
        if (balance < coins) return undefined; // abort: insufficient balance
        return balance - coins;
      });
    if (!txResult.committed) {
      // Debit failed — release the claim so a retry can proceed
      await receiptRef.remove();
      return res
        .status(400)
        .json({ ok: false, error: "Insufficient balance" });
    }
    const newBalance = txResult.snapshot.val();

    // Credit the recipient through the shared credit path (creates the
    // wallet node when absent, increments balance + weeklyEarned).
    // C1: skip credit for self-gifts (deduct-only).
    if (!isSelfGift) {
      await creditWalletDiamonds(db, toUid, coins);
    }

    const receipt = {
      fromUid,
      toUid,
      giftId,
      coins,
      ts: ServerValue.TIMESTAMP,
      status: "completed",
      newBalance,
    };
    await receiptRef.set(receipt);

    // TRANSACTION HISTORY (2026-10-06 fix):
    // Write history entries for sender and recipient. Previously no history
    // was written, leaving wallet history empty.
    const ts = Date.now();
    const senderTx = {
      type: "gift_sent",
      giftId,
      coins: -coins, // negative for debit
      toUid,
      ts,
      idempotencyKey,
    };
    const recipientTx = {
      type: "gift_received",
      giftId,
      coins: coins, // positive for credit
      fromUid,
      ts,
      idempotencyKey,
    };

    // Write sender history (always)
    await db.ref(`wallets/${fromUid}/transactions`).push(senderTx);
    // Write recipient history (skip for self-gifts since it's deduct-only)
    if (!isSelfGift) {
      await db.ref(`wallets/${toUid}/transactions`).push(recipientTx);
    }

    logger.info(
      { fromUid, toUid, giftId, coins },
      "Gift sent, receipt stored, history written",
    );
    return res.status(200).json({
      ok: true,
      newBalance,
      receipt: { fromUid, toUid, giftId, coins },
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /api/wallet/send-gift");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/wallet/balance — read the caller's current balance.
 *
 * Never auto-creates a wallet: a missing wallet node reports balance 0.
 */
router.get("/balance", async (req: Request, res: Response) => {
  try {
    const uid = await verifyCaller(req, res);
    if (!uid) return;

    const snap = await adminDatabase()
      .ref(`wallets/${uid}/balance`)
      .get();
    const balance = typeof snap.val() === "number" ? snap.val() : 0;
    return res.status(200).json({ balance });
  } catch (err) {
    logger.error({ err }, "Unhandled error in GET /api/wallet/balance");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/* ─── USDT (TRC20) top-up — server-verified, on-chain ───────────────────
 *
 * Manual bKash claims stay manual (bKash exposes no public TrxID verification
 * API). Crypto top-up is automated instead: the server verifies the USDT
 * transfer on-chain via the Tronscan public API before crediting anything.
 * Clients never send amounts, addresses, or package prices — every value is
 * server-owned (env vars + the package table below).
 */

const USDT_CONTRACT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // Tether USD on TRON
const USDT_DECIMALS = 6;
const TRONSCAN_API_BASE =
  process.env["TRONSCAN_API_BASE"] ?? "https://api.tronscan.org";
const TRONSCAN_API_BASE_FALLBACK =
  process.env["TRONSCAN_API_BASE_FALLBACK"] ?? "https://apilist.tronscan.org";
const TRONSCAN_TIMEOUT_MS = 12_000;
/** Confirmations required before a USDT transfer is trusted (~19 for TRC20). */
const REQUIRED_TRX_CONFIRMATIONS = 19;
const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;

/** Our USDT (TRC20) deposit address — null when not configured. */
function getDepositAddress(): string | null {
  const addr = (process.env["USDT_TRC20_DEPOSIT_ADDRESS"] ?? "").trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return null;
  return addr;
}

/**
 * Diamonds credited per 1 USDT (server-owned rate).
 *
 * Default 200: 1 USDT = 200 diamonds (business rate; VPS env overrides).
 */
function getDiamondRate(): number {
  const rate = Number((process.env["USDT_DIAMOND_RATE"] ?? "200").trim());
  return Number.isFinite(rate) && rate > 0 ? rate : 200;
}

export type TopupPackage = { id: string; diamonds: number; usdt: number };

/** Server-owned diamond packages; USDT amounts are derived from the rate. */
function getTopupPackages(): TopupPackage[] {
  const rate = getDiamondRate();
  return [100, 500, 1000, 5000].map((diamonds) => ({
    id: `usdt-${diamonds}`,
    diamonds,
    // Round to whole sun (1 USDT = 1e6 sun) so on-chain comparison is exact.
    usdt: Math.round((diamonds / rate) * 1_000_000) / 1_000_000,
  }));
}

/* ─── Tronscan verification (public API, no key needed) ─────────────────── */

type TronTransferInfo = {
  from_address?: unknown;
  to_address?: unknown;
  contract_address?: unknown;
  amount_str?: unknown;
  decimals?: unknown;
  symbol?: unknown;
  type?: unknown;
  status?: unknown;
  tokenType?: unknown;
};

type TronTxInfo = {
  confirmed?: unknown;
  confirmations?: unknown;
  contractRet?: unknown;
  revert?: unknown;
  tokenTransferInfo?: unknown;
  trc20TransferInfo?: unknown;
};

type CryptoVerification =
  | { ok: true; fromAddress: string; usdtReceived: number }
  | { ok: false; error: string };

/** Fetch transaction-info for a hash. Returns null on unknown hash / error. */
async function fetchTronTxInfo(txHash: string): Promise<TronTxInfo | null> {
  // Primary base first; on network-level failure fall back to the legacy
  // base once. A definitive "unknown hash" (200 + {}) is NOT retried.
  for (const base of [TRONSCAN_API_BASE, TRONSCAN_API_BASE_FALLBACK]) {
    const result = await fetchTronTxInfoFrom(base, txHash);
    if (result !== undefined) return result;
  }
  return null;
}

/**
 * One attempt against a single Tronscan base.
 * Returns the parsed info, null for "unknown hash", or undefined when the
 * base itself failed (caller may try the fallback base).
 */
async function fetchTronTxInfoFrom(
  base: string,
  txHash: string,
): Promise<TronTxInfo | null | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRONSCAN_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/transaction-info?hash=${txHash}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "vee-api-server/topup-crypto",
      },
    });
    if (!res.ok) return undefined; // base failed — try fallback
    const data = (await res.json().catch(() => null)) as TronTxInfo | null;
    // Tronscan answers unknown hashes with 200 + {} — treat as not found.
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      return null;
    }
    return data;
  } catch {
    return undefined; // network/timeout — try fallback
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify that the transaction contains a successful USDT (TRC20) transfer to
 * our deposit address of at least `requiredSun` sun (1 USDT = 1e6 sun).
 */
function verifyTrc20Transfer(
  info: TronTxInfo,
  depositAddress: string,
  requiredSun: bigint,
): CryptoVerification {
  if (info.confirmed !== true) {
    return {
      ok: false,
      error: "Transaction is not confirmed yet. Wait for more confirmations and try again.",
    };
  }
  const confirmations =
    typeof info.confirmations === "number" ? info.confirmations : 0;
  if (confirmations < REQUIRED_TRX_CONFIRMATIONS) {
    return {
      ok: false,
      error: `Transaction has ${confirmations} confirmations; ${REQUIRED_TRX_CONFIRMATIONS} are required. Try again shortly.`,
    };
  }
  if (info.revert === true || info.contractRet === "REVERT") {
    return {
      ok: false,
      error: "Transaction reverted on-chain and did not transfer USDT.",
    };
  }
  if (info.contractRet !== "SUCCESS") {
    return {
      ok: false,
      error: "Transaction did not succeed on-chain.",
    };
  }

  const transfers: TronTransferInfo[] = [];
  if (info.tokenTransferInfo && typeof info.tokenTransferInfo === "object") {
    transfers.push(info.tokenTransferInfo as TronTransferInfo);
  }
  if (Array.isArray(info.trc20TransferInfo)) {
    for (const t of info.trc20TransferInfo) {
      if (t && typeof t === "object") transfers.push(t as TronTransferInfo);
    }
  }

  const matching = transfers.find(
    (t) =>
      t.tokenType === "trc20" &&
      t.contract_address === USDT_CONTRACT_ADDRESS &&
      t.to_address === depositAddress &&
      t.type === "Transfer" &&
      t.status === 0,
  );
  if (!matching) {
    return {
      ok: false,
      error: "No USDT (TRC20) transfer to our deposit address was found in this transaction.",
    };
  }

  const rawAmount = String(matching.amount_str ?? "");
  if (!/^\d+$/.test(rawAmount)) {
    return {
      ok: false,
      error: "Could not read the transferred amount from the transaction.",
    };
  }
  const amountSun = BigInt(rawAmount);
  if (
    typeof matching.decimals === "number" &&
    matching.decimals !== USDT_DECIMALS
  ) {
    return { ok: false, error: "Unexpected token decimals in the transaction." };
  }
  if (amountSun < requiredSun) {
    const sent = Number(amountSun) / 1_000_000;
    const required = Number(requiredSun) / 1_000_000;
    return {
      ok: false,
      error: `Underpaid: sent ${sent} USDT but the package requires ${required} USDT. No diamonds were credited.`,
    };
  }

  return {
    ok: true,
    fromAddress:
      typeof matching.from_address === "string" ? matching.from_address : "",
    usdtReceived: Number(amountSun) / 1_000_000,
  };
}

/* ─── Minimal in-memory rate limiter (per uid, rolling hour) ───────────── */

const MAX_TOPUP_ATTEMPTS_PER_HOUR = 30;
const topupAttempts = new Map<string, number[]>();

function topupRateLimited(uid: string): boolean {
  const now = Date.now();
  const windowStart = now - 3_600_000;
  const prior = (topupAttempts.get(uid) ?? []).filter((t) => t > windowStart);
  if (prior.length >= MAX_TOPUP_ATTEMPTS_PER_HOUR) {
    topupAttempts.set(uid, prior);
    return true;
  }
  prior.push(now);
  topupAttempts.set(uid, prior);
  // Opportunistic cleanup so the map can't grow forever.
  if (topupAttempts.size > 10_000) {
    for (const [key, stamps] of topupAttempts) {
      if (stamps.length === 0 || stamps[stamps.length - 1]! <= windowStart) {
        topupAttempts.delete(key);
      }
    }
  }
  return false;
}

/**
 * GET /api/wallet/topup-config — server-owned crypto top-up configuration.
 *
 * Returns the USDT (TRC20) deposit address and the exact USDT amount for each
 * diamond package. The web client displays these verbatim and never computes
 * prices itself.
 */
router.get("/topup-config", async (req: Request, res: Response) => {
  try {
    const uid = await verifyCaller(req, res);
    if (!uid) return;

    const usdtTrc20Address = getDepositAddress();
    if (!usdtTrc20Address) {
      return res
        .status(503)
        .json({ ok: false, error: "Crypto top-up is not configured" });
    }

    return res.status(200).json({
      usdtTrc20Address,
      packages: getTopupPackages(),
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in GET /api/wallet/topup-config");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/wallet/topup-crypto — credit diamonds for a USDT (TRC20) payment.
 *
 * Body: `{ txHash, network, packageId }`.
 *
 *  1. The txHash is atomically claimed at `topups/crypto/{txHash}` via an
 *     RTDB transaction — a claimed hash can never credit twice, and a
 *     concurrent duplicate is rejected outright.
 *  2. The transaction is verified on-chain via the Tronscan public API:
 *     confirmed, ≥19 confirmations, SUCCESS (not reverted), and containing a
 *     USDT transfer to our deposit address of at least the package amount.
 *  3. On success the diamonds are credited through the existing
 *     creditWalletDiamonds() path (the same code the gift flow uses).
 *
 * Underpayment, wrong recipient/network, unconfirmed or failed transactions
 * are rejected with 400 and a clear message — never credited proportionally.
 * A failed verification releases the claim so the user can retry with a
 * corrected transaction; a credited claim is kept forever as the dedup record.
 */
router.post("/topup-crypto", async (req: Request, res: Response) => {
  try {
    const uid = await verifyCaller(req, res);
    if (!uid) return;

    // Always log attempts — this is real money.
    logger.info({ uid }, "topup-crypto: attempt");

    if (topupRateLimited(uid)) {
      logger.warn({ uid }, "topup-crypto: rate limited");
      return res
        .status(429)
        .json({ ok: false, error: "Too many attempts. Please wait and try again later." });
    }

    const depositAddress = getDepositAddress();
    if (!depositAddress) {
      return res
        .status(503)
        .json({ ok: false, error: "Crypto top-up is not configured" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const txHash = body["txHash"];
    const network = body["network"];
    const packageId = body["packageId"];

    if (typeof txHash !== "string" || !TX_HASH_RE.test(txHash)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid transaction hash" });
    }
    const normalizedTxHash = txHash.toLowerCase();

    const normalizedNetwork =
      typeof network === "string" ? network.trim().toLowerCase() : "";
    if (normalizedNetwork !== "trc20" && normalizedNetwork !== "tron") {
      return res
        .status(400)
        .json({ ok: false, error: "Unsupported network. Only USDT on TRC20 is accepted." });
    }

    const pkg =
      typeof packageId === "string"
        ? getTopupPackages().find((p) => p.id === packageId)
        : undefined;
    if (!pkg) {
      return res.status(400).json({ ok: false, error: "Unknown package" });
    }

    const db = adminDatabase();
    const claimRef = db.ref(`topups/crypto/${normalizedTxHash}`);

    // Atomic claim: two concurrent requests can never both credit this hash.
    const claimTx = await claimRef.transaction((current: unknown) => {
      if (current !== null && current !== undefined) return undefined; // abort: already used
      return {
        uid,
        packageId: pkg.id,
        status: "claimed",
        claimedAt: ServerValue.TIMESTAMP,
      };
    });
    if (!claimTx.committed) {
      return res
        .status(400)
        .json({ ok: false, error: "This transaction has already been used for a top-up." });
    }

    const info = await fetchTronTxInfo(normalizedTxHash);
    if (!info) {
      // Release the claim so the user can retry with a corrected hash.
      await claimRef.remove().catch(() => {});
      logger.warn(
        { uid, txHash: normalizedTxHash },
        "topup-crypto: Tronscan lookup failed or hash unknown",
      );
      return res.status(400).json({
        ok: false,
        error: "Transaction not found. Check the hash and the TRC20 network, then try again.",
      });
    }

    const requiredSun = BigInt(Math.round(pkg.usdt * 1_000_000));
    const verdict = verifyTrc20Transfer(info, depositAddress, requiredSun);
    if (!verdict.ok) {
      // Not credited — release the claim so the user can retry.
      await claimRef.remove().catch(() => {});
      logger.info(
        { uid, txHash: normalizedTxHash, reason: verdict.error },
        "topup-crypto: verification failed",
      );
      return res.status(400).json({ ok: false, error: verdict.error });
    }

    // Credit through the EXISTING wallet credit path (same as gift credit).
    await creditWalletDiamonds(db, uid, pkg.diamonds);

    await claimRef.set({
      uid,
      packageId: pkg.id,
      diamonds: pkg.diamonds,
      usdt: verdict.usdtReceived,
      fromAddress: verdict.fromAddress,
      status: "credited",
      ts: ServerValue.TIMESTAMP,
    });

    const balanceSnap = await db.ref(`wallets/${uid}/balance`).get();
    const newBalance =
      typeof balanceSnap.val() === "number" ? balanceSnap.val() : pkg.diamonds;

    logger.info(
      { uid, txHash: normalizedTxHash, packageId: pkg.id, diamonds: pkg.diamonds },
      "topup-crypto: credited",
    );
    return res.status(200).json({ ok: true, diamonds: pkg.diamonds, newBalance });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /api/wallet/topup-crypto");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/* ─── bKash top-up — manual claim + admin verification ──────────────────
 *
 * bKash exposes no public TrxID verification API, so automation stops at the
 * claim: the user submits { trxId, diamonds }, the server stores a pending
 * claim at `topupClaims/bkash/{trxId}` (deduped — a TrxID can be submitted
 * only once, by anyone), and an admin approves/rejects after checking the
 * payment in the bKash app. Approval credits through the existing
 * creditWalletDiamonds() path — the same code the gift flow and crypto
 * top-up use.
 *
 * Anti-fraud notes:
 *  - TrxID is normalized (trim + uppercase) and must match /^[0-9A-Z]{10}$/,
 *    which also makes path traversal impossible (no `. $ # [ ] /` possible).
 *  - Diamonds must be one of the server-owned packages; the BDT amount is
 *    derived (diamonds / 2) and never trusted from the client.
 *  - Claims live under a server-only RTDB node: Admin SDK bypasses rules,
 *    clients cannot read or forge claims directly.
 *  - Admin routes require the caller's uid in ADMIN_UIDS (env).
 */

/** Server-owned bKash diamond packages. BDT is always diamonds / 2. */
const BKASH_DIAMOND_PACKAGES = [100, 500, 1000, 5000];

/** bKash TrxID format: 10 uppercase alphanumerics (e.g. 9HXK2L8M1Q). */
const BKASH_TRXID_RE = /^[0-9A-Z]{10}$/;

/** Admin uids from the ADMIN_UIDS env var (comma-separated). */
function getAdminUids(): Set<string> {
  return new Set(
    (process.env["ADMIN_UIDS"] ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.length > 0),
  );
}

/**
 * Fail-closed admin gate: verified caller whose uid is in ADMIN_UIDS,
 * or null after sending 401/403.
 */
async function verifyAdmin(req: Request, res: Response): Promise<string | null> {
  const uid = await verifyCaller(req, res);
  if (!uid) return null;
  if (!getAdminUids().has(uid)) {
    logger.warn({ uid }, "wallet: non-admin attempted admin route");
    res.status(403).json({ ok: false, error: "Forbidden" });
    return null;
  }
  return uid;
}

type BkashClaim = {
  uid?: unknown;
  trxId?: unknown;
  diamonds?: unknown;
  bdt?: unknown;
  status?: unknown;
  createdAt?: unknown;
};

/**
 * POST /api/wallet/topup-bkash — submit a bKash payment claim.
 *
 * Body: `{ trxId, diamonds }`. The claim is stored as pending; an admin
 * verifies the payment manually and approves it.
 */
router.post("/topup-bkash", async (req: Request, res: Response) => {
  try {
    const uid = await verifyCaller(req, res);
    if (!uid) return;

    if (topupRateLimited(uid)) {
      logger.warn({ uid }, "topup-bkash: rate limited");
      return res
        .status(429)
        .json({ ok: false, error: "Too many attempts. Please wait and try again later." });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawTrxId = body["trxId"];
    const diamonds = body["diamonds"];

    const trxId =
      typeof rawTrxId === "string" ? rawTrxId.trim().toUpperCase() : "";
    if (!BKASH_TRXID_RE.test(trxId)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid TrxID. Use the 10-character TrxID from your bKash payment SMS.",
      });
    }

    if (typeof diamonds !== "number" || !BKASH_DIAMOND_PACKAGES.includes(diamonds)) {
      return res.status(400).json({ ok: false, error: "Unknown package" });
    }

    const db = adminDatabase();
    const claimRef = db.ref(`topupClaims/bkash/${trxId}`);

    // Dedupe: a TrxID can be submitted only once, by anyone. A second
    // submission (same user retrying, or someone else's TrxID) is rejected.
    const priorSnap = await claimRef.get();
    if (priorSnap.exists()) {
      logger.warn({ uid, trxId }, "topup-bkash: duplicate TrxID submission");
      return res.status(409).json({
        ok: false,
        error: "This TrxID has already been submitted.",
      });
    }

    await claimRef.set({
      uid,
      trxId,
      diamonds,
      bdt: diamonds / 2,
      status: "pending",
      createdAt: ServerValue.TIMESTAMP,
    });

    logger.info({ uid, trxId, diamonds }, "topup-bkash: claim recorded");
    return res.status(200).json({ ok: true, status: "pending" });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /api/wallet/topup-bkash");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/wallet/topup-bkash/approve — admin: verify + credit a claim.
 *
 * Body: `{ trxId }`. Credits through the existing creditWalletDiamonds()
 * path, then marks the claim approved. Not idempotent by design: a second
 * approve is rejected (409) so a double-click can never double-credit.
 */
router.post("/topup-bkash/approve", async (req: Request, res: Response) => {
  try {
    const adminUid = await verifyAdmin(req, res);
    if (!adminUid) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const trxId =
      typeof body["trxId"] === "string"
        ? body["trxId"].trim().toUpperCase()
        : "";
    if (!BKASH_TRXID_RE.test(trxId)) {
      return res.status(400).json({ ok: false, error: "Invalid TrxID" });
    }

    const db = adminDatabase();
    const claimRef = db.ref(`topupClaims/bkash/${trxId}`);
    const snap = await claimRef.get();
    if (!snap.exists()) {
      return res.status(404).json({ ok: false, error: "Claim not found" });
    }
    const claim = (snap.val() ?? {}) as BkashClaim;
    if (claim.status !== "pending") {
      return res.status(409).json({
        ok: false,
        error: `Claim is already ${typeof claim.status === "string" ? claim.status : "processed"}.`,
      });
    }
    const diamonds =
      typeof claim.diamonds === "number" &&
      BKASH_DIAMOND_PACKAGES.includes(claim.diamonds)
        ? claim.diamonds
        : 0;
    const claimUid = typeof claim.uid === "string" ? claim.uid : "";
    if (!diamonds || !claimUid) {
      return res.status(500).json({ ok: false, error: "Claim is malformed" });
    }

    // Credit through the EXISTING wallet credit path (same as gift/crypto).
    await creditWalletDiamonds(db, claimUid, diamonds);

    await claimRef.update({
      status: "approved",
      approvedAt: ServerValue.TIMESTAMP,
      approvedBy: adminUid,
    });

    const balanceSnap = await db.ref(`wallets/${claimUid}/balance`).get();
    const newBalance =
      typeof balanceSnap.val() === "number" ? balanceSnap.val() : diamonds;

    logger.info(
      { adminUid, trxId, uid: claimUid, diamonds },
      "topup-bkash: claim approved and credited",
    );
    return res.status(200).json({ ok: true, diamonds, newBalance });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /api/wallet/topup-bkash/approve");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/wallet/topup-bkash/reject — admin: reject a pending claim.
 *
 * Body: `{ trxId, reason? }`. Nothing is credited; the claim is kept as a
 * permanent record so the same TrxID cannot be resubmitted.
 */
router.post("/topup-bkash/reject", async (req: Request, res: Response) => {
  try {
    const adminUid = await verifyAdmin(req, res);
    if (!adminUid) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const trxId =
      typeof body["trxId"] === "string"
        ? body["trxId"].trim().toUpperCase()
        : "";
    if (!BKASH_TRXID_RE.test(trxId)) {
      return res.status(400).json({ ok: false, error: "Invalid TrxID" });
    }
    const reason =
      typeof body["reason"] === "string" ? body["reason"].slice(0, 280) : "";

    const db = adminDatabase();
    const claimRef = db.ref(`topupClaims/bkash/${trxId}`);
    const snap = await claimRef.get();
    if (!snap.exists()) {
      return res.status(404).json({ ok: false, error: "Claim not found" });
    }
    const claim = (snap.val() ?? {}) as BkashClaim;
    if (claim.status !== "pending") {
      return res.status(409).json({
        ok: false,
        error: `Claim is already ${typeof claim.status === "string" ? claim.status : "processed"}.`,
      });
    }

    await claimRef.update({
      status: "rejected",
      reason,
      rejectedAt: ServerValue.TIMESTAMP,
      rejectedBy: adminUid,
    });

    logger.info({ adminUid, trxId, reason }, "topup-bkash: claim rejected");
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /api/wallet/topup-bkash/reject");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/wallet/topup-bkash/pending — admin: list pending claims.
 *
 * Returns newest first, capped at 100. The admin checks each payment in the
 * bKash app, then calls /approve or /reject with the TrxID.
 */
router.get("/topup-bkash/pending", async (req: Request, res: Response) => {
  try {
    const adminUid = await verifyAdmin(req, res);
    if (!adminUid) return;

    const db = adminDatabase();
    const snap = await db
      .ref("topupClaims/bkash")
      .orderByChild("createdAt")
      .limitToLast(100)
      .get();

    const claims: Array<{
      trxId: string;
      uid: string;
      diamonds: number;
      bdt: number;
      createdAt: number | null;
    }> = [];
    snap.forEach((child) => {
      const c = (child.val() ?? {}) as BkashClaim;
      if (c.status !== "pending") return;
      claims.push({
        trxId: typeof c.trxId === "string" ? c.trxId : (child.key ?? ""),
        uid: typeof c.uid === "string" ? c.uid : "",
        diamonds: typeof c.diamonds === "number" ? c.diamonds : 0,
        bdt: typeof c.bdt === "number" ? c.bdt : 0,
        createdAt: typeof c.createdAt === "number" ? c.createdAt : null,
      });
    });
    // limitToLast returns ascending — reverse for newest first.
    claims.reverse();

    return res.status(200).json({ claims });
  } catch (err) {
    logger.error({ err }, "Unhandled error in GET /api/wallet/topup-bkash/pending");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;
