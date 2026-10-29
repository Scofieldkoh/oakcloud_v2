'use client';

import Link from 'next/link';
import { Mail, Phone, Pencil, Building2, User, Trash2, Star, Loader2 } from 'lucide-react';
import { CopyButton } from './copy-button';
import type { ContactWithDetails } from './types';

// Common abbreviations that should remain uppercase
const ABBREVIATIONS = new Set(['CEO', 'CFO', 'COO', 'CTO', 'CIO', 'CMO', 'HR', 'IT', 'VP', 'SVP', 'EVP']);

// Helper to normalize and convert to Title Case while preserving abbreviations
// Replaces underscores with spaces and converts to title case
function normalizeRole(str: string): string {
  // First check if the entire string (trimmed, uppercased) is an abbreviation
  const upperStr = str.trim().toUpperCase();
  if (ABBREVIATIONS.has(upperStr)) {
    return upperStr;
  }

  return str
    .replace(/_/g, ' ')  // Replace underscores with spaces
    .toLowerCase()
    .replace(/\b\w+/g, (word) => {
      const upperWord = word.toUpperCase();
      // Keep abbreviations uppercase
      if (ABBREVIATIONS.has(upperWord)) {
        return upperWord;
      }
      // Title case for other words
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
}

// Helper to deduplicate and clean up relationships
// - Normalizes underscores and casing for proper deduplication
// - Removes generic "Shareholder" if there's a more specific one like "Ordinary Shareholder"
function cleanRelationships(relationshipStr: string | undefined): string[] {
  if (!relationshipStr) return [];

  // Split, normalize, and deduplicate
  const normalizedRoles = relationshipStr
    .split(', ')
    .filter(Boolean)
    .map(normalizeRole);

  // Deduplicate after normalization
  const uniqueRoles = [...new Set(normalizedRoles)];

  // Check if there's a specific shareholder type (e.g., "Ordinary Shareholder", "Preference Shareholder")
  const hasSpecificShareholder = uniqueRoles.some(r => r.includes('Shareholder') && r !== 'Shareholder');

  // Filter out generic "Shareholder" if there's a more specific one
  return uniqueRoles.filter(r => {
    if (r === 'Shareholder' && hasSpecificShareholder) return false;
    return true;
  });
}

interface ContactRowProps {
  item: ContactWithDetails;
  companyId: string;
  canEdit: boolean;
  onAddDetail: () => void;
  onUnlink?: () => void;
  onTogglePoc?: (isPoc: boolean) => void;
  isTogglingPoc?: boolean;
}

const RELATIONSHIP_BADGE =
  'inline-flex min-h-5 items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium leading-none text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

const POC_BADGE =
  'inline-flex min-h-5 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium leading-none text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200';

export function ContactRow({
  item,
  companyId,
  canEdit,
  onAddDetail,
  onUnlink,
  onTogglePoc,
  isTogglingPoc,
}: ContactRowProps) {
  // Parse relationship to show badges (deduplicated, cleaned, and in title case)
  const relationships = cleanRelationships(item.contact.relationship);

  // Check if contact has Director or Shareholder roles (cannot unlink these directly)
  const hasProtectedRole = relationships.some(
    (rel) => rel.toLowerCase().includes('director') || rel.toLowerCase().includes('shareholder')
  );

  // Get company-specific email/phone for THIS company, otherwise fall back to contact's default detail
  // Company-specific details have both contactId AND companyId set (must match current company)
  // Default details have contactId but companyId is null
  const companySpecificEmail = item.details.find(
    d => d.detailType === 'EMAIL' && d.companyId === companyId
  );
  const companySpecificPhone = item.details.find(
    d => d.detailType === 'PHONE' && d.companyId === companyId
  );
  const defaultEmail = item.details.find(
    d => d.detailType === 'EMAIL' && d.companyId === null
  );
  const defaultPhone = item.details.find(
    d => d.detailType === 'PHONE' && d.companyId === null
  );

  // Use company-specific (for THIS company) if available, otherwise contact's default detail
  const displayedEmail = companySpecificEmail?.value || defaultEmail?.value || null;
  const displayedPhone = companySpecificPhone?.value || defaultPhone?.value || null;

  // Get purposes from the displayed email's detail record
  const emailDetail = companySpecificEmail || defaultEmail;
  const emailPurposes = emailDetail?.purposes || [];

  // POC status is now company-specific, stored on CompanyContact
  const hasPoc = item.isPoc;

  // Handle POC toggle - toggle the company-specific POC status
  const handlePocClick = () => {
    if (!onTogglePoc || !canEdit) return;
    onTogglePoc(!hasPoc);
  };

  return (
    <div className="group flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
          {item.contact.contactType === 'CORPORATE' ? (
            <Building2 className="h-4 w-4 flex-shrink-0 text-text-tertiary" aria-hidden="true" />
          ) : (
            <User className="h-4 w-4 flex-shrink-0 text-text-tertiary" aria-hidden="true" />
          )}
          <Link
            href={`/contacts/${item.contact.id}`}
            className="truncate text-oak-primary hover:underline"
          >
            {item.contact.fullName}
          </Link>
          {relationships.map((rel) => (
            <span key={rel} className={RELATIONSHIP_BADGE}>
              {rel}
            </span>
          ))}
          {hasPoc && (
            <span className={POC_BADGE} title="Point of Contact">
              <Star className="h-3 w-3 fill-current" aria-hidden="true" />
              Point of Contact
            </span>
          )}
          {!item.isCurrent && (
            <span className="inline-flex min-h-5 items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium leading-none text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              Past
            </span>
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
          {displayedPhone && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Phone className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary" aria-hidden="true" />
              <span className="truncate">{displayedPhone}</span>
              <CopyButton value={displayedPhone} label="phone number" />
            </span>
          )}
          {displayedEmail && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Mail className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary" aria-hidden="true" />
              <span className="truncate">{displayedEmail}</span>
              <CopyButton value={displayedEmail} label="email address" />
            </span>
          )}
          {emailPurposes.map((purpose) => (
            <span key={purpose} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              {purpose}
            </span>
          ))}
          {!displayedPhone && !displayedEmail && (
            <span className="italic">No contact details</span>
          )}
        </p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {canEdit ? (
          <button
            onClick={handlePocClick}
            disabled={isTogglingPoc}
            className={`rounded p-1 transition-colors ${
              hasPoc
                ? 'text-amber-500 hover:text-amber-600'
                : 'text-text-muted hover:text-amber-500'
            } disabled:opacity-50`}
            aria-label={hasPoc ? `Remove ${item.contact.fullName} as point of contact` : `Set ${item.contact.fullName} as point of contact`}
            aria-pressed={hasPoc}
          >
            {isTogglingPoc ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Star className={`h-4 w-4 ${hasPoc ? 'fill-current' : ''}`} aria-hidden="true" />
            )}
          </button>
        ) : hasPoc ? (
          <span className="text-amber-500" aria-label={`${item.contact.fullName} is point of contact`}>
            <Star className="h-4 w-4 fill-current" aria-hidden="true" />
          </span>
        ) : null}
        {canEdit && (
          <button
            onClick={onAddDetail}
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-tertiary hover:text-oak-light"
            aria-label={`Edit contact details for ${item.contact.fullName}`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        {canEdit && onUnlink && !hasProtectedRole && (
          <button
            onClick={onUnlink}
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-tertiary hover:text-status-error"
            aria-label={`Remove ${item.contact.fullName} from company`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
