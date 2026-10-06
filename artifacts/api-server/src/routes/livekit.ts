import { Router, type IRouter, type Request, type Response } from "express";
import { AccessToken } from "livekit-server-sdk";
import {
  adminDatabase,
  getAdminInitError,
  isAdminReady,
  verifyIdToken,
} from "../lib/firebaseAdmin";
import { logger } from "../lib/logger";

/**
 * POST /api/livekit/token — mint a LiveKit room-join token for the caller.
 *
 * Flow:  vee app livekitService.ts → this route → LiveKit join token.
 * The LiveKit API key/secret live only in server env; the client never sees
 * them and never mints its own tokens.
 *
 * The participant identity always comes from the verified Firebase ID token
 * (`decoded.uid`) — a client-supplied uid is never trusted.
 *
 * Authorization gate (server-side, via Admin SDK): the roomName must be a
 * real voice-room ID; the caller must not be platform-banned nor blocked
 * from the room; private (PIN-locked) rooms additionally require the caller
 * to be the room owner or hold a fresh PIN grant written by
 * POST /api/rooms/verify-pin (10-minute TTL).
 *
 * Required env (server env, NOT EAS):
 *   FIREBASE_SERVICE_ACCOUNT_JSON  Firebase service-account JSON string,
 *                                  OR GOOGLE_APPLICATION_CREDENTIALS file path
 *   LIVEKIT_URL                    LiveKit server URL (wss://...), also
 *                                  returned to the client for connecting
 *   LIVEKIT_API_KEY                LiveKit API key (token signing only)
 *   LIVEKIT_API_SECRET             LiveKit API secret (token signing only)
 * Optional:
 *   FIREBASE_DATABASE_URL          RTDB instance URL
 *                                  (defaults to the vee RTDB instance)
 *
 * Request body:
 *   { roomName: string, participantName?: string, canPublish?: boolean }
 *
 * Response contract:
 *   200 { token, url }            fresh LiveKit join token (valid 6h)
 *   400                           roomName missing / not a string / too long
 *   401                           missing or invalid Firebase ID token
 *   403                           banned / room-blocked / PIN required
 *   404                           room does not exist
 *   500                           server misconfigured or unhandled error
 */

const router: IRouter = Router();

/** Hard caps on client-controlled fields (bound JWT size, abuse friction). */
const MAX_ROOM_NAME_LENGTH = 200;
const MAX_PARTICIPANT_NAME_LENGTH = 100;

// Firebase Admin SDK is initialized once in ../lib/firebaseAdmin (fail-closed).

router.post("/token", async (req: Request, res: Response) => {
  try {
    // Fail closed: no Admin SDK → we cannot verify tokens.
    if (!isAdminReady()) {
      logger.error(
        { err: getAdminInitError() },
        "POST /api/livekit/token: Firebase Admin SDK not initialized",
      );
      return res
        .status(500)
        .json({ ok: false, error: "LiveKit service not configured" });
    }

    // Caller must be an authenticated user (client sends its Firebase ID token).
    const authHeader = req.headers.authorization;
    const bearerMatch = /^Bearer (.+)$/.exec(authHeader ?? "");
    if (!bearerMatch) {
      return res
        .status(401)
        .json({ ok: false, error: "Missing Authorization Bearer token" });
    }
    let uid: string;
    try {
      const decoded = await verifyIdToken(bearerMatch[1]);
      uid = decoded.uid;
    } catch (err) {
      logger.warn(
        { err },
        "POST /api/livekit/token: invalid Firebase ID token",
      );
      return res.status(401).json({ ok: false, error: "Invalid ID token" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const roomName = body["roomName"];
    const participantName = body["participantName"];
    const canPublish = body["canPublish"];

    if (typeof roomName !== "string" || roomName.trim().length === 0) {
      return res
        .status(400)
        .json({ ok: false, error: "roomName is required" });
    }
    if (roomName.length > MAX_ROOM_NAME_LENGTH) {
      return res
        .status(400)
        .json({ ok: false, error: "roomName is too long" });
    }

    // --- Room authorization gate ---
    // The roomName is a Firebase voice-room ID. Verify via Admin SDK that:
    //   1. the room actually exists (kills arbitrary-room token minting),
    //   2. the caller is not platform-banned,
    //   3. the caller is not blocked from this room,
    //   4. for private (PIN-locked) rooms, the caller is the owner or has a
    //      fresh PIN grant written by POST /api/rooms/verify-pin.
    const roomId = roomName.trim();
    if (/[/\\.#$[\]]/.test(roomId)) {
      return res.status(400).json({ ok: false, error: "Invalid roomName" });
    }
    try {
      const db = adminDatabase();
      const [infoSnap, pinSnap, blockSnap, bannedSnap, grantSnap] =
        await Promise.all([
          db.ref(`rooms/${roomId}/info`).get(),
          db.ref(`roomPins/${roomId}`).get(),
          db.ref(`roomBlocks/${roomId}/${uid}`).get(),
          db.ref(`users/${uid}/banned`).get(),
          db.ref(`roomPinGrants/${roomId}/${uid}`).get(),
        ]);

      if (!infoSnap.exists()) {
        return res.status(404).json({ ok: false, error: "Room not found" });
      }
      if (bannedSnap.val() === true) {
        logger.warn({ uid, roomId }, "LiveKit token denied: user banned");
        return res
          .status(403)
          .json({ ok: false, error: "Account restricted" });
      }
      if (blockSnap.exists()) {
        logger.warn({ uid, roomId }, "LiveKit token denied: room-blocked");
        return res
          .status(403)
          .json({ ok: false, error: "You are blocked from this room" });
      }

      const info = infoSnap.val() as { ownerId?: string };
      const isOwner = info?.ownerId === uid;
      if (pinSnap.exists() && !isOwner) {
        // Private room: require a PIN grant from a successful verify-pin
        // within the last 10 minutes (client flow: PIN dialog → verify →
        // enter room → token request, seconds apart).
        const grant = grantSnap.val() as { at?: number } | null;
        const grantAt = typeof grant?.at === "number" ? grant.at : 0;
        const grantAge = Date.now() - grantAt;
        if (grantAt <= 0 || grantAge < 0 || grantAge > 10 * 60 * 1000) {
          logger.warn({ uid, roomId }, "LiveKit token denied: PIN required");
          return res
            .status(403)
            .json({ ok: false, error: "PIN verification required" });
        }
      }
    } catch (gateErr) {
      logger.error({ gateErr, uid, roomId }, "LiveKit token gate failed");
      return res
        .status(500)
        .json({ ok: false, error: "Authorization check failed" });
    }
    // --- End authorization gate ---

    const participantNameStr =
      typeof participantName === "string" ? participantName : uid;
    if (participantNameStr.length > MAX_PARTICIPANT_NAME_LENGTH) {
      return res
        .status(400)
        .json({ ok: false, error: "participantName is too long" });
    }

    const livekitUrl = process.env["LIVEKIT_URL"];
    const livekitApiKey = process.env["LIVEKIT_API_KEY"];
    const livekitApiSecret = process.env["LIVEKIT_API_SECRET"];
    if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
      logger.error(
        "POST /api/livekit/token: LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set",
      );
      return res
        .status(500)
        .json({ ok: false, error: "LiveKit service not configured" });
    }

    // Participant identity is the verified Firebase uid — never client-supplied.
    const at = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: uid,
      name: participantNameStr,
      ttl: "6h",
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: !!canPublish,
      canSubscribe: true,
    });
    const token = await at.toJwt();

    logger.info({ uid, roomName }, "Minted LiveKit join token");
    return res.status(200).json({ token, url: livekitUrl });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /api/livekit/token");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;
