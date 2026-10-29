import { describe, expect, it } from 'vitest';
import { SERVICE_AGREEMENT_SLOTS } from '@/lib/service-agreement-template';
import { OAKTREE_SERVICE_AGREEMENT_V1 } from '@/content/service-agreement/oaktree-service-agreement-v1';
import { seedServiceAgreementBundle } from '../../scripts/seed-service-agreement-template';

describe('initial Service Agreement content bundle', () => {
  it('contains one active agreement template and exactly two supplied services', () => {
    expect(OAKTREE_SERVICE_AGREEMENT_V1.template.compositionType).toBe(
      'SERVICE_AGREEMENT',
    );
    for (const token of Object.values(SERVICE_AGREEMENT_SLOTS)) {
      expect(OAKTREE_SERVICE_AGREEMENT_V1.template.content.split(token)).toHaveLength(2);
    }
    expect(OAKTREE_SERVICE_AGREEMENT_V1.template.content).not.toMatch(
      /OpenSign|DocumentId/,
    );
    expect(OAKTREE_SERVICE_AGREEMENT_V1.template.content).not.toContain('<img');
    expect(OAKTREE_SERVICE_AGREEMENT_V1.template.placeholders.map((placeholder) => placeholder.key)).toEqual([
      'custom.agreementDate',
      'custom.effectiveDate',
      'custom.termMonths',
    ]);
    expect(OAKTREE_SERVICE_AGREEMENT_V1.variants).toHaveLength(2);
    expect(OAKTREE_SERVICE_AGREEMENT_V1.families.every((family) => !family.isActive)).toBe(
      true,
    );
    expect(OAKTREE_SERVICE_AGREEMENT_V1.variants.every((variant) => !variant.isActive)).toBe(
      true,
    );
    expect(OAKTREE_SERVICE_AGREEMENT_V1.template.isActive).toBe(true);
  });

  it('retains the controlled clause fingerprints and saved agreement date', () => {
    const content = OAKTREE_SERVICE_AGREEMENT_V1.template.content;
    for (const clause of [
      'Services will be performed in such manner, at such place or places',
      'shall not be held responsible for the production of inaccurate financial statements',
      'we will mutually agree with you on a revised fee',
      'Email address / Mobile',
      'data-signature-placeholder="oaktree-cover"',
      'data-signature-placeholder="client-acceptance"',
      'data-signature-placeholder="authorised-representative-specimen"',
      'data-signature-placeholder="oaktree-sow"',
      'data-signature-placeholder="client-sow"',
    ]) {
      expect(content).toContain(clause);
    }
    expect(content).toContain('{{custom.agreementDate}}');
    expect(content).not.toContain('{{system.currentDate}}');
  });

  it('increments material versions once and preserves reviewed activation on rerun', async () => {
    const families = new Map<string, any>();
    const partials = new Map<string, any>();
    const variants = new Map<string, any>();
    const fees = new Map<string, any[]>();
    let template: any = null;
    let sequence = 0;
    const apply = (record: any, data: any) => {
      for (const [key, value] of Object.entries(data)) {
        if (key === 'version' && value && typeof value === 'object' && 'increment' in value) {
          record.version += Number(value.increment);
        } else {
          record[key] = value;
        }
      }
      return record;
    };
    const tx = {
      serviceFamily: {
        upsert: async ({ where, create, update }: any) => {
          const key = where.tenantId_code.code;
          const current = families.get(key);
          if (current) return apply(current, update);
          const saved = { id: `family-${++sequence}`, ...create };
          families.set(key, saved);
          return saved;
        },
      },
      templatePartial: {
        findUnique: async ({ where }: any) => partials.get(where.tenantId_name.name) ?? null,
        findMany: async ({ where }: any) => [...partials.values()]
          .filter((partial: any) => where.name.in.includes(partial.name)),
        upsert: async ({ where, create, update }: any) => {
          const key = where.tenantId_name.name;
          const current = partials.get(key);
          if (current) return apply(current, update);
          const saved = { id: `partial-${++sequence}`, version: 1, ...create };
          partials.set(key, saved);
          return saved;
        },
      },
      serviceVariant: {
        findUnique: async ({ where }: any) => {
          const current = variants.get(where.tenantId_code.code);
          return current
            ? { ...current, defaultFeeTemplates: fees.get(current.id) ?? [] }
            : null;
        },
        upsert: async ({ where, create, update }: any) => {
          const key = where.tenantId_code.code;
          const current = variants.get(key);
          if (current) return apply(current, update);
          const saved = { id: `variant-${++sequence}`, version: 1, ...create };
          variants.set(key, saved);
          return saved;
        },
      },
      serviceVariantFeeTemplate: {
        deleteMany: async ({ where }: any) => fees.set(where.variantId, []),
        createMany: async ({ data }: any) => {
          for (const fee of data) {
            fees.set(fee.variantId, [
              ...(fees.get(fee.variantId) ?? []),
              { id: `fee-template-${++sequence}`, ...fee },
            ]);
          }
        },
      },
      documentTemplate: {
        updateMany: async () => ({ count: 0 }),
        findFirst: async () => template,
        create: async ({ data }: any) => {
          template = { id: `template-${++sequence}`, version: 1, ...data };
          return template;
        },
        update: async ({ data }: any) => apply(template, data),
      },
    };
    const db = {
      user: { findFirst: async () => ({ id: 'user-1' }) },
      $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx),
    };
    const input = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
    };

    await seedServiceAgreementBundle(input, db as never);
    families.forEach((family) => { family.isActive = true; });
    partials.values().next().value.content = 'outdated wording';
    variants.values().next().value.name = 'outdated variant';
    variants.values().next().value.isActive = true;
    template.content = 'outdated template';
    template.isActive = true;

    await seedServiceAgreementBundle(input, db as never);
    const changedPartial = partials.values().next().value;
    const changedVariant = variants.values().next().value;
    expect(changedPartial.version).toBe(2);
    expect(changedVariant.version).toBe(2);
    expect(template.version).toBe(2);
    expect([...families.values()].every((family) => family.isActive)).toBe(true);
    expect(changedVariant.isActive).toBe(true);
    expect(template.isActive).toBe(true);

    const feeTemplateIds = [...fees.values()].flat().map((fee) => fee.id);
    await seedServiceAgreementBundle(input, db as never);
    expect(changedPartial.version).toBe(2);
    expect(changedVariant.version).toBe(2);
    expect(template.version).toBe(2);
    expect([...fees.values()].flat().map((fee) => fee.id)).toEqual(feeTemplateIds);

    // A service already switched to its Word scope stays on it.
    const wordPartial = { id: 'word-partial', name: 'service-agreement-corporate-secretarial-oakdoc-v1', version: 1 };
    partials.set(wordPartial.name, wordPartial);
    const secretarial = [...variants.values()].find(
      (variant) => variant.sowPartialId === partials.get('service-agreement-corporate-secretarial-v1').id,
    );
    secretarial.sowPartialId = wordPartial.id;
    const versionBefore = secretarial.version;
    await seedServiceAgreementBundle(input, db as never);
    expect(secretarial.sowPartialId).toBe(wordPartial.id);
    expect(secretarial.version).toBe(versionBefore);
  });
});
