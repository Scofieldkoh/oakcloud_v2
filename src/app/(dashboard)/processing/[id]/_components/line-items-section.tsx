'use client';

import { RefreshCw, AlertTriangle, List, Plus, Trash2 } from 'lucide-react';
import { ConfidenceDot } from '@/components/processing';
import { cn } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { gstTaxCodes, formatCurrency, formatNumber, type ValidationIssue } from './helpers';

// Helper to extract confidence from line item evidence
function getLineItemConfidence(evidenceJson: Record<string, unknown> | null): number | undefined {
  if (!evidenceJson) return undefined;
  // Check for description confidence (main confidence indicator)
  const descEvidence = evidenceJson.description as { confidence?: number } | undefined;
  const amountEvidence = evidenceJson.amount as { confidence?: number } | undefined;
  // Return average of available confidences
  const confidences: number[] = [];
  if (descEvidence?.confidence !== undefined) confidences.push(descEvidence.confidence);
  if (amountEvidence?.confidence !== undefined) confidences.push(amountEvidence.confidence);
  if (confidences.length === 0) return undefined;
  return confidences.reduce((a, b) => a + b, 0) / confidences.length;
}

export function LineItemsSection({
  lineItems,
  isEditing,
  isLoading,
  currency,
  homeCurrency,
  exchangeRate,
  chartOfAccounts,
  onAdd,
  onRemove,
  onChange,
  fullWidth = false,
  validationIssues = [],
}: {
  lineItems?: Array<{
    id?: string;
    lineNo: number;
    description: string;
    quantity?: string | null;
    unitPrice?: string | null;
    amount: string;
    gstAmount?: string | null;
    taxCode?: string | null;
    accountCode?: string | null;
    evidenceJson?: Record<string, unknown> | null;
    homeAmount?: string | null;
    homeGstAmount?: string | null;
  }>;
  isEditing: boolean;
  isLoading: boolean;
  currency: string;
  homeCurrency: string;
  exchangeRate: number;
  chartOfAccounts: Array<{ code: string; name: string }>;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, field: string, value: string) => void;
  fullWidth?: boolean;
  validationIssues?: ValidationIssue[];
}) {
  const isSameCurrency = currency === homeCurrency;

  // Helper to check if a line item has GST validation issue
  const getLineItemGstIssue = (lineNo: number): ValidationIssue | undefined => {
    return validationIssues.find(
      (issue) =>
        issue.code === 'GST_CODE_AMOUNT_MISMATCH' &&
        issue.message.includes(`Line ${lineNo}:`)
    );
  };

  // Helper to get validation issue for footer totals
  const getFooterValidationIssue = (code: string): ValidationIssue | undefined => {
    return validationIssues.find((issue) => issue.code === code);
  };

  // Check for footer-level validation issues
  const lineSubtotalIssue = getFooterValidationIssue('LINE_SUM_MISMATCH');
  const lineTaxIssue = getFooterValidationIssue('LINE_GST_SUM_MISMATCH');
  const homeSubtotalIssue = getFooterValidationIssue('HOME_AMOUNT_SUM_MISMATCH');
  const homeTaxIssue = getFooterValidationIssue('HOME_GST_SUM_MISMATCH');
  const homeTotalIssue = getFooterValidationIssue('HEADER_HOME_LINE_TOTAL_MISMATCH');

  // Helper to get home amount for display (calculate if not stored)
  const getDisplayHomeAmount = (item: { amount: string; homeAmount?: string | null }): string => {
    if (isSameCurrency) return item.amount;
    if (item.homeAmount) return item.homeAmount;
    // Calculate from document amount if not stored
    const amount = parseFloat(item.amount) || 0;
    return (amount * exchangeRate).toFixed(2);
  };

  // Helper to get home GST amount for display (calculate if not stored)
  const getDisplayHomeGstAmount = (item: { gstAmount?: string | null; homeGstAmount?: string | null }): string => {
    if (isSameCurrency) return item.gstAmount || '0';
    if (item.homeGstAmount) return item.homeGstAmount;
    // Calculate from document GST amount if not stored
    const gstAmount = parseFloat(item.gstAmount || '0') || 0;
    return (gstAmount * exchangeRate).toFixed(2);
  };

  // Calculate totals from line items (authoritative source)
  const calculatedSubtotal = lineItems?.reduce((sum, item) => {
    const amount = parseFloat(item.amount) || 0;
    return sum + amount;
  }, 0) ?? 0;

  const calculatedTax = lineItems?.reduce((sum, item) => {
    const gstAmount = parseFloat(item.gstAmount || '0') || 0;
    return sum + gstAmount;
  }, 0) ?? 0;

  const calculatedTotal = calculatedSubtotal + calculatedTax;

  // Calculate home currency totals (use stored values or calculate)
  const calculatedHomeSubtotal = lineItems?.reduce((sum, item) => {
    const homeAmount = parseFloat(getDisplayHomeAmount(item)) || 0;
    return sum + homeAmount;
  }, 0) ?? 0;

  const calculatedHomeTax = lineItems?.reduce((sum, item) => {
    const homeGstAmount = parseFloat(getDisplayHomeGstAmount(item)) || 0;
    return sum + homeGstAmount;
  }, 0) ?? 0;

  const calculatedHomeTotal = calculatedHomeSubtotal + calculatedHomeTax;

  if (isLoading) {
    return (
      <div className={cn(fullWidth ? 'p-4' : 'card p-8', 'flex items-center justify-center')}>
        <RefreshCw className="w-5 h-5 animate-spin text-text-muted" />
      </div>
    );
  }

  // Calculate amount including tax for each item
  const getAmountInclTax = (item: { amount: string; gstAmount?: string | null }) => {
    const amount = parseFloat(item.amount) || 0;
    const gst = parseFloat(item.gstAmount || '0') || 0;
    return amount + gst;
  };

  // Calculate home amount including tax for each item (use stored or calculated values)
  const getHomeAmountInclTax = (item: { amount: string; gstAmount?: string | null; homeAmount?: string | null; homeGstAmount?: string | null }) => {
    const homeAmount = parseFloat(getDisplayHomeAmount(item)) || 0;
    const homeGst = parseFloat(getDisplayHomeGstAmount(item)) || 0;
    return homeAmount + homeGst;
  };

  return (
    <div className={cn(fullWidth ? 'flex flex-col' : 'card')}>
      <div className={cn(
        'flex items-center justify-between flex-shrink-0',
        fullWidth ? 'px-4 py-3 border-b border-border-primary bg-background-secondary' : 'p-4 border-b border-border-primary'
      )}>
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <List className="w-4 h-4" />
          Line Items ({lineItems?.length || 0})
        </h3>
        {isEditing && (
          <button onClick={onAdd} className="btn-secondary btn-xs flex items-center gap-1">
            <Plus className="w-3 h-3" />
            Add Item
          </button>
        )}
      </div>

      {lineItems && lineItems.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background-tertiary">
              <tr>
                <th className="text-left text-xs font-medium text-text-secondary px-3 py-2.5 w-10">#</th>
                <th className="text-left text-xs font-medium text-text-secondary px-3 py-2.5">Description</th>
                <th className="text-left text-xs font-medium text-text-secondary px-3 py-2.5 w-96">Account</th>
                <th className="text-right text-xs font-medium text-text-secondary px-3 py-2.5 w-14">Qty</th>
                <th className="text-right text-xs font-medium text-text-secondary px-3 py-2.5 w-24">Unit Price</th>
                <th className="text-right text-xs font-medium text-text-secondary px-3 py-2.5 w-28">
                  <div>Amount</div>
                  {isEditing && <div className="font-normal text-text-muted">({currency})</div>}
                </th>
                <th className="text-right text-xs font-medium text-text-secondary px-3 py-2.5 w-24">
                  <div>GST Amt</div>
                  {isEditing && <div className="font-normal text-text-muted">({currency})</div>}
                </th>
                <th className="text-right text-xs font-medium text-text-secondary px-3 py-2.5 w-28">
                  <div>Amt Incl Tax</div>
                  {isEditing && <div className="font-normal text-text-muted">({currency})</div>}
                </th>
                {/* Home Currency Headers - always shown */}
                <th className="w-px bg-border-primary"></th>
                <th className={cn(
                  "text-right text-xs font-medium px-3 py-2.5 w-28",
                  isSameCurrency ? "text-text-muted bg-background-secondary/60" : "text-text-secondary"
                )}>
                  <div>Amount</div>
                  {isEditing && <div className="font-normal text-text-muted">({homeCurrency})</div>}
                </th>
                <th className={cn(
                  "text-right text-xs font-medium px-3 py-2.5 w-24",
                  isSameCurrency ? "text-text-muted bg-background-secondary/60" : "text-text-secondary"
                )}>
                  <div>GST Amt</div>
                  {isEditing && <div className="font-normal text-text-muted">({homeCurrency})</div>}
                </th>
                <th className={cn(
                  "text-right text-xs font-medium px-3 py-2.5 w-28",
                  isSameCurrency ? "text-text-muted bg-background-secondary/60" : "text-text-secondary"
                )}>
                  <div>Amt Incl Tax</div>
                  {isEditing && <div className="font-normal text-text-muted">({homeCurrency})</div>}
                </th>
                <th className={cn(
                  "text-right text-xs font-medium text-text-secondary px-3 py-2.5 w-32",
                  !isEditing && "pr-8"
                )}>GST</th>
                {isEditing && <th className="w-10"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-primary">
              {lineItems.map((item, index) => {
                const account = chartOfAccounts.find((a) => a.code === item.accountCode);
                const gstCode = gstTaxCodes.find((g) => g.code === item.taxCode);
                const lineConfidence = getLineItemConfidence(item.evidenceJson || null);
                const amountInclTax = getAmountInclTax(item);
                const homeAmountInclTax = getHomeAmountInclTax(item);
                const gstIssue = getLineItemGstIssue(item.lineNo);
                return (
                  <tr key={item.id || `new-${index}`} className="hover:bg-background-tertiary/50">
                    <td className="px-3 py-2.5 text-sm text-text-muted">
                      <span className="flex items-center gap-1.5">
                        {item.lineNo}
                        {lineConfidence !== undefined && !isEditing && (
                          <ConfidenceDot confidence={lineConfidence} size="sm" />
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-text-primary">
                      {isEditing ? (
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => onChange(index, 'description', e.target.value)}
                          className="w-full px-2 py-1 text-sm bg-background-secondary border border-border-primary rounded focus:border-oak-light focus:outline-none"
                        />
                      ) : (
                        <span className="block" title={item.description}>
                          {item.description}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-text-primary">
                      {isEditing ? (
                        <SearchableSelect
                          options={chartOfAccounts.map((acc) => ({
                            value: acc.code,
                            label: `${acc.code} - ${acc.name}`,
                          }))}
                          value={item.accountCode || ''}
                          onChange={(value) => onChange(index, 'accountCode', value)}
                          placeholder="Select account..."
                          size="sm"
                          showKeyboardHints={false}
                        />
                      ) : (
                        <span
                          className="cursor-default"
                          title={account ? `${account.code} - ${account.name}` : item.accountCode || ''}
                        >
                          {account?.name || item.accountCode || '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-right text-text-primary tabular-nums">
                      {isEditing ? (
                        <input
                          type="number"
                          step="1"
                          value={item.quantity || ''}
                          onChange={(e) => onChange(index, 'quantity', e.target.value)}
                          className="w-full px-2 py-1 text-sm bg-background-secondary border border-border-primary rounded focus:border-oak-light focus:outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      ) : (
                        formatNumber(item.quantity || null, 0)
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-right text-text-primary tabular-nums">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={item.unitPrice || ''}
                          onChange={(e) => onChange(index, 'unitPrice', e.target.value)}
                          className="w-full px-2 py-1 text-sm bg-background-secondary border border-border-primary rounded focus:border-oak-light focus:outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      ) : (
                        formatCurrency(item.unitPrice || '0', currency)
                      )}
                    </td>
                    {/* Amount (document currency) */}
                    <td className="px-3 py-2.5 text-sm text-right text-text-primary tabular-nums">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={item.amount}
                          onChange={(e) => onChange(index, 'amount', e.target.value)}
                          className="w-full px-2 py-1 text-sm bg-background-secondary border border-border-primary rounded focus:border-oak-light focus:outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      ) : (
                        formatCurrency(item.amount, currency)
                      )}
                    </td>
                    {/* GST Amount (document currency) */}
                    <td className={cn(
                      "px-3 py-2.5 text-sm text-right tabular-nums",
                      gstIssue ? "text-status-warning" : "text-text-primary"
                    )}>
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={item.gstAmount || ''}
                          onChange={(e) => onChange(index, 'gstAmount', e.target.value)}
                          className={cn(
                            "w-full px-2 py-1 text-sm bg-background-secondary border rounded focus:outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                            gstIssue ? "border-status-warning focus:border-status-warning" : "border-border-primary focus:border-oak-light"
                          )}
                        />
                      ) : (
                        <span className="flex items-center justify-end gap-1">
                          {gstIssue && (
                            <span title={gstIssue.message}>
                              <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
                            </span>
                          )}
                          {formatCurrency(item.gstAmount || '0', currency)}
                        </span>
                      )}
                    </td>
                    {/* Amt Incl Tax (document currency) */}
                    <td className="px-3 py-2.5 text-sm text-right text-text-primary tabular-nums">
                      {formatCurrency(amountInclTax.toFixed(2), currency)}
                    </td>
                    {/* Home Currency Columns - always shown */}
                    {/* Divider */}
                    <td className="w-px bg-border-primary"></td>
                    {/* Amount (home currency) */}
                    <td className={cn(
                      "px-3 py-2.5 text-sm text-right tabular-nums",
                      isSameCurrency ? "text-text-muted bg-background-secondary/40" : "text-text-primary"
                    )}>
                      {isEditing && !isSameCurrency ? (
                        <input
                          type="number"
                          step="0.01"
                          value={item.homeAmount || ''}
                          onChange={(e) => onChange(index, 'homeAmount', e.target.value)}
                          className="w-full px-2 py-1 text-sm bg-background-secondary border border-border-primary rounded focus:border-oak-light focus:outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      ) : (
                        formatCurrency(getDisplayHomeAmount(item), homeCurrency)
                      )}
                    </td>
                    {/* GST Amount (home currency) */}
                    <td className={cn(
                      "px-3 py-2.5 text-sm text-right tabular-nums",
                      isSameCurrency ? "text-text-muted bg-background-secondary/40" : "text-text-primary"
                    )}>
                      {isEditing && !isSameCurrency ? (
                        <input
                          type="number"
                          step="0.01"
                          value={item.homeGstAmount || ''}
                          onChange={(e) => onChange(index, 'homeGstAmount', e.target.value)}
                          className="w-full px-2 py-1 text-sm bg-background-secondary border border-border-primary rounded focus:border-oak-light focus:outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      ) : (
                        formatCurrency(getDisplayHomeGstAmount(item), homeCurrency)
                      )}
                    </td>
                    {/* Amt Incl Tax (home currency) */}
                    <td className={cn(
                      "px-3 py-2.5 text-sm text-right tabular-nums",
                      isSameCurrency ? "text-text-muted bg-background-secondary/40" : "text-text-primary"
                    )}>
                      {formatCurrency(isSameCurrency ? amountInclTax.toFixed(2) : homeAmountInclTax.toFixed(2), homeCurrency)}
                    </td>
                    {/* GST Code (last column) */}
                    <td className={cn(
                      "px-3 py-2.5 text-sm text-right",
                      gstIssue ? "text-status-warning" : "text-text-primary",
                      !isEditing && "pr-8"
                    )}>
                      {isEditing ? (
                        <select
                          value={item.taxCode || ''}
                          onChange={(e) => onChange(index, 'taxCode', e.target.value)}
                          className={cn(
                            "w-full px-2 py-1 text-sm bg-background-secondary border rounded focus:outline-none text-right min-w-[100px]",
                            gstIssue ? "border-status-warning focus:border-status-warning" : "border-border-primary focus:border-oak-light"
                          )}
                        >
                          <option value="">-</option>
                          {gstTaxCodes.map((gst) => (
                            <option key={gst.code} value={gst.code}>
                              {gst.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="flex items-center justify-end gap-1">
                          {gstIssue && (
                            <span title={gstIssue.message}>
                              <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
                            </span>
                          )}
                          {gstCode?.label || item.taxCode || '-'}
                        </span>
                      )}
                    </td>
                    {isEditing && (
                      <td className="px-2 py-2.5 text-center">
                        <button
                          onClick={() => onRemove(index)}
                          className="p-1 text-status-error hover:bg-status-error/10 rounded transition-colors"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-background-tertiary border-t border-border-primary">
              <tr className="font-semibold">
                <td colSpan={5} className="px-3 py-2.5 text-sm text-right text-text-primary">
                  Total
                </td>
                {/* Document currency totals */}
                <td className={cn(
                  "px-3 py-2.5 text-sm text-right tabular-nums",
                  lineSubtotalIssue ? "text-status-warning" : "text-text-primary"
                )}>
                  <span className="flex items-center justify-end gap-1">
                    {lineSubtotalIssue && (
                      <span title={lineSubtotalIssue.message}>
                        <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
                      </span>
                    )}
                    {formatCurrency(calculatedSubtotal.toFixed(2), currency)}
                  </span>
                </td>
                <td className={cn(
                  "px-3 py-2.5 text-sm text-right tabular-nums",
                  lineTaxIssue ? "text-status-warning" : "text-text-primary"
                )}>
                  <span className="flex items-center justify-end gap-1">
                    {lineTaxIssue && (
                      <span title={lineTaxIssue.message}>
                        <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
                      </span>
                    )}
                    {formatCurrency(calculatedTax.toFixed(2), currency)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-sm text-right text-text-primary tabular-nums">
                  {formatCurrency(calculatedTotal.toFixed(2), currency)}
                </td>
                {/* Home currency totals - always shown */}
                <td className="w-px bg-border-primary"></td>
                <td className={cn(
                  "px-3 py-2.5 text-sm text-right tabular-nums",
                  homeSubtotalIssue ? "text-status-warning" : isSameCurrency ? "text-text-muted bg-background-secondary/60" : "text-text-primary"
                )}>
                  <span className="flex items-center justify-end gap-1">
                    {homeSubtotalIssue && (
                      <span title={homeSubtotalIssue.message}>
                        <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
                      </span>
                    )}
                    {formatCurrency(isSameCurrency ? calculatedSubtotal.toFixed(2) : calculatedHomeSubtotal.toFixed(2), homeCurrency)}
                  </span>
                </td>
                <td className={cn(
                  "px-3 py-2.5 text-sm text-right tabular-nums",
                  homeTaxIssue ? "text-status-warning" : isSameCurrency ? "text-text-muted bg-background-secondary/60" : "text-text-primary"
                )}>
                  <span className="flex items-center justify-end gap-1">
                    {homeTaxIssue && (
                      <span title={homeTaxIssue.message}>
                        <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
                      </span>
                    )}
                    {formatCurrency(isSameCurrency ? calculatedTax.toFixed(2) : calculatedHomeTax.toFixed(2), homeCurrency)}
                  </span>
                </td>
                <td className={cn(
                  "px-3 py-2.5 text-sm text-right tabular-nums",
                  homeTotalIssue ? "text-status-warning" : isSameCurrency ? "text-text-muted bg-background-secondary/60" : "text-text-primary"
                )}>
                  <span className="flex items-center justify-end gap-1">
                    {homeTotalIssue && (
                      <span title={homeTotalIssue.message}>
                        <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
                      </span>
                    )}
                    {formatCurrency(isSameCurrency ? calculatedTotal.toFixed(2) : calculatedHomeTotal.toFixed(2), homeCurrency)}
                  </span>
                </td>
                {/* Empty cell for GST column */}
                <td className={cn("px-3 py-2.5", !isEditing && "pr-8")}></td>
                {isEditing && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="p-8 text-center text-text-muted">
          <List className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No line items extracted</p>
        </div>
      )}
    </div>
  );
}
