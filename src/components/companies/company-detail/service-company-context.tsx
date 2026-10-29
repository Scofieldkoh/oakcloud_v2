'use client';

interface ServiceCompanyContextProps {
  companyName?: string | null;
  uen?: string | null;
}

export function ServiceCompanyContext({ companyName, uen }: ServiceCompanyContextProps) {
  return (
    <div
      aria-label="Company details"
      className="grid grid-cols-2 gap-4 rounded-xl border border-border-primary bg-background-primary p-4 shadow-sm"
    >
      <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        <span className="shrink-0 text-xs font-medium text-text-secondary">Company Name:</span>
        <span className="truncate text-sm font-medium text-text-primary" title={companyName?.trim() || '—'}>{companyName?.trim() || '—'}</span>
      </div>
      <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        <span className="shrink-0 text-xs font-medium text-text-secondary">UEN:</span>
        <span className="truncate text-sm font-medium text-text-primary" title={uen?.trim() || '—'}>{uen?.trim() || '—'}</span>
      </div>
    </div>
  );
}
