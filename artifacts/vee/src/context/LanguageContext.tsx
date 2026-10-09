/**
 * LanguageContext
 *
 * BUG 17 fix: Added a 6-second timeout fallback on the AsyncStorage load
 * so the app never stays permanently stuck on the loading screen if
 * AsyncStorage hangs (common after a crash on some Android devices).
 *
 * 2026-10-09 — RTL REMOVED PERMANENTLY: selecting Arabic used to call
 * I18nManager.forceRTL(true), which mirrored the whole app and left it
 * permanently garbled (no clean undo). No screen was ever built for RTL.
 * Per the "no setting may ever break the app" rule:
 *   - Arabic is no longer selectable (see src/i18n/index.ts),
 *   - I18nManager.allowRTL(false) is enforced at app root (app/_layout.tsx),
 *   - this context never touches I18nManager again.
 * If a device has 'ar' persisted from before, it is migrated to 'en'.
 *
 * Responsibilities:
 *  - Load the previously-selected language from AsyncStorage on app start.
 *  - Apply it to i18next.
 *  - Expose helpers so screens can change / confirm the language.
 *  - Track whether the user has ever completed language selection (used by
 *    AuthGuard to gate the language-select screen on first launch).
 */

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n, { SupportedLanguage } from '@/src/i18n';

// ─── Storage keys ──────────────────────────────────────────────────────────────

const LANG_KEY     = '@vee/language';
const SELECTED_KEY = '@vee/language_selected';

/** Maximum ms to wait for AsyncStorage on app start. */
const LANG_LOADING_TIMEOUT_MS = 6_000;

// ─── Context shape ─────────────────────────────────────────────────────────────

interface LanguageContextValue {
  /** Active language code */
  language: SupportedLanguage;
  /** Always false — RTL is permanently disabled app-wide (2026-10-09). */
  isRTL: boolean;
  /** True once the user has completed the language-selection screen */
  isLanguageSelected: boolean;
  /** True while the context is loading from AsyncStorage */
  isLoading: boolean;
  /** Change the active language and persist it */
  changeLanguage: (lang: SupportedLanguage) => Promise<void>;
  /** Mark that the user has completed the language-selection step */
  markLanguageSelected: () => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  isRTL: false,
  isLanguageSelected: false,
  isLoading: true,
  changeLanguage: async () => {},
  markLanguageSelected: async () => {},
});

// ─── Provider ──────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage]                 = useState<SupportedLanguage>('en');
  const [isLanguageSelected, setIsLangSelected] = useState(false);
  const [isLoading, setIsLoading]               = useState(true);
  const loadingDoneRef = useRef(false);

  // Load persisted settings once on mount
  useEffect(() => {
    // BUG 17 fix: hard timeout so we never block the app permanently
    const timeoutId = setTimeout(() => {
      if (!loadingDoneRef.current) {
        loadingDoneRef.current = true;
        setIsLoading(false);
      }
    }, LANG_LOADING_TIMEOUT_MS);

    (async () => {
      try {
        const [savedLang, selected] = await Promise.all([
          AsyncStorage.getItem(LANG_KEY),
          AsyncStorage.getItem(SELECTED_KEY),
        ]);

        if (savedLang && isValidLang(savedLang)) {
          await applyLanguage(savedLang as SupportedLanguage, false);
        } else if (savedLang === 'ar') {
          // Migrated: Arabic was removed (RTL broke the app) — fall back to
          // English and overwrite the persisted value so the user is never
          // stuck on an unselectable language.
          await applyLanguage('en', true);
        }

        setIsLangSelected(selected === 'true');
      } catch {
        // Silently fall back to English defaults
      } finally {
        if (!loadingDoneRef.current) {
          loadingDoneRef.current = true;
          clearTimeout(timeoutId);
        }
        setIsLoading(false);
      }
    })();

    return () => clearTimeout(timeoutId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Apply language to i18next, optionally persisting it. Never touches RTL. */
  async function applyLanguage(lang: SupportedLanguage, persist: boolean) {
    await i18n.changeLanguage(lang);
    setLanguage(lang);

    if (persist) {
      await AsyncStorage.setItem(LANG_KEY, lang);
    }
  }

  async function changeLanguage(lang: SupportedLanguage) {
    await applyLanguage(lang, true);
  }

  async function markLanguageSelected() {
    await AsyncStorage.setItem(SELECTED_KEY, 'true');
    setIsLangSelected(true);
  }

  return (
    <LanguageContext.Provider
      value={{
        language,
        isRTL: false, // RTL permanently disabled — see file header
        isLanguageSelected,
        isLoading,
        changeLanguage,
        markLanguageSelected,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useLanguage() {
  return useContext(LanguageContext);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isValidLang(value: string): value is SupportedLanguage {
  // 'ar' intentionally excluded — removed 2026-10-09 (RTL broke the app).
  return ['en', 'bn', 'hi'].includes(value);
}
