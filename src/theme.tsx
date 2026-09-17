import React, { createContext, useContext, useState, useEffect } from 'react';
import Storage from './utils/storage';

const DARK_MODE_KEY = '@camscanner_dark_mode';

// ========= COLOR PALETTES =========
export const LightTheme = {
  dark: false,
  bg:           '#f0f2f5',
  card:         '#ffffff',
  surface:      '#f8f9fa',
  border:       '#e8e8e8',
  text:         '#2c3e50',
  textSub:      '#7f8c8d',
  textMuted:    '#b2bec3',
  accent:       '#00bfa5',
  accentDark:   '#00897b',
  gradStart:    '#00bfa5',
  gradEnd:      '#009688',
  danger:       '#e53935',
  warn:         '#ef6c00',
  blue:         '#1e88e5',
  green:        '#43a047',
  shadow:       '#000000',
  fabBg:        '#00bfa5',
  headerBg:     '#ffffff',
  headerText:   '#2c3e50',
  iconBg:       '#f5f6fa',
  switchTrackOff: '#ddd',
  statusBar:    'dark-content' as 'dark-content' | 'light-content',
};

export const DarkTheme = {
  dark: true,
  bg:           '#0d0d0d',
  card:         '#1a1a2e',
  surface:      '#16213e',
  border:       '#2a2a4a',
  text:         '#e0e0ff',
  textSub:      '#8892b0',
  textMuted:    '#4a4a6a',
  accent:       '#00e5cc',
  accentDark:   '#00bfa5',
  gradStart:    '#0f3460',
  gradEnd:      '#16213e',
  danger:       '#ff5252',
  warn:         '#ff9800',
  blue:         '#64b5f6',
  green:        '#69f0ae',
  shadow:       '#00e5cc',
  fabBg:        '#00e5cc',
  headerBg:     '#1a1a2e',
  headerText:   '#e0e0ff',
  iconBg:       '#16213e',
  switchTrackOff: '#333',
  statusBar:    'light-content' as 'dark-content' | 'light-content',
};

export type Theme = typeof LightTheme;

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  toggleDark: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: LightTheme,
  isDark: false,
  toggleDark: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    Storage.getItem(DARK_MODE_KEY).then((val: string | null) => {
      if (val === 'true') setIsDark(true);
    }).catch(() => {});
  }, []);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    Storage.setItem(DARK_MODE_KEY, String(next)).catch(() => {});
  };

  return (
    <ThemeContext.Provider value={{ theme: isDark ? DarkTheme : LightTheme, isDark, toggleDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
