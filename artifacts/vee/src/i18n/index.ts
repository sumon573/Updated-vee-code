/**
 * i18n initialisation — import this module once at app root to configure i18next.
 * Uses in-memory resources (no backend) so init is synchronous.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';

/**
 * NOTE (2026-10-09): Arabic was REMOVED from the selectable languages.
 * Arabic is RTL — selecting it called I18nManager.forceRTL(true), which
 * mirrored the entire app layout and left it permanently garbled
 * (forceRTL has no clean undo without a full reload, and no screen in the
 * app was ever designed or tested for RTL). Per the "no setting may ever
 * break the app" rule, RTL is now disabled app-wide via
 * I18nManager.allowRTL(false) in app/_layout.tsx, and 'ar' can never be
 * selected.
 *
 * 2026-10-22 (perf audit): only English is bundled eagerly. bn/hi load
 * on demand via ensureLanguageBundle() (dynamic import +
 * addResourceBundle) the first time the user picks that language, and
 * the 'ar' resource is no longer registered at all (it was parsed on
 * every cold start despite being unselectable — dead weight). If RTL
 * support is ever built, re-add 'ar' through the same lazy path.
 */
export type SupportedLanguage = 'en' | 'bn' | 'hi';

export interface LanguageOption {
  code: SupportedLanguage;
  /** English name */
  name: string;
  /** Name in the language itself */
  nativeName: string;
  /** Flag emoji */
  flag: string;
  /** Whether this is an RTL language */
  rtl: boolean;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English',  nativeName: 'English',   flag: '🇬🇧', rtl: false },
  { code: 'bn', name: 'Bengali',  nativeName: 'বাংলা',     flag: '🇧🇩', rtl: false },
  { code: 'hi', name: 'Hindi',    nativeName: 'हिन्दी',    flag: '🇮🇳', rtl: false },
];

/** No RTL language is selectable — kept as an empty list for API compatibility. */
export const RTL_LANGUAGES: SupportedLanguage[] = [];

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en },
      },
      lng: 'en',
      fallbackLng: 'en',
      interpolation: {
        // React already escapes values — no need for i18next to double-escape
        escapeValue: false,
      },
      // Suppress the missing-key warning noise in dev; English fallback covers it
      saveMissing: false,
    });
}

const bundleLoads = new Map<string, Promise<void>>();

/**
 * Load a non-English locale bundle on demand (2026-10-22). Idempotent and
 * race-safe: concurrent calls share one in-flight import. English is
 * always available (bundled eagerly at init).
 */
export function ensureLanguageBundle(lang: SupportedLanguage): Promise<void> {
  if (lang === 'en' || i18n.hasResourceBundle(lang, 'translation')) {
    return Promise.resolve();
  }
  const inFlight = bundleLoads.get(lang);
  if (inFlight) return inFlight;
  const load = (async () => {
    const mod = lang === 'bn'
      ? await import('./locales/bn')
      : await import('./locales/hi');
    i18n.addResourceBundle(lang, 'translation', mod.default, true, true);
  })().catch((e) => {
    // Never let a failed bundle load break language switching — the UI
    // falls back to English strings. Allow a later retry.
    bundleLoads.delete(lang);
    console.warn('[i18n] locale bundle load failed', lang, (e as Error)?.message ?? String(e));
  });
  bundleLoads.set(lang, load);
  return load;
}

export default i18n;
