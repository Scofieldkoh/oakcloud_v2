/** Public types of form responses, drafts and exports. */

import {
  FormStatus,
  FormSubmissionStatus,
  type FormSubmission,
  type FormUpload,
} from '@/generated/prisma';
import { type FormResponseReviewStatus } from '@/lib/form-utils';

export interface FormResponseAttachmentListItem {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface FormResponseSubmissionListItem extends FormSubmission {
  uploadCount: number;
  attachments: FormResponseAttachmentListItem[];
}

export interface FormResponseDraftListItem {
  id: string;
  code: string;
  answers: Record<string, unknown>;
  metadata: Record<string, unknown>;
  expiresAt: Date;
  lastSavedAt: Date;
  createdAt: Date;
  uploadCount: number;
  attachments: FormResponseAttachmentListItem[];
}

export interface FormResponseDetailResult {
  submission: FormSubmission;
  uploads: FormUpload[];
}

export interface FormDraftDetailResult {
  draft: FormResponseDraftListItem;
  uploads: FormUpload[];
}

export interface DeleteFormResponseResult {
  id: string;
  deletedUploadCount: number;
}

export interface DeleteFormResponseUploadResult {
  id: string;
  submissionId: string;
}

export interface RecentFormSubmissionItem {
  id: string;
  formId: string;
  formTitle: string;
  formSlug: string;
  formStatus: FormStatus;
  submittedAt: Date;
  respondentName: string | null;
  respondentEmail: string | null;
  status: FormSubmissionStatus;
}

export interface FormResponsesQueryInput {
  submissionSortBy?: string;
  submissionSortOrder?: 'asc' | 'desc';
  submissionFilters?: Record<string, string>;
}

export type FormResponsesExportStatus = FormSubmissionStatus | 'DRAFT' | 'ALL_WITH_DRAFTS';

export interface FormResponsesExportInput {
  fromDate?: Date;
  toDate?: Date;
  status?: FormResponsesExportStatus;
  submissionIds?: string[];
  draftIds?: string[];
  submissionFilters?: Record<string, string>;
  includeTags?: string[];
  excludeTags?: string[];
}

export interface FormResponsesExcelExportResult {
  buffer: Buffer;
  fileName: string;
}

export interface UpdateFormResponseTagsResult {
  id: string;
  tags: string[];
}

export interface UpdateFormResponseReviewStatusResult {
  id: string;
  reviewStatus: FormResponseReviewStatus;
}

export interface FormResponsesResult {
  submissions: FormResponseSubmissionListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  drafts: FormResponseDraftListItem[];
  draftTotal: number;
  draftPage: number;
  draftLimit: number;
  draftTotalPages: number;
  chart: Array<{ date: string; responses: number }>;
}
