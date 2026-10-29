import { createHash } from 'node:crypto';

import type { CompanyProfileSectionId } from '@/lib/company-profile-sections';
import type { ContactResolutionDecision } from '@/types/contact-identity';

import { normalizeExtractedData } from './normalizer';
import type {
  ExtractedBizFileData,
  OfficerAction,
} from './types';

/**
 * The operation vocabulary used by a reviewed BizFile plan.
 *
 * `KEEP` is intentionally not emitted in a prepared plan. It is useful to
 * describe a caller supplied plan and makes validation of a plan easier to
 * reason about. Missing fields and rows mean KEEP as well; they never mean
 * REMOVE.
 */
export type BizFileChangeOperation =
  | 'KEEP'
  | 'SET'
  | 'CLEAR'
  | 'ADD'
  | 'UPDATE'
  | 'CEASE'
  | 'REMOVE';

export type BizFileCommandMode = 'CREATE' | 'UPDATE';

export interface BizFileContactDecisionBinding {
  sourceRecordId: string;
  decision: Exclude<ContactResolutionDecision, { action: 'AUTO' }>;
  /** Version of the selected contact observed while preparing the plan. */
  expectedContactUpdatedAt?: string;
}

export interface BizFileChange {
  /** Stable across retries of the same source and target record. */
  id: string;
  path: string;
  section: CompanyProfileSectionId;
  operation: Exclude<BizFileChangeOperation, 'KEEP'>;
  before: unknown;
  after: unknown;
  /** Existing canonical row when this is UPDATE/CEASE/REMOVE. */
  targetId?: string;
  /** Stable source row identity, e.g. officers.0 or shareholders.1. */
  sourceRecordId?: string;
  /** Related changes that must be approved together. */
  dependencyIds?: string[];
}

export interface BizFileBaselineSnapshot {
  company: Record<string, unknown>;
  addresses?: Array<Record<string, unknown>>;
  formerNames?: Array<Record<string, unknown>>;
  shareCapital?: Array<Record<string, unknown>>;
  officers?: Array<Record<string, unknown>>;
  shareholders?: Array<Record<string, unknown>>;
  auditor?: Record<string, unknown> | null;
  charges?: Array<Record<string, unknown>>;
  /** Computed from the complete writer-covered aggregate at preparation time. */
  aggregateRevision?: string;
  /** Persisted optimistic-lock token from Company.aggregateRevision. */
  expectedAggregateRevision?: number;
  /** The optimistic token used by older callers during the transition. */
  updatedAt?: string;
}

export interface BizFileChangePlan {
  schemaVersion: 1;
  mode: BizFileCommandMode;
  tenantId: string;
  documentId: string;
  targetCompanyId?: string;
  sourceVersion?: number;
  sourceHash?: string;
  expectedUpdatedAt?: string;
  aggregateRevision: string;
  expectedAggregateRevision: number;
  baseline: BizFileBaselineSnapshot;
  reviewedData: ExtractedBizFileData;
  changes: BizFileChange[];
  selectedChangeIds: string[];
  contactDecisions: Record<string, BizFileContactDecisionBinding>;
  officerActions?: OfficerAction[];
  /** Hash of the exact canonical plan, including selected IDs. */
  canonicalHash: string;
}

export interface BuildBizFileChangePlanInput {
  mode: BizFileCommandMode;
  tenantId: string;
  documentId: string;
  reviewedData: ExtractedBizFileData;
  baseline?: BizFileBaselineSnapshot;
  targetCompanyId?: string;
  sourceVersion?: number;
  sourceHash?: string;
  aggregateRevision?: string;
  expectedAggregateRevision?: number;
  expectedUpdatedAt?: string;
  contactDecisions?: Record<string, BizFileContactDecisionBinding>;
  /** Defaults to every proposed change. The UI may submit a strict subset. */
  selectedChangeIds?: string[];
  officerActions?: OfficerAction[];
}

export class BizFileChangePlanError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BizFileChangePlanError';
    this.code = code;
  }
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return canonicalize((value as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashBizFileValue(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/**
 * Produce a deterministic identifier for a change. Do not use an array index
 * by itself: a newly inserted source row must not make all later IDs change.
 */
export function stableBizFileChangeId(path: string, identity: unknown): string {
  const digest = hashBizFileValue({ path, identity }).slice(0, 24);
  return `bizfile.${path}.${digest}`;
}

export function computeBizFileAggregateRevision(snapshot: BizFileBaselineSnapshot): string {
  return hashBizFileValue({
    company: snapshot.company,
    addresses: snapshot.addresses ?? [],
    formerNames: snapshot.formerNames ?? [],
    shareCapital: snapshot.shareCapital ?? [],
    officers: snapshot.officers ?? [],
    shareholders: snapshot.shareholders ?? [],
    auditor: snapshot.auditor ?? null,
    charges: snapshot.charges ?? [],
  });
}

function hasOwn(value: object | null | undefined, key: string): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function dateValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return dateValue(value);
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, comparable(child)]),
    );
  }
  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(comparable(left)) === canonicalJson(comparable(right));
}

function scalarChange(
  changes: BizFileChange[],
  path: string,
  section: CompanyProfileSectionId,
  before: unknown,
  after: unknown,
  present: boolean,
  identity = path,
): void {
  if (!present || valuesEqual(before, after)) return;
  const operation = after === null || after === undefined || after === '' ? 'CLEAR' : 'SET';
  changes.push({
    id: stableBizFileChangeId(path, identity),
    path,
    section,
    operation,
    before: before ?? null,
    after: operation === 'CLEAR' ? null : after,
  });
}

function recordIdentity(record: Record<string, unknown>, index: number, kind: string): string {
  const identifierType = typeof record.identificationType === 'string'
    ? record.identificationType.toUpperCase()
    : '';
  const identifier = typeof record.identificationNumber === 'string'
    ? record.identificationNumber.trim().toUpperCase()
    : '';
  const role = typeof record.role === 'string' ? record.role.toUpperCase() : '';
  const shareClass = typeof record.shareClass === 'string' ? record.shareClass.toUpperCase() : '';
  const name = typeof record.name === 'string' ? record.name.trim().toUpperCase() : '';
  // IDs are preferred. The source index is only a final tie breaker for two
  // genuinely identical rows in one source document.
  return String(record.id || [kind, identifierType, identifier, role, shareClass, name, index].join(':'));
}

function identityMatches(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
): boolean {
  if (incoming.id && existing.id) return incoming.id === existing.id;
  const incomingId = typeof incoming.identificationNumber === 'string'
    ? incoming.identificationNumber.trim().toUpperCase()
    : '';
  const existingId = typeof existing.identificationNumber === 'string'
    ? existing.identificationNumber.trim().toUpperCase()
    : '';
  if (incomingId && existingId && incomingId === existingId) {
    if (incoming.role && existing.role && incoming.role !== existing.role) return false;
    return true;
  }
  const incomingName = typeof incoming.name === 'string' ? incoming.name.trim().toUpperCase() : '';
  const existingName = typeof existing.name === 'string' ? existing.name.trim().toUpperCase() : '';
  if (!incomingName || incomingName !== existingName) return false;
  if (incoming.role && existing.role && incoming.role !== existing.role) return false;
  if (incoming.shareClass && existing.shareClass && incoming.shareClass !== existing.shareClass) return false;
  return true;
}

function stripIdentity(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  delete result.id;
  delete result.createdAt;
  delete result.updatedAt;
  delete result.sourceDocumentId;
  delete result.contactResolution;
  return result;
}

function collectionChanges<T extends Record<string, unknown>>(
  changes: BizFileChange[],
  path: string,
  section: CompanyProfileSectionId,
  incoming: T[] | undefined,
  existing: T[] | undefined,
  kind: string,
): void {
  if (!incoming) return;
  const rows = existing ?? [];
  const matched = new Set<string>();

  incoming.forEach((row, index) => {
    const match = rows.find((candidate) => !matched.has(String(candidate.id)) && identityMatches(row, candidate));
    const sourceRecordId = `${path}.${index}`;
    const identity = recordIdentity(row, index, kind);
    if (!match) {
      changes.push({
        id: stableBizFileChangeId(path, identity),
        path,
        section,
        operation: 'ADD',
        before: null,
        after: row,
        sourceRecordId,
      });
      return;
    }
    matched.add(String(match.id));
    const before = stripIdentity(match);
    const after = stripIdentity(row);
    if (valuesEqual(before, after)) return;
    changes.push({
      id: stableBizFileChangeId(path, String(match.id || identity)),
      path,
      section,
      operation: 'UPDATE',
      before: match,
      after: row,
      targetId: typeof match.id === 'string' ? match.id : undefined,
      sourceRecordId,
    });
  });
}

function oneToOneChange(
  changes: BizFileChange[],
  path: string,
  section: CompanyProfileSectionId,
  incoming: Record<string, unknown> | null | undefined,
  existing: Record<string, unknown> | null | undefined,
): void {
  if (incoming === undefined) return;
  if (incoming === null) {
    if (existing) {
      changes.push({ id: stableBizFileChangeId(path, existing.id ?? path), path, section, operation: 'REMOVE', before: existing, after: null, targetId: typeof existing.id === 'string' ? existing.id : undefined });
    }
    return;
  }
  if (!existing || !valuesEqual(stripIdentity(existing), stripIdentity(incoming))) {
    changes.push({
      id: stableBizFileChangeId(path, existing?.id ?? path),
      path,
      section,
      operation: existing ? 'UPDATE' : 'ADD',
      before: existing ?? null,
      after: incoming,
      targetId: typeof existing?.id === 'string' ? existing.id : undefined,
    });
  }
}

function buildCreateChanges(data: ExtractedBizFileData): BizFileChange[] {
  const changes: BizFileChange[] = [];
  const entity = data.entityDetails as Record<string, unknown>;
  const companyScalars: Array<[string, CompanyProfileSectionId, unknown, boolean]> = [
    ['entityDetails.uen', 'identity', entity.uen, true],
    ['entityDetails.name', 'identity', entity.name, true],
    ['entityDetails.displayAlias', 'identity', entity.displayAlias, hasOwn(entity, 'displayAlias')],
    ['entityDetails.formerName', 'identity', entity.formerName, hasOwn(entity, 'formerName')],
    ['entityDetails.dateOfNameChange', 'identity', entity.dateOfNameChange, hasOwn(entity, 'dateOfNameChange')],
    ['entityDetails.entityType', 'identity', entity.entityType, true],
    ['entityDetails.status', 'identity', entity.status, true],
    ['entityDetails.statusDate', 'identity', entity.statusDate, hasOwn(entity, 'statusDate')],
    ['entityDetails.incorporationDate', 'identity', entity.incorporationDate, hasOwn(entity, 'incorporationDate')],
    ['entityDetails.registrationDate', 'identity', entity.registrationDate, hasOwn(entity, 'registrationDate')],
    ['ssicActivities.primary.code', 'activities', data.ssicActivities?.primary?.code, Boolean(data.ssicActivities?.primary)],
    ['ssicActivities.primary.description', 'activities', data.ssicActivities?.primary?.description, Boolean(data.ssicActivities?.primary)],
    ['ssicActivities.secondary.code', 'activities', data.ssicActivities?.secondary?.code, Boolean(data.ssicActivities?.secondary)],
    ['ssicActivities.secondary.description', 'activities', data.ssicActivities?.secondary?.description, Boolean(data.ssicActivities?.secondary)],
    ['financialYear.endDay', 'compliance', data.financialYear?.endDay, Boolean(data.financialYear)],
    ['financialYear.endMonth', 'compliance', data.financialYear?.endMonth, Boolean(data.financialYear)],
    ['compliance.lastAgmDate', 'compliance', data.compliance?.lastAgmDate, Boolean(data.compliance && hasOwn(data.compliance, 'lastAgmDate'))],
    ['compliance.lastArFiledDate', 'compliance', data.compliance?.lastArFiledDate, Boolean(data.compliance && hasOwn(data.compliance, 'lastArFiledDate'))],
    ['compliance.accountsDueDate', 'compliance', data.compliance?.accountsDueDate, Boolean(data.compliance && hasOwn(data.compliance, 'accountsDueDate'))],
    ['compliance.fyeAsAtLastAr', 'compliance', data.compliance?.fyeAsAtLastAr, Boolean(data.compliance && hasOwn(data.compliance, 'fyeAsAtLastAr'))],
    ['homeCurrency', 'capital', data.homeCurrency, hasOwn(data, 'homeCurrency')],
    ['paidUpCapital', 'capital', data.paidUpCapital, hasOwn(data, 'paidUpCapital')],
    ['issuedCapital', 'capital', data.issuedCapital, hasOwn(data, 'issuedCapital')],
  ];
  for (const [path, section, value, present] of companyScalars) {
    if (!present) continue;
    changes.push({ id: stableBizFileChangeId(path, path), path, section, operation: 'SET', before: null, after: value });
  }
  oneToOneChange(changes, 'addresses.registered', 'addresses', data.registeredAddress as Record<string, unknown> | undefined, undefined);
  oneToOneChange(changes, 'addresses.mailing', 'addresses', data.mailingAddress as Record<string, unknown> | undefined, undefined);
  oneToOneChange(changes, 'auditor', 'additional', data.auditor as Record<string, unknown> | undefined, undefined);
  collectionChanges(changes, 'formerNames', 'additional', data.entityDetails.formerNames as unknown as Record<string, unknown>[] | undefined, [], 'formerName');
  collectionChanges(changes, 'shareCapital', 'capital', data.shareCapital as unknown as Record<string, unknown>[] | undefined, [], 'shareCapital');
  if (data.treasuryShares) {
    oneToOneChange(changes, 'treasuryShares', 'capital', data.treasuryShares as unknown as Record<string, unknown>, undefined);
  }
  collectionChanges(changes, 'officers', 'officers', data.officers as unknown as Record<string, unknown>[] | undefined, [], 'officer');
  collectionChanges(changes, 'shareholders', 'shareholders', data.shareholders as unknown as Record<string, unknown>[] | undefined, [], 'shareholder');
  collectionChanges(changes, 'charges', 'charges', data.charges as unknown as Record<string, unknown>[] | undefined, [], 'charge');
  return changes;
}

function buildUpdateChanges(data: ExtractedBizFileData, baseline: BizFileBaselineSnapshot): BizFileChange[] {
  const changes: BizFileChange[] = [];
  const entity = data.entityDetails as Record<string, unknown>;
  const company = baseline.company;
  const scalarMappings: Array<[string, CompanyProfileSectionId, unknown, unknown, boolean]> = [
    ['entityDetails.name', 'identity', company.name, entity.name, true],
    ['entityDetails.displayAlias', 'identity', company.displayAlias, entity.displayAlias, hasOwn(entity, 'displayAlias')],
    ['entityDetails.formerName', 'identity', company.formerName, entity.formerName, hasOwn(entity, 'formerName')],
    ['entityDetails.dateOfNameChange', 'identity', company.dateOfNameChange, entity.dateOfNameChange, hasOwn(entity, 'dateOfNameChange')],
    ['entityDetails.entityType', 'identity', company.entityType, entity.entityType, true],
    ['entityDetails.status', 'identity', company.status, entity.status, true],
    ['entityDetails.statusDate', 'identity', company.statusDate, entity.statusDate, hasOwn(entity, 'statusDate')],
    ['entityDetails.incorporationDate', 'identity', company.incorporationDate, entity.incorporationDate, hasOwn(entity, 'incorporationDate')],
    ['entityDetails.registrationDate', 'identity', company.registrationDate, entity.registrationDate, hasOwn(entity, 'registrationDate')],
    ['ssicActivities.primary.code', 'activities', company.primarySsicCode, data.ssicActivities?.primary?.code, Boolean(data.ssicActivities?.primary)],
    ['ssicActivities.primary.description', 'activities', company.primarySsicDescription, data.ssicActivities?.primary?.description, Boolean(data.ssicActivities?.primary)],
    ['ssicActivities.secondary.code', 'activities', company.secondarySsicCode, data.ssicActivities?.secondary?.code, Boolean(data.ssicActivities?.secondary)],
    ['ssicActivities.secondary.description', 'activities', company.secondarySsicDescription, data.ssicActivities?.secondary?.description, Boolean(data.ssicActivities?.secondary)],
    ['financialYear.endDay', 'compliance', company.financialYearEndDay, data.financialYear?.endDay, Boolean(data.financialYear)],
    ['financialYear.endMonth', 'compliance', company.financialYearEndMonth, data.financialYear?.endMonth, Boolean(data.financialYear)],
    ['compliance.lastAgmDate', 'compliance', company.lastAgmDate, data.compliance?.lastAgmDate, Boolean(data.compliance && hasOwn(data.compliance, 'lastAgmDate'))],
    ['compliance.lastArFiledDate', 'compliance', company.lastArFiledDate, data.compliance?.lastArFiledDate, Boolean(data.compliance && hasOwn(data.compliance, 'lastArFiledDate'))],
    ['compliance.accountsDueDate', 'compliance', company.accountsDueDate, data.compliance?.accountsDueDate, Boolean(data.compliance && hasOwn(data.compliance, 'accountsDueDate'))],
    ['compliance.fyeAsAtLastAr', 'compliance', company.fyeAsAtLastAr, data.compliance?.fyeAsAtLastAr, Boolean(data.compliance && hasOwn(data.compliance, 'fyeAsAtLastAr'))],
    ['homeCurrency', 'capital', company.homeCurrency, data.homeCurrency, hasOwn(data, 'homeCurrency')],
    ['paidUpCapital', 'capital', { amount: company.paidUpCapitalAmount, currency: company.paidUpCapitalCurrency }, data.paidUpCapital, hasOwn(data, 'paidUpCapital')],
    ['issuedCapital', 'capital', { amount: company.issuedCapitalAmount, currency: company.issuedCapitalCurrency }, data.issuedCapital, hasOwn(data, 'issuedCapital')],
  ];
  for (const [path, section, before, after, present] of scalarMappings) scalarChange(changes, path, section, before, after, present);

  const addresses = baseline.addresses ?? [];
  const registered = addresses.find((address) => address.addressType === 'REGISTERED_OFFICE');
  const mailing = addresses.find((address) => address.addressType === 'MAILING');
  oneToOneChange(changes, 'addresses.registered', 'addresses', data.registeredAddress as Record<string, unknown> | undefined, registered);
  oneToOneChange(changes, 'addresses.mailing', 'addresses', data.mailingAddress as Record<string, unknown> | undefined, mailing);
  oneToOneChange(changes, 'auditor', 'additional', data.auditor as Record<string, unknown> | null | undefined, baseline.auditor);
  collectionChanges(changes, 'formerNames', 'additional', data.entityDetails.formerNames as unknown as Record<string, unknown>[] | undefined, baseline.formerNames, 'formerName');
  collectionChanges(changes, 'shareCapital', 'capital', data.shareCapital as unknown as Record<string, unknown>[] | undefined, baseline.shareCapital, 'shareCapital');
  if (data.treasuryShares !== undefined) {
    const treasury = (baseline.shareCapital ?? []).find((row) => row.isTreasury === true);
    oneToOneChange(changes, 'treasuryShares', 'capital', data.treasuryShares as unknown as Record<string, unknown> | null, treasury);
  }
  collectionChanges(changes, 'officers', 'officers', data.officers as unknown as Record<string, unknown>[] | undefined, baseline.officers, 'officer');
  collectionChanges(changes, 'shareholders', 'shareholders', data.shareholders as unknown as Record<string, unknown>[] | undefined, baseline.shareholders, 'shareholder');
  collectionChanges(changes, 'charges', 'charges', data.charges as unknown as Record<string, unknown>[] | undefined, baseline.charges, 'charge');
  return changes;
}

function validateSelectedIds(changes: BizFileChange[], selected: string[]): string[] {
  const valid = new Set(changes.map((change) => change.id));
  const unique = [...new Set(selected)];
  const unknown = unique.filter((id) => !valid.has(id));
  if (unknown.length > 0) throw new BizFileChangePlanError('UNKNOWN_CHANGE', `The selected BizFile change is not part of this proposal: ${unknown[0]}`);
  const byId = new Map(changes.map((change) => [change.id, change]));
  for (const id of unique) {
    const dependencies = byId.get(id)?.dependencyIds ?? [];
    if (dependencies.some((dependency) => !unique.includes(dependency))) {
      throw new BizFileChangePlanError('MISSING_DEPENDENCY', `Change ${id} requires an additional reviewed change`);
    }
  }
  return unique;
}

/** Build an immutable, reviewable proposal from a source and a complete baseline. */
export function buildBizFileChangePlan(input: BuildBizFileChangePlanInput): BizFileChangePlan {
  if (input.mode === 'CREATE' && input.targetCompanyId) {
    throw new BizFileChangePlanError('CREATE_TARGET', 'CREATE proposals cannot target an existing company');
  }
  if (input.mode === 'UPDATE' && !input.targetCompanyId) {
    throw new BizFileChangePlanError('UPDATE_TARGET', 'UPDATE proposals require a target company');
  }
  const sourceVersion = input.sourceVersion ?? 0;
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 0) {
    throw new BizFileChangePlanError('SOURCE_REVISION', 'BizFile source revision must be a non-negative safe integer');
  }
  const reviewedData = normalizeExtractedData(input.reviewedData);
  const baseline = input.baseline ?? {
    company: {},
    addresses: [],
    formerNames: [],
    shareCapital: [],
    officers: [],
    shareholders: [],
    auditor: null,
    charges: [],
  };
  const changes = input.mode === 'CREATE' ? buildCreateChanges(reviewedData) : buildUpdateChanges(reviewedData, baseline);
  const officerActions = input.officerActions ?? [];
  const officerIds = new Set<string>();
  for (const action of officerActions) {
    if (input.mode !== 'UPDATE' || action.action !== 'cease') {
      throw new BizFileChangePlanError('OFFICER_ACTION_UNAVAILABLE', 'Only an explicit officer cessation is supported in this import plan. Create follow-up work separately.');
    }
    const date = action.cessationDate;
    const parsedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new BizFileChangePlanError('OFFICER_CESSATION_DATE', 'Choose a valid explicit cessation date before preparing the plan.');
    }
    const officer = baseline.officers?.find((row) => row.id === action.officerId && row.isCurrent !== false);
    if (!officer || officerIds.has(action.officerId) || changes.some((change) => change.path === 'officers' && change.targetId === action.officerId)) {
      throw new BizFileChangePlanError('OFFICER_ACTION_CONFLICT', 'The selected officer is unavailable or already has another proposed change.');
    }
    officerIds.add(action.officerId);
    changes.push({ id: stableBizFileChangeId('officers.cease', action.officerId), path: 'officers', section: 'officers',
      operation: 'CEASE', targetId: action.officerId, before: officer, after: { cessationDate: date } });
  }
  const selectedChangeIds = validateSelectedIds(changes, input.selectedChangeIds ?? changes.map((change) => change.id));
  const aggregateRevision = input.aggregateRevision ?? baseline.aggregateRevision ?? computeBizFileAggregateRevision(baseline);
  const expectedAggregateRevision = input.expectedAggregateRevision
    ?? baseline.expectedAggregateRevision
    ?? 0;
  const planWithoutHash = {
    schemaVersion: 1 as const,
    mode: input.mode,
    tenantId: input.tenantId,
    documentId: input.documentId,
    ...(input.targetCompanyId ? { targetCompanyId: input.targetCompanyId } : {}),
    sourceVersion,
    ...(input.sourceHash ? { sourceHash: input.sourceHash } : {}),
    ...(input.expectedUpdatedAt || baseline.updatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt ?? baseline.updatedAt } : {}),
    aggregateRevision,
    expectedAggregateRevision,
    baseline,
    reviewedData,
    changes,
    selectedChangeIds,
    contactDecisions: input.contactDecisions ?? {},
    ...(officerActions.length ? { officerActions } : {}),
  };
  return { ...planWithoutHash, canonicalHash: hashBizFileValue(planWithoutHash) };
}

export function assertBizFileChangePlan(plan: BizFileChangePlan): void {
  if (plan.schemaVersion !== 1) throw new BizFileChangePlanError('SCHEMA_VERSION', 'Unsupported BizFile change plan version');
  if (!plan.tenantId || !plan.documentId || !plan.aggregateRevision || !Number.isInteger(plan.expectedAggregateRevision) || plan.expectedAggregateRevision < 0 || !plan.canonicalHash) {
    throw new BizFileChangePlanError('INVALID_PLAN', 'BizFile change plan is missing its immutable identity');
  }
  if (typeof plan.sourceVersion !== 'number' || !Number.isSafeInteger(plan.sourceVersion) || plan.sourceVersion < 0) {
    throw new BizFileChangePlanError('SOURCE_REVISION', 'BizFile change plan is missing a valid source revision');
  }
  if (plan.mode === 'CREATE' && plan.targetCompanyId) throw new BizFileChangePlanError('CREATE_TARGET', 'CREATE plans cannot contain a target company');
  if (plan.mode === 'UPDATE' && !plan.targetCompanyId) throw new BizFileChangePlanError('UPDATE_TARGET', 'UPDATE plans require a target company');
  validateSelectedIds(plan.changes, plan.selectedChangeIds);
  const { canonicalHash: _ignored, ...withoutHash } = plan;
  if (hashBizFileValue(withoutHash) !== plan.canonicalHash) throw new BizFileChangePlanError('PLAN_TAMPERED', 'BizFile change plan no longer matches its approval hash');
}

export function selectedBizFileChanges(plan: BizFileChangePlan): BizFileChange[] {
  assertBizFileChangePlan(plan);
  const selected = new Set(plan.selectedChangeIds);
  return plan.changes.filter((change) => selected.has(change.id));
}

/** A strict numeric boundary for values persisted in Decimal/Int columns. */
export function assertSafeBizFileNumbers(value: unknown, path = 'value'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new BizFileChangePlanError('UNSAFE_NUMBER', `${path} cannot be represented safely; review it as an exact decimal`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSafeBizFileNumbers(child, `${path}.${index}`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => assertSafeBizFileNumbers(child, `${path}.${key}`));
  }
}
