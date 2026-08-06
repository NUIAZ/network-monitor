/**
 * ThemeContext: applying a theme must write CSS custom properties on the
 * document root, flip data-bs-theme, and persist the choice.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { THEMES, ThemeProvider, applyTheme, useTheme } from '../context/ThemeContext';

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme.name}</span>
      <button type="button" onClick={() => setTheme('Carbon')}>go carbon</button>
      <button type="button" onClick={() => setTheme('Slate Light')}>go light</button>
    </div>
  );
}

describe('applyTheme', () => {
  it('writes every token as a custom property and sets data-bs-theme', () => {
    const carbon = THEMES.find((t) => t.name === 'Carbon')!;
    applyTheme(carbon);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bg-primary')).toBe('#161616');
    expect(root.style.getPropertyValue('--accent-color')).toBe('#4589ff');
    expect(root.style.getPropertyValue('--chart-1')).toBe('#3987e5'); // dark chart step
    expect(root.getAttribute('data-bs-theme')).toBe('dark');
  });
});

describe('ThemeProvider', () => {
  it('defaults to Midnight when nothing is stored', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('current-theme')).toHaveTextContent('Midnight');
  });

  it('applies and persists a theme change', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('go carbon'));
    expect(screen.getByTestId('current-theme')).toHaveTextContent('Carbon');
    expect(localStorage.getItem('netmon_theme')).toBe('Carbon');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('#161616');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');

    // Switching to a light theme flips both the tokens and the bootstrap mode.
    fireEvent.click(screen.getByText('go light'));
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('#f1f5f9');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
  });

  it('hydrates from localStorage on mount', () => {
    localStorage.setItem('netmon_theme', 'Deep Ocean');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('current-theme')).toHaveTextContent('Deep Ocean');
  });

  it('falls back to the default when the stored name is unknown', () => {
    localStorage.setItem('netmon_theme', 'Nonexistent Theme');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('current-theme')).toHaveTextContent('Midnight');
  });
});
