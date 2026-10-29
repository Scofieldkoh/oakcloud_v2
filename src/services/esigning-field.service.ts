import { randomUUID } from 'crypto';
import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { storage, StorageKeys } from '@/lib/storage';
import { createLogger } from '@/lib/logger';
import type { EsigningFieldType } from '@/generated/prisma';
import type {
  EsigningFieldDefinitionInput,
  SaveEsigningFieldDefinitionsInput,
  SaveEsigningFieldValuesInput,
} from '@/lib/validations/esigning';
import type { EsigningFieldOverlapWarning } from '@/types/esigning';

const log = createLogger('esigning-field');

function hasFieldValueContent(
  fieldType: EsigningFieldType,
  value: string | null | undefined,
  signatureDataUrl: string | null | undefined
): boolean {
  if (fieldType === 'SIGNATURE' || fieldType === 'INITIALS') {
    return Boolean(signatureDataUrl || value);
  }

  if (fieldType === 'CHECKBOX') {
    return value === 'true';
  }

  return Boolean(value && value.trim().length > 0);
}

type FieldBounds = Pick<
  EsigningFieldDefinitionInput,
  'id' | 'documentId' | 'pageNumber' | 'xPercent' | 'yPercent' | 'widthPercent' | 'heightPercent'
>;

function fieldsOverlap(left: FieldBounds, right: FieldBounds): boolean {
  if (left.documentId !== right.documentId || left.pageNumber !== right.pageNumber) {
    return false;
  }

  const leftRight = left.xPercent + left.widthPercent;
  const rightRight = right.xPercent + right.widthPercent;
  const leftBottom = left.yPercent + left.heightPercent;
  const rightBottom = right.yPercent + right.heightPercent;

  return (
    left.xPercent < rightRight &&
    leftRight > right.xPercent &&
    left.yPercent < rightBottom &&
    leftBottom > right.yPercent
  );
}

export function detectEsigningFieldOverlapWarnings(
  fields: FieldBounds[]
): EsigningFieldOverlapWarning[] {
  const warnings: EsigningFieldOverlapWarning[] = [];

  for (let leftIndex = 0; leftIndex < fields.length; leftIndex += 1) {
    const left = fields[leftIndex];
    if (!left?.id) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < fields.length; rightIndex += 1) {
      const right = fields[rightIndex];
      if (!right?.id || !fieldsOverlap(left, right)) {
        continue;
      }

      warnings.push({
        fieldIds: [left.id, right.id],
        documentId: left.documentId,
        pageNumber: left.pageNumber,
        message: `2 fields overlap on page ${left.pageNumber}`,
      });
    }
  }

  return warnings;
}

export function isRequiredEsigningFieldComplete(input: {
  fieldType: EsigningFieldType;
  required: boolean;
  value: string | null | undefined;
  signatureStoragePath?: string | null;
}): boolean {
  if (!input.required) {
    return true;
  }

  if (input.fieldType === 'SIGNATURE' || input.fieldType === 'INITIALS') {
    return Boolean(input.signatureStoragePath || (input.value && input.value.length > 0));
  }

  if (input.fieldType === 'CHECKBOX') {
    return input.value === 'true';
  }

  return Boolean(input.value && input.value.trim().length > 0);
}

export async function saveEnvelopeFieldDefinitions(
  envelopeId: string,
  input: SaveEsigningFieldDefinitionsInput,
  tx?: Prisma.TransactionClient
): Promise<EsigningFieldOverlapWarning[]> {
  const db = tx ?? prisma;
  const envelope = await db.esigningEnvelope.findUnique({
    where: { id: envelopeId },
    include: {
      documents: {
        select: { id: true, pageCount: true },
      },
      recipients: {
        select: { id: true, type: true },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }

  if (envelope.status !== 'DRAFT') {
    throw new Error('Fields can only be edited while the envelope is a draft');
  }

  const documentMap = new Map(envelope.documents.map((document) => [document.id, document]));
  const recipientMap = new Map(envelope.recipients.map((recipient) => [recipient.id, recipient]));

  const normalizedFields = input.fields.map((field, index) => normalizeFieldDefinition(field, index));

  for (const field of normalizedFields) {
    const document = documentMap.get(field.documentId);
    if (!document) {
      throw new Error('Field references an unknown document');
    }

    if (field.pageNumber > document.pageCount) {
      throw new Error(`Field page number exceeds document page count for ${document.id}`);
    }

    const recipient = recipientMap.get(field.recipientId);
    if (!recipient) {
      throw new Error('Field references an unknown recipient');
    }

    if (recipient.type !== 'SIGNER') {
      throw new Error('Fields can only be assigned to signer recipients');
    }
  }

  const overlapWarnings = detectEsigningFieldOverlapWarnings(normalizedFields);

  const persist = async (client: Prisma.TransactionClient) => {
    await client.esigningDocumentFieldDefinition.deleteMany({
      where: { envelopeId },
    });

    if (normalizedFields.length === 0) {
      return;
    }

    await client.esigningDocumentFieldDefinition.createMany({
      data: normalizedFields.map((field) => ({
        id: field.id,
        tenantId: envelope.tenantId,
        envelopeId,
        documentId: field.documentId,
        recipientId: field.recipientId,
        type: field.type,
        pageNumber: field.pageNumber,
        xPercent: field.xPercent,
        yPercent: field.yPercent,
        widthPercent: field.widthPercent,
        heightPercent: field.heightPercent,
        required: field.required,
        label: field.label,
        placeholder: field.placeholder,
        sortOrder: field.sortOrder,
      })),
    });
  };

  if (tx) {
    await persist(tx);
  } else {
    await prisma.$transaction(persist);
  }

  log.info(`Saved ${normalizedFields.length} field definitions for envelope ${envelopeId}`);
  return overlapWarnings;
}

export async function saveRecipientFieldValues(input: {
  tenantId: string;
  envelopeId: string;
  recipientId: string;
  values: SaveEsigningFieldValuesInput['values'];
  finalize?: boolean;
}, tx?: Prisma.TransactionClient): Promise<void> {
  const fieldIds = input.values.map((entry) => entry.fieldDefinitionId);

  const fieldDefinitions = await prisma.esigningDocumentFieldDefinition.findMany({
    where: {
      envelopeId: input.envelopeId,
      recipientId: input.recipientId,
      id: { in: fieldIds },
    },
    select: {
      id: true,
      type: true,
      required: true,
    },
  });

  const fieldMap = new Map(fieldDefinitions.map((field) => [field.id, field]));

  if (fieldDefinitions.length !== fieldIds.length) {
    throw new Error('One or more fields are invalid for this signing session');
  }

  const persist = async (client: Prisma.TransactionClient) => {
    const existingValues = await client.esigningDocumentFieldValue.findMany({
      where: {
        recipientId: input.recipientId,
        fieldDefinitionId: { in: fieldIds },
      },
      select: {
        id: true,
        fieldDefinitionId: true,
        value: true,
        revision: true,
        finalizedAt: true,
        signatureStoragePath: true,
      },
    });

    const existingMap = new Map(existingValues.map((value) => [value.fieldDefinitionId, value]));

    for (const valueInput of input.values) {
      const field = fieldMap.get(valueInput.fieldDefinitionId);
      if (!field) {
        throw new Error('Field definition not found');
      }

      const existing = existingMap.get(valueInput.fieldDefinitionId);
      if (existing?.finalizedAt) {
        throw new Error('A finalized field cannot be modified');
      }

      const signatureAsset =
        valueInput.signatureDataUrl && (field.type === 'SIGNATURE' || field.type === 'INITIALS')
          ? await persistSignatureAsset({
              tenantId: input.tenantId,
              envelopeId: input.envelopeId,
              recipientId: input.recipientId,
              fieldType: field.type,
              dataUrl: valueInput.signatureDataUrl,
            })
          : null;

      if (valueInput.signatureDataUrl && !signatureAsset) {
        throw new Error('Signature data can only be used with signature or initials fields');
      }

      const isSignatureField = field.type === 'SIGNATURE' || field.type === 'INITIALS';
      const explicitlyClearsSignature =
        isSignatureField &&
        valueInput.signatureDataUrl === null &&
        (valueInput.value === undefined || valueInput.value === null);

      const normalizedValue =
        field.type === 'CHECKBOX'
          ? normalizeCheckboxValue(valueInput.value ?? existing?.value)
          : explicitlyClearsSignature
            ? null
          : valueInput.value === undefined
            ? existing?.value ?? null
            : valueInput.value?.trim() ?? null;

      const hasContent = hasFieldValueContent(field.type, normalizedValue, valueInput.signatureDataUrl);
      const timestamp = hasContent ? new Date() : null;

      if (existing) {
        await client.esigningDocumentFieldValue.update({
          where: { id: existing.id },
          data: {
            value: normalizedValue,
            signatureStoragePath:
              isSignatureField && explicitlyClearsSignature
                ? null
                : signatureAsset?.storagePath ?? existing.signatureStoragePath ?? null,
            filledAt: timestamp,
            finalizedAt: input.finalize ? new Date() : existing.finalizedAt ?? null,
            revision: existing.revision + 1,
          },
        });
      } else {
        await client.esigningDocumentFieldValue.create({
          data: {
            tenantId: input.tenantId,
            fieldDefinitionId: valueInput.fieldDefinitionId,
            recipientId: input.recipientId,
            value: normalizedValue,
            signatureStoragePath: signatureAsset?.storagePath ?? null,
            filledAt: timestamp,
            finalizedAt: input.finalize ? new Date() : null,
            revision: 1,
          },
        });
      }
    }
  };

  if (tx) {
    await persist(tx);
  } else {
    await prisma.$transaction(persist);
  }
}

function normalizeFieldDefinition(field: EsigningFieldDefinitionInput, index: number) {
  return {
    ...field,
    id: field.id ?? randomUUID(),
    label: field.label ?? null,
    placeholder: field.placeholder ?? null,
    sortOrder: field.sortOrder ?? index,
  };
}

function normalizeCheckboxValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase().trim();
  return normalized === 'true' || normalized === '1' || normalized === 'checked'
    ? 'true'
    : null;
}

async function persistSignatureAsset(input: {
  tenantId: string;
  envelopeId: string;
  recipientId: string;
  fieldType: 'SIGNATURE' | 'INITIALS';
  dataUrl: string;
}): Promise<{ storagePath: string }> {
  const [, base64Payload] = input.dataUrl.split(',');
  if (!base64Payload) {
    throw new Error('Invalid signature image payload');
  }

  const buffer = Buffer.from(base64Payload, 'base64');
  const kind = input.fieldType === 'SIGNATURE' ? 'signature' : 'initials';
  const storagePath = StorageKeys.esigningSignatureAsset(
    input.tenantId,
    input.envelopeId,
    input.recipientId,
    kind
  );

  await storage.upload(storagePath, buffer, {
    contentType: 'image/png',
    metadata: {
      envelopeId: input.envelopeId,
      recipientId: input.recipientId,
      kind,
    },
  });

  return { storagePath };
}
