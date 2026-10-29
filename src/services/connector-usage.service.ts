/**
 * Connector Usage Service
 *
 * Handles logging and querying of connector usage for billing, analytics, and auditing.
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import { calculateUsageCost } from '@/lib/ai/models';

// ============================================================================
// Types
// ============================================================================

export interface LogUsageParams {
  connectorId: string;
  tenantId?: string | null;
  userId?: string | null;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs?: number;
  operation?: string;
  success?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface UsageLogSearchParams {
  connectorId?: string;
  tenantId?: string;
  userId?: string;
  model?: string;
  provider?: string;
  operation?: string;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'costCents' | 'totalTokens' | 'latencyMs';
  sortOrder?: 'asc' | 'desc';
}

export interface UsageLogResult {
  id: string;
  connectorId: string;
  connectorName?: string;
  tenantId: string | null;
  tenantName?: string;
  userId: string | null;
  userName?: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  costUsd: number;
  latencyMs: number | null;
  operation: string | null;
  success: boolean;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface UsageStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  totalCostUsd: number;
  avgLatencyMs: number | null;
  byModel: Array<{
    model: string;
    calls: number;
    tokens: number;
    costCents: number;
  }>;
  byDay: Array<{
    date: string;
    calls: number;
    costCents: number;
  }>;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Log a connector usage event
 */
export async function logConnectorUsage(params: LogUsageParams): Promise<void> {
  const {
    connectorId,
    tenantId,
    userId,
    model,
    provider,
    inputTokens,
    outputTokens,
    totalTokens,
    latencyMs,
    operation,
    success = true,
    errorMessage,
    metadata,
  } = params;

  const metadataRecord =
    metadata && typeof metadata === 'object' ? metadata : undefined;
  const pagesProcessed =
    typeof metadataRecord?.pagesProcessed === 'number'
      ? metadataRecord.pagesProcessed
      : undefined;
  const batchMode =
    metadataRecord?.batchMode === true ||
    typeof metadataRecord?.batchJobId === 'string' ||
    (typeof operation === 'string' && operation.includes('batch'));

  // Calculate cost in micro-dollars (1/10000 of USD for 4 decimal precision)
  const costUsd = calculateUsageCost({
    modelId: model,
    provider,
    inputTokens,
    outputTokens,
    totalTokens,
    pagesProcessed,
    batchMode,
  });
  const costCents = Math.round(costUsd * 10000);

  try {
    await prisma.$transaction([
      // Create usage log
      prisma.connectorUsageLog.create({
        data: {
          connectorId,
          workspaceId: tenantId || null,
          userId: userId || null,
          model,
          provider,
          inputTokens,
          outputTokens,
          totalTokens,
          costCents,
          latencyMs,
          operation,
          success,
          errorMessage,
          metadata: metadata as Prisma.InputJsonValue,
        },
      }),
      // Update connector stats
      prisma.connector.update({
        where: { id: connectorId },
        data: {
          callCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      }),
    ]);
  } catch (error) {
    // Don't fail the main operation if logging fails
    console.error('[ConnectorUsage] Failed to log usage:', error);
  }
}

/**
 * Search usage logs with filtering
 */
export async function searchUsageLogs(
  params: UsageLogSearchParams
): Promise<{ logs: UsageLogResult[]; total: number }> {
  const {
    connectorId,
    tenantId,
    userId,
    model,
    provider,
    operation,
    success,
    startDate,
    endDate,
    page = 1,
    limit = 50,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = params;

  const where: Prisma.ConnectorUsageLogWhereInput = {
    ...(connectorId && { connectorId }),
    ...(tenantId && { workspaceId: tenantId }),
    ...(userId && { userId }),
    ...(model && { model }),
    ...(provider && { provider }),
    ...(operation && { operation }),
    ...(typeof success === 'boolean' && { success }),
    ...(startDate || endDate
      ? {
          createdAt: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        }
      : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.connectorUsageLog.findMany({
      where,
      include: {
        connector: { select: { name: true } },
        workspace: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.connectorUsageLog.count({ where }),
  ]);

  return {
    logs: logs.map((log) => ({
      id: log.id,
      connectorId: log.connectorId,
      connectorName: log.connector?.name,
      tenantId: log.workspaceId,
      tenantName: log.workspace?.name,
      userId: log.userId,
      userName: log.user ? `${log.user.firstName} ${log.user.lastName}` : undefined,
      model: log.model,
      provider: log.provider,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      totalTokens: log.totalTokens,
      costCents: log.costCents,
      costUsd: log.costCents / 10000,
      latencyMs: log.latencyMs,
      operation: log.operation,
      success: log.success,
      errorMessage: log.errorMessage,
      metadata: log.metadata as Record<string, unknown> | null,
      createdAt: log.createdAt,
    })),
    total,
  };
}

/**
 * Get usage statistics for a connector
 */
export async function getUsageStats(
  connectorId: string,
  startDate?: Date,
  endDate?: Date
): Promise<UsageStats> {
  const where: Prisma.ConnectorUsageLogWhereInput = {
    connectorId,
    ...(startDate || endDate
      ? {
          createdAt: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        }
      : {}),
  };

  // Get aggregate stats
  const [aggregates, byModel, byDay] = await Promise.all([
    prisma.connectorUsageLog.aggregate({
      where,
      _count: { id: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        costCents: true,
      },
      _avg: { latencyMs: true },
    }),
    // Group by model
    prisma.connectorUsageLog.groupBy({
      by: ['model'],
      where,
      _count: { id: true },
      _sum: { totalTokens: true, costCents: true },
    }),
    // Group by day - using raw query for date truncation
    prisma.$queryRaw<Array<{ date: Date; calls: bigint; cost_cents: bigint }>>`
      SELECT
        DATE_TRUNC('day', "createdAt") as date,
        COUNT(*) as calls,
        COALESCE(SUM("costCents"), 0) as cost_cents
      FROM connector_usage_logs
      WHERE "connectorId" = ${connectorId}
        ${startDate ? Prisma.sql`AND "createdAt" >= ${startDate}` : Prisma.empty}
        ${endDate ? Prisma.sql`AND "createdAt" <= ${endDate}` : Prisma.empty}
      GROUP BY DATE_TRUNC('day', "createdAt")
      ORDER BY date DESC
      LIMIT 30
    `,
  ]);

  // Get success/failure counts
  const successCounts = await prisma.connectorUsageLog.groupBy({
    by: ['success'],
    where,
    _count: { id: true },
  });

  const successfulCalls =
    successCounts.find((s) => s.success === true)?._count.id ?? 0;
  const failedCalls = successCounts.find((s) => s.success === false)?._count.id ?? 0;

  return {
    totalCalls: aggregates._count.id,
    successfulCalls,
    failedCalls,
    totalTokens: aggregates._sum.totalTokens ?? 0,
    totalInputTokens: aggregates._sum.inputTokens ?? 0,
    totalOutputTokens: aggregates._sum.outputTokens ?? 0,
    totalCostCents: aggregates._sum.costCents ?? 0,
    totalCostUsd: (aggregates._sum.costCents ?? 0) / 10000,
    avgLatencyMs: aggregates._avg.latencyMs,
    byModel: byModel.map((m) => ({
      model: m.model,
      calls: m._count.id,
      tokens: m._sum.totalTokens ?? 0,
      costCents: m._sum.costCents ?? 0,
    })),
    byDay: byDay.map((d) => ({
      date: d.date.toISOString().split('T')[0],
      calls: Number(d.calls),
      costCents: Number(d.cost_cents),
    })),
  };
}

/**
 * Export usage logs as CSV
 */
export async function exportUsageLogs(
  params: UsageLogSearchParams
): Promise<string> {
  // Get all matching logs (no pagination for export)
  const { logs } = await searchUsageLogs({
    ...params,
    page: 1,
    limit: 10000, // Max export size
  });

  // Build CSV
  const headers = [
    'Date',
    'Time',
    'Connector',
    'Workspace',
    'User',
    'Model',
    'Provider',
    'Operation',
    'Input Tokens',
    'Output Tokens',
    'Total Tokens',
    'Cost (USD)',
    'Latency (ms)',
    'Status',
    'Error',
  ];

  const rows = logs.map((log) => [
    log.createdAt.toISOString().split('T')[0],
    log.createdAt.toISOString().split('T')[1].split('.')[0],
    log.connectorName || log.connectorId,
    log.tenantName || log.tenantId || 'System',
    log.userName || log.userId || 'N/A',
    log.model,
    log.provider,
    log.operation || 'N/A',
    log.inputTokens.toString(),
    log.outputTokens.toString(),
    log.totalTokens.toString(),
    log.costUsd.toFixed(4),
    log.latencyMs?.toString() || 'N/A',
    log.success ? 'Success' : 'Failed',
    log.errorMessage || '',
  ]);

  // Escape CSV values
  const escapeCSV = (value: string) => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const csvLines = [
    headers.map(escapeCSV).join(','),
    ...rows.map((row) => row.map(escapeCSV).join(',')),
  ];

  return csvLines.join('\n');
}

/**
 * Get usage summary for all connectors (for admin dashboard)
 */
export async function getAllConnectorsUsageSummary(
  tenantId?: string | null,
  startDate?: Date,
  endDate?: Date
): Promise<
  Array<{
    connectorId: string;
    connectorName: string;
    provider: string;
    totalCalls: number;
    totalCostCents: number;
    lastUsedAt: Date | null;
  }>
> {
  const where: Prisma.ConnectorUsageLogWhereInput = {
    ...(tenantId !== undefined && { workspaceId: tenantId }),
    ...(startDate || endDate
      ? {
          createdAt: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        }
      : {}),
  };

  const result = await prisma.connectorUsageLog.groupBy({
    by: ['connectorId'],
    where,
    _count: { id: true },
    _sum: { costCents: true },
    _max: { createdAt: true },
  });

  // Get connector details
  const connectorIds = result.map((r) => r.connectorId);
  const connectors = await prisma.connector.findMany({
    where: { id: { in: connectorIds } },
    select: { id: true, name: true, provider: true },
  });

  const connectorMap = new Map(connectors.map((c) => [c.id, c]));

  return result.map((r) => {
    const connector = connectorMap.get(r.connectorId);
    return {
      connectorId: r.connectorId,
      connectorName: connector?.name ?? 'Unknown',
      provider: connector?.provider ?? 'unknown',
      totalCalls: r._count.id,
      totalCostCents: r._sum.costCents ?? 0,
      lastUsedAt: r._max.createdAt,
    };
  });
}
