import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, resolveWorkspaceId } from '@/lib/api-helpers';
import { callAIWithConnector, stripMarkdownCodeBlocks, type AIModel } from '@/lib/ai';
import { getFormById } from '@/services/form-builder.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const translationItemSchema = z.object({
  key: z.string().min(1).max(300),
  text: z.string().min(1).max(12000),
  context: z.string().max(2000).optional().default(''),
});

const requestSchema = z.object({
  tenantId: z.string().uuid().optional().nullable(),
  model: z.string().min(1).max(120),
  targetLocale: z.string().min(2).max(32),
  items: z.array(translationItemSchema).min(1).max(2000),
  instructions: z.string().max(4000).optional().default(''),
});

const aiResponseSchema = z.object({
  translations: z.record(z.string()),
});

const MAX_TOTAL_SOURCE_CHARS = 200000;

function buildTranslationPrompt(
  targetLocale: string,
  items: Array<{ key: string; text: string; context?: string }>,
  instructions: string
): string {
  const guidance = [
    `Target locale: ${targetLocale}`,
    instructions.trim() ? `Additional instructions:\n${instructions.trim()}` : '',
    'Translate each item from English to the target locale.',
    'Keep placeholders unchanged (for example: [field_key], {{variable}}, {0}, %s).',
    'Do not remove URLs, emails, IDs, or product names unless translation is necessary.',
    'Return only JSON with this exact shape: {"translations":{"<key>":"<translated text>"}}',
    `Items:\n${JSON.stringify(items, null, 2)}`,
  ].filter(Boolean);

  return guidance.join('\n\n');
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

    const totalSourceChars = parsed.items.reduce((sum, item) => sum + item.text.length, 0);
    if (totalSourceChars > MAX_TOTAL_SOURCE_CHARS) {
      return NextResponse.json(
        { error: 'Too much text to translate in a single request. Reduce field content and try again.' },
        { status: 400 }
      );
    }

    const prompt = buildTranslationPrompt(
      parsed.targetLocale,
      parsed.items.map((item) => ({
        key: item.key,
        text: item.text,
        context: item.context || undefined,
      })),
      parsed.instructions || ''
    );

    const aiResponse = await callAIWithConnector({
      tenantId,
      userId: session.id,
      model: parsed.model as AIModel,
      userPrompt: prompt,
      systemPrompt: 'You are a strict translation engine for web form content. Return JSON only.',
      jsonMode: true,
      temperature: 0.1,
      operation: 'form_translation',
      usageMetadata: {
        formId: id,
        targetLocale: parsed.targetLocale,
        itemCount: parsed.items.length,
      },
    });

    const cleanedContent = stripMarkdownCodeBlocks(aiResponse.content);
    const parsedAiPayload = aiResponseSchema.parse(JSON.parse(cleanedContent));
    const allowedKeys = new Set(parsed.items.map((item) => item.key));

    const translations: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsedAiPayload.translations)) {
      if (!allowedKeys.has(key)) continue;
      const normalized = value.trim();
      if (!normalized) continue;
      translations[key] = normalized;
    }

    if (Object.keys(translations).length === 0) {
      return NextResponse.json(
        { error: 'AI did not return any usable translations.' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      translations,
      translatedCount: Object.keys(translations).length,
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
