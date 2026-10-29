# Document Template Party Placeholders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Add explicit single-director, single-shareholder, and single-company-contact placeholders, contact fields, preparer name, and letter-format addresses to document generation.

**Architecture:** Introduce a pure document-party normalization module and a tenant-scoped party-selection service. Feed their canonical output into the existing shared template renderer, extend template analysis and the editor catalog, and make the generation wizard request only the singular selections referenced by the chosen template.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.7, Prisma 7, Zod 3, Vitest 4, Testing Library.

## Global Constraints

- Preserve existing director and shareholder loop behavior.
- Keep contact.*, contacts, and system.generatedBy backward compatible.
- Use company-specific email and phone first, then general contact details.
- Reject stale, cross-company, deleted, inactive, or cross-workspace selections.
- Do not add a database migration.
- Update existing documentation under docs/.
- Preserve the user's uncommitted edits in src/components/documents/template-editor/template-details-panel.tsx and __tests__/components/template-editor/template-editor-panel.test.tsx.
- Follow docs/guides/DESIGN_GUIDELINE.md for wizard UI changes.

---

## File Structure

- Create src/lib/document-party.ts: pure address formatting and contact-detail precedence.
- Create src/services/document-party.service.ts: tenant-scoped option loading and selection validation.
- Create src/app/api/companies/[id]/document-parties/route.ts: authenticated party-option endpoint.
- Create __tests__/lib/document-party.test.ts: pure formatter and precedence coverage.
- Create __tests__/services/document-party.service.test.ts: company membership and selection coverage.
- Create __tests__/api/company-document-parties-route.test.ts: endpoint authorization and response coverage.
- Modify src/lib/placeholder-resolver.ts: canonical party types, enriched loops, singular contexts, preparer alias.
- Modify src/lib/template-analysis.ts: selected-party roots and dependency detection.
- Modify src/types/placeholders.ts: selected-party placeholder sources and mock types.
- Modify src/components/documents/template-editor/template-builders.ts: new safe loop fields.
- Modify src/components/documents/template-editor/placeholder-panel.tsx: new placeholder categories and loop fields.
- Modify src/lib/validations/generated-document.ts: selected ID schemas.
- Modify src/services/document-generator.service.ts: selection context, metadata, and preparer name.
- Modify src/services/document-validation.service.ts: explicit selected-party validation.
- Modify preview, validate, and create generated-document routes: selected ID propagation.
- Modify src/components/documents/document-generation-wizard.tsx: conditional single selectors and draft state.
- Modify src/app/(dashboard)/generated-documents/generate/page.tsx: company-scoped party loading.
- Modify existing tests under __tests__/lib, __tests__/components, __tests__/services, and __tests__/api.
- Modify docs/reference/API_REFERENCE.md and docs/reference/DATABASE_SCHEMA.md: public contract documentation.

---

### Task 1: Canonical Party and Letter Address Utilities

**Files:**
- Create: src/lib/document-party.ts
- Test: __tests__/lib/document-party.test.ts

**Interfaces:**
- Consumes: ContactDetail rows with detailType, value, companyId, isPrimary, displayOrder, and createdAt.
- Produces: DocumentParty, formatLetterAddress(input), chooseContactDetail(details, detailType, companyId), and buildPartyContactFields(input).

- [ ] **Step 1: Write failing utility tests**

~~~ts
import { describe, expect, it } from 'vitest';
import {
  buildPartyContactFields,
  chooseContactDetail,
  formatLetterAddress,
} from '@/lib/document-party';

describe('document party utilities', () => {
  it('formats structured Singapore addresses as three letter lines', () => {
    expect(formatLetterAddress({
      fullAddress: '21 Bukit Batok Crescent #25-72 WCEGA Tower Singapore 658065',
      block: '21',
      street: 'Bukit Batok Crescent',
      level: '25',
      unit: '72',
      building: 'WCEGA Tower',
      postalCode: '658065',
      country: 'Singapore',
    })).toEqual({
      full: '21 Bukit Batok Crescent #25-72 WCEGA Tower Singapore 658065',
      letter: 'WCEGA Tower\n21 Bukit Batok Crescent, #25-72\nSingapore  658065',
    });
  });

  it('collapses a missing building into two lines', () => {
    expect(formatLetterAddress({
      block: '21',
      street: 'Bukit Batok Crescent',
      level: '25',
      unit: '72',
      postalCode: '658065',
      country: 'Singapore',
    }).letter).toBe('21 Bukit Batok Crescent, #25-72\nSingapore  658065');
  });

  it('preserves unrecognized free text without destructive reordering', () => {
    expect(formatLetterAddress({ fullAddress: 'PO Box 123, Johor Bahru' }).letter)
      .toBe('PO Box 123, Johor Bahru');
  });

  it('uses company-specific primary details before general details', () => {
    const details = [
      { detailType: 'EMAIL', value: 'general@example.com', companyId: null, isPrimary: true, displayOrder: 0, createdAt: new Date('2026-01-01') },
      { detailType: 'EMAIL', value: 'company@example.com', companyId: 'company-1', isPrimary: true, displayOrder: 0, createdAt: new Date('2026-01-02') },
    ];
    expect(chooseContactDetail(details, 'EMAIL', 'company-1')).toBe('company@example.com');
  });

  it('falls back independently for email and phone', () => {
    const result = buildPartyContactFields({
      companyId: 'company-1',
      roleAddress: null,
      contactAddress: '1 General Road, Singapore 123456',
      contactDetails: [
        { detailType: 'EMAIL', value: 'company@example.com', companyId: 'company-1', isPrimary: false, displayOrder: 1, createdAt: new Date('2026-01-02') },
        { detailType: 'PHONE', value: '+65 6123 4567', companyId: null, isPrimary: true, displayOrder: 0, createdAt: new Date('2026-01-01') },
      ],
    });
    expect(result.email).toBe('company@example.com');
    expect(result.phone).toBe('+65 6123 4567');
    expect(result.address.full).toBe('1 General Road, Singapore 123456');
  });
});
~~~

- [ ] **Step 2: Run the utility tests and confirm the red state**

Run: npx.cmd vitest run __tests__/lib/document-party.test.ts

Expected: FAIL because @/lib/document-party does not exist.

- [ ] **Step 3: Implement the pure utilities**

~~~ts
export interface PartyAddress {
  full: string | null;
  letter: string | null;
}

export interface DocumentParty {
  id: string;
  contactId: string | null;
  name: string;
  detail: string | null;
  contactType?: string | null;
  email: string | null;
  phone: string | null;
  address: PartyAddress;
  nationality?: string | null;
  identificationNumber?: string | null;
  role?: string | null;
  appointmentDate?: Date | string | null;
  shareholderType?: string | null;
  shareClass?: string | null;
  numberOfShares?: number | null;
  percentageHeld?: number | string | null;
}

export interface AddressInput {
  fullAddress?: string | null;
  block?: string | null;
  street?: string | null;
  level?: string | null;
  unit?: string | null;
  building?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface ContactDetailInput {
  detailType: string;
  value: string;
  companyId?: string | null;
  isPrimary?: boolean;
  displayOrder?: number;
  createdAt?: Date | string;
}

const clean = (value?: string | null) => value?.trim() || null;

export function chooseContactDetail(
  details: ContactDetailInput[],
  detailType: 'EMAIL' | 'PHONE',
  companyId: string
): string | null {
  const rank = (detail: ContactDetailInput) => [
    detail.companyId === companyId ? 0 : detail.companyId == null ? 1 : 2,
    detail.isPrimary ? 0 : 1,
    detail.displayOrder ?? Number.MAX_SAFE_INTEGER,
    new Date(detail.createdAt ?? 0).getTime(),
  ];
  const compare = (left: ContactDetailInput, right: ContactDetailInput) => {
    const a = rank(left);
    const b = rank(right);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
  };
  return details
    .filter((detail) =>
      detail.detailType === detailType &&
      (detail.companyId === companyId || detail.companyId == null) &&
      Boolean(clean(detail.value))
    )
    .sort(compare)[0]?.value.trim() ?? null;
}

export function formatLetterAddress(input: AddressInput): PartyAddress {
  const full = clean(input.fullAddress);
  const street = [clean(input.block), clean(input.street)].filter(Boolean).join(' ');
  const levelUnit = [clean(input.level), clean(input.unit)].filter(Boolean).join('-');
  const streetLine = [street, levelUnit ? '#' + levelUnit : null].filter(Boolean).join(', ');
  const country = clean(input.country) ?? 'Singapore';
  const postalLine = [country, clean(input.postalCode)].filter(Boolean).join(country === 'Singapore' ? '  ' : ' ');
  const structured = [clean(input.building), streetLine || null, postalLine || null].filter(Boolean) as string[];

  if (streetLine || input.postalCode || input.building) {
    return { full: full ?? structured.join(' '), letter: structured.join('\n') || null };
  }
  if (!full) return { full: null, letter: null };

  const existingLines = full.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (existingLines.length > 1) return { full, letter: existingLines.join('\n') };

  const singapore = full.match(/^(?:(.+?),\s*)?(\d+\s+[^,]+?)(?:,\s*(#[^,]+))?,\s*Singapore\s+(\d{6})$/i);
  if (!singapore) return { full, letter: full };
  const [, building, road, unit, postalCode] = singapore;
  return {
    full,
    letter: [clean(building), [road, unit].filter(Boolean).join(', '), 'Singapore  ' + postalCode]
      .filter(Boolean)
      .join('\n'),
  };
}

export function buildPartyContactFields(input: {
  companyId: string;
  roleAddress?: string | null;
  contactAddress?: string | null;
  contactDetails?: ContactDetailInput[];
}) {
  const details = input.contactDetails ?? [];
  return {
    email: chooseContactDetail(details, 'EMAIL', input.companyId),
    phone: chooseContactDetail(details, 'PHONE', input.companyId),
    address: formatLetterAddress({ fullAddress: input.roleAddress || input.contactAddress }),
  };
}
~~~

- [ ] **Step 4: Run the utility tests and confirm the green state**

Run: npx.cmd vitest run __tests__/lib/document-party.test.ts

Expected: PASS with 5 tests.

- [ ] **Step 5: Commit Task 1**

~~~powershell
git add -- src/lib/document-party.ts __tests__/lib/document-party.test.ts
git commit -m "feat(documents): add party contact formatting utilities"
~~~

### Task 2: Tenant-Scoped Company Party Options and Selection Resolution

**Files:**
- Create: src/services/document-party.service.ts
- Create: src/app/api/companies/[id]/document-parties/route.ts
- Test: __tests__/services/document-party.service.test.ts
- Test: __tests__/api/company-document-parties-route.test.ts

**Interfaces:**
- Consumes: buildPartyContactFields from Task 1 and Prisma company/contact relations.
- Produces: DocumentParty option arrays, getDocumentPartyOptions(companyId, tenantId), and resolveDocumentPartySelections(input).

- [ ] **Step 1: Write failing service tests**

~~~ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  getDocumentPartyOptions,
  resolveDocumentPartySelections,
} from '@/services/document-party.service';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    company: { findFirst: vi.fn() },
  },
}));

describe('document party service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns current directors, shareholders, and the company Contacts union', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [{ id: 'officer-1', name: 'Alice', role: 'DIRECTOR', contact: null }],
      shareholders: [{ id: 'shareholder-1', name: 'Ben', shareClass: 'ORDINARY', contact: null }],
      contacts: [{ contact: { id: 'contact-1', fullName: 'Cara', fullAddress: null, contactDetails: [] }, relationship: 'Representative' }],
    } as never);
    const result = await getDocumentPartyOptions('company-1', 'tenant-1');
    expect(result.directors.map((party) => party.id)).toEqual(['officer-1']);
    expect(result.shareholders.map((party) => party.id)).toEqual(['shareholder-1']);
    expect(result.contacts.map((party) => party.id)).toEqual(['contact-1']);
  });

  it('rejects a director outside the selected company', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [],
      shareholders: [],
      contacts: [],
    } as never);
    await expect(resolveDocumentPartySelections({
      companyId: 'company-1',
      tenantId: 'tenant-1',
      selectedDirectorId: 'officer-2',
    })).rejects.toThrow('Selected director is not a current director of this company');
  });
});
~~~

- [ ] **Step 2: Run the service tests and confirm the red state**

Run: npx.cmd vitest run __tests__/services/document-party.service.test.ts

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement party option and selection queries**

~~~ts
import { prisma } from '@/lib/prisma';
import { buildPartyContactFields, type DocumentParty } from '@/lib/document-party';

export interface DocumentPartySelections {
  selectedDirector?: DocumentParty;
  selectedShareholder?: DocumentParty;
  selectedContact?: DocumentParty;
}

const contactSelect = {
  id: true,
  fullName: true,
  contactType: true,
  fullAddress: true,
  contactDetails: {
    where: { deletedAt: null },
    select: {
      detailType: true,
      value: true,
      companyId: true,
      isPrimary: true,
      displayOrder: true,
      createdAt: true,
    },
  },
} as const;

export async function getDocumentPartyOptions(companyId: string, tenantId: string) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId, deletedAt: null },
    select: {
      id: true,
      officers: {
        where: { isCurrent: true, role: 'DIRECTOR' },
        select: { id: true, contactId: true, name: true, role: true, nationality: true, identificationNumber: true, address: true, appointmentDate: true, contact: { select: contactSelect } },
      },
      shareholders: {
        where: { isCurrent: true },
        select: { id: true, contactId: true, name: true, shareholderType: true, nationality: true, identificationNumber: true, shareClass: true, numberOfShares: true, percentageHeld: true, address: true, contact: { select: contactSelect } },
      },
      contacts: {
        where: { deletedAt: null },
        select: { relationship: true, contact: { select: contactSelect } },
      },
    },
  });
  if (!company) throw new Error('Company not found');

  const toParty = (record: {
    id: string;
    contactId?: string | null;
    name: string;
    detail: string | null;
    roleAddress?: string | null;
    roleFields?: Partial<Pick<DocumentParty, 'nationality' | 'identificationNumber' | 'role' | 'appointmentDate' | 'shareholderType' | 'shareClass' | 'numberOfShares' | 'percentageHeld'>>;
    contact?: { id: string; fullName: string; contactType: string; fullAddress: string | null; contactDetails: Array<{ detailType: string; value: string; companyId: string | null; isPrimary: boolean; displayOrder: number; createdAt: Date }> } | null;
  }): DocumentParty => ({
    id: record.id,
    contactId: record.contactId ?? record.contact?.id ?? null,
    name: record.name,
    detail: record.detail,
    contactType: record.contact?.contactType ?? null,
    ...record.roleFields,
    ...buildPartyContactFields({
      companyId,
      roleAddress: record.roleAddress,
      contactAddress: record.contact?.fullAddress,
      contactDetails: record.contact?.contactDetails,
    }),
  });

  const directors = company.officers.map((officer) => toParty({
    id: officer.id, contactId: officer.contactId, name: officer.name,
    detail: officer.role, roleAddress: officer.address, contact: officer.contact,
    roleFields: {
      role: officer.role,
      nationality: officer.nationality,
      identificationNumber: officer.identificationNumber,
      appointmentDate: officer.appointmentDate,
    },
  }));
  const shareholders = company.shareholders.map((shareholder) => toParty({
    id: shareholder.id, contactId: shareholder.contactId, name: shareholder.name,
    detail: shareholder.shareClass, roleAddress: shareholder.address, contact: shareholder.contact,
    roleFields: {
      shareholderType: shareholder.shareholderType,
      nationality: shareholder.nationality,
      identificationNumber: shareholder.identificationNumber,
      shareClass: shareholder.shareClass,
      numberOfShares: shareholder.numberOfShares,
      percentageHeld: shareholder.percentageHeld?.toString() ?? null,
    },
  }));

  const contactMap = new Map<string, DocumentParty>();
  for (const relation of company.contacts) {
    const contact = relation.contact;
    contactMap.set(contact.id, toParty({
      id: contact.id, contactId: contact.id, name: contact.fullName,
      detail: relation.relationship, contact,
    }));
  }
  for (const party of [...directors, ...shareholders]) {
    if (party.contactId && !contactMap.has(party.contactId)) {
      contactMap.set(party.contactId, { ...party, id: party.contactId });
    }
  }
  return { directors, shareholders, contacts: Array.from(contactMap.values()) };
}

export async function resolveDocumentPartySelections(input: {
  companyId: string;
  tenantId: string;
  selectedDirectorId?: string;
  selectedShareholderId?: string;
  selectedContactId?: string;
}): Promise<DocumentPartySelections> {
  const options = await getDocumentPartyOptions(input.companyId, input.tenantId);
  const selectedDirector = input.selectedDirectorId
    ? options.directors.find((party) => party.id === input.selectedDirectorId)
    : undefined;
  const selectedShareholder = input.selectedShareholderId
    ? options.shareholders.find((party) => party.id === input.selectedShareholderId)
    : undefined;
  const selectedContact = input.selectedContactId
    ? options.contacts.find((party) => party.id === input.selectedContactId)
    : undefined;
  if (input.selectedDirectorId && !selectedDirector) throw new Error('Selected director is not a current director of this company');
  if (input.selectedShareholderId && !selectedShareholder) throw new Error('Selected shareholder is not a current shareholder of this company');
  if (input.selectedContactId && !selectedContact) throw new Error('Selected contact is not linked to this company');
  return { selectedDirector, selectedShareholder, selectedContact };
}
~~~

- [ ] **Step 4: Add and test the authenticated options route**

~~~ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { requireSessionWorkspaceId, createErrorResponse } from '@/lib/api-helpers';
import { getDocumentPartyOptions } from '@/services/document-party.service';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');
    const { id } = await params;
    return NextResponse.json(await getDocumentPartyOptions(id, requireSessionWorkspaceId(session)));
  } catch (error) {
    return createErrorResponse(error);
  }
}
~~~

Use this route assertion in __tests__/api/company-document-parties-route.test.ts:

~~~ts
it('loads document parties inside the session workspace', async () => {
  vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1' } as never);
  vi.mocked(getDocumentPartyOptions).mockResolvedValue({
    directors: [], shareholders: [], contacts: [],
  });
  const response = await GET(
    new NextRequest('http://localhost/api/companies/company-1/document-parties'),
    { params: Promise.resolve({ id: 'company-1' }) }
  );
  expect(response.status).toBe(200);
  expect(getDocumentPartyOptions).toHaveBeenCalledWith('company-1', 'tenant-1');
  expect(await response.json()).toEqual({ directors: [], shareholders: [], contacts: [] });
});
~~~

- [ ] **Step 5: Run service and route tests**

Run: npx.cmd vitest run __tests__/services/document-party.service.test.ts __tests__/api/company-document-parties-route.test.ts

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

~~~powershell
git add -- src/services/document-party.service.ts src/app/api/companies/[id]/document-parties/route.ts __tests__/services/document-party.service.test.ts __tests__/api/company-document-parties-route.test.ts
git commit -m "feat(documents): load company-scoped document parties"
~~~

### Task 3: Resolver Context, Loop Fields, and Letter Addresses

**Files:**
- Modify: src/lib/placeholder-resolver.ts
- Test: __tests__/lib/placeholder-resolver.test.ts

**Interfaces:**
- Consumes: PartyAddress, buildPartyContactFields, formatLetterAddress, and DocumentPartySelections.
- Produces: PlaceholderContext.selectedDirector, selectedShareholder, selectedContact; enriched loop records; system.preparerName alias.

- [ ] **Step 1: Add failing resolver tests**

~~~ts
it('resolves independent selected parties and preparer aliases', () => {
  const result = resolvePlaceholders(
    [
      '{{selectedDirector.name}}|{{selectedDirector.email}}|{{selectedDirector.address.letter}}',
      '{{selectedDirector.role}}|{{selectedShareholder.name}}|{{selectedShareholder.shareClass}}|{{selectedContact.phone}}',
      '{{system.preparerName}}|{{system.generatedBy}}',
    ].join('|'),
    {
      selectedDirector: { id: 'd1', contactId: 'c1', name: 'Alice', detail: 'DIRECTOR', role: 'DIRECTOR', email: 'alice@example.com', phone: null, address: { full: 'One Road', letter: 'One Road' } },
      selectedShareholder: { id: 's1', contactId: 'c2', name: 'Ben', detail: 'ORDINARY', shareClass: 'ORDINARY', email: null, phone: null, address: { full: null, letter: null } },
      selectedContact: { id: 'c3', contactId: 'c3', name: 'Cara', detail: 'Representative', email: null, phone: '+65 6123 4567', address: { full: null, letter: null } },
      system: { currentDate: new Date('2026-07-16'), preparerName: 'Test User', generatedBy: 'Test User' },
    }
  );
  expect(result.resolved).toContain('Alice|alice@example.com|One Road');
  expect(result.resolved).toContain('DIRECTOR|Ben|ORDINARY|+65 6123 4567|Test User|Test User');
  expect(result.missing).toEqual([]);
});

it('adds contact fields to current director and shareholder loops', () => {
  const context = prepareCompanyContext({
    id: 'company-1',
    name: 'Sample',
    uen: '202600001A',
    officers: [{
      name: 'Alice', role: 'DIRECTOR', address: 'One Road', isCurrent: true,
      contact: { id: 'c1', fullAddress: null, contactDetails: [{ detailType: 'EMAIL', value: 'alice@example.com', companyId: null }] },
    }],
    shareholders: [{
      name: 'Ben', numberOfShares: 1, address: 'Two Road', isCurrent: true,
      contact: { id: 'c2', fullAddress: null, contactDetails: [{ detailType: 'PHONE', value: '+65 6000 0000', companyId: null }] },
    }],
  });
  const result = resolvePlaceholders(
    '{{#each directors}}{{email}}|{{letterAddress}}{{/each}}/{{#each shareholders}}{{phone}}|{{letterAddress}}{{/each}}',
    context
  );
  expect(result.resolved).toBe('alice@example.com|One Road/+65 6000 0000|Two Road');
});

it('renders letter-address newlines as safe HTML breaks', () => {
  const result = resolvePlaceholders(
    '{{company.address.letter}}',
    {
      company: {
        id: 'company-1',
        name: 'Sample',
        uen: '202600001A',
        address: {
          block: '21',
          street: 'Bukit Batok Crescent',
          level: '25',
          unit: '72',
          building: 'WCEGA <Tower>',
          postalCode: '658065',
          letter: 'WCEGA <Tower>\n21 Bukit Batok Crescent, #25-72\nSingapore  658065',
        },
      },
    }
  );
  expect(result.resolved).toBe('WCEGA &lt;Tower&gt;<br>21 Bukit Batok Crescent, #25-72<br>Singapore  658065');
});
~~~

- [ ] **Step 2: Run the resolver tests and confirm the red state**

Run: npx.cmd vitest run __tests__/lib/placeholder-resolver.test.ts

Expected: FAIL because singular contexts and letterAddress are absent.

- [ ] **Step 3: Extend resolver types and prepareCompanyContext**

Add DocumentParty-shaped singular values to PlaceholderContext. Extend OfficerData and ShareholderData with id, contactId, email, phone, letterAddress, and contact.fullAddress/contactDetails metadata. Extend CompanyData.address with letter and CompanyAddressData with country.

In prepareCompanyContext, map current directors and shareholders through buildPartyContactFields using company.id. Preserve each record's existing scalar address and add:

~~~ts
const enrichOfficer = (officer: OfficerData): OfficerData => {
  const fields = buildPartyContactFields({
    companyId: company.id,
    roleAddress: officer.address,
    contactAddress: officer.contact?.fullAddress,
    contactDetails: officer.contact?.contactDetails,
  });
  return {
    ...officer,
    email: fields.email,
    phone: fields.phone,
    letterAddress: fields.address.letter,
  };
};
~~~

Set company.address.letter from formatLetterAddress using the selected registered address record. When system data is merged in resolvePlaceholders, keep both names synchronized:

~~~ts
const preparerName = context.system?.preparerName ?? context.system?.generatedBy;
system: {
  currentDate: context.system?.currentDate ?? new Date(),
  ...context.system,
  preparerName,
  generatedBy: context.system?.generatedBy ?? preparerName,
}
~~~

Add a focused value renderer and use it in simple placeholders and loop-property replacement for address.letter and letterAddress:

~~~ts
function formatResolvedValue(path: string, value: unknown, options: ResolveOptions): string {
  const formatted = formatValue(value, options) ?? '';
  if (path === 'letterAddress' || path.endsWith('.address.letter')) {
    return formatted
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\r?\n/g, '<br>');
  }
  return formatted;
}
~~~

- [ ] **Step 4: Run resolver regression tests**

Run: npx.cmd vitest run __tests__/lib/placeholder-resolver.test.ts __tests__/components/template-editor/template-builders.test.ts

Expected: PASS, including all existing loop layouts.

- [ ] **Step 5: Commit Task 3**

~~~powershell
git add -- src/lib/placeholder-resolver.ts __tests__/lib/placeholder-resolver.test.ts
git commit -m "feat(documents): resolve selected party placeholders"
~~~

### Task 4: Template Analysis, Catalog, and Guided Loop Fields

**Files:**
- Modify: src/lib/template-analysis.ts
- Modify: src/types/placeholders.ts
- Modify: src/components/documents/template-editor/template-builders.ts
- Modify: src/components/documents/template-editor/placeholder-panel.tsx
- Test: __tests__/lib/template-analysis.test.ts
- Test: __tests__/components/template-editor/template-builders.test.ts
- Test: __tests__/components/template-editor/placeholder-panel.test.tsx

**Interfaces:**
- Consumes: selectedDirector.*, selectedShareholder.*, selectedContact.*, company.address.letter, and system.preparerName.
- Produces: getRequiredPartySelections(content, partials), known roots, catalog insert actions, and allowlisted loop fields.

- [ ] **Step 1: Add failing analysis and editor tests**

~~~ts
it('detects singular party requirements in templates and partials', () => {
  expect(getRequiredPartySelections(
    '<p>{{selectedDirector.name}}</p>{{>signature}}',
    [{ name: 'signature', content: '{{selectedContact.email}}{{selectedShareholder.phone}}' }]
  )).toEqual({
    director: true,
    shareholder: true,
    contact: true,
  });
});
~~~

In placeholder-panel.test.tsx, assert that the panel displays Selected Director, Selected Shareholder, Selected Contact, Company Letter Address, and Preparer Name. Click Insert Director Email and expect onInsert to receive {{selectedDirector.email}}.

In template-builders.test.ts, build a directors loop with email, phone, and letterAddress and assert that the output contains {{this.email}}, {{this.phone}}, and {{this.letterAddress}} inside one balanced each block.

- [ ] **Step 2: Run focused tests and confirm the red state**

Run: npx.cmd vitest run __tests__/lib/template-analysis.test.ts __tests__/components/template-editor/template-builders.test.ts __tests__/components/template-editor/placeholder-panel.test.tsx

Expected: FAIL because the roots, detector, and catalog fields are absent.

- [ ] **Step 3: Implement analysis and catalog changes**

Add selectedDirector, selectedShareholder, and selectedContact to KNOWN_PLACEHOLDER_ROOTS. Add this.letterAddress to LOOP_ONLY_PLACEHOLDERS.

Export:

~~~ts
export interface RequiredPartySelections {
  director: boolean;
  shareholder: boolean;
  contact: boolean;
}

export function getRequiredPartySelections(
  content: string,
  partials: TemplatePartialLike[] = []
): RequiredPartySelections {
  const byName = new Map(partials.map((partial) => [partial.name, partial]));
  const names = collectDependencyNames(content, byName);
  const combined = [content, ...names.map((name) => byName.get(name)?.content ?? '')].join('\n');
  const keys = extractTemplatePlaceholderKeys(combined);
  return {
    director: keys.some((key) => key === 'selectedDirector' || key.startsWith('selectedDirector.')),
    shareholder: keys.some((key) => key === 'selectedShareholder' || key.startsWith('selectedShareholder.')),
    contact: keys.some((key) =>
      key === 'selectedContact' ||
      key.startsWith('selectedContact.') ||
      key === 'contact' ||
      key.startsWith('contact.') ||
      key === 'contacts'
    ),
  };
}
~~~

Keep selected director requirements mapped to the existing officer source, selected shareholder requirements mapped to shareholder, and selected contact requirements mapped to contact. Extend mock placeholder context types with the three singular DocumentParty values. Add catalog fields for the common fields plus the applicable role-specific fields under each selected category. Add company.address.letter and system.preparerName. Add email, phone, and letterAddress to both TEMPLATE_FIELD_OPTIONS allowlists without changing the existing address option.

- [ ] **Step 4: Run focused editor and analysis tests**

Run: npx.cmd vitest run __tests__/lib/template-analysis.test.ts __tests__/components/template-editor/template-builders.test.ts __tests__/components/template-editor/placeholder-panel.test.tsx

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

~~~powershell
git add -- src/lib/template-analysis.ts src/types/placeholders.ts src/components/documents/template-editor/template-builders.ts src/components/documents/template-editor/placeholder-panel.tsx __tests__/lib/template-analysis.test.ts __tests__/components/template-editor/template-builders.test.ts __tests__/components/template-editor/placeholder-panel.test.tsx
git commit -m "feat(documents): expose selected party template fields"
~~~

### Task 5: Shared Rendering, Request Schemas, Metadata, and Preparer Name

**Files:**
- Modify: src/lib/validations/generated-document.ts
- Modify: src/services/document-generator.service.ts
- Modify: src/app/api/generated-documents/preview/route.ts
- Modify: src/app/api/generated-documents/route.ts
- Test: __tests__/services/document-generator.service.test.ts
- Test: __tests__/api/generated-documents-preview-route.test.ts
- Test: __tests__/api/generated-documents-workspace.test.ts

**Interfaces:**
- Consumes: resolveDocumentPartySelections and selected ID request fields.
- Produces: a single renderTemplateForGeneration path used by preview and generation, plus selected IDs in metadata.

- [ ] **Step 1: Add failing schema, route, and renderer tests**

Extend the preview-route test request with all three selected IDs and expect renderTemplateForGeneration to receive them. In document-generator.service.test.ts, mock resolveDocumentPartySelections and assert its returned objects appear in rendered.context. Assert generated metadata contains:

~~~ts
selectedParties: {
  directorId: 'officer-1',
  shareholderId: 'shareholder-1',
  contactId: 'contact-1',
}
~~~

Add a generation test proving system.preparerName and system.generatedBy both equal the creating user's first and last name.

- [ ] **Step 2: Run focused server tests and confirm the red state**

Run: npx.cmd vitest run __tests__/services/document-generator.service.test.ts __tests__/api/generated-documents-preview-route.test.ts __tests__/api/generated-documents-workspace.test.ts

Expected: FAIL because selected IDs are stripped or ignored.

- [ ] **Step 3: Extend schemas and renderer parameters**

Add the three optional UUID fields to createDocumentFromTemplateSchema and previewSchema:

~~~ts
selectedDirectorId: z.string().uuid().optional(),
selectedShareholderId: z.string().uuid().optional(),
selectedContactId: z.string().uuid().optional(),
~~~

Add the same optional fields to RenderTemplateForGenerationParams. After company context is prepared, require companyId when any selected ID is present, call resolveDocumentPartySelections, and merge its result:

~~~ts
if (
  selectedDirectorId || selectedShareholderId || selectedContactId
) {
  if (!companyId) throw new Error('Company selection is required for selected parties');
  const selections = await resolveDocumentPartySelections({
    companyId,
    tenantId,
    selectedDirectorId,
    selectedShareholderId,
    selectedContactId,
  });
  const legacySelectedContact = selections.selectedContact
    ? {
        id: selections.selectedContact.id,
        fullName: selections.selectedContact.name,
        contactType: selections.selectedContact.contactType ?? 'INDIVIDUAL',
        email: selections.selectedContact.email,
        phone: selections.selectedContact.phone,
        fullAddress: selections.selectedContact.address.full,
      }
    : undefined;
  const contacts = legacySelectedContact
    ? [
        legacySelectedContact,
        ...(context.contacts ?? []).filter((contact) => contact.id !== legacySelectedContact.id),
      ]
    : context.contacts;
  context = {
    ...context,
    ...selections,
    contact: legacySelectedContact ?? context.contact,
    contacts,
    custom: {
      ...context.custom,
      contacts,
    },
  };
}
~~~

When generatedBy is provided, set both system.preparerName and system.generatedBy. In createDocumentFromTemplate, load the creator with:

~~~ts
const creator = await prisma.user.findFirst({
  where: { id: userId, tenantId },
  select: { firstName: true, lastName: true },
});
const generatedBy = creator
  ? [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim()
  : undefined;
~~~

Pass generatedBy and the selected IDs into renderTemplateForGeneration. Store selectedParties in generated-document metadata and the audit metadata.

- [ ] **Step 4: Propagate preview and create payloads**

Pass selectedDirectorId, selectedShareholderId, and selectedContactId from validated preview data into renderTemplateForGeneration. The create route already parses createDocumentFromTemplateSchema, so no unvalidated request fields enter the service.

- [ ] **Step 5: Run server tests**

Run: npx.cmd vitest run __tests__/services/document-generator.service.test.ts __tests__/api/generated-documents-preview-route.test.ts __tests__/api/generated-documents-workspace.test.ts

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

~~~powershell
git add -- src/lib/validations/generated-document.ts src/services/document-generator.service.ts src/app/api/generated-documents/preview/route.ts src/app/api/generated-documents/route.ts __tests__/services/document-generator.service.test.ts __tests__/api/generated-documents-preview-route.test.ts __tests__/api/generated-documents-workspace.test.ts
git commit -m "feat(documents): render validated selected parties"
~~~

### Task 6: Pre-Generation Validation for Singular Selections

**Files:**
- Modify: src/services/document-validation.service.ts
- Modify: src/app/api/generated-documents/validate/route.ts
- Test: __tests__/services/document-validation.test.ts
- Create: __tests__/api/generated-documents-validation-route.test.ts

**Interfaces:**
- Consumes: getRequiredPartySelections, resolveDocumentPartySelections, and selected IDs.
- Produces: precise missing-selection and invalid-membership errors.

- [ ] **Step 1: Add failing validation tests**

~~~ts
it('requires only singular selections referenced by the resolved template', async () => {
  mocks.templateFind.mockResolvedValue({
    id: 'template-1',
    name: 'Letter',
    content: '{{selectedDirector.name}}{{selectedContact.email}}',
    placeholders: [],
  });
  const result = await validateForGeneration('tenant-1', {
    templateId: 'template-1',
    companyId: 'company-1',
  });
  expect(result.errors.map((error) => error.message)).toEqual([
    'Select a director for this template.',
    'Select a company contact for this template.',
  ]);
});
~~~

Add a route test proving all three UUIDs are passed to validateForGeneration.

- [ ] **Step 2: Run validation tests and confirm the red state**

Run: npx.cmd vitest run __tests__/services/document-validation.test.ts __tests__/api/generated-documents-validation-route.test.ts

Expected: FAIL because the validation input has no singular selections.

- [ ] **Step 3: Implement selection requirement validation**

Extend ValidateForGenerationInput and validateSchema with the three IDs. After resolving partials, call getRequiredPartySelections. Produce selection errors before field-value validation:

~~~ts
const partyRequirements = getRequiredPartySelections(contentToValidate);
const selectionErrors: ValidationError[] = [
  partyRequirements.director && !input.selectedDirectorId
    ? { field: 'selectedDirector', message: 'Select a director for this template.', category: 'directors' }
    : null,
  partyRequirements.shareholder && !input.selectedShareholderId
    ? { field: 'selectedShareholder', message: 'Select a shareholder for this template.', category: 'shareholders' }
    : null,
  partyRequirements.contact && !input.selectedContactId
    ? { field: 'selectedContact', message: 'Select a company contact for this template.', category: 'contacts' }
    : null,
].filter((error): error is ValidationError => error !== null);
~~~

Update getPlaceholderCategory before analyzing requirements:

~~~ts
if (lowerKey === 'selecteddirector' || lowerKey.startsWith('selecteddirector.')) {
  return 'officer';
}
if (lowerKey === 'selectedshareholder' || lowerKey.startsWith('selectedshareholder.')) {
  return 'shareholder';
}
if (lowerKey === 'selectedcontact' || lowerKey.startsWith('selectedcontact.')) {
  return 'contact';
}
~~~

When IDs are present, call resolveDocumentPartySelections once, retain its returned DocumentPartySelections, and convert membership errors into ValidationError entries. Include selectionErrors and membership errors in allErrors.

Extend calculateAvailablePlaceholders with a selections argument. Add system.preparerName and company.address.letter. Walk non-empty scalar leaves of each selected party into its prefix:

~~~ts
function addAvailableLeaves(
  available: string[],
  prefix: string,
  value: unknown
): void {
  if (value === null || value === undefined || value === '') return;
  if (typeof value !== 'object' || value instanceof Date) {
    available.push(prefix);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    addAvailableLeaves(available, prefix + '.' + key, nested);
  }
}

addAvailableLeaves(available, 'selectedDirector', selections.selectedDirector);
addAvailableLeaves(available, 'selectedShareholder', selections.selectedShareholder);
addAvailableLeaves(available, 'selectedContact', selections.selectedContact);
~~~

Return booleans for hasSelectedDirector, hasSelectedShareholder, and hasSelectedContact in the route's resolvedData.

- [ ] **Step 4: Run validation tests**

Run: npx.cmd vitest run __tests__/services/document-validation.test.ts __tests__/api/generated-documents-validation-route.test.ts

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

~~~powershell
git add -- src/services/document-validation.service.ts src/app/api/generated-documents/validate/route.ts __tests__/services/document-validation.test.ts __tests__/api/generated-documents-validation-route.test.ts
git commit -m "feat(documents): validate selected template parties"
~~~

### Task 7: Conditional People Step and Single-Selection Wizard

**Files:**
- Modify: src/components/documents/document-generation-wizard.tsx
- Modify: src/app/(dashboard)/generated-documents/generate/page.tsx
- Test: __tests__/components/document-generation-wizard.test.tsx

**Interfaces:**
- Consumes: GET /api/companies/[id]/document-parties and getRequiredPartySelections.
- Produces: selectedDirectorId, selectedShareholderId, and selectedContactId in preview, validation, and generation payloads.

- [ ] **Step 1: Read the UI guideline sections used by selectors**

Read docs/guides/DESIGN_GUIDELINE.md sections for searchable selects, form labels, loading states, empty states, focus rings, and validation messages. Reuse the existing color and spacing tokens in document-generation-wizard.tsx.

- [ ] **Step 2: Add failing wizard tests**

~~~tsx
const company = {
  id: 'company-1',
  name: 'Sample Company',
  uen: '202600001A',
  status: 'ACTIVE',
};
const onGenerate = vi.fn().mockResolvedValue({
  id: 'document-1',
  title: 'Resolution',
  content: '<p>Resolved</p>',
  status: 'DRAFT',
});

function mockPartyFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/document-parties')) {
      return {
        ok: true,
        json: async () => ({
          directors: [{ id: 'officer-1', contactId: 'person-1', name: 'Alice', detail: 'Director', email: null, phone: null, address: { full: null, letter: null } }],
          shareholders: [{ id: 'shareholder-1', contactId: 'person-2', name: 'Ben', detail: 'Ordinary', email: null, phone: null, address: { full: null, letter: null } }],
          contacts: [{ id: 'contact-1', contactId: 'contact-1', name: 'Cara', detail: 'Representative', email: null, phone: null, address: { full: null, letter: null } }],
        }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        preview: {
          content: '<p>Resolved</p>',
          unresolvedPlaceholders: [],
          missingPartials: [],
          blockingErrors: [],
        },
      }),
    } as Response;
  }));
}

it('shows only required independent party selectors and submits their IDs', async () => {
  const selectedTemplate = {
    ...template,
    content: '{{selectedDirector.name}}{{selectedShareholder.email}}{{selectedContact.phone}}',
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/document-parties')) {
      return {
        ok: true,
        json: async () => ({
          directors: [{ id: 'officer-1', contactId: 'person-1', name: 'Alice', detail: 'Director', email: null, phone: null, address: { full: null, letter: null } }],
          shareholders: [{ id: 'shareholder-1', contactId: 'person-2', name: 'Ben', detail: 'Ordinary', email: null, phone: null, address: { full: null, letter: null } }],
          contacts: [{ id: 'contact-1', contactId: 'contact-1', name: 'Cara', detail: 'Representative', email: null, phone: null, address: { full: null, letter: null } }],
        }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        preview: {
          content: '<p>Resolved</p>',
          unresolvedPlaceholders: [],
          missingPartials: [],
          blockingErrors: [],
        },
      }),
    } as Response;
  }));
  render(
    <DocumentGenerationWizard
      templates={[selectedTemplate]}
      companies={[company]}
      onGenerate={onGenerate}
    />
  );
  fireEvent.click(screen.getAllByText('Resolution')[1]);
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText(company.name));
  fireEvent.click(screen.getByText('Next'));
  fireEvent.change(await screen.findByLabelText('Director'), { target: { value: 'officer-1' } });
  fireEvent.change(screen.getByLabelText('Shareholder'), { target: { value: 'shareholder-1' } });
  fireEvent.change(screen.getByLabelText('Company Contact'), { target: { value: 'contact-1' } });
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('Next'));
  await screen.findByLabelText('Document content');
  fireEvent.click(screen.getByText('Next'));
  await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({
    selectedDirectorId: 'officer-1',
    selectedShareholderId: 'shareholder-1',
    selectedContactId: 'contact-1',
  })));
});

it('clears party selections when the company changes', async () => {
  mockPartyFetch();
  render(
    <DocumentGenerationWizard
      templates={[{ ...template, content: '{{selectedDirector.name}}' }]}
      companies={[company, { ...company, id: 'company-2', name: 'Second Company' }]}
      onGenerate={vi.fn()}
    />
  );
  fireEvent.click(screen.getAllByText('Resolution')[1]);
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText(company.name));
  fireEvent.click(screen.getByText('Next'));
  fireEvent.change(await screen.findByLabelText('Director'), { target: { value: 'officer-1' } });
  fireEvent.click(screen.getByText('Previous'));
  fireEvent.click(screen.getByText('Second Company'));
  fireEvent.click(screen.getByText('Next'));
  expect(await screen.findByLabelText('Director')).toHaveValue('');
});

it('blocks preview with a direct message when a required party is missing', async () => {
  mockPartyFetch();
  render(
    <DocumentGenerationWizard
      templates={[{ ...template, content: '{{selectedDirector.name}}' }]}
      companies={[company]}
      onGenerate={vi.fn()}
    />
  );
  fireEvent.click(screen.getAllByText('Resolution')[1]);
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText(company.name));
  fireEvent.click(screen.getByText('Next'));
  await screen.findByLabelText('Director');
  fireEvent.click(screen.getByText('Next'));
  expect(screen.getByText('Select a director for this template.')).toBeVisible();
});
~~~

Import waitFor from @testing-library/react. Call vi.restoreAllMocks() after each test so the fetch stub and localStorage state do not leak.

- [ ] **Step 3: Run the wizard tests and confirm the red state**

Run: npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx

Expected: FAIL because the People step and singular state do not exist.

- [ ] **Step 4: Add party types, state, and requirement derivation**

Add:

~~~ts
import type { DocumentParty } from '@/lib/document-party';

interface DocumentPartyOptions {
  directors: DocumentParty[];
  shareholders: DocumentParty[];
  contacts: DocumentParty[];
}
~~~

Add selectedDirector, selectedShareholder, and selectedContact to WizardState. Add their IDs to WizardDraftState and GenerateDocumentData. Rename the visible step label from Contacts to People. Derive requirements with getRequiredPartySelections from template content plus loaded partials.

- [ ] **Step 5: Load and render accessible single selectors**

When selectedCompany.id changes, clear all three selected values and fetch /api/companies/{id}/document-parties. Ignore an obsolete response with an AbortController. Render a PartySelector for each required category:

~~~tsx
<PartySelector
  label="Director"
  options={partyOptions.directors}
  value={state.selectedDirector}
  onChange={(selectedDirector) => setState((previous) => ({ ...previous, selectedDirector }))}
  required
/>
~~~

PartySelector uses radio semantics or a native select with one value, a text search input, visible loading and empty states, and the existing focus and error tokens. It displays option name as the primary label and detail, email, or phone as secondary identifying text.

- [ ] **Step 6: Enforce requirements and propagate selected IDs**

In isStepValid and goToNextStep, return the exact missing-selection messages from Task 6. Add selected IDs to onValidate, preview requestBody, and onGenerate. When the company changes, clear previewContent and editedContent because their resolved party data is stale.

Persist the selected IDs in localStorage. Restore them only after options load and only if the matching option exists under the restored company.

In generate/page.tsx, remove the workspace-wide contacts fetch and onSearchContacts plumbing. Add the selected IDs to preview validation and create request bodies.

- [ ] **Step 7: Run wizard and route regression tests**

Run: npx.cmd vitest run __tests__/components/document-generation-wizard.test.tsx __tests__/api/generated-documents-preview-route.test.ts __tests__/api/generated-documents-workspace.test.ts

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

~~~powershell
git add -- src/components/documents/document-generation-wizard.tsx src/app/(dashboard)/generated-documents/generate/page.tsx __tests__/components/document-generation-wizard.test.tsx
git commit -m "feat(documents): select template parties during generation"
~~~

### Task 8: Documentation and Full Verification

**Files:**
- Modify: docs/reference/API_REFERENCE.md
- Modify: docs/reference/DATABASE_SCHEMA.md
- Modify: docs/README.md

**Interfaces:**
- Consumes: the completed placeholder and API contracts.
- Produces: discoverable developer and user-facing reference material.

- [ ] **Step 1: Update existing documentation**

In docs/reference/API_REFERENCE.md, document GET /api/companies/[id]/document-parties and the three optional selected IDs accepted by preview, validate, and create endpoints. Include one request example:

~~~json
{
  "templateId": "33333333-3333-4333-8333-333333333333",
  "companyId": "55555555-5555-4555-8555-555555555555",
  "selectedDirectorId": "66666666-6666-4666-8666-666666666666",
  "selectedShareholderId": "77777777-7777-4777-8777-777777777777",
  "selectedContactId": "88888888-8888-4888-8888-888888888888",
  "title": "Company Letter",
  "customData": {}
}
~~~

In docs/reference/DATABASE_SCHEMA.md, extend the placeholder context example with selectedDirector, selectedShareholder, selectedContact, company.address.letter, system.preparerName, and the selectedParties metadata snapshot. State explicitly that these are computed values and require no migration.

In docs/README.md, expand the Document Generation description to mention explicit party selection and letter-format address placeholders.

- [ ] **Step 2: Run formatting and static checks**

Run: git diff --check

Expected: no whitespace errors.

Run: npx.cmd eslint src/lib/document-party.ts src/services/document-party.service.ts src/lib/placeholder-resolver.ts src/lib/template-analysis.ts src/services/document-generator.service.ts src/services/document-validation.service.ts src/components/documents/document-generation-wizard.tsx src/components/documents/template-editor/placeholder-panel.tsx src/components/documents/template-editor/template-builders.ts

Expected: exit code 0.

- [ ] **Step 3: Run all focused document-generation tests**

Run: npx.cmd vitest run __tests__/lib/document-party.test.ts __tests__/lib/placeholder-resolver.test.ts __tests__/lib/template-analysis.test.ts __tests__/services/document-party.service.test.ts __tests__/services/document-generator.service.test.ts __tests__/services/document-validation.test.ts __tests__/api/company-document-parties-route.test.ts __tests__/api/generated-documents-preview-route.test.ts __tests__/api/generated-documents-validation-route.test.ts __tests__/api/generated-documents-workspace.test.ts __tests__/components/document-generation-wizard.test.tsx __tests__/components/template-editor/template-builders.test.ts __tests__/components/template-editor/placeholder-panel.test.tsx

Expected: all tests pass.

- [ ] **Step 4: Run the complete test suite**

Run: npx.cmd vitest run

Expected: exit code 0. If an unrelated pre-existing failure occurs, record the exact test name and failure output without changing unrelated code.

- [ ] **Step 5: Build the production application**

Run: npm.cmd run build

Expected: Prisma generation and Next.js production build complete with exit code 0.

- [ ] **Step 6: Commit documentation**

~~~powershell
git add -- docs/reference/API_REFERENCE.md docs/reference/DATABASE_SCHEMA.md docs/README.md
git commit -m "docs: document selected party placeholders"
~~~

- [ ] **Step 7: Review the final change boundary**

Run: git status --short

Expected: only the user's pre-existing changes remain:

~~~text
 M __tests__/components/template-editor/template-editor-panel.test.tsx
 M src/components/documents/template-editor/template-details-panel.tsx
~~~

Run: git log --oneline -9

Expected: the design commit plus the task commits are visible, with no unrelated files included.
