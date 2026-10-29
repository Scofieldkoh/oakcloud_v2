import { z } from 'zod';

export const contactDuplicateListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const rejectContactDuplicatePairSchema = z.object({
  leftContactId: z.string().uuid(),
  rightContactId: z.string().uuid(),
  leftFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  rightFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  reason: z.string().trim().min(10).max(1_000),
}).refine(({ leftContactId, rightContactId }) => leftContactId !== rightContactId, {
  message: 'Contact IDs must be different',
  path: ['rightContactId'],
});
