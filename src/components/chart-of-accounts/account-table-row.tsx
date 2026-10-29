'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  Pencil,
  Trash2,
  Check,
  X,
  ChevronRight,
  ChevronDown,
  CornerDownRight,
  Loader2,
} from 'lucide-react';
import {
  useUpdateAccount,
  type ChartOfAccount,
  type UpdateAccountInput,
} from '@/hooks/use-chart-of-accounts';
import { useToast } from '@/components/ui/toast';
import {
  AccountTypeBadge,
  AccountStatusBadge,
  AccountScopeBadge,
} from './account-type-badge';
import {
  ACCOUNT_TYPES,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPE_NAMES,
  ACCOUNT_STATUS_NAMES,
} from '@/lib/validations/chart-of-accounts';
import type { AccountType, AccountStatus } from '@/generated/prisma';

// ============================================================================
// Types
// ============================================================================

interface AccountTableRowProps {
  account: ChartOfAccount;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  childCount: number;
  onToggleCollapse: (id: string) => void;
  onDelete: (account: ChartOfAccount) => void;
  onUpdate: () => void;
  canEdit: boolean;
  canDelete: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function AccountTableRow({
  account,
  depth,
  hasChildren,
  isCollapsed,
  childCount,
  onToggleCollapse,
  onDelete,
  onUpdate,
  canEdit,
  canDelete,
}: AccountTableRowProps) {
  const toast = useToast();
  const updateAccount = useUpdateAccount();
  const [isEditing, setIsEditing] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [code, setCode] = useState(account.code);
  const [name, setName] = useState(account.name);
  const [description, setDescription] = useState(account.description || '');
  const [accountType, setAccountType] = useState<AccountType>(account.accountType);
  const [status, setStatus] = useState<AccountStatus>(account.status);
  const [isTaxApplicable, setIsTaxApplicable] = useState(account.isTaxApplicable);
  const [isHeader, setIsHeader] = useState(account.isHeader);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isSystem = account.isSystem;

  // Reset form when account changes or editing is cancelled
  const resetForm = useCallback(() => {
    setCode(account.code);
    setName(account.name);
    setDescription(account.description || '');
    setAccountType(account.accountType);
    setStatus(account.status);
    setIsTaxApplicable(account.isTaxApplicable);
    setIsHeader(account.isHeader);
    setErrors({});
  }, [account]);

  // Focus code input when entering edit mode
  useEffect(() => {
    if (isEditing && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [isEditing]);

  // Handle escape key to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditing && e.key === 'Escape') {
        resetForm();
        setIsEditing(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, resetForm]);

  const handleEdit = () => {
    resetForm();
    setIsEditing(true);
  };

  const handleCancel = () => {
    resetForm();
    setIsEditing(false);
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!code.trim()) {
      newErrors.code = 'Required';
    } else if (!/^[A-Z0-9\-_]+$/i.test(code)) {
      newErrors.code = 'Alphanumeric only';
    } else if (code.length > 20) {
      newErrors.code = 'Max 20 chars';
    }

    if (!name.trim()) {
      newErrors.name = 'Required';
    } else if (name.length > 200) {
      newErrors.name = 'Max 200 chars';
    }

    if (description && description.length > 500) {
      newErrors.description = 'Max 500 chars';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    try {
      const updateData: UpdateAccountInput = {};

      // Only include changed fields
      if (code !== account.code) updateData.code = code;
      if (name !== account.name) updateData.name = name;
      if (description !== (account.description || '')) updateData.description = description || null;
      if (accountType !== account.accountType) updateData.accountType = accountType;
      if (status !== account.status) updateData.status = status;
      if (isTaxApplicable !== account.isTaxApplicable) updateData.isTaxApplicable = isTaxApplicable;
      if (isHeader !== account.isHeader) updateData.isHeader = isHeader;

      // Only update if there are changes
      if (Object.keys(updateData).length === 0) {
        setIsEditing(false);
        return;
      }

      await updateAccount.mutateAsync({ id: account.id, data: updateData });
      toast.success('Account updated');
      setIsEditing(false);
      onUpdate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update account');
    }
  };

  // Handle Enter key to save
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  const isChild = depth > 0;
  const isLoading = updateAccount.isPending;

  // ============================================================================
  // Display Mode
  // ============================================================================

  if (!isEditing) {
    return (
      <tr
        className={cn(
          'hover:bg-background-tertiary/50 transition-colors',
          isChild && 'bg-background-secondary/30'
        )}
      >
        {/* Code */}
        <td className="font-mono text-sm">
          <div className="flex items-center">
            {depth > 0 && <span className="inline-block" style={{ width: `${depth * 20}px` }} />}
            {isChild && <CornerDownRight className="w-3.5 h-3.5 text-text-muted mr-1.5 flex-shrink-0" />}
            {!isChild && hasChildren && (
              <button
                type="button"
                onClick={() => onToggleCollapse(account.id)}
                className="p-0.5 rounded hover:bg-background-tertiary transition-colors mr-1 flex-shrink-0"
                title={isCollapsed ? 'Expand' : 'Collapse'}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5 text-oak-light" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-oak-light" />
                )}
              </button>
            )}
            {!isChild && !hasChildren && <span className="inline-block w-5" />}
            <span>{account.code}</span>
            {hasChildren && isCollapsed && (
              <span className="ml-1 text-xs text-text-muted">({childCount})</span>
            )}
          </div>
        </td>

        {/* Name */}
        <td>
          <div className="flex items-center">
            {depth > 0 && <span className="inline-block" style={{ width: `${depth * 12}px` }} />}
            <span className={cn(isChild && 'text-text-secondary')}>{account.name}</span>
          </div>
        </td>

        {/* Description */}
        <td className="text-text-secondary text-sm max-w-[150px] truncate" title={account.description || undefined}>
          {account.description || '-'}
        </td>

        {/* Type */}
        <td><AccountTypeBadge type={account.accountType} /></td>

        {/* Status */}
        <td><AccountStatusBadge status={account.status} /></td>

        {/* Header */}
        <td className="text-center">
          {account.isHeader ? (
            <Check className="w-4 h-4 text-blue-600 mx-auto" />
          ) : (
            <X className="w-4 h-4 text-text-muted mx-auto" />
          )}
        </td>

        {/* Tax Applicable */}
        <td className="text-center">
          {account.isTaxApplicable ? (
            <Check className="w-4 h-4 text-green-600 mx-auto" />
          ) : (
            <X className="w-4 h-4 text-text-muted mx-auto" />
          )}
        </td>

        {/* Scope */}
        <td>
          <AccountScopeBadge
            tenantId={account.tenantId}
            companyId={account.companyId}
            isSystem={account.isSystem}
          />
        </td>

        {/* Actions */}
        <td>
          <div className="flex items-center gap-1">
            {canEdit && !isSystem && (
              <button
                type="button"
                onClick={handleEdit}
                className="p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
                title="Edit"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            {canDelete && !isSystem && (
              <button
                type="button"
                onClick={() => onDelete(account)}
                className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-text-muted hover:text-red-600 transition-colors"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            {isSystem && (
              <span className="text-xs text-text-muted px-2">System</span>
            )}
          </div>
        </td>
      </tr>
    );
  }

  // ============================================================================
  // Edit Mode
  // ============================================================================

  return (
    <tr className="bg-oak-primary/5 dark:bg-oak-primary/10">
      {/* Code */}
      <td>
        <div className="flex items-center">
          {depth > 0 && <span className="inline-block" style={{ width: `${depth * 20}px` }} />}
          {isChild && <CornerDownRight className="w-3.5 h-3.5 text-text-muted mr-1.5 flex-shrink-0" />}
          {!isChild && hasChildren && (
            <span className="p-0.5 mr-1 flex-shrink-0">
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5 text-oak-light" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-oak-light" />
              )}
            </span>
          )}
          {!isChild && !hasChildren && <span className="inline-block w-5" />}
          <input
            ref={codeInputRef}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            disabled={isLoading || isSystem}
            className={cn(
              'w-20 px-2 py-1 text-sm font-mono rounded border bg-background-primary',
              errors.code ? 'border-status-error' : 'border-border-primary',
              'focus:outline-none focus:ring-1 focus:ring-oak-primary',
              (isLoading || isSystem) && 'opacity-50 cursor-not-allowed'
            )}
          />
        </div>
        {errors.code && <span className="text-xs text-status-error">{errors.code}</span>}
      </td>

      {/* Name */}
      <td>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading || isSystem}
          className={cn(
            'w-full px-2 py-1 text-sm rounded border bg-background-primary',
            errors.name ? 'border-status-error' : 'border-border-primary',
            'focus:outline-none focus:ring-1 focus:ring-oak-primary',
            (isLoading || isSystem) && 'opacity-50 cursor-not-allowed'
          )}
        />
        {errors.name && <span className="text-xs text-status-error">{errors.name}</span>}
      </td>

      {/* Description */}
      <td>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder="-"
          className={cn(
            'w-full px-2 py-1 text-sm rounded border bg-background-primary',
            errors.description ? 'border-status-error' : 'border-border-primary',
            'focus:outline-none focus:ring-1 focus:ring-oak-primary',
            isLoading && 'opacity-50 cursor-not-allowed'
          )}
        />
      </td>

      {/* Type */}
      <td>
        <select
          value={accountType}
          onChange={(e) => setAccountType(e.target.value as AccountType)}
          disabled={isLoading || isSystem}
          className={cn(
            'px-2 py-1 text-sm rounded border border-border-primary bg-background-primary',
            'focus:outline-none focus:ring-1 focus:ring-oak-primary',
            (isLoading || isSystem) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {ACCOUNT_TYPES.map((type) => (
            <option key={type} value={type}>
              {ACCOUNT_TYPE_NAMES[type]}
            </option>
          ))}
        </select>
      </td>

      {/* Status */}
      <td>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as AccountStatus)}
          disabled={isLoading}
          className={cn(
            'px-2 py-1 text-sm rounded border border-border-primary bg-background-primary',
            'focus:outline-none focus:ring-1 focus:ring-oak-primary',
            isLoading && 'opacity-50 cursor-not-allowed'
          )}
        >
          {ACCOUNT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ACCOUNT_STATUS_NAMES[s]}
            </option>
          ))}
        </select>
      </td>

      {/* Header */}
      <td className="text-center">
        <input
          type="checkbox"
          checked={isHeader}
          onChange={(e) => setIsHeader(e.target.checked)}
          disabled={isLoading}
          className="w-4 h-4 rounded border-border-primary text-blue-600 focus:ring-blue-500"
        />
      </td>

      {/* Tax Applicable */}
      <td className="text-center">
        <input
          type="checkbox"
          checked={isTaxApplicable}
          onChange={(e) => setIsTaxApplicable(e.target.checked)}
          disabled={isLoading}
          className="w-4 h-4 rounded border-border-primary text-oak-primary focus:ring-oak-primary"
        />
      </td>

      {/* Scope (read-only) */}
      <td>
        <AccountScopeBadge
          tenantId={account.tenantId}
          companyId={account.companyId}
          isSystem={account.isSystem}
        />
      </td>

      {/* Actions */}
      <td>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={isLoading}
            className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 transition-colors disabled:opacity-50"
            title="Save (Enter)"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isLoading}
            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 transition-colors disabled:opacity-50"
            title="Cancel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
