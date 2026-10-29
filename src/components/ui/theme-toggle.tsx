'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';

interface ThemeToggleProps {
  variant?: 'button' | 'dropdown';
  showLabel?: boolean;
}

export function ThemeToggle({ variant = 'button' }: ThemeToggleProps) {
  const { theme, setTheme, toggleTheme } = useUIStore();

  if (variant === 'button') {
    return (
      <button
        onClick={toggleTheme}
        className="btn-ghost btn-sm btn-icon"
        aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      >
        {theme === 'light' ? (
          <Moon className="w-4 h-4" aria-hidden="true" />
        ) : (
          <Sun className="w-4 h-4" aria-hidden="true" />
        )}
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme selection"
      className="flex items-center gap-1 p-1 bg-background-tertiary rounded-lg"
    >
      <button
        onClick={() => setTheme('light')}
        role="radio"
        aria-checked={theme === 'light'}
        aria-label="Light mode"
        className={`p-1.5 rounded transition-colors ${
          theme === 'light'
            ? 'bg-background-elevated text-text-primary shadow-sm'
            : 'text-text-tertiary hover:text-text-secondary'
        }`}
      >
        <Sun className="w-4 h-4" aria-hidden="true" />
      </button>
      <button
        onClick={() => setTheme('dark')}
        role="radio"
        aria-checked={theme === 'dark'}
        aria-label="Dark mode"
        className={`p-1.5 rounded transition-colors ${
          theme === 'dark'
            ? 'bg-background-elevated text-text-primary shadow-sm'
            : 'text-text-tertiary hover:text-text-secondary'
        }`}
      >
        <Moon className="w-4 h-4" aria-hidden="true" />
      </button>
      <button
        onClick={() => setTheme('system')}
        role="radio"
        aria-checked={theme === 'system'}
        aria-label="Use system preference"
        className={`p-1.5 rounded transition-colors ${
          theme === 'system'
            ? 'bg-background-elevated text-text-primary shadow-sm'
            : 'text-text-tertiary hover:text-text-secondary'
        }`}
      >
        <Monitor className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
