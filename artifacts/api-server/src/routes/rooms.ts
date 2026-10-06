import { Router, type IRouter, type Request, type Response } from "express";
import {
  adminDatabase,
  getAdminInitError,
  isAdminReady,
  verifyIdToken,
} from "../lib/firebaseAdmin";
import { logger } from "../lib/logger";

/**
 * POST /api/rooms/verify-pin — server-side PIN verification for private rooms.
 *
 * SECURITY: Room PIN hashes are no longer readable by clients (Firebase rules
 * hardened 2026-10-06). Clients MUST use this endpoint to verify a PIN attempt.
 * The server reads the hash via Admin SDK and compares — the hash never leaves
 * the server.
 *
 * Request (JSON):
 *   { roomId: string, hashedPin: string }
 *   - roomId: the voice room ID
 *   - hashedPin: SHA-256 hash of the 4-digit PIN entered by the user
 *                 (client hashes locally, sends only the hash)
 *
 * Response:
 *   200 { ok: true, valid: true }    PIN matches
 *   200 { ok: true, valid: false }   PIN does not match or no PIN set
 *   400                             missing/invalid roomId or hashedPin
 *   401                             missing or invalid Firebase ID token
 *   500                             server misconfigured
 *
 * Rate limiting: Clients should rate-limit attempts (max 5 per minute per room).
 * The server logs failed attempts for abuse detection.
 */

const router: IRouter = Router();

// Simple in-memory rate limiter: max 10 attempts per room per minute per user
const attemptLog = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(userId: string, roomId: string): boolean {
  const key = `${userId}:${roomId}`;
  const now = Date.now();
  const entry = attemptLog.get(key);

  if (!entry || now > entry.resetAt) {
    attemptLog.set(key, { count: 1, resetAt: now + 60000 });
    return false;
  }

  entry.count++;
  if (entry.count > 10) {
    return true;
  }
  return false;
}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attemptLog.entries()) {
    if (now > entry.resetAt) {
      attemptLog.delete(key);
    }
  }
}, 5 * 60 * 1000);

router.post("/verify-pin", async (req: Request, res: Response) => {
  try {
    // Fail closed: no Admin SDK → cannot verify
    if (!isAdminReady()) {
      logger.error(
        { err: getAdminInitError() },
        "POST /api/rooms/verify-pin: Firebase Admin SDK not initialized",
      );
      return res
        .status(500)
        .json({ ok: false, error: "Server not configured" });
    }

    // Authenticate the caller
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "Missing auth token" });
    }
    const idToken = authHeader.slice(7);
    let decoded;
    try {
      decoded = await verifyIdToken(idToken);
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid auth token" });
    }
    const userId = decoded.uid;

    // Validate input
    const { roomId, hashedPin } = req.body ?? {};
    if (typeof roomId !== "string" || roomId.length === 0 || roomId.length > 128) {
      return res.status(400).json({ ok: false, error: "Invalid roomId" });
    }
    if (typeof hashedPin !== "string" || hashedPin.length !== 64) {
      // SHA-256 hex is 64 chars
      return res.status(400).json({ ok: false, error: "Invalid hashedPin" });
    }

    // Rate limit
    if (isRateLimited(userId, roomId)) {
      logger.warn({ userId, roomId }, "PIN verification rate limited");
      return res
        .status(429)
        .json({ ok: false, error: "Too many attempts, try again later" });
    }

    // Read the stored hash via Admin SDK (bypasses client rules)
    const db = adminDatabase();
    const snap = await db.ref(`roomPins/${roomId}`).get();

    if (!snap.exists()) {
      // No PIN set for this room
      return res.json({ ok: true, valid: false });
    }

    const stored = snap.val() as { hashedPin?: string };
    const valid = stored.hashedPin === hashedPin;

    if (!valid) {
      logger.info({ userId, roomId }, "PIN verification failed");
    }

    return res.json({ ok: true, valid });
  } catch (err) {
    logger.error({ err }, "POST /api/rooms/verify-pin: unhandled error");
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
});

export default router;
