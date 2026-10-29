import { describe, expect, it } from 'vitest';
import { esigningRecipientInputSchema } from '@/lib/validations/esigning';

describe('e-signing recipient email validation', () => {
  it('allows manual-link signers without an email address', () => {
    const result = esigningRecipientInputSchema.safeParse({
      type: 'SIGNER',
      name: 'Manual signer',
      accessMode: 'MANUAL_LINK',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
    }
  });

  it('requires an email when the recipient method sends email', () => {
    expect(esigningRecipientInputSchema.safeParse({
      type: 'SIGNER',
      name: 'Email signer',
      accessMode: 'EMAIL_LINK',
    }).success).toBe(false);

    expect(esigningRecipientInputSchema.safeParse({
      type: 'CC',
      name: 'Internal copy',
      accessMode: 'MANUAL_LINK',
    }).success).toBe(false);
  });
});
