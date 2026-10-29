import { Prisma } from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantAwareParams } from '@/lib/types';
import { chooseContactDetail } from '@/lib/document-party';
import { canonicalAppointment, rankAppointments } from '@/lib/representative-authority';
import { serviceAgreementDraftSchema } from '@/lib/validations/service-agreement';
import { checkUserCompanyAccess } from '@/services/user-company.service';
import type {
  AuthorizedRepresentativeSnapshot,
  ServiceAgreementDraftDto,
  ServiceAgreementDraftInput,
  ServiceAgreementItemDto,
} from './types';
import { snapshotServiceVariant } from './snapshot';

const agreementInclude = {
  entities: { orderBy: { displayOrder: 'asc' as const } },
  items: {
    orderBy: { displayOrder: 'asc' as const },
    include: {
      entityLinks: true,
      feeLines: {
        orderBy: [{ agreementEntityId: 'asc' }, { displayOrder: 'asc' }],
        include: { agreementEntity: true },
      },
      serviceVariant: { include: { sowPartial: true } },
    },
  },
} satisfies Prisma.ServiceAgreementInclude;

type AgreementWithRelations = Prisma.ServiceAgreementGetPayload<{
  include: typeof agreementInclude;
}>;
type AgreementItemWithRelations = AgreementWithRelations['items'][number];

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function fixedAmount(value: unknown): string {
  if (value && typeof value === 'object' && 'toFixed' in value) {
    return (value as { toFixed: (digits: number) => string }).toFixed(2);
  }
  return Number(value).toFixed(2);
}

function jsonObject<T>(value: unknown, fallback: T): T {
  return value && typeof value === 'object' ? (value as T) : fallback;
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function toItemDto(item: AgreementItemWithRelations): ServiceAgreementItemDto {
  return {
    id: item.id,
    serviceVariantId: item.serviceVariantId,
    variantVersion: item.variantVersion,
    familyNameSnapshot: item.familyNameSnapshot,
    variantNameSnapshot: item.variantNameSnapshot,
    serviceCadence: item.serviceCadence,
    customCadenceLabel: item.customCadenceLabel,
    sowPartialId: item.sowPartialId,
    partialVersion: item.partialVersion,
    partialContentSnapshot: item.partialContentSnapshot,
    partialPlaceholdersSnapshot: Array.isArray(item.partialPlaceholdersSnapshot)
      ? (item.partialPlaceholdersSnapshot as unknown as ServiceAgreementItemDto['partialPlaceholdersSnapshot'])
      : [],
    partialDependencySnapshot: Array.isArray(item.partialDependencySnapshot)
      ? (item.partialDependencySnapshot as unknown as ServiceAgreementItemDto['partialDependencySnapshot'])
      : [],
    startDate: dateOnly(item.startDate) ?? '',
    endDate: dateOnly(item.endDate),
    fieldValues: jsonObject(item.fieldValues, {}),
    displayOrder: item.displayOrder,
    entityIds: (item.entityLinks ?? []).map(
      (link: { agreementEntityId: string }) => link.agreementEntityId,
    ),
    feeLines: (item.feeLines ?? []).map((fee) => ({
      id: fee.id,
      agreementEntityId: fee.agreementEntityId,
      companyId: fee.agreementEntity.companyId,
      description: fee.description,
      amount: fixedAmount(fee.amount),
      currency: fee.currency,
      billingFrequency: fee.billingFrequency,
      customFrequencyLabel: fee.customFrequencyLabel,
      billingStartDate: dateOnly(fee.billingStartDate) ?? dateOnly(item.startDate) ?? '',
      displayOrder: fee.displayOrder,
    })),
    staleVariantVersion: Boolean(
      item.serviceVariant && item.serviceVariant.version !== item.variantVersion,
    ),
    stalePartialVersion: Boolean(
      item.serviceVariant?.sowPartial &&
        (item.serviceVariant.sowPartial.id !== item.sowPartialId ||
          item.serviceVariant.sowPartial.version !== item.partialVersion),
    ),
  };
}

function toDraftDto(agreement: AgreementWithRelations): ServiceAgreementDraftDto {
  return {
    id: agreement.id,
    generatedDocumentId: agreement.generatedDocumentId,
    primaryCompanyId: agreement.primaryCompanyId,
    authorizedContactIds: jsonArray<AuthorizedRepresentativeSnapshot>(
      agreement.authorizedRepresentativeSnapshots,
    ).map((representative) => representative.id),
    signerContactIds: jsonArray<string>(agreement.signerContactIds),
    authorizedRepresentativeSnapshots: jsonArray<AuthorizedRepresentativeSnapshot>(
      agreement.authorizedRepresentativeSnapshots,
    ),
    agreementDate: dateOnly(agreement.agreementDate) ?? '',
    effectiveDate: dateOnly(agreement.effectiveDate),
    termMonths: agreement.termMonths,
    status: agreement.status,
    entities: agreement.entities.map((entity) => ({
      id: entity.id,
      companyId: entity.companyId,
      nameSnapshot: entity.nameSnapshot,
      uenSnapshot: entity.uenSnapshot,
      displayOrder: entity.displayOrder,
    })),
    items: agreement.items.map(toItemDto),
    createdAt: agreement.createdAt.toISOString(),
    updatedAt: agreement.updatedAt.toISOString(),
  };
}

async function assertCompanyAccess(companyIds: string[], params: TenantAwareParams) {
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds }, tenantId: params.tenantId, deletedAt: null },
    select: { id: true, name: true, uen: true },
  });
  if (companies.length !== companyIds.length) throw new NotFoundError('Company not found');
  const access = await Promise.all(
    companyIds.map((companyId) => checkUserCompanyAccess(params.userId, companyId)),
  );
  if (access.some((allowed) => !allowed)) throw new ForbiddenError('Company access denied');
  return companies;
}

async function representativeSnapshots(
  contactIds: string[],
  primaryCompanyId: string,
  tenantId: string,
  selectedRoles: Readonly<Record<string, string>> = {},
): Promise<AuthorizedRepresentativeSnapshot[]> {
  if (contactIds.length === 0) return [];
  const contactInclude = {
    include: {
      contactDetails: {
        where: { deletedAt: null },
        orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
      },
    },
  } satisfies Prisma.ContactDefaultArgs;
  const [relations, officers, shareholders] = await Promise.all([
    prisma.companyContact.findMany({
      where: {
        companyId: primaryCompanyId,
        contactId: { in: contactIds },
        deletedAt: null,
        company: { tenantId, deletedAt: null },
        contact: { tenantId, deletedAt: null, isActive: true },
      },
      include: { contact: contactInclude },
    }),
    prisma.companyOfficer.findMany({
      where: {
        companyId: primaryCompanyId,
        contactId: { in: contactIds },
        isCurrent: true,
        company: { tenantId, deletedAt: null },
        contact: { tenantId, deletedAt: null, isActive: true },
      },
      include: { contact: contactInclude },
    }),
    prisma.companyShareholder.findMany({
      where: {
        companyId: primaryCompanyId,
        contactId: { in: contactIds },
        isCurrent: true,
        company: { tenantId, deletedAt: null },
        contact: { tenantId, deletedAt: null, isActive: true },
      },
      include: { contact: contactInclude },
    }),
  ]);
  const sources = [
    ...relations.map((relation) => ({
      contact: relation.contact,
      appointment: relation.relationship,
    })),
    ...officers.flatMap((officer) => officer.contact ? [{
      contact: officer.contact,
      appointment: officer.role,
    }] : []),
    ...shareholders.flatMap((shareholder) => shareholder.contact ? [{
      contact: shareholder.contact,
      appointment: 'Shareholder',
    }] : []),
  ];
  const sourceIds = new Set(sources.map((source) => source.contact.id));
  if (contactIds.some((contactId) => !sourceIds.has(contactId))) {
    throw new ValidationError('Every authorised contact must belong to the primary company');
  }
  const byId = new Map<string, AuthorizedRepresentativeSnapshot>();
  for (const contactId of contactIds) {
    const contactSources = sources.filter((source) => source.contact.id === contactId);
    const contact = contactSources[0].contact;
    const details = contact.contactDetails;
    const roles = rankAppointments(contactSources.map((source) => source.appointment));
    const requestedRole = selectedRoles[contactId]
      ? canonicalAppointment(selectedRoles[contactId])
      : null;
    if (requestedRole && !roles.includes(requestedRole)) {
      throw new ValidationError(
        `${requestedRole} is not a current appointment for ${contact.fullName}`,
      );
    }
    byId.set(contactId, {
      id: contact.id,
      name: contact.fullName,
      role: requestedRole ?? roles[0] ?? null,
      email: chooseContactDetail(details, 'EMAIL', primaryCompanyId),
      phone: chooseContactDetail(details, 'PHONE', primaryCompanyId),
    });
  }
  return contactIds.map((contactId) => byId.get(contactId)!);
}

function validateRequiredFields(
  placeholders: Array<{ key: string; required?: boolean }>,
  fieldValues: Record<string, string>,
) {
  const missing = placeholders
    .filter((placeholder) => placeholder.required)
    .map((placeholder) => placeholder.key.replace(/^service\.fields\./, ''))
    .filter((key) => !fieldValues[key]?.trim());
  if (missing.length) {
    throw new ValidationError('Required service fields are missing', { missing });
  }
}

export async function upsertServiceAgreementDraft(
  generatedDocumentId: string,
  input: ServiceAgreementDraftInput,
  params: TenantAwareParams,
  options?: {
    tx?: Prisma.TransactionClient;
    skipDocumentCheck?: boolean;
  },
): Promise<ServiceAgreementDraftDto> {
  const parsed = serviceAgreementDraftSchema.parse(input);
  if (!options?.skipDocumentCheck) {
    const document = await prisma.generatedDocument.findFirst({
      where: {
        id: generatedDocumentId,
        tenantId: params.tenantId,
        status: 'DRAFT',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('Document generation draft not found');
  }

  const companies = await assertCompanyAccess(parsed.entityIds, params);
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const mutate = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.serviceAgreement.findUnique({
      where: { generatedDocumentId },
      include: { items: true, entities: true },
    });
    if (existing && existing.status !== 'DRAFT') {
      throw new ConflictError('Only draft service agreements can be changed');
    }
    const existingRepresentatives = existing?.primaryCompanyId === parsed.primaryCompanyId
      ? jsonArray<AuthorizedRepresentativeSnapshot>(existing.authorizedRepresentativeSnapshots)
      : [];
    const existingRepresentativeById = new Map(
      existingRepresentatives.map((representative) => [representative.id, representative]),
    );
    const newContactIds = parsed.authorizedContactIds.filter(
      (contactId) => !existingRepresentativeById.has(contactId),
    );
    const changedRoleContactIds = parsed.authorizedContactIds.filter((contactId) => {
      const existingRepresentative = existingRepresentativeById.get(contactId);
      const selectedRole = parsed.authorizedRepresentativeRoles?.[contactId];
      return existingRepresentative
        && selectedRole
        && canonicalAppointment(selectedRole) !== canonicalAppointment(
          existingRepresentative.role ?? '',
        );
    });
    const contactIdsToResolve = [...new Set([
      ...newContactIds,
      ...changedRoleContactIds,
    ])];
    const resolvedRepresentatives = await representativeSnapshots(
      contactIdsToResolve,
      parsed.primaryCompanyId,
      params.tenantId,
      parsed.authorizedRepresentativeRoles,
    );
    const newContactIdSet = new Set(newContactIds);
    const newRepresentatives = resolvedRepresentatives.filter((representative) =>
      newContactIdSet.has(representative.id));
    const representativeById = new Map([
      ...existingRepresentativeById,
      ...newRepresentatives.map((representative) => [representative.id, representative] as const),
    ]);
    const representatives = parsed.authorizedContactIds.map((contactId) => {
      const representative = representativeById.get(contactId)!;
      const selectedRole = parsed.authorizedRepresentativeRoles?.[contactId];
      return selectedRole
        ? { ...representative, role: canonicalAppointment(selectedRole) }
        : representative;
    });

    const agreement = await tx.serviceAgreement.upsert({
      where: { generatedDocumentId },
      create: {
        tenantId: params.tenantId,
        generatedDocumentId,
        primaryCompanyId: parsed.primaryCompanyId,
        authorizedRepresentativeSnapshots: representatives as unknown as Prisma.InputJsonValue,
        signerContactIds: parsed.signerContactIds as unknown as Prisma.InputJsonValue,
        agreementDate: new Date(`${parsed.agreementDate}T00:00:00.000Z`),
        effectiveDate: parsed.effectiveDate
          ? new Date(`${parsed.effectiveDate}T00:00:00.000Z`)
          : null,
        termMonths: parsed.termMonths,
      },
      update: {
        primaryCompanyId: parsed.primaryCompanyId,
        authorizedRepresentativeSnapshots: representatives as unknown as Prisma.InputJsonValue,
        signerContactIds: parsed.signerContactIds as unknown as Prisma.InputJsonValue,
        agreementDate: new Date(`${parsed.agreementDate}T00:00:00.000Z`),
        effectiveDate: parsed.effectiveDate
          ? new Date(`${parsed.effectiveDate}T00:00:00.000Z`)
          : null,
        termMonths: parsed.termMonths,
      },
    });

    const oldItemIds = existing?.items.map((item) => item.id) ?? [];
    if (oldItemIds.length) {
      await tx.serviceAgreementFeeLine.deleteMany({ where: { itemId: { in: oldItemIds } } });
      await tx.serviceAgreementItemEntity.deleteMany({ where: { itemId: { in: oldItemIds } } });
    }
    const retainedIds = new Set(parsed.items.flatMap((item) => (item.id ? [item.id] : [])));
    const removedIds = oldItemIds.filter((id) => !retainedIds.has(id));
    if (removedIds.length) {
      await tx.serviceAgreementItem.deleteMany({
        where: { id: { in: removedIds }, agreementId: agreement.id },
      });
    }
    await tx.serviceAgreementEntity.deleteMany({ where: { agreementId: agreement.id } });

    const entityByCompany = new Map<string, { id: string }>();
    for (const [displayOrder, companyId] of parsed.entityIds.entries()) {
      const company = companyById.get(companyId)!;
      entityByCompany.set(
        companyId,
        await tx.serviceAgreementEntity.create({
          data: {
            tenantId: params.tenantId,
            agreementId: agreement.id,
            companyId,
            nameSnapshot: company.name,
            uenSnapshot: company.uen,
            displayOrder,
          },
          select: { id: true },
        }),
      );
    }

    const existingById = new Map(existing?.items.map((item) => [item.id, item]) ?? []);
    for (const itemInput of parsed.items) {
      const prior = itemInput.id ? existingById.get(itemInput.id) : undefined;
      if (itemInput.id && !prior) throw new ValidationError('Service item does not belong to this draft');
      const snapshot =
        !prior || prior.serviceVariantId !== itemInput.variantId
          ? await snapshotServiceVariant(itemInput.variantId, params.tenantId)
          : null;
      validateRequiredFields(
        snapshot
          ? snapshot.placeholders
          : Array.isArray(prior?.partialPlaceholdersSnapshot)
            ? prior.partialPlaceholdersSnapshot as Array<{
                key: string;
                required?: boolean;
              }>
            : [],
        itemInput.fieldValues,
      );

      const structuredData = {
        startDate: new Date(`${itemInput.startDate}T00:00:00.000Z`),
        endDate: itemInput.endDate
          ? new Date(`${itemInput.endDate}T00:00:00.000Z`)
          : null,
        fieldValues: itemInput.fieldValues as Prisma.InputJsonValue,
        displayOrder: itemInput.displayOrder,
      };
      const snapshotData = snapshot
        ? {
            serviceVariantId: snapshot.variantId,
            variantVersion: snapshot.variantVersion,
            familyNameSnapshot: snapshot.familyName,
            variantNameSnapshot: snapshot.variantName,
            serviceCadence: snapshot.serviceCadence,
            customCadenceLabel: snapshot.customCadenceLabel,
            sowPartialId: snapshot.partialId,
            partialVersion: snapshot.partialVersion,
            partialContentSnapshot: snapshot.partialContent,
            partialPlaceholdersSnapshot:
              snapshot.placeholders as unknown as Prisma.InputJsonValue,
            partialDependencySnapshot:
              snapshot.dependencies as unknown as Prisma.InputJsonValue,
          }
        : {};
      const item = prior
        ? await tx.serviceAgreementItem.update({
            where: { id: prior.id },
            data: {
              ...snapshotData,
              ...structuredData,
            },
          })
        : await tx.serviceAgreementItem.create({
            data: {
              tenantId: params.tenantId,
              agreementId: agreement.id,
              serviceVariantId: snapshot!.variantId,
              variantVersion: snapshot!.variantVersion,
              familyNameSnapshot: snapshot!.familyName,
              variantNameSnapshot: snapshot!.variantName,
              serviceCadence: snapshot!.serviceCadence,
              customCadenceLabel: snapshot!.customCadenceLabel,
              sowPartialId: snapshot!.partialId,
              partialVersion: snapshot!.partialVersion,
              partialContentSnapshot: snapshot!.partialContent,
              partialPlaceholdersSnapshot:
                snapshot!.placeholders as unknown as Prisma.InputJsonValue,
              partialDependencySnapshot:
                snapshot!.dependencies as unknown as Prisma.InputJsonValue,
              ...structuredData,
            },
          });

      for (const companyId of itemInput.entityIds) {
        await tx.serviceAgreementItemEntity.create({
          data: {
            tenantId: params.tenantId,
            itemId: item.id,
            agreementEntityId: entityByCompany.get(companyId)!.id,
          },
        });
      }
      for (const fee of itemInput.feeLines) {
        await tx.serviceAgreementFeeLine.create({
          data: {
            tenantId: params.tenantId,
            itemId: item.id,
            agreementEntityId: entityByCompany.get(fee.companyId)!.id,
            description: fee.description,
            amount: new Prisma.Decimal(fee.amount),
            currency: fee.currency,
            billingFrequency: fee.billingFrequency,
            customFrequencyLabel: fee.customFrequencyLabel,
            billingStartDate: new Date(
              `${fee.billingStartDate ?? itemInput.startDate}T00:00:00.000Z`,
            ),
            displayOrder: fee.displayOrder,
          },
        });
      }
    }

    await createAuditLog(
      {
        tenantId: params.tenantId,
        userId: params.userId,
        companyId: parsed.primaryCompanyId,
        action: existing ? 'UPDATE' : 'CREATE',
        entityType: 'ServiceAgreement',
        entityId: agreement.id,
        summary: existing
          ? 'Updated service agreement draft selections'
          : 'Created service agreement draft selections',
        metadata: { entityCount: parsed.entityIds.length, itemCount: parsed.items.length },
      },
      tx,
    );

    const saved = await tx.serviceAgreement.findUnique({
      where: { id: agreement.id },
      include: agreementInclude,
    });
    if (!saved) throw new NotFoundError('Saved Service Agreement draft not found');
    return toDraftDto(saved);
  };
  return options?.tx ? mutate(options.tx) : prisma.$transaction(mutate);
}

export async function getServiceAgreementDraft(
  generatedDocumentId: string,
  access: string | TenantAwareParams,
): Promise<ServiceAgreementDraftDto | null> {
  const tenantId = typeof access === 'string' ? access : access.tenantId;
  const agreement = await prisma.serviceAgreement.findFirst({
    where: { generatedDocumentId, tenantId },
    include: agreementInclude,
  });
  if (agreement && typeof access !== 'string') {
    await assertCompanyAccess(
      agreement.entities.map((entity) => entity.companyId),
      access,
    );
  }
  return agreement ? toDraftDto(agreement) : null;
}

export async function getServiceAgreementDraftById(
  id: string,
  access: string | TenantAwareParams,
): Promise<ServiceAgreementDraftDto | null> {
  const tenantId = typeof access === 'string' ? access : access.tenantId;
  const agreement = await prisma.serviceAgreement.findFirst({
    where: {
      id,
      tenantId,
      generatedDocument: { tenantId, deletedAt: null },
    },
    include: agreementInclude,
  });
  if (agreement && typeof access !== 'string') {
    await assertCompanyAccess(
      agreement.entities.map((entity) => entity.companyId),
      access,
    );
  }
  return agreement ? toDraftDto(agreement) : null;
}

export async function refreshServiceAgreementItemWording(
  itemId: string,
  input: { expectedVariantVersion: number; expectedPartialVersion: number },
  params: TenantAwareParams,
): Promise<ServiceAgreementItemDto> {
  const current = await prisma.serviceAgreementItem.findFirst({
    where: { id: itemId, tenantId: params.tenantId },
    include: { agreement: { select: { id: true, status: true } } },
  });
  if (!current) throw new NotFoundError('Service agreement item not found');
  if (current.agreement.status !== 'DRAFT') {
    throw new ConflictError('Only draft service agreements can refresh wording');
  }
  await getServiceAgreementDraftById(current.agreement.id, params);
  if (
    current.variantVersion !== input.expectedVariantVersion ||
    current.partialVersion !== input.expectedPartialVersion
  ) {
    throw new ConflictError('Service wording versions changed; reload and try again');
  }

  const snapshot = await snapshotServiceVariant(
    current.serviceVariantId,
    params.tenantId,
  );
  const updated = await prisma.serviceAgreementItem.update({
    where: { id: itemId },
    data: {
      serviceVariantId: snapshot.variantId,
      variantVersion: snapshot.variantVersion,
      familyNameSnapshot: snapshot.familyName,
      variantNameSnapshot: snapshot.variantName,
      serviceCadence: snapshot.serviceCadence,
      customCadenceLabel: snapshot.customCadenceLabel,
      sowPartialId: snapshot.partialId,
      partialVersion: snapshot.partialVersion,
      partialContentSnapshot: snapshot.partialContent,
      partialPlaceholdersSnapshot:
        snapshot.placeholders as unknown as Prisma.InputJsonValue,
      partialDependencySnapshot:
        snapshot.dependencies as unknown as Prisma.InputJsonValue,
    },
    include: agreementInclude.items.include,
  });
  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'UPDATE',
    entityType: 'ServiceAgreementItem',
    entityId: itemId,
    summary: 'Refreshed pinned service agreement wording',
    metadata: {
      variantVersion: snapshot.variantVersion,
      partialVersion: snapshot.partialVersion,
    },
  });
  return toItemDto(updated);
}
