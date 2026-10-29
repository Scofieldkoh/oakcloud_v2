import { prisma } from '@/lib/prisma';
import type { FieldOwnerScope } from '@/lib/template-field-contract';
import { addSectionAnchors, extractSections } from '@/services/document-validation.service';
import {
  renderTemplateForGeneration,
  type RenderTemplateForGenerationParams,
  type RenderTemplateForGenerationResult,
} from '@/services/document-generator.service';
import { getPartialsUsedInTemplate } from '@/services/template-partial.service';
import {
  assembleServiceAgreementTemplate,
  getServiceAgreementDraftById,
} from '@/services/service-agreement';
import {
  renderScopedTemplateFields,
} from '@/services/scoped-template-field-renderer.service';

export interface WorkflowRenderTemplateParams extends RenderTemplateForGenerationParams {
  /** Unsaved/test snapshots carry their complete current field schema here. */
  templatePlaceholders?: unknown;
  /** Stable saved template id or current editor snapshot id. */
  templateScopeId?: string;
  /** Required only for an unsaved composition preview. */
  compositionType?: 'STANDARD' | 'SERVICE_AGREEMENT' | 'RESOLUTION';
}

function fieldBlockingErrors(
  rendered: ReturnType<typeof renderScopedTemplateFields>,
): string[] {
  const messages = rendered.fieldDiagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.message);
  const parserMessages = rendered.fieldParserDiagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.message);
  return [...new Set([...messages, ...parserMessages])];
}

/**
 * Canonical W3 workflow renderer.
 *
 * The legacy renderer is invoked once only to build the authoritative business
 * context and existing dependency/service diagnostics. Its HTML is discarded.
 * W3 then resolves the original template and canonical partial sources through
 * F2 scoped identities. Ordinary field output is escaped/protected from a
 * second template pass; partial markup is accepted only through the canonical
 * trusted-partial sanitizer capability.
 */
export async function renderTemplateForWorkflow(
  params: WorkflowRenderTemplateParams,
): Promise<RenderTemplateForGenerationResult> {
  const contextRender = await renderTemplateForGeneration(params);
  const storedTemplate = params.templateId
    ? await prisma.documentTemplate.findFirst({
        where: { id: params.templateId, tenantId: params.tenantId, deletedAt: null },
        select: {
          id: true,
          content: true,
          placeholders: true,
          compositionType: true,
        },
      })
    : null;

  let sourceContent = storedTemplate?.content ?? params.templateContent;
  if (!sourceContent) throw new Error('Template content is required for workflow rendering');
  const compositionType = storedTemplate?.compositionType
    ?? params.compositionType
    ?? 'STANDARD';

  if (compositionType === 'SERVICE_AGREEMENT' && params.serviceAgreementId) {
    const agreement = await getServiceAgreementDraftById(
      params.serviceAgreementId,
      params.userId ? { tenantId: params.tenantId, userId: params.userId } : params.tenantId,
    );
    if (!agreement) throw new Error('Service Agreement draft not found');
    sourceContent = assembleServiceAgreementTemplate({
      templateContent: sourceContent,
      agreement,
    }).content;
  }

  const partials = await getPartialsUsedInTemplate(sourceContent, params.tenantId);
  const templateScope: FieldOwnerScope = {
    kind: 'template',
    id: storedTemplate?.id
      ?? params.templateScopeId
      ?? `preview:${params.templateName ?? 'unsaved-template'}`,
  };
  const scoped = renderScopedTemplateFields({
    templateScope,
    content: sourceContent,
    templatePlaceholders: storedTemplate?.placeholders ?? params.templatePlaceholders,
    partials: partials.map((partial) => ({
      id: partial.id?.trim() || `legacy-partial:${partial.name}`,
      name: partial.name,
      displayName: partial.displayName,
      content: partial.content,
      placeholders: partial.placeholders,
    })),
    customData: params.customData ?? {},
    context: contextRender.context,
    valueContext: params.companyId
      ? { kind: 'company', id: params.companyId }
      : { kind: 'global', id: params.templateScopeId },
    missingPlaceholder: 'highlight',
  });
  const content = addSectionAnchors(scoped.resolved);
  const sections = extractSections(content);
  const scopedBlockingErrors = fieldBlockingErrors(scoped);

  return {
    ...contextRender,
    content,
    contentHtml: content,
    rawResolvedContent: scoped.resolved,
    sections,
    missingPlaceholders: scoped.missing,
    missingPartials: scoped.missingPartials,
    blockingErrors: [...new Set([
      ...contextRender.blockingErrors.filter((message) => !message.startsWith('Unresolved placeholders:')),
      ...(scoped.missing.length > 0
        ? [`Unresolved placeholders: ${scoped.missing.join(', ')}`]
        : []),
      ...(scoped.missingPartials.length > 0
        ? [`Missing partials: ${scoped.missingPartials.join(', ')}`]
        : []),
      ...scopedBlockingErrors,
    ])],
  };
}
