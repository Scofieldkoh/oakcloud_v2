import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, PoolConfig } from 'pg';
import { getPrismaLogConfig, createLogger, isLogLevelEnabled } from './logger';

const prismaLogger = createLogger('prisma');

// Slow query threshold in milliseconds (configurable via env)
const SLOW_QUERY_THRESHOLD = parseInt(process.env.SLOW_QUERY_THRESHOLD || '100', 10);

declare global {
  var __prisma: PrismaClient | undefined;
  var __prismaPool: Pool | undefined;
}

/**
 * Create a PostgreSQL connection pool
 */
function createPool(): Pool {
  if (global.__prismaPool) {
    return global.__prismaPool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const poolConfig: PoolConfig = {
    connectionString,
    max: 20, // Increased for better concurrency
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  if (process.env.NODE_ENV === 'production' && process.env.DATABASE_SSL !== 'false') {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  const pool = new Pool(poolConfig);
  global.__prismaPool = pool;
  return pool;
}

/**
 * Initialize Prisma Client - called from instrumentation.ts or on first use
 */
export function initializePrisma(): PrismaClient {
  if (global.__prisma) {
    return global.__prisma;
  }

  const logConfig = getPrismaLogConfig();
  const enableSlowQueryLogging = isLogLevelEnabled('debug');

  prismaLogger.debug(`Initializing Prisma 7 with log levels: ${logConfig.join(', ') || 'none'}`);
  if (enableSlowQueryLogging) {
    prismaLogger.debug(`Slow query logging enabled (threshold: ${SLOW_QUERY_THRESHOLD}ms)`);
  }

  const pool = createPool();
  const adapter = new PrismaPg(pool);

  // Configure Prisma with event-based logging for slow queries
  const client = new PrismaClient({
    adapter,
    log: enableSlowQueryLogging
      ? [
          { emit: 'event', level: 'query' },
          ...logConfig.filter(l => l !== 'query').map(level => ({ emit: 'stdout' as const, level })),
        ]
      : logConfig,
  });

  // Log slow queries when debug level is enabled
  if (enableSlowQueryLogging) {
    client.$on('query', (e: { query: string; params: string; duration: number; target: string }) => {
      if (e.duration >= SLOW_QUERY_THRESHOLD) {
        const queryPreview = e.query.length > 200 ? e.query.substring(0, 200) + '...' : e.query;
        prismaLogger.warn(`SLOW QUERY (${e.duration}ms): ${queryPreview}`);

        // Log full query details at trace level
        if (isLogLevelEnabled('trace')) {
          prismaLogger.trace(`Full query: ${e.query}`);
          prismaLogger.trace(`Params: ${e.params}`);
        }
      }
    });
  }

  global.__prisma = client;
  return client;
}

/**
 * Get the Prisma client instance
 */
export function getPrisma(): PrismaClient {
  if (!global.__prisma) {
    return initializePrisma();
  }
  return global.__prisma;
}

// CRITICAL FIX: Lazy proxy that defers initialization until first use
// This prevents module-level execution timing issues with instrumentation.ts
export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop) {
    return getPrisma()[prop as keyof PrismaClient];
  },
});

export default prisma;
