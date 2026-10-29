import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CompanyAccentSectionProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CompanyAccentSection({
  title,
  actions,
  children,
  className,
}: CompanyAccentSectionProps) {
  return <section className={cn('card overflow-hidden p-0', className)}>
    <header className="flex min-h-12 items-center justify-between gap-3 rounded-t-xl bg-oak-primary px-4 py-3 text-white">
      <h2 className="text-sm font-semibold leading-5">{title}</h2>
      {actions}
    </header>
    <div>{children}</div>
  </section>;
}

interface CompanyAccentButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

export function CompanyAccentButton({ onClick, disabled, children }: CompanyAccentButtonProps) {
  return <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center gap-1.5 rounded border border-white/50 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
  >
    {children}
  </button>;
}

interface CompanyAccentFilterProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function CompanyAccentFilter({ label, checked, onChange }: CompanyAccentFilterProps) {
  return <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-white">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="h-3.5 w-3.5 rounded-sm border-white/50 accent-white"
    />
    {label}
  </label>;
}

export function CompanyFieldLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">{children}</p>;
}
