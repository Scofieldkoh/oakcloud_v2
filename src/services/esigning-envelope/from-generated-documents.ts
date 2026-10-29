/**
 * One-click e-signing for generated documents: finalize drafts if asked,
 * create a draft envelope for the documents' company, attach them and add
 * the people who sign them as signers. The user then places the signature
 * fields and sends it from the envelope page.
 */
import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ValidationError } from '@/lib/errors';
import type { DocumentParty } from '@/lib/document-party';
import { readOakDocTemplateMetadata } from '@/lib/document-editor/oakdoc-template';
import {
  ESIGNING_LIMITS,
  createEsigningEnvelopeSchema,
  esigningRecipientInputSchema,
} from '@/lib/validations/esigning';
import type { EsigningEnvelopeDetailDto } from '@/types/esigning';
import { finalizeDocument } from '@/services/document-generator.service';
import { getDocumentPartyOptions } from '@/services/document-party.service';
import { createEsigningEnvelope, deleteDraftEsigningEnvelope } from './lifecycle';
import { addEsigningEnvelopeRecipient } from './recipients';
import { attachGeneratedDocumentsToEsigningEnvelope } from './documents';

export interface SignerSource {
  /** Field tags of the document's template. */
  fieldTags: readonly string[];
  /** Batch item configuration, when the document came from a batch. */
  configuration?: {
    selectedDirectorId?: string | null;
    selectedDirectorIds?: string[];
    selectedShareholderId?: string | null;
    selectedShareholderIds?: string[];
    contactIds?: string[];
  } | null;
  /** Generated document metadata.selectedParties. */
  selectedParties?: { directorId?: unknown; shareholderId?: unknown; contactIds?: unknown } | null;
}

export interface SignerCandidate {
  name: string;
  email: string | null;
}

function asIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

function pick(parties: DocumentParty[], ids: readonly string[] | undefined): DocumentParty[] {
  if (!ids) return parties;
  const wanted = new Set(ids);
  return parties.filter((party) => wanted.has(party.id));
}

/**
 * Who signs a document: everyone its director or shareholder repeaters print
 * (the ones ticked on Configure, or all), otherwise its selected director,
 * shareholder and contacts. Deduplicated by email, then name.
 */
export function signersForDocuments(
  sources: readonly SignerSource[],
  parties: { directors: DocumentParty[]; shareholders: DocumentParty[]; contacts: DocumentParty[] },
): SignerCandidate[] {
  const chosen: DocumentParty[] = [];
  for (const source of sources) {
    const config = source.configuration ?? {};
    const selected = source.selectedParties ?? {};
    const tags = new Set(source.fieldTags);
    const usesDirectors = tags.has('repeat.directors');
    const usesShareholders = tags.has('repeat.shareholders');
    if (usesDirectors) chosen.push(...pick(parties.directors, config.selectedDirectorIds));
    if (usesShareholders) chosen.push(...pick(parties.shareholders, config.selectedShareholderIds));
    if (usesDirectors || usesShareholders) continue;

    const directorId = config.selectedDirectorId ?? (typeof selected.directorId === 'string' ? selected.directorId : null);
    const shareholderId = config.selectedShareholderId ?? (typeof selected.shareholderId === 'string' ? selected.shareholderId : null);
    const contactIds = config.contactIds?.length ? config.contactIds : asIds(selected.contactIds);
    if (directorId) chosen.push(...pick(parties.directors, [directorId]));
    if (shareholderId) chosen.push(...pick(parties.shareholders, [shareholderId]));
    if (contactIds.length > 0) {
      const wanted = new Set(contactIds);
      chosen.push(...parties.contacts.filter((party) => wanted.has(party.id) || (party.contactId && wanted.has(party.contactId))));
    }
  }

  const seen = new Set<string>();
  const signers: SignerCandidate[] = [];
  for (const party of chosen) {
    const name = party.name.trim();
    if (!name) continue;
    const email = party.email?.trim().toLowerCase() || null;
    const key = email ?? `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signers.push({ name, email });
  }
  return signers.slice(0, ESIGNING_LIMITS.MAX_RECIPIENTS);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export interface CreateEnvelopeFromDocumentsInput {
  generatedDocumentIds: string[];
  /** Finalize documents that are still drafts; otherwise drafts are refused. */
  finalizeDrafts: boolean;
}

export interface CreateEnvelopeFromDocumentsResult {
  envelope: EsigningEnvelopeDetailDto;
  signersAdded: number;
  signersWithoutEmail: number;
  finalized: number;
}

export async function createEsigningEnvelopeFromGeneratedDocuments(
  session: SessionUser,
  tenantId: string,
  input: CreateEnvelopeFromDocumentsInput,
): Promise<CreateEnvelopeFromDocumentsResult> {
  const ids = Array.from(new Set(input.generatedDocumentIds));
  const documents = await prisma.generatedDocument.findMany({
    where: { id: { in: ids }, tenantId, deletedAt: null },
    select: {
      id: true,
      title: true,
      status: true,
      revision: true,
      companyId: true,
      metadata: true,
      template: { select: { contentJson: true } },
      batchItem: { select: { configuration: true } },
    },
  });
  if (documents.length !== ids.length) throw new ValidationError('One or more documents were not found.');
  const ordered = ids.map((id) => documents.find((document) => document.id === id)!);

  const archived = ordered.find((document) => document.status === 'ARCHIVED');
  if (archived) throw new ValidationError(`"${archived.title}" is archived and cannot be sent for e-signing.`);
  const companyIds = new Set(ordered.map((document) => document.companyId ?? null));
  if (companyIds.size > 1) {
    throw new ValidationError('Documents sent together for e-signing must belong to the same company.');
  }
  const drafts = ordered.filter((document) => document.status === 'DRAFT');
  if (drafts.length > 0 && !input.finalizeDrafts) {
    throw new ValidationError(`Finalize "${drafts[0].title}" before sending it for e-signing.`);
  }
  for (const draft of drafts) {
    await finalizeDocument(draft.id, { tenantId, userId: session.id }, draft.revision);
  }

  const companyId = ordered[0].companyId;
  const parties = companyId
    ? await getDocumentPartyOptions(companyId, tenantId)
    : { directors: [], shareholders: [], contacts: [] };
  const signers = signersForDocuments(ordered.map((document) => ({
    fieldTags: readOakDocTemplateMetadata(document.template?.contentJson)?.fieldTags ?? [],
    configuration: readRecord(document.batchItem?.configuration) as SignerSource['configuration'],
    selectedParties: readRecord(readRecord(document.metadata).selectedParties),
  })), parties);

  const title = ordered.length === 1
    ? ordered[0].title.slice(0, 160)
    : `${ordered[0].title} and ${ordered.length - 1} more`.slice(0, 160);
  let envelope = await createEsigningEnvelope(
    session,
    tenantId,
    createEsigningEnvelopeSchema.parse({ title, companyId: companyId ?? undefined }),
  );
  try {
    envelope = await attachGeneratedDocumentsToEsigningEnvelope(session, tenantId, envelope.id, ids);
    for (const signer of signers) {
      envelope = await addEsigningEnvelopeRecipient(session, tenantId, envelope.id, esigningRecipientInputSchema.parse({
        type: 'SIGNER',
        name: signer.name,
        ...(signer.email ? { email: signer.email } : {}),
        accessMode: signer.email ? 'EMAIL_LINK' : 'MANUAL_LINK',
      }));
    }
  } catch (error) {
    await deleteDraftEsigningEnvelope(session, tenantId, envelope.id).catch(() => undefined);
    throw error;
  }
  return {
    envelope,
    signersAdded: signers.length,
    signersWithoutEmail: signers.filter((signer) => !signer.email).length,
    finalized: drafts.length,
  };
}
