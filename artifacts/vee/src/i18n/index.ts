/**
 * i18n initialisation — import this module once at app root to configure i18next.
 * Uses in-memory resources (no backend) so init is synchronous.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import bn from './locales/bn';
import hi from './locales/hi';
import ar from './locales/ar';

/**
 * NOTE (2026-10-09): Arabic was REMOVED from the selectable languages.
 * Arabic is RTL — selecting it called I18nManager.forceRTL(true), which
 * mirrored the entire app layout and left it permanently garbled
 * (forceRTL has no clean undo without a full reload, and no screen in the
 * app was ever designed or tested for RTL). Per the "no setting may ever
 * break the app" rule, RTL is now disabled app-wide via
 * I18nManager.allowRTL(false) in app/_layout.tsx, and 'ar' can never be
 * selected. The ar locale resource stays registered below (harmless) so it
 * can return if full RTL support is ever properly built.
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
        bn: { translation: bn },
        hi: { translation: hi },
        ar: { translation: ar },
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

export default i18n;
