import { z } from 'zod';
import {
  canonicalizeJson,
  resourceRefSchema,
  sha256,
  type BlockedPreparation,
  type BusinessAssistantCapability,
  type CapabilityContext,
  type CapabilityPresentation,
  type CapabilityPresentationSection,
  type CanonicalActorContext,
  type JsonValue,
  type PreparedCapabilityArtifact,
  type PreparedCapabilityItem,
  type ReadExecutionResult,
  type ResourceRef,
} from '@/services/business-assistant/contracts';
import {
  messageStronglyIdentifiesCompany,
  readAuthorizedCompanyAssistantIdentity,
  readAuthorizedCompanyAssistantProfile,
  resolveAuthorizedCompanyFromAssistantMessage,
  type CompanyAssistantIdentity,
  type CompanyAssistantProfileSnapshot,
} from './assistant-profile-read';

const inputSchema = z.object({
  message: z.string().trim().min(1).max(12_000),
}).strict();

const requestedFactSchema = z.enum([
  'directors',
  'officers',
  'shareholders',
  'registeredAddress',
  'financialYearEnd',
  'status',
  'incorporation',
  'auditor',
  'charges',
  'gst',
]);
type RequestedFact = z.infer<typeof requestedFactSchema>;

const preparedInputSchema = z.object({
  message: z.string().trim().min(1).max(12_000),
  requestedFacts: z.array(requestedFactSchema).max(10),
  resolution: z.enum(['FOUND', 'CLARIFICATION']),
  companyId: z.string().trim().min(1).max(200).optional(),
  clarification: z.string().trim().min(1).max(1_000).optional(),
}).strict();

const preparedItemSchema = z.object({
  itemId: z.literal('company.profile_read'),
  itemKey: z.literal('company.profile_read'),
  input: preparedInputSchema,
  resources: z.array(resourceRefSchema).max(1),
  status: z.enum(['ELIGIBLE', 'BLOCKED', 'NOT_SELECTED']),
  metadata: z.unknown().optional(),
}).strict();

const preparedSchema = z.object({
  status: z.enum(['PREPARED', 'BLOCKED']),
  items: z.array(preparedItemSchema).max(1),
  warnings: z.array(z.string().max(500)).max(20).optional(),
  blockers: z.array(z.string().max(500)).max(20).optional(),
  preparedAt: z.string().datetime(),
  preparedHash: z.string().length(64),
}).strict();

const officerSchema = z.object({
  name: z.string(),
  role: z.string(),
  appointmentDate: z.string().nullable(),
  status: z.literal('CURRENT'),
}).strict();

const shareholderSchema = z.object({
  name: z.string(),
  shareholderType: z.string().nullable(),
  shareClass: z.string().nullable(),
  numberOfShares: z.number().nonnegative(),
  percentageHeld: z.string().nullable(),
  currency: z.string().nullable(),
  allotmentDate: z.string().nullable(),
  status: z.literal('CURRENT'),
}).strict();

const sectionsSchema = z.object({
  directors: z.array(officerSchema).max(100).optional(),
  officers: z.array(officerSchema).max(100).optional(),
  shareholders: z.array(shareholderSchema).max(100).optional(),
  registeredAddress: z.object({
    fullAddress: z.string(),
    effectiveFrom: z.string().nullable(),
  }).strict().nullable().optional(),
  financialYearEnd: z.object({
    day: z.number().int().min(1).max(31).nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    display: z.string(),
  }).strict().optional(),
  status: z.object({
    value: z.string(),
    asOf: z.string().nullable(),
  }).strict().optional(),
  incorporation: z.object({ date: z.string().nullable() }).strict().optional(),
  auditor: z.object({
    name: z.string(),
    appointmentDate: z.string().nullable(),
  }).strict().nullable().optional(),
  charges: z.object({
    active: z.boolean(),
    count: z.number().int().nonnegative(),
    items: z.array(z.object({
      chargeNumber: z.string().nullable(),
      chargeType: z.string().nullable(),
      chargeHolderName: z.string(),
      registrationDate: z.string().nullable(),
    }).strict()).max(20),
  }).strict().optional(),
  gst: z.object({
    registered: z.boolean(),
    registrationNumber: z.string().nullable(),
    registrationDate: z.string().nullable(),
  }).strict().optional(),
}).strict();

export const companyProfileReadOutputSchema = z.object({
  kind: z.enum(['ANSWER', 'CLARIFICATION']),
  content: z.string().trim().min(1).max(12_000),
  company: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    uen: z.string().min(1),
  }).strict().optional(),
  sections: sectionsSchema.optional(),
  observedAt: z.string().datetime(),
}).strict();

function json(value: unknown): JsonValue {
  return canonicalizeJson(value);
}

function uniqueFacts(facts: readonly RequestedFact[]): RequestedFact[] {
  return [...new Set(facts)];
}

const GENERAL_FACTS: readonly RequestedFact[] = [
  'status',
  'incorporation',
  'financialYearEnd',
  'registeredAddress',
  'officers',
  'shareholders',
  'auditor',
  'charges',
  'gst',
];

function requestedFacts(message: string): RequestedFact[] {
  const lower = message.toLowerCase();
  if (/\b(tell me about|company profile|company details|company overview|overview|summary)\b/.test(lower)) {
    return [...GENERAL_FACTS];
  }
  const facts: RequestedFact[] = [];
  if (/\bdirectors?\b/.test(lower)) facts.push('directors');
  if (/\bofficers?\b|\bcompany secretary\b|\bsecretary\b/.test(lower)) facts.push('officers');
  if (/\bshareholders?\b|\bownership\b/.test(lower)) facts.push('shareholders');
  if (/\bregistered (?:office|address)\b|\baddress\b/.test(lower)) facts.push('registeredAddress');
  if (/\bfye\b|\bfinancial year end\b|\byear end\b/.test(lower)) facts.push('financialYearEnd');
  if (/\bstatus\b/.test(lower)) facts.push('status');
  if (/\bincorporat(?:e|ed|ion)\b|\bregistration date\b|\bformed\b/.test(lower)) facts.push('incorporation');
  if (/\bauditor\b|\baudit firm\b/.test(lower)) facts.push('auditor');
  if (/\bcharges?\b|\bsecurity interest\b/.test(lower)) facts.push('charges');
  if (/\bgst\b|\bgoods and services tax\b/.test(lower)) facts.push('gst');
  return uniqueFacts(facts);
}

function companyResourceIds(resources: readonly ResourceRef[]): string[] {
  return [...new Set(resources
    .filter((resource) => resource.resourceType.trim().toLowerCase() === 'company')
    .map((resource) => resource.resourceId))];
}

type PreparedResolution =
  | { kind: 'FOUND'; company: CompanyAssistantIdentity }
  | { kind: 'CLARIFICATION'; content: string };

async function resolveCompany(
  message: string,
  resources: readonly ResourceRef[],
  context: CapabilityContext,
): Promise<PreparedResolution> {
  const ids = companyResourceIds(resources);
  if (ids.length === 1) {
    const resolved = await readAuthorizedCompanyAssistantIdentity(context.actor, ids[0]);
    return resolved.kind === 'FOUND'
      ? { kind: 'FOUND', company: resolved.company }
      : { kind: 'CLARIFICATION', content: 'I can’t use the selected company context. Select a company you can currently access.' };
  }
  if (ids.length > 1) {
    const matches: CompanyAssistantIdentity[] = [];
    for (const id of ids) {
      const resolved = await readAuthorizedCompanyAssistantIdentity(context.actor, id);
      if (resolved.kind === 'FOUND' && messageStronglyIdentifiesCompany(message, resolved.company)) matches.push(resolved.company);
    }
    return matches.length === 1
      ? { kind: 'FOUND', company: matches[0] }
      : { kind: 'CLARIFICATION', content: 'More than one company is attached. Select one company or include its exact UEN so I don’t guess.' };
  }

  const resolved = await resolveAuthorizedCompanyFromAssistantMessage(context.actor, message);
  if (resolved.kind === 'FOUND') return { kind: 'FOUND', company: resolved.company };
  if (resolved.kind === 'AMBIGUOUS') {
    return { kind: 'CLARIFICATION', content: 'More than one accessible company matches this request. Select one company or include its exact UEN.' };
  }
  return { kind: 'CLARIFICATION', content: 'Select a company, or include its exact UEN or a sufficiently specific company name.' };
}

function buildPreparedArtifact(item: PreparedCapabilityItem): PreparedCapabilityArtifact {
  const withoutHash: Omit<PreparedCapabilityArtifact, 'preparedHash'> = {
    status: 'PREPARED',
    items: [item],
    preparedAt: new Date().toISOString(),
  };
  return { ...withoutHash, preparedHash: sha256(withoutHash) };
}

async function prepareCapability(
  input: unknown,
  context: CapabilityContext,
): Promise<PreparedCapabilityArtifact | BlockedPreparation> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'BLOCKED', code: 'VALIDATION_FAILED', reason: 'Ask a complete company profile question.' };
  }

  const facts = requestedFacts(parsed.data.message);
  if (facts.length === 0) {
    return buildPreparedArtifact({
      itemId: 'company.profile_read',
      itemKey: 'company.profile_read',
      input: json({
        message: parsed.data.message,
        requestedFacts: [],
        resolution: 'CLARIFICATION',
        clarification: 'I can read current directors, officers, shareholders, registered address, FYE, status, incorporation date, auditor, active charges, or GST status. Which fact do you need?',
      }),
      resources: [],
      status: 'ELIGIBLE',
      metadata: json({ authorization: 'fresh-company-read', result: 'clarification' }),
    });
  }

  const resolved = await resolveCompany(parsed.data.message, context.resources, context);
  if (resolved.kind === 'CLARIFICATION') {
    return buildPreparedArtifact({
      itemId: 'company.profile_read',
      itemKey: 'company.profile_read',
      input: json({
        message: parsed.data.message,
        requestedFacts: facts,
        resolution: 'CLARIFICATION',
        clarification: resolved.content,
      }),
      resources: [],
      status: 'ELIGIBLE',
      metadata: json({ authorization: 'fresh-company-read', result: 'clarification' }),
    });
  }

  const companyResource: ResourceRef = { resourceType: 'company', resourceId: resolved.company.id, role: 'context' };
  return buildPreparedArtifact({
    itemId: 'company.profile_read',
    itemKey: 'company.profile_read',
    input: json({
      message: parsed.data.message,
      requestedFacts: facts,
      resolution: 'FOUND',
      companyId: resolved.company.id,
    }),
    resources: [companyResource],
    status: 'ELIGIBLE',
    metadata: json({ authorization: 'fresh-company-read', companyUen: resolved.company.uen }),
  });
}

function dateDisplay(value: string | null): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

function fyeDisplay(day: number | null, month: number | null): string {
  if (!month) return 'Not recorded';
  if (!day) return MONTHS[month - 1] ?? `Month ${month}`;
  return `${day} ${MONTHS[month - 1] ?? `month ${month}`}`;
}

function officerOutput(officer: CompanyAssistantProfileSnapshot['officers'][number]) {
  return {
    name: officer.name,
    role: officer.role,
    appointmentDate: officer.appointmentDate,
    status: 'CURRENT' as const,
  };
}

function shareholderOutput(shareholder: CompanyAssistantProfileSnapshot['shareholders'][number]) {
  return {
    name: shareholder.name,
    shareholderType: shareholder.shareholderType,
    shareClass: shareholder.shareClass,
    numberOfShares: shareholder.numberOfShares,
    percentageHeld: shareholder.percentageHeld,
    currency: shareholder.currency,
    allotmentDate: shareholder.allotmentDate,
    status: 'CURRENT' as const,
  };
}

function buildSections(profile: CompanyAssistantProfileSnapshot, facts: readonly RequestedFact[]): z.infer<typeof sectionsSchema> {
  const wanted = new Set(facts);
  const sections: z.infer<typeof sectionsSchema> = {};
  if (wanted.has('directors')) {
    sections.directors = profile.officers.filter((officer) => /director/i.test(officer.role)).map(officerOutput);
  }
  if (wanted.has('officers')) sections.officers = profile.officers.map(officerOutput);
  if (wanted.has('shareholders')) sections.shareholders = profile.shareholders.map(shareholderOutput);
  if (wanted.has('registeredAddress')) sections.registeredAddress = profile.registeredAddress;
  if (wanted.has('financialYearEnd')) {
    sections.financialYearEnd = {
      day: profile.financialYearEndDay,
      month: profile.financialYearEndMonth,
      display: fyeDisplay(profile.financialYearEndDay, profile.financialYearEndMonth),
    };
  }
  if (wanted.has('status')) sections.status = { value: profile.status, asOf: profile.statusDate };
  if (wanted.has('incorporation')) sections.incorporation = { date: profile.incorporationDate };
  if (wanted.has('auditor')) sections.auditor = profile.auditor;
  if (wanted.has('charges')) {
    sections.charges = {
      active: profile.activeCharges.length > 0,
      count: profile.activeCharges.length,
      items: profile.activeCharges.map((charge) => ({
        chargeNumber: charge.chargeNumber,
        chargeType: charge.chargeType,
        chargeHolderName: charge.chargeHolderName,
        registrationDate: charge.registrationDate,
      })),
    };
  }
  if (wanted.has('gst')) sections.gst = profile.gst;
  return sections;
}

function boundedNames<T>(items: readonly T[], format: (item: T) => string, limit = 20): string {
  const shown = items.slice(0, limit).map(format);
  const remaining = items.length - shown.length;
  return `${shown.join('; ')}${remaining > 0 ? `; and ${remaining} more` : ''}`;
}

function sectionContent(profile: CompanyAssistantProfileSnapshot, fact: RequestedFact): string {
  switch (fact) {
    case 'directors': {
      const directors = profile.officers.filter((officer) => /director/i.test(officer.role));
      return directors.length
        ? `Current directors: ${boundedNames(directors, (officer) => `${officer.name} — ${officer.role}${officer.appointmentDate ? `, appointed ${dateDisplay(officer.appointmentDate)}` : ''}`)}.`
        : 'No current director is recorded.';
    }
    case 'officers':
      return profile.officers.length
        ? `Current officers: ${boundedNames(profile.officers, (officer) => `${officer.name} — ${officer.role}${officer.appointmentDate ? `, appointed ${dateDisplay(officer.appointmentDate)}` : ''}`)}.`
        : 'No current officers are recorded.';
    case 'shareholders':
      return profile.shareholders.length
        ? `Current shareholders: ${boundedNames(profile.shareholders, (shareholder) => {
          const holding = [
            shareholder.numberOfShares ? `${shareholder.numberOfShares} shares` : null,
            shareholder.percentageHeld ? `${shareholder.percentageHeld}%` : null,
            shareholder.shareClass,
          ].filter(Boolean).join(', ');
          return holding ? `${shareholder.name} (${holding})` : shareholder.name;
        })}.`
        : 'No current shareholders are recorded.';
    case 'registeredAddress':
      return `Registered address: ${profile.registeredAddress?.fullAddress ?? 'Not recorded'}.`;
    case 'financialYearEnd':
      return `Financial year end: ${fyeDisplay(profile.financialYearEndDay, profile.financialYearEndMonth)}.`;
    case 'status':
      return `Company status: ${profile.status}${profile.statusDate ? ` (as of ${dateDisplay(profile.statusDate)})` : ''}.`;
    case 'incorporation':
      return `Incorporation date: ${dateDisplay(profile.incorporationDate)}.`;
    case 'auditor':
      return profile.auditor
        ? `Auditor: ${profile.auditor.name}${profile.auditor.appointmentDate ? ` (appointed ${dateDisplay(profile.auditor.appointmentDate)})` : ''}.`
        : 'No auditor is recorded.';
    case 'charges':
      return profile.activeCharges.length
        ? `Active charges: ${profile.activeCharges.length}. ${boundedNames(profile.activeCharges, (charge) => [charge.chargeNumber, charge.chargeType, charge.chargeHolderName].filter(Boolean).join(' — '), 10)}.`
        : 'There are no active charges recorded.';
    case 'gst':
      return profile.gst.registered
        ? `GST status: Registered${profile.gst.registrationNumber ? ` (${profile.gst.registrationNumber})` : ''}${profile.gst.registrationDate ? ` from ${dateDisplay(profile.gst.registrationDate)}` : ''}.`
        : 'GST status: Not registered.';
  }
}

function answerContent(profile: CompanyAssistantProfileSnapshot, facts: readonly RequestedFact[]): string {
  const prefix = `${profile.name} (${profile.uen})`;
  return [prefix, ...facts.map((fact) => sectionContent(profile, fact))].join('\n');
}

async function executeCapability(prepared: unknown, context: CapabilityContext): Promise<ReadExecutionResult> {
  const artifact = preparedSchema.safeParse(prepared);
  if (!artifact.success || artifact.data.status !== 'PREPARED') throw new Error('Prepared company profile read is malformed.');
  const item = artifact.data.items.find((candidate) => candidate.status === 'ELIGIBLE');
  const input = preparedInputSchema.safeParse(item?.input);
  if (!input.success) throw new Error('Prepared company profile read input is malformed.');

  const observedAt = new Date().toISOString();
  if (input.data.resolution === 'CLARIFICATION' || !input.data.companyId) {
    const output = companyProfileReadOutputSchema.parse({
      kind: 'CLARIFICATION',
      content: input.data.clarification ?? 'Select one accessible company before I read its current profile.',
      observedAt,
    });
    return { output: json(output), observedAt, resources: [] };
  }

  const current = await readAuthorizedCompanyAssistantProfile(context.actor, input.data.companyId);
  if (current.kind !== 'FOUND') {
    const output = companyProfileReadOutputSchema.parse({
      kind: 'CLARIFICATION',
      content: 'I can’t use that company context now. Select a company you can currently access.',
      observedAt,
    });
    return { output: json(output), observedAt, resources: [] };
  }

  const sections = buildSections(current.company, input.data.requestedFacts);
  const output = companyProfileReadOutputSchema.parse({
    kind: 'ANSWER',
    content: answerContent(current.company, input.data.requestedFacts),
    company: { id: current.company.id, name: current.company.name, uen: current.company.uen },
    sections,
    observedAt,
  });
  const resource: ResourceRef = { resourceType: 'company', resourceId: current.company.id, role: 'context' };
  return { output: json(output), observedAt, resources: [resource] };
}

function splitCapability(
  input: unknown,
  _actor: CanonicalActorContext,
): readonly { itemKey: string; input: unknown; resources?: readonly ResourceRef[] }[] {
  const payload = input && typeof input === 'object' && !Array.isArray(input)
    ? { message: (input as Record<string, unknown>).message }
    : input;
  const parsed = inputSchema.safeParse(payload);
  return parsed.success ? [{ itemKey: 'company.profile_read', input: parsed.data }] : [];
}

function presentCapability(prepared: unknown): CapabilityPresentation {
  const artifact = preparedSchema.safeParse(prepared);
  const item = artifact.success ? artifact.data.items[0] : undefined;
  const sections: CapabilityPresentationSection[] = [
    {
      id: 'company-profile-read:scope',
      title: 'Current company profile',
      kind: 'TEXT',
      value: 'Read-only company facts with fresh company access checked again when the result is produced.',
    },
  ];
  if (item?.resources.length) {
    sections.push({ id: 'company-profile-read:resource', title: 'Company', kind: 'RESOURCES', value: json(item.resources) });
  }
  if (item?.input.resolution === 'CLARIFICATION' && item.input.clarification) {
    sections.push({ id: 'company-profile-read:clarification', title: 'Needs clarification', kind: 'WARNINGS', value: item.input.clarification });
  }
  return { sections };
}

export const assistantCapabilities = [
  {
    id: 'company.profile_read',
    version: '1.0',
    contractVersion: '1',
    title: 'Read company profile',
    description: 'Answer current authorized company profile questions from canonical company records without changing company data.',
    executionKind: 'READ_ONLY' as const,
    riskLevel: 'READ_ONLY' as const,
    confirmationPolicy: 'NONE' as const,
    reviewPolicy: 'NONE' as const,
    approvalPolicyVersion: '1',
    requiredPermissions: ['company:read'],
    inputSchema,
    itemInputSchema: inputSchema,
    preparedSchema,
    outputSchema: companyProfileReadOutputSchema,
    splitInput: splitCapability,
    prepare: prepareCapability,
    present: presentCapability,
    execute: executeCapability,
  },
] satisfies readonly BusinessAssistantCapability[];
