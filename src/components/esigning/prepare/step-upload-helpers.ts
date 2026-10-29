import type { EsigningRecipientAccessMode, EsigningRecipientType, EsigningSigningOrder } from '@/generated/prisma';
import type { EsigningEnvelopeRecipientDto } from '@/types/esigning';
import type { ReorderEsigningRecipientsPayload } from '@/hooks/use-esigning';

/** Pure helpers for the Documents & Recipients step of envelope preparation. */

export const RECIPIENT_ACCENT_COLORS = ['#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#f97316'];
export const SIGNING_ORDER_CYCLE: EsigningSigningOrder[] = ['PARALLEL', 'SEQUENTIAL', 'MIXED'];
export const SIGNING_ORDER_PILL_LABELS: Record<EsigningSigningOrder, string> = {
  PARALLEL: 'Parallel',
  SEQUENTIAL: 'Sequential',
  MIXED: 'Mixed',
};

export const DEFAULT_RECIPIENT_FORM = {
  name: '',
  email: '',
  type: 'SIGNER' as EsigningRecipientType,
  accessMode: 'MANUAL_LINK' as EsigningRecipientAccessMode,
  accessCode: '',
};

export const EDITABLE_CONTROL_CLASS_NAME = [
  'bg-emerald-50',
  'dark:bg-emerald-950/30',
  'disabled:bg-background-primary',
  'dark:disabled:bg-background-secondary',
].join(' ');

export function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateInputValueToIso(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T00:00`).toISOString();
}

export function parseOptionalWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function signerGroupsEqual(left: string[][], right: string[][]): boolean {
  return left.length === right.length && left.every((group, index) => arraysEqual(group, right[index] ?? []));
}

export function getNextSigningOrder(current: EsigningSigningOrder): EsigningSigningOrder {
  const currentIndex = SIGNING_ORDER_CYCLE.indexOf(current);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % SIGNING_ORDER_CYCLE.length;
  return SIGNING_ORDER_CYCLE[nextIndex] ?? 'PARALLEL';
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function parseCompletionCopyEmails(value: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const entry of value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean)) {
    const normalized = normalizeEmail(entry);
    if (!isValidEmail(normalized)) {
      if (!invalid.includes(entry)) {
        invalid.push(entry);
      }
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      emails.push(normalized);
    }
  }

  return { emails, invalid };
}

export function splitFullName(value: string): { firstName: string; lastName: string | null } {
  const parts = value.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: '', lastName: null };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1] ?? null,
  };
}

export function buildSignerGroups(
  recipients: EsigningEnvelopeRecipientDto[],
  envelopeSigningOrder: EsigningSigningOrder
): string[][] {
  const orderedRecipients = [...recipients].sort((left, right) => {
    const leftOrder = left.signingOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.signingOrder ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });

  if (envelopeSigningOrder !== 'MIXED') {
    return orderedRecipients.map((recipient) => [recipient.id]);
  }

  const groups = new Map<number, string[]>();

  orderedRecipients.forEach((recipient, index) => {
    const groupOrder = recipient.signingOrder ?? index + 1;
    const existing = groups.get(groupOrder) ?? [];
    existing.push(recipient.id);
    groups.set(groupOrder, existing);
  });

  return [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, recipientIds]) => recipientIds);
}

export function reconcileSignerGroups(groups: string[][], signerIds: string[]): string[][] {
  const signerIdSet = new Set(signerIds);
  const seen = new Set<string>();
  const nextGroups = groups
    .map((group) =>
      group.filter((recipientId) => {
        if (!signerIdSet.has(recipientId) || seen.has(recipientId)) {
          return false;
        }
        seen.add(recipientId);
        return true;
      })
    )
    .filter((group) => group.length > 0);

  const missingGroups = signerIds
    .filter((recipientId) => !seen.has(recipientId))
    .map((recipientId) => [recipientId]);

  return [...nextGroups, ...missingGroups];
}

export function flattenSignerGroups(groups: string[][]): string[] {
  return groups.flat();
}

export function buildReorderRecipientsPayload(
  groups: string[][],
  signingOrder: EsigningSigningOrder
): ReorderEsigningRecipientsPayload {
  if (signingOrder === 'SEQUENTIAL') {
    return {
      recipients: flattenSignerGroups(groups).map((recipientId, index) => ({
        recipientId,
        signingOrder: index + 1,
      })),
    };
  }

  return {
    recipients: groups.flatMap((group, groupIndex) =>
      group.map((recipientId) => ({
        recipientId,
        signingOrder: groupIndex + 1,
      }))
    ),
  };
}

// Signer group edits for mixed routing. Each returns new groups and leaves the input untouched.

export function moveGroup(groups: string[][], groupIndex: number, direction: -1 | 1): string[][] {
  const targetIndex = groupIndex + direction;
  if (targetIndex < 0 || targetIndex >= groups.length) {
    return groups;
  }

  const nextGroups = [...groups];
  [nextGroups[groupIndex], nextGroups[targetIndex]] = [nextGroups[targetIndex] ?? [], nextGroups[groupIndex] ?? []];
  return nextGroups;
}

export function mergeGroup(groups: string[][], groupIndex: number): string[][] {
  if (groups.length <= 1) {
    return groups;
  }

  const nextGroups = groups.map((group) => [...group]);
  const group = nextGroups[groupIndex];
  if (!group || group.length === 0) {
    return nextGroups.filter((_, index) => index !== groupIndex);
  }

  const targetIndex = groupIndex > 0 ? groupIndex - 1 : 1;
  nextGroups[targetIndex] = [...(nextGroups[targetIndex] ?? []), ...group];
  return nextGroups.filter((_, index) => index !== groupIndex);
}

export function moveSignerToAdjacentGroup(
  groups: string[][],
  groupIndex: number,
  recipientId: string,
  direction: -1 | 1
): string[][] {
  const targetIndex = groupIndex + direction;
  if (targetIndex < 0 || targetIndex >= groups.length) {
    return groups;
  }

  const nextGroups = groups.map((group) => [...group]);
  nextGroups[groupIndex] = nextGroups[groupIndex]?.filter((id) => id !== recipientId) ?? [];
  nextGroups[targetIndex] = [...(nextGroups[targetIndex] ?? []), recipientId];
  return nextGroups.filter((group) => group.length > 0);
}

export function splitSignerIntoOwnGroup(
  groups: string[][],
  groupIndex: number,
  recipientId: string
): string[][] {
  const group = groups[groupIndex] ?? [];
  if (group.length <= 1) {
    return groups;
  }

  const nextGroups = groups.map((entry) => [...entry]);
  nextGroups[groupIndex] = nextGroups[groupIndex]?.filter((id) => id !== recipientId) ?? [];
  nextGroups.splice(groupIndex + 1, 0, [recipientId]);
  return nextGroups.filter((entry) => entry.length > 0);
}
