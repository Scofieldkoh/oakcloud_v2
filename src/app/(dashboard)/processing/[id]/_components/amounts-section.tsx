'use client';

import { useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ConfidenceDot } from '@/components/processing';
import { cn } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { CURRENCY_SYMBOLS, type ValidationIssue } from './helpers';

export interface AmountsSectionProps {
  documentCurrency: string;
  documentSubtotal: string | null;
  documentTaxAmount: string | null;
  documentTotalAmount: string;
  isEditing: boolean;
  editFormData: {
    currency: string;
    subtotal: string;
    taxAmount: string;
    totalAmount: string;
    homeCurrency: string;
    homeExchangeRate: string;
    homeSubtotal: string;
    homeTaxAmount: string;
    homeTotal: string;
    isHomeExchangeRateOverride: boolean;
    documentDate: string;
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
  currencyOptions: string[];
  focusedField: string | null;
  setFocusedField: (field: string | null) => void;
  getFieldConfidence: (key: string) => number | undefined;
  tenantId?: string;
  validationIssues?: ValidationIssue[];
}

export function AmountsSection({
  documentCurrency,
  documentSubtotal,
  documentTaxAmount,
  documentTotalAmount,
  isEditing,
  editFormData,
  setEditFormData,
  currencyOptions,
  focusedField,
  setFocusedField,
  getFieldConfidence,
  tenantId,
  validationIssues = [],
}: AmountsSectionProps) {
  // Use editFormData.currency for dynamic updates during editing
  const isSameCurrency = (isEditing ? editFormData.currency : documentCurrency) === editFormData.homeCurrency;

  // Helper to get validation issue for a specific field
  const getFieldValidationIssue = (fieldName: string): ValidationIssue | undefined => {
    return validationIssues.find((issue) => issue.field === fieldName);
  };

  // Check for header-level validation issues that affect amounts
  const subtotalIssue = getFieldValidationIssue('subtotal');
  const taxAmountIssue = getFieldValidationIssue('taxAmount');
  const totalAmountIssue = getFieldValidationIssue('totalAmount');
  const homeSubtotalIssue = getFieldValidationIssue('homeSubtotal');
  const homeTaxAmountIssue = getFieldValidationIssue('homeTaxAmount');
  const homeEquivalentIssue = getFieldValidationIssue('homeEquivalent');

  // Format amount helper with currency symbol (uses parentheses for negative numbers)
  const formatAmount = (value: string | null, currency?: string): string => {
    if (!value || value === '') return '-';
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    const isNegative = num < 0;
    const absNum = Math.abs(num);
    const formatted = new Intl.NumberFormat('en-SG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(absNum);
    if (currency) {
      const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
      return isNegative ? `(${symbol}${formatted})` : `${symbol}${formatted}`;
    }
    return isNegative ? `(${formatted})` : formatted;
  };

  // Format exchange rate with 6 decimal places
  const formatExchangeRate = (rate: string | null | undefined): string => {
    if (!rate) return '1.000000';
    const num = parseFloat(rate);
    if (isNaN(num)) return rate;
    return num.toFixed(6);
  };

  const handleFieldFocus = (fieldKey: string) => setFocusedField(fieldKey);
  const handleFieldBlur = () => setFocusedField(null);

  // Handler for currency change - looks up exchange rate
  const handleCurrencyChange = useCallback(async (newCurrency: string) => {
    const homeCurrency = editFormData.homeCurrency;
    const isSame = newCurrency === homeCurrency;

    if (isSame) {
      // Same currency - reset exchange rate to 1 and clear home amounts
      setEditFormData((prev) => ({
        ...prev,
        currency: newCurrency,
        homeExchangeRate: '1.000000',
        isHomeExchangeRateOverride: false,
        homeSubtotal: '',
        homeTaxAmount: '',
        homeTotal: '',
      }));
      return;
    }

    // Different currency - lookup rate
    const rateDate = editFormData.documentDate || new Date().toISOString().split('T')[0];

    try {
      const searchParams = new URLSearchParams({
        currency: newCurrency,
        date: rateDate,
      });
      if (tenantId) searchParams.set('tenantId', tenantId);

      const response = await fetch(`/api/admin/exchange-rates/lookup?${searchParams}`);

      if (response.ok) {
        const rateData = await response.json();
        const rate = parseFloat(rateData.rate) || 1;
        const subtotal = parseFloat(editFormData.subtotal) || 0;
        const tax = parseFloat(editFormData.taxAmount) || 0;
        const total = subtotal + tax;

        setEditFormData((prev) => ({
          ...prev,
          currency: newCurrency,
          homeExchangeRate: rate.toFixed(6),
          isHomeExchangeRateOverride: false,
          homeSubtotal: (subtotal * rate).toFixed(2),
          homeTaxAmount: (tax * rate).toFixed(2),
          homeTotal: (total * rate).toFixed(2),
        }));
      } else {
        // Rate lookup failed - just update currency, keep rate as 1
        setEditFormData((prev) => ({
          ...prev,
          currency: newCurrency,
          homeExchangeRate: '1.000000',
          isHomeExchangeRateOverride: false,
        }));
      }
    } catch {
      // Error - just update currency
      setEditFormData((prev) => ({
        ...prev,
        currency: newCurrency,
      }));
    }
  }, [editFormData.homeCurrency, editFormData.documentDate, editFormData.subtotal, editFormData.taxAmount, tenantId, setEditFormData]);

  // Edit mode - CSS class for hiding number input spinners
  const numberInputClass = '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  if (isEditing) {
    return (
      <div className="border border-border-primary rounded-lg overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[140px_1fr_1fr] gap-0 text-xs font-medium text-text-muted bg-background-tertiary border-b border-border-primary">
          <div className="px-3 py-2 border-r border-border-primary"></div>
          <div className="px-3 py-2 text-right border-r border-border-primary">
            <div className="text-text-muted mb-1">Document Amount</div>
            <div className="flex items-center justify-end">
              <div className="w-36 text-text-primary">
                <SearchableSelect
                  options={currencyOptions.map((curr) => ({
                    value: curr,
                    label: curr,
                  }))}
                  value={editFormData.currency}
                  onChange={handleCurrencyChange}
                  placeholder="Currency"
                  clearable={false}
                  size="sm"
                  showKeyboardHints={false}
                />
              </div>
            </div>
          </div>
          <div className={cn(
            'px-3 py-2 text-right',
            isSameCurrency && 'bg-background-secondary/50'
          )}>
            <div className={cn('text-text-muted mb-1', isSameCurrency && 'opacity-50')}>Home Amount</div>
            <div className={cn(
              'flex items-center justify-end gap-2 text-sm',
              isSameCurrency ? 'text-text-muted' : 'text-text-primary'
            )}>
              <span className="font-medium">{editFormData.homeCurrency}</span>
              {!isSameCurrency && (
                <>
                  <span>@</span>
                  <input
                    type="number"
                    step="0.000001"
                    value={editFormData.homeExchangeRate}
                    onChange={(e) => {
                      const newRate = e.target.value;
                      const rate = parseFloat(newRate) || 1;
                      setEditFormData((prev) => ({
                        ...prev,
                        homeExchangeRate: newRate,
                        isHomeExchangeRateOverride: true,
                        // Recalculate home amounts based on new exchange rate
                        homeSubtotal: prev.subtotal ? (parseFloat(prev.subtotal) * rate).toFixed(2) : '',
                        homeTaxAmount: prev.taxAmount ? (parseFloat(prev.taxAmount) * rate).toFixed(2) : '',
                        homeTotal: prev.totalAmount ? (parseFloat(prev.totalAmount) * rate).toFixed(2) : '',
                      }));
                    }}
                    className={cn(
                      'w-24 px-1.5 py-0.5 text-sm font-mono bg-background-primary border border-border-primary rounded focus:border-oak-light focus:outline-none text-right',
                      numberInputClass
                    )}
                    placeholder="1.000000"
                  />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Subtotal row */}
        <div className="grid grid-cols-[140px_1fr_1fr] gap-0 border-b border-border-primary">
          <div className="px-3 py-2 text-sm text-text-secondary border-r border-border-primary bg-background-secondary">
            Subtotal
          </div>
          <div className="px-3 py-1.5 border-r border-border-primary">
            <input
              type="number"
              step="0.01"
              value={editFormData.subtotal}
              onChange={(e) => {
                const newSubtotal = e.target.value;
                const subtotal = parseFloat(newSubtotal) || 0;
                const tax = parseFloat(editFormData.taxAmount) || 0;
                const newTotal = (subtotal + tax).toFixed(2);
                const rate = parseFloat(editFormData.homeExchangeRate) || 1;
                setEditFormData((prev) => ({
                  ...prev,
                  subtotal: newSubtotal,
                  totalAmount: newTotal,
                  homeSubtotal: !isSameCurrency ? (subtotal * rate).toFixed(2) : '',
                  homeTotal: !isSameCurrency ? ((subtotal + tax) * rate).toFixed(2) : '',
                }));
              }}
              className={cn(
                'w-full px-2 py-1 text-sm text-right tabular-nums bg-background-primary border border-border-primary rounded focus:border-oak-light focus:outline-none',
                numberInputClass
              )}
              placeholder="0.00"
            />
          </div>
          <div className={cn(
            'px-3 py-1.5',
            isSameCurrency && 'bg-background-secondary/50'
          )}>
            {isSameCurrency ? (
              <div className="w-full px-2 py-1 text-sm text-right tabular-nums text-text-muted">
                {editFormData.subtotal ? parseFloat(editFormData.subtotal).toFixed(2) : '-'}
              </div>
            ) : (
              <input
                type="number"
                step="0.01"
                value={editFormData.homeSubtotal}
                onChange={(e) => {
                  const newHomeSubtotal = e.target.value;
                  const homeSubtotal = parseFloat(newHomeSubtotal) || 0;
                  const homeTax = parseFloat(editFormData.homeTaxAmount) || 0;
                  setEditFormData((prev) => ({
                    ...prev,
                    homeSubtotal: newHomeSubtotal,
                    homeTotal: (homeSubtotal + homeTax).toFixed(2),
                  }));
                }}
                className={cn(
                  'w-full px-2 py-1 text-sm text-right tabular-nums bg-background-primary border border-border-primary rounded focus:border-oak-light focus:outline-none',
                  numberInputClass
                )}
                placeholder="0.00"
              />
            )}
          </div>
        </div>

        {/* Tax row */}
        <div className="grid grid-cols-[140px_1fr_1fr] gap-0 border-b border-border-primary">
          <div className="px-3 py-2 text-sm text-text-secondary border-r border-border-primary bg-background-secondary">
            Tax
          </div>
          <div className="px-3 py-1.5 border-r border-border-primary">
            <input
              type="number"
              step="0.01"
              value={editFormData.taxAmount}
              onChange={(e) => {
                const newTax = e.target.value;
                const subtotal = parseFloat(editFormData.subtotal) || 0;
                const tax = parseFloat(newTax) || 0;
                const newTotal = (subtotal + tax).toFixed(2);
                const rate = parseFloat(editFormData.homeExchangeRate) || 1;
                setEditFormData((prev) => ({
                  ...prev,
                  taxAmount: newTax,
                  totalAmount: newTotal,
                  homeTaxAmount: !isSameCurrency ? (tax * rate).toFixed(2) : '',
                  homeTotal: !isSameCurrency ? ((subtotal + tax) * rate).toFixed(2) : '',
                }));
              }}
              className={cn(
                'w-full px-2 py-1 text-sm text-right tabular-nums bg-background-primary border border-border-primary rounded focus:border-oak-light focus:outline-none',
                numberInputClass
              )}
              placeholder="0.00"
            />
          </div>
          <div className={cn(
            'px-3 py-1.5',
            isSameCurrency && 'bg-background-secondary/50'
          )}>
            {isSameCurrency ? (
              <div className="w-full px-2 py-1 text-sm text-right tabular-nums text-text-muted">
                {editFormData.taxAmount ? parseFloat(editFormData.taxAmount).toFixed(2) : '-'}
              </div>
            ) : (
              <input
                type="number"
                step="0.01"
                value={editFormData.homeTaxAmount}
                onChange={(e) => {
                  const newHomeTax = e.target.value;
                  const homeSubtotal = parseFloat(editFormData.homeSubtotal) || 0;
                  const homeTax = parseFloat(newHomeTax) || 0;
                  setEditFormData((prev) => ({
                    ...prev,
                    homeTaxAmount: newHomeTax,
                    homeTotal: (homeSubtotal + homeTax).toFixed(2),
                  }));
                }}
                className={cn(
                  'w-full px-2 py-1 text-sm text-right tabular-nums bg-background-primary border border-border-primary rounded focus:border-oak-light focus:outline-none',
                  numberInputClass
                )}
                placeholder="0.00"
              />
            )}
          </div>
        </div>

        {/* Total row - calculated, not editable */}
        <div className="grid grid-cols-[140px_1fr_1fr] gap-0 bg-background-tertiary">
          <div className="px-3 py-2 text-sm font-semibold text-text-primary border-r border-border-primary">
            Total
          </div>
          <div className="px-3 py-1.5 border-r border-border-primary bg-background-secondary/30">
            <div className="w-full px-2 py-1 text-sm text-right tabular-nums font-semibold text-text-secondary">
              {editFormData.totalAmount ? parseFloat(editFormData.totalAmount).toFixed(2) : '-'}
            </div>
          </div>
          <div className={cn(
            'px-3 py-1.5 bg-background-secondary/30',
            isSameCurrency && 'bg-background-secondary/50'
          )}>
            <div className={cn(
              'w-full px-2 py-1 text-sm text-right tabular-nums font-semibold',
              isSameCurrency ? 'text-text-muted' : 'text-text-secondary'
            )}>
              {isSameCurrency
                ? (editFormData.totalAmount ? parseFloat(editFormData.totalAmount).toFixed(2) : '-')
                : (editFormData.homeTotal ? parseFloat(editFormData.homeTotal).toFixed(2) : '-')}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // View mode - clean table layout
  return (
    <div className="border border-border-primary rounded-lg overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[140px_1fr_1fr] gap-0 text-xs font-medium text-text-muted bg-background-tertiary border-b border-border-primary">
        <div className="px-3 py-2 border-r border-border-primary"></div>
        <div className="px-3 py-2 text-right border-r border-border-primary">
          <div className="text-text-muted">Document Amount</div>
        </div>
        <div className={cn(
          'px-3 py-2 text-right',
          isSameCurrency && 'bg-background-secondary/50'
        )}>
          <div className={cn('text-text-muted', isSameCurrency && 'opacity-50')}>Home Amount</div>
          {!isSameCurrency && (
            <div className="text-xs text-text-muted mt-0.5">
              @{formatExchangeRate(editFormData.homeExchangeRate)}
            </div>
          )}
        </div>
      </div>

      {/* Subtotal row */}
      <div
        className={cn(
          'grid grid-cols-[140px_1fr_1fr] gap-0 border-b border-border-primary transition-colors cursor-pointer',
          focusedField === 'subtotal' ? 'bg-yellow-50 dark:bg-yellow-900/20' : 'hover:bg-background-secondary/50'
        )}
        onMouseEnter={() => handleFieldFocus('subtotal')}
        onMouseLeave={handleFieldBlur}
      >
        <div className="px-3 py-2.5 text-sm text-text-secondary border-r border-border-primary flex items-center gap-1.5">
          Subtotal
          {getFieldConfidence('subtotal') !== undefined && (
            <ConfidenceDot confidence={getFieldConfidence('subtotal')!} size="sm" />
          )}
        </div>
        <div className={cn(
          'px-3 py-2.5 text-sm tabular-nums text-right border-r border-border-primary',
          subtotalIssue ? 'text-status-warning' : 'text-text-primary'
        )}>
          <span className="flex items-center justify-end gap-1">
            {subtotalIssue && (
              <span title={subtotalIssue.message}>
                <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
              </span>
            )}
            {formatAmount(documentSubtotal, documentCurrency)}
          </span>
        </div>
        <div className={cn(
          'px-3 py-2.5 text-sm tabular-nums text-right',
          homeSubtotalIssue ? 'text-status-warning' : isSameCurrency ? 'text-text-muted bg-background-secondary/50' : 'text-text-primary'
        )}>
          <span className="flex items-center justify-end gap-1">
            {homeSubtotalIssue && (
              <span title={homeSubtotalIssue.message}>
                <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
              </span>
            )}
            {formatAmount(isSameCurrency ? documentSubtotal : editFormData.homeSubtotal, editFormData.homeCurrency)}
          </span>
        </div>
      </div>

      {/* Tax row */}
      <div
        className={cn(
          'grid grid-cols-[140px_1fr_1fr] gap-0 border-b border-border-primary transition-colors cursor-pointer',
          focusedField === 'taxAmount' ? 'bg-yellow-50 dark:bg-yellow-900/20' : 'hover:bg-background-secondary/50'
        )}
        onMouseEnter={() => handleFieldFocus('taxAmount')}
        onMouseLeave={handleFieldBlur}
      >
        <div className="px-3 py-2.5 text-sm text-text-secondary border-r border-border-primary flex items-center gap-1.5">
          Tax
          {getFieldConfidence('taxAmount') !== undefined && (
            <ConfidenceDot confidence={getFieldConfidence('taxAmount')!} size="sm" />
          )}
        </div>
        <div className={cn(
          'px-3 py-2.5 text-sm tabular-nums text-right border-r border-border-primary',
          taxAmountIssue ? 'text-status-warning' : 'text-text-primary'
        )}>
          <span className="flex items-center justify-end gap-1">
            {taxAmountIssue && (
              <span title={taxAmountIssue.message}>
                <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
              </span>
            )}
            {formatAmount(documentTaxAmount, documentCurrency)}
          </span>
        </div>
        <div className={cn(
          'px-3 py-2.5 text-sm tabular-nums text-right',
          homeTaxAmountIssue ? 'text-status-warning' : isSameCurrency ? 'text-text-muted bg-background-secondary/50' : 'text-text-primary'
        )}>
          <span className="flex items-center justify-end gap-1">
            {homeTaxAmountIssue && (
              <span title={homeTaxAmountIssue.message}>
                <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
              </span>
            )}
            {formatAmount(isSameCurrency ? documentTaxAmount : editFormData.homeTaxAmount, editFormData.homeCurrency)}
          </span>
        </div>
      </div>

      {/* Total row - emphasized */}
      <div
        className={cn(
          'grid grid-cols-[140px_1fr_1fr] gap-0 bg-background-tertiary transition-colors cursor-pointer',
          focusedField === 'totalAmount' ? 'bg-yellow-100 dark:bg-yellow-900/30' : ''
        )}
        onMouseEnter={() => handleFieldFocus('totalAmount')}
        onMouseLeave={handleFieldBlur}
      >
        <div className="px-3 py-2.5 text-sm font-semibold text-text-primary border-r border-border-primary flex items-center gap-1.5">
          Total
          {getFieldConfidence('totalAmount') !== undefined && (
            <ConfidenceDot confidence={getFieldConfidence('totalAmount')!} size="sm" />
          )}
        </div>
        <div className={cn(
          'px-3 py-2.5 text-sm tabular-nums text-right font-semibold border-r border-border-primary',
          totalAmountIssue ? 'text-status-warning' : 'text-text-primary'
        )}>
          <span className="flex items-center justify-end gap-1">
            {totalAmountIssue && (
              <span title={totalAmountIssue.message}>
                <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
              </span>
            )}
            {formatAmount(documentTotalAmount, documentCurrency)}
          </span>
        </div>
        <div className={cn(
          'px-3 py-2.5 text-sm tabular-nums text-right font-semibold',
          homeEquivalentIssue ? 'text-status-warning' : isSameCurrency ? 'text-text-muted bg-background-secondary/50' : 'text-text-primary'
        )}>
          <span className="flex items-center justify-end gap-1">
            {homeEquivalentIssue && (
              <span title={homeEquivalentIssue.message}>
                <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
              </span>
            )}
            {formatAmount(isSameCurrency ? documentTotalAmount : editFormData.homeTotal, editFormData.homeCurrency)}
          </span>
        </div>
      </div>
    </div>
  );
}
