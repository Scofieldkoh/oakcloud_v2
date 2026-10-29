/**
 * Document Category and Sub-Category Mapping Utilities
 *
 * This module provides type-safe mappings between document categories and their
 * valid sub-categories, along with display labels for UI rendering.
 */

// Import enums directly from the enums file to avoid pulling in Prisma client runtime
// This allows the file to be used in client components
import {
  DocumentCategory,
  DocumentSubCategory,
} from '@/generated/prisma/enums';

// =============================================================================
// CATEGORY → SUB-CATEGORY MAPPING
// =============================================================================

/**
 * Maps each document category to its valid sub-categories.
 * This is the authoritative source for category-subcategory relationships.
 */
export const CATEGORY_SUBCATEGORY_MAP: Record<DocumentCategory, DocumentSubCategory[]> = {
  [DocumentCategory.ACCOUNTS_PAYABLE]: [
    DocumentSubCategory.VENDOR_INVOICE,
    DocumentSubCategory.VENDOR_CREDIT_NOTE,
    DocumentSubCategory.PURCHASE_ORDER,
    DocumentSubCategory.DELIVERY_NOTE,
    DocumentSubCategory.VENDOR_STATEMENT,
    DocumentSubCategory.VENDOR_QUOTATION,
    DocumentSubCategory.OTHERS_ACCOUNTS_PAYABLE,
  ],
  [DocumentCategory.ACCOUNTS_RECEIVABLE]: [
    DocumentSubCategory.SALES_INVOICE,
    DocumentSubCategory.SALES_CREDIT_NOTE,
    DocumentSubCategory.SALES_ORDER,
    DocumentSubCategory.DELIVERY_ORDER,
    DocumentSubCategory.CUSTOMER_STATEMENT,
    DocumentSubCategory.OTHERS_ACCOUNTS_RECEIVABLE,
  ],
  [DocumentCategory.TREASURY]: [
    DocumentSubCategory.BANK_STATEMENT,
    DocumentSubCategory.BANK_ADVICE,
    DocumentSubCategory.PAYMENT_VOUCHER,
    DocumentSubCategory.RECEIPT_VOUCHER,
    DocumentSubCategory.LOAN_DOCUMENT,
    DocumentSubCategory.OTHERS_TREASURY,
  ],
  [DocumentCategory.TAX_COMPLIANCE]: [
    DocumentSubCategory.GST_RETURN,
    DocumentSubCategory.INCOME_TAX,
    DocumentSubCategory.OTHERS_TAX_COMPLIANCE,
  ],
  [DocumentCategory.PAYROLL]: [
    DocumentSubCategory.PAYSLIP,
    DocumentSubCategory.CPF_SUBMISSION,
    DocumentSubCategory.IR8A,
    DocumentSubCategory.EXPENSE_CLAIM,
    DocumentSubCategory.OTHERS_PAYROLL,
  ],
  [DocumentCategory.CORPORATE_SECRETARIAL]: [
    DocumentSubCategory.BIZFILE,
    DocumentSubCategory.RESOLUTION,
    DocumentSubCategory.REGISTER,
    DocumentSubCategory.INCORPORATION,
    DocumentSubCategory.ANNUAL_RETURN,
    DocumentSubCategory.MEETING_MINUTES,
    DocumentSubCategory.OTHERS_CORPORATE_SECRETARIAL,
  ],
  [DocumentCategory.CONTRACTS]: [
    DocumentSubCategory.VENDOR_CONTRACT,
    DocumentSubCategory.CUSTOMER_CONTRACT,
    DocumentSubCategory.EMPLOYMENT_CONTRACT,
    DocumentSubCategory.LEASE_AGREEMENT,
    DocumentSubCategory.OTHERS_CONTRACTS,
  ],
  [DocumentCategory.FINANCIAL_REPORTS]: [
    DocumentSubCategory.FINANCIAL_STATEMENT,
    DocumentSubCategory.MANAGEMENT_REPORT,
    DocumentSubCategory.AUDIT_REPORT,
    DocumentSubCategory.OTHERS_FINANCIAL_REPORTS,
  ],
  [DocumentCategory.INSURANCE]: [
    DocumentSubCategory.INSURANCE_POLICY,
    DocumentSubCategory.INSURANCE_CLAIM,
    DocumentSubCategory.OTHERS_INSURANCE,
  ],
  [DocumentCategory.CORRESPONDENCE]: [
    DocumentSubCategory.LETTER,
    DocumentSubCategory.EMAIL,
    DocumentSubCategory.OTHERS_CORRESPONDENCE,
  ],
  [DocumentCategory.OTHER]: [
    DocumentSubCategory.MISCELLANEOUS,
    DocumentSubCategory.SUPPORTING_DOCUMENT,
  ],
};

// =============================================================================
// DISPLAY LABELS
// =============================================================================

/**
 * Human-readable labels for document categories
 */
export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  [DocumentCategory.ACCOUNTS_PAYABLE]: 'Accounts Payable',
  [DocumentCategory.ACCOUNTS_RECEIVABLE]: 'Accounts Receivable',
  [DocumentCategory.TREASURY]: 'Treasury',
  [DocumentCategory.TAX_COMPLIANCE]: 'Tax Compliance',
  [DocumentCategory.PAYROLL]: 'Payroll',
  [DocumentCategory.CORPORATE_SECRETARIAL]: 'Corporate Secretarial',
  [DocumentCategory.CONTRACTS]: 'Contracts',
  [DocumentCategory.FINANCIAL_REPORTS]: 'Financial Reports',
  [DocumentCategory.INSURANCE]: 'Insurance',
  [DocumentCategory.CORRESPONDENCE]: 'Correspondence',
  [DocumentCategory.OTHER]: 'Other',
};

/**
 * Human-readable labels for document sub-categories
 */
export const SUBCATEGORY_LABELS: Record<DocumentSubCategory, string> = {
  // ACCOUNTS_PAYABLE
  [DocumentSubCategory.VENDOR_INVOICE]: 'Vendor Invoice',
  [DocumentSubCategory.VENDOR_CREDIT_NOTE]: 'Vendor Credit Note',
  [DocumentSubCategory.PURCHASE_ORDER]: 'Purchase Order',
  [DocumentSubCategory.DELIVERY_NOTE]: 'Delivery Note',
  [DocumentSubCategory.VENDOR_STATEMENT]: 'Vendor Statement',
  [DocumentSubCategory.VENDOR_QUOTATION]: 'Vendor Quotation',
  [DocumentSubCategory.OTHERS_ACCOUNTS_PAYABLE]: 'Others',

  // ACCOUNTS_RECEIVABLE
  [DocumentSubCategory.SALES_INVOICE]: 'Sales Invoice',
  [DocumentSubCategory.SALES_CREDIT_NOTE]: 'Sales Credit Note',
  [DocumentSubCategory.SALES_ORDER]: 'Sales Order',
  [DocumentSubCategory.DELIVERY_ORDER]: 'Delivery Order',
  [DocumentSubCategory.CUSTOMER_STATEMENT]: 'Customer Statement',
  [DocumentSubCategory.OTHERS_ACCOUNTS_RECEIVABLE]: 'Others',

  // TREASURY
  [DocumentSubCategory.BANK_STATEMENT]: 'Bank Statement',
  [DocumentSubCategory.BANK_ADVICE]: 'Bank Advice',
  [DocumentSubCategory.PAYMENT_VOUCHER]: 'Payment Voucher',
  [DocumentSubCategory.RECEIPT_VOUCHER]: 'Receipt Voucher',
  [DocumentSubCategory.LOAN_DOCUMENT]: 'Loan Document',
  [DocumentSubCategory.OTHERS_TREASURY]: 'Others',

  // TAX_COMPLIANCE
  [DocumentSubCategory.GST_RETURN]: 'GST Return',
  [DocumentSubCategory.INCOME_TAX]: 'Income Tax',
  [DocumentSubCategory.OTHERS_TAX_COMPLIANCE]: 'Others',

  // PAYROLL
  [DocumentSubCategory.PAYSLIP]: 'Payslip',
  [DocumentSubCategory.CPF_SUBMISSION]: 'CPF Submission',
  [DocumentSubCategory.IR8A]: 'IR8A',
  [DocumentSubCategory.EXPENSE_CLAIM]: 'Expense Claim',
  [DocumentSubCategory.OTHERS_PAYROLL]: 'Others',

  // CORPORATE_SECRETARIAL
  [DocumentSubCategory.BIZFILE]: 'BizFile',
  [DocumentSubCategory.RESOLUTION]: 'Resolution',
  [DocumentSubCategory.REGISTER]: 'Register',
  [DocumentSubCategory.INCORPORATION]: 'Incorporation',
  [DocumentSubCategory.ANNUAL_RETURN]: 'Annual Return',
  [DocumentSubCategory.MEETING_MINUTES]: 'Meeting Minutes',
  [DocumentSubCategory.OTHERS_CORPORATE_SECRETARIAL]: 'Others',

  // CONTRACTS
  [DocumentSubCategory.VENDOR_CONTRACT]: 'Vendor Contract',
  [DocumentSubCategory.CUSTOMER_CONTRACT]: 'Customer Contract',
  [DocumentSubCategory.EMPLOYMENT_CONTRACT]: 'Employment Contract',
  [DocumentSubCategory.LEASE_AGREEMENT]: 'Lease Agreement',
  [DocumentSubCategory.OTHERS_CONTRACTS]: 'Others',

  // FINANCIAL_REPORTS
  [DocumentSubCategory.FINANCIAL_STATEMENT]: 'Financial Statement',
  [DocumentSubCategory.MANAGEMENT_REPORT]: 'Management Report',
  [DocumentSubCategory.AUDIT_REPORT]: 'Audit Report',
  [DocumentSubCategory.OTHERS_FINANCIAL_REPORTS]: 'Others',

  // INSURANCE
  [DocumentSubCategory.INSURANCE_POLICY]: 'Insurance Policy',
  [DocumentSubCategory.INSURANCE_CLAIM]: 'Insurance Claim',
  [DocumentSubCategory.OTHERS_INSURANCE]: 'Others',

  // CORRESPONDENCE
  [DocumentSubCategory.LETTER]: 'Letter',
  [DocumentSubCategory.EMAIL]: 'Email',
  [DocumentSubCategory.OTHERS_CORRESPONDENCE]: 'Others',

  // OTHER
  [DocumentSubCategory.MISCELLANEOUS]: 'Miscellaneous',
  [DocumentSubCategory.SUPPORTING_DOCUMENT]: 'Supporting Document',
};

/**
 * Short descriptions for each category (for tooltips/help text)
 */
export const CATEGORY_DESCRIPTIONS: Record<DocumentCategory, string> = {
  [DocumentCategory.ACCOUNTS_PAYABLE]: 'Vendor invoices, purchase orders, and supplier documents',
  [DocumentCategory.ACCOUNTS_RECEIVABLE]: 'Sales invoices, customer orders, and billing documents',
  [DocumentCategory.TREASURY]: 'Bank statements, payment vouchers, and cash management',
  [DocumentCategory.TAX_COMPLIANCE]: 'GST returns, tax assessments, and compliance documents',
  [DocumentCategory.PAYROLL]: 'Payslips, CPF submissions, and HR documents',
  [DocumentCategory.CORPORATE_SECRETARIAL]: 'BizFile extracts, resolutions, and statutory documents',
  [DocumentCategory.CONTRACTS]: 'Vendor, customer, and employment agreements',
  [DocumentCategory.FINANCIAL_REPORTS]: 'Financial statements and management reports',
  [DocumentCategory.INSURANCE]: 'Insurance policies and claims',
  [DocumentCategory.CORRESPONDENCE]: 'Letters, emails, and general communications',
  [DocumentCategory.OTHER]: 'Miscellaneous and supporting documents',
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get valid sub-categories for a given category
 */
export function getSubCategoriesForCategory(category: DocumentCategory): DocumentSubCategory[] {
  return CATEGORY_SUBCATEGORY_MAP[category] ?? [];
}

/**
 * Get the parent category for a given sub-category
 */
export function getCategoryForSubCategory(subCategory: DocumentSubCategory): DocumentCategory | null {
  for (const [category, subCategories] of Object.entries(CATEGORY_SUBCATEGORY_MAP)) {
    if (subCategories.includes(subCategory)) {
      return category as DocumentCategory;
    }
  }
  return null;
}

/**
 * Check if a sub-category is valid for a given category
 */
export function isValidSubCategoryForCategory(
  category: DocumentCategory,
  subCategory: DocumentSubCategory
): boolean {
  return CATEGORY_SUBCATEGORY_MAP[category]?.includes(subCategory) ?? false;
}

/**
 * Get display label for a category
 */
export function getCategoryLabel(category: DocumentCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * Get display label for a sub-category
 */
export function getSubCategoryLabel(subCategory: DocumentSubCategory): string {
  return SUBCATEGORY_LABELS[subCategory] ?? subCategory;
}

/**
 * Get all categories as options for a select dropdown
 */
export function getCategoryOptions(): Array<{ value: DocumentCategory; label: string; description: string }> {
  return Object.values(DocumentCategory).map((category) => ({
    value: category,
    label: CATEGORY_LABELS[category],
    description: CATEGORY_DESCRIPTIONS[category],
  }));
}

/**
 * Get sub-category options for a given category (for filtered dropdown)
 */
export function getSubCategoryOptions(
  category: DocumentCategory
): Array<{ value: DocumentSubCategory; label: string }> {
  const subCategories = getSubCategoriesForCategory(category);
  return subCategories.map((subCategory) => ({
    value: subCategory,
    label: SUBCATEGORY_LABELS[subCategory],
  }));
}

/**
 * Get the default sub-category for a category (first in the list)
 */
export function getDefaultSubCategory(category: DocumentCategory): DocumentSubCategory | null {
  const subCategories = CATEGORY_SUBCATEGORY_MAP[category];
  return subCategories?.[0] ?? null;
}

/**
 * Get the catch-all "Others" sub-category for a category, if one exists.
 */
export function getCatchAllSubCategory(category: DocumentCategory): DocumentSubCategory | null {
  switch (category) {
    case DocumentCategory.ACCOUNTS_PAYABLE:
      return DocumentSubCategory.OTHERS_ACCOUNTS_PAYABLE;
    case DocumentCategory.ACCOUNTS_RECEIVABLE:
      return DocumentSubCategory.OTHERS_ACCOUNTS_RECEIVABLE;
    case DocumentCategory.TREASURY:
      return DocumentSubCategory.OTHERS_TREASURY;
    case DocumentCategory.TAX_COMPLIANCE:
      return DocumentSubCategory.OTHERS_TAX_COMPLIANCE;
    case DocumentCategory.PAYROLL:
      return DocumentSubCategory.OTHERS_PAYROLL;
    case DocumentCategory.CORPORATE_SECRETARIAL:
      return DocumentSubCategory.OTHERS_CORPORATE_SECRETARIAL;
    case DocumentCategory.CONTRACTS:
      return DocumentSubCategory.OTHERS_CONTRACTS;
    case DocumentCategory.FINANCIAL_REPORTS:
      return DocumentSubCategory.OTHERS_FINANCIAL_REPORTS;
    case DocumentCategory.INSURANCE:
      return DocumentSubCategory.OTHERS_INSURANCE;
    case DocumentCategory.CORRESPONDENCE:
      return DocumentSubCategory.OTHERS_CORRESPONDENCE;
    case DocumentCategory.OTHER:
      return null;
    default:
      return null;
  }
}

// =============================================================================
// MIGRATION HELPERS (for migrating from old categories)
// =============================================================================

/**
 * Legacy category enum values (for migration purposes)
 */
type LegacyDocumentCategory =
  | 'INVOICE'
  | 'RECEIPT'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'
  | 'PURCHASE_ORDER'
  | 'STATEMENT'
  | 'OTHER';

/**
 * Map old category values to new category + sub-category
 */
export const LEGACY_CATEGORY_MIGRATION: Record<
  LegacyDocumentCategory,
  { category: DocumentCategory; subCategory: DocumentSubCategory }
> = {
  INVOICE: {
    category: DocumentCategory.ACCOUNTS_PAYABLE,
    subCategory: DocumentSubCategory.VENDOR_INVOICE,
  },
  RECEIPT: {
    category: DocumentCategory.TREASURY,
    subCategory: DocumentSubCategory.RECEIPT_VOUCHER,
  },
  CREDIT_NOTE: {
    category: DocumentCategory.ACCOUNTS_PAYABLE,
    subCategory: DocumentSubCategory.VENDOR_CREDIT_NOTE,
  },
  DEBIT_NOTE: {
    category: DocumentCategory.ACCOUNTS_PAYABLE,
    subCategory: DocumentSubCategory.VENDOR_INVOICE,
  },
  PURCHASE_ORDER: {
    category: DocumentCategory.ACCOUNTS_PAYABLE,
    subCategory: DocumentSubCategory.PURCHASE_ORDER,
  },
  STATEMENT: {
    category: DocumentCategory.TREASURY,
    subCategory: DocumentSubCategory.BANK_STATEMENT,
  },
  OTHER: {
    category: DocumentCategory.OTHER,
    subCategory: DocumentSubCategory.MISCELLANEOUS,
  },
};

/**
 * Migrate a legacy category to new category + sub-category
 */
export function migrateLegacyCategory(legacyCategory: string): {
  category: DocumentCategory;
  subCategory: DocumentSubCategory;
} | null {
  const migration = LEGACY_CATEGORY_MIGRATION[legacyCategory as LegacyDocumentCategory];
  return migration ?? null;
}
