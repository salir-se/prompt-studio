// @module-tag dom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

function matchMedia(matches: boolean): typeof window.matchMedia {
  return vi.fn(() => ({
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('defaults to light when no stored or system preference is available', () => {
    vi.stubGlobal('matchMedia', undefined);

    render(<ThemeToggle className="theme-control" />);

    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toHaveClass('theme-control');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem('prompt-studio-theme')).toBe('light');
  });

  it('uses the system dark preference when no choice is stored', () => {
    vi.stubGlobal('matchMedia', matchMedia(true));

    render(<ThemeToggle className="theme-control" />);

    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('prompt-studio-theme')).toBe('dark');
  });

  it.each([
    ['light', false],
    ['dark', true],
  ] as const)('prefers the stored %s choice over the system preference', (stored, dark) => {
    window.localStorage.setItem('prompt-studio-theme', stored);
    vi.stubGlobal('matchMedia', matchMedia(!dark));

    render(<ThemeToggle className="theme-control" />);

    expect(document.documentElement.classList.contains('dark')).toBe(dark);
  });

  it('toggles and persists both themes', () => {
    window.localStorage.setItem('prompt-studio-theme', 'light');
    vi.stubGlobal('matchMedia', matchMedia(false));
    render(<ThemeToggle className="theme-control" />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('prompt-studio-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem('prompt-studio-theme')).toBe('light');
  });
});
