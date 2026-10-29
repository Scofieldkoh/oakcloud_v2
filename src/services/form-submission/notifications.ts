/**
 * Completion notification emails for form submissions, with their attachments.
 */

import {
  type Form,
  type FormField,
  type FormSubmission,
  type FormUpload,
} from '@/generated/prisma';
import {
  parseFormAiSettings,
  parseFormNotificationSettings,
  parseFormSubmissionAiReview,
  toAnswerRecord,
} from '@/lib/form-utils';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { getAppBaseUrl, sendEmail, type EmailAttachment } from '@/lib/email';
import { normalizeWorkspaceLogoUrl } from '@/lib/workspace-logo-url';
import { escapeHtml } from '@/services/form-builder.helpers';
import { buildSubmissionPdfBuffer, resolveSubmissionPdfFileName } from '@/services/form-pdf.service';
import {
  MAX_NOTIFICATION_ATTACHMENT_BYTES,
  MAX_NOTIFICATION_UPLOAD_ATTACHMENTS,
  MAX_NOTIFICATION_DOWNLOAD_CONCURRENCY,
  log,
} from './shared';

async function buildSubmissionNotificationAttachments(input: {
  pdfFileName: string;
  pdfBuffer: Buffer;
  uploads: FormUpload[];
}): Promise<{ attachments: EmailAttachment[]; omittedUploads: number }> {
  const attachments: EmailAttachment[] = [
    {
      filename: input.pdfFileName,
      content: input.pdfBuffer,
      contentType: 'application/pdf',
    },
  ];

  let omittedUploads = 0;
  const uploadsToAttach = input.uploads.slice(0, MAX_NOTIFICATION_UPLOAD_ATTACHMENTS);
  omittedUploads += Math.max(0, input.uploads.length - uploadsToAttach.length);

  // Phase 1: pre-filter based on expected size so we avoid downloading bytes
  // we know won't fit. Mirrors the greedy accept-in-order semantics of the
  // original sequential loop, but without waiting on each download.
  const toDownload: FormUpload[] = [];
  let projectedBytes = input.pdfBuffer.length;
  for (const upload of uploadsToAttach) {
    if (projectedBytes >= MAX_NOTIFICATION_ATTACHMENT_BYTES) {
      omittedUploads += 1;
      continue;
    }
    const expectedSize = Math.max(0, upload.sizeBytes || 0);
    if (expectedSize > 0 && projectedBytes + expectedSize > MAX_NOTIFICATION_ATTACHMENT_BYTES) {
      omittedUploads += 1;
      continue;
    }
    toDownload.push(upload);
    projectedBytes += expectedSize;
  }

  // Phase 2: fetch survivors in small concurrent batches so we improve
  // latency without over-downloading large blobs that may later be dropped.
  let totalBytes = input.pdfBuffer.length;
  for (let i = 0; i < toDownload.length; i += MAX_NOTIFICATION_DOWNLOAD_CONCURRENCY) {
    if (totalBytes >= MAX_NOTIFICATION_ATTACHMENT_BYTES) {
      omittedUploads += toDownload.length - i;
      break;
    }

    const batch = toDownload.slice(i, i + MAX_NOTIFICATION_DOWNLOAD_CONCURRENCY);
    const downloadResults = await Promise.all(
      batch.map(async (upload): Promise<{ upload: FormUpload; content?: Buffer; error?: unknown }> => {
        try {
          const content = await storage.download(upload.storageKey);
          return { upload, content };
        } catch (error) {
          return { upload, error };
        }
      })
    );

    // Apply the real-byte budget in original order.
    for (const { upload, content, error } of downloadResults) {
      if (error || !content) {
        omittedUploads += 1;
        log.error('Failed to load upload for form completion email', {
          formId: upload.formId,
          uploadId: upload.id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (totalBytes + content.length > MAX_NOTIFICATION_ATTACHMENT_BYTES) {
        omittedUploads += 1;
        continue;
      }
      attachments.push({
        filename: upload.fileName,
        content,
        contentType: upload.mimeType || 'application/octet-stream',
      });
      totalBytes += content.length;
    }
  }

  return { attachments, omittedUploads };
}

export async function sendCompletionNotificationEmailInternal(input: {
  form: Form & { fields: FormField[] };
  submission: FormSubmission;
  uploads: FormUpload[];
  tenantTimeZone: string;
}): Promise<void> {
  const notificationSettings = parseFormNotificationSettings(input.form.settings);
  const recipients = notificationSettings.completionRecipientEmails;
  if (recipients.length === 0) return;

  try {
    const answers = toAnswerRecord(input.submission.answers);
    const aiSettings = parseFormAiSettings(input.form.settings);
    const aiReview = parseFormSubmissionAiReview(input.submission.metadata);
    const aiReviewRequired = aiReview?.status === 'completed' && aiReview.reviewRequired;
    const aiReviewFailed = aiSettings.enabled && aiReview?.status === 'failed';
    const tenant = await prisma.workspace.findUnique({
      where: { id: input.form.tenantId },
      select: { logoUrl: true, name: true },
    });
    const linkOnly = notificationSettings.attachmentMode === 'link_only';
    const pdfBuffer = linkOnly ? null : await buildSubmissionPdfBuffer({
      formTitle: input.form.title,
      formDescription: input.form.description,
      submittedAt: input.submission.submittedAt,
      respondentName: input.submission.respondentName,
      respondentEmail: input.submission.respondentEmail,
      status: input.submission.status,
      fields: input.form.fields,
      answers,
      uploads: input.uploads,
      tenantLogoUrl: normalizeWorkspaceLogoUrl(tenant?.logoUrl),
      tenantName: tenant?.name ?? null,
      formSettings: input.form.settings,
      timeZone: input.tenantTimeZone,
    });
    const pdfFileName = resolveSubmissionPdfFileName({
      formTitle: input.form.title,
      formSlug: input.form.slug,
      settings: input.form.settings,
      submissionId: input.submission.id,
      submittedAt: input.submission.submittedAt,
      timeZone: input.tenantTimeZone,
      answers,
    });

    const { attachments, omittedUploads } = pdfBuffer
      ? await buildSubmissionNotificationAttachments({
        pdfFileName,
        pdfBuffer,
        uploads: input.uploads,
      })
      : { attachments: [], omittedUploads: 0 };

    const safeFormTitle = escapeHtml(input.form.title);
    const submittedAt = new Date(input.submission.submittedAt).toLocaleString('en-SG');
    const responseUrl = `${getAppBaseUrl()}/forms/${encodeURIComponent(input.form.id)}/responses/${encodeURIComponent(input.submission.id)}`;
    const safeResponseUrl = responseUrl.replace(/"/g, '&quot;');
    const omittedMessage = omittedUploads > 0
      ? `<p><em>${omittedUploads} uploaded file(s) were not attached due to size or attachment limits.</em></p>`
      : '';
    const aiReviewSectionsHtml = aiReview
      ? aiReview.sections.map((section) => {
        if (section.type === 'text' && section.content) {
          return `
            <div style="margin-top:10px;">
              <p style="margin:0 0 6px;font-weight:600;color:#78350f;">${escapeHtml(section.title)}</p>
              <p style="margin:0;color:#78350f;">${escapeHtml(section.content)}</p>
            </div>
          `;
        }

        if (section.type === 'bullet_list' && section.items.length > 0) {
          return `
            <div style="margin-top:10px;">
              <p style="margin:0 0 6px;font-weight:600;color:#78350f;">${escapeHtml(section.title)}</p>
              <ul style="margin:0;padding-left:18px;color:#78350f;">${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            </div>
          `;
        }

        if (section.type === 'key_value' && section.entries.length > 0) {
          return `
            <div style="margin-top:10px;">
              <p style="margin:0 0 6px;font-weight:600;color:#78350f;">${escapeHtml(section.title)}</p>
              <ul style="margin:0;padding-left:18px;color:#78350f;">${section.entries.map((entry) => `<li><strong>${escapeHtml(entry.label)}:</strong> ${escapeHtml(entry.value)}</li>`).join('')}</ul>
            </div>
          `;
        }

        return '';
      }).join('')
      : '';
    const aiReviewHtml = aiReviewRequired
      ? `
        <div style="margin:16px 0;padding:12px 14px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;">
          <p style="margin:0 0 8px;font-weight:600;color:#92400e;">AI review flagged this submission for follow-up.</p>
          ${aiReview?.severity ? `<p style="margin:0 0 8px;color:#78350f;"><strong>Severity:</strong> ${escapeHtml(aiReview.severity.toUpperCase())}</p>` : ''}
          ${aiReview?.summary ? `<p style="margin:0 0 8px;color:#78350f;">${escapeHtml(aiReview.summary)}</p>` : ''}
          ${aiReview && aiReview.tags.length > 0 ? `<p style="margin:0 0 8px;color:#78350f;"><strong>Tags:</strong> ${aiReview.tags.map((tag) => escapeHtml(tag)).join(', ')}</p>` : ''}
          ${aiReviewSectionsHtml}
        </div>
      `
      : aiReviewFailed
        ? '<p><em>AI review did not complete before the internal notification was sent.</em></p>'
        : '';
    const html = `
      <p>Hello,</p>
      <p>A new response has been submitted for <strong>${safeFormTitle}</strong>.</p>
      <p>Submitted on: ${submittedAt}</p>
      <p><a href="${safeResponseUrl}">Open completed response</a></p>
      ${aiReviewHtml}
      ${omittedMessage}
      ${linkOnly
        ? '<p>Open the response in Oakcloud to view the answers and any uploaded files.</p>'
        : '<p>The response PDF and available uploaded files are attached.</p>'}
    `;

    const result = await sendEmail({
      to: recipients,
      subject: `${aiReviewRequired ? '[AI Review Required] ' : ''}New form submission: ${input.form.title}`,
      html,
      attachments,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to send completion notification');
    }
  } catch (error) {
    log.error('Failed to send form completion notification email', {
      formId: input.form.id,
      submissionId: input.submission.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
