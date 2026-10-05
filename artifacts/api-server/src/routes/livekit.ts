import { Router, type IRouter, type Request, type Response } from "express";
import { AccessToken } from "livekit-server-sdk";
import {
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
 *   400                           roomName missing / not a string / too long,
 *                                   or participantName too long
 *   401                           missing or invalid Firebase ID token
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
