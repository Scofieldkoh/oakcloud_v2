/**
 * Admin Data Purge API Routes
 *
 * GET   /api/admin/purge - Get soft-deleted records available for purging
 * POST  /api/admin/purge - Permanently delete soft-deleted records
 * PATCH /api/admin/purge - Restore soft-deleted records
 *
 * SUPER_ADMIN only - for managing soft-deleted data
 */

import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { clientErrorMessage } from '@/lib/api-route-errors';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { storage } from '@/lib/storage';
import { createLogger } from '@/lib/logger';
import { permanentlyDeleteGeneratedDocument } from '@/services/generated-document-purge.service';
import {
  permanentlyDeleteDocumentTemplate,
  permanentlyDeleteTemplatePartial,
  restoreTemplatePartials,
} from '@/services/document-library-purge.service';
import { restoreDocumentTemplate } from '@/services/document-template.service';
import { getDocumentTemplateDisplayEngine } from '@/lib/document-editor/document-engine';

const log = createLogger('admin-purge');

const PURGEABLE_ENTITIES = [
  'user',
  'company',
  'contact',
  'generatedDocument',
  'processingDocument',
  'documentTemplate',
  'templatePartial',
] as const;

export type PurgeableEntity = typeof PURGEABLE_ENTITIES[number];

const INVALID_ENTITY_MESSAGE = `Invalid entity type. Must be one of: ${PURGEABLE_ENTITIES.join(', ')}`;

interface PurgeStats {
  users: number;
  companies: number;
  contacts: number;
  generatedDocuments: number;
  processingDocuments: number;
  documentTemplates: number;
  templatePartials: number;
}

/**
 * GET - Retrieve counts and records of soft-deleted data
 */
export async function GET() {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get counts of soft-deleted records
    const [
      users,
      companies,
      contacts,
      generatedDocuments,
      processingDocuments,
      documentTemplates,
      templatePartials,
    ] = await Promise.all([
      prisma.user.findMany({
        where: { deletedAt: { not: null } },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          deletedAt: true,
          tenant: {
            select: { name: true },
          },
        },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.company.findMany({
        where: { deletedAt: { not: null } },
        select: {
          id: true,
          name: true,
          uen: true,
          deletedAt: true,
          deletedReason: true,
          tenant: {
            select: { name: true },
          },
          _count: {
            select: {
              documents: true,
              officers: true,
              shareholders: true,
            },
          },
        },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.contact.findMany({
        where: { deletedAt: { not: null } },
        select: {
          id: true,
          fullName: true,
          deletedAt: true,
          tenant: {
            select: { name: true },
          },
        },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.generatedDocument.findMany({
        where: { deletedAt: { not: null } },
        select: {
          id: true,
          title: true,
          status: true,
          deletedAt: true,
          tenant: {
            select: { name: true },
          },
          template: {
            select: { name: true },
          },
          company: {
            select: { name: true },
          },
          createdBy: {
            select: { firstName: true, lastName: true },
          },
        },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.processingDocument.findMany({
        where: { deletedAt: { not: null } },
        include: {
          document: {
            select: {
              fileName: true,
              tenant: { select: { name: true } },
              company: { select: { name: true } },
            },
          },
          currentRevision: {
            select: {
              vendorName: true,
              documentNumber: true,
              documentCategory: true,
            },
          },
        },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.documentTemplate.findMany({
        where: { deletedAt: { not: null } },
        select: {
          id: true,
          name: true,
          contentJson: true,
          deletedAt: true,
          tenant: { select: { name: true } },
          _count: { select: { generatedDocuments: true } },
        },
        orderBy: { deletedAt: 'desc' },
      }),
      prisma.templatePartial.findMany({
        where: { deletedAt: { not: null } },
        select: {
          id: true,
          name: true,
          displayName: true,
          contentJson: true,
          deletedAt: true,
          tenant: { select: { name: true } },
        },
        orderBy: { deletedAt: 'desc' },
      }),
    ]);

    const stats: PurgeStats = {
      users: users.length,
      companies: companies.length,
      contacts: contacts.length,
      generatedDocuments: generatedDocuments.length,
      processingDocuments: processingDocuments.length,
      documentTemplates: documentTemplates.length,
      templatePartials: templatePartials.length,
    };

    return NextResponse.json({
      stats,
      records: {
        users,
        companies,
        contacts,
        generatedDocuments,
        processingDocuments,
        documentTemplates: documentTemplates.map(({ contentJson, ...template }) => ({
          ...template,
          documentEngine: getDocumentTemplateDisplayEngine(contentJson),
        })),
        templatePartials: templatePartials.map(({ contentJson, ...partial }) => ({
          ...partial,
          documentEngine: getDocumentTemplateDisplayEngine(contentJson),
        })),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * POST - Permanently delete soft-deleted records
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { entityType, entityIds, reason } = body as {
      entityType: PurgeableEntity;
      entityIds: string[];
      reason: string;
    };

    // Validate inputs
    if (!entityType || !PURGEABLE_ENTITIES.includes(entityType)) {
      return NextResponse.json({ error: INVALID_ENTITY_MESSAGE }, { status: 400 });
    }

    if (!entityIds || !Array.isArray(entityIds) || entityIds.length === 0) {
      return NextResponse.json(
        { error: 'Entity IDs are required' },
        { status: 400 }
      );
    }

    if (!reason || reason.length < 10) {
      return NextResponse.json(
        { error: 'Reason must be at least 10 characters' },
        { status: 400 }
      );
    }

    let deletedCount = 0;
    const deletedRecords: { id: string; name: string }[] = [];
    const failedRecords: { id: string; name: string; error: string }[] = [];

    switch (entityType) {
      case 'user':
        const usersToDelete = await prisma.user.findMany({
          where: {
            id: { in: entityIds },
            deletedAt: { not: null },
          },
          select: { id: true, email: true, firstName: true, lastName: true },
        });

        if (usersToDelete.length === 0) {
          return NextResponse.json(
            { error: 'No soft-deleted users found with the provided IDs' },
            { status: 404 }
          );
        }

        for (const user of usersToDelete) {
          const userName = `${user.firstName} ${user.lastName}`;
          try {
            await prisma.$transaction(async (tx) => {
              // Delete role assignments
              await tx.userRoleAssignment.deleteMany({
                where: { userId: user.id },
              });

              // Delete company assignments
              await tx.userCompanyAssignment.deleteMany({
                where: { userId: user.id },
              });

              // Delete user
              await tx.user.delete({
                where: { id: user.id },
              });
            });

            deletedRecords.push({ id: user.id, name: userName });
            deletedCount++;
          } catch (err) {
            const errorMessage = clientErrorMessage(err, 'Could not purge this record');
            console.error(`Failed to purge user ${user.id}:`, err);
            failedRecords.push({ id: user.id, name: userName, error: errorMessage });
          }
        }
        break;

      case 'company':
        const companiesToDelete = await prisma.company.findMany({
          where: {
            id: { in: entityIds },
            deletedAt: { not: null },
          },
          select: { id: true, name: true, uen: true },
        });

        if (companiesToDelete.length === 0) {
          return NextResponse.json(
            { error: 'No soft-deleted companies found with the provided IDs' },
            { status: 404 }
          );
        }

        for (const company of companiesToDelete) {
          try {
            // Get all documents and their storage keys before deletion
            const documentsWithStorage = await prisma.document.findMany({
              where: { companyId: company.id },
              select: { storageKey: true },
            });

            // Get all processing documents with their related files
            const processingDocs = await prisma.processingDocument.findMany({
              where: { document: { companyId: company.id } },
              include: {
                pages: { select: { storageKey: true } },
                derivedFiles: { select: { storageKey: true } },
              },
            });

            // Collect all storage keys
            const storageKeysToDelete: string[] = [];
            for (const doc of documentsWithStorage) {
              if (doc.storageKey) storageKeysToDelete.push(doc.storageKey);
            }
            for (const procDoc of processingDocs) {
              for (const page of procDoc.pages) {
                if (page.storageKey) storageKeysToDelete.push(page.storageKey);
              }
              for (const derivedFile of procDoc.derivedFiles) {
                if (derivedFile.storageKey) storageKeysToDelete.push(derivedFile.storageKey);
              }
            }

            // Delete files from storage
            for (const key of storageKeysToDelete) {
              try {
                await storage.delete(key);
              } catch (storageErr) {
                log.warn(`Failed to delete file from storage: ${key}`, storageErr);
              }
            }

            await prisma.$transaction(async (tx) => {
              // Delete company-related data
              await tx.companyCharge.deleteMany({
                where: { companyId: company.id },
              });
              await tx.companyShareholder.deleteMany({
                where: { companyId: company.id },
              });
              await tx.shareCapital.deleteMany({
                where: { companyId: company.id },
              });
              await tx.companyOfficer.deleteMany({
                where: { companyId: company.id },
              });
              await tx.companyAddress.deleteMany({
                where: { companyId: company.id },
              });
              await tx.companyFormerName.deleteMany({
                where: { companyId: company.id },
              });
              await tx.companyContact.deleteMany({
                where: { companyId: company.id },
              });

              // Delete processing document related data first
              for (const procDoc of processingDocs) {
                await tx.documentRevisionLineItem.deleteMany({
                  where: { revision: { processingDocumentId: procDoc.id } },
                });
                await tx.documentRevision.deleteMany({
                  where: { processingDocumentId: procDoc.id },
                });
                await tx.processingAttempt.deleteMany({
                  where: { processingDocumentId: procDoc.id },
                });
                await tx.processingCheckpoint.deleteMany({
                  where: { processingDocumentId: procDoc.id },
                });
                await tx.documentStateEvent.deleteMany({
                  where: { processingDocumentId: procDoc.id },
                });
                await tx.documentDerivedFile.deleteMany({
                  where: { processingDocumentId: procDoc.id },
                });
                await tx.documentExtraction.deleteMany({
                  where: { processingDocumentId: procDoc.id },
                });
                await tx.documentPage.deleteMany({
                  where: { processingDocumentId: procDoc.id },
                });
                await tx.duplicateDecision.deleteMany({
                  where: { processingDocumentId: procDoc.id },
                });
                await tx.splitPlan.deleteMany({
                  where: { processingDocumentId: procDoc.id },
                });
                await tx.processingDocument.delete({
                  where: { id: procDoc.id },
                });
              }

              // Delete documents
              await tx.document.deleteMany({
                where: { companyId: company.id },
              });

              // Delete user company assignments
              await tx.userCompanyAssignment.deleteMany({
                where: { companyId: company.id },
              });

              // Delete role assignments scoped to this company
              await tx.userRoleAssignment.deleteMany({
                where: { companyId: company.id },
              });

              // Delete service agreements where this company is the primary company
              const ownedAgreementIds = (
                await tx.serviceAgreement.findMany({
                  where: { primaryCompanyId: company.id },
                  select: { id: true },
                })
              ).map((a) => a.id);

              const ownedItemIds = ownedAgreementIds.length
                ? (
                    await tx.serviceAgreementItem.findMany({
                      where: { agreementId: { in: ownedAgreementIds } },
                      select: { id: true },
                    })
                  ).map((i) => i.id)
                : [];

              // Delete client services referencing this company or its agreements
              const clientServiceIds = (
                await tx.clientService.findMany({
                  where: {
                    OR: [
                      { companyId: company.id },
                      ...(ownedAgreementIds.length ? [{ agreementId: { in: ownedAgreementIds } }] : []),
                      ...(ownedItemIds.length ? [{ agreementItemId: { in: ownedItemIds } }] : []),
                    ],
                  },
                  select: { id: true },
                })
              ).map((c) => c.id);

              await tx.clientServiceFeeLine.deleteMany({
                where: { clientServiceId: { in: clientServiceIds } },
              });
              await tx.clientService.deleteMany({
                where: { id: { in: clientServiceIds } },
              });

              // Delete service agreement entities referencing this company
              await tx.serviceAgreementEntity.deleteMany({
                where: { companyId: company.id },
              });

              // Delete service agreements where this company is the primary company
              await tx.serviceAgreement.deleteMany({
                where: { id: { in: ownedAgreementIds } },
              });

              // Delete document generation batches referencing this company
              await tx.documentGenerationBatch.deleteMany({
                where: { primaryCompanyId: company.id },
              });

              // Delete the company
              await tx.company.delete({
                where: { id: company.id },
              });
            });

            log.info(`Purged company ${company.id} with ${storageKeysToDelete.length} files`);
            deletedRecords.push({ id: company.id, name: company.name });
            deletedCount++;
          } catch (err) {
            const errorMessage = clientErrorMessage(err, 'Could not purge this record');
            console.error(`Failed to purge company ${company.id}:`, err);
            failedRecords.push({ id: company.id, name: company.name, error: errorMessage });
          }
        }
        break;

      case 'contact':
        const contactsToDelete = await prisma.contact.findMany({
          where: {
            id: { in: entityIds },
            deletedAt: { not: null },
          },
          select: { id: true, fullName: true },
        });

        if (contactsToDelete.length === 0) {
          return NextResponse.json(
            { error: 'No soft-deleted contacts found with the provided IDs' },
            { status: 404 }
          );
        }

        for (const contact of contactsToDelete) {
          try {
            await prisma.$transaction(async (tx) => {
              // Delete company contact relations
              await tx.companyContact.deleteMany({
                where: { contactId: contact.id },
              });

              // Update officers to remove contact reference
              await tx.companyOfficer.updateMany({
                where: { contactId: contact.id },
                data: { contactId: null },
              });

              // Update shareholders to remove contact reference
              await tx.companyShareholder.updateMany({
                where: { contactId: contact.id },
                data: { contactId: null },
              });

              // Update charges to remove contact reference
              await tx.companyCharge.updateMany({
                where: { chargeHolderId: contact.id },
                data: { chargeHolderId: null },
              });

              // Delete the contact
              await tx.contact.delete({
                where: { id: contact.id },
              });
            });

            deletedRecords.push({ id: contact.id, name: contact.fullName });
            deletedCount++;
          } catch (err) {
            const errorMessage = clientErrorMessage(err, 'Could not purge this record');
            console.error(`Failed to purge contact ${contact.id}:`, err);
            failedRecords.push({ id: contact.id, name: contact.fullName, error: errorMessage });
          }
        }
        break;

      case 'generatedDocument':
        const documentsToDelete = await prisma.generatedDocument.findMany({
          where: {
            id: { in: entityIds },
            deletedAt: { not: null },
          },
          select: { id: true, title: true, tenantId: true },
        });

        if (documentsToDelete.length === 0) {
          return NextResponse.json(
            { error: 'No soft-deleted generated documents found with the provided IDs' },
            { status: 404 }
          );
        }

        for (const doc of documentsToDelete) {
          try {
            // Shared with the Generated Documents page: refuses documents that
            // are out for signature or back live service agreements, removes
            // stored files and writes the audit entry.
            await permanentlyDeleteGeneratedDocument(
              doc.id,
              { tenantId: doc.tenantId, userId: session.id },
              reason,
            );

            deletedRecords.push({ id: doc.id, name: doc.title });
            deletedCount++;
          } catch (err) {
            const errorMessage = clientErrorMessage(err, 'Could not purge this record');
            console.error(`Failed to purge generated document ${doc.id}:`, err);
            failedRecords.push({ id: doc.id, name: doc.title, error: errorMessage });
          }
        }
        break;

      case 'documentTemplate':
      case 'templatePartial': {
        const purgeOne = entityType === 'documentTemplate'
          ? permanentlyDeleteDocumentTemplate
          : permanentlyDeleteTemplatePartial;
        for (const id of entityIds) {
          try {
            const removed = await purgeOne(id);
            deletedRecords.push(removed);
            deletedCount++;
          } catch (err) {
            const errorMessage = clientErrorMessage(err, 'Could not purge this record');
            log.warn('Failed to purge document library record', { entityType, id, error: err instanceof Error ? err.message : String(err) });
            failedRecords.push({ id, name: id, error: errorMessage });
          }
        }
        break;
      }

      case 'processingDocument':
        const processingDocsToDelete = await prisma.processingDocument.findMany({
          where: {
            id: { in: entityIds },
            deletedAt: { not: null },
          },
          include: {
            document: {
              select: { fileName: true, storageKey: true },
            },
            pages: {
              select: { storageKey: true },
            },
            derivedFiles: {
              select: { storageKey: true },
            },
          },
        });

        if (processingDocsToDelete.length === 0) {
          return NextResponse.json(
            { error: 'No soft-deleted processing documents found with the provided IDs' },
            { status: 404 }
          );
        }

        for (const procDoc of processingDocsToDelete) {
          const docName = procDoc.document?.fileName || procDoc.id;
          try {
            // Collect all storage keys to delete
            const storageKeysToDelete: string[] = [];

            // Add original document storage key
            if (procDoc.document?.storageKey) {
              storageKeysToDelete.push(procDoc.document.storageKey);
            }

            // Add page image storage keys
            for (const page of procDoc.pages) {
              if (page.storageKey) {
                storageKeysToDelete.push(page.storageKey);
              }
            }

            // Add derived file storage keys
            for (const derivedFile of procDoc.derivedFiles) {
              if (derivedFile.storageKey) {
                storageKeysToDelete.push(derivedFile.storageKey);
              }
            }

            // Delete files from storage first
            for (const key of storageKeysToDelete) {
              try {
                await storage.delete(key);
                log.debug(`Deleted file from storage: ${key}`);
              } catch (storageErr) {
                // Log but continue - file might not exist
                log.warn(`Failed to delete file from storage: ${key}`, storageErr);
              }
            }

            await prisma.$transaction(async (tx) => {
              // Delete line items for all revisions
              await tx.documentRevisionLineItem.deleteMany({
                where: {
                  revision: {
                    processingDocumentId: procDoc.id,
                  },
                },
              });

              // Delete all revisions
              await tx.documentRevision.deleteMany({
                where: { processingDocumentId: procDoc.id },
              });

              // Delete processing attempts
              await tx.processingAttempt.deleteMany({
                where: { processingDocumentId: procDoc.id },
              });

              // Delete processing checkpoints
              await tx.processingCheckpoint.deleteMany({
                where: { processingDocumentId: procDoc.id },
              });

              // Delete state events
              await tx.documentStateEvent.deleteMany({
                where: { processingDocumentId: procDoc.id },
              });

              // Delete derived files
              await tx.documentDerivedFile.deleteMany({
                where: { processingDocumentId: procDoc.id },
              });

              // Delete extractions
              await tx.documentExtraction.deleteMany({
                where: { processingDocumentId: procDoc.id },
              });

              // Delete pages
              await tx.documentPage.deleteMany({
                where: { processingDocumentId: procDoc.id },
              });

              // Delete duplicate decisions
              await tx.duplicateDecision.deleteMany({
                where: { processingDocumentId: procDoc.id },
              });

              // Delete split plans
              await tx.splitPlan.deleteMany({
                where: { processingDocumentId: procDoc.id },
              });

              // Delete the processing document
              await tx.processingDocument.delete({
                where: { id: procDoc.id },
              });

              // Delete the underlying document
              if (procDoc.documentId) {
                await tx.document.delete({
                  where: { id: procDoc.documentId },
                });
              }
            });

            log.info(`Purged processing document ${procDoc.id} with ${storageKeysToDelete.length} files`);
            deletedRecords.push({ id: procDoc.id, name: docName });
            deletedCount++;
          } catch (err) {
            const errorMessage = clientErrorMessage(err, 'Could not purge this record');
            console.error(`Failed to purge processing document ${procDoc.id}:`, err);
            failedRecords.push({ id: procDoc.id, name: docName, error: errorMessage });
          }
        }
        break;
    }

    // Log the purge action (only if at least one record was deleted)
    if (deletedCount > 0) {
      const recordNames = deletedRecords.map(r => r.name).join(', ');
      await createAuditLog({
        userId: session.id,
        action: 'DELETE',
        entityType: `Purge_${entityType}`,
        entityId: deletedRecords.map(r => r.id).join(','),
        entityName: recordNames,
        summary: `Permanently deleted ${deletedCount} ${entityType}(s): ${recordNames}`,
        changeSource: 'MANUAL',
        reason,
        metadata: {
          purgeType: 'permanent',
          entityType,
          deletedCount,
          deletedRecords,
          failedCount: failedRecords.length,
          failedRecords: failedRecords.length > 0 ? failedRecords : undefined,
        },
      });
    }

    // Determine success status based on results
    const hasFailures = failedRecords.length > 0;
    const allFailed = deletedCount === 0 && hasFailures;

    if (allFailed) {
      return NextResponse.json({
        success: false,
        message: `Failed to delete all ${entityType}(s)`,
        deletedCount: 0,
        deletedRecords: [],
        failedCount: failedRecords.length,
        failedRecords,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: hasFailures
        ? `Deleted ${deletedCount} ${entityType}(s), ${failedRecords.length} failed`
        : `Permanently deleted ${deletedCount} ${entityType}(s)`,
      deletedCount,
      deletedRecords,
      ...(hasFailures && {
        failedCount: failedRecords.length,
        failedRecords,
      }),
    });
  } catch (error) {
    console.error('Purge error:', error);
    return createErrorResponse(error);
  }
}

/**
 * PATCH - Restore soft-deleted records
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { entityType, entityIds } = body as {
      entityType: PurgeableEntity;
      entityIds: string[];
    };

    // Validate inputs
    if (!entityType || !PURGEABLE_ENTITIES.includes(entityType)) {
      return NextResponse.json({ error: INVALID_ENTITY_MESSAGE }, { status: 400 });
    }

    if (!entityIds || !Array.isArray(entityIds) || entityIds.length === 0) {
      return NextResponse.json(
        { error: 'Entity IDs are required' },
        { status: 400 }
      );
    }

    let restoredCount = 0;
    const restoredRecords: { id: string; name: string }[] = [];

    switch (entityType) {
      case 'user':
        const usersToRestore = await prisma.user.findMany({
          where: {
            id: { in: entityIds },
            deletedAt: { not: null },
          },
          select: { id: true, firstName: true, lastName: true, tenantId: true },
        });

        if (usersToRestore.length === 0) {
          return NextResponse.json(
            { error: 'No soft-deleted users found with the provided IDs' },
            { status: 404 }
          );
        }

        // Check if parent workspace is active
        for (const user of usersToRestore) {
          if (!user.tenantId) continue;
          const workspace = await prisma.workspace.findUnique({
            where: { id: user.tenantId },
            select: { deletedAt: true, status: true },
          });

          if (workspace?.deletedAt) {
            return NextResponse.json(
              { error: `Cannot restore user "${user.firstName} ${user.lastName}" - parent workspace is deleted. Restore the workspace first.` },
              { status: 400 }
            );
          }
        }

        await prisma.user.updateMany({
          where: { id: { in: entityIds }, deletedAt: { not: null } },
          data: {
            deletedAt: null,
            isActive: false, // Set inactive so admin can review before activating
          },
        });

        for (const user of usersToRestore) {
          restoredRecords.push({ id: user.id, name: `${user.firstName} ${user.lastName}` });
        }
        restoredCount = usersToRestore.length;
        break;

      case 'company':
        const companiesToRestore = await prisma.company.findMany({
          where: {
            id: { in: entityIds },
            deletedAt: { not: null },
          },
          select: { id: true, name: true, tenantId: true },
        });

        if (companiesToRestore.length === 0) {
          return NextResponse.json(
            { error: 'No soft-deleted companies found with the provided IDs' },
            { status: 404 }
          );
        }

        // Check if parent workspace is active
        for (const company of companiesToRestore) {
          if (!company.tenantId) continue;
          const workspace = await prisma.workspace.findUnique({
            where: { id: company.tenantId },
            select: { deletedAt: true },
          });

          if (workspace?.deletedAt) {
            return NextResponse.json(
              { error: `Cannot restore company "${company.name}" - parent workspace is deleted. Restore the workspace first.` },
              { status: 400 }
            );
          }
        }

        await prisma.company.updateMany({
          where: { id: { in: entityIds }, deletedAt: { not: null } },
          data: {
            deletedAt: null,
            deletedReason: null,
          },
        });

        for (const company of companiesToRestore) {
          restoredRecords.push({ id: company.id, name: company.name });
        }
        restoredCount = companiesToRestore.length;
        break;

      case 'contact':
        const contactsToRestore = await prisma.contact.findMany({
          where: {
            id: { in: entityIds },
            deletedAt: { not: null },
          },
          select: { id: true, fullName: true, tenantId: true },
        });

        if (contactsToRestore.length === 0) {
          return NextResponse.json(
            { error: 'No soft-deleted contacts found with the provided IDs' },
            { status: 404 }
          );
        }

        // Check if parent workspace is active
        for (const contact of contactsToRestore) {
          if (!contact.tenantId) continue;
          const workspace = await prisma.workspace.findUnique({
            where: { id: contact.tenantId },
            select: { deletedAt: true },
          });

          if (workspace?.deletedAt) {
            return NextResponse.json(
              { error: `Cannot restore contact "${contact.fullName}" - parent workspace is deleted. Restore the workspace first.` },
              { status: 400 }
            );
          }
        }

        await prisma.contact.updateMany({
          where: { id: { in: entityIds }, deletedAt: { not: null } },
          data: {
            deletedAt: null,
          },
        });

        for (const contact of contactsToRestore) {
          restoredRecords.push({ id: contact.id, name: contact.fullName });
        }
        restoredCount = contactsToRestore.length;
        break;

      case 'generatedDocument':
        const documentsToRestore = await prisma.generatedDocument.findMany({
          where: {
            id: { in: entityIds },
            deletedAt: { not: null },
          },
          select: { id: true, title: true, tenantId: true },
        });

        if (documentsToRestore.length === 0) {
          return NextResponse.json(
            { error: 'No soft-deleted generated documents found with the provided IDs' },
            { status: 404 }
          );
        }

        // Check if parent workspace is active
        for (const doc of documentsToRestore) {
          if (!doc.tenantId) continue;
          const workspace = await prisma.workspace.findUnique({
            where: { id: doc.tenantId },
            select: { deletedAt: true },
          });

          if (workspace?.deletedAt) {
            return NextResponse.json(
              { error: `Cannot restore document "${doc.title}" - parent workspace is deleted. Restore the workspace first.` },
              { status: 400 }
            );
          }
        }

        await prisma.generatedDocument.updateMany({
          where: { id: { in: entityIds }, deletedAt: { not: null } },
          data: {
            deletedAt: null,
          },
        });

        for (const doc of documentsToRestore) {
          restoredRecords.push({ id: doc.id, name: doc.title });
        }
        restoredCount = documentsToRestore.length;
        break;

      case 'documentTemplate': {
        const templatesToRestore = await prisma.documentTemplate.findMany({
          where: { id: { in: entityIds }, deletedAt: { not: null } },
          select: { id: true, name: true, tenantId: true },
        });
        if (templatesToRestore.length === 0) {
          return NextResponse.json(
            { error: 'No deleted templates found with the provided IDs' },
            { status: 404 }
          );
        }
        for (const template of templatesToRestore) {
          await restoreDocumentTemplate(template.id, { tenantId: template.tenantId, userId: session.id });
          restoredRecords.push({ id: template.id, name: template.name });
        }
        restoredCount = templatesToRestore.length;
        break;
      }

      case 'templatePartial': {
        const restored = await restoreTemplatePartials(entityIds);
        if (restored.length === 0) {
          return NextResponse.json(
            { error: 'No deleted partials found with the provided IDs' },
            { status: 404 }
          );
        }
        restoredRecords.push(...restored);
        restoredCount = restored.length;
        break;
      }

      case 'processingDocument':
        const processingDocsToRestore = await prisma.processingDocument.findMany({
          where: {
            id: { in: entityIds },
            deletedAt: { not: null },
          },
          include: {
            document: {
              select: {
                fileName: true,
                tenantId: true,
                tenant: { select: { deletedAt: true } },
              },
            },
          },
        });

        if (processingDocsToRestore.length === 0) {
          return NextResponse.json(
            { error: 'No soft-deleted processing documents found with the provided IDs' },
            { status: 404 }
          );
        }

        // Check if parent workspace is active
        for (const procDoc of processingDocsToRestore) {
          if (procDoc.document?.tenant?.deletedAt) {
            return NextResponse.json(
              { error: `Cannot restore document "${procDoc.document?.fileName || procDoc.id}" - parent workspace is deleted. Restore the workspace first.` },
              { status: 400 }
            );
          }
        }

        await prisma.processingDocument.updateMany({
          where: { id: { in: entityIds }, deletedAt: { not: null } },
          data: {
            deletedAt: null,
            deletedReason: null,
          },
        });

        for (const procDoc of processingDocsToRestore) {
          restoredRecords.push({ id: procDoc.id, name: procDoc.document?.fileName || procDoc.id });
        }
        restoredCount = processingDocsToRestore.length;
        break;
    }

    // Log the restore action
    const restoredNames = restoredRecords.map(r => r.name).join(', ');
    await createAuditLog({
      userId: session.id,
      action: 'RESTORE',
      entityType: `Restore_${entityType}`,
      entityId: entityIds.join(','),
      entityName: restoredNames,
      summary: `Restored ${restoredCount} ${entityType}(s): ${restoredNames}`,
      changeSource: 'MANUAL',
      metadata: {
        entityType,
        restoredCount,
        restoredRecords,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Restored ${restoredCount} ${entityType}(s)`,
      restoredCount,
      restoredRecords,
    });
  } catch (error) {
    console.error('Restore error:', error);
    return createErrorResponse(error);
  }
}
