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
 * Optional:
 *   FIREBASE_DATABASE_URL          RTDB instance URL
 *                                  (defaults to the vee RTDB instance)
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
      INVALID_PATH_CHARS.test(toUid) ||
      toUid === fromUid
    ) {
      return res.status(400).json({ ok: false, error: "Invalid request" });
    }

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

    // Idempotency first: a retry returns the stored receipt without
    // re-charging the sender.
    const priorSnap = await receiptRef.get();
    if (priorSnap.exists()) {
      const stored = (priorSnap.val() ?? {}) as Record<string, unknown>;
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

    // Atomically debit the sender. Missing wallet counts as balance 0, so
    // uninitialized senders fail here with insufficient balance instead of
    // being charged.
    const txResult = await db
      .ref(`wallets/${fromUid}/balance`)
      .transaction((current: number | null) => {
        const balance = typeof current === "number" ? current : 0;
        if (balance < coins) return undefined; // abort: insufficient balance
        return balance - coins;
      });
    if (!txResult.committed) {
      return res
        .status(400)
        .json({ ok: false, error: "Insufficient balance" });
    }
    const newBalance = txResult.snapshot.val();

    // Credit the recipient. Ensure the wallet node exists first so it always
    // carries a balance + createdAt shape.
    const recipientRef = db.ref(`wallets/${toUid}`);
    const recipientSnap = await recipientRef.get();
    if (!recipientSnap.exists()) {
      await recipientRef.set({
        balance: 0,
        createdAt: ServerValue.TIMESTAMP,
      });
    }
    await db
      .ref(`wallets/${toUid}/balance`)
      .set(ServerValue.increment(coins));

    // Best-effort weekly earnings counter for the recipient — must never
    // fail the gift.
    try {
      await db
        .ref(`wallets/${toUid}/weeklyEarned`)
        .set(ServerValue.increment(coins));
    } catch (weeklyErr) {
      logger.warn(
        { err: weeklyErr, toUid, coins },
        "send-gift: failed to increment weeklyEarned (best-effort)",
      );
    }

    const receipt = {
      fromUid,
      toUid,
      giftId,
      coins,
      ts: ServerValue.TIMESTAMP,
    };
    await receiptRef.set(receipt);

    logger.info(
      { fromUid, toUid, giftId, coins },
      "Gift sent and receipt stored",
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

export default router;
