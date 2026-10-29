import { z } from 'zod';

/** The complete set of user-editable preferences. Values are data, never prompt
 * instructions, authorization policy, executable code, or business facts. */
export const assistantPreferenceDefinitions = {
  language: { label: 'Response language', schema: z.enum(['en', 'zh', 'ms']), options: [
    { value: 'en', label: 'English' }, { value: 'zh', label: 'Chinese' }, { value: 'ms', label: 'Malay' },
  ] },
  response_detail: { label: 'Response detail', schema: z.enum(['concise', 'standard', 'detailed']), options: [
    { value: 'concise', label: 'Concise' }, { value: 'standard', label: 'Standard' }, { value: 'detailed', label: 'Detailed' },
  ] },
  playfulness: { label: 'Conversational tone', schema: z.enum(['none', 'light']), options: [
    { value: 'none', label: 'Straightforward' }, { value: 'light', label: 'Light and friendly' },
  ] },
} as const;

export type AssistantPreferenceKey = keyof typeof assistantPreferenceDefinitions;
export function getAssistantPreferenceDefinition(key: string) {
  return Object.prototype.hasOwnProperty.call(assistantPreferenceDefinitions, key)
    ? assistantPreferenceDefinitions[key as AssistantPreferenceKey] : undefined;
}
