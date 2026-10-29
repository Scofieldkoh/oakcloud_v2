# AI Debug Log

> **Last Updated**: 2025-01-12
> **Audience**: Developers

This file contains debug logs for AI extraction calls when `AI_DEBUG=true`.

## Related Documents

- [Document Vault / Extraction](../features/document-processing/EXTRACTION.md) - AI extraction details
- [Environment Variables](../reference/ENVIRONMENT_VARIABLES.md) - Configuration options

## How to Enable Debug Logging

Set the following environment variable in your `.env` file:

```bash
AI_DEBUG=true
```

When enabled, the system automatically appends detailed AI call logs to **this file** (`docs/AI_DEBUG.md`).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_DEBUG` | `false` | Enable AI debug logging to this file |
| `AI_DEBUG_LOG_PROMPTS` | `true` | Include full prompts in logs |
| `AI_DEBUG_LOG_RESPONSES` | `true` | Include full AI responses in logs |
| `AI_DEBUG_LOG_IMAGES` | `false` | Include image metadata in logs |

## Log Format

Each AI call logs:
1. **Request Details** - Model, provider, operation, tenant, temperature, COA context
2. **Prompt** - Full extraction prompt (collapsible)
3. **Response** - Status, latency, token counts, estimated cost, raw response (collapsible)
4. **Extraction Results** - Document fields and line item account codes

## Troubleshooting Account Code Assignment

### Common Issues

1. **No account code assigned** (`❌ NOT ASSIGNED`)
   - Check if COA context was included (look for `COA Context: Yes`)
   - Verify tenant has chart of accounts configured in 4xxx-8xxx range
   - Review the prompt to ensure accounts are listed

2. **Wrong account code assigned**
   - Check the AI response for the `accountCode` field
   - Review the description and compare to available accounts
   - Consider adding more specific accounts to COA

3. **Low confidence scores** (< 0.7)
   - AI is uncertain about the mapping
   - Review the line item description for clarity
   - Consider manual assignment for edge cases

### Expected Account Code Ranges

- **4xxx**: Revenue accounts (sales, service income)
- **5xxx**: Cost of goods sold (direct costs, purchases)
- **6xxx-7xxx**: Operating expenses (admin, marketing, utilities)
- **8xxx**: Tax expenses (income tax, deferred tax)

## Clearing Logs

To clear this log file, you can:
1. Delete everything below the `---` line manually
2. Or use the `clearDebugLog()` function programmatically

---
## AI Request - 2026-06-29T09:22:12.588Z

### Request Details
| Field | Value |
|-------|-------|
| Operation | document_counterparty_hint |
| Model | openai/gpt-5.4-mini |
| Provider | openrouter |
| Tenant | b117cdc7-bdbb-4597-9a79-af14faf67dc4 |
| User | 1ff281ab-4946-434e-8318-f357dee1661a |
| Temperature | 0 |
| JSON Mode | true |
| Images | 1 |
| COA Context | No |

<details>
<summary>Prompt (1997 chars)</summary>

```
Extract only the counterparty names from the first page of this business document.
Return JSON with exactly 2 keys: vendorName and customerName.
Return AT MOST ONE non-null field whenever possible.
vendorName = the external supplier, seller, issuer, charging party, or service provider organization shown on the document.
customerName = the buyer, bill-to, ship-to, applicant, account holder, or customer organization shown on the document.
Prefer the corporate or legal entity name over any contact person name.
If the same organization appears in abbreviated and expanded form, prefer the expanded legal or corporate name shown on the document.
Only return the actual accounting counterparty. Ignore product names, plans, packages, subscriptions, service modules, business-profile subjects, searched entities, regulated entities, and reference companies unless they are clearly the buyer or seller on the document.
If another company is mentioned only as the company profile purchased, searched company, subject company, or service target, do not return it as customerName.
Use null when a field is not clearly visible.
Do not infer, explain, or add extra keys.

Current processing company context:
- Official company name: Oaktree Accounting & Corporate Solutions Pte. Ltd.
- UEN: 202437906H
Use this context to disambiguate roles on the document:
- If a visible organization matches the current company context, treat that as the in-scope company mention.
- Do not mistake the in-scope company for the external issuer/supplier unless the document clearly shows the in-scope company is the seller or issuer.
- If the in-scope company appears only as a searched entity, subject company, business-profile target, service target, regulated entity, or reference company, do not return it as customerName.
- For vendor invoices and receipts issued to the in-scope company, prefer vendorName only.
- For sales invoices issued by the in-scope company to an external customer, prefer customerName only.
```
</details>

### Response
| Field | Value |
|-------|-------|
| Status | ✅ Success |
| Latency | 3562ms |
| Input Tokens | 1611 |
| Output Tokens | 24 |
| Total Tokens | 1635 |
| Estimated Cost | $0.0000 |
| Connector Source | system |
| Connector ID | 4f41587f-2d00-4ea5-b513-1fdde4047d3d |
| Connector Name | Openrouter |

---

## AI Request - 2026-06-29T09:22:16.904Z

### Request Details
| Field | Value |
|-------|-------|
| Operation | document_extraction |
| Model | openai/gpt-5.4-mini |
| Provider | openrouter |
| Tenant | b117cdc7-bdbb-4597-9a79-af14faf67dc4 |
| User | 1ff281ab-4946-434e-8318-f357dee1661a |
| Temperature | 0.1 |
| JSON Mode | true |
| Images | 1 |
| COA Context | No |

<details>
<summary>Prompt (23700 chars)</summary>

```
You are a document data extraction AI specializing in Singapore business documents. Analyze this document image and extract all relevant information with high accuracy.

## Response Schema (JSON)
{
  "documentCategory": {
    "value": "ACCOUNTS_PAYABLE" | "ACCOUNTS_RECEIVABLE" | "TREASURY" | "TAX_COMPLIANCE" | "PAYROLL" | "CORPORATE_SECRETARIAL" | "CONTRACTS" | "FINANCIAL_REPORTS" | "INSURANCE" | "CORRESPONDENCE" | "OTHER",
    "confidence": number between 0 and 1
  },
  "documentSubCategory": {
    "value": "(see sub-category list below)",
    "confidence": number between 0 and 1
  } | null,
  "vendorName": {
    "value": "string",
    "confidence": number
  } | null,
  "customerName": {
    "value": "string",
    "confidence": number
  } | null,
  "documentNumber": {
    "value": "string",
    "confidence": number
  } | null,
  "documentDate": {
    "value": "YYYY-MM-DD",
    "confidence": number
  } | null,
  "dueDate": {
    "value": "YYYY-MM-DD",
    "confidence": number
  } | null,
  "currency": {
    "value": "3-letter currency code (e.g., SGD, USD)",
    "confidence": number
  },
  "subtotal": {
    "value": "decimal number as string",
    "confidence": number
  } | null,
  "taxAmount": {
    "value": "decimal number as string",
    "confidence": number
  } | null,
  "totalAmount": {
    "value": "decimal number as string (required)",
    "confidence": number
  },
  "supplierGstNo": {
    "value": "string",
    "confidence": number
  } | null,
  "homeCurrencyEquivalent": {
    "currency": "3-letter code (e.g., SGD)",
    "exchangeRate": "decimal number as string",
    "subtotal": "decimal number as string" | null,
    "taxAmount": "decimal number as string" | null,
    "totalAmount": "decimal number as string",
    "confidence": number
  } | null,
  "lineItems": [
    {
      "lineNo": number,
      "description": { "value": "string", "confidence": number },
      "quantity": { "value": "decimal string", "confidence": number } | null,
      "unitPrice": { "value": "decimal string", "confidence": number } | null,
      "amount": { "value": "decimal string", "confidence": number },
      "gstAmount": { "value": "decimal string", "confidence": number } | null,
      "taxCode": { "value": "string (SR, ZR, ES, NA, TX, etc.)", "confidence": number },
      "accountCode": { "value": "string (e.g., 5000, 6000, 6100)", "confidence": number } | null
    }
  ],
  "overallConfidence": number between 0 and 1
}

## Counterparty Field Rules (IMPORTANT)
- For **ACCOUNTS_PAYABLE** documents, extract the supplier into "vendorName".
- For **ACCOUNTS_RECEIVABLE** documents, extract the buyer into "customerName".
- Do NOT put a person's name (e.g., "Raymond") unless the counterparty on the document is clearly an individual.

## Singapore GST Tax Codes (REQUIRED for each line item)
You MUST assign a taxCode to EVERY line item based on these rules:
- **SR (Standard-Rated 9%)**: Most goods and services in Singapore. ONLY use if supplier has GST registration number.
- **ZR (Zero-Rated 0%)**: Exports, international services, prescribed goods
- **ES (Exempt Supply)**: Financial services, residential property sales/rentals, precious metals
- **NA (Not Applicable)**: Use when supplier is NOT GST registered, or for non-business transactions, private expenses, government fees/fines
- **TX (Taxable Purchases)**: Standard input tax claimable purchases
- **BL (Blocked Input Tax)**: Club subscriptions, medical expenses, motor vehicle expenses

**CRITICAL - GST Registration Check:**
First, look for a GST Registration Number on the document. It typically appears as:
- "GST Reg No: M12345678X" or "GST No: 12345678X"
- Usually near the company name, address, or footer
- Format: 9-10 alphanumeric characters (e.g., M12345678X, 200012345M)

Determination logic:
1. **If NO GST registration number found** â†’ ALL line items should use **NA** (supplier is not GST registered, no GST claimable)
2. If GST registration found AND GST/tax amount is shown â†’ SR (9% GST)
3. If GST registration found but explicitly marked as "0% GST" or "Zero-rated" â†’ ZR
4. If GST registration found but no GST charged â†’ Could be ZR, ES, or exempt item
5. If foreign supplier/service â†’ ZR or NA depending on nature
6. When in doubt AND supplier is GST registered â†’ SR

## Amount Validation Rules (CRITICAL)
1. **Line Item Calculation**: For each line item, verify: quantity * unitPrice = amount (with small rounding tolerance)
2. **Subtotal Validation**: Sum of all line item amounts MUST equal subtotal
3. **Tax Calculation**: taxAmount should be approximately 9% of subtotal for SR items (or sum of line item gstAmounts)
4. **Total Validation**: subtotal + taxAmount MUST equal totalAmount

**IMPORTANT: For GST-INCLUSIVE documents (see GST-INCLUSIVE section below):**
- The "amount" field should contain the PRE-GST amount (calculated by dividing inclusive price by 1.09)
- Do NOT extract the GST-inclusive amount as the line item amount
- This ensures validation rules work correctly

If the document shows values that don't add up:
- Extract the values as shown on the document
- Lower your confidence score for affected fields
- The document's printed values take precedence over calculations

## Line Item GST Amount Calculation
For each line item with taxCode = "SR":
- gstAmount = amount * 0.09 (rounded to 2 decimal places)
- If the document shows a different GST amount per line, use the document's value

## GST-INCLUSIVE Pricing (CRITICAL - Common in Singapore)
Many Singapore documents show prices INCLUSIVE of GST. Look for these indicators:
- "GST inclusive", "GST included", "Inclusive of GST", "Price inclusive of GST"
- "Inc. GST", "incl. GST", "w/ GST", "Including 9% GST"
- "All prices are inclusive of GST", "Prices shown include GST"
- Total amount shown with "GST @ 9% Inclusive" or similar notation

**When amounts are GST-INCLUSIVE, you MUST calculate backwards to get the pre-GST amount:**
- For 9% GST: Pre-GST Amount = Inclusive Amount / 1.09
- For 8% GST: Pre-GST Amount = Inclusive Amount / 1.08

**Example (9% GST):**
- Document shows line item: $205.69 (GST inclusive)
- Pre-GST amount (what to extract): $205.69 / 1.09 = $188.71
- GST amount: $205.69 - $188.71 = $16.98 (or $188.71 * 0.09 = $16.98)
- Extract: amount = "188.71", gstAmount = "16.98"

**Validation for GST-inclusive documents:**
- amount (pre-GST) * 1.09 should approximately equal the displayed inclusive price
- Sum of all line item amounts = subtotal (pre-GST)
- subtotal + taxAmount = totalAmount (which may equal the GST-inclusive total shown)

**How to identify GST-inclusive vs GST-exclusive:**
1. Look for explicit labels: "incl GST", "excl GST", "before GST", "after GST"
2. Check if the math works: If line items sum to total without adding GST separately, it's likely inclusive
3. Look at the GST breakdown section - does it show "GST @ 9% Inclusive" or "Add: GST 9%"?
4. Singapore retail receipts and some invoices commonly use GST-inclusive pricing

## Negative Amounts (Credits/Refunds) - CRITICAL
Amounts shown in parentheses like ($17.50) or (17.50) represent NEGATIVE values:
- Extract as negative decimal: "($17.50)" â†’ "-17.50"
- Extract as negative decimal: "(17.50)" â†’ "-17.50"
- These are credits, refunds, discounts, or reversals
- When calculating subtotal: $25.00 + ($17.50) = $25.00 + (-$17.50) = $7.50
- The subtotal must be the algebraic SUM of all line items including negatives

## Document Categories and Sub-Categories
Select the most appropriate category and sub-category based on document content:

**ACCOUNTS_PAYABLE** (Vendor/Purchase Documents):
- VENDOR_INVOICE: Purchase invoices & debit notes from suppliers
- VENDOR_CREDIT_NOTE: Credit notes from suppliers
- PURCHASE_ORDER: Purchase orders issued
- DELIVERY_NOTE: Goods received notes, delivery receipts
- VENDOR_STATEMENT: Supplier statements of account
- VENDOR_QUOTATION: Quotations from suppliers
- OTHERS_ACCOUNTS_PAYABLE: Other accounts payable documents

**ACCOUNTS_RECEIVABLE** (Customer/Sales Documents):
- SALES_INVOICE: Invoices & debit notes to customers
- SALES_CREDIT_NOTE: Credit notes to customers
- SALES_ORDER: Sales orders & quotations
- DELIVERY_ORDER: Delivery orders issued
- CUSTOMER_STATEMENT: Customer statements of account
- OTHERS_ACCOUNTS_RECEIVABLE: Other accounts receivable documents

**TREASURY** (Banking & Cash Management):
- BANK_STATEMENT: Monthly/periodic bank statements
- BANK_ADVICE: Debit/credit advices, TT advices, FD advices
- PAYMENT_VOUCHER: Payment vouchers, cheques
- RECEIPT_VOUCHER: Receipt vouchers
- LOAN_DOCUMENT: Loan agreements, facility letters
- OTHERS_TREASURY: Other treasury documents

**TAX_COMPLIANCE** (Tax & Regulatory):
- GST_RETURN: GST F5/F7 returns & assessments
- INCOME_TAX: Form C/C-S, tax assessments, computations
- OTHERS_TAX_COMPLIANCE: Other tax & regulatory documents

**PAYROLL** (HR & Payroll):
- PAYSLIP: Employee payslips
- CPF_SUBMISSION: CPF contribution records
- IR8A: Annual IR8A/IR8S forms
- EXPENSE_CLAIM: Employee expense claims, timesheets
- OTHERS_PAYROLL: Other payroll documents

**CORPORATE_SECRETARIAL** (Corporate Governance):
- BIZFILE: ACRA BizFile extracts
- RESOLUTION: Board/shareholder resolutions
- REGISTER: Statutory registers (members, directors, charges)
- INCORPORATION: Constitution, incorporation cert, share certs
- ANNUAL_RETURN: Annual returns, statutory forms
- MEETING_MINUTES: AGM, EGM, board meeting minutes
- OTHERS_CORPORATE_SECRETARIAL: Other corporate secretarial documents

**CONTRACTS** (Legal Agreements):
- VENDOR_CONTRACT: Supplier/service provider agreements, NDAs
- CUSTOMER_CONTRACT: Customer/client agreements
- EMPLOYMENT_CONTRACT: Employment agreements
- LEASE_AGREEMENT: Property/equipment leases, licenses
- OTHERS_CONTRACTS: Other contracts and legal agreements

**FINANCIAL_REPORTS** (Reporting & Analysis):
- FINANCIAL_STATEMENT: Balance sheet, P&L, cash flow
- MANAGEMENT_REPORT: Trial balance, GL reports, management accounts
- AUDIT_REPORT: Auditor's report, supporting schedules
- OTHERS_FINANCIAL_REPORTS: Other financial reports

**INSURANCE** (Risk Management):
- INSURANCE_POLICY: Policies, certificates, renewals
- INSURANCE_CLAIM: Claim documents
- OTHERS_INSURANCE: Other insurance documents

**CORRESPONDENCE** (General Communications):
- LETTER: Business letters, memos, notices
- EMAIL: Email correspondence
- OTHERS_CORRESPONDENCE: Other correspondence

**OTHER** (Uncategorized):
- MISCELLANEOUS: Documents that don't fit other categories
- SUPPORTING_DOCUMENT: Supporting/backup documents

## Home Currency Equivalent (IMPORTANT for Singapore Tax)
Many foreign currency invoices show SGD equivalent amounts for Singapore GST purposes.
Look for sections labeled:
- "Tax information", "For GST purposes", "Singapore Tax Information"
- "Total Charges (excluding GST)" in SGD
- "Total GST" in SGD
- "Total charges (including GST)" in SGD
- Exchange rate or conversion rate shown on document

If you find SGD equivalents on a foreign currency invoice:
- Extract them in "homeCurrencyEquivalent" object
- The document's printed exchange rate takes precedence over any calculated rate
- These amounts should be used for Singapore GST reporting

Example: A USD invoice showing "Total charges (including GST): 507.97 SGD"
{
  "homeCurrencyEquivalent": {
    "currency": "SGD",
    "exchangeRate": "1.2940",
    "subtotal": "465.48",
    "taxAmount": "41.89",
    "totalAmount": "507.97",
    "confidence": 0.95
  }
}

## Important Rules
- All monetary values should be decimal numbers as strings (e.g., "1234.56" or "-17.50" for negatives)
- Amounts in parentheses are NEGATIVE - convert (X) to -X
- Dates should be in YYYY-MM-DD format
- If a field is not visible or cannot be determined, use null
- The totalAmount field is required - estimate if necessary
- taxCode is REQUIRED for every line item - never leave it null
- Be precise with numbers - extract exactly as shown, don't round
- When extracting from Singapore invoices, assume SGD unless otherwise specified
- Always select both documentCategory AND documentSubCategory when possible
- If a document clearly belongs to a category but does not fit any listed specific sub-category, use that category's OTHERS_* sub-category
- ALWAYS look for and extract home currency equivalents on foreign currency invoices

## Line Item Completeness (CRITICAL)
- For invoices, purchase orders, sales orders, delivery orders, and other structured item tables, extract EVERY visible business row as its own line item
- There is NO 30-line limit and NO 20-line limit
- Continue through all pages and continuation tables until all line items are captured
- If a row wraps across multiple text lines, keep it as one line item
- The extracted lineItems count should match the visible item-row count whenever possible
- Only aggregate line items for simple receipts/claims as described below

## Line Item Aggregation (IMPORTANT for Receipts & Claims)
For certain document types, DO NOT extract every individual item as a separate line item.
Instead, aggregate items into meaningful categories for accounting purposes.

### CRITICAL: Always Consolidate Minor Adjustments
The following should NEVER appear as separate line items - always include them in the main line item amount:
- **Service Charge** - add to the main line item (e.g., F&B total should include service charge)
- **Rounding Adjustments** - include in the nearest appropriate line item
- **Discounts** - deduct from the relevant line item, don't show as negative line
- **Minor fees** (tray return charge, takeaway fee, etc.) - include in main line item
- **Tips/Gratuity** - include in the service line item unless separately invoiced

**Rationale**: These minor adjustments provide no accounting value when separated. For expense claims and receipts, what matters is the total spent per category, not the breakdown of charges vs adjustments.

### When to Aggregate:

**1. Restaurant/Dining Receipts**
- Create a SINGLE line item: "Food & Beverage" or "Meals"
- This amount should include: food, drinks, service charge, rounding, minor fees
- The line item amount = subtotal before GST (including service charge and adjustments)
- DO NOT list each food/drink item separately
- DO NOT create separate lines for service charge, rounding, or discounts

**2. Cafe/Coffee Shop Receipts**
- Create a SINGLE line: "Refreshments" or "Team Refreshments"
- Include all drinks, snacks, and any service/adjustment fees
- DO NOT list individual coffees, pastries, or fees separately

**3. Entertainment/Events**
- Create minimal lines by major category only: "Event Admission", "F&B", "Merchandise"
- Include booking fees, service fees, convenience fees in the main category
- DO NOT create separate lines for fees and adjustments

**4. Supermarket/Grocery Receipts**
- For office/pantry purchases: SINGLE line as "Office Pantry" or "Office Supplies"
- Include bag charges, rounding in the total
- For inventory: AGGREGATE by product category unless specifically for resale

**5. Hotel/Accommodation**
- Maximum 2-3 lines for major expense types:
  - "Room Charges" (all room nights + resort fees + service charges)
  - "Food & Beverage" (all F&B + service charges)
  - "Other Services" (laundry, internet, parking combined if applicable)
- DO NOT create separate lines for service charges, tourism taxes, or adjustments

**6. Transport/Parking**
- SINGLE line: "Parking" or "Transport"
- Include all fees, surcharges, admin fees in the total
- DO NOT separate booking fees, platform fees, etc.

**7. Petty Cash Claims/Expense Reports**
- Group by expense nature: "Office Supplies", "Transport", "Meals"
- Each category should be a single line with total amount

### When NOT to Aggregate (keep individual items):
- Official invoices for products/services purchased for resale
- Capital expenditure items (equipment, assets)
- Items that need individual tracking for warranty/support
- Professional services invoices with distinct billable services
- Inventory purchases for resale where item-level tracking is needed

### Aggregation Guidelines:
- **Minimize line items**: For receipts/claims, aim for 1-3 lines maximum
- Use clear, professional descriptions (e.g., "Food & Beverage", not "Various food items")
- The aggregated amount MUST equal the subtotal before GST (including all adjustments)
- GST should be calculated on the final aggregated subtotal
- Set quantity to 1 for aggregated items
- Set unitPrice equal to the aggregated amount
- **Never create lines for amounts under $5 that are adjustments/fees** - always consolidate them

## Available Chart of Accounts (for accountCode assignment)
IMPORTANT: You SHOULD attempt to assign an accountCode to every line item based on the description.
Even if uncertain, make your best guess - the user can correct it later.

- 4100: Sales revenue (REVENUE)
- 4110: Product sales (REVENUE)
- 4120: Sales discounts (REVENUE)
- 4130: Sales returns (REVENUE)
- 4200: Service revenue (REVENUE)
- 4210: Consulting income (REVENUE)
- 4220: Commission income (REVENUE)
- 4230: Management fee income (REVENUE)
- 4300: Interest income (REVENUE)
- 4400: Other income (REVENUE)
- 4410: Dividend income (REVENUE)
- 4420: Rental income (REVENUE)
- 4430: Foreign exchange gain (REVENUE)
- 4440: Gain on disposal of assets (REVENUE)
- 4450: Government grants (REVENUE)
- 5100: Direct labour (EXPENSE)
- 5200: Direct materials (EXPENSE)
- 5210: Purchases (EXPENSE)
- 5220: Purchase discounts (EXPENSE)
- 5230: Purchase returns (EXPENSE)
- 5240: Freight inwards (EXPENSE)
- 5300: Manufacturing overhead (EXPENSE)
- 5400: Direct software costs (EXPENSE)
- 5500: Subcontractor costs (EXPENSE)
- 5600: Other direct costs (EXPENSE)
- 6100: Advertising & marketing (EXPENSE)
- 6110: Website & online marketing (EXPENSE)
- 6120: Promotional materials (EXPENSE)
- 6200: Bank charges (EXPENSE)
- 6210: Merchant fees (EXPENSE)
- 6300: Depreciation expense (EXPENSE)
- 6310: Amortisation expense (EXPENSE)
- 6400: Insurance (EXPENSE)
- 6410: General insurance (EXPENSE)
- 6420: Professional indemnity insurance (EXPENSE)
- 6430: Workman compensation insurance (EXPENSE)
- 6500: Office supplies (EXPENSE)
- 6510: Stationery & printing (EXPENSE)
- 6520: Postage & courier (EXPENSE)
- 6600: Professional fees (EXPENSE)
- 6610: Accounting fees (EXPENSE)
- 6620: Audit fees (EXPENSE)
- 6630: Legal fees (EXPENSE)
- 6640: Consulting fees (EXPENSE)
- 6650: Corporate secretarial fees (EXPENSE)
- 6660: Tax advisory fees (EXPENSE)
- 6700: Rent expense (EXPENSE)
- 6710: Office rent (EXPENSE)
- 6720: Equipment rental (EXPENSE)
- 6800: Repairs & maintenance (EXPENSE)
- 6810: Building maintenance (EXPENSE)
- 6820: Equipment maintenance (EXPENSE)
- 6830: IT maintenance (EXPENSE)
- 6900: Telephone & internet (EXPENSE)
- 6910: Mobile phone expenses (EXPENSE)
- 6920: Software subscriptions (EXPENSE)
- 7000: Travel & entertainment (EXPENSE)
- 7010: Local transport (EXPENSE)
- 7020: Overseas travel (EXPENSE)
- 7030: Staff meals & entertainment (EXPENSE)
- 7040: Client entertainment (EXPENSE)
- 7100: Utilities (EXPENSE)
- 7110: Electricity (EXPENSE)
- 7120: Water (EXPENSE)
- 7200: Salaries & wages (EXPENSE)
- 7210: Director fees (EXPENSE)
- 7220: Staff salaries (EXPENSE)
- 7230: Bonus (EXPENSE)
- 7240: Overtime (EXPENSE)
- 7250: Commission expense (EXPENSE)
- 7300: CPF contributions (EXPENSE)
- 7310: Skills development levy (EXPENSE)
- 7320: Foreign worker levy (EXPENSE)
- 7400: Training & development (EXPENSE)
- 7410: Staff welfare (EXPENSE)
- 7420: Medical expenses (EXPENSE)
- 7430: Staff insurance (EXPENSE)
- 7440: Recruitment expenses (EXPENSE)
- 7500: Foreign exchange loss (EXPENSE)
- 7600: Bad debts (EXPENSE)
- 7610: Provision for doubtful debts (EXPENSE)
- 7700: Interest expense (EXPENSE)
- 7710: Loan interest (EXPENSE)
- 7720: Finance lease interest (EXPENSE)
- 7800: Government fees & licenses (EXPENSE)
- 7801: Administrative fees (EXPENSE)
- 7810: Business registration fees (EXPENSE)
- 7820: Permit & license fees (EXPENSE)
- 7830: Property tax (EXPENSE)
- 7900: Other expenses (EXPENSE)
- 7910: Donations (EXPENSE)
- 7920: Fines & penalties (EXPENSE)
- 7930: Loss on disposal of assets (EXPENSE)
- 7940: Miscellaneous expenses (EXPENSE)
- 8100: Income tax expense (EXPENSE)
- 8200: Deferred tax expense (EXPENSE)

Guidelines for account selection:
- 4xxx: Revenue accounts (use for sales, service income, other income)
- 5xxx: Cost of goods sold (use for direct costs, purchases, manufacturing)
- 6xxx-7xxx: Operating expenses (use for admin, marketing, utilities, rent, professional fees, software, subscriptions, cloud services, etc.)
- 8xxx: Tax expenses (use for income tax, deferred tax)

Common mappings for vendor invoices (Accounts Payable):
- Software/SaaS subscriptions (e.g., Wix, Adobe, Microsoft) â†’ 6xxx (IT/Software expenses)
- Professional services (legal, accounting, consulting) â†’ 6xxx (Professional fees)
- Office supplies, utilities â†’ 6xxx (Administrative expenses)
- Inventory purchases â†’ 5xxx (Cost of goods sold)
- Advertising, marketing â†’ 6xxx (Marketing expenses)

Set lower confidence (0.5-0.7) if the account mapping is a best guess rather than obvious.

## Additional Context
## Learned Counterparty Context
Lightweight pass selected vendorName="Accounting and Corporate Regulatory Authority".
Normalized counterparty="ACRA" using ALIAS matching (confidence 1.00).
Database match mode=CONTACT_ID using 3 recent approved current records.
Use these records only as consistency hints for naming, sub-category tendencies, line descriptions, taxCode, and accountCode assignment.
Do not copy document numbers, dates, quantities, or amounts unless they are visible on the current document.
Record 1: category=ACCOUNTS_PAYABLE; subCategory=VENDOR_INVOICE; documentNumber=ACRA260610003610; documentDate=2026-06-10; currency=SGD; subtotal=300; taxAmount=0; totalAmount=300; supplierGstNo=M9-0008879-T; vendorName=ACRA; customerName=-; approvedAt=2026-06-14
- lineNo=1; description=Incorporate new local company - ELIXIR EDGE EDUCATION PTE. LTD.; quantity=1; unitPrice=300; amount=300; gstAmount=0; taxCode=NA; accountCode=7810
Record 2: category=ACCOUNTS_PAYABLE; subCategory=VENDOR_INVOICE; documentNumber=ACRA260610003070; documentDate=2026-06-10; currency=SGD; subtotal=13.76; taxAmount=1.24; totalAmount=15; supplierGstNo=M9-0008879-T; vendorName=ACRA; customerName=-; approvedAt=2026-06-14
- lineNo=1; description=Apply for new business entity name - ELIXIR EDGE EDUCATION PTE. LTD.; quantity=1; unitPrice=13.76; amount=13.76; gstAmount=1.24; taxCode=SR; accountCode=7801
Record 3: category=ACCOUNTS_PAYABLE; subCategory=VENDOR_INVOICE; documentNumber=ACRA260610005824; documentDate=2026-06-10; currency=SGD; subtotal=60; taxAmount=0; totalAmount=60; supplierGstNo=M9-0008879-T; vendorName=ACRA; customerName=-; approvedAt=2026-06-14
- lineNo=1; description=File annual returns - SHINY HAPPY PEOPLE (199607830N); quantity=1; unitPrice=60; amount=60; gstAmount=0; taxCode=NA; accountCode=7801

Uploading Company: Oaktree Accounting & Corporate Solutions Pte. Ltd.
Business Nature: Other Financial Service Activities, Except Insurance and Pension Funding Activities N.e.c.
Home Currency: SGD

IMPORTANT BUSINESS CONTEXT:
- "Oaktree Accounting & Corporate Solutions Pte. Ltd." is uploading this document for processing
- For ACCOUNTS_PAYABLE (vendor invoices/bills): "Oaktree Accounting & Corporate Solutions Pte. Ltd." is the BUYER/RECIPIENT - the vendor/supplier name must be a DIFFERENT company
- For ACCOUNTS_RECEIVABLE (sales invoices): "Oaktree Accounting & Corporate Solutions Pte. Ltd." is the SELLER/ISSUER - extract the customer name as the other party
```
</details>

### Response
| Field | Value |
|-------|-------|
| Status | ✅ Success |
| Latency | 5155ms |
| Input Tokens | 7378 |
| Output Tokens | 511 |
| Total Tokens | 7889 |
| Estimated Cost | $0.0000 |
| Connector Source | system |
| Connector ID | 4f41587f-2d00-4ea5-b513-1fdde4047d3d |
| Connector Name | Openrouter |

---

## Extraction Results - 2026-06-29T09:22:22.068Z

### Document Fields
| Field | Value | Confidence |
|-------|-------|------------|
| Document Category | ACCOUNTS_PAYABLE | 0.99 |
| Vendor | Accounting and Corporate Regulatory Authority | 0.99 |
| Total Amount | 5.50 SGD | 0.99 |

### Line Item Account Codes
| Line | Account Code | Confidence | Description |
|------|--------------|------------|-------------|
| 1 | 7801 | 0.75 | Business Profile (Co) |

---
