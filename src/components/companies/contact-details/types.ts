/**
 * Types and constants for contact details components.
 *
 * This file re-exports from centralized locations for backward compatibility.
 * New code should import directly from:
 * - @/lib/constants/contact-details
 * - @/types/contact
 */

// Re-export from centralized constants
export {
  DETAIL_TYPE_CONFIG as detailTypeConfig,
  LABEL_SUGGESTIONS as labelSuggestions,
  RELATIONSHIP_OPTIONS as relationshipOptions,
  type ContactDetailFormState as EditFormState,
  type DetailTypeConfig,
} from '@/lib/constants/contact-details';

// Re-export types from hooks for backward compatibility
export type { ContactDetail, ContactWithDetails } from '@/hooks/use-contact-details';
