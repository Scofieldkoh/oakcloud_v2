import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  profile: vi.fn(),
  resolve: vi.fn(),
  strong: vi.fn(),
}));

vi.mock('@/services/company/assistant-profile-read', () => ({
  readAuthorizedCompanyAssistantIdentity: mocks.identity,
  readAuthorizedCompanyAssistantProfile: mocks.profile,
  resolveAuthorizedCompanyFromAssistantMessage: mocks.resolve,
  messageStronglyIdentifiesCompany: mocks.strong,
}));

import {
  assistantCapabilities,
  companyProfileReadOutputSchema,
} from '@/services/company/assistant-capabilities';
import type { CapabilityContext, PreparedCapabilityArtifact, ResourceRef } from '@/services/business-assistant/contracts';

const capability = assistantCapabilities[0];
const identity = { id: 'company-1', name: 'Acme Pte. Ltd.', uen: '202612345A', displayAlias: 'Acme' };
const profile = {
  ...identity,
  entityType: 'PRIVATE_LIMITED',
  status: 'LIVE',
  statusDate: '2026-01-02',
  incorporationDate: '2020-03-04',
  financialYearEndDay: 31,
  financialYearEndMonth: 12,
  registeredAddress: { fullAddress: '1 Raffles Place Singapore 048616', effectiveFrom: '2024-01-01' },
  officers: [
    { name: 'Alice Tan', role: 'DIRECTOR', appointmentDate: '2020-03-04', cessationDate: null, isCurrent: true },
    { name: 'Bob Lim', role: 'SECRETARY', appointmentDate: '2021-01-01', cessationDate: null, isCurrent: true },
  ],
  shareholders: [
    { name: 'Carol Goh', shareholderType: 'INDIVIDUAL', shareClass: 'ORDINARY', numberOfShares: 100, percentageHeld: '100', currency: 'SGD', allotmentDate: '2020-03-04', isCurrent: true },
  ],
  auditor: { name: 'Audit LLP', appointmentDate: '2025-02-01' },
  activeCharges: [
    { chargeNumber: 'C1', chargeType: 'FIXED', chargeHolderName: 'Bank A', registrationDate: '2025-01-01', isFullyDischarged: false },
  ],
  gst: { registered: true, registrationNumber: 'M91234567A', registrationDate: '2022-05-06' },
};

function context(resources: readonly ResourceRef[] = []): CapabilityContext {
  return {
    actor: { tenantId: 'workspace-1', userId: 'user-1', requestId: 'request-1', source: 'test' },
    resources,
  };
}

async function prepare(message: string, resources: readonly ResourceRef[] = []): Promise<PreparedCapabilityArtifact> {
  const result = await capability.prepare({ message }, context(resources));
  if ('reason' in result) throw new Error(`Unexpected blocked preparation: ${result.reason}`);
  return result;
}

async function run(message: string, resources: readonly ResourceRef[] = []) {
  const prepared = await prepare(message, resources);
  const result = await capability.execute(prepared, context(resources));
  return { prepared, result, output: companyProfileReadOutputSchema.parse(result.output) };
}

const companyResource: ResourceRef = { resourceType: 'company', resourceId: 'company-1', role: 'context' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockImplementation(async (_actor, companyId: string) => companyId === 'company-1'
    ? { kind: 'FOUND', company: identity }
    : { kind: 'UNAVAILABLE' });
  mocks.profile.mockResolvedValue({ kind: 'FOUND', company: profile });
  mocks.resolve.mockResolvedValue({ kind: 'FOUND', company: identity });
  mocks.strong.mockImplementation((_message: string, company: { id: string }) => company.id === 'company-1');
});

describe('company.profile_read capability', () => {
  it('registers as a production READ_ONLY contract without confirmation or review', () => {
    expect(capability).toMatchObject({
      id: 'company.profile_read',
      version: '1.0',
      executionKind: 'READ_ONLY',
      riskLevel: 'READ_ONLY',
      confirmationPolicy: 'NONE',
      reviewPolicy: 'NONE',
      requiredPermissions: ['company:read'],
    });
    expect('revisionSchema' in capability).toBe(false);
    expect('reconcile' in capability).toBe(false);
    expect('review' in capability).toBe(false);
  });

  it('answers a director question from one authorized company resource', async () => {
    const { output } = await run('Who is the director?', [companyResource]);
    expect(output.kind).toBe('ANSWER');
    expect(output.sections?.directors).toEqual([
      { name: 'Alice Tan', role: 'DIRECTOR', appointmentDate: '2020-03-04', status: 'CURRENT' },
    ]);
    expect(output.content).toContain('Alice Tan');
    expect(output.content).not.toContain('Bob Lim');
  });

  it('answers current shareholders', async () => {
    const { output } = await run('Who are the shareholders?', [companyResource]);
    expect(output.sections?.shareholders?.[0]).toMatchObject({ name: 'Carol Goh', numberOfShares: 100, percentageHeld: '100' });
  });

  it('answers FYE', async () => {
    const { output } = await run('What is the FYE?', [companyResource]);
    expect(output.sections?.financialYearEnd).toEqual({ day: 31, month: 12, display: '31 December' });
  });

  it('answers the registered address', async () => {
    const { output } = await run('What is the registered address?', [companyResource]);
    expect(output.sections?.registeredAddress?.fullAddress).toBe('1 Raffles Place Singapore 048616');
  });

  it('answers status and incorporation date together', async () => {
    const { output } = await run('What is the company status and incorporation date?', [companyResource]);
    expect(output.sections?.status).toEqual({ value: 'LIVE', asOf: '2026-01-02' });
    expect(output.sections?.incorporation).toEqual({ date: '2020-03-04' });
  });

  it('answers auditor', async () => {
    const { output } = await run('Who is the auditor?', [companyResource]);
    expect(output.sections?.auditor).toEqual({ name: 'Audit LLP', appointmentDate: '2025-02-01' });
  });

  it('answers active charges', async () => {
    const { output } = await run('Are there active charges?', [companyResource]);
    expect(output.sections?.charges).toMatchObject({ active: true, count: 1 });
    expect(output.sections?.charges?.items[0]).toMatchObject({ chargeNumber: 'C1', chargeHolderName: 'Bank A' });
  });

  it('answers GST status', async () => {
    const { output } = await run('Is the company GST registered?', [companyResource]);
    expect(output.sections?.gst).toEqual({ registered: true, registrationNumber: 'M91234567A', registrationDate: '2022-05-06' });
  });

  it('returns a bounded general company summary', async () => {
    const { output } = await run('Tell me about this company', [companyResource]);
    expect(output.kind).toBe('ANSWER');
    expect(output.sections).toMatchObject({
      status: { value: 'LIVE' },
      incorporation: { date: '2020-03-04' },
      financialYearEnd: { display: '31 December' },
      registeredAddress: { fullAddress: '1 Raffles Place Singapore 048616' },
      gst: { registered: true },
    });
    expect(output.sections?.officers).toHaveLength(2);
    expect(output.sections?.shareholders).toHaveLength(1);
  });

  it('resolves zero company context through an exact UEN', async () => {
    const { prepared, output } = await run('What is the FYE for 202612345A?');
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'workspace-1', userId: 'user-1' }), 'What is the FYE for 202612345A?');
    expect(prepared.items[0].resources).toEqual([companyResource]);
    expect(output.kind).toBe('ANSWER');
  });

  it('returns CLARIFICATION for an ambiguous zero-context name', async () => {
    mocks.resolve.mockResolvedValue({ kind: 'AMBIGUOUS' });
    const { output } = await run('Who are the directors of Acme?');
    expect(output.kind).toBe('CLARIFICATION');
    expect(output.content).toContain('More than one accessible company');
    expect(mocks.profile).not.toHaveBeenCalled();
  });

  it('returns CLARIFICATION for multiple company resources when intent does not disambiguate', async () => {
    const other: ResourceRef = { resourceType: 'Company', resourceId: 'company-2', role: 'context' };
    mocks.strong.mockReturnValue(false);
    const { output } = await run('Who is the director?', [companyResource, other]);
    expect(output.kind).toBe('CLARIFICATION');
    expect(output.content).toContain('More than one company is attached');
  });

  it('rechecks authorization at execution and fails safely after access is revoked', async () => {
    const prepared = await prepare('Who is the director?', [companyResource]);
    mocks.profile.mockResolvedValue({ kind: 'UNAVAILABLE' });
    const result = await capability.execute(prepared, context([companyResource]));
    const output = companyProfileReadOutputSchema.parse(result.output);
    expect(output.kind).toBe('CLARIFICATION');
    expect(output.company).toBeUndefined();
    expect(output.sections).toBeUndefined();
    expect(result.resources).toEqual([]);
  });

  it('fails safely when the selected resource is cross-workspace or otherwise inaccessible', async () => {
    mocks.identity.mockResolvedValue({ kind: 'UNAVAILABLE' });
    const { output } = await run('What is the FYE?', [companyResource]);
    expect(output.kind).toBe('CLARIFICATION');
    expect(output.content).not.toContain('Acme');
  });

  it('handles a deleted company without leaking its prior details', async () => {
    mocks.identity.mockResolvedValue({ kind: 'UNAVAILABLE' });
    const { output } = await run('Tell me about this company', [companyResource]);
    expect(output.kind).toBe('CLARIFICATION');
    expect(JSON.stringify(output)).not.toContain('202612345A');
  });

  it('enforces the strict output schema and data minimisation boundary', async () => {
    const { result, output } = await run('Who are the current officers?', [companyResource]);
    expect(() => companyProfileReadOutputSchema.parse({ ...output, identificationNumber: 'S1234567A' })).toThrow();
    expect(JSON.stringify(result.output)).not.toContain('identificationNumber');
    expect(JSON.stringify(result.output)).not.toContain('personalAddress');
  });

  it('returns the resolved company as an output resource ref', async () => {
    const { result } = await run('What is the status?', [companyResource]);
    expect(result.resources).toEqual([companyResource]);
  });

  it('does not require a proposal or confirmation for a read', async () => {
    const { prepared, result } = await run('What is the status?', [companyResource]);
    expect(prepared.status).toBe('PREPARED');
    expect(result.output).toBeTruthy();
    expect(capability.confirmationPolicy).toBe('NONE');
    expect(capability.reviewPolicy).toBe('NONE');
  });

  it('asks a bounded clarification when the requested fact is unsupported', async () => {
    const { output } = await run('What should I do next?', [companyResource]);
    expect(output.kind).toBe('CLARIFICATION');
    expect(output.content).toContain('current directors');
  });
});
