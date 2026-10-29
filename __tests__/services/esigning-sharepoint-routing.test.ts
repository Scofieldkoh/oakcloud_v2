import { describe, expect, it } from 'vitest';
import { snapshotFilingRoute } from '@/services/esigning-sharepoint-filing/routing';

const orphan = { driveId: 'drive', itemId: 'orphan', name: 'Unassigned', webUrl: 'https://example.test/orphan' };
const mapping = { connectorId: 'connector', driveId: 'drive', folderItemId: 'company' };

describe('signed-document SharePoint routing', () => {
  it('routes a mapped templated document to the intended path', () => expect(snapshotFilingRoute({ connectorId: 'connector', configVersion: 2, companyId: 'company', companyName: 'Acme', mapping, templateId: 'template', templateVersion: 3, relativePath: 'Agreements/2026', orphanFolder: orphan })).toMatchObject({ destinationKind: 'INTENDED', routingReason: 'TEMPLATE_ROUTE', intendedRelativePath: 'Agreements/2026' }));

  it('routes a mapped manual document directly to the company folder root', () => expect(snapshotFilingRoute({ connectorId: 'connector', configVersion: 2, companyId: 'company', companyName: 'Acme', mapping, templateId: null, relativePath: null, orphanFolder: orphan })).toMatchObject({
    destinationKind: 'INTENDED',
    routingReason: 'MANUAL_DOCUMENT',
    intendedCompanyDriveId: 'drive',
    intendedCompanyFolderId: 'company',
    intendedRelativePath: null,
  }));

  it.each([
    [{}, 'NO_COMPANY_MAPPING'],
    [{ mapping, templateId: 'template', relativePath: null }, 'NO_TEMPLATE_PATH'],
    [{ mapping, templateId: 'template', relativePath: 'bad:name' }, 'DESTINATION_PATH_INVALID'],
  ])('keeps %s on the orphan route', (input, reason) => expect(snapshotFilingRoute({ connectorId: 'connector', configVersion: 1, orphanFolder: orphan, ...(input as object) })).toMatchObject({ destinationKind: 'ORPHAN', routingReason: reason }));
});
