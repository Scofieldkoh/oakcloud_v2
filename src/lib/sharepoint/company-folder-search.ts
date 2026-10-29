const COMPANY_LEGAL_SUFFIX_PATTERN = /\s*,?\s*(?:pte\.?\s+ltd\.?|private\s+limited|public\s+limited|incorporated|corporation|limited|llp|llc|inc|corp|company|co|pte|private|ltd)\.?\s*$/i;

/**
 * Build the initial SharePoint folder search term without changing the
 * company's displayed/legal name.
 */
export function getCompanyFolderSearchTerm(companyName: string): string {
  const original = companyName.trim().replace(/\s+/g, ' ');
  let result = original;

  while (result) {
    const stripped = result.replace(COMPANY_LEGAL_SUFFIX_PATTERN, '').trim();
    if (stripped === result) break;
    result = stripped;
  }

  return result || original;
}

/**
 * Keep the complete company name for an auto-created folder while removing
 * terminal periods that SharePoint does not permit in folder names.
 */
export function getCompanyFolderName(companyName: string): string {
  const original = companyName.trim().replace(/\s+/g, ' ');
  return original.replace(/\.+$/, '').trim() || original;
}
