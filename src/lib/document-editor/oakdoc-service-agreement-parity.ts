import {
  semanticRequirement,
  type SemanticRequirement,
} from '@/lib/document-editor/oakdoc-semantic-compare';

export interface ServiceAgreementParityEntity {
  name: string;
  uen?: string | null;
}

export interface ServiceAgreementParityService {
  name: string;
  entityNames?: readonly string[];
}

export interface ServiceAgreementParityFeeLine {
  description: string;
  semanticAmount: string;
  entityName?: string | null;
}

export interface ServiceAgreementParityRepresentative {
  name: string;
  role?: string | null;
  email?: string | null;
}

export interface ServiceAgreementParityContext {
  agreementDate?: string | null;
  effectiveDate?: string | null;
  entities: readonly ServiceAgreementParityEntity[];
  services: readonly ServiceAgreementParityService[];
  feeLines: readonly ServiceAgreementParityFeeLine[];
  authorizedRepresentatives: readonly ServiceAgreementParityRepresentative[];
  signers: readonly string[];
  criticalHeadings?: readonly string[];
  criticalClauses?: readonly string[];
}

/**
 * Business-semantic contract for Service Agreement migration parity. Formatting,
 * HTML structure, Word runs and page layout are deliberately excluded.
 */
export function buildServiceAgreementSemanticRequirements(
  context: ServiceAgreementParityContext,
): SemanticRequirement[] {
  const requirements: SemanticRequirement[] = [];

  if (context.agreementDate) {
    requirements.push(semanticRequirement(
      'agreement-date',
      'agreement date',
      [context.agreementDate],
    ));
  }
  if (context.effectiveDate) {
    requirements.push(semanticRequirement(
      'effective-date',
      'effective date',
      [context.effectiveDate],
    ));
  }

  requirements.push(
    semanticRequirement(
      'entities',
      'agreement entities',
      context.entities.flatMap((entity) => [entity.name, entity.uen]),
    ),
    semanticRequirement(
      'services',
      'service names and entity assignments',
      context.services.flatMap((service) => [service.name, ...(service.entityNames ?? [])]),
    ),
    semanticRequirement(
      'fee-lines',
      'fee descriptions and amounts',
      context.feeLines.flatMap((fee) => [
        fee.description,
        fee.semanticAmount,
        fee.entityName,
      ]),
    ),
    semanticRequirement(
      'authorised-representatives',
      'authorised representatives',
      context.authorizedRepresentatives.flatMap((representative) => [
        representative.name,
        representative.role,
        representative.email,
      ]),
    ),
    semanticRequirement(
      'signers',
      'signer names',
      context.signers,
    ),
    semanticRequirement(
      'critical-headings',
      'critical headings',
      context.criticalHeadings ?? [],
    ),
    semanticRequirement(
      'critical-clauses',
      'critical clauses',
      context.criticalClauses ?? [],
    ),
  );

  return requirements;
}
