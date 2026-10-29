'use client';

import { FileStack, Link2 } from 'lucide-react';
import { ConfidenceDot } from '@/components/processing';
import type { DocumentCategory, DocumentSubCategory } from '@/generated/prisma';
import { cn } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SUBCATEGORY_LABELS, getSubCategoryOptions } from '@/lib/document-categories';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { getCopyableText } from '@/lib/clipboard';
import { formatDate } from './helpers';

export function ExtractedHeaderFields({
  revision,
  isEditing,
  editFormData,
  setEditFormData,
  onResolveAlias,
  isResolvingAlias,
  disableResolveAlias,
  focusedField,
  setFocusedField,
  getFieldConfidence,
  categoryLabels,
  onCopyFieldValue,
}: {
  revision: {
    documentCategory: DocumentCategory | null;
    documentSubCategory?: string | null;
    vendorName: string | null;
    counterpartyIdentity?: {
      identificationType?: 'NRIC' | 'FIN' | 'PASSPORT' | 'UEN' | 'OTHER';
      identificationNumber?: string;
      fullAddress?: string;
      email?: string;
      phone?: string;
      confidence: Partial<Record<'identificationNumber' | 'fullAddress' | 'email' | 'phone', number>>;
    } | null;
    documentNumber: string | null;
    documentDate: string | null;
    dueDate?: string | null;
    currency: string;
    subtotal?: string | null;
    taxAmount?: string | null;
    totalAmount: string;
  };
  isEditing: boolean;
  editFormData: {
    documentCategory: string;
    documentSubCategory: string;
    vendorName: string;
    identificationType: string;
    identificationNumber: string;
    counterpartyAddress: string;
    counterpartyEmail: string;
    counterpartyPhone: string;
    documentNumber: string;
    documentDate: string;
    dueDate: string;
    currency: string;
    subtotal: string;
    taxAmount: string;
    totalAmount: string;
    supplierGstNo: string;
    homeCurrency: string;
    homeExchangeRate: string;
    homeSubtotal: string;
    homeTaxAmount: string;
    homeTotal: string;
    isHomeExchangeRateOverride: boolean;
  };
  setEditFormData: React.Dispatch<React.SetStateAction<{
    documentCategory: string;
    documentSubCategory: string;
    vendorName: string;
    identificationType: string;
    identificationNumber: string;
    counterpartyAddress: string;
    counterpartyEmail: string;
    counterpartyPhone: string;
    documentNumber: string;
    documentDate: string;
    dueDate: string;
    currency: string;
    subtotal: string;
    taxAmount: string;
    totalAmount: string;
    supplierGstNo: string;
    homeCurrency: string;
    homeExchangeRate: string;
    homeSubtotal: string;
    homeTaxAmount: string;
    homeTotal: string;
    isHomeExchangeRateOverride: boolean;
  }>>;
  onResolveAlias?: () => void;
  isResolvingAlias?: boolean;
  disableResolveAlias?: boolean;
  focusedField: string | null;
  setFocusedField: (field: string | null) => void;
  getFieldConfidence: (key: string) => number | undefined;
  categoryLabels: Record<DocumentCategory, string>;
  onCopyFieldValue: (label: string, value: string | null) => void;
}) {
  const handleFieldFocus = (fieldKey: string) => setFocusedField(fieldKey);
  const handleFieldBlur = () => setFocusedField(null);

  if (isEditing) {
    return (
      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <FileStack className="w-4 h-4" />
          Extracted Data
        </h3>

        {/* Classification */}
        <div className="grid grid-cols-2 gap-3 pb-3 border-b border-border-secondary">
          <div>
            <label className="block text-xs text-text-muted mb-1">Category</label>
            <SearchableSelect
              options={Object.entries(categoryLabels).map(([key, label]) => ({
                value: key,
                label: label,
              }))}
              value={editFormData.documentCategory}
              onChange={(value) => setEditFormData({
                ...editFormData,
                documentCategory: value,
                documentSubCategory: '',
              })}
              placeholder="Select category..."
              clearable={false}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Sub-category</label>
            <SearchableSelect
              options={editFormData.documentCategory
                ? getSubCategoryOptions(editFormData.documentCategory as DocumentCategory).map(({ value, label }) => ({
                  value,
                  label,
                }))
                : []
              }
              value={editFormData.documentSubCategory}
              onChange={(value) => setEditFormData({ ...editFormData, documentSubCategory: value })}
              placeholder="Select sub-category..."
              disabled={!editFormData.documentCategory}
              clearable={false}
            />
          </div>
        </div>

        {/* Key Identification */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">
              {editFormData.documentCategory === 'ACCOUNTS_RECEIVABLE' ? 'Customer' : 'Vendor'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editFormData.vendorName}
                onChange={(e) => setEditFormData({ ...editFormData, vendorName: e.target.value })}
                className="flex-1 w-full px-2.5 py-1.5 text-sm bg-background-secondary border border-border-primary rounded focus:border-oak-light focus:outline-none"
                placeholder={editFormData.documentCategory === 'ACCOUNTS_RECEIVABLE' ? 'Customer name' : 'Vendor name'}
              />
              <button
                type="button"
                onClick={onResolveAlias}
                disabled={!onResolveAlias || !!isResolvingAlias || !!disableResolveAlias}
                className="btn-ghost btn-sm"
                title="Apply saved contact name"
              >
                <Link2 className={cn('w-4 h-4', isResolvingAlias && 'animate-pulse')} />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Document #</label>
            <input
              type="text"
              value={editFormData.documentNumber}
              onChange={(e) => setEditFormData({ ...editFormData, documentNumber: e.target.value })}
              className="w-full px-2.5 py-1.5 text-sm bg-background-secondary border border-border-primary rounded focus:border-oak-light focus:outline-none"
              placeholder="INV-001"
            />
          </div>
        </div>

        <div className="space-y-3 border-t border-border-secondary pt-3">
          <p className="text-xs font-medium text-text-secondary">Counterparty identity</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="counterparty-identification-type" className="block text-xs text-text-muted mb-1">Identification type</label>
              <select
                id="counterparty-identification-type"
                value={editFormData.identificationType}
                onChange={(event) => setEditFormData({ ...editFormData, identificationType: event.target.value })}
                className="min-h-[44px] w-full rounded border border-border-primary bg-background-secondary px-2.5 py-1.5 text-sm focus:border-oak-light focus:outline-none sm:min-h-0"
              >
                <option value="">Select type</option>
                <option value="UEN">UEN</option>
                <option value="NRIC">NRIC</option>
                <option value="FIN">FIN</option>
                <option value="PASSPORT">Passport</option>
                <option value="OTHER">Other registration</option>
              </select>
            </div>
            <div>
              <label htmlFor="counterparty-identification-number" className="block text-xs text-text-muted mb-1">Identification / UEN</label>
              <input
                id="counterparty-identification-number"
                type="text"
                value={editFormData.identificationNumber}
                onChange={(event) => setEditFormData({ ...editFormData, identificationNumber: event.target.value })}
                className="min-h-[44px] w-full rounded border border-border-primary bg-background-secondary px-2.5 py-1.5 text-sm focus:border-oak-light focus:outline-none sm:min-h-0"
                placeholder="UEN or registration number"
              />
            </div>
          </div>
          <div>
            <label htmlFor="counterparty-address" className="block text-xs text-text-muted mb-1">Address</label>
            <input
              id="counterparty-address"
              type="text"
              value={editFormData.counterpartyAddress}
              onChange={(event) => setEditFormData({ ...editFormData, counterpartyAddress: event.target.value })}
              className="min-h-[44px] w-full rounded border border-border-primary bg-background-secondary px-2.5 py-1.5 text-sm focus:border-oak-light focus:outline-none sm:min-h-0"
              placeholder="Counterparty address"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="counterparty-email" className="block text-xs text-text-muted mb-1">Email</label>
              <input
                id="counterparty-email"
                type="email"
                value={editFormData.counterpartyEmail}
                onChange={(event) => setEditFormData({ ...editFormData, counterpartyEmail: event.target.value })}
                className="min-h-[44px] w-full rounded border border-border-primary bg-background-secondary px-2.5 py-1.5 text-sm focus:border-oak-light focus:outline-none sm:min-h-0"
                placeholder="accounts@example.com"
              />
            </div>
            <div>
              <label htmlFor="counterparty-phone" className="block text-xs text-text-muted mb-1">Phone</label>
              <input
                id="counterparty-phone"
                type="tel"
                value={editFormData.counterpartyPhone}
                onChange={(event) => setEditFormData({ ...editFormData, counterpartyPhone: event.target.value })}
                className="min-h-[44px] w-full rounded border border-border-primary bg-background-secondary px-2.5 py-1.5 text-sm focus:border-oak-light focus:outline-none sm:min-h-0"
                placeholder="+65 6123 4567"
              />
            </div>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <SingleDateInput
            label="Document date"
            value={editFormData.documentDate}
            onChange={(value) => setEditFormData({ ...editFormData, documentDate: value })}
          />
          <SingleDateInput
            label="Due date"
            value={editFormData.dueDate}
            onChange={(value) => setEditFormData({ ...editFormData, dueDate: value })}
          />
        </div>
      </div>
    );
  }

  // Format document type as "Category - Subcategory"
  const documentType = revision.documentCategory
    ? revision.documentSubCategory
      ? `${categoryLabels[revision.documentCategory]} - ${SUBCATEGORY_LABELS[revision.documentSubCategory as DocumentSubCategory]}`
      : categoryLabels[revision.documentCategory]
    : 'Uncategorized';

  return (
    <div className="space-y-3">
      {/* Document Type - Full Row */}
      <FieldDisplay
        label="Document Type"
        value={documentType}
        fieldKey="documentType"
        focusedField={focusedField}
        onFocus={handleFieldFocus}
        onBlur={handleFieldBlur}
        onCopy={onCopyFieldValue}
      />

      {/* Vendor and Document # */}
      <div className="grid grid-cols-2 gap-3">
        <FieldDisplay
          label={revision.documentCategory === 'ACCOUNTS_RECEIVABLE' ? 'Customer' : 'Vendor'}
          value={revision.vendorName}
          fieldKey="vendorName"
          confidence={getFieldConfidence('vendorName')}
          focusedField={focusedField}
          onFocus={handleFieldFocus}
          onBlur={handleFieldBlur}
          onCopy={onCopyFieldValue}
        />
        <FieldDisplay
          label="Document #"
          value={revision.documentNumber}
          fieldKey="documentNumber"
          confidence={getFieldConfidence('documentNumber')}
          focusedField={focusedField}
          onFocus={handleFieldFocus}
          onBlur={handleFieldBlur}
          onCopy={onCopyFieldValue}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 border-t border-border-secondary pt-3 sm:grid-cols-2">
        <FieldDisplay
          label="Identification type"
          value={revision.counterpartyIdentity?.identificationType ?? null}
          fieldKey="counterpartyIdentificationType"
          confidence={getFieldConfidence('counterpartyIdentificationType')}
          focusedField={focusedField}
          onFocus={handleFieldFocus}
          onBlur={handleFieldBlur}
          onCopy={onCopyFieldValue}
        />
        <FieldDisplay
          label="Identification / UEN"
          value={revision.counterpartyIdentity?.identificationNumber ?? null}
          fieldKey="counterpartyIdentificationNumber"
          confidence={revision.counterpartyIdentity?.confidence.identificationNumber ?? getFieldConfidence('counterpartyIdentificationNumber')}
          focusedField={focusedField}
          onFocus={handleFieldFocus}
          onBlur={handleFieldBlur}
          onCopy={onCopyFieldValue}
        />
        <FieldDisplay
          label="Address"
          value={revision.counterpartyIdentity?.fullAddress ?? null}
          fieldKey="counterpartyAddress"
          confidence={revision.counterpartyIdentity?.confidence.fullAddress ?? getFieldConfidence('counterpartyAddress')}
          focusedField={focusedField}
          onFocus={handleFieldFocus}
          onBlur={handleFieldBlur}
          onCopy={onCopyFieldValue}
        />
        <FieldDisplay
          label="Email"
          value={revision.counterpartyIdentity?.email ?? null}
          fieldKey="counterpartyEmail"
          confidence={revision.counterpartyIdentity?.confidence.email ?? getFieldConfidence('counterpartyEmail')}
          focusedField={focusedField}
          onFocus={handleFieldFocus}
          onBlur={handleFieldBlur}
          onCopy={onCopyFieldValue}
        />
        <FieldDisplay
          label="Phone"
          value={revision.counterpartyIdentity?.phone ?? null}
          fieldKey="counterpartyPhone"
          confidence={revision.counterpartyIdentity?.confidence.phone ?? getFieldConfidence('counterpartyPhone')}
          focusedField={focusedField}
          onFocus={handleFieldFocus}
          onBlur={handleFieldBlur}
          onCopy={onCopyFieldValue}
        />
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <FieldDisplay
          label="Document Date"
          value={formatDate(revision.documentDate)}
          fieldKey="documentDate"
          confidence={getFieldConfidence('documentDate')}
          focusedField={focusedField}
          onFocus={handleFieldFocus}
          onBlur={handleFieldBlur}
          onCopy={onCopyFieldValue}
        />
        <FieldDisplay
          label="Due Date"
          value={formatDate(revision.dueDate || null)}
          fieldKey="dueDate"
          focusedField={focusedField}
          onFocus={handleFieldFocus}
          onBlur={handleFieldBlur}
          onCopy={onCopyFieldValue}
        />
      </div>
    </div>
  );
}

export function FieldDisplay({
  label,
  value,
  fieldKey,
  confidence,
  focusedField,
  onFocus,
  onBlur,
  onCopy,
  highlight = false,
  size = 'md',
}: {
  label: string;
  value: string | null;
  fieldKey: string;
  confidence?: number;
  focusedField: string | null;
  onFocus: (key: string) => void;
  onBlur: () => void;
  onCopy?: (label: string, value: string | null) => void;
  highlight?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const isFocused = focusedField === fieldKey;
  const copyValue = getCopyableText(value);
  const isCopyable = Boolean(onCopy && copyValue);

  const handleCopy = () => {
    if (!onCopy || !copyValue) return;
    onCopy(label, copyValue);
  };

  return (
    <div
      className={cn(
        'py-1.5 px-2 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-oak-light/50',
        isCopyable && 'cursor-copy',
        isFocused ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'hover:bg-background-tertiary'
      )}
      onMouseEnter={() => onFocus(fieldKey)}
      onMouseLeave={onBlur}
      onClick={handleCopy}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleCopy();
      }}
      role={isCopyable ? 'button' : undefined}
      tabIndex={isCopyable ? 0 : undefined}
      aria-label={isCopyable ? `Copy ${label}` : undefined}
      title={isCopyable ? `Copy ${label}` : undefined}
    >
      <dt className="text-xs text-text-muted mb-0.5 flex items-center gap-1.5">
        {label}
        {confidence !== undefined && <ConfidenceDot confidence={confidence} size="sm" />}
      </dt>
      <dd className={cn(
        size === 'lg' ? 'text-base font-medium' : 'text-sm',
        highlight ? 'font-semibold text-text-primary' : 'text-text-primary'
      )}>
        {value || '-'}
      </dd>
    </div>
  );
}

// ============================================================================
// AmountsSection Component - Combined document and home currency amounts
// ============================================================================
