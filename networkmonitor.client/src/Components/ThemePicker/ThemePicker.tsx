/**
 * Theme dropdown for the top bar. Custom popover (Bootstrap CSS only, no JS)
 * grouped Light/Dark, with a three-color swatch per theme so people can pick
 * by eye instead of by name.
 */
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeDefinition } from '../../context/ThemeContext';
import './ThemePicker.css';

/** The three tokens that best summarize a theme at swatch size. */
function swatchColors(theme: ThemeDefinition): string[] {
  return [
    theme.colors['--bg-primary'],
    theme.colors['--card-bg'],
    theme.colors['--accent-color'],
  ];
}

export default function ThemePicker() {
  const { theme, themes, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click — the standard dropdown contract.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const groups: Array<{ label: string; mode: 'light' | 'dark' }> = [
    { label: 'Light', mode: 'light' },
    { label: 'Dark', mode: 'dark' },
  ];

  return (
    <div className="theme-picker" ref={rootRef} data-tour="theme-picker">
      <button
        type="button"
        className="btn btn-ghost theme-picker-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Change theme"
        data-testid="theme-picker"
      >
        <i className={`bi ${theme.mode === 'dark' ? 'bi-moon-stars' : 'bi-sun'}`} />
        <span className="d-none d-md-inline ms-2">{theme.name}</span>
        <i className="bi bi-chevron-down ms-2 small" />
      </button>

      {open && (
        <div className="theme-picker-menu" role="listbox" data-testid="theme-picker-menu">
          {groups.map((group) => (
            <div key={group.mode}>
              <div className="theme-group-label">{group.label}</div>
              {themes
                .filter((t) => t.mode === group.mode)
                .map((t) => (
                  <button
                    type="button"
                    key={t.name}
                    role="option"
                    aria-selected={t.name === theme.name}
                    className={`theme-option${t.name === theme.name ? ' active' : ''}`}
                    onClick={() => {
                      setTheme(t.name);
                      setOpen(false);
                    }}
                    data-testid={`theme-option-${t.name.replace(/\s+/g, '-').toLowerCase()}`}
                  >
                    <span className="theme-swatches">
                      {swatchColors(t).map((color, i) => (
                        <span key={i} style={{ background: color }} />
                      ))}
                    </span>
                    <span className="flex-grow-1 text-start">{t.name}</span>
                    {t.name === theme.name && <i className="bi bi-check-lg" />}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
