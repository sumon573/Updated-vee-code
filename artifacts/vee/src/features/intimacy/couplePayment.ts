/**
 * couplePayment.ts — THE single entry point for NEW couple diamond charges.
 *
 * STATUS: NOT IMPLEMENTED — deliberately. This function is wired into the
 * Couple tab upgrade flow, but it cannot debit anything yet, because NO
 * existing wallet-service endpoint fits a couple charge:
 *   - /wallet/gift/send and /wallet/send-gift: gift transfers. The
 *     recipient receives 40% — a couple upgrade is not a gift to anyone.
 *   - /wallet/store/purchase + /wallet/store/grant-complete: store items
 *     with catalog grants. Couple levels are not store items; inventing a
 *     store item id for them would fake a catalog entry.
 *   - /wallet/purchase-short-id: short-ID purchases only.
 *   - /wallet/balance, /wallet/me, /wallet/init: reads/setup, not debits.
 *
 * WHAT IS NEEDED (the single open item for this build): a wallet-service
 * endpoint, e.g. POST /wallet/couple/charge with { uid, pairKey, kind,
 * level, amount, idempotencyKey }, debiting Postgres truth (the wallet
 * service) and mirroring to RTDB like every other money path. Until it
 * exists, upgrades fail cleanly with CouplePaymentUnavailable and NO
 * money moves, NO balance is faked, and NO RTDB balance is written.
 *
 * HARD RULE (mirror-freeze lesson): NEVER implement this by writing
 * wallets/{uid}/balance directly in RTDB. Direct RTDB balance writes
 * bypass Postgres + the mirror and permanently freeze that user's
 * displayed balance (the driftGate stall). The legacy couple-invite debit
 * in inviteService.ts still uses its old receipt-guarded RTDB path — that
 * path is pre-existing, untouched by this build, and unifying it under a
 * wallet-service endpoint is the same open item (its price default is
 * now COUPLE_REQUEST_PRICE = 1200).
 */

export class CouplePaymentUnavailable extends Error {
  constructor() {
    super('Couple upgrades are not available yet.');
    this.name = 'CouplePaymentUnavailable';
  }
}

export interface CoupleChargeArgs {
  /** The paying user. */
  uid: string;
  /** couples/{pairKey} being upgraded. */
  pairKey: string;
  /** Paid level being bought (2..5). */
  level: number;
  /** Diamonds for that level (see COUPLE_UPGRADE_COSTS). */
  amount: number;
  /** Caller-provided idempotency key (pairKey + level + day, or a uuid). */
  idempotencyKey: string;
}

/**
 * Charge diamonds for a couple level upgrade. Currently ALWAYS throws
 * CouplePaymentUnavailable — the wallet-service endpoint does not exist
 * yet. Callers must catch that error and show a neutral "not available
 * yet" state; they must never fall back to an RTDB balance write.
 */
export async function chargeCoupleDiamonds(
  _args: CoupleChargeArgs,
): Promise<{ receiptId: string }> {
  // Intentionally unimplemented: see the header. No endpoint fits, no
  // balance is touched, no charge is faked.
  throw new CouplePaymentUnavailable();
}
