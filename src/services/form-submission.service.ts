/**
 * Public entry point for form submissions. The implementation is split by
 * responsibility under ./form-submission/.
 */

export type {
  FormResponseAttachmentListItem,
  FormResponseSubmissionListItem,
  FormResponseDraftListItem,
  FormResponseDetailResult,
  FormDraftDetailResult,
  DeleteFormResponseResult,
  DeleteFormResponseUploadResult,
  RecentFormSubmissionItem,
  FormResponsesQueryInput,
  FormResponsesExportStatus,
  FormResponsesExportInput,
  FormResponsesExcelExportResult,
  UpdateFormResponseTagsResult,
  UpdateFormResponseReviewStatusResult,
  FormResponsesResult,
} from './form-submission/types';
export type { PublicFormField, PublicFormDefinition } from '@/lib/form-utils';
export {
  validateCompanyNameCheckResults,
  sanitizeSubmissionMetadata,
  sanitizePublicAnswers as sanitizeSubmissionAnswers,
  validateRequiredPublicAnswers,
} from './form-submission/validation';
export {
  sendCompletionNotificationEmailInternal,
} from './form-submission/notifications';
export {
  getFormResponses,
  getFormResponseById,
  updateFormResponseTags,
  updateFormResponseReviewStatus,
  getFormDraftById,
  reconcileFormSubmissionCounts,
  deleteFormResponse,
  deleteFormResponseUpload,
  listRecentFormSubmissions,
} from './form-submission/responses';
export {
  exportFormResponsesExcel,
  exportFormResponsesCsv,
} from './form-submission/export';
export {
  getPublicFormBySlug,
  createPublicUpload,
  createPublicSubmission,
  getSubmissionUploads,
  getSubmissionUploadById,
  getDraftUploadById,
  cleanupOrphanedUploads,
} from './form-submission/public-submission';
