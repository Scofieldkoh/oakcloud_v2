import type { Prisma } from '@/generated/prisma';

export type EsigningDocumentVisibility = 'SIGNER_ONLY' | 'EVERYONE';

const METADATA_KEY = 'documentVisibility';

function metadataObject(metadata: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') {
    return {};
  }
  return { ...(metadata as Record<string, Prisma.JsonValue>) };
}

export function getEsigningDocumentVisibility(
  metadata: Prisma.JsonValue | null | undefined,
  documentId: string
): EsigningDocumentVisibility {
  const root = metadataObject(metadata);
  const visibilityMap = root[METADATA_KEY];

  if (!visibilityMap || Array.isArray(visibilityMap) || typeof visibilityMap !== 'object') {
    return 'SIGNER_ONLY';
  }

  return (visibilityMap as Record<string, Prisma.JsonValue>)[documentId] === 'EVERYONE'
    ? 'EVERYONE'
    : 'SIGNER_ONLY';
}

export function isEsigningDocumentVisibleToRecipient(input: {
  metadata: Prisma.JsonValue | null | undefined;
  documentId: string;
  recipientId: string;
  fieldDefinitions: ReadonlyArray<{
    documentId: string;
    recipientId: string;
  }>;
}): boolean {
  if (getEsigningDocumentVisibility(input.metadata, input.documentId) === 'EVERYONE') {
    return true;
  }

  return input.fieldDefinitions.some(
    (field) =>
      field.documentId === input.documentId &&
      field.recipientId === input.recipientId
  );
}

export function setEsigningDocumentVisibility(
  metadata: Prisma.JsonValue | null | undefined,
  documentId: string,
  visibility: EsigningDocumentVisibility
): Prisma.InputJsonValue {
  const root = metadataObject(metadata);
  const existingMap = root[METADATA_KEY];
  const visibilityMap =
    existingMap && !Array.isArray(existingMap) && typeof existingMap === 'object'
      ? { ...(existingMap as Record<string, Prisma.JsonValue>) }
      : {};

  visibilityMap[documentId] = visibility;

  return {
    ...root,
    [METADATA_KEY]: visibilityMap,
  } as Prisma.InputJsonValue;
}

export function removeEsigningDocumentVisibility(
  metadata: Prisma.JsonValue | null | undefined,
  documentId: string
): Prisma.InputJsonValue {
  const root = metadataObject(metadata);
  const existingMap = root[METADATA_KEY];

  if (!existingMap || Array.isArray(existingMap) || typeof existingMap !== 'object') {
    return root as Prisma.InputJsonValue;
  }

  const visibilityMap = { ...(existingMap as Record<string, Prisma.JsonValue>) };
  delete visibilityMap[documentId];

  if (Object.keys(visibilityMap).length > 0) {
    root[METADATA_KEY] = visibilityMap;
  } else {
    delete root[METADATA_KEY];
  }

  return root as Prisma.InputJsonValue;
}
