const rolePalette: Record<string, string> = {
  DIRECTOR: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
  MANAGING_DIRECTOR: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  ALTERNATE_DIRECTOR: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200',
  SECRETARY: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  CEO: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200',
  CFO: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
};

const ABBREVIATIONS = new Set(['CEO', 'CFO', 'COO', 'CTO', 'CIO', 'CMO']);

function roleLabel(value: string): string {
  const upper = value.trim().toUpperCase();
  if (ABBREVIATIONS.has(upper)) return upper;
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const base = 'inline-flex min-h-5 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none';

export function OfficerRoleBadge({ role }: { role: string }) {
  return <span className={`${base} ${rolePalette[role] ?? 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>{roleLabel(role)}</span>;
}

export function ShareholderTypeBadge({ type }: { type: string }) {
  const corporate = type === 'CORPORATE';
  return <span className={`${base} ${corporate
    ? 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-200'
    : 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-200'}`}>{corporate ? 'Corporate' : 'Individual'}</span>;
}

export function ActiveBadge({ label = 'Active' }: { label?: string }) {
  return <span className={`${base} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200`}>{label}</span>;
}
