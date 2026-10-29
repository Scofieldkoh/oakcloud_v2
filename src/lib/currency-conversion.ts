/**
 * Currency Conversion Utilities
 *
 * Client-safe functions for converting amounts between currencies.
 * These are pure functions with no server-side dependencies.
 */

/**
 * Convert amount to home currency (2 decimal places)
 */
export function convertToHomeCurrency(amount: number, rate: number): number {
  return Math.round(amount * rate * 100) / 100;
}

/**
 * Input type for line item conversion
 */
export interface LineItemForConversion {
  amount: number;
  gstAmount: number | null;
  isOverride?: boolean;
  homeAmount?: number | null;
}

/**
 * Output type for converted line item
 */
export interface ConvertedLineItem {
  homeAmount: number;
  homeGstAmount: number | null;
}

/**
 * Convert line items and apply rounding adjustment to first line item
 * so that sum of line home amounts equals header home total exactly
 */
export function convertLineItemsWithRounding(
  lineItems: LineItemForConversion[],
  rate: number,
  headerHomeTotal: number
): ConvertedLineItem[] {
  // Convert each line
  const converted = lineItems.map((item) => {
    const homeAmount =
      item.isOverride && item.homeAmount != null
        ? item.homeAmount
        : convertToHomeCurrency(item.amount, rate);
    const homeGstAmount =
      item.gstAmount != null ? convertToHomeCurrency(item.gstAmount, rate) : null;
    return { homeAmount, homeGstAmount };
  });

  // Calculate sum
  const sum = converted.reduce((acc, item) => {
    return acc + item.homeAmount + (item.homeGstAmount || 0);
  }, 0);

  // Apply rounding adjustment to first non-overridden line
  const diff = Math.round((headerHomeTotal - sum) * 100) / 100;
  if (diff !== 0) {
    const firstNonOverrideIdx = lineItems.findIndex((item) => !item.isOverride);
    if (firstNonOverrideIdx >= 0) {
      converted[firstNonOverrideIdx].homeAmount = Math.round(
        (converted[firstNonOverrideIdx].homeAmount + diff) * 100
      ) / 100;
    }
  }

  return converted;
}

/**
 * Calculate header home amounts from document amounts
 */
export function calculateHomeHeaderAmounts(
  subtotal: number | null,
  taxAmount: number | null,
  totalAmount: number,
  rate: number
): { homeSubtotal: number | null; homeTaxAmount: number | null; homeTotal: number } {
  return {
    homeSubtotal: subtotal != null ? convertToHomeCurrency(subtotal, rate) : null,
    homeTaxAmount: taxAmount != null ? convertToHomeCurrency(taxAmount, rate) : null,
    homeTotal: convertToHomeCurrency(totalAmount, rate),
  };
}
