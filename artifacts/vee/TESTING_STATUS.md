# Vee testing status

## Verified in this workspace

- Expo SDK 54 public configuration resolves successfully.
- Vee Android and iOS production JavaScript bundles compile successfully.
- Expo manifests for Android and iOS are generated successfully.
- All referenced static assets are found and copied into the build.
- Vee and API server TypeScript checks pass.
- The API server starts successfully and `/api/healthz` returns `status: ok`.
- Firebase Admin, Cloudinary authenticated delete, and OneSignal server integration
  are configured through secure environment secrets.
- The server-side expired-story cleanup job starts without configuration warnings.
- The Expo development workflow starts Metro and connects its tunnel.

## Device checks still required

An APK or physical device is required to verify native-only behavior. Before
calling the app ready for release, test on at least one Android device:

1. Fresh install, cold start, and restart after force-close.
2. Signup, login, password reset, logout, and offline startup.
3. Profile photo, story image/video, and chat media uploads.
4. Real-time chat, reactions, reply, delete, block, and report.
5. Push notification delivery and notification-to-chat/room navigation.
6. Microphone permission, one-to-one call, voice-room join/leave, mute, and
   background/foreground resume.
7. Wallet, gift send/receive, and insufficient-balance handling.
8. Language switching, Arabic RTL restart, dark mode, and deep links.

## Android build note

This repository contains the Expo source and build configuration, but not a
checked-in native `android/` project. Replit's mobile workflow can preview the
app and this workspace can validate the production JS bundles; an installable
Android APK must be produced by the Android/Expo build service used by the
target account, then installed for the device checks above.

Do not put Firebase Admin, Cloudinary API secret, or OneSignal REST key in this
archive. Configure them as secure environment secrets in the target account.