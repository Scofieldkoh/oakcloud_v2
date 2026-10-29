/** Local types of the public form page: uploads, drafts, repeat sections and render groups. */

import { type PublicFormField as PublicField } from '@/lib/form-utils';
import { type NameCheckResultValue } from '@/lib/forms/name-check-result';

export type UploadStatus = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type DraftSession = {
  draftCode: string;
  accessToken: string;
  resumeUrl: string;
  expiresAt: string;
  savedAt: string;
};

export type NameCheckResult = NameCheckResultValue;

export type DraftRestorePayload = {
  draft: DraftSession;
  answers: Record<string, unknown>;
  metadata: Record<string, unknown>;
  uploadsByFieldKey: Record<string, UploadStatus[]>;
};

export type RepeatSectionConfig = {
  id: string;
  minItems: number;
  maxItems: number | null;
  addLabel: string;
  /** When set, rows render as numbered cards ("Shareholder or director 1"). */
  itemLabel: string | null;
  total: { fieldKey: string; label: string; suffix: string; target: number | null } | null;
};

export type ChoiceAnswerEntry = {
  value: string;
  detailText: string;
  children: ChoiceAnswerEntry[];
};

export type InfoPadding = {
  top: number | null;
  right: number | null;
  bottom: number | null;
  left: number | null;
};

export type RenderGroup = {
  kind: 'group';
  heading: PublicField | null;
  fields: PublicField[];
};

export type RenderStandalone = {
  kind: 'standalone';
  field: PublicField;
};

export type RenderItem = RenderGroup | RenderStandalone;
