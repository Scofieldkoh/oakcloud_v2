export function formatEsigningAccessModeLabel(accessMode: string | null | undefined): string {
  switch (accessMode) {
    case 'EMAIL_WITH_CODE':
      return 'Email link + access code';
    case 'MANUAL_LINK':
      return 'Manual signing link';
    case 'EMAIL_LINK':
    default:
      return 'Email link';
  }
}

export function summarizeEsigningUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) {
    return null;
  }

  const normalized = userAgent.toLowerCase();

  const browser =
    normalized.includes('edg/')
      ? 'Microsoft Edge'
      : normalized.includes('chrome/')
        ? 'Google Chrome'
        : normalized.includes('firefox/')
          ? 'Mozilla Firefox'
          : normalized.includes('safari/') && !normalized.includes('chrome/')
            ? 'Safari'
            : normalized.includes('opr/') || normalized.includes('opera/')
              ? 'Opera'
              : 'Unknown browser';

  const operatingSystem =
    normalized.includes('iphone') || normalized.includes('ipad')
      ? 'iOS'
      : normalized.includes('android')
        ? 'Android'
        : normalized.includes('windows')
          ? 'Windows'
          : normalized.includes('mac os x') || normalized.includes('macintosh')
            ? 'macOS'
            : normalized.includes('linux')
              ? 'Linux'
              : 'Unknown OS';

  const deviceType =
    normalized.includes('ipad') || normalized.includes('tablet')
      ? 'Tablet'
      : normalized.includes('mobile') || normalized.includes('iphone') || normalized.includes('android')
        ? 'Mobile'
        : 'Desktop';

  return `${browser} on ${operatingSystem} (${deviceType})`;
}

export function buildEsigningEventLabel(input: {
  action: string;
  recipientName?: string | null;
}): string {
  const recipientSuffix = input.recipientName ? ` ${input.recipientName}` : '';

  switch (input.action) {
    case 'CREATED':
      return 'Envelope created';
    case 'SENT':
      return 'Envelope sent for signature';
    case 'VIEWED':
      return `Viewed by${recipientSuffix}`.trim();
    case 'CONSENTED':
      return `Electronic consent given by${recipientSuffix}`.trim();
    case 'SIGNED':
      return `Signed by${recipientSuffix}`.trim();
    case 'DECLINED':
      return `Declined by${recipientSuffix}`.trim();
    case 'VOIDED':
      return 'Envelope voided';
    case 'CORRECTED':
      return input.recipientName ? `Recipient corrected: ${input.recipientName}` : 'Envelope corrected';
    case 'COMPLETED':
      return 'All parties signed - envelope completed';
    case 'REMINDER_SENT':
      return input.recipientName ? `Reminder sent to ${input.recipientName}` : 'Reminder sent';
    case 'EXPIRED':
      return 'Envelope expired';
    case 'PDF_GENERATION_FAILED':
      return 'Signed PDF generation failed';
    default:
      return input.action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
  }
}

export function isEsigningPositiveEvent(action: string): boolean {
  return !['DECLINED', 'VOIDED', 'EXPIRED', 'PDF_GENERATION_FAILED'].includes(action);
}
