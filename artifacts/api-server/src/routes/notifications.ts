import { Router, type IRouter, type Request, type Response } from "express";
import {
  adminDatabase,
  adminMessaging,
  getAdminInitError,
  isAdminReady,
  verifyIdToken,
} from "../lib/firebaseAdmin";
import { logger } from "../lib/logger";

/**
 * POST /api/notifications/send — fire-and-forget push trigger.
 *
 * 2026-10-14 (Sumon): PERMANENT FIX — OneSignal dropped, FCM direct.
 * Flow: vee app notifyService.ts → this route → Firebase Admin SDK → FCM.
 * - 100% free, unlimited, no third-party
 * - FCM token is stored at users/{uid}/oneSignalId (OneSignal's pushSubscription.id IS the FCM token)
 *
 * The recipient's per-category toggle is read from
 * `users/{externalUserId}/notificationSettings` in RTDB. If the toggle for the
 * notification's category is off, the push is skipped (200 { ok, skipped })
 * without touching FCM.
 *
 * Required env (server env, NOT EAS):
 *   FIREBASE_SERVICE_ACCOUNT_JSON  Firebase service-account JSON string,
 *                                  OR GOOGLE_APPLICATION_CREDENTIALS file path
 * Optional:
 *   FIREBASE_DATABASE_URL          RTDB instance URL
 *                                  (defaults to the vee RTDB instance)
 *
 * Response contract (client is fire-and-forget):
 *   200 { ok: true }                  push accepted / handed to FCM
 *   200 { ok: true, skipped: true }   recipient disabled this category / muted / no token
 *   400                               missing/invalid externalUserId, title,
 *                                     message, or oversized data payload
 *   401                               missing or invalid Firebase ID token
 *   500                               server misconfigured or unhandled error
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

/** Hard caps on client-controlled fields (abuse friction + FCM sanity). */
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

    // 2026-10-13 (Sumon): muted chat-এ push যাবে না। chatId data payload-এ থাকে।
    if (categoryKey === "messages") {
      const chatId =
        typeof dataPayload === "object" &&
        dataPayload !== null &&
        typeof (dataPayload as Record<string, unknown>)["chatId"] === "string"
          ? ((dataPayload as Record<string, unknown>)["chatId"] as string)
          : null;
      if (chatId && chatId.length > 0 && !INVALID_EXTERNAL_USER_ID_CHARS.test(chatId)) {
        try {
          const muteSnap = await adminDatabase()
            .ref(`userChats/${externalUserId}/${chatId}/isMuted`)
            .get();
          if (muteSnap.val() === true) {
            logger.info(
              { externalUserId, chatId },
              "Push skipped: recipient muted this chat",
            );
            return res.status(200).json({ ok: true, skipped: true, muted: true });
          }
        } catch (err) {
          // Mute check ব্যর্থ হলে push পাঠিয়ে দিই (fail-open) — notification
          // miss হওয়ার চেয়ে extra notification ভালো।
          logger.warn({ err, externalUserId, chatId }, "Mute check failed, sending push anyway");
        }
      }
    }

    // 2026-10-14 (Sumon): FCM DIRECT — get recipient's FCM token from Firebase.
    // The app saves OneSignal's pushSubscription.id to users/{uid}/oneSignalId,
    // and on Android that IS the FCM registration token. No OneSignal needed.
    let fcmToken: string | null = null;
    try {
      const tokenSnap = await adminDatabase()
        .ref(`users/${externalUserId}/oneSignalId`)
        .get();
      const tokenVal = tokenSnap.val();
      if (typeof tokenVal === "string" && tokenVal.trim().length > 0) {
        fcmToken = tokenVal.trim();
      }
    } catch (err) {
      logger.warn({ err, externalUserId }, "Failed to read FCM token, skipping push");
    }
    if (!fcmToken) {
      logger.info(
        { externalUserId },
        "Push skipped: recipient has no FCM token (app never registered)",
      );
      return res.status(200).json({ ok: true, skipped: true, noToken: true });
    }

    // Convert data payload to string map for FCM (FCM data values must be strings)
    const fcmData: Record<string, string> = {};
    if (typeof dataPayload === "object" && dataPayload !== null) {
      for (const [k, v] of Object.entries(dataPayload as Record<string, unknown>)) {
        try {
          fcmData[k] = typeof v === "string" ? v : JSON.stringify(v);
        } catch {
          // skip unserializable values
        }
      }
    }
    // Always include category so the app can route the notification
    fcmData["category"] = categoryKey;

    try {
      const messageId = await adminMessaging().send({
        token: fcmToken,
        notification: {
          title: title.trim(),
          body: message.trim(),
        },
        data: fcmData,
        android: {
          priority: "high",
          notification: {
            sound: "default",
            channelId: "vee_notifications",
          },
        },
      });
      logger.info(
        { externalUserId, category: categoryKey, messageId },
        "Push notification sent via FCM direct",
      );
    } catch (err: unknown) {
      // FCM send failed (invalid token, etc.) — log with full detail, client stays fire-and-forget.
      // 2026-10-14: Unlike the old OneSignal path, we now LOG the real error instead of hiding it.
      const errMsg = err instanceof Error ? err.message : String(err);
      const errCode = (err as { code?: string })?.code ?? "unknown";
      logger.error(
        { err: errMsg, code: errCode, externalUserId },
        "FCM send failed",
      );
      // If the token is invalid/expired, clear it so we don't keep trying.
      // FCM error codes: messaging/invalid-registration-token, messaging/registration-token-not-registered
      if (
        errCode === "messaging/invalid-registration-token" ||
        errCode === "messaging/registration-token-not-registered"
      ) {
        try {
          await adminDatabase().ref(`users/${externalUserId}/oneSignalId`).remove();
          logger.info({ externalUserId }, "Cleared invalid FCM token");
        } catch {
          // non-critical
        }
      }
    }

    // Fire-and-forget: always 200 to the client on delivery attempts.
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /api/notifications/send");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/notifications/broadcast — official notice to ALL users via FCM.
 *
 * 2026-10-14 (Sumon): Admin panel থেকে official notice পাঠানোর জন্য।
 * - Only platform admins (superAdmin/admin via Firebase custom claims) can call.
 * - Collects all users' FCM tokens from users/{uid}/oneSignalId and sends
 *   via sendEachForMulticast (500 per batch). No app change needed.
 * - 100% free, unlimited, no third-party.
 *
 * Body: { title: string, message: string, data?: object }
 * Response: 200 { ok: true, sent: number, failed: number } on success.
 */
router.post("/broadcast", async (req: Request, res: Response) => {
  try {
    if (!isAdminReady()) {
      logger.error("POST /api/notifications/broadcast: Firebase Admin SDK not initialized");
      return res.status(500).json({ ok: false, error: "Notification service not configured" });
    }

    // Caller must be authenticated
    const authHeader = req.headers.authorization;
    const bearerMatch = /^Bearer (.+)$/.exec(authHeader ?? "");
    if (!bearerMatch) {
      return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    }
    let decoded: { role?: string; uid?: string };
    try {
      decoded = (await verifyIdToken(bearerMatch[1])) as unknown as {
        role?: string;
        uid?: string;
      };
    } catch (err) {
      logger.warn({ err }, "POST /api/notifications/broadcast: invalid Firebase ID token");
      return res.status(401).json({ ok: false, error: "Invalid ID token" });
    }

    // Only platform admins can broadcast
    const role = decoded.role ?? "";
    if (role !== "superAdmin" && role !== "admin") {
      // Fallback: check admins registry in RTDB
      try {
        const adminSnap = await adminDatabase()
          .ref(`admins/${decoded.uid ?? ""}`)
          .get();
        if (!adminSnap.exists()) {
          return res.status(403).json({ ok: false, error: "Admin only" });
        }
      } catch {
        return res.status(403).json({ ok: false, error: "Admin only" });
      }
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = body["title"];
    const message = body["message"];
    const data = body["data"];

    if (
      typeof title !== "string" ||
      title.trim().length === 0 ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return res.status(400).json({ ok: false, error: "title and message are required" });
    }
    if (title.length > MAX_TITLE_LENGTH || message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ ok: false, error: "title or message is invalid" });
    }

    const fcmData: Record<string, string> = { category: "official" };
    if (typeof data === "object" && data !== null) {
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        try {
          fcmData[k] = typeof v === "string" ? v : JSON.stringify(v);
        } catch {
          // skip unserializable
        }
      }
    }

    // Collect all users' FCM tokens. users/{uid}/oneSignalId holds the FCM token.
    // For scale: paginate if users grow large; 500/batch via sendEachForMulticast.
    const allTokens: string[] = [];
    try {
      const usersSnap = await adminDatabase().ref("users").get();
      if (usersSnap.exists()) {
        usersSnap.forEach((child) => {
          const token = child.child("oneSignalId").val();
          if (typeof token === "string" && token.trim().length > 0) {
            allTokens.push(token.trim());
          }
          return false; // continue iteration
        });
      }
    } catch (err) {
      logger.error({ err }, "Broadcast: failed to collect FCM tokens");
      return res.status(500).json({ ok: false, error: "Failed to collect tokens" });
    }
    if (allTokens.length === 0) {
      return res.status(200).json({ ok: true, sent: 0, failed: 0, note: "no tokens" });
    }

    // FCM multicast max 500 tokens per call — batch it.
    let totalSuccess = 0;
    let totalFailure = 0;
    const invalidTokens: string[] = [];
    for (let i = 0; i < allTokens.length; i += 500) {
      const batch = allTokens.slice(i, i + 500);
      const batchResult = await adminMessaging().sendEachForMulticast({
        tokens: batch,
        notification: {
          title: title.trim(),
          body: message.trim(),
        },
        data: fcmData,
        android: {
          priority: "high",
          notification: {
            sound: "default",
            channelId: "vee_notifications",
          },
        },
      });
      totalSuccess += batchResult.successCount;
      totalFailure += batchResult.failureCount;
      batchResult.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const code = (resp.error as { code?: string })?.code ?? "";
          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            const badToken = batch[idx];
            if (badToken) invalidTokens.push(badToken);
          }
        }
      });
    }
    if (invalidTokens.length > 0) {
      logger.info({ count: invalidTokens.length }, "Broadcast: invalid tokens detected");
    }

    logger.info(
      { success: totalSuccess, failure: totalFailure, by: decoded.uid },
      "Official broadcast sent via FCM multicast",
    );
    return res.status(200).json({
      ok: true,
      sent: totalSuccess,
      failed: totalFailure,
    });
  } catch (err) {
    logger.error({ err }, "Unhandled error in POST /api/notifications/broadcast");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;
