import { createHash } from 'crypto';
import {
  getCanonicalSharePointItem,
  getWorkspaceSharePointContext,
  sharePointGraphRequest,
  uploadSharePointContent,
  SharePointServiceError,
  type CanonicalSharePointItem,
} from './sharepoint.service';
import { invalidateSharePointFolderCache } from './sharepoint-folder.service';

const MAX_SIGNED_DOCUMENT_BYTES = 250 * 1024 * 1024;

export interface SignedUploadInput {
  workspaceId: string;
  connectorId: string;
  destinationFolderId: string;
  fileName: string;
  content: Buffer;
  mimeType?: string;
}

export interface SignedUploadResult extends CanonicalSharePointItem {
  eTag?: string;
}

function ensurePdfUpload(input: SignedUploadInput): void {
  if (!input.fileName.toLowerCase().endsWith('.pdf') || input.mimeType && input.mimeType !== 'application/pdf') {
    throw new SharePointServiceError({ code: 'SOURCE_INVALID_TYPE', category: 'VALIDATION', statusCode: 400, message: 'Signed document must be a PDF' });
  }
  if (input.content.length === 0 || input.content.length > MAX_SIGNED_DOCUMENT_BYTES) {
    throw new SharePointServiceError({ code: 'SOURCE_INVALID_SIZE', category: 'VALIDATION', statusCode: 400, message: 'Signed document size is not supported' });
  }
}

export async function uploadSignedDocument(input: SignedUploadInput): Promise<SignedUploadResult> {
  ensurePdfUpload(input);
  const context = await getWorkspaceSharePointContext({ workspaceId: input.workspaceId, connectorId: input.connectorId });
  const destination = await getCanonicalSharePointItem(context, input.destinationFolderId);
  if (!destination.isFolder) {
    throw new SharePointServiceError({ code: 'DESTINATION_NOT_FOLDER', category: 'VALIDATION', statusCode: 400, message: 'SharePoint destination is not a folder' });
  }
  const uploaded = await uploadSharePointContent(context, destination.id, input.fileName, input.content, input.mimeType ?? 'application/pdf');
  invalidateSharePointFolderCache({ workspaceId: input.workspaceId, connectorId: input.connectorId, driveId: context.driveId, parentItemId: destination.id });
  return {
    id: uploaded.id,
    name: uploaded.name,
    webUrl: uploaded.webUrl,
    driveId: uploaded.driveId,
    parentItemId: destination.id,
    size: uploaded.size,
    isFolder: false,
    eTag: uploaded.eTag,
  };
}

export async function findItemByName(input: {
  workspaceId: string;
  connectorId: string;
  folderId: string;
  name: string;
}): Promise<CanonicalSharePointItem | null> {
  const context = await getWorkspaceSharePointContext({ workspaceId: input.workspaceId, connectorId: input.connectorId });
  const folder = await getCanonicalSharePointItem(context, input.folderId);
  if (!folder.isFolder) throw new SharePointServiceError({ code: 'DESTINATION_NOT_FOLDER', category: 'VALIDATION', statusCode: 400, message: 'SharePoint destination is not a folder' });

  let next: string | undefined = `/items/${encodeURIComponent(folder.id)}/children?$top=200&$select=id,name,webUrl,size,folder,file,parentReference`;
  while (next) {
    const graphResponse: {
      value: Array<{
        id: string;
        name: string;
        webUrl: string;
        size?: number;
        folder?: { childCount?: number };
        file?: { hashes?: { quickXorHash?: string; sha1Hash?: string } };
        parentReference?: { driveId?: string; id?: string };
      }>;
      '@odata.nextLink'?: string;
    } = await sharePointGraphRequest<{
      value: Array<{
        id: string;
        name: string;
        webUrl: string;
        size?: number;
        folder?: { childCount?: number };
        file?: { hashes?: { quickXorHash?: string; sha1Hash?: string } };
        parentReference?: { driveId?: string; id?: string };
      }>;
      '@odata.nextLink'?: string;
    }>(context, next);
    const wantedName = input.name.toLocaleLowerCase();
    const match = graphResponse.value?.find((item) => item.name.toLocaleLowerCase() === wantedName);
    if (match) {
      return {
        id: match.id,
        name: match.name,
        webUrl: match.webUrl,
        driveId: match.parentReference?.driveId || context.driveId,
        parentItemId: match.parentReference?.id || folder.id,
        size: match.size,
        isFolder: Boolean(match.folder),
        fileHash: match.file?.hashes?.sha1Hash || match.file?.hashes?.quickXorHash,
      };
    }
    next = graphResponse['@odata.nextLink'];
  }
  return null;
}

export function sha256Content(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Compare the persisted item evidence before adopting an uncertain upload. */
export function uploadedItemMatches(input: {
  item: Pick<CanonicalSharePointItem, 'driveId' | 'parentItemId' | 'size' | 'fileHash'>;
  destinationFolderId: string;
  driveId: string;
  expectedSize: number;
  expectedHash?: string;
}): boolean {
  return input.item.driveId === input.driveId
    && input.item.parentItemId === input.destinationFolderId
    && input.item.size === input.expectedSize;
}
