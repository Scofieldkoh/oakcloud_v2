import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildContentDispositionHeader, createErrorResponse } from '@/lib/api-helpers';
import { buildAcraEntityWhere } from '@/lib/acra-records-query';

const BATCH_SIZE = 1_000;

// Keep this list aligned with the AcraEntity Prisma model. Headers use the
// actual database column names so the export is suitable for re-imports.
const CSV_COLUMNS = [
  ['id', 'id'],
  ['uen', 'uen'],
  ['entityName', 'entity_name'],
  ['entityStatus', 'entity_status'],
  ['entityType', 'entity_type'],
  ['companyTypeDescription', 'company_type_description'],
  ['registrationIncorporateDate', 'registration_incorporate_date'],
  ['block', 'block'],
  ['streetName', 'street_name'],
  ['levelNo', 'level_no'],
  ['unitNo', 'unit_no'],
  ['buildingName', 'building_name'],
  ['postalCode', 'postal_code'],
  ['address', 'address'],
  ['accountDueDate', 'account_due_date'],
  ['annualReturnDate', 'annual_return_date'],
  ['primarySsicCode', 'primary_ssic_code'],
  ['primarySsicDescription', 'primary_ssic_description'],
  ['secondarySsicCode', 'secondary_ssic_code'],
  ['secondarySsicDescription', 'secondary_ssic_description'],
  ['noOfOfficers', 'no_of_officers'],
  ['formerEntityName1', 'former_entity_name1'],
  ['uenOfAuditFirm1', 'uen_of_audit_firm1'],
  ['dataAsOf', 'data_as_of'],
  ['createdAt', 'created_at'],
  ['updatedAt', 'updated_at'],
] as const;

type CsvColumnKey = (typeof CSV_COLUMNS)[number][0];

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';

  const stringValue = value instanceof Date ? value.toISOString() : String(value);
  if (!/[",\r\n]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function serializeRecord(record: Record<CsvColumnKey, unknown>): string {
  return CSV_COLUMNS.map(([key]) => escapeCsvValue(record[key])).join(',');
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (!isAdmin(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const where = buildAcraEntityWhere(searchParams);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let cursorUen: string | undefined;

        try {
          controller.enqueue(encoder.encode(`\uFEFF${CSV_COLUMNS.map(([, header]) => header).join(',')}\r\n`));

          while (true) {
            const records = await prisma.acraEntity.findMany({
              where,
              orderBy: { uen: 'asc' },
              take: BATCH_SIZE,
              ...(cursorUen ? { cursor: { uen: cursorUen }, skip: 1 } : {}),
            });

            if (records.length === 0) break;

            const rows = records.map((record) => serializeRecord(record as Record<CsvColumnKey, unknown>));
            controller.enqueue(encoder.encode(`${rows.join('\r\n')}\r\n`));
            cursorUen = records[records.length - 1].uen;

            if (records.length < BATCH_SIZE) break;
          }

          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': buildContentDispositionHeader('attachment', `acra-records-${date}.csv`),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
