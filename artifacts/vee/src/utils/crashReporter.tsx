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
}

let crashListeners: Array<(crash: CrashInfo) => void> = [];
let lastCrash: CrashInfo | null = null;

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
    };
    notifyCrash(crash);

    if (defaultHandler) {
      try {
        defaultHandler(error, isFatal);
      } catch {
        /* ignore */
      }
    }
  });
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
