import { z } from 'zod';

export const listCommunicationsSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID').optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type ListCommunicationsInput = z.infer<typeof listCommunicationsSchema>;

export const ingestCommunicationsSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID').optional(),
  lookbackDays: z.coerce.number().int().min(1).max(365).default(30),
  maxMessagesPerMailbox: z.coerce.number().int().min(1).max(500).default(200),
});

export type IngestCommunicationsInput = z.infer<typeof ingestCommunicationsSchema>;

export const updateCommunicationMailboxesSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID').optional(),
  mailboxUserIds: z
    .array(z.string().email('Mailbox must be a valid email address'))
    .min(1, 'At least one mailbox is required')
    .max(50, 'Too many mailboxes (max 50)')
    .optional(),
  ingestAllEmails: z.boolean().optional(),
}).refine(
  (data) => data.mailboxUserIds !== undefined || data.ingestAllEmails !== undefined,
  {
    message: 'Provide mailbox settings to update',
    path: ['mailboxUserIds'],
  }
);

export type UpdateCommunicationMailboxesInput = z.infer<typeof updateCommunicationMailboxesSchema>;

export const deleteCommunicationSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID').optional(),
});

export type DeleteCommunicationInput = z.infer<typeof deleteCommunicationSchema>;

export const bulkDeleteCommunicationsSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID').optional(),
  ids: z
    .array(z.string().uuid('Invalid communication ID'))
    .min(1, 'Select at least one communication')
    .max(500, 'Too many communications selected'),
});

export type BulkDeleteCommunicationsInput = z.infer<typeof bulkDeleteCommunicationsSchema>;
