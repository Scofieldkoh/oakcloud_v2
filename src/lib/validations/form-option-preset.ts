import { z } from 'zod';

export const FORM_PRESET_MAX_OPTIONS = 5_000;
export const FORM_PRESET_MAX_FILE_BYTES = 5_000_000;
export const FORM_PRESET_NAME_MAX_LENGTH = 120;

export const presetOptionSchema = z.object({
  value: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(500),
});

export type PresetOption = z.infer<typeof presetOptionSchema>;

export const createFormOptionPresetSchema = z.object({
  name: z.string().trim().min(1).max(FORM_PRESET_NAME_MAX_LENGTH),
  csv: z.string().min(1),
});

export const updateFormOptionPresetSchema = z.object({
  name: z.string().trim().min(1).max(FORM_PRESET_NAME_MAX_LENGTH).optional(),
  csv: z.string().min(1).optional(),
}).refine((value) => value.name !== undefined || value.csv !== undefined, {
  message: 'Provide a name or CSV content to update',
});

export const previewFormOptionPresetSchema = z.object({
  csv: z.string().min(1),
});

export type CreateFormOptionPresetInput = z.infer<typeof createFormOptionPresetSchema>;
export type UpdateFormOptionPresetInput = z.infer<typeof updateFormOptionPresetSchema>;
