'use client';

import { Building2, User } from 'lucide-react';

export type DetailScope = 'default' | 'company';

interface ScopeToggleProps {
  value: DetailScope;
  onChange: (scope: DetailScope) => void;
  companyName?: string;
  disabled?: boolean;
  className?: string;
}

export function ScopeToggle({
  value,
  onChange,
  companyName,
  disabled = false,
  className = '',
}: ScopeToggleProps) {
  return (
    <div className={`flex gap-1 p-0.5 bg-surface-secondary rounded-lg ${className}`}>
      <button
        type="button"
        onClick={() => onChange('default')}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          value === 'default'
            ? 'bg-white text-oak-dark shadow-sm'
            : 'text-text-secondary hover:text-text-primary'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <User className="w-3.5 h-3.5" />
        Default
      </button>
      <button
        type="button"
        onClick={() => onChange('company')}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
          value === 'company'
            ? 'bg-white text-oak-dark shadow-sm'
            : 'text-text-secondary hover:text-text-primary'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={companyName ? `Company-specific for ${companyName}` : 'Company-specific'}
      >
        <Building2 className="w-3.5 h-3.5" />
        {companyName ? (
          <span className="truncate max-w-[150px]">{companyName}</span>
        ) : (
          'Company-specific'
        )}
      </button>
    </div>
  );
}
