import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { callAIWithConnector, getDefaultModelId, stripMarkdownCodeBlocks } from '@/lib/ai';
import { getFormById } from '@/services/form-builder.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const requestSchema = z.object({
  tenantId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().min(1).max(12000),
});

const aiResponseSchema = z.object({
  customContext: z.string().trim().min(1).max(10000),
});

function buildAiAssistPrompt(input: {
  formTitle: string;
  formDescription: string | null;
  notes: string;
}): string {
  return [
    'You are helping a form administrator write a custom context prompt for an internal AI review workflow.',
    'Rewrite the user\'s rough notes into a production-ready custom context that can be pasted directly into form settings.',
    '',
    'The generated custom context will later be sent to another AI model together with:',
    '- submitted form answers',
    '- uploaded attachments',
    '- the custom context you generate',
    '',
    'Requirements for the generated custom context:',
    '- Write instructions addressed to the downstream reviewing AI.',
    '- Use a concise, structured format with short sections or bullets when helpful.',
    '- Preserve the user\'s domain, jurisdiction, risk checks, document checks, and escalation logic.',
    '- Assume the downstream AI only has the submitted answers and attachments.',
    '- Do not assume internet access, sanctions tools, adverse media tools, or external databases unless the user notes explicitly say such screening results are included in the submitted materials.',
    '- Instruct the downstream AI not to invent facts and to state clearly when something cannot be verified from the provided materials.',
    '- Require JSON-only output with exactly this schema:',
    JSON.stringify({
      reviewRequired: true,
      severity: 'medium',
      summary: 'Short operational summary for staff',
      tags: ['short-label'],
      sections: [
        {
          title: 'Issues found',
          type: 'bullet_list',
          items: ['Specific finding'],
        },
      ],
    }, null, 2),
    '- Keep a small fixed workflow envelope: reviewRequired, severity, summary, and tags.',
    '- Use sections for the detailed form-specific output instead of inventing fixed fields like warnings or recommendedActions.',
    '- Allow only these section types: text, bullet_list, key_value.',
    '- Tell the downstream AI to write findings in plain language without internal field keys or uploaded file names.',
    '- Include clear decision rules for reviewRequired and severity.',
    '- Keep tags short and stable.',
    '- Keep the result practical and token-efficient for repeated production use.',
    '- Return only JSON with this exact shape: {"customContext":"..."}',
    '',
    `Form title: ${input.formTitle}`,
    input.formDescription ? `Form description: ${input.formDescription}` : 'Form description: null',
    '',
    'User notes to convert:',
    input.notes,
  ].join('\n');
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');

    const body = await request.json();
    const parsed = requestSchema.parse(body);
    const tenantId = resolveWorkspaceId(session, parsed.tenantId);

    const form = await getFormById(id, tenantId);
    if (!form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    const aiResponse = await callAIWithConnector({
      tenantId,
      userId: session.id,
      model: getDefaultModelId(),
      userPrompt: buildAiAssistPrompt({
        formTitle: form.title,
        formDescription: form.description,
        notes: parsed.notes,
      }),
      systemPrompt: 'You rewrite rough review notes into concise production-ready custom AI instructions. Return JSON only.',
      jsonMode: true,
      temperature: 0.2,
      operation: 'form_ai_context_assist',
      usageMetadata: {
        formId: id,
      },
    });

    const cleanedContent = stripMarkdownCodeBlocks(aiResponse.content);
    const parsedAiPayload = aiResponseSchema.parse(JSON.parse(cleanedContent));

    return NextResponse.json({
      customContext: parsedAiPayload.customContext.trim(),
      model: aiResponse.model,
      provider: aiResponse.provider,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid payload', details: error.flatten() },
        { status: 400 }
      );
    }

    return createErrorResponse(error);
  }
}
