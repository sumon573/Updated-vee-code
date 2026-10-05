import { Router, type IRouter, type Request, type Response } from "express";
import {
  adminDatabase,
  getAdminInitError,
  isAdminReady,
  verifyIdToken,
} from "../lib/firebaseAdmin";
import { logger } from "../lib/logger";

/**
 * POST /api/notifications/send — fire-and-forget push trigger.
 *
 * Flow:  vee app notifyService.ts → this route → OneSignal REST API.
 * The OneSignal REST API key lives only in server env; the client never sees it.
 *
 * The recipient's per-category toggle is read from
 * `users/{externalUserId}/notificationSettings` in RTDB. If the toggle for the
 * notification's category is off, the push is skipped (200 { ok, skipped })
 * without touching OneSignal.
 *
 * Required env (server env, NOT EAS):
 *   FIREBASE_SERVICE_ACCOUNT_JSON  Firebase service-account JSON string,
 *                                  OR GOOGLE_APPLICATION_CREDENTIALS file path
 *   ONESIGNAL_APP_ID               OneSignal app id (REST)
 *   ONESIGNAL_REST_API_KEY         OneSignal REST API key (Basic auth)
 * Optional:
 *   FIREBASE_DATABASE_URL          RTDB instance URL
 *                                  (defaults to the vee RTDB instance)
 *
 * Response contract (client is fire-and-forget):
 *   200 { ok: true }                  push accepted / handed to OneSignal
 *   200 { ok: true, skipped: true }   recipient disabled this category
 *   400                               missing/invalid externalUserId, title,
 *                                     message, or oversized data payload
 *   401                               missing or invalid Firebase ID token
 *   500                               server misconfigured or unhandled error
 *
 * Note: a non-2xx response from OneSignal is logged as an error but still
 * returns 200 { ok: true } to the client — the client contract is
 * fire-and-forget and the client only retries network-level failures.
 */

const router: IRouter = Router();

type NotificationCategory =
  | "messages"
  | "voiceRooms"
  | "follows"
  | "mentions"
  | "stories";

type NotificationSettings = {
  messages?: boolean;
  voiceRooms?: boolean;
  follows?: boolean;
  mentions?: boolean;
  stories?: boolean;
  sounds?: boolean;
  vibration?: boolean;
};

const VALID_CATEGORIES: readonly NotificationCategory[] = [
  "messages",
  "voiceRooms",
  "follows",
  "mentions",
  "stories",
];

/** Hard caps on client-controlled fields (abuse friction + OneSignal sanity). */
const MAX_EXTERNAL_USER_ID_LENGTH = 256;
const MAX_TITLE_LENGTH = 200;
// Generous: chat messages can be long and `message` mirrors the DM text.
// The 100kb body-parser limit remains the real backstop.
const MAX_MESSAGE_LENGTH = 5000;
const MAX_DATA_JSON_BYTES = 8192;

/**
 * Characters rejected in externalUserId. The RTDB-invalid set (`. $ # [ ]`)
 * plus `/` blocks path traversal into other users' `notificationSettings`
 * nodes (e.g. externalUserId "a/b"), plus ASCII control characters.
 */
const INVALID_EXTERNAL_USER_ID_CHARS = /[/.$#[\]\u0000-\u001f\u007f]/;

// Firebase Admin SDK is initialized once in ../lib/firebaseAdmin (fail-closed).

router.post("/send", async (req: Request, res: Response) => {
  try {
    // Fail closed: no Admin SDK → we cannot verify tokens or read settings.
    if (!isAdminReady()) {
      logger.error(
        { err: getAdminInitError() },
        "POST /api/notifications/send: Firebase Admin SDK not initialized",
      );
      return res
        .status(500)
        .json({ ok: false, error: "Notification service not configured" });
    }

    // Caller must be an authenticated user (client sends its Firebase ID token).
    const authHeader = req.headers.authorization;
    const bearerMatch = /^Bearer (.+)$/.exec(authHeader ?? "");
    if (!bearerMatch) {
      return res
        .status(401)
        .json({ ok: false, error: "Missing Authorization Bearer token" });
    }
    try {
      await verifyIdToken(bearerMatch[1]);
    } catch (err) {
      logger.warn(
        { err },
        "POST /api/notifications/send: invalid Firebase ID token",
      );
      return res.status(401).json({ ok: false, error: "Invalid ID token" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const externalUserId = body["externalUserId"];
    const title = body["title"];
    const message = body["message"];
    const data = body["data"];
    const category = body["category"];

    if (
      typeof externalUserId !== "string" ||
      externalUserId.trim().length === 0 ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return res.status(400).json({
        ok: false,
        error: "externalUserId, title and message are required",
      });
    }

    if (
      externalUserId.length > MAX_EXTERNAL_USER_ID_LENGTH ||
      INVALID_EXTERNAL_USER_ID_CHARS.test(externalUserId) ||
      title.length > MAX_TITLE_LENGTH ||
      message.length > MAX_MESSAGE_LENGTH
    ) {
      return res.status(400).json({
        ok: false,
        error: "externalUserId, title or message is invalid",
      });
    }

    // `data` is forwarded to OneSignal verbatim — bound its size so a caller
    // cannot smuggle an arbitrarily large payload through this endpoint.
    const dataPayload: unknown =
      typeof data === "object" && data !== null ? data : {};
    if (JSON.stringify(dataPayload).length > MAX_DATA_JSON_BYTES) {
      return res
        .status(400)
        .json({ ok: false, error: "data payload too large" });
    }

    const categoryKey: NotificationCategory =
      typeof category === "string" &&
      (VALID_CATEGORIES as readonly string[]).includes(category)
        ? (category as NotificationCategory)
        : "messages";

    // Read the recipient's notification settings; every toggle defaults to
    // true when the node (or the key) is missing.
    const settingsSnap = await adminDatabase()
      .ref(`users/${externalUserId}/notificationSettings`)
      .get();
    const stored = (settingsSnap.val() ?? {}) as NotificationSettings;
    const settings: Record<NotificationCategory, boolean> = {
      messages: stored.messages ?? true,
      voiceRooms: stored.voiceRooms ?? true,
      follows: stored.follows ?? true,
      mentions: stored.mentions ?? true,
      stories: stored.stories ?? true,
    };

    if (!settings[categoryKey]) {
      logger.info(
        { externalUserId, category: categoryKey },
        "Push skipped: recipient disabled this notification category",
      );
      return res.status(200).json({ ok: true, skipped: true });
    }

    const oneSignalAppId = process.env["ONESIGNAL_APP_ID"];
    const oneSignalRestApiKey = process.env["ONESIGNAL_REST_API_KEY"];
    if (!oneSignalAppId || !oneSignalRestApiKey) {
      logger.error(
        "POST /api/notifications/send: ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY not set",
      );
      return res
        .status(500)
        .json({ ok: false, error: "Notification service not configured" });
    }

    const onesignalRes = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${oneSignalRestApiKey}`,
      },
      body: JSON.stringify({
        app_id: oneSignalAppId,
        include_external_user_ids: [externalUserId],
        headings: { en: title },
        contents: { en: message },
        data: dataPayload,
      }),
      // Never let a hung OneSignal call tie up a server connection forever.
      signal: AbortSignal.timeout(10_000),
    });

    if (!onesignalRes.ok) {
      const responseBody = await onesignalRes.text().catch(() => "<unreadable>");
      logger.error(
        { status: onesignalRes.status, responseBody, externalUserId },
        "OneSignal API returned non-2xx",
      );
    } else {
      logger.info(
        { externalUserId, category: categoryKey },
        "Push notification handed to OneSignal",
      );
    }

    // Fire-and-forget: always 200 to the client on delivery attempts.
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /api/notifications/send");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;
