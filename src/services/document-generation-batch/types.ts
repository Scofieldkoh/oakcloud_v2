import type { Prisma } from '@/generated/prisma';
import type {
  BatchItemConfiguration,
  MasterFieldCatalogue,
} from '@/types/document-generation-batch';

export const batchItemInclude = {
  template: {
    select: {
      id: true,
      name: true,
      category: true,
      compositionType: true,
      version: true,
      contentJson: true,
    },
  },
  generatedDocument: {
    include: {
      serviceAgreement: true,
    },
  },
} satisfies Prisma.DocumentGenerationBatchItemInclude;

export const batchInclude = {
  primaryCompany: {
    select: { id: true, name: true, uen: true },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true },
  },
  items: {
    orderBy: { displayOrder: 'asc' as const },
    include: batchItemInclude,
  },
  activeItem: {
    select: { id: true },
  },
} satisfies Prisma.DocumentGenerationBatchInclude;

export type BatchWithRelations = Prisma.DocumentGenerationBatchGetPayload<{
  include: typeof batchInclude;
}>;

export type BatchItemWithRelations = Prisma.DocumentGenerationBatchItemGetPayload<{
  include: typeof batchItemInclude;
}>;

export interface BatchRenderItem {
  itemId: string;
  templateId: string;
  templateName: string;
  templateVersion: number;
  templateKind: 'STANDARD' | 'SERVICE_AGREEMENT' | 'RESOLUTION';
  generatedDocumentId: string;
  serviceAgreementId: string | null;
  configuration: BatchItemConfiguration;
}

export interface BatchRenderInput {
  tenantId: string;
  userId: string;
  primaryCompanyId: string | null;
  masterFieldValues: Record<string, string>;
  catalogue: MasterFieldCatalogue;
  items: BatchRenderItem[];
  actorName: string;
  taskContext?: unknown;
}

export interface BatchItemRenderInput {
  tenantId: string;
  userId: string;
  primaryCompanyId: string | null;
  masterFieldValues: Record<string, string>;
  catalogue: MasterFieldCatalogue;
  item: BatchRenderItem;
  actorName: string;
  taskContext?: unknown;
}

export interface BatchListItemSummary {
  id: string;
  tenantId: string;
  primaryCompanyId: string | null;
  companyName: string | null;
  itemCount: number;
  counts: {
    NOT_STARTED: number;
    NEEDS_INPUT: number;
    PREVIEWED: number;
    READY: number;
    GENERATING: number;
    GENERATED: number;
    FAILED: number;
    BLOCKED: number;
  };
  status: 'DRAFT' | 'PARTIAL' | 'COMPLETED';
  currentStage: number;
  updatedAt: Date;
}
