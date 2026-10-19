/**
 * crashReporter — Global crash-cause display (2026-10-11).
 * Sumon's rule: every error must show its REAL cause, never a generic message.
 *
 * Catches JS-level errors via ErrorUtils.setGlobalHandler and displays
 * the actual error message + stack on screen.
 *
 * LIMITATION: Native startup crashes (before JS loads) cannot be caught here.
 * If the app crashes before this code runs, no JS handler can display it.
 * Native crashes require adb logcat or Firebase Crashlytics to diagnose.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, Modal, StyleSheet } from 'react-native';

interface CrashInfo {
  message: string;
  stack?: string;
  timestamp: string;
  fatal?: boolean;
}

let crashListeners: Array<(crash: CrashInfo) => void> = [];
let lastCrash: CrashInfo | null = null;
// 2026-10-19 stability fix: rate-limit server reports — a crash loop must
// never spam Firebase (or itself, if the report write throws).
let lastServerReportAt = 0;
const SERVER_REPORT_MIN_GAP_MS = 60_000;

export function getLastCrash(): CrashInfo | null {
  return lastCrash;
}

export function onCrash(listener: (crash: CrashInfo) => void): () => void {
  crashListeners.push(listener);
  return () => {
    crashListeners = crashListeners.filter((l) => l !== listener);
  };
}

function notifyCrash(crash: CrashInfo): void {
  lastCrash = crash;
  crashListeners.forEach((l) => {
    try {
      l(crash);
    } catch {
      /* ignore listener errors */
    }
  });
}

/**
 * 2026-10-19 stability fix — report the crash to Firebase so the NEXT crash
 * leaves evidence even if the user can't screenshot it. Fire-and-forget:
 * never throws, never blocks, rate-limited. Writes to
 * `clientCrashReports/{uid}/{pushId}` (rules: owner-write only).
 */
function reportCrashToServer(crash: CrashInfo): void {
  try {
    const now = Date.now();
    if (now - lastServerReportAt < SERVER_REPORT_MIN_GAP_MS) return;
    lastServerReportAt = now;
    // Lazy imports — this module loads before Firebase is initialized.
    Promise.all([
      import('@/src/config/firebase'),
      import('firebase/database'),
      import('@/src/features/voice-room/utils/voiceCrashBreadcrumb'),
    ])
      .then(([{ auth, database }, { ref, push, set }, { getVoiceBreadcrumb }]) => {
        const uid = auth?.currentUser?.uid;
        if (!uid || !database) return;
        // 2026-10-19: include the voice breadcrumb if present — pinpoints
        // which native stage died when the crash was in a voice room.
        getVoiceBreadcrumb()
          .catch(() => null)
          .then((breadcrumb) => {
            const reportRef = push(ref(database, `clientCrashReports/${uid}`));
            set(reportRef, {
              message: String(crash.message || 'Unknown error').slice(0, 2000),
              stack: String(crash.stack || '').slice(0, 4000),
              timestamp: crash.timestamp,
              fatal: crash.fatal === true,
              voiceStage: breadcrumb ? breadcrumb.stage : null,
              voiceRoomId: breadcrumb ? breadcrumb.roomId : null,
            }).catch(() => {});
          });
      })
      .catch(() => {});
  } catch {
    // never break the crash path
  }
}

/**
 * Install the global JS error handler. Call once at app startup,
 * before any other imports that might throw.
 */
export function installGlobalCrashHandler(): void {
  const ErrorUtilsGlobal = (global as any).ErrorUtils;
  if (!ErrorUtilsGlobal?.setGlobalHandler) {
    return;
  }

  const defaultHandler = ErrorUtilsGlobal.getGlobalHandler?.();

  ErrorUtilsGlobal.setGlobalHandler((error: Error, isFatal?: boolean) => {
    const crash: CrashInfo = {
      message: error?.message || String(error) || 'Unknown error',
      stack: error?.stack || undefined,
      timestamp: new Date().toISOString(),
      fatal: isFatal === true,
    };
    notifyCrash(crash);
    // 2026-10-19 stability fix: leave server-side evidence for the next crash.
    reportCrashToServer(crash);

    if (defaultHandler) {
      try {
        defaultHandler(error, isFatal);
      } catch {
        /* ignore */
      }
    }
  });

  // 2026-10-19 stability fix: explicit unhandled-rejection safety net. Most
  // RN/Hermes versions route these through ErrorUtils already, but if the
  // global supports the DOM-style event, listen directly too. Harmless if
  // unsupported — never throws.
  try {
    const g = global as unknown as {
      addEventListener?: (type: string, listener: (e: unknown) => void) => void;
    };
    if (typeof g.addEventListener === 'function') {
      g.addEventListener('unhandledrejection', (e: unknown) => {
        try {
          const reason = (e as { reason?: unknown })?.reason;
          const crash: CrashInfo = {
            message:
              reason instanceof Error
                ? reason.message
                : `Unhandled promise rejection: ${String(reason)}`,
            stack: reason instanceof Error ? reason.stack : undefined,
            timestamp: new Date().toISOString(),
            fatal: false,
          };
          notifyCrash(crash);
          reportCrashToServer(crash);
        } catch {
          /* ignore */
        }
      });
    }
  } catch {
    /* ignore */
  }
}

/**
 * CrashOverlay — displays the crash cause on screen when a JS error occurs.
 * Mount this at the root of the app.
 */
export function CrashOverlay(): React.ReactElement | null {
  const [crash, setCrash] = useState<CrashInfo | null>(null);

  useEffect(() => {
    return onCrash(setCrash);
  }, []);

  if (!crash) return null;

  return (
    <Modal visible transparent={false} animationType="slide">
      <View style={styles.container}>
        <Text style={styles.title}>⚠️ App Error</Text>
        <Text style={styles.subtitle}>The app hit a problem. Here is the real cause:</Text>
        <ScrollView style={styles.scroll}>
          <Text style={styles.message}>{crash.message}</Text>
          {crash.stack ? (
            <Text style={styles.stack}>{crash.stack}</Text>
          ) : null}
          <Text style={styles.time}>{crash.timestamp}</Text>
        </ScrollView>
        <Pressable
          style={styles.button}
          onPress={() => setCrash(null)}
        >
          <Text style={styles.buttonText}>Dismiss</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#d32f2f',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  scroll: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
  },
  message: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  stack: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
  },
  time: {
    fontSize: 11,
    color: '#999',
    marginTop: 12,
  },
  button: {
    backgroundColor: '#2196F3',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
