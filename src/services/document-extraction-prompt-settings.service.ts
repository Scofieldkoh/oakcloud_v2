import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';

export interface DocumentExtractionQuickContext {
  id: string;
  label: string;
  value: string;
}

export interface DocumentExtractionPromptSettings {
  promptTemplate: string;
  quickContexts: DocumentExtractionQuickContext[];
}

export interface DocumentExtractionPromptVariables {
  additionalContext?: string;
  chartOfAccounts?: string;
  companyContext?: string;
  currentDate?: string;
  currentDateTime?: string;
  recentTransactions?: string;
  timeZone?: string;
}

const DOCUMENT_EXTRACTION_PROMPT_SETTINGS_KEY = 'documentExtractionPrompt';
const MAX_PROMPT_LENGTH = 30000;
const MAX_QUICK_CONTEXTS = 12;
const MAX_QUICK_CONTEXT_LABEL_LENGTH = 40;
const MAX_QUICK_CONTEXT_VALUE_LENGTH = 1000;

export const DOCUMENT_EXTRACTION_PROMPT_VARIABLES = [
  {
    key: '[AdditionalContext]',
    label: 'Additional context entered or inserted by the user',
  },
  {
    key: '[ChartOfAccounts]',
    label: 'Chart of accounts available for account code suggestions',
  },
  {
    key: '[CompanyContext]',
    label: 'Selected company business context',
  },
  {
    key: '[CurrentDate]',
    label: 'Current date in ISO format',
  },
  {
    key: '[CurrentDateTime]',
    label: 'Current date and time',
  },
  {
    key: '[Details]',
    label: 'Alias for recent transaction details',
  },
  {
    key: '[RecentTransactions]',
    label: 'Recent approved transactions for the detected counterparty',
  },
  {
    key: '[Timezone]',
    label: 'Workspace/server timezone',
  },
] as const;

export const DEFAULT_DOCUMENT_EXTRACTION_QUICK_CONTEXTS: DocumentExtractionQuickContext[] = [
  {
    id: 'datetime',
    label: 'Current Date & Time',
    value: 'Current date and time: [CurrentDateTime]',
  },
  {
    id: 'date',
    label: 'Current Date',
    value: 'Current date: [CurrentDate]',
  },
  {
    id: 'timezone',
    label: 'Timezone Info',
    value: 'Timezone: [Timezone]',
  },
];

export const DEFAULT_DOCUMENT_EXTRACTION_PROMPT_TEMPLATE = `You are an expert accounting document extraction AI for Singapore businesses.

Extract structured data from the uploaded business document and return ONLY valid JSON matching the requested schema.

## Available Context
[CompanyContext]

[RecentTransactions]

[ChartOfAccounts]

## Additional Context
[AdditionalContext]

## Required Output
Return a JSON object with these fields:
- documentCategory
- documentSubCategory
- vendorName
- customerName
- counterpartyIdentificationType
- counterpartyIdentificationNumber
- counterpartyAddress
- counterpartyEmail
- counterpartyPhone
- documentNumber
- documentDate
- dueDate
- currency
- subtotal
- taxAmount
- totalAmount
- supplierGstNo
- homeCurrencyEquivalent
- lineItems
- overallConfidence

Each extracted field should include a value and confidence where the extraction schema supports it.

## Counterparty Field Rules
- For ACCOUNTS_PAYABLE documents, extract the supplier into vendorName.
- For ACCOUNTS_RECEIVABLE documents, extract the buyer into customerName.
- Do not put the uploading company as vendorName for payable documents or customerName for receivable documents.
- Do not put a person's name unless the counterparty on the document is clearly an individual.
- Prioritize the external counterparty's UEN or other registration identifier, then preserve every visible address, email, and phone value with confidence.
- Use UEN for Singapore entity registration numbers and OTHER for other organization registration identifiers.

## Singapore GST Tax Codes
Assign a taxCode to every line item:
- SR: Standard-rated GST, generally only when supplier GST registration is visible.
- ZR: Zero-rated supplies.
- ES: Exempt supplies.
- NA: Not applicable, including suppliers with no GST registration number.
- TX: Taxable purchases.
- BL: Blocked input tax.

First look for a GST registration number. If none is visible, use NA for line items unless the document clearly provides a stronger basis.

## Amount Rules
- Monetary values must be decimal strings.
- Dates must be YYYY-MM-DD.
- Amounts in parentheses are negative.
- Extract printed values as shown when document arithmetic does not add up, and reduce confidence.
- For GST-inclusive prices, calculate pre-GST line item amount and GST amount when needed.
- Extract home currency equivalents when a foreign currency invoice shows Singapore GST reporting amounts.

## Line Item Rules
- For invoices, purchase orders, delivery orders, sales orders, and itemized business documents, extract every visible business row.
- For receipts, expense claims, restaurant receipts, transport, parking, hotels, and petty cash, aggregate minor lines into meaningful accounting categories.
- Do not create separate line items for service charges, rounding, discounts, tips, tray return fees, or other minor adjustments unless separately invoiced as meaningful business charges.
- The extracted lineItems count should match the visible item-row count whenever the document is an itemized invoice or order.

## Document Categories and Sub-Categories
Select the most appropriate category and sub-category from the application taxonomy:
- ACCOUNTS_PAYABLE: vendor invoices, vendor credit notes, purchase orders, delivery notes, vendor statements, vendor quotations, other payables.
- ACCOUNTS_RECEIVABLE: sales invoices, sales credit notes, sales orders, delivery orders issued, customer statements, other receivables.
- TREASURY: bank statements, bank advices, payment vouchers, receipt vouchers, loan documents, other treasury.
- TAX_COMPLIANCE: GST returns, income tax, other tax documents.
- PAYROLL: payslips, CPF submissions, IR8A, expense claims, other payroll.
- CORPORATE_SECRETARIAL: BizFile, resolutions, statutory registers, incorporation documents, annual returns, meeting minutes, other corporate secretarial.
- CONTRACTS: vendor, customer, employment, lease, and other contracts.
- FINANCIAL_REPORTS: financial statements, management reports, audit reports, other financial reports.
- INSURANCE: policies, claims, other insurance.
- CORRESPONDENCE: letters, emails, other correspondence.
- OTHER: miscellaneous or supporting documents.

If a document clearly belongs to a category but does not fit a specific sub-category, use that category's OTHERS_* sub-category.`;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizePromptTemplate(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_DOCUMENT_EXTRACTION_PROMPT_TEMPLATE;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_DOCUMENT_EXTRACTION_PROMPT_TEMPLATE;
  return trimmed.slice(0, MAX_PROMPT_LENGTH);
}

function normalizeQuickContexts(value: unknown): DocumentExtractionQuickContext[] {
  if (!Array.isArray(value)) return DEFAULT_DOCUMENT_EXTRACTION_QUICK_CONTEXTS;

  const seen = new Set<string>();
  const normalized: DocumentExtractionQuickContext[] = [];

  for (const item of value) {
    const record = asRecord(item);
    const id = typeof record?.id === 'string' ? record.id.trim() : '';
    const label = typeof record?.label === 'string' ? record.label.trim() : '';
    const text = typeof record?.value === 'string' ? record.value.trim() : '';

    if (!id || !label || !text || seen.has(id)) continue;

    seen.add(id);
    normalized.push({
      id: id.slice(0, 80),
      label: label.slice(0, MAX_QUICK_CONTEXT_LABEL_LENGTH),
      value: text.slice(0, MAX_QUICK_CONTEXT_VALUE_LENGTH),
    });

    if (normalized.length >= MAX_QUICK_CONTEXTS) break;
  }

  return normalized.length > 0 ? normalized : DEFAULT_DOCUMENT_EXTRACTION_QUICK_CONTEXTS;
}

export function getDocumentExtractionPromptSettingsFromWorkspace(
  workspaceSettings: unknown
): DocumentExtractionPromptSettings {
  const root = asRecord(workspaceSettings);
  const saved = asRecord(root?.[DOCUMENT_EXTRACTION_PROMPT_SETTINGS_KEY]);

  return {
    promptTemplate: normalizePromptTemplate(saved?.promptTemplate),
    quickContexts: normalizeQuickContexts(saved?.quickContexts),
  };
}

export async function getDocumentExtractionPromptSettings(
  tenantId: string
): Promise<DocumentExtractionPromptSettings> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: tenantId, deletedAt: null },
    select: { settings: true },
  });

  return getDocumentExtractionPromptSettingsFromWorkspace(workspace?.settings);
}

export async function updateDocumentExtractionPromptSettings(
  tenantId: string,
  settings: Partial<DocumentExtractionPromptSettings>
): Promise<DocumentExtractionPromptSettings> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: tenantId, deletedAt: null },
    select: { settings: true },
  });

  const currentRoot = asRecord(workspace?.settings) ?? {};
  const current = getDocumentExtractionPromptSettingsFromWorkspace(currentRoot);
  const next: DocumentExtractionPromptSettings = {
    promptTemplate: normalizePromptTemplate(settings.promptTemplate ?? current.promptTemplate),
    quickContexts: normalizeQuickContexts(settings.quickContexts ?? current.quickContexts),
  };

  await prisma.workspace.update({
    where: { id: tenantId },
    data: {
      settings: {
        ...currentRoot,
        [DOCUMENT_EXTRACTION_PROMPT_SETTINGS_KEY]: next,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return next;
}

export function resolveDocumentExtractionPrompt(
  promptTemplate: string,
  variables: DocumentExtractionPromptVariables
): string {
  const now = new Date();
  const currentDate = variables.currentDate ?? now.toISOString().slice(0, 10);
  const currentDateTime = variables.currentDateTime ?? now.toISOString();
  const timeZone = variables.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const recentTransactions = variables.recentTransactions ?? '';

  const replacements: Record<string, string> = {
    '[AdditionalContext]': variables.additionalContext ?? '',
    '[ChartOfAccounts]': variables.chartOfAccounts ?? '',
    '[CompanyContext]': variables.companyContext ?? '',
    '[CurrentDate]': currentDate,
    '[CurrentDateTime]': currentDateTime,
    '[Details]': recentTransactions,
    '[RecentTransactions]': recentTransactions,
    '[Timezone]': timeZone,
  };

  return Object.entries(replacements).reduce(
    (prompt, [key, value]) => prompt.split(key).join(value),
    promptTemplate
  );
}
