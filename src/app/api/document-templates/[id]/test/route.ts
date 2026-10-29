import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import {
  extractPlaceholders,
  type PlaceholderContext,
} from '@/lib/placeholder-resolver';
import { resolvePartials } from '@/services/template-partial.service';
import { renderTemplateForGeneration } from '@/services/document-generator.service';
import { createErrorResponse } from '@/lib/api-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Type for sample company data used in testing
interface TestCompanyData {
  id: string;
  name: string;
  uen: string;
  formerName: string | null;
  entityType: string;
  status: string;
  incorporationDate: Date;
  homeCurrency: string;
  paidUpCapitalAmount: number;
  issuedCapitalAmount: number;
  financialYearEndMonth: number;
  financialYearEndDay: number;
  isGstRegistered: boolean;
  gstRegistrationNumber: string;
  addresses: {
    addressType: string;
    fullAddress: string;
    isCurrent: boolean;
  }[];
  officers: {
    name: string;
    role: string;
    nationality: string | null;
    address: string | null;
    appointmentDate: Date | null;
    cessationDate: Date | null;
    isCurrent: boolean;
    contact: {
      id: string;
      contactDetails?: Array<{ detailType: string; value: string }>;
    } | null;
  }[];
  shareholders: {
    name: string;
    shareholderType: string | null;
    nationality: string | null;
    numberOfShares: number;
    percentageHeld: number | null;
    shareClass: string | null;
    isCurrent: boolean;
    contact: {
      id: string;
      contactDetails?: Array<{ detailType: string; value: string }>;
    } | null;
  }[];
}

// Sample data for testing templates
const SAMPLE_COMPANY_DATA: TestCompanyData = {
  id: 'sample-company-id',
  name: 'Sample Company Pte Ltd',
  uen: '202301234A',
  formerName: null,
  entityType: 'Private Company Limited by Shares',
  status: 'Live',
  incorporationDate: new Date('2023-01-15'),
  homeCurrency: 'SGD',
  paidUpCapitalAmount: 100000,
  issuedCapitalAmount: 100000,
  financialYearEndMonth: 12,
  financialYearEndDay: 31,
  isGstRegistered: true,
  gstRegistrationNumber: 'M90000001A',
  addresses: [
    {
      addressType: 'REGISTERED_OFFICE',
      fullAddress: '123 Sample Street, #01-01, Singapore 123456',
      isCurrent: true,
    },
    {
      addressType: 'BUSINESS',
      fullAddress: '456 Business Park, #05-10, Singapore 654321',
      isCurrent: true,
    },
  ],
  officers: [
    {
      name: 'John Tan Wei Ming',
      role: 'DIRECTOR',
      nationality: 'Singaporean',
      address: '10 Residential Road, Singapore 111111',
      appointmentDate: new Date('2023-01-15'),
      cessationDate: null,
      isCurrent: true,
      contact: {
        id: 'sample-contact-1',
        contactDetails: [
          { detailType: 'EMAIL', value: 'john.tan@example.com' },
          { detailType: 'PHONE', value: '+65 9123 4567' },
        ],
      },
    },
    {
      name: 'Mary Lee Siew Ling',
      role: 'DIRECTOR',
      nationality: 'Singaporean',
      address: '20 Condo Avenue, Singapore 222222',
      appointmentDate: new Date('2023-01-15'),
      cessationDate: null,
      isCurrent: true,
      contact: {
        id: 'sample-contact-2',
        contactDetails: [
          { detailType: 'EMAIL', value: 'mary.lee@example.com' },
          { detailType: 'PHONE', value: '+65 9234 5678' },
        ],
      },
    },
    {
      name: 'Corporate Secretary Pte Ltd',
      role: 'SECRETARY',
      nationality: null,
      address: '30 Office Tower, Singapore 333333',
      appointmentDate: new Date('2023-01-15'),
      cessationDate: null,
      isCurrent: true,
      contact: {
        id: 'sample-contact-3',
        contactDetails: [
          { detailType: 'EMAIL', value: 'secretary@corpsec.com' },
          { detailType: 'PHONE', value: '+65 6123 4567' },
        ],
      },
    },
  ],
  shareholders: [
    {
      name: 'John Tan Wei Ming',
      shareholderType: 'INDIVIDUAL',
      nationality: 'Singaporean',
      numberOfShares: 50000,
      percentageHeld: 50,
      shareClass: 'Ordinary',
      isCurrent: true,
      contact: {
        id: 'sample-contact-1',
        contactDetails: [
          { detailType: 'EMAIL', value: 'john.tan@example.com' },
          { detailType: 'PHONE', value: '+65 9123 4567' },
        ],
      },
    },
    {
      name: 'Mary Lee Siew Ling',
      shareholderType: 'INDIVIDUAL',
      nationality: 'Singaporean',
      numberOfShares: 50000,
      percentageHeld: 50,
      shareClass: 'Ordinary',
      isCurrent: true,
      contact: {
        id: 'sample-contact-2',
        contactDetails: [
          { detailType: 'EMAIL', value: 'mary.lee@example.com' },
          { detailType: 'PHONE', value: '+65 9234 5678' },
        ]
      },
    },
  ],
};

const SAMPLE_CONTACT_DATA = {
  id: 'sample-contact-id',
  fullName: 'David Wong Keng Liang',
  firstName: 'David',
  lastName: 'Wong',
  contactType: 'CLIENT',
  email: 'david.wong@client.com',
  phone: '+65 9345 6789',
  fullAddress: '50 Client Street, Singapore 444444',
  nationality: 'Singaporean',
  identificationNumber: 'S1234567A',
};

const SAMPLE_CUSTOM_DATA = {
  resolutionNumber: '2024/001',
  effectiveDate: new Date('2024-01-01'),
  meetingDate: new Date('2024-01-15'),
  meetingTime: '10:00 AM',
  meetingVenue: 'Company Registered Office',
  previousResolutionNumber: '2023/025',
};

// Validation schema for test request
const testSchema = z.object({
  companyId: z.string().uuid().optional(), // Use real company data instead of sample
  customData: z.record(z.unknown()).optional(), // Override sample custom data
  tenantId: z.string().uuid().optional(), // For SUPER_ADMIN
});

/**
 * POST /api/document-templates/[id]/test
 * Test a template with sample or real data
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check read permission
    await requirePermission(session, 'document', 'read');

    const body = await request.json();
    const data = testSchema.parse(body);

    // Determine tenant ID
    let tenantId = session.tenantId;
    if (session.isSuperAdmin && data.tenantId) {
      tenantId = data.tenantId;
    }

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    // Fetch template
    const template = await prisma.documentTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        content: true,
        contentJson: true,
        category: true,
        placeholders: true,
      },
    });

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    let contentWithPartials = template.content;
    try {
      contentWithPartials = await resolvePartials(template.content, tenantId);
    } catch (partialError) {
      console.warn('Failed to resolve partials for template test:', partialError);
    }

    // Extract placeholders from template with partials resolved
    const placeholderKeys = extractPlaceholders(contentWithPartials);

    // Build context with sample or real data
    let companyData: TestCompanyData = SAMPLE_COMPANY_DATA;
    let usingSampleData = true;

    // If companyId provided, use real company data
    if (data.companyId) {
      const realCompany = await prisma.company.findFirst({
        where: { id: data.companyId, tenantId, deletedAt: null },
        include: {
          addresses: true,
          officers: { include: { contact: true } },
          shareholders: { include: { contact: true } },
        },
      });

      if (realCompany) {
        companyData = {
          id: realCompany.id,
          name: realCompany.name,
          uen: realCompany.uen,
          formerName: realCompany.formerName ?? null,
          entityType: realCompany.entityType,
          status: realCompany.status,
          incorporationDate: realCompany.incorporationDate ?? new Date(),
          homeCurrency: realCompany.homeCurrency ?? 'SGD',
          paidUpCapitalAmount: realCompany.paidUpCapitalAmount ? Number(realCompany.paidUpCapitalAmount) : 0,
          issuedCapitalAmount: realCompany.issuedCapitalAmount ? Number(realCompany.issuedCapitalAmount) : 0,
          financialYearEndMonth: realCompany.financialYearEndMonth ?? 12,
          financialYearEndDay: realCompany.financialYearEndDay ?? 31,
          isGstRegistered: realCompany.isGstRegistered,
          gstRegistrationNumber: realCompany.gstRegistrationNumber ?? '',
          addresses: realCompany.addresses.map((a: { addressType: string; fullAddress: string; isCurrent: boolean }) => ({
            addressType: a.addressType,
            fullAddress: a.fullAddress,
            isCurrent: a.isCurrent,
          })),
          officers: realCompany.officers.map((o: { name: string; role: string; nationality: string | null; address: string | null; appointmentDate: Date | null; cessationDate: Date | null; isCurrent: boolean; contact: { id: string; contactDetails?: Array<{ detailType: string; value: string }> } | null }) => ({
            name: o.name,
            role: o.role,
            nationality: o.nationality,
            address: o.address,
            appointmentDate: o.appointmentDate,
            cessationDate: o.cessationDate,
            isCurrent: o.isCurrent,
            contact: o.contact ? { id: o.contact.id, contactDetails: o.contact.contactDetails } : null,
          })),
          shareholders: realCompany.shareholders.map((s: { name: string; shareholderType: string | null; nationality: string | null; numberOfShares: number; percentageHeld: unknown; shareClass: string | null; isCurrent: boolean; contact: { id: string; contactDetails?: Array<{ detailType: string; value: string }> } | null }) => ({
            name: s.name,
            shareholderType: s.shareholderType,
            nationality: s.nationality,
            numberOfShares: s.numberOfShares,
            percentageHeld: s.percentageHeld ? Number(s.percentageHeld) : null,
            shareClass: s.shareClass,
            isCurrent: s.isCurrent,
            contact: s.contact ? { id: s.contact.id, contactDetails: s.contact.contactDetails } : null,
          })),
        };
        usingSampleData = false;
      }
    }

    // Get tenant name
    const tenant = await prisma.workspace.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    // Build placeholder context
    const directors = companyData.officers.filter(o => o.isCurrent && o.role === 'DIRECTOR');
    const secretaries = companyData.officers.filter(o => o.isCurrent && o.role === 'SECRETARY');
    const shareholders = companyData.shareholders.filter(s => s.isCurrent);
    const registeredAddress = companyData.addresses.find(
      a => a.addressType === 'REGISTERED_OFFICE' && a.isCurrent
    )?.fullAddress || null;

    const context: PlaceholderContext = {
      company: {
        ...companyData,
        registeredAddress,
      } as PlaceholderContext['company'],
      contact: SAMPLE_CONTACT_DATA,
      custom: {
        ...SAMPLE_CUSTOM_DATA,
        ...data.customData,
        directors,
        secretaries,
        shareholders,
        firstDirector: directors[0] || null,
        firstSecretary: secretaries[0] || null,
        directorCount: directors.length,
        shareholderCount: shareholders.length,
      },
      system: {
        currentDate: new Date(),
        tenantName: tenant?.name,
        generatedBy: `${session.firstName} ${session.lastName}`.trim(),
      },
    };

    const rendered = await renderTemplateForGeneration({
      templateId: id,
      tenantId,
      customData: data.customData,
      contextOverride: context,
      generatedBy: `${session.firstName} ${session.lastName}`.trim(),
      mode: 'test',
    });

    return NextResponse.json({
      test: {
        content: rendered.content,
        sections: rendered.sections,
        unresolvedPlaceholders: rendered.missingPlaceholders,
        missingPartials: rendered.missingPartials,
        blockingErrors: rendered.blockingErrors,
        usingSampleData,
      },
      template: {
        id: template.id,
        name: template.name,
        category: template.category,
        extractedPlaceholders: placeholderKeys,
      },
      sampleData: usingSampleData ? {
        company: companyData,
        contact: SAMPLE_CONTACT_DATA,
        custom: SAMPLE_CUSTOM_DATA,
      } : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return createErrorResponse(error);
  }
}
