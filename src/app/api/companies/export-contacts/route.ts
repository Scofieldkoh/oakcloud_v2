import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { requireWorkspaceContext } from '@/lib/api-helpers';
import { getContactDetailsForExport } from '@/services/contact-detail.service';
import { exportContactDetailsSchema } from '@/lib/validations/contact-detail';
import { ZodError } from 'zod';
import ExcelJS from 'exceljs';
import { routeErrorResponse } from '@/lib/api-route-errors';

/**
 * POST /api/companies/export-contacts
 * Export contact details for selected companies to Excel
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Check export permission (tenant-level since this spans multiple companies)
    await requirePermission(session, 'company', 'export');

    const body = await request.json();

    // Parse and validate input
    const { companyIds, tenantId: bodyTenantId } = body;
    exportContactDetailsSchema.parse({ companyIds });

    // Resolve tenant context - SUPER_ADMIN can specify via body
    const tenantResult = await requireWorkspaceContext(session, bodyTenantId);
    if (tenantResult.error) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    // Verify access to all companies
    for (const companyId of companyIds) {
      if (!(await canAccessCompany(session, companyId))) {
        return NextResponse.json(
          { error: `Access denied to company ${companyId}` },
          { status: 403 }
        );
      }
    }

    // Get export data
    const exportData = await getContactDetailsForExport(companyIds, tenantId);

    // Pivot data: group by company + contact (with relationships concatenated), types as columns
    interface PivotedRow {
      companyName: string;
      companyUen: string;
      contactName: string;
      relationships: Set<string>;
      isPoc: boolean;
      email: string[];
      phone: string[];
      website: string[];
      other: string[];
    }

    const pivotMap = new Map<string, PivotedRow>();
    // Separate map for company-level details (keyed by company + label)
    const companyLevelMap = new Map<string, PivotedRow>();

    for (const detail of exportData) {
      // Company-level details: use label as the "contact name", each label is a separate row
      if (detail.contactName === null) {
        const labelKey = `${detail.companyName}|${detail.label || '(Unlabeled)'}`;

        if (!companyLevelMap.has(labelKey)) {
          companyLevelMap.set(labelKey, {
            companyName: detail.companyName,
            companyUen: detail.companyUen,
            contactName: detail.label || '(Company-level)',
            relationships: new Set(),
            isPoc: false,
            email: [],
            phone: [],
            website: [],
            other: [],
          });
        }

        const row = companyLevelMap.get(labelKey)!;

        // Add value (without label since label is used as contact name)
        switch (detail.detailType) {
          case 'EMAIL':
            row.email.push(detail.value);
            break;
          case 'PHONE':
            row.phone.push(detail.value);
            break;
          case 'WEBSITE':
            row.website.push(detail.value);
            break;
          default:
            row.other.push(detail.value);
            break;
        }
      } else {
        // Contact-level details: group by company + contact, concatenate relationships
        const key = `${detail.companyName}|${detail.contactName}`;

        if (!pivotMap.has(key)) {
          pivotMap.set(key, {
            companyName: detail.companyName,
            companyUen: detail.companyUen,
            contactName: detail.contactName,
            relationships: new Set(),
            isPoc: detail.isPoc,
            email: [],
            phone: [],
            website: [],
            other: [],
          });
        }

        const row = pivotMap.get(key)!;

        // Add relationship to set (will be concatenated later)
        if (detail.relationship) {
          row.relationships.add(detail.relationship);
        }

        // Update isPoc if any detail for this contact has isPoc true
        if (detail.isPoc) row.isPoc = true;

        // Format value with label if present
        const formattedValue = detail.label ? `${detail.value} (${detail.label})` : detail.value;

        // Add to appropriate type column (avoid duplicates)
        switch (detail.detailType) {
          case 'EMAIL':
            if (!row.email.includes(formattedValue)) row.email.push(formattedValue);
            break;
          case 'PHONE':
            if (!row.phone.includes(formattedValue)) row.phone.push(formattedValue);
            break;
          case 'WEBSITE':
            if (!row.website.includes(formattedValue)) row.website.push(formattedValue);
            break;
          default:
            if (!row.other.includes(formattedValue)) row.other.push(formattedValue);
            break;
        }
      }
    }

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Oakcloud';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Contact Details');

    // Define columns with types pivoted into separate columns
    worksheet.columns = [
      { header: 'Company Name', key: 'companyName', width: 30 },
      { header: 'UEN', key: 'companyUen', width: 15 },
      { header: 'Contact Name', key: 'contactName', width: 25 },
      { header: 'Relationship', key: 'relationship', width: 20 },
      { header: 'Point of Contact', key: 'isPoc', width: 15 },
      { header: 'Email', key: 'email', width: 35 },
      { header: 'Phone', key: 'phone', width: 25 },
      { header: 'Website', key: 'website', width: 35 },
      { header: 'Other', key: 'other', width: 30 },
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF294D44' },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data rows - first company-level, then contact-level
    // Company-level rows (labels as contact names)
    for (const row of companyLevelMap.values()) {
      worksheet.addRow({
        companyName: row.companyName,
        companyUen: row.companyUen,
        contactName: row.contactName,
        relationship: '-',
        isPoc: '-',
        email: row.email.join(', ') || '-',
        phone: row.phone.join(', ') || '-',
        website: row.website.join(', ') || '-',
        other: row.other.join(', ') || '-',
      });
    }

    // Contact-level rows (with concatenated relationships)
    for (const row of pivotMap.values()) {
      worksheet.addRow({
        companyName: row.companyName,
        companyUen: row.companyUen,
        contactName: row.contactName,
        relationship: row.relationships.size > 0 ? Array.from(row.relationships).join(', ') : '-',
        isPoc: row.isPoc ? 'Yes' : '-',
        email: row.email.join(', ') || '-',
        phone: row.phone.join(', ') || '-',
        website: row.website.join(', ') || '-',
        other: row.other.join(', ') || '-',
      });
    }

    // Add alternating row colors
    for (let i = 2; i <= worksheet.rowCount; i++) {
      if (i % 2 === 0) {
        worksheet.getRow(i).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF7FBFA' },
        };
      }
    }

    // Add borders to all cells
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E4E9' } },
          left: { style: 'thin', color: { argb: 'FFE2E4E9' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E4E9' } },
          right: { style: 'thin', color: { argb: 'FFE2E4E9' } },
        };
      });
    });

    // Freeze header row
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `contact-details-${timestamp}.xlsx`;

    // Return the file
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    return routeErrorResponse(error, { logLabel: 'Error exporting contact details:' });
  }
}

