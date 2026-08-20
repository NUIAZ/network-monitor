/**
 * Theme engine: eight named themes (four light, four dark), each a complete
 * set of design-token values. applyTheme writes every token as a CSS custom
 * property on <html>, so the entire UI (components, charts, scrollbars)
 * re-skins from one place and no component ever hardcodes a color.
 *
 * data-bs-theme is set alongside the tokens so Bootstrap's own light/dark
 * internals (form controls, dropdown shadows) agree with the active theme.
 * The chart series slots (--chart-1..8) come from a validated palette: the
 * light and dark columns are the same eight hues stepped for their surface,
 * with the ordering chosen so adjacent series stay distinguishable under
 * color-vision deficiency. Do not reorder them casually.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/** localStorage key for the persisted theme name. */
const STORAGE_KEY = 'netmon_theme';

/** Falls back to this when storage is empty or names a theme we removed. */
const DEFAULT_THEME = 'Midnight';

/** A complete token set. Themes are whole palettes, never partial overrides;
 *  there is no merging against a base, so every theme defines every token. */
export interface ThemeDefinition {
  /** Also the persisted identity: this string is what goes into localStorage,
   *  so renaming a theme silently resets everyone who had it selected. */
  name: string;
  /** Selects the Bootstrap light/dark family as well as the palette. */
  mode: 'light' | 'dark';
  /** Every value is written as a CSS custom property (key = property name). */
  colors: Record<string, string>;
}

/** Chart + status token sets shared by all themes of a mode. */
const chartLight = {
  '--chart-1': '#2a78d6',
  '--chart-2': '#eb6834',
  '--chart-3': '#1baf7a',
  '--chart-4': '#eda100',
  '--chart-5': '#e87ba4',
  '--chart-6': '#008300',
  '--chart-7': '#4a3aa7',
  '--chart-8': '#e34948',
};

const chartDark = {
  '--chart-1': '#3987e5',
  '--chart-2': '#d95926',
  '--chart-3': '#199e70',
  '--chart-4': '#c98500',
  '--chart-5': '#d55181',
  '--chart-6': '#008300',
  '--chart-7': '#9085e9',
  '--chart-8': '#e66767',
};

const statusLight = {
  '--success': '#15803d',
  '--success-bg': 'rgba(21, 128, 61, 0.12)',
  '--warning': '#b45309',
  '--warning-bg': 'rgba(180, 83, 9, 0.12)',
  '--error': '#dc2626',
  '--error-bg': 'rgba(220, 38, 38, 0.10)',
  '--info': '#2563eb',
  '--info-bg': 'rgba(37, 99, 235, 0.10)',
};

const statusDark = {
  '--success': '#4ade80',
  '--success-bg': 'rgba(74, 222, 128, 0.14)',
  '--warning': '#fbbf24',
  '--warning-bg': 'rgba(251, 191, 36, 0.14)',
  '--error': '#f87171',
  '--error-bg': 'rgba(248, 113, 113, 0.14)',
  '--info': '#60a5fa',
  '--info-bg': 'rgba(96, 165, 250, 0.14)',
};

/**
 * The theme catalog. Sidebar tokens are separate from the page background on
 * purpose: the light themes keep a dark sidebar (the classic ops-dashboard
 * look) so navigation stays visually anchored while content stays bright.
 */
export const THEMES: ThemeDefinition[] = [
  // ------------------------------------------------------------- light ----
  {
    name: 'Slate Light',
    mode: 'light',
    colors: {
      '--bg-primary': '#f1f5f9',
      '--bg-secondary': '#e2e8f0',
      '--text-primary': '#0f172a',
      '--text-secondary': '#334155',
      '--text-muted': '#64748b',
      '--card-bg': '#ffffff',
      '--card-border': '#e2e8f0',
      '--input-bg': '#ffffff',
      '--input-border': '#cbd5e1',
      '--accent-color': '#2563eb',
      '--accent-hover': '#1d4ed8',
      '--sidebar-bg-start': '#1e293b',
      '--sidebar-bg-end': '#0f172a',
      '--sidebar-text': '#cbd5e1',
      '--sidebar-muted': '#7c8ba1',
      '--nav-bg': '#ffffff',
      '--hover-bg': 'rgba(15, 23, 42, 0.05)',
      '--chart-grid': '#e2e8f0',
      ...statusLight,
      ...chartLight,
    },
  },
  {
    name: 'Nordic',
    mode: 'light',
    colors: {
      '--bg-primary': '#eceff4',
      '--bg-secondary': '#e5e9f0',
      '--text-primary': '#2e3440',
      '--text-secondary': '#434c5e',
      '--text-muted': '#7b88a1',
      '--card-bg': '#ffffff',
      '--card-border': '#dde3ec',
      '--input-bg': '#ffffff',
      '--input-border': '#c2cbd9',
      '--accent-color': '#5e81ac',
      '--accent-hover': '#4c6a92',
      '--sidebar-bg-start': '#3b4252',
      '--sidebar-bg-end': '#2e3440',
      '--sidebar-text': '#d8dee9',
      '--sidebar-muted': '#8792a5',
      '--nav-bg': '#ffffff',
      '--hover-bg': 'rgba(46, 52, 64, 0.05)',
      '--chart-grid': '#e0e5ee',
      ...statusLight,
      ...chartLight,
    },
  },
  {
    name: 'Solarized',
    mode: 'light',
    colors: {
      '--bg-primary': '#fdf6e3',
      '--bg-secondary': '#eee8d5',
      '--text-primary': '#073642',
      '--text-secondary': '#586e75',
      '--text-muted': '#93a1a1',
      '--card-bg': '#fffdf5',
      '--card-border': '#e8e1c8',
      '--input-bg': '#fffdf5',
      '--input-border': '#d5cdb2',
      '--accent-color': '#268bd2',
      '--accent-hover': '#1e6ea6',
      '--sidebar-bg-start': '#073642',
      '--sidebar-bg-end': '#002b36',
      '--sidebar-text': '#c9d8d9',
      '--sidebar-muted': '#7d9a9a',
      '--nav-bg': '#fffdf5',
      '--hover-bg': 'rgba(7, 54, 66, 0.05)',
      '--chart-grid': '#ece5cd',
      ...statusLight,
      ...chartLight,
    },
  },
  {
    name: 'Parchment',
    mode: 'light',
    colors: {
      '--bg-primary': '#faf7f2',
      '--bg-secondary': '#f1ece2',
      '--text-primary': '#3d3529',
      '--text-secondary': '#5c5243',
      '--text-muted': '#8a7f6d',
      '--card-bg': '#fffdf9',
      '--card-border': '#e7dfd2',
      '--input-bg': '#fffdf9',
      '--input-border': '#d4c9b6',
      '--accent-color': '#b3652b',
      '--accent-hover': '#9a5423',
      '--sidebar-bg-start': '#453a2d',
      '--sidebar-bg-end': '#2f2820',
      '--sidebar-text': '#e4dccf',
      '--sidebar-muted': '#a0947f',
      '--nav-bg': '#fffdf9',
      '--hover-bg': 'rgba(61, 53, 41, 0.05)',
      '--chart-grid': '#ece4d6',
      ...statusLight,
      ...chartLight,
    },
  },
  // -------------------------------------------------------------- dark ----
  {
    name: 'Midnight',
    mode: 'dark',
    colors: {
      '--bg-primary': '#0f172a',
      '--bg-secondary': '#1e293b',
      '--text-primary': '#e2e8f0',
      '--text-secondary': '#94a3b8',
      '--text-muted': '#64748b',
      '--card-bg': '#1e293b',
      '--card-border': '#334155',
      '--input-bg': '#0f172a',
      '--input-border': '#334155',
      '--accent-color': '#3b82f6',
      '--accent-hover': '#60a5fa',
      '--sidebar-bg-start': '#16213c',
      '--sidebar-bg-end': '#0b1122',
      '--sidebar-text': '#cbd5e1',
      '--sidebar-muted': '#64748b',
      '--nav-bg': '#111c33',
      '--hover-bg': 'rgba(148, 163, 184, 0.08)',
      '--chart-grid': '#283a52',
      ...statusDark,
      ...chartDark,
    },
  },
  {
    name: 'Deep Ocean',
    mode: 'dark',
    colors: {
      '--bg-primary': '#05242c',
      '--bg-secondary': '#073642',
      '--text-primary': '#d8e6ea',
      '--text-secondary': '#a3c0c9',
      '--text-muted': '#6b8b95',
      '--card-bg': '#0a3140',
      '--card-border': '#14495a',
      '--input-bg': '#062a35',
      '--input-border': '#1a5468',
      '--accent-color': '#29b6af',
      '--accent-hover': '#4dd0c9',
      '--sidebar-bg-start': '#052e38',
      '--sidebar-bg-end': '#031f26',
      '--sidebar-text': '#bcd6dc',
      '--sidebar-muted': '#5f838d',
      '--nav-bg': '#06303c',
      '--hover-bg': 'rgba(163, 192, 201, 0.08)',
      '--chart-grid': '#124450',
      ...statusDark,
      ...chartDark,
    },
  },
  {
    name: 'Carbon',
    mode: 'dark',
    colors: {
      '--bg-primary': '#161616',
      '--bg-secondary': '#1f1f1f',
      '--text-primary': '#f4f4f4',
      '--text-secondary': '#c6c6c6',
      '--text-muted': '#8d8d8d',
      '--card-bg': '#262626',
      '--card-border': '#393939',
      '--input-bg': '#1f1f1f',
      '--input-border': '#4a4a4a',
      '--accent-color': '#4589ff',
      '--accent-hover': '#78a9ff',
      '--sidebar-bg-start': '#262626',
      '--sidebar-bg-end': '#141414',
      '--sidebar-text': '#d4d4d4',
      '--sidebar-muted': '#8d8d8d',
      '--nav-bg': '#1c1c1c',
      '--hover-bg': 'rgba(255, 255, 255, 0.06)',
      '--chart-grid': '#333333',
      ...statusDark,
      ...chartDark,
    },
  },
  {
    name: 'Ember',
    mode: 'dark',
    colors: {
      '--bg-primary': '#1c1917',
      '--bg-secondary': '#292524',
      '--text-primary': '#f5f0eb',
      '--text-secondary': '#d0c8bf',
      '--text-muted': '#a29a8f',
      '--card-bg': '#292524',
      '--card-border': '#44403c',
      '--input-bg': '#211d1b',
      '--input-border': '#57534e',
      '--accent-color': '#f97316',
      '--accent-hover': '#fb923c',
      '--sidebar-bg-start': '#2a2018',
      '--sidebar-bg-end': '#17130f',
      '--sidebar-text': '#e2d9cf',
      '--sidebar-muted': '#8f8578',
      '--nav-bg': '#221e1c',
      '--hover-bg': 'rgba(245, 240, 235, 0.06)',
      '--chart-grid': '#3b3733',
      ...statusDark,
      ...chartDark,
    },
  },
];

/**
 * Writes a theme onto the document root. Exported (rather than private to the
 * provider) so tests can exercise it directly.
 */
export function applyTheme(theme: ThemeDefinition): void {
  const root = document.documentElement;
  for (const [property, value] of Object.entries(theme.colors)) {
    root.style.setProperty(property, value);
  }
  // Keeps Bootstrap's built-in components (selects, dropdown chrome) in the
  // right light/dark family without us restyling each one.
  root.setAttribute('data-bs-theme', theme.mode);
}

interface ThemeContextValue {
  theme: ThemeDefinition;
  themes: ThemeDefinition[];
  setTheme: (name: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveInitial(): ThemeDefinition {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private windows, embedded webviews), the
    // default theme is a perfectly good answer there.
  }
  return THEMES.find((t) => t.name === stored) ?? THEMES.find((t) => t.name === DEFAULT_THEME)!;
}

/**
 * Owns the selected theme and its persistence. The initial value is resolved
 * lazily during the first render rather than in an effect, so a returning
 * visitor's saved theme is applied before the app body paints instead of
 * flashing the default first.
 *
 * Its side effect is global: tokens are written onto <html>, not scoped to
 * this subtree: so mounting two providers means the last one to render wins.
 * Mount it once, at the root, above anything that reads a design token.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeDefinition>(resolveInitial);

  // Apply on mount and whenever the selection changes, including the initial
  // render, so a persisted theme is active before first paint of the app body.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((name: string) => {
    const next = THEMES.find((t) => t.name === name);
    if (!next) return;
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next.name);
    } catch {
      // Persisting is best-effort; the session still gets the theme.
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, themes: THEMES, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Hook accessor; throws when used outside the provider to fail loudly. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
