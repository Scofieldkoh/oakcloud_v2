import { NextRequest, NextResponse } from 'next/server';
import { createErrorResponse } from '@/lib/api-helpers';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { z } from 'zod';
import { callAIWithConnector } from '@/lib/ai';
import { requireAuth } from '@/lib/auth';
import {
  normalizeModel,
  persistModels,
  readEditableModels,
  toResponseModel,
} from '@/lib/ai/connector-model-settings';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const pdfTestSchema = z.object({
  modelId: z.string().trim().min(1),
});

async function buildPdfInputTestDocument(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 160]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('PDF input test', {
    x: 32,
    y: 92,
    size: 22,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText('Reply with JSON: {"ok": true}', {
    x: 32,
    y: 58,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });

  return Buffer.from(await pdf.save());
}

async function getAuthorizedConnector(id: string) {
  const session = await requireAuth();

  if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  const connector = await prisma.connector.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(session.isSuperAdmin ? {} : { workspaceId: session.tenantId }),
    },
  });

  if (!connector) {
    return { error: NextResponse.json({ error: 'Connector not found' }, { status: 404 }) };
  }

  if (!session.isSuperAdmin && !connector.workspaceId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { connector, session };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const authorized = await getAuthorizedConnector(id);
    if (authorized.error) return authorized.error;
    const { connector, session } = authorized;

    if (connector.type !== 'AI_PROVIDER' || connector.provider !== 'OPENROUTER') {
      return NextResponse.json(
        { error: 'PDF input testing is only available for OpenRouter AI connectors' },
        { status: 400 }
      );
    }

    const { modelId } = pdfTestSchema.parse(await request.json());
    const overrides = (await prisma.connectorModelConfig.findMany({
      where: { connectorId: id },
      select: { modelId: true, isEnabled: true },
    })) ?? [];
    const models = readEditableModels(connector, overrides);
    const model = models.find((item) => item.modelId === modelId);
    if (!model) {
      return NextResponse.json({ error: 'Model not found for this connector' }, { status: 404 });
    }

    const pdfBuffer = await buildPdfInputTestDocument();
    const testedAt = new Date().toISOString();
    let testError: string | undefined;
    let supportsPdfInput = false;

    try {
      await callAIWithConnector({
        model: modelId,
        tenantId: connector.workspaceId,
        userId: session.id,
        connectorId: connector.id,
        isSuperAdmin: session.isSuperAdmin,
        preferredProvider: 'openrouter',
        userPrompt: 'Read the attached PDF and respond with {"ok":true}.',
        jsonMode: true,
        images: [{ base64: pdfBuffer.toString('base64'), mimeType: 'application/pdf' }],
        operation: 'connector_pdf_input_test',
        temperature: 0,
        maxTokens: 40,
      });
      supportsPdfInput = true;
    } catch (error) {
      testError = error instanceof Error ? error.message : 'PDF input test failed';
    }

    const nextModel = normalizeModel({
      ...model,
      supportsPdfInput,
      documentInputMode: supportsPdfInput ? 'pdf' : 'image',
      lastPdfInputTest: {
        success: supportsPdfInput,
        testedAt,
        error: testError,
      },
    });
    const nextModels = models.map((item) => (item.modelId === modelId ? nextModel : item));
    await persistModels(connector, nextModels);

    const responseBody = {
      success: supportsPdfInput,
      model: toResponseModel(nextModel),
      error: testError,
    };
    return NextResponse.json(responseBody, { status: supportsPdfInput ? 200 : 200 });
  } catch (error) {
    return createErrorResponse(error);
  }
}
