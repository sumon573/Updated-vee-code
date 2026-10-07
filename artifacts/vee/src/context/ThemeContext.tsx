/**
 * ThemeContext — app-wide dark/light mode.
 *
 * • Dark mode is the DEFAULT (the app is dark-first by design).
 * • Loads preference from Firebase RTDB on auth mount (users/{uid}/appSettings/darkMode).
 * • Exposes darkMode, theme colors, and setDarkMode via useTheme().
 * • setDarkMode updates local state AND persists to Firebase immediately.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { ref, get, update } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from './AuthContext';

export type ThemeColors = {
  bg: string;
  surface: string;
  card: string;
  text: string;
  muted: string;
  mutedDim: string;
  border: string;
  primary: string;
  glow: string;
  error: string;
  gold: string;
};

const DARK: ThemeColors = {
  bg: '#07020F',
  surface: 'rgba(255,255,255,0.055)',
  card: '#120A24',
  text: '#FFFFFF',
  muted: '#B8A6D9',
  mutedDim: '#4A3D6E',
  border: '#1E1830',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  error: '#EF4444',
  gold: '#F5C044',
};

const LIGHT: ThemeColors = {
  bg: '#F5F3FA',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  text: '#1A1030',
  muted: '#6B5B8E',
  mutedDim: '#9A8BB8',
  border: '#E8E2F2',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  error: '#EF4444',
  gold: '#D9A02B',
};

type ThemeContextType = {
  darkMode: boolean;
  theme: ThemeColors;
  setDarkMode: (value: boolean) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType>({
  darkMode: true, // default: Dark Mode
  theme: DARK,
  setDarkMode: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [darkMode, setDarkModeState] = useState(true); // default: Dark Mode

  // Load persisted preference once the user is known
  useEffect(() => {
    if (!user?.uid) {
      setDarkModeState(true); // reset to default (dark) on logout
      return;
    }
    get(ref(database, `users/${user.uid}/appSettings/darkMode`))
      .then((snap) => {
        if (snap.exists()) {
          setDarkModeState(snap.val() as boolean);
        }
        // If no value saved yet, stay at default (true = Dark Mode)
      })
      .catch(() => {/* background: safe to swallow — theme load is best-effort */});
  }, [user?.uid]);

  const setDarkMode = useCallback((value: boolean) => {
    setDarkModeState(value);
    if (user?.uid) {
      update(ref(database, `users/${user.uid}/appSettings`), { darkMode: value })
        .catch(() => {/* background: safe to swallow — theme persists on next toggle */});
    }
  }, [user?.uid]);

  const toggleTheme = useCallback(() => {
    setDarkMode(!darkMode);
  }, [darkMode, setDarkMode]);

  const theme = useMemo(() => (darkMode ? DARK : LIGHT), [darkMode]);

  return (
    <ThemeContext.Provider value={{ darkMode, theme, setDarkMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
