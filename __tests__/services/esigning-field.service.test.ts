import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveRecipientFieldValues } from '@/services/esigning-field.service';

const prismaMocks = vi.hoisted(() => ({
  fieldDefinitionFindMany: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  upload: vi.fn(),
  esigningSignatureAsset: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    esigningDocumentFieldDefinition: {
      findMany: prismaMocks.fieldDefinitionFindMany,
    },
  },
}));

vi.mock('@/lib/storage', () => ({
  storage: storageMocks,
  StorageKeys: {
    esigningSignatureAsset: storageMocks.esigningSignatureAsset,
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn() }),
}));

describe('saveRecipientFieldValues signature clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.fieldDefinitionFindMany.mockResolvedValue([
      { id: 'field-1', type: 'SIGNATURE', required: true },
    ]);
    storageMocks.esigningSignatureAsset.mockReturnValue('esigning/signature.png');
    storageMocks.upload.mockResolvedValue(undefined);
  });

  it('clears an existing signature when the payload explicitly sends nulls', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const tx = {
      esigningDocumentFieldValue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'value-1',
            fieldDefinitionId: 'field-1',
            value: 'signed',
            revision: 2,
            finalizedAt: null,
            signatureStoragePath: 'esigning/signature.png',
          },
        ]),
        update,
        create: vi.fn(),
      },
    };

    await saveRecipientFieldValues(
      {
        tenantId: 'tenant-1',
        envelopeId: 'envelope-1',
        recipientId: 'recipient-1',
        values: [{ fieldDefinitionId: 'field-1', value: null, signatureDataUrl: null }],
      },
      tx as never
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'value-1' },
      data: expect.objectContaining({
        value: null,
        signatureStoragePath: null,
        filledAt: null,
        revision: 3,
      }),
    });
    expect(storageMocks.upload).not.toHaveBeenCalled();
  });

  it('preserves an existing signature when the signature payload is omitted', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const tx = {
      esigningDocumentFieldValue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'value-1',
            fieldDefinitionId: 'field-1',
            value: 'signed',
            revision: 2,
            finalizedAt: null,
            signatureStoragePath: 'esigning/signature.png',
          },
        ]),
        update,
        create: vi.fn(),
      },
    };

    await saveRecipientFieldValues(
      {
        tenantId: 'tenant-1',
        envelopeId: 'envelope-1',
        recipientId: 'recipient-1',
        values: [{ fieldDefinitionId: 'field-1', value: 'signed' }],
      },
      tx as never
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'value-1' },
      data: expect.objectContaining({
        value: 'signed',
        signatureStoragePath: 'esigning/signature.png',
      }),
    });
    expect(storageMocks.upload).not.toHaveBeenCalled();
  });
});

describe('saveRecipientFieldValues text values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.fieldDefinitionFindMany.mockResolvedValue([{ id: 'field-1', type: 'TEXT', required: true }]);
  });

  function transaction() {
    return {
      esigningDocumentFieldValue: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
  }

  const baseInput = { tenantId: 'tenant-1', envelopeId: 'envelope-1', recipientId: 'recipient-1' };

  it.each(['John Tan', 'Tan Wei Ming 陈伟明', 'Nguyễn Văn A', '₹ 2,500'])('stores %s', async (value) => {
    const tx = transaction();
    await saveRecipientFieldValues(
      { ...baseInput, values: [{ fieldDefinitionId: 'field-1', value: `  ${value}  ` }] },
      tx as never
    );
    expect(tx.esigningDocumentFieldValue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ value }),
    });
  });

  it('stores decomposed Vietnamese in its composed form', async () => {
    const tx = transaction();
    await saveRecipientFieldValues(
      { ...baseInput, values: [{ fieldDefinitionId: 'field-1', value: 'Nguye\u0302\u0303n' }] },
      tx as never
    );
    expect(tx.esigningDocumentFieldValue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ value: 'Nguyễn' }),
    });
  });

  it('refuses text the signed PDF cannot print, even when a caller skips the route schema', async () => {
    const tx = transaction();
    await expect(
      saveRecipientFieldValues(
        { ...baseInput, values: [{ fieldDefinitionId: 'field-1', value: 'Happy 😀' }] },
        tx as never
      )
    ).rejects.toThrow(/This field contains a character that cannot be printed on the signed document: "😀"/);
    expect(tx.esigningDocumentFieldValue.create).not.toHaveBeenCalled();
  });
});
